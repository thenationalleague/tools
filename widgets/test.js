<link rel="stylesheet" href="https://use.typekit.net/gff4ipy.css">

<script>
(function() {
  if (window.__NL_TRANSFER_TICKER_V2_0__) return;
  window.__NL_TRANSFER_TICKER_V2_0__ = true;

  var API_URL     = 'https://script.google.com/macros/s/AKfycbxmGpOdK4oKJ8Yvjr0jl5dz-NKoS3S6tTDj4h701W0jqHYIckYZu0WAVWlY5YtHOFzK/exec';
  var CREST_BASE  = 'https://raw.githubusercontent.com/rckd-nl/nl-tools/main/assets/crests/';
  var POLL_MS     = 30000;
  var FLIP_MS     = 8000;
  var MOB_FLIP_MS = 3500;
  var MAX_ITEMS   = 5;
  var BREAKING_MS = 12 * 60 * 60 * 1000; /* v2.0 — 12 hours */

  var SHOW_TYPES = {
    confirmed_signing:   { label: 'Transfer', css: 'transfer' },
    confirmed_departure: { label: 'Transfer', css: 'transfer' },
    loan_in:             { label: 'Loan',     css: 'loan' },
    loan_out:            { label: 'Loan',     css: 'loan' },
    contract_extension:  { label: 'Contract', css: 'contract' }
  };

  var posts = [];
  var current = 0;
  var flipTimer = null;
  var mobTimer = null;
  var mobStates = [];
  var mobStateIdx = 0;
  var routeHooksBound = false;
  var resizeBound = false;
  var nudgeStyle = null;
  var resizeObserver = null;
  var domObserver = null;
  var lastRenderedIds = '';

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function crestUrl(name) {
    return name ? CREST_BASE + encodeURIComponent(name) + '.png' : '';
  }

  function timeAgo(ts) {
    if (!ts) return '';
    var diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function isBreaking(post) {
    var ts = post.clock_time || post.created_at || '';
    if (!ts) return false;
    return (Date.now() - new Date(ts).getTime()) < BREAKING_MS;
  }

  function isMobPortrait() {
    return window.innerWidth <= 600 && window.innerHeight > window.innerWidth;
  }

  function getTicker() {
    return document.getElementById('nl-ticker');
  }

  function getStage() {
    return document.getElementById('nl-ticker-stage');
  }

  function getStage2() {
    return document.getElementById('nl-ticker-stage2');
  }

  function getLoading() {
    return document.getElementById('nl-ticker-loading');
  }

  function getLoading2() {
    return document.getElementById('nl-ticker-loading2');
  }

  function ensureStyle() {
    if (document.getElementById('nl-transfer-ticker-style')) return;

    var style = document.createElement('style');
    style.id = 'nl-transfer-ticker-style';
    style.textContent = `
* { box-sizing: border-box; }

#nl-ticker {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background: #0a0a0a;
  border-bottom: 2px solid #FFD700;
  z-index: 9999999;
  font-family: 'carbona-variable', 'din-condensed', sans-serif;
  user-select: none;
  display: flex;
  flex-direction: column;
}

#nl-ticker-row {
  display: flex;
  align-items: stretch;
  height: 44px;
  overflow: hidden;
  flex-shrink: 0;
}

#nl-ticker-row2 {
  display: none;
  align-items: stretch;
  height: 40px;
  overflow: hidden;
  border-top: 1px solid #1a1a1a;
  flex-shrink: 0;
}

@media (max-width: 600px) and (orientation: portrait) {
  #nl-ticker-row { height: 40px; }
  #nl-ticker-row #nl-ticker-stage,
  #nl-ticker-row #nl-ticker-nav,
  #nl-ticker-row #nl-ticker-link { display: none !important; }
  #nl-ticker-row #nl-ticker-badge { flex: 1; justify-content: center; font-size: 12px; }
  #nl-ticker-row2 { display: flex; }
}

#nl-ticker-badge {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 14px;
  background: #FFD700;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #000;
  font-variation-settings: 'wght' 900;
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s;
}
#nl-ticker-badge:hover { background: #ffe033; }

.nl-ticker-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #cc0000;
  flex-shrink: 0;
  animation: nlDotPulse 1.2s ease-in-out infinite;
}

@keyframes nlDotPulse {
  0%,100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(204,0,0,0.7); }
  50% { transform: scale(1.3); box-shadow: 0 0 0 5px rgba(204,0,0,0); }
}

#nl-ticker-stage,
#nl-ticker-stage2 {
  flex: 1;
  position: relative;
  overflow: hidden;
  min-width: 0;
}

.nl-ticker-item {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 10px;
  opacity: 0;
  transition: opacity 0.5s ease;
  pointer-events: none;
  overflow: hidden;
}

@media (max-width: 600px) {
  .nl-ticker-item { padding: 0; gap: 0; }
}

.nl-ticker-item.active {
  opacity: 1;
  pointer-events: auto;
}

.nl-ticker-pill {
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 3px;
  flex-shrink: 0;
  font-variation-settings: 'wght' 900;
  white-space: nowrap;
}
.nl-ticker-pill--transfer { background: #1a1a00; color: #FFD700; border: 1px solid #333300; }
.nl-ticker-pill--loan { background: #001a0a; color: #00cc66; border: 1px solid #003311; }
.nl-ticker-pill--contract { background: #00101a; color: #33aaff; border: 1px solid #003355; }

.nl-ticker-crest {
  width: 22px;
  height: 22px;
  object-fit: contain;
  flex-shrink: 0;
  border-radius: 50%;
  background: #fff;
  padding: 2px;
}
.nl-ticker-crest-err { display: none !important; }

.nl-ticker-player {
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #fff;
  font-variation-settings: 'wght' 900;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
  max-width: 45%;
  min-width: 0;
}

.nl-ticker-clubs {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 1;
  white-space: nowrap;
  min-width: 0;
}

.nl-ticker-club-name {
  font-size: 11px;
  color: #999;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-weight: 700;
  font-variation-settings: 'wght' 700;
}

.nl-ticker-arrow {
  display: inline-flex;
  align-items: center;
  gap: 0;
  flex-shrink: 0;
}

.nl-ticker-arrow-chv {
  color: #FFD700;
  font-size: 13px;
  opacity: 0.2;
  animation: nlChvWave 2s ease-in-out infinite;
  line-height: 1;
}
.nl-ticker-arrow-chv:nth-child(1) { animation-delay: 0s; }
.nl-ticker-arrow-chv:nth-child(2) { animation-delay: 0.25s; }
.nl-ticker-arrow-chv:nth-child(3) { animation-delay: 0.5s; }

.nl-ticker-time {
  font-size: 10px;
  color: #d9d9d9;
  flex-shrink: 0;
  margin-left: auto;
  padding-left: 10px;
}

#nl-ticker-nav,
#nl-ticker-nav2 {
  display: none !important;
}

.nl-mob-label {
  font-size: 8px;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #555;
  font-variation-settings: 'wght' 900;
  flex-shrink: 0;
  white-space: nowrap;
}

.nl-mob-club {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}

.nl-mob-club-name {
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #fff;
  font-variation-settings: 'wght' 900;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

#nl-ticker-loading,
#nl-ticker-loading2 {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
}

.nl-ticker-loading-chv {
  font-size: 36px;
  font-weight: 900;
  color: #FFD700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0.2;
  animation: nlChvWave 1.4s ease-in-out infinite;
  line-height: 40px;
  height: 40px;
  font-variation-settings: 'wght' 900;
}
.nl-ticker-loading-chv:nth-child(1) { animation-delay: 0s; }
.nl-ticker-loading-chv:nth-child(2) { animation-delay: 0.18s; }
.nl-ticker-loading-chv:nth-child(3) { animation-delay: 0.36s; }

@keyframes nlChvWave {
  0%,100% { opacity: 0.15; }
  50% { opacity: 1; }
}

#nl-ticker-link {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 16px 0 8px;
}

#nl-ticker-link a {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: #FFD700;
  color: #000;
  font-family: 'carbona-variable', sans-serif;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  text-decoration: none;
  padding: 5px 12px;
  border-radius: 20px;
  white-space: nowrap;
  font-variation-settings: 'wght' 900;
  transition: background 0.15s;
}
#nl-ticker-link a:hover { background: #ffe033; }

.nl-item-desktop {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-width: 0;
}

.nl-item-mobile {
  display: none;
}

@media (max-width: 600px) and (orientation: portrait) {
  .nl-item-desktop { display: none !important; }

  .nl-item-scroll .nl-ticker-player {
    max-width: none;
    flex-shrink: 1;
    flex: 1;
    min-width: 0;
  }

  .nl-item-mobile {
    display: flex;
    align-items: center;
    width: 100%;
    height: 100%;
    min-width: 0;
    overflow: hidden;
    position: relative;
  }

  .nl-item-mobile__time {
    flex-shrink: 0;
    padding: 0 10px 0 6px;
    display: flex;
    align-items: center;
    height: 100%;
  }

  .nl-item-mobile__time .nl-ticker-time {
    margin-left: 0;
    padding-left: 0;
  }

  .nl-item-mobile__pill {
    flex-shrink: 0;
    padding: 0 8px 0 12px;
    display: flex;
    align-items: center;
    height: 100%;
    z-index: 2;
  }

  .nl-item-mobile__stage {
    flex: 1;
    min-width: 0;
    height: 100%;
    position: relative;
    overflow: hidden;
  }

  .nl-item-mobile__breaking {
    position: absolute;
    inset: 0;
    z-index: 10;
    background: #cc0000;
    display: none;
    justify-content: center;
    align-items: center;
    transform: translateY(-100%);
  }

  .nl-item-mobile__breaking.brk-in {
    display: flex;
    animation: brkBarIn 0.22s cubic-bezier(0.22,1,0.36,1) forwards;
  }

  .nl-item-mobile__breaking.brk-out {
    display: flex;
    animation: brkBarOut 0.5s ease forwards;
  }

  @keyframes brkBarIn {
    from { transform: translateY(-100%); }
    to { transform: translateY(0); }
  }

  @keyframes brkBarOut {
    from { opacity: 1; transform: translateY(0); }
    to { opacity: 0; transform: translateY(0); }
  }

  .brk-letter {
    font-family: 'carbona-variable', 'din-condensed', sans-serif !important;
    font-size: 32px !important;
    font-weight: 900 !important;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #fff !important;
    font-variation-settings: 'wght' 900;
    display: inline-block;
    opacity: 0;
    transform: translateY(110%) scaleY(1.3);
    line-height: 40px;
  }

  .brk-in .brk-letter {
    animation: brkLetterIn 0.3s cubic-bezier(0.22,1,0.36,1) forwards;
  }

  @keyframes brkLetterIn {
    to { opacity: 1; transform: translateY(0) scaleY(1); }
  }

  .nl-item-scroll {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px 0 4px;
    transform: translateY(100%);
    transition: transform 0.4s cubic-bezier(0.4,0,0.2,1);
    white-space: nowrap;
    min-width: 0;
    overflow: hidden;
  }

  .nl-item-scroll--active { transform: translateY(0); }
  .nl-item-scroll--exit { transform: translateY(-100%); }
}

@media (min-width: 601px), (orientation: landscape) {
  .nl-item-mobile { display: none !important; }
}

.nl-ticker-breaking-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: #cc0000;
  color: #fff;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 3px;
  flex-shrink: 0;
  font-variation-settings: 'wght' 900;
}

.nl-ticker-breaking-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #fff;
  flex-shrink: 0;
  animation: nlDotPulse 1.2s ease-in-out infinite;
}

html.nl-ticker-ready,
body.nl-ticker-ready {
  scroll-padding-top: var(--nl-ticker-offset, 44px);
}
`;
    document.head.appendChild(style);
  }

  function buildTickerHtml() {
    return `
<div id="nl-ticker">
  <div id="nl-ticker-row">
    <a id="nl-ticker-badge" href="https://www.thenationalleague.org.uk" target="_blank" rel="noopener">
      <div class="nl-ticker-dot"></div>
      <span>Transfer Centre</span>
    </a>
    <div id="nl-ticker-stage">
      <div id="nl-ticker-loading">
        <span class="nl-ticker-loading-chv">›</span>
        <span class="nl-ticker-loading-chv">›</span>
        <span class="nl-ticker-loading-chv">›</span>
      </div>
    </div>
    <div id="nl-ticker-nav"></div>
    <div id="nl-ticker-link">
      <a href="https://www.thenationalleague.org.uk" target="_blank" rel="noopener">Transfer Centre ↗</a>
    </div>
  </div>
  <div id="nl-ticker-row2">
    <div id="nl-ticker-stage2">
      <div id="nl-ticker-loading2">
        <span class="nl-ticker-loading-chv">›</span>
        <span class="nl-ticker-loading-chv">›</span>
        <span class="nl-ticker-loading-chv">›</span>
      </div>
    </div>
    <div id="nl-ticker-nav2"></div>
  </div>
</div>
`;
  }

  function ensureTicker() {
    var existing = getTicker();
    if (existing) return existing;

    if (!document.body) return null;

    var wrap = document.createElement('div');
    wrap.innerHTML = buildTickerHtml();
    var ticker = wrap.firstElementChild;
    document.body.insertBefore(ticker, document.body.firstChild);

    if (!nudgeStyle) {
      nudgeStyle = document.createElement('style');
      nudgeStyle.id = 'nl-transfer-ticker-nudge-style';
      document.head.appendChild(nudgeStyle);
    }

    observeTickerSize();
    applyNudge();

    return ticker;
  }

  function buildItem(post, idx) {
    var tc = SHOW_TYPES[post.card_type];
    var isContract = post.card_type === 'contract_extension';
    var breaking = isBreaking(post);
    var div = document.createElement('div');
    div.className = 'nl-ticker-item' + (breaking ? ' nl-ticker-item--breaking' : '');
    div.dataset.idx = idx;

    var pillHtml = '<span class="nl-ticker-pill nl-ticker-pill--' + tc.css + '">' + tc.label + '</span>';
    var player = '<span class="nl-ticker-player">' + esc(post.player_name || '') + '</span>';

    var clubs = '';
    if (!isContract && (post.from_club || post.to_club)) {
      clubs = '<div class="nl-ticker-clubs">';
      if (post.from_club) {
        clubs += '<img class="nl-ticker-crest" src="' + crestUrl(post.from_club) + '" alt="" onerror="this.classList.add(\'nl-ticker-crest-err\')">';
        clubs += '<span class="nl-ticker-club-name">' + esc(post.from_club) + '</span>';
        clubs += '<span class="nl-ticker-arrow"><span class="nl-ticker-arrow-chv">›</span><span class="nl-ticker-arrow-chv">›</span><span class="nl-ticker-arrow-chv">›</span></span>';
      }
      if (post.to_club) {
        clubs += '<img class="nl-ticker-crest" src="' + crestUrl(post.to_club) + '" alt="" onerror="this.classList.add(\'nl-ticker-crest-err\')">';
        clubs += '<span class="nl-ticker-club-name">' + esc(post.to_club) + '</span>';
      }
      clubs += '</div>';
    } else if (isContract && post.to_club) {
      clubs = '<div class="nl-ticker-clubs">' +
        '<img class="nl-ticker-crest" src="' + crestUrl(post.to_club) + '" alt="" onerror="this.classList.add(\'nl-ticker-crest-err\')">' +
        '<span class="nl-ticker-club-name">' + esc(post.to_club) + '</span>' +
      '</div>';
    }

    var ts = post.clock_time || post.created_at || '';
    var time = '<span class="nl-ticker-time">' + timeAgo(ts) + '</span>';

    var nameState = '<div class="nl-item-scroll nl-item-scroll--active">' + player + '</div>';

    var fromState = post.from_club && !isContract
      ? '<div class="nl-item-scroll"><span class="nl-mob-label">FROM</span><div class="nl-mob-club"><img class="nl-ticker-crest" src="' + crestUrl(post.from_club) + '" alt="" onerror="this.classList.add(\'nl-ticker-crest-err\')"><span class="nl-mob-club-name">' + esc(post.from_club) + '</span></div></div>'
      : '';

    var toClub = post.to_club || (isContract ? post.to_club : '');
    var toState = toClub
      ? '<div class="nl-item-scroll"><span class="nl-mob-label">' + (isContract ? 'CLUB' : 'TO') + '</span><div class="nl-mob-club"><img class="nl-ticker-crest" src="' + crestUrl(toClub) + '" alt="" onerror="this.classList.add(\'nl-ticker-crest-err\')"><span class="nl-mob-club-name">' + esc(toClub) + '</span></div></div>'
      : '';

    var mobStatesHtml = nameState + fromState + toState;

    div.innerHTML =
      '<div class="nl-item-desktop">' +
        (breaking ? '<span class="nl-ticker-breaking-badge"><span class="nl-ticker-breaking-dot"></span>Breaking</span>' : '') +
        pillHtml + player + clubs + time +
      '</div>' +
      '<div class="nl-item-mobile">' +
        '<div class="nl-item-mobile__breaking">' +
          'BREAKING'.split('').map(function(ch, i) {
            return '<span class="brk-letter" style="animation-delay:' + (0.22 + i * 0.05) + 's">' + ch + '</span>';
          }).join('') +
        '</div>' +
        '<div class="nl-item-mobile__pill">' + pillHtml + '</div>' +
        '<div class="nl-item-mobile__stage">' + mobStatesHtml + '</div>' +
        '<div class="nl-item-mobile__time">' + time + '</div>' +
      '</div>';

    return div;
  }

  function buildMobStates() {
    mobStates = [];
    posts.forEach(function(post, pi) {
      var isContract = post.card_type === 'contract_extension';
      if (isBreaking(post)) mobStates.push({ post: pi, state: 'breaking' });
      mobStates.push({ post: pi, state: 'name' });
      if (post.from_club && !isContract) mobStates.push({ post: pi, state: 'from' });
      if (post.to_club) mobStates.push({ post: pi, state: 'to' });
    });
  }

  function getActiveStage() {
    return isMobPortrait() ? getStage2() : getStage();
  }

  function applyMobState(entry) {
    var stage = getStage();
    var stage2 = getStage2();
    var activeStage = getActiveStage();
    var pi = entry.post;
    var st = entry.state;

    [stage, stage2].forEach(function(s) {
      if (!s) return;
      s.querySelectorAll('.nl-ticker-item').forEach(function(el, i) {
        el.classList.toggle('active', i === pi);
      });
    });

    current = pi;

    if (!activeStage) return;
    var item = activeStage.querySelectorAll('.nl-ticker-item')[pi];
    if (!item) return;

    var brk = item.querySelector('.nl-item-mobile__breaking');
    if (brk) {
      if (st === 'breaking') {
        clearTimeout(brk._exitTimer);
        brk.classList.remove('brk-in', 'brk-out');
        brk.style.cssText = 'display:flex';
        brk.querySelectorAll('.brk-letter').forEach(function(el) {
          var delay = el.style.animationDelay;
          el.style.cssText = '';
          if (delay) el.style.animationDelay = delay;
        });
        void brk.offsetWidth;
        brk.classList.add('brk-in');
      } else {
        if (brk.style.display === 'flex' || brk.classList.contains('brk-in')) {
          clearTimeout(brk._exitTimer);
          brk.style.transform = 'translateY(0)';
          brk.classList.remove('brk-in');
          brk.style.display = 'flex';
          brk.classList.add('brk-out');
          var brkCap = brk;
          brkCap._exitTimer = setTimeout(function() {
            brkCap.classList.remove('brk-out');
            brkCap.style.cssText = '';
          }, 550);
        }
      }
    }

    var scrolls = item.querySelectorAll('.nl-item-scroll');
    var comingFromBreaking = (st === 'name' && brk && (brk.classList.contains('brk-out') || brk._exitTimer));

    scrolls.forEach(function(sc) {
      sc.style.transition = 'none';
      sc.style.opacity = '1';
      sc.classList.remove('nl-item-scroll--active', 'nl-item-scroll--exit');
      void sc.offsetWidth;
      sc.style.transition = '';
    });

    var scrollIdx = 0;
    if (st === 'name') scrollIdx = 0;
    if (st === 'from') scrollIdx = 1;
    if (st === 'to') scrollIdx = scrolls.length - 1;

    var targetScroll = scrolls[scrollIdx];
    if (targetScroll) {
      if (comingFromBreaking) {
        targetScroll.style.opacity = '0';
        targetScroll.classList.add('nl-item-scroll--active');
        void targetScroll.offsetWidth;
        targetScroll.style.transition = 'opacity 0.5s ease';
        targetScroll.style.opacity = '1';
      } else {
        targetScroll.classList.add('nl-item-scroll--active');
      }
    }
  }

  function showItem(idx) {
    var stage = getStage();
    var stage2 = getStage2();
    if (!posts.length) return;

    current = ((idx % posts.length) + posts.length) % posts.length;

    [stage, stage2].forEach(function(s) {
      if (!s) return;
      s.querySelectorAll('.nl-ticker-item').forEach(function(el, i) {
        el.classList.toggle('active', i === current);
      });
    });
  }

  function startMobTimer() {
    if (mobTimer) clearInterval(mobTimer);
    if (!mobStates.length) return;
    mobStateIdx = 0;
    applyMobState(mobStates[0]);
    mobTimer = setInterval(function() {
      mobStateIdx = (mobStateIdx + 1) % mobStates.length;
      if (mobStateIdx === 0) buildMobStates();
      applyMobState(mobStates[mobStateIdx]);
    }, MOB_FLIP_MS);
  }

  function startFlip() {
    if (flipTimer) clearInterval(flipTimer);
    if (mobTimer) clearInterval(mobTimer);
    if (posts.length < 2) return;

    if (isMobPortrait()) {
      startMobTimer();
    } else {
      flipTimer = setInterval(function() {
        showItem(current + 1);
      }, FLIP_MS);
    }
  }

  function render(items) {
    var stage = getStage();
    var stage2 = getStage2();
    var loading = getLoading();
    var loading2 = getLoading2();

    if (!stage || !stage2 || !loading || !loading2) return;

    var filtered = items.filter(function(p) {
      return SHOW_TYPES[p.card_type] && p.player_name;
    }).slice(0, MAX_ITEMS);

    if (!filtered.length) {
      loading.style.display = 'flex';
      loading2.style.display = 'flex';
      return;
    }

    loading.style.display = 'none';
    loading2.style.display = 'none';

    var newIds = filtered.map(function(p) { return p.id; }).join(',');
    if (newIds === lastRenderedIds) return;
    lastRenderedIds = newIds;

    posts = filtered;
    buildMobStates();

    stage.querySelectorAll('.nl-ticker-item').forEach(function(el) { el.remove(); });
    stage2.querySelectorAll('.nl-ticker-item').forEach(function(el) { el.remove(); });

    posts.forEach(function(post, idx) {
      stage.appendChild(buildItem(post, idx));
      stage2.appendChild(buildItem(post, idx));
    });

    showItem(0);
    startFlip();
    applyNudge();
  }

  function fetchPosts() {
    ensureTicker();
    fetch(API_URL + '?action=listPosts')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d && d.ok && Array.isArray(d.items)) render(d.items);
      })
      .catch(function() {});
  }

  function applyNudge() {
    var ticker = getTicker();
    if (!ticker || !nudgeStyle) return;

    var h = ticker.offsetHeight || 44;
    document.documentElement.style.setProperty('--nl-ticker-offset', h + 'px');
    document.documentElement.classList.add('nl-ticker-ready');
    document.body.classList.add('nl-ticker-ready');

    nudgeStyle.textContent = `
html { scroll-padding-top: ${h}px !important; }
body { padding-top: ${h}px !important; }

header,
header.fixed,
header.sticky,
header[class*="sticky"],
header[style*="position: fixed"],
header[style*="position:fixed"],
header[style*="position: sticky"],
header[style*="position:sticky"] {
  top: ${h}px !important;
}

nav.lock-scroll,
nav[class*="fixed"],
nav[style*="position: fixed"],
nav[style*="position:fixed"] {
  top: ${h}px !important;
  max-height: calc(100vh - ${h}px) !important;
}

[role="dialog"][class*="fixed"],
[class*="menu"][class*="fixed"],
[class*="drawer"][class*="fixed"] {
  top: ${h}px !important;
  max-height: calc(100vh - ${h}px) !important;
}
`;
  }

  function observeTickerSize() {
    var ticker = getTicker();
    if (!ticker || !window.ResizeObserver) return;

    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = new ResizeObserver(function() {
      applyNudge();
    });
    resizeObserver.observe(ticker);
  }

  function bindResize() {
    if (resizeBound) return;
    resizeBound = true;

    window.addEventListener('resize', function() {
      applyNudge();
      startFlip();
    });
    window.addEventListener('orientationchange', function() {
      applyNudge();
      startFlip();
    });
  }

  function bindRouteHooks() {
    if (routeHooksBound) return;
    routeHooksBound = true;

    var origPushState = history.pushState;
    var origReplaceState = history.replaceState;

    history.pushState = function() {
      var out = origPushState.apply(this, arguments);
      setTimeout(function() {
        ensureTicker();
        applyNudge();
        fetchPosts();
      }, 50);
      return out;
    };

    history.replaceState = function() {
      var out = origReplaceState.apply(this, arguments);
      setTimeout(function() {
        ensureTicker();
        applyNudge();
        fetchPosts();
      }, 50);
      return out;
    };

    window.addEventListener('popstate', function() {
      setTimeout(function() {
        ensureTicker();
        applyNudge();
        fetchPosts();
      }, 50);
    });
  }

  function observeDom() {
    if (domObserver) domObserver.disconnect();

    domObserver = new MutationObserver(function() {
      if (!getTicker()) {
        ensureTicker();
      }
      applyNudge();
    });

    domObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function init() {
    ensureStyle();
    ensureTicker();
    bindResize();
    bindRouteHooks();
    observeDom();
    applyNudge();
    fetchPosts();
    setInterval(fetchPosts, POLL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
</script>
