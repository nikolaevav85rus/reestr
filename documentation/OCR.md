# ТЗ: Парсинг счёта и автозаполнение реквизитов заявки (Блок 16)

## 1. Цель

При создании платёжной заявки пользователь прикрепляет скан или PDF счёта. Система должна автоматически распознать реквизиты (контрагент, сумма, назначение платежа, дата оплаты) и заполнить соответствующие поля формы. Пользователь может скорректировать значения перед сохранением черновика.

---

## 2. Область применения

- Форма «Новая заявка» и «Копия заявки» в разделе «Реестр платежей»
- Поддерживаемые форматы: `.pdf`, `.jpg`, `.jpeg`, `.png`
- Доступно пользователям с правом `req_create`

---

## 3. Пользовательский сценарий

> Как инициатор заявки, я хочу загрузить счёт от поставщика и получить автозаполненную форму, чтобы не вводить реквизиты вручную.

**Шаги:**
1. Открыть форму создания заявки
2. Нажать «Выбрать файл» → выбрать PDF или изображение счёта
3. Система автоматически анализирует файл (индикатор `Spin` в области Upload)
4. Поля «Контрагент», «Сумма», «Назначение платежа», «Дата оплаты» заполняются
5. Пользователь проверяет / корректирует данные
6. Нажимает «Сохранить» — заявка создаётся с заполненными реквизитами

**Граничные случаи:**

| Ситуация | Поведение |
|----------|-----------|
| Поле не распознано | Поле остаётся пустым, остальные заполнены |
| Не удалось распознать счёт вообще | `messageApi.warning(...)`, форма пустая |
| Неподдерживаемый формат файла | HTTP 400, сообщение об ошибке |
| GigaChat недоступен | `messageApi.warning(...)`, форма пустая |

---

## 4. Техническая архитектура

### 4.1. Технологический стек

| Компонент | Решение |
|-----------|---------|
| LLM-провайдер | GigaChat (Сбер) |
| Модель для текста | GigaChat (дефолт) |
| Модель для vision | GigaChat-Pro |
| Извлечение текста из PDF | `pdfplumber` |
| Рендер PDF → изображение | `PyMuPDF` (пакет `PyMuPDF`, импорт `fitz`) |
| Python SDK | `gigachat` |

### 4.2. Алгоритм выбора метода

```
Входной файл
│
├─ .pdf
│   ├─ pdfplumber → извлечь текст
│   │   ├─ len(text) ≥ 100 → Text completion GigaChat  (дешевле)
│   │   └─ len(text) < 100 → PyMuPDF: рендер стр.1 → PNG → Vision GigaChat-Pro
│   └─
│
└─ .jpg / .jpeg / .png
    └─ Vision GigaChat-Pro напрямую
```

### 4.3. Промпт для GigaChat

```
Ты — финансовый ассистент. Извлеки из счёта реквизиты и верни ТОЛЬКО JSON без
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
- Если поле отсутствует — null
```

---

## 5. Backend

### 5.1. Новые зависимости (`requirements.txt`)

```
gigachat
pdfplumber
PyMuPDF
```

### 5.2. Конфигурация

**`.env`:**
```env
GIGACHAT_CREDENTIALS=<base64-строка из кабинета разработчика Сбер>
```

**`app/core/config.py`** — добавить в класс `Settings`:
```python
GIGACHAT_CREDENTIALS: str = ""
```

