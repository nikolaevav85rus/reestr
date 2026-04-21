"""
Автоматическое API-тестирование реестра платёжных заявок.
Запуск: python scripts/run_tests.py
"""
import requests
import json
import sys

BASE = "http://127.0.0.1:8080/api/v1"
PASSWORD = "Test1234!"

PASS = "[OK]"
FAIL = "[FAIL]"
SKIP = "[SKIP]"

results = []

def check(label, condition, detail=""):
    status = PASS if condition else FAIL
    results.append((status, label, detail))
    print(f"  {status} {label}" + (f"  [{detail}]" if detail else ""))

def login(username, password=PASSWORD):
    r = requests.post(f"{BASE}/auth/login",
                      data={"username": username, "password": password},
                      headers={"Content-Type": "application/x-www-form-urlencoded"})
    if r.status_code == 200:
        return r.json().get("access_token")
    return None

def auth(token):
    return {"Authorization": f"Bearer {token}"}


print("=" * 60)
print("АВТО-ТЕСТ: Реестр платёжных заявок")
print("=" * 60)

# ─── ЛОГИН ──────────────────────────────────────────────────────────────────
print("\n[1] Авторизация")
t_init  = login("initiator1");  check("initiator1 логин",  bool(t_init))
t_feo   = login("feo1");        check("feo1 логин",        bool(t_feo))
t_cash  = login("cashier1");    check("cashier1 логин",    bool(t_cash))
t_acc   = login("accountant1"); check("accountant1 логин", bool(t_acc))
t_dir   = login("director1");   check("director1 логин",   bool(t_dir))

check("неверный пароль -> 401",
      requests.post(f"{BASE}/auth/login",
                    data={"username": "initiator1", "password": "wrongpassword"},
                    headers={"Content-Type": "application/x-www-form-urlencoded"}
                    ).status_code == 401)

check("без токена -> 401",
      requests.get(f"{BASE}/requests/all").status_code == 401)

if not t_init:
    print("\n[FAIL] Нет токена initiator1 -- прерываем тесты")
    sys.exit(1)

# ─── ПОЛУЧАЕМ СПРАВОЧНИКИ ────────────────────────────────────────────────────
print("\n[2] Справочники")
orgs = requests.get(f"{BASE}/dict/organizations", headers=auth(t_init)).json()
check("GET /dict/organizations", isinstance(orgs, list) and len(orgs) > 0,
      f"{len(orgs)} орг")

budget_items = requests.get(f"{BASE}/dict/budget_items", headers=auth(t_init)).json()
check("GET /dict/budget_items", isinstance(budget_items, list) and len(budget_items) > 0,
      f"{len(budget_items)} статей")

dirs = requests.get(f"{BASE}/dict/directions", headers=auth(t_init)).json()
check("GET /dict/directions", isinstance(dirs, list),
      f"{len(dirs)} направлений")

if not orgs or not budget_items:
    print(f"\n{SKIP} Нет орг или статей ДДС — запустите seed.py")
    sys.exit(1)

org_id = orgs[0]["id"]
bi_id  = budget_items[0]["id"]
dir_id = dirs[0]["id"] if dirs else None

# ─── СОЗДАНИЕ ЗАЯВКИ ─────────────────────────────────────────────────────────
print("\n[3] CRUD заявок (Инициатор)")
payload = {
    "organization_id": org_id,
    "budget_item_id": bi_id,
    "counterparty": "ООО Тест",
    "description": "Авто-тест платёж",
    "amount": 50000,
    "payment_date": "2026-04-15",
}
if dir_id:
    payload["direction_id"] = dir_id

r = requests.post(f"{BASE}/requests/", json=payload, headers=auth(t_init))
check("POST /requests/ (создание черновика)", r.status_code == 200,
      r.json().get("approval_status") if r.status_code == 200 else r.text[:80])

req_id = r.json().get("id") if r.status_code == 200 else None

if req_id:
    # GET /my
    my = requests.get(f"{BASE}/requests/my", headers=auth(t_init)).json()
    check("GET /requests/my содержит заявку", any(x["id"] == req_id for x in my))

    # PUT — редактирование
    r2 = requests.put(f"{BASE}/requests/{req_id}",
                      json={**payload, "amount": 60000}, headers=auth(t_init))
    check("PUT /requests/{id} (редактирование черновика)", r2.status_code == 200,
          str(r2.json().get("amount")) if r2.status_code == 200 else r2.text[:80])

