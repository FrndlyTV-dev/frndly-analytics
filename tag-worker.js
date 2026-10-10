// tag.frndlytv.com Cloudflare worker
//
// Two roles:
//   GET  -> returns the inline first-party tracker script
//   POST -> normalizes inbound events into GA4 measurement-protocol
//           and forwards to GTM Server (prod.gtm.frndlytv.com)
//
// Patch log (latest first):
//   2026-09-05  Phase 1 of CHANGE-LIST.md: domain-wide identity/session cookies,
//               _ss/_fv/seg/_s flags, gcs layout fix + undetermined-consent policy,
//               gtag ecommerce (uid/cu/pr1..N), campaign overrides only from URL,
//               synthesized _gcl_aw / _fbp / _fbc Cookie header, Preview passthrough,
//               _fbc parse fix, gbraid/wbraid capture.  (T-1..T-8, W-1..W-8)
//   2026-06-30 Add ttclid, oppref, _ttp, _fbp, _uetmsclkid capture +
//              synthetic Tapfiliate UTMs + sendPurchase idempotency guard.

addEventListener('fetch', event => {
  // Pass the FetchEvent through so handleRequest can hand background work
  // (e.g. the analytics-DB mirror) to event.waitUntil() instead of awaiting
  // it inline. That keeps the user-visible response off the critical path
  // of any downstream slowness.
  event.respondWith(handleRequest(event.request, event));
});

