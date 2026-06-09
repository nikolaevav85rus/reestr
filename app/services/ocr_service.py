"""Распознавание счетов на оплату через платформу evo-ai (Dify-совместимый API).

Поток:
  1. POST {base}/files/upload  — загрузка файла (multipart), возвращает id файла.
  2. POST {base}/chat-messages — отправка запроса агенту со ссылкой на файл,
     ответ агента (строго валидный JSON) приходит строкой в поле `answer`.

Сервис ничего не знает про HTTP-слой приложения: он бросает OcrError с кодом
статуса, который эндпоинт переводит в HTTPException.
"""
import asyncio
import json
import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class OcrError(Exception):
    """Ошибка распознавания, переводимая эндпоинтом в HTTPException.

    Атрибут ``status_code`` подсказывает эндпоинту, какой HTTP-код вернуть:
      - 503 — OCR не настроен (нет ключа);
      - 502 — внешний сервис вернул ошибку или нечитаемый ответ.
    """

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def _strip_json_fence(text: str) -> str:
    """Снимает обрамляющий ```json ... ``` (или ``` ... ```), если он есть."""
    stripped = text.strip()
    if stripped.startswith("```"):
        # Убираем открывающую строку с ограждением (```json / ```)
        newline = stripped.find("\n")
        if newline != -1:
            stripped = stripped[newline + 1:]
        else:
            stripped = stripped[3:]
        # Убираем закрывающее ограждение
        if stripped.rstrip().endswith("```"):
            stripped = stripped.rstrip()[:-3]
    return stripped.strip()


class _ParseError(Exception):
    """Внутренний сигнал: ответ агента не удалось разобрать как JSON-объект.

    Используется только внутри цикла повторов, наружу не выходит.
    """


def _parse_answer(answer) -> dict:
    """Пытается извлечь JSON-объект из ответа агента.

    Сначала снимает ограждение ```json ... ``` и парсит как есть. Если это не
    удаётся — пытается «спасти» ответ, вырезая подстроку от первой `{` до
    последней `}` и парся её. Бросает ``_ParseError`` только если оба способа
    не дали JSON-объект (dict) — это и есть условие для повтора запроса.
    """
    candidate = _strip_json_fence(answer)

    # Основная попытка: парсим очищенный от ограждения текст.
    try:
        parsed = json.loads(candidate)
        if isinstance(parsed, dict):
            return parsed
    except (ValueError, TypeError):
        pass

    # Спасательная попытка: берём подстроку от первой "{" до последней "}".
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            parsed = json.loads(candidate[start:end + 1])
            if isinstance(parsed, dict):
                return parsed
        except (ValueError, TypeError):
            pass

    raise _ParseError()


async def recognize_invoice(file_bytes: bytes, filename: str, content_type: str) -> dict:
    """Загружает файл в evo-ai и возвращает распознанный JSON счёта (dict).

    Бросает OcrError(503) если OCR не настроен, OcrError(502) при ошибке внешнего
    сервиса или если ответ агента не является валидным JSON.
    """
    if not settings.EVOAI_API_KEY:
        raise OcrError(503, "OCR не настроен")

    base = settings.EVOAI_BASE_URL.rstrip("/")
    user = settings.EVOAI_USER
    auth_headers = {"Authorization": f"Bearer {settings.EVOAI_API_KEY}"}
    # evo-ai принимает и PDF, и изображения как файл type="document"; type="image"
    # отвергается валидацией (HTTP 400). Поэтому всегда отправляем "document".
    file_type = "document"

    timeout = httpx.Timeout(settings.EVOAI_TIMEOUT_SEC)
    async with httpx.AsyncClient(timeout=timeout) as client:
        # --- Шаг 1: загрузка файла (надёжна, одна попытка) ---
        try:
            upload_resp = await client.post(
                f"{base}/files/upload",
                headers=auth_headers,
                files={"file": (filename, file_bytes, content_type)},
                data={"user": user},
            )
        except httpx.HTTPError as exc:
            logger.warning("evo-ai upload request failed: %s", exc)
            raise OcrError(502, "Сервис распознавания недоступен") from exc

        if upload_resp.status_code // 100 != 2:
            logger.warning(
                "evo-ai upload returned %s: %s",
                upload_resp.status_code,
                upload_resp.text[:500],
            )
            raise OcrError(502, "Ошибка загрузки файла в сервис распознавания")

        try:
            upload_id = upload_resp.json()["id"]
        except (ValueError, KeyError, TypeError) as exc:
            logger.warning("evo-ai upload response without id: %s", upload_resp.text[:500])
            raise OcrError(502, "Некорректный ответ сервиса распознавания") from exc

        # --- Шаг 2: распознавание (с повторами) ---
        chat_payload = {
            "inputs": {},
            "query": (
                "Распознай прикреплённый счёт на оплату и верни строго валидный "
                "JSON по заданной схеме."
            ),
            "response_mode": "blocking",
            "user": user,
            "files": [
                {
                    "type": file_type,
                    "transfer_method": "local_file",
                    "upload_file_id": upload_id,
                }
            ],
        }

        max_attempts = 3
        last_5xx_status = None  # последний апстрим-статус 5xx, чтобы вернуть его в detail
        for attempt in range(1, max_attempts + 1):
            if attempt > 1:
                await asyncio.sleep(1.5 * (attempt - 1))

            # 2a. Запрос к chat-messages. Транспорт/таймаут -> повтор.
            try:
                chat_resp = await client.post(
                    f"{base}/chat-messages",
                    headers={**auth_headers, "Content-Type": "application/json"},
                    json=chat_payload,
                )
            except httpx.HTTPError as exc:
                logger.warning(
                    "evo-ai chat-messages request failed (attempt %s/%s): %s",
                    attempt, max_attempts, exc,
                )
                continue

            status = chat_resp.status_code
            # 2b. 4xx — настоящая клиентская ошибка, повтор не поможет.
            if 400 <= status < 500:
                logger.warning(
                    "evo-ai chat-messages returned %s: %s",
                    status, chat_resp.text[:500],
                )
                raise OcrError(502, "Ошибка сервиса распознавания")

            # 2c. 5xx — временная серверная ошибка, повтор.
            if status >= 500:
                last_5xx_status = status
                logger.warning(
                    "evo-ai chat-messages returned %s (attempt %s/%s): %s",
                    status, attempt, max_attempts, chat_resp.text[:500],
                )
                continue

            # 2d. 2xx — пытаемся достать и разобрать answer.
            try:
                answer = chat_resp.json()["answer"]
            except (ValueError, KeyError, TypeError):
                logger.warning(
                    "evo-ai chat-messages response without answer (attempt %s/%s): %s",
                    attempt, max_attempts, chat_resp.text[:500],
                )
                continue

            try:
                return _parse_answer(answer)
            except _ParseError:
                logger.warning(
                    "evo-ai answer is not valid JSON (attempt %s/%s): %s",
                    attempt, max_attempts, str(answer)[:500],
                )
                continue

    # Все попытки исчерпаны.
    if last_5xx_status is not None:
        raise OcrError(502, f"Сервис распознавания вернул ошибку (HTTP {last_5xx_status})")
    raise OcrError(502, "Сервис распознавания вернул некорректный ответ")