# ─── ПРАВА — СОЗДАНИЕ ЧУЖОЙ ЗАЯВКИ ───────────────────────────────────────────
print("\n[4] Проверка прав (негативные тесты)")

# Казначей не может создать заявку
r = requests.post(f"{BASE}/requests/", json=payload, headers=auth(t_cash))
check("Казначей POST /requests/ -> 403", r.status_code == 403, str(r.status_code))

# Казначей не может approve
if req_id:
    r = requests.post(f"{BASE}/requests/{req_id}/approve", headers=auth(t_cash))
    check("Казначей POST /approve -> 403", r.status_code == 403, str(r.status_code))

    # Казначей не может suspend
    r = requests.post(f"{BASE}/requests/{req_id}/suspend",
                      json={"reason": "тест"}, headers=auth(t_cash))
    check("Казначей POST /suspend -> 403", r.status_code == 403, str(r.status_code))

    # Бухгалтер не может approve
    r = requests.post(f"{BASE}/requests/{req_id}/approve", headers=auth(t_acc))
    check("Бухгалтер POST /approve -> 403", r.status_code == 403, str(r.status_code))

    # Инициатор не может approve чужой (submit своей)
    r = requests.post(f"{BASE}/requests/{req_id}/approve", headers=auth(t_init))
    check("Инициатор POST /approve -> 403", r.status_code == 403, str(r.status_code))

# ─── RLS — ВИДИМОСТЬ ДАННЫХ ───────────────────────────────────────────────────
print("\n[5] Row-Level Security")

# Инициатор видит только свои через /all
all_init = requests.get(f"{BASE}/requests/all", headers=auth(t_init)).json()
check("Инициатор GET /all — только свои заявки",
      isinstance(all_init, list) and all(x.get("creator", {}).get("ad_login") == "initiator1" for x in all_init),
      f"{len(all_init)} заявок")

# ФЭО видит все
all_feo = requests.get(f"{BASE}/requests/all", headers=auth(t_feo)).json()
check("ФЭО GET /all — видит заявки", isinstance(all_feo, list), f"{len(all_feo)} заявок")

# Директор видит только заявки своих орг
all_dir = requests.get(f"{BASE}/requests/all", headers=auth(t_dir)).json()
check("Директор GET /all — возвращает список", isinstance(all_dir, list),
      f"{len(all_dir)} заявок")

# ─── SUBMIT WORKFLOW ──────────────────────────────────────────────────────────
print("\n[6] Workflow — Submit")

if req_id:
    r = requests.post(f"{BASE}/requests/{req_id}/submit", headers=auth(t_init))
    check("POST /submit", r.status_code == 200, r.json().get("approval_status") if r.status_code == 200 else r.text[:80])

    new_status = r.json().get("approval_status") if r.status_code == 200 else None
    check("Статус после submit = PENDING или PENDING_GATE",
          new_status in ("PENDING", "PENDING_GATE"), new_status)

    # Повторный submit — должен упасть
    r2 = requests.post(f"{BASE}/requests/{req_id}/submit", headers=auth(t_init))
    check("Повторный submit -> 400", r2.status_code == 400, str(r2.status_code))

    if new_status == "PENDING_GATE":
        # ФЭО разрешает
        r3 = requests.post(f"{BASE}/requests/{req_id}/approve_gate",
                           json={"reason": "авто-тест разрешение"}, headers=auth(t_feo))
        check("ФЭО approve_gate -> PENDING",
              r3.status_code == 200 and r3.json().get("approval_status") == "PENDING",
              r3.json().get("approval_status") if r3.status_code == 200 else r3.text[:80])

    # ФЭО согласует
    r4 = requests.post(f"{BASE}/requests/{req_id}/approve", headers=auth(t_feo))
    check("ФЭО approve -> APPROVED",
          r4.status_code == 200 and r4.json().get("approval_status") == "APPROVED",
          r4.json().get("approval_status") if r4.status_code == 200 else r4.text[:80])

    # Казначей оплачивает
    r5 = requests.post(f"{BASE}/requests/{req_id}/pay", headers=auth(t_cash))
    check("Казначей pay -> PAID",
          r5.status_code == 200 and r5.json().get("payment_status") == "PAID",
          r5.json().get("payment_status") if r5.status_code == 200 else r5.text[:80])

