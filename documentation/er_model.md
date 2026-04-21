# Логическая ER-модель базы данных

## 1. Описание таблиц

### 1.1. Справочники и структура
* **`organizations`** — Юридические лица. Содержит настройку группы платежных дней (GROUP_A/GROUP_B) и актуальный утренний остаток ликвидности.
* **`directions`** — Дерево подразделений (ЦФО). Связано само с собой через `parent_id` для построения иерархии подчинения.
* **`users`** — Пользователи системы. Идентифицируются по `ad_login` для будущей интеграции с Active Directory. Хранят жестко заданную роль `role` и привязку к `direction_id`.

### 1.2. Транзакционные данные
* **`payment_requests`** — Центральная таблица реестра (Заявки на платеж). Связывает инициатора, организацию, подразделение и содержит всю финансовую информацию (сумма, контрагент, статья ДДС), а также текущий статус заявки в FSM.
* **`digital_memos`** — Электронные служебные записки. Привязываются к заявке (`request_id`). Фиксируют тип нарушения логики (например, вне бюджета или подача после 11:00) и хранят статус согласования директором.
* **`audit_logs`** — Системный журнал действий. Записывает ID пользователя, таблицу, измененное поле, старое и новое значения.

---

## 2. Диаграмма связей (Mermaid)

```mermaid
erDiagram
    organizations {
        uuid id PK
        string name
        string payment_group
        decimal morning_balance
        timestamp created_at
        timestamp updated_at
    }

    directions {
        uuid id PK
        uuid parent_id FK "Nullable"
        string name
    }

    users {
        uuid id PK
        string ad_login UK
        string full_name
        string role
        string hashed_password "Nullable"
        uuid direction_id FK
        boolean is_active
    }

    payment_requests {
        uuid id PK
        uuid initiator_id FK
        uuid organization_id FK
        uuid direction_id FK
        string counterparty
        string contract_details
        decimal amount
        string purpose
        string budget_item
        boolean has_contract
        date desired_date
        date planned_date
        string status
        boolean is_priority
        string file_path
        timestamp created_at
        timestamp updated_at
    }

    digital_memos {
        uuid id PK
        uuid request_id FK
        string violation_type
        text reason
        boolean is_approved
        uuid approver_id FK "Nullable"
        timestamp created_at
    }

    audit_logs {
        uuid id PK
        uuid user_id FK "Nullable"
        string table_name
        string record_id
        string field_name
        string old_value
        string new_value
        timestamp changed_at
    }

    %% Связи
    directions ||--o{ directions : "parent_id"
    directions ||--o{ users : "employs"
    users ||--o{ payment_requests : "initiates"
    organizations ||--o{ payment_requests : "pays_for"
    directions ||--o{ payment_requests : "allocated_to"
    payment_requests ||--o| digital_memos : "requires"
    users ||--o{ digital_memos : "approves"
    users ||--o{ audit_logs : "performs"