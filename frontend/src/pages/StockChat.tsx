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

function signalColor(signal: string) {
  if (signal === "買い") return "text-emerald-600";
  if (signal === "売り") return "text-red-500";
  return "text-slate-400";
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

  if (loading) return <div className="h-48 flex items-center justify-center text-slate-400 text-sm">読み込み中…</div>;
  if (!data.length) return <div className="h-48 flex items-center justify-center text-slate-400 text-sm">データなし</div>;

  const min = Math.min(...data.map((d) => d.close));
  const max = Math.max(...data.map((d) => d.close));
  const pad = (max - min) * 0.05;
  const thinned = data.filter((_, i) => i % Math.ceil(data.length / 8) === 0);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            dataKey="date"
            ticks={thinned.map((d) => d.date)}
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[min - pad, max + pad]}
            tick={{ fontSize: 11, fill: "#94a3b8" }}
            axisLine={false}
            tickLine={false}
            width={55}
            tickFormatter={(v) => v.toLocaleString("ja-JP", { maximumFractionDigits: 0 })}
          />
          <Tooltip
            formatter={(v) => [Number(v).toLocaleString("ja-JP", { maximumFractionDigits: 2 }), "終値"]}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
          />
          <Line type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Shared badge / stars (mirrors Dashboard) ──────────────────────────────

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

// ── Pinned analysis card ───────────────────────────────────────────────────

function AnalysisBubble({ report }: { report: NonNullable<StockDetailData["report"]> }) {
  const rows = [
    ["RSI",      report.RSI?.toFixed(1) ?? "—"],
    ["MA200",    fmt(report.MA200)],
    ["目標株価",  fmt(report.TargetPrice)],
    ["損切りライン", fmt(report.StopLoss)],
  ];
  return (
    <div className="px-4 py-3 rounded-2xl rounded-bl-sm text-sm bg-white border border-slate-200 shadow-sm space-y-3">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">本日の分析</p>

      <table className="text-xs w-auto border-collapse">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-slate-100 last:border-0">
              <td className="pr-6 py-1 text-slate-400">{label}</td>
              <td className="py-1 font-semibold text-slate-700 tabular-nums">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center gap-2">
        <SignalBadge signal={report.Signal} />
        <Stars n={report.Confidence} />
      </div>

      <p className="text-slate-600 leading-relaxed">{report.Reason}</p>
    </div>
  );
}

// ── Markdown bubble ────────────────────────────────────────────────────────

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
          const chunk = line.slice(6);
          if (chunk === "[DONE]") break;
          if (chunk.startsWith("[ERROR]")) { full += "\n⚠ " + chunk.slice(8); break; }
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

  if (!data)
    return <div className="flex items-center justify-center h-screen text-slate-400 text-sm">読み込み中…</div>;

  const { stock, report } = data;
  const up = (report?.PriceChangePct ?? 0) >= 0;


  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 shadow-sm shrink-0">
        <div className="flex items-center gap-3 px-5 py-3">
          <Link to="/" className="text-slate-400 hover:text-slate-600 text-lg transition-colors">←</Link>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-slate-900 truncate">
              {stock.Name}
              <span className="text-slate-400 text-sm font-normal ml-2">({stock.Ticker})</span>
            </div>
            {report && (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold text-slate-700 tabular-nums">{fmt(report.Price)}</span>
                <span className={`font-semibold tabular-nums ${up ? "text-emerald-600" : "text-red-500"}`}>
                  {up ? "▲" : "▼"} {Math.abs(report.PriceChangePct).toFixed(1)}%
                </span>
                {report.Signal && (
                  <span className={`font-semibold text-xs ${signalColor(report.Signal)}`}>{report.Signal}</span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowChart((v) => !v)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${showChart ? "bg-blue-600 text-white border-blue-600" : "text-slate-500 border-slate-200 hover:border-slate-300"}`}
            >
              📈 チャート
            </button>
            <button
              onClick={resetChat}
              className="text-xs text-slate-400 hover:text-red-500 border border-slate-200 hover:border-red-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              リセット
            </button>
          </div>
        </div>

        {/* Stat bar */}
        {report && (
          <div className="flex gap-5 px-5 py-2 border-t border-slate-100 text-xs text-slate-400 overflow-x-auto">
            {[
              ["RSI", report.RSI.toFixed(1)],
              ["MA20", fmt(report.MA20)],
              ["MA200", fmt(report.MA200)],
              ["損切り", fmt(report.StopLoss)],
              ["目標", fmt(report.TargetPrice)],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5 whitespace-nowrap">
                <span className="uppercase tracking-wide">{label}</span>
                <span className="text-slate-700 font-semibold">{value}</span>
              </div>
            ))}
          </div>
        )}
      </header>

      {/* Chart (collapsible) */}
      {showChart && (
        <div className="px-4 pt-3 pb-1 bg-white border-b border-slate-200 shrink-0">
          <StockPriceChart ticker={stock.Ticker} market={stock.Market} />
        </div>
      )}

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
        {/* Pinned analysis bubble */}
        <div className="flex flex-col max-w-[85%] self-start">
          <span className="text-xs text-slate-400 mb-1">AI</span>
          {report
            ? <AnalysisBubble report={report} />
            : <MdBubble content="まだ分析データがありません。pipeline を実行してください。" isUser={false} />}
        </div>

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
  );
}
