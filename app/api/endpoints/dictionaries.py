from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError
from uuid import UUID

from app.api.deps import get_db, PermissionChecker
from app.models.organization import Organization, Cluster, PaymentGroup
from app.models.direction import Direction, DirectionCategory
from app.models.user import Permission, Role, User
from app.models.budget import BudgetItem
from app.models.request import PaymentRequest

from app.schemas.organization import (
    OrganizationCreate, OrganizationUpdate,
    ClusterCreate, ClusterUpdate,
    PaymentGroupCreate, PaymentGroupUpdate,
)
from app.schemas.direction import (
    DirectionCreate, DirectionUpdate,
    DirectionCategoryCreate, DirectionCategoryUpdate,
)
from app.schemas.budget import BudgetItemCreate, BudgetItemUpdate
from app.schemas.user import RoleCreate, RoleBasicUpdate, RolePermissionsUpdate

router = APIRouter()


async def _ensure_exists(db: AsyncSession, model, obj_id, detail: str) -> None:
    """Проверяет, что строка по FK существует. Иначе 400 (вместо FK -> 500)."""
    if obj_id is None:
        return
    found = await db.get(model, obj_id)
    if not found:
        raise HTTPException(status_code=400, detail=detail)

# --- КЛАСТЕРЫ (Clusters) ---
@router.get("/clusters")
async def get_clusters(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Cluster).order_by(Cluster.name))
    return result.scalars().all()

@router.post("/clusters")
async def create_cluster(data: ClusterCreate, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("dict_edit"))):
    if data.head_id is not None:
        await _ensure_exists(db, User, data.head_id, "Руководитель кластера не найден")
    new_obj = Cluster(name=data.name, head_id=data.head_id, is_active=data.is_active)
    db.add(new_obj)
    await db.commit()
    await db.refresh(new_obj)
    return new_obj

@router.put("/clusters/{id}")
async def update_cluster(id: UUID, data: ClusterUpdate, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("dict_edit"))):
    obj = await db.get(Cluster, id)
    if not obj:
        raise HTTPException(status_code=404, detail="Кластер не найден")
    update_data = data.model_dump(exclude_unset=True)
    if 'head_id' in update_data and update_data['head_id'] is not None:
        await _ensure_exists(db, User, update_data['head_id'], "Руководитель кластера не найден")
    for k, v in update_data.items():
        setattr(obj, k, v)
    await db.commit()
    return obj

@router.delete("/clusters/{id}")
async def delete_cluster(id: UUID, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("dict_delete"))):
    # Мягкая проверка на привязанные организации
    org_check = await db.execute(select(Organization).where(Organization.cluster_id == id).limit(1))
    if org_check.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Нельзя удалить кластер: к нему привязаны организации")
        
    # Жесткое удаление с отловом ошибок БД
    try:
        await db.execute(delete(Cluster).where(Cluster.id == id))
        await db.commit()
        return {"ok": True}
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Нельзя удалить кластер: в системе есть связанные с ним данные")

# --- ОРГАНИЗАЦИИ (Organizations) ---
@router.get("/organizations")
async def get_organizations(search: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    query = select(Organization).order_by(Organization.name)
    if search: 
        query = query.where(Organization.name.ilike(f"%{search}%"))
    result = await db.execute(query)
    return result.scalars().all()

@router.post("/organizations")
async def create_org(data: OrganizationCreate, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("dict_edit"))):
    # Проверяем FK, влияющие на видимость/авторизацию.
    await _ensure_exists(db, PaymentGroup, data.payment_group_id, "Группа оплаты не найдена")
    await _ensure_exists(db, Cluster, data.cluster_id, "Кластер не найден")
    await _ensure_exists(db, User, data.director_id, "Директор не найден")
    new_org = Organization(**data.model_dump())
    db.add(new_org)
    await db.commit()
    await db.refresh(new_org)
    return new_org

