// Shared auth helpers loaded on every page.
window.Auth = (() => {
  const TOKEN_KEY = 'let_token';
  const USER_KEY = 'let_user';

  const getToken = () => localStorage.getItem(TOKEN_KEY);
  const getUser = () => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
  };
  const setSession = (token, user) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  };
  const clearSession = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  };

  async function authFetch(url, opts = {}) {
    const headers = new Headers(opts.headers || {});
    const token = getToken();
    if (token) headers.set('Authorization', 'Bearer ' + token);
    if (opts.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const res = await fetch(url, { ...opts, headers });
    if (res.status === 401) {
      clearSession();
      window.location.replace('/login.html');
      throw new Error('auth_required');
    }
    return res;
  }

  /**
   * Hide document body until we've confirmed the token with the server.
   * Redirects to /login.html on failure. Returns the user on success.
   * Also re-runs on bfcache restore (pageshow with persisted=true).
   */
  async function ensureSession() {
    if (document.body) document.body.style.visibility = 'hidden';
    const finish = (user) => {
      renderUserBadge();
      if (document.body) document.body.style.visibility = 'visible';
      return user;
    };
    if (!getToken()) { window.location.replace('/login.html'); return null; }
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: 'Bearer ' + getToken() },
        cache: 'no-store',
      });
      if (!res.ok) {
        clearSession();
        window.location.replace('/login.html');
        return null;
      }
      const data = await res.json();
      setSession(getToken(), data.user);
      return finish(data.user);
    } catch {
      window.location.replace('/login.html');
      return null;
    }
  }

  /**
   * Mirror of ensureSession for public pages (login/signup/forgot).
   * If a valid session exists, hard-redirect to '/' with location.replace so back button
   * cannot land on the public page again. Hides body while checking.
   */
  async function redirectIfAuthed() {
    if (document.body) document.body.style.visibility = 'hidden';
    const showBody = () => { if (document.body) document.body.style.visibility = 'visible'; };
    if (!getToken()) { showBody(); return false; }
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: 'Bearer ' + getToken() },
        cache: 'no-store',
      });
      if (res.ok) {
        window.location.replace('/');
        return true;
      }
      clearSession();
      showBody();
      return false;
    } catch {
      showBody();
      return false;
    }
  }

  // If user returns via back/forward and the page was cached, re-check.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    if (document.body?.dataset.requiresAuth === '1') ensureSession();
    if (document.body?.dataset.publicOnly === '1') redirectIfAuthed();
  });

  function renderUserBadge(containerId = 'userBadge') {
    const el = document.getElementById(containerId);
    if (!el) return;
    const user = getUser();
    if (!user) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <span class="user-email">${user.email}</span>
      <button id="logoutBtn" class="link-btn">Log out</button>
    `;
    document.getElementById('logoutBtn').onclick = () => {
      clearSession();
      window.location.replace('/login.html');
    };
  }

  return { getToken, getUser, setSession, clearSession, authFetch, ensureSession, redirectIfAuthed, renderUserBadge };
})();
