# FrndlyTV Analytics

A lightweight, privacy-friendly analytics system built with Cloudflare Workers and D1 database.

## Overview

This analytics system replaces GA4 with a custom solution that provides:

- **Real-time analytics** (no 24-48 hour delays like GA4)
- **Privacy-friendly tracking** with daily-rotating visitor hashes
- **Simple, clean dashboard** with instant insights
- **Full control** over your data
- **Fast & serverless** running on Cloudflare's edge network

## Architecture

```
Website → POST /track → Analytics Worker → D1 Database → Dashboard
```

### Components

1. **Analytics Database (D1 - SQLite)**
   - Stores pageviews with URL, referrer, UTM params, country, device type
   - Stores events (purchases, clicks) with values and metadata
   - Privacy-friendly visitor hashing (rotates daily, no PII)

2. **Analytics Worker (Cloudflare Worker)**
   - `POST /track` - Receives tracking data via HTTP
   - `GET /` or `/analytics` - Serves dashboard HTML
   - `GET /api/stats` - Returns analytics data as JSON

3. **Dashboard**
   - Real-time metrics: pageviews, visitors, sessions
   - Top pages, referrers, countries, devices
   - Event tracking with revenue
   - Filter by: today, 7 days, 30 days
   - Auto-refreshes every 30 seconds

## Project Structure

```
frndly-analytics/
├── migrations/
│   ├── 0001_create_comments_table.sql    # (legacy, will be replaced)
│   └── 0002_create_analytics_tables.sql  # Analytics schema
├── src/
│   ├── index.ts                          # Worker code
│   └── renderHtml.ts                     # Dashboard HTML
├── wrangler.json                         # Worker configuration
├── package.json                          # Dependencies
└── test-tracking.html                    # Test page for tracking
```

## Deployment

### Prerequisites

- Cloudflare account
- Wrangler CLI installed (`npm install -g wrangler`)
- Cloudflare API token (for deployment)

### Steps

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Apply migrations to remote database:**
   ```bash
   npm run predeploy
   # or manually:
   npx wrangler d1 migrations apply ANALYTICS_DB --remote
   ```

3. **Deploy the worker:**
   ```bash
   npm run deploy
   # or manually:
   npx wrangler deploy
   ```

### Configuration

The worker is configured in `wrangler.json`:

- **Worker name:** `frndly-analytics`
- **Database name:** `frndly-analytics-db`
- **Database ID:** `1853c78e-b865-4151-9c25-880c7eb5e283`
- **Binding:** `ANALYTICS_DB`

## Usage

### Tracking Pageviews

Send a POST request to `/track`:

```javascript
fetch('https://your-worker.workers.dev/track', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://frndlytv.com/home',
    referrer: 'https://google.com',
    utm_source: 'google',
    utm_medium: 'cpc',
    utm_campaign: 'winter_promo',
    utm_content: 'ad1',
    utm_term: 'streaming'
  })
});
```

### Tracking Events

Send events with the same endpoint:

```javascript
fetch('https://your-worker.workers.dev/track', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    url: 'https://frndlytv.com/checkout',
    event_name: 'purchase',
    event_value: 49.99,
    metadata: { plan: 'monthly', currency: 'USD' }
  })
});
```

### Viewing the Dashboard

Open your worker URL in a browser:
```
https://frndly-analytics.your-account.workers.dev/
```

### API Access

Get analytics data as JSON:

```bash
# Last 7 days (default)
curl https://your-worker.workers.dev/api/stats

# Last 30 days
curl https://your-worker.workers.dev/api/stats?days=30

# Today
curl https://your-worker.workers.dev/api/stats?days=1
```

## Privacy Features

- **No PII stored:** Visitor hashes are generated from IP addresses
- **Daily rotation:** Hashes change every day, preventing long-term tracking
- **No cookies:** Client-side tracking uses optional visitor/session IDs
- **GDPR-friendly:** No personal data collection

## Database Schema

### Pageviews Table

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| timestamp | INTEGER | Unix timestamp |
| url | TEXT | Page URL |
| referrer | TEXT | Referrer URL |
| utm_source | TEXT | UTM source parameter |
| utm_medium | TEXT | UTM medium parameter |
| utm_campaign | TEXT | UTM campaign parameter |
| utm_content | TEXT | UTM content parameter |
| utm_term | TEXT | UTM term parameter |
| country | TEXT | Visitor country (from Cloudflare) |
| device_type | TEXT | desktop/mobile/tablet |
| visitor_hash | TEXT | Daily-rotating visitor hash |
| session_hash | TEXT | Session identifier hash |

### Events Table

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| timestamp | INTEGER | Unix timestamp |
| event_name | TEXT | Event name (e.g., 'purchase') |
| event_value | REAL | Optional numeric value |
| metadata | TEXT | JSON metadata |
| url | TEXT | Page URL where event occurred |
| country | TEXT | Visitor country |
| device_type | TEXT | desktop/mobile/tablet |
| visitor_hash | TEXT | Daily-rotating visitor hash |
| session_hash | TEXT | Session identifier hash |

## Development

### Local Testing

1. **Apply migrations locally:**
   ```bash
   npm run seedLocalD1
   ```

2. **Start local dev server:**
   ```bash
   npm run dev
   ```

3. **Open test page:**
   Open `test-tracking.html` in your browser to send test tracking data.

### Type Generation

Generate TypeScript types from wrangler config:

```bash
npm run cf-typegen
```

### Type Checking

Run TypeScript type checking:

```bash
npm run check
```

## Metrics Tracked

### Overview
- Total pageviews
- Unique visitors (daily rotation)
- Sessions

### Breakdowns
- Top 10 pages by views
- Top 10 referrers
- Top 10 countries
- Device type distribution
- Top 10 UTM sources
- Events with count and total value

## Auto-Refresh

The dashboard automatically refreshes every 30 seconds to show real-time data.

## CORS

CORS is enabled for all origins (`*`). Update `corsHeaders` in `src/index.ts` to restrict access.

## License

MIT License - See LICENSE file for details

## Support

For issues or questions, please open an issue in the repository.
