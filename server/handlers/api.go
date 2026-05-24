// Package handlers contains HTTP handler functions for the Kabuly API server.
package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/kabuly/kabuly/db"
)

// pipelineRunning tracks tickers currently being analyzed.
var (
	pipelineMu      sync.Mutex
	pipelineRunning = map[string]bool{}
)

// ─────────────────────────────────────────────────────────
// JSON helpers
// ─────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// ─────────────────────────────────────────────────────────
// GET /api/dashboard
// Returns everything the dashboard page needs in one request.
// ─────────────────────────────────────────────────────────

type stockWithReport struct {
	Stock  db.Stock        `json:"stock"`
	Report *db.DailyReport `json:"report"`
}

type dashboardResponse struct {
	Holdings  []stockWithReport `json:"holdings"`
	Watchlist []stockWithReport `json:"watchlist"`
	Insight   *db.DailyInsight  `json:"insight"`
	Profile   *db.UserProfile   `json:"profile"`
}

func GetDashboard(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		stocks, err := db.GetAllStocks(database)
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}

		var holdings, watchlist []stockWithReport
		for _, s := range stocks {
			report, _ := db.GetLatestReport(database, s.Ticker)
			swr := stockWithReport{Stock: s, Report: report}
			if s.Category == "holding" {
				holdings = append(holdings, swr)
			} else {
				watchlist = append(watchlist, swr)
			}
		}
		if holdings == nil {
			holdings = []stockWithReport{}
		}
		if watchlist == nil {
			watchlist = []stockWithReport{}
		}

		insight, _ := db.GetLatestInsight(database)
		profile, _ := db.GetProfile(database)

		writeJSON(w, 200, dashboardResponse{
			Holdings:  holdings,
			Watchlist: watchlist,
			Insight:   insight,
			Profile:   profile,
		})
	}
}

// ─────────────────────────────────────────────────────────
// GET /api/stock/{ticker}
// Returns everything the stock chat page needs.
// ─────────────────────────────────────────────────────────

type stockDetailResponse struct {
	Stock   *db.Stock        `json:"stock"`
	Report  *db.DailyReport  `json:"report"`
	History []db.ChatMessage `json:"history"`
	Profile *db.UserProfile  `json:"profile"`
}

func GetStockDetail(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ticker := strings.ToUpper(r.PathValue("ticker"))
		stock, err := db.GetStock(database, ticker)
		if err != nil || stock == nil {
			writeError(w, 404, "stock not found")
			return
		}
		report, _ := db.GetLatestReport(database, ticker)
		history, _ := db.GetChatHistory(database, ticker, 50)
		profile, _ := db.GetProfile(database)

		if history == nil {
			history = []db.ChatMessage{}
		}

		writeJSON(w, 200, stockDetailResponse{
			Stock:   stock,
			Report:  report,
			History: history,
			Profile: profile,
		})
	}
}

// ─────────────────────────────────────────────────────────
// GET /api/stocks
// ─────────────────────────────────────────────────────────

func GetStocks(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		stocks, err := db.GetAllStocks(database)
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		if stocks == nil {
			stocks = []db.Stock{}
		}
		writeJSON(w, 200, stocks)
	}
}

// ─────────────────────────────────────────────────────────
// POST /api/stocks
// ─────────────────────────────────────────────────────────