# ─── НОВАЯ ЗАЯВКА ДЛЯ ДАЛЬНЕЙШИХ ТЕСТОВ ─────────────────────────────────────
print("\n[7] Workflow — Reject / Suspend")

r = requests.post(f"{BASE}/requests/", json=payload, headers=auth(t_init))
req2_id = r.json().get("id") if r.status_code == 200 else None

if req2_id:
    requests.post(f"{BASE}/requests/{req2_id}/submit", headers=auth(t_init))

    # Проверяем статус
    r_get = requests.get(f"{BASE}/requests/all", headers=auth(t_feo)).json()
    req2 = next((x for x in r_get if x["id"] == req2_id), None)
    if req2 and req2["approval_status"] == "PENDING_GATE":
        requests.post(f"{BASE}/requests/{req2_id}/approve_gate",
                      json={"reason": "авто"}, headers=auth(t_feo))

    # ФЭО отклоняет
    r_rej = requests.post(f"{BASE}/requests/{req2_id}/reject",
                          json={"reason": "тест отклонения"}, headers=auth(t_feo))
    check("ФЭО reject -> REJECTED",
          r_rej.status_code == 200 and r_rej.json().get("approval_status") == "REJECTED",
          r_rej.json().get("approval_status") if r_rej.status_code == 200 else r_rej.text[:80])

    # Инициатор делает re-submit из REJECTED? — должно упасть (статус не тот)
    r_re = requests.post(f"{BASE}/requests/{req2_id}/submit", headers=auth(t_init))
    check("Re-submit из REJECTED -> 400", r_re.status_code == 400, str(r_re.status_code))

    # Переводим в clarification
    r3 = requests.post(f"{BASE}/requests/", json=payload, headers=auth(t_init))
    req3_id = r3.json().get("id") if r3.status_code == 200 else None
    if req3_id:
        requests.post(f"{BASE}/requests/{req3_id}/submit", headers=auth(t_init))
        r_get2 = requests.get(f"{BASE}/requests/all", headers=auth(t_feo)).json()
        req3 = next((x for x in r_get2 if x["id"] == req3_id), None)
        if req3 and req3["approval_status"] == "PENDING_GATE":
            requests.post(f"{BASE}/requests/{req3_id}/approve_gate",
                          json={"reason": "авто"}, headers=auth(t_feo))
        r_cl = requests.post(f"{BASE}/requests/{req3_id}/clarify",
                             json={"reason": "уточни пожалуйста"}, headers=auth(t_feo))
        check("ФЭО clarify -> CLARIFICATION",
              r_cl.status_code == 200 and r_cl.json().get("approval_status") == "CLARIFICATION",
              r_cl.json().get("approval_status") if r_cl.status_code == 200 else r_cl.text[:80])

        # Инициатор re-submit из CLARIFICATION
        r_re2 = requests.post(f"{BASE}/requests/{req3_id}/submit", headers=auth(t_init))
        check("Re-submit из CLARIFICATION -> ok",
              r_re2.status_code == 200,
              r_re2.json().get("approval_status") if r_re2.status_code == 200 else r_re2.text[:80])

# ─── SUSPEND / UNSUSPEND ──────────────────────────────────────────────────────
print("\n[8] Suspend / Unsuspend")

