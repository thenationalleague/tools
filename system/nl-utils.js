/* =========================================================================
   NL Tools — Shared utilities
   File: /tools/system/nl-utils.js
   Version: v1.1 (17/04/2026)

   Shared helper functions used by every tool page. Exposed on window.NL
   namespace. All functions are defensive — they handle missing arguments
   gracefully and never throw in normal use.

   Usage:
     NL.toast('Saved', 'success');
     NL.formatDate('2026-04-17');    // → '17 April 2026'
     NL.ensureAuth().then(function(user) { ... });
     NL.escHtml('<script>');          // → '&lt;script&gt;'

   Changelog
   v1.0 (17/04/2026)
     - Initial centralised utilities. Extracted from duplicated code
       across all tool pages.
   ========================================================================= */

(function() {
  'use strict';

  window.NL = window.NL || {};

  /* ── Toast notification ──────────────────────────────────────────────── */
  var toastTimeout = null;
  var toastEl = null;

  window.NL.toast = function(message, type) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      document.body.appendChild(toastEl);
    }
    var kind = type || 'success';
    toastEl.className = 'toast toast--' + kind + ' show';
    toastEl.textContent = message || '';
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(function() {
      toastEl.classList.remove('show');
    }, 3500);
  };

  /* ── Auth helper: wait for Firebase Auth to resolve before reading/writing ── */
  /* Auth-guard may fire nlAuthReady with a cached session before Firebase
     Auth has actually restored the live user. Any RTDB operation that needs
     a real auth token must wrap in ensureAuth(). */
  window.NL.ensureAuth = function() {
    return new Promise(function(resolve, reject) {
      if (!window.firebase || !firebase.auth) {
        reject(new Error('Firebase Auth not loaded'));
        return;
      }
      var user = firebase.auth().currentUser;
      if (user) { resolve(user); return; }
      var unsub = firebase.auth().onAuthStateChanged(function(u) {
        unsub();
        if (u) resolve(u);
        else reject(new Error('Not authenticated'));
      });
    });
  };

  /* ── Date helpers ────────────────────────────────────────────────────── */
  /* Accepts multiple formats:
     - ISO: "2026-04-17" or "2026-04-17T09:30"
     - UK with time: "17/04/2026 09:30" or "17/04/2026 09:30:00"
     - UK date only: "17/04/2026"
  */
  window.NL.parseDate = function(str) {
    if (!str) return null;
    str = String(str).trim();
    if (!str) return null;

    var d;

    /* UK format: DD/MM/YYYY with optional HH:MM[:SS] */
    var ukMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (ukMatch) {
      d = new Date(
        parseInt(ukMatch[3], 10),
        parseInt(ukMatch[2], 10) - 1,
        parseInt(ukMatch[1], 10),
        parseInt(ukMatch[4] || 0, 10),
        parseInt(ukMatch[5] || 0, 10),
        parseInt(ukMatch[6] || 0, 10)
      );
      return isNaN(d.getTime()) ? null : d;
    }

    /* ISO format: YYYY-MM-DD with optional THH:MM[:SS] */
    var isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (isoMatch) {
      d = new Date(
        parseInt(isoMatch[1], 10),
        parseInt(isoMatch[2], 10) - 1,
        parseInt(isoMatch[3], 10),
        parseInt(isoMatch[4] || 0, 10),
        parseInt(isoMatch[5] || 0, 10),
        parseInt(isoMatch[6] || 0, 10)
      );
      return isNaN(d.getTime()) ? null : d;
    }

    /* Fallback: let JS Date try */
    d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  };

  var MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  window.NL.formatDate = function(str) {
    var d = window.NL.parseDate(str);
    if (!d) return '—';
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  };

  /* Short format, e.g. '17 Apr 2026' */
  window.NL.formatDateShort = function(str) {
    var d = window.NL.parseDate(str);
    if (!d) return '—';
    return d.getDate() + ' ' + MONTHS[d.getMonth()].substring(0, 3) + ' ' + d.getFullYear();
  };

  /* ── HTML escape ─────────────────────────────────────────────────────── */
  window.NL.escHtml = function(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  /* JS string escape (for embedding in single-quoted inline handlers) */
  window.NL.escJ = function(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'");
  };

  /* ── Session helper ──────────────────────────────────────────────────── */
  /* Set by auth-guard so tool pages can access session without duplication */
  window.NL.session = null;

  /* ── Audit log helpers ───────────────────────────────────────────────── */
  window.NL.writeAudit = function(action, detail) {
    if (!window.firebase || !firebase.database) return;
    if (!window.NL.session) return;
    var entry = {
      action: action || '',
      detail: detail || '',
      uid: window.NL.session.uid,
      name: window.NL.session.name || '',
      email: window.NL.session.email || '',
      ts: Date.now()
    };
    var key = String(Date.now()) + '_' + Math.random().toString(36).slice(2, 8);
    var updates = {};
    updates['admin/audit/' + key] = entry;
    updates['admin/audit-by-user/' + window.NL.session.uid + '/' + key] = entry;
    firebase.database().ref().update(updates).catch(function() {});
  };

})();
