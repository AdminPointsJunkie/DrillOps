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
  function build(budgetRows, holeRows, scope) {
    const budgets = budgetRows === null ? null : budgetRows.filter(row => matches(row, scope, false));
    const holes = holeRows === null ? null : holeRows.filter(row => matches(row, scope, true) && row.current_budget_scope !== false && norm(row.status) !== 'cancelled');
    const amounts = budgets?.map(row => amount(row.budget_amount));
    const budget = amounts?.length && amounts.every(value => value !== null) ? amounts.reduce((sum, value) => sum + value, 0) : null;
    const categories = Object.create(null);
    if (budget !== null) budgets.forEach((row, index) => {
      const category = text(row.section) || 'Uncategorised';
      categories[category] = (categories[category] || 0) + amounts[index];
    });
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
    return {budget, budgets, holes, categories, groups, schedule, located};
  }
  return {build, amount, date};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ProjectDashboardModel;
