/* Public navigation and presentation only; account handling stays in the portal. */
(() => {
  document.querySelectorAll('.mobile-menu a').forEach(link => link.addEventListener('click', () => link.closest('details').removeAttribute('open')));
  const screen = document.getElementById('login-screen');
  if (!screen) return;
  const showSignIn = () => screen.classList.add('signin-mode');
  const update = () => {
    const params = new URLSearchParams(location.search);
    if (params.has('signin') || params.has('return_to') || location.hash === '#portal-login' || /(?:type=(?:recovery|invite)|access_token=)/.test(location.hash)) showSignIn();
    const reset = document.getElementById('password-reset-panel');
    const error = document.getElementById('login-error');
    if ((reset && !reset.hidden) || (error && error.textContent.trim())) showSignIn();
  };
  update();
  addEventListener('hashchange', update);
  for (const id of ['password-reset-panel', 'login-error']) {
    const element = document.getElementById(id);
    if (element) new MutationObserver(update).observe(element, {attributes:true, childList:true, subtree:true, characterData:true});
  }
})();
