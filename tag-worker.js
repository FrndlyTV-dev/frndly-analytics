addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

// Helper function to extract cookie values
function getCookieValue(request, name) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  
  const cookies = cookieHeader.split(';');
  for (let cookie of cookies) {
    const [cookieName, cookieValue] = cookie.trim().split('=');
    if (cookieName === name) {
      return cookieValue;
    }
  }
  return null;
}

// Extract gclid from _gcl_aw cookie format (1.timestamp.gclid)
function extractGclidFromCookie(cookieValue) {
  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if (parts.length >= 3) {
    return parts[2]; // Return the actual gclid value
  }
  return null;
}

// Get all Google conversion cookies from header
function getGoogleConversionCookies(request) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return {};
  
  const cookies = {};
  const cookieItems = cookieHeader.split(';');
  
  // Extract all Google conversion cookies
  cookieItems.forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    if (name.startsWith('_gcl_') || 
        name.startsWith('FPGCL') || 
        name.startsWith('FPLC') || 
        name.startsWith('_ga')) {
      cookies[name] = value;
    }
  });
  
  return cookies;
}

async function handleRequest(request) {
  // Define common CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept'
  };

  // Handle OPTIONS preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  // Handle POST requests: proxy to GA4 measurement protocol via GTM server
  if (request.method === 'POST') {
    try {
      // Read the request body
      const bodyText = await request.text();
      let jsonData;
      
      try {
        jsonData = JSON.parse(bodyText);
        console.log("Received payload:", JSON.stringify(jsonData));
      } catch (e) {
        console.error("Error parsing JSON:", e);
        return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        });
      }
      
      // Constants for GTM server and measurement ID
      const measurementId = 'G-94LMWQ1X74'; // Your GA4 measurement ID
      const gtmServerEndpoint = 'https://prod.gtm.frndlytv.com/g/collect';
      
      // Extract information from request headers
      const userAgent = request.headers.get('User-Agent') || jsonData.user_agent || 'Cloudflare-Worker';
      const ipAddress = request.headers.get('CF-Connecting-IP') || jsonData.ip_address || '';
      const language = request.headers.get('Accept-Language') || jsonData.language || 'en-us';
      const origin = request.headers.get('Origin') || jsonData.origin || 'https://tag.frndlytv.com';
      
      // Build the URL with required GA4 parameters
      let gaUrl = `${gtmServerEndpoint}?v=2&tid=${measurementId}`;
      
      // Add cache buster
      gaUrl += '&_p=' + Date.now();
      
      // Add client ID if available, otherwise generate one
      const clientId = jsonData.client_id || jsonData.clientId || Math.floor(Math.random() * 1000000000) + '.' + Math.floor(Date.now() / 1000);
      gaUrl += '&cid=' + clientId;
      
      // Add event name
      const eventName = jsonData.event || 'page_view';
      gaUrl += '&en=' + eventName;
      
      // Add standard GA4 parameters - FIXED: Check for page_location first
      if (jsonData.page_location || jsonData.page_url) 
        gaUrl += '&dl=' + encodeURIComponent(jsonData.page_location || jsonData.page_url);
      
      if (jsonData.page_title) 
        gaUrl += '&dt=' + encodeURIComponent(jsonData.page_title);
      
      if (jsonData.page_referrer || jsonData.referrer) 
        gaUrl += '&dr=' + encodeURIComponent(jsonData.page_referrer || jsonData.referrer);
      
      // Add engagement time if available
      if (jsonData.engagement_time_msec) 
        gaUrl += '&_et=' + jsonData.engagement_time_msec;
      
      // Add session parameters if available
      if (jsonData.session_id) 
        gaUrl += '&sid=' + jsonData.session_id;
      
      if (jsonData.session_number) 
        gaUrl += '&sct=' + jsonData.session_number;
      
      // Add language parameter
      gaUrl += '&ul=' + encodeURIComponent(language);
      
      // Add screen resolution if available
      if (jsonData.screen_resolution) 
        gaUrl += '&sr=' + jsonData.screen_resolution;
      
      // Add viewport size if available
      if (jsonData.viewport_size) 
        gaUrl += '&vp=' + jsonData.viewport_size;
      
      // Add campaign parameters if available, checking both JSON and cookies
      // Google Ads
      const gclid = jsonData.gclid || extractGclidFromCookie(getCookieValue(request, '_gcl_aw'));
      if (gclid) gaUrl += '&ep.gclid=' + encodeURIComponent(gclid);
      
      // Get all Google conversion cookies
      const googleCookies = jsonData.google_conversion_cookies || getGoogleConversionCookies(request);
      if (googleCookies && Object.keys(googleCookies).length > 0) {
        // Log cookies for debugging
        console.log("Google conversion cookies:", googleCookies);
        
        // Add each Google cookie to the request parameters
        Object.keys(googleCookies).forEach(cookieName => {
          // Add the "ep." prefix to all cookie parameters
          gaUrl += `&ep.${cookieName}=${encodeURIComponent(googleCookies[cookieName])}`;
        });
      }
      
      // Facebook
      let fbclid = jsonData.fbclid;
      if (!fbclid) {
        const fbcCookie = getCookieValue(request, '_fbc');
        if (fbcCookie && fbcCookie.startsWith('fb.1.')) {
          const parts = fbcCookie.split('.');
          if (parts.length >= 3) {
            fbclid = parts[2];
          }
        }
      }
      if (fbclid) gaUrl += '&fbclid=' + encodeURIComponent(fbclid);
      
      // CJ
      const cjevent = jsonData.cjevent || getCookieValue(request, 'cjevent');
      if (cjevent) gaUrl += '&ep.cjevent=' + encodeURIComponent(cjevent);
      
      // Microsoft Click ID
      const msclkid = jsonData.msclkid || getCookieValue(request, 'msclkid');
      if (msclkid) gaUrl += '&ep.msclkid=' + encodeURIComponent(msclkid);

      // Tapfiliate
      const ref = jsonData.ref || getCookieValue(request, 'ref');
      if (ref) gaUrl += '&ep.ref=' + encodeURIComponent(ref);
      
      // UTM parameters
      if (jsonData.utm_source) gaUrl += '&cs=' + encodeURIComponent(jsonData.utm_source);
      if (jsonData.utm_medium) gaUrl += '&cm=' + encodeURIComponent(jsonData.utm_medium);
      if (jsonData.utm_campaign) gaUrl += '&cn=' + encodeURIComponent(jsonData.utm_campaign);
      if (jsonData.utm_content) gaUrl += '&cc=' + encodeURIComponent(jsonData.utm_content);
      if (jsonData.utm_term) gaUrl += '&ck=' + encodeURIComponent(jsonData.utm_term);
      
      // Add any custom event parameters
      if (jsonData.params && typeof jsonData.params === 'object') {
        Object.keys(jsonData.params).forEach(key => {
          gaUrl += `&ep.${key}=${encodeURIComponent(jsonData.params[key])}`;
        });
      }
      
      // Add any user properties
      if (jsonData.user_properties && typeof jsonData.user_properties === 'object') {
        Object.keys(jsonData.user_properties).forEach(key => {
          gaUrl += `&up.${key}=${encodeURIComponent(jsonData.user_properties[key])}`;
        });
      }
      
      // Add Google Consent Mode parameters if available
      if (jsonData.consent_mode && typeof jsonData.consent_mode === 'object') {
        // Create Google Consent Mode string (e.g., G110 for denied analytics, ads, personalization)
        let gcsValue = 'G';
        
        // Add analytics_storage status (1=granted, 0=denied)
        gcsValue += jsonData.consent_mode.analytics_storage === 'granted' ? '1' : '0';
        
        // Add ad_storage status (1=granted, 0=denied)
        gcsValue += jsonData.consent_mode.ad_storage === 'granted' ? '1' : '0';
        
        // Add personalization_storage status (1=granted, 0=denied)
        gcsValue += jsonData.consent_mode.personalization_storage === 'granted' ? '1' : '0';
        
        // Add the consent mode parameter to the URL
        gaUrl += `&gcs=${gcsValue}`;
        
        console.log(`Adding Google Consent Mode parameter: gcs=${gcsValue}`);
        
        // Add individual consent parameters for clarity
        Object.keys(jsonData.consent_mode).forEach(key => {
          gaUrl += `&gac_${key}=${jsonData.consent_mode[key]}`;
        });
      }
      
      // Handle e-commerce purchase event specifically
      if (eventName === 'purchase' || eventName === 'orderCompleted') {
        // Required purchase parameters
        if (jsonData.transaction_id || jsonData.transactionId) {
          gaUrl += `&ep.transaction_id=${encodeURIComponent(jsonData.transaction_id || jsonData.transactionId)}`;
        }
        
        if (jsonData.value || jsonData.transactionTotal) {
          gaUrl += `&ep.value=${encodeURIComponent(jsonData.value || jsonData.transactionTotal)}`;
        }
        
        // Currency (defaulting to USD if not specified)
        gaUrl += `&ep.currency=${encodeURIComponent(jsonData.currency || 'USD')}`;
        
        // Reference ID and Frndly ID
        if (jsonData.reference_id || jsonData.referenceId) {
          gaUrl += `&ep.reference_id=${encodeURIComponent(jsonData.reference_id || jsonData.referenceId)}`;
        }
        
        if (jsonData.frndly_id || jsonData.frndlyId) {
          gaUrl += `&ep.frndly_id=${encodeURIComponent(jsonData.frndly_id || jsonData.frndlyId)}`;
        }
        
        // Session ID for purchase tracking
        if (jsonData.session_id || jsonData.sessionId) {
          gaUrl += `&ep.session_id=${encodeURIComponent(jsonData.session_id || jsonData.sessionId)}`;
        }
        
        // Items/Products (required for purchase events)
        if (jsonData.items || jsonData.transactionProducts) {
          const items = jsonData.items || jsonData.transactionProducts;
          
          if (Array.isArray(items)) {
            // Loop through each item and add required parameters
            items.forEach((item, index) => {
              // Item ID (required)
              if (item.id || item.item_id) {
                gaUrl += `&ep.items[${index}].item_id=${encodeURIComponent(item.id || item.item_id)}`;
              }
              
              // Item name (required)
              if (item.name || item.item_name) {
                gaUrl += `&ep.items[${index}].item_name=${encodeURIComponent(item.name || item.item_name)}`;
              }
              
              // Price (required for ecommerce)
              if (item.price) {
                gaUrl += `&ep.items[${index}].price=${encodeURIComponent(item.price)}`;
              }
              
              // Quantity
              if (item.quantity) {
                gaUrl += `&ep.items[${index}].quantity=${encodeURIComponent(item.quantity)}`;
              }
              
              // Category
              if (item.category || item.item_category) {
                gaUrl += `&ep.items[${index}].item_category=${encodeURIComponent(item.category || item.item_category)}`;
              }
              
              // SKU/item_variant
              if (item.sku || item.item_variant) {
                gaUrl += `&ep.items[${index}].item_variant=${encodeURIComponent(item.sku || item.item_variant)}`;
              }
              
              // Currency at item level
              if (item.currency) {
                gaUrl += `&ep.items[${index}].currency=${encodeURIComponent(item.currency)}`;
              }
            });
          } else if (typeof items === 'string') {
            // Handle case where items might be a JSON string
            try {
              const parsedItems = JSON.parse(items);
              if (Array.isArray(parsedItems)) {
                // Process parsed items
                parsedItems.forEach((item, index) => {
                  if (item.id || item.item_id) {
                    gaUrl += `&ep.items[${index}].item_id=${encodeURIComponent(item.id || item.item_id)}`;
                  }
                  if (item.name || item.item_name) {
                    gaUrl += `&ep.items[${index}].item_name=${encodeURIComponent(item.name || item.item_name)}`;
                  }
                  if (item.price) {
                    gaUrl += `&ep.items[${index}].price=${encodeURIComponent(item.price)}`;
                  }
                  if (item.quantity) {
                    gaUrl += `&ep.items[${index}].quantity=${encodeURIComponent(item.quantity)}`;
                  }
                  if (item.category || item.item_category) {
                    gaUrl += `&ep.items[${index}].item_category=${encodeURIComponent(item.category || item.item_category)}`;
                  }
                  if (item.sku || item.item_variant) {
                    gaUrl += `&ep.items[${index}].item_variant=${encodeURIComponent(item.sku || item.item_variant)}`;
                  }
                  if (item.currency) {
                    gaUrl += `&ep.items[${index}].currency=${encodeURIComponent(item.currency)}`;
                  }
                });
              }
            } catch (e) {
              console.error("Error parsing items JSON string:", e);
            }
          }
        }
      }
      
      // Forward to GTM Server with POST method
      const proxyResponse = await fetch(gaUrl, {
        method: 'POST',
        headers: {
          'User-Agent': userAgent,
          'X-Forwarded-For': ipAddress,
          'Origin': origin,
          'Referer': jsonData.page_location || jsonData.page_url || request.headers.get('Referer') || origin,
          'Accept-Language': language
        }
      });
      
      // Log the response for debugging
      const responseStatus = proxyResponse.status;
      const responseText = await proxyResponse.text();
      console.log(`GA4 response: ${responseStatus}`, responseText);
     
      // ALSO send to our analytics database (fire and forget)
