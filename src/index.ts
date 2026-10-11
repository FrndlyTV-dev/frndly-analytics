// src/index.ts
// Ingestion only: POST /track writes one data point to the Analytics Engine
// dataset frndly-analytics-db. Reporting lives in MediaPerf, which reads that
// dataset directly.

interface Env {
  ANALYTICS_ENGINE: AnalyticsEngineDataset;
  // Still bound in wrangler.json; no longer written. Removed in a later change.
  ANALYTICS_DB: D1Database;
}

type CorsHeaders = Record<string, string>;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Track endpoint
      if (path === "/track" && request.method === "POST") {
        return await handleTrack(request, env, corsHeaders);
      }

      return new Response("Not Found", { status: 404, headers: corsHeaders });
    } catch (error: any) {
      console.error("Error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          "content-type": "application/json",
          ...corsHeaders
        }
      });
    }
  }
};

// ==================== UTILITY FUNCTIONS ====================

async function generateHash(input: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input + salt);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").substring(0, 16);
}

function getDeviceType(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua)) {
    return "mobile";
  }
  if (/tablet|ipad/i.test(ua)) {
    return "tablet";
  }
  return "desktop";
}

function transformGA4ToAnalytics(ga4Data: any): any {
  if (ga4Data.url && ga4Data.event_name) {
    return ga4Data;
  }

  const analytics: any = {
    url: ga4Data.url || ga4Data.page_location || ga4Data.page_url || "",
    referrer: ga4Data.referrer || ga4Data.page_referrer,
    utm_source: ga4Data.utm_source,
    utm_medium: ga4Data.utm_medium,
    utm_campaign: ga4Data.utm_campaign,
    utm_content: ga4Data.utm_content,
    utm_term: ga4Data.utm_term,
    visitor_id: ga4Data.visitor_id || ga4Data.client_id || ga4Data.clientId,
    session_id: ga4Data.session_id || ga4Data.sessionId
  };

  const eventName = ga4Data.event_name || ga4Data.event;
  if (eventName && eventName !== "page_view") {
    analytics.event_name = eventName;

    if (eventName === "purchase" || eventName === "orderCompleted" || eventName === "resub") {  // R-1: resub uses the purchase field mapping
      analytics.event_value = ga4Data.event_value || ga4Data.value || ga4Data.transactionTotal;
      analytics.metadata = {
        transaction_id: ga4Data.transaction_id || ga4Data.transactionId,
        currency: ga4Data.currency || "USD",
        reference_id: ga4Data.reference_id || ga4Data.referenceId,
        frndly_id: ga4Data.frndly_id || ga4Data.frndlyId,
        items: ga4Data.items || ga4Data.transactionProducts || []
      };
    } else {
      analytics.event_value = ga4Data.event_value || ga4Data.value;
      analytics.metadata = ga4Data.metadata || ga4Data.params;
    }
  }

  return analytics;
}

// ==================== REQUEST HANDLERS ====================

async function handleTrack(request: Request, env: Env, corsHeaders: CorsHeaders): Promise<Response> {
  const rawData: any = await request.json();
  const data = transformGA4ToAnalytics(rawData);

  if (!data.url) {
    return new Response(JSON.stringify({ error: "URL is required" }), {
      status: 400,
      headers: { "content-type": "application/json", ...corsHeaders }
    });
  }

  const cfData = request.cf;
  const country = cfData?.country || "Unknown";
  const userAgent = request.headers.get("User-Agent") || rawData.user_agent || "";
  const deviceType = getDeviceType(userAgent);

  // Persistent visitor tracking
  const visitorSource = data.client_id || data.visitor_id || request.headers.get("CF-Connecting-IP") || "unknown";
  const sessionSource = data.session_id || `${visitorSource}-${Date.now()}`;

  const visitorHash = await generateHash(visitorSource, "persistent_v1");
  const sessionHash = await generateHash(sessionSource, "session");

  // Parse metadata for transaction details
  const metadata = data.metadata ? (typeof data.metadata === 'string' ? JSON.parse(data.metadata) : data.metadata) : {};

  // Write to Analytics Engine with visitor hash
  try {
    env.ANALYTICS_ENGINE.writeDataPoint({
      blobs: [
        data.url,                          // blob1
        data.referrer || "",               // blob2
        country,                           // blob3
        deviceType,                        // blob4
        data.utm_source || "",             // blob5
        data.utm_medium || "",             // blob6
        data.utm_campaign || "",           // blob7
        data.utm_content || "",            // blob8
        data.utm_term || "",               // blob9
        data.event_name || "pageview",     // blob10
        metadata.transaction_id || "",     // blob11 - Transaction ID
        metadata.frndly_id || "",          // blob12 - Customer ID
        metadata.reference_id || "",       // blob13 - Reference ID
        visitorHash,                       // blob14 - Persistent visitor
        metadata.currency || "USD"         // blob15
      ],
      doubles: [
        data.event_value || 0              // double1
      ],
      indexes: [sessionHash]               // Session for sampling
    });

    console.log("✅ Written to Analytics Engine");
  } catch (error) {
    console.error("❌ Analytics Engine write failed:", error);
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: {
      "content-type": "application/json",
      ...corsHeaders
    }
  });
}
