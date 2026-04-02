# Greens Health Slack bot — one-command dev startup
# Whisper (faster-whisper) runs inside the Node process when audio arrives; no STT daemon.

SHELL := /bin/bash
.PHONY: dev help pull ollama-up whisper-check

ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
OLLAMA_URL ?= http://127.0.0.1:11434
OLLAMA_LOG ?= /tmp/ollama-serve.log
OLLAMA_MODEL ?= llama3.2:latest

help:
	@echo "Greens Health AI receptionist — Make targets"
	@echo ""
	@echo "  make dev          Start Ollama if needed, verify optional local Whisper, run npm run dev"
	@echo "  make ollama-up    Only ensure Ollama is listening at $(OLLAMA_URL)"
	@echo "  make pull         ollama pull $(OLLAMA_MODEL)  (override: make pull OLLAMA_MODEL=...)"
	@echo "  make whisper-check  Quick check: FASTER_WHISPER_PYTHON in .env imports faster_whisper"
	@echo ""
	@echo "Prereqs: Node 20+, npm install, .env with Slack tokens. Optional: FASTER_WHISPER_PYTHON,"
	@echo "ffmpeg, files:read on the Slack app for voice clips."
	@echo ""

pull:
	ollama pull "$(OLLAMA_MODEL)"

ollama-up:
	@OLLAMA_URL="$(OLLAMA_URL)" OLLAMA_LOG="$(OLLAMA_LOG)" bash -euo pipefail -c '\
	if curl -sf "$$OLLAMA_URL/api/tags" >/dev/null 2>&1; then \
	  echo "[dev] Ollama already up ($$OLLAMA_URL)"; \
	  exit 0; \
	fi; \
	if ! command -v ollama >/dev/null 2>&1; then \
	  echo "[dev] ERROR: ollama not in PATH. Install from https://ollama.com" >&2; \
	  exit 1; \
	fi; \
	echo "[dev] Starting ollama serve (log: $$OLLAMA_LOG)"; \
	nohup ollama serve >>"$$OLLAMA_LOG" 2>&1 & \
	for i in $$(seq 1 25); do \
	  if curl -sf "$$OLLAMA_URL/api/tags" >/dev/null 2>&1; then \
	    echo "[dev] Ollama ready."; \
	    exit 0; \
	  fi; \
	  sleep 1; \
	done; \
	echo "[dev] ERROR: Ollama did not become ready. See $$OLLAMA_LOG" >&2; \
	exit 1'

# Optional: validates .env path so voice clips fail fast with a clear message
whisper-check:
	@ENV_FILE="$(ROOT)/.env"; \
	if [ ! -f "$$ENV_FILE" ]; then \
	  echo "[dev] No .env — skipping Whisper check."; \
	  exit 0; \
	fi; \
	PY=$$(grep -E '^[[:space:]]*FASTER_WHISPER_PYTHON=' "$$ENV_FILE" | tail -1 | sed -E 's/^[[:space:]]*FASTER_WHISPER_PYTHON=//; s/^[\"'\'']//; s/[\"'\'']$$//'); \
	if [ -z "$$PY" ]; then \
	  echo "[dev] Voice: FASTER_WHISPER_PYTHON unset — audio will use WHISPER_API_KEY or a setup hint in Slack."; \
	  exit 0; \
	fi; \
	if [ ! -x "$$PY" ]; then \
	  echo "[dev] WARNING: FASTER_WHISPER_PYTHON is not executable: $$PY" >&2; \
	  exit 0; \
	fi; \
	if "$$PY" -c "import faster_whisper" 2>/dev/null; then \
	  echo "[dev] Local Whisper OK ($$PY)"; \
	else \
	  echo "[dev] WARNING: faster_whisper import failed for $$PY (pip install faster-whisper in that venv?)" >&2; \
	fi

dev: ollama-up whisper-check
	@echo "[dev] Starting Slack bot: npm run dev (root: $(ROOT))"
	@cd "$(ROOT)" && npm run dev