@router.put("/organizations/{id}")
async def update_org(id: UUID, data: OrganizationUpdate, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("dict_edit"))):
    obj = await db.get(Organization, id)
    if not obj:
        raise HTTPException(status_code=404, detail="Организация не найдена")
    update_data = data.model_dump(exclude_unset=True)
    if 'payment_group_id' in update_data and update_data['payment_group_id'] is not None:
        await _ensure_exists(db, PaymentGroup, update_data['payment_group_id'], "Группа оплаты не найдена")
    if 'cluster_id' in update_data and update_data['cluster_id'] is not None:
        await _ensure_exists(db, Cluster, update_data['cluster_id'], "Кластер не найден")
    if 'director_id' in update_data and update_data['director_id'] is not None:
        await _ensure_exists(db, User, update_data['director_id'], "Директор не найден")
    for k, v in update_data.items():
        setattr(obj, k, v)
    await db.commit()
    return obj

@router.delete("/organizations/{id}")
async def delete_org(id: UUID, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("dict_delete"))):
    try:
        await db.execute(delete(Organization).where(Organization.id == id))
        await db.commit()
        return {"ok": True}
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Нельзя удалить организацию: по ней уже есть документы или заявки")

# --- ГРУППЫ ОПЛАТЫ (Payment Groups) ---
@router.get("/payment_groups")
async def get_groups(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(PaymentGroup).order_by(PaymentGroup.name))
    return res.scalars().all()

@router.post("/payment_groups")
async def create_group(data: PaymentGroupCreate, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("dict_edit"))):
    new_obj = PaymentGroup(name=data.name, is_active=data.is_active)
    db.add(new_obj)
    await db.commit()
    await db.refresh(new_obj)
    return new_obj

@router.put("/payment_groups/{id}")
async def update_group(id: UUID, data: PaymentGroupUpdate, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("dict_edit"))):
    obj = await db.get(PaymentGroup, id)
    if not obj:
        raise HTTPException(status_code=404, detail="Группа оплаты не найдена")
    update_data = data.model_dump(exclude_unset=True)
    if 'name' in update_data and update_data['name'] is not None:
        obj.name = update_data['name']
    if 'is_active' in update_data and update_data['is_active'] is not None:
        obj.is_active = update_data['is_active']
    await db.commit()
    return obj

@router.delete("/payment_groups/{id}")
async def delete_group(id: UUID, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("dict_delete"))):
    # Мягкая проверка на привязанные организации
    org_check = await db.execute(select(Organization).where(Organization.payment_group_id == id).limit(1))
    if org_check.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Нельзя удалить группу: к ней привязаны организации")
        
    # Жесткое удаление с отловом ошибки платежного календаря (payment_calendar_payment_group_id_fkey)
    try:
        await db.execute(delete(PaymentGroup).where(PaymentGroup.id == id))
        await db.commit()
        return {"ok": True}
    except IntegrityError:
        await db.rollback() # Обязательно откатываем транзакцию при ошибке
        raise HTTPException(status_code=400, detail="Нельзя удалить группу: она уже используется в платежном календаре")

# --- ПОДРАЗДЕЛЕНИЯ (Directions / CFO) ---
# --- КАТЕГОРИИ ЦФО ---
@router.get("/direction_categories")
async def get_direction_categories(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(DirectionCategory).order_by(DirectionCategory.name))
    return res.scalars().all()

@router.post("/direction_categories")
async def create_direction_category(data: DirectionCategoryCreate, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("dict_edit"))):
    new_obj = DirectionCategory(name=data.name)
    db.add(new_obj)
    try:
        await db.commit()
        await db.refresh(new_obj)
        return new_obj
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Категория с таким названием уже существует")

@router.put("/direction_categories/{id}")
async def update_direction_category(id: UUID, data: DirectionCategoryUpdate, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("dict_edit"))):
    obj = await db.get(DirectionCategory, id)
    if not obj:
        raise HTTPException(status_code=404, detail="Категория не найдена")
    if data.name is not None:
        obj.name = data.name
    await db.commit()
    await db.refresh(obj)
    return obj