func AddStock(database *sql.DB, pipelineDir, uvPath string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Ticker        string  `json:"ticker"`
			Name          string  `json:"name"`
			Market        string  `json:"market"`
			Category      string  `json:"category"`
			PurchasePrice float64 `json:"purchase_price"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, 400, "invalid JSON")
			return
		}
		if payload.Ticker == "" || payload.Name == "" {
			writeError(w, 400, "ticker and name are required")
			return
		}
		s := db.Stock{
			Ticker:        strings.ToUpper(payload.Ticker),
			Name:          payload.Name,
			Market:        strings.ToUpper(payload.Market),
			Category:      payload.Category,
			PurchasePrice: payload.PurchasePrice,
		}
		if err := db.AddStock(database, s); err != nil {
			writeError(w, 500, err.Error())
			return
		}
		// Run analysis for the new stock in the background — don't block the response.
		go runPipelineForTicker(pipelineDir, uvPath, s.Ticker)
		writeJSON(w, 201, map[string]string{"status": "ok", "ticker": s.Ticker})
	}
}

// runPipelineForTicker sets the running flag and launches the pipeline goroutine.
func runPipelineForTicker(pipelineDir, uvPath, ticker string) {
	pipelineMu.Lock()
	pipelineRunning[ticker] = true
	pipelineMu.Unlock()
	go runPipelineForTickerAsync(pipelineDir, uvPath, ticker)
}

// ─────────────────────────────────────────────────────────
// POST /api/insight/refresh
// Re-fetches macro news and regenerates today's insight.
// ─────────────────────────────────────────────────────────

var (
	insightMu      sync.Mutex
	insightRunning bool
)

func RefreshInsight(_ *sql.DB, pipelineDir, uvPath string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		insightMu.Lock()
		already := insightRunning
		if !already {
			insightRunning = true
		}
		insightMu.Unlock()

		if already {
			writeJSON(w, 200, map[string]string{"status": "already_running"})
			return
		}

		go func() {
			defer func() {
				insightMu.Lock()
				insightRunning = false
				insightMu.Unlock()
			}()
			log.Printf("[insight] refreshing ...")
			cmd := exec.Command(uvPath, "run", "python", "main.py", "refresh-insight")
			cmd.Dir = pipelineDir
			out, err := cmd.CombinedOutput()
			if err != nil {
				log.Printf("[insight] error: %v\n%s", err, out)
			} else {
				log.Printf("[insight] done")
			}
		}()

		writeJSON(w, 200, map[string]string{"status": "started"})
	}
}

// ─────────────────────────────────────────────────────────
// POST /api/pipeline/run/{ticker}
// Triggers a background analysis run for one ticker.
// ─────────────────────────────────────────────────────────

func RunPipeline(database *sql.DB, pipelineDir, uvPath string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ticker := strings.ToUpper(r.PathValue("ticker"))
		stock, err := db.GetStock(database, ticker)
		if err != nil || stock == nil {
			writeError(w, 404, "stock not found")
			return
		}
		pipelineMu.Lock()
		alreadyRunning := pipelineRunning[ticker]
		pipelineMu.Unlock()
		if alreadyRunning {
			writeJSON(w, 200, map[string]string{"status": "already_running"})
			return
		}
		go runPipelineForTicker(pipelineDir, uvPath, ticker)
		writeJSON(w, 200, map[string]string{"status": "started", "ticker": ticker})
	}
}

// ─────────────────────────────────────────────────────────
// POST /api/pipeline/run/all
// Triggers background analysis for every registered stock.
// ─────────────────────────────────────────────────────────

func RunAllPipeline(database *sql.DB, pipelineDir, uvPath string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		stocks, err := db.GetAllStocks(database)
		if err != nil || len(stocks) == 0 {
			writeJSON(w, 200, map[string]any{"status": "no stocks", "tickers": []string{}})
			return
		}
		pipelineMu.Lock()
		var queued []string
		for _, s := range stocks {
			if !pipelineRunning[s.Ticker] {
				pipelineRunning[s.Ticker] = true
				queued = append(queued, s.Ticker)
			}
		}
		pipelineMu.Unlock()

		for _, ticker := range queued {
			go runPipelineForTickerAsync(pipelineDir, uvPath, ticker)
		}

		writeJSON(w, 200, map[string]any{"status": "started", "tickers": queued})
	}
}

// runPipelineForTickerAsync runs the pipeline without setting the running flag
// (the caller already set it under the lock).
func runPipelineForTickerAsync(pipelineDir, uvPath, ticker string) {
	defer func() {
		pipelineMu.Lock()
		delete(pipelineRunning, ticker)
		pipelineMu.Unlock()
	}()
	log.Printf("[pipeline] starting analysis for %s", ticker)
	cmd := exec.Command(uvPath, "run", "python", "main.py", "run", "--ticker", ticker, "--no-notify")
	cmd.Dir = pipelineDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("[pipeline] %s error: %v\n%s", ticker, err, out)
	} else {
		log.Printf("[pipeline] %s done", ticker)
	}
}

// ─────────────────────────────────────────────────────────
// GET /api/pipeline/status
// Returns which tickers are currently being analyzed.
// ─────────────────────────────────────────────────────────

func GetPipelineStatus(_ *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pipelineMu.Lock()
		running := make([]string, 0, len(pipelineRunning))
		for ticker := range pipelineRunning {
			running = append(running, ticker)
		}
		pipelineMu.Unlock()

		insightMu.Lock()
		insightRunning_ := insightRunning
		insightMu.Unlock()

		writeJSON(w, 200, map[string]any{
			"running":         running,
			"insight_running": insightRunning_,
		})
	}
}

// ─────────────────────────────────────────────────────────
// DELETE /api/stocks/{ticker}
// ─────────────────────────────────────────────────────────

func RemoveStock(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ticker := strings.ToUpper(r.PathValue("ticker"))
		if err := db.DeleteStock(database, ticker); err != nil {
			writeError(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, map[string]string{"status": "ok"})
	}
}

// ─────────────────────────────────────────────────────────
// GET /api/profile
// ─────────────────────────────────────────────────────────

func GetProfile(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		profile, err := db.GetProfile(database)
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, profile)
	}
}

// ─────────────────────────────────────────────────────────
// POST /api/profile
// ─────────────────────────────────────────────────────────

func SaveProfile(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Style string `json:"style"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, 400, "invalid JSON")
			return
		}
		p := db.UserProfile{
			Style: payload.Style,
		}
		if err := db.UpdateProfile(database, p); err != nil {
			writeError(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, map[string]string{"status": "ok"})
	}
}

