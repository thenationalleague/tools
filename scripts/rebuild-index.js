/* =======================================================================
   NL Archive Index Rebuild
   Version: 2.4
   Date: 20/04/2026

   Builds or updates assets/data/articles-index.json from the NL CMS.
   Each article record includes plaintext body text (for full-text search
   and clean CSV exports) and optional Google Analytics metrics.

   MODES (auto-detected):
     FIRST-TIME BUILD   - articles-index.json does not exist OR does not yet
                          include bodyText. Iterates every article, fetching
                          body via /v1/byslug and extracting plaintext.
                          Slow (~90 mins for 11,267 articles at 500ms rate).
     INCREMENTAL UPDATE - articles-index.json exists with bodyText.
                          Fetches page 1 of search, merges new postIDs +
                          edits, fetches bodies only for those.
                          Runs once daily, ~5-10 seconds.

   MANUAL FULL REBUILD - set FORCE_FULL_REBUILD=true to rebuild from scratch.

   GA METRICS
     If assets/data/ga-metrics.json exists (produced by fetch-ga-metrics.js),
     this script reads it and merges per-article metrics into each record.
     Missing GA data is non-fatal: articles simply get metrics:null.
     Metrics included: pageViews, users, avgEngagementTimeSecs, engagementRate,
     scrollRate (% of users who scrolled past 90%), sources (channel breakdown).

   CHANGELOG
   v2.4 (20/04/2026)
     - Added -XXXXX article ID suffix fallback to mergeGaMetrics(). Every
       article has a trailing numeric ID (e.g. ...-83850) which is stable
       across the Oct 2025 migration. Pre-migration legacy GA URLs like
       /national-league-statement-morecambe-fc-83850 now match post-migration
       CMS slugs like /news/2025/august/17/...-83850. Unlocks 60k+ views
       per article that were previously orphaned.
     - Merge now carries through new scrollRate and sources fields from
       ga-metrics.json v2+ schema.
   v2.3 (20/04/2026)
     - Fix GA join failure for articles with trailing-slash postSlugs.
       CMS stores some slugs with a trailing '/', GA paths always have it
       stripped. v2.2 join failed for all 334 2026 articles (plus ~360
       others). v2.3 tries exact match first, then retries with trailing
       slash removed. No re-fetch required - only affects merge step.
   v2.2 (19/04/2026)
     - Merge GA metrics from assets/data/ga-metrics.json when present.
       Each article record gains a `metrics` object joined by postSlug.
       If ga-metrics.json is absent or a slug is missing from it, the
       article gets metrics:null rather than failing the rebuild.
   v2.1 (19/04/2026)
     - Fix hero images for imported/legacy articles. Native articles have
       imageData.location (absolute S3 URL); imported articles only have
       imageData.key (filename). resolveImageUrl() now constructs the full
       URL from the S3 bucket when only a key is present.
     - Affects ~7,000 pre-Oct-2025 articles. Requires full rebuild to apply
       retroactively - incremental runs only fix articles as they're touched.
   v2.0 (19/04/2026)
     - Adds bodyText field to each article record (plaintext, whitespace-collapsed)
     - First-time build fetches bodies for every article (rate-limited)
     - Incremental updates fetch bodies only for new/edited articles
     - Master JSON grows from ~3MB to ~25MB (still fine, gzipped ~8MB)
     - Auto-detects pre-v2.0 index and upgrades it to include bodyText
   v1.0 (19/04/2026) - Initial build, metadata only
======================================================================= */

const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.join(__dirname, '..', 'assets', 'data', 'articles-index.json');
const GA_METRICS_PATH = path.join(__dirname, '..', 'assets', 'data', 'ga-metrics.json');
const SEARCH_BASE = 'https://news.cms.web.gc.nationalleagueservices.co.uk/v2/search';
const BYSLUG_BASE = 'https://news.cms.web.gc.nationalleagueservices.co.uk/v1/byslug';
const PAGE_SIZE = 500;
const SEARCH_RATE_MS = 300;
const BYSLUG_RATE_MS = 500;
const EARLIEST_YEAR = 2010;

const FORCE_FULL_REBUILD = process.env.FORCE_FULL_REBUILD === 'true';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log('[' + ts + '] ' + msg);
}

/* ============ PLAINTEXT EXTRACTION ============ */

