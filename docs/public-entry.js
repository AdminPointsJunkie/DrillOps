/* Keep historical sign-in/recovery bookmarks working without loading the app on the public home. */
(() => {
  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.slice(1));
  if (query.has('signin') || query.has('return_to') || query.has('code') || query.has('token_hash') ||
      location.hash === '#portal-login' || hash.has('access_token') || hash.has('error') ||
      ['recovery', 'invite'].includes(hash.get('type'))) {
    location.replace('./eos.html' + location.search + location.hash);
  }
})();
