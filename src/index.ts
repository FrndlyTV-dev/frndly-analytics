import { renderDashboard } from "./renderHtml";

// GA4 format from tag worker
interface GA4TrackingData {
  // Page info (GA4 format)
  page_location?: string;
  page_url?: string;
  page_referrer?: string;
  page_title?: string;

  // Event info
  event?: string;

  // UTM parameters
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;

  // Session/visitor
  client_id?: string;
  clientId?: string;
  session_id?: string;
  sessionId?: string;
  user_agent?: string;

  // Purchase events
  transaction_id?: string;
  transactionId?: string;
  value?: number;
  transactionTotal?: number;
  currency?: string;
  reference_id?: string;
  referenceId?: string;
  frndly_id?: string;
  frndlyId?: string;
  items?: any[];
  transactionProducts?: any[];

  // Custom event parameters
  params?: any;

  // Direct format (also support this for backwards compatibility)
  url?: string;
  referrer?: string;
  event_name?: string;
  event_value?: number;
  metadata?: any;
  visitor_id?: string;
}

interface TrackingData {
  url: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  event_name?: string;
  event_value?: number;
  metadata?: any;
  visitor_id?: string;
  session_id?: string;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Enable CORS for all requests
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle OPTIONS request for CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // POST /track - Tracking endpoint
      if (path === '/track' && request.method === 'POST') {
        return await handleTrack(request, env, corsHeaders);
      }

      // GET /api/stats - JSON stats API
      if (path === '/api/stats' && request.method === 'GET') {
        return await handleStats(request, env, corsHeaders);
      }

      // GET / or /analytics - Dashboard
      if ((path === '/' || path === '/analytics') && request.method === 'GET') {
        return new Response(renderDashboard(), {
          headers: {
            'content-type': 'text/html',
            ...corsHeaders,
          },
        });
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (error) {
      console.error('Error:', error);
      return new Response('Internal Server Error', {
        status: 500,
        headers: corsHeaders
      });
    }
  },
} satisfies ExportedHandler<Env>;

// Helper function to generate privacy-friendly visitor hash
async function generateHash(input: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
}

// Get current date as YYYYMMDD for daily hash rotation
function getCurrentDateSalt(): string {
  const now = new Date();
  return now.toISOString().split('T')[0].replace(/-/g, '');
}

// Transform GA4 format to Analytics format
function transformGA4ToAnalytics(ga4Data: GA4TrackingData): TrackingData {
  // If already in direct format, use it
  if (ga4Data.url && ga4Data.event_name) {
    return ga4Data as TrackingData;
  }

  const analytics: TrackingData = {
    // Required: URL (try multiple GA4 fields)
    url: ga4Data.url || ga4Data.page_location || ga4Data.page_url || '',

    // Referrer
    referrer: ga4Data.referrer || ga4Data.page_referrer,

    // UTM parameters (already in correct format)
    utm_source: ga4Data.utm_source,
    utm_medium: ga4Data.utm_medium,
    utm_campaign: ga4Data.utm_campaign,
    utm_content: ga4Data.utm_content,
    utm_term: ga4Data.utm_term,

    // Visitor/Session tracking
    visitor_id: ga4Data.visitor_id || ga4Data.client_id || ga4Data.clientId,
    session_id: ga4Data.session_id || ga4Data.sessionId,
  };

  // Handle events
  const eventName = ga4Data.event_name || ga4Data.event;

  if (eventName && eventName !== 'page_view') {
    analytics.event_name = eventName;

    // Handle purchase/orderCompleted events
    if (eventName === 'purchase' || eventName === 'orderCompleted') {
      analytics.event_value = ga4Data.event_value || ga4Data.value || ga4Data.transactionTotal;

      // Store purchase metadata
      analytics.metadata = {
        transaction_id: ga4Data.transaction_id || ga4Data.transactionId,
        currency: ga4Data.currency || 'USD',
        reference_id: ga4Data.reference_id || ga4Data.referenceId,
        frndly_id: ga4Data.frndly_id || ga4Data.frndlyId,
        items: ga4Data.items || ga4Data.transactionProducts || [],
      };
    } else {
      // For other events, use params or existing metadata
      analytics.event_value = ga4Data.event_value || ga4Data.value;
      analytics.metadata = ga4Data.metadata || ga4Data.params;
    }
  }

  return analytics;
}

