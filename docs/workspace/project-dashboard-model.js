/* Pure dashboard calculations. No forecasts, accruals or fallback sample records. */
var ProjectDashboardModel = (() => {
  const text = value => String(value ?? '').trim();
  const norm = value => text(value).toLowerCase();
  function amount(value) {
    if (value === null || value === undefined || text(value) === '') return null;
    const number = Number(text(value).replace(/[$,\s]/g, ''));
    return Number.isFinite(number) ? number : null;
  }
  function date(value) {
    let valueText = text(value);
    const local = valueText.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
    if (local) valueText = local[3]+'-'+local[2].padStart(2,'0')+'-'+local[1].padStart(2,'0');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valueText)) return null;
    const time = Date.parse(valueText + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === valueText ? time : null;
  }
  function matches(row, scope, requireYear) {
    if (norm(row.project) !== norm(scope.project) || norm(row.program) !== norm(scope.program)) return false;
    if (row.client_id != null && String(row.client_id) !== String(scope.clientId)) return false;
    if (row.project_id != null && String(row.project_id) !== String(scope.projectId)) return false;
    const year = text(row.planned_year ?? row.year);
    return requireYear ? year === String(scope.year) : !year || year === String(scope.year);
  }
  function workbook(source, scope) {
    if (!source || norm(scope.program)!=='exploration' || norm(source.project)!==norm(scope.project) || String(source.year)!==String(scope.year)) return null;
    if (source.program && norm(source.program)!==norm(scope.program)) return null;
    if (!Array.isArray(source.boreholes) || !source.boreholes.length || amount(source.total)===null) throw new Error('Incomplete workbook budget');
    const fields={drilling_budget_total:'Drilling',earthworks_budget_total:'Earthworks',geophysical_budget_total:'Geophysical',geological_support_budget_total:'Geological support',misc_budget_total:'Other'};
    const categories={};
    for (const [field,label] of Object.entries(fields)) {
      const values=source.boreholes.map(row=>amount(row[field]));
      if(values.some(value=>value===null))throw new Error('Missing workbook category amounts');
      categories[label]=Math.round(values.reduce((a,b)=>a+b,0)*100)/100;
    }
    const total=amount(source.total),categoryTotal=Object.values(categories).reduce((a,b)=>a+b,0);
    if(Math.abs(total-categoryTotal)>0.02)throw new Error('Workbook categories do not reconcile');
    return {...source,total,comparison_total:amount(source.comparison_total),categories};
  }
  function build(budgetRows, holeRows, scope, source=null) {
    let budgets = budgetRows === null ? null : budgetRows.filter(row => matches(row, scope, false));
    const holes = holeRows === null ? null : holeRows.filter(row => matches(row, scope, true) && row.current_budget_scope !== false && norm(row.status) !== 'cancelled');
    const amounts = budgets?.map(row => amount(row.budget_amount));
    let budget = amounts?.length && amounts.every(value => value !== null) ? amounts.reduce((sum, value) => sum + value, 0) : null;
    let categories = Object.create(null);
    if (budget !== null) budgets.forEach((row, index) => {
      const category = text(row.section) || 'Uncategorised';
      categories[category] = (categories[category] || 0) + amounts[index];
    });
    const imported=workbook(source,scope);
    if(imported){budget=imported.total;categories=imported.categories;budgets=Object.entries(categories).map(([section,budget_amount])=>({section,budget_amount}));}
    const groups = {Complete: 0, 'In Progress': 0, Planned: 0, Other: 0};
    holes?.forEach(row => {
      const status = Object.keys(groups).find(key => norm(key) === norm(row.status)) || 'Other';
      groups[status] += 1;
    });
    const schedule = (holes || []).map(row => ({...row, start: date(row.scheduled_start), end: date(row.scheduled_end)}))
      .filter(row => row.start !== null && row.end !== null && row.end >= row.start)
      .sort((a, b) => a.start - b.start || text(a.hole_id).localeCompare(text(b.hole_id)));
    const located = holes?.filter(row => {
      const lat = amount(row.lat), lng = amount(row.lng);
      return lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
    }).length ?? null;
    return {budget, budgets, imported, holes, categories, groups, schedule, located};
  }
  return {build, amount, date, workbook};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ProjectDashboardModel;
