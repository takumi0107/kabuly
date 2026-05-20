// Kabuly API server.
// Serves JSON APIs consumed by the React frontend.
// In production it also serves the compiled frontend from ../frontend/dist.
package main

import (
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/joho/godotenv"
	"github.com/kabuly/kabuly/db"
	"github.com/kabuly/kabuly/handlers"
)

func main() {
	// projectRoot is one directory above server/
	cwd, _ := os.Getwd()
	projectRoot := filepath.Join(cwd, "..")

	_ = godotenv.Load(filepath.Join(projectRoot, ".env"))

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "data/kabu.db"
	}
	if !filepath.IsAbs(dbPath) {
		dbPath = filepath.Join(projectRoot, dbPath)
	}

	database := db.Open(dbPath)
	defer database.Close()

	mux := http.NewServeMux()

	pipelineDir := filepath.Join(projectRoot, "pipeline")

	uvPath, err := exec.LookPath("uv")
	if err != nil {
		// LookPath only searches PATH; try common install locations as fallback
		for _, candidate := range []string{
			os.ExpandEnv("$HOME/.local/bin/uv"),
			"/usr/local/bin/uv",
			"/opt/homebrew/bin/uv",
		} {
			if _, e := os.Stat(candidate); e == nil {
				uvPath = candidate
				break
			}
		}
	}
	if uvPath == "" {
		log.Println("warning: uv not found — pipeline auto-run disabled")
	} else {
		log.Printf("uv found at %s", uvPath)
	}

	// ── Stock APIs ──────────────────────────────────────
	mux.HandleFunc("GET /api/stocks", handlers.GetStocks(database))
	mux.HandleFunc("POST /api/stocks", handlers.AddStock(database, pipelineDir, uvPath))
	mux.HandleFunc("DELETE /api/stocks/{ticker}", handlers.RemoveStock(database))

	// ── Stock search & chart (Yahoo Finance proxy) ─────
	mux.HandleFunc("GET /api/search", handlers.SearchStocks(database))
	mux.HandleFunc("GET /api/chart/{ticker}", handlers.GetChartData(database))

	// ── Dashboard (all data in one call) ────────────────
	mux.HandleFunc("GET /api/dashboard", handlers.GetDashboard(database))

	// ── Stock detail page data ──────────────────────────
	mux.HandleFunc("GET /api/stock/{ticker}", handlers.GetStockDetail(database))

	// ── Profile ─────────────────────────────────────────
	mux.HandleFunc("GET /api/profile", handlers.GetProfile(database))
	mux.HandleFunc("POST /api/profile", handlers.SaveProfile(database))

	// ── Pipeline status ─────────────────────────────────
	mux.HandleFunc("GET /api/pipeline/status", handlers.GetPipelineStatus(database))

	// ── Chat (SSE streaming) ────────────────────────────
	mux.HandleFunc("POST /api/chat/{ticker}", handlers.StockChat(database))

	// ── LINE Webhook ────────────────────────────────────
	mux.HandleFunc("POST /webhook/line", handlers.LineWebhook(database))

	// ── Serve React SPA (production build) ──────────────
	distDir := filepath.Join(projectRoot, "frontend", "dist")
	mux.Handle("/", handlers.SPA(distDir))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Kabuly server on http://localhost:%s", port)
	log.Fatal(http.ListenAndServe(":"+port, cors(mux)))
}

// cors adds permissive CORS headers so the Vite dev server (port 5173)
// can reach this API during development.
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
