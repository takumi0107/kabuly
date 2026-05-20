// Chat handler: SSE streaming chat API backed by the Claude Anthropic API.
// The system prompt is built from the stock's latest report and user profile.
package handlers

import (
	"bufio"
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
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

// StockChat handles POST /api/chat/{ticker}.
// Body: { "message": "..." } — streams SSE response chunks.
// Body: { "reset": true }   — clears chat history and returns JSON.
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

		db.AppendChat(database, ticker, "user", body.Message)

		systemPrompt := buildSystemPrompt(*stock, report, profile)

		var messages []chatMsg
		for _, h := range history {
			messages = append(messages, chatMsg{Role: h.Role, Content: h.Content})
		}
		messages = append(messages, chatMsg{Role: "user", Content: body.Message})

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		flusher, _ := w.(http.Flusher)

		reply, err := streamClaude(w, flusher, systemPrompt, messages)
		if err != nil {
			fmt.Fprintf(w, "data: [ERROR] %s\n\n", err.Error())
			if flusher != nil {
				flusher.Flush()
			}
			return
		}

		db.AppendChat(database, ticker, "assistant", reply)
		fmt.Fprintf(w, "data: [DONE]\n\n")
		if flusher != nil {
			flusher.Flush()
		}
	}
}

// streamClaude calls the Anthropic streaming Messages API and relays chunks
// as SSE events. Returns the full assembled response text.
func streamClaude(w io.Writer, flusher http.Flusher,
	system string, messages []chatMsg) (string, error) {

	reqBody := map[string]any{
		"model":      "claude-sonnet-4-6",
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
	req.Header.Set("x-api-key", os.Getenv("ANTHROPIC_API_KEY"))
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("Anthropic API %d: %s", resp.StatusCode, b)
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
			// JSON-encode the chunk so newlines in the text survive SSE's line-based framing.
			encoded, _ := json.Marshal(chunk)
			fmt.Fprintf(w, "data: %s\n\n", encoded)
			if flusher != nil {
				flusher.Flush()
			}
		}
	}
	return full.String(), scanner.Err()
}

// buildSystemPrompt injects stock data, latest report, and user profile so
// Claude has full investment context for every chat turn.
func buildSystemPrompt(stock db.Stock, report *db.DailyReport, profile *db.UserProfile) string {
	if report == nil {
		report = &db.DailyReport{}
	}
	if profile == nil {
		profile = &db.UserProfile{Style: "normal"}
	}
	return fmt.Sprintf(`You are a stock investment assistant. Answer every question about the target stock in Japanese.

## Target stock
- Name: %s (%s) / Market: %s / Category: %s / Acquisition cost: %.0f

## Today's data
- Price: %.0f (%+.1f%%) / RSI: %.1f / MA20: %.0f / MA200: %.0f
- Signal: %s (confidence %d/5) — %s
- Target price: %.0f / Stop-loss: %.0f

## User profile
- Style: %s

## Guidelines
- Explain business, revenue breakdown, and segments with concrete numbers
- Compare with competitors when relevant
- Give specific buy timing and stop-loss levels
- Always explain financial jargon in plain language`,
		stock.Name, stock.Ticker, stock.Market, stock.Category, stock.PurchasePrice,
		report.Price, report.PriceChangePct, report.RSI, report.MA20, report.MA200,
		report.Signal, report.Confidence, report.Reason,
		report.TargetPrice, report.StopLoss,
		profile.Style,
	)
}
