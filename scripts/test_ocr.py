"""
Пилотный скрипт для проверки распознавания счётов через GigaChat.

Использование:
    python scripts/test_ocr.py <путь_к_файлу>
    python scripts/test_ocr.py storage/4014e3ec-95bc-4d74-8546-039f9642141c.pdf

Требования:
    - GIGACHAT_CREDENTIALS в файле .env
    - pip install gigachat pdfplumber PyMuPDF
"""

import sys
import json
import io
import time
from pathlib import Path

# Загружаем .env вручную (без FastAPI)
def load_env(env_path: str = ".env") -> dict:
    env = {}
    try:
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                env[key.strip()] = val.strip().strip('"')
    except FileNotFoundError:
        print(f"[!] Файл {env_path} не найден")
    return env


PROMPT = """Ты — финансовый ассистент. Извлеки из счёта реквизиты и верни ТОЛЬКО JSON без
markdown-блоков и комментариев:
{
  "counterparty": "Полное юридическое название поставщика/исполнителя",
  "amount": 12345.67,
  "description": "Назначение платежа (Оплата по счёту № X от DD.MM.YYYY)",
  "payment_date": "YYYY-MM-DD"
}

Правила:
- amount — число с точкой, без символов валюты, пробелов и запятых
- payment_date — срок оплаты из счёта; если не указан — дата выставления счёта
- description — краткое, подходит для банковского поля «Назначение платежа»
- counterparty — полное юридическое название как написано в счёте
- Если поле отсутствует — null"""


def extract_pdf_text(data: bytes) -> str:
    import pdfplumber
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        pages = pdf.pages[:3]
        return "\n".join(p.extract_text() or "" for p in pages)


def pdf_to_image(data: bytes) -> bytes:
    import fitz
    doc = fitz.open(stream=data, filetype="pdf")
    pix = doc[0].get_pixmap(dpi=150)
    return pix.tobytes("png")


def call_gigachat_text(credentials: str, text: str) -> dict:
    from gigachat import GigaChat
    from gigachat.models import Chat, Messages, MessagesRole

    print("  → Метод: text completion (текстовый слой PDF)")
    with GigaChat(credentials=credentials, verify_ssl_certs=False) as g:
        response = g.chat(Chat(messages=[
            Messages(
                role=MessagesRole.USER,
                content=f"{PROMPT}\n\nТекст счёта:\n{text[:4000]}"
            )
        ]))
        return json.loads(response.choices[0].message.content)


def call_gigachat_vision(credentials: str, image_bytes: bytes, filename: str) -> dict:
    from gigachat import GigaChat
    from gigachat.models import Chat, Messages, MessagesRole

    print("  → Метод: vision (GigaChat-Pro)")
    with GigaChat(credentials=credentials, verify_ssl_certs=False, model="GigaChat-Pro") as g:
        uploaded = g.upload_file(io.BytesIO(image_bytes), filename)
        print(f"  → Файл загружен: id={uploaded.id}")
        response = g.chat(Chat(messages=[
            Messages(role=MessagesRole.USER, content=[
                {"type": "text", "text": PROMPT},
                {"type": "image_url", "image_url": {"url": uploaded.id}}
            ])
        ]))
        return json.loads(response.choices[0].message.content)


def parse_file(file_path: str, credentials: str) -> dict | None:
    path = Path(file_path)
    if not path.exists():
        print(f"[!] Файл не найден: {file_path}")
        return None

    ext = path.suffix.lower()
    if ext not in {".pdf", ".jpg", ".jpeg", ".png"}:
        print(f"[!] Неподдерживаемый формат: {ext}")
        return None

    print(f"\n[>] Файл: {path.name}  ({path.stat().st_size // 1024} KB)")
    file_bytes = path.read_bytes()

    if ext == ".pdf":
        text = extract_pdf_text(file_bytes)
        text_len = len(text.strip())
        print(f"  → Извлечено символов текста: {text_len}")

        if text_len >= 100:
            return call_gigachat_text(credentials, text)
        else:
            print("  → Текста недостаточно, конвертируем в изображение...")
            image_bytes = pdf_to_image(file_bytes)
            print(f"  → PNG: {len(image_bytes) // 1024} KB")
            return call_gigachat_vision(credentials, image_bytes, "page.png")
    else:
        return call_gigachat_vision(credentials, file_bytes, path.name)


def main():
    env = load_env()
    credentials = env.get("GIGACHAT_CREDENTIALS", "").strip()

    if not credentials:
        print("[!] GIGACHAT_CREDENTIALS не задан в .env")
        print("    Получите ключ на: https://developers.sber.ru/studio")
        sys.exit(1)

    # Определяем файл для теста
    if len(sys.argv) > 1:
        file_path = sys.argv[1]
    else:
        # Ищем первый PDF в storage/
        storage = Path("storage")
        pdfs = list(storage.glob("*.pdf")) if storage.exists() else []
        if not pdfs:
            print("[!] Укажите файл: python scripts/test_ocr.py <путь>")
            sys.exit(1)
        file_path = str(pdfs[0])
        print(f"[i] Файл не указан, используем: {file_path}")

    start = time.time()

    try:
        result = parse_file(file_path, credentials)
    except Exception as e:
        print(f"\n[✗] Ошибка: {e}")
        sys.exit(1)

    elapsed = time.time() - start

    if result is None:
        print("\n[✗] Результат не получен")
        sys.exit(1)

    print(f"\n[✓] Распознано за {elapsed:.1f} сек\n")
    print("─" * 40)
    print(f"  Контрагент:  {result.get('counterparty') or '—'}")
    print(f"  Сумма:       {result.get('amount') or '—'}")
    print(f"  Назначение:  {result.get('description') or '—'}")
    print(f"  Дата оплаты: {result.get('payment_date') or '—'}")
    print("─" * 40)
    print("\n[raw JSON]")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
