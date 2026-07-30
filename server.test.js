const request = require('supertest');

// Mock the scraper module BEFORE requiring the app
jest.mock('./scraper', () => ({
  scrapeGoogle: jest.fn(),
}));

const app = require('./server');
const { scrapeGoogle } = require('./scraper');

// ---------------------------------------------------------------------------
// Unit tests for the Google Search Scraper API
// ---------------------------------------------------------------------------

describe('API Endpoints', () => {
  // ---- Health check -------------------------------------------------------
  describe('GET /api/health', () => {
    it('should return status ok with 200', async () => {
      const res = await request(app).get('/api/health');
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('timestamp');
    });
  });

  // ---- Search endpoint – input validation ---------------------------------
  describe('POST /api/search – input validation', () => {
    it('should return 400 when query is missing', async () => {
      const res = await request(app).post('/api/search').send({});
      expect(res.statusCode).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should return 400 when query is empty string', async () => {
      const res = await request(app).post('/api/search').send({ query: '' });
      expect(res.statusCode).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should return 400 when query is only whitespace', async () => {
      const res = await request(app).post('/api/search').send({ query: '   ' });
      expect(res.statusCode).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should return 400 when query is not a string', async () => {
      const res = await request(app).post('/api/search').send({ query: 12345 });
      expect(res.statusCode).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });

  // ---- Search endpoint – response structure (mocked scraper) --------------
  describe('POST /api/search – response structure (mocked scraper)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return structured JSON with expected fields', async () => {
      scrapeGoogle.mockResolvedValueOnce([
        { title: 'Test Result 1', url: 'https://example.com/page1', snippet: 'Snippet 1.' },
        { title: 'Test Result 2', url: 'https://example.com/page2', snippet: 'Snippet 2.' },
      ]);

      const res = await request(app)
        .post('/api/search')
        .send({ query: 'test keyword' });

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('query', 'test keyword');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('totalResults');
      expect(res.body).toHaveProperty('results');
    });

    it('should return an array of results', async () => {
      scrapeGoogle.mockResolvedValueOnce([
        { title: 'T1', url: 'https://a.com', snippet: 's' },
        { title: 'T2', url: 'https://b.com', snippet: 's' },
      ]);

      const res = await request(app)
        .post('/api/search')
        .send({ query: 'test keyword' });

      expect(Array.isArray(res.body.results)).toBe(true);
      expect(res.body.results.length).toBe(2);
    });

    it('each result should have title, url, and snippet with correct types', async () => {
      scrapeGoogle.mockResolvedValueOnce([
        { title: 'A Title', url: 'https://example.com', snippet: 'A snippet.' },
      ]);

      const res = await request(app)
        .post('/api/search')
        .send({ query: 'test keyword' });

      for (const item of res.body.results) {
        expect(item).toHaveProperty('title');
        expect(item).toHaveProperty('url');
        expect(item).toHaveProperty('snippet');
        expect(typeof item.title).toBe('string');
        expect(typeof item.url).toBe('string');
        expect(typeof item.snippet).toBe('string');
        expect(item.title.length).toBeGreaterThan(0);
        expect(item.url).toMatch(/^https?:\/\//);
      }
    });

    it('should trim whitespace from the query', async () => {
      scrapeGoogle.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/search')
        .send({ query: '   padded query   ' });

      expect(res.body.query).toBe('padded query');
    });

    it('totalResults should equal the length of results array', async () => {
      scrapeGoogle.mockResolvedValueOnce([
        { title: 'X', url: 'https://x.com', snippet: 'x' },
        { title: 'Y', url: 'https://y.com', snippet: 'y' },
        { title: 'Z', url: 'https://z.com', snippet: 'z' },
      ]);

      const res = await request(app)
        .post('/api/search')
        .send({ query: 'anything' });

      expect(res.body.totalResults).toBe(res.body.results.length);
      expect(res.body.totalResults).toBe(3);
    });

    it('should return 500 when scraper throws an error', async () => {
      scrapeGoogle.mockRejectedValueOnce(new Error('Network timeout'));

      const res = await request(app)
        .post('/api/search')
        .send({ query: 'fail' });

      expect(res.statusCode).toBe(500);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('Failed to fetch search results');
    });
  });
});

// ---------------------------------------------------------------------------
// Unit tests for the parsing logic used inside the browser context
// (replicated here to test the core algorithm)
// ---------------------------------------------------------------------------
describe('Browser-side parsing logic (unit)', () => {
  it('should return empty array when no blocks match', () => {
    const blocks = [];
    const output = [];

    for (const block of blocks) {
      const linkEl = block.querySelector('a[href^="http"]');
      if (!linkEl) continue;
      const url = linkEl.getAttribute('href');
      const titleEl = block.querySelector('h3');
      const title = titleEl ? titleEl.textContent.trim() : '';
      if (url && title) {
        output.push({ title, url, snippet: '' });
      }
    }

    expect(output).toEqual([]);
  });

  it('should correctly extract title and url from a result block', () => {
    const block = {
      querySelector: (sel) => {
        if (sel === 'a[href^="http"]') return { getAttribute: () => 'https://example.com' };
        if (sel === 'h3') return { textContent: 'Example Title' };
        return null;
      },
      querySelectorAll: () => [],
    };
    const blocks = [block];
    const output = [];

    for (const b of blocks) {
      const linkEl = b.querySelector('a[href^="http"]');
      if (!linkEl) continue;
      const url = linkEl.getAttribute('href');
      const titleEl = b.querySelector('h3');
      const title = titleEl ? titleEl.textContent.trim() : '';
      if (url && title) {
        output.push({ title, url, snippet: '' });
      }
    }

    expect(output).toHaveLength(1);
    expect(output[0].title).toBe('Example Title');
    expect(output[0].url).toBe('https://example.com');
  });

  it('should skip blocks without a link', () => {
    const block = {
      querySelector: (sel) => {
        if (sel === 'a[href^="http"]') return null;
        if (sel === 'h3') return { textContent: 'No Link' };
        return null;
      },
      querySelectorAll: () => [],
    };
    const blocks = [block];
    const output = [];

    for (const b of blocks) {
      const linkEl = b.querySelector('a[href^="http"]');
      if (!linkEl) continue;
      const url = linkEl.getAttribute('href');
      const titleEl = b.querySelector('h3');
      const title = titleEl ? titleEl.textContent.trim() : '';
      if (url && title) {
        output.push({ title, url, snippet: '' });
      }
    }

    expect(output).toHaveLength(0);
  });

  it('should deduplicate results by URL', () => {
    const items = [
      { title: 'A', url: 'https://example.com/a', snippet: 's1' },
      { title: 'B duplicate', url: 'https://example.com/a', snippet: 's2' },
      { title: 'C', url: 'https://example.com/c', snippet: 's3' },
    ];

    const seen = new Set();
    const deduped = items.filter((r) => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    expect(deduped).toHaveLength(2);
    expect(deduped[0].title).toBe('A');
    expect(deduped[1].title).toBe('C');
  });
});

// ---------------------------------------------------------------------------
// Miscellaneous
// ---------------------------------------------------------------------------
describe('Miscellaneous', () => {
  it('should return 404 for unknown GET routes', async () => {
    const res = await request(app).get('/non-existent');
    expect(res.statusCode).toBe(404);
  });
});