/* =========================================================================
   NL Tools — Topbar renderer
   File: /tools/system/nl-topbar.js
   Version: v1.4 (25/04/2026)

   Renders the standardised NL Tools topbar into #nlTopbar slot. Reads
   session from window.NL_SESSION (set by auth-guard) and tool catalogue
   from /tools/{key} in RTDB.

   Usage on every tool page:
   ----
   <div id="nlTopbar"></div>

   <script>
     window.NL_TOOL = {
       title: 'Vacancies',           // required — tool name shown in topbar
       toolKey: 'ops-vacancies',     // required — matches /tools/{key} in RTDB
       kicker: 'NL Tools',           // optional — defaults to 'NL Tools'. Use '' on portal
       isPortal: false,              // optional — hides Portal button if true
       extras: {                     // optional — tool-specific topbar elements
         left: null,                 // HTML string inserted left of logo (e.g. menu toggle)
         right: null,                // HTML string inserted before profile (e.g. settings gear)
         middle: null               // HTML string inserted between title and profile
       }
     };
   </script>
   ----

   The topbar auto-renders when auth-guard fires nlAuthReady(session).
   Call window.NL.renderTopbar() manually if needed (e.g. portal dashboard
   which doesn't use auth-guard directly).

   Changelog
   v1.4 (25/04/2026)
     - Logo now a link to /tools/portal/ on all pages (acts as home button).
     - Removed arrow (←) from Portal button — just shows "Portal" text.

   v1.3 (21/04/2026)
     - Added "Install as app" item in profile dropdown. Captures Android Chrome's
       beforeinstallprompt event and fires the native install dialog on click.
       Hidden by default; revealed when browser confirms site is installable.
       Also hidden if app is already installed (display-mode: standalone).
     - Gracefully no-ops on iOS Safari and Firefox (no beforeinstallprompt support).

   v1.2 (17/04/2026)
     - Added "What's new" changelog feature. Tool pages declare
       window.NL_CHANGELOG = [{date, version, items: []}] and the most recent
       version appears as a clickable badge next to the title. Click opens a
       modal with full user-friendly release notes. Unread versions show a
       green dot (tracked per-tool via localStorage).
     - Removed kicker from default visible topbar (version badge replaces it).
       kicker still supported if set explicitly (legacy fallback).

   v1.1 (17/04/2026)
     - Sign-out now calls NL.writeAudit and nlSession.clear before firebase signOut.

   v1.0 (17/04/2026)
     - Initial centralised topbar component.
   ========================================================================= */

