// Kabuly Go web server.
// Serves the dashboard, stock chat pages, and REST APIs.
// All analysis data is produced by the Python pipeline and read from SQLite.
package main

import (
	"html/template"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/joho/godotenv"
	"github.com/kabuly/kabuly/db"
	"github.com/kabuly/kabuly/handlers"
)

func main() {
	// projectRoot is one directory above go/
	// Works for both `go run .` (run from go/) and compiled binaries.
	cwd, _ := os.Getwd()
	projectRoot := filepath.Join(cwd, "..")

	// Load .env from the project root; ignore error if file doesn't exist.
	envFile := filepath.Join(projectRoot, ".env")
	_ = godotenv.Load(envFile)

	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "data/kabu.db"
	}
	// Resolve relative paths against the project root, not the cwd.
	if !filepath.IsAbs(dbPath) {
		dbPath = filepath.Join(projectRoot, dbPath)
	}

	// Open SQLite connection shared across all handlers
	database := db.Open(dbPath)
	defer database.Close()

	// Parse all HTML templates from the templates/ directory
	tmpl, err := template.New("").Funcs(templateFuncs()).ParseGlob("./templates/*.html")
	if err != nil {
		log.Fatalf("template parse error: %v", err)
	}

	mux := http.NewServeMux()

	// ── Pages ───────────────────────────────────────────
	mux.HandleFunc("GET /{$}", handlers.Dashboard(database, tmpl))
	mux.HandleFunc("GET /stock/{ticker}", handlers.StockPage(database, tmpl))
	mux.HandleFunc("GET /profile", handlers.ProfilePage(database, tmpl))

	// ── REST APIs ───────────────────────────────────────
	mux.HandleFunc("GET /api/stocks", handlers.GetStocks(database))
	mux.HandleFunc("POST /api/stocks", handlers.AddStock(database))
	mux.HandleFunc("DELETE /api/stocks/{ticker}", handlers.RemoveStock(database))
	mux.HandleFunc("POST /api/profile", handlers.SaveProfile(database))
	mux.HandleFunc("POST /api/chat/{ticker}", handlers.StockChat(database))

	// ── LINE Webhook ────────────────────────────────────
	mux.HandleFunc("POST /webhook/line", handlers.LineWebhook(database))

	// ── Static files ────────────────────────────────────
	mux.Handle("GET /static/", http.StripPrefix("/static/",
		http.FileServer(http.Dir("./static"))))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Kabuly server starting on http://localhost:%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

// templateFuncs returns helper functions available in all templates.
func templateFuncs() template.FuncMap {
	return template.FuncMap{
		// Format a float with thousands separator and given decimal places
		"fmtPrice": func(f float64) string {
			if f == 0 {
				return "—"
			}
			return fmt_price(f)
		},
		// Signal to CSS class ("買い" → "buy", "売り" → "sell", else "hold")
		"signalClass": func(sig string) string {
			switch sig {
			case "買い":
				return "buy"
			case "売り":
				return "sell"
			default:
				return "hold"
			}
		},
		// Signal to emoji badge
		"signalEmoji": func(sig string) string {
			switch sig {
			case "買い":
				return "🟢"
			case "売り":
				return "🔴"
			default:
				return "⚪"
			}
		},
		// Repeat a rune n times (used for star ratings)
		"stars": func(n int) string {
			s := ""
			for i := 0; i < 5; i++ {
				if i < n {
					s += "★"
				} else {
					s += "☆"
				}
			}
			return s
		},
		// Add sign prefix to float
		"signedPct": func(f float64) string {
			if f >= 0 {
				return fmt_sign(f)
			}
			return fmt_sign(f)
		},
	}
}

func fmt_price(f float64) string {
	// Simple integer rounding — no external dependency
	i := int64(f + 0.5)
	s := ""
	neg := i < 0
	if neg {
		i = -i
	}
	for i > 0 {
		if len(s) > 0 && len(s)%4 == 3 {
			s = "," + s
		}
		s = string(rune('0'+i%10)) + s
		i /= 10
	}
	if s == "" {
		s = "0"
	}
	if neg {
		s = "-" + s
	}
	return s
}

func fmt_sign(f float64) string {
	if f >= 0 {
		return "+" + fmt_price(f)
	}
	return fmt_price(f)
}
