"""
SQLite database operations.
Creates all tables and provides CRUD helpers for every entity.
"""
import sqlite3
from datetime import date
from typing import Optional
from config import DB_PATH


def get_conn() -> sqlite3.Connection:
    """Return a connection with row_factory set for dict-like row access."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ─────────────────────────────────────────────────────────
# Schema initialization
# ─────────────────────────────────────────────────────────

def init_db() -> None:
    """Create all tables (skipped if they already exist)."""
    conn = get_conn()
    cur = conn.cursor()

    cur.executescript("""
        -- Stock master
        CREATE TABLE IF NOT EXISTS stocks (
            id INTEGER PRIMARY KEY,
            ticker TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            market TEXT NOT NULL,           -- "JP" or "US"
            category TEXT NOT NULL,         -- "holding" or "watchlist"
            purchase_price REAL,            -- acquisition cost (holding only)
            purchase_date TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        -- Daily analysis reports
        CREATE TABLE IF NOT EXISTS daily_reports (
            id INTEGER PRIMARY KEY,
            ticker TEXT NOT NULL,
            report_date TEXT NOT NULL,
            price REAL,
            price_change_pct REAL,
            signal TEXT,                    -- "買い" / "様子見" / "売り"
            confidence INTEGER,             -- conviction 1-5
            reason TEXT,
            target_price REAL,
            stop_loss REAL,
            recommended_amount REAL,        -- recommended buy amount (JPY/USD)
            recommended_shares INTEGER,     -- recommended number of shares
            rsi REAL,
            ma20 REAL,
            ma50 REAL,
            ma200 REAL,
            macd REAL,
            business_summary_ja TEXT,       -- Claude-generated business summary in Japanese
            raw_analysis TEXT,              -- full Claude response (JSON string)
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(ticker, report_date)
        );

        -- News items (ticker=NULL means macro news)
        CREATE TABLE IF NOT EXISTS news_items (
            id INTEGER PRIMARY KEY,
            ticker TEXT,
            title TEXT NOT NULL,
            summary TEXT,
            sentiment TEXT,                 -- "positive" / "neutral" / "negative"
            source TEXT,
            url TEXT,
            published_at TEXT,
            report_date TEXT
        );

        -- Daily insight (educational corner)
        CREATE TABLE IF NOT EXISTS daily_insights (
            id INTEGER PRIMARY KEY,
            report_date TEXT NOT NULL UNIQUE,
            headline TEXT,
            explanation TEXT,
            impact_on_holdings TEXT,
            keyword TEXT,
            keyword_explanation TEXT,
            related_tickers TEXT
        );

        -- Per-ticker chat history
        CREATE TABLE IF NOT EXISTS chat_history (
            id INTEGER PRIMARY KEY,
            ticker TEXT NOT NULL,
            role TEXT NOT NULL,             -- "user" or "assistant"
            content TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        -- User investment profile (always a single row with id=1)
        CREATE TABLE IF NOT EXISTS user_profile (
            id INTEGER PRIMARY KEY DEFAULT 1,
            total_funds REAL NOT NULL DEFAULT 500000,
            max_position_pct REAL DEFAULT 20.0,
            style TEXT DEFAULT 'normal',    -- "aggressive" / "normal" / "conservative"
            rebalance_freq TEXT DEFAULT 'monthly',
            line_user_id TEXT,
            updated_at TEXT DEFAULT (datetime('now'))
        );

        -- Insert default profile if missing
        INSERT OR IGNORE INTO user_profile (id, total_funds, max_position_pct, style)
        VALUES (1, 500000, 20.0, 'normal');
    """)

    conn.commit()
    conn.close()
    print(f"DB initialized: {DB_PATH}")


# ─────────────────────────────────────────────────────────
# stocks table
# ─────────────────────────────────────────────────────────

def add_stock(ticker: str, name: str, market: str, category: str,
              purchase_price: Optional[float] = None,
              purchase_date: Optional[str] = None) -> None:
    conn = get_conn()
    conn.execute(
        """INSERT OR REPLACE INTO stocks
           (ticker, name, market, category, purchase_price, purchase_date)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (ticker.upper(), name, market.upper(), category, purchase_price, purchase_date)
    )
    conn.commit()
    conn.close()


def remove_stock(ticker: str) -> None:
    conn = get_conn()
    conn.execute("DELETE FROM stocks WHERE ticker = ?", (ticker.upper(),))
    conn.commit()
    conn.close()


def get_all_stocks() -> list[dict]:
    conn = get_conn()
    rows = conn.execute("SELECT * FROM stocks ORDER BY category, market, ticker").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_stock(ticker: str) -> Optional[dict]:
    conn = get_conn()
    row = conn.execute("SELECT * FROM stocks WHERE ticker = ?", (ticker.upper(),)).fetchone()
    conn.close()
    return dict(row) if row else None


# ─────────────────────────────────────────────────────────
# daily_reports table
# ─────────────────────────────────────────────────────────

def upsert_daily_report(data: dict) -> None:
    """Insert or replace a daily report row."""
    conn = get_conn()
    conn.execute(
        """INSERT OR REPLACE INTO daily_reports
           (ticker, report_date, price, price_change_pct, signal, confidence,
            reason, target_price, stop_loss, recommended_amount, recommended_shares,
            rsi, ma20, ma50, ma200, macd, business_summary_ja, raw_analysis)
           VALUES (:ticker, :report_date, :price, :price_change_pct, :signal, :confidence,
                   :reason, :target_price, :stop_loss, :recommended_amount, :recommended_shares,
                   :rsi, :ma20, :ma50, :ma200, :macd, :business_summary_ja, :raw_analysis)""",
        data
    )
    conn.commit()
    conn.close()


def get_latest_report(ticker: str) -> Optional[dict]:
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM daily_reports WHERE ticker = ? ORDER BY report_date DESC LIMIT 1",
        (ticker.upper(),)
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def get_today_reports() -> list[dict]:
    today = date.today().isoformat()
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM daily_reports WHERE report_date = ?", (today,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ─────────────────────────────────────────────────────────
# news_items table
# ─────────────────────────────────────────────────────────

def save_news_items(items: list[dict]) -> None:
    conn = get_conn()
    conn.executemany(
        """INSERT INTO news_items
           (ticker, title, summary, sentiment, source, url, published_at, report_date)
           VALUES (:ticker, :title, :summary, :sentiment, :source, :url, :published_at, :report_date)""",
        items
    )
    conn.commit()
    conn.close()


def get_news_for_ticker(ticker: str, report_date: str) -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM news_items WHERE ticker = ? AND report_date = ? ORDER BY id DESC LIMIT 10",
        (ticker.upper(), report_date)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ─────────────────────────────────────────────────────────
# daily_insights table
# ─────────────────────────────────────────────────────────

def upsert_daily_insight(data: dict) -> None:
    conn = get_conn()
    conn.execute(
        """INSERT OR REPLACE INTO daily_insights
           (report_date, headline, explanation, impact_on_holdings,
            keyword, keyword_explanation, related_tickers)
           VALUES (:report_date, :headline, :explanation, :impact_on_holdings,
                   :keyword, :keyword_explanation, :related_tickers)""",
        data
    )
    conn.commit()
    conn.close()


def get_latest_insight() -> Optional[dict]:
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM daily_insights ORDER BY report_date DESC LIMIT 1"
    ).fetchone()
    conn.close()
    return dict(row) if row else None


