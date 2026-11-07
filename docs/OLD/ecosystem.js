(() => {
  const products = {
    activities: {name:'DRILLOPS ACTIVITIES',title:'Make every shift count.',copy:'Capture daily activity, metres and delays. Give the office a clear report to review.',link:'#activities',label:'Explore Activities'},
    fieldops: {name:'FIELDOPS',title:'Bring back the field context.',copy:'Photos, waypoints and tracks. Practical tools to record what matters on the ground.',link:'./fieldops.html',label:'Explore FieldOps'},
    fieldmaps: {name:'DRILLOPS FIELDMAPS',title:'See how it all fits.',copy:'Organise drawings, points and boundaries in a clear project map. Style layers and share a SYNC view.',link:'#fieldmaps',label:'Explore FieldMaps'}
  };
  document.querySelectorAll('.eco-scene-tabs button').forEach(button => button.addEventListener('click', () => {
    const product = products[button.dataset.product];
    if (!product) return;
    document.querySelectorAll('.eco-scene-tabs button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    document.getElementById('eco-preview-product').textContent = product.name;
    document.getElementById('eco-preview-title').textContent = product.title;
    document.getElementById('eco-preview-copy').textContent = product.copy;
    const link = document.getElementById('eco-preview-link');
    link.href = product.link;
    link.textContent = product.label + ' →';
  }));
  document.querySelectorAll('.eco-menu a').forEach(link => link.addEventListener('click', () => link.closest('details').removeAttribute('open')));
})();
