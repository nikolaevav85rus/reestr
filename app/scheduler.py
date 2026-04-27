"""
Фоновые задачи (APScheduler).
Крон 17:00 МСК — уведомления инициаторам о неоплаченных заявках на сегодня.
"""
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from datetime import date, datetime, timezone, timedelta
from sqlalchemy import select

from app.db.database import AsyncSessionLocal
from app.models.request import PaymentRequest, PaymentStatus
from app.models.notification import Notification

scheduler = AsyncIOScheduler(timezone="Europe/Moscow")


async def notify_unpaid_eod():
    """Находит все неоплаченные заявки на сегодня и уведомляет инициаторов."""
    today = date.today()
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(PaymentRequest).where(
                PaymentRequest.payment_date == today,
                PaymentRequest.payment_status != PaymentStatus.PAID,
            )
        )
        requests = res.scalars().all()

        status_labels = {
            "REJECTED":      "отклонена",
            "CLARIFICATION": "требует уточнения",
            "POSTPONED":     "перенесена",
            "SUSPENDED":     "отложена (недостаточно средств)",
            "PENDING":       "не была рассмотрена сегодня",
            "PENDING_GATE":  "не получила разрешения шлюза",
            "MEMO_REQUIRED": "ожидает обоснования вне бюджета",
            "PENDING_MEMO":  "ожидает утверждения Директора",
            "APPROVED":      "не была оплачена сегодня",
            "DRAFT":         "осталась в черновике",
        }

        for req in requests:
            label = status_labels.get(req.approval_status, "не оплачена")
            text = (
                f"Заявка на {today.strftime('%d.%m.%Y')}: "
                f"{req.counterparty}, {req.amount:,.0f} ₽ — {label}."
            )
            db.add(Notification(
                user_id=req.creator_id,
                request_id=req.id,
                text=text,
                type="EOD_UNPAID",
            ))

        if requests:
            await db.commit()


def start_scheduler():
    scheduler.add_job(
        notify_unpaid_eod,
        trigger=CronTrigger(hour=17, minute=0, timezone="Europe/Moscow"),
        id="eod_unpaid_notify",
        replace_existing=True,
    )
    scheduler.start()


def stop_scheduler():
    scheduler.shutdown(wait=False)
