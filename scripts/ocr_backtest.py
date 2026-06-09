"""OCR backtest harness.

Runs every invoice file under docs/invoices through the app's
POST /api/v1/requests/ocr_recognize endpoint (which exercises the full chain:
upload -> evo-ai agent -> our mapping/normalization) and collects the results
into docs/_backtest/results.json + an HTML report for manual review.

Usage:  venv/Scripts/python.exe scripts/ocr_backtest.py
Resumable: re-running skips files already present in results.json.
"""
import asyncio
import json
import mimetypes
import os
import sys
import time

import httpx

BASE = "http://127.0.0.1:8080/api/v1"
INVOICES_DIR = os.path.join("docs", "invoices")
OUT_DIR = os.path.join("docs", "_backtest")
RESULTS_JSON = os.path.join(OUT_DIR, "results.json")
REPORT_HTML = os.path.join(OUT_DIR, "report.html")
EXTS = {".pdf", ".jpg", ".jpeg", ".png"}
CONCURRENCY = 4
USER = "initiator1"
PASSWORD = "1234"


def _digits(s):
    import re
    return re.sub(r"\D", "", str(s or ""))


def build_org_map():
    """{нормализованный ИНН -> название организации-плательщика} из справочника."""
    token = login()
    r = httpx.get(f"{BASE}/dict/organizations", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    r.raise_for_status()
    m = {}
    for o in r.json():
        if o.get("inn"):
            m[_digits(o["inn"])] = o.get("name")
    return m


def discover():
    files = []
    for root, _dirs, names in os.walk(INVOICES_DIR):
        for n in names:
            ext = os.path.splitext(n)[1].lower()
            if ext in EXTS:
                files.append(os.path.join(root, n))
    return sorted(files)


def login() -> str:
    r = httpx.post(f"{BASE}/auth/login", data={"username": USER, "password": PASSWORD}, timeout=30)
    r.raise_for_status()
    return r.json()["access_token"]


async def recognize(client, sem, token, path, done):
    rel = os.path.relpath(path, INVOICES_DIR).replace("\\", "/")
    if rel in done:
        return None
    folder = rel.split("/")[0]
    name = os.path.basename(path)
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    async with sem:
        t0 = time.time()
        try:
            with open(path, "rb") as f:
                files = {"file": (name, f.read(), mime)}
            r = await client.post(
                f"{BASE}/requests/ocr_recognize",
                files=files,
                headers={"Authorization": f"Bearer {token}"},
                timeout=200,
            )
            dt = round(time.time() - t0, 1)
            if r.status_code != 200:
                rec = {"file": rel, "folder": folder, "ok": False,
                       "http": r.status_code, "error": r.text[:300], "secs": dt}
            else:
                d = r.json()
                p = d.get("prefill", {})
                raw = d.get("raw", {})
                rec = {
                    "file": rel, "folder": folder, "ok": True, "http": 200, "secs": dt,
                    "is_invoice": p.get("is_invoice"),
                    "document_type": (raw.get("recognition") or {}).get("document_type"),
                    "counterparty": p.get("counterparty"),
                    "amount": p.get("amount"),
                    "payment_purpose": p.get("description"),
                    "summary": p.get("note"),
                    "requirement": p.get("payment_purpose_requirement"),
                    "supplier_inn": p.get("supplier_inn"),
                    "buyer_inn": p.get("buyer_inn"),
                    "confidence": p.get("confidence"),
                    "warnings": d.get("warnings", []),
                }
        except Exception as e:  # noqa: BLE001
            rec = {"file": rel, "folder": folder, "ok": False, "http": 0,
                   "error": repr(e)[:300], "secs": round(time.time() - t0, 1)}
        print(f"[{rec['ok'] and 'OK ' or 'ERR'}] {rec.get('secs')}s  {rel}", flush=True)
        return rec


async def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    files = discover()
    print(f"discovered {len(files)} files", flush=True)
    results = []
    if os.path.exists(RESULTS_JSON):
        try:
            results = json.load(open(RESULTS_JSON, encoding="utf-8"))
        except Exception:
            results = []
    done = {r["file"] for r in results}
    token = login()
    sem = asyncio.Semaphore(CONCURRENCY)
    async with httpx.AsyncClient() as client:
        tasks = [recognize(client, sem, token, p, done) for p in files]
        for i, coro in enumerate(asyncio.as_completed(tasks), 1):
            rec = await coro
            if rec is None:
                continue
            results.append(rec)
            if i % 5 == 0:
                json.dump(results, open(RESULTS_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump(results, open(RESULTS_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    _report(results, build_org_map())
    _summary(results)


def _summary(results):
    ok = [r for r in results if r.get("ok")]
    err = [r for r in results if not r.get("ok")]
    inv = [r for r in ok if r.get("is_invoice")]
    noninv = [r for r in ok if r.get("is_invoice") is False]
    no_amount = [r for r in inv if r.get("amount") in (None, 0)]
    print("\n==== SUMMARY ====", flush=True)
    print(f"total={len(results)} ok={len(ok)} errors={len(err)}", flush=True)
    print(f"  invoices={len(inv)} non-invoices={len(noninv)} invoices_without_amount={len(no_amount)}", flush=True)
    from collections import Counter
    dt = Counter((r.get("document_type") or "—") for r in ok)
    print("  document_type:", dict(dt), flush=True)
    if err:
        print("  ERROR files:", flush=True)
        for r in err:
            print(f"    {r['http']} {r['file']} :: {r.get('error','')[:120]}", flush=True)


def _esc(s):
    return ("" if s is None else str(s)).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _report(results, org_map=None):
    org_map = org_map or {}
    rows = []
    matched = 0
    for r in sorted(results, key=lambda x: (x.get("folder", ""), x.get("file", ""))):
        cls = "ok" if r.get("ok") else "err"
        inv = r.get("is_invoice")
        invcell = "—" if inv is None else ("✅" if inv else "❌ не счёт")
        warn = "; ".join(r.get("warnings") or [])
        our_org = org_map.get(_digits(r.get("buyer_inn")))
        if our_org:
            matched += 1
        org_cell = _esc(our_org) if our_org else "<span style='color:#cf1322'>— не найдена</span>"
        rows.append(
            f"<tr class='{cls}'><td>{_esc(r.get('file'))}</td>"
            f"<td>{invcell}<br><small>{_esc(r.get('document_type'))}</small></td>"
            f"<td><b>{org_cell}</b><br><small>ИНН пок.: {_esc(r.get('buyer_inn'))}</small></td>"
            f"<td class='r'>{_esc(r.get('amount'))}</td>"
            f"<td>{_esc(r.get('counterparty'))}<br><small>ИНН пост.: {_esc(r.get('supplier_inn'))}</small></td>"
            f"<td>{_esc(r.get('payment_purpose'))}</td>"
            f"<td>{_esc(r.get('summary'))}</td>"
            f"<td>{_esc(r.get('requirement'))}</td>"
            f"<td>{_esc(r.get('confidence'))}</td>"
            f"<td class='w'>{_esc(warn)}{('<b>'+_esc(r.get('error'))+'</b>') if not r.get('ok') else ''}</td></tr>"
        )
    html = (
        "<!doctype html><meta charset='utf-8'><title>OCR backtest</title>"
        "<style>body{font:13px/1.4 system-ui,Arial;margin:16px}"
        "table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px;vertical-align:top}"
        "th{position:sticky;top:0;background:#1677ff;color:#fff}tr.err{background:#fff1f0}small{color:#888}"
        ".r{text-align:right;white-space:nowrap}.w{color:#cf1322;max-width:240px}</style>"
        "<h2>OCR backtest — " + str(len(results)) + " файлов; организация-плательщик подобрана по ИНН: " + str(matched) + "</h2>"
        "<table><thead><tr><th>Файл</th><th>Тип</th><th>Наша орг. (плательщик)</th><th>Сумма</th><th>Контрагент</th>"
        "<th>Назначение платежа</th><th>Описание</th><th>Требование</th><th>Conf</th><th>Замечания/ошибка</th></tr></thead>"
        "<tbody>" + "".join(rows) + "</tbody></table>"
    )
    open(REPORT_HTML, "w", encoding="utf-8").write(html)
    print(f"report -> {REPORT_HTML}", flush=True)


if __name__ == "__main__":
    # --report: перегенерировать report.html из существующих results.json (без вызовов OCR)
    if len(sys.argv) > 1 and sys.argv[1] == "--report":
        _results = json.load(open(RESULTS_JSON, encoding="utf-8"))
        _report(_results, build_org_map())
        _summary(_results)
        sys.exit(0)
    sys.exit(asyncio.run(main()))
