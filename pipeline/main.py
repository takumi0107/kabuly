"""
CLI entry point and APScheduler integration.

Commands:
  python main.py init-db
  python main.py add <ticker> --name <name> --market JP|US --holding|--watchlist [--price N]
  python main.py remove <ticker>
  python main.py list
  python main.py run [--no-notify] [--ticker TICKER]
  python main.py backtest --days N
"""
import argparse
import json
import sys
from datetime import date, datetime, timedelta
from typing import Optional

import db
import collector
import analyzer
import news as news_mod
import notifier
from config import SCHEDULE_HOUR, SCHEDULE_MINUTE, TIMEZONE


# ─────────────────────────────────────────────────────────
# Core pipeline
# ─────────────────────────────────────────────────────────

def run_analysis(tickers: Optional[list] = None, notify: bool = True) -> None:
    """
    Run the full analysis pipeline for all (or selected) stocks.
    Steps:
      1. Fetch stock price + technicals
      2. Collect news
      3. Analyze with Claude
      4. Save results to DB
      5. Generate macro insight
      6. Send LINE notification (unless --no-notify)
    """
    all_stocks = db.get_all_stocks()
    if not all_stocks:
        print("No stocks registered. Add stocks first with: python main.py add ...")
        return

    targets = tickers or all_stocks
    profile = db.get_profile()
    today = date.today().isoformat()

    signal_counts = {"買い": 0, "様子見": 0, "売り": 0}

    for stock in targets:
        ticker = stock["ticker"]
        market = stock["market"]
        print(f"\n[{ticker}] fetching data ...")

        # 1. Fetch price + technical data
        try:
            stock_data = collector.get_stock_data(ticker, market)
        except Exception as e:
            print(f"[{ticker}] collector error: {e}")
            continue

        # 2. Fetch news
        try:
            news_items = news_mod.get_news_for_ticker(
                ticker, stock["name"], market, report_date=today
            )
            db.save_news_items(news_items)
        except Exception as e:
            print(f"[{ticker}] news error: {e}")
            news_items = []

        # 3. Analyze with Claude
        print(f"[{ticker}] analyzing with Claude ...")
        try:
            result = analyzer.analyze_stock(stock_data, news_items, profile)
        except Exception as e:
            print(f"[{ticker}] analyzer error: {e}")
            continue

        # 4. Persist report
        report_row = {
            "ticker": ticker,
            "report_date": today,
            "price": stock_data["price"],
            "price_change_pct": stock_data["price_change_pct"],
            "signal": result.get("signal", "様子見"),
            "confidence": result.get("confidence", 3),
            "reason": result.get("reason", ""),
            "target_price": result.get("target_price"),
            "stop_loss": result.get("stop_loss"),
            "recommended_amount": result.get("recommended_amount"),
            "recommended_shares": result.get("recommended_shares"),
            "rsi": stock_data.get("rsi"),
            "ma20": stock_data.get("ma20"),
            "ma50": stock_data.get("ma50"),
            "ma200": stock_data.get("ma200"),
            "macd": stock_data.get("macd"),
            "business_summary_ja": result.get("business_summary_ja", ""),
            "raw_analysis": json.dumps(result, ensure_ascii=False),
        }
        db.upsert_daily_report(report_row)

        sig = result.get("signal", "様子見")
        if sig in signal_counts:
            signal_counts[sig] += 1

        print(
            f"[{ticker}] {sig} (confidence {result.get('confidence')}/5) "
            f"price={stock_data['price']:,.0f} target={result.get('target_price')}"
        )

    # 5. Macro news + insight
    print("\n[macro] fetching macro news ...")
    try:
        macro = news_mod.get_macro_news(report_date=today)
        db.save_news_items(macro)
        holding_tickers = [s["ticker"] for s in all_stocks if s["category"] == "holding"]
        insight = news_mod.generate_daily_insight(macro, holding_tickers, report_date=today)
        db.upsert_daily_insight(insight)
        print(f"[macro] insight: {insight.get('headline')}")
    except Exception as e:
        print(f"[macro] error: {e}")
        insight = {}

    # 6. LINE notification
    if notify:
        summary = {
            "buy_count": signal_counts["買い"],
            "hold_count": signal_counts["様子見"],
            "sell_count": signal_counts["売り"],
            "insight_headline": insight.get("headline", ""),
        }
        notifier.send_morning_notification(summary)

    print("\nDone.")


