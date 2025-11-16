/**
 * FrndlyTV Analytics Tracking Snippet
 *
 * Usage:
 * 1. Replace 'YOUR_WORKER_URL' with your actual worker URL
 * 2. Add this script to your website's <head> or before </body>
 * 3. Analytics will automatically track pageviews
 * 4. Use frndlyAnalytics.track() to send custom events
 */

(function() {
  'use strict';

  // Configuration
  const ANALYTICS_URL = 'https://frndly-analytics.your-account.workers.dev/track';

  // Generate a session ID (persists for browser session)
  function getSessionId() {
    let sessionId = sessionStorage.getItem('frndly_session_id');
    if (!sessionId) {
      sessionId = Math.random().toString(36).substring(2) + Date.now().toString(36);
      sessionStorage.setItem('frndly_session_id', sessionId);
    }
    return sessionId;
  }

  // Generate a visitor ID (persists for 1 day)
  function getVisitorId() {
    const key = 'frndly_visitor_id';
    const expiry = 'frndly_visitor_expiry';

    let visitorId = localStorage.getItem(key);
    let expiryTime = localStorage.getItem(expiry);

    // Check if expired (24 hours)
    if (!visitorId || !expiryTime || Date.now() > parseInt(expiryTime)) {
      visitorId = Math.random().toString(36).substring(2) + Date.now().toString(36);
      localStorage.setItem(key, visitorId);
      localStorage.setItem(expiry, (Date.now() + 24 * 60 * 60 * 1000).toString());
    }

    return visitorId;
  }

  // Extract UTM parameters from URL
  function getUtmParams() {
    const params = new URLSearchParams(window.location.search);
    return {
      utm_source: params.get('utm_source') || undefined,
      utm_medium: params.get('utm_medium') || undefined,
      utm_campaign: params.get('utm_campaign') || undefined,
      utm_content: params.get('utm_content') || undefined,
      utm_term: params.get('utm_term') || undefined,
    };
  }

  // Send tracking data to analytics worker
  function sendTracking(data) {
    const payload = {
      url: window.location.href,
      referrer: document.referrer || undefined,
      visitor_id: getVisitorId(),
      session_id: getSessionId(),
      ...getUtmParams(),
      ...data,
    };

    // Use sendBeacon if available (works even when page is unloading)
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon(ANALYTICS_URL, blob);
    } else {
      // Fallback to fetch
      fetch(ANALYTICS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        keepalive: true, // Keep request alive even if page unloads
      }).catch(err => {
        // Silently fail - don't break the page
        console.debug('Analytics tracking failed:', err);
      });
    }
  }

  // Track pageview
  function trackPageview() {
    sendTracking({
      url: window.location.href,
    });
  }

  // Track custom event
  function trackEvent(eventName, eventValue, metadata) {
    sendTracking({
      event_name: eventName,
      event_value: eventValue,
      metadata: metadata,
    });
  }

  // Auto-track pageview on load
  if (document.readyState === 'complete') {
    trackPageview();
  } else {
    window.addEventListener('load', trackPageview);
  }

  // Track pageview on history changes (for SPAs)
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function() {
    originalPushState.apply(this, arguments);
    trackPageview();
  };

  history.replaceState = function() {
    originalReplaceState.apply(this, arguments);
    trackPageview();
  };

  window.addEventListener('popstate', trackPageview);

  // Expose public API
  window.frndlyAnalytics = {
    track: trackEvent,
    pageview: trackPageview,
  };
})();
