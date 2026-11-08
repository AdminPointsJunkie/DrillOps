-- A complete 3D KML document can expand to megabytes of geometry and attributes.
-- Hoist only this atomic import's timeout above the role's eight-second limit.
-- Keep invoker permissions, validation and all other query limits unchanged.
alter function public.import_vector(jsonb,jsonb) set statement_timeout = '45s';
notify pgrst, 'reload schema';
