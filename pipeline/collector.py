"""
Stock price and technical indicator fetching.
Uses yfinance for price data and ta (Technical Analysis library) for indicator calculations.
Japanese stocks require the ".T" suffix on the ticker symbol.
"""
import warnings
warnings.filterwarnings("ignore")

import yfinance as yf
import pandas as pd
import ta
from typing import Optional


def get_stock_data(ticker: str, market: str) -> dict:
    """
    Fetch OHLCV data, technical indicators, and company info for one ticker.

    Args:
        ticker: ticker symbol (e.g. "7974" for Nintendo, "NVDA" for NVIDIA)
        market: "JP" or "US" — JP tickers get ".T" appended for yfinance

    Returns:
        dict with price, indicators, and company metadata
    """
    yf_ticker = f"{ticker}.T" if market.upper() == "JP" else ticker
    stock = yf.Ticker(yf_ticker)

    # Fetch 1 year of daily OHLCV
    hist = stock.history(period="1y")
    if hist.empty:
        raise ValueError(f"No price data returned for: {yf_ticker}")

    close = hist["Close"]
    high  = hist["High"]
    low   = hist["Low"]

    # RSI(14)
    hist["RSI_14"] = ta.momentum.RSIIndicator(close, window=14).rsi()

    # MACD (12, 26, 9)
    macd_obj = ta.trend.MACD(close, window_slow=26, window_fast=12, window_sign=9)
    hist["MACD"] = macd_obj.macd()
    hist["MACD_signal"] = macd_obj.macd_signal()

    # Simple moving averages
    hist["SMA_20"]  = ta.trend.SMAIndicator(close, window=20).sma_indicator()
    hist["SMA_50"]  = ta.trend.SMAIndicator(close, window=50).sma_indicator()
    hist["SMA_200"] = ta.trend.SMAIndicator(close, window=200).sma_indicator()

    # Bollinger Bands (window=20, std=2)
    bb = ta.volatility.BollingerBands(close, window=20, window_dev=2)
    hist["BB_upper"] = bb.bollinger_hband()
    hist["BB_lower"] = bb.bollinger_lband()

    latest = hist.iloc[-1]
    prev   = hist.iloc[-2] if len(hist) >= 2 else latest

    price_change_pct = (
        (latest["Close"] - prev["Close"]) / prev["Close"] * 100
        if prev["Close"] > 0 else 0.0
    )

    # Fetch company metadata (may fail for some tickers — handled gracefully)
    try:
        info = stock.info
    except Exception:
        info = {}

    def safe(col) -> Optional[float]:
        v = latest.get(col)
        return float(v) if v is not None and pd.notna(v) else None

    return {
        "ticker": ticker.upper(),
        "market": market.upper(),
        # Price
        "price": float(latest["Close"]),
        "price_change_pct": round(price_change_pct, 2),
        "volume": int(latest["Volume"]) if pd.notna(latest["Volume"]) else 0,
        # Technical indicators
        "rsi": safe("RSI_14"),
        "macd": safe("MACD"),
        "macd_signal": safe("MACD_signal"),
        "ma20": safe("SMA_20"),
        "ma50": safe("SMA_50"),
        "ma200": safe("SMA_200"),
        "bb_upper": safe("BB_upper"),
        "bb_lower": safe("BB_lower"),
        # Company info used by Claude for chat and analysis
        "business_summary": info.get("longBusinessSummary", ""),
        "sector": info.get("sector", ""),
        "industry": info.get("industry", ""),
        "per": info.get("trailingPE"),
        "pbr": info.get("priceToBook"),
        "market_cap": info.get("marketCap"),
        "currency": info.get("currency", "JPY" if market.upper() == "JP" else "USD"),
        # Last 60 candles for charts / backtesting
        "hist_data": hist.tail(60)[["Open", "High", "Low", "Close", "Volume"]].to_dict(),
    }
