/* =======================================================================
   NL Archive Index Rebuild
   Version: 1.0
   Date: 19/04/2026

   Builds or updates assets/data/articles-index.json from the NL CMS search API.

   Modes (auto-detected):
     FIRST-TIME BUILD   — articles-index.json does not exist yet.
                          Shards by year and paginates each year to bypass
                          the search API's 10,000-result window cap.
                          Slow but only runs once.
     INCREMENTAL UPDATE — articles-index.json exists. Fetches only page 1
                          (500 most-recent articles by published date) and
                          merges new postIDs + any edits (via savedTimestamp
                          comparison) into the existing master.
                          Runs every 6 hours, ~2-3 seconds, one API call.

   MANUAL FULL REBUILD — set FORCE_FULL_REBUILD=true in the environment to
                          force a from-scratch rebuild even if the file exists.

   CHANGELOG
   v1.0 (19/04/2026) — Initial build
     - First-time year-sharded build with q= date filter syntax probing
     - Incremental mode with savedTimestamp edit detection
     - Writes only if content actually changed (clean git history)
     - Stripped metadata schema (~10 fields per article)
======================================================================= */

const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.join(__dirname, '..', 'assets', 'data', 'articles-index.json');
const SEARCH_BASE = 'https://news.cms.web.gc.nationalleagueservices.co.uk/v2/search';
const PAGE_SIZE = 500;
const RATE_LIMIT_MS = 300;

// Years we try to cover in first-time build. Lower bound is generous;
// empty years are fine, just produce zero articles.
const EARLIEST_YEAR = 2010;

const FORCE_FULL_REBUILD = process.env.FORCE_FULL_REBUILD === 'true';

/* ============ UTILITIES ============ */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log('[' + ts + '] ' + msg);
}