fetch('https://frndly-analytics.chris-0b8.workers.dev/track', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(jsonData)
}).catch(err => console.error('Analytics error:', err));
      
      // Return success response to client
      return new Response(JSON.stringify({ 
        success: true, 
        gaStatus: responseStatus,
        clientId: clientId,
        gaUrl: gaUrl
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    } catch (err) {
      console.error('Proxy error:', err);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      });
    }
  }

  // For GET requests, serve the enhanced tracking script
  const trackingScript = `
    (function() {
      console.log("Frndly tracking script loaded at", new Date().toISOString());
      
      // Use hardcoded endpoint instead of dynamic detection
      var workerEndpoint = "https://tag.frndlytv.com";
      
      console.log("Worker endpoint determined:", workerEndpoint);
      
      // Generate a client ID if not already present
      function getClientId() {
        var storageKey = 'ga_client_id';
        var existingId = localStorage.getItem(storageKey);
        
        if (existingId) {
          return existingId;
        }
        
        // Generate a new client ID
        var newId = Math.floor(Math.random() * 1000000000) + '.' + Math.floor(Date.now() / 1000);
        localStorage.setItem(storageKey, newId);
        return newId;
      }

      // Get the viewport size
      function getViewportSize() {
        return window.innerWidth + 'x' + window.innerHeight;
      }

      // Get the screen resolution
      function getScreenResolution() {
        return screen.width + 'x' + screen.height;
      }
      
      // Get session information
      function getSessionInfo() {
        var sessionKey = 'ga_session_id';
        var sessionCountKey = 'ga_session_count';
        var sessionTimeout = 30 * 60 * 1000; // 30 minutes
        
        var sessionId = sessionStorage.getItem(sessionKey);
        var lastActivity = parseInt(sessionStorage.getItem('ga_last_activity') || '0');
        var sessionCount = parseInt(localStorage.getItem(sessionCountKey) || '0');
        var now = Date.now();
        
        // If session expired or doesn't exist, create a new one
        if (!sessionId || (now - lastActivity > sessionTimeout)) {
          sessionId = now.toString();
          sessionStorage.setItem(sessionKey, sessionId);
          sessionCount++;
          localStorage.setItem(sessionCountKey, sessionCount.toString());
        }
        
        // Update last activity
        sessionStorage.setItem('ga_last_activity', now.toString());
        
        return {
          session_id: sessionId,
          session_number: sessionCount
        };
      }
      
      // Get all Google conversion cookies
      function getGoogleConversionCookies() {
        var cookies = {};
        
        // Get all cookies
        document.cookie.split(';').forEach(function(cookie) {
          var parts = cookie.trim().split('=');
          var name = parts[0];
          var value = parts.slice(1).join('='); // Handle values that might contain =
          
          // Capture all Google conversion-related cookies
          if (name.startsWith('_gcl_') || 
              name.startsWith('FPGCL') || 
              name.startsWith('_ga') || 
              name.startsWith('FPLC')) {
            cookies[name] = value;
          }
        });
        
        console.log('Google conversion cookies found:', cookies);
        return cookies;
      }
      
      // Parse URL parameters and set proper cookies
      function getUrlParams() {
        var result = {};
        var urlParams = new URLSearchParams(window.location.search);
        
        // Campaign parameters
        var campaignParams = [
          'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 
          'gclid', 'fbclid', 'cjevent', 'msclkid', 'ref'
        ];
        
        campaignParams.forEach(function(param) {
          var value = urlParams.get(param);
          if (value) {
            result[param] = value;
            
            // Store in localStorage as backup
            localStorage.setItem(param, value);
            
            // Set as cookies with proper domain
            if (param === 'gclid') {
              // Google Ads requires specific cookie format
              document.cookie = \`_gcl_aw=1.\${Date.now()}.\${value}; domain=.frndlytv.com; path=/; max-age=7776000; SameSite=None; Secure\`;
              
              // Also create first-party cookies for conversion linker
              try {
                // Set Google's first-party conversion cookies
                document.cookie = \`FPGCLAW_\${value}=1.\${Date.now()}.\${value}; domain=.frndlytv.com; path=/; max-age=7776000; SameSite=None; Secure\`;
                document.cookie = \`FPLC=\${Date.now()}.\${value}; domain=.frndlytv.com; path=/; max-age=7776000; SameSite=None; Secure\`;
              } catch(e) {
                console.error('Error setting conversion cookies:', e);
              }
            } else if (param === 'fbclid') {
              document.cookie = \`_fbc=fb.1.\${Date.now()}.\${value}; domain=.frndlytv.com; path=/; max-age=7776000; SameSite=None; Secure\`;
              // Also set _fbp cookie if it doesn't exist
              if (!document.cookie.match(/(^|;)\\s*_fbp=/)) {
                document.cookie = \`_fbp=fb.1.\${Date.now()}.\${Math.floor(Math.random() * 10000000000)}; domain=.frndlytv.com; path=/; max-age=7776000; SameSite=None; Secure\`;
              }
            } else {
              document.cookie = \`\${param}=\${value}; domain=.frndlytv.com; path=/; max-age=7776000; SameSite=None; Secure\`;
            }
          } else {
            // Check cookies if not in URL
            var cookieMatch = document.cookie.match(new RegExp('(^| )' + param + '=([^;]+)'));
            if (cookieMatch) result[param] = cookieMatch[2];
            
            // For Google Ads, check _gcl_aw cookie format
            if (param === 'gclid' && !result[param]) {
              cookieMatch = document.cookie.match(new RegExp('(^| )_gcl_aw=([^;]+)'));
              if (cookieMatch) {
                var parts = cookieMatch[2].split('.');
                if (parts.length >= 3) {
                  result[param] = parts[2]; // Extract actual gclid from cookie
                }
              }
            }
            
            // For Facebook, check _fbc cookie format
            if (param === 'fbclid' && !result[param]) {
              cookieMatch = document.cookie.match(new RegExp('(^| )_fbc=([^;]+)'));
              if (cookieMatch && cookieMatch[2].startsWith('fb.1.')) {
                var parts = cookieMatch[2].split('.');
                if (parts.length >= 3) {
                  result[param] = parts[2]; // Extract actual fbclid from cookie
                }
              }
            }
          }
        });
        
        return result;
      }
      
      // Send event to GA4 via server GTM
      function sendEvent(eventType, eventParams, userProperties) {
        // Get session information
        var sessionInfo = getSessionInfo();
        
        // Base payload with all required GA4 parameters
        var payload = {
          event: eventType || 'page_view',
          client_id: getClientId(),
          
          // Page parameters - ALWAYS include page_location
          page_location: window.location.href,
          page_title: document.title,
          page_referrer: document.referrer,
          
          // Technical parameters
          user_agent: navigator.userAgent,
          language: navigator.language || 'en-us',
          screen_resolution: getScreenResolution(),
          viewport_size: getViewportSize(),
          timestamp: new Date().toISOString(),
          
          // Session parameters
          session_id: sessionInfo.session_id,
          session_number: sessionInfo.session_number,
          
          // For page_view events, calculate engagement time if possible
          engagement_time_msec: (eventType === 'page_view' && window.performance) 
            ? Math.round(performance.now()) 
            : undefined,
          
          // Origin for headers
          origin: window.location.origin,
          
          // URL parameters (UTM, etc.)
          ...getUrlParams(),
          
          // Google conversion cookies
          google_conversion_cookies: getGoogleConversionCookies(),
          
          // Add Google Consent Mode values
          consent_mode: {
            analytics_storage: hasConsentForTracking() ? 'granted' : 'denied',
            ad_storage: hasConsentForMarketing() ? 'granted' : 'denied',
            personalization_storage: hasConsentForPreferences() ? 'granted' : 'denied',
            functionality_storage: 'granted',
            security_storage: 'granted'
          }
        };
        
        // Add custom event parameters
        if (eventParams && typeof eventParams === 'object') {
          payload.params = eventParams;
        }
        
        // Add user properties
        if (userProperties && typeof userProperties === 'object') {
          payload.user_properties = userProperties;
        }
        
        // Add debugging logs for ALL events
        console.log('Sending event to server:', eventType);
        console.log('Event payload:', JSON.stringify(payload, null, 2));
        console.log('Consent status - Analytics:', payload.consent_mode.analytics_storage);
        console.log('Consent status - Ads:', payload.consent_mode.ad_storage);
        console.log('Consent status - Personalization:', payload.consent_mode.personalization_storage);
        
        // Send to our Cloudflare Worker
        return fetch(workerEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          // Use keepalive for events sent during page unload
          keepalive: true
        })
        .then(function(response) {
          if (!response.ok) {
            throw new Error('Server responded with status: ' + response.status);
          }
          return response.json();
        })
        .then(function(responseData) {
          // Log the server response
          console.log('Server response for ' + eventType + ' event:', responseData);
          return responseData;
        })
        .catch(function(error) {
          console.error('Error sending ' + eventType + ' event:', error);
          throw error;
        });
      }
      
      // Check if user has given consent for tracking (analytics)
      function hasConsentForTracking() {
        // First check if window.PrivacyConsent exists (from privacy-worker.js)
        if (window.PrivacyConsent && window.PrivacyConsent.getConsent) {
          const consent = window.PrivacyConsent.getConsent();
          // For analytics events, we need analytics consent
          return consent.analytics === true;
        }
        
        // If privacy consent system isn't available, check cookies directly
        try {
          const analyticsCookie = document.cookie
            .split('; ')
            .find(row => row.startsWith('consent_analytics='));
            
          if (analyticsCookie) {
            return analyticsCookie.split('=')[1] === 'true';
          }
          
          // Check for GPC signal which would deny consent
          const gpcCookie = document.cookie
            .split('; ')
            .find(row => row.startsWith('frndly_privacy_doNotSell='));
            
          if (gpcCookie && gpcCookie.split('=')[1] === 'true') {
            return false; // GPC signal is present, deny tracking
          }
        } catch (e) {
          console.warn('Error checking consent cookies:', e);
        }
        
        // Default to false if we can't determine consent status
        return false;
      }
      
      // Check if user has given consent for marketing
      function hasConsentForMarketing() {
        // First check if window.PrivacyConsent exists (from privacy-worker.js)
        if (window.PrivacyConsent && window.PrivacyConsent.getConsent) {
          const consent = window.PrivacyConsent.getConsent();
          return consent.marketing === true;
        }
        
        // If privacy consent system isn't available, check cookies directly
        try {
          const marketingCookie = document.cookie
            .split('; ')
            .find(row => row.startsWith('consent_marketing='));
            
          if (marketingCookie) {
            return marketingCookie.split('=')[1] === 'true';
          }
          
          // Check for GPC signal which would deny consent
          const gpcCookie = document.cookie
            .split('; ')
            .find(row => row.startsWith('frndly_privacy_doNotSell='));
            
          if (gpcCookie && gpcCookie.split('=')[1] === 'true') {
            return false; // GPC signal is present, deny marketing
          }
        } catch (e) {
          console.warn('Error checking consent cookies:', e);
        }
        
        // Default to false if we can't determine consent status
        return false;
      }
      
      // Check if user has given consent for preferences
      function hasConsentForPreferences() {
        // First check if window.PrivacyConsent exists (from privacy-worker.js)
        if (window.PrivacyConsent && window.PrivacyConsent.getConsent) {
          const consent = window.PrivacyConsent.getConsent();
          return consent.preferences === true;
        }
        
        // If privacy consent system isn't available, check cookies directly
        try {
          const preferencesCookie = document.cookie
            .split('; ')
            .find(row => row.startsWith('consent_preferences='));
            
          if (preferencesCookie) {
            return preferencesCookie.split('=')[1] === 'true';
          }
          
          // Check for GPC signal which would deny consent
          const gpcCookie = document.cookie
            .split('; ')
            .find(row => row.startsWith('frndly_privacy_doNotSell='));
            
          if (gpcCookie && gpcCookie.split('=')[1] === 'true') {
            return false; // GPC signal is present, deny preferences
          }
        } catch (e) {
          console.warn('Error checking consent cookies:', e);
        }
        
        // Default to false if we can't determine consent status
        return false;
      }
      
      // Send purchase event
      function sendPurchase(transactionData) {
        if (!transactionData) {
          console.error('Transaction data is required for purchase events');
          return Promise.reject(new Error('Transaction data is required'));
        }
        
        // Clone the data to avoid modifying the original
        const purchaseData = {
          event: 'purchase',
          transaction_id: transactionData.transactionId || transactionData.transaction_id,
          value: transactionData.transactionTotal || transactionData.value || transactionData.revenue,
          currency: transactionData.currency || 'USD',
          reference_id: transactionData.referenceId || transactionData.reference_id,
          frndly_id: transactionData.frndlyId || transactionData.frndly_id
        };
        
        // Add items directly to the root object
        if (transactionData.transactionProducts || transactionData.items) {
          purchaseData.items = transactionData.transactionProducts || transactionData.items;
        }

        // Add user ID directly to the root, not nested in user_properties
        if (transactionData.userId || transactionData.user_id) {
          purchaseData.user_id = transactionData.userId || transactionData.user_id;
        }
        
        // Add Google conversion cookies specifically for purchase events
        purchaseData.google_conversion_cookies = getGoogleConversionCookies();
        
        // Log the full purchase payload for debugging
        console.log('Purchase payload:', JSON.stringify(purchaseData, null, 2));
        console.log('Google conversion cookies for purchase:', purchaseData.google_conversion_cookies);
        
        // Send as a regular event but with the special purchase data structure
        return sendEvent('purchase', purchaseData);
      }
      
      // Track page visibility changes
      function setupVisibilityTracking() {
        var startTime, visibilityTime = 0;
        
        document.addEventListener('visibilitychange', function() {
          if (document.visibilityState === 'visible') {
            startTime = Date.now();
          } else if (startTime) {
            visibilityTime += (Date.now() - startTime);
            startTime = null;
            
            // Send engagement event if significant time was spent on page
            if (visibilityTime > 1000) {
              sendEvent('user_engagement', {
                engagement_time_msec: visibilityTime
              });
              visibilityTime = 0;
            }
          }
        });
      }
      
      // Set up click tracking for key elements
      function setupClickTracking() {
        document.addEventListener('click', function(e) {
          var target = e.target;
          
          // Track link clicks
          if (target.tagName === 'A' || target.closest('a')) {
            var link = target.tagName === 'A' ? target : target.closest('a');
            var href = link.href || '';
            
            if (href && !href.startsWith('javascript:')) {
              sendEvent('click', {
                link_url: href,
                link_id: link.id || undefined,
                link_classes: link.className || undefined,
                link_text: link.innerText || link.textContent || undefined,
                outbound: link.hostname !== window.location.hostname
              });
            }
          }

          // Track button clicks
          if (target.tagName === 'BUTTON' || target.closest('button') ||
              (target.tagName === 'INPUT' && target.type === 'button') ||
              target.getAttribute('role') === 'button') {
            var button = target.tagName === 'BUTTON' || (target.tagName === 'INPUT' && target.type === 'button')
                        ? target : target.closest('button') || target;

            sendEvent('click', {
              button_id: button.id || undefined,
              button_name: button.name || undefined,
              button_text: button.innerText || button.textContent || button.value || undefined
            });
          }
        });
      }
      
      // Set up form submission tracking
      function setupFormTracking() {
        document.addEventListener('submit', function(e) {
          var form = e.target;
          
          if (form.tagName === 'FORM') {
            sendEvent('form_submit', {
              form_id: form.id || undefined,
              form_name: form.name || undefined,
              form_classes: form.className || undefined,
              form_destination: form.action || undefined
            });
          }
        });
      }
      
      // Monitor the dataLayer for purchase events
      function setupDataLayerMonitoring() {
        // Initialize dataLayer if it doesn't exist
        window.dataLayer = window.dataLayer || [];
        
        console.log('Setting up dataLayer monitoring for transaction events');
        console.log('Current dataLayer state:', JSON.stringify(window.dataLayer));
        
        // Process any existing events in the dataLayer
        if (window.dataLayer.length > 0) {
          window.dataLayer.forEach(function(event, index) {
            console.log('Examining dataLayer entry:', index, event);
            
            if (event.event === 'confirmation') {
              console.log('Found confirmation event in dataLayer!');
              console.log('Transaction ID:', event.transactionId);
              console.log('Transaction Total:', event.transactionTotal);
              console.log('Products:', JSON.stringify(event.transactionProducts));
              console.log('Reference ID:', event.referenceId);
              console.log('User ID:', event.userId);
              console.log('Full transaction data:', JSON.stringify(event, null, 2));
              console.log('Google conversion cookies at purchase time:', getGoogleConversionCookies());
              
              sendPurchase(event);
            }
          });
        } else {
          console.log('No existing dataLayer events found, will monitor for new events');
        }
        
        // Override the dataLayer.push method to catch future events
        var originalPush = window.dataLayer.push;
        window.dataLayer.push = function() {
          // Call the original push method
          var result = originalPush.apply(window.dataLayer, arguments);
          
          // Log every dataLayer push for debugging
          console.log('dataLayer.push detected:', arguments[0]);
          
          // Check if the pushed data contains a confirmation event
          if (arguments[0] && arguments[0].event === 'confirmation') {
            console.log('CONFIRMATION EVENT CAPTURED!');
            console.log('Transaction ID:', arguments[0].transactionId);
            console.log('Transaction Total:', arguments[0].transactionTotal);
            console.log('Products:', JSON.stringify(arguments[0].transactionProducts));
            console.log('Reference ID:', arguments[0].referenceId);
            console.log('User ID:', arguments[0].userId);
            console.log('Full transaction data:', JSON.stringify(arguments[0], null, 2));
            console.log('Google conversion cookies at purchase time:', getGoogleConversionCookies());
            
            sendPurchase(arguments[0]);
          }
          
          return result;
        };
        
        console.log('DataLayer monitoring has been successfully set up');
      }
      
      // Initialize tracking
      function initialize() {
        try {
          console.log("Initializing Frndly tracking...");
          
          // Send initial page view
          sendEvent('page_view')
            .then(function(response) {
              console.log('Page view event sent successfully', response);
            })
            .catch(function(error) {
              console.error('Error sending page view event:', error);
            });
          
          // Set up enhanced measurement
          console.log("Setting up visibility tracking...");
          setupVisibilityTracking();
          
          console.log("Setting up click tracking...");
          setupClickTracking();
          
          console.log("Setting up form tracking...");
          setupFormTracking();
          
          // Handle page unload/navigation
          console.log("Setting up unload handler...");
          window.addEventListener('beforeunload', function() {
            // Calculate final engagement time
            if (window.performance) {
              sendEvent('user_engagement', {
                engagement_time_msec: Math.round(performance.now())
              });
            }
          });
        
          // Monitor dataLayer for confirmation events
          console.log("Setting up dataLayer monitoring...");
          setupDataLayerMonitoring();
          
          console.log("Frndly tracking initialization complete");
        } catch (error) {
          console.error("Error during tracking initialization:", error);
        }
      }
      
      // Expose public API
      window.gtmServerClient = {
        sendEvent: sendEvent,
        sendPurchase: sendPurchase,
        initialize: initialize,
        hasConsentForTracking: hasConsentForTracking,
        getGoogleConversionCookies: getGoogleConversionCookies
      };
      
      // Wait for DOM to be ready before initializing
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
        console.log("Waiting for DOMContentLoaded to initialize tracking");
      } else {
        // DOM is already ready
        console.log("DOM already loaded, initializing tracking immediately");
        initialize();
      }
      
      console.log("Frndly tracking script setup complete");
    })();
  `;

  return new Response(trackingScript, {
    headers: {
      'Content-Type': 'application/javascript;charset=UTF-8',
      'Cache-Control': 'public, max-age=3600',
      ...corsHeaders
    }
  });
}
