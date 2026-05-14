"""
News collection and daily insight generation.
Sources: Google News RSS (feedparser) for Japanese news,
         NewsAPI for English news, and Claude for the educational insight.
"""
import json
import re
from datetime import date
from typing import Optional

import urllib.parse

import feedparser
import anthropic
from config import ANTHROPIC_API_KEY, CLAUDE_MODEL, NEWSAPI_KEY


def _extract_json(text: str) -> dict:
    """Extract JSON object from Claude's response, handling code fences."""
    text = re.sub(r"```(?:json)?", "", text).strip().rstrip("`").strip()
    start = text.find("{")
    end = text.rfind("}") + 1
    if start == -1 or end == 0:
        raise ValueError(f"No JSON found: {text[:200]}")
    return json.loads(text[start:end])


def _newsapi_search(query: str, language: str = "en", page_size: int = 5) -> list[dict]:
    """
    Query NewsAPI /everything endpoint.
    Returns an empty list when NEWSAPI_KEY is not set or the request fails.
    """
    if not NEWSAPI_KEY:
        return []
    try:
        from newsapi import NewsApiClient
        client = NewsApiClient(api_key=NEWSAPI_KEY)
        resp = client.get_everything(q=query, language=language,
                                     sort_by="publishedAt", page_size=page_size)
        return [
            {
                "title": a["title"],
                "url": a["url"],
                "source": a["source"]["name"],
                "published_at": a.get("publishedAt", ""),
            }
            for a in resp.get("articles", [])
        ]
    except Exception as e:
        print(f"[news] NewsAPI error ({query}): {e}")
        return []


def _google_news_rss(query: str, lang: str = "ja", region: str = "JP") -> list[dict]:
    """Fetch articles from Google News RSS for a given query."""
    encoded_query = urllib.parse.quote(query)
    url = (
        f"https://news.google.com/rss/search"
        f"?q={encoded_query}&hl={lang}&gl={region}&ceid={region}:{lang}"
    )
    try:
        feed = feedparser.parse(url)
        return [
            {"title": e.title, "url": e.link, "source": "Google News", "published_at": ""}
            for e in feed.entries[:5]
        ]
    except Exception as e:
        print(f"[news] RSS error ({query}): {e}")
        return []


def get_news_for_ticker(ticker: str, name: str, market: str,
                        report_date: Optional[str] = None) -> list[dict]:
    """
    Collect news articles for a single stock from Google News RSS and NewsAPI.
    Returns a list ready for db.save_news_items().
    """
    today = report_date or date.today().isoformat()
    articles = []

    if market.upper() == "JP":
        for item in _google_news_rss(f"{name} 株"):
            articles.append({
                "ticker": ticker.upper(),
                "title": item["title"],
                "summary": None,
                "sentiment": "neutral",
                "source": item["source"],
                "url": item["url"],
                "published_at": item["published_at"],
                "report_date": today,
            })

    # English news via NewsAPI
    query = ticker if market.upper() == "US" else f"{name} Japan stock"
    for item in _newsapi_search(query):
        articles.append({
            "ticker": ticker.upper(),
            "title": item["title"],
            "summary": None,
            "sentiment": "neutral",
            "source": item["source"],
            "url": item["url"],
            "published_at": item["published_at"],
            "report_date": today,
        })

    return articles


def get_macro_news(report_date: Optional[str] = None) -> list[dict]:
    """
    Collect macro-level news for Japan and the US.
    Returns articles with ticker=None for storage as macro news.
    """
    today = report_date or date.today().isoformat()
    feeds = [
        ("日銀 金利 為替", "ja", "JP"),
        ("日経平均 東証", "ja", "JP"),
    ]
    english_queries = [
        "Fed interest rate",
        "S&P500 nasdaq",
    ]

    articles = []

    for query, lang, region in feeds:
        for item in _google_news_rss(query, lang=lang, region=region):
            articles.append({
                "ticker": None,
                "title": item["title"],
                "summary": None,
                "sentiment": "neutral",
                "source": item["source"],
                "url": item["url"],
                "published_at": item["published_at"],
                "report_date": today,
            })

    for query in english_queries:
        for item in _newsapi_search(query, language="en", page_size=3):
            articles.append({
                "ticker": None,
                "title": item["title"],
                "summary": None,
                "sentiment": "neutral",
                "source": item["source"],
                "url": item["url"],
                "published_at": item["published_at"],
                "report_date": today,
            })

    return articles


def generate_daily_insight(macro_news: list[dict], holdings: list[str],
                            report_date: Optional[str] = None) -> dict:
    """
    Ask Claude to produce the educational "insight corner" based on today's macro news.
    Returns a dict ready for db.upsert_daily_insight().
    """
    today = report_date or date.today().isoformat()
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    news_text = "\n".join(
        [f"[{n.get('source', '')}] {n['title']}" for n in macro_news[:8]]
    ) or "(no macro news)"

    holdings_text = ", ".join(holdings) if holdings else "(none)"

    prompt = f"""You are a Japanese financial educator. Create today's educational insight corner based on the news below.

Today's macro news:
{news_text}

User's holdings: {holdings_text}

Reply with ONLY valid JSON (no markdown):
{{
  "headline": "Today's theme in under 20 Japanese characters",
  "explanation": "~200 char explanation in Japanese with jargon simplified",
  "impact_on_holdings": "Concrete impact on the user's holdings in Japanese",
  "keyword": "One financial term to learn today",
  "keyword_explanation": "Explanation of that term in under 60 Japanese characters",
  "related_tickers": "comma-separated ticker symbols mentioned (empty string if none)"
}}"""

    try:
        message = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=800,
            messages=[{"role": "user", "content": prompt}]
        )
        result = _extract_json(message.content[0].text)
    except Exception as e:
        print(f"[news] insight generation error: {e}")
        result = {
            "headline": "本日のマーケット",
            "explanation": "データ取得中にエラーが発生しました。",
            "impact_on_holdings": "",
            "keyword": "",
            "keyword_explanation": "",
            "related_tickers": "",
        }

    result["report_date"] = today
    return result
