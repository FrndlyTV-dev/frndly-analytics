// src/index.ts
export default {
  async fetch(request, env) {
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

      // Basic stats endpoint
      if (path === "/api/stats" && request.method === "GET") {
        return await handleStats(request, env, corsHeaders);
      }

      // Enhanced analytics endpoint
      if (path === "/api/analytics" && request.method === "GET") {
        return await handleEnhancedAnalytics(request, env, corsHeaders);
      }

      // Revenue endpoint
      if (path === "/api/revenue" && request.method === "GET") {
        return await handleRevenue(request, env, corsHeaders);
      }

      // Campaign attribution endpoint
      if (path === "/api/campaigns" && request.method === "GET") {
        return await handleCampaigns(request, env, corsHeaders);
      }

      // Hourly stats endpoint
      if (path === "/api/hourly" && request.method === "GET") {
        return await handleHourly(request, env, corsHeaders);
      }

      // Orders endpoint
      if (path === "/api/orders" && request.method === "GET") {
        return await handleOrders(request, env, corsHeaders);
      }

      // Export endpoint (CSV)
      if (path === "/api/export" && request.method === "GET") {
        return await handleExport(request, env, corsHeaders);
      }

      // Dashboard HTML
      if ((path === "/" || path === "/analytics") && request.method === "GET") {
        return new Response(renderEnhancedDashboard(), {
          headers: {
            "content-type": "text/html",
            ...corsHeaders
          }
        });
      }

      return new Response("Not Found", { status: 404, headers: corsHeaders });
    } catch (error) {
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

async function generateHash(input, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input + salt);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").substring(0, 16);
}

function getCurrentDateSalt() {
  const now = new Date();
  return now.toISOString().split("T")[0].replace(/-/g, "");
}

function getDeviceType(userAgent) {
  const ua = userAgent.toLowerCase();
  if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua)) {
    return "mobile";
  }
  if (/tablet|ipad/i.test(ua)) {
    return "tablet";
  }
  return "desktop";
}

function transformGA4ToAnalytics(ga4Data) {
  if (ga4Data.url && ga4Data.event_name) {
    return ga4Data;
  }

  const analytics = {
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
    
    if (eventName === "purchase" || eventName === "orderCompleted") {
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

async function handleTrack(request, env, corsHeaders) {
  const rawData = await request.json();
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
  
  // ✅ FIXED: Persistent visitor tracking
  const visitorSource = data.client_id || data.visitor_id || request.headers.get("CF-Connecting-IP") || "unknown";
  const sessionSource = data.session_id || `${visitorSource}-${Date.now()}`;
  
  const visitorHash = await generateHash(visitorSource, "persistent_v1");
  const sessionHash = await generateHash(sessionSource, "session");
  
  const timestamp = Math.floor(Date.now() / 1000);

  // Parse metadata for transaction details
  const metadata = data.metadata ? (typeof data.metadata === 'string' ? JSON.parse(data.metadata) : data.metadata) : {};
  
  // ✅ Write to Analytics Engine with visitor hash
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
        visitorHash,                       // blob14 - ⭐ Persistent visitor
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

  // ============================================
  // EXISTING: WRITE TO D1 (keep as backup)
  // ============================================
  
  // Insert event if present
  if (data.event_name) {
    const eventStmt = env.ANALYTICS_DB.prepare(`
      INSERT INTO events (timestamp, event_name, event_value, metadata, url, country, device_type, visitor_hash, session_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    await eventStmt.bind(
      timestamp,
      data.event_name,
      data.event_value || null,
      data.metadata ? JSON.stringify(data.metadata) : null,
      data.url,
      country,
      deviceType,
      visitorHash,
      sessionHash
    ).run();
  }

  // Insert pageview
  const pageviewStmt = env.ANALYTICS_DB.prepare(`
    INSERT INTO pageviews (timestamp, url, referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term, country, device_type, visitor_hash, session_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  await pageviewStmt.bind(
    timestamp,
    data.url,
    data.referrer || null,
    data.utm_source || null,
    data.utm_medium || null,
    data.utm_campaign || null,
    data.utm_content || null,
    data.utm_term || null,
    country,
    deviceType,
    visitorHash,
    sessionHash
  ).run();

  return new Response(JSON.stringify({ success: true }), {
    headers: {
      "content-type": "application/json",
      ...corsHeaders
    }
  });
}

async function handleStats(request, env, corsHeaders) {
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get("days") || "7");
  const startTimestamp = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);

  const pageviewsResult = await env.ANALYTICS_DB.prepare(`
    SELECT COUNT(*) as count FROM pageviews WHERE timestamp >= ?
  `).bind(startTimestamp).first();

  const visitorsResult = await env.ANALYTICS_DB.prepare(`
    SELECT COUNT(DISTINCT visitor_hash) as count FROM pageviews WHERE timestamp >= ?
  `).bind(startTimestamp).first();

  const sessionsResult = await env.ANALYTICS_DB.prepare(`
    SELECT COUNT(DISTINCT session_hash) as count FROM pageviews WHERE timestamp >= ?
  `).bind(startTimestamp).first();

  const topPages = await env.ANALYTICS_DB.prepare(`
    SELECT url, COUNT(*) as views
    FROM pageviews
    WHERE timestamp >= ?
    GROUP BY url
    ORDER BY views DESC
    LIMIT 10
  `).bind(startTimestamp).all();

  const topReferrers = await env.ANALYTICS_DB.prepare(`
    SELECT referrer, COUNT(*) as views
    FROM pageviews
    WHERE timestamp >= ? AND referrer IS NOT NULL AND referrer != ''
    GROUP BY referrer
    ORDER BY views DESC
    LIMIT 10
  `).bind(startTimestamp).all();

  const topCountries = await env.ANALYTICS_DB.prepare(`
    SELECT country, COUNT(*) as views
    FROM pageviews
    WHERE timestamp >= ?
    GROUP BY country
    ORDER BY views DESC
    LIMIT 10
  `).bind(startTimestamp).all();

  const deviceBreakdown = await env.ANALYTICS_DB.prepare(`
    SELECT device_type, COUNT(*) as views
    FROM pageviews
    WHERE timestamp >= ?
    GROUP BY device_type
    ORDER BY views DESC
  `).bind(startTimestamp).all();

  const utmSources = await env.ANALYTICS_DB.prepare(`
    SELECT utm_source, COUNT(*) as views
    FROM pageviews
    WHERE timestamp >= ? AND utm_source IS NOT NULL
    GROUP BY utm_source
    ORDER BY views DESC
    LIMIT 10
  `).bind(startTimestamp).all();

  const eventsResult = await env.ANALYTICS_DB.prepare(`
    SELECT event_name, COUNT(*) as count, SUM(event_value) as total_value
    FROM events
    WHERE timestamp >= ?
    GROUP BY event_name
    ORDER BY count DESC
  `).bind(startTimestamp).all();

  const stats = {
    period: {
      days,
      start: new Date(startTimestamp * 1000).toISOString(),
      end: new Date().toISOString()
    },
    overview: {
      pageviews: pageviewsResult?.count || 0,
      visitors: visitorsResult?.count || 0,
      sessions: sessionsResult?.count || 0
    },
    topPages: topPages.results || [],
    topReferrers: topReferrers.results || [],
    topCountries: topCountries.results || [],
    deviceBreakdown: deviceBreakdown.results || [],
    utmSources: utmSources.results || [],
    events: eventsResult.results || []
  };

  return new Response(JSON.stringify(stats, null, 2), {
    headers: {
      "content-type": "application/json",
      ...corsHeaders
    }
  });
}

async function handleEnhancedAnalytics(request, env, corsHeaders) {
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get("days") || "7");
  const startTimestamp = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);

  // Get daily breakdown
  const dailyStats = await env.ANALYTICS_DB.prepare(`
    SELECT 
      DATE(timestamp, 'unixepoch') as date,
      COUNT(*) as pageviews,
      COUNT(DISTINCT visitor_hash) as visitors,
      COUNT(DISTINCT session_hash) as sessions
    FROM pageviews
    WHERE timestamp >= ?
    GROUP BY date
    ORDER BY date ASC
  `).bind(startTimestamp).all();

  // Get hourly breakdown (last 24 hours)
  const last24h = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
  const hourlyStats = await env.ANALYTICS_DB.prepare(`
    SELECT 
      strftime('%Y-%m-%d %H:00:00', timestamp, 'unixepoch') as hour,
      COUNT(*) as pageviews,
      COUNT(DISTINCT visitor_hash) as visitors
    FROM pageviews
    WHERE timestamp >= ?
    GROUP BY hour
    ORDER BY hour ASC
  `).bind(last24h).all();

  // Get device breakdown
  const deviceStats = await env.ANALYTICS_DB.prepare(`
    SELECT device_type, COUNT(*) as count
    FROM pageviews
    WHERE timestamp >= ?
    GROUP BY device_type
  `).bind(startTimestamp).all();

  // Get country breakdown
  const countryStats = await env.ANALYTICS_DB.prepare(`
    SELECT country, COUNT(*) as count
    FROM pageviews
    WHERE timestamp >= ?
    GROUP BY country
    ORDER BY count DESC
    LIMIT 10
  `).bind(startTimestamp).all();

  return new Response(JSON.stringify({
    daily: dailyStats.results || [],
    hourly: hourlyStats.results || [],
    devices: deviceStats.results || [],
    countries: countryStats.results || []
  }, null, 2), {
    headers: {
      "content-type": "application/json",
      ...corsHeaders
    }
  });
}

async function handleRevenue(request, env, corsHeaders) {
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get("days") || "7");
  const startTimestamp = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);

  // Daily revenue
  const dailyRevenue = await env.ANALYTICS_DB.prepare(`
    SELECT 
      DATE(timestamp, 'unixepoch') as date,
      COUNT(*) as orders,
      SUM(event_value) as revenue,
      AVG(event_value) as avg_order_value
    FROM events
    WHERE timestamp >= ?
      AND event_name IN ('purchase', 'orderCompleted')
      AND event_value IS NOT NULL
    GROUP BY date
    ORDER BY date ASC
  `).bind(startTimestamp).all();

  // Revenue by source
  const revenueBySource = await env.ANALYTICS_DB.prepare(`
    SELECT 
      COALESCE(p.utm_source, 'Direct') as source,
      COUNT(DISTINCT e.id) as orders,
      SUM(e.event_value) as revenue,
      AVG(e.event_value) as avg_order_value
    FROM events e
    LEFT JOIN (
      SELECT DISTINCT session_hash, utm_source 
      FROM pageviews 
      WHERE timestamp >= ?
    ) p ON e.session_hash = p.session_hash
    WHERE e.timestamp >= ?
      AND e.event_name IN ('purchase', 'orderCompleted')
      AND e.event_value IS NOT NULL
    GROUP BY source
    ORDER BY revenue DESC
  `).bind(startTimestamp, startTimestamp).all();

  // Total stats
  const totalStats = await env.ANALYTICS_DB.prepare(`
    SELECT 
      COUNT(*) as total_orders,
      SUM(event_value) as total_revenue,
      AVG(event_value) as avg_order_value
    FROM events
    WHERE timestamp >= ?
      AND event_name IN ('purchase', 'orderCompleted')
      AND event_value IS NOT NULL
  `).bind(startTimestamp).first();

  // Conversion rate
  const conversionRate = await env.ANALYTICS_DB.prepare(`
    SELECT 
      COUNT(DISTINCT p.session_hash) as total_sessions,
      COUNT(DISTINCT e.session_hash) as converted_sessions
    FROM pageviews p
    LEFT JOIN events e ON p.session_hash = e.session_hash 
      AND e.event_name IN ('purchase', 'orderCompleted')
    WHERE p.timestamp >= ?
  `).bind(startTimestamp).first();

  const convRate = conversionRate.total_sessions > 0 
    ? (conversionRate.converted_sessions / conversionRate.total_sessions * 100).toFixed(2)
    : 0;

  return new Response(JSON.stringify({
    overview: {
      total_revenue: totalStats?.total_revenue || 0,
      total_orders: totalStats?.total_orders || 0,
      avg_order_value: totalStats?.avg_order_value || 0,
      conversion_rate: convRate
    },
    daily: dailyRevenue.results || [],
    by_source: revenueBySource.results || []
  }, null, 2), {
    headers: {
      "content-type": "application/json",
      ...corsHeaders
    }
  });
}