// POST /track handler
async function handleTrack(request: Request, env: Env, corsHeaders: any): Promise<Response> {
  // Accept raw data from tag worker (GA4 format)
  const rawData: GA4TrackingData = await request.json();

  // Transform GA4 format to analytics format
  const data: TrackingData = transformGA4ToAnalytics(rawData);

  // Validate required fields
  if (!data.url) {
    return new Response(JSON.stringify({ error: 'URL is required' }), {
      status: 400,
      headers: {
        'content-type': 'application/json',
        ...corsHeaders,
      },
    });
  }

  // Get visitor information from headers
  const cfData = request.cf as any;
  const country = cfData?.country || 'Unknown';
  const userAgent = request.headers.get('User-Agent') || rawData.user_agent || '';
  const deviceType = getDeviceType(userAgent);

  // Generate privacy-friendly hashes
  const dateSalt = getCurrentDateSalt();
  const visitorSource = data.visitor_id || request.headers.get('CF-Connecting-IP') || 'unknown';
  const sessionSource = data.session_id || `${visitorSource}-${Date.now()}`;

  const visitorHash = await generateHash(visitorSource, dateSalt);
  const sessionHash = await generateHash(sessionSource, 'session');

  const timestamp = Math.floor(Date.now() / 1000);

  console.log('Analytics tracking:', {
    event: data.event_name || 'pageview',
    url: data.url,
    visitor_hash: visitorHash.substring(0, 8) + '...',
    session_hash: sessionHash.substring(0, 8) + '...',
  });

  // If it's an event, store in events table
  if (data.event_name) {
    const stmt = env.ANALYTICS_DB.prepare(`
      INSERT INTO events (timestamp, event_name, event_value, metadata, url, country, device_type, visitor_hash, session_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    await stmt.bind(
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

  // Always store pageview
  const stmt = env.ANALYTICS_DB.prepare(`
    INSERT INTO pageviews (timestamp, url, referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term, country, device_type, visitor_hash, session_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  await stmt.bind(
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
      'content-type': 'application/json',
      ...corsHeaders,
    },
  });
}

// GET /api/stats handler
async function handleStats(request: Request, env: Env, corsHeaders: any): Promise<Response> {
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get('days') || '7');

  const startTimestamp = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);

  // Get total pageviews
  const pageviewsResult = await env.ANALYTICS_DB.prepare(`
    SELECT COUNT(*) as count FROM pageviews WHERE timestamp >= ?
  `).bind(startTimestamp).first();

  // Get unique visitors
  const visitorsResult = await env.ANALYTICS_DB.prepare(`
    SELECT COUNT(DISTINCT visitor_hash) as count FROM pageviews WHERE timestamp >= ?
  `).bind(startTimestamp).first();

  // Get unique sessions
  const sessionsResult = await env.ANALYTICS_DB.prepare(`
    SELECT COUNT(DISTINCT session_hash) as count FROM pageviews WHERE timestamp >= ?
  `).bind(startTimestamp).first();

  // Get top pages
  const topPages = await env.ANALYTICS_DB.prepare(`
    SELECT url, COUNT(*) as views
    FROM pageviews
    WHERE timestamp >= ?
    GROUP BY url
    ORDER BY views DESC
    LIMIT 10
  `).bind(startTimestamp).all();

  // Get top referrers
  const topReferrers = await env.ANALYTICS_DB.prepare(`
    SELECT referrer, COUNT(*) as views
    FROM pageviews
    WHERE timestamp >= ? AND referrer IS NOT NULL AND referrer != ''
    GROUP BY referrer
    ORDER BY views DESC
    LIMIT 10
  `).bind(startTimestamp).all();

  // Get top countries
  const topCountries = await env.ANALYTICS_DB.prepare(`
    SELECT country, COUNT(*) as views
    FROM pageviews
    WHERE timestamp >= ?
    GROUP BY country
    ORDER BY views DESC
    LIMIT 10
  `).bind(startTimestamp).all();

  // Get device breakdown
  const deviceBreakdown = await env.ANALYTICS_DB.prepare(`
    SELECT device_type, COUNT(*) as views
    FROM pageviews
    WHERE timestamp >= ?
    GROUP BY device_type
    ORDER BY views DESC
  `).bind(startTimestamp).all();

  // Get top UTM sources
  const utmSources = await env.ANALYTICS_DB.prepare(`
    SELECT utm_source, COUNT(*) as views
    FROM pageviews
    WHERE timestamp >= ? AND utm_source IS NOT NULL
    GROUP BY utm_source
    ORDER BY views DESC
    LIMIT 10
  `).bind(startTimestamp).all();

  // Get events with revenue
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
      end: new Date().toISOString(),
    },
    overview: {
      pageviews: pageviewsResult?.count || 0,
      visitors: visitorsResult?.count || 0,
      sessions: sessionsResult?.count || 0,
    },
    topPages: topPages.results || [],
    topReferrers: topReferrers.results || [],
    topCountries: topCountries.results || [],
    deviceBreakdown: deviceBreakdown.results || [],
    utmSources: utmSources.results || [],
    events: eventsResult.results || [],
  };

  return new Response(JSON.stringify(stats, null, 2), {
    headers: {
      'content-type': 'application/json',
      ...corsHeaders,
    },
  });
}

// Helper to detect device type from User-Agent
function getDeviceType(userAgent: string): string {
  const ua = userAgent.toLowerCase();

  if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua)) {
    return 'mobile';
  }
  if (/tablet|ipad/i.test(ua)) {
    return 'tablet';
  }
  return 'desktop';
}
