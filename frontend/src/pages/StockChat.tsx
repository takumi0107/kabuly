import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { api } from "../api/client";
import type { ChatMessage, StockDetailData } from "../types";

function fmt(n: number | null | undefined) {
  if (n == null || n === 0) return "—";
  return n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
}

// ── Shared badge / stars ───────────────────────────────────────────────────

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

// ── Price chart ────────────────────────────────────────────────────────────

type ChartPoint = { date: string; close: number };

function StockPriceChart({ ticker, market }: { ticker: string; market: string }) {
  const [data, setData] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/chart/${ticker}?market=${market}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticker, market]);

  if (loading) return <div className="h-36 flex items-center justify-center text-slate-400 text-xs">読み込み中…</div>;
  if (!data.length) return <div className="h-36 flex items-center justify-center text-slate-400 text-xs">データなし</div>;

  const min = Math.min(...data.map((d) => d.close));
  const max = Math.max(...data.map((d) => d.close));
  const pad = (max - min) * 0.05;
  const thinned = data.filter((_, i) => i % Math.ceil(data.length / 6) === 0);

  return (
    <ResponsiveContainer width="100%" height={150}>
      <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis
          dataKey="date"
          ticks={thinned.map((d) => d.date)}
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[min - pad, max + pad]}
          tick={{ fontSize: 10, fill: "#94a3b8" }}
          axisLine={false}
          tickLine={false}
          width={48}
          tickFormatter={(v) => v.toLocaleString("ja-JP", { maximumFractionDigits: 0 })}
        />
        <Tooltip
          formatter={(v) => [Number(v).toLocaleString("ja-JP", { maximumFractionDigits: 2 }), "終値"]}
          contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e2e8f0" }}
        />
        <Line type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Chat bubbles ───────────────────────────────────────────────────────────