async function handleCampaigns(request, env, corsHeaders) {
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get("days") || "7");
  const startTimestamp = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);

  // Campaign performance with attribution
  const campaignPerformance = await env.ANALYTICS_DB.prepare(`
    SELECT 
      p.utm_source,
      p.utm_medium,
      p.utm_campaign,
      COUNT(DISTINCT p.session_hash) as sessions,
      COUNT(DISTINCT e.session_hash) as conversions,
      SUM(e.event_value) as revenue,
      AVG(e.event_value) as avg_order_value,
      ROUND(COUNT(DISTINCT e.session_hash) * 100.0 / COUNT(DISTINCT p.session_hash), 2) as conversion_rate
    FROM pageviews p
    LEFT JOIN events e ON p.session_hash = e.session_hash 
      AND e.event_name IN ('purchase', 'orderCompleted')
      AND e.timestamp >= ?
    WHERE p.timestamp >= ?
      AND p.utm_campaign IS NOT NULL
    GROUP BY p.utm_source, p.utm_medium, p.utm_campaign
    ORDER BY revenue DESC
  `).bind(startTimestamp, startTimestamp).all();

  // Daily campaign revenue
  const dailyCampaignRevenue = await env.ANALYTICS_DB.prepare(`
    SELECT 
      DATE(e.timestamp, 'unixepoch') as date,
      p.utm_campaign,
      p.utm_source,
      COUNT(*) as orders,
      SUM(e.event_value) as revenue
    FROM events e
    JOIN (
      SELECT DISTINCT session_hash, utm_campaign, utm_source
      FROM pageviews
      WHERE timestamp >= ? AND utm_campaign IS NOT NULL
    ) p ON e.session_hash = p.session_hash
    WHERE e.timestamp >= ?
      AND e.event_name IN ('purchase', 'orderCompleted')
      AND e.event_value IS NOT NULL
    GROUP BY date, p.utm_campaign, p.utm_source
    ORDER BY date ASC, revenue DESC
  `).bind(startTimestamp, startTimestamp).all();

  // First touch attribution
  const firstTouchAttribution = await env.ANALYTICS_DB.prepare(`
    WITH first_touch AS (
      SELECT 
        session_hash,
        utm_source,
        utm_campaign,
        MIN(timestamp) as first_visit
      FROM pageviews
      WHERE timestamp >= ? AND utm_campaign IS NOT NULL
      GROUP BY session_hash
    )
    SELECT 
      ft.utm_source,
      ft.utm_campaign,
      COUNT(DISTINCT e.session_hash) as conversions,
      SUM(e.event_value) as attributed_revenue
    FROM first_touch ft
    JOIN events e ON ft.session_hash = e.session_hash
    WHERE e.event_name IN ('purchase', 'orderCompleted')
      AND e.event_value IS NOT NULL
    GROUP BY ft.utm_source, ft.utm_campaign
    ORDER BY attributed_revenue DESC
  `).bind(startTimestamp).all();

  return new Response(JSON.stringify({
    campaigns: campaignPerformance.results || [],
    daily_campaign_revenue: dailyCampaignRevenue.results || [],
    first_touch_attribution: firstTouchAttribution.results || []
  }, null, 2), {
    headers: {
      "content-type": "application/json",
      ...corsHeaders
    }
  });
}

