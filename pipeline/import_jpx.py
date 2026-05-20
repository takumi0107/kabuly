"""
Download the TSE listed-company master file from JPX and import it into jp_stocks.

Run: uv run python import_jpx.py
"""
import sqlite3
import urllib.request
import io
import xlrd
from config import DB_PATH

JPX_URL = (
    "https://www.jpx.co.jp/markets/statistics-equities/misc/"
    "tvdivq0000001vg2-att/data_j.xls"
)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    "Referer": "https://www.jpx.co.jp/markets/statistics-equities/misc/01.html",
}

# Market segments that are real domestic stocks (exclude ETF/ETN, REIT, etc.)
EQUITY_SEGMENTS = {"プライム（内国株式）", "スタンダード（内国株式）", "グロース（内国株式）"}


def download_xls() -> bytes:
    req = urllib.request.Request(JPX_URL, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def import_jpx() -> None:
    print("Downloading JPX stock listing…")
    data = download_xls()

    wb = xlrd.open_workbook(file_contents=data)
    ws = wb.sheet_by_index(0)

    rows = []
    for i in range(1, ws.nrows):  # skip header row
        market_segment = str(ws.cell_value(i, 3)).strip()
        if market_segment not in EQUITY_SEGMENTS:
            continue

        raw_code = ws.cell_value(i, 1)
        # Numeric cells come as float (1301.0 → "1301"); string cells are already strings
        if isinstance(raw_code, float):
            code = str(int(raw_code))
        else:
            code = str(raw_code).strip()
        name = str(ws.cell_value(i, 2)).strip()
        sector = str(ws.cell_value(i, 5)).strip()
        segment_short = market_segment.split("（")[0]  # "プライム"

        rows.append((code, name, sector, segment_short))

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("DELETE FROM jp_stocks")
    cur.executemany(
        "INSERT INTO jp_stocks (code, name, sector, market_segment) VALUES (?, ?, ?, ?)",
        rows,
    )
    conn.commit()
    conn.close()

    print(f"Imported {len(rows)} JP stocks into jp_stocks table.")


if __name__ == "__main__":
    import_jpx()
