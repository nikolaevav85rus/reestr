from fastapi import APIRouter, Depends, HTTPException
from app.api.deps import PermissionChecker
from app.models.user import User
from app.services.app_settings import get_settings, save_settings

router = APIRouter()

@router.get("/")
async def read_settings(
    current_user: User = Depends(PermissionChecker("rbac_manage"))
):
    return get_settings()

@router.put("/")
async def update_settings(
    data: dict,
    current_user: User = Depends(PermissionChecker("rbac_manage"))
):
    try:
        return save_settings(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
