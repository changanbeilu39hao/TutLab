.PHONY: dev down seed

dev:
	corepack pnpm supabase start
	corepack pnpm supabase db reset
	docker compose up

down:
	docker compose down
	corepack pnpm supabase stop

seed:
	corepack pnpm supabase db reset
