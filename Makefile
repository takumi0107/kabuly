.PHONY: install dev build pipeline import-jpx

# ── Install all dependencies ────────────────────────────────────────────────
install:
	@echo "→ Installing Go dependencies..."
	cd server && go mod download
	@echo "→ Installing frontend dependencies..."
	cd frontend && npm install
	@echo "→ Installing pipeline dependencies (uv)..."
	cd pipeline && uv sync
	@echo "→ Initializing database..."
	cd pipeline && uv run python main.py init-db
	@echo "→ Importing JPX stock listing..."
	cd pipeline && uv run python import_jpx.py
	@echo "✓ Done. Copy .env.example to .env and fill in your keys."

# ── Development mode: Go API server + Vite dev server ───────────────────────
# Browse http://localhost:5173 — Vite proxies /api to the Go server on :8080.
dev:
	@echo "→ Starting Go API server on :8080 and Vite dev server on :5173..."
	@trap 'kill 0' INT; \
	  (cd server && go run .) & \
	  (cd frontend && npm run dev) & \
	  wait

# ── One-off frontend build ───────────────────────────────────────────────────
build:
	@echo "→ Building frontend..."
	cd frontend && npm run build

# ── Run the analysis pipeline once (manual trigger) ────────────────────────
pipeline:
	cd pipeline && uv run python main.py run --no-notify

# ── Refresh JPX stock master from TSE listing file ──────────────────────────
import-jpx:
	cd pipeline && uv run python import_jpx.py
