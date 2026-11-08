
CREATE TABLE IF NOT EXISTS account_accruals (
 id BIGSERIAL PRIMARY KEY,project_id INTEGER NOT NULL REFERENCES projects(id),
 supplier TEXT NOT NULL,po_id INTEGER REFERENCES purchase_orders(id),po_number TEXT NOT NULL DEFAULT '',
 period DATE NOT NULL CHECK(extract(day FROM period)=1),amount NUMERIC(16,2) NOT NULL CHECK(amount>0),
 status TEXT NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','Cleared','Voided')),
 description TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS account_accrual_open_identity ON account_accruals(project_id,lower(trim(supplier)),period,COALESCE(po_id,0)) WHERE status='Open';
ALTER TABLE account_accruals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_accruals FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE account_accruals_id_seq FROM PUBLIC,anon,authenticated;
