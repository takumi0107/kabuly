"""
Investment signal generation via the Claude API.
Incorporates the user's investment profile (funds, style) into the
recommended buy amount and share count.
"""
import json
import re
from typing import Optional
import anthropic
from config import ANTHROPIC_API_KEY, CLAUDE_MODEL, STYLE_MULTIPLIER


def _extract_json(text: str) -> dict:
    """
    Extract a JSON object from Claude's response text.
    Handles responses wrapped in ```json ... ``` code fences.
    """
    text = re.sub(r"```(?:json)?", "", text).strip().rstrip("`").strip()
    start = text.find("{")
    end = text.rfind("}") + 1
    if start == -1 or end == 0:
        raise ValueError(f"No JSON found in response: {text[:200]}")
    return json.loads(text[start:end])


def analyze_stock(stock_data: dict, news: list[dict], profile: dict) -> dict:
    """
    Ask Claude to analyze a stock and return a structured investment signal.

    Args:
        stock_data: output from collector.get_stock_data()
        news:       list of news dicts (title, source, url)
        profile:    user profile dict from db.get_profile()

    Returns dict with keys: signal, confidence, reason, target_price, stop_loss,
    time_horizon, recommended_amount, recommended_shares, reasoning_for_amount,
    key_risks, business_summary_ja
    """
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    max_amount = profile["total_funds"] * (profile["max_position_pct"] / 100)
    multiplier = STYLE_MULTIPLIER.get(profile["style"], 0.7)

    news_lines = "\n".join([f"- {n['title']}" for n in news[:5]]) or "(no news)"

    def fmt(v, decimals=1):
        return "N/A" if v is None else f"{v:,.{decimals}f}"

    prompt = f"""You are an expert stock analyst. Analyze the data below and produce a JSON investment signal.

## Stock info
- Ticker: {stock_data['ticker']}
- Price: {fmt(stock_data['price'])} {stock_data['currency']} / Day change: {fmt(stock_data['price_change_pct'])}%
- Sector: {stock_data.get('sector', 'N/A')} / Industry: {stock_data.get('industry', 'N/A')}
- Business: {str(stock_data.get('business_summary', ''))[:400] or 'N/A'}

## Technical indicators
- RSI(14): {fmt(stock_data.get('rsi'))}
- MACD: {fmt(stock_data.get('macd'), 2)} / Signal: {fmt(stock_data.get('macd_signal'), 2)}
- MA20: {fmt(stock_data.get('ma20'), 0)} / MA50: {fmt(stock_data.get('ma50'), 0)} / MA200: {fmt(stock_data.get('ma200'), 0)}
- BB upper: {fmt(stock_data.get('bb_upper'), 0)} / BB lower: {fmt(stock_data.get('bb_lower'), 0)}

## Fundamentals
- P/E: {fmt(stock_data.get('per'))} / P/B: {fmt(stock_data.get('pbr'))}

## Recent news
{news_lines}

## User profile
- Total funds: {profile['total_funds']:,.0f} {stock_data['currency']}
- Style: {profile['style']}
- Max per position: {max_amount:,.0f} {stock_data['currency']}
- Style multiplier: {multiplier}

## Instructions
Reply with ONLY valid JSON (no markdown, no explanation):
{{
  "signal": "買い" or "様子見" or "売り",
  "confidence": integer 1-5,
  "reason": "3-4 sentence reasoning in Japanese",
  "target_price": number,
  "stop_loss": number,
  "time_horizon": "短期(1-2週)" or "中期(1-3ヶ月)" or "長期(3ヶ月以上)",
  "recommended_amount": max_amount × multiplier × confidence_adjustment as number,
  "recommended_shares": floor(recommended_amount / current_price) as integer,
  "reasoning_for_amount": "one sentence in Japanese explaining the amount",
  "key_risks": ["risk1", "risk2"],
  "business_summary_ja": "2-3 sentence summary of business and revenue segments in Japanese"
}}"""

    message = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}]
    )

    raw_text = message.content[0].text
    result = _extract_json(raw_text)

    # Fallback calculation if Claude omits recommended fields
    if not result.get("recommended_amount"):
        adj = min(result.get("confidence", 3) / 5, 1.0)
        result["recommended_amount"] = round(max_amount * multiplier * adj, 0)
    if not result.get("recommended_shares") and stock_data["price"] > 0:
        result["recommended_shares"] = int(result["recommended_amount"] // stock_data["price"])

    return result


def build_chat_system_prompt(stock: dict, report: Optional[dict], profile: dict) -> str:
    """
    Build the system prompt injected into every chat turn for a given stock.
    Provides Claude with today's price, technicals, signal, and user profile.
    """
    def fmt(v, decimals=0):
        return "N/A" if v is None else f"{v:,.{decimals}f}"

    report = report or {}
    return f"""You are a stock investment assistant. Answer every question about the target stock in Japanese.

## Target stock
- Name: {stock.get('name', stock['ticker'])} ({stock['ticker']})
- Market: {stock.get('market', 'N/A')} / Category: {stock.get('category', 'N/A')}
- Acquisition cost: {fmt(stock.get('purchase_price'))}

## Today's data
- Price: {fmt(report.get('price'))} ({fmt(report.get('price_change_pct'), 1):+}%)
- RSI: {fmt(report.get('rsi'), 1)} / MA20: {fmt(report.get('ma20'))} / MA200: {fmt(report.get('ma200'))}
- Signal: {report.get('signal', 'N/A')} (confidence {report.get('confidence', 'N/A')}/5)
- Reason: {report.get('reason', 'N/A')}
- Recommended buy: {fmt(report.get('recommended_amount'))} ({report.get('recommended_shares', 'N/A')} shares)

## User profile
- Total funds: {fmt(profile.get('total_funds'))} / Style: {profile.get('style', 'N/A')} / Max per position: {profile.get('max_position_pct', 20)}%

## Answer guidelines
- Explain business overview, revenue breakdown, and segment details concretely
- Use specific numbers ("real estate is ~0% of revenue", "segment X is ~40% of sales")
- Compare with competitors when relevant
- Give concrete buy timing and stop-loss levels
- Always explain financial jargon in plain language"""
