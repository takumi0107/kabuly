import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { ChatMessage, StockDetailData } from "../types";

function fmt(n: number | null | undefined) {
  if (n == null || n === 0) return "—";
  return n.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
}

function signalColor(signal: string) {
  if (signal === "買い") return "text-green-400";
  if (signal === "売り") return "text-red-400";
  return "text-slate-400";
}

// ── Bubble ─────────────────────────────────────────────────────────────────

function Bubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.Role === "user";
  return (
    <div className={`flex flex-col max-w-[82%] ${isUser ? "self-end" : "self-start"}`}>
      <span className={`text-xs text-slate-500 mb-1 ${isUser ? "text-right" : ""}`}>
        {isUser ? "あなた" : "Claude"}
      </span>
      <div
        className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
          isUser
            ? "bg-blue-900/50 rounded-br-sm"
            : "bg-[#1a1d27] border border-[#2a2d3a] rounded-bl-sm"
        }`}
      >
        {msg.Content}
      </div>
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
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ticker) return;
    api.stockDetail(ticker).then((d) => {
      setData(d);
      setMessages(d.history);
    });
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
          if (chunk.startsWith("[ERROR]")) {
            full += "\n⚠ " + chunk.slice(8);
            break;
          }
          full += chunk;
          setStreamText(full);
        }
      }

      setMessages((prev) => [
        ...prev,
        { Role: "assistant", Content: full, CreatedAt: "" },
      ]);
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
    return (
      <div className="flex items-center justify-center h-screen text-slate-400">
        読み込み中…
      </div>
    );

  const { stock, report } = data;
  const up = (report?.PriceChangePct ?? 0) >= 0;

  // Initial analysis bubble shown at the top of every conversation
  const analysisText = report
    ? `本日の分析:\nRSI ${report.RSI.toFixed(1)} / MA200 ${fmt(report.MA200)}\n判断: ${report.Signal}（確信度${"★".repeat(report.Confidence)}${"☆".repeat(5 - report.Confidence)}）\n${report.Reason}${report.RecommendedAmount > 0 ? `\n\n推奨購入額: ¥${fmt(report.RecommendedAmount)}（${report.RecommendedShares}株）\n損切りライン: ${fmt(report.StopLoss)}` : ""}`
    : "まだ分析データがありません。pipeline を実行してください。";

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex items-center gap-3 px-5 py-3 border-b border-[#2a2d3a] shrink-0">
        <Link to="/" className="text-slate-400 text-lg">←</Link>
        <div className="flex-1">
          <div className="font-bold">
            {stock.Name}
            <span className="text-slate-400 text-sm ml-2">({stock.Ticker})</span>
          </div>
          {report && (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-slate-200">{fmt(report.Price)}</span>
              <span className={up ? "text-green-400" : "text-red-400"}>
                {up ? "+" : ""}{report.PriceChangePct.toFixed(1)}%
              </span>
              {report.Signal && (
                <span className={`font-semibold ${signalColor(report.Signal)}`}>
                  {report.Signal}
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Stat bar */}
      {report && (
        <div className="flex gap-5 px-5 py-2 border-b border-[#2a2d3a] text-xs text-slate-500 overflow-x-auto shrink-0">
          {[
            ["RSI", report.RSI.toFixed(1)],
            ["MA20", fmt(report.MA20)],
            ["MA200", fmt(report.MA200)],
            ["損切り", fmt(report.StopLoss)],
            ["目標", fmt(report.TargetPrice)],
            ["推奨額", `¥${fmt(report.RecommendedAmount)}`],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5 whitespace-nowrap">
              <span className="uppercase tracking-wide">{label}</span>
              <span className="text-slate-200 font-semibold">{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Reset button */}
      <div className="flex justify-end px-5 py-2 border-b border-[#2a2d3a] shrink-0">
        <button
          onClick={resetChat}
          className="text-xs text-slate-500 hover:text-red-400 border border-[#2a2d3a] hover:border-red-900 px-3 py-1 rounded-lg transition-colors"
        >
          新しい会話を始める
        </button>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
        {/* Pinned analysis bubble */}
        <div className="flex flex-col max-w-[82%] self-start">
          <span className="text-xs text-slate-500 mb-1">Claude</span>
          <div className="px-4 py-2.5 rounded-2xl rounded-bl-sm text-sm leading-relaxed whitespace-pre-wrap bg-[#1a1d27] border border-[#2a2d3a]">
            {analysisText}
          </div>
        </div>

        {messages.map((m, i) => (
          <Bubble key={i} msg={m} />
        ))}

        {/* Streaming bubble */}
        {streaming && streamText && (
          <div className="flex flex-col max-w-[82%] self-start">
            <span className="text-xs text-slate-500 mb-1">Claude</span>
            <div className="px-4 py-2.5 rounded-2xl rounded-bl-sm text-sm leading-relaxed whitespace-pre-wrap bg-[#1a1d27] border border-[#2a2d3a]">
              {streamText}
              <span className="inline-block w-1.5 h-3.5 bg-blue-400 ml-0.5 animate-pulse" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="flex gap-3 px-4 py-3 border-t border-[#2a2d3a] shrink-0 bg-[#0f1117]">
        <textarea
          className="flex-1 bg-[#1a1d27] border border-[#2a2d3a] text-slate-200 rounded-xl px-4 py-2.5 text-sm resize-none leading-relaxed focus:outline-none focus:border-blue-500"
          rows={2}
          placeholder="何でも聞いてください… (Shift+Enter で送信)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          onClick={send}
          disabled={streaming || !input.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold text-sm px-5 rounded-xl transition-colors whitespace-nowrap"
        >
          送信 ↗
        </button>
      </div>
    </div>
  );
}
