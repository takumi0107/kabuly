package handlers

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

// ─────────────────────────────────────────────────────────
// Session helpers (HMAC-signed cookie, no external JWT lib)
// ─────────────────────────────────────────────────────────

const sessionCookieName = "kabuly_session"

type sessionKey struct{}

// SessionData is the payload stored in the session cookie.
type SessionData struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	GoogleID string `json:"gid"`
	Exp      int64  `json:"exp"`
}

func sessionSecret() []byte {
	if s := os.Getenv("SESSION_SECRET"); s != "" {
		return []byte(s)
	}
	return []byte("kabuly-dev-secret-change-in-production")
}

func signSession(d SessionData) string {
	b, _ := json.Marshal(d)
	payload := base64.RawURLEncoding.EncodeToString(b)
	mac := hmac.New(sha256.New, sessionSecret())
	mac.Write([]byte(payload))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return payload + "." + sig
}

func parseSession(token string) (*SessionData, bool) {
	i := strings.LastIndex(token, ".")
	if i < 0 {
		return nil, false
	}
	payload, sig := token[:i], token[i+1:]

	mac := hmac.New(sha256.New, sessionSecret())
	mac.Write([]byte(payload))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(sig), []byte(expected)) {
		return nil, false
	}

	b, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return nil, false
	}
	var d SessionData
	if err := json.Unmarshal(b, &d); err != nil {
		return nil, false
	}
	if time.Now().Unix() > d.Exp {
		return nil, false
	}
	return &d, true
}

func setSessionCookie(w http.ResponseWriter, d SessionData) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    signSession(d),
		Path:     "/",
		MaxAge:   30 * 24 * 3600,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func SessionFromContext(ctx context.Context) *SessionData {
	d, _ := ctx.Value(sessionKey{}).(*SessionData)
	return d
}

// ─────────────────────────────────────────────────────────
// OAuth2 config
// ─────────────────────────────────────────────────────────

func oauthConf() *oauth2.Config {
	redirectURL := os.Getenv("GOOGLE_REDIRECT_URL")
	if redirectURL == "" {
		redirectURL = "http://localhost:8080/auth/callback"
	}
	return &oauth2.Config{
		ClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		RedirectURL:  redirectURL,
		Scopes:       []string{"openid", "email", "profile"},
		Endpoint:     google.Endpoint,
	}
}

// ─────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────

// GoogleLogin redirects to Google's OAuth2 consent screen.
func GoogleLogin() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cfg := oauthConf()
		if cfg.ClientID == "" {
			http.Error(w, "GOOGLE_CLIENT_ID not set", http.StatusServiceUnavailable)
			return
		}
		url := cfg.AuthCodeURL("state", oauth2.AccessTypeOnline)
		http.Redirect(w, r, url, http.StatusTemporaryRedirect)
	}
}

// GoogleCallback handles the redirect from Google after login.
func GoogleCallback() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cfg := oauthConf()
		code := r.URL.Query().Get("code")
		if code == "" {
			http.Error(w, "missing code", http.StatusBadRequest)
			return
		}

		tok, err := cfg.Exchange(r.Context(), code)
		if err != nil {
			http.Error(w, "token exchange failed", http.StatusInternalServerError)
			return
		}

		resp, err := cfg.Client(r.Context(), tok).Get("https://www.googleapis.com/oauth2/v2/userinfo")
		if err != nil {
			http.Error(w, "userinfo fetch failed", http.StatusInternalServerError)
			return
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)

		var info struct {
			ID    string `json:"id"`
			Email string `json:"email"`
			Name  string `json:"name"`
		}
		if err := json.Unmarshal(body, &info); err != nil {
			http.Error(w, "userinfo parse failed", http.StatusInternalServerError)
			return
		}

		if allowed := os.Getenv("ALLOWED_EMAIL"); allowed != "" && info.Email != allowed {
			http.Error(w, "このアプリはプライベートです / access denied", http.StatusForbidden)
			return
		}

		setSessionCookie(w, SessionData{
			Email:    info.Email,
			Name:     info.Name,
			GoogleID: info.ID,
			Exp:      time.Now().Add(30 * 24 * time.Hour).Unix(),
		})
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
	}
}

// AuthMe returns the current user's email and name, or 401.
// When GOOGLE_CLIENT_ID is not set (auth disabled), returns an empty guest response.
// NOTE: this handler is NOT wrapped by RequireAuth, so it reads the cookie directly.
func AuthMe() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if os.Getenv("GOOGLE_CLIENT_ID") == "" {
			writeJSON(w, 200, map[string]string{"email": "", "name": ""})
			return
		}
		cookie, err := r.Cookie(sessionCookieName)
		if err != nil {
			writeError(w, 401, "not authenticated")
			return
		}
		d, ok := parseSession(cookie.Value)
		if !ok {
			writeError(w, 401, "session expired")
			return
		}
		writeJSON(w, 200, map[string]string{"email": d.Email, "name": d.Name})
	}
}

// Logout clears the session cookie and redirects to /login.
func Logout() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		http.SetCookie(w, &http.Cookie{
			Name:   sessionCookieName,
			Value:  "",
			Path:   "/",
			MaxAge: -1,
		})
		http.Redirect(w, r, "/login", http.StatusSeeOther)
	}
}

// ─────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────

// RequireAuth wraps an API handler to enforce session authentication.
// When GOOGLE_CLIENT_ID is not set, auth is skipped entirely.
func RequireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if os.Getenv("GOOGLE_CLIENT_ID") == "" {
			next(w, r)
			return
		}
		cookie, err := r.Cookie(sessionCookieName)
		if err != nil {
			writeError(w, 401, "not authenticated")
			return
		}
		d, ok := parseSession(cookie.Value)
		if !ok {
			writeError(w, 401, "session expired")
			return
		}
		ctx := context.WithValue(r.Context(), sessionKey{}, d)
		next(w, r.WithContext(ctx))
	}
}
