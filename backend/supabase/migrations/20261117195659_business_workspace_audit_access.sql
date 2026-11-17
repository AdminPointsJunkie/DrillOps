-- Existing audit triggers read only the actor established by the authenticated backend.
GRANT USAGE ON SCHEMA drillops_private TO drillops_business;
GRANT EXECUTE ON FUNCTION drillops_private.current_actor_id() TO drillops_business;
