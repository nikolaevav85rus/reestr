# Current

## Текущий фокус

Контейнеризация для переносимого Linux-деплоя. Ветка `docker-deploy` от `main`:
`docker compose up` поднимает весь стек (PostgreSQL + backend + scheduler + nginx/SPA),
применяет миграции и проксирует `/api`. Стек собран и проверен на Docker Desktop
(Linux-движок). Ожидается ревью/мерж PR в `main`.

## Последний зафиксированный коммит

- Хвост ветки: `i18n(#21)` каркас + его revert (i18n не нужен).
- Ветка: 33 коммита поверх `main`, запушена в GitHub (`github.com/nikolaevav85rus/reestr`). PR: https://github.com/nikolaevav85rus/reestr/pull/new/sprint-1-prod-blockers

## Что сделано (аудит 09.06.2026 → спринты)

- **Аудит** (многоагентный) — карта проблем, перепроверена.
- **Спринт 1 (блокеры прода):** фикс падавшей миграции RBAC; деньги Float→Numeric(18,2); утечка hashed_password; сильный SECRET_KEY+валидатор; валидация storage_path; шлюз fail-closed.
- **Спринт 2 (целостность workflow):** гарды статусов, row-lock, аудит с автором, GET аудита, блок действий над soft-deleted, фан-аут уведомлений, /history из AuditLog.
- **Спринт 3 (security):** Pydantic-схемы+whitelist (anti-mass-assignment), object-level авторизация (IDOR), session revocation (token_version), user→organizations + оргскоуп остатков + ИНН в карточке орг.
- **Архив уведомлений:** страница «Мои уведомления» (read+unread, пагинация).
- **OCR счетов (evo-ai):** кнопка «Распознать счёт» (автозаполнение + автоподбор орг по ИНН покупателя), устойчивое распознавание; бэктест 165/165.
- **Спринт 4 (гигиена/CI):** GitHub Actions, единый сид + согласованные креды, индексы payment_requests, Vitest, requirements разнесены, flaky-хелпер укреплён.
- **Отложенный долг:** единый `transition()` (#11), scheduler отдельным процессом (#24), code-splitting (#23), декомпозиция PaymentRegistry (#7), a11y (#22). i18n (#21) — каркас сделан и откатан (русскоязычная аудитория).

## Docker-деплой (ветка `docker-deploy`)

- Файлы: `Dockerfile` (backend, python:3.12-slim, non-root, tzdata),
  `docker/backend-entrypoint.sh` (wait DB → `alembic upgrade head` (gated
  `RUN_MIGRATIONS`) → опц. seed (`RUN_SEED`) → exec), `frontend/Dockerfile`
  (node:22 build → nginx:1.27), `frontend/nginx.conf` (SPA + proxy `/api` на
  `backend:8080` через Docker DNS-resolver), `docker-compose.yml`
  (db/backend/scheduler/frontend, healthchecks, volumes db_data/storage_data/app_data),
  `.env.docker.example`, `.dockerignore`(x2), `.gitattributes` (LF + .bat=CRLF),
  `Makefile`. OCR-либы (requirements-ocr.txt) в образ НЕ тянутся.
- Scheduler — отдельный сервис (`RUN_SCHEDULER_IN_APP=false` у backend), без
  задвоения EOD-джоба; миграции применяет только backend.
- **Два реальных Linux/Docker-бага найдены и исправлены:**
  1. `app/core/config.py` — pydantic-settings JSON-парсил `CORS_ORIGINS`/
     `UPLOAD_ALLOWED_*` (list-поля) до валидатора и падал на comma-строке из env;
     добавлены comma-tolerant env/dotenv source-классы (NoDecode нет в 2.2.1).
  2. `requirements.txt` — запинен `bcrypt==4.0.1` (passlib 1.7.4 падает с bcrypt>=4.1
     «password cannot be longer than 72 bytes»; образ ставил 5.0.0).
- Проверка на Docker Desktop: build+up зелёные, db+backend healthy, `/health`→200,
  миграции на head (`b1c2d3e4f5a6`), фронт отдаётся, `/api` проксируется,
  scheduler стартует отдельным процессом, сид + логин `admin1/1234` через прокси→200,
  авторизованный `GET /dict/organizations`→3 орг.
- Playwright API против докер-стека: 15 passed / 1 skipped / **4 failed**. Все 4 —
  `gate-preview.spec.ts`: требуют датированных строк `payment_calendar`, которых
  `seed.py` НЕ создаёт (только WeeklyTemplate+DayTypeRule). Проявляется на ЛЮБОЙ
  чистой БД (вкл. CI) — НЕ дефект контейнеризации. Шлюз fail-closed по дизайну,
  календарь наполняется через UI. Кандидат на доработку сида (вне scope Docker).

## Состояние БД и тестов

- Миграции применены к боевой dev-БД до head (`b1c2d3e4f5a6`). Тестовые заявки/остатки/счета удалены (clean slate); НСИ (организации+ИНН, пользователи, статьи ДДС, календарь) сохранены.
- Регрессия Playwright зелёная (≈49 passed / 0 failed / 1–2 skipped), Vitest 39/0. Skip — не-герметичные dataset-условия, не регресс.
- Канонический сид: `python scripts/seed.py` (юзеры пароль `1234`, admin1=superadmin).

## Остаточные риски / открытое (некритично)

- `seed.py` не создаёт датированных строк `payment_calendar` → на чистой БД 4
  gate-preview API-теста падают (и CI на чистом postgres тоже). Доработать сид
  или сделать отдельный сидер календаря.
- Часть `any`-типов в renderers; форма/фильтр-бар реестра ещё не вынесены отдельными компонентами.
- Vite dev-сервер иногда падает в долгих сессиях — проверять `:5173` перед e2e.
- `Tracker/handoff.md` повреждён mojibake (исторический).

## Следующий вероятный шаг

Ревью и мерж PR `docker-deploy` → `main`. После мержа — прогнать CI на GitHub
(теперь, с фиксами CORS-env и bcrypt-пина, e2e на чистом postgres должны
доходить дальше; останется пробел календаря в gate-preview).
