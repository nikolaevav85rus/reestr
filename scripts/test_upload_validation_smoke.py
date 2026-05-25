"""
Smoke checks for upload validation.

Run:
    venv\\Scripts\\python.exe scripts\\test_upload_validation_smoke.py
"""

import datetime
import os
import sys

import requests

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings as app_settings


BASE_URL = "http://127.0.0.1:8080/api/v1"
USERNAME = "initiator1"
PASSWORD = "1234"

PASS = "[OK]"
FAIL = "[FAIL]"


def print_result(label: str, ok: bool, detail: str = "") -> bool:
    status = PASS if ok else FAIL
    suffix = f" [{detail}]" if detail else ""
    print(f"{status} {label}{suffix}")
    return ok


def login():
    resp = requests.post(
        f"{BASE_URL}/auth/login",
        data={"username": USERNAME, "password": PASSWORD},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=10,
    )
    return resp


def create_request(headers):
    orgs = requests.get(f"{BASE_URL}/dict/organizations", headers=headers, timeout=10)
    dirs = requests.get(f"{BASE_URL}/dict/directions", headers=headers, timeout=10)
    budget_items = requests.get(f"{BASE_URL}/dict/budget_items", headers=headers, timeout=10)
    if orgs.status_code != 200 or dirs.status_code != 200 or budget_items.status_code != 200:
        return None, f"dictionaries status: orgs={orgs.status_code}, dirs={dirs.status_code}, budget={budget_items.status_code}"
    if not orgs.json() or not dirs.json() or not budget_items.json():
        return None, "dictionaries are empty"

    payload = {
        "amount": 1234.56,
        "description": "Upload validation smoke",
        "note": "",
        "payment_date": datetime.date.today().isoformat(),
        "organization_id": orgs.json()[0]["id"],
        "direction_id": dirs.json()[0]["id"],
        "budget_item_id": budget_items.json()[0]["id"],
        "counterparty": "Upload Smoke",
        "special_order": False,
    }
    created = requests.post(f"{BASE_URL}/requests/", headers=headers, json=payload, timeout=12)
    if created.status_code != 200:
        return None, f"create status={created.status_code}, body={created.text[:300]}"
    return created.json()["id"], ""


def run():
    results = []
    request_id = None

    login_resp = login()
    results.append(print_result("Login initiator1", login_resp.status_code == 200, str(login_resp.status_code)))
    if login_resp.status_code != 200:
        return results

    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    request_id, create_error = create_request(headers)
    results.append(print_result("Create draft request for upload", bool(request_id), create_error))
    if not request_id:
        return results

    try:
        # 1) Allowed PDF
        pdf_bytes = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"
        resp_pdf = requests.post(
            f"{BASE_URL}/requests/{request_id}/upload",
            headers=headers,
            files={"file": ("upload-smoke.pdf", pdf_bytes, "application/pdf")},
            timeout=20,
        )
        pdf_ok = resp_pdf.status_code == 200 and bool(resp_pdf.json().get("file_path"))
        results.append(print_result("PDF upload is accepted", pdf_ok, str(resp_pdf.status_code)))

        # 2) Forbidden extension (.docx)
        resp_docx = requests.post(
            f"{BASE_URL}/requests/{request_id}/upload",
            headers=headers,
            files={
                "file": (
                    "upload-smoke.docx",
                    b"PK\x03\x04fake-docx-content",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                )
            },
            timeout=20,
        )
        docx_ok = (
            resp_docx.status_code == 400
            and "Неподдерживаемый формат файла" in (resp_docx.json().get("detail") or "")
        )
        results.append(print_result("DOCX upload is rejected", docx_ok, str(resp_docx.status_code)))

        # 3) Forbidden MIME
        resp_bad_mime = requests.post(
            f"{BASE_URL}/requests/{request_id}/upload",
            headers=headers,
            files={"file": ("upload-smoke.pdf", b"fake-pdf", "text/plain")},
            timeout=20,
        )
        bad_mime_ok = (
            resp_bad_mime.status_code == 400
            and "Неподдерживаемый MIME/content-type файла" in (resp_bad_mime.json().get("detail") or "")
        )
        results.append(print_result("Invalid MIME is rejected", bad_mime_ok, str(resp_bad_mime.status_code)))

        # 4) Oversized file
        max_bytes = app_settings.UPLOAD_MAX_SIZE_MB * 1024 * 1024
        huge_pdf = b"%PDF-1.4\n" + (b"x" * (max_bytes + 1))
        resp_huge = requests.post(
            f"{BASE_URL}/requests/{request_id}/upload",
            headers=headers,
            files={"file": ("huge-upload.pdf", huge_pdf, "application/pdf")},
            timeout=60,
        )
        huge_ok = (
            resp_huge.status_code == 400
            and "Файл слишком большой" in (resp_huge.json().get("detail") or "")
        )
        results.append(print_result("Oversized upload is rejected", huge_ok, str(resp_huge.status_code)))
    finally:
        cleanup = requests.delete(f"{BASE_URL}/requests/{request_id}", headers=headers, timeout=10)
        results.append(print_result("Cleanup draft request", cleanup.status_code == 200, str(cleanup.status_code)))

    return results


if __name__ == "__main__":
    print("=== Upload validation smoke ===")
    final_results = run()
    passed = sum(1 for ok in final_results if ok)
    total = len(final_results)
    failed = total - passed
    print(f"RESULT: passed={passed}, failed={failed}, total={total}")
    raise SystemExit(1 if failed else 0)