function MdBubble({ content, isUser }: { content: string; isUser: boolean }) {
  if (isUser) {
    return (
      <div className="px-4 py-2.5 rounded-2xl rounded-br-sm text-sm leading-relaxed bg-blue-600 text-white whitespace-pre-wrap break-words">
        {content}
      </div>
    );
  }
  return (
    <div className="px-4 py-3 rounded-2xl rounded-bl-sm text-sm leading-relaxed bg-white border border-slate-200 text-slate-700 shadow-sm prose prose-sm max-w-none
      prose-headings:text-slate-800 prose-headings:font-bold prose-headings:mt-3 prose-headings:mb-1
      prose-p:my-1 prose-p:leading-relaxed
      prose-strong:text-slate-800 prose-strong:font-semibold
      prose-ul:my-1 prose-ul:pl-4 prose-li:my-0.5
      prose-ol:my-1 prose-ol:pl-4
      prose-code:bg-slate-100 prose-code:text-slate-700 prose-code:px-1 prose-code:rounded prose-code:text-xs
      prose-blockquote:border-l-blue-400 prose-blockquote:text-slate-500
      prose-table:text-xs prose-table:w-auto prose-th:bg-slate-50 prose-th:px-3 prose-th:py-1.5
      prose-td:border-slate-200 prose-td:px-3 prose-td:py-1.5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function Bubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.Role === "user";
  return (
    <div className={`flex flex-col max-w-[85%] ${isUser ? "self-end" : "self-start"}`}>
      <span className={`text-xs text-slate-400 mb-1 ${isUser ? "text-right" : ""}`}>
        {isUser ? "あなた" : "AI"}
      </span>
      <MdBubble content={msg.Content} isUser={isUser} />
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function StockChat() {
  const { ticker } = useParams<{ ticker: string }>();
  const [data, setData] = useState<StockDetailData | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [showChart, setShowChart] = useState(false);
  const [updating, setUpdating] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ticker) return;
    api.stockDetail(ticker).then((d) => { setData(d); setMessages(d.history); });
  }, [ticker]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  async function send() {
    const msg = input.trim();
    if (!msg || streaming || !ticker) return;
    const userMsg: ChatMessage = { Role: "user", Content: msg, CreatedAt: "" };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);
    setStreamText("");

    try {
      const res = await fetch(`/api/chat/${ticker}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6);
          if (raw === "[DONE]") break;
          if (raw.startsWith("[ERROR]")) { full += "\n⚠ " + raw.slice(8); break; }
          let chunk: string;
          try { chunk = JSON.parse(raw); } catch { chunk = raw; }
          full += chunk;
          setStreamText(full);
        }
      }
      setMessages((prev) => [...prev, { Role: "assistant", Content: full, CreatedAt: "" }]);
    } finally {
      setStreaming(false);
      setStreamText("");
    }
  }

  async function resetChat() {
    if (!ticker || !confirm("会話履歴をリセットしますか？")) return;
    await api.resetChat(ticker);
    setMessages([]);
  }

  async function triggerUpdate() {
    if (!ticker || updating) return;
    setUpdating(true);
    try {
      await api.runPipeline(ticker);
    } catch { /* ignore — server not ready yet */ }
    const id = setInterval(async () => {
      try {
        const { running } = await api.pipelineStatus();
        if (!running.includes(ticker)) {
          clearInterval(id);
          const fresh = await api.stockDetail(ticker);
          setData(fresh);
          setUpdating(false);
        }
      } catch { /* ignore poll errors */ }
    }, 2500);
  }

  if (!data)
    return <div className="flex items-center justify-center h-screen text-slate-400 text-sm">読み込み中…</div>;

  const { stock, report } = data;
  const up = (report?.PriceChangePct ?? 0) >= 0;

  const stats = [
    ["RSI",    report?.RSI != null ? report.RSI.toFixed(1) : "—"],
    ["MA20",   fmt(report?.MA20)],
    ["MA200",  fmt(report?.MA200)],
    ["目標株価", fmt(report?.TargetPrice)],
    ["損切り",  fmt(report?.StopLoss)],
    ...(stock.PurchasePrice > 0 ? [["取得単価", fmt(stock.PurchasePrice)]] : []),
  ] as [string, string][];

  return (
    <div className="flex h-screen bg-slate-50">

      {/* ── Left sidebar ─────────────────────────────────────────────── */}
      <aside className="w-72 shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-y-auto">

        {/* Back + stock name */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-100">
          <Link to="/" className="text-slate-400 hover:text-slate-600 transition-colors text-lg leading-none">←</Link>
          <div className="min-w-0">
            <p className="font-bold text-slate-900 text-sm truncate">{stock.Name}</p>
            <p className="text-xs text-slate-400 mt-0.5">{stock.Ticker} · {stock.Market}</p>
          </div>
        </div>

        {/* Price + signal */}
        <div className="px-4 py-4 border-b border-slate-100 space-y-2">
          {report ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-900 tabular-nums">{fmt(report.Price)}</span>
                <span className={`text-sm font-semibold tabular-nums ${up ? "text-emerald-600" : "text-red-500"}`}>
                  {up ? "▲" : "▼"} {Math.abs(report.PriceChangePct).toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <SignalBadge signal={report.Signal} />
                <Stars n={report.Confidence} />
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400">データなし</p>
          )}
        </div>

        {/* Stat grid */}
        {report && (
          <div className="px-4 py-4 border-b border-slate-100 grid grid-cols-2 gap-x-4 gap-y-3">
            {stats.map(([label, value]) => (
              <div key={label}>
                <p className="text-xs text-slate-400">{label}</p>
                <p className="text-sm font-semibold text-slate-700 tabular-nums">{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Analysis reason */}
        {report?.Reason && (
          <div className="px-4 py-4 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">分析コメント</p>
            <p className="text-xs text-slate-600 leading-relaxed">{report.Reason}</p>
          </div>
        )}

        {/* Chart */}
        <div>
          <button
            onClick={() => setShowChart((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-xs text-slate-500 hover:bg-slate-50 transition-colors border-b border-slate-100"
          >
            <span className="font-medium">📈 価格チャート</span>
            <span className="text-slate-300 text-xs">{showChart ? "▲" : "▼"}</span>
          </button>
          {showChart && (
            <div className="px-3 py-3">
              <StockPriceChart ticker={stock.Ticker} market={stock.Market} />
            </div>
          )}
        </div>

        {/* No data fallback */}
        {!report && (
          <div className="px-4 py-4 text-xs text-slate-400">
            ↻ 更新 を押して分析を実行してください。
          </div>
        )}
      </aside>

      {/* ── Chat panel ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Chat header */}
        <header className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between shrink-0 shadow-sm">
          <span className="text-sm font-medium text-slate-500">💬 AIアナリストに質問</span>
          <div className="flex items-center gap-2">
            <button
              onClick={triggerUpdate}
              disabled={updating}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:border-blue-300 text-slate-500 hover:text-blue-600 disabled:opacity-40 transition-colors"
            >
              {updating ? "更新中…" : "↻ 更新"}
            </button>
            <button
              onClick={resetChat}
              className="text-xs text-slate-400 hover:text-red-500 border border-slate-200 hover:border-red-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              リセット
            </button>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {messages.length === 0 && !streaming && (
            <div className="flex-1 flex items-center justify-center py-20">
              <p className="text-sm text-slate-400">左の分析を参考に、何でも聞いてください</p>
            </div>
          )}
          {messages.map((m, i) => <Bubble key={i} msg={m} />)}
          {streaming && streamText && (
            <div className="flex flex-col max-w-[85%] self-start">
              <span className="text-xs text-slate-400 mb-1">AI</span>
              <MdBubble content={streamText + "▌"} isUser={false} />
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div className="flex gap-3 px-4 py-3 border-t border-slate-200 shrink-0 bg-white shadow-sm">
          <textarea
            className="flex-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-2.5 text-sm resize-none leading-relaxed focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors"
            rows={2}
            placeholder="何でも聞いてください… (Shift+Enter で送信)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); send(); }
            }}
          />
          <button
            onClick={send}
            disabled={streaming || !input.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold text-sm px-5 rounded-xl transition-colors whitespace-nowrap"
          >
            送信 ↗
          </button>
        </div>
      </div>
    </div>
  );
}