r = requests.post(f"{BASE}/requests/", json=payload, headers=auth(t_init))
req_s_id = r.json().get("id") if r.status_code == 200 else None
if req_s_id:
    requests.post(f"{BASE}/requests/{req_s_id}/submit", headers=auth(t_init))
    all_r = requests.get(f"{BASE}/requests/all", headers=auth(t_feo)).json()
    req_s = next((x for x in all_r if x["id"] == req_s_id), None)
    if req_s and req_s["approval_status"] == "PENDING_GATE":
        requests.post(f"{BASE}/requests/{req_s_id}/approve_gate",
                      json={"reason": "авто"}, headers=auth(t_feo))
    requests.post(f"{BASE}/requests/{req_s_id}/approve", headers=auth(t_feo))

    r_sus = requests.post(f"{BASE}/requests/{req_s_id}/suspend",
                          json={"reason": "нет средств"}, headers=auth(t_feo))
    check("ФЭО suspend -> SUSPENDED",
          r_sus.status_code == 200 and r_sus.json().get("approval_status") == "SUSPENDED",
          r_sus.json().get("approval_status") if r_sus.status_code == 200 else r_sus.text[:80])

    # Казначей не может suspend
    r_sus2 = requests.post(f"{BASE}/requests/{req_s_id}/suspend",
                           json={"reason": "тест"}, headers=auth(t_cash))
    check("Казначей suspend -> 403", r_sus2.status_code == 403, str(r_sus2.status_code))

    # Unsuspend
    r_uns = requests.post(f"{BASE}/requests/{req_s_id}/unsuspend",
                          json={"payment_date": "2026-04-22"}, headers=auth(t_feo))
    check("ФЭО unsuspend -> DRAFT",
          r_uns.status_code == 200 and r_uns.json().get("approval_status") == "DRAFT",
          r_uns.json().get("approval_status") if r_uns.status_code == 200 else r_uns.text[:80])

# ─── ДОГОВОР / БЮДЖЕТ ─────────────────────────────────────────────────────────
print("\n[9] Колонки Договор и Бюджет")

r = requests.post(f"{BASE}/requests/", json=payload, headers=auth(t_init))
req_c_id = r.json().get("id") if r.status_code == 200 else None
if req_c_id:
    # Бухгалтер меняет договор
    r_cont = requests.patch(f"{BASE}/requests/{req_c_id}/contract",
                            json={"contract_status": True}, headers=auth(t_acc))
    check("Бухгалтер PATCH /contract -> True",
          r_cont.status_code == 200 and r_cont.json().get("contract_status") is True,
          str(r_cont.json().get("contract_status")) if r_cont.status_code == 200 else r_cont.text[:80])

    # Инициатор не может менять договор
    r_cont2 = requests.patch(f"{BASE}/requests/{req_c_id}/contract",
                             json={"contract_status": False}, headers=auth(t_init))
    check("Инициатор PATCH /contract -> 403", r_cont2.status_code == 403, str(r_cont2.status_code))

    # ФЭО меняет бюджет
    r_bud = requests.patch(f"{BASE}/requests/{req_c_id}/budget",
                           json={"is_budgeted": True}, headers=auth(t_feo))
    check("ФЭО PATCH /budget -> True",
          r_bud.status_code == 200 and r_bud.json().get("is_budgeted") is True,
          str(r_bud.json().get("is_budgeted")) if r_bud.status_code == 200 else r_bud.text[:80])

# ─── УВЕДОМЛЕНИЯ ─────────────────────────────────────────────────────────────
print("\n[10] Уведомления")

r_notif = requests.get(f"{BASE}/notifications/", headers=auth(t_init))
check("GET /notifications/ (инициатор)", r_notif.status_code == 200,
      f"{len(r_notif.json())} уведомлений" if r_notif.status_code == 200 else r_notif.text[:80])

r_count = requests.get(f"{BASE}/notifications/unread_count", headers=auth(t_init))
check("GET /notifications/unread_count",
      r_count.status_code == 200 and "count" in r_count.json(),
      str(r_count.json().get("count")) if r_count.status_code == 200 else r_count.text[:80])

r_notif_cash = requests.get(f"{BASE}/notifications/", headers=auth(t_cash))
check("GET /notifications/ (казначей — есть req_view_own)",
      r_notif_cash.status_code == 200, str(r_notif_cash.status_code))

# ─── ИТОГ ─────────────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
passed = sum(1 for s, _, _ in results if s == PASS)
failed = sum(1 for s, _, _ in results if s == FAIL)
print(f"ИТОГ: {PASS} {passed} прошло  {FAIL} {failed} упало  из {len(results)} тестов")
print("=" * 60)

if failed:
    print("\nУПАВШИЕ ТЕСТЫ:")
    for s, label, detail in results:
        if s == FAIL:
            print(f"  {FAIL} {label}  [{detail}]")
