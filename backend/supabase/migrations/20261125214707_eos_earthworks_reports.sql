-- Native EOS uses canonical DrillOps user IDs; it does not introduce accounts.
CREATE UNIQUE INDEX IF NOT EXISTS business_campaigns_scope_identity
ON public.business_campaigns(workspace_id,project_id,id);

CREATE TABLE public.eos_earthworks_codes (
 workspace_id uuid NOT NULL,
 business_project_id uuid NOT NULL,
 campaign_id uuid NOT NULL,
 id uuid NOT NULL,
 code text NOT NULL CHECK(length(code) BETWEEN 1 AND 100),
 label text NOT NULL DEFAULT '',
 kind text NOT NULL CHECK(kind IN ('site','overhead')),
 chargeable boolean NOT NULL DEFAULT false,
 active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(workspace_id,business_project_id,campaign_id,id),
 FOREIGN KEY(workspace_id,business_project_id,campaign_id)
 REFERENCES public.business_campaigns(workspace_id,project_id,id)
);
CREATE UNIQUE INDEX eos_earthworks_codes_name ON public.eos_earthworks_codes(workspace_id,business_project_id,campaign_id,lower(code));

CREATE TABLE public.eos_earthworks_reviewers (
 workspace_id uuid NOT NULL,
 business_project_id uuid NOT NULL,
 campaign_id uuid NOT NULL,
 user_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,business_project_id,campaign_id,user_id),
 FOREIGN KEY(workspace_id,business_project_id,campaign_id)
 REFERENCES public.business_campaigns(workspace_id,project_id,id)
);

CREATE TABLE public.eos_earthworks_reports (
 workspace_id uuid NOT NULL,
 business_project_id uuid NOT NULL,
 campaign_id uuid NOT NULL,
 id uuid NOT NULL,
 owner_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','returned')),
 revision integer NOT NULL CHECK(revision>0),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'),
 history jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(history)='array'),
 last_mutation uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,business_project_id,campaign_id,id),
 FOREIGN KEY(workspace_id,business_project_id,campaign_id)
 REFERENCES public.business_campaigns(workspace_id,project_id,id)
);
CREATE INDEX eos_earthworks_report_owner ON public.eos_earthworks_reports(workspace_id,business_project_id,campaign_id,owner_id);

-- Direct browser/Data API access is deliberately absent. The authenticated
-- DrillOps API applies author/reviewer checks in addition to campaign RLS.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['eos_earthworks_codes','eos_earthworks_reviewers','eos_earthworks_reports'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO drillops_business',t);
  EXECUTE format('CREATE POLICY eos_read ON public.%I FOR SELECT TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,false))',t);
  EXECUTE format('CREATE POLICY eos_insert ON public.%I FOR INSERT TO drillops_business WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true))',t);
  EXECUTE format('CREATE POLICY eos_update ON public.%I FOR UPDATE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true)) WITH CHECK(business_private.allowed(workspace_id,business_project_id,campaign_id,true))',t);
  EXECUTE format('CREATE POLICY eos_delete ON public.%I FOR DELETE TO drillops_business USING(business_private.allowed(workspace_id,business_project_id,campaign_id,true))',t);
 END LOOP;
END $$;
