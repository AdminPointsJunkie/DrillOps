export const normalise = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
export const dayNumber = s => Math.floor(Date.parse(s + 'T00:00:00Z') / 86400000);
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function recordStatus(r, today, horizon=90) {
  if (r.assignment !== 'Complete') return 'review';
  if (r.reportedStatus === 'Expired' || (r.expires && r.expires < today)) return 'expired';
  if (r.reportedStatus !== 'Current' || (r.issued && r.issued > today)) return 'review';
  if (r.expires && dayNumber(r.expires)-dayNumber(today) <= horizon) return 'soon';
  return 'current';
}
export function evidence(person, column, today, horizon=90) {
  if (!column.aliases.length) return {status:'unmapped', records:[], best:null};
  const aliases = new Set(column.aliases.map(normalise));
  const records = person.records.filter(r => aliases.has(normalise(r.name)));
  const rank = {current:4, soon:3, review:2, expired:1};
  const sorted = [...records].sort((a,b) => rank[recordStatus(b,today,horizon)]-rank[recordStatus(a,today,horizon)] || (b.expires || '9999').localeCompare(a.expires || '9999') || (b.issued || '').localeCompare(a.issued || ''));
  return {status:sorted.length ? recordStatus(sorted[0],today,horizon) : 'missing', records:sorted, best:sorted[0] || null};
}
export function requirement(state, person, column) {
  return state.roles[person.role]?.[column.id] || 'optional';
}
export function readiness(state, person, today, horizon=90) {
  if (person.role === 'Unassigned') return {label:'Assign role', total:0, met:0, gaps:[]};
  const minimum = state.columns.filter(c => requirement(state,person,c)==='minimum');
  if (!minimum.length) return {label:'Set requirements', total:0, met:0, gaps:[]};
  const gaps = minimum.filter(c=>!['current','soon'].includes(evidence(person,c,today,horizon).status));
  return {label:gaps.length ? `${gaps.length} to review` : 'Minimum met', total:minimum.length, met:minimum.length-gaps.length, gaps};
}