async function handleHourly(request, env, corsHeaders) {
  const last24h = Math.floor(Date.now() / 1000) - (24 * 60 * 60);

  // Hourly pageviews and visitors
  const hourlyStats = await env.ANALYTICS_DB.prepare(`
    SELECT 
      strftime('%Y-%m-%d %H:00:00', timestamp, 'unixepoch') as hour,
      COUNT(*) as pageviews,
      COUNT(DISTINCT visitor_hash) as visitors,
      COUNT(DISTINCT session_hash) as sessions
    FROM pageviews
    WHERE timestamp >= ?
    GROUP BY hour
    ORDER BY hour ASC
  `).bind(last24h).all();

  // Hourly orders and revenue
  const hourlyRevenue = await env.ANALYTICS_DB.prepare(`
    SELECT 
      strftime('%Y-%m-%d %H:00:00', timestamp, 'unixepoch') as hour,
      COUNT(*) as orders,
      SUM(event_value) as revenue
    FROM events
    WHERE timestamp >= ?
      AND event_name IN ('purchase', 'orderCompleted')
      AND event_value IS NOT NULL
    GROUP BY hour
    ORDER BY hour ASC
  `).bind(last24h).all();

  // Peak hours
  const peakHours = await env.ANALYTICS_DB.prepare(`
    SELECT 
      strftime('%H:00', timestamp, 'unixepoch') as hour_of_day,
      COUNT(*) as pageviews,
      COUNT(DISTINCT visitor_hash) as visitors
    FROM pageviews
    WHERE timestamp >= ?
    GROUP BY hour_of_day
    ORDER BY pageviews DESC
    LIMIT 5
  `).bind(last24h).all();

  return new Response(JSON.stringify({
    hourly_stats: hourlyStats.results || [],
    hourly_revenue: hourlyRevenue.results || [],
    peak_hours: peakHours.results || []
  }, null, 2), {
    headers: {
      "content-type": "application/json",
      ...corsHeaders
    }
  });
}

async function handleOrders(request, env, corsHeaders) {
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get("days") || "7");
  const limit = parseInt(url.searchParams.get("limit") || "100");
  const startTimestamp = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);

  // Get individual orders with UTM attribution
  const orders = await env.ANALYTICS_DB.prepare(`
    SELECT 
      e.id,
      e.timestamp,
      e.event_value,
      e.metadata,
      e.country,
      e.device_type,
      e.url,
      p.utm_source,
      p.utm_medium,
      p.utm_campaign,
      p.utm_content,
      p.utm_term
    FROM events e
    LEFT JOIN (
      SELECT DISTINCT 
        session_hash, 
        utm_source, 
        utm_medium, 
        utm_campaign, 
        utm_content, 
        utm_term
      FROM pageviews
      WHERE timestamp >= ?
    ) p ON e.session_hash = p.session_hash
    WHERE e.timestamp >= ?
      AND e.event_name IN ('purchase', 'orderCompleted')
      AND e.event_value IS NOT NULL
    ORDER BY e.timestamp DESC
    LIMIT ?
  `).bind(startTimestamp, startTimestamp, limit).all();

  return new Response(JSON.stringify({
    orders: orders.results || [],
    count: orders.results?.length || 0
  }, null, 2), {
    headers: {
      "content-type": "application/json",
      ...corsHeaders
    }
  });
}

async function handleExport(request, env, corsHeaders) {
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get("days") || "7");
  const type = url.searchParams.get("type") || "orders"; // orders, campaigns, daily
  const startTimestamp = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);

  let csvContent = "";
  
  if (type === "orders") {
    const orders = await env.ANALYTICS_DB.prepare(`
      SELECT 
        e.timestamp,
        e.event_value,
        e.metadata,
        e.country,
        e.device_type,
        p.utm_source,
        p.utm_medium,
        p.utm_campaign
      FROM events e
      LEFT JOIN (
        SELECT DISTINCT session_hash, utm_source, utm_medium, utm_campaign
        FROM pageviews WHERE timestamp >= ?
      ) p ON e.session_hash = p.session_hash
      WHERE e.timestamp >= ?
        AND e.event_name IN ('purchase', 'orderCompleted')
        AND e.event_value IS NOT NULL
      ORDER BY e.timestamp DESC
    `).bind(startTimestamp, startTimestamp).all();

    csvContent = "Timestamp,Date,Order Value,Transaction ID,Country,Device,Source,Medium,Campaign\n";
    orders.results.forEach(order => {
      const date = new Date(order.timestamp * 1000).toISOString();
      const metadata = order.metadata ? JSON.parse(order.metadata) : {};
      const transactionId = metadata.transaction_id || "";
      csvContent += `${order.timestamp},${date},${order.event_value || 0},"${transactionId}",${order.country || ""},${order.device_type || ""},${order.utm_source || "Direct"},${order.utm_medium || ""},${order.utm_campaign || ""}\n`;
    });
  } else if (type === "campaigns") {
    const campaigns = await env.ANALYTICS_DB.prepare(`
      SELECT 
        p.utm_source,
        p.utm_medium,
        p.utm_campaign,
        COUNT(DISTINCT p.session_hash) as sessions,
        COUNT(DISTINCT e.session_hash) as conversions,
        SUM(e.event_value) as revenue
      FROM pageviews p
      LEFT JOIN events e ON p.session_hash = e.session_hash 
        AND e.event_name IN ('purchase', 'orderCompleted')
      WHERE p.timestamp >= ? AND p.utm_campaign IS NOT NULL
      GROUP BY p.utm_source, p.utm_medium, p.utm_campaign
      ORDER BY revenue DESC
    `).bind(startTimestamp).all();

    csvContent = "Source,Medium,Campaign,Sessions,Conversions,Revenue,Conversion Rate,AOV\n";
    campaigns.results.forEach(c => {
      const convRate = c.sessions > 0 ? ((c.conversions / c.sessions) * 100).toFixed(2) : 0;
      const aov = c.conversions > 0 ? (c.revenue / c.conversions).toFixed(2) : 0;
      csvContent += `${c.utm_source || ""},${c.utm_medium || ""},${c.utm_campaign || ""},${c.sessions},${c.conversions || 0},${c.revenue || 0},${convRate},${aov}\n`;
    });
  }

  return new Response(csvContent, {
    headers: {
      "content-type": "text/csv",
      "content-disposition": `attachment; filename="analytics-${type}-${days}days.csv"`,
      ...corsHeaders
    }
  });
}

// ==================== DASHBOARD HTML ====================