/**
 * Extract plaintext from byslug response's body array.
 * Only TextBlockWidget prose is included — tweets/custom HTML widgets
 * are skipped because their rendered text is irrelevant for search.
 */
function extractBodyText(byslugBody) {
  if (!Array.isArray(byslugBody) || !byslugBody[0]) return '';
  
  const content = byslugBody[0].content;
  if (!Array.isArray(content)) return '';
  
  const textPieces = [];
  content.forEach(row => {
    if (!row || !row.rowData) return;
    const widget = row.rowData;
    if (widget.widgetType !== 'TextBlockWidget') return;
    
    const html = widget.widgetData && widget.widgetData.content;
    if (!html) return;
    
    // Strip HTML tags
    let text = html.replace(/<[^>]*>/g, ' ');
    // Decode common HTML entities
    text = text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&ndash;/g, '–')
      .replace(/&mdash;/g, '—')
      .replace(/&hellip;/g, '…')
      .replace(/&rsquo;/g, '\u2019')
      .replace(/&lsquo;/g, '\u2018')
      .replace(/&ldquo;/g, '\u201C')
      .replace(/&rdquo;/g, '\u201D')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
    // Collapse whitespace
    text = text.replace(/\s+/g, ' ').trim();
    
    if (text) textPieces.push(text);
  });
  
  return textPieces.join(' ');
}

/* ============ ARTICLE STRIPPING ============ */

// CMS images are served from this S3 bucket. Native articles include a
// pre-built `location` URL in imageData; imported/legacy articles only include
// a `key` filename and the front end constructs the URL from that.
const S3_IMAGE_BASE = 'https://s3.eu-west-1.amazonaws.com/gc-media-assets-v2.gc.nationalleagueservices.co.uk/';

function resolveImageUrl(imageData) {
  if (!imageData) return '';
  // Native articles: pre-built absolute URL
  if (imageData.location) return imageData.location;
  // Imported/legacy articles: construct from S3 bucket + key
  if (imageData.key) return S3_IMAGE_BASE + imageData.key;
  return '';
}

function stripArticleMeta(a) {
  const attr = a.attributes || a;
  return {
    postID:            attr.postID || a.id || '',
    postTitle:         attr.postTitle || '',
    description:       attr.description || '',
    postAuthor:        (attr.postAuthor || '').trim(),
    publishedDateTime: attr.publishedDateTime || '',
    savedTimestamp:    attr.savedTimestamp || '',
    newsCategory:      attr.newsCategory || attr.postCategoryName || '',
    postSlug:          attr.postSlug || '',
    imageUrl:          resolveImageUrl(attr.imageData),
    bodyText:          ''  // populated after byslug fetch
  };
}

/* ============ API FETCH ============ */

async function fetchSearchPage(pageNumber, dateFilter) {
  const params = new URLSearchParams();
  params.set('page.number', pageNumber);
  params.set('page.size', PAGE_SIZE);
  params.set('sort', 'publishedDateTime:desc');
  if (dateFilter) params.set('q', dateFilter);
  
  const url = SEARCH_BASE + '?' + params.toString();
  
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'accept': '*/*',
      'origin': 'https://www.thenationalleague.org.uk',
      'referer': 'https://www.thenationalleague.org.uk/'
    }
  });
  
  if (!resp.ok) {
    throw new Error('Search API HTTP ' + resp.status + ' for page ' + pageNumber);
  }
  
  return await resp.json();
}

async function fetchArticleBody(postSlug) {
  const url = BYSLUG_BASE + '?postSlug=' + encodeURI(postSlug);
  
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'accept': '*/*',
      'origin': 'https://www.thenationalleague.org.uk',
      'referer': 'https://www.thenationalleague.org.uk/'
    }
  });
  
  if (!resp.ok) {
    throw new Error('Byslug HTTP ' + resp.status);
  }
  
  const json = await resp.json();
  if (!json.success || !json.body) return null;
  return json.body;
}

/**
 * Fetch and populate bodyText for an article record.
 * Mutates in place. Returns true on success, false on error (body left empty).
 */
async function populateBody(articleRec) {
  try {
    const body = await fetchArticleBody(articleRec.postSlug);
    if (body) {
      articleRec.bodyText = extractBodyText(body);
    }
    return true;
  } catch (err) {
    log('    ! body fetch failed for ' + articleRec.postSlug + ': ' + err.message);
    return false;
  }
}

/* ============ METADATA DISCOVERY ============ */

