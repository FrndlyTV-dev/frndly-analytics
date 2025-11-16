export function renderDashboard() {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FrndlyTV Analytics Dashboard</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #333;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }

    header {
      text-align: center;
      color: white;
      margin-bottom: 30px;
    }

    h1 {
      font-size: 2.5rem;
      font-weight: 700;
      margin-bottom: 10px;
    }

    .subtitle {
      font-size: 1.1rem;
      opacity: 0.9;
    }

    .filters {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-bottom: 30px;
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
    }

    .filter-btn:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: translateY(-2px);
    }

    .filter-btn.active {
      background: white;
      color: #667eea;
      border-color: white;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }

    .stat-card {
      background: white;
      padding: 25px;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .stat-label {
      font-size: 0.9rem;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 10px;
    }

    .stat-value {
      font-size: 2.5rem;
      font-weight: 700;
      color: #667eea;
    }

    .data-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 20px;
      margin-bottom: 20px;
    }

    .data-card {
      background: white;
      padding: 25px;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .data-card h2 {
      font-size: 1.3rem;
      margin-bottom: 20px;
      color: #333;
      border-bottom: 2px solid #667eea;
      padding-bottom: 10px;
    }

    .data-list {
      list-style: none;
    }

    .data-item {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #eee;
    }

    .data-item:last-child {
      border-bottom: none;
    }

    .data-label {
      color: #555;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-right: 10px;
    }

    .data-value {
      font-weight: 600;
      color: #667eea;
    }

    .loading {
      text-align: center;
      color: white;
      font-size: 1.2rem;
      padding: 40px;
    }

    .error {
      background: #ff6b6b;
      color: white;
      padding: 15px;
      border-radius: 8px;
      margin: 20px 0;
      text-align: center;
    }

    .last-updated {
      text-align: center;
      color: white;
      margin-top: 20px;
      opacity: 0.8;
      font-size: 0.9rem;
    }

    .empty-state {
      text-align: center;
      color: #999;
      padding: 20px;
      font-style: italic;
    }

    @media (max-width: 768px) {
      h1 {
        font-size: 1.8rem;
      }

      .data-grid {
        grid-template-columns: 1fr;
      }

      .filter-btn {
        padding: 10px 16px;
        font-size: 0.9rem;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>FrndlyTV Analytics</h1>
      <p class="subtitle">Real-time analytics dashboard</p>
    </header>

    <div class="filters">
      <button class="filter-btn" data-days="1">Today</button>
      <button class="filter-btn active" data-days="7">7 Days</button>
      <button class="filter-btn" data-days="30">30 Days</button>
    </div>

    <div id="dashboard">
      <div class="loading">Loading analytics data...</div>
    </div>

    <div class="last-updated" id="lastUpdated"></div>
  </div>

  <script>
    let currentDays = 7;
    let autoRefreshTimer;

    // Fetch and render analytics data
    async function loadAnalytics() {
      try {
        const response = await fetch(\`/api/stats?days=\${currentDays}\`);
        if (!response.ok) throw new Error('Failed to fetch analytics');

        const data = await response.json();
        renderDashboard(data);
        updateLastUpdated();
      } catch (error) {
        console.error('Error loading analytics:', error);
        document.getElementById('dashboard').innerHTML =
          '<div class="error">Failed to load analytics data. Please try again.</div>';
      }
    }

    function renderDashboard(data) {
      const html = \`
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Total Pageviews</div>
            <div class="stat-value">\${data.overview.pageviews.toLocaleString()}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Unique Visitors</div>
            <div class="stat-value">\${data.overview.visitors.toLocaleString()}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Sessions</div>
            <div class="stat-value">\${data.overview.sessions.toLocaleString()}</div>
          </div>
        </div>

        <div class="data-grid">
          <div class="data-card">
            <h2>Top Pages</h2>
            \${renderList(data.topPages, 'url', 'views')}
          </div>

          <div class="data-card">
            <h2>Top Referrers</h2>
            \${renderList(data.topReferrers, 'referrer', 'views')}
          </div>

          <div class="data-card">
            <h2>Top Countries</h2>
            \${renderList(data.topCountries, 'country', 'views')}
          </div>

          <div class="data-card">
            <h2>Device Types</h2>
            \${renderList(data.deviceBreakdown, 'device_type', 'views')}
          </div>

          <div class="data-card">
            <h2>UTM Sources</h2>
            \${renderList(data.utmSources, 'utm_source', 'views')}
          </div>

          <div class="data-card">
            <h2>Events</h2>
            \${renderEventsList(data.events)}
          </div>
        </div>
      \`;

      document.getElementById('dashboard').innerHTML = html;
    }

    function renderList(items, labelKey, valueKey) {
      if (!items || items.length === 0) {
        return '<div class="empty-state">No data available</div>';
      }

      return \`
        <ul class="data-list">
          \${items.map(item => \`
            <li class="data-item">
              <span class="data-label" title="\${item[labelKey]}">\${item[labelKey]}</span>
              <span class="data-value">\${item[valueKey].toLocaleString()}</span>
            </li>
          \`).join('')}
        </ul>
      \`;
    }

    function renderEventsList(events) {
      if (!events || events.length === 0) {
        return '<div class="empty-state">No events tracked</div>';
      }

      return \`
        <ul class="data-list">
          \${events.map(event => \`
            <li class="data-item">
              <span class="data-label">\${event.event_name}</span>
              <span class="data-value">
                \${event.count} events
                \${event.total_value ? \` • $\${event.total_value.toFixed(2)}\` : ''}
              </span>
            </li>
          \`).join('')}
        </ul>
      \`;
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
        loadAnalytics();
      });
    });

    // Auto-refresh every 30 seconds
    function startAutoRefresh() {
      if (autoRefreshTimer) clearInterval(autoRefreshTimer);
      autoRefreshTimer = setInterval(loadAnalytics, 30000);
    }

    // Initial load
    loadAnalytics();
    startAutoRefresh();

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    });
  </script>
</body>
</html>
`;
}