# ─────────────────────────────────────────────────────────
# Backtest
# ─────────────────────────────────────────────────────────

def run_backtest(days: int) -> None:
    """
    Simple backtest: replay the last N days of daily_reports and count
    how often each signal direction was correct (based on next-day price).
    """
    conn = db.get_conn()
    rows = conn.execute(
        "SELECT * FROM daily_reports ORDER BY report_date DESC LIMIT ?",
        (days * 10,)
    ).fetchall()
    conn.close()

    correct = wrong = 0
    for row in rows:
        row = dict(row)
        # Find the next report for the same ticker
        conn = db.get_conn()
        nxt = conn.execute(
            """SELECT price FROM daily_reports
               WHERE ticker = ? AND report_date > ?
               ORDER BY report_date ASC LIMIT 1""",
            (row["ticker"], row["report_date"])
        ).fetchone()
        conn.close()
        if not nxt:
            continue

        diff = nxt["price"] - row["price"]
        if row["signal"] == "買い" and diff > 0:
            correct += 1
        elif row["signal"] == "売り" and diff < 0:
            correct += 1
        elif row["signal"] == "様子見":
            pass  # skip neutral
        else:
            wrong += 1

    total = correct + wrong
    rate = correct / total * 100 if total > 0 else 0
    print(f"Backtest ({days}d): correct={correct} wrong={wrong} "
          f"total={total} accuracy={rate:.1f}%")


# ─────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────

def cmd_init_db(_args) -> None:
    db.init_db()


def cmd_add(args) -> None:
    category = "holding" if args.holding else "watchlist"
    db.add_stock(
        ticker=args.ticker,
        name=args.name,
        market=args.market,
        category=category,
        purchase_price=args.price,
        purchase_date=date.today().isoformat() if args.holding else None,
    )
    print(f"Added {args.ticker} ({args.name}) as {category}")


def cmd_remove(args) -> None:
    db.remove_stock(args.ticker)
    print(f"Removed {args.ticker}")


def cmd_list(_args) -> None:
    stocks = db.get_all_stocks()
    if not stocks:
        print("No stocks registered.")
        return
    for s in stocks:
        price_str = f" @ ¥{s['purchase_price']:,.0f}" if s.get("purchase_price") else ""
        print(f"[{s['category']:9}] {s['ticker']:10} {s['name']:20} {s['market']}{price_str}")


def cmd_run(args) -> None:
    if args.ticker:
        stock = db.get_stock(args.ticker)
        if not stock:
            print(f"Ticker {args.ticker} not found in DB. Register it first.")
            sys.exit(1)
        targets = [stock]
    else:
        targets = None  # all stocks

    run_analysis(tickers=targets, notify=not args.no_notify)


def cmd_backtest(args) -> None:
    run_backtest(args.days)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="kabuly", description="Kabuly stock assistant CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    # init-db
    sub.add_parser("init-db", help="Initialize the SQLite database")

    # add
    p_add = sub.add_parser("add", help="Register a stock")
    p_add.add_argument("ticker", help="Ticker symbol (e.g. 7974, NVDA)")
    p_add.add_argument("--name", required=True, help="Company name")
    p_add.add_argument("--market", required=True, choices=["JP", "US"])
    group = p_add.add_mutually_exclusive_group(required=True)
    group.add_argument("--holding", action="store_true", help="Mark as holding")
    group.add_argument("--watchlist", action="store_true", help="Mark as watchlist")
    p_add.add_argument("--price", type=float, default=None, help="Acquisition price")

    # remove
    p_rm = sub.add_parser("remove", help="Remove a stock")
    p_rm.add_argument("ticker")

    # list
    sub.add_parser("list", help="List all registered stocks")

    # run
    p_run = sub.add_parser("run", help="Run analysis pipeline")
    p_run.add_argument("--no-notify", action="store_true", help="Skip LINE notification")
    p_run.add_argument("--ticker", default=None, help="Analyze a single ticker only")

    # backtest
    p_bt = sub.add_parser("backtest", help="Simple signal backtest")
    p_bt.add_argument("--days", type=int, default=30)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    dispatch = {
        "init-db": cmd_init_db,
        "add": cmd_add,
        "remove": cmd_remove,
        "list": cmd_list,
        "run": cmd_run,
        "backtest": cmd_backtest,
    }
    dispatch[args.command](args)


if __name__ == "__main__":
    main()
