# NewsLens

A "nutrition label" for news. Search any topic, and NewsLens pulls real
articles from multiple outlets and shows you — side by side — how each one's
**tone** and **emphasis** differ. It never claims to detect what's true or
false, and it never assigns a political label. It just shows you *how* the
story is told in different places, so you can decide what to trust.

## Why it's built this way

- **News sources:** Google News RSS + Bing News RSS (both free, no key, search
  by topic, work once deployed) + The Guardian API (free, full article text).
  Together these pull from many different real outlets, not just one. We
  deliberately did **not** use NewsAPI.org — its free tier only works on
  localhost and blocks requests the moment you deploy publicly.
- **AI analysis:** Claude reads each article and reports tone (e.g. Urgent,
  Neutral, Emotional) and what it emphasizes — never a truth/fake verdict or a
  left/right label. Those are judgment calls we don't think an AI should make
  with false confidence.

## 1. Install

You need [Node.js](https://nodejs.org) installed. Then:

```bash
cd newslens
npm install
```

## 2. Add your API key

Copy the example env file:

```bash
cp .env.example .env
```

Open `.env` and paste in your key:

- `ANTHROPIC_API_KEY` — **required.** Get a free key at
  [console.anthropic.com](https://console.anthropic.com) → API Keys.
- `GUARDIAN_API_KEY` — optional, defaults to `"test"` which works fine for
  development. Get your own free key at
  [open-platform.theguardian.com/access](https://open-platform.theguardian.com/access)
  if you want higher limits.

## 3. Run it locally

```bash
npm start
```

Open **http://localhost:3000** in your browser. Type a topic and hit "Compare
Coverage."

## 4. Deploy it live (so judges/friends can use it)

**Render** (recommended, free tier) — one-click option:
1. Push this folder to a GitHub repo.
2. Go to [render.com](https://render.com) → New → Blueprint → connect your
   repo. Render will read `render.yaml` and configure everything
   automatically.
3. It'll prompt you to fill in `ANTHROPIC_API_KEY` (and optionally
   `GUARDIAN_API_KEY`) — paste your keys in.
4. Deploy. You'll get a public URL like `newslens.onrender.com`.

Manual option, if you'd rather not use Blueprints:
1. New → Web Service → connect your repo.
2. Build command: `npm install`. Start command: `npm start`.
3. Add your env vars under Environment → Environment Variables.
4. Deploy.

## Project structure

```
newslens/
├── server.js          # API routes: /api/search, /api/analyze
├── public/
│   └── index.html      # Search UI + comparison cards (vanilla JS, no build step)
├── .env.example        # Copy to .env and fill in your keys
└── package.json
```

## How it works, step by step

There are two modes, both starting from the same search box — no login, no
extra steps either way:

**"Just Show Articles" (fast path)**
1. User types a topic and clicks it.
2. `GET /api/search` fetches matching articles from Google News RSS, Bing News
   RSS, and The Guardian, in parallel, then removes any duplicate URLs.
3. Articles render immediately as plain cards. No AI call happens at all —
   this is the "open, read, leave" path.

**"Compare Tone" (full comparison)**
1. Same search step as above — articles appear on screen right away.
2. Each card independently calls `POST /api/analyze-one`, so tone tags fill
   in one by one as they finish, instead of the whole page waiting on the
   slowest article.
3. Claude reports only tone, emphasis, and notable phrasing per article —
   never a truth/false or political-leaning judgment.

## Extending it

Ideas for next steps, roughly in order of effort:
- Cache search results for a few hours to avoid re-fetching the same topic.
- Add more free sources (e.g. NDTV, Al Jazeera RSS feeds) the same way Google
  News is added.
- Track a source's tone pattern over time ("this outlet tends toward Urgent
  tone across topics") instead of per-article only.
- Let users flag a comparison as interesting/misleading to build a feedback
  loop (store in a database — none is included yet, this is stateless).
