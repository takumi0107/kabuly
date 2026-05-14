# Kabuly 📊

Personal stock assistant that delivers a Claude-powered AI analysis report every morning via LINE and serves a full dashboard in the browser.

**What it does**

- Registers Japanese and US stocks (holdings + watchlist)
- Fetches price data, RSI/MACD/MA indicators, and news every morning
- Claude generates a buy / hold / sell signal with a concrete recommended purchase amount tailored to your investment profile
- Sends a LINE notification with today's summary → one tap opens the full dashboard
- Each stock has a dedicated chat page where you can ask Claude anything about it

---

## Stack

| Layer | Technology |
|---|---|
| Analysis pipeline | Python 3.13 + uv |
| Price & indicators | yfinance + ta |
| AI analysis & chat | Claude API (`claude-sonnet-4-20250514`) |
| News | Google News RSS + NewsAPI |
| Notifications | LINE Messaging API v3 |
| Web server | Go 1.26 |
| Database | SQLite |
| Scheduler | APScheduler (daily 07:00 JST) |

---

## Setup

### 1. Clone and configure

```bash
git clone <repo>
cd kabuly
cp .env.example .env
# Fill in your API keys (see Environment Variables below)
```

### 2. Python — install dependencies

```bash
cd python
uv sync          # creates .venv and installs all packages
```

### 3. Initialize the database and add stocks

```bash
uv run python main.py init-db

uv run python main.py add 7974 --name "任天堂" --market JP --holding --price 8000
uv run python main.py add NVDA --name "NVIDIA" --market US --watchlist
```

### 4. Run a test analysis (no LINE notification)

```bash
uv run python main.py run --no-notify
```

### 5. Start the web dashboard

```bash
cd ../go
go run .
# → http://localhost:8080
```

---

## CLI Reference

All commands run from the `python/` directory with `uv run python main.py <command>`.

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
├── python/
│   ├── main.py          # CLI entry point + APScheduler
│   ├── collector.py     # Price data + technical indicators
│   ├── analyzer.py      # Claude API investment signal generation
│   ├── news.py          # RSS + NewsAPI + daily insight generation
│   ├── notifier.py      # LINE Flex Message sender
│   ├── db.py            # SQLite CRUD
│   ├── config.py        # Environment variables
│   └── pyproject.toml   # uv dependencies
│
├── go/
│   ├── main.go          # HTTP server + routing
│   ├── handlers/        # Dashboard, chat, profile, API handlers
│   ├── templates/       # index.html, stock.html, profile.html
│   └── db/sqlite.go     # SQLite read layer
│
├── data/kabu.db         # SQLite database (git-ignored)
└── .env                 # API keys (git-ignored)
```

---

## Cron (production)

```cron
# Run every weekday morning at 07:00 JST
0 7 * * 1-5 cd /path/to/kabuly/python && uv run python main.py run
```