// ─────────────────────────────────────────────────────────
// GET /api/search?q=query
// Proxies Yahoo Finance stock search, returns equities only.
// ─────────────────────────────────────────────────────────

type StockSearchResult struct {
	Ticker   string `json:"ticker"`
	Name     string `json:"name"`
	Market   string `json:"market"`
	Exchange string `json:"exchange"`
}

func SearchStocks(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		if q == "" {
			writeJSON(w, 200, []StockSearchResult{})
			return
		}

		results := []StockSearchResult{}

		if isJapanese(q) {
			// Japanese text → search local JPX master by name
			stocks, _ := db.SearchJPStocks(database, q, "")
			for _, s := range stocks {
				results = append(results, StockSearchResult{
					Ticker:   s.Code,
					Name:     s.Name,
					Market:   "JP",
					Exchange: s.Market + "（東証）",
				})
			}
		} else if isAllDigits(q) {
			// Numeric code → search local JPX master by code prefix
			stocks, _ := db.SearchJPStocks(database, "", q)
			for _, s := range stocks {
				results = append(results, StockSearchResult{
					Ticker:   s.Code,
					Name:     s.Name,
					Market:   "JP",
					Exchange: s.Market + "（東証）",
				})
			}
		} else {
			// English/ASCII text → search jp_stocks with fullwidth conversion (e.g. "IHI" → "ＩＨＩ")
			// and also hit Yahoo Finance for US/global stocks.
			fwQuery := toFullwidth(strings.ToUpper(q))
			if jpStocks, _ := db.SearchJPStocks(database, fwQuery, ""); len(jpStocks) > 0 {
				for _, s := range jpStocks {
					results = append(results, StockSearchResult{
						Ticker:   s.Code,
						Name:     s.Name,
						Market:   "JP",
						Exchange: s.Market + "（東証）",
					})
				}
			}

			// query2 is the working mirror of query1 (query1 has been down since Apr 2025)
			endpoint := fmt.Sprintf(
				"https://query2.finance.yahoo.com/v1/finance/search?q=%s&quotesCount=10&newsCount=0&enableFuzzyQuery=false",
				url.QueryEscape(q),
			)
			req, _ := http.NewRequestWithContext(r.Context(), "GET", endpoint, nil)
			req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
			req.Header.Set("Accept", "application/json")

			resp, err := http.DefaultClient.Do(req)
			if err == nil {
				defer resp.Body.Close()
				var raw struct {
					Quotes []struct {
						Symbol    string `json:"symbol"`
						Shortname string `json:"shortname"`
						Longname  string `json:"longname"`
						ExchDisp  string `json:"exchDisp"`
						QuoteType string `json:"quoteType"`
					} `json:"quotes"`
				}
				if json.NewDecoder(resp.Body).Decode(&raw) == nil {
					for _, item := range raw.Quotes {
						if item.QuoteType != "EQUITY" {
							continue
						}
						ticker := item.Symbol
						market := "US"
						if strings.HasSuffix(ticker, ".T") {
							ticker = strings.TrimSuffix(ticker, ".T")
							market = "JP"
						} else if strings.Contains(ticker, ".") {
							continue
						}
						name := item.Longname
						if name == "" {
							name = item.Shortname
						}
						results = append(results, StockSearchResult{
							Ticker:   ticker,
							Name:     name,
							Market:   market,
							Exchange: item.ExchDisp,
						})
					}
				}
			}
		}

		writeJSON(w, 200, results)
	}
}

