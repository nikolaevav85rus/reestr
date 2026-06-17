# ---------------------------------------------------------------------------
# Linux/Docker convenience targets (mirror of the Windows *.bat helpers).
# Usage: `make <target>`. Requires Docker + Docker Compose v2.
# ---------------------------------------------------------------------------
COMPOSE ?= docker compose

.PHONY: help env build up down restart logs ps health seed migrate \
        backend-shell db-shell pull clean test

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

env: ## Create .env.docker from the template (does not overwrite)
	@test -f .env.docker || cp .env.docker.example .env.docker
	@echo "Edit .env.docker and set a strong SECRET_KEY."

build: ## Build all images
	$(COMPOSE) build

up: ## Start the full stack in the background
	$(COMPOSE) up -d

down: ## Stop the stack (keep volumes/data)
	$(COMPOSE) down

restart: ## Restart all services
	$(COMPOSE) restart

logs: ## Tail logs from all services
	$(COMPOSE) logs -f

ps: ## Show service status
	$(COMPOSE) ps

health: ## Curl the backend health endpoint (host port BACKEND_PORT, default 8081)
	@curl -fsS http://localhost:$${BACKEND_PORT:-8081}/health && echo

seed: ## One-off: seed RBAC + demo NSI + test users (admin1/1234)
	$(COMPOSE) run --rm backend python scripts/seed.py

migrate: ## Apply Alembic migrations against the running DB
	$(COMPOSE) run --rm -e RUN_MIGRATIONS=false backend alembic upgrade head

backend-shell: ## Open a shell in the backend container
	$(COMPOSE) exec backend sh

db-shell: ## Open psql in the db container
	$(COMPOSE) exec db sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

clean: ## Stop the stack AND delete volumes (DESTROYS DB + uploads)
	$(COMPOSE) down -v
