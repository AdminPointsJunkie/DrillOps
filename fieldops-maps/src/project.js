// Projects retain the existing maps IDs and layer relationships.
export function importCRS(project, embedded = '', embeddedLabel = '') {
  if (project?.default_crs) return {
    code: project.default_crs,
    label: project.default_crs_label || project.default_crs,
    fromProject: true,
  };
  return { code: embedded, label: embeddedLabel, fromProject: false };
}

export function projectCRS(value, catalogue) {
  const text = value.trim();
  if (!text) return { default_crs: null, default_crs_label: null };
  const entry = catalogue.find(c => c.code.toLowerCase() === text.toLowerCase()
    || c.code.slice(5) === text || `${c.code} — ${c.name}` === text);
  if (!entry) throw Error('Choose a coordinate system from the EPSG results, or leave the default blank.');
  return { default_crs: entry.code, default_crs_label: `${entry.code} — ${entry.name}` };
}
