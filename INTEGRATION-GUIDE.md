# Tag Worker → Analytics Worker Integration Guide

## Integration Status: Complete ✅

The Tag Worker is successfully sending tracking data to the Analytics Worker. **No changes to the Tag Worker are needed!**

### Current Integration (Lines 358-363 in tag-worker.js)

```javascript
// ALSO send to our analytics database (fire and forget)
fetch('https://frndly-analytics.chris-0b8.workers.dev/track', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(jsonData)
}).catch(err => console.error('Analytics error:', err));
```

This simple integration sends raw GA4 format data to the Analytics Worker, which **automatically transforms** it to the correct format.

## How It Works

### Data Flow

```
Website Client
    ↓ (sends GA4 formatted data)
Tag Worker
    ├─→ GTM Server (GA4 tracking)
    └─→ Analytics Worker (POST /track)
        ↓
    [Automatic GA4 → Analytics transformation]
        ↓
    D1 Database (pageviews & events tables)
        ↓
    Real-time Dashboard
```

### Automatic Data Transformation

The Analytics Worker automatically handles data transformation from GA4 format:

| GA4 Field (from Tag Worker) | Analytics Field (in Database) | Notes |
|----------------------------|------------------------------|-------|
| `page_location` or `page_url` | `url` | Required |
| `page_referrer` | `referrer` | Optional |
| `utm_source` | `utm_source` | From URL params |
| `utm_medium` | `utm_medium` | From URL params |
| `utm_campaign` | `utm_campaign` | From URL params |
| `utm_content` | `utm_content` | From URL params |
| `utm_term` | `utm_term` | From URL params |
| `client_id` or `clientId` | `visitor_id` | Then hashed for privacy |
| `session_id` | `session_id` | Then hashed for privacy |
| `event` | `event_name` | Only if not 'page_view' |
| `value` or `transactionTotal` | `event_value` | For purchase events |
| Transaction data | `metadata` | JSON object with purchase details |

### Purchase Event Handling

When the Tag Worker sends a purchase event (`event: 'purchase'` or `event: 'orderCompleted'`), the Analytics Worker automatically:

1. Extracts the event value from `value` or `transactionTotal`
2. Creates a metadata JSON object with:
   - `transaction_id` or `transactionId`
   - `currency` (defaults to 'USD')
   - `reference_id` or `referenceId`
   - `frndly_id` or `frndlyId`
   - `items` or `transactionProducts` (product array)

**Example purchase data sent from Tag Worker:**

```javascript
{
  event: 'purchase',
  page_location: 'https://frndlytv.com/checkout/confirmation',
  client_id: '123456789.1234567890',
  session_id: '1234567890',
  transaction_id: 'TXN-12345',
  transactionTotal: 49.99,
  currency: 'USD',
  referenceId: 'REF-67890',
  frndlyId: 'FRND-12345',
  transactionProducts: [
    {
      item_id: 'monthly-plan',
      item_name: 'Monthly Subscription',
      price: 49.99,
      quantity: 1
    }
  ]
}
```

**Automatically transformed and stored as:**

```json
{
  "url": "https://frndlytv.com/checkout/confirmation",
  "event_name": "purchase",
  "event_value": 49.99,
  "visitor_hash": "a1b2c3d4e5f6g7h8",
  "session_hash": "h8g7f6e5d4c3b2a1",
  "metadata": {
    "transaction_id": "TXN-12345",
    "currency": "USD",
    "reference_id": "REF-67890",
    "frndly_id": "FRND-12345",
    "items": [
      {
        "item_id": "monthly-plan",
        "item_name": "Monthly Subscription",
        "price": 49.99,
        "quantity": 1
      }
    ]
  }
}
```

## Optional Improvements

While the current integration works perfectly, you can optionally improve the Tag Worker for better performance:

### 1. Use `event.waitUntil()` for Non-Blocking (Optional)

