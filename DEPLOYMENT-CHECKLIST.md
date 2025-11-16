# Analytics Deployment & Troubleshooting Checklist

## Step 1: Set Cloudflare API Token (Required)

```bash
export CLOUDFLARE_API_TOKEN=your_token_here
```

**How to get your token:**
1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click "Create Token"
3. Use "Edit Cloudflare Workers" template
4. Create the token and copy it

## Step 2: Apply Database Migrations

```bash
npm run predeploy
```

**Expected output:**
```
Migrations to be applied:
┌──────────────────────────────────┐
│ 0001_create_comments_table.sql   │
│ 0002_create_analytics_tables.sql │
└──────────────────────────────────┘
✅ Both migrations successful
```

**To verify migrations worked:**
```bash
npx wrangler d1 execute ANALYTICS_DB --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```

You should see: `comments`, `pageviews`, `events`

## Step 3: Deploy Analytics Worker

```bash
npm run deploy
```

**Expected output:**
```
Published frndly-analytics (X.XX sec)
  https://frndly-analytics.chris-0b8.workers.dev
```

## Step 4: Test the Deployment

Run the automated health check:
```bash
./troubleshoot.sh
```

Or manually test:

### Test 1: Dashboard loads
```bash
curl https://frndly-analytics.chris-0b8.workers.dev/
# Should return HTML
```

### Test 2: API endpoint works
```bash
curl https://frndly-analytics.chris-0b8.workers.dev/api/stats
# Should return JSON with pageviews, visitors, sessions (may be 0)
```

### Test 3: Tracking endpoint accepts data
```bash
curl -X POST https://frndly-analytics.chris-0b8.workers.dev/track \
  -H "Content-Type: application/json" \
  -d '{
    "page_location": "https://frndlytv.com/test",
    "event": "page_view",
    "client_id": "test-123"
  }'

# Should return: {"success":true}
```

### Test 4: Data was stored
```bash
# Wait 2 seconds, then check stats again
sleep 2
curl https://frndly-analytics.chris-0b8.workers.dev/api/stats

# pageviews should now be 1 or more
```

## Step 5: Verify Tag Worker Integration

Your tag worker is already configured (line 359):
```javascript
fetch('https://frndly-analytics.chris-0b8.workers.dev/track', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(jsonData)
}).catch(err => console.error('Analytics error:', err));
```

**To verify it's working:**

1. **Watch the logs:**
   ```bash
   # Terminal 1: Tag worker
   npx wrangler tail tag

   # Terminal 2: Analytics worker
   npx wrangler tail frndly-analytics
   ```

2. **Visit your website** (any page on frndlytv.com that uses the tag worker)

3. **Look for in tag worker logs:**
   ```
   Analytics tracked: page_view
   ```
   or
   ```
   fetch to frndly-analytics.chris-0b8.workers.dev
   ```

4. **Look for in analytics worker logs:**
   ```
   Analytics tracking: { event: 'pageview', url: '...', ... }
   ```

## Step 6: Check the Dashboard

Visit: **https://frndly-analytics.chris-0b8.workers.dev/**

You should see:
- Total pageviews count
- Unique visitors count
- Sessions count
- Top pages list
- Top countries
- Device types
- Purchase events (if any)

The dashboard auto-refreshes every 30 seconds.

## Common Issues & Solutions

### Issue: Worker returns 404

**Solution:** Deploy the worker
```bash
npm run deploy
```

### Issue: "URL is required" error

**Cause:** The tag worker is sending data without `page_location` or `page_url`

**Solution:** Check that tag worker is sending proper GA4 format. Look at line 114 in tag-worker.js:
```javascript
if (jsonData.page_location || jsonData.page_url)
  gaUrl += '&dl=' + encodeURIComponent(jsonData.page_location || jsonData.page_url);
```

This should always be set.

### Issue: Pageviews count is 0

**Possible causes:**

1. **Migrations not applied**
   ```bash
   npm run predeploy
   ```

2. **Tag worker not deployed or not sending data**
   - Check tag worker is deployed at `tag.frndlytv.com`
   - Check logs: `npx wrangler tail tag`

3. **No website traffic yet**
   - Visit your website
   - Check browser console for errors
   - Check Network tab for request to tag.frndlytv.com

4. **CORS errors**
   - Analytics worker has CORS enabled for `*`
   - Check browser console for CORS errors

### Issue: Purchase events not tracking revenue

**Check:**
1. Tag worker is sending `event: 'purchase'` or `event: 'orderCompleted'`
2. Tag worker includes `transactionTotal` or `value`
3. Tag worker includes `transactionId`

**Test manually:**
```bash
curl -X POST https://frndly-analytics.chris-0b8.workers.dev/track \
  -H "Content-Type: application/json" \
  -d '{
    "page_location": "https://frndlytv.com/checkout",
    "event": "purchase",
    "transactionTotal": 49.99,
    "transactionId": "TEST-123",
    "client_id": "test-456"
  }'

# Check dashboard - should show purchase event
```

### Issue: Analytics worker logs show errors

**Common errors:**

1. **"Cannot read property 'prepare' of undefined"**
   - Database binding not configured
   - Check `wrangler.json` has correct `ANALYTICS_DB` binding
   - Redeploy: `npm run deploy`

2. **"no such table: pageviews"**
   - Migrations not applied
   - Run: `npm run predeploy`

3. **"URL is required"**
   - Data transformation issue
   - Check incoming data has `page_location` or `page_url`
   - See analytics worker logs for what data was received

## Verification Database Queries

If you want to query the database directly:

```bash
# Count total pageviews
npx wrangler d1 execute ANALYTICS_DB --remote \
  --command "SELECT COUNT(*) as total FROM pageviews"

# See recent pageviews
npx wrangler d1 execute ANALYTICS_DB --remote \
  --command "SELECT url, country, device_type, datetime(timestamp, 'unixepoch') as time FROM pageviews ORDER BY timestamp DESC LIMIT 10"

# Count events by type
npx wrangler d1 execute ANALYTICS_DB --remote \
  --command "SELECT event_name, COUNT(*) as count, SUM(event_value) as revenue FROM events GROUP BY event_name"

# See recent purchases
npx wrangler d1 execute ANALYTICS_DB --remote \
  --command "SELECT event_value, metadata, datetime(timestamp, 'unixepoch') as time FROM events WHERE event_name = 'purchase' ORDER BY timestamp DESC LIMIT 5"
```

## Success Criteria

✅ Dashboard loads at https://frndly-analytics.chris-0b8.workers.dev/
✅ API returns data at /api/stats
✅ Manual test tracking works
✅ Tag worker logs show analytics fetch
✅ Analytics worker logs show incoming data
✅ Dashboard shows pageview count > 0
✅ Database queries return data

## Next Steps After Deployment

1. **Monitor logs for first 24 hours**
   ```bash
   npx wrangler tail frndly-analytics
   ```

2. **Check dashboard daily** to ensure data is flowing

3. **Set up alerts** (optional) - Use Cloudflare Workers Analytics

4. **Test purchase tracking** - Complete a test transaction and verify it shows in dashboard

5. **Share dashboard URL** with your team

## Support

If you're still having issues after following this checklist:

1. Run `./troubleshoot.sh` and share the output
2. Check both tag worker and analytics worker logs
3. Share any error messages you're seeing
4. Verify your Cloudflare account has Workers and D1 enabled
