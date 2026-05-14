"""
Environment variable loading and constant definitions.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root
_root = Path(__file__).parent.parent
load_dotenv(_root / ".env")

# ── Anthropic ──────────────────────────────────────────
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = "claude-sonnet-4-20250514"

# ── LINE ───────────────────────────────────────────────
LINE_CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "")
LINE_CHANNEL_SECRET = os.getenv("LINE_CHANNEL_SECRET", "")
LINE_USER_ID = os.getenv("LINE_USER_ID", "")

# ── NewsAPI ────────────────────────────────────────────
NEWSAPI_KEY = os.getenv("NEWSAPI_KEY", "")

# ── J-Quants ───────────────────────────────────────────
# Refresh token obtained from https://jpx-jquants.com (used to get short-lived ID tokens)
JQUANTS_REFRESH_TOKEN = os.getenv("JQUANTS_REFRESH_TOKEN", "")

# ── Server ─────────────────────────────────────────────
PORT = int(os.getenv("PORT", "8080"))
DASHBOARD_URL = os.getenv("DASHBOARD_URL", "http://localhost:8080")

_raw_db_path = os.getenv("DB_PATH", "")
if _raw_db_path:
    # Resolve relative paths against the project root, not the cwd
    _p = Path(_raw_db_path)
    DB_PATH = str(_p if _p.is_absolute() else _root / _p)
else:
    DB_PATH = str(_root / "data" / "kabu.db")

# ── Scheduler ──────────────────────────────────────────
# Run every morning at 07:00 Asia/Tokyo on weekdays
SCHEDULE_HOUR = 7
SCHEDULE_MINUTE = 0
TIMEZONE = "Asia/Tokyo"

# ── Investment style multipliers ───────────────────────
STYLE_MULTIPLIER = {
    "conservative": 0.5,   # use 50% of max position budget
    "normal": 0.7,          # use 70% of max position budget
    "aggressive": 1.0,      # use 100% of max position budget
}

# Minimum confidence score required to issue a buy recommendation per style
STYLE_MIN_CONFIDENCE = {
    "conservative": 4,
    "normal": 3,
    "aggressive": 2,
}