@router.delete("/direction_categories/{id}")
async def delete_direction_category(id: UUID, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("dict_delete"))):
    used = await db.execute(select(Direction).where(Direction.category_id == id).limit(1))
    if used.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Категория используется в ЦФО")
    await db.execute(delete(DirectionCategory).where(DirectionCategory.id == id))
    await db.commit()
    return {"ok": True}

# --- ЦФО ---
@router.get("/directions")
async def get_directions(db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(Direction).options(selectinload(Direction.category)).order_by(Direction.name)
    )
    return res.scalars().all()

@router.post("/directions")
async def create_direction(data: DirectionCreate, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("dict_edit"))):
    if data.category_id is not None:
        await _ensure_exists(db, DirectionCategory, data.category_id, "Категория ЦФО не найдена")
    new_obj = Direction(name=data.name, category_id=data.category_id, is_active=data.is_active)
    db.add(new_obj)
    await db.commit()
    res = await db.execute(
        select(Direction).options(selectinload(Direction.category)).where(Direction.id == new_obj.id)
    )
    return res.scalar_one()

@router.put("/directions/{id}")
async def update_direction(id: UUID, data: DirectionUpdate, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("dict_edit"))):
    res = await db.execute(
        select(Direction).options(selectinload(Direction.category)).where(Direction.id == id)
    )
    obj = res.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="ЦФО не найдено")
    update_data = data.model_dump(exclude_unset=True)
    if 'category_id' in update_data and update_data['category_id'] is not None:
        await _ensure_exists(db, DirectionCategory, update_data['category_id'], "Категория ЦФО не найдена")
    if 'name' in update_data and update_data['name'] is not None:
        obj.name = update_data['name']
    if 'category_id' in update_data:
        obj.category_id = update_data['category_id']
    if 'is_active' in update_data and update_data['is_active'] is not None:
        obj.is_active = update_data['is_active']
    await db.commit()
    await db.refresh(obj)
    res2 = await db.execute(
        select(Direction).options(selectinload(Direction.category)).where(Direction.id == id)
    )
    return res2.scalar_one()

@router.delete("/directions/{id}")
async def delete_direction(id: UUID, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("dict_delete"))):
    user_check = await db.execute(select(User).where(User.direction_id == id).limit(1))
    if user_check.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="К этому ЦФО привязаны сотрудники")
        
    try:
        await db.execute(delete(Direction).where(Direction.id == id))
        await db.commit()
        return {"ok": True}
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Нельзя удалить ЦФО: оно используется в реестре платежей")

# --- РОЛИ И ПРАВА ---
@router.get("/permissions")
async def get_permissions(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Permission).order_by(Permission.category))
    return res.scalars().all()

@router.get("/roles")
async def get_roles(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Role).options(selectinload(Role.permissions)).order_by(Role.label))
    return res.scalars().all()

@router.post("/roles")
async def create_role(data: RoleCreate, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("user_edit"))):
    # is_superadmin намеренно НЕ принимается из тела — создать god-mode роль через API нельзя.
    new_role = Role(name=data.name, label=data.label, color=data.color or 'blue')
    db.add(new_role)
    await db.commit()
    return new_role

@router.put("/roles/{id}")
async def update_role_basic(id: UUID, data: RoleBasicUpdate, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("user_edit"))):
    role = await db.get(Role, id)
    if not role:
        raise HTTPException(status_code=404, detail="Роль не найдена")
    if data.label is not None:
        role.label = data.label
    if data.color is not None:
        role.color = data.color
    await db.commit()
    return role

