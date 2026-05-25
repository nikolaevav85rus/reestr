# Backlog

Статусы: `TODO`, `IN PROGRESS`, `REVIEW`, `DONE`, `BLOCKED`.

Последнее обновление: `2026-05-19`.

## P0 — Regression Safety

### Production readiness: быстрые backend-риски

- Status: `DONE`
- Owner: `Backend / workflow`
- Source: `documentation/code-review-remarks.md`, пункты 1, 2, 6, 14, 19.
- Goal: закрыть быстрые прод-риски без большого auth/refactor-проекта.
- Acceptance:
  - CORS управляется настройками и не использует `*` в production;
  - SQL echo управляется настройкой окружения и выключается вне dev;
  - backend logging имеет понятный базовый конфиг;
  - загрузка файлов проверяет расширение, MIME/content type и размер;
  - блокирующий file I/O в async endpoints убран или вынесен в threadpool;
  - `SUBMIT_CUTOFF_HOUR` и timezone-настройки вынесены в config.
- Verification:
  - `python -m compileall app`;
  - backend smoke auth/health;
  - regression upload/request tests.
- Done:
  - CORS вынесен в настройки, wildcard `*` убран из runtime-настроек;
  - SQL echo вынесен в настройки и выключен в обычном runtime;
  - добавлен базовый backend logging config;
  - upload проверяет расширение, MIME/content type и размер;
  - file write/delete в upload вынесены из event loop через threadpool;
  - `SUBMIT_CUTOFF_HOUR` и `APP_TIMEZONE` вынесены в config;
  - добавлен `.env.example` с CORS, SQL/logging, upload и gate/time settings;
  - upload regression, file-replace smoke и gate regression зелёные.
- Remaining:
  - нет в рамках этого quick-risk блока.
- Evidence:
  - upload smoke: `passed=7, failed=0`;
  - UI upload regression: `1 passed`;
  - gate-preview regression после config-вынесения: `6 passed`;
  - full regression после gate config: `46 passed`, `2 skipped`, `0 failed`.

### Production readiness: транзакции workflow

- Status: `DONE`
- Owner: `Backend / workflow`
- Source: `documentation/code-review-remarks.md`, пункт 3.
- Goal: убрать двойные commit'ы в workflow-действиях, где изменение заявки и уведомления/история должны быть согласованы.
- Acceptance:
  - workflow-действия заявки используют единый транзакционный подход;
  - уведомления/история не оставляют заявку в частично обновленном состоянии;
  - существующие статусы и ответы API не меняются без необходимости.
- Verification:
  - API workflow regression;
  - Playwright workflow regression.
- Result:
  - `reject_gate`, `suspend`, `reject_memo` переведены на single-commit pattern;
  - status/reason/history для этих переходов подтверждены API smoke;
  - контракт API и пользовательские тексты не менялись.
- Evidence:
  - `reject_gate` smoke: статус `REJECTED` + history `GATE_REJECTED`;
  - `suspend` smoke: статус `SUSPENDED` + history `SUSPENDED`;
  - `reject_memo` smoke: статус `REJECTED` + history с причиной;
  - full regression после последнего шага: `32 passed`, `2 skipped`, `0 failed`.

### Production readiness: auth/session policy

- Status: `IN PROGRESS`
- Owner: `Backend / workflow` + `Frontend / UX`
- Source: `documentation/code-review-remarks.md`, пункты 4, 5, 15.
- Goal: спроектировать и внедрить безопасную политику сессий без рывка в большой rewrite.
- Acceptance:
  - выбран целевой вариант хранения токена/session;
  - устранено дублирование источников токена на frontend;
  - определена политика refresh/expiration/logout;
  - изменение роли пользователя не оставляет старые права активными надолго.
