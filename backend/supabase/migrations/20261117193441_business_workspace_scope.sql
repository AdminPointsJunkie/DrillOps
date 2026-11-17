-- Additive hierarchy. Historic identifiers, amounts and source documents are retained.
CREATE SCHEMA IF NOT EXISTS business_private;
REVOKE ALL ON SCHEMA business_private FROM PUBLIC;
CREATE TABLE public.business_workspaces (
 id uuid PRIMARY KEY, name text NOT NULL, client_id integer UNIQUE REFERENCES public.clients(id),
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.business_projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.business_workspaces(id),
 name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,name), UNIQUE(id,workspace_id));
CREATE TABLE public.business_campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, project_id uuid NOT NULL,
 legacy_project_id integer UNIQUE REFERENCES public.projects(id), name text NOT NULL, year text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,workspace_id) REFERENCES public.business_projects(id,workspace_id), UNIQUE(project_id,name), UNIQUE(id,workspace_id));
CREATE TABLE public.business_shares (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.business_workspaces(id),
 user_id uuid NOT NULL, project_id uuid, campaign_id uuid, role text NOT NULL CHECK(role IN ('viewer','editor')),
 apps text[] NOT NULL DEFAULT ARRAY['eos','account','project'], created_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((project_id IS NULL) <> (campaign_id IS NULL)), CHECK(apps <@ ARRAY['eos','account','project'] AND cardinality(apps)>0),
 FOREIGN KEY(project_id,workspace_id) REFERENCES public.business_projects(id,workspace_id),
 FOREIGN KEY(campaign_id,workspace_id) REFERENCES public.business_campaigns(id,workspace_id));
