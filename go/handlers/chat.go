// Chat handler: serves the per-stock chat page and the SSE streaming chat API.
// Claude is called via the Anthropic API with a system prompt built from
// the stock's latest report and the user's investment profile.
package handlers

import (
	"bufio"
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/kabuly/kabuly/db"
)

// chatMsg is one message turn sent to the Claude API.
type chatMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// stockPageData is passed to stock.html.
type stockPageData struct {
	Stock   db.Stock
	Report  *db.DailyReport
	History []db.ChatMessage
	Profile *db.UserProfile
}

// StockPage serves GET /stock/{ticker} — the detail + chat page.
func StockPage(database *sql.DB, tmpl *template.Template) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ticker := strings.ToUpper(r.PathValue("ticker"))

		stock, err := db.GetStock(database, ticker)
		if err != nil || stock == nil {
			http.NotFound(w, r)
			return
		}

		report, _ := db.GetLatestReport(database, ticker)
		history, _ := db.GetChatHistory(database, ticker, 50)
		profile, _ := db.GetProfile(database)

		data := stockPageData{
			Stock:   *stock,
			Report:  report,
			History: history,
			Profile: profile,
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := tmpl.ExecuteTemplate(w, "stock.html", data); err != nil {
			http.Error(w, err.Error(), 500)
		}
	}
}

// ─────────────────────────────────────────────────────────
// POST /api/chat/{ticker}   — SSE streaming chat endpoint
// ─────────────────────────────────────────────────────────

// StockChat handles the streaming chat API.
// It saves the user message, sends the full conversation to Claude via
// the streaming Messages API, relays chunks as SSE events, then saves
// the assembled assistant reply.
func StockChat(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ticker := strings.ToUpper(r.PathValue("ticker"))

		var body struct {
			Message string `json:"message"`
			Reset   bool   `json:"reset"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(w, 400, "invalid JSON")
			return
		}

		// Handle history reset
		if body.Reset {
			db.ClearChatHistory(database, ticker)
			writeJSON(w, 200, map[string]string{"status": "cleared"})
			return
		}

		if body.Message == "" {
			writeError(w, 400, "message is required")
			return
		}

		stock, _ := db.GetStock(database, ticker)
		if stock == nil {
			writeError(w, 404, "stock not found")
			return
		}
		report, _ := db.GetLatestReport(database, ticker)
		profile, _ := db.GetProfile(database)
		history, _ := db.GetChatHistory(database, ticker, 20)

		// Save user message
		db.AppendChat(database, ticker, "user", body.Message)

		// Build system prompt
		systemPrompt := buildSystemPrompt(*stock, report, profile)

		// Build messages array from history + new user message
		var messages []chatMsg
		for _, h := range history {
			messages = append(messages, chatMsg{Role: h.Role, Content: h.Content})
		}
		messages = append(messages, chatMsg{Role: "user", Content: body.Message})

		// Set SSE headers
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		flusher, _ := w.(http.Flusher)

		// Call Anthropic streaming API
		reply, err := streamClaude(w, flusher, systemPrompt, messages)
		if err != nil {
			fmt.Fprintf(w, "data: [ERROR] %s\n\n", err.Error())
			if flusher != nil {
				flusher.Flush()
			}
			return
		}

		// Save assistant reply
		db.AppendChat(database, ticker, "assistant", reply)

		// Signal stream end
		fmt.Fprintf(w, "data: [DONE]\n\n")
		if flusher != nil {
			flusher.Flush()
		}
	}
}

// streamClaude calls the Anthropic Messages API with stream=true,
// writes SSE events to w, and returns the assembled full text.
func streamClaude(w io.Writer, flusher http.Flusher,
	system string, messages []chatMsg) (string, error) {

	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	model := "claude-sonnet-4-20250514"

	reqBody := map[string]any{
		"model":      model,
		"max_tokens": 1500,
		"system":     system,
		"stream":     true,
		"messages":   messages,
	}
	bodyBytes, _ := json.Marshal(reqBody)

	req, err := http.NewRequest("POST",
		"https://api.anthropic.com/v1/messages",
		bytes.NewReader(bodyBytes))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("Anthropic API error %d: %s", resp.StatusCode, string(b))
	}

	var full strings.Builder
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		var event struct {
			Type  string `json:"type"`
			Delta struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"delta"`
		}
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			continue
		}
		if event.Type == "content_block_delta" && event.Delta.Type == "text_delta" {
			chunk := event.Delta.Text
			full.WriteString(chunk)
			fmt.Fprintf(w, "data: %s\n\n", chunk)
			if flusher != nil {
				flusher.Flush()
			}
		}
	}

	return full.String(), scanner.Err()
}

// buildSystemPrompt injects stock data, latest report, and profile into the
// Claude system prompt so every chat message has full investment context.
func buildSystemPrompt(stock db.Stock, report *db.DailyReport, profile *db.UserProfile) string {
	if report == nil {
		report = &db.DailyReport{}
	}
	if profile == nil {
		profile = &db.UserProfile{TotalFunds: 500000, MaxPositionPct: 20, Style: "normal"}
	}

	return fmt.Sprintf(`You are a stock investment assistant. Answer every question about the target stock in Japanese.

## Target stock
- Name: %s (%s)
- Market: %s / Category: %s
- Acquisition cost: %.0f

## Today's data
- Price: %.0f (%+.1f%%)
- RSI: %.1f / MA20: %.0f / MA200: %.0f
- Signal: %s (confidence %d/5)
- Reason: %s
- Recommended buy: %.0f (%d shares)

## User profile
- Total funds: %.0f / Style: %s / Max per position: %.0f%%

## Answer guidelines
- Explain business overview, revenue breakdown, and segment details concretely
- Use specific numbers ("real estate is ~0%% of revenue", "segment X is ~40%% of sales")
- Compare with competitors when relevant
- Give concrete buy timing and stop-loss levels
- Always explain financial jargon in plain language`,
		stock.Name, stock.Ticker,
		stock.Market, stock.Category,
		stock.PurchasePrice,
		report.Price, report.PriceChangePct,
		report.RSI, report.MA20, report.MA200,
		report.Signal, report.Confidence, report.Reason,
		report.RecommendedAmount, report.RecommendedShares,
		profile.TotalFunds, profile.Style, profile.MaxPositionPct,
	)
}
