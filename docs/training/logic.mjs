export const normalise = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
export const dayNumber = s => Math.floor(Date.parse(s + 'T00:00:00Z') / 86400000);
export const evidenceTypes = {qualification:'Qualification / statement of attainment',site_authorisation:'Site authorisation / appointment',voc:'VOC / recognition of current competency',site_training:'Site training / familiarisation',licence:'Licence',medical:'Medical',transcript:'Transcript entry',other:'Other evidence'};
export const recordDueDate = r => r.expires || r.renewalDue || null;
export function evidenceType(r) {
  if (r.evidenceType) return r.evidenceType;
  if (/\.(Authorisation|Appointment)\./i.test(r.name)) return 'site_authorisation';
  if (/^(Medical|Drug and Alcohol Testing)\./i.test(r.name)) return 'medical';
  if (/Statement of (Attainment|Competency)/i.test(r.name)) return 'qualification';
  if (/\.(Training|Induction|Awareness)\./i.test(r.name)) return 'site_training';
  return 'other';
}
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function recordStatus(r, today, horizon=90) {
  if (r.reviewRequired) return 'review';
  if (r.assignment !== 'Complete') return 'review';
  const due = recordDueDate(r);
  if (r.reportedStatus === 'Expired' || (due && due < today)) return 'expired';
  if (r.reportedStatus !== 'Current' || (r.issued && r.issued > today)) return 'review';
  if (due && dayNumber(due)-dayNumber(today) <= horizon) return 'soon';
  return 'current';
}
export function evidence(person, column, today, horizon=90) {
  if (!column.aliases.length) return {status:'unmapped', records:[], best:null};
  const aliases = new Set(column.aliases.map(normalise));
  const records = person.records.filter(r => aliases.has(normalise(r.name)) && (!column.evidenceType || evidenceType(r) === column.evidenceType));
  const rank = {current:4, soon:3, review:2, expired:1};
  const sorted = [...records].sort((a,b) => rank[recordStatus(b,today,horizon)]-rank[recordStatus(a,today,horizon)] || (recordDueDate(b) || '9999').localeCompare(recordDueDate(a) || '9999') || (b.issued || '').localeCompare(a.issued || ''));
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
