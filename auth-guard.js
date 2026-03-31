/*
  NL Tools — Auth Guard
  Version: v1.2
  Date: 30/03/2026
  Location: /tools/auth-guard.js

  Changelog:
  v1.2 (30/03/2026) — Removed admins/ node dependency. Role now read from
                       users/{uid}/role. Superadmin and admin both bypass
                       tier checks. Tier enforcement unchanged.
  v1.1 (30/03/2026) — Tier enforcement added.
  v1.0 (30/03/2026) — Initial build.

  USAGE
  -----
    <script>
      var NL_TOOL_KEY = 'vacancies-admin';
      window.nlAuthReady = function(user) {
        document.getElementById('pageWrap').style.display = 'block';
      };
    </script>
    <script src="/tools/auth-guard.js"></script>

  ACCESS MATRIX
  -------------
    Tool tier 'staff' → role must be staff, admin, or superadmin
    Tool tier 'club'  → role must be club, staff, admin, or superadmin
    Tool tier 'all'   → any authenticated user
    No tier set       → treated as 'staff' (safe default)

  Admins and superadmins bypass tier checks but still need explicit tool access.
  Superadmins bypass everything including tool access checks.
*/

(function() {
  'use strict';

  // ── Overlay ───────────────────────────────────────────────────────────────
  var overlay = document.createElement('div');
  overlay.id  = 'nlAuthOverlay';
  overlay.innerHTML = '<div style="position:fixed;inset:0;background:#9e0000;display:flex;align-items:center;justify-content:center;z-index:99999;">'
    + '<div style="width:32px;height:32px;border:3px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:nlSpin 0.7s linear infinite;"></div></div>'
    + '<style>@keyframes nlSpin{to{transform:rotate(360deg)}}</style>';
  document.body.appendChild(overlay);

  // ── Validate ──────────────────────────────────────────────────────────────
  if (typeof NL_TOOL_KEY === 'undefined' || !NL_TOOL_KEY) {
    console.error('[NL Auth Guard] NL_TOOL_KEY is not defined.');
    _fail('config'); return;
  }
  if (typeof firebase === 'undefined') {
    console.error('[NL Auth Guard] Firebase is not loaded.');
    _fail('config'); return;
  }

  var auth = firebase.auth();
  var db   = firebase.database();

  // ── Auth check ────────────────────────────────────────────────────────────
  auth.onAuthStateChanged(function(user) {
    if (!user) { window.location.replace('/tools/'); return; }

    Promise.all([
      db.ref('users/' + user.uid + '/tools/' + NL_TOOL_KEY).once('value'),
      db.ref('tools/' + NL_TOOL_KEY + '/tier').once('value'),
      db.ref('users/' + user.uid + '/role').once('value')
    ])
    .then(function(results) {
      var hasAccess = results[0].val() === true;
      var toolTier  = results[1].val() || 'staff';
      var userRole  = results[2].val() || 'staff';
      var isAdmin   = userRole === 'admin' || userRole === 'superadmin';

      // Superadmins bypass everything
      if (userRole === 'superadmin') { _pass(user); return; }

      // Check explicit tool access
      if (!hasAccess) { _fail('denied'); return; }

      // Admins bypass tier checks but need explicit access (checked above)
      if (isAdmin) { _pass(user); return; }

      // Tier check for staff and club
      if (toolTier === 'staff' && userRole === 'club') { _fail('tier'); return; }

      _pass(user);
    })
    .catch(function(err) {
      console.error('[NL Auth Guard] Read failed:', err);
      _fail('error');
    });
  });

  function _pass(user) {
    var el = document.getElementById('nlAuthOverlay');
    if (el) el.parentNode.removeChild(el);
    if (typeof window.nlAuthReady === 'function') {
      window.nlAuthReady(user);
    } else {
      console.warn('[NL Auth Guard] window.nlAuthReady is not defined.');
    }
  }

  function _fail(reason) {
    if (reason === 'config') return;
    window.location.replace('/tools/portal/?guard=' + reason);
  }

})();
