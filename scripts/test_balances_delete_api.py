"""
Regression checks for DELETE /api/v1/balances/accounts/{account_id}.

Run:
    venv\\Scripts\\python.exe scripts\\test_balances_delete_api.py
"""

import asyncio
import os
import sys
import uuid
from datetime import date

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
            raise RuntimeError("Нет организаций в БД для теста.")

        perm_dict_delete = (
            await db.execute(select(Permission).where(Permission.name == "dict_delete"))
        ).scalar_one_or_none()
        if not perm_dict_delete:
            raise RuntimeError("Не найдено permission dict_delete.")

        role_allow = Role(
            name=f"TMP_BAL_DELETE_ALLOW_{suffix}",
            label=f"TMP Balance Delete Allow {suffix}",
            color="blue",
        )
        role_allow.permissions = [perm_dict_delete]

        role_deny = Role(
            name=f"TMP_BAL_DELETE_DENY_{suffix}",
            label=f"TMP Balance Delete Deny {suffix}",
            color="gray",
        )
        db.add_all([role_allow, role_deny])
        await db.flush()

        user_allow = User(
            ad_login=f"tmp_bal_delete_allow_{suffix}",
            full_name=f"TMP Balance Delete Allow {suffix}",
            hashed_password=get_password_hash(PASSWORD),
            is_active=True,
            role_id=role_allow.id,
        )
        user_deny = User(
            ad_login=f"tmp_bal_delete_deny_{suffix}",
            full_name=f"TMP Balance Delete Deny {suffix}",
            hashed_password=get_password_hash(PASSWORD),
            is_active=True,
            role_id=role_deny.id,
        )
        db.add_all([user_allow, user_deny])
        await db.flush()

        account_free = BankAccount(
            organization_id=org.id,
            bank_name="TMP Delete Free",
            account_number=f"40702810{suffix}01",
            is_active=True,
        )
        account_with_balance = BankAccount(
            organization_id=org.id,
            bank_name="TMP Delete Used",
            account_number=f"40702810{suffix}02",
            is_active=True,
        )
        db.add_all([account_free, account_with_balance])
        await db.flush()

        balance = DailyAccountBalance(
            balance_date=date.today(),
            organization_id=org.id,
            bank_account_id=account_with_balance.id,
            amount=1000.0,
            created_by_id=user_allow.id,
            updated_by_id=user_allow.id,
        )
        db.add(balance)
        await db.commit()

        ctx.update(
            {
                "role_allow_id": role_allow.id,
                "role_deny_id": role_deny.id,
                "user_allow_id": user_allow.id,
                "user_deny_id": user_deny.id,
                "user_allow_login": user_allow.ad_login,
                "user_deny_login": user_deny.ad_login,
                "account_free_id": account_free.id,
                "account_with_balance_id": account_with_balance.id,
            }
        )
    return ctx


async def cleanup_test_data(ctx):
    async with AsyncSessionLocal() as db:
        await db.execute(
            delete(DailyAccountBalance).where(
                DailyAccountBalance.bank_account_id.in_(
                    [ctx["account_free_id"], ctx["account_with_balance_id"]]
                )
            )
        )
        await db.execute(
            delete(BankAccount).where(
                BankAccount.id.in_([ctx["account_free_id"], ctx["account_with_balance_id"]])
            )
        )
        await db.execute(delete(User).where(User.id.in_([ctx["user_allow_id"], ctx["user_deny_id"]])))
        await db.execute(delete(Role).where(Role.id.in_([ctx["role_allow_id"], ctx["role_deny_id"]])))
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
            deny_login = await login(client, ctx["user_deny_login"], PASSWORD)
            allow_login = await login(client, ctx["user_allow_login"], PASSWORD)

            results.append(
                print_result("Логин пользователя без dict_delete", deny_login.status_code == 200, str(deny_login.status_code))
            )
            results.append(
                print_result("Логин пользователя с dict_delete", allow_login.status_code == 200, str(allow_login.status_code))
            )

            if deny_login.status_code != 200 or allow_login.status_code != 200:
                return results

            deny_token = deny_login.json()["access_token"]
            allow_token = allow_login.json()["access_token"]
            deny_headers = {"Authorization": f"Bearer {deny_token}"}
            allow_headers = {"Authorization": f"Bearer {allow_token}"}

            resp_forbidden = await client.delete(
                f"/api/v1/balances/accounts/{ctx['account_free_id']}",
                headers=deny_headers,
            )
            results.append(
                print_result(
                    "DELETE без dict_delete -> 403",
                    resp_forbidden.status_code == 403,
                    str(resp_forbidden.status_code),
                )
            )

            resp_has_balance = await client.delete(
                f"/api/v1/balances/accounts/{ctx['account_with_balance_id']}",
                headers=allow_headers,
            )
            expected_detail = "Нельзя удалить расчетный счет: по нему есть остатки. Отключите счет."
            results.append(
                print_result(
                    "DELETE счета с остатками -> 400",
                    resp_has_balance.status_code == 400 and resp_has_balance.json().get("detail") == expected_detail,
                    f"{resp_has_balance.status_code}",
                )
            )

            resp_not_found = await client.delete(
                f"/api/v1/balances/accounts/{uuid.uuid4()}",
                headers=allow_headers,
            )
            results.append(
                print_result(
                    "DELETE несуществующего счета -> 404",
                    resp_not_found.status_code == 404,
                    str(resp_not_found.status_code),
                )
            )

            resp_deleted = await client.delete(
                f"/api/v1/balances/accounts/{ctx['account_free_id']}",
                headers=allow_headers,
            )
            results.append(
                print_result(
                    "DELETE счета без остатков -> 200",
                    resp_deleted.status_code == 200 and resp_deleted.json().get("ok") is True,
                    str(resp_deleted.status_code),
                )
            )

            async with AsyncSessionLocal() as db:
                deleted_obj = await db.get(BankAccount, ctx["account_free_id"])
            results.append(
                print_result("Счет действительно удален из БД", deleted_obj is None)
            )
    finally:
        await cleanup_test_data(ctx)

    return results


if __name__ == "__main__":
    print("=== DELETE /balances/accounts regression ===")
    final_results = asyncio.run(run())
    passed = sum(1 for ok in final_results if ok)
    total = len(final_results)
    failed = total - passed
    print(f"RESULT: passed={passed}, failed={failed}, total={total}")
    raise SystemExit(1 if failed else 0)
