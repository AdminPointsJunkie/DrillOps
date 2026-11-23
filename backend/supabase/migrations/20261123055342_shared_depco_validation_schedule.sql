-- Additive rollout: link and remove duplicate rows only after the reader is deployed.
CREATE TABLE public.shared_rate_schedules (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES public.business_workspaces(id),
 contractor text NOT NULL, program text NOT NULL, name text NOT NULL,
 source_reference text NOT NULL, rates jsonb NOT NULL CHECK(jsonb_typeof(rates)='array'),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,contractor,program), UNIQUE(id,workspace_id)
);
ALTER TABLE public.shared_rate_schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shared_rate_schedules FROM anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.shared_rate_schedules TO drillops_business;
GRANT USAGE,SELECT ON SEQUENCE public.shared_rate_schedules_id_seq TO drillops_business;
CREATE POLICY schedule_read ON public.shared_rate_schedules FOR SELECT TO drillops_business
 USING(business_private.allowed(workspace_id,NULL,NULL,false,true));
CREATE POLICY schedule_write ON public.shared_rate_schedules FOR ALL TO drillops_business
 USING(business_private.allowed(workspace_id,NULL,NULL,true,true))
 WITH CHECK(business_private.allowed(workspace_id,NULL,NULL,true,true));
ALTER TABLE public.cost_contracts ADD COLUMN rate_schedule_id bigint;
ALTER TABLE public.cost_contracts ADD CONSTRAINT contract_shared_schedule_workspace_fk
 FOREIGN KEY(rate_schedule_id,workspace_id) REFERENCES public.shared_rate_schedules(id,workspace_id);
CREATE INDEX ON public.cost_contracts(rate_schedule_id);

CREATE FUNCTION business_private.link_shared_rate_schedule() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE schedule_id bigint;
BEGIN
 SELECT s.id INTO schedule_id FROM public.shared_rate_schedules s
 JOIN public.projects p ON p.workspace_id=s.workspace_id AND p.program=s.program
 WHERE p.id=NEW.project_id AND s.contractor=NEW.contractor;
 NEW.rate_schedule_id := schedule_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION business_private.link_shared_rate_schedule() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business_private.link_shared_rate_schedule() TO drillops_business;
CREATE TRIGGER zzz_shared_schedule BEFORE INSERT OR UPDATE ON public.cost_contracts
 FOR EACH ROW EXECUTE FUNCTION business_private.link_shared_rate_schedule();

CREATE FUNCTION business_private.prevent_duplicate_rate_list() RETURNS trigger
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.cost_contracts WHERE id=NEW.contract_id AND rate_schedule_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Contract uses one shared rate schedule; duplicate rates are not permitted';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION business_private.prevent_duplicate_rate_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business_private.prevent_duplicate_rate_list() TO drillops_business;
CREATE TRIGGER prevent_duplicate_rate_list BEFORE INSERT OR UPDATE ON public.cost_contract_rates
 FOR EACH ROW EXECUTE FUNCTION business_private.prevent_duplicate_rate_list();
