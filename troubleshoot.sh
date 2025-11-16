#!/bin/bash

# Analytics Worker Troubleshooting Script
# Run this to diagnose data flow issues

echo "=== Analytics Worker Health Check ==="
echo ""

# Check 1: Worker is deployed and responding
echo "1. Testing if analytics worker is accessible..."
STATS_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" https://frndly-analytics.chris-0b8.workers.dev/api/stats)
if [ "$STATS_RESPONSE" = "200" ]; then
    echo "✓ Analytics worker is deployed and responding"
else
    echo "✗ Analytics worker not accessible (HTTP $STATS_RESPONSE)"
    echo "  → Run: npm run deploy"
    exit 1
fi

echo ""

# Check 2: Worker accepts tracking data
echo "2. Testing /track endpoint..."
TRACK_RESPONSE=$(curl -s -X POST https://frndly-analytics.chris-0b8.workers.dev/track \
  -H "Content-Type: application/json" \
  -d '{
    "page_location": "https://frndlytv.com/test",
    "event": "page_view",
    "client_id": "test-123"
  }')

if echo "$TRACK_RESPONSE" | grep -q "success"; then
    echo "✓ /track endpoint accepting data"
    echo "  Response: $TRACK_RESPONSE"
else
    echo "✗ /track endpoint returned error"
    echo "  Response: $TRACK_RESPONSE"
    echo "  → Check if URL field is required"
fi

echo ""

# Check 3: Dashboard is accessible
echo "3. Testing dashboard..."
DASHBOARD_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" https://frndly-analytics.chris-0b8.workers.dev/)
if [ "$DASHBOARD_RESPONSE" = "200" ]; then
    echo "✓ Dashboard accessible at https://frndly-analytics.chris-0b8.workers.dev/"
else
    echo "✗ Dashboard not accessible (HTTP $DASHBOARD_RESPONSE)"
fi

echo ""

# Check 4: Get current stats
echo "4. Checking current data..."
STATS=$(curl -s https://frndly-analytics.chris-0b8.workers.dev/api/stats)
PAGEVIEWS=$(echo "$STATS" | grep -o '"pageviews":[0-9]*' | grep -o '[0-9]*')
VISITORS=$(echo "$STATS" | grep -o '"visitors":[0-9]*' | grep -o '[0-9]*')

if [ -n "$PAGEVIEWS" ]; then
    echo "✓ Current stats:"
    echo "  - Pageviews: $PAGEVIEWS"
    echo "  - Visitors: $VISITORS"

    if [ "$PAGEVIEWS" = "0" ]; then
        echo ""
        echo "⚠ No data in database yet"
        echo "  Possible causes:"
        echo "  1. Migrations not applied → Run: npm run predeploy"
        echo "  2. Tag worker not sending data → Check: npx wrangler tail tag"
        echo "  3. Website not generating traffic → Visit your site"
    fi
else
    echo "✗ Could not parse stats"
    echo "  Raw response: $STATS"
fi

echo ""
echo "=== Troubleshooting Steps ==="
echo ""
echo "If data is not flowing:"
echo ""
echo "1. Ensure migrations are applied:"
echo "   export CLOUDFLARE_API_TOKEN=your_token_here"
echo "   npm run predeploy"
echo ""
echo "2. Check tag worker is sending data:"
echo "   npx wrangler tail tag"
echo "   (Look for fetch to frndly-analytics.chris-0b8.workers.dev)"
echo ""
echo "3. Check analytics worker is receiving:"
echo "   npx wrangler tail frndly-analytics"
echo "   (Look for 'Analytics tracking:' log messages)"
echo ""
echo "4. Test manual tracking:"
echo "   curl -X POST https://frndly-analytics.chris-0b8.workers.dev/track \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"page_location\":\"https://test.com\",\"event\":\"page_view\",\"client_id\":\"123\"}'"
echo ""
echo "5. View dashboard:"
echo "   https://frndly-analytics.chris-0b8.workers.dev/"
echo ""