(function() {

  /* ── PWA install prompt capture ──────────────────────────────────────────
     Android Chrome fires beforeinstallprompt when site is installable.
     We capture it to trigger the native install dialog from our own UI
     (the "Install as app" item in the profile dropdown). */
  var deferredInstallPrompt = null;
  var isAppInstalled = false;

  if (typeof window !== 'undefined') {
    /* Detect if already running as installed PWA */
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
      isAppInstalled = true;
    }
    if (window.navigator && window.navigator.standalone === true) {
      isAppInstalled = true; /* iOS Safari detection */
    }

    window.addEventListener('beforeinstallprompt', function(e) {
      e.preventDefault();
      deferredInstallPrompt = e;
      /* Update any open dropdown to show the item */
      var installItems = document.querySelectorAll('.topbar__dd-item--install');
      installItems.forEach(function(el) { el.style.display = ''; });
    });

    window.addEventListener('appinstalled', function() {
      isAppInstalled = true;
      deferredInstallPrompt = null;
      var installItems = document.querySelectorAll('.topbar__dd-item--install');
      installItems.forEach(function(el) { el.style.display = 'none'; });
    });
  }

  'use strict';

  /* ── Namespace ───────────────────────────────────────────────────────── */
  window.NL = window.NL || {};

  var CREST_BASE = 'https://raw.githubusercontent.com/thenationalleague/tools/refs/heads/main/assets/crests/';
  var LOGO_URL = CREST_BASE + 'National%20League%20rose%20white.png';
  var LOGO_FALLBACK = CREST_BASE + 'National%20League%20rose.png';

  /* Role labels for the pill */
  var ROLE_LABELS = {
    superadmin: 'Superadmin',
    admin:      'Admin',
    staff:      'Staff',
    club:       'Club'
  };

  /* ── Public API ──────────────────────────────────────────────────────── */

  /**
   * Render the topbar into #nlTopbar slot.
   * Called automatically by auth-guard after auth resolves.
   * Safe to call multiple times (will replace existing topbar).
   */
  window.NL.renderTopbar = function(session) {
    var mount = document.getElementById('nlTopbar');
    if (!mount) {
      console.warn('[nl-topbar] No #nlTopbar slot found on page');
      return;
    }

    var cfg = window.NL_TOOL || {};
    var title = cfg.title || 'NL Tools';
    var kicker = (cfg.kicker === undefined) ? 'NL Tools' : cfg.kicker;
    var isPortal = !!cfg.isPortal;
    var extras = cfg.extras || {};

    mount.innerHTML = '';
    mount.appendChild(buildTopbar(session, {
      title: title,
      kicker: kicker,
      isPortal: isPortal,
      extras: extras,
      currentToolKey: cfg.toolKey || null
    }));

    /* Load tool catalogue for dropdown (async, non-blocking) */
    if (session && session.uid) loadToolCatalogue(session);
  };

  /* ── Topbar builder ──────────────────────────────────────────────────── */
  function buildTopbar(session, opts) {
    var header = el('header', { class: 'topbar' });

    /* Extras: left (e.g. menu toggle) */
    if (opts.extras.left) {
      var leftWrap = document.createElement('span');
      leftWrap.innerHTML = opts.extras.left;
      while (leftWrap.firstChild) header.appendChild(leftWrap.firstChild);
    }

    /* Logo — links to portal (home) on all pages */
    var logoLink = el('a', {
      class: 'topbar__logo-link',
      href: '/tools/portal/',
      'aria-label': 'NL Tools home',
      title: 'Go to portal'
    });
    var logo = el('img', {
      class: 'topbar__logo',
      src: LOGO_URL,
      alt: 'National League'
    });
    logo.onerror = function() { this.onerror = null; this.src = LOGO_FALLBACK; };
    logoLink.appendChild(logo);
    header.appendChild(logoLink);

    /* Title + (clickable version badge if NL_CHANGELOG is declared) */
    var titleWrap = el('div', { class: 'topbar__title-wrap' });
    var titleRow  = el('div', { class: 'topbar__title-row' });
    titleRow.appendChild(el('span', { class: 'topbar__title', text: opts.title }));

    /* Version badge — clickable, opens What's new modal */
    var changelog = window.NL_CHANGELOG;
    if (changelog && changelog.length && changelog[0].version) {
      var versionBtn = el('button', {
        class: 'topbar__version',
        type:  'button',
        'aria-label': "What's new in " + changelog[0].version,
        title: "What's new"
      });
      versionBtn.textContent = changelog[0].version;
      /* Unread dot if this version hasn't been seen */
      var seenKey = 'nl_changelog_seen:' + (opts.toolKey || 'portal');
      try {
        var seen = localStorage.getItem(seenKey);
        if (seen !== changelog[0].version) {
          var dot = el('span', { class: 'topbar__version-dot', 'aria-label': 'New' });
          versionBtn.appendChild(dot);
        }
      } catch(e) { /* localStorage may be blocked */ }
      versionBtn.addEventListener('click', function() {
        openChangelogModal(changelog, opts.toolKey, opts.title);
        try { localStorage.setItem(seenKey, changelog[0].version); } catch(e) {}
        var existingDot = versionBtn.querySelector('.topbar__version-dot');
        if (existingDot) existingDot.remove();
      });
      titleRow.appendChild(versionBtn);
    }
    titleWrap.appendChild(titleRow);

    if (opts.kicker) {
      titleWrap.appendChild(el('span', { class: 'topbar__kicker', text: opts.kicker }));
    }
    header.appendChild(titleWrap);

    /* Extras: middle */
    if (opts.extras.middle) {
      var midWrap = document.createElement('span');
      midWrap.innerHTML = opts.extras.middle;
      while (midWrap.firstChild) header.appendChild(midWrap.firstChild);
    }

    /* Portal button (tool pages only) */
    if (!opts.isPortal) {
      var portalBtn = el('a', {
        class: 'topbar__btn topbar__btn--portal',
        href: '/tools/portal/',
        'aria-label': 'Back to portal'
      });
      portalBtn.textContent = 'Portal';
      header.appendChild(portalBtn);
    }

    /* Extras: right (e.g. settings gear) */
    if (opts.extras.right) {
      var rightWrap = document.createElement('span');
      rightWrap.innerHTML = opts.extras.right;
      while (rightWrap.firstChild) header.appendChild(rightWrap.firstChild);
    }

    /* Profile avatar + dropdown */
    var profile = buildProfile(session, opts);
    header.appendChild(profile);

    return header;
  }

  /* ── Profile (avatar + dropdown) ─────────────────────────────────────── */
  function buildProfile(session, opts) {
    var profileWrap = el('div', { class: 'topbar__profile' });

    /* Avatar */
    var isClub = !!(session && session.club && session.club.trim());
    var avatar = buildAvatar(session, isClub);
    profileWrap.appendChild(avatar);

    /* Dropdown (initially hidden) */
    var dropdown = buildDropdown(session, isClub, opts);
    profileWrap.appendChild(dropdown);

    /* Toggle on click */
    avatar.addEventListener('click', function(e) {
      e.stopPropagation();
      dropdown.classList.toggle('is-open');
    });

    /* Close on outside click */
    document.addEventListener('click', function(e) {
      if (!profileWrap.contains(e.target)) dropdown.classList.remove('is-open');
    });

    /* Close on Escape */
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') dropdown.classList.remove('is-open');
    });

    return profileWrap;
  }

  function buildAvatar(session, isClub) {
    if (isClub) {
      var avatar = el('button', {
        class: 'topbar__avatar topbar__avatar--club',
        'aria-label': 'Open profile menu'
      });
      var img = el('img', {
        src: CREST_BASE + encodeURIComponent(session.club) + '.png',
        alt: session.club
      });
      img.onerror = function() {
        this.onerror = null;
        /* Fallback to initials */
        this.parentElement.className = 'topbar__avatar topbar__avatar--staff topbar__avatar--staff-2';
        this.parentElement.textContent = initials(session.club || session.name || '?');
      };
      avatar.appendChild(img);
      return avatar;
    } else {
      var inits = initials(session && session.name || session && session.email || '?');
      var sizeClass = 'topbar__avatar--staff-' + Math.min(inits.length, 4);
      return el('button', {
        class: 'topbar__avatar topbar__avatar--staff ' + sizeClass,
        'aria-label': 'Open profile menu',
        text: inits
      });
    }
  }

  function buildDropdown(session, isClub, opts) {
    var dd = el('div', { class: 'topbar__dropdown' });

    /* Header: name + email + role pill */
    var head = el('div', { class: 'topbar__dd-head' });
    head.appendChild(el('div', {
      class: 'topbar__dd-name',
      text: (session && session.name) || (session && session.email) || 'Unknown user'
    }));
    if (session && session.email) {
      head.appendChild(el('div', { class: 'topbar__dd-email', text: session.email }));
    }
    head.appendChild(buildRolePill(session, isClub));
    dd.appendChild(head);

    /* Tools section — populated async by loadToolCatalogue */
    dd.appendChild(el('div', { class: 'topbar__dd-section', text: 'Your tools' }));
    dd.appendChild(el('div', { id: 'nlDdTools', html: '<div class="topbar__dd-item" style="color:var(--text-muted);">Loading\u2026</div>' }));

    /* Admin Panel shortcut (superadmin/admin only, not on portal) */
    if (!opts.isPortal && session && (session.role === 'superadmin' || session.role === 'admin')) {
      dd.appendChild(el('div', { class: 'topbar__dd-divider' }));
      var adminBtn = el('a', {
        class: 'topbar__dd-item',
        href: '/tools/portal/?tab=users'
      });
      adminBtn.innerHTML =
        '<span class="topbar__dd-item-icon">\ud83d\udee1\ufe0f</span>' +
        '<span class="topbar__dd-item-label">Admin panel</span>';
      dd.appendChild(adminBtn);
    }

    /* Install as app — shown only if browser fired beforeinstallprompt and app
       not already installed. Hidden by default (style.display='none') and
       revealed by the event listener when the prompt becomes available. */
    var installBtn = el('button', { class: 'topbar__dd-item topbar__dd-item--install' });
    installBtn.innerHTML =
      '<span class="topbar__dd-item-icon">⬇️</span>' +
      '<span class="topbar__dd-item-label">Install as app</span>';
    installBtn.style.display = (deferredInstallPrompt && !isAppInstalled) ? '' : 'none';
    installBtn.addEventListener('click', function() {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then(function(result) {
        /* result.outcome: 'accepted' or 'dismissed' */
        deferredInstallPrompt = null;
        installBtn.style.display = 'none';
      }).catch(function() {
        deferredInstallPrompt = null;
        installBtn.style.display = 'none';
      });
    });
    dd.appendChild(installBtn);

    /* Sign out */
    dd.appendChild(el('div', { class: 'topbar__dd-divider' }));
    var signOut = el('button', { class: 'topbar__dd-item topbar__dd-item--danger' });
    signOut.innerHTML =
      '<span class="topbar__dd-item-icon">\u21aa</span>' +
      '<span class="topbar__dd-item-label">Sign out</span>';
    signOut.addEventListener('click', function() {
      /* Before sign-out: write audit entry (needs auth to succeed) and clear session cache */
      try {
        if (window.NL && window.NL.writeAudit) {
          window.NL.writeAudit('signed_out', 'Signed out');
        }
      } catch(e) {}
      try {
        if (window.nlSession && window.nlSession.clear) {
          window.nlSession.clear();
        }
      } catch(e) {}
      /* Allow audit write to fire, then sign out */
      setTimeout(function() {
        if (window.firebase && firebase.auth) {
          firebase.auth().signOut().then(function() {
            window.location.replace('/tools/');
          });
        } else {
          window.location.replace('/tools/');
        }
      }, 50);
    });
    dd.appendChild(signOut);

    return dd;
  }

  function buildRolePill(session, isClub) {
    if (isClub) {
      var pill = el('span', { class: 'topbar__dd-role topbar__dd-role--club' });
      var img = el('img', {
        src: CREST_BASE + encodeURIComponent(session.club) + '.png',
        alt: ''
      });
      img.onerror = function() { this.onerror = null; this.style.display = 'none'; };
      pill.appendChild(img);
      pill.appendChild(document.createTextNode(session.club));
      return pill;
    }
    var role = (session && session.role) || 'staff';
    return el('span', {
      class: 'topbar__dd-role topbar__dd-role--' + role,
      text: ROLE_LABELS[role] || role
    });
  }

  /* ── Tool catalogue — populate dropdown tools list ───────────────────── */
  function loadToolCatalogue(session) {
    if (!window.firebase || !firebase.database) return;

    firebase.database().ref('tools').once('value').then(function(snap) {
      var tools = snap.val() || {};
      renderToolsList(tools, session);
    }).catch(function(err) {
      console.warn('[nl-topbar] Could not load tools:', err.message);
      var slot = document.getElementById('nlDdTools');
      if (slot) slot.innerHTML = '';
    });
  }

  function renderToolsList(tools, session) {
    var slot = document.getElementById('nlDdTools');
    if (!slot) return;

    var userTools = (session && session.tools) || {};
    var currentKey = (window.NL_TOOL && window.NL_TOOL.toolKey) || null;
    var isPortal = !!(window.NL_TOOL && window.NL_TOOL.isPortal);

    /* Filter tools user has access to */
    var visible = [];
    Object.keys(tools).forEach(function(key) {
      var t = tools[key];
      if (!t || t.placeholder) return;

      var access = userTools[key];
      var hasAccess = false;
      var isAdmin = false;

      if (typeof access === 'object' && access !== null) {
        hasAccess = !!access.access;
        isAdmin = !!access.admin;
      } else if (typeof access === 'string') {
        hasAccess = access === 'access' || access === 'admin';
        isAdmin = access === 'admin';
      }
      /* Superadmin sees everything */
      if (session && session.role === 'superadmin') {
        hasAccess = true;
        isAdmin = true;
      }
      if (!hasAccess) return;

      visible.push({ key: key, tool: t, isAdmin: isAdmin });
    });

    /* Sort by catalogue order (if present), then label */
    visible.sort(function(a, b) {
      var oa = (a.tool.order != null) ? a.tool.order : 999;
      var ob = (b.tool.order != null) ? b.tool.order : 999;
      if (oa !== ob) return oa - ob;
      return (a.tool.label || a.key).localeCompare(b.tool.label || b.key);
    });

    slot.innerHTML = '';

    if (visible.length === 0) {
      slot.innerHTML = '<div class="topbar__dd-item" style="color:var(--text-muted);">No tools available</div>';
      return;
    }

    visible.forEach(function(item) {
      var t = item.tool;
      var isCurrent = (item.key === currentKey) && !isPortal;
      var a = document.createElement(isCurrent ? 'div' : 'a');
      a.className = 'topbar__dd-item';
      if (isCurrent) {
        a.classList.add('topbar__dd-item--active');
      } else {
        a.href = t.url || ('/tools/' + item.key + '/');
      }

      var icon = document.createElement('span');
      icon.className = 'topbar__dd-item-icon';
      icon.textContent = t.icon || '\u25a1';

      var label = document.createElement('span');
      label.className = 'topbar__dd-item-label';
      label.textContent = t.label || item.key;

      a.appendChild(icon);
      a.appendChild(label);

      if (item.isAdmin && !isCurrent) {
        var badge = document.createElement('span');
        badge.className = 'topbar__dd-item-badge';
        badge.textContent = 'Admin';
        a.appendChild(badge);
      }

      slot.appendChild(a);
    });
  }

  /* ── Utilities ───────────────────────────────────────────────────────── */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (!attrs) return node;
    Object.keys(attrs).forEach(function(k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    return node;
  }

  function initials(str) {
    if (!str) return '?';
    var parts = String(str).trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    /* Up to 4 initials — first letter of each word */
    return parts.slice(0, 4).map(function(p) { return p.charAt(0); }).join('').toUpperCase();
  }


  /* ── Changelog modal ──────────────────────────────────────────────────── */
  function openChangelogModal(changelog, toolKey, toolTitle) {
    /* Remove any existing modal first */
    var existing = document.getElementById('nlChangelogBackdrop');
    if (existing) existing.remove();

    var backdrop = el('div', { id: 'nlChangelogBackdrop', class: 'nl-changelog-backdrop' });
    var modal    = el('div', { class: 'nl-changelog-modal' });

    var head = el('div', { class: 'nl-changelog-modal__head' });
    head.appendChild(el('h3', { text: "What's new" + (toolTitle ? ' in ' + toolTitle : '') }));
    var closeBtn = el('button', {
      class: 'nl-changelog-modal__close',
      type: 'button',
      'aria-label': 'Close'
    });
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', function() { backdrop.remove(); });
    head.appendChild(closeBtn);
    modal.appendChild(head);

    var body = el('div', { class: 'nl-changelog-modal__body' });
    if (!changelog.length) {
      body.appendChild(el('p', { text: 'No updates yet.' }));
    } else {
      changelog.forEach(function(entry) {
        var entryEl = el('div', { class: 'nl-changelog-entry' });
        var meta    = el('div', { class: 'nl-changelog-entry__meta' });
        if (entry.date) meta.appendChild(el('span', { class: 'nl-changelog-entry__date', text: entry.date }));
        if (entry.version) {
          meta.appendChild(el('span', { class: 'nl-changelog-entry__sep', text: '·' }));
          meta.appendChild(el('span', { class: 'nl-changelog-entry__version', text: entry.version }));
        }
        entryEl.appendChild(meta);
        if (entry.items && entry.items.length) {
          var ul = el('ul', { class: 'nl-changelog-entry__list' });
          entry.items.forEach(function(item) {
            ul.appendChild(el('li', { text: item }));
          });
          entryEl.appendChild(ul);
        } else if (entry.note) {
          entryEl.appendChild(el('p', { class: 'nl-changelog-entry__note', text: entry.note }));
        }
        body.appendChild(entryEl);
      });
    }
    modal.appendChild(body);

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    /* Click backdrop to close */
    backdrop.addEventListener('click', function(e) {
      if (e.target === backdrop) backdrop.remove();
    });
    /* Esc to close */
    var escHandler = function(e) {
      if (e.key === 'Escape') {
        backdrop.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  /* Inject changelog modal styles (one-shot) */
  if (!document.getElementById('nl-changelog-styles')) {
    var cs = document.createElement('style');
    cs.id = 'nl-changelog-styles';
    cs.textContent = [
      '.topbar__title-row{display:flex;align-items:center;gap:8px;}',
      '.topbar__version{position:relative;background:rgba(255,255,255,0.15);color:rgba(255,255,255,0.9);border:1px solid rgba(255,255,255,0.2);padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;font-family:var(--font);cursor:pointer;transition:all 0.15s;white-space:nowrap;letter-spacing:0.04em;}',
      '.topbar__version:hover{background:rgba(255,255,255,0.25);border-color:rgba(255,255,255,0.35);}',
      '.topbar__logo-link{display:flex;align-items:center;flex-shrink:0;opacity:0.92;transition:opacity 0.15s;}',
      '.topbar__logo-link:hover{opacity:1;}',
      '.topbar__version-dot{position:absolute;top:-3px;right:-3px;width:8px;height:8px;border-radius:50%;background:#4ade80;border:1.5px solid var(--primary);box-shadow:0 0 0 1px rgba(255,255,255,0.4);}',
      '.nl-changelog-backdrop{position:fixed;inset:0;background:rgba(10,22,40,0.65);z-index:300;display:flex;align-items:flex-start;justify-content:center;padding:60px 16px;overflow-y:auto;animation:nlFade 0.15s ease-out;}',
      '.nl-changelog-modal{background:var(--white);border-radius:10px;width:100%;max-width:560px;box-shadow:0 16px 60px rgba(0,0,0,0.3);overflow:hidden;margin:auto;animation:nlFade 0.2s ease-out;}',
      '.nl-changelog-modal__head{background:var(--primary);color:var(--white);padding:16px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:7px solid var(--navy);}',
      '.nl-changelog-modal__head h3{color:var(--white);font-size:14px;font-weight:900;font-variation-settings:\'wght\' 900;text-transform:uppercase;letter-spacing:0.1em;margin:0;}',
      '.nl-changelog-modal__close{background:none;border:none;color:rgba(255,255,255,0.6);font-size:26px;cursor:pointer;line-height:1;padding:2px 8px;font-family:var(--font);}',
      '.nl-changelog-modal__close:hover{color:var(--white);}',
      '.nl-changelog-modal__body{padding:24px;max-height:65vh;overflow-y:auto;}',
      '.nl-changelog-entry{padding:16px 0;border-bottom:1px solid var(--border);}',
      '.nl-changelog-entry:first-child{padding-top:0;}',
      '.nl-changelog-entry:last-child{border-bottom:none;padding-bottom:0;}',
      '.nl-changelog-entry__meta{display:flex;gap:8px;margin-bottom:10px;align-items:center;}',
      '.nl-changelog-entry__date{font-size:12px;font-weight:900;font-variation-settings:\'wght\' 900;color:var(--navy);text-transform:uppercase;letter-spacing:0.08em;}',
      '.nl-changelog-entry__sep{color:var(--text-muted);font-size:12px;}',
      '.nl-changelog-entry__version{font-size:11px;color:var(--text-muted);font-weight:600;background:var(--off-white);border:1px solid var(--border);padding:1px 7px;border-radius:10px;}',
      '.nl-changelog-entry__list{margin:0;padding-left:20px;}',
      '.nl-changelog-entry__list li{font-size:14px;line-height:1.6;color:var(--text);margin-bottom:6px;}',
      '.nl-changelog-entry__list li:last-child{margin-bottom:0;}',
      '.nl-changelog-entry__note{font-size:14px;line-height:1.6;color:var(--text);}'
    ].join('\n');
    document.head.appendChild(cs);
  }

})();
