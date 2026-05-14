// Profile handler: renders and processes the investment profile settings page.
package handlers

import (
	"database/sql"
	"html/template"
	"net/http"

	"github.com/kabuly/kabuly/db"
)

// ProfilePage serves GET /profile — the investment profile settings page.
func ProfilePage(database *sql.DB, tmpl *template.Template) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		profile, err := db.GetProfile(database)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := tmpl.ExecuteTemplate(w, "profile.html", profile); err != nil {
			http.Error(w, err.Error(), 500)
		}
	}
}
