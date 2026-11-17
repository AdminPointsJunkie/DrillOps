-- Prepare scoped keys before deploying the new conflict targets. Old keys remain during rollout.
CREATE UNIQUE INDEX business_key_0 ON public.rig_schedule USING btree (workspace_id, source_key);
CREATE UNIQUE INDEX business_key_1 ON public.imported_files USING btree (workspace_id, filename);
CREATE UNIQUE INDEX business_key_2 ON public.contractors USING btree (workspace_id, name);
CREATE UNIQUE INDEX business_key_3 ON public.mcc_swipe_history USING btree (workspace_id, contractor, person_key, time_in, logpoint);
CREATE UNIQUE INDEX business_key_4 ON public.projects USING btree (workspace_id, contractor, lower(btrim(name)), lower(btrim(program)));
CREATE UNIQUE INDEX business_key_5 ON public.boreholes USING btree (workspace_id, contractor, hole_id);
CREATE UNIQUE INDEX business_key_6 ON public.project_budgets USING btree (workspace_id, contractor, project, program, section, vendor);
CREATE UNIQUE INDEX business_key_7 ON public.clients USING btree (workspace_id, name);
CREATE UNIQUE INDEX business_key_8 ON public.cost_centre_forecasts USING btree (workspace_id, site, cost_centre, year, month, category);
CREATE UNIQUE INDEX business_key_9 ON public.lab_rates USING btree (workspace_id, lower(TRIM(BOTH FROM lab)), category, lower(TRIM(BOTH FROM test_name)), lower(TRIM(BOTH FROM unit)));
CREATE UNIQUE INDEX business_key_10 ON public.ironbark_posted_costs USING btree (workspace_id, source_file, po_number, po_item, invoice_reference);
CREATE UNIQUE INDEX business_key_11 ON public.report_approvals USING btree (workspace_id, contractor, report_date, hole_num, source_file);
CREATE UNIQUE INDEX business_key_12 ON public.activity_sheet_locks USING btree (workspace_id, contractor, report_date, hole_num, source_file);
CREATE UNIQUE INDEX business_key_13 ON public.minimum_shift_topup_preferences USING btree (workspace_id, contractor, report_date, hole_num, source_file);
CREATE UNIQUE INDEX business_key_14 ON public.source_files USING btree (workspace_id, filename, contractor);
CREATE UNIQUE INDEX business_key_15 ON public.invoice_imports USING btree (workspace_id, filename, contractor);
ALTER TABLE public.organizations ADD COLUMN workspace_id uuid REFERENCES public.business_workspaces(id);
UPDATE public.organizations o SET workspace_id=COALESCE((SELECT id FROM public.business_workspaces WHERE client_id=o.client_id),'a7ecd88b-8ba9-4c5f-80c8-872fcc50f34f'::uuid);
ALTER TABLE public.organizations ALTER COLUMN workspace_id SET DEFAULT 'a7ecd88b-8ba9-4c5f-80c8-872fcc50f34f'::uuid, ALTER COLUMN workspace_id SET NOT NULL;

CREATE OR REPLACE FUNCTION business_private.resolve_scope(t text,j jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
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
 IF c IS NULL AND legacy IS NULL AND NULLIF(j->>'project','') IS NULL THEN
  c:=NULLIF(j->>'campaign_id','')::uuid;p:=COALESCE(p,NULLIF(j->>'business_project_id','')::uuid);
 END IF;
 RETURN jsonb_build_object('workspace_id',w,'business_project_id',p,'campaign_id',c);
END $$;
-- Validate existing ID-based relationships before accepting a scoped write.
CREATE OR REPLACE FUNCTION business_private.check_scope_references() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j jsonb; ref record; parent_workspace uuid; ref_id text;
BEGIN
 IF current_user <> 'drillops_business' THEN RETURN NEW; END IF;
 j:=to_jsonb(NEW);
 FOR ref IN SELECT * FROM (VALUES ('client_id','clients'),('project_id','projects'),('allocated_project_id','projects'),('contractor_id','contractors'),('invoice_id','invoices'),('contract_id','cost_contracts'),('dar_id','daily_activity_reports'),('po_id','purchase_orders'),('import_id','project_register_imports')) AS refs(field_name,table_name) LOOP
  ref_id:=NULLIF(j->>ref.field_name,'');
  IF ref_id IS NULL THEN CONTINUE; END IF;
  EXECUTE format('SELECT workspace_id FROM public.%I x WHERE to_jsonb(x)->>''id''=$1',ref.table_name) INTO parent_workspace USING ref_id;
  IF parent_workspace IS NULL OR parent_workspace<>NEW.workspace_id THEN RAISE EXCEPTION 'Referenced record is outside your permitted scope' USING ERRCODE='42501'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION business_private.check_scope_references() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business_private.check_scope_references() TO drillops_business;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['projects','activities','invoices','purchase_orders','daily_activity_reports','cost_contracts','invoice_lines','invoice_attachments','cost_contract_rates','consumables','crew','account_accruals','lab_samples','day_rate_days','day_rate_rosters','project_register_imports','project_register_records'] LOOP
  EXECUTE format('CREATE TRIGGER zzz_business_references BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION business_private.check_scope_references()',t);
 END LOOP;
END $$;
