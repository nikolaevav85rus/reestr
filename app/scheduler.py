"""
Фоновые задачи (APScheduler).
Крон 17:00 МСК — уведомления инициаторам о неоплаченных заявках на сегодня.

Планировщик может работать двумя способами:
  * внутри процесса API (по умолчанию, RUN_SCHEDULER_IN_APP=true) — см. app/main.py;
  * как отдельный процесс в проде:  python -m app.scheduler
    (тогда в API ставят RUN_SCHEDULER_IN_APP=false).

ВНИМАНИЕ: не запускайте оба режима одновременно — задача задвоится
(уведомления будут отправлены дважды).
"""
import asyncio
import logging
import signal

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


async def _run_standalone() -> None:
    """Запускает планировщик в собственном asyncio-цикле и блокируется навсегда.

    Используется только при `python -m app.scheduler`. Корректно завершается
    по SIGINT/SIGTERM (на платформах, где они поддерживаются).
    """
    logger = logging.getLogger(__name__)

    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    def _request_stop() -> None:
        logger.info("Получен сигнал остановки планировщика.")
        stop_event.set()

    # add_signal_handler доступен не на всех платформах (на Windows для
    # ProactorEventLoop его нет) — деградируем до KeyboardInterrupt.
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _request_stop)
        except (NotImplementedError, AttributeError):
            pass

    start_scheduler()
    logger.info("Планировщик запущен как отдельный процесс. Ожидание задач...")

    try:
        await stop_event.wait()
    finally:
        stop_scheduler()
        logger.info("Планировщик остановлен.")


if __name__ == "__main__":
    # Локальная настройка логирования, чтобы отдельный процесс был информативным.
    from app.core.logging_config import configure_logging

    configure_logging()
    try:
        asyncio.run(_run_standalone())
    except KeyboardInterrupt:
        # Fallback для платформ без add_signal_handler (Windows).
        pass
