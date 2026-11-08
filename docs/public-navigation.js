/* Shared public menu: native details works without JavaScript. */
(() => {
  const menu = document.querySelector('.mobile-menu');
  if (!menu) return;
  const close = () => { menu.open = false; };
  menu.querySelectorAll('a').forEach(link => link.addEventListener('click', close));
  document.addEventListener('click', event => { if (!menu.contains(event.target)) close(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) { close(); menu.querySelector('summary').focus(); }
  });
  matchMedia('(min-width: 960px)').addEventListener('change', event => { if (event.matches) close(); });
})();
