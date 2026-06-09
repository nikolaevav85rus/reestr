"""Распознавание счетов на оплату через платформу evo-ai (Dify-совместимый API).

Поток:
  1. POST {base}/files/upload  — загрузка файла (multipart), возвращает id файла.
  2. POST {base}/chat-messages — отправка запроса агенту со ссылкой на файл,
     ответ агента (строго валидный JSON) приходит строкой в поле `answer`.

Сервис ничего не знает про HTTP-слой приложения: он бросает OcrError с кодом
статуса, который эндпоинт переводит в HTTPException.
"""
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
    file_type = "image" if content_type.startswith("image/") else "document"

    timeout = httpx.Timeout(settings.EVOAI_TIMEOUT_SEC)
    async with httpx.AsyncClient(timeout=timeout) as client:
        # --- Шаг 1: загрузка файла ---
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

        # --- Шаг 2: распознавание ---
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
        try:
            chat_resp = await client.post(
                f"{base}/chat-messages",
                headers={**auth_headers, "Content-Type": "application/json"},
                json=chat_payload,
            )
        except httpx.HTTPError as exc:
            logger.warning("evo-ai chat-messages request failed: %s", exc)
            raise OcrError(502, "Сервис распознавания недоступен") from exc

    if chat_resp.status_code // 100 != 2:
        logger.warning(
            "evo-ai chat-messages returned %s: %s",
            chat_resp.status_code,
            chat_resp.text[:500],
        )
        raise OcrError(502, "Ошибка сервиса распознавания")

    try:
        answer = chat_resp.json()["answer"]
    except (ValueError, KeyError, TypeError) as exc:
        logger.warning("evo-ai chat-messages response without answer: %s", chat_resp.text[:500])
        raise OcrError(502, "Не удалось разобрать ответ распознавания") from exc

    try:
        recognition = json.loads(_strip_json_fence(answer))
    except (ValueError, TypeError) as exc:
        logger.warning("evo-ai answer is not valid JSON: %s", str(answer)[:500])
        raise OcrError(502, "Не удалось разобрать ответ распознавания") from exc

    if not isinstance(recognition, dict):
        logger.warning("evo-ai answer JSON is not an object: %r", recognition)
        raise OcrError(502, "Не удалось разобрать ответ распознавания")

    return recognition
