"""
Investment signal generation via the Claude API.
Incorporates the user's investment profile (funds, style) into the
recommended buy amount and share count.
"""
import json
import re
from typing import Optional
import anthropic
from config import ANTHROPIC_API_KEY, CLAUDE_MODEL


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

    news_lines = "\n".join([f"- {n['title']}" for n in news[:6]]) or "- (no news)"

    def fmt(v, decimals=1):
        return "N/A" if v is None else f"{v:,.{decimals}f}"

    p = stock_data.get("patterns", {})
    vol_ratio = stock_data.get("volume_ratio", 1.0)
    price     = stock_data["price"]
    atr       = stock_data.get("atr") or 0.0
    ma20      = stock_data.get("ma20") or 0.0
    ma50      = stock_data.get("ma50") or 0.0
    ma200     = stock_data.get("ma200") or 0.0
    high_52w  = p.get("high_52w") or 0.0

    # Pre-compute anchor suggestions — keep decimal precision so Claude doesn't round further.
    suggested_stop  = round(price - 2 * atr, 1) if atr else None
    # Nearest resistance above price: prefer MA20 > MA50 > MA200 > 52w high
    resistances = [r for r in [ma20, ma50, ma200, high_52w] if r > price]
    suggested_target = round(min(resistances), 1) if resistances else round(price * 1.05, 1)

    prompt = f"""Analyze and output a JSON investment signal. Reply with ONLY valid JSON, no markdown.

Stock: {stock_data['ticker']} | {fmt(price)} {stock_data['currency']} ({fmt(stock_data['price_change_pct'])}% today)
Sector: {stock_data.get('sector','N/A')} | Industry: {stock_data.get('industry','N/A')}
Business: {str(stock_data.get('business_summary',''))[:800] or 'N/A'}

Technicals: RSI {fmt(stock_data.get('rsi'))} | MACD {fmt(stock_data.get('macd'),2)} | ATR(14) {fmt(atr)}
BB {fmt(stock_data.get('bb_lower'),0)}–{fmt(stock_data.get('bb_upper'),0)}
MA20 {fmt(ma20,0)} / MA50 {fmt(ma50,0)} / MA200 {fmt(ma200,0)} | P/E {fmt(stock_data.get('per'))} P/B {fmt(stock_data.get('pbr'))}
Volume: {fmt(stock_data.get('volume'),0)} (×{vol_ratio:.1f} of 20d avg)

Historical (2y): 52w H {fmt(high_52w,0)} ({p.get('dist_from_high_pct',0):+.1f}%) / L {fmt(p.get('low_52w'),0)} ({p.get('dist_from_low_pct',0):+.1f}%)
Overbought days: {p.get('rsi_overbought_days',0)} | Oversold days: {p.get('rsi_oversold_days',0)} | Avg monthly: {p.get('avg_monthly_return_pct',0):+.2f}%
Vol(30d): {p.get('volatility_30d',0):.2f}% | Above MA200: {p.get('above_ma200',False)} | 20d trend: {p.get('trend_20d',0):+.1f}%

Recent news:
{news_lines}

Investor style: {profile['style']}

Anchors for target_price / stop_loss:
- stop_loss anchor: price − 2×ATR = {fmt(suggested_stop, 1)} → set to the exact support/MA level nearest to this value
- target_price anchor: nearest resistance above price = {fmt(suggested_target, 1)} → set to this exact value
- Output exact decimal values as-is (e.g. 2848.3, 2675.5). Do NOT round to the nearest 50 or 100.
- stop_loss must be strictly below current price; target_price must be strictly above current price

{{"signal":"買い"or"様子見"or"売り","confidence":1-5,"reason":"4-5 sentences in Japanese","target_price":number,"stop_loss":number,"time_horizon":"短期(1-2週)"or"中期(1-3ヶ月)"or"長期(3ヶ月以上)","key_risks":["risk1","risk2"],"business_summary_ja":"2-3 sentences in Japanese"}}"""

    message = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1200,
        messages=[{"role": "user", "content": prompt}]
    )

    raw_text = message.content[0].text
    result = _extract_json(raw_text)

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