/**
 * Discover all article metadata via paginated search + year-sharded backfill.
 * Returns a dedupe-by-postID map.
 */
async function discoverAllMetadata() {
  log('METADATA DISCOVERY — paginating + sharding by year');
  
  const byID = {};
  
  // Phase 1: unfiltered pagination (gets ~10,000 most recent)
  log('Phase 1: paginating recent articles');
  let pageNum = 1;
  let count = 0;
  while (true) {
    try {
      const json = await fetchSearchPage(pageNum);
      const data = json.data || [];
      if (!data.length) break;
      
      data.forEach(a => {
        const rec = stripArticleMeta(a);
        if (rec.postID) byID[rec.postID] = rec;
      });
      count += data.length;
      if (pageNum % 5 === 0) log('  page ' + pageNum + ': ' + count + ' articles so far');
      
      if (data.length < PAGE_SIZE) break;
      pageNum++;
      await sleep(SEARCH_RATE_MS);
    } catch (err) {
      log('  phase 1 stopped at page ' + pageNum + ': ' + err.message);
      break;
    }
  }
  log('Phase 1 complete: ' + Object.keys(byID).length + ' unique articles');
  
  // Phase 2: year-sharded for pre-window articles
  const existing = Object.values(byID);
  existing.sort((a, b) => (a.publishedDateTime || '').localeCompare(b.publishedDateTime || ''));
  const oldestHaveDate = existing[0] ? existing[0].publishedDateTime.slice(0, 10) : null;
  
  if (oldestHaveDate) {
    const oldestYear = new Date(oldestHaveDate).getFullYear();
    const syntaxVariants = [
      y => 'publishedDateTime:[' + y + '-01-01 TO ' + y + '-12-31]',
      y => 'publishedDateTime:>=' + y + '-01-01 AND publishedDateTime:<=' + y + '-12-31',
      y => 'year:' + y
    ];
    let workingSyntax = null;
    
    log('Phase 2: sharding pre-' + oldestYear + ' articles by year');
    for (let year = oldestYear - 1; year >= EARLIEST_YEAR; year--) {
      let yearCount = 0;
      
      if (!workingSyntax) {
        for (const fn of syntaxVariants) {
          try {
            const probe = await fetchSearchPage(1, fn(year));
            if (probe.data && probe.data.length) {
              const firstDate = probe.data[0].attributes.publishedDateTime || '';
              if (firstDate.indexOf(String(year)) === 0) {
                workingSyntax = fn;
                log('  date filter syntax: ' + fn(year));
                probe.data.forEach(a => {
                  const r = stripArticleMeta(a);
                  if (r.postID) byID[r.postID] = r;
                });
                yearCount += probe.data.length;
                break;
              }
            }
            await sleep(SEARCH_RATE_MS);
          } catch (e) { /* try next */ }
        }
        if (!workingSyntax) {
          log('  no working date filter \u2014 stopping at phase 1');
          break;
        }
      }
      
      let p = yearCount > 0 ? 2 : 1;
      while (true) {
        try {
          const json = await fetchSearchPage(p, workingSyntax(year));
          const data = json.data || [];
          if (!data.length) break;
          data.forEach(a => {
            const r = stripArticleMeta(a);
            if (r.postID) byID[r.postID] = r;
          });
          yearCount += data.length;
          if (data.length < PAGE_SIZE) break;
          p++;
          await sleep(SEARCH_RATE_MS);
        } catch (err) {
          break;
        }
      }
      log('  ' + year + ': +' + yearCount + ' articles');
      await sleep(SEARCH_RATE_MS);
    }
  }
  
  return byID;
}

/* ============ BODY POPULATION ============ */

/**
 * Fetch bodies for articles that don't yet have bodyText.
 * Rate-limited to BYSLUG_RATE_MS between calls.
 */
