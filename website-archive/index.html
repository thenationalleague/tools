/* =======================================================================
   NL Archive - GA Metrics Fetcher
   Version: 2.1
   Date: 20/04/2026

   Queries the GA4 Data API for page-level engagement metrics, scroll
   depth and traffic source breakdown, and writes everything to
   assets/data/ga-metrics.json.

   The main rebuild script (rebuild-index.js) reads this file and merges
   the metrics into article records during index generation.

   AUTH
     Uses Workload Identity Federation - no JSON key required. The
     GitHub Actions workflow authenticates via OIDC, impersonates the
     nl-archive-ga-reader service account, which has GA4 Viewer access.

   WHAT THIS QUERIES

     Query 1 - core metrics by page path
       Dimension:  pagePath
       Metrics:    screenPageViews, totalUsers, userEngagementDuration,
                   engagementRate

     Query 2 - scroll depth event counts by page path
       Dimension:  pagePath
       Metrics:    eventCount (filtered to eventName = 'scroll')
       Note:       GA4 fires the built-in scroll event at 90% page depth.
                   We return scroll count per path so the merge can compute
                   scrollReached90Pct = scrollCount / totalUsers.

     Query 3 - traffic source breakdown by page path
       Dimensions: pagePath, sessionDefaultChannelGroup
       Metrics:    screenPageViews
       Output:     per-path map of channel -> views
                     { "Organic Search": 1200, "Direct": 450, ... }

     Date range: 2024-11-08 -> today. This is the earliest date the GA4
                 property has data. Covers both the legacy site (Nov 2024
                 to Sept 2025) and the new site (Oct 2025 onwards).
     Filter:     NO path filter. We pull everything. Legacy pre-migration
                 URLs like /national-league-statement-morecambe-fc-83850
                 still appear and need to be captured so the rebuild's
                 ID-suffix merge can join them to modern article records.

   CHANGELOG
   v2.1 (20/04/2026)
     - Extended START_DATE from 2025-10-01 to 2024-11-08, the earliest
       date the GA4 property has data. Unlocks ~11 months of pre-migration
       traffic that was previously ignored. Legacy URLs get their real
       numbers - e.g. Morecambe statement jumps from 34 views to ~65k.
     - File size roughly triples but still well under 10MB.
   v2.0 (20/04/2026)
     - Added scroll depth query (event count per path)
     - Added traffic source query (channel group breakdown per path)
     - Removed /news/ path filter so legacy URLs are captured. Old URLs
       like /national-league-statement-morecambe-fc-83850 had 64k+ views
       that were being ignored. Merge script now matches by -XXXXX ID
       suffix.
   v1.0 (19/04/2026) - Initial build
======================================================================= */

const fs = require('fs');
const path = require('path');
const { BetaAnalyticsDataClient } = require('@google-analytics/data');

const OUTPUT_PATH = path.join(__dirname, '..', 'assets', 'data', 'ga-metrics.json');
const GA_PROPERTY_ID = process.env.GA_PROPERTY_ID;
const START_DATE = '2024-11-08';  // earliest date GA4 property has data
const PAGE_SIZE = 100000;

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log('[' + ts + '] ' + msg);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Normalise a GA pagePath. Strips query string, fragment, and trailing slash.
 */