- Done:
  - проведена backend-инвентаризация auth/session contract;
  - `GET /api/v1/users/` закрыт правом `user_view`;
  - `hashed_password` убран из ответа списка пользователей;
  - `/organizations` перестал падать при `403` от `/users/`;
  - в `get_current_user` добавлена проверка `is_active`;
  - Login UX исправлен: стабильная ошибка, повторная попытка, защита от отката username после failed login.
- Remaining:
  - принять решение по долгосрочной session policy: текущий localStorage JWT или переход на httpOnly cookie + CSRF;
  - устранить дублирование источников токена на frontend;
  - определить TTL/refresh/logout/revocation strategy;
  - решить, как быстро инвалидировать старые права при изменении роли пользователя.
- Evidence:
  - users security regression: green;
  - auth security regression: green;
  - login UX regression: green;
  - full regression после Login UX fix: `46 passed`, `2 skipped`, `0 failed`.

### Maintainability: frontend decomposition and shared types

- Status: `IN PROGRESS`
- Owner: `Frontend / UX`
- Source: `documentation/code-review-remarks.md`, пункты 7, 8, 9, 10, 13, 20.
- Goal: снизить стоимость поддержки больших экранов после стабилизации P0.
- Acceptance:
  - выбран порядок декомпозиции `PaymentRegistry` и `CashierWorkspace`;
  - общие константы вынесены без изменения поведения;
  - определен подход к типам API на frontend;
  - React Query либо внедряется постепенно, либо удаляется из зависимостей как неиспользуемый.
- Done:
  - общие request status/label/color constants вынесены в `frontend/src/requestStatus.ts`;
  - helper'ы настроек колонок вынесены в `frontend/src/utils/columnSettings.ts`;
  - `CashierWorkspace.tsx` локально типизирован по безопасным state/API моделям;
  - `PaymentRegistry.tsx` локально типизирован по базовым state/API моделям без grouped rows;
  - `PaymentRegistry.tsx` типизирован по grouped rows через discriminated union;
  - `RequestDetailsCard.tsx` типизирован в безопасном no-behavior-change scope;
  - добавлен общий `frontend/src/utils/errorMessage.ts`;
  - `catch (e: any)` заменён на `unknown` + `getErrorMessage(...)` в `AccountBalancesPanel`, `Organizations`, `SettingsPage`, `CalendarPage`, `Users` и `PaymentRegistry`;
  - неиспользуемая зависимость `@tanstack/react-query` удалена из frontend;
  - AntD deprecation warnings (`Drawer`, `Space`, `columns.render`, `Alert`) устранены безопасным no-behavior-change patch;
  - warning `useForm is not connected to any Form element` устранён в `PaymentRegistry`, `AccountBalancesPanel` и `Organizations`;
  - каждый шаг подтвержден targeted UI tests и full regression без новых падений.
- Remaining:
  - решить, останавливаем frontend maintainability batch и коммитим, или делаем отдельный inventory для optional `key -> WorkflowAction` factory extract.
