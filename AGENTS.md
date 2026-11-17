# DrillOps working preferences

- Fetch `origin` and inspect the latest `origin/main` before reviewing or changing DrillOps code. Do not assume an existing local checkout matches the live application.
- Integrate completed, verified changes into `main` by default unless explicitly instructed otherwise.
- Always make completed, verified DrillOps changes live: push to `origin/main`, follow deployment, and verify the production site. Do not stop at a local commit or ask again for permission to publish routine requested updates.
- Preserve unrelated local work and newer remote changes when integrating updates.

## Business platform structure (confirmed 18 November 2026)

- EOS, Account and Project are applications within one shared business platform. They use the same company workspace, project/campaign hierarchy, user accounts and permissions.
- The hierarchy is **Company -> Workspace -> Project -> Campaign**. Each company has its own workspace. The current company/workspace is **ARGO NR**; all existing business reports and data belong to ARGO NR.
- Under ARGO NR, **Exploration** is a project. **Ironbark No1 2026** is an example campaign within that project. Do not assume the legacy client/project/program field names already implement this hierarchy; map existing records explicitly before any migration.
- Contractors such as Weatherfords, DEPCO and Mitchells remain distinct contractors associated with work in the hierarchy. They are not company workspaces or substitutes for projects/campaigns.
- Each user has an individual account and specific permissions. John O'Leary is the **Platform Admin**, with all platform permissions. Preserve his existing administrator access; do not infer an administrator grant for other users.
- Workspace administrators manage sharing and access to projects and campaigns through **Workspace Settings**, within their authorized scope.
- Keep company workspaces isolated. Apply permissions consistently across EOS, Account and Project, including reads, imports, exports, reports and updates. Backend authorization must enforce access; UI filtering alone is insufficient.
- This is the target structure for future implementation. Recording it does not establish that the current database, sharing controls or every endpoint already implement it. Preserve existing records and verify mappings and permissions when implementing changes.
