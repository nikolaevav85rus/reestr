"""
Regression checks for:
- PUT /api/v1/balances/daily/{balance_id}
- DELETE /api/v1/balances/daily/{balance_id}
- GET /api/v1/balances/daily response fields

Run:
    venv\\Scripts\\python.exe scripts\\test_balances_daily_crud_api.py
"""

import asyncio
import os
import sys
import uuid
from datetime import date, timedelta

import httpx
from sqlalchemy import delete, select

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.security import get_password_hash
from app.db.database import AsyncSessionLocal
from app.main import app
from app.models.balance import BankAccount, DailyAccountBalance
from app.models.organization import Organization
from app.models.user import Permission, Role, User


PASS = "[OK]"
FAIL = "[FAIL]"
PASSWORD = "Test1234!"
CONFLICT_DETAIL = "Остаток на указанную дату и расчетный счет уже существует"


def print_result(label: str, ok: bool, detail: str = "") -> bool:
    status = PASS if ok else FAIL
    suffix = f" [{detail}]" if detail else ""
    print(f"{status} {label}{suffix}")
    return ok


async def create_test_data():
    suffix = uuid.uuid4().hex[:8]
    ctx = {"suffix": suffix}

    async with AsyncSessionLocal() as db:
        org = (await db.execute(select(Organization).order_by(Organization.name).limit(1))).scalar_one_or_none()
        if not org:
            raise RuntimeError("No organizations found for test setup.")

        perm_manage = (
            await db.execute(select(Permission).where(Permission.name == "account_balance_manage"))
        ).scalar_one_or_none()
        if not perm_manage:
            raise RuntimeError("Permission account_balance_manage not found.")

        perm_view = (
            await db.execute(select(Permission).where(Permission.name == "account_balance_view"))
        ).scalar_one_or_none()
        if not perm_view:
            raise RuntimeError("Permission account_balance_view not found.")

        role_manage = Role(
            name=f"TMP_BAL_DAILY_MANAGE_{suffix}",
            label=f"TMP Bal Daily Manage {suffix}",
            color="blue",
        )
        role_manage.permissions = [perm_manage, perm_view]

        role_view_only = Role(
            name=f"TMP_BAL_DAILY_VIEW_{suffix}",
            label=f"TMP Bal Daily View {suffix}",
            color="gray",
        )
        role_view_only.permissions = [perm_view]

        db.add_all([role_manage, role_view_only])
        await db.flush()

        user_manage = User(
            ad_login=f"tmp_bal_daily_manage_{suffix}",
            full_name=f"TMP Bal Daily Manage {suffix}",
            hashed_password=get_password_hash(PASSWORD),
            is_active=True,
            role_id=role_manage.id,
        )
        user_view = User(
            ad_login=f"tmp_bal_daily_view_{suffix}",
            full_name=f"TMP Bal Daily View {suffix}",
            hashed_password=get_password_hash(PASSWORD),
            is_active=True,
            role_id=role_view_only.id,
        )
        db.add_all([user_manage, user_view])
        await db.flush()

        account_a = BankAccount(
            organization_id=org.id,
            bank_name="TMP Daily Account A",
            account_number=f"40702810{suffix}31",
            is_active=True,
        )
        account_b = BankAccount(
            organization_id=org.id,
            bank_name="TMP Daily Account B",
            account_number=f"40702810{suffix}32",
            is_active=True,
        )
        db.add_all([account_a, account_b])
        await db.flush()

        base_date = date.today()
        balance_edit = DailyAccountBalance(
            balance_date=base_date,
            organization_id=org.id,
            bank_account_id=account_a.id,
            amount=100.0,
            created_by_id=user_manage.id,
            updated_by_id=user_manage.id,
        )
        balance_conflict = DailyAccountBalance(
            balance_date=base_date + timedelta(days=1),
            organization_id=org.id,
            bank_account_id=account_b.id,
            amount=500.0,
            created_by_id=user_manage.id,
            updated_by_id=user_manage.id,
        )
        db.add_all([balance_edit, balance_conflict])
        await db.commit()

        ctx.update(
            {
                "org_id": org.id,
                "role_manage_id": role_manage.id,
                "role_view_id": role_view_only.id,
                "user_manage_id": user_manage.id,
                "user_view_id": user_view.id,
                "user_manage_login": user_manage.ad_login,
                "user_view_login": user_view.ad_login,
                "account_a_id": account_a.id,
                "account_b_id": account_b.id,
                "balance_edit_id": balance_edit.id,
                "balance_conflict_id": balance_conflict.id,
                "base_date": base_date.isoformat(),
                "conflict_date": (base_date + timedelta(days=1)).isoformat(),
                "moved_date": (base_date + timedelta(days=2)).isoformat(),
            }
        )
    return ctx


