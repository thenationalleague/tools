/*
  NL Tools — Auth Guard
  Version: v1.0
  Date: 30/03/2026
  Location: /tools/auth-guard.js

  Changelog:
  v1.0 (30/03/2026) — Initial build. Shared auth guard for all NL tool pages.
                       Checks Firebase Auth session, then verifies the current
                       user has access to the specific tool key defined on the
                       page. Redirects to /tools/ if unauthenticated, or to
                       /tools/portal/ with an error flag if access is denied.

  USAGE
  -----
  Include at the bottom of any protected tool page's <body>, BEFORE the
  page's own <script> block. Define the tool key on the page first:

    <script>
      var NL_TOOL_KEY = 'vacancies-admin'; // must match key in RTDB /tools
    </script>
    <script src="/tools/auth-guard.js"></script>

  The guard will:
  1. Show a full-screen spinner while Firebase resolves auth state
  2. Redirect to /tools/ if the user is not signed in
  3. Read users/{uid}/tools/{NL_TOOL_KEY} from RTDB
  4. Redirect to /tools/portal/?denied=1 if access is false or missing
  5. Call window.nlAuthReady(user) if access is confirmed — implement this
     function in the page's own script to initialise the tool

  REQUIREMENTS
  ------------
  - Firebase app-compat and auth-compat and database-compat CDN scripts
    must be loaded BEFORE this file
  - firebaseConfig must be initialised BEFORE this file
  - The page must define var NL_TOOL_KEY before loading this file
  - The page must implement window.nlAuthReady = function(user) { ... }

  FULL PAGE TEMPLATE
  ------------------

  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>Tool Name — NL Tools</title>
    <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js"></script>
  </head>
  <body>
    <!-- Your page content here — keep it hidden initially -->
    <div id="pageWrap" style="display:none;">
      ...
    </div>

    <script>
      // 1. Firebase config — must come before auth-guard.js
      var firebaseConfig = {
        apiKey:            "AIzaSyC3az3OMnU7TdqlaWp8yrO_EjgZ36l-mXU",
        authDomain:        "nl-tools.firebaseapp.com",
        databaseURL:       "https://nl-tools-default-rtdb.europe-west1.firebasedatabase.app",
        projectId:         "nl-tools",
        storageBucket:     "nl-tools.firebasestorage.app",
        messagingSenderId: "801354670005",
        appId:             "1:801354670005:web:05d8ebad3e7e63610d03fc"
      };
      firebase.initializeApp(firebaseConfig);

      // 2. Declare which tool this page is — must match RTDB /tools key
      var NL_TOOL_KEY = 'your-tool-key';

      // 3. Called by auth-guard.js once auth + access are confirmed
      window.nlAuthReady = function(user) {
        document.getElementById('pageWrap').style.display = 'block';
        // Initialise your tool here — user.uid and user.email are available
      };
    </script>
    <script src="/tools/auth-guard.js"></script>
  </body>
  </html>
*/

(function() {
  'use strict';

  // ── Inject loading overlay ─────────────────────────────────────────────────
  // Inserted into the page immediately so there's no flash of unguarded content
  // while Firebase resolves the auth state.
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
    + '"></div>'
    + '</div>'
    + '<style>@keyframes nlSpin{to{transform:rotate(360deg)}}</style>';
  document.body.appendChild(overlay);

  // ── Validate setup ─────────────────────────────────────────────────────────
  // Fail loudly in development if the page hasn't set NL_TOOL_KEY —
  // better to catch this early than silently pass the guard.
  if (typeof NL_TOOL_KEY === 'undefined' || !NL_TOOL_KEY) {
    console.error('[NL Auth Guard] NL_TOOL_KEY is not defined on this page. Set var NL_TOOL_KEY = "your-tool-key" before loading auth-guard.js');
    _guardFail('config');
    return;
  }

  if (typeof firebase === 'undefined') {
    console.error('[NL Auth Guard] Firebase is not loaded. Include Firebase CDN scripts before auth-guard.js');
    _guardFail('config');
    return;
  }

  var auth = firebase.auth();
  var db   = firebase.database();

  // ── Auth state check ───────────────────────────────────────────────────────
  auth.onAuthStateChanged(function(user) {
    if (!user) {
      // No session — send to login
      window.location.replace('/tools/');
      return;
    }

    // User is authenticated — now check tool-specific access
    db.ref('users/' + user.uid + '/tools/' + NL_TOOL_KEY)
      .once('value')
      .then(function(snap) {
        if (snap.val() !== true) {
          // Authenticated but not permitted for this tool
          _guardFail('denied');
          return;
        }
        // Access confirmed — remove overlay and hand off to page
        _guardPass(user);
      })
      .catch(function(err) {
        console.error('[NL Auth Guard] RTDB read failed:', err);
        _guardFail('error');
      });
  });

  // ── Pass: remove overlay, call page callback ───────────────────────────────
  function _guardPass(user) {
    var el = document.getElementById('nlAuthOverlay');
    if (el) el.parentNode.removeChild(el);

    if (typeof window.nlAuthReady === 'function') {
      window.nlAuthReady(user);
    } else {
      console.warn('[NL Auth Guard] window.nlAuthReady is not defined. Define it to initialise your tool after auth passes.');
    }
  }

  // ── Fail: redirect appropriately ──────────────────────────────────────────
  // 'denied' → portal with query flag so it can show a toast
  // 'error'  → portal with error flag
  // 'config' → stay on page, just log (misconfiguration during development)
  function _guardFail(reason) {
    if (reason === 'config') return; // dev error — don't redirect, let devs see the console
    var dest = '/tools/portal/?guard=' + reason;
    window.location.replace(dest);
  }

})();