async function populateBodies(articleList) {
  const needsBody = articleList.filter(a => !a.bodyText && a.postSlug);
  if (!needsBody.length) {
    log('No bodies to fetch \u2014 all articles have bodyText already');
    return { fetched: 0, failed: 0 };
  }
  
  log('BODY FETCH \u2014 ' + needsBody.length + ' articles need bodyText');
  const startMs = Date.now();
  const estMins = Math.ceil((needsBody.length * BYSLUG_RATE_MS) / 60000);
  log('  estimated time: ~' + estMins + ' minutes at ' + BYSLUG_RATE_MS + 'ms per article');
  
  let fetched = 0;
  let failed = 0;
  
  for (let i = 0; i < needsBody.length; i++) {
    const ok = await populateBody(needsBody[i]);
    if (ok) fetched++; else failed++;
    
    // Progress every 100 articles
    if ((i + 1) % 100 === 0 || i === needsBody.length - 1) {
      const elapsedMins = ((Date.now() - startMs) / 60000).toFixed(1);
      log('  ' + (i + 1) + '/' + needsBody.length + ' fetched (' + elapsedMins + ' min elapsed, ' + failed + ' failures)');
    }
    
    if (i < needsBody.length - 1) await sleep(BYSLUG_RATE_MS);
  }
  
  return { fetched, failed };
}

/* ============ INCREMENTAL ============ */

async function incrementalUpdate(existing) {
  log('INCREMENTAL UPDATE \u2014 existing master has ' + existing.length + ' articles');
  
  const byID = {};
  existing.forEach(a => { if (a.postID) byID[a.postID] = a; });
  
  const json = await fetchSearchPage(1);
  const data = json.data || [];
  log('  fetched page 1: ' + data.length + ' articles');
  
  let added = 0;
  let edited = 0;
  const needsBodyFetch = [];
  
  data.forEach(raw => {
    const fresh = stripArticleMeta(raw);
    if (!fresh.postID) return;
    
    const prev = byID[fresh.postID];
    if (!prev) {
      byID[fresh.postID] = fresh;
      needsBodyFetch.push(fresh);
      added++;
    } else if (fresh.savedTimestamp && fresh.savedTimestamp !== prev.savedTimestamp) {
      // Preserve bodyText if we don't re-fetch, but flag for re-fetch if it's been edited
      fresh.bodyText = '';  // invalidate, will refetch
      byID[fresh.postID] = fresh;
      needsBodyFetch.push(fresh);
      edited++;
    }
  });
  
  log('  +' + added + ' new, ' + edited + ' edited');
  
  if (needsBodyFetch.length) {
    log('  fetching bodies for ' + needsBodyFetch.length + ' article(s)');
    for (let i = 0; i < needsBodyFetch.length; i++) {
      await populateBody(needsBodyFetch[i]);
      if (i < needsBodyFetch.length - 1) await sleep(BYSLUG_RATE_MS);
    }
  }
  
  const result = Object.values(byID);
  result.sort((a, b) => (b.publishedDateTime || '').localeCompare(a.publishedDateTime || ''));
  return { articles: result, changed: added > 0 || edited > 0, added, edited };
}

/* ============ GA METRICS MERGE ============ */

/**
 * Read ga-metrics.json (if present) and merge per-article metrics into
 * each record by postSlug. Non-fatal if the file is missing or malformed
 * - the article index stands on its own without GA data.
 *
 * Each article either gets a `metrics` object with pageViews/users/etc.,
 * or `metrics: null` if GA has no data for that article (e.g. imported
 * articles from before the new site launch).
 */
/**
 * Combine multiple GA metric records for the same article (e.g. legacy URL +
 * new URL both pointing to the same piece of content). Sums counts; averages
 * rates weighted by users.
 */
function aggregateMetrics(list) {
  if (!list || !list.length) return null;
  if (list.length === 1) return list[0];
  
  let pageViews = 0;
  let users = 0;
  let engagementDurationSecs = 0;
  let scrollCount = 0;
  let weightedEngRate = 0;  // weighted by users
  const sources = {};
  
  list.forEach(m => {
    pageViews += (m.pageViews || 0);
    users += (m.users || 0);
    engagementDurationSecs += (m.engagementDurationSecs || 0);
    scrollCount += (m.scrollCount || 0);
    weightedEngRate += (m.engagementRate || 0) * (m.users || 0);
    if (m.sources) {
      Object.keys(m.sources).forEach(k => {
        sources[k] = (sources[k] || 0) + m.sources[k];
      });
    }
  });
  
  return {
    pageViews: pageViews,
    users: users,
    engagementDurationSecs: engagementDurationSecs,
    scrollCount: scrollCount,
    engagementRate: users > 0 ? Math.round((weightedEngRate / users) * 1000) / 1000 : 0,
    avgEngagementTimeSecs: users > 0 ? Math.round(engagementDurationSecs / users) : 0,
    scrollRate: users > 0 ? Math.round((scrollCount / users) * 1000) / 1000 : 0,
    sources: Object.keys(sources).length ? sources : null
  };
}

