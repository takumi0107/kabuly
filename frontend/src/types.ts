// Domain types mirroring the Go server's JSON responses.

export interface Stock {
  ID: number;
  Ticker: string;
  Name: string;
  Market: string;
  Category: string;
  PurchasePrice: number;
  PurchaseDate: string;
  CreatedAt: string;
}

export interface DailyReport {
  ID: number;
  Ticker: string;
  ReportDate: string;
  Price: number;
  PriceChangePct: number;
  Signal: string;
  Confidence: number;
  Reason: string;
  TargetPrice: number;
  StopLoss: number;
  RecommendedAmount: number;
  RecommendedShares: number;
  RSI: number;
  MA20: number;
  MA50: number;
  MA200: number;
  MACD: number;
  BusinessSummaryJa: string;
}

export interface DailyInsight {
  ID: number;
  ReportDate: string;
  Headline: string;
  Explanation: string;
  ImpactOnHoldings: string;
  Keyword: string;
  KeywordExplanation: string;
  RelatedTickers: string;
}

export interface ChatMessage {
  Role: "user" | "assistant";
  Content: string;
  CreatedAt: string;
}

export interface UserProfile {
  ID: number;
  TotalFunds: number;
  MaxPositionPct: number;
  Style: string;
  LineUserID: string;
  UpdatedAt: string;
}

export interface StockWithReport {
  stock: Stock;
  report: DailyReport | null;
}

export interface DashboardData {
  holdings: StockWithReport[];
  watchlist: StockWithReport[];
  insight: DailyInsight | null;
  profile: UserProfile;
}

export interface StockDetailData {
  stock: Stock;
  report: DailyReport | null;
  history: ChatMessage[];
  profile: UserProfile;
}
