import json
import os

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
SETTINGS_FILE = os.path.join(PROJECT_ROOT, "data", "app_settings.json")

# Only these keys may be persisted. Any other key in the incoming payload is dropped.
ALLOWED_SETTINGS_KEYS = {"storage_path", "storage_path_label"}

DEFAULT_STORAGE_PATH = "storage"

DEFAULT_SETTINGS = {
    "storage_path": DEFAULT_STORAGE_PATH,
    "storage_path_label": "Локальная папка (относительно корня проекта)",
}


def _validate_storage_path(path: str) -> str:
    """Validate and normalize a storage_path into a safe path relative to PROJECT_ROOT.

    Rules:
      - must be a non-empty string;
      - UNC paths (leading \\ or //) are rejected;
      - drive-letter / absolute paths are rejected, UNLESS they resolve to a
        location inside PROJECT_ROOT — in that case the value is remapped to the
        equivalent relative path (handles legitimate values stored before this
        validation existed, e.g. "<project>\\storage");
      - paths containing ".." or that otherwise escape PROJECT_ROOT are rejected.

    Returns the safe relative path (e.g. "storage"). Raises ValueError otherwise.
    """
    if not isinstance(path, str):
        raise ValueError("storage_path must be a string")

    candidate = path.strip()
    if not candidate:
        raise ValueError("storage_path must not be empty")

    # Reject UNC paths (\\server\share or //server/share).
    if candidate.startswith("\\\\") or candidate.startswith("//"):
        raise ValueError(f"storage_path must not be a UNC path: {path!r}")

    if os.path.isabs(candidate) or (len(candidate) >= 2 and candidate[1] == ":"):
        # Absolute / drive-letter path: only tolerate it if it points inside the
        # project root, in which case remap to the relative form. Otherwise reject.
        resolved = os.path.normpath(os.path.abspath(candidate))
        root = os.path.normpath(os.path.abspath(PROJECT_ROOT))
        if os.path.normcase(resolved) == os.path.normcase(root) or \
                os.path.normcase(resolved).startswith(os.path.normcase(root) + os.sep):
            rel = os.path.relpath(resolved, root)
            return DEFAULT_STORAGE_PATH if rel in (".", "") else rel
        raise ValueError(f"storage_path must be a relative path inside the project: {path!r}")

    # Relative path: reject explicit parent-directory traversal.
    if ".." in candidate.replace("\\", "/").split("/"):
        raise ValueError(f"storage_path must not contain '..': {path!r}")

    # Confine the resolved target inside the project root.
    root = os.path.normpath(os.path.abspath(PROJECT_ROOT))
    resolved = os.path.normpath(os.path.abspath(os.path.join(root, candidate)))
    if not (os.path.normcase(resolved) == os.path.normcase(root) or
            os.path.normcase(resolved).startswith(os.path.normcase(root) + os.sep)):
        raise ValueError(f"storage_path escapes the project root: {path!r}")

    rel = os.path.relpath(resolved, root)
    return DEFAULT_STORAGE_PATH if rel in (".", "") else rel


def get_settings() -> dict:
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if not isinstance(data, dict):
                    data = {}
                # Only surface whitelisted keys.
                filtered = {k: v for k, v in data.items() if k in ALLOWED_SETTINGS_KEYS}
                return {**DEFAULT_SETTINGS, **filtered}
        except Exception:
            pass
    return dict(DEFAULT_SETTINGS)


def save_settings(new_settings: dict) -> dict:
    os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
    current = get_settings()
    # Whitelist incoming keys; silently drop anything unknown.
    incoming = {k: v for k, v in (new_settings or {}).items() if k in ALLOWED_SETTINGS_KEYS}
    if "storage_path" in incoming:
        # Validate and normalize before persisting; raises ValueError on bad input.
        incoming["storage_path"] = _validate_storage_path(incoming["storage_path"])
    current.update(incoming)
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(current, f, ensure_ascii=False, indent=2)
    return current


def get_storage_path() -> str:
    raw = get_settings().get("storage_path", DEFAULT_STORAGE_PATH)
    try:
        path = _validate_storage_path(raw)
    except ValueError:
        # A previously-stored unsafe value must never let uploads/downloads
        # touch arbitrary locations — fall back to the safe default.
        path = DEFAULT_STORAGE_PATH
    abs_path = os.path.join(PROJECT_ROOT, path)
    os.makedirs(abs_path, exist_ok=True)
    return abs_path
