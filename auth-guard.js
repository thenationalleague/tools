/*
 * auth-guard.js — NL Tools v2
 * Version: v3.1 (conversation turn 74)
 * Date: 02/04/2026
 *
 * Changelog:
 * v3.1 — Progressive loading messages. Reassurance at 3s and 8s.
 * v3.0 — Complete rewrite. sessionStorage-first architecture.
 *         Session written by portal on load. Tool pages read instantly.
 *         Falls back to Firebase Auth for direct access / bookmarks.
 *         Clean URLs always -- no tokens.
 *         Three access states: hidden (silent redirect), off (request card),
 *         access/admin (page loads).
 *         Future pages need only: var NL_TOOL_KEY + this script.
 * v2.2 — Promise.resolve() + currentUser check.
 * v2.1 — Timeout fallback for onAuthStateChanged.
 * v2.0 — Rebuilt for v2 string access model.
 * v1.0 — Initial build.
 *
 * ── Usage (two lines on every tool page) ────────────────────────────────────
 *
 *   <script>var NL_TOOL_KEY = 'ops-vacancies';</script>
 *   <script src="/tools/auth-guard.js"></script>
 *
 *   Wrap page content in: <div id="pageWrap" style="display:none">
 *   Guard shows it when access confirmed.
 *
 *   Optional callback for when access is confirmed:
 *   window.nlAuthReady = function(userData) { ... }
 *
 * ── Session written by portal ────────────────────────────────────────────────
 *
 *   Portal calls nlSession.write(uid, userData) after loading user record.
 *   Session stored in sessionStorage under key 'nl_session'.
 *   Expires after 4 hours. Cleared on sign-out.
 *
 * ── Requirements ────────────────────────────────────────────────────────────
 *
 *   Firebase compat SDKs (app + auth + database) loaded before this script.
 *   NL_TOOL_KEY defined before this script.
 */

