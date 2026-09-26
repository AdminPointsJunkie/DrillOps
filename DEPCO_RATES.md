# DEPCO contract codes and activity pricing

The 26038 workbook is stored as a source-referenced catalogue in `backend/data/depco_26038_rates.json`. Rates are AUD excluding GST. Exploration uses the current rate columns, confirmed by the user: active $630.50/hour, standby $485/hour, chipping reductions of $2/metre and PQ reductions of $10/metre. HQ is unchanged.

In Costs → Contracts, open a DEPCO project contract, select its schedule and choose **Add DEPCO codes**. Exploration, Service Casing (Gas Riser), and SIS remain separate. Imports add missing codes without replacing edited rates. Set the contract Active when ready to use it.

In the activity register, choose **Contract code** beside an activity. Select its activity or drill size; the existing reprice action calculates the cost. Hourly charges use duration, metre charges use drilled metres, and daily/item charges require an explicit quantity. Depth-based drilling splits the recorded interval across the applicable size's depth bands. Bulk recalculation uses the same calculation and respects locked reports.

Review entries retain the original source text. They include missing prices, cost-plus items, responsibility-dependent delays, off-lease travel allowances, provisional casing, charges included in another package, and Exploration wet-weather rates awaiting confirmation. Enter an agreed price and resolve the condition before changing a rate to Active. No automatic discount effective date is inferred; set the contract's dates for the agreed period.

The SIS and VPW worked examples are not imported as additional rate schedules. They contain indicative quantities and conflicts with the rate card (for example, casing units and wellhead completion prices). Blank tender tables are not converted to zero prices.

DEPCO DDR imports suggest codes from the active project/program contract using recognised activity descriptions and explicit drilling sizes. For example, rig setup maps to the setup/packup code, waiting for a logger maps to standby, and PCD drilling with a diameter maps to that size's depth bands. Suggestions are labelled in the pricing basis; combined activities, missing dimensions and ambiguous matches require review. Conditional codes can be suggested without assigning a charge.

The handwritten DDR preview displays each suggested code, unit rate, line amount and reason. Reviewers can change the code using the contract dropdown and provide daily/item quantities. After editing the source text, dimensions, date or quantity, refresh suggestions before import. The server recomputes all prices on import and never trusts submitted amounts. The selected client, project and program are retained with the imported rows. Explicit code choices are preserved; automatic suggestions are recomputed from the reviewed description.

An unmapped or unresolved activity remains unpriced and displays its review reason. Existing consumables records remain managed by their existing workflow; the DEPCO catalogue's consumable codes can also price explicit activity quantities.
