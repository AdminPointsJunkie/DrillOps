# Standalone DrillOps apps

Entry points:
- `index.html`: public homepage; stays public even with a saved session. Explicit sign-in links enter EOS, and password recovery/return links retain their existing flow.
- `eos.html`: EOS reporting, production, recorded-work charges, rates and operational imports.
- `account.html`: invoice actuals ledger, purchase orders, suppliers and invoice imports.
- `project.html`: project setup, borehole planning/maps, budget planning and administration.

Each app document contains only its own page panels and its own navigation. Cross-app links navigate to the owning app. They are independent documents, not tabs around the old all-in-one page. Shared dialogs and authentication remain in `shell.html`; the existing business functions and API/auth client remain in `runtime.js`. `start.js` runs after optional app enhancements, including Account's invoice ledger.

The shared session key and API origin are unchanged. Account and Project keep their client/project/program selection keys. EOS saves optional viewing filters separately in sessionStorage.drillops_eos_view_scope; imports require an explicit destination project ID and program. No database copies, schema changes or new access privileges are introduced. Management access is still verified before app initialization; non-management accounts retain their field portal route. Never put tokens in app links.

EOS's contractor choices are restricted to Mitchells Drilling and DEPCO Drilling, with one contractor selected at a time. EOS defaults to all projects and can filter project and program without changing contractor. Both cached contractor choices and project-linked contractor responses are scoped for EOS; a previously selected MCC session falls back to an allowed contractor before report requests start. The full supplier cache remains available to Account and Project. No supplier records are deleted.

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

## Read performance

EOS starts its active view after authentication while contractor/project registries load alongside it. It derives filter options from the same report response, avoiding a blocking filter-count request. A memory-only 30-second read cache coalesces simultaneous requests and reuses contractor report bundles across Overview, Production, Plods and Period Reports. Cache keys include request parameters and the current session; mutations, explicit Refresh and session changes invalidate it. Failed responses and auth endpoints are never cached. No records or credentials are added to persistent browser storage.

The API seeds contractor defaults once at startup, batches the inserts, and serves GET /contractors with one read. GET /filters combines five scans into one aggregate. Client/project metadata reads avoid unnecessary write-transaction setup. Borehole actuals use deduplicated candidate pairs and compute normalized identifiers once, retaining all exact/audited matching rules. Live read-only comparisons covered Company (109 rows), Mitchells (110), DEPCO (109) and all contractors (111); counts, dates/status and totals matched (floating-point summation differences below 1e-6). The replacement Company query measured 92.554 ms in EXPLAIN ANALYZE; historical matching queries averaged 17–22 seconds. No schema or data migration is needed.

Performance checks: `tests/eos_data_cache.test.mjs`, `tests/eos_loading.browser.mjs`, and `backend/test_eos_read_speed.py`, alongside navigation/scope and existing read-path/alias tests. Browser delay figures are controlled fixtures, not a promise of production network latency.

### EOS operational performance

- Standby defaults to confirmed chargeable entries. The optional non-chargeable checkbox is shared by Overview, Production and Period Report and does not refetch data. Missing rates remain unconfirmed and are disclosed separately. Excluded standby is removed from chart hours, never relabelled as other work; recorded source hours and charges remain intact.
- Wet weather, logging, water, grouting, inspections and other standby reasons have separate bars. Source rates and explicit non-chargeable basis determine inclusion, rather than a zero cost alone.
- Completed holes require an explicit dated EOH/completion note. Each contractor/project/hole is counted once at its first recorded completion, including when a later period contains a repeated EOH note.
- Penetration is timed metres divided by recorded drilling hours, weighted across rows, with separate core/chip rates. Untimed metres do not inflate the rate. Daily averages use production days; rig-day averages count producing rig/date combinations. Daily rows show completed holes, metres, drilling hours, penetration, standby and site moves.
- Site moves use explicit rig/site movement codes or descriptions, excluding crew travel and delays. Mixed move/setup records retain their entire recorded duration and are labelled as combined. The printable report preserves average lines and the standby selection.
- CorePlan generic time categories now recognise explicit weather standby as H_Standby_Wet_Weath. This changes classification only; imported source rates and amounts are retained.
- Regression coverage: tests/eos_production.test.mjs, tests/eos_performance.browser.mjs, backend/test_weather_standby.py.

### On-demand detail and historical weather

- PLODs / Activity Reports is a permanent main-navigation item and supports direct links. Its report register, filters and individual report access load when the page is opened, independent of raw-log settings. EOS Settings enables only the optional raw activity, crew, consumables and reconciliation tables for the current browser tab. Background hooks cannot build the report register or raw tables on other pages. Unload removes optional tables and invalidates pending loads while preserving the PLOD register and Production Report shift register.
- Fatigue management counts as standby only when its recorded line charge is positive. Zero/missing-charge fatigue stays excluded even with non-chargeable standby enabled; source hours and prices are retained.
- The Period Report has an optional charge column in its shift register. Activity costs respect cost-source flags and MCC allocations. Material charges attach only to a unique project/plod/rig/shift; ambiguous or missing charges are marked partial, not silently apportioned. Displaying standby differently never reprices the register.
- Weather loads independently above the Period Report production chart from `/eos/weather`. The endpoint uses saved project borehole coordinates (MGA55 fallback, as in the planning map), rounds to SILO's 0.05° grid and caches provider responses for six hours. A newly named project can use an exact shared recorded hole only when it resolves to one planning project; that location source is displayed. Missing or geographically ambiguous locations remain unavailable.
- Source: Queensland Government SILO, BOM-derived interpolated estimates, CC BY 4.0. Temperature is daily maximum °C; humidity is derived relative humidity at Tmax, not daily mean humidity. Icons indicate rainfall/no rainfall, not cloud cover. Long-term-average source code 75, future dates and missing values are never presented as the day's weather. Multi-month charts use maximum temperature, mean RH at Tmax and total rain over recorded report dates.
- SILO uses `SILO_CONTACT_EMAIL` when configured, otherwise the published business contact `admin@drillops.com.au`. Only grid coordinates, dates and that contact are sent to SILO. API calls retain the existing authenticated admin middleware; no schema or access-policy changes.
- Tests: `tests/eos_lazy_logs.browser.mjs`, `tests/eos_shift_charges.test.mjs`, `tests/eos_weather.browser.mjs`, `backend/test_eos_weather.py` plus the existing operational/loading/auth checks.
