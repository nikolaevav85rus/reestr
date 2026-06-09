from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from uuid import UUID
from typing import Optional, Iterable

from app.models.notification import Notification
from app.models.user import User, Role
from app.models.user import role_permissions
from app.models.user import Permission


async def get_active_users_with_permission(db: AsyncSession, perm: str) -> list[UUID]:
    """Возвращает id активных пользователей, чья роль имеет указанное право,
    плюс пользователей с ролью-суперадмином. Список уникален."""
    res = await db.execute(
        select(User.id)
        .join(Role, User.role_id == Role.id)
        .outerjoin(role_permissions, role_permissions.c.role_id == Role.id)
        .outerjoin(Permission, Permission.id == role_permissions.c.permission_id)
        .where(
            User.is_active == True,  # noqa: E712
            (Permission.name == perm) | (Role.is_superadmin == True),  # noqa: E712
        )
        .distinct()
    )
    return [row[0] for row in res.all()]


async def fan_out_notification(
    db: AsyncSession,
    recipient_ids: Iterable[UUID],
    text: str,
    notif_type: str,
    request_id: Optional[UUID] = None,
    exclude_user_id: Optional[UUID] = None,
) -> int:
    """Создаёт уведомление каждому уникальному получателю, исключая актора.
    Возвращает число созданных уведомлений."""
    seen: set[UUID] = set()
    created = 0
    for uid in recipient_ids:
        if uid is None or uid == exclude_user_id or uid in seen:
            continue
        seen.add(uid)
        db.add(Notification(user_id=uid, request_id=request_id, text=text, type=notif_type))
        created += 1
    if created:
        await db.flush()
    return created


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


async def get_all_notifications(
    db: AsyncSession, user_id: UUID, limit: int = 50, offset: int = 0
):
    res = await db.execute(
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return res.scalars().all()


async def get_notifications_summary(db: AsyncSession, user_id: UUID) -> dict:
    """Возвращает счётчики уведомлений пользователя: всего и непрочитанных.
    Использует эффективные count-запросы вместо загрузки строк."""
    total = await db.scalar(
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == user_id)
    )
    unread = await db.scalar(
        select(func.count())
        .select_from(Notification)
        .where(
            Notification.user_id == user_id,
            Notification.is_read == False,  # noqa: E712
        )
    )
    return {"total": int(total or 0), "unread": int(unread or 0)}


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
