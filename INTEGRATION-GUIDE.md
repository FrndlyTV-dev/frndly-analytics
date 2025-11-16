# Tag Worker → Analytics Worker Integration Guide

## Current Integration (Line 358-363 in tag-worker.js)

```javascript
// ALSO send to our analytics database (fire and forget)
fetch('https://frndly-analytics.chris-0b8.workers.dev/track', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(jsonData)
}).catch(err => console.error('Analytics error:', err));
```

## Issues with Current Approach

1. **Data format mismatch**: Sends raw GA4 format, but analytics worker expects different fields
2. **Blocking request**: Not using `event.waitUntil()`, so errors can affect response time
3. **Missing data transformation**: GA4 fields don't map directly to analytics schema

## Recommended Changes

### Step 1: Add Transformation Function

Add this function near the top of `tag-worker.js` (after the helper functions):

```javascript
/**
 * Transform GA4 data format to Analytics Worker format
 */
function transformToAnalyticsFormat(jsonData) {
  const analyticsData = {
    // Required: URL
    url: jsonData.page_location || jsonData.page_url || '',

    // Optional: Referrer
    referrer: jsonData.page_referrer || jsonData.referrer || null,

    // UTM Parameters
    utm_source: jsonData.utm_source || null,
    utm_medium: jsonData.utm_medium || null,
    utm_campaign: jsonData.utm_campaign || null,
    utm_content: jsonData.utm_content || null,
    utm_term: jsonData.utm_term || null,

    // Visitor & Session tracking
    visitor_id: jsonData.client_id || jsonData.clientId || null,
    session_id: jsonData.session_id || null,
  };

  // Handle events (purchase, click, etc.)
  const eventName = jsonData.event;

  if (eventName && eventName !== 'page_view') {
    analyticsData.event_name = eventName;

    // For purchase events
    if (eventName === 'purchase' || eventName === 'orderCompleted') {
      analyticsData.event_value = parseFloat(jsonData.value || jsonData.transactionTotal || 0);

      // Store additional purchase metadata
      analyticsData.metadata = {
        transaction_id: jsonData.transaction_id || jsonData.transactionId,
        currency: jsonData.currency || 'USD',
        reference_id: jsonData.reference_id || jsonData.referenceId,
        frndly_id: jsonData.frndly_id || jsonData.frndlyId,
        items: jsonData.items || jsonData.transactionProducts || [],
      };
    } else {
      // For other events, store custom parameters as metadata
      if (jsonData.params) {
        analyticsData.metadata = jsonData.params;
      }
    }
  }

  return analyticsData;
}
```

### Step 2: Update Event Listener

Change lines 1-2 from:

```javascript
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});
```

To:

```javascript
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event));
});
```

### Step 3: Update handleRequest Function Signature

Change line 52 from:

```javascript
async function handleRequest(request) {
```

To:

```javascript
async function handleRequest(request, event) {
```

### Step 4: Replace Analytics Call (Lines 358-363)

Replace the current analytics fetch with this optimized version:

```javascript
// Send to analytics database (fire and forget, non-blocking)
try {
  const analyticsData = transformToAnalyticsFormat(jsonData);

  // Only send if we have a valid URL
  if (analyticsData.url) {
    const analyticsPromise = fetch('https://frndly-analytics.chris-0b8.workers.dev/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(analyticsData)
    })
    .then(res => {
      if (res.ok) {
        console.log('Analytics tracked:', eventName);
      } else {
        console.error('Analytics error:', res.status);
      }
    })
    .catch(err => console.error('Analytics error:', err));

    // Non-blocking: continue without waiting
    event.waitUntil(analyticsPromise);
  }
} catch (err) {
  console.error('Analytics transformation error:', err);
}
```

## Alternative: Service Bindings (Best Performance)

For even better performance, use Cloudflare Service Bindings to avoid HTTP overhead.

### In tag worker's wrangler.toml (create this file if it doesn't exist):

```toml
name = "tag"
main = "tag-worker.js"

[[services]]
binding = "ANALYTICS"
service = "frndly-analytics"
```

### Update handleRequest to accept env parameter:

```javascript
async function handleRequest(request, env, event) {
```

### Replace analytics call with service binding:

```javascript
// Send to analytics using service binding (fastest)
try {
  const analyticsData = transformToAnalyticsFormat(jsonData);

  if (analyticsData.url) {
    const analyticsPromise = env.ANALYTICS.fetch('https://dummy/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(analyticsData)
    })
    .then(res => {
      if (res.ok) {
        console.log('Analytics tracked:', eventName);
      }
    })
    .catch(err => console.error('Analytics error:', err));

    event.waitUntil(analyticsPromise);
  }
} catch (err) {
  console.error('Analytics error:', err);
}
```

## Data Flow

```
Website Client
    ↓ (POST with GA4 data)
Tag Worker
    ├─→ Transform to Analytics format
    ├─→ Send to GTM Server (GA4) [blocking]
    └─→ Send to Analytics Worker [non-blocking]
        ↓
    Analytics Worker (/track endpoint)
        ↓
    D1 Database (pageviews & events tables)
        ↓
    Analytics Dashboard (real-time display)
```

## Data Mapping

| GA4 Field | Analytics Field | Notes |
|-----------|----------------|-------|
| `page_location` or `page_url` | `url` | Required |
| `page_referrer` or `referrer` | `referrer` | Optional |
| `utm_source` | `utm_source` | From URL params |
| `utm_medium` | `utm_medium` | From URL params |
| `utm_campaign` | `utm_campaign` | From URL params |
| `utm_content` | `utm_content` | From URL params |
| `utm_term` | `utm_term` | From URL params |
| `client_id` or `clientId` | `visitor_id` | Daily-rotating hash |
| `session_id` | `session_id` | Session identifier |
| `event` | `event_name` | Only if not 'page_view' |
| `value` or `transactionTotal` | `event_value` | For purchase events |
| `params` or purchase data | `metadata` | JSON object |

## Testing

After making these changes:

1. **Test pageview tracking**:
   ```bash
   # Visit a page with UTM params
   https://frndlytv.com/?utm_source=google&utm_medium=cpc
   ```

2. **Check analytics dashboard**:
   ```
   https://frndly-analytics.chris-0b8.workers.dev/
   ```

3. **Verify data in logs**:
   ```bash
   npx wrangler tail tag
   npx wrangler tail frndly-analytics
   ```

## Benefits

1. ✅ **Cleaner data**: Only relevant fields stored in analytics DB
2. ✅ **Non-blocking**: Analytics doesn't slow down GA4 tracking
3. ✅ **Better error handling**: Separate error logging for analytics
4. ✅ **Proper mapping**: Purchase events tracked with revenue
5. ✅ **Type safety**: Consistent data format

## Notes

- The analytics worker will generate its own visitor/session hashes from IP + date salt
- The `visitor_id` and `session_id` from GA4 are stored but the analytics worker creates additional hashes for privacy
- Purchase event metadata is stored as JSON in the `metadata` column
- All analytics tracking is fire-and-forget and won't affect user experience
