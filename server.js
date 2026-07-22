require('dotenv').config();
const express = require('express');
const path = require('path');
const Parser = require('rss-parser');

const app = express();
const parser = new Parser();
// Bing's RSS includes a <source url="..."> tag we want to capture for the
// outlet name, so this instance is configured to keep it.
const bingParser = new Parser({ customFields: { item: ['source'] } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GUARDIAN_API_KEY = process.env.GUARDIAN_API_KEY || 'test'; // "test" works for low-volume, free
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

// ---------------------------------------------------------------------------
// Source 1: Google News RSS — free, no key, works in production (no localhost
// restriction like NewsAPI.org's free tier has). Aggregates many outlets.
// ---------------------------------------------------------------------------
async function fetchGoogleNews(topic, limit = 5) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const feed = await parser.parseURL(url);
  return feed.items.slice(0, limit).map((item) => ({
    source: (item.title && item.title.split(' - ').pop()) || 'Google News source',
    title: item.title,
    url: item.link,
    publishedAt: item.pubDate,
    snippet: item.contentSnippet || '',
  }));
}

// ---------------------------------------------------------------------------
// Source 2: The Guardian Open Platform — free, full article text, no
// production restriction. Good for deeper tone analysis on at least one source.
// ---------------------------------------------------------------------------
async function fetchGuardian(topic, limit = 5) {
  const url = `https://content.guardianapis.com/search?q=${encodeURIComponent(
    topic
  )}&show-fields=trailText,bodyText&page-size=${limit}&api-key=${GUARDIAN_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  const results = data?.response?.results || [];
  return results.map((r) => ({
    source: 'The Guardian',
    title: r.webTitle,
    url: r.webUrl,
    publishedAt: r.webPublicationDate,
    snippet: r.fields?.trailText || (r.fields?.bodyText || '').slice(0, 500),
  }));
}

// ---------------------------------------------------------------------------
// Source 3: Bing News search RSS — free, no key, search-capable, aggregates
// many outlets (different mix than Google News, which broadens coverage).
// ---------------------------------------------------------------------------
function extractBingSourceName(item) {
  if (item.source) {
    if (typeof item.source === 'string') return item.source;
    if (typeof item.source === 'object') return item.source._ || item.source['#'] || null;
  }
  if (item.title && item.title.includes(' - ')) return item.title.split(' - ').pop();
  return null;
}

async function fetchBingNews(topic, limit = 5) {
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(topic)}&format=RSS`;
  const feed = await bingParser.parseURL(url);
  return feed.items.slice(0, limit).map((item) => ({
    source: extractBingSourceName(item) || 'Bing News source',
    title: item.title,
    url: item.link,
    publishedAt: item.pubDate,
    snippet: item.contentSnippet || '',
  }));
}

// ---------------------------------------------------------------------------
// AI analysis — deliberately scoped to TONE and EMPHASIS only.
// This app never claims to detect "true" vs "false" news, and never assigns
// a political left/right label — both are judgment calls we don't think an
// AI (or anyone) should make with false confidence. See README for why.
// ---------------------------------------------------------------------------
async function analyzeArticle(article) {
  const prompt = `You are a media-literacy assistant. Read this news article summary and describe ONLY its tone and framing choices. Do not evaluate whether it is true, false, biased toward a political side, or trustworthy — only describe HOW it is written.

Source: ${article.source}
Title: ${article.title}
Text: ${article.snippet}

Respond in strict JSON with exactly these fields and nothing else:
{
  "tone": "one or two words, e.g. Neutral, Urgent, Emotional, Analytical, Cautious",
  "emphasis": "one short sentence describing what this article chose to highlight or lead with",
  "notable_language": "one short phrase paraphrasing a distinctive word choice, or an empty string if nothing stands out"
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  const textBlock = data?.content?.find((c) => c.type === 'text')?.text || '{}';
  try {
    const clean = textBlock.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { tone: 'Unknown', emphasis: 'Could not analyze this article.', notable_language: '' };
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/api/search', async (req, res) => {
  const topic = (req.query.topic || '').trim();
  if (!topic) {
    return res.status(400).json({ error: 'Please enter a topic to search for.' });
  }
  try {
    const [googleResults, guardianResults, bingResults] = await Promise.all([
      fetchGoogleNews(topic).catch(() => []),
      fetchGuardian(topic).catch(() => []),
      fetchBingNews(topic).catch(() => []),
    ]);
    const merged = [...guardianResults, ...googleResults, ...bingResults];
    const seen = new Set();
    const articles = merged.filter((a) => {
      if (!a.url || seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });
    if (articles.length === 0) {
      return res.status(404).json({ error: 'No articles found for that topic. Try a different search term.' });
    }
    res.json({ topic, articles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong fetching news. Please try again.' });
  }
});

// Batch analysis (kept for convenience / scripting use, not used by the UI)
app.post('/api/analyze', async (req, res) => {
  const { articles } = req.body;
  if (!Array.isArray(articles) || articles.length === 0) {
    return res.status(400).json({ error: 'No articles were provided for analysis.' });
  }
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. Add it to your .env file.' });
  }
  try {
    const analyses = await Promise.all(
      articles.map(async (a) => ({ ...a, analysis: await analyzeArticle(a) }))
    );
    res.json({ analyses });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong analyzing these articles. Please try again.' });
  }
});

// Single-article analysis — the UI calls this once per article in parallel,
// so each card's tone tag "pops in" as soon as it's ready instead of the
// whole page waiting on the slowest article.
app.post('/api/analyze-one', async (req, res) => {
  const { article } = req.body;
  if (!article || !article.title) {
    return res.status(400).json({ error: 'No article was provided for analysis.' });
  }
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. Add it to your .env file.' });
  }
  try {
    const analysis = await analyzeArticle(article);
    res.json({ analysis });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not analyze this article.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`NewsLens server running on http://localhost:${PORT}`));