- Evidence:
  - status constants extract: full regression `46 passed`, `2 skipped`, `0 failed`;
  - column settings extract: full regression `46 passed`, `2 skipped`, `0 failed`;
  - `CashierWorkspace.tsx` local typing: full regression `46 passed`, `2 skipped`, `0 failed`;
  - `PaymentRegistry.tsx` basic local typing: full regression `46 passed`, `2 skipped`, `0 failed`.
  - `PaymentRegistry.tsx` grouped rows typing: full regression `46 passed`, `2 skipped`, `0 failed`.
  - AntD deprecation cleanup: full regression `46 passed`, `2 skipped`, `0 failed`; fresh frontend stderr stayed empty.
  - `useForm` warning cleanup: full regression `46 passed`, `2 skipped`, `0 failed`; no new warning lines in current run.
  - `RequestDetailsCard` typing: build green, `workflow.spec.ts` `6 passed` / `1 skipped`, `users-security.spec.ts` `1 passed`.
  - catch(any) cleanup: targeted build/UI checks green for each scoped file; `frontend/src` no longer has `catch (e: any)` or direct `e.response?.data?.detail`.
  - React Query dependency removal: build green, `users-security.spec.ts` `1 passed`.
  - `PaymentRegistry` decomposition inventory completed; recommended first extract is pure view-model helpers.
  - `PaymentRegistry` pure view-model helpers extracted to `paymentRegistryViewModel.ts`; build green, `workflow.spec.ts` `6 passed` / `1 skipped`, `balances-panel.spec.ts` `6 passed`.
  - regression gate after maintainability batch: `47 passed`, `1 skipped`, `0 failed`.
  - `PaymentRegistry` grouped rows builder extracted to `paymentRegistryGrouping.ts`; build green, `workflow.spec.ts` `6 passed` / `1 skipped`, `balances-panel.spec.ts` `6 passed`.
  - regression gate after `PaymentRegistry` view-model + grouping extracts: final run `46 passed`, `2 skipped`, `0 failed`; two earlier full runs had dropdown/select flaky failures that passed on rerun.
  - AntD Select UI-test stabilization: targeted `balances-panel` `6 passed`, `organizations-accounts` `8 passed`; full regression `47 passed`, `1 skipped`, `0 failed`.
  - `PaymentRegistry` action composition inventory completed; recommended next extract is pure decision helper only.
  - `PaymentRegistry` action decision layer extracted to `paymentRegistryActions.ts`; build green, `workflow.spec.ts` `6 passed` / `1 skipped`, `balances-panel.spec.ts` `6 passed`, full regression `46 passed`, `2 skipped`, `0 failed`.

### Maintainability: PaymentRegistry grouped rows typing

- Status: `DONE`
- Owner: `Frontend / UX`
- Source: `documentation/code-review-remarks.md`, пункт 8 + frontend `any` inventory.
- Goal: типизировать grouped rows в `PaymentRegistry` отдельным безопасным шагом.
- Context:
  - базовые state/API модели `PaymentRegistry.tsx` уже типизированы;
  - grouped rows оставлены как следующий isolated patch из-за повышенного риска.
- Acceptance:
  - введен discriminated union для строк `request`, `org`, `dircat`, `category`;
  - `isGroupRow`, grouped data builder и безопасные renderers используют этот union;
  - workflow/action logic, column settings и Excel export не меняются;
  - build и targeted regression зелёные.
- Notes:
  - не объединять с декомпозицией таблицы или UX-изменениями.
- Result:
  - введён discriminated union для grouped rows;
  - типизированы grouped builder, `isGroupRow`, group keys, row key и безопасные renderers;
  - grouped mode, month/day tabs, expand/collapse и balances рядом с registry подтверждены regression.
- Evidence:
  - full regression после grouped rows typing: `46 passed`, `2 skipped`, `0 failed`.

### Maintainability: AntD deprecation warnings

- Status: `DONE`
- Owner: `Frontend / UX`
- Source: frontend stderr после regression-прогонов.
- Goal: убрать шум AntD deprecation warnings, чтобы реальные runtime-проблемы были заметнее.
- Known warnings:
  - `Space direction`;
  - `Drawer width`;
  - `columns.render return cell props`.
- Acceptance:
  - проведена inventory warning sources;
  - исправлены только безопасные deprecation-паттерны без изменения UI;
  - frontend stderr после targeted smoke не содержит этих warning'ов или они явно классифицированы как external/remaining;
  - full regression green по падениям.
- Result:
  - `Drawer width` заменён на актуальный API;
  - `Space direction` заменён на актуальный API;
  - `columns.render return cell props` перенесён на `onCell`;
  - `Alert message` заменён на актуальный API;
  - свежий `logs/frontend-live-20260514-153536.err.log` после targeted/full regression пустой.
- Evidence:
  - full regression после cleanup: `46 passed`, `2 skipped`, `0 failed`.

### Maintainability: useForm warning inventory/fix