// Helper function to extract cookie values.
// Uses indexOf('=') rather than split('=') so cookie VALUES that contain '='
// (common with base64-padded vendor cookies) are returned intact.
function getCookieValue(request, name) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';');
  for (let cookie of cookies) {
    const trimmed = cookie.trim();
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const cookieName = trimmed.slice(0, idx);
    if (cookieName === name) {
      return trimmed.slice(idx + 1);
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

// Get all Google conversion cookies from header.
// NOTE: This sweep is Google-only on purpose. TikTok (_ttp), Facebook (_fbp),
// and Microsoft (_uetmsclkid) are read separately below so we can map them
// to the exact ep.* name each vendor tag expects.
// Uses the same indexOf('=') split as getCookieValue so values that contain
// '=' are returned whole.
function getGoogleConversionCookies(request) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return {};

  const cookies = {};
  const cookieItems = cookieHeader.split(';');

  cookieItems.forEach(cookie => {
    const trimmed = cookie.trim();
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const name = trimmed.slice(0, idx);
    const value = trimmed.slice(idx + 1);
    if (name.startsWith('_gcl_') ||
        name.startsWith('FPGCL') ||
        name.startsWith('FPLC') ||
        name.startsWith('_ga')) {
      cookies[name] = value;
    }
  });

  return cookies;
}

async function handleRequest(request, event) {
  // Define common CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, X-Gtm-Server-Preview'   // EDIT W-6
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
      if (jsonData.session_id) {
        let sidValue = String(jsonData.session_id);
        if (sidValue.length > 10) sidValue = String(Math.floor(Number(sidValue) / 1000)); // ADDED W-1: old tracker sends ms
        gaUrl += '&sid=' + sidValue;
      }

      if (jsonData.session_number)
        gaUrl += '&sct=' + jsonData.session_number;

        // ---- ADDED W-1: GA4 session semantics (absent from old cached trackers -> nothing is sent, same as today) ----
        if (jsonData.session_start === true) gaUrl += '&_ss=1';   // GA4 creates session_start -> session source/medium
        if (jsonData.first_visit === true)   gaUrl += '&_fv=1';   // GA4 creates first_visit -> new users
        if (jsonData.engaged === true)       gaUrl += '&seg=1';   // engaged session
        if (jsonData.hit_number)             gaUrl += '&_s=' + parseInt(jsonData.hit_number, 10);
        if (jsonData.debug_mode === true)    gaUrl += '&_dbg=1';  // shows the hit in GA4 DebugView (QA only)

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

      // Facebook click ID (URL or _fbc cookie)
      let fbclid = jsonData.fbclid;
      if (!fbclid) {
        const fbcCookie = getCookieValue(request, '_fbc');
        if (fbcCookie && fbcCookie.startsWith('fb.1.')) {
          const parts = fbcCookie.split('.');
          if (parts.length >= 4) {
            fbclid = parts[3];   // EDIT W-7: was parts[2] (timestamp)
          }
        }
      }
      if (fbclid) gaUrl += '&fbclid=' + encodeURIComponent(fbclid);

      // Facebook browser ID (_fbp). Used by FB CAPI for match quality even
      // when there's no click ID. Harmless to capture now; the future CAPI
      // tag will read ep.fbp directly.
      const fbp = jsonData.fbp || getCookieValue(request, '_fbp');
      if (fbp) gaUrl += '&ep.fbp=' + encodeURIComponent(fbp);

      // CJ
      const cjevent = jsonData.cjevent || getCookieValue(request, 'cjevent');
      if (cjevent) gaUrl += '&ep.cjevent=' + encodeURIComponent(cjevent);

      // Microsoft Click ID. Resolution order:
      //   1. payload (set by tracker from ?msclkid= URL param or msclkid cookie)
      //   2. msclkid cookie on tag.frndlytv.com
      //   3. _uetmsclkid cookie (Microsoft's first-party UET click-id cookie,
      //      written by the UET tag in GTM Server. Value is the raw msclkid.)
      // The Bing UET tag reads ep.msclkid, so we collapse all three sources
      // into that single output name.
      const msclkid = jsonData.msclkid
        || getCookieValue(request, 'msclkid')
        || getCookieValue(request, '_uetmsclkid');
      if (msclkid) gaUrl += '&ep.msclkid=' + encodeURIComponent(msclkid);

      // TikTok click ID
      const ttclid = jsonData.ttclid || getCookieValue(request, 'ttclid');
      if (ttclid) gaUrl += '&ep.ttclid=' + encodeURIComponent(ttclid);

      // TikTok first-party browser ID (_ttp). Set by any TikTok pixel the
      // user previously encountered on .frndlytv.com. Server-side TikTok
      // Events API tag in GTM reads ep.ttp (no underscore), so we strip it.
      const ttp = jsonData.ttp || getCookieValue(request, '_ttp');
      if (ttp) gaUrl += '&ep.ttp=' + encodeURIComponent(ttp);

      // OpenAI Ads click ID
      const oppref = jsonData.oppref || getCookieValue(request, 'oppref');
      if (oppref) gaUrl += '&ep.oppref=' + encodeURIComponent(oppref);

      // Tapfiliate
      const ref = jsonData.ref || getCookieValue(request, 'ref');
      if (ref) gaUrl += '&ep.ref=' + encodeURIComponent(ref);

      // UTM parameters.
      // NOTE: jsonData.utm_* may have been synthesized client-side from ref
      // when no real UTMs were present (see getUrlParams in the tracker).
      // Real UTMs from the user's landing URL still win because the tracker
      // only synthesizes into empty slots.
      // W-4: only emit gtag campaign OVERRIDES when the tracker says the UTMs are in the current page URL;
      // otherwise GA4 attributes from dl/dr like gtag does. Old cached trackers keep today's behaviour.
      if (jsonData.campaign_from_url !== false) {   // ADDED W-4
        if (jsonData.utm_source) gaUrl += '&cs=' + encodeURIComponent(jsonData.utm_source);
        if (jsonData.utm_medium) gaUrl += '&cm=' + encodeURIComponent(jsonData.utm_medium);
        if (jsonData.utm_campaign) gaUrl += '&cn=' + encodeURIComponent(jsonData.utm_campaign);
        if (jsonData.utm_content) gaUrl += '&cc=' + encodeURIComponent(jsonData.utm_content);
        if (jsonData.utm_term) gaUrl += '&ck=' + encodeURIComponent(jsonData.utm_term);
      }

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
      const UNDETERMINED_CONSENT_DEFAULT = 'granted';   // W-2 policy: 'granted' (opt-out model, matches the CMP) or 'denied'
      if (jsonData.consent_mode && typeof jsonData.consent_mode === 'object') {
        let adGranted = jsonData.consent_mode.ad_storage === 'granted';
        let analyticsGranted = jsonData.consent_mode.analytics_storage === 'granted';

        // ADDED W-2: visitor has not decided yet (CMP method === null) and no GPC -> apply policy
        if (jsonData.consent_determined === false && jsonData.gpc !== true && UNDETERMINED_CONSENT_DEFAULT === 'granted') {
          adGranted = true;
          analyticsGranted = true;
        }

        // EDIT W-2: Google's format is G1 + ad_storage + analytics_storage (was 'G' + analytics + ad + personalization)
        const gcsValue = 'G1' + (adGranted ? '1' : '0') + (analyticsGranted ? '1' : '0');
        gaUrl += '&gcs=' + gcsValue;

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

        // ---- ADDED W-3: gtag-format ecommerce so the GA4 client builds a real items[] (and every vendor tag can read it) ----
        // W-12: do NOT send uid to GA4. user_id is only known on the purchase hit; under GA4's Blended/Observed
        // reporting identity a uid-bearing hit becomes a different user than the session_start hit, so every
        // purchase landed in a session with no source "(not set)". user_id still reaches the GTM server as
        // ep.user_id (it is inside jsonData.params), so vendor tags keep it.
        const GA4_SEND_USER_ID = false;
        if (GA4_SEND_USER_ID && (jsonData.user_id || jsonData.userId)) {
          gaUrl += '&uid=' + encodeURIComponent(jsonData.user_id || jsonData.userId);
        }
        
        gaUrl += '&cu=' + encodeURIComponent(jsonData.currency || 'USD');
        let prItems = jsonData.items || jsonData.transactionProducts;
        if (typeof prItems === 'string') { try { prItems = JSON.parse(prItems); } catch (e) { prItems = null; } }
        if (Array.isArray(prItems)) {
          const clean = (v) => String(v).replace(/~/g, '-');
          prItems.forEach((item, index) => {
            const f = [];
            const itemId = item.id !== undefined ? item.id : item.item_id;
            const itemName = item.name || item.item_name;
            const itemCat = item.category || item.item_category;
            const itemVar = item.sku !== undefined ? item.sku : item.item_variant;
            if (itemId !== undefined) f.push('id' + clean(itemId));
            if (itemName) f.push('nm' + clean(itemName));
            if (itemCat) f.push('ca' + clean(itemCat));
            if (itemVar !== undefined) f.push('va' + clean(itemVar));
            if (item.price !== undefined) f.push('pr' + clean(item.price));
            f.push('qt' + clean(item.quantity || 1));
            gaUrl += '&pr' + (index + 1) + '=' + encodeURIComponent(f.join('~'));
          });
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

      // ---- ADDED W-5: first-party cookies for Google/Meta server tags + Preview passthrough ----
      const cookieParts = [];
      const ownGclAw = jsonData.google_conversion_cookies && jsonData.google_conversion_cookies._gcl_aw; // tracker's "1.<ms>.<gclid>"
      const gclidForCookie = jsonData.gclid || extractGclidFromCookie(ownGclAw);
      if (gclidForCookie) {
        let clickTs = Math.floor(Date.now() / 1000);
        if (ownGclAw) {
          const seg = ownGclAw.split('.');
          if (seg.length >= 3 && /^\d{13}$/.test(seg[1])) clickTs = Math.floor(parseInt(seg[1], 10) / 1000);
        }
        cookieParts.push('_gcl_aw=GCL.' + clickTs + '.' + gclidForCookie);
      }
      if (jsonData.fbp) cookieParts.push('_fbp=' + jsonData.fbp);
      if (jsonData.fbc) cookieParts.push('_fbc=' + jsonData.fbc);
      const incomingCookie = request.headers.get('Cookie');        // only present once the tracker sends credentials (W-11)
      if (incomingCookie) cookieParts.push(incomingCookie);

      const outboundHeaders = {
        'User-Agent': userAgent,
        'X-Forwarded-For': ipAddress,
        'Origin': origin,
        'Referer': jsonData.page_location || jsonData.page_url || request.headers.get('Referer') || origin,
        'Accept-Language': language
      };
      if (cookieParts.length) outboundHeaders['Cookie'] = cookieParts.join('; ');
      const previewToken = request.headers.get('X-Gtm-Server-Preview');   // lets sGTM Preview see browser-originated hits
      if (previewToken) outboundHeaders['X-Gtm-Server-Preview'] = previewToken;

      console.log('GA4 URL:', gaUrl.replace(/cid=[^&]+/, 'cid=...'));   // ADDED W-8: search Workers Logs for "_ss=1", "gcs=G1", "pr1="

      // Forward to GTM Server with POST method
      const proxyResponse = await fetch(gaUrl, {
        method: 'POST',
        headers: outboundHeaders          // EDIT W-5: was the inline headers object
      });

      // Log the response for debugging
      const responseStatus = proxyResponse.status;
      const responseText = await proxyResponse.text();
      console.log(`GA4 response: ${responseStatus}`, responseText);

      // ALSO send to our analytics database.
      // Handed to event.waitUntil() so the user-visible response returns
      // immediately. If the analytics worker is slow or down, the tracker
      // client never waits on it. The Promise still resolves in background
      // and the Worker stays alive until it does.
      const analyticsData = JSON.stringify(jsonData);
      console.log('Sending to analytics:', analyticsData.substring(0, 200));

      const analyticsMirror = fetch('https://frndly-analytics.chris-0b8.workers.dev/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: analyticsData
      })
        .then(async (analyticsResponse) => {
          console.log('Analytics response:', analyticsResponse.status);
          try {
            const analyticsResult = await analyticsResponse.json();
            console.log('Analytics result:', analyticsResult);
          } catch (e) {
            // Non-JSON response is fine; just log status.
          }
        })
        .catch(err => console.error('Analytics error:', err));

      if (event && typeof event.waitUntil === 'function') {
        event.waitUntil(analyticsMirror);
      }

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

      // One-time init guard. If the tracker is included twice on the same
      // page (the second hypothesized cause of duplicate purchase events),
      // the second IIFE invocation bails out before installing duplicate
      // click/form/dataLayer listeners or sending a duplicate page_view.
      // This is the structural fix; the per-transaction Set below is the
      // belt-and-suspenders fallback for the intra-instance double path.
      if (window.__frndlyTrackingInit) {
        console.warn("Frndly tracking script already initialized; skipping duplicate include.");
        return;
      }
      window.__frndlyTrackingInit = true;

      // Use hardcoded endpoint instead of dynamic detection
      var workerEndpoint = "https://tag.frndlytv.com";

      console.log("Worker endpoint determined:", workerEndpoint);

      // Idempotency guard for purchase events.
      // The confirmation page has been observed firing the same transaction
      // twice within 20-50ms. Two known causes:
      //   1. setupDataLayerMonitoring iterating existing dataLayer entries
      //      AND its push wrapper firing for the same confirmation event.
      //   2. A double-include of this script (now blocked above).
      // The four vendor conversion tags all dedupe server-side on
      // transaction_id, but GA4 measurement-protocol has no event-level
      // dedupe key, so duplicates inflate purchase counts. The Set lives on
      // window so even if the init guard ever regresses, two IIFEs share the
      // same dedupe state. Also persisted to sessionStorage so a hard
      // refresh of the confirmation page doesn't re-fire (transaction_id is
      // stable; sessionStorage clears when the tab closes).
      window.__frndlyFiredTxns = window.__frndlyFiredTxns || new Set();
      try {
        var persisted = sessionStorage.getItem('frndly_fired_txns');
        if (persisted) {
          JSON.parse(persisted).forEach(function(id) { window.__frndlyFiredTxns.add(id); });
        }
      } catch (e) {
        console.warn("Could not hydrate fired-txn cache from sessionStorage:", e);
      }
      var firedTransactionIds = window.__frndlyFiredTxns;
      function persistFiredTxns() {
        try {
          sessionStorage.setItem('frndly_fired_txns', JSON.stringify(Array.from(firedTransactionIds)));
        } catch (e) {
          // Quota or disabled storage; in-memory Set still works for this page.
        }
      }

      // ---- ADDED T-1: domain-wide cookie helpers (identity + session live on .frndlytv.com) ----
      var FP_COOKIE_DOMAIN = '.frndlytv.com';
      var campaignFromUrl = false;        // set by getUrlParams() when a utm_* is in the current URL
      var firstVisitPending = false;      // set by getClientId() only when a new id is minted
      var hitCounter = 0;                 // per page load, becomes _s

      function fpReadCookie(name) {
        var parts = document.cookie.split(';');
        for (var i = 0; i < parts.length; i++) {
          var p = parts[i].trim();
          if (p.indexOf(name + '=') === 0) {
            try { return decodeURIComponent(p.slice(name.length + 1)); } catch (e) { return p.slice(name.length + 1); }
          }
        }
        return null;
      }
      function fpWriteCookie(name, value, maxAgeSeconds) {
        document.cookie = name + '=' + encodeURIComponent(value) +
          '; domain=' + FP_COOKIE_DOMAIN + '; path=/; max-age=' + maxAgeSeconds + '; SameSite=Lax; Secure';
      }

      // Generate a client ID if not already present
      function getClientId() {
        var storageKey = 'ga_client_id';
        var cookieName = '_fpcid';                                  // ADDED T-2
        var fromCookie = fpReadCookie(cookieName);                  // ADDED T-2
        var existingId = null;
        try { existingId = localStorage.getItem(storageKey); } catch (e) {}
        var id = fromCookie || existingId;                          // ADDED T-2: cookie wins, localStorage migrates once
        if (!id) {
          id = Math.floor(Math.random() * 1000000000) + '.' + Math.floor(Date.now() / 1000);
          firstVisitPending = true;                                 // ADDED T-2: this hit gets _fv=1
        }
        fpWriteCookie(cookieName, id, 63072000);                    // ADDED T-2: 2 years, refreshed on every call
        try { localStorage.setItem(storageKey, id); } catch (e) {}  // kept: existing storage stays in sync
        return id;
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
      // T-3: domain-wide cookie, seconds, session_start/engaged flags
      function getSessionInfo(eventType) {
        var sessionTimeout = 30 * 60 * 1000;
        var now = Date.now();
        var cookieName = '_fpsess';
        // cookie value: <sid_seconds>.<session_number>.<last_activity_ms>.<engaged 0|1>.<pageviews>
        var raw = fpReadCookie(cookieName);
        var st = raw ? raw.split('.') : [];
        var sid = parseInt(st[0] || '0', 10);
        var sct = parseInt(st[1] || '0', 10);
        var last = parseInt(st[2] || '0', 10);
        var engaged = st[3] === '1';
        var pageviews = parseInt(st[4] || '0', 10);
        var sessionStart = false;

        if (!raw) {
          // migration: keep the visitor's old per-origin session count if we have one
          try { sct = parseInt(localStorage.getItem('ga_session_count') || '0', 10); } catch (e) {}
        }
        if (!sid || (now - last > sessionTimeout)) {
          sid = Math.floor(now / 1000);          // seconds, like gtag's ga_session_id
          sct = sct + 1;
          engaged = false;
          pageviews = 0;
          sessionStart = true;                    // -> worker sends _ss=1 on this hit
        }
        if (eventType === 'page_view') pageviews += 1;
        if (!engaged && (pageviews >= 2 || eventType === 'purchase' || (now - sid * 1000) >= 10000)) {
          engaged = true;                         // -> worker sends seg=1 from this hit on
        }

        fpWriteCookie(cookieName, [sid, sct, now, engaged ? 1 : 0, pageviews].join('.'), 1800); // 30-min sliding

        // kept for compatibility with anything that reads the old keys
        try {
          sessionStorage.setItem('ga_session_id', String(sid));
          sessionStorage.setItem('ga_last_activity', String(now));
          localStorage.setItem('ga_session_count', String(sct));
        } catch (e) {}

        return { session_id: sid, session_number: sct, session_start: sessionStart, engaged: engaged };
      }

      // Get all Google conversion cookies (client-side sweep, mirrors the
      // worker's getGoogleConversionCookies). _ttp / _fbp are handled by the
      // worker reading the Cookie header on the POST, not surfaced here.
      function getGoogleConversionCookies() {
        var cookies = {};

        document.cookie.split(';').forEach(function(cookie) {
          var parts = cookie.trim().split('=');
          var name = parts[0];
          var value = parts.slice(1).join('='); // Handle values that might contain =

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
        campaignFromUrl = false;                                        // ADDED T-6

        // Campaign parameters captured on landing and persisted to first-party
        // cookies on .frndlytv.com. ttclid (TikTok) and oppref (OpenAI Ads)
        // were added 2026-06-30 so the server-side TikTok Events API and
        // OpenAI conversion tags receive the click ID on every subsequent
        // event, not just the landing pageview.
        var campaignParams = [
          'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
          'gclid', 'fbclid', 'cjevent', 'msclkid', 'ref', 'ttclid', 'oppref',
          'gbraid', 'wbraid'                                           // ADDED T-6
        ];

        campaignParams.forEach(function(param) {
          var value = urlParams.get(param);
          if (value) {
            result[param] = value;
            if (param.indexOf('utm_') === 0) campaignFromUrl = true;    // ADDED T-6

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
              // ttclid, oppref, ref, msclkid, cjevent, utm_* all use this
              // plain raw-value branch. No special cookie envelope required.
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
                if (parts.length >= 4) {
                  result[param] = parts[3]; // EDIT T-7: was parts[2] (that is the timestamp)
                }
              }
            }
          }
        });

        // Synthetic Tapfiliate UTMs.
        // Affiliate traffic arrives with ?ref=<affiliate_code> but no UTMs,
        // so GA4 attributes those sessions to "(direct) / (none)". Synthesize
        // utm_source=tapfiliate / utm_medium=affiliate / utm_campaign=<ref>
        // into any slot that is still empty.
        //
        // Attribution-bleed guard: only synthesize when no competing paid
        // click ID is present in the resolved params. Otherwise a user who
        // landed via affiliate 30 days ago and comes back today via Google
        // Ads (gclid) would still get "tapfiliate/affiliate" stamped on
        // their events, crediting affiliate for a Google-driven conversion.
        // The ref cookie lives for 90 days, so without this guard the
        // synthesis would fire on every event for those 90 days.
        //
        // Real UTMs (from the current URL or a prior-session cookie) were
        // populated above and also win because we only fill blanks here.
        // Do NOT persist these synthetic values to cookies.
        var hasCompetingClickId = !!(result.gclid || result.gbraid || result.wbraid || result.fbclid || result.msclkid || result.ttclid || result.oppref);   // EDIT T-6
        if (result.ref && !hasCompetingClickId) {
          if (!result.utm_source) result.utm_source = 'tapfiliate';
          if (!result.utm_medium) result.utm_medium = 'affiliate';
          if (!result.utm_campaign) result.utm_campaign = result.ref;
        }

        return result;
      }

      // Send event to GA4 via server GTM
      function sendEvent(eventType, eventParams, userProperties, rootFields) {   // EDIT T-4: optional 4th arg
        // Get session information
        var sessionInfo = getSessionInfo(eventType);   // EDIT T-4: was getSessionInfo()
        hitCounter += 1;                               // ADDED T-4

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

          // URL parameters (UTM, etc.) -- includes synthetic Tapfiliate UTMs
          // when ref is present and the real slots are empty.
          ...getUrlParams(),

          // ---- ADDED T-4: GA4 session semantics + consent context (worker maps these) ----
          session_start: sessionInfo.session_start,     // -> _ss=1
          engaged: sessionInfo.engaged,                 // -> seg=1
          first_visit: firstVisitPending,               // -> _fv=1 (true only on the minting hit)
          hit_number: hitCounter,                       // -> _s
          consent_determined: consentIsDetermined(),    // false until the CMP has a decision
          gpc: hasGpcSignal(),
          campaign_from_url: campaignFromUrl,           // true only when utm_* came from this page's URL
          fbc: fpReadCookie('_fbc') || undefined,       // Meta match keys, forwarded as cookies by the worker
          fbp: fpReadCookie('_fbp') || undefined,

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

        // ADDED T-4: optional root-level fields (used by sendPurchase so the worker's purchase block sees them)
        if (rootFields && typeof rootFields === 'object') {
          for (var rk in rootFields) { if (rootFields[rk] !== undefined) payload[rk] = rootFields[rk]; }
        }
        firstVisitPending = false;   // ADDED T-4: only the first hit carries first_visit

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

      // ---- ADDED T-5: distinguish "no decision yet" from "explicit reject"; detect GPC ----
      function consentIsDetermined() {
        try {
          if (window.PrivacyConsent && window.PrivacyConsent.getConsent) {
            var c = window.PrivacyConsent.getConsent();
            return !!(c && c.method);   // CMP keeps method === null until accept / reject / 25% scroll
          }
        } catch (e) {}
        return false;
      }
      function hasGpcSignal() {
        try {
          if (navigator.globalPrivacyControl === true) return true;
          return fpReadCookie('frndly_privacy_doNotSell') === 'true';
        } catch (e) { return false; }
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

        // Idempotency guard. Resolve transaction_id once, then short-circuit
        // if we've already fired it from this page lifetime. Vendor tags
        // dedupe server-side (Tapfiliate external_id, OpenAI id, TikTok
        // event_id, Bing UET rn) but GA4 measurement-protocol has no
        // event-level dedupe key, so duplicate sends count as real purchases.
        var resolvedTxnId = transactionData.transactionId || transactionData.transaction_id;
        if (resolvedTxnId) {
          if (firedTransactionIds.has(resolvedTxnId)) {
            console.warn('Duplicate purchase suppressed for transaction_id:', resolvedTxnId);
            return Promise.resolve({ success: true, deduped: true, transaction_id: resolvedTxnId });
          }
          firedTransactionIds.add(resolvedTxnId);
          persistFiredTxns();
        } else {
          // No transaction_id means we cannot dedupe. Log loudly but still
          // send, so we don't silently drop a real conversion.
          console.warn('Purchase event has no transaction_id; cannot dedupe.');
        }

        // Clone the data to avoid modifying the original
        const purchaseData = {
          event: 'purchase',
          transaction_id: resolvedTxnId,
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
        // EDIT T-8: also expose the transaction at the payload root (worker purchase block reads root fields)
        return sendEvent('purchase', purchaseData, undefined, {
          transaction_id: purchaseData.transaction_id,
          value: purchaseData.value,
          currency: purchaseData.currency,
          reference_id: purchaseData.reference_id,
          frndly_id: purchaseData.frndly_id,
          items: purchaseData.items,
          user_id: purchaseData.user_id
        });
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

      // Monitor the dataLayer for purchase events.
      // sendPurchase() now dedupes by transaction_id, so the two known dup
      // paths (existing dataLayer entry + push-wrapped future event, or a
      // double-included script tag) are both safe.
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
