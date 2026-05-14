import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { DashboardData, StockWithReport } from "../types";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined) {
  if (n == null || n === 0) return "—";
  return n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
}

function signalBadge(signal: string) {
  if (signal === "買い")
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/15 text-green-400">
        🟢 {signal}
      </span>
    );
  if (signal === "売り")
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-500/15 text-red-400">
        🔴 {signal}
      </span>
    );
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-500/15 text-slate-400">
      ⚪ {signal || "—"}
    </span>
  );
}

function stars(n: number) {
  return Array.from({ length: 5 }, (_, i) => (
    <span key={i} className={i < n ? "text-amber-400" : "text-slate-600"}>
      ★
    </span>
  ));
}

// ── Stock card ─────────────────────────────────────────────────────────────

function StockCard({
  swr,
  onRemove,
}: {
  swr: StockWithReport;
  onRemove: (ticker: string) => void;
}) {
  const { stock, report } = swr;
  const up = (report?.PriceChangePct ?? 0) >= 0;

  return (
    <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-xl p-4">
      {/* Top row */}
      <div className="flex justify-between items-start mb-2">
        <div>
          <span className="font-semibold">{stock.Name}</span>
          <span className="text-slate-400 text-sm ml-2">{stock.Ticker}</span>
          {stock.PurchasePrice > 0 && (
            <span className="text-slate-500 text-xs ml-2">
              @ ¥{fmt(stock.PurchasePrice)}
            </span>
          )}
        </div>
        <div className="text-right">
          <div className="font-bold text-lg">
            {report ? fmt(report.Price) : "—"}
          </div>
          {report && (
            <div
              className={`text-sm ${up ? "text-green-400" : "text-red-400"}`}
            >
              {up ? "+" : ""}
              {report.PriceChangePct.toFixed(1)}%
            </div>
          )}
        </div>
      </div>

      {/* Signal row */}
      {report?.Signal && (
        <div className="flex items-center gap-2 mb-2">
          {signalBadge(report.Signal)}
          <span className="text-sm">{stars(report.Confidence)}</span>
        </div>
      )}

      {/* Reason */}
      {report?.Reason && (
        <p className="text-sm text-slate-400 leading-relaxed mb-2 line-clamp-2">
          {report.Reason}
        </p>
      )}

      {/* Recommended amount */}
      {report?.Signal === "買い" && report.RecommendedAmount > 0 && (
        <p className="text-sm text-green-400 font-semibold mb-3">
          推奨: ¥{fmt(report.RecommendedAmount)}（{report.RecommendedShares}株）
        </p>
      )}

      {/* Footer buttons */}
      <div className="flex justify-between items-center mt-2">
        <button
          onClick={() => onRemove(stock.Ticker)}
          className="text-xs text-slate-500 hover:text-red-400 transition-colors"
        >
          削除
        </button>
        <Link
          to={`/stock/${stock.Ticker}`}
          className="text-xs border border-[#2a2d3a] text-slate-400 hover:border-blue-500 hover:text-blue-400 px-3 py-1 rounded-lg transition-colors"
        >
          💬 Claudeに聞く →
        </Link>
      </div>
    </div>
  );
}

// ── Add stock form ─────────────────────────────────────────────────────────

function AddStockForm({ onAdded }: { onAdded: () => void }) {
  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");
  const [market, setMarket] = useState("JP");
  const [category, setCategory] = useState("holding");
  const [price, setPrice] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker || !name) return;
    setLoading(true);
    setError("");
    try {
      await api.addStock({
        ticker,
        name,
        market,
        category,
        purchase_price: parseFloat(price) || 0,
      });
      setTicker("");
      setName("");
      setPrice("");
      onAdded();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    "bg-[#0f1117] border border-[#2a2d3a] text-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500";

  return (
    <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-xl p-5">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">
        ＋ 銘柄を追加
      </h3>
      <form onSubmit={submit}>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">ティッカー</label>
            <input
              className={inputCls}
              placeholder="7974 / NVDA"
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">銘柄名</label>
            <input
              className={inputCls}
              placeholder="任天堂"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">市場</label>
            <select
              className={inputCls}
              value={market}
              onChange={(e) => setMarket(e.target.value)}
            >
              <option value="JP">JP（日本）</option>
              <option value="US">US（米国）</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">カテゴリ</label>
            <select
              className={inputCls}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="holding">保有</option>
              <option value="watchlist">ウォッチ</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">取得単価（任意）</label>
            <input
              className={inputCls}
              type="number"
              placeholder="8000"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              style={{ width: 110 }}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
          >
            {loading ? "追加中…" : "追加"}
          </button>
        </div>
        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      </form>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setData(await api.dashboard());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleRemove(ticker: string) {
    if (!confirm(`${ticker} を削除しますか？`)) return;
    await api.removeStock(ticker);
    load();
  }

  if (loading)
    return (
      <div className="flex items-center justify-center h-screen text-slate-400">
        読み込み中…
      </div>
    );

  const { holdings, watchlist, insight } = data!;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
        <h1 className="text-xl font-bold tracking-tight">📊 Kabuly</h1>
        <Link to="/profile" className="text-sm text-slate-400 hover:text-slate-200 transition-colors">
          ⚙ 投資プロファイル設定
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-8">
        {/* Holdings */}
        <section>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
            保有銘柄
          </h2>
          <div className="space-y-3">
            {holdings.length === 0 ? (
              <p className="text-slate-500 text-sm">保有銘柄が登録されていません。</p>
            ) : (
              holdings.map((swr) => (
                <StockCard key={swr.stock.Ticker} swr={swr} onRemove={handleRemove} />
              ))
            )}
          </div>
        </section>

        {/* Watchlist */}
        <section>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
            ウォッチリスト
          </h2>
          <div className="space-y-3">
            {watchlist.length === 0 ? (
              <p className="text-slate-500 text-sm">ウォッチリストに銘柄がありません。</p>
            ) : (
              watchlist.map((swr) => (
                <StockCard key={swr.stock.Ticker} swr={swr} onRemove={handleRemove} />
              ))
            )}
          </div>
        </section>

        {/* Daily insight */}
        {insight && (
          <section>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
              📰 今日の教養
            </h2>
            <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-xl p-5 space-y-2">
              <p className="font-bold">{insight.Headline}</p>
              <p className="text-sm text-slate-400 leading-relaxed">{insight.Explanation}</p>
              {insight.ImpactOnHoldings && (
                <p className="text-sm text-slate-300">→ {insight.ImpactOnHoldings}</p>
              )}
              {insight.Keyword && (
                <span className="inline-block bg-blue-500/10 border border-blue-500/25 text-blue-400 text-xs px-3 py-1 rounded">
                  📖 {insight.Keyword}
                  {insight.KeywordExplanation && ` — ${insight.KeywordExplanation}`}
                </span>
              )}
            </div>
          </section>
        )}

        {/* Add stock */}
        <AddStockForm onAdded={load} />
      </main>
    </div>
  );
}