function mergeGaMetrics(articles) {
  if (!fs.existsSync(GA_METRICS_PATH)) {
    log('GA MERGE: ga-metrics.json not found - articles will have metrics:null');
    articles.forEach(a => { a.metrics = null; });
    return { matched: 0, unmatched: articles.length };
  }
  
  let gaData;
  try {
    const raw = fs.readFileSync(GA_METRICS_PATH, 'utf8');
    gaData = JSON.parse(raw);
  } catch (e) {
    log('GA MERGE: could not parse ga-metrics.json (' + e.message + ') - articles will have metrics:null');
    articles.forEach(a => { a.metrics = null; });
    return { matched: 0, unmatched: articles.length };
  }
  
  const metricsByPath = gaData.metrics || {};
  const pathCount = Object.keys(metricsByPath).length;
  log('GA MERGE: loaded ' + pathCount + ' paths from ga-metrics.json');
  log('  generated: ' + (gaData.generatedAt || 'unknown'));
  log('  date range: ' + (gaData.startDate || '?') + ' to ' + (gaData.endDate || '?'));
  log('  schema: v' + (gaData.schemaVersion || 1));
  
  // Build a secondary lookup by trailing numeric article ID.
  // Every NL article URL ends in '-XXXXX' where XXXXX is a stable numeric
  // ID. Pre-migration legacy URLs like /national-league-statement-morecambe-fc-83850
  // share the same ID as post-migration URLs like /news/2025/august/17/.../-83850.
  // This lookup lets us join by ID when direct path match fails.
  const metricsByArticleId = {};
  const ID_RX = /-(\d+)$/;
  let legacyPathCount = 0;
  Object.keys(metricsByPath).forEach(path => {
    const match = path.match(ID_RX);
    if (match) {
      const id = match[1];
      // If multiple paths share an ID (legacy + new), aggregate them.
      // The new URL is typically the /news/YYYY/MONTH/DD/... canonical one;
      // the legacy URL is the bare /slug-ID one. Both count toward the same article.
      if (!metricsByArticleId[id]) {
        metricsByArticleId[id] = [];
      }
      metricsByArticleId[id].push(metricsByPath[path]);
      if (!path.startsWith('/news/')) legacyPathCount++;
    }
  });
  log('  built ID index: ' + Object.keys(metricsByArticleId).length + ' unique IDs');
  log('  legacy (non-/news/) paths with IDs: ' + legacyPathCount);
  
  let matched = 0;
  let matchedById = 0;
  let unmatched = 0;
  
  articles.forEach(a => {
    const slug = a.postSlug;
    if (!slug) {
      a.metrics = null;
      unmatched++;
      return;
    }
    
    // Pass 1: try exact match on full slug (with/without trailing slash).
    let m = metricsByPath[slug];
    if (!m && slug.length > 1 && slug.endsWith('/')) {
      m = metricsByPath[slug.slice(0, -1)];
    }
    
    // Pass 2: if no direct match, try joining by article ID suffix.
    // This catches legacy URLs where the same article has a pre-migration
    // path with different structure but identical ID suffix.
    let gatheredFromId = false;
    if (!m) {
      const idMatch = slug.match(ID_RX);
      if (idMatch) {
        const matchesForId = metricsByArticleId[idMatch[1]];
        if (matchesForId && matchesForId.length) {
          // Aggregate metrics across all paths sharing this ID
          m = aggregateMetrics(matchesForId);
          gatheredFromId = true;
        }
      }
    }
    
    if (m) {
      a.metrics = {
        pageViews:             m.pageViews || 0,
        users:                 m.users || 0,
        avgEngagementTimeSecs: m.avgEngagementTimeSecs || 0,
        engagementRate:        m.engagementRate || 0,
        scrollRate:            m.scrollRate != null ? m.scrollRate : null,
        sources:               m.sources || null
      };
      matched++;
      if (gatheredFromId) matchedById++;
    } else {
      a.metrics = null;
      unmatched++;
    }
  });
  
  log('GA MERGE: ' + matched + ' articles matched, ' + unmatched + ' unmatched');
  log('  of which ' + matchedById + ' matched only via article ID suffix (legacy URLs)');
  
  // Leaderboard for sanity check
  const top = articles
    .filter(a => a.metrics && a.metrics.pageViews > 0)
    .sort((a, b) => b.metrics.pageViews - a.metrics.pageViews)
    .slice(0, 5);
  if (top.length) {
    log('Top 5 by GA page views (post-merge):');
    top.forEach(a => {
      log('  ' + a.metrics.pageViews.toString().padStart(6) + '  ' + (a.postTitle || '').slice(0, 70));
    });
  }
  
  return { matched, unmatched };
}

