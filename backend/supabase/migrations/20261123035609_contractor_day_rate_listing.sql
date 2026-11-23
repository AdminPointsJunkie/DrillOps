ALTER TABLE public.contractors ADD COLUMN eos_day_rates_enabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.contractors.eos_day_rates_enabled IS 'List in EOS day-rate contractors, independently of report imports and production reports.';
-- Retain existing configured roster providers without classifying drilling rigs as day-rate suppliers.
UPDATE public.contractors c SET eos_day_rates_enabled=true
WHERE EXISTS (SELECT 1 FROM public.day_rate_rosters r WHERE r.workspace_id=c.workspace_id AND r.contractor=c.name);
