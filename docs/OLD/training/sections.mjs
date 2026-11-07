export const sectionColours = {teal:'Teal',blue:'Blue',purple:'Purple',gold:'Gold',sky:'Sky blue',indigo:'Indigo',clay:'Clay',green:'Green',slate:'Slate'};
const legacyColours = Object.fromEntries(['Core / Site','Drilling','Supervisor','Driving','Gas Testing','Lifting','Loading Crane'].map((name,i)=>[name,Object.keys(sectionColours)[i]]));
export function trainingSections(state) {
  const sections=(state.sections||[]).map(s=>({...s}));
  for(const c of state.columns) if(!sections.some(s=>s.name===c.group)) sections.push({name:c.group,colour:legacyColours[c.group]||Object.keys(sectionColours)[sections.length%Object.keys(sectionColours).length]});
  return sections;
}
export function orderedTrainingColumns(state) {
  return trainingSections(state).flatMap(s=>state.columns.filter(c=>c.group===s.name));
}
