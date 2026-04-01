/*
 * auth-guard.js — NL Tools v2
 * Version: v2.0 (conversation turn 56)
 * Date: 01/04/2026
 *
 * Changelog:
 * v2.0 — Rebuilt for v2 string access model (hidden/off/access/admin).
 *         Three distinct access states:
 *           hidden → silent redirect to portal (user not meant to know it exists)
 *           off    → full-screen access denied card with Request Access button
 *           access/admin → granted, overlay removed, nlAuthReady called
 *         Denied card matches login page aesthetic (red bg, white card, NL rose).
 *         Tool name + description pulled from RTDB tools catalogue for denied card.
 *         Request Access posts to tool-requests queue (same as portal flow).
 *         Superadmin bypasses all checks.
 *         Pending users redirected to portal.
 *         Tool key naming follows dept-prefixed convention (e.g. ops-vacancies).
 * v1.0 — Initial v2 build. Reads users/{uid}/tools/{key}/access (boolean).
 *
 * Usage (include on every tool page AFTER Firebase SDK):
 *
 *   <script>
 *     var NL_TOOL_KEY = 'ops-vacancies'; // must match RTDB tools/{key}
 *     window.nlAuthReady = function(user, userData) {
 *       // Called when access confirmed. Show your page content here.
 *       document.getElementById('pageWrap').style.display = 'block';
 *     };
 *   </script>
 *   <script src="/tools/auth-guard.js"></script>
 *
 * NL_TOOL_KEY must match the key in RTDB tools/ node exactly.
 * window.nlAuthReady must be defined before this script is included.
 * Firebase compat CDN (app + auth + database) must be loaded before this script.
 */

