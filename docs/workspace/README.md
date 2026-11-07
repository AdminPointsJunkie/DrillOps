# Standalone DrillOps apps

Entry points:
- `index.html`: legacy entry address; opens EOS directly after the existing login.
- `eos.html`: EOS reporting, production, recorded-work charges, rates and operational imports.
- `account.html`: invoice actuals ledger, purchase orders, suppliers and invoice imports.
- `project.html`: project setup, borehole planning/maps, budget planning and administration.

Each app document contains only its own page panels and its own navigation. Cross-app links navigate to the owning app. They are independent documents, not tabs around the old all-in-one page. Shared dialogs and authentication remain in `shell.html`; the existing business functions and API/auth client remain in `runtime.js`. `start.js` runs after optional app enhancements, including Account's invoice ledger.

The shared session key, API origin and client/project/program selection keys are unchanged. No database copies, schema changes or new access privileges are introduced. Management access is still verified before app initialization; non-management accounts retain their field portal route. Never put tokens in app links.

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

EOS uses the existing daily-report bundle and approval records to show report counts, metres, hours, priced charges, recent plods and recorded time usage. These are recorded shifts, not sensor telemetry. Unknown pricing is flagged as incomplete. The selected contractor, client, project and program scope the overview. The plod register offers functional approval, shift and rig filters.

Design references (reviewed 8 November 2026): CorePlan's public contractor/plod workflow (https://help.coreplan.io/en/articles/12888261-using-the-coreplan-driller-contractor-portal and https://www.coreplan.io/drilling) and Felt's interface (https://felt.com/). EOS retains its own name and assets; the implementation does not embed either vendor's screenshots or branding, nor claim feature parity with their platforms.

Account opens straight into its invoice ledger; Project opens straight into its project register. EOS opens its operational overview. There is no chooser or app-switching control. Training Matrix belongs to Project and returns there.

All three apps share the approved EOS visual style: a white sidebar and compact header, neutral background, light panels, subdued blue actions and consistent tables. Training Matrix uses the same palette while preserving its evidence colours and adjustable text sizes.

## Previous portal

`/OLD/` retains the combined portal that was published immediately before this release, from commit `cfb28bf4858f841cb3cc2622e7406dbab0b759ce`. Its documents, scripts, styles and training pages are preserved by `scripts/snapshot_legacy_site.py`. Shared images and the separate FieldMaps app keep their unchanged root URLs. The old portal retains its existing login and uses the same live API data; it is not a backup database. Normal workspace generation does not overwrite this snapshot.

The snapshot includes one compatibility guard: the old startup timer skips its retired analytics panel when that panel is absent.
