"""
LINE Messaging API v3 notification sender.
Sends a Flex Message with a morning summary and a link to the dashboard.
Uses line-bot-sdk-python v3.
"""
from linebot.v3.messaging import (
    ApiClient,
    Configuration,
    MessagingApi,
    PushMessageRequest,
    FlexMessage,
    FlexContainer,
)
from config import LINE_CHANNEL_ACCESS_TOKEN, LINE_USER_ID, DASHBOARD_URL


def _build_flex(report_url: str, summary: dict) -> dict:
    """
    Build the Flex Message JSON payload.
    summary keys: buy_count, hold_count, sell_count, insight_headline
    """
    return {
        "type": "bubble",
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "md",
            "contents": [
                {
                    "type": "text",
                    "text": "おはようございます ☀️",
                    "size": "sm",
                    "color": "#888888",
                },
                {
                    "type": "text",
                    "text": "今日のレポートできました",
                    "weight": "bold",
                    "size": "lg",
                    "wrap": True,
                },
                {"type": "separator"},
                {
                    "type": "box",
                    "layout": "horizontal",
                    "contents": [
                        {"type": "text", "text": "📈 買いシグナル", "flex": 3},
                        {
                            "type": "text",
                            "text": f"{summary.get('buy_count', 0)}銘柄",
                            "align": "end",
                            "color": "#e74c3c",
                            "weight": "bold",
                        },
                    ],
                },
                {
                    "type": "box",
                    "layout": "horizontal",
                    "contents": [
                        {"type": "text", "text": "⚪ 様子見", "flex": 3},
                        {
                            "type": "text",
                            "text": f"{summary.get('hold_count', 0)}銘柄",
                            "align": "end",
                        },
                    ],
                },
                {
                    "type": "box",
                    "layout": "horizontal",
                    "contents": [
                        {"type": "text", "text": "📉 売りシグナル", "flex": 3},
                        {
                            "type": "text",
                            "text": f"{summary.get('sell_count', 0)}銘柄",
                            "align": "end",
                            "color": "#3498db",
                            "weight": "bold",
                        },
                    ],
                },
                {"type": "separator"},
                {
                    "type": "text",
                    "text": f"💡 {summary.get('insight_headline', '')}",
                    "size": "sm",
                    "color": "#555555",
                    "wrap": True,
                },
            ],
        },
        "footer": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {
                    "type": "button",
                    "action": {
                        "type": "uri",
                        "label": "📊 レポートを見る",
                        "uri": report_url,
                    },
                    "style": "primary",
                    "color": "#2c3e50",
                }
            ],
        },
    }


def send_morning_notification(summary: dict) -> None:
    """
    Push a LINE Flex Message to the configured user.
    Silently skips if LINE credentials are not configured.
    """
    if not LINE_CHANNEL_ACCESS_TOKEN or not LINE_USER_ID:
        print("[notify] LINE credentials not set — skipping notification")
        return

    report_url = DASHBOARD_URL
    flex_json = _build_flex(report_url, summary)

    config = Configuration(access_token=LINE_CHANNEL_ACCESS_TOKEN)
    with ApiClient(config) as api_client:
        api = MessagingApi(api_client)
        api.push_message(
            PushMessageRequest(
                to=LINE_USER_ID,
                messages=[
                    FlexMessage(
                        alt_text="今日のレポートができました 📊",
                        contents=FlexContainer.from_dict(flex_json),
                    )
                ],
            )
        )
    print(f"[notify] LINE message sent to {LINE_USER_ID}")
