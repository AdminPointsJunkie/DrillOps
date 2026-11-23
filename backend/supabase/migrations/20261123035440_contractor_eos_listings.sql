-- Preserve existing workspaces; new suppliers opt into EOS explicitly.
ALTER TABLE public.contractors
  ADD COLUMN eos_imports_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN eos_reports_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.contractors
  ALTER COLUMN eos_imports_enabled SET DEFAULT false,
  ALTER COLUMN eos_reports_enabled SET DEFAULT false;
COMMENT ON COLUMN public.contractors.eos_imports_enabled IS 'List in EOS report imports, activity reports and report calendar; not an access permission.';
COMMENT ON COLUMN public.contractors.eos_reports_enabled IS 'List in EOS production reports and overview; not an access permission.';
