// Package handlers contains HTTP handler functions for the Kabuly web server.
package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/kabuly/kabuly/db"
)

// ─────────────────────────────────────────────────────────
// REST helpers
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
// GET /api/stocks
// ─────────────────────────────────────────────────────────

// GetStocks returns all registered stocks as JSON.
func GetStocks(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		stocks, err := db.GetAllStocks(database)
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, stocks)
	}
}

// ─────────────────────────────────────────────────────────
// POST /api/stocks
// ─────────────────────────────────────────────────────────

// AddStock registers a new stock from a JSON body.
// Expected body: { "ticker", "name", "market", "category", "purchase_price"? }
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
			writeError(w, 400, "invalid JSON: "+err.Error())
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

// RemoveStock deletes a stock and its chat history.
func RemoveStock(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ticker := strings.ToUpper(r.PathValue("ticker"))
		if ticker == "" {
			writeError(w, 400, "ticker required")
			return
		}
		if err := db.DeleteStock(database, ticker); err != nil {
			writeError(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, map[string]string{"status": "ok"})
	}
}

// ─────────────────────────────────────────────────────────
// POST /api/profile
// ─────────────────────────────────────────────────────────

// SaveProfile updates the user investment profile.
func SaveProfile(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			TotalFunds     float64 `json:"total_funds"`
			MaxPositionPct float64 `json:"max_position_pct"`
			Style          string  `json:"style"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, 400, "invalid JSON: "+err.Error())
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

// LineWebhook handles incoming LINE webhook events.
// Currently just acknowledges the request (full chat relay is a future feature).
func LineWebhook(_ *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}
}
