/*
 * auth-guard.js — NL Tools v2
 * Version: v1.0 (conversation turn 3)
 * Date: 31/03/2025
 *
 * Changelog:
 * v1.0 — Initial v2 build. Rebuilt from scratch for v2 two-toggle access model.
 *         Reads users/{uid}/tools/{key}/access (not the v1 boolean at tools/{key}).
 *         Superadmin bypasses all checks.
 *         Admin bypasses tier checks but still requires explicit access grant.
 *         Redirects to /tools/portal/?guard=denied|error on failure.
 *         Redirects to /tools/ if unauthenticated.
 *         Shows full-screen red spinner overlay while checking.
 *
 * Usage (include on every tool page):
 *   <script>
 *     var NL_TOOL_KEY = 'ao-vacancies';
 *     window.nlAuthReady = function(user, userData) {
 *       // user = Firebase Auth user object
 *       // userData = full user record from RTDB
 *       document.getElementById('pageWrap').style.display = 'block';
 *     };
 *   </script>
 *   <script src="/tools/auth-guard.js"></script>
 *
 * Requires: Firebase compat CDN (app + auth + database) already loaded on the page.
 * NL_TOOL_KEY must be defined before this script is included.
 * window.nlAuthReady must be defined before this script is included.
 */

(function () {

  /* ─── Validate host page has set required globals ─────────────────────── */
  if (typeof NL_TOOL_KEY === 'undefined' || !NL_TOOL_KEY) {
    console.error('[auth-guard] NL_TOOL_KEY is not defined. Include this script after setting NL_TOOL_KEY.');
    return;
  }
  if (typeof window.nlAuthReady !== 'function') {
    console.error('[auth-guard] window.nlAuthReady is not defined. Include this script after defining nlAuthReady.');
    return;
  }

  /* ─── Spinner overlay ─────────────────────────────────────────────────── */
  var overlay = document.createElement('div');
  overlay.id = 'nlAuthOverlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'background:#9e0000',
    'display:flex', 'align-items:center', 'justify-content:center',
    'flex-direction:column', 'gap:20px'
  ].join(';');

  var spinnerEl = document.createElement('div');
  spinnerEl.style.cssText = [
    'width:36px', 'height:36px',
    'border:3px solid rgba(255,255,255,0.3)',
    'border-top-color:#fff',
    'border-radius:50%',
    'animation:nlSpin 0.7s linear infinite'
  ].join(';');

  var styleEl = document.createElement('style');
  styleEl.textContent = '@keyframes nlSpin{to{transform:rotate(360deg)}}';

  overlay.appendChild(spinnerEl);
  document.head.appendChild(styleEl);
  document.body.appendChild(overlay);

  function removeOverlay() {
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  }

  /* ─── Firebase refs ───────────────────────────────────────────────────── */
  var auth = firebase.auth();
  var db   = firebase.database();

  /* ─── Redirect helpers ────────────────────────────────────────────────── */
  var PORTAL_URL = '/tools/portal/';
  var LOGIN_URL  = '/tools/';

  function redirectTo(url) {
    window.location.replace(url);
  }

  /* ─── Main auth state listener ────────────────────────────────────────── */
  auth.onAuthStateChanged(function (user) {

    if (!user) {
      /* Not signed in — send to login */
      redirectTo(LOGIN_URL);
      return;
    }

    /* Signed in — fetch user record from RTDB */
    db.ref('users/' + user.uid).once('value')
      .then(function (snap) {

        if (!snap.exists()) {
          /* No user record — deny */
          redirectTo(PORTAL_URL + '?guard=error');
          return;
        }

        var userData = snap.val();
        var role = userData.role || '';

        /* ── Superadmin: bypass everything ─────────────────────────────── */
        if (role === 'superadmin') {
          removeOverlay();
          window.nlAuthReady(user, userData);
          return;
        }

        /* ── Pending users: deny ────────────────────────────────────────── */
        if (userData.pending === true) {
          redirectTo(PORTAL_URL + '?guard=pending');
          return;
        }

        /* ── Check access toggle ────────────────────────────────────────── */
        /*
         * v2 structure: users/{uid}/tools/{key}/access: bool
         * v1 was:       users/{uid}/tools/{key}: true/false  ← DO NOT USE
         *
         * Admin role bypasses tier restrictions but still needs an explicit
         * access grant on the tool (admin panel must assign it).
         */
        var toolEntry = userData.tools && userData.tools[NL_TOOL_KEY];
        var hasAccess = toolEntry && toolEntry.access === true;

        if (!hasAccess) {
          redirectTo(PORTAL_URL + '?guard=denied');
          return;
        }

        /* ── Access granted ─────────────────────────────────────────────── */
        removeOverlay();
        window.nlAuthReady(user, userData);

      })
      .catch(function (err) {
        console.error('[auth-guard] RTDB read failed:', err);
        redirectTo(PORTAL_URL + '?guard=error');
      });

  });

})();
