# Kabuly

Personal stock assistant that delivers a Claude-powered AI analysis report every morning via LINE and serves a full dashboard in the browser.

**What it does**

- Registers Japanese and US stocks (holdings + watchlist) — search by name, ticker, or Japanese text
- Fetches 2 years of price data, RSI/MACD/MA indicators, Bollinger Bands, and news every morning
- Computes 2-year historical patterns: 52-week high/low, overbought/oversold frequency, monthly return, volatility
- Claude generates a buy / hold / sell signal with target price and stop-loss tailored to your investment style
- Sends a LINE notification with today's summary → one tap opens the full dashboard
- Each stock has a dedicated chat page where you can ask Claude anything about it

---

## Stack

| Layer | Technology |
|---|---|
| Analysis pipeline | Python 3.13 + uv |
| Price & indicators | yfinance + ta |
| AI analysis & chat | Claude API (claude-sonnet-4-6) |
| News | Google News RSS + NewsAPI |
| Notifications | LINE Messaging API v3 |
| Web server | Go 1.24 |
| Frontend | React + Vite + Tailwind CSS |
| Database | SQLite |
| Scheduler | APScheduler (daily 07:00 JST) |

---

## Quick Start

### 1. Clone and configure

```bash
git clone <repo>
cd kabuly
cp .env.example .env
# Fill in your API keys (see Environment Variables below)
```

### 2. Install everything

```bash
make install
```

This installs Go deps, npm packages, Python packages via uv, and initializes the database.

### 3. Add stocks

```bash
cd pipeline
uv run python main.py add 7974 --name "任天堂" --market JP --holding --price 8000
uv run python main.py add NVDA --name "NVIDIA" --market US --watchlist
```

### 4. Start dev servers

```bash
make dev
# Go API → http://localhost:8080
# Vite   → http://localhost:5173
```

### 5. Run a test analysis (no LINE notification)

```bash
make pipeline
```

---

## Architecture

The pipeline and server are decoupled — they share a single SQLite file and never call each other over HTTP.

```
pipeline/ (Python)       data/kabu.db        server/ (Go) + frontend/ (React)
  collector.py  ─write─► daily_reports ─read─► GET /api/dashboard
  analyzer.py   ─write─► news_items    ─read─► GET /api/stock/{ticker}
  main.py       ─write─► daily_insights─read─► GET /api/stocks
                          stocks (shared R/W)
```

The pipeline runs once a day (cron or `make pipeline`). The Go server runs continuously and serves the React SPA.

---

## Makefile Reference

| Command | Description |
|---|---|
| `make install` | Install all dependencies and initialize the database |
| `make dev` | Start Go API server + Vite dev server in parallel |
| `make pipeline` | Run the analysis pipeline once (no LINE notification) |

---

## Pipeline CLI Reference

All commands run from the `pipeline/` directory with `uv run python main.py <command>`.

| Command | Description |
|---|---|
| `init-db` | Create all database tables |
| `add <ticker> --name <n> --market JP\|US --holding\|--watchlist [--price N]` | Register a stock |
| `remove <ticker>` | Remove a stock |
| `list` | List all registered stocks |
| `run [--no-notify] [--ticker TICKER]` | Run full analysis pipeline |
| `backtest --days N` | Simple signal accuracy backtest |

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Description | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API key | [console.anthropic.com](https://console.anthropic.com) |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE bot access token | [developers.line.biz](https://developers.line.biz) |
| `LINE_CHANNEL_SECRET` | LINE channel secret | Same as above |
| `LINE_USER_ID` | Your LINE user ID | LINE Developers console |
| `NEWSAPI_KEY` | NewsAPI key (100 req/day free) | [newsapi.org](https://newsapi.org) |
| `JQUANTS_REFRESH_TOKEN` | J-Quants refresh token | [jpx-jquants.com](https://jpx-jquants.com) |

---

## Project Structure

```
kabuly/
├── pipeline/
│   ├── main.py          # CLI entry point + APScheduler
│   ├── collector.py     # Price data + technical indicators
│   ├── analyzer.py      # Claude API investment signal generation
│   ├── news.py          # RSS + NewsAPI + daily insight generation
│   ├── notifier.py      # LINE Flex Message sender
│   ├── db.py            # SQLite CRUD
│   ├── config.py        # Environment variables
│   └── pyproject.toml   # uv dependencies
│
├── server/
│   ├── main.go          # HTTP server + routing
│   ├── handlers/        # Dashboard, chat, profile, API handlers
│   └── db/              # SQLite read layer
│
├── frontend/
│   ├── src/             # React components + pages
│   └── package.json     # npm dependencies
│
├── data/kabu.db         # SQLite database (git-ignored)
├── Makefile
└── .env                 # API keys (git-ignored)
```

---

## Cron (production)

```cron
# Run every weekday morning at 07:00 JST
0 7 * * 1-5 cd /path/to/kabuly/pipeline && uv run python main.py run
```
