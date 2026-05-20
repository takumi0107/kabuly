// Typed API wrappers for the Kabuly Go backend.
import type { DashboardData, StockDetailData, UserProfile } from "../types";

const BASE = "";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}

export const api = {
  // Dashboard — all data in one call
  dashboard: () => json<DashboardData>("/api/dashboard"),

  // Stock detail + chat history
  stockDetail: (ticker: string) =>
    json<StockDetailData>(`/api/stock/${ticker}`),

  // Stock management
  addStock: (payload: {
    ticker: string;
    name: string;
    market: string;
    category: string;
    purchase_price: number;
  }) =>
    json<{ status: string; ticker: string }>("/api/stocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  removeStock: (ticker: string) =>
    json<{ status: string }>(`/api/stocks/${ticker}`, { method: "DELETE" }),

  // Profile
  getProfile: () => json<UserProfile>("/api/profile"),
  saveProfile: (payload: {
    style: string;
  }) =>
    json<{ status: string }>("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  // Stock search (Yahoo Finance proxy)
  searchStocks: (q: string) =>
    json<{ ticker: string; name: string; market: string; exchange: string }[]>(
      `/api/search?q=${encodeURIComponent(q)}`
    ),

  // Pipeline status — which tickers are being analyzed + whether insight is refreshing
  pipelineStatus: () =>
    json<{ running: string[]; insight_running: boolean }>("/api/pipeline/status"),

  // Manually trigger analysis for one ticker
  runPipeline: (ticker: string) =>
    json<{ status: string }>(`/api/pipeline/run/${ticker}`, { method: "POST" }),

  // Re-fetch macro news and regenerate today's insight
  refreshInsight: () =>
    json<{ status: string }>("/api/insight/refresh", { method: "POST" }),

  // Chat reset (message sending uses SSE, not this helper)
  resetChat: (ticker: string) =>
    json<{ status: string }>(`/api/chat/${ticker}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reset: true }),
    }),
};