function normalisePath(pagePath) {
  if (!pagePath) return '';
  let p = pagePath.split('?')[0];
  p = p.split('#')[0];
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/**
 * Run a report with automatic pagination. Stops when a response returns
 * fewer rows than PAGE_SIZE.
 */
async function runReportPaginated(client, request, label) {
  const allRows = [];
  let offset = 0;
  let page = 1;

  while (true) {
    const paged = Object.assign({}, request, { limit: PAGE_SIZE, offset: offset });
    log('  ' + label + ': page ' + page + ' (offset ' + offset + ')');
    const [response] = await client.runReport(paged);
    const rows = response.rows || [];
    log('    got ' + rows.length + ' rows');
    allRows.push.apply(allRows, rows);
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    page++;
  }
  return allRows;
}

async function main() {
  if (!GA_PROPERTY_ID) {
    throw new Error('GA_PROPERTY_ID env var not set');
  }

  log('GA METRICS FETCH v2.0');
  log('  property: ' + GA_PROPERTY_ID);
  log('  range:    ' + START_DATE + ' -> ' + today());

  const client = new BetaAnalyticsDataClient();
  const byPath = {};

  // ========== QUERY 1: Core metrics ==========
  log('');
  log('QUERY 1: Core metrics (pageViews, users, engagement)');
  const coreRows = await runReportPaginated(client, {
    property: 'properties/' + GA_PROPERTY_ID,
    dateRanges: [{ startDate: START_DATE, endDate: today() }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [
      { name: 'screenPageViews' },
      { name: 'totalUsers' },
      { name: 'userEngagementDuration' },
      { name: 'engagementRate' }
    ]
  }, 'core');

  coreRows.forEach(row => {
    const p = normalisePath(row.dimensionValues[0].value);
    if (!p) return;

    const pv = parseInt(row.metricValues[0].value, 10) || 0;
    const users = parseInt(row.metricValues[1].value, 10) || 0;
    const engDur = parseFloat(row.metricValues[2].value) || 0;
    const engRate = parseFloat(row.metricValues[3].value) || 0;

    if (byPath[p]) {
      // Aggregate if multiple raw paths normalise to the same canonical path
      byPath[p].pageViews += pv;
      byPath[p].users += users;
      byPath[p].engagementDurationSecs += engDur;
      const totalUsers = byPath[p].users;
      byPath[p].engagementRate = totalUsers > 0
        ? ((byPath[p].engagementRate * (totalUsers - users)) + (engRate * users)) / totalUsers
        : 0;
    } else {
      byPath[p] = {
        pageViews: pv,
        users: users,
        engagementDurationSecs: engDur,
        engagementRate: engRate,
        scrollCount: 0,
        sources: {}
      };
    }
  });
  log('Core metrics: ' + Object.keys(byPath).length + ' unique paths');

  // ========== QUERY 2: Scroll depth ==========
  log('');
  log('QUERY 2: Scroll event counts');
  const scrollRows = await runReportPaginated(client, {
    property: 'properties/' + GA_PROPERTY_ID,
    dateRanges: [{ startDate: START_DATE, endDate: today() }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        stringFilter: { matchType: 'EXACT', value: 'scroll' }
      }
    }
  }, 'scroll');

  let scrollMatched = 0;
  scrollRows.forEach(row => {
    const p = normalisePath(row.dimensionValues[0].value);
    if (!p || !byPath[p]) return;
    const count = parseInt(row.metricValues[0].value, 10) || 0;
    byPath[p].scrollCount += count;
    scrollMatched++;
  });
  log('Scroll events: ' + scrollRows.length + ' rows, ' + scrollMatched + ' matched to paths');

  // ========== QUERY 3: Traffic source ==========
  log('');
  log('QUERY 3: Traffic source breakdown');
  const sourceRows = await runReportPaginated(client, {
    property: 'properties/' + GA_PROPERTY_ID,
    dateRanges: [{ startDate: START_DATE, endDate: today() }],
    dimensions: [
      { name: 'pagePath' },
      { name: 'sessionDefaultChannelGroup' }
    ],
    metrics: [{ name: 'screenPageViews' }]
  }, 'sources');

  let sourceMatched = 0;
  sourceRows.forEach(row => {
    const p = normalisePath(row.dimensionValues[0].value);
    const channel = row.dimensionValues[1].value || 'Unknown';
    if (!p || !byPath[p]) return;
    const pv = parseInt(row.metricValues[0].value, 10) || 0;
    byPath[p].sources[channel] = (byPath[p].sources[channel] || 0) + pv;
    sourceMatched++;
  });
  log('Source breakdown: ' + sourceRows.length + ' rows, ' + sourceMatched + ' matched to paths');

  // ========== DERIVE & ROUND ==========
  Object.keys(byPath).forEach(p => {
    const m = byPath[p];
    m.engagementDurationSecs = Math.round(m.engagementDurationSecs);
    m.engagementRate = Math.round(m.engagementRate * 1000) / 1000;
    m.avgEngagementTimeSecs = m.users > 0 ? Math.round(m.engagementDurationSecs / m.users) : 0;
    // Scroll-to-90% rate: what % of users scrolled deep into the article.
    // GA4 default scroll event fires once per session at 90% depth.
    m.scrollRate = m.users > 0 ? Math.round((m.scrollCount / m.users) * 1000) / 1000 : 0;
  });

  // ========== SANITY LOG ==========
  log('');
  log('Top 10 article paths by views:');
  const top = Object.entries(byPath)
    .sort((a, b) => b[1].pageViews - a[1].pageViews)
    .slice(0, 10);
  top.forEach(([p, m]) => {
    log('  ' + String(m.pageViews).padStart(7) + ' v | ' +
        String(m.users).padStart(6) + ' u | ' +
        String(m.avgEngagementTimeSecs).padStart(3) + 's | ' +
        (m.scrollRate * 100).toFixed(0).padStart(3) + '% scroll | ' +
        p.slice(0, 70));
  });

  // ========== PERSIST ==========
  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const payload = {
    generatedAt: new Date().toISOString(),
    propertyId: GA_PROPERTY_ID,
    startDate: START_DATE,
    endDate: today(),
    pathCount: Object.keys(byPath).length,
    schemaVersion: 2,
    metrics: byPath
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  const sizeMB = (fs.statSync(OUTPUT_PATH).size / 1024 / 1024).toFixed(2);
  log('');
  log('Wrote ' + OUTPUT_PATH + ' (' + sizeMB + 'MB, ' + Object.keys(byPath).length + ' paths)');
}

main().catch(err => {
  console.error('FATAL:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
