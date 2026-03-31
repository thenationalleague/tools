/*
  NL Tools — Auth Guard
  Version: v1.1
  Date: 30/03/2026
  Location: /tools/auth-guard.js

  Changelog:
  v1.1 (30/03/2026) — Added tier enforcement. Reads tool tier from RTDB
                       /tools/{NL_TOOL_KEY}/tier and user role from
                       /users/{uid}/role. Blocks club users from staff-tier
                       tools, redirecting to portal with guard=tier flag.
  v1.0 (30/03/2026) — Initial build. Auth check + per-tool access check.

  USAGE
  -----
  Include at the bottom of any protected tool page's <body>, BEFORE the
  page's own <script> block. Define the tool key on the page first:

    <script>
      var NL_TOOL_KEY = 'vacancies-admin';
      window.nlAuthReady = function(user) {
        document.getElementById('pageWrap').style.display = 'block';
        // initialise your tool here
      };
    </script>
    <script src="/tools/auth-guard.js"></script>

  TIER ENFORCEMENT
  ----------------
  Tool tier is read from RTDB /tools/{NL_TOOL_KEY}/tier.
  User role is read from RTDB /users/{uid}/role.

  Access matrix:
    Tool tier 'staff' → only users with role 'staff' or 'admin' may access
    Tool tier 'club'  → only users with role 'club', 'staff', or 'admin' may access
    Tool tier 'all'   → any authenticated user may access
    No tier set       → treated as 'staff' (safe default)

  Admins (admins/{uid} === true) bypass tier checks entirely.
*/

(function() {
  'use strict';

  // ── Inject loading overlay ─────────────────────────────────────────────────
  var overlay = document.createElement('div');
  overlay.id  = 'nlAuthOverlay';
  overlay.innerHTML = '<div style="'
    + 'position:fixed;inset:0;background:#9e0000;'
    + 'display:flex;align-items:center;justify-content:center;z-index:99999;'
    + '">'
    + '<div style="'
    + 'width:32px;height:32px;'
    + 'border:3px solid rgba(255,255,255,0.3);'
    + 'border-top-color:#fff;border-radius:50%;'
    + 'animation:nlSpin 0.7s linear infinite;'
    + '"></div></div>'
    + '<style>@keyframes nlSpin{to{transform:rotate(360deg)}}</style>';
  document.body.appendChild(overlay);

  // ── Validate setup ─────────────────────────────────────────────────────────
  if (typeof NL_TOOL_KEY === 'undefined' || !NL_TOOL_KEY) {
    console.error('[NL Auth Guard] NL_TOOL_KEY is not defined.');
    _guardFail('config'); return;
  }
  if (typeof firebase === 'undefined') {
    console.error('[NL Auth Guard] Firebase is not loaded.');
    _guardFail('config'); return;
  }

  var auth = firebase.auth();
  var db   = firebase.database();

  // ── Auth state ─────────────────────────────────────────────────────────────
  auth.onAuthStateChanged(function(user) {
    if (!user) { window.location.replace('/tools/'); return; }

    // Run all three checks in parallel: tool access, tool tier, user role + admin status
    Promise.all([
      db.ref('users/' + user.uid + '/tools/' + NL_TOOL_KEY).once('value'),
      db.ref('tools/' + NL_TOOL_KEY + '/tier').once('value'),
      db.ref('users/' + user.uid + '/role').once('value'),
      db.ref('admins/' + user.uid).once('value')
    ])
    .then(function(results) {
      var hasAccess = results[0].val() === true;
      var toolTier  = results[1].val() || 'staff'; // default to staff if not set
      var userRole  = results[2].val() || 'staff';
      var isAdmin   = results[3].val() === true;

      // Admins bypass everything
      if (isAdmin) { _guardPass(user); return; }

      // Check individual tool access
      if (!hasAccess) { _guardFail('denied'); return; }

      // Check tier — club users cannot access staff-tier tools
      if (toolTier === 'staff' && userRole === 'club') {
        _guardFail('tier'); return;
      }

      _guardPass(user);
    })
    .catch(function(err) {
      console.error('[NL Auth Guard] RTDB read failed:', err);
      _guardFail('error');
    });
  });

  // ── Pass ───────────────────────────────────────────────────────────────────
  function _guardPass(user) {
    var el = document.getElementById('nlAuthOverlay');
    if (el) el.parentNode.removeChild(el);
    if (typeof window.nlAuthReady === 'function') {
      window.nlAuthReady(user);
    } else {
      console.warn('[NL Auth Guard] window.nlAuthReady is not defined.');
    }
  }

  // ── Fail ───────────────────────────────────────────────────────────────────
  function _guardFail(reason) {
    if (reason === 'config') return;
    window.location.replace('/tools/portal/?guard=' + reason);
  }

})();
