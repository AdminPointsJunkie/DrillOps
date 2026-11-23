-- Preserve hole numbers and source identifiers while formatting Gas Riser records on write.
CREATE OR REPLACE FUNCTION business_private.format_gas_riser_hole()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE
    fields jsonb;
    input_id text;
    parts text[];
    program_name text;
    site text;
    legacy_id integer;
    output_id text;
BEGIN
    IF NEW.workspace_id IS DISTINCT FROM 'a7ecd88b-8ba9-4c5f-80c8-872fcc50f34f'::uuid THEN RETURN NEW; END IF;
    IF TG_ARGV[0] = 'hole_num' THEN input_id := NEW.hole_num;
    ELSE input_id := NEW.hole_id; END IF;
    parts := regexp_match(btrim(input_id), '^(?:(IB|CD)[ _-]*)?GR[ _-]*([0-9]+)$', 'i');
    IF parts IS NULL THEN RETURN NEW; END IF;
    fields := to_jsonb(NEW);
    program_name := fields->>'program';
    site := fields->>'project';
    IF TG_TABLE_NAME = 'project_register_records' THEN
        IF NEW.kind <> 'boreholes' OR lower(NEW.sheet) <> 'gas risers' THEN RETURN NEW; END IF;
        program_name := 'Gas Riser';
    END IF;
    IF site IS NULL OR program_name IS NULL THEN
        legacy_id := (fields->>'project_id')::integer;
        IF legacy_id IS NULL AND NEW.campaign_id IS NOT NULL THEN
            SELECT bc.legacy_project_id INTO legacy_id FROM public.business_campaigns bc
            WHERE bc.workspace_id=NEW.workspace_id AND bc.id=NEW.campaign_id;
        END IF;
        IF legacy_id IS NOT NULL THEN
            SELECT coalesce(site,p.name),coalesce(program_name,p.program) INTO site,program_name
            FROM public.projects p WHERE p.id=legacy_id AND p.workspace_id=NEW.workspace_id;
        END IF;
    END IF;
    IF lower(btrim(program_name)) IS DISTINCT FROM 'gas riser' THEN RETURN NEW; END IF;
    IF parts[1] IS NULL THEN
        -- Weekly MCC sheets can charge Ironbark for work physically performed at Carborough.
        IF fields->>'contractor'='MCC Group' AND fields->>'source_file' ~* '[.]xlsx?$' THEN RETURN NEW; END IF;
        SELECT loc INTO site FROM unnest(ARRAY[fields->>'location', fields->>'site_name', site]) WITH ORDINALITY v(loc,priority)
        WHERE loc ~* '^ *(iron *bark( *(no[.]? *)?1)?|carborough( downs)?( mine)?) *$'
        ORDER BY priority LIMIT 1;
        IF site IS NULL THEN RETURN NEW; END IF;
    END IF;
    output_id := CASE WHEN upper(parts[1])='IB' OR (parts[1] IS NULL AND site ~* '^ *iron') THEN 'IBGR-' ELSE 'GR-' END
        || CASE WHEN length(parts[2])=1 THEN '0' ELSE '' END || parts[2];
    IF TG_ARGV[0]='hole_num' THEN NEW.hole_num := output_id;
    ELSE NEW.hole_id := output_id; END IF;
    IF TG_TABLE_NAME='project_register_records' THEN
        IF NEW.identifier=input_id THEN NEW.identifier := output_id; END IF;
    END IF;
    RETURN NEW;
END
$fn$;
CREATE TRIGGER zzzz_gas_riser_hole_name BEFORE INSERT OR UPDATE OF hole_id ON public.boreholes
FOR EACH ROW EXECUTE FUNCTION business_private.format_gas_riser_hole('hole_id');
CREATE TRIGGER zzzz_gas_riser_hole_name BEFORE INSERT OR UPDATE OF hole_num ON public.activities
FOR EACH ROW EXECUTE FUNCTION business_private.format_gas_riser_hole('hole_num');
CREATE TRIGGER zzzz_gas_riser_hole_name BEFORE INSERT OR UPDATE OF hole_id ON public.project_register_records
FOR EACH ROW EXECUTE FUNCTION business_private.format_gas_riser_hole('hole_id');
CREATE TRIGGER zzzz_gas_riser_hole_name BEFORE INSERT OR UPDATE OF hole_id ON public.rig_schedule
FOR EACH ROW EXECUTE FUNCTION business_private.format_gas_riser_hole('hole_id');
CREATE TRIGGER zzzz_gas_riser_hole_name BEFORE INSERT OR UPDATE OF hole_id ON public.daily_activity_reports
FOR EACH ROW EXECUTE FUNCTION business_private.format_gas_riser_hole('hole_id');
CREATE TRIGGER zzzz_gas_riser_hole_name BEFORE INSERT OR UPDATE OF hole_num ON public.crew
FOR EACH ROW EXECUTE FUNCTION business_private.format_gas_riser_hole('hole_num');
CREATE TRIGGER zzzz_gas_riser_hole_name BEFORE INSERT OR UPDATE OF hole_num ON public.consumables
FOR EACH ROW EXECUTE FUNCTION business_private.format_gas_riser_hole('hole_num');