(function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────────────────────── */
  var SESSION_KEY  = 'nl_session';
  var SESSION_TTL  = 4 * 60 * 60 * 1000; /* 4 hours in ms */
  var PORTAL_URL   = '/tools/portal/';
  var LOGIN_URL    = '/tools/';
  var ROSE_URL     = 'https://raw.githubusercontent.com/thenationalleague/tools/refs/heads/main/assets/crests/National%20League%20rose%20white.png';

  /* ── Validate ──────────────────────────────────────────────────────────── */
  if (typeof NL_TOOL_KEY === 'undefined' || !NL_TOOL_KEY) {
    console.error('[auth-guard] NL_TOOL_KEY is not defined.');
    return;
  }

  /* ── Session helpers ───────────────────────────────────────────────────── */
  var nlSession = {
    write: function(uid, userData) {
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
          uid:      uid,
          name:     userData.name     || '',
          email:    userData.email    || '',
          role:     userData.role     || '',
          org:      userData.org      || '',
          orgKey:   userData.orgKey   || '',
          club:     userData.club     || '',
          clubRole: userData.clubRole || '',
          pending:  userData.pending  || false,
          tools:    userData.tools    || {},
          cachedAt: Date.now()
        }));
      } catch(e) {}
    },
    read: function() {
      try {
        var raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        var s = JSON.parse(raw);
        if (!s || !s.uid) return null;
        /* Expire after TTL */
        if (Date.now() - (s.cachedAt || 0) > SESSION_TTL) {
          sessionStorage.removeItem(SESSION_KEY);
          return null;
        }
        return s;
      } catch(e) { return null; }
    },
    clear: function() {
      try { sessionStorage.removeItem(SESSION_KEY); } catch(e) {}
    }
  };

  /* Expose so portal can write session */
  window.nlSession = nlSession;

  /* ── Loading overlay ────────────────────────────────────────────────────── */
  var styleEl = document.createElement('style');
  styleEl.textContent = [
    '@keyframes nlSpin{to{transform:rotate(360deg)}}',
    '@keyframes nlFade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}'
  ].join('');
  document.head.appendChild(styleEl);

  var overlay = document.createElement('div');
  overlay.id  = 'nlAuthOverlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'background:#9e0000',
    'display:flex', 'align-items:center', 'justify-content:center',
    'font-family:carbona-variable,Arial,sans-serif',
    'flex-direction:column', 'gap:0'
  ].join(';');

  /* Card */
  var card = document.createElement('div');
  card.style.cssText = [
    'background:rgba(0,0,0,0.15)',
    'border-radius:12px',
    'padding:32px 40px',
    'display:flex', 'flex-direction:column', 'align-items:center', 'gap:20px',
    'min-width:260px', 'text-align:center'
  ].join(';');

  /* NL Rose */
  var rose = document.createElement('img');
  rose.src = ROSE_URL;
  rose.style.cssText = 'height:44px;width:auto;opacity:0.9;';
  card.appendChild(rose);

  /* Spinner */
  var spinner = document.createElement('div');
  spinner.style.cssText = [
    'width:28px', 'height:28px',
    'border:2px solid rgba(255,255,255,0.3)',
    'border-top-color:#fff',
    'border-radius:50%',
    'animation:nlSpin 0.8s linear infinite',
    'flex-shrink:0'
  ].join(';');
  card.appendChild(spinner);

  /* Status text */
  var statusText = document.createElement('div');
  statusText.style.cssText = [
    'font-size:13px', 'font-weight:600',
    'color:rgba(255,255,255,0.9)',
    'letter-spacing:0.02em',
    'min-height:20px',
    'animation:nlFade 0.3s ease'
  ].join(';');
  statusText.textContent = 'Loading…';
  card.appendChild(statusText);

  /* Sub text */
  var subText = document.createElement('div');
  subText.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.55);margin-top:-12px;min-height:16px;';
  card.appendChild(subText);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  /* Progress messages */
  var _msgTimeout = null;
  function setStatus(msg, sub) {
    statusText.style.animation = 'none';
    void statusText.offsetWidth; /* reflow to restart animation */
    statusText.style.animation = 'nlFade 0.3s ease';
    statusText.textContent = msg;
    subText.textContent    = sub || '';
  }

  /* Reassurance message if things are taking a while */
  var _slowTimer = setTimeout(function() {
    setStatus('Still loading…', 'This can take a moment on first visit');
  }, 3000);

  var _verySlowTimer = setTimeout(function() {
    setStatus('Nearly there…', 'Waking up the server');
  }, 8000);

  function removeOverlay() {
    clearTimeout(_slowTimer);
    clearTimeout(_verySlowTimer);
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  /* ── Access check ──────────────────────────────────────────────────────── */
  function checkAccess(session, toolData) {
    if (session.pending) {
      window.location.replace(PORTAL_URL + '?guard=pending');
      return;
    }

    /* Superadmin: always granted */
    if (session.role === 'superadmin') {
      grantAccess(session);
      return;
    }

    var level = (session.tools && session.tools[NL_TOOL_KEY]) || 'hidden';

    /* Fallback to tool defaults if no explicit entry */
    if (!session.tools || !session.tools.hasOwnProperty(NL_TOOL_KEY)) {
      if (toolData && toolData.defaults) {
        var groupKey = session.role === 'club' ? 'club'
                     : ((session.orgKey || 'nl') + '-' + session.role);
        level = toolData.defaults[groupKey] || 'hidden';
      }
    }

    if (level === 'access' || level === 'admin') {
      grantAccess(session);
    } else if (level === 'off') {
      showDeniedCard(session, toolData);
    } else {
      /* hidden -- silent redirect */
      window.location.replace(PORTAL_URL);
    }
  }

  function grantAccess(session) {
    removeOverlay();
    var wrap = document.getElementById('pageWrap');
    if (wrap) wrap.style.display = 'block';
    if (typeof window.nlAuthReady === 'function') {
      window.nlAuthReady(session);
    }
  }

  /* ── Denied card ───────────────────────────────────────────────────────── */
  function showDeniedCard(session, toolData) {
    var label       = (toolData && toolData.label)       || NL_TOOL_KEY;
    var description = (toolData && toolData.description) || '';

    overlay.innerHTML  = '';
    overlay.style.cssText += ';padding:20px;';

    var card = document.createElement('div');
    card.style.cssText = [
      'background:#fff', 'border-radius:12px',
      'padding:40px 36px', 'max-width:420px', 'width:100%',
      'text-align:center', 'box-shadow:0 8px 40px rgba(0,0,0,0.25)'
    ].join(';');

    var rose = document.createElement('img');
    rose.src = ROSE_URL;
    rose.style.cssText = 'height:56px;width:auto;margin:0 auto 24px;display:block;';
    card.appendChild(rose);

    var heading = document.createElement('div');
    heading.style.cssText = 'font-size:20px;font-weight:900;color:#1a2a44;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:8px;';
    heading.textContent = label;
    card.appendChild(heading);

    if (description) {
      var desc = document.createElement('div');
      desc.style.cssText = 'font-size:14px;color:#5a6a82;line-height:1.6;margin-bottom:20px;';
      desc.textContent = description;
      card.appendChild(desc);
    }

    var divider = document.createElement('div');
    divider.style.cssText = 'height:1px;background:#dde3ed;margin:0 0 20px;';
    card.appendChild(divider);

    var msg = document.createElement('div');
    msg.style.cssText = 'font-size:14px;color:#1a2a44;line-height:1.6;margin-bottom:24px;';
    msg.textContent = 'You don\u2019t currently have access to this tool. Request access below and the National League team will review your request.';
    card.appendChild(msg);

    var statusMsg = document.createElement('div');
    statusMsg.style.cssText = 'font-size:13px;margin-bottom:16px;display:none;';
    card.appendChild(statusMsg);

    var reqBtn = document.createElement('button');
    reqBtn.style.cssText = 'display:block;width:100%;padding:14px 24px;background:#9e0000;color:#fff;border:none;border-radius:8px;font-family:inherit;font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:0.08em;cursor:pointer;margin-bottom:12px;';
    reqBtn.textContent = 'Request access';

    reqBtn.addEventListener('click', function() {
      reqBtn.disabled    = true;
      reqBtn.textContent = 'Sending\u2026';

      var db = firebase.database();
      db.ref('tool-requests').push({
        uid:       session.uid,
        name:      session.name,
        email:     session.email,
        role:      session.role,
        org:       session.org,
        club:      session.club,
        toolKey:   NL_TOOL_KEY,
        toolLabel: label,
        at:        new Date().toISOString(),
        status:    'pending'
      }).then(function() {
        statusMsg.style.display = 'block';
        statusMsg.style.color   = '#1e7e34';
        statusMsg.textContent   = 'Request sent \u2014 the NL team will be in touch.';
        reqBtn.style.display    = 'none';
      }).catch(function() {
        statusMsg.style.display = 'block';
        statusMsg.style.color   = '#9e0000';
        statusMsg.textContent   = 'Could not send request. Please contact the National League directly.';
        reqBtn.disabled    = false;
        reqBtn.textContent = 'Request access';
      });
    });

    card.appendChild(reqBtn);

    var backLink = document.createElement('a');
    backLink.href = PORTAL_URL;
    backLink.style.cssText = 'font-size:12px;color:#5a6a82;text-decoration:none;display:block;';
    backLink.textContent = '\u2190 Back to portal';
    card.appendChild(backLink);

    overlay.appendChild(card);
  }

  /* ── Main flow ─────────────────────────────────────────────────────────── */
  function run() {
    /* 1. Try sessionStorage first -- instant, no network call */
    var session = nlSession.read();

    if (session) {
      /* Session found -- get tool data from RTDB (lightweight, just one node) */
      /* then check access. Tool data needed for denied card label/description */
      firebase.database().ref('tools/' + NL_TOOL_KEY).once('value')
        .then(function(snap) {
          var toolData = snap.exists() ? snap.val() : null;
          checkAccess(session, toolData);
        })
        .catch(function() {
          /* RTDB failed -- check access without tool data */
          checkAccess(session, null);
        });
      return;
    }

    /* 2. No session -- use Firebase Auth (direct access / bookmark) */
    var auth = firebase.auth();
    var db   = firebase.database();

    setStatus('Signing you in…');
    auth.onAuthStateChanged(function(user) {
      if (!user) {
        window.location.replace(LOGIN_URL);
        return;
      }

      setStatus('Loading your profile…');
      /* Load user record + tool data in parallel */
      Promise.all([
        db.ref('users/' + user.uid).once('value'),
        db.ref('tools/' + NL_TOOL_KEY).once('value')
      ]).then(function(snaps) {
        if (!snaps[0].exists()) {
          window.location.replace(PORTAL_URL + '?guard=error');
          return;
        }
        var userData = snaps[0].val();
        var toolData = snaps[1].exists() ? snaps[1].val() : null;

        /* Write session for subsequent page loads */
        nlSession.write(user.uid, userData);

        checkAccess(nlSession.read(), toolData);
      }).catch(function() {
        window.location.replace(PORTAL_URL + '?guard=error');
      });
    });
  }

  run();

})();