function stripArticle(a) {
  // Compact schema — only fields used by the archive tool
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
    imageUrl:          (attr.imageData && attr.imageData.location) || ''
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

/* ============ FIRST-TIME BUILD (year-sharded) ============ */

async function buildFromScratch() {
  log('FIRST-TIME BUILD — sharding by year from ' + EARLIEST_YEAR + ' to current');
  
  const thisYear = new Date().getFullYear();
  const articlesByID = {}; // dedupe while merging
  
  // First try: no date filter, pull as many pages as we can up to the 10k cap
  // This captures the most recent ~10,000 articles.
  log('Phase 1: paginating recent articles without date filter');
  let pageNum = 1;
  let phase1Count = 0;
  while (true) {
    try {
      const json = await fetchSearchPage(pageNum);
      const data = json.data || [];
      if (!data.length) break;
      
      data.forEach(a => {
        const stripped = stripArticle(a);
        if (stripped.postID) articlesByID[stripped.postID] = stripped;
      });
      phase1Count += data.length;
      log('  page ' + pageNum + ': ' + data.length + ' articles (' + phase1Count + ' total so far)');
      
      // If this page returned fewer than PAGE_SIZE, we've reached the end
      if (data.length < PAGE_SIZE) break;
      
      pageNum++;
      await sleep(RATE_LIMIT_MS);
    } catch (err) {
      // Expected when we hit the 10,000 window cap
      log('  stopped at page ' + pageNum + ': ' + err.message);
      break;
    }
  }
  
  log('Phase 1 complete: ' + Object.keys(articlesByID).length + ' unique articles');
  
  // Phase 2: try to get older articles via date-sharded queries
  // We don't know the exact q= syntax — probe with likely variants
  log('Phase 2: attempting date-sharded fetches for pre-window articles');
  
  // Find the oldest article we already have — anything older than this is what we need
  const existing = Object.values(articlesByID);
  existing.sort((a, b) => (a.publishedDateTime || '').localeCompare(b.publishedDateTime || ''));
  const oldestHaveDate = existing[0] ? existing[0].publishedDateTime.slice(0, 10) : null;
  log('  oldest article from phase 1: ' + oldestHaveDate);
  
  if (oldestHaveDate) {
    // Try year by year going backwards from oldestHaveDate
    const oldestYear = new Date(oldestHaveDate).getFullYear();
    const syntaxVariants = [
      // Elasticsearch-style q= filters. Try each until one works.
      y => 'publishedDateTime:[' + y + '-01-01 TO ' + y + '-12-31]',
      y => 'publishedDateTime:>=' + y + '-01-01 AND publishedDateTime:<=' + y + '-12-31',
      y => 'year:' + y
    ];
    
    let workingSyntax = null;
    
    for (let year = oldestYear - 1; year >= EARLIEST_YEAR; year--) {
      let yearCount = 0;
      
      // Find a working syntax if we haven't yet
      if (!workingSyntax) {
        for (const syntaxFn of syntaxVariants) {
          try {
            const filter = syntaxFn(year);
            const probe = await fetchSearchPage(1, filter);
            if (probe.data && probe.data.length > 0) {
              // Sanity check: are these actually from that year?
              const firstDate = probe.data[0].attributes.publishedDateTime || '';
              if (firstDate.indexOf(String(year)) === 0) {
                workingSyntax = syntaxFn;
                log('  date filter syntax found: ' + filter);
                probe.data.forEach(a => {
                  const s = stripArticle(a);
                  if (s.postID) articlesByID[s.postID] = s;
                });
                yearCount += probe.data.length;
                break;
              }
            }
            await sleep(RATE_LIMIT_MS);
          } catch (e) {
            // Try next variant
          }
        }
        
        if (!workingSyntax) {
          log('  no date filter syntax worked — stopping at phase 1 result');
          break;
        }
      }
      
      // We have a working syntax — paginate the year
      let p = yearCount > 0 ? 2 : 1; // if probe already got page 1
      while (true) {
        try {
          const filter = workingSyntax(year);
          const json = await fetchSearchPage(p, filter);
          const data = json.data || [];
          if (!data.length) break;
          
          data.forEach(a => {
            const s = stripArticle(a);
            if (s.postID) articlesByID[s.postID] = s;
          });
          yearCount += data.length;
          
          if (data.length < PAGE_SIZE) break;
          p++;
          await sleep(RATE_LIMIT_MS);
        } catch (err) {
          log('  ' + year + ' page ' + p + ' error: ' + err.message);
          break;
        }
      }
      
      log('  ' + year + ': +' + yearCount + ' articles');
      await sleep(RATE_LIMIT_MS);
    }
  }
  
  const finalArticles = Object.values(articlesByID);
  finalArticles.sort((a, b) => (b.publishedDateTime || '').localeCompare(a.publishedDateTime || ''));
  
  log('BUILD COMPLETE — ' + finalArticles.length + ' unique articles');
  return finalArticles;
}

/* ============ INCREMENTAL UPDATE ============ */

async function incrementalUpdate(existing) {
  log('INCREMENTAL UPDATE — existing master has ' + existing.length + ' articles');
  
  const byID = {};
  existing.forEach(a => { if (a.postID) byID[a.postID] = a; });
  
  const json = await fetchSearchPage(1);
  const data = json.data || [];
  log('  fetched page 1: ' + data.length + ' most-recent articles');
  
  let added = 0;
  let edited = 0;
  
  data.forEach(raw => {
    const s = stripArticle(raw);
    if (!s.postID) return;
    
    const existingRec = byID[s.postID];
    if (!existingRec) {
      byID[s.postID] = s;
      added++;
    } else if (s.savedTimestamp && s.savedTimestamp !== existingRec.savedTimestamp) {
      byID[s.postID] = s;
      edited++;
    }
  });
  
  log('  +' + added + ' new, ' + edited + ' edited');
  
  const result = Object.values(byID);
  result.sort((a, b) => (b.publishedDateTime || '').localeCompare(a.publishedDateTime || ''));
  return { articles: result, changed: added > 0 || edited > 0, added, edited };
}

/* ============ WRITE JSON ============ */

function writeIndex(articles) {
  // Ensure directory exists
  const dir = path.dirname(INDEX_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const payload = {
    generatedAt: new Date().toISOString(),
    count: articles.length,
    articles: articles
  };
  
  // Pretty-printed for readable diffs (marginally larger but nightly commits should be small)
  fs.writeFileSync(INDEX_PATH, JSON.stringify(payload, null, 2));
  log('Wrote ' + INDEX_PATH + ' (' + articles.length + ' articles)');
}

function readExistingIndex() {
  if (!fs.existsSync(INDEX_PATH)) return null;
  try {
    const raw = fs.readFileSync(INDEX_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : (parsed.articles || []);
  } catch (e) {
    log('WARNING: existing index file could not be parsed — treating as missing');
    return null;
  }
}

/* ============ MAIN ============ */

async function main() {
  try {
    const existing = FORCE_FULL_REBUILD ? null : readExistingIndex();
    
    let finalArticles;
    let changed = true;
    let summary = '';
    
    if (!existing || FORCE_FULL_REBUILD) {
      finalArticles = await buildFromScratch();
      summary = 'full rebuild → ' + finalArticles.length + ' articles';
    } else {
      const result = await incrementalUpdate(existing);
      finalArticles = result.articles;
      changed = result.changed;
      summary = 'incremental → +' + result.added + ' new, ' + result.edited + ' edited (total ' + finalArticles.length + ')';
    }
    
    if (changed) {
      writeIndex(finalArticles);
      log('RESULT: ' + summary);
    } else {
      log('RESULT: no changes — leaving existing file untouched');
    }
    
    process.exit(0);
  } catch (err) {
    log('FATAL: ' + (err && err.message ? err.message : err));
    if (err && err.stack) console.error(err.stack);
    process.exit(1);
  }
}

main();