/* ============ PERSIST ============ */

function writeIndex(articles) {
  const dir = path.dirname(INDEX_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  // Merge GA metrics before writing (non-fatal if missing)
  mergeGaMetrics(articles);
  
  const payload = {
    generatedAt: new Date().toISOString(),
    count: articles.length,
    schemaVersion: 3,  // v3 = has bodyText AND metrics
    articles: articles
  };
  
  fs.writeFileSync(INDEX_PATH, JSON.stringify(payload, null, 2));
  const sizeMB = (fs.statSync(INDEX_PATH).size / 1024 / 1024).toFixed(1);
  log('Wrote ' + INDEX_PATH + ' (' + articles.length + ' articles, ' + sizeMB + 'MB)');
}

function readExistingIndex() {
  if (!fs.existsSync(INDEX_PATH)) return null;
  try {
    const raw = fs.readFileSync(INDEX_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      articles: Array.isArray(parsed) ? parsed : (parsed.articles || []),
      schemaVersion: parsed.schemaVersion || 1
    };
  } catch (e) {
    log('WARNING: existing index could not be parsed \u2014 treating as missing');
    return null;
  }
}

/* ============ MAIN ============ */

async function main() {
  try {
    const existingData = FORCE_FULL_REBUILD ? null : readExistingIndex();
    
    let finalArticles;
    let changed = true;
    let summary = '';
    
    // Full rebuild if: no existing, forced, or schema is pre-v2 (needs bodyText backfill)
    const needsFullRebuild = !existingData || FORCE_FULL_REBUILD || existingData.schemaVersion < 2;
    
    if (needsFullRebuild) {
      if (existingData && existingData.schemaVersion < 2) {
        log('SCHEMA UPGRADE \u2014 existing index is v' + existingData.schemaVersion + ', rebuilding to v2 (with bodyText)');
      }
      
      const byID = await discoverAllMetadata();
      let articles = Object.values(byID);
      articles.sort((a, b) => (b.publishedDateTime || '').localeCompare(a.publishedDateTime || ''));
      log('Metadata discovery complete: ' + articles.length + ' unique articles');
      
      // If upgrading from v1, preserve any metadata we already have
      if (existingData && existingData.schemaVersion < 2) {
        log('(schema upgrade preserves no prior data \u2014 body fetch runs for all)');
      }
      
      // Fetch bodies for everything
      const bodyResult = await populateBodies(articles);
      log('Body fetch: ' + bodyResult.fetched + ' OK, ' + bodyResult.failed + ' failed');
      
      finalArticles = articles;
      summary = 'full rebuild \u2192 ' + finalArticles.length + ' articles (' + bodyResult.fetched + ' bodies fetched, ' + bodyResult.failed + ' failed)';
    } else {
      const result = await incrementalUpdate(existingData.articles);
      finalArticles = result.articles;
      changed = result.changed;
      summary = 'incremental \u2192 +' + result.added + ' new, ' + result.edited + ' edited (total ' + finalArticles.length + ')';
    }
    
    if (changed) {
      writeIndex(finalArticles);
      log('RESULT: ' + summary);
    } else {
      // Even if no CMS changes, check if GA metrics file is newer than
      // the index - if so, rewrite to refresh the merged metrics.
      let gaIsFresher = false;
      if (fs.existsSync(GA_METRICS_PATH) && fs.existsSync(INDEX_PATH)) {
        const gaMtime = fs.statSync(GA_METRICS_PATH).mtimeMs;
        const idxMtime = fs.statSync(INDEX_PATH).mtimeMs;
        gaIsFresher = gaMtime > idxMtime;
      }
      
      if (gaIsFresher) {
        log('GA metrics file is newer than index - rewriting to refresh metrics');
        writeIndex(finalArticles);
        log('RESULT: ' + summary + ' (GA metrics refreshed)');
      } else {
        log('RESULT: no changes - leaving existing file untouched');
      }
    }
    
    process.exit(0);
  } catch (err) {
    log('FATAL: ' + (err && err.message ? err.message : err));
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
  }
}

main();
