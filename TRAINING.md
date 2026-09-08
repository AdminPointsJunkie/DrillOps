# Training matrix

Open **Training Matrix** from the management portal's Operations menu, or visit `/training.html`. The contractor selected in the portal is carried into the page; the selector can switch workspaces.

## Access and storage

All `/training` endpoints require an active system administrator, following the existing management portal access model. The API checks this both in the global middleware and the training router. Records, requirements and source PDFs are scoped to the selected contractor.

Three additive PostgreSQL tables are created by `ensure_training_schema` on backend startup: `training_workspaces`, `training_cardholders` and `training_sources`. Row-level security is enabled and all direct client grants are revoked. They are accessed only by the authenticated FastAPI backend through its existing privileged database connection. Original PDFs are stored as binary data in PostgreSQL and retrieved using an authenticated request; no personnel records or PDFs are included in the public `docs` directory.

The normal database backups cover training data. Reimports replace a cardholder's current report snapshot by cardholder ID, preserve the assigned role, and retain prior source files. An earlier printed report is rejected, including older reports from the same day when a print time is available. Requirements use revision checks to prevent silent overwrites from another browser session. Changes and imports are recorded in the existing audit trail.

## Setup

1. Select the report's contractor and import one or more Cardholder Report PDFs. Company names are matched without case sensitivity; a mismatched company is rejected.
2. Assign personnel roles in the matrix. Reports do not specify these roles, so initial assignments are **Unassigned**.
3. Use **Role requirements** to set **Minimum**, **Optional**, or **Not applicable**. No minimum requirements are assumed; a role needs at least one minimum before readiness is calculated.
4. Review **Training library** mappings. The 23 initial columns follow the supplied matrix image. Surface Induction initially uses CD site induction only; IB1 and online induction records are not silently treated as equivalent. Columns with no known exact match start **Unmapped** and cannot satisfy a minimum requirement.
5. Click a matrix cell for its issue/expiry dates, original report status, renewal history and source PDF page. **Export CSV** exports the current filters.

## Evidence rules

- Both current and historical rows are extracted from actual PDF table columns. Issue and expiry dates are not inferred from text order.
- Only Complete assignments reported Current, without a past expiry or future issue date, count as current evidence. The expiry date itself is included; upcoming expiries are highlighted within a configurable 30/60/90/180-day window.
- A current renewal wins over expired history. Unknown status and future issue dates require review.
- Blank expiry means **not recorded**, not lifetime validity. **No record** means no matching evidence in the supplied report, not proof that training was never completed.
- Multiple exact mappings mean **any one** can satisfy the column. Training requirements that must all be met need separate columns.
- Optional gaps do not reduce minimum readiness. Not applicable cells remain inspectable.
- Reports are snapshots: their dates are visible, and status is recalculated using the browser's local date when the page loads.
- Imports are limited to 20 MB and 50 pages. Scanned PDFs, password-protected PDFs and other layouts need conversion or a separate parser.

## Deployment and verification

Deploy the backend and the GitHub Pages `docs` folder together. No additional environment variables or Python dependencies are required. `auth-guard.js` and the portal sign-in return allowlist include `training.html`.

Install test dependencies with `python -m pip install -r backend/requirements-dev.txt`, then run `python -m unittest discover -s backend -p 'test_*.py'` and `node --test tests/training_logic.test.mjs`. The training tests exercise parsed report counts, renewal and expiry handling, minimum versus optional rules, import validation, administrator checks, workspace isolation and conflicting edits.