async def cleanup_test_data(ctx):
    async with AsyncSessionLocal() as db:
        await db.execute(
            delete(DailyAccountBalance).where(
                DailyAccountBalance.id.in_([ctx["balance_edit_id"], ctx["balance_conflict_id"]])
            )
        )
        await db.execute(
            delete(BankAccount).where(BankAccount.id.in_([ctx["account_a_id"], ctx["account_b_id"]]))
        )
        await db.execute(delete(User).where(User.id.in_([ctx["user_manage_id"], ctx["user_view_id"]])))
        await db.execute(delete(Role).where(Role.id.in_([ctx["role_manage_id"], ctx["role_view_id"]])))
        await db.commit()


async def login(client: httpx.AsyncClient, username: str, password: str):
    response = await client.post(
        "/api/v1/auth/login",
        data={"username": username, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    return response


async def run():
    results = []
    ctx = await create_test_data()
    transport = httpx.ASGITransport(app=app)

    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            view_login = await login(client, ctx["user_view_login"], PASSWORD)
            manage_login = await login(client, ctx["user_manage_login"], PASSWORD)

            results.append(
                print_result("Login view-only user", view_login.status_code == 200, str(view_login.status_code))
            )
            results.append(
                print_result("Login manage user", manage_login.status_code == 200, str(manage_login.status_code))
            )

            if view_login.status_code != 200 or manage_login.status_code != 200:
                return results

            view_token = view_login.json()["access_token"]
            manage_token = manage_login.json()["access_token"]
            view_headers = {"Authorization": f"Bearer {view_token}"}
            manage_headers = {"Authorization": f"Bearer {manage_token}"}

            resp_forbidden_put = await client.put(
                f"/api/v1/balances/daily/{ctx['balance_edit_id']}",
                headers=view_headers,
                json={
                    "balance_date": ctx["base_date"],
                    "bank_account_id": str(ctx["account_a_id"]),
                    "amount": 111.11,
                },
            )
            results.append(
                print_result("PUT daily without manage -> 403", resp_forbidden_put.status_code == 403, str(resp_forbidden_put.status_code))
            )

            resp_forbidden_delete = await client.delete(
                f"/api/v1/balances/daily/{ctx['balance_edit_id']}",
                headers=view_headers,
            )
            results.append(
                print_result(
                    "DELETE daily without manage -> 403",
                    resp_forbidden_delete.status_code == 403,
                    str(resp_forbidden_delete.status_code),
                )
            )

            resp_amount_update = await client.put(
                f"/api/v1/balances/daily/{ctx['balance_edit_id']}",
                headers=manage_headers,
                json={
                    "balance_date": ctx["base_date"],
                    "bank_account_id": str(ctx["account_a_id"]),
                    "amount": 111.11,
                },
            )
            amount_payload = resp_amount_update.json() if resp_amount_update.status_code == 200 else {}
            results.append(
                print_result(
                    "Manage user updates amount",
                    resp_amount_update.status_code == 200 and abs(float(amount_payload.get("amount", 0)) - 111.11) < 0.001,
                    str(resp_amount_update.status_code),
                )
            )

            resp_date_account_update = await client.put(
                f"/api/v1/balances/daily/{ctx['balance_edit_id']}",
                headers=manage_headers,
                json={
                    "balance_date": ctx["moved_date"],
                    "bank_account_id": str(ctx["account_b_id"]),
                    "amount": 222.22,
                },
            )
            moved_payload = resp_date_account_update.json() if resp_date_account_update.status_code == 200 else {}
            results.append(
                print_result(
                    "Manage user updates date+account",
                    resp_date_account_update.status_code == 200
                    and moved_payload.get("balance_date") == ctx["moved_date"]
                    and moved_payload.get("bank_account_id") == str(ctx["account_b_id"])
                    and abs(float(moved_payload.get("amount", 0)) - 222.22) < 0.001,
                    str(resp_date_account_update.status_code),
                )
            )

            resp_conflict = await client.put(
                f"/api/v1/balances/daily/{ctx['balance_edit_id']}",
                headers=manage_headers,
                json={
                    "balance_date": ctx["conflict_date"],
                    "bank_account_id": str(ctx["account_b_id"]),
                    "amount": 333.33,
                },
            )
            results.append(
                print_result(
                    "PUT daily unique conflict -> 400",
                    resp_conflict.status_code == 400 and resp_conflict.json().get("detail") == CONFLICT_DETAIL,
                    str(resp_conflict.status_code),
                )
            )

            resp_get_daily = await client.get(
                f"/api/v1/balances/daily?date_from={ctx['base_date']}&date_to={ctx['moved_date']}&organization_id={ctx['org_id']}",
                headers=manage_headers,
            )
            rows = resp_get_daily.json() if resp_get_daily.status_code == 200 else []
            target_row = next((row for row in rows if row.get("id") == str(ctx["balance_edit_id"])), None)
            has_required_fields = bool(
                target_row
                and target_row.get("id")
                and target_row.get("balance_date")
                and target_row.get("opening_balance") is not None
                and isinstance(target_row.get("organization"), dict)
                and isinstance(target_row.get("bank_account"), dict)
            )
            results.append(
                print_result(
                    "GET /balances/daily returns id/date/opening_balance/organization/bank_account",
                    resp_get_daily.status_code == 200 and has_required_fields,
                    str(resp_get_daily.status_code),
                )
            )

            resp_delete = await client.delete(
                f"/api/v1/balances/daily/{ctx['balance_edit_id']}",
                headers=manage_headers,
            )
            results.append(
                print_result(
                    "DELETE daily removes record",
                    resp_delete.status_code == 200 and resp_delete.json().get("ok") is True,
                    str(resp_delete.status_code),
                )
            )

            async with AsyncSessionLocal() as db:
                deleted_obj = await db.get(DailyAccountBalance, ctx["balance_edit_id"])
            results.append(print_result("Deleted daily record is absent in DB", deleted_obj is None))

            missing_id = uuid.uuid4()
            resp_put_not_found = await client.put(
                f"/api/v1/balances/daily/{missing_id}",
                headers=manage_headers,
                json={
                    "balance_date": ctx["base_date"],
                    "bank_account_id": str(ctx["account_a_id"]),
                    "amount": 10.0,
                },
            )
            results.append(
                print_result(
                    "PUT daily missing id -> 404",
                    resp_put_not_found.status_code == 404,
                    str(resp_put_not_found.status_code),
                )
            )

            resp_delete_not_found = await client.delete(
                f"/api/v1/balances/daily/{missing_id}",
                headers=manage_headers,
            )
            results.append(
                print_result(
                    "DELETE daily missing id -> 404",
                    resp_delete_not_found.status_code == 404,
                    str(resp_delete_not_found.status_code),
                )
            )
    finally:
        await cleanup_test_data(ctx)

    return results


if __name__ == "__main__":
    print("=== Daily balances PUT/DELETE regression ===")
    final_results = asyncio.run(run())
    passed = sum(1 for ok in final_results if ok)
    total = len(final_results)
    failed = total - passed
    print(f"RESULT: passed={passed}, failed={failed}, total={total}")
    raise SystemExit(1 if failed else 0)
