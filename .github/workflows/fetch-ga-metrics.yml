/* =======================================================================
   NL Archive — GA Metrics Fetcher
   Version: 1.0
   Date: 19/04/2026

   Queries the GA4 Data API for page-level engagement metrics and writes
   a JSON map of { postSlug → metrics } to assets/data/ga-metrics.json.

   The main rebuild script (rebuild-index.js) reads this file and merges
   the metrics into article records during index generation.

   AUTH
     Uses Workload Identity Federation — no JSON key required. The
     GitHub Actions workflow authenticates via OIDC, impersonates the
     nl-archive-ga-reader service account, which has GA4 Viewer access.

   ENV VARS REQUIRED
     GA_PROPERTY_ID           — numeric GA4 property ID
     GOOGLE_APPLICATION_CREDENTIALS
                              — auto-set by google-github-actions/auth
                                step in the workflow. Do not set manually.

   WHAT THIS QUERIES
     Dimension:  pagePath
     Metrics:    screenPageViews, totalUsers, userEngagementDuration,
                 engagementRate
     Date range: 2025-10-01 → today (lifetime since new site launch)
     Filter:     pagePath starts with /news/ (limits to article URLs only,
                 excludes homepage, team pages, etc.)
     Pagination: GA Data API returns max 100,000 rows per request. The NL
                 archive has ~11,000 articles and likely <50,000 unique
                 article paths since launch, so single request works.
                 Paginate defensively anyway.

   CHANGELOG
   v1.0 (19/04/2026) — Initial build
======================================================================= */

const fs = require('fs');
const path = require('path');
const { BetaAnalyticsDataClient } = require('@google-analytics/data');

const OUTPUT_PATH = path.join(__dirname, '..', 'assets', 'data', 'ga-metrics.json');
const GA_PROPERTY_ID = process.env.GA_PROPERTY_ID;
const START_DATE = '2025-10-01';  // new NL site launch
const PAGE_SIZE = 100000;

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log('[' + ts + '] ' + msg);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Normalise a GA pagePath to match our postSlug format.
 *
 * GA stores paths like "/news/2024/july/2/oldham-...-82365" or sometimes with
 * query strings like "/news/...-82365?utm_source=twitter". Our postSlugs are
 * the canonical form without query/hash.
 */
function normalisePath(pagePath) {
  if (!pagePath) return '';
  // Strip query string
  let p = pagePath.split('?')[0];
  // Strip fragment
  p = p.split('#')[0];
  // Strip trailing slash (GA sometimes adds, sometimes not)
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

async function main() {
  if (!GA_PROPERTY_ID) {
    throw new Error('GA_PROPERTY_ID env var not set');
  }
  
  log('GA METRICS FETCH');
  log('  property: ' + GA_PROPERTY_ID);
  log('  range:    ' + START_DATE + ' \u2192 ' + today());
  
  const client = new BetaAnalyticsDataClient();
  
  const byPath = {};
  let offset = 0;
  let totalRows = 0;
  let page = 1;
  
  while (true) {
    log('  requesting page ' + page + ' (offset ' + offset + ')');
    
    const [response] = await client.runReport({
      property: 'properties/' + GA_PROPERTY_ID,
      dateRanges: [{ startDate: START_DATE, endDate: today() }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'totalUsers' },
        { name: 'userEngagementDuration' },
        { name: 'engagementRate' }
      ],
      dimensionFilter: {
        filter: {
          fieldName: 'pagePath',
          stringFilter: {
            matchType: 'BEGINS_WITH',
            value: '/news/'
          }
        }
      },
      limit: PAGE_SIZE,
      offset: offset
    });
    
    const rows = response.rows || [];
    log('  got ' + rows.length + ' rows this page');
    
    rows.forEach(row => {
      const rawPath = row.dimensionValues[0].value;
      const path = normalisePath(rawPath);
      if (!path) return;
      
      const pageViews = parseInt(row.metricValues[0].value, 10) || 0;
      const users = parseInt(row.metricValues[1].value, 10) || 0;
      const engagementDurationSecs = parseFloat(row.metricValues[2].value) || 0;
      const engagementRate = parseFloat(row.metricValues[3].value) || 0;
      
      // If multiple raw paths normalise to the same canonical path,
      // aggregate (GA sometimes splits /path and /path?utm=x)
      if (byPath[path]) {
        byPath[path].pageViews += pageViews;
        byPath[path].users += users;
        byPath[path].engagementDurationSecs += engagementDurationSecs;
        // engagementRate is a ratio — weighted average by users
        const totalUsers = byPath[path].users;
        byPath[path].engagementRate = totalUsers > 0
          ? ((byPath[path].engagementRate * (totalUsers - users)) + (engagementRate * users)) / totalUsers
          : 0;
      } else {
        byPath[path] = {
          pageViews: pageViews,
          users: users,
          engagementDurationSecs: engagementDurationSecs,
          engagementRate: engagementRate
        };
      }
    });
    
    totalRows += rows.length;
    
    // If we got fewer rows than page size, no more pages
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    page++;
  }
  
  log('Total rows fetched: ' + totalRows);
  log('Unique paths after normalisation: ' + Object.keys(byPath).length);
  
  // Round floats for cleaner JSON
  Object.keys(byPath).forEach(p => {
    byPath[p].engagementDurationSecs = Math.round(byPath[p].engagementDurationSecs);
    byPath[p].engagementRate = Math.round(byPath[p].engagementRate * 1000) / 1000;
    // Add derived metric: average engagement time per user (in seconds)
    byPath[p].avgEngagementTimeSecs = byPath[p].users > 0
      ? Math.round(byPath[p].engagementDurationSecs / byPath[p].users)
      : 0;
  });
  
  // Sort top entries for sanity-check logging
  const topByViews = Object.entries(byPath)
    .sort((a, b) => b[1].pageViews - a[1].pageViews)
    .slice(0, 10);
  log('Top 10 article paths by views:');
  topByViews.forEach(([p, m]) => {
    log('  ' + m.pageViews.toString().padStart(6) + ' views  |  ' + m.users.toString().padStart(6) + ' users  |  ' + p.slice(0, 80));
  });
  
  // Persist
  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  const payload = {
    generatedAt: new Date().toISOString(),
    propertyId: GA_PROPERTY_ID,
    startDate: START_DATE,
    endDate: today(),
    pathCount: Object.keys(byPath).length,
    metrics: byPath
  };
  
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  const sizeMB = (fs.statSync(OUTPUT_PATH).size / 1024 / 1024).toFixed(2);
  log('Wrote ' + OUTPUT_PATH + ' (' + sizeMB + 'MB)');
}

main().catch(err => {
  console.error('FATAL:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
