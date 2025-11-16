-- Migration number: 0002 	 2025-11-16T00:00:00.000Z
-- Custom Analytics System Schema

-- Drop the old comments table
DROP TABLE IF EXISTS comments;

-- Page Views Table
CREATE TABLE IF NOT EXISTS pageviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    url TEXT NOT NULL,
    referrer TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_content TEXT,
    utm_term TEXT,
    country TEXT,
    device_type TEXT,
    visitor_hash TEXT NOT NULL,
    session_hash TEXT NOT NULL
);

-- Events Table (purchases, clicks, etc)
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    event_name TEXT NOT NULL,
    event_value REAL,
    metadata TEXT,
    url TEXT,
    country TEXT,
    device_type TEXT,
    visitor_hash TEXT NOT NULL,
    session_hash TEXT NOT NULL
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_pageviews_timestamp ON pageviews(timestamp);
CREATE INDEX IF NOT EXISTS idx_pageviews_url ON pageviews(url);
CREATE INDEX IF NOT EXISTS idx_pageviews_visitor ON pageviews(visitor_hash);
CREATE INDEX IF NOT EXISTS idx_pageviews_session ON pageviews(session_hash);
CREATE INDEX IF NOT EXISTS idx_pageviews_country ON pageviews(country);
CREATE INDEX IF NOT EXISTS idx_pageviews_device ON pageviews(device_type);

CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_name ON events(event_name);
CREATE INDEX IF NOT EXISTS idx_events_visitor ON events(visitor_hash);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_hash);