**Current:** The analytics fetch could potentially block the response to GA4.

**Improved:** Make it truly fire-and-forget:

**Change line 1-2 from:**
```javascript
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});
```

**To:**
```javascript
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event));
});
```

**Change line 52 from:**
```javascript
async function handleRequest(request) {
```

**To:**
```javascript
async function handleRequest(request, event) {
```

**Replace lines 358-363 with:**
```javascript
// Send to analytics (non-blocking with event.waitUntil)
if (event) {
  const analyticsPromise = fetch('https://frndly-analytics.chris-0b8.workers.dev/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jsonData)
  })
  .then(res => {
    if (res.ok) {
      console.log('Analytics tracked:', eventName);
    } else {
      console.error('Analytics error:', res.status);
    }
  })
  .catch(err => console.error('Analytics error:', err));

  event.waitUntil(analyticsPromise);
} else {
  // Fallback if event is not available
  fetch('https://frndly-analytics.chris-0b8.workers.dev/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jsonData)
  }).catch(err => console.error('Analytics error:', err));
}
```

### 2. Use Service Bindings for Better Performance (Optional)

Service bindings allow worker-to-worker communication without HTTP overhead.

**In Tag Worker's wrangler.toml:**
```toml
[[services]]
binding = "ANALYTICS"
service = "frndly-analytics"
```

**Replace the analytics call with:**
```javascript
// Use service binding for direct worker-to-worker call
if (event && env.ANALYTICS) {
  const analyticsPromise = env.ANALYTICS.fetch('https://dummy/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jsonData)
  })
  .then(res => res.ok && console.log('Analytics tracked'))
  .catch(err => console.error('Analytics error:', err));

  event.waitUntil(analyticsPromise);
}
```

## Testing

### 1. Check Analytics Dashboard

Visit: `https://frndly-analytics.chris-0b8.workers.dev/`

You should see:
- Real-time pageviews
- Unique visitors
- Top pages
- Purchase events with revenue

### 2. Test with Tag Worker Logs

```bash
# View Tag Worker logs
npx wrangler tail tag

# Send a test pageview from your website
# Check logs for "Analytics tracked: page_view"
```

### 3. Test with Analytics Worker Logs

```bash
# View Analytics Worker logs
npx wrangler tail frndly-analytics

# Check logs for transformation details:
# "Analytics tracking: { event: 'pageview', url: '...', ... }"
```

### 4. Verify Database

```bash
# Query the database directly
npx wrangler d1 execute ANALYTICS_DB --command "SELECT COUNT(*) as total FROM pageviews"
npx wrangler d1 execute ANALYTICS_DB --command "SELECT * FROM events WHERE event_name = 'purchase' LIMIT 5"
```

## Troubleshooting

### No data appearing in dashboard

1. **Check Tag Worker is sending data:**
   ```bash
   npx wrangler tail tag
   ```
   Look for the analytics fetch call

2. **Check Analytics Worker is receiving data:**
   ```bash
   npx wrangler tail frndly-analytics
   ```
   Look for "Analytics tracking:" logs

3. **Verify database has data:**
   ```bash
   npx wrangler d1 execute ANALYTICS_DB --command "SELECT COUNT(*) FROM pageviews"
   ```

### Purchase events not tracking revenue

Check that the Tag Worker is sending:
- `event: 'purchase'` or `event: 'orderCompleted'`
- `value` or `transactionTotal` with numeric value
- `transaction_id` or `transactionId`

The Analytics Worker will log the transformed data for debugging.

## Summary

✅ **Current setup is working!** The Tag Worker sends GA4 format data, and the Analytics Worker automatically transforms it.

✅ **No Tag Worker changes required** - transformation happens server-side in the Analytics Worker

✅ **Backwards compatible** - Also accepts direct analytics format if needed

🚀 **Optional improvements available** - Use `event.waitUntil()` or Service Bindings for better performance