# ─────────────────────────────────────────────────────────
# chat_history table
# ─────────────────────────────────────────────────────────

def append_chat(ticker: str, role: str, content: str) -> None:
    conn = get_conn()
    conn.execute(
        "INSERT INTO chat_history (ticker, role, content) VALUES (?, ?, ?)",
        (ticker.upper(), role, content)
    )
    conn.commit()
    conn.close()


def get_chat_history(ticker: str, limit: int = 50) -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT role, content, created_at FROM chat_history WHERE ticker = ? ORDER BY id DESC LIMIT ?",
        (ticker.upper(), limit)
    ).fetchall()
    conn.close()
    # Return in chronological order
    return [dict(r) for r in reversed(rows)]


def clear_chat_history(ticker: str) -> None:
    conn = get_conn()
    conn.execute("DELETE FROM chat_history WHERE ticker = ?", (ticker.upper(),))
    conn.commit()
    conn.close()


# ─────────────────────────────────────────────────────────
# user_profile table
# ─────────────────────────────────────────────────────────

def get_profile() -> dict:
    conn = get_conn()
    row = conn.execute("SELECT * FROM user_profile WHERE id = 1").fetchone()
    conn.close()
    return dict(row) if row else {
        "id": 1, "total_funds": 500000, "max_position_pct": 20.0,
        "style": "normal", "line_user_id": None,
    }


def update_profile(total_funds: float, max_position_pct: float,
                   style: str, line_user_id: Optional[str] = None) -> None:
    conn = get_conn()
    conn.execute(
        """UPDATE user_profile
           SET total_funds = ?, max_position_pct = ?, style = ?,
               line_user_id = COALESCE(?, line_user_id),
               updated_at = datetime('now')
           WHERE id = 1""",
        (total_funds, max_position_pct, style, line_user_id)
    )
    conn.commit()
    conn.close()