@router.put("/roles/{id}/permissions")
async def update_role_perms(id: UUID, data: RolePermissionsUpdate, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("user_edit"))):
    result = await db.execute(select(Role).options(selectinload(Role.permissions)).where(Role.id == id))
    role = result.scalar_one_or_none()
    if not role or role.is_superadmin:
        raise HTTPException(status_code=400, detail="Нельзя изменять права суперадмина")

    perm_names = data.permissions
    perms_res = await db.execute(select(Permission).where(Permission.name.in_(perm_names)))
    role.permissions = perms_res.scalars().all()
    await db.commit()
    return {"ok": True}

@router.post("/roles/{id}/copy_permissions")
async def copy_role_permissions(id: UUID, from_role_id: UUID, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("user_edit"))):
    target_res = await db.execute(select(Role).options(selectinload(Role.permissions)).where(Role.id == id))
    target = target_res.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="Роль не найдена")
    if target.is_superadmin:
        raise HTTPException(status_code=400, detail="Нельзя изменять права суперадмина")

    source_res = await db.execute(select(Role).options(selectinload(Role.permissions)).where(Role.id == from_role_id))
    source = source_res.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Роль-источник не найдена")

    target.permissions = list(source.permissions)
    await db.commit()
    return {"ok": True, "permissions": [p.name for p in target.permissions]}

@router.delete("/roles/{id}")
async def delete_role(id: UUID, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("user_delete"))):
    role = await db.get(Role, id)
    if not role: 
        raise HTTPException(status_code=404, detail="Роль не найдена")
    if role.is_superadmin: 
        raise HTTPException(status_code=400, detail="Нельзя удалить суперадмина")
    
    user_check = await db.execute(select(User).where(User.role_id == id).limit(1))
    if user_check.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="К этой роли привязаны сотрудники")
        
    try:
        await db.delete(role)
        await db.commit()
        return {"ok": True}
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Нельзя удалить роль: существуют связанные объекты")

# --- СТАТЬИ ДДС (Budget Items) ---
@router.get("/budget_items")
async def get_budget_items(active_only: bool = False, db: AsyncSession = Depends(get_db)):
    query = select(BudgetItem).order_by(BudgetItem.category, BudgetItem.name)
    if active_only:
        query = query.where(BudgetItem.is_active == True)
    result = await db.execute(query)
    return result.scalars().all()

@router.post("/budget_items")
async def create_budget_item(data: BudgetItemCreate, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("dict_edit"))):
    # category — Enum BudgetItemCategory; в БД храним строковое значение.
    new_obj = BudgetItem(name=data.name, category=data.category.value, is_active=data.is_active)
    db.add(new_obj)
    try:
        await db.commit()
        await db.refresh(new_obj)
        return new_obj
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Статья ДДС с таким названием уже существует")

@router.put("/budget_items/{id}")
async def update_budget_item(id: UUID, data: BudgetItemUpdate, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("dict_edit"))):
    obj = await db.get(BudgetItem, id)
    if not obj:
        raise HTTPException(status_code=404, detail="Статья ДДС не найдена")
    update_data = data.model_dump(exclude_unset=True)
    if 'name' in update_data and update_data['name'] is not None:
        obj.name = update_data['name']
    if 'category' in update_data and update_data['category'] is not None:
        cat = update_data['category']
        obj.category = cat.value if hasattr(cat, 'value') else cat
    if 'is_active' in update_data and update_data['is_active'] is not None:
        obj.is_active = update_data['is_active']
    try:
        await db.commit()
        return obj
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Статья ДДС с таким названием уже существует")

@router.delete("/budget_items/{id}")
async def delete_budget_item(id: UUID, db: AsyncSession = Depends(get_db), c=Depends(PermissionChecker("dict_delete"))):
    request_check = await db.execute(select(PaymentRequest).where(PaymentRequest.budget_item_id == id).limit(1))
    if request_check.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Нельзя удалить статью ДДС: по ней есть платёжные заявки")
    try:
        await db.execute(delete(BudgetItem).where(BudgetItem.id == id))
        await db.commit()
        return {"ok": True}
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Нельзя удалить статью ДДС: она используется в системе")