- Status: `DONE`
- Owner: `Frontend / UX`
- Source: fresh frontend stderr after grouped rows regression.
- Goal: разобраться с warning `useForm is not connected to any Form element` и убрать его, если это безопасный no-behavior-change fix.
- Context:
  - warning не относится к закрытому AntD deprecation-набору;
  - warning не влияет на текущий regression pass/fail;
  - нужен отдельный inventory, чтобы не чинить вслепую.
- Acceptance:
  - найден источник warning;
  - если source в нашем коде и fix безопасен, form instance подключён к нужному `<Form form={...}>` или создание form instance перенесено;
  - если source связан с условным modal render/AntD internals, риск описан и warning классифицирован;
  - targeted UI и full regression зелёные.
- Notes:
  - не менять UX форм и модалок в этом шаге.
- Result:
  - `PaymentRegistry` и `AccountBalancesPanel` безопасно закрыты через `forceRender` при сохранении `destroyOnHidden`;
  - `Organizations` bank account modal закрыт без `forceRender`: pre-open `setFieldsValue` заменён на `initialValues` + `key`;
  - nested modal click interception не воспроизвелся.
- Evidence:
  - `organizations-accounts.spec.ts` -> `8 passed`;
  - `balances-panel.spec.ts` -> `6 passed`;
  - `workflow.spec.ts` -> `6 passed`, `1 skipped`;
  - full regression after `Organizations` fix -> `46 passed`, `2 skipped`, `0 failed`;
  - fresh-run stderr baseline did not grow, no new `useForm` warning lines.

### DevOps baseline

- Status: `IN PROGRESS`
- Owner: `Backend / workflow` + `Tests / regression`
- Source: `documentation/code-review-remarks.md`, пункты 16, 17, 18.
- Goal: сделать запуск и проверку проекта воспроизводимее.
- Acceptance:
  - добавлен `.env.example`;
  - определен минимальный CI для build/regression;
  - Docker/docker-compose вынесены в отдельное решение, если подтвердится необходимость.
- Done:
  - добавлен `.env.example` с безопасными dev-примерами и актуальными backend settings.
- Remaining:
  - синхронизировать README с `.env.example` и текущим запуском;
  - определить минимальный CI для build/regression;
  - решить, нужен ли Docker/docker-compose на текущем этапе.

### UI upload через сетевой адрес

- Status: `DONE`
- Owner: `Tests / regression`
- Result: добавлен regression-тест на создание заявки с PDF и проверку, что upload идет через origin текущей UI-страницы.
- Evidence:
  - UI upload regression подтверждает относительный `/api/v1/requests/{id}/upload`;
  - hardcoded `localhost:8080` / `127.0.0.1:8080` в browser upload request не используется;
  - full regression после upload validation: green по падениям.

### Проверка workflow после последних изменений

- Status: `DONE`
- Owner: `Tests / regression`
- Acceptance:
  - создание заявки;
  - отправка;
  - согласование;
  - исключение;
  - вне бюджета;
  - отложить/перенести;
  - оплата;
  - история.
- Evidence:
  - workflow transaction smoke прошёл для `reject_gate`, `suspend`, `reject_memo`;
  - full regression после workflow/security/login цепочки: green по падениям;
  - текущие skips классифицированы как dataset-dependent.

## P1 — UX Workflow

### Карточка заявки

- Status: `TODO`
- Owner: `Frontend / UX`
- Acceptance:
  - горизонтальное представление без лишней прокрутки;
  - история вынесена на отдельную вкладку;
  - файл счета виден и открывается из карточки;
  - доступные действия видны по роли;
  - шрифт и плотность согласованы с реестром.

### Реестры и рабочее место казначея

- Status: `TODO`
- Owner: `Frontend / UX`
- Acceptance:
  - таблицы читаемые на 1366 px;
  - sticky-заголовки при прокрутке;
  - фильтры скрываются переключателем;
  - настройки колонок сохраняются по пользователю;
  - колонка файла счета доступна в рабочем месте казначея.

