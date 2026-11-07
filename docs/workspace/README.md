# Standalone DrillOps apps

Entry points:
- `index.html`: public homepage; stays public even with a saved session. Explicit sign-in links enter EOS, and password recovery/return links retain their existing flow.
- `eos.html`: EOS reporting, production, recorded-work charges, rates and operational imports.
- `account.html`: invoice actuals ledger, purchase orders, suppliers and invoice imports.
- `project.html`: project setup, borehole planning/maps, budget planning and administration.

Each app document contains only its own page panels and its own navigation. Cross-app links navigate to the owning app. They are independent documents, not tabs around the old all-in-one page. Shared dialogs and authentication remain in `shell.html`; the existing business functions and API/auth client remain in `runtime.js`. `start.js` runs after optional app enhancements, including Account's invoice ledger.

The shared session key and API origin are unchanged. Account and Project keep their client/project/program selection keys. EOS saves optional viewing filters separately in sessionStorage.drillops_eos_view_scope; imports require an explicit destination project ID and program. No database copies, schema changes or new access privileges are introduced. Management access is still verified before app initialization; non-management accounts retain their field portal route. Never put tokens in app links.

EOS's contractor choices are restricted to Mitchells Drilling, DEPCO Drilling and MCC Group, with one contractor selected at a time. EOS defaults to all projects and can filter project and program without changing contractor. Both cached contractor choices and project-linked contractor responses are scoped for EOS; the full supplier cache remains available to Account and Project. No supplier records are deleted.

## Editing

Edit `panels/*.html`, `shell.html`, `runtime.js`, `navigation.js`, `navigation.css` or the shared `app-style.css`, then run:

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

EOS uses the existing daily-report bundle and approval records to show report counts, metres, hours, priced charges, recent plods and recorded time usage. These are recorded shifts, not sensor telemetry. Unknown pricing is flagged as incomplete. One selected contractor scopes Overview, Plods, Production, Period Reports, Associated Charges, rates and contracts. Overview and other EOS links navigate inside the current session; back/forward navigation retains filters. The plod register offers functional approval, shift and rig filters.

Design references (reviewed 8 November 2026): CorePlan's public contractor/plod workflow (https://help.coreplan.io/en/articles/12888261-using-the-coreplan-driller-contractor-portal and https://www.coreplan.io/drilling) and Felt's interface (https://felt.com/). EOS retains its own name and assets; the implementation does not embed either vendor's screenshots or branding, nor claim feature parity with their platforms.

Account opens straight into its invoice ledger; Project opens straight into its project dashboard, with the register available from Projects. EOS opens its operational overview. There is no chooser or app-switching control. Training Matrix belongs to Project and returns there.

All three apps share the approved navigation and base components: a white sidebar and compact header, light panels and consistent tables. Project adds the Mastt-informed dashboard styling described below. Training Matrix preserves its evidence colours and adjustable text sizes.

## EOS production and period operations report

Production and Period Reports use recorded activities for the selected contractor only. Both include zero-metre standby entries and keep other/unclassified metres visible. Cored/chipped metres use codes and bit types; time uses valid recorded durations or valid start/end times. Neither assumes shift length, planned metres or costs. MCC weekly charge sheets are excluded from operational totals to avoid duplicating daily records. Project and rig totals reconcile to the same filtered rows.

The Period Report is a printable operations document with rig activity, project breakdowns, standby reasons and a source shift register. It does not fetch budgets, forecasts or support invoices. Associated Charges remains its own page. Record-level filters do not change API authorization; no data or auth schema changes are required. Stale responses are discarded after contractor or viewing-scope changes.

Checks: `node --test tests/eos_production.test.mjs` and `CHROME_PATH=/path/to/chrome node tests/eos_operations.browser.mjs`. Optional `CAPTURE_EOS` saves labelled sample screenshots and print PDFs.

## Previous portal

`/OLD/` retains the combined portal that was published immediately before this release, from commit `cfb28bf4858f841cb3cc2622e7406dbab0b759ce`. Its documents, scripts, styles and training pages are preserved by `scripts/snapshot_legacy_site.py`. Shared images and the separate FieldMaps app keep their unchanged root URLs. The old portal retains its existing login and uses the same live API data; it is not a backup database. Normal workspace generation does not overwrite this snapshot.

The snapshot includes one compatibility guard: the old startup timer skips its retired analytics panel when that panel is absent.

## Project dashboard

Project's dashboard uses Mastt's public product reference (https://www.mastt.com/product/project-dashboard-software, reviewed 8 November 2026) for its navy header, summary tiles, progress breakdown and schedule presentation. It uses DrillOps branding and contains no Mastt assets. Training retains its evidence colours and text-size controls.

`project-dashboard-model.js` scopes saved allocations and boreholes to the selected project and program, plus the borehole plan year. Cancelled and superseded plan rows are excluded. Allocations are planning amounts, never labelled expenditure or remaining budget. Progress means the count of boreholes marked Complete, not physical completion by metres. Schedule bars require valid saved start/end dates. Missing amounts, unavailable requests and empty records are distinct; no seed/fallback records are used. Name-based records are suppressed if the same project/program belongs to multiple clients. The dashboard refreshes on navigation, workspace changes or Refresh; Print dashboard uses the browser's print/PDF flow.

Validation: `node --test tests/project_dashboard.test.mjs` and `CHROME_PATH=/path/to/chrome node tests/project_dashboard.browser.mjs`, alongside the existing app integration checks.
