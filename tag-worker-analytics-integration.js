// Tag Worker Integration Helper for Analytics
// Add this to your tag-worker.js file

/**
 * Transform GA4 data format to Analytics Worker format
 * This ensures clean, consistent data in your analytics database
 */
function transformToAnalyticsFormat(jsonData, request) {
  // Base analytics payload
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

/**
 * Send data to analytics worker
 * Use this instead of direct fetch
 */
async function sendToAnalytics(jsonData, request, ctx) {
  try {
    // Transform the data to analytics format
    const analyticsData = transformToAnalyticsFormat(jsonData, request);

    // Only send if we have a valid URL
    if (!analyticsData.url) {
      console.log('Skipping analytics - no URL provided');
      return;
    }

    // Use ctx.waitUntil for fire-and-forget (non-blocking)
    const analyticsPromise = fetch('https://frndly-analytics.chris-0b8.workers.dev/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(analyticsData)
    })
    .then(response => {
      if (!response.ok) {
        console.error('Analytics response error:', response.status);
      } else {
        console.log('Analytics tracking successful');
      }
      return response;
    })
    .catch(err => {
      console.error('Analytics error:', err);
    });

    // Let the request continue without waiting for analytics
    ctx.waitUntil(analyticsPromise);

  } catch (error) {
    console.error('Error sending to analytics:', error);
  }
}

// USAGE EXAMPLE:
// Replace lines 358-363 in your tag-worker.js with:
// sendToAnalytics(jsonData, request, event);
