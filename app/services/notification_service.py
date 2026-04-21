from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from typing import Optional

from app.models.notification import Notification


async def create_notification(
    db: AsyncSession,
    user_id: UUID,
    text: str,
    notif_type: str,
    request_id: Optional[UUID] = None,
) -> Notification:
    n = Notification(
        user_id=user_id,
        request_id=request_id,
        text=text,
        type=notif_type,
    )
    db.add(n)
    await db.flush()
    return n


async def get_unread_notifications(db: AsyncSession, user_id: UUID):
    res = await db.execute(
        select(Notification)
        .where(Notification.user_id == user_id, Notification.is_read == False)
        .order_by(Notification.created_at.desc())
        .limit(50)
    )
    return res.scalars().all()


async def get_all_notifications(db: AsyncSession, user_id: UUID, limit: int = 50):
    res = await db.execute(
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
        .limit(limit)
    )
    return res.scalars().all()


async def mark_read(db: AsyncSession, notification_id: UUID, user_id: UUID) -> bool:
    res = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == user_id,
        )
    )
    n = res.scalar_one_or_none()
    if not n:
        return False
    n.is_read = True
    await db.flush()
    return True


async def mark_all_read(db: AsyncSession, user_id: UUID) -> int:
    res = await db.execute(
        select(Notification).where(
            Notification.user_id == user_id,
            Notification.is_read == False,
        )
    )
    notifications = res.scalars().all()
    for n in notifications:
        n.is_read = True
    await db.flush()
    return len(notifications)
