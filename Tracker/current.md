# Current

## Текущий фокус

Весь запланированный объём закрыт. Ветка `sprint-1-prod-blockers` запушена в `origin`; ожидается ревью/мерж PR в `main`.

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

## Состояние БД и тестов

- Миграции применены к боевой dev-БД до head (`b1c2d3e4f5a6`). Тестовые заявки/остатки/счета удалены (clean slate); НСИ (организации+ИНН, пользователи, статьи ДДС, календарь) сохранены.
- Регрессия Playwright зелёная (≈49 passed / 0 failed / 1–2 skipped), Vitest 39/0. Skip — не-герметичные dataset-условия, не регресс.
- Канонический сид: `python scripts/seed.py` (юзеры пароль `1234`, admin1=superadmin).

## Остаточные риски / открытое (некритично)

- Docker/compose не сделан (есть CI GitHub Actions).
- Часть `any`-типов в renderers; форма/фильтр-бар реестра ещё не вынесены отдельными компонентами.
- Vite dev-сервер иногда падает в долгих сессиях — проверять `:5173` перед e2e.
- `Tracker/handoff.md` повреждён mojibake (исторический).

## Следующий вероятный шаг

Ревью и мерж PR `sprint-1-prod-blockers` → `main`. После мержа — прогнать CI на GitHub.
