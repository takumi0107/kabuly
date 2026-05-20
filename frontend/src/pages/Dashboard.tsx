import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { DashboardData, StockWithReport } from "../types";

function fmt(n: number | null | undefined) {
  if (n == null || n === 0) return "—";
  return n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
}

function SignalBadge({ signal }: { signal: string }) {
  if (signal === "買い")
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
        {signal}
      </span>
    );
  if (signal === "売り")
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-600 border border-red-200">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
        {signal}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500 border border-slate-200">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
      {signal || "様子見"}
    </span>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span className="tracking-tight text-sm">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < n ? "text-amber-400" : "text-slate-200"}>★</span>
      ))}
    </span>
  );
}

// ── Stock card ─────────────────────────────────────────────────────────────

function StockCard({ swr, onRemove, analyzing }: { swr: StockWithReport; onRemove: (ticker: string) => void; analyzing?: boolean }) {
  const { stock, report } = swr;
  const up = (report?.PriceChangePct ?? 0) >= 0;
  const navigate = useNavigate();

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden hover:shadow-md hover:border-slate-300 transition-all">
      {/* Clickable body */}
      <div
        className="p-5 flex flex-col gap-3 cursor-pointer"
        onClick={() => navigate(`/stock/${stock.Ticker}`)}
      >
        {analyzing && (
          <div className="flex items-center gap-2 text-xs text-blue-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
            <svg className="animate-spin h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            AI分析を実行中…
          </div>
        )}
        <div className="flex justify-between items-start">
          <div>
            <div className="font-semibold text-slate-900">{stock.Name}</div>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="text-xs text-slate-400">{stock.Ticker}</span>
              <span className="text-slate-300">·</span>
              <span className="text-xs text-slate-400">{stock.Market}</span>
              {stock.PurchasePrice > 0 && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="text-xs text-slate-400">取得 ¥{fmt(stock.PurchasePrice)}</span>
                </>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="font-bold text-slate-900 tabular-nums text-lg">{report ? fmt(report.Price) : "—"}</div>
            {report && (
              <div className={`text-xs font-semibold tabular-nums ${up ? "text-emerald-600" : "text-red-500"}`}>
                {up ? "▲" : "▼"} {Math.abs(report.PriceChangePct).toFixed(1)}%
              </div>
            )}
          </div>
        </div>

        {report?.Signal && (
          <div className="flex items-center gap-2 flex-wrap">
            <SignalBadge signal={report.Signal} />
            <Stars n={report.Confidence} />
            {report.TargetPrice > 0 && (
              <span className="text-xs text-emerald-600 font-medium tabular-nums">目標 {fmt(report.TargetPrice)}</span>
            )}
            {report.StopLoss > 0 && (
              <span className="text-xs text-red-400 font-medium tabular-nums">損切 {fmt(report.StopLoss)}</span>
            )}
          </div>
        )}

        {report?.Reason && (
          <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">{report.Reason}</p>
        )}

      </div>

      {/* Footer */}
      <div className="flex justify-between items-center px-5 py-2.5 border-t border-slate-100 bg-slate-50">
        <button
          onClick={() => onRemove(stock.Ticker)}
          className="text-xs text-slate-300 hover:text-red-500 transition-colors"
        >
          削除
        </button>
        <Link
          to={`/stock/${stock.Ticker}`}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          💬 AIに聞く →
        </Link>
      </div>
    </div>
  );
}

// ── Section header ─────────────────────────────────────────────────────────

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest whitespace-nowrap">{label}</h2>
      <span className="text-xs text-slate-400 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">{count}</span>
      <div className="flex-1 h-px bg-slate-200" />
    </div>
  );
}

// ── Stock search & register ────────────────────────────────────────────────

type SearchResult = { ticker: string; name: string; market: string; exchange: string };

