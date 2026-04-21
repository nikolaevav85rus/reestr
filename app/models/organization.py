import uuid
from sqlalchemy import Column, String, ForeignKey, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.db.database import Base

class Cluster(Base):
    """Группа организаций (Кластер)"""
    __tablename__ = "clusters"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False, unique=True)
    is_active = Column(Boolean, default=True, nullable=False)

    # Ссылка на руководителя кластера (из таблицы users)
    head_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    organizations = relationship("Organization", back_populates="cluster")
    head = relationship("User")

class PaymentGroup(Base):
    __tablename__ = "payment_groups"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    organizations = relationship("Organization", back_populates="payment_group")

class Organization(Base):
    __tablename__ = "organizations"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    inn = Column(String(12), nullable=True)
    prefix = Column(String(10), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    payment_group_id = Column(UUID(as_uuid=True), ForeignKey("payment_groups.id"), nullable=False)
    cluster_id = Column(UUID(as_uuid=True), ForeignKey("clusters.id"), nullable=True)
    director_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    payment_group = relationship("PaymentGroup", back_populates="organizations")
    cluster = relationship("Cluster", back_populates="organizations")
    director = relationship("User")