Как получить `GIGACHAT_CREDENTIALS`:
1. Регистрация на [developers.sber.ru](https://developers.sber.ru/studio)
2. Создать проект → получить `Client ID` и `Client Secret`
3. Закодировать: `base64(ClientID:ClientSecret)` (одна строка без пробелов)

### 5.3. Новый сервис `app/services/invoice_parser.py`

```python
import asyncio, io, json
from pathlib import Path
from app.core.config import settings

async def parse_invoice(file_bytes: bytes, filename: str) -> dict | None:
    """
    Возвращает dict с полями counterparty/amount/description/payment_date
    или None при любой ошибке.
    """
    try:
        ext = Path(filename).suffix.lower()
        if ext == ".pdf":
            text = _extract_pdf_text(file_bytes)
            if len(text) >= 100:
                return await asyncio.to_thread(_call_text, text)
            else:
                image_bytes = _pdf_to_image(file_bytes)
                return await asyncio.to_thread(_call_vision, image_bytes, "page.png")
        else:
            return await asyncio.to_thread(_call_vision, file_bytes, filename)
    except Exception:
        return None

def _extract_pdf_text(data: bytes) -> str:
    import pdfplumber, io
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        return "\n".join(p.extract_text() or "" for p in pdf.pages[:3])

def _pdf_to_image(data: bytes) -> bytes:
    import fitz
    doc = fitz.open(stream=data, filetype="pdf")
    pix = doc[0].get_pixmap(dpi=150)
    return pix.tobytes("png")

PROMPT = """Ты — финансовый ассистент. Извлеки из счёта реквизиты и верни ТОЛЬКО JSON:
{"counterparty":"...","amount":0.0,"description":"...","payment_date":"YYYY-MM-DD"}
Правила: amount — число; payment_date — срок оплаты или дата счёта; если поле не найдено — null."""

def _call_text(text: str) -> dict | None:
    from gigachat import GigaChat
    from gigachat.models import Chat, Messages, MessagesRole
    with GigaChat(credentials=settings.GIGACHAT_CREDENTIALS, verify_ssl_certs=False) as g:
        r = g.chat(Chat(messages=[
            Messages(role=MessagesRole.USER, content=f"{PROMPT}\n\nТекст счёта:\n{text[:4000]}")
        ]))
        return json.loads(r.choices[0].message.content)

def _call_vision(image_bytes: bytes, filename: str) -> dict | None:
    from gigachat import GigaChat
    from gigachat.models import Chat, Messages, MessagesRole
    with GigaChat(credentials=settings.GIGACHAT_CREDENTIALS, verify_ssl_certs=False,
                  model="GigaChat-Pro") as g:
        uploaded = g.upload_file(io.BytesIO(image_bytes), filename)
        r = g.chat(Chat(messages=[Messages(role=MessagesRole.USER, content=[
            {"type": "text", "text": PROMPT},
            {"type": "image_url", "image_url": {"url": uploaded.id}}
        ])]))
        return json.loads(r.choices[0].message.content)
```

### 5.4. Новый endpoint в `app/api/endpoints/requests.py`

Добавить **перед** параметрическими роутами `/{request_id}/...`:

```python
from pathlib import Path as FilePath
from app.services import invoice_parser

@router.post("/parse-invoice")
async def parse_invoice_endpoint(
    file: UploadFile = File(...),
    current_user: User = Depends(PermissionChecker("req_create")),
):
    if FilePath(file.filename).suffix.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Неподдерживаемый формат файла")
    data = await invoice_parser.parse_invoice(await file.read(), file.filename)
    if data is None:
        raise HTTPException(status_code=422, detail="Не удалось распознать реквизиты счёта")
    return data
```

**Важно:** регистрация **до** `/{request_id}` — иначе FastAPI перехватит `/parse-invoice` как UUID.

---

## 6. Frontend (`frontend/src/pages/PaymentRegistry.tsx`)

### 6.1. Новое состояние

```tsx
const [isParsingFile, setIsParsingFile] = useState(false);
```

### 6.2. Функция `handleParseInvoice`

```tsx
const handleParseInvoice = async (file: File) => {
  setIsParsingFile(true);
  try {
    const fd = new FormData();
    fd.append('file', file);
    const { data } = await apiClient.post('/requests/parse-invoice', fd);
    form.setFieldsValue({
      counterparty:   data.counterparty   ?? undefined,
      amount:         data.amount         ?? undefined,
      description:    data.description    ?? undefined,
      payment_date:   data.payment_date   ? dayjs(data.payment_date) : undefined,
    });
    messageApi.success('Реквизиты заполнены из счёта');
  } catch {
    messageApi.warning('Не удалось распознать счёт — заполните вручную');
  } finally {
    setIsParsingFile(false);
  }
};
```

### 6.3. Изменение `<Upload>`

```tsx
// onChange — добавить авто-вызов парсера
onChange={({ fileList: fl, file }) => {
  setFileList(fl);
  if (file.status !== 'removed' && file.originFileObj) {
    handleParseInvoice(file.originFileObj);
  }
}}
```

Обернуть `<Upload>` в `<Spin>`:
```tsx
<Spin spinning={isParsingFile} tip="Распознаём счёт...">
  <Upload ...>
    <Button icon={<UploadOutlined />}>Выбрать файл</Button>
  </Upload>
</Spin>
```

---

## 7. Изменяемые файлы

| Файл | Тип изменения |
|------|--------------|
| `requirements.txt` | + gigachat, pdfplumber, PyMuPDF |
| `.env` | + GIGACHAT_CREDENTIALS |
| `app/core/config.py` | + поле GIGACHAT_CREDENTIALS |
| `app/services/invoice_parser.py` | **новый файл** |
| `app/api/endpoints/requests.py` | + endpoint POST /parse-invoice |
| `frontend/src/pages/PaymentRegistry.tsx` | isParsingFile + handleParseInvoice + Spin |

---

## 8. Сценарии тестирования

| № | Тест | Ожидаемый результат |
|---|------|---------------------|
| 1 | PDF с текстовым слоем | Поля заполнены через pdfplumber + text completion |
| 2 | JPEG-скан счёта | Поля заполнены через GigaChat-Pro vision |
| 3 | Scanned PDF (без текста) | PyMuPDF → PNG → vision → поля заполнены |
| 4 | PDF без поля «дата оплаты» | `payment_date = null`, остальные поля заполнены |
| 5 | Неподдерживаемый формат | HTTP 400, предупреждение |
| 6 | GigaChat недоступен | warning «заполните вручную», форма пустая |
| 7 | Поля редактируются после автозаполнения | Пользователь корректирует данные и сохраняет |

---

## 9. Ограничения

- GigaChat требует соединения с серверами Сбера (при закрытом периметре — VPN)
- Vision работает только с GigaChat-Pro (тарифицируется отдельно)
- Файл не сохраняется на диск при парсинге — только в памяти для анализа; сохранение происходит после создания черновика в `POST /{id}/upload`