(function () {
  'use strict';

  /* ── Validate required globals ─────────────────────────────────────────── */
  if (typeof NL_TOOL_KEY === 'undefined' || !NL_TOOL_KEY) {
    console.error('[auth-guard] NL_TOOL_KEY is not defined.');
    return;
  }
  if (typeof window.nlAuthReady !== 'function') {
    console.error('[auth-guard] window.nlAuthReady is not defined.');
    return;
  }

  /* ── Firebase ──────────────────────────────────────────────────────────── */
  var auth = firebase.auth();
  var db   = firebase.database();

  /* ── URLs ──────────────────────────────────────────────────────────────── */
  var PORTAL_URL   = '/tools/portal/';
  var LOGIN_URL    = '/tools/';
  var ROSE_URL     = 'https://raw.githubusercontent.com/thenationalleague/tools/refs/heads/main/assets/crests/National%20League%20rose%20white.png';

  /* ── Overlay (shown while checking) ───────────────────────────────────── */
  var styleEl = document.createElement('style');
  styleEl.textContent = [
    '@keyframes nlSpin{to{transform:rotate(360deg)}}',
    '@font-face{font-family:"carbona-variable";',
    'src:url("https://use.typekit.net/af/184cf2/0000000000000000774c3175/31/l?primer=7cdcb44be4a7db8877ffa5c0007b8dd865b3bbc383831fe2ea177f62257a9191&fvd=n4&v=3") format("woff2");',
    'font-display:swap;font-style:normal;font-weight:200 900;}'
  ].join('');
  document.head.appendChild(styleEl);

  var overlay = document.createElement('div');
  overlay.id = 'nlAuthOverlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'background:#9e0000',
    'display:flex', 'align-items:center', 'justify-content:center',
    'font-family:carbona-variable,Arial,sans-serif'
  ].join(';');

  /* Spinner (shown during check) */
  var spinner = document.createElement('div');
  spinner.style.cssText = [
    'width:36px', 'height:36px',
    'border:3px solid rgba(255,255,255,0.3)',
    'border-top-color:#fff',
    'border-radius:50%',
    'animation:nlSpin 0.7s linear infinite'
  ].join(';');
  overlay.appendChild(spinner);
  document.body.appendChild(overlay);

  function removeOverlay() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  /* ── Build the access-denied card ─────────────────────────────────────── */
  function showDeniedCard(toolData, userData, user) {
    var label       = (toolData && toolData.label)       || NL_TOOL_KEY;
    var description = (toolData && toolData.description) || '';

    /* Clear spinner, show card */
    overlay.innerHTML = '';
    overlay.style.cssText += ';padding:20px;';

    var card = document.createElement('div');
    card.style.cssText = [
      'background:#ffffff',
      'border-radius:12px',
      'padding:40px 36px',
      'max-width:420px',
      'width:100%',
      'text-align:center',
      'box-shadow:0 8px 40px rgba(0,0,0,0.25)'
    ].join(';');

    /* NL Rose */
    var rose = document.createElement('img');
    rose.src = ROSE_URL;
    rose.alt = 'National League';
    rose.style.cssText = 'height:56px;width:auto;margin-bottom:24px;display:block;margin-left:auto;margin-right:auto;';
    card.appendChild(rose);

    /* Heading */
    var heading = document.createElement('div');
    heading.style.cssText = [
      'font-size:20px',
      'font-weight:900',
      'font-variation-settings:"wght" 900',
      'color:#1a2a44',
      'text-transform:uppercase',
      'letter-spacing:0.03em',
      'margin-bottom:8px'
    ].join(';');
    heading.textContent = label;
    card.appendChild(heading);

    if (description) {
      var desc = document.createElement('div');
      desc.style.cssText = 'font-size:14px;color:#5a6a82;line-height:1.6;margin-bottom:24px;';
      desc.textContent = description;
      card.appendChild(desc);
    }

    /* Divider */
    var divider = document.createElement('div');
    divider.style.cssText = 'height:1px;background:#dde3ed;margin:0 0 24px;';
    card.appendChild(divider);

    /* Message */
    var msg = document.createElement('div');
    msg.style.cssText = 'font-size:14px;color:#1a2a44;line-height:1.6;margin-bottom:28px;';
    msg.textContent = "You don\u2019t currently have access to this tool. You can request access below and a member of the National League team will review your request.";
    card.appendChild(msg);

    /* Status message (shown after request sent) */
    var statusMsg = document.createElement('div');
    statusMsg.style.cssText = 'font-size:13px;margin-bottom:16px;display:none;';
    card.appendChild(statusMsg);

    /* Request Access button */
    var reqBtn = document.createElement('button');
    reqBtn.style.cssText = [
      'display:block', 'width:100%',
      'padding:14px 24px',
      'background:#9e0000',
      'color:#ffffff',
      'border:none',
      'border-radius:8px',
      'font-family:inherit',
      'font-size:13px',
      'font-weight:900',
      'font-variation-settings:"wght" 900',
      'text-transform:uppercase',
      'letter-spacing:0.08em',
      'cursor:pointer',
      'margin-bottom:12px',
      'transition:background 0.15s'
    ].join(';');
    reqBtn.textContent = 'Request access';
    reqBtn.onmouseover = function() { this.style.background = '#7a0000'; };
    reqBtn.onmouseout  = function() { this.style.background = '#9e0000'; };

    reqBtn.addEventListener('click', function() {
      reqBtn.disabled = true;
      reqBtn.textContent = 'Sending\u2026';

      var request = {
        uid:       user.uid,
        name:      (userData && userData.name)  || '',
        email:     (userData && userData.email) || user.email || '',
        role:      (userData && userData.role)  || '',
        org:       (userData && userData.org)   || '',
        club:      (userData && userData.club)  || '',
        toolKey:   NL_TOOL_KEY,
        toolLabel: label,
        at:        new Date().toISOString(),
        status:    'pending'
      };

      db.ref('tool-requests').push(request)
        .then(function() {
          statusMsg.style.display  = 'block';
          statusMsg.style.color    = '#1e7e34';
          statusMsg.textContent    = 'Request sent \u2014 the NL team will be in touch.';
          reqBtn.style.display     = 'none';
        })
        .catch(function() {
          statusMsg.style.display  = 'block';
          statusMsg.style.color    = '#9e0000';
          statusMsg.textContent    = 'Could not send request. Please contact the National League directly.';
          reqBtn.disabled = false;
          reqBtn.textContent = 'Request access';
        });
    });

    card.appendChild(reqBtn);

    /* Back to portal link */
    var backLink = document.createElement('a');
    backLink.href = PORTAL_URL;
    backLink.style.cssText = 'font-size:12px;color:#5a6a82;text-decoration:none;display:block;';
    backLink.textContent = '\u2190 Back to portal';
    card.appendChild(backLink);

    overlay.appendChild(card);
  }

  /* ── Main auth state handler ───────────────────────────────────────────── */
  auth.onAuthStateChanged(function(user) {

    if (!user) {
      window.location.replace(LOGIN_URL);
      return;
    }

    /* Fetch user record and tool catalogue entry in parallel */
    Promise.all([
      db.ref('users/' + user.uid).once('value'),
      db.ref('tools/' + NL_TOOL_KEY).once('value')
    ])
    .then(function(snaps) {
      var userSnap = snaps[0];
      var toolSnap = snaps[1];

      if (!userSnap.exists()) {
        window.location.replace(PORTAL_URL + '?guard=error');
        return;
      }

      var userData = userSnap.val();
      var toolData = toolSnap.exists() ? toolSnap.val() : null;
      var role     = userData.role || '';

      /* Superadmin: bypass everything */
      if (role === 'superadmin') {
        removeOverlay();
        window.nlAuthReady(user, userData);
        return;
      }

      /* Pending: send to portal */
      if (userData.pending === true) {
        window.location.replace(PORTAL_URL + '?guard=pending');
        return;
      }

      /* Read access level from v2 string model */
      var tools  = userData.tools || {};
      var level  = tools[NL_TOOL_KEY] || 'hidden';

      /* Fallback: if no explicit entry, read from tool defaults */
      if (!tools.hasOwnProperty(NL_TOOL_KEY) && toolData && toolData.defaults) {
        var groupKey = role === 'club' ? 'club'
                     : ((userData.orgKey || 'nl') + '-' + role);
        level = toolData.defaults[groupKey] || 'hidden';
      }

      if (level === 'access' || level === 'admin') {
        /* Granted */
        removeOverlay();
        window.nlAuthReady(user, userData);

      } else if (level === 'off') {
        /* Known but no access -- show request card */
        showDeniedCard(toolData, userData, user);

      } else {
        /* hidden -- silent redirect, no explanation */
        window.location.replace(PORTAL_URL);
      }
    })
    .catch(function(err) {
      console.error('[auth-guard] RTDB read failed:', err);
      window.location.replace(PORTAL_URL + '?guard=error');
    });

  });

})();