// toFullwidth converts ASCII printable characters to their fullwidth equivalents
// (e.g. "IHI" → "ＩＨＩ") so they match how JPX stores company names.
func toFullwidth(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= 0x21 && r <= 0x7E {
			b.WriteRune(r + 0xFEE0)
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func isJapanese(s string) bool {
	for _, r := range s {
		if r >= 0x3040 && r <= 0x9FFF { // hiragana, katakana, kanji
			return true
		}
	}
	return false
}

func isAllDigits(s string) bool {
	if len(s) == 0 {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// ─────────────────────────────────────────────────────────
// GET /api/chart/{ticker}
// Returns price history from local daily_reports table.
// ─────────────────────────────────────────────────────────

type ChartPoint struct {
	Date  string  `json:"date"`
	Close float64 `json:"close"`
}

func GetChartData(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ticker := strings.ToUpper(r.PathValue("ticker"))
		rows, err := database.QueryContext(r.Context(),
			`SELECT report_date, price FROM daily_reports
			 WHERE ticker = ? AND price > 0
			 ORDER BY report_date ASC`,
			ticker,
		)
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		defer rows.Close()

		points := []ChartPoint{}
		for rows.Next() {
			var dateStr string
			var price float64
			if err := rows.Scan(&dateStr, &price); err != nil {
				continue
			}
			t, err := time.Parse("2006-01-02", dateStr)
			if err != nil {
				continue
			}
			points = append(points, ChartPoint{
				Date:  t.Format("1/2"),
				Close: price,
			})
		}
		writeJSON(w, 200, points)
	}
}

// ─────────────────────────────────────────────────────────
// POST /webhook/line
// ─────────────────────────────────────────────────────────

func LineWebhook(_ *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}
}

// ─────────────────────────────────────────────────────────
// SPA fallback — serves React index.html for non-API routes
// ─────────────────────────────────────────────────────────

// SPA returns a handler that serves static files from distDir and falls back
// to index.html for any path that doesn't map to a file (React Router).
func SPA(distDir string) http.Handler {
	fileServer := http.FileServer(http.Dir(distDir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/auth/") {
			http.NotFound(w, r)
			return
		}
		if _, err := os.Stat(distDir + r.URL.Path); os.IsNotExist(err) {
			http.ServeFile(w, r, distDir+"/index.html")
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}
