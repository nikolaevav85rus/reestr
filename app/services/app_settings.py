import json
import os

SETTINGS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "app_settings.json")

DEFAULT_SETTINGS = {
    "storage_path": "storage",
    "storage_path_label": "Локальная папка (относительно корня проекта)",
}

def get_settings() -> dict:
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return {**DEFAULT_SETTINGS, **data}
        except Exception:
            pass
    return dict(DEFAULT_SETTINGS)

def save_settings(new_settings: dict) -> dict:
    os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
    current = get_settings()
    current.update(new_settings)
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(current, f, ensure_ascii=False, indent=2)
    return current

def get_storage_path() -> str:
    path = get_settings().get("storage_path", "storage")
    os.makedirs(path, exist_ok=True)
    return path
