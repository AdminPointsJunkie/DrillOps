# Standalone DrillOps apps

Entry points:
- `index.html`: authenticated app chooser (public marketing and existing login remain available before sign-in).
- `eos.html`: EOS reporting, production, recorded-work charges, rates and operational imports.
- `account.html`: invoice actuals ledger, purchase orders, suppliers and invoice imports.
- `project.html`: project setup, borehole planning/maps, budget planning and administration.

Each app document contains only its own page panels and its own navigation. Cross-app links navigate to the owning app. They are independent documents, not tabs around the old all-in-one page. Shared dialogs and authentication remain in `shell.html`; the existing business functions and API/auth client remain in `runtime.js`. `start.js` runs after optional app enhancements, including Account's invoice ledger.

The shared session key, API origin and client/project/program selection keys are unchanged. No database copies, schema changes or new access privileges are introduced. Management access is still verified before app initialization; non-management accounts retain their field portal route. Never put tokens in app links.

## Editing

Edit `panels/*.html`, `shell.html`, `runtime.js`, `navigation.js` or `navigation.css`, then run:

```
python3 scripts/build_workspaces.py
```

Commit the generated four entry documents with their sources. The generator includes the owning app's panels only and separates the operational/invoice upload cards. Previously hidden, unavailable legacy panels remain in source but are not promoted into new navigation.

## Checks

```
python3 tests/test_public_pages.py
node --test tests/*.test.mjs
python3 -m http.server 8766 --directory docs
# With Playwright available; CHROME_PATH is optional when its Chromium is installed:
CHROME_PATH=/path/to/chrome node tests/standalone_apps.browser.mjs
CHROME_PATH=/path/to/chrome node tests/invoice_ledger.browser.mjs
```

Browser integration tests mock API data and sessions locally. They do not use real user tokens or write production data. They exercise each app's working pages, shared session/project state, mobile layout and the signed-out access gate.

## EOS design and reporting

EOS uses the existing daily-report bundle and approval records to show report counts, metres, hours, priced charges, recent plods and recorded time usage. These are recorded shifts, not sensor telemetry. Unknown pricing is flagged as incomplete. The selected contractor, client, project and program scope the overview. The plod register offers functional approval, shift and rig filters.

Design references (reviewed 8 November 2026): CorePlan's public contractor/plod workflow (https://help.coreplan.io/en/articles/12888261-using-the-coreplan-driller-contractor-portal and https://www.coreplan.io/drilling) and Felt's interface (https://felt.com/). EOS retains its own name and assets; the implementation does not embed either vendor's screenshots or branding, nor claim feature parity with their platforms.
