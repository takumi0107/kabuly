// Dashboard handler: renders the main index page showing holdings,
// watchlist, and today's educational insight.
package handlers

import (
	"database/sql"
	"html/template"
	"net/http"

	"github.com/kabuly/kabuly/db"
)

// dashboardData is passed to the index.html template.
type dashboardData struct {
	Holdings  []stockWithReport
	Watchlist []stockWithReport
	Insight   *db.DailyInsight
	Profile   *db.UserProfile
}

// stockWithReport pairs a stock master record with its latest report.
type stockWithReport struct {
	Stock  db.Stock
	Report *db.DailyReport
}

// Dashboard serves GET / and renders the main dashboard page.
func Dashboard(database *sql.DB, tmpl *template.Template) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}

		stocks, err := db.GetAllStocks(database)
		if err != nil {
			http.Error(w, err.Error(), 500)
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

		insight, _ := db.GetLatestInsight(database)
		profile, _ := db.GetProfile(database)

		data := dashboardData{
			Holdings:  holdings,
			Watchlist: watchlist,
			Insight:   insight,
			Profile:   profile,
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := tmpl.ExecuteTemplate(w, "index.html", data); err != nil {
			http.Error(w, err.Error(), 500)
		}
	}
}
