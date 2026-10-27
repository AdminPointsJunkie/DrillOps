export function installBasemaps(L, map, select, label) {
  const esri = 'https://services.arcgisonline.com/ArcGIS/rest/services/';
  const imagery = () => L.tileLayer(esri + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Tiles © Esri — Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community',
  });
  const reference = service => L.tileLayer(esri + `Reference/${service}/MapServer/tile/{z}/{y}/{x}`, {
    maxZoom: 19, maxNativeZoom: 19, attribution: 'Labels © Esri, HERE, Garmin, OpenStreetMap contributors, and the GIS User Community',
  });
  const views = {
    street: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }),
    satellite: imagery(),
    hybrid: L.layerGroup([imagery(), reference('World_Transportation'), reference('World_Boundaries_and_Places')]),
  };
  let active = views.street;
  active.addTo(map);
  select.onchange = () => {
    const next = views[select.value];
    if (!next || next === active) return;
    map.removeLayer(active);
    active = next;
    active.addTo(map);
    label.textContent = { street: 'OpenStreetMap', satellite: 'Esri Satellite', hybrid: 'Esri Hybrid' }[select.value];
  };
}
