-- Transactional integration check. All fixture rows are rolled back.
BEGIN;
DO $$
DECLARE w1 uuid:=gen_random_uuid(); w2 uuid:=gen_random_uuid(); p1 uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid();
 c1 uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid(); denied boolean:=false; n integer;
BEGIN
 INSERT INTO public.business_workspaces(id,name) VALUES(w1,'EOS rollback test A'),(w2,'EOS rollback test B');
 INSERT INTO public.business_projects(id,workspace_id,name) VALUES(p1,w1,'Test A'),(p2,w2,'Test B');
 INSERT INTO public.business_campaigns(id,workspace_id,project_id,name) VALUES(c1,w1,p1,'Test A'),(c2,w2,p2,'Test B');
 INSERT INTO public.eos_earthworks_codes(workspace_id,business_project_id,campaign_id,id,code,kind)
 VALUES(w1,p1,c1,gen_random_uuid(),'A','site'),(w2,p2,c2,gen_random_uuid(),'B','site');
 PERFORM set_config('app.workspace_id',w1::text,true),set_config('app.business_project_id',p1::text,true),
 set_config('app.campaign_id',c1::text,true),set_config('app.workspace_admin','false',true),
 set_config('app.read_projects','',true),set_config('app.write_projects','',true),
 set_config('app.read_campaigns',c1::text,true),set_config('app.write_campaigns',c1::text,true);
 SET LOCAL ROLE drillops_business;
 SELECT count(*) INTO n FROM public.eos_earthworks_codes;
 IF n<>1 THEN RAISE EXCEPTION 'Cross-workspace rows visible'; END IF;
 INSERT INTO public.eos_earthworks_reports(workspace_id,business_project_id,campaign_id,id,owner_id,revision,document,last_mutation)
 VALUES(w1,p1,c1,gen_random_uuid(),gen_random_uuid(),1,'{}',gen_random_uuid());
 BEGIN
  INSERT INTO public.eos_earthworks_reports(workspace_id,business_project_id,campaign_id,id,owner_id,revision,document,last_mutation)
  VALUES(w2,p2,c2,gen_random_uuid(),gen_random_uuid(),1,'{}',gen_random_uuid());
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Cross-workspace write allowed'; END IF;
 denied:=false;
 PERFORM set_config('app.write_campaigns','',true);
 BEGIN
  INSERT INTO public.eos_earthworks_reports(workspace_id,business_project_id,campaign_id,id,owner_id,revision,document,last_mutation)
  VALUES(w1,p1,c1,gen_random_uuid(),gen_random_uuid(),1,'{}',gen_random_uuid());
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Read-only member write allowed'; END IF;
 RESET ROLE;
 IF has_table_privilege('anon','public.eos_earthworks_reports','SELECT') OR has_table_privilege('authenticated','public.eos_earthworks_reports','UPDATE') THEN
  RAISE EXCEPTION 'Direct Data API access unexpectedly granted';
 END IF;
END $$;
ROLLBACK;
SELECT 'PASS: campaign isolation, read-only denial, API-only access; fixtures rolled back' AS result;