function AddStockPanel({ onAdded }: { onAdded: (ticker: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [category, setCategory] = useState("holding");
  const [price, setPrice] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleQuery(v: string) {
    setQuery(v);
    setSelected(null);
    setResults([]);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!v.trim()) return;
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await api.searchStocks(v.trim()));
      } finally {
        setSearching(false);
      }
    }, 400);
  }

  async function register() {
    if (!selected) return;
    setAdding(true);
    setError("");
    try {
      const res = await api.addStock({
        ticker: selected.ticker,
        name: selected.name,
        market: selected.market,
        category,
        purchase_price: parseFloat(price) || 0,
      });
      setQuery("");
      setResults([]);
      setSelected(null);
      setPrice("");
      onAdded(res.ticker);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  const inputCls = "bg-white border border-slate-200 text-slate-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors";

  return (
    <div>
      <div>

        {/* Search input */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
          <input
            className="w-full bg-white border border-slate-200 text-slate-800 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors"
            placeholder="銘柄を検索… 例: NVDA, Apple, トヨタ, 7974"
            value={query}
            onChange={(e) => handleQuery(e.target.value)}
          />
          {searching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">検索中…</span>
          )}
        </div>

        {/* Search results */}
        {results.length > 0 && !selected && (
          <div className="mt-2 border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            {results.map((r, i) => (
              <button
                key={i}
                className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-blue-50 transition-colors border-b border-slate-100 last:border-0"
                onClick={() => { setSelected(r); setQuery(r.name); setResults([]); }}
              >
                <div>
                  <span className="text-sm font-medium text-slate-800">{r.name}</span>
                  <span className="text-xs text-slate-400 ml-2">{r.ticker}</span>
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${r.market === "JP" ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"}`}>
                  {r.market}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Registration form (shown after selecting a result) */}
        {selected && (
          <div className="mt-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex items-center gap-2 mb-3">
              <span className="font-semibold text-slate-800 text-sm">{selected.name}</span>
              <span className="text-xs text-slate-400">{selected.ticker}</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ml-auto ${selected.market === "JP" ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"}`}>
                {selected.market}
              </span>
            </div>
            <div className="flex gap-3 items-end flex-wrap">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">カテゴリ</label>
                <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="holding">保有</option>
                  <option value="watchlist">ウォッチリスト</option>
                </select>
              </div>
              {category === "holding" && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">取得単価（任意）</label>
                  <input className={inputCls} type="number" placeholder="8000" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 120 }} />
                </div>
              )}
              <button
                onClick={register}
                disabled={adding}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold text-sm px-5 py-2 rounded-lg transition-colors"
              >
                {adding ? "追加中…" : "追加する"}
              </button>
              <button onClick={() => { setSelected(null); setQuery(""); }} className="text-xs text-slate-400 hover:text-slate-600">
                キャンセル
              </button>
            </div>
            {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Insight card ───────────────────────────────────────────────────────────

function InsightCard({ insight }: { insight: NonNullable<DashboardData["insight"]> }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
      <p className="font-semibold text-slate-800">{insight.Headline}</p>
      <p className="text-sm text-slate-500 leading-relaxed">{insight.Explanation}</p>
      {insight.ImpactOnHoldings && (
        <p className="text-sm text-slate-600 leading-relaxed border-l-2 border-blue-400 pl-3">{insight.ImpactOnHoldings}</p>
      )}
      {insight.Keyword && (
        <span className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-600 text-xs px-3 py-1.5 rounded-lg">
          <span>📖</span>
          <span className="font-medium">{insight.Keyword}</span>
          {insight.KeywordExplanation && <span className="text-blue-400">— {insight.KeywordExplanation}</span>}
        </span>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [analyzingTickers, setAnalyzingTickers] = useState<Set<string>>(new Set());

  async function load() {
    try { setData(await api.dashboard()); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  // Poll pipeline status while any ticker is being analyzed.
  useEffect(() => {
    if (analyzingTickers.size === 0) return;
    const id = setInterval(async () => {
      try {
        const { running } = await api.pipelineStatus();
        const stillRunning = new Set(running);
        setAnalyzingTickers((prev) => {
          const next = new Set([...prev].filter((t) => stillRunning.has(t)));
          if (next.size < prev.size) load(); // refresh dashboard when one finishes
          return next;
        });
      } catch { /* ignore poll errors */ }
    }, 2500);
    return () => clearInterval(id);
  }, [analyzingTickers]);

  function handleAdded(ticker: string) {
    load();
    setShowAdd(false);
    setAnalyzingTickers((prev) => new Set([...prev, ticker]));
  }

  async function handleRemove(ticker: string) {
    if (!confirm(`${ticker} を削除しますか？`)) return;
    await api.removeStock(ticker);
    load();
  }

  if (loading)
    return <div className="flex items-center justify-center h-screen text-slate-400 text-sm">読み込み中…</div>;

  const { holdings, watchlist, insight } = data!;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-5 py-3.5 flex items-center justify-between">
          <span className="font-bold tracking-tight text-slate-900">Kabuly</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              ＋ 銘柄を追加
            </button>
            <Link to="/profile" className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1.5 transition-colors">
              ⚙ 設定
            </Link>
          </div>
        </div>
      </header>

      {/* Add stock modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowAdd(false)} />
          <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <span className="font-semibold text-slate-800">銘柄を追加</span>
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
            </div>
            <div className="p-5">
              <AddStockPanel onAdded={handleAdded} />
            </div>
          </div>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-5 py-8 space-y-10">
        <section>
          <SectionHeader label="保有銘柄" count={holdings.length} />
          {holdings.length === 0 ? (
            <p className="text-slate-400 text-sm">保有銘柄が登録されていません。</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {holdings.map((swr) => <StockCard key={swr.stock.Ticker} swr={swr} onRemove={handleRemove} analyzing={analyzingTickers.has(swr.stock.Ticker)} />)}
            </div>
          )}
        </section>

        <section>
          <SectionHeader label="ウォッチリスト" count={watchlist.length} />
          {watchlist.length === 0 ? (
            <p className="text-slate-400 text-sm">ウォッチリストに銘柄がありません。</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {watchlist.map((swr) => <StockCard key={swr.stock.Ticker} swr={swr} onRemove={handleRemove} analyzing={analyzingTickers.has(swr.stock.Ticker)} />)}
            </div>
          )}
        </section>

        {insight && (
          <section>
            <SectionHeader label="今日の教養" count={1} />
            <InsightCard insight={insight} />
          </section>
        )}
      </main>
    </div>
  );
}