## P1.6 — Dev Run And Logs

- Status: `TODO`
- Owner: `Backend / workflow` + `Frontend / UX`
- Acceptance:
  - один удобный запуск проекта для отладки;
  - frontend/backend логи разделены и подписаны;
  - SQL echo управляется настройкой;
  - README описывает запуск, логи и типовые проблемы;
  - reverse proxy `/api/v1` описан для network/production-режима.

## P1.7 — Daily Account Balances

- Status: `DONE`
- Owner: `Head` -> `Backend / workflow` + `Frontend / UX`
- Summary: ежедневный ввод остатков на утро по организации и расчетному счету.
- Business:
  - казначей вводит остатки каждый день;
  - разрез данных: дата, организация, расчетный счет, остаток на утро;
  - остатки видны в реестре платежей и рабочем месте казначея;
  - блок остатков можно свернуть, чтобы он не мешал просмотру реестра.
- Permissions:
  - отдельное право просмотра остатков;
  - отдельное право управления остатками для ввода/правки.
- Acceptance:
  - backend хранит справочник расчетных счетов и ежедневные остатки;
  - для одной даты и одного расчетного счета может быть только один остаток;
  - `CASHIER` получает управление и просмотр остатков по умолчанию;
  - `FEO` получает просмотр остатков по умолчанию;
  - UI скрывает блок при отсутствии права просмотра;
  - UI позволяет свернуть/развернуть блок в обоих реестрах;
  - ввод остатков доступен только при праве управления;
  - ежедневные остатки можно редактировать и удалять при праве управления;
  - таблица остатков сгруппирована по организациям;
  - организации в таблице остатков свернуты по умолчанию и раскрываются пользователем;
  - по каждой организации показан итог остатков;
  - в реестре и рабочем месте казначея показан профицит/дефицит по выбранному дню;
  - удаление расчетного счета доступно только при общем праве `dict_delete`;
  - счет с остатками не удаляется, пользователь получает подсказку отключить счет;
  - в реестре платежей остатки привязаны к фильтрам даты и организации;
  - в режиме `По дням` остатки привязаны к выбранному дню;
  - автотесты/проверки покрывают права, создание/обновление и отображение.
- Result:
  - backend API, RBAC, migration и seed добавлены;
  - frontend блок `Остатки на утро` добавлен в `/dashboard` и `/cashier`;
  - управление расчетными счетами перенесено из блока остатков в НСИ организаций;
  - добавлены редактирование и удаление ежедневных остатков;
  - таблица остатков растянута по ширине, сгруппирована по организациям и по умолчанию свернута до групп;
  - в группах организаций показываются итоги остатков и профицит/дефицит по выбранному дню;
  - добавлено удаление расчетных счетов через `dict_delete` с защитой счетов, по которым есть остатки;
  - блок остатков в `/dashboard` привязан к фильтрам даты/организации и выбранному дню в day-mode;
  - API и UI regression покрывают права, upsert, CRUD ежедневных остатков, отображение, удаление счетов, группировку и привязки фильтров;
  - UI-падения классифицированы как stale-runtime/test/invocation issues и исправлены или защищены preflight guard.
- Evidence:
  - `cd frontend && npm exec playwright test tests/ui/balances-panel.spec.ts` -> 5 passed / 1 skipped;
  - `cd frontend && npm exec playwright test tests/ui/organizations-accounts.spec.ts` -> 8 passed / 0 failed;
  - `npm run test:regression` -> 33 passed / 1 skipped.

## P2 — OCR

### Черновик из счета

- Status: `TODO`
- Owner: `Backend / workflow` + `Frontend / UX`
- Acceptance:
  - OCR предлагает поля-кандидаты, а не создает заявку вслепую;
  - пользователь подтверждает значения перед сохранением;
  - есть confidence/подсветка сомнительных полей.
