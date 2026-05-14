// Package handlers contains HTTP handler functions for the Kabuly API server.
package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/kabuly/kabuly/db"
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

func AddStock(database *sql.DB) http.HandlerFunc {
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
		writeJSON(w, 201, map[string]string{"status": "ok", "ticker": s.Ticker})
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
			TotalFunds     float64 `json:"total_funds"`
			MaxPositionPct float64 `json:"max_position_pct"`
			Style          string  `json:"style"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, 400, "invalid JSON")
			return
		}
		p := db.UserProfile{
			TotalFunds:     payload.TotalFunds,
			MaxPositionPct: payload.MaxPositionPct,
			Style:          payload.Style,
		}
		if err := db.UpdateProfile(database, p); err != nil {
			writeError(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, map[string]string{"status": "ok"})
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
		if strings.HasPrefix(r.URL.Path, "/api/") {
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
