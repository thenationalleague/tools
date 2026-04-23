/* =========================================================================
   NL Tools — Topbar renderer
   File: /tools/system/nl-topbar.js
   Version: v1.0 (17/04/2026)

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
   v1.0 (17/04/2026)
     - Initial centralised topbar component.
   ========================================================================= */

(function() {
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

    /* Logo */
    var logo = el('img', {
      class: 'topbar__logo',
      src: LOGO_URL,
      alt: 'National League'
    });
    logo.onerror = function() { this.onerror = null; this.src = LOGO_FALLBACK; };
    header.appendChild(logo);

    /* Title + kicker */
    var titleWrap = el('div', { class: 'topbar__title-wrap' });
    titleWrap.appendChild(el('span', { class: 'topbar__title', text: opts.title }));
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
      portalBtn.innerHTML =
        '<span>\u2190</span>' +
        '<span class="topbar__btn-text-portal">Portal</span>';
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

    /* Sign out */
    dd.appendChild(el('div', { class: 'topbar__dd-divider' }));
    var signOut = el('button', { class: 'topbar__dd-item topbar__dd-item--danger' });
    signOut.innerHTML =
      '<span class="topbar__dd-item-icon">\u21aa</span>' +
      '<span class="topbar__dd-item-label">Sign out</span>';
    signOut.addEventListener('click', function() {
      if (window.firebase && firebase.auth) {
        firebase.auth().signOut().then(function() {
          window.location.replace('/tools/');
        });
      } else {
        window.location.replace('/tools/');
      }
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

})();
