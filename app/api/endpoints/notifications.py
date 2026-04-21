from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from uuid import UUID
from datetime import datetime
from typing import List, Optional

from app.api.deps import get_db, PermissionChecker
from app.models.user import User
from app.services import notification_service as notif_svc

router = APIRouter()


class NotificationOut(BaseModel):
    id: UUID
    request_id: Optional[UUID]
    text: str
    type: str
    is_read: bool
    created_at: datetime

    class Config:
        from_attributes = True


class UnreadCountOut(BaseModel):
    count: int


@router.get("/", response_model=List[NotificationOut])
async def get_notifications(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_view_own")),
):
    return await notif_svc.get_all_notifications(db, current_user.id)


@router.get("/unread_count", response_model=UnreadCountOut)
async def get_unread_count(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_view_own")),
):
    notifications = await notif_svc.get_unread_notifications(db, current_user.id)
    return {"count": len(notifications)}


@router.post("/{notification_id}/read")
async def mark_notification_read(
    notification_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_view_own")),
):
    await notif_svc.mark_read(db, notification_id, current_user.id)
    await db.commit()
    return {"ok": True}


@router.post("/read_all")
async def mark_all_notifications_read(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(PermissionChecker("req_view_own")),
):
    count = await notif_svc.mark_all_read(db, current_user.id)
    await db.commit()
    return {"marked": count}
