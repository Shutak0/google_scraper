const express = require('express');
const cors = require('cors');
const path = require('path');
const { scrapeGoogle } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint: POST /api/search
app.post('/api/search', async (req, res) => {
  const { query } = req.body;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'Query parameter is required and must be a non-empty string.' });
  }

  try {
    const results = await scrapeGoogle(query.trim());
    return res.json({
      query: query.trim(),
      timestamp: new Date().toISOString(),
      totalResults: results.length,
      results,
    });
  } catch (err) {
    console.error('Scraping error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch search results. ' + err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
