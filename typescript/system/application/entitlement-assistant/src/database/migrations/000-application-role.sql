-- The role the application acts with. Subsystem migrations grant it exactly what each table allows:
-- never DELETE (CM-7), and only INSERT and SELECT on audit records (CM-13).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'entitlement_assistant_app') THEN
    CREATE ROLE entitlement_assistant_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO entitlement_assistant_app;