CREATE UNIQUE INDEX business_share_project ON public.business_shares(workspace_id,user_id,project_id) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX business_share_campaign ON public.business_shares(workspace_id,user_id,campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX business_share_user ON public.business_shares(user_id,workspace_id);
CREATE TABLE public.business_access_events(id bigserial PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES public.business_workspaces(id),
 actor_id uuid NOT NULL, action text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.business_workspaces(id,name,client_id) VALUES
 ('a7ecd88b-8ba9-4c5f-80c8-872fcc50f34f','ARGO NR',1),
 ('00000000-0000-4000-8000-000000000008','App Store Review Demo',8);
-- A known SIS campaign already has activity evidence but lacked a registry row.
INSERT INTO public.projects(contractor,name,year,status,program,client_id)
SELECT 'Company','Ironbark','2026','Active','SIS',1
WHERE EXISTS(SELECT 1 FROM public.activities WHERE project='Ironbark' AND program='SIS')
AND NOT EXISTS(SELECT 1 FROM public.projects WHERE name='Ironbark' AND program='SIS' AND year='2026' AND client_id=1);
INSERT INTO public.business_projects(workspace_id,name)
SELECT DISTINCT w.id,COALESCE(NULLIF(btrim(p.program),''),'Unallocated') FROM public.projects p
JOIN public.business_workspaces w ON w.client_id=p.client_id;
INSERT INTO public.business_campaigns(workspace_id,project_id,legacy_project_id,name,year)
SELECT bp.workspace_id,bp.id,p.id,
 CASE WHEN p.name='Ironbark' AND p.program='Exploration' THEN 'Ironbark No1' ELSE p.name END || ' ' || p.year,p.year
FROM public.projects p JOIN public.business_workspaces w ON w.client_id=p.client_id
JOIN public.business_projects bp ON bp.workspace_id=w.id AND bp.name=COALESCE(NULLIF(btrim(p.program),''),'Unallocated');
DO $$ BEGIN CREATE ROLE drillops_business NOLOGIN NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT drillops_business TO postgres;
GRANT USAGE ON SCHEMA public,business_private TO drillops_business;
ALTER TABLE public.business_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_access_events ENABLE ROW LEVEL SECURITY;
-- Metadata/shares are read and changed only through explicitly authorized platform endpoints.
REVOKE ALL ON public.business_workspaces,public.business_projects,public.business_campaigns,public.business_shares,public.business_access_events FROM anon,authenticated;
GRANT SELECT ON public.business_workspaces,public.business_projects,public.business_campaigns TO drillops_business;
CREATE POLICY business_metadata_workspaces ON public.business_workspaces TO drillops_business USING(id::text=current_setting('app.workspace_id',true));
CREATE POLICY business_metadata_projects ON public.business_projects TO drillops_business USING(workspace_id::text=current_setting('app.workspace_id',true));
CREATE POLICY business_metadata_campaigns ON public.business_campaigns TO drillops_business USING(workspace_id::text=current_setting('app.workspace_id',true));

CREATE FUNCTION business_private.allowed(w uuid,p uuid,c uuid,write_access boolean,catalog boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT COALESCE(w::text=current_setting('app.workspace_id',true)
 AND (catalog OR NULLIF(current_setting('app.campaign_id',true),'') IS NULL OR c::text=current_setting('app.campaign_id',true))
 AND (catalog OR NULLIF(current_setting('app.business_project_id',true),'') IS NULL OR p::text=current_setting('app.business_project_id',true))
 AND (current_setting('app.workspace_admin',true)='true' OR
  (NOT write_access AND catalog) OR
  p::text=ANY(string_to_array(current_setting(CASE WHEN write_access THEN 'app.write_projects' ELSE 'app.read_projects' END,true),',')) OR
  c::text=ANY(string_to_array(current_setting(CASE WHEN write_access THEN 'app.write_campaigns' ELSE 'app.read_campaigns' END,true),','))),false);
$$;
REVOKE ALL ON FUNCTION business_private.allowed(uuid,uuid,uuid,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business_private.allowed(uuid,uuid,uuid,boolean,boolean) TO drillops_business;

CREATE FUNCTION business_private.resolve_scope(t text,j jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE w uuid; p uuid; c uuid; parent jsonb; legacy integer; matches integer; src text;
BEGIN
 w:=NULLIF(j->>'workspace_id','')::uuid;
 IF w IS NULL AND j ? 'client_id' THEN SELECT id INTO w FROM public.business_workspaces WHERE client_id=NULLIF(j->>'client_id','')::integer; END IF;
 IF w IS NULL AND (j->>'contractor'='App Review Drilling' OR (t='clients' AND j->>'id'='8')) THEN w:='00000000-0000-4000-8000-000000000008'; END IF;
 w:=COALESCE(w,NULLIF(current_setting('app.workspace_id',true),'')::uuid,'a7ecd88b-8ba9-4c5f-80c8-872fcc50f34f'::uuid);
 legacy:=CASE WHEN t='projects' THEN (j->>'id')::integer ELSE COALESCE(NULLIF(j->>'allocated_project_id',''),NULLIF(j->>'project_id',''))::integer END;
 IF legacy IS NOT NULL THEN SELECT project_id,id INTO p,c FROM public.business_campaigns WHERE legacy_project_id=legacy AND workspace_id=w; IF c IS NULL AND t<>'projects' AND current_user='drillops_business' THEN RAISE EXCEPTION 'Referenced campaign is inaccessible' USING ERRCODE='42501'; END IF; END IF;
 IF c IS NULL AND NULLIF(j->>'project','') IS NOT NULL THEN
  SELECT count(*),(array_agg(bc.id))[1],(array_agg(bc.project_id))[1] INTO matches,c,p
  FROM public.business_campaigns bc JOIN public.projects lp ON lp.id=bc.legacy_project_id
  WHERE bc.workspace_id=w AND lower(btrim(lp.name))=lower(btrim(j->>'project'))
  AND (NULLIF(j->>'program','') IS NULL OR lp.program=j->>'program')
  AND (COALESCE(NULLIF(j->>'planned_year',''),NULLIF(j->>'year','')) IS NULL OR bc.year=COALESCE(NULLIF(j->>'planned_year',''),NULLIF(j->>'year','')));
  IF matches<>1 THEN c:=NULL;p:=NULL;END IF;
 END IF;
 IF NULLIF(j->>'invoice_id','') IS NOT NULL THEN SELECT to_jsonb(x) INTO parent FROM public.invoices x WHERE id=(j->>'invoice_id')::integer;
 ELSIF NULLIF(j->>'contract_id','') IS NOT NULL THEN SELECT to_jsonb(x) INTO parent FROM public.cost_contracts x WHERE id=(j->>'contract_id')::integer;
 ELSIF NULLIF(j->>'dar_id','') IS NOT NULL THEN SELECT to_jsonb(x) INTO parent FROM public.daily_activity_reports x WHERE id=(j->>'dar_id')::uuid;
 END IF;
 IF current_user='drillops_business' AND parent IS NULL AND (NULLIF(j->>'invoice_id','') IS NOT NULL OR NULLIF(j->>'contract_id','') IS NOT NULL OR NULLIF(j->>'dar_id','') IS NOT NULL) THEN RAISE EXCEPTION 'Referenced parent is inaccessible' USING ERRCODE='42501';END IF;
 IF parent->>'workspace_id' IS NOT NULL THEN w:=(parent->>'workspace_id')::uuid;p:=(parent->>'business_project_id')::uuid;c:=(parent->>'campaign_id')::uuid; END IF;
 src:=COALESCE(NULLIF(j->>'source_file',''),NULLIF(j->>'filename',''));
 IF c IS NULL AND src IS NOT NULL AND t NOT IN ('activities','invoices','import_batches') THEN
  SELECT count(DISTINCT a.campaign_id),(array_agg(a.campaign_id) FILTER(WHERE a.campaign_id IS NOT NULL))[1],
   (array_agg(a.business_project_id) FILTER(WHERE a.business_project_id IS NOT NULL))[1]
  INTO matches,c,p FROM public.activities a WHERE a.workspace_id=w AND a.source_file=src AND a.contractor=j->>'contractor';
  IF matches<>1 THEN c:=NULL;p:=NULL;END IF;
 END IF;
 IF p IS NULL THEN SELECT id INTO p FROM public.business_projects WHERE workspace_id=w AND name=j->>'program'; END IF;
 IF t='ironbark_posted_costs' THEN SELECT bc.id,bc.project_id INTO c,p FROM public.business_campaigns bc JOIN public.projects lp ON lp.id=bc.legacy_project_id WHERE bc.workspace_id=w AND lp.name='Ironbark' AND lp.program='Exploration' AND bc.year=COALESCE(NULLIF(j->>'reporting_year',''),'2026'); END IF;
 RETURN jsonb_build_object('workspace_id',w,'business_project_id',p,'campaign_id',c);
END $$;
REVOKE ALL ON FUNCTION business_private.resolve_scope(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business_private.resolve_scope(text,jsonb) TO drillops_business;

CREATE FUNCTION business_private.stamp_scope() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s jsonb; w uuid; p uuid; c uuid; selected_campaign uuid; selected_project uuid; legacy_row record;
BEGIN
 s:=business_private.resolve_scope(TG_TABLE_NAME,to_jsonb(NEW));
 w:=(s->>'workspace_id')::uuid;p:=(s->>'business_project_id')::uuid;c:=(s->>'campaign_id')::uuid;
 selected_campaign:=NULLIF(current_setting('app.campaign_id',true),'')::uuid;
 selected_project:=NULLIF(current_setting('app.business_project_id',true),'')::uuid;
 IF TG_OP='UPDATE' AND OLD.workspace_id IS DISTINCT FROM w THEN RAISE EXCEPTION 'Records cannot be moved between company workspaces' USING ERRCODE='42501';END IF;
 IF selected_campaign IS NOT NULL AND TG_ARGV[0]<>'catalog' THEN
  SELECT lp.name,lp.program INTO legacy_row FROM public.business_campaigns bc JOIN public.projects lp ON lp.id=bc.legacy_project_id WHERE bc.id=selected_campaign;
  IF (NULLIF(to_jsonb(NEW)->>'project','') IS NOT NULL AND lower(btrim(to_jsonb(NEW)->>'project'))<>lower(btrim(legacy_row.name)))
    OR (NULLIF(to_jsonb(NEW)->>'program','') IS NOT NULL AND to_jsonb(NEW)->>'program'<>legacy_row.program) THEN
    RAISE EXCEPTION 'Record does not match the selected campaign (row-level security)' USING ERRCODE='42501';
  END IF;
 END IF;
 IF TG_ARGV[0]<>'catalog' THEN
  IF c IS NULL AND selected_campaign IS NOT NULL THEN SELECT id,project_id INTO c,p FROM public.business_campaigns WHERE id=selected_campaign AND workspace_id=w;END IF;
  p:=COALESCE(p,selected_project);
 END IF;
 NEW.workspace_id:=w;NEW.business_project_id:=p;NEW.campaign_id:=c;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION business_private.stamp_scope() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business_private.stamp_scope() TO drillops_business;

ALTER TABLE public.clients ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.contractors ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.projects ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.activities ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.invoices ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.purchase_orders ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.boreholes ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.daily_activity_reports ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.cost_contracts ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.invoice_lines ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.invoice_attachments ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.cost_contract_rates ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.consumables ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.crew ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.source_files ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.imported_files ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.invoice_imports ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.report_approvals ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.activity_sheet_locks ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.minimum_shift_topup_preferences ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.project_budgets ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.cost_centre_forecasts ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.ironbark_posted_costs ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.rig_schedule ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.account_accruals ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.lab_samples ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.day_rate_days ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.day_rate_rosters ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.project_register_imports ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.project_register_records ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.hourly_rates ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.drilling_rates ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.consumable_rates ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.lab_rates ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.mcc_swipe_history ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.training_workspaces ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.training_sources ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.training_cardholders ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.training_configuration ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.import_batches ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);

ALTER TABLE public.activities_csv_import ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id), ADD COLUMN business_project_id uuid REFERENCES public.business_projects(id), ADD COLUMN campaign_id uuid REFERENCES public.business_campaigns(id);
UPDATE public.clients x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('clients',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('clients',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('clients',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.clients ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.clients(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('catalog');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.clients TO drillops_business;
CREATE POLICY business_read ON public.clients FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,true));
CREATE POLICY business_insert ON public.clients FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true));
CREATE POLICY business_update ON public.clients FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true));
CREATE POLICY business_delete ON public.clients FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true));
UPDATE public.contractors x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('contractors',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('contractors',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('contractors',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.contractors ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.contractors ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.contractors(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.contractors FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('catalog');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.contractors TO drillops_business;
CREATE POLICY business_read ON public.contractors FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,true));
CREATE POLICY business_insert ON public.contractors FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true));
CREATE POLICY business_update ON public.contractors FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true));
CREATE POLICY business_delete ON public.contractors FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true));
UPDATE public.projects x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('projects',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('projects',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('projects',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.projects ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.projects(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.projects TO drillops_business;
CREATE POLICY business_read ON public.projects FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.projects FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.projects FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.projects FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.invoices x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('invoices',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('invoices',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('invoices',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.invoices ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.invoices(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.invoices TO drillops_business;
CREATE POLICY business_read ON public.invoices FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.invoices FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.invoices FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.invoices FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.purchase_orders x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('purchase_orders',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('purchase_orders',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('purchase_orders',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.purchase_orders ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.purchase_orders(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.purchase_orders TO drillops_business;
CREATE POLICY business_read ON public.purchase_orders FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.purchase_orders FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.purchase_orders FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.purchase_orders FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.boreholes x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('boreholes',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('boreholes',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('boreholes',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.boreholes ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.boreholes ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.boreholes(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.boreholes FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.boreholes TO drillops_business;
CREATE POLICY business_read ON public.boreholes FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.boreholes FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.boreholes FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.boreholes FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.daily_activity_reports x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('daily_activity_reports',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('daily_activity_reports',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('daily_activity_reports',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.daily_activity_reports ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.daily_activity_reports ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.daily_activity_reports(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.daily_activity_reports FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.daily_activity_reports TO drillops_business;
CREATE POLICY business_read ON public.daily_activity_reports FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.daily_activity_reports FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.daily_activity_reports FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.daily_activity_reports FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.activities x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('activities',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('activities',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('activities',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.activities ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.activities(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.activities FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.activities TO drillops_business;
CREATE POLICY business_read ON public.activities FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.activities FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.activities FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.activities FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.cost_contracts x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('cost_contracts',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('cost_contracts',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('cost_contracts',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.cost_contracts ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.cost_contracts ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.cost_contracts(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.cost_contracts FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.cost_contracts TO drillops_business;
CREATE POLICY business_read ON public.cost_contracts FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.cost_contracts FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.cost_contracts FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.cost_contracts FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.invoice_lines x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('invoice_lines',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('invoice_lines',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('invoice_lines',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.invoice_lines ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.invoice_lines(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.invoice_lines FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.invoice_lines TO drillops_business;
CREATE POLICY business_read ON public.invoice_lines FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.invoice_lines FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.invoice_lines FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.invoice_lines FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.invoice_attachments x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('invoice_attachments',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('invoice_attachments',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('invoice_attachments',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.invoice_attachments ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.invoice_attachments ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.invoice_attachments(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.invoice_attachments FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.invoice_attachments TO drillops_business;
CREATE POLICY business_read ON public.invoice_attachments FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.invoice_attachments FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.invoice_attachments FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.invoice_attachments FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.cost_contract_rates x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('cost_contract_rates',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('cost_contract_rates',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('cost_contract_rates',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.cost_contract_rates ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.cost_contract_rates ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.cost_contract_rates(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.cost_contract_rates FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.cost_contract_rates TO drillops_business;
CREATE POLICY business_read ON public.cost_contract_rates FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.cost_contract_rates FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.cost_contract_rates FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.cost_contract_rates FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.consumables x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('consumables',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('consumables',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('consumables',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.consumables ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.consumables ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.consumables(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.consumables FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.consumables TO drillops_business;
CREATE POLICY business_read ON public.consumables FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.consumables FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.consumables FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.consumables FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.crew x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('crew',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('crew',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('crew',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.crew ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.crew ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.crew(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.crew FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.crew TO drillops_business;
CREATE POLICY business_read ON public.crew FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.crew FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.crew FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.crew FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.source_files x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('source_files',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('source_files',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('source_files',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.source_files ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.source_files ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.source_files(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.source_files FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.source_files TO drillops_business;
CREATE POLICY business_read ON public.source_files FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.source_files FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.source_files FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.source_files FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.imported_files x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('imported_files',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('imported_files',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('imported_files',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.imported_files ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.imported_files ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.imported_files(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.imported_files FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.imported_files TO drillops_business;
CREATE POLICY business_read ON public.imported_files FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.imported_files FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.imported_files FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.imported_files FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.invoice_imports x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('invoice_imports',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('invoice_imports',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('invoice_imports',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.invoice_imports ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.invoice_imports ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.invoice_imports(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.invoice_imports FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.invoice_imports TO drillops_business;
CREATE POLICY business_read ON public.invoice_imports FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.invoice_imports FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.invoice_imports FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.invoice_imports FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.report_approvals x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('report_approvals',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('report_approvals',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('report_approvals',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.report_approvals ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.report_approvals ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.report_approvals(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.report_approvals FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.report_approvals TO drillops_business;
CREATE POLICY business_read ON public.report_approvals FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.report_approvals FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.report_approvals FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.report_approvals FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.activity_sheet_locks x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('activity_sheet_locks',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('activity_sheet_locks',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('activity_sheet_locks',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.activity_sheet_locks ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.activity_sheet_locks ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.activity_sheet_locks(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.activity_sheet_locks FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.activity_sheet_locks TO drillops_business;
CREATE POLICY business_read ON public.activity_sheet_locks FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.activity_sheet_locks FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.activity_sheet_locks FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.activity_sheet_locks FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.minimum_shift_topup_preferences x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('minimum_shift_topup_preferences',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('minimum_shift_topup_preferences',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('minimum_shift_topup_preferences',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.minimum_shift_topup_preferences ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.minimum_shift_topup_preferences ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.minimum_shift_topup_preferences(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.minimum_shift_topup_preferences FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.minimum_shift_topup_preferences TO drillops_business;
CREATE POLICY business_read ON public.minimum_shift_topup_preferences FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.minimum_shift_topup_preferences FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.minimum_shift_topup_preferences FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.minimum_shift_topup_preferences FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.project_budgets x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('project_budgets',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('project_budgets',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('project_budgets',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.project_budgets ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.project_budgets ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.project_budgets(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.project_budgets FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.project_budgets TO drillops_business;
CREATE POLICY business_read ON public.project_budgets FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.project_budgets FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.project_budgets FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.project_budgets FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.cost_centre_forecasts x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('cost_centre_forecasts',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('cost_centre_forecasts',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('cost_centre_forecasts',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.cost_centre_forecasts ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.cost_centre_forecasts ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.cost_centre_forecasts(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.cost_centre_forecasts FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.cost_centre_forecasts TO drillops_business;
CREATE POLICY business_read ON public.cost_centre_forecasts FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.cost_centre_forecasts FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.cost_centre_forecasts FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.cost_centre_forecasts FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.ironbark_posted_costs x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('ironbark_posted_costs',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('ironbark_posted_costs',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('ironbark_posted_costs',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.ironbark_posted_costs ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.ironbark_posted_costs ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.ironbark_posted_costs(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.ironbark_posted_costs FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ironbark_posted_costs TO drillops_business;
CREATE POLICY business_read ON public.ironbark_posted_costs FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.ironbark_posted_costs FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.ironbark_posted_costs FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.ironbark_posted_costs FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.rig_schedule x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('rig_schedule',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('rig_schedule',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('rig_schedule',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.rig_schedule ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.rig_schedule ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.rig_schedule(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.rig_schedule FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.rig_schedule TO drillops_business;
CREATE POLICY business_read ON public.rig_schedule FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.rig_schedule FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.rig_schedule FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.rig_schedule FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.account_accruals x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('account_accruals',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('account_accruals',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('account_accruals',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.account_accruals ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.account_accruals ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.account_accruals(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.account_accruals FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.account_accruals TO drillops_business;
CREATE POLICY business_read ON public.account_accruals FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.account_accruals FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.account_accruals FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.account_accruals FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.lab_samples x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('lab_samples',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('lab_samples',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('lab_samples',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.lab_samples ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.lab_samples ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.lab_samples(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.lab_samples FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.lab_samples TO drillops_business;
CREATE POLICY business_read ON public.lab_samples FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.lab_samples FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.lab_samples FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.lab_samples FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.day_rate_days x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('day_rate_days',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('day_rate_days',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('day_rate_days',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.day_rate_days ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.day_rate_days ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.day_rate_days(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.day_rate_days FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.day_rate_days TO drillops_business;
CREATE POLICY business_read ON public.day_rate_days FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.day_rate_days FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.day_rate_days FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.day_rate_days FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.day_rate_rosters x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('day_rate_rosters',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('day_rate_rosters',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('day_rate_rosters',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.day_rate_rosters ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.day_rate_rosters ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.day_rate_rosters(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.day_rate_rosters FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.day_rate_rosters TO drillops_business;
CREATE POLICY business_read ON public.day_rate_rosters FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.day_rate_rosters FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.day_rate_rosters FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.day_rate_rosters FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.project_register_imports x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('project_register_imports',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('project_register_imports',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('project_register_imports',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.project_register_imports ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.project_register_imports ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.project_register_imports(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.project_register_imports FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.project_register_imports TO drillops_business;
CREATE POLICY business_read ON public.project_register_imports FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.project_register_imports FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.project_register_imports FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.project_register_imports FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.project_register_records x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('project_register_records',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('project_register_records',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('project_register_records',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.project_register_records ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.project_register_records ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.project_register_records(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.project_register_records FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.project_register_records TO drillops_business;
CREATE POLICY business_read ON public.project_register_records FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.project_register_records FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.project_register_records FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.project_register_records FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.hourly_rates x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('hourly_rates',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('hourly_rates',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('hourly_rates',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.hourly_rates ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.hourly_rates ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.hourly_rates(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.hourly_rates FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('catalog');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.hourly_rates TO drillops_business;
CREATE POLICY business_read ON public.hourly_rates FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,true));
CREATE POLICY business_insert ON public.hourly_rates FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true));
CREATE POLICY business_update ON public.hourly_rates FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true));
CREATE POLICY business_delete ON public.hourly_rates FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true));
UPDATE public.drilling_rates x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('drilling_rates',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('drilling_rates',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('drilling_rates',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.drilling_rates ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.drilling_rates ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.drilling_rates(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.drilling_rates FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('catalog');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.drilling_rates TO drillops_business;
CREATE POLICY business_read ON public.drilling_rates FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,true));
CREATE POLICY business_insert ON public.drilling_rates FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true));
CREATE POLICY business_update ON public.drilling_rates FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true));
CREATE POLICY business_delete ON public.drilling_rates FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true));
UPDATE public.consumable_rates x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('consumable_rates',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('consumable_rates',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('consumable_rates',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.consumable_rates ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.consumable_rates ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.consumable_rates(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.consumable_rates FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('catalog');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.consumable_rates TO drillops_business;
CREATE POLICY business_read ON public.consumable_rates FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,true));
CREATE POLICY business_insert ON public.consumable_rates FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true));
CREATE POLICY business_update ON public.consumable_rates FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true));
CREATE POLICY business_delete ON public.consumable_rates FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true));
UPDATE public.lab_rates x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('lab_rates',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('lab_rates',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('lab_rates',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.lab_rates ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.lab_rates ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.lab_rates(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.lab_rates FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('catalog');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.lab_rates TO drillops_business;
CREATE POLICY business_read ON public.lab_rates FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,true));
CREATE POLICY business_insert ON public.lab_rates FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true));
CREATE POLICY business_update ON public.lab_rates FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true));
CREATE POLICY business_delete ON public.lab_rates FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true));
UPDATE public.mcc_swipe_history x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('mcc_swipe_history',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('mcc_swipe_history',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('mcc_swipe_history',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.mcc_swipe_history ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.mcc_swipe_history ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.mcc_swipe_history(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.mcc_swipe_history FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.mcc_swipe_history TO drillops_business;
CREATE POLICY business_read ON public.mcc_swipe_history FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.mcc_swipe_history FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.mcc_swipe_history FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.mcc_swipe_history FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.training_workspaces x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('training_workspaces',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('training_workspaces',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('training_workspaces',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.training_workspaces ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.training_workspaces ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.training_workspaces(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.training_workspaces FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.training_workspaces TO drillops_business;
CREATE POLICY business_read ON public.training_workspaces FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.training_workspaces FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.training_workspaces FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.training_workspaces FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.training_sources x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('training_sources',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('training_sources',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('training_sources',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.training_sources ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.training_sources ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.training_sources(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.training_sources FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.training_sources TO drillops_business;
CREATE POLICY business_read ON public.training_sources FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.training_sources FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.training_sources FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.training_sources FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.training_cardholders x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('training_cardholders',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('training_cardholders',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('training_cardholders',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.training_cardholders ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.training_cardholders ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.training_cardholders(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.training_cardholders FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.training_cardholders TO drillops_business;
CREATE POLICY business_read ON public.training_cardholders FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.training_cardholders FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.training_cardholders FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.training_cardholders FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.training_configuration x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('training_configuration',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('training_configuration',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('training_configuration',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.training_configuration ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.training_configuration ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.training_configuration(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.training_configuration FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('catalog');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.training_configuration TO drillops_business;
CREATE POLICY business_read ON public.training_configuration FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,true));
CREATE POLICY business_insert ON public.training_configuration FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true));
CREATE POLICY business_update ON public.training_configuration FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true));
CREATE POLICY business_delete ON public.training_configuration FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,true));
UPDATE public.import_batches x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('import_batches',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('import_batches',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('import_batches',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.import_batches ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.import_batches(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.import_batches FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.import_batches TO drillops_business;
CREATE POLICY business_read ON public.import_batches FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.import_batches FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.import_batches FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.import_batches FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
UPDATE public.activities_csv_import x SET (workspace_id,business_project_id,campaign_id)=((business_private.resolve_scope('activities_csv_import',to_jsonb(x))->>'workspace_id')::uuid,(business_private.resolve_scope('activities_csv_import',to_jsonb(x))->>'business_project_id')::uuid,(business_private.resolve_scope('activities_csv_import',to_jsonb(x))->>'campaign_id')::uuid);
ALTER TABLE public.activities_csv_import ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.activities_csv_import ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.activities_csv_import(workspace_id,business_project_id,campaign_id);
CREATE TRIGGER zz_business_scope BEFORE INSERT OR UPDATE ON public.activities_csv_import FOR EACH ROW EXECUTE FUNCTION business_private.stamp_scope('data');
GRANT SELECT,INSERT,UPDATE,DELETE ON public.activities_csv_import TO drillops_business;
CREATE POLICY business_read ON public.activities_csv_import FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false,false));
CREATE POLICY business_insert ON public.activities_csv_import FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_update ON public.activities_csv_import FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));
CREATE POLICY business_delete ON public.activities_csv_import FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true,false));

GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO drillops_business;
GRANT INSERT ON public.audit_events TO drillops_business;
CREATE POLICY business_audit_insert ON public.audit_events FOR INSERT TO drillops_business WITH CHECK(actor_user_id::text=current_setting('app.actor_user_id',true));
GRANT SELECT ON public.user_profiles TO drillops_business;
CREATE POLICY business_own_profile ON public.user_profiles FOR SELECT TO drillops_business USING(user_id::text=current_setting('app.actor_user_id',true));