function renderEnhancedDashboard() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FrndlyTV Analytics Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    :root {
      --primary: #667eea;
      --secondary: #764ba2;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --info: #3b82f6;
      --dark: #1e293b;
      --light: #f8fafc;
      --border: #e2e8f0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
      min-height: 100vh;
      padding: 20px;
      color: #333;
    }

    .container {
      max-width: 1800px;
      margin: 0 auto;
    }

    /* Header */
    header {
      text-align: center;
      color: white;
      margin-bottom: 30px;
      animation: fadeIn 0.5s ease-in;
    }

    h1 {
      font-size: 2.5rem;
      font-weight: 700;
      margin-bottom: 10px;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
    }

    .subtitle {
      font-size: 1.1rem;
      opacity: 0.9;
    }

    /* Filters */
    .filters {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .filter-btn {
      padding: 12px 24px;
      background: rgba(255, 255, 255, 0.2);
      color: white;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 8px;
      cursor: pointer;
      font-size: 1rem;
      font-weight: 600;
      transition: all 0.3s;
      backdrop-filter: blur(10px);
    }

    .filter-btn:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }

    .filter-btn.active {
      background: white;
      color: var(--primary);
      border-color: white;
    }

    /* Export Button */
    .export-section {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-bottom: 20px;
    }

    .export-btn {
      padding: 10px 20px;
      background: rgba(16, 185, 129, 0.9);
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.95rem;
      font-weight: 600;
      transition: all 0.3s;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .export-btn:hover {
      background: var(--success);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
    }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
      animation: slideUp 0.6s ease-out;
    }

    .stat-card {
      background: white;
      padding: 25px;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      transition: all 0.3s;
      position: relative;
      overflow: hidden;
    }

    .stat-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 4px;
      background: linear-gradient(90deg, var(--primary), var(--secondary));
    }

    .stat-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
    }

    .stat-label {
      font-size: 0.85rem;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 10px;
      font-weight: 600;
    }

    .stat-value {
      font-size: 2.2rem;
      font-weight: 700;
      color: var(--primary);
      font-family: 'JetBrains Mono', monospace;
    }

    .stat-change {
      font-size: 0.85rem;
      margin-top: 8px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .stat-change.positive {
      color: var(--success);
    }

    .stat-change.negative {
      color: var(--danger);
    }

    /* Chart Grid */
    .chart-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }

    .chart-card {
      background: white;
      padding: 25px;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      transition: all 0.3s;
    }

    .chart-card:hover {
      box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
    }

    .chart-card.full-width {
      grid-column: 1 / -1;
    }

    .chart-card h2 {
      font-size: 1.3rem;
      margin-bottom: 20px;
      color: #333;
      border-bottom: 2px solid var(--primary);
      padding-bottom: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .chart-container {
      position: relative;
      height: 300px;
    }

    .chart-container.tall {
      height: 400px;
    }

    /* Tables */
    .table-wrapper {
      overflow-x: auto;
      margin-top: 15px;
    }

    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }

    .data-table th {
      background: var(--light);
      padding: 12px;
      text-align: left;
      font-weight: 600;
      color: #555;
      border-bottom: 2px solid var(--primary);
      position: sticky;
      top: 0;
      z-index: 10;
      white-space: nowrap;
    }

    .data-table th:hover {
      background: #e2e8f0;
      cursor: pointer;
    }

    .data-table td {
      padding: 12px;
      border-bottom: 1px solid var(--border);
    }

    .data-table tr:hover {
      background: var(--light);
    }

    .data-table tr:last-child td {
      border-bottom: none;
    }

    #ordersTableContainer,
    #campaignTableContainer {
      max-height: 600px;
      overflow-y: auto;
      border: 1px solid var(--border);
      border-radius: 8px;
    }

    /* Search and Filter Controls */
    .table-controls {
      display: flex;
      gap: 10px;
      margin-bottom: 15px;
      flex-wrap: wrap;
    }

    .search-input,
    .filter-select {
      padding: 10px 15px;
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 0.95rem;
      transition: all 0.3s;
    }

    .search-input {
      flex: 1;
      min-width: 200px;
    }

    .search-input:focus,
    .filter-select:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    /* Badges */
    code {
      background: #f0f0f0;
      padding: 4px 8px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 0.85rem;
    }

    .revenue-badge {
      background: var(--success);
      color: white;
      padding: 4px 12px;
      border-radius: 12px;
      font-weight: 600;
      font-size: 0.9rem;
      white-space: nowrap;
    }

    .conversion-badge {
      background: var(--primary);
      color: white;
      padding: 4px 12px;
      border-radius: 12px;
      font-weight: 600;
      font-size: 0.9rem;
    }

    .campaign-tag {
      background: var(--light);
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 0.85rem;
      color: #555;
      display: inline-block;
      margin: 2px;
      border: 1px solid var(--border);
    }

    /* Tabs */
    .tab-container {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
      border-bottom: 2px solid var(--border);
      flex-wrap: wrap;
    }

    .tab-btn {
      padding: 12px 24px;
      background: none;
      border: none;
      color: #666;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      border-bottom: 3px solid transparent;
      transition: all 0.3s;
      white-space: nowrap;
    }

    .tab-btn:hover {
      color: var(--primary);
      background: rgba(102, 126, 234, 0.05);
    }

    .tab-btn.active {
      color: var(--primary);
      border-bottom-color: var(--primary);
    }

    .tab-content {
      display: none;
      animation: fadeIn 0.3s ease-in;
    }

    .tab-content.active {
      display: block;
    }

    /* Loading States */
    .loading {
      text-align: center;
      color: white;
      font-size: 1.2rem;
      padding: 40px;
    }

    .loading::after {
      content: '...';
      animation: dots 1.5s steps(4, end) infinite;
    }

    /* Skeleton Loading */
    .skeleton {
      background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
      background-size: 200% 100%;
      animation: loading 1.5s infinite;
      border-radius: 4px;
    }

    /* Footer */
    .last-updated {
      text-align: center;
      color: white;
      margin-top: 20px;
      opacity: 0.8;
      font-size: 0.9rem;
    }

    /* Animations */
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes dots {
      0%, 20% { content: '.'; }
      40% { content: '..'; }
      60%, 100% { content: '...'; }
    }

    @keyframes loading {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* Responsive Design */
    @media (max-width: 1200px) {
      .chart-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 768px) {
      h1 {
        font-size: 1.8rem;
      }

      .stat-value {
        font-size: 1.8rem;
      }

      .filters {
        justify-content: flex-start;
      }

      .filter-btn {
        padding: 10px 18px;
        font-size: 0.9rem;
      }

      .chart-card {
        padding: 15px;
      }

      .tab-btn {
        padding: 10px 16px;
        font-size: 0.9rem;
      }

      .data-table {
        font-size: 0.8rem;
      }

      .data-table th,
      .data-table td {
        padding: 8px;
      }
    }

    /* Dark mode support */
    @media (prefers-color-scheme: dark) {
      body {
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      }

      .stat-card,
      .chart-card {
        background: #1e293b;
        color: #e2e8f0;
      }

      .stat-card h2,
      .chart-card h2 {
        color: #e2e8f0;
      }

      .data-table th {
        background: #334155;
        color: #e2e8f0;
      }

      .data-table tr:hover {
        background: #334155;
      }
    }

    /* Utility Classes */
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .mt-1 { margin-top: 0.5rem; }
    .mt-2 { margin-top: 1rem; }
    .mb-1 { margin-bottom: 0.5rem; }
    .mb-2 { margin-bottom: 1rem; }
    .flex { display: flex; }
    .gap-1 { gap: 0.5rem; }
    .gap-2 { gap: 1rem; }
    .items-center { align-items: center; }
    .justify-between { justify-content: space-between; }

    /* Tooltip */
    .tooltip {
      position: relative;
      display: inline-block;
    }

    .tooltip .tooltiptext {
      visibility: hidden;
      width: 200px;
      background-color: #555;
      color: #fff;
      text-align: center;
      border-radius: 6px;
      padding: 8px;
      position: absolute;
      z-index: 1;
      bottom: 125%;
      left: 50%;
      margin-left: -100px;
      opacity: 0;
      transition: opacity 0.3s;
      font-size: 0.85rem;
    }

    .tooltip:hover .tooltiptext {
      visibility: visible;
      opacity: 1;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>📊 FrndlyTV Analytics</h1>
      <p class="subtitle">Real-time performance & revenue tracking</p>
    </header>

    <div class="filters">
      <button class="filter-btn" data-days="1">Today</button>
      <button class="filter-btn active" data-days="7">7 Days</button>
      <button class="filter-btn" data-days="30">30 Days</button>
      <button class="filter-btn" data-days="90">90 Days</button>
    </div>

    <div class="export-section">
      <button class="export-btn" onclick="exportData('orders')">
        📥 Export Orders
      </button>
      <button class="export-btn" onclick="exportData('campaigns')">
        📥 Export Campaigns
      </button>
    </div>

    <div id="dashboard">
      <div class="loading">Loading analytics data</div>
    </div>

    <div class="last-updated" id="lastUpdated"></div>
  </div>

  <script>
    let currentDays = 7;
    let charts = {};
    let allData = {};

    const chartColors = {
      primary: '#667eea',
      secondary: '#764ba2',
      success: '#10b981',
      warning: '#f59e0b',
      danger: '#ef4444',
      info: '#3b82f6'
    };

    // Export functionality
    function exportData(type) {
      const url = \`/api/export?days=\${currentDays}&type=\${type}\`;
      window.location.href = url;
    }

    // Data loading with caching
    async function loadAllData() {
      try {
        const [analytics, revenue, campaigns, hourly, orders] = await Promise.all([
          fetch(\`/api/analytics?days=\${currentDays}\`).then(r => r.json()),
          fetch(\`/api/revenue?days=\${currentDays}\`).then(r => r.json()),
          fetch(\`/api/campaigns?days=\${currentDays}\`).then(r => r.json()),
          fetch(\`/api/hourly\`).then(r => r.json()),
          fetch(\`/api/orders?days=\${currentDays}&limit=200\`).then(r => r.json())
        ]);

        allData = { analytics, revenue, campaigns, hourly, orders: orders.orders || [] };

        if (document.getElementById('dashboard').querySelector('.loading')) {
          renderDashboard(allData);
        } else {
          updateDashboardData(allData);
        }
        
        updateLastUpdated();
      } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('dashboard').innerHTML =
          '<div class="loading" style="color: #ef4444;">Failed to load analytics data. Please refresh the page.</div>';
      }
    }

    function renderDashboard(data) {
      const html = \`
        <div class="stats-grid" id="statsGrid">
          <div class="stat-card">
            <div class="stat-label">Total Revenue</div>
            <div class="stat-value">$\${formatNumber(data.revenue.overview.total_revenue || 0, 2)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Orders</div>
            <div class="stat-value">\${formatNumber(data.revenue.overview.total_orders || 0)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Conversion Rate</div>
            <div class="stat-value">\${data.revenue.overview.conversion_rate}%</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Avg Order Value</div>
            <div class="stat-value">$\${(data.revenue.overview.avg_order_value || 0).toFixed(2)}</div>
          </div>
        </div>

        <div class="chart-card full-width">
          <div class="tab-container">
            <button class="tab-btn active" data-tab="overview">📈 Overview</button>
            <button class="tab-btn" data-tab="revenue-tab">💰 Revenue</button>
            <button class="tab-btn" data-tab="orders-tab">📦 Orders</button>
            <button class="tab-btn" data-tab="campaigns-tab">🎯 Campaigns</button>
            <button class="tab-btn" data-tab="hourly-tab">⏰ Hourly</button>
          </div>

          <div class="tab-content active" id="overview">
            <div class="chart-grid">
              <div class="chart-card full-width">
                <h2>
                  Daily Performance Trend
                  <span class="tooltip">ℹ️
                    <span class="tooltiptext">Pageviews and unique visitors over time</span>
                  </span>
                </h2>
                <div class="chart-container tall">
                  <canvas id="dailyTrendChart"></canvas>
                </div>
              </div>
              <div class="chart-card">
                <h2>Traffic by Country</h2>
                <div class="chart-container">
                  <canvas id="countryChart"></canvas>
                </div>
              </div>
              <div class="chart-card">
                <h2>Device Breakdown</h2>
                <div class="chart-container">
                  <canvas id="deviceChart"></canvas>
                </div>
              </div>
            </div>
          </div>

          <div class="tab-content" id="revenue-tab">
            <div class="chart-grid">
              <div class="chart-card full-width">
                <h2>Daily Revenue & Orders</h2>
                <div class="chart-container tall">
                  <canvas id="revenueChart"></canvas>
                </div>
              </div>
              <div class="chart-card">
                <h2>Revenue by Source</h2>
                <div class="chart-container">
                  <canvas id="revenueSourceChart"></canvas>
                </div>
              </div>
            </div>
          </div>

          <div class="tab-content" id="orders-tab">
            <h2>Recent Orders</h2>
            <div class="table-controls">
              <input type="text" class="search-input" id="orderSearch" placeholder="🔍 Search orders...">
              <select class="filter-select" id="orderSort">
                <option value="timestamp_desc">Newest First</option>
                <option value="timestamp_asc">Oldest First</option>
                <option value="value_desc">Highest Value</option>
                <option value="value_asc">Lowest Value</option>
              </select>
            </div>
            <div id="ordersTableContainer">
              <div class="table-wrapper">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th onclick="sortOrdersBy('id')">Order ID</th>
                      <th onclick="sortOrdersBy('timestamp')">Date/Time</th>
                      <th onclick="sortOrdersBy('value')">Amount</th>
                      <th onclick="sortOrdersBy('source')">Source</th>
                      <th onclick="sortOrdersBy('campaign')">Campaign</th>
                      <th onclick="sortOrdersBy('country')">Country</th>
                      <th onclick="sortOrdersBy('device')">Device</th>
                    </tr>
                  </thead>
                  <tbody id="ordersTableBody">
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="tab-content" id="campaigns-tab">
            <h2>Campaign Attribution Report</h2>
            <div class="table-controls">
              <input type="text" class="search-input" id="campaignSearch" placeholder="🔍 Search campaigns...">
              <select class="filter-select" id="campaignSort">
                <option value="revenue_desc">Highest Revenue</option>
                <option value="revenue_asc">Lowest Revenue</option>
                <option value="conversion_desc">Highest Conversion Rate</option>
                <option value="sessions_desc">Most Sessions</option>
              </select>
            </div>
            <div id="campaignTableContainer">
              <div class="table-wrapper">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th onclick="sortCampaignsBy('campaign')">Campaign</th>
                      <th onclick="sortCampaignsBy('source')">Source</th>
                      <th onclick="sortCampaignsBy('sessions')">Sessions</th>
                      <th onclick="sortCampaignsBy('conversions')">Orders</th>
                      <th onclick="sortCampaignsBy('revenue')">Revenue</th>
                      <th onclick="sortCampaignsBy('conversion_rate')">CVR</th>
                      <th onclick="sortCampaignsBy('aov')">AOV</th>
                    </tr>
                  </thead>
                  <tbody id="campaignTableBody">
                  </tbody>
                </table>
              </div>
            </div>
            <div style="margin-top: 30px;">
              <h2>Campaign Performance Over Time</h2>
              <div class="chart-container tall">
                <canvas id="campaignTrendChart"></canvas>
              </div>
            </div>
          </div>

          <div class="tab-content" id="hourly-tab">
            <h2>Last 24 Hours - Hourly Breakdown</h2>
            <div class="chart-container tall">
              <canvas id="hourlyChart"></canvas>
            </div>
          </div>
        </div>
      \`;

      document.getElementById('dashboard').innerHTML = html;
      
      setupEventListeners();
      setupOrdersTable(data);
      setupCampaignsTable(data);
      renderCharts(data);
    }

    function setupEventListeners() {
      // Tab switching
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
          btn.classList.add('active');
          document.getElementById(btn.dataset.tab).classList.add('active');
        });
      });
    }

    // Formatting utilities
    function formatNumber(num, decimals = 0) {
      if (typeof num !== 'number') num = parseFloat(num) || 0;
      return num.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      });
    }

    function formatCurrency(num) {
      return '$' + formatNumber(num, 2);
    }

    // Orders table management
    let currentOrdersData = [];
    let currentOrderSort = { field: 'timestamp', direction: 'desc' };

    function setupOrdersTable(data) {
      currentOrdersData = data.orders || [];
      renderOrdersTable(currentOrdersData);

      document.getElementById('orderSearch')?.addEventListener('input', (e) => {
        filterOrders(e.target.value);
      });

      document.getElementById('orderSort')?.addEventListener('change', (e) => {
        const [field, direction] = e.target.value.split('_');
        currentOrderSort = { field, direction };
        sortAndRenderOrders();
      });
    }

    function filterOrders(searchTerm) {
      if (!searchTerm) {
        sortAndRenderOrders();
        return;
      }

      const term = searchTerm.toLowerCase();
      const filtered = currentOrdersData.filter(order => {
        const metadata = order.metadata ? JSON.parse(order.metadata) : {};
        const transactionId = (metadata.transaction_id || '').toLowerCase();
        const source = (order.utm_source || '').toLowerCase();
        const campaign = (order.utm_campaign || '').toLowerCase();
        const country = (order.country || '').toLowerCase();
        
        return transactionId.includes(term) || source.includes(term) || 
               campaign.includes(term) || country.includes(term);
      });

      renderOrdersTable(filtered);
    }

    function sortOrdersBy(field) {
      if (currentOrderSort.field === field) {
        currentOrderSort.direction = currentOrderSort.direction === 'desc' ? 'asc' : 'desc';
      } else {
        currentOrderSort = { field, direction: 'desc' };
      }
      sortAndRenderOrders();
    }

    function sortAndRenderOrders() {
      const searchTerm = document.getElementById('orderSearch')?.value || '';
      let data = searchTerm ? 
        currentOrdersData.filter(order => {
          const term = searchTerm.toLowerCase();
          const metadata = order.metadata ? JSON.parse(order.metadata) : {};
          const transactionId = (metadata.transaction_id || '').toLowerCase();
          return transactionId.includes(term) || 
                 (order.utm_source || '').toLowerCase().includes(term);
        }) : 
        [...currentOrdersData];

      data.sort((a, b) => {
        let aVal, bVal;
        
        switch(currentOrderSort.field) {
          case 'timestamp':
            aVal = a.timestamp;
            bVal = b.timestamp;
            break;
          case 'value':
            aVal = a.event_value || 0;
            bVal = b.event_value || 0;
            break;
          case 'source':
            aVal = (a.utm_source || 'Direct').toLowerCase();
            bVal = (b.utm_source || 'Direct').toLowerCase();
            break;
          case 'campaign':
            aVal = (a.utm_campaign || '').toLowerCase();
            bVal = (b.utm_campaign || '').toLowerCase();
            break;
          case 'country':
            aVal = (a.country || '').toLowerCase();
            bVal = (b.country || '').toLowerCase();
            break;
          case 'device':
            aVal = (a.device_type || '').toLowerCase();
            bVal = (b.device_type || '').toLowerCase();
            break;
          default:
            return 0;
        }

        if (aVal < bVal) return currentOrderSort.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return currentOrderSort.direction === 'asc' ? 1 : -1;
        return 0;
      });

      renderOrdersTable(data);
    }

    function renderOrdersTable(orders) {
      const tbody = document.getElementById('ordersTableBody');
      if (!tbody) return;

      if (!orders || orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color: #999; padding: 40px;">No orders found</td></tr>';
        return;
      }

      tbody.innerHTML = orders.map(order => {
        const date = new Date(order.timestamp * 1000);
        const metadata = order.metadata ? JSON.parse(order.metadata) : {};
        const transactionId = metadata.transaction_id || 'N/A';
        
        return \`
          <tr>
            <td><code>\${transactionId}</code></td>
            <td>\${date.toLocaleString()}</td>
            <td><span class="revenue-badge">\${formatCurrency(order.event_value || 0)}</span></td>
            <td>\${order.utm_source || 'Direct'}</td>
            <td>\${order.utm_campaign ? '<span class="campaign-tag">' + order.utm_campaign + '</span>' : 'N/A'}</td>
            <td>\${order.country || 'Unknown'}</td>
            <td>\${order.device_type || 'Unknown'}</td>
          </tr>
        \`;
      }).join('');
    }

    // Campaigns table management
    let currentCampaignsData = [];
    let currentCampaignSort = { field: 'revenue', direction: 'desc' };

    function setupCampaignsTable(data) {
      currentCampaignsData = data.campaigns.campaigns || [];
      renderCampaignsTable(currentCampaignsData);

      document.getElementById('campaignSearch')?.addEventListener('input', (e) => {
        filterCampaigns(e.target.value);
      });

      document.getElementById('campaignSort')?.addEventListener('change', (e) => {
        const [field, direction] = e.target.value.split('_');
        currentCampaignSort = { field, direction };
        sortAndRenderCampaigns();
      });
    }

    function filterCampaigns(searchTerm) {
      if (!searchTerm) {
        sortAndRenderCampaigns();
        return;
      }

      const term = searchTerm.toLowerCase();
      const filtered = currentCampaignsData.filter(campaign => {
        return (campaign.utm_campaign || '').toLowerCase().includes(term) ||
               (campaign.utm_source || '').toLowerCase().includes(term) ||
               (campaign.utm_medium || '').toLowerCase().includes(term);
      });

      renderCampaignsTable(filtered);
    }

    function sortCampaignsBy(field) {
      if (currentCampaignSort.field === field) {
        currentCampaignSort.direction = currentCampaignSort.direction === 'desc' ? 'asc' : 'desc';
      } else {
        currentCampaignSort = { field, direction: 'desc' };
      }
      sortAndRenderCampaigns();
    }

    function sortAndRenderCampaigns() {
      const searchTerm = document.getElementById('campaignSearch')?.value || '';
      let data = searchTerm ? 
        currentCampaignsData.filter(c => {
          const term = searchTerm.toLowerCase();
          return (c.utm_campaign || '').toLowerCase().includes(term) ||
                 (c.utm_source || '').toLowerCase().includes(term);
        }) : 
        [...currentCampaignsData];

      data.sort((a, b) => {
        let aVal, bVal;
        
        switch(currentCampaignSort.field) {
          case 'campaign':
            aVal = (a.utm_campaign || '').toLowerCase();
            bVal = (b.utm_campaign || '').toLowerCase();
            break;
          case 'source':
            aVal = (a.utm_source || '').toLowerCase();
            bVal = (b.utm_source || '').toLowerCase();
            break;
          case 'sessions':
            aVal = a.sessions || 0;
            bVal = b.sessions || 0;
            break;
          case 'conversions':
            aVal = a.conversions || 0;
            bVal = b.conversions || 0;
            break;
          case 'revenue':
            aVal = a.revenue || 0;
            bVal = b.revenue || 0;
            break;
          case 'conversion_rate':
            aVal = a.conversion_rate || 0;
            bVal = b.conversion_rate || 0;
            break;
          case 'aov':
            aVal = a.avg_order_value || 0;
            bVal = b.avg_order_value || 0;
            break;
          default:
            return 0;
        }

        if (aVal < bVal) return currentCampaignSort.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return currentCampaignSort.direction === 'asc' ? 1 : -1;
        return 0;
      });

      renderCampaignsTable(data);
    }

    function renderCampaignsTable(campaigns) {
      const tbody = document.getElementById('campaignTableBody');
      if (!tbody) return;

      if (!campaigns || campaigns.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color: #999; padding: 40px;">No campaign data available</td></tr>';
        return;
      }

      tbody.innerHTML = campaigns.map(c => \`
        <tr>
          <td><span class="campaign-tag">\${c.utm_campaign || 'N/A'}</span></td>
          <td>\${c.utm_source || 'N/A'}</td>
          <td>\${formatNumber(c.sessions)}</td>
          <td>\${formatNumber(c.conversions || 0)}</td>
          <td><span class="revenue-badge">\${formatCurrency(c.revenue || 0)}</span></td>
          <td><span class="conversion-badge">\${c.conversion_rate || 0}%</span></td>
          <td>\${formatCurrency(c.avg_order_value || 0)}</td>
        </tr>
      \`).join('');
    }

    function updateDashboardData(data) {
      // Update stats
      const statsGrid = document.getElementById('statsGrid');
      if (statsGrid) {
        statsGrid.innerHTML = \`
          <div class="stat-card">
            <div class="stat-label">Total Revenue</div>
            <div class="stat-value">\${formatCurrency(data.revenue.overview.total_revenue || 0)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Orders</div>
            <div class="stat-value">\${formatNumber(data.revenue.overview.total_orders || 0)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Conversion Rate</div>
            <div class="stat-value">\${data.revenue.overview.conversion_rate}%</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Avg Order Value</div>
            <div class="stat-value">\${formatCurrency(data.revenue.overview.avg_order_value || 0)}</div>
          </div>
        \`;
      }

      // Update tables
      currentOrdersData = data.orders || [];
      currentCampaignsData = data.campaigns.campaigns || [];
      sortAndRenderOrders();
      sortAndRenderCampaigns();

      // Update charts
      updateCharts(data);
    }

    function renderCharts(data) {
      // Destroy existing charts
      Object.values(charts).forEach(chart => chart?.destroy());
      charts = {};

      // Daily Trend Chart
      const dailyLabels = data.analytics.daily.map(d => d.date);
      const dailyPageviews = data.analytics.daily.map(d => d.pageviews);
      const dailyVisitors = data.analytics.daily.map(d => d.visitors);

      charts.dailyTrend = new Chart(document.getElementById('dailyTrendChart'), {
        type: 'line',
        data: {
          labels: dailyLabels,
          datasets: [{
            label: 'Pageviews',
            data: dailyPageviews,
            borderColor: chartColors.primary,
            backgroundColor: 'rgba(102, 126, 234, 0.1)',
            tension: 0.4,
            fill: true
          }, {
            label: 'Unique Visitors',
            data: dailyVisitors,
            borderColor: chartColors.secondary,
            backgroundColor: 'rgba(118, 75, 162, 0.1)',
            tension: 0.4,
            fill: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false,
          },
          plugins: { 
            legend: { position: 'top' },
            tooltip: {
              callbacks: {
                label: function(context) {
                  return context.dataset.label + ': ' + formatNumber(context.parsed.y);
                }
              }
            }
          },
          scales: { 
            y: { 
              beginAtZero: true,
              ticks: {
                callback: function(value) {
                  return formatNumber(value);
                }
              }
            } 
          }
        }
      });

      // Revenue Chart
      const revenueLabels = data.revenue.daily.map(d => d.date);
      const revenueData = data.revenue.daily.map(d => d.revenue || 0);
      const ordersData = data.revenue.daily.map(d => d.orders);

      charts.revenue = new Chart(document.getElementById('revenueChart'), {
        type: 'bar',
        data: {
          labels: revenueLabels,
          datasets: [{
            label: 'Revenue ($)',
            data: revenueData,
            backgroundColor: chartColors.success,
            yAxisID: 'y'
          }, {
            label: 'Orders',
            data: ordersData,
            backgroundColor: chartColors.info,
            type: 'line',
            yAxisID: 'y1',
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false,
          },
          plugins: {
            tooltip: {
              callbacks: {
                label: function(context) {
                  if (context.dataset.yAxisID === 'y') {
                    return 'Revenue: ' + formatCurrency(context.parsed.y);
                  }
                  return 'Orders: ' + formatNumber(context.parsed.y);
                }
              }
            }
          },
          scales: {
            y: { 
              type: 'linear', 
              display: true, 
              position: 'left', 
              beginAtZero: true,
              ticks: {
                callback: function(value) {
                  return '$' + formatNumber(value);
                }
              }
            },
            y1: { 
              type: 'linear', 
              display: true, 
              position: 'right', 
              beginAtZero: true, 
              grid: { drawOnChartArea: false },
              ticks: {
                callback: function(value) {
                  return formatNumber(value);
                }
              }
            }
          }
        }
      });

      // Country Chart
      const countryLabels = data.analytics.countries.map(c => c.country);
      const countryData = data.analytics.countries.map(c => c.count);

      charts.country = new Chart(document.getElementById('countryChart'), {
        type: 'doughnut',
        data: {
          labels: countryLabels,
          datasets: [{
            data: countryData,
            backgroundColor: [
              chartColors.primary, 
              chartColors.secondary, 
              chartColors.success, 
              chartColors.warning, 
              chartColors.info, 
              '#94a3b8',
              '#f472b6',
              '#a78bfa'
            ]
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { 
            legend: { position: 'right' },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const total = context.dataset.data.reduce((a, b) => a + b, 0);
                  const percentage = ((context.parsed / total) * 100).toFixed(1);
                  return context.label + ': ' + formatNumber(context.parsed) + ' (' + percentage + '%)';
                }
              }
            }
          }
        }
      });

      // Device Chart
      const deviceLabels = data.analytics.devices.map(d => d.device_type);
      const deviceData = data.analytics.devices.map(d => d.count);

      charts.device = new Chart(document.getElementById('deviceChart'), {
        type: 'pie',
        data: {
          labels: deviceLabels,
          datasets: [{
            data: deviceData,
            backgroundColor: [chartColors.primary, chartColors.success, chartColors.warning]
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { 
            legend: { position: 'bottom' },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const total = context.dataset.data.reduce((a, b) => a + b, 0);
                  const percentage = ((context.parsed / total) * 100).toFixed(1);
                  return context.label + ': ' + formatNumber(context.parsed) + ' (' + percentage + '%)';
                }
              }
            }
          }
        }
      });

      // Revenue Source Chart
      const sourceLabels = data.revenue.by_source.map(s => s.source);
      const sourceRevenue = data.revenue.by_source.map(s => s.revenue || 0);

      charts.revenueSource = new Chart(document.getElementById('revenueSourceChart'), {
        type: 'bar',
        data: {
          labels: sourceLabels,
          datasets: [{
            label: 'Revenue ($)',
            data: sourceRevenue,
            backgroundColor: chartColors.success
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y',
          plugins: { 
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function(context) {
                  return 'Revenue: ' + formatCurrency(context.parsed.x);
                }
              }
            }
          },
          scales: { 
            x: { 
              beginAtZero: true,
              ticks: {
                callback: function(value) {
                  return '$' + formatNumber(value);
                }
              }
            } 
          }
        }
      });

      // Campaign Trend Chart
      const campaignDaily = {};
      data.campaigns.daily_campaign_revenue.forEach(item => {
        const campaign = item.utm_campaign;
        if (!campaignDaily[campaign]) campaignDaily[campaign] = {};
        campaignDaily[campaign][item.date] = item.revenue || 0;
      });

      const allDates = [...new Set(data.campaigns.daily_campaign_revenue.map(i => i.date))].sort();
      const topCampaigns = Object.keys(campaignDaily).slice(0, 5);
      
      const campaignDatasets = topCampaigns.map((campaign, idx) => ({
        label: campaign,
        data: allDates.map(date => campaignDaily[campaign][date] || 0),
        borderColor: [chartColors.danger, chartColors.info, chartColors.warning, '#ec4899', chartColors.secondary][idx],
        tension: 0.4,
        fill: false
      }));

      charts.campaignTrend = new Chart(document.getElementById('campaignTrendChart'), {
        type: 'line',
        data: {
          labels: allDates,
          datasets: campaignDatasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false,
          },
          plugins: { 
            legend: { position: 'top' },
            tooltip: {
              callbacks: {
                label: function(context) {
                  return context.dataset.label + ': ' + formatCurrency(context.parsed.y);
                }
              }
            }
          },
          scales: { 
            y: { 
              beginAtZero: true,
              ticks: {
                callback: function(value) {
                  return '$' + formatNumber(value);
                }
              }
            } 
          }
        }
      });

      // Hourly Chart
      const hourlyLabels = data.hourly.hourly_stats.map(h => {
        const date = new Date(h.hour);
        return date.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
      });
      const hourlyPageviews = data.hourly.hourly_stats.map(h => h.pageviews);
      
      const hourlyRevenueMap = {};
      data.hourly.hourly_revenue.forEach(h => {
        hourlyRevenueMap[h.hour] = h.orders;
      });
      const hourlyOrders = data.hourly.hourly_stats.map(h => hourlyRevenueMap[h.hour] || 0);

      charts.hourly = new Chart(document.getElementById('hourlyChart'), {
        type: 'bar',
        data: {
          labels: hourlyLabels,
          datasets: [{
            label: 'Pageviews',
            data: hourlyPageviews,
            backgroundColor: chartColors.primary,
            yAxisID: 'y'
          }, {
            label: 'Orders',
            data: hourlyOrders,
            backgroundColor: chartColors.success,
            type: 'line',
            yAxisID: 'y1',
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false,
          },
          scales: {
            y: { 
              type: 'linear', 
              display: true, 
              position: 'left', 
              beginAtZero: true,
              ticks: {
                callback: function(value) {
                  return formatNumber(value);
                }
              }
            },
            y1: { 
              type: 'linear', 
              display: true, 
              position: 'right', 
              beginAtZero: true, 
              grid: { drawOnChartArea: false },
              ticks: {
                callback: function(value) {
                  return formatNumber(value);
                }
              }
            }
          }
        }
      });
    }

    function updateCharts(data) {
      // Efficiently update charts without full recreation
      if (charts.dailyTrend) {
        charts.dailyTrend.data.labels = data.analytics.daily.map(d => d.date);
        charts.dailyTrend.data.datasets[0].data = data.analytics.daily.map(d => d.pageviews);
        charts.dailyTrend.data.datasets[1].data = data.analytics.daily.map(d => d.visitors);
        charts.dailyTrend.update('none');
      }

      if (charts.revenue) {
        charts.revenue.data.labels = data.revenue.daily.map(d => d.date);
        charts.revenue.data.datasets[0].data = data.revenue.daily.map(d => d.revenue || 0);
        charts.revenue.data.datasets[1].data = data.revenue.daily.map(d => d.orders);
        charts.revenue.update('none');
      }

      if (charts.country) {
        charts.country.data.labels = data.analytics.countries.map(c => c.country);
        charts.country.data.datasets[0].data = data.analytics.countries.map(c => c.count);
        charts.country.update('none');
      }

      if (charts.device) {
        charts.device.data.labels = data.analytics.devices.map(d => d.device_type);
        charts.device.data.datasets[0].data = data.analytics.devices.map(d => d.count);
        charts.device.update('none');
      }

      if (charts.revenueSource) {
        charts.revenueSource.data.labels = data.revenue.by_source.map(s => s.source);
        charts.revenueSource.data.datasets[0].data = data.revenue.by_source.map(s => s.revenue || 0);
        charts.revenueSource.update('none');
      }

      if (charts.campaignTrend) {
        const campaignDaily = {};
        data.campaigns.daily_campaign_revenue.forEach(item => {
          const campaign = item.utm_campaign;
          if (!campaignDaily[campaign]) campaignDaily[campaign] = {};
          campaignDaily[campaign][item.date] = item.revenue || 0;
        });

        const allDates = [...new Set(data.campaigns.daily_campaign_revenue.map(i => i.date))].sort();
        const topCampaigns = Object.keys(campaignDaily).slice(0, 5);
        
        charts.campaignTrend.data.labels = allDates;
        charts.campaignTrend.data.datasets = topCampaigns.map((campaign, idx) => ({
          label: campaign,
          data: allDates.map(date => campaignDaily[campaign][date] || 0),
          borderColor: [chartColors.danger, chartColors.info, chartColors.warning, '#ec4899', chartColors.secondary][idx],
          tension: 0.4,
          fill: false
        }));
        
        charts.campaignTrend.update('none');
      }

      if (charts.hourly) {
        const hourlyLabels = data.hourly.hourly_stats.map(h => {
          const date = new Date(h.hour);
          return date.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
        });
        const hourlyRevenueMap = {};
        data.hourly.hourly_revenue.forEach(h => {
          hourlyRevenueMap[h.hour] = h.orders;
        });

        charts.hourly.data.labels = hourlyLabels;
        charts.hourly.data.datasets[0].data = data.hourly.hourly_stats.map(h => h.pageviews);
        charts.hourly.data.datasets[1].data = data.hourly.hourly_stats.map(h => hourlyRevenueMap[h.hour] || 0);
        charts.hourly.update('none');
      }
    }

    function updateLastUpdated() {
      const now = new Date();
      document.getElementById('lastUpdated').textContent = 
        \`Last updated: \${now.toLocaleTimeString()}\`;
    }

    // Filter button handlers
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentDays = parseInt(btn.dataset.days);
        loadAllData();
      });
    });

    // Initial load
    loadAllData();

    // Auto-refresh every 5 minutes
    setInterval(loadAllData, 300000);
  </script>
</body>
</html>
`;
}
