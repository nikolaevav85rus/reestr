# Казначейство Метком

Веб-приложение для ведения реестра платежных заявок: создание заявок, согласование, исключения из регламента, внебюджетные платежи, оплата, рабочее пространство казначея, история и уведомления.

## Состав проекта

- `app/` — backend на FastAPI.
- `frontend/` — frontend на React, Vite и Ant Design.
- `alembic/` — миграции базы данных.
- `scripts/` — служебные seed/test-скрипты.
- `documentation/` — рабочая документация проекта.
- `start_backend.bat` — запуск backend на Windows.
- `start_all.bat` — совместный запуск frontend и backend.

## Требования

- Windows.
- Python 3.11+.
- Node.js 22+.
- PostgreSQL.
- Доступная база данных, указанная в `.env`.

## Первичная настройка

### 1. Установить Python-зависимости

```powershell
cd C:\MyPyProjects\reestr
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Установить Node-зависимости

В проекте есть зависимости корня и frontend-зависимости.

```powershell
cd C:\MyPyProjects\reestr
npm install
npm --prefix frontend install
```

### 3. Создать `.env`

Файл `.env` должен лежать в корне проекта: `C:\MyPyProjects\reestr\.env`.

Пример:

```env
PROJECT_NAME=reestr
DATABASE_URL=postgresql+asyncpg://postgres:password@127.0.0.1:5432/reestr
SECRET_KEY=change-me
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440
```

`DATABASE_URL` должен использовать async-драйвер `postgresql+asyncpg`.

### 4. Применить миграции

```powershell
cd C:\MyPyProjects\reestr
venv\Scripts\activate
alembic upgrade head
```

## Заполнение пустой базы

Если база новая и в ней нет ролей, прав, пользователей и НСИ, можно использовать seed-скрипты.

Минимальный порядок:

```powershell
venv\Scripts\activate
python scripts/seed_roles.py
python scripts/seed_rbac_matrix.py
python scripts/seed_test_users.py
python scripts/seed.py
```

Важно:

- `seed.py` добавляет демонстрационные НСИ и календарь.
- На рабочей базе с уже заведенными НСИ запускать seed-скрипты нужно осторожно.
- Текущие пользовательские данные лучше не перезатирать без отдельного решения.

## Запуск для разработки

### Вариант 1. Запустить все одной командой

```powershell
cd C:\MyPyProjects\reestr
npm run dev
```

Эта команда запускает:

- frontend: `http://localhost:5173`
- backend: `http://127.0.0.1:8080`

Логи в общем терминале помечаются префиксами:

- `FRONT`
- `BACK`

Можно также запустить через:

```powershell
start_all.bat
```

### Вариант 2. Запустить по отдельности

Backend:

```powershell
cd C:\MyPyProjects\reestr
start_backend.bat
```

или:

```powershell
cd C:\MyPyProjects\reestr
venv\Scripts\activate
python -m app.main
```

Frontend:

```powershell
cd C:\MyPyProjects\reestr
npm run dev:frontend
```

Раздельный запуск удобнее для активной отладки, потому что логи frontend и backend не смешиваются.

## Сетевой доступ в dev-режиме

Vite настроен на `host: 0.0.0.0`, поэтому frontend доступен с других машин по IP компьютера-разработчика, например:

```text
http://192.168.150.14:5173
```

Frontend runtime обращается к API через относительный путь:

```text
/api/v1
```

В dev-режиме этот путь проксируется Vite на backend:

```text
/api -> http://localhost:8080
```

Поэтому при сетевом доступе запросы выглядят так:

```text
http://192.168.150.14:5173/api/v1/...
```

Это важно: в пользовательском frontend runtime не должно быть жестких ссылок на `127.0.0.1:8080` или `localhost:8080`, иначе доступ с другого компьютера сломается.

## Production / reverse proxy

Если frontend будет раздаваться не через Vite dev server, нужно настроить reverse proxy:

- frontend отдает статические файлы;
- `/api/v1` проксируется на backend;
- загрузка файлов тоже идет через `/api/v1/requests/{id}/upload`;
- открытие файлов идет через `/api/v1/requests/{id}/file`.

Пример схемы:

```text
https://treasury.example.local/          -> frontend static
https://treasury.example.local/api/v1/   -> backend http://127.0.0.1:8080/api/v1/
```

Без такого proxy frontend будет открываться, но API-запросы не дойдут до backend.

## Проверка работоспособности

Backend healthcheck:

```text
http://127.0.0.1:8080/health
```

Frontend:

```text
http://localhost:5173
```

Сетевой frontend:

```text
http://<IP-компьютера>:5173
```

## Сборка

```powershell
cd C:\MyPyProjects\reestr
npm run build
```

Команда проксирует сборку в `frontend`.

## Тесты

Перед тестами должны быть запущены backend и frontend.

API-тесты:

```powershell
npm run test:api
```

UI-тесты:

```powershell
npm run test:e2e
```

Полный regression suite:

```powershell
npm run test:regression
```

UI-тесты в видимом браузере:

```powershell
npm --prefix frontend run test:regression:headed
```

## Логи

Текущее состояние:

- backend пишет в консоль;
- frontend пишет в консоль;
- при `npm run dev` потоки помечены как `FRONT` и `BACK`;
- SQLAlchemy сейчас шумно пишет SQL-запросы из-за `echo=True` в `app/db/database.py`.

План улучшения логов зафиксирован в `documentation/backlog.md`, задача `P1.6 Техническое логирование и dev-запуск`.

## Частые проблемы

### `Port 5173 is already in use`

Frontend уже запущен. Нужно закрыть старый процесс или открыть существующий адрес:

```text
http://localhost:5173
```

### `Network Error` при сохранении заявки с файлом

Проверить, что frontend обращается к upload через относительный путь:

```text
/api/v1/requests/{id}/upload
```

Если запрос идет на `127.0.0.1:8080`, сетевой клиент будет пытаться обратиться к самому себе, а не к серверу.

### Backend не стартует после перезагрузки

Проверить:

- активирован ли `venv`;
- существует ли `.env`;
- доступна ли PostgreSQL;
- применены ли миграции;
- свободен ли порт `8080`.

### Frontend открылся, но данные не грузятся

Проверить:

- backend запущен на `8080`;
- Vite proxy `/api` работает;
- при production-запуске настроен reverse proxy `/api/v1`.

## Полезные команды

```powershell
# Запустить frontend + backend
npm run dev

# Только frontend
npm run dev:frontend

# Только backend
npm run dev:backend

# Сборка frontend
npm run build

# Полный regression suite
npm run test:regression

# Миграции БД
alembic upgrade head
```
