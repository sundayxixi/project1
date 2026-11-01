# 数据级授权内核 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在功能权限通过的前提下，为 Agent / Prompt / 知识库 / 工具增加数据归属、角色数据范围与资源级共享（ACL），并保证列表、详情、写操作都在服务端按数据权限过滤或拒绝。

**Architecture:** 四张业务表新增 `owner_id`；新增 `role_data_scopes`、`role_data_scope_targets`、`resource_acl` 三张表。角色数据范围按“查看 / 管理 × 全部 / 本人 / 指定用户或角色”编译进用户权限上下文；资源级共享实时查询，不进用户缓存。列表用 SQL `EXISTS` 过滤，详情/写操作用统一的 `assert_can_view_resource` / `assert_can_manage_resource` 判定。

**Tech Stack:** Python 3.13 / FastAPI / SQLAlchemy 2.0 async / Alembic / pytest + pytest-asyncio / fakeredis。

**Spec:** `docs/spec/PROJECT_SPEC_V2.md`（§6 数据级授权、FR-14~17、§9.3 接口映射、§10 数据模型、§12.2 验收）。

**前置计划:** `RBAC权限内核-plan.md` 必须已完成。

---

## 模块说明（产品视角）

### 目标

| 编号 | 目标 | 本计划落点 |
|---|---|---|
| G9 | 业务资源有明确所有者，创建时自动写入 | 四表 `owner_id` + 模块计划写入 |
| G10 | 角色可配置每类资源的查看/管理范围 | `role_data_scopes` + `role_data_scope_targets` |
| G11 | 列表、详情、写操作按数据范围过滤或拒绝 | `visible_condition` + `assert_can_*` |
| G12 | 所有者可把单个资源共享给用户/角色 | `resource_acl` + ACL 接口 |
| G13 | 数据级授权变更立即生效 | ACL 实时查询；范围变更失效用户缓存 |

### 交付物

1. 四张业务表 `owner_id` 字段与历史数据回填。
2. 三张新表与内置角色数据范围默认值。
3. 用户数据范围编译（多角色并集）。
4. 列表过滤、详情/写操作判定、逐行 `can_manage` / `is_shared`。
5. 角色数据范围查询/覆盖接口。
6. ACL 查询/新增/修改/删除与归属转移接口工厂。
7. 用户删除、角色删除、归属转移的边界规则。
8. 数据级授权验收测试。

### 不在本期范围

- 前端共享抽屉、归属列、转移弹窗 → `前端权限控制-plan.md` 与各业务模块计划。
- 各业务模块的接口接入 → `Agent管理-plan.md`、`Prompt管理-plan.md`、`知识库管理-plan.md`、`工具管理-plan.md`。
- 模型、供应商、用户、角色、权限等平台资源不做行级隔离（NG10）。
- 已发布 Agent 的运行时调用不做数据隔离（NG8）。

---

## Global Constraints

- 可配置数据范围的资源类别固定 4 类：`agent`、`prompt`、`knowledge`、`tool`。
- 范围取值固定 `ALL` / `SELF` / `CUSTOM`；维度固定 `view` / `manage`。
- 多角色按并集计算：任一角色某维度为 `ALL` → 该维度 `ALL`；否则合并 `SELF` 与 `CUSTOM` 目标。无角色用户默认 `SELF/SELF`（默认收紧）。
- 超级管理员两维度均为 `ALL`。
- 管理范围隐含查看：`manage=ALL` 时可见；`manage=SELF` 时本人可见。此决策与原型 §6.3 一致。
- ACL 访问级别固定 `view` / `manage`；`manage` 隐含只读。不能共享给“所有人”，不能共享给自己。
- 单角色单资源类别自定义目标总数上限 1000；单资源 ACL 条目建议 ≤ 200。
- 资源不存在与无权限统一返回 `BizException(403, "资源不存在或无权限访问")`，不区分。
- 所有数据过滤必须发生在服务端查询层，不提供任何“查看全部”请求参数。
- 响应保持 HTTP 200 + body `code`；缓存 key `rbac:user:{user_id}`，TTL 300 秒。
- 迁移必须兼容 SQLite 与 MySQL；改列/加外键使用 `op.batch_alter_table`。
- 每个任务结束提交一次，提交信息使用中文摘要。

---

## Review Focus

1. **列表分页总数**：数据范围收紧后，`total` 必须等于过滤后的数量，不能出现“列表 3 条、总数 100”。
2. **他人资源 ID 直连**：知道 ID 直接请求详情、编辑、删除，必须统一返回 403，且消息不泄露资源是否存在。
3. **共享与取消共享的即时性**：共享后下一次请求即可见/可管理；取消后下一次请求即 403，无需重新登录。
4. **多角色合并**：一个角色 `ALL`、另一个 `SELF` 时结果为 `ALL`；`CUSTOM` 的用户与角色目标按并集去重。
5. **派生资源继承**：文档/分段/版本的可见性与管理权完全继承父资源，不能通过子资源接口绕过。

---

## File Structure

**新增**

| 文件 | 职责 |
|---|---|
| `src/core/data_scope.py` | `ScopeLevel`、`DataScope`、合并规则、默认范围 |
| `src/core/data_auth.py` | 范围编译、可见性 SQL 条件、`can_view` / `can_manage`、断言、归属统计 |
| `src/modules/data_auth/__init__.py` | 数据授权模块包 |
| `src/modules/data_auth/model.py` | `RoleDataScope`、`RoleDataScopeTarget`、`ResourceAcl` |
| `src/modules/data_auth/schema.py` | 数据范围与 ACL 请求/响应 Schema |
| `src/modules/data_auth/repository.py` | `DataScopeRepository`、`AclRepository` |
| `src/modules/data_auth/service.py` | `DataScopeService`、`AclService`、`DataAuthService` |
| `src/modules/data_auth/router.py` | `make_acl_router()` 通用 ACL/转移路由工厂 |
| `src/db/data_auth_seed.py` | `owner_id` 回填、内置角色数据范围默认值 |
| `alembic/versions/<rev>_data_auth_v2.py` | 四表 owner_id + 三张新表 + 种子 |
| `test/test_data_auth_seed.py` | 种子幂等与默认值 |
| `test/test_data_scope_compile.py` | 多角色合并规则 |
| `test/test_data_auth_predicates.py` | 可见性/管理权判定 |
| `test/test_data_scope_api.py` | 角色数据范围接口 |
| `test/test_acl_service.py` | ACL 规则 |
| `test/test_transfer_and_delete.py` | 转移与删除约束 |
| `test/test_data_auth_flow.py` | 跨用户数据隔离验收 |

**修改**

| 文件 | 变更 |
|---|---|
| `src/modules/agent/model.py` | 新增 `owner_id` + `owner` 关系 |
| `src/modules/prompt/model.py` | 同上 |
| `src/modules/knowledge/model.py` | `KnowledgeBase` 新增 `owner_id` + `owner` 关系 |
| `src/modules/tool/model.py` | 同上 |
| `src/core/rbac.py` | 从 `data_scope.py` 引入正式 `DataScope`；`PermissionContext` 增加 `role_ids`；加载时编译数据范围并写入缓存 |
| `src/modules/user/schema.py` | `MeRead.data_scopes` 填充 |
| `src/modules/user/api.py` | `/users/me` 返回 `data_scopes` |
| `src/modules/user/service.py` | 删除用户前检查归属资源；清理 ACL 主体 |
| `src/modules/role/service.py` | 删除角色时清理数据范围、ACL 主体与 scope target |
| `src/modules/role/api.py` | 新增数据范围查询/覆盖接口与对象选项接口 |
| `alembic/env.py` | 导入 `src.modules.data_auth.model` |

---

### Task 1: 数据归属字段、三张新表与迁移

**Files:**
- Modify: `src/modules/agent/model.py`, `src/modules/prompt/model.py`, `src/modules/knowledge/model.py`, `src/modules/tool/model.py`, `alembic/env.py`, `test/conftest.py`
- Create: `src/modules/data_auth/__init__.py`, `src/modules/data_auth/model.py`, `src/db/data_auth_seed.py`
- Create: `alembic/versions/<rev>_data_auth_v2.py`
- Test: `test/test_data_auth_seed.py`

**Interfaces:**
- Consumes: `roles.code`、`users.is_superuser`、`src.core.permissions.RESOURCE_TYPES`。
- Produces:
  - 四张业务表字段 `owner_id: Mapped[int]`、关系 `owner: Mapped["User"]`（`lazy="selectin"`）
  - `RoleDataScope`、`RoleDataScopeTarget`、`ResourceAcl` ORM 模型
  - `seed_data_auth(bind: Connection) -> None`
  - `DATA_SCOPE_DEFAULTS`

- [ ] **Step 1: 写失败测试**

`test/test_data_auth_seed.py`：

```python
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from src.core.base_model import Base
import src.modules.user.model  # noqa: F401
import src.modules.role.model  # noqa: F401
import src.modules.permission.model  # noqa: F401
import src.modules.agent.model  # noqa: F401
import src.modules.prompt.model  # noqa: F401
import src.modules.knowledge.model  # noqa: F401
import src.modules.tool.model  # noqa: F401
import src.modules.data_auth.model  # noqa: F401
from src.modules.agent.model import Agent
from src.modules.prompt.model import Prompt
from src.modules.knowledge.model import KnowledgeBase
from src.modules.tool.model import Tool
from src.modules.data_auth.model import RoleDataScope
from src.db.data_auth_seed import seed_data_auth

def test_business_tables_have_owner_id():
    for model in (Agent, Prompt, KnowledgeBase, Tool):
        assert "owner_id" in model.__table__.columns

def test_seed_data_scopes_idempotent():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    from src.modules.user.model import User
    from src.modules.role.model import Role
    with Session(engine) as s:
        s.add(User(username="admin", email="admin@example.com", hashed_password="x", is_superuser=True))
        s.add(Role(code="developer", name="开发者", is_system=True))
        s.commit()
    with engine.begin() as conn:
        seed_data_auth(conn)
        seed_data_auth(conn)
    with Session(engine) as s:
        rows = s.scalars(select(RoleDataScope)).all()
        assert len(rows) == 4  # developer 的 4 类资源
```

> 历史数据 `owner_id` 回填在迁移中验证（`alembic upgrade head` 后检查无 NULL）；不在单元测试里构造 NULL 行，因为模型已声明非空。

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_data_auth_seed.py -v`
Expected: FAIL，`owner_id` 列与模块不存在。

- [ ] **Step 3: 给四张业务表加 `owner_id`**

以 Agent 为例，Prompt/KnowledgeBase/Tool 同构：

```python
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from src.modules.user.model import User

    owner_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"),
        index=True, comment="所有者用户ID"
    )
    owner: Mapped["User"] = relationship("User", lazy="selectin")
```

- [ ] **Step 4: 新增三张 ORM 表**

`src/modules/data_auth/model.py`：

```python
class RoleDataScope(BaseModel):
    __tablename__ = "role_data_scopes"
    __table_args__ = (UniqueConstraint("role_id", "resource_type", name="uq_role_data_scope"),)
    role_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("roles.id", ondelete="CASCADE"), index=True)
    resource_type: Mapped[str] = mapped_column(String(32))
    view_scope: Mapped[str] = mapped_column(String(16), default="SELF")
    manage_scope: Mapped[str] = mapped_column(String(16), default="SELF")
    targets: Mapped[list["RoleDataScopeTarget"]] = relationship(
        "RoleDataScopeTarget", cascade="all, delete-orphan", lazy="selectin"
    )

class RoleDataScopeTarget(BaseModel):
    __tablename__ = "role_data_scope_targets"
    __table_args__ = (UniqueConstraint(
        "role_data_scope_id", "applies_to", "subject_type", "subject_id",
        name="uq_role_data_scope_target",
    ),)
    role_data_scope_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("role_data_scopes.id", ondelete="CASCADE"), index=True
    )
    applies_to: Mapped[str] = mapped_column(String(8))   # VIEW / MANAGE
    subject_type: Mapped[str] = mapped_column(String(8)) # user / role
    subject_id: Mapped[int] = mapped_column(BigInteger)

class ResourceAcl(BaseModel):
    __tablename__ = "resource_acl"
    __table_args__ = (
        UniqueConstraint("resource_type", "resource_id", "subject_type", "subject_id", name="uq_resource_acl"),
        Index("ix_resource_acl_resource", "resource_type", "resource_id"),
        Index("ix_resource_acl_subject", "subject_type", "subject_id"),
    )
    resource_type: Mapped[str] = mapped_column(String(32))
    resource_id: Mapped[int] = mapped_column(BigInteger)
    subject_type: Mapped[str] = mapped_column(String(8))
    subject_id: Mapped[int] = mapped_column(BigInteger)
    access_level: Mapped[str] = mapped_column(String(8))
    granted_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
        comment="授予人；用户删除后置空，共享关系保留",
    )
```

> 新增模型后，把 `import src.modules.data_auth.model` 同步加入 `test/conftest.py` 与 `alembic/env.py`，否则 `Base.metadata` 不完整。

- [ ] **Step 5: 实现种子与回填**

`src/db/data_auth_seed.py`：

```python
DATA_SCOPE_DEFAULTS: dict[str, dict[str, tuple[str, str]]] = {
    "admin": {rt: ("ALL", "ALL") for rt in RESOURCE_TYPES},
    "developer": {rt: ("ALL", "SELF") for rt in RESOURCE_TYPES},
    "operator": {
        "agent": ("ALL", "SELF"), "prompt": ("ALL", "SELF"),
        "knowledge": ("ALL", "ALL"), "tool": ("ALL", "SELF"),
    },
    "viewer": {rt: ("ALL", "SELF") for rt in RESOURCE_TYPES},
}
```

`seed_data_auth(bind)` 顺序：

1. 查 `is_superuser=true` 且启用的用户，取最小 id 作为 admin；不存在则抛 `RuntimeError("未找到超级管理员，无法回填 owner_id")`。
2. 对 `agents`、`prompts`、`knowledge_bases`、`tools` 执行 `UPDATE ... SET owner_id = :admin_id WHERE owner_id IS NULL`。
3. 对上述四表执行 `UPDATE ... SET created_by = :admin_username WHERE created_by IS NULL`，保留历史显示名口径。
4. 对每个内置角色、每类资源，按 `DATA_SCOPE_DEFAULTS` upsert `role_data_scopes`（唯一键 `role_id + resource_type`）；已有则更新两个 scope 字段。
5. 不删除自定义角色、自定义角色权限、已有 ACL。

- [ ] **Step 6: 生成迁移并补回填**

Run: `alembic revision --autogenerate -m "data authorization v2"`

`upgrade()` 必须按顺序：

```python
for table in ("agents", "prompts", "knowledge_bases", "tools"):
    with op.batch_alter_table(table) as batch:
        batch.add_column(sa.Column("owner_id", sa.BigInteger(), nullable=True))
        batch.create_foreign_key(f"fk_{table}_owner_id_users", "users", ["owner_id"], ["id"], ondelete="RESTRICT")
        batch.create_index(f"ix_{table}_owner_id", ["owner_id"])
# 建三张新表（autogenerate 已生成，保持在回填之前）
# 回填 owner_id
from src.db.data_auth_seed import seed_data_auth
seed_data_auth(op.get_bind())
# 再改为非空
for table in ("agents", "prompts", "knowledge_bases", "tools"):
    with op.batch_alter_table(table) as batch:
        batch.alter_column("owner_id", existing_type=sa.BigInteger(), nullable=False)
```

> SQLite 下 `batch_alter_table` 会重建表；MySQL 下生成普通 ALTER。若 autogenerate 已生成外键/索引，避免重复创建。

- [ ] **Step 7: 运行迁移验证**

Run:

```bash
alembic upgrade head
alembic downgrade -1
alembic upgrade head
```

Expected: 三次成功；`agents/prompts/knowledge_bases/tools` 的 `owner_id` 非空；`role_data_scopes` 每个内置角色 4 行。

- [ ] **Step 8: 运行测试确认通过**

Run: `pytest test/test_data_auth_seed.py -v`
Expected: 3 passed。

- [ ] **Step 9: 提交**

```bash
git add src/modules/*/model.py src/modules/data_auth src/db/data_auth_seed.py alembic test/test_data_auth_seed.py
git commit -m "feat: 增加业务资源归属字段、数据范围与 ACL 表"
```

---

### Task 2: 数据范围类型与多角色合并

**Files:**
- Create: `src/core/data_scope.py`
- Modify: `src/core/rbac.py`, `src/modules/user/schema.py`, `src/modules/user/api.py`
- Test: `test/test_data_scope_compile.py`

**Interfaces:**
- Consumes: `User.roles`、`RoleDataScope.targets`、`RESOURCE_TYPES`。
- Produces:

```python
class ScopeLevel(StrEnum):
    ALL = "ALL"; SELF = "SELF"; CUSTOM = "CUSTOM"

@dataclass(frozen=True)
class DataScope:
    view: ScopeLevel = ScopeLevel.SELF
    manage: ScopeLevel = ScopeLevel.SELF
    view_users: frozenset[int] = frozenset()
    view_roles: frozenset[int] = frozenset()
    manage_users: frozenset[int] = frozenset()
    manage_roles: frozenset[int] = frozenset()
    def to_dict(self) -> dict: ...
    @classmethod
    def from_dict(cls, raw: dict) -> "DataScope": ...

def default_scope() -> DataScope
def superuser_scope() -> DataScope
def merge_scopes(scopes: list[DataScope]) -> DataScope

async def compile_user_scopes(user: User, db: AsyncSession) -> dict[str, DataScope]
```

- `PermissionContext` 新增 `role_ids: frozenset[int]`，`data_scopes` 存放 4 类资源的正式 `DataScope`。

- [ ] **Step 1: 写失败测试**

`test/test_data_scope_compile.py`：

```python
from src.core.data_scope import DataScope, ScopeLevel, merge_scopes, default_scope
from src.core.rbac import load_permission_context
from src.modules.role.model import Role
from src.modules.user.model import User
from src.modules.data_auth.model import RoleDataScope, RoleDataScopeTarget

def test_merge_all_wins_over_self():
    result = merge_scopes([
        DataScope(view=ScopeLevel.ALL, manage=ScopeLevel.SELF),
        DataScope(view=ScopeLevel.SELF, manage=ScopeLevel.SELF),
    ])
    assert result.view == ScopeLevel.ALL
    assert result.manage == ScopeLevel.SELF

def test_merge_custom_targets_union():
    a = DataScope(view=ScopeLevel.CUSTOM, view_users=frozenset({1}), view_roles=frozenset({2}))
    b = DataScope(view=ScopeLevel.CUSTOM, view_users=frozenset({1, 3}))
    result = merge_scopes([a, b])
    assert result.view == ScopeLevel.CUSTOM
    assert result.view_users == frozenset({1, 3})
    assert result.view_roles == frozenset({2})

async def test_user_without_roles_gets_self(db_session, fake_redis):
    user = User(username="u", email="u@example.com", hashed_password="x")
    db_session.add(user); await db_session.flush()
    ctx = await load_permission_context(user, db_session, fake_redis)
    assert ctx.data_scopes["agent"] == default_scope()

async def test_superuser_gets_all(db_session, fake_redis):
    user = User(username="root", email="root@example.com", hashed_password="x", is_superuser=True)
    db_session.add(user); await db_session.flush()
    ctx = await load_permission_context(user, db_session, fake_redis)
    assert all(s.view == ScopeLevel.ALL and s.manage == ScopeLevel.ALL for s in ctx.data_scopes.values())

async def test_role_custom_scope_compiled(db_session, fake_redis):
    role = Role(code="r", name="角色", is_system=False)
    scope = RoleDataScope(role_id=0, resource_type="agent", view_scope="CUSTOM", manage_scope="SELF",
                          targets=[RoleDataScopeTarget(applies_to="VIEW", subject_type="user", subject_id=9)])
    role.data_scopes = [scope]  # 若未建关系，可先 flush role 再设置 role_id
    user = User(username="u2", email="u2@example.com", hashed_password="x", roles=[role])
    db_session.add_all([role, user]); await db_session.flush()
    ctx = await load_permission_context(user, db_session, fake_redis)
    assert ctx.data_scopes["agent"].view == ScopeLevel.CUSTOM
    assert ctx.data_scopes["agent"].view_users == frozenset({9})
```

> 若 `Role` 未声明 `data_scopes` 关系，测试改为先 `db_session.flush()` 拿到 `role.id`，再创建 `RoleDataScope(role_id=role.id, ...)`。

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_data_scope_compile.py -v`
Expected: FAIL，`src.core.data_scope` 不存在。

- [ ] **Step 3: 实现 `src/core/data_scope.py`**

合并规则：

1. 任一 scope 的 `view == ALL` → 结果 `view=ALL`，`view_users/view_roles` 清空。
2. 否则若存在 `view == SELF` → 结果 `view=SELF`；否则只要存在 `CUSTOM` → `CUSTOM`。
3. `view_users` / `view_roles` 取所有 scope 并集（`ALL` 时清空）。
4. `manage` 同规则。
5. 空列表 → `default_scope()`（`SELF/SELF`）。

- [ ] **Step 4: 编译用户范围并接入上下文**

`src/core/data_auth.py` 增加：

```python
async def compile_user_scopes(user, db) -> dict[str, DataScope]:
    if user.is_superuser:
        return {rt: superuser_scope() for rt in RESOURCE_TYPES}
    role_ids = [r.id for r in user.roles]
    if not role_ids:
        return {rt: default_scope() for rt in RESOURCE_TYPES}
    rows = (await db.execute(
        select(RoleDataScope)
        .where(RoleDataScope.role_id.in_(role_ids))
        .options(selectinload(RoleDataScope.targets))
    )).scalars().all()
    grouped: dict[str, list[DataScope]] = {rt: [] for rt in RESOURCE_TYPES}
    for row in rows:
        grouped.setdefault(row.resource_type, []).append(_to_scope(row))
    return {rt: merge_scopes(scopes) for rt, scopes in grouped.items()}
```

`src/core/rbac.py`：

- 删除占位 `DataScope`，改为 `from src.core.data_scope import DataScope, ScopeLevel, default_scope`。
- `PermissionContext` 增加 `role_ids: frozenset[int] = frozenset()`。
- `load_permission_context` 在缓存未命中时调用 `compile_user_scopes`（函数内导入，避免循环依赖）。
- 缓存 payload 增加 `data_scopes`；命中时用 `DataScope.from_dict` 还原。
- `scope(resource_type)` 返回 `self.data_scopes.get(resource_type, default_scope())`。

`/users/me` 返回：

```python
data_scopes={
    rt: DataScopeSummary(view=s.view.value, manage=s.manage.value)
    for rt, s in ctx.data_scopes.items()
}
```

同时更新 `test/test_user_me.py`：把原断言 `data_scopes == {}` 改为包含 `agent/prompt/knowledge/tool` 四个键，且无角色用户为 `SELF/SELF`。

- [ ] **Step 5: 运行测试确认通过**

Run: `pytest test/test_data_scope_compile.py test/test_permission_context.py -v`
Expected: 全部通过。

- [ ] **Step 6: 提交**

```bash
git add src/core/data_scope.py src/core/data_auth.py src/core/rbac.py src/modules/user test/test_data_scope_compile.py
git commit -m "feat: 编译角色数据范围并注入用户权限上下文"
```

---

### Task 3: 可见性与管理权判定

**Files:**
- Modify: `src/core/data_auth.py`, `src/core/base_repository.py`
- Test: `test/test_data_auth_predicates.py`

**Interfaces:**
- Consumes: `DataScope`、`PermissionContext`、`ResourceAcl`、`user_roles`。
- Produces:

```python
# src/core/base_repository.py：通用分页 + 可选 WHERE 条件
async def get_page_where(
    self, offset: int, limit: int, keyword: str | None,
    search_fields: list[str] | None, where: ColumnElement[bool] | None = None,
) -> tuple[list[T], int]

# src/core/data_auth.py
def visible_condition(model, resource_type: str, ctx: PermissionContext) -> ColumnElement[bool]

def can_view(ctx, resource_type: str, owner_id: int,
             owner_role_ids: set[int], acl_levels: set[str]) -> bool
def can_manage(ctx, resource_type: str, owner_id: int,
               owner_role_ids: set[int], acl_levels: set[str]) -> bool

async def acl_levels_for(db, resource_type: str, resource_id: int,
                         user_id: int, role_ids: frozenset[int]) -> set[str]
async def acl_levels_map(db, resource_type: str, resource_ids: list[int],
                         user_id: int, role_ids: frozenset[int]) -> dict[int, set[str]]
async def is_shared_map(db, resource_type: str, resource_ids: list[int]) -> dict[int, bool]

async def assert_can_view_resource(db, resource_type: str, resource, ctx) -> None
async def assert_can_manage_resource(db, resource_type: str, resource, ctx) -> None
```

- [ ] **Step 1: 写失败测试**

`test/test_data_auth_predicates.py`：

```python
from sqlalchemy import select
from src.core.data_scope import DataScope, ScopeLevel
from src.core.rbac import PermissionContext
from src.core.data_auth import visible_condition, can_view, can_manage
from src.modules.agent.model import Agent
from src.modules.data_auth.model import ResourceAcl
from src.modules.user.model import User

def ctx_for(user, *, view="SELF", manage="SELF", view_users=frozenset(), view_roles=frozenset()):
    return PermissionContext(
        user=user,
        permissions=frozenset(),
        role_ids=frozenset(r.id for r in user.roles),
        data_scopes={"agent": DataScope(
            view=ScopeLevel(view), manage=ScopeLevel(manage),
            view_users=view_users, view_roles=view_roles,
        )},
    )

async def make_user(db, username, role=None):
    user = User(username=username, email=f"{username}@example.com", hashed_password="x",
                roles=[role] if role else [])
    db.add(user); await db.flush()
    return user

async def test_owner_sees_own_agent(db_session):
    a = await make_user(db_session, "a")
    assert can_view(ctx_for(a), "agent", owner_id=a.id, owner_role_ids=set(), acl_levels=set()) is True
    assert can_manage(ctx_for(a), "agent", owner_id=a.id, owner_role_ids=set(), acl_levels=set()) is True

async def test_self_scope_hides_other_agent(db_session):
    a = await make_user(db_session, "a")
    b = await make_user(db_session, "b")
    assert can_view(ctx_for(a), "agent", owner_id=b.id, owner_role_ids=set(), acl_levels=set()) is False

async def test_all_view_scope_sees_other(db_session):
    a = await make_user(db_session, "a")
    b = await make_user(db_session, "b")
    assert can_view(ctx_for(a, view="ALL"), "agent", owner_id=b.id, owner_role_ids=set(), acl_levels=set()) is True

async def test_acl_manage_implies_view(db_session):
    a = await make_user(db_session, "a")
    b = await make_user(db_session, "b")
    assert can_view(ctx_for(a), "agent", owner_id=b.id, owner_role_ids=set(), acl_levels={"manage"}) is True
    assert can_manage(ctx_for(a), "agent", owner_id=b.id, owner_role_ids=set(), acl_levels={"manage"}) is True

async def test_custom_role_target_matches_owner_role(db_session):
    from src.modules.role.model import Role
    a = await make_user(db_session, "a")
    role = Role(code="dev", name="开发", is_system=False)
    owner = await make_user(db_session, "owner", role=role)
    ctx = ctx_for(a, view="CUSTOM", view_roles=frozenset({role.id}))
    assert can_view(ctx, "agent", owner_id=owner.id,
                    owner_role_ids={role.id}, acl_levels=set()) is True

async def test_visible_condition_filters_rows(db_session):
    a = await make_user(db_session, "a")
    b = await make_user(db_session, "b")
    db_session.add_all([
        Agent(name="a1", type="conversation", owner_id=a.id),
        Agent(name="b1", type="conversation", owner_id=b.id),
    ])
    await db_session.flush()
    rows = (await db_session.execute(
        select(Agent).where(visible_condition(Agent, "agent", ctx_for(a)))
    )).scalars().all()
    assert [r.name for r in rows] == ["a1"]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_data_auth_predicates.py -v`
Expected: FAIL，函数不存在。

- [ ] **Step 3: 实现 SQL 过滤**

`visible_condition` 构造：

```python
def visible_condition(model, resource_type, ctx):
    from sqlalchemy import and_, exists, false, or_, select, true
    from src.modules.data_auth.model import ResourceAcl
    from src.modules.role.model import user_roles

    if ctx.user.is_superuser:
        return true()

    owner_self = model.owner_id == ctx.user.id
    acl_subject = or_(
        and_(ResourceAcl.subject_type == "user", ResourceAcl.subject_id == ctx.user.id),
        and_(ResourceAcl.subject_type == "role", ResourceAcl.subject_id.in_(ctx.role_ids or {-1})),
    )
    acl_exists = exists(select(1).select_from(ResourceAcl).where(
        ResourceAcl.resource_type == resource_type,
        ResourceAcl.resource_id == model.id,
        acl_subject,
    ))

    scope = ctx.scope(resource_type)
    conditions = [owner_self, acl_exists]
    if scope.view == ScopeLevel.ALL or scope.manage == ScopeLevel.ALL:
        return true()
    if scope.view == ScopeLevel.SELF or scope.manage == ScopeLevel.SELF:
        conditions.append(owner_self)

    users = scope.view_users | scope.manage_users
    roles = scope.view_roles | scope.manage_roles
    if users:
        conditions.append(model.owner_id.in_(users))
    if roles:
        conditions.append(exists(select(1).select_from(user_roles).where(
            user_roles.c.user_id == model.owner_id,
            user_roles.c.role_id.in_(roles),
        )))
    return or_(*conditions)
```

- [ ] **Step 4: 给 `BaseRepository` 增加带条件的通用分页**

在 `src/core/base_repository.py` 中新增 `get_page_where(offset, limit, keyword, search_fields, where=None)`，把现有 `get_page` 的查询构造抽出来；`get_page` 直接调用 `get_page_where(..., where=None)`，保持现有行为不变。四个业务模块的 repository 用它拼接 `visible_condition(...)`，不要在各自 service 里复制分页与计数逻辑。

- [ ] **Step 5: 实现 Python 判定与 ACL 查询**

`can_view`：
1. `ctx.user.is_superuser` → True。
2. `owner_id == ctx.user.id` → True。
3. `"manage" in acl_levels or "view" in acl_levels` → True。
4. `scope.view == ALL or scope.manage == ALL` → True。
5. `scope.view == SELF or scope.manage == SELF` 且 `owner_id == ctx.user.id` → True（已在上方）。
6. CUSTOM：`owner_id in scope.view_users | scope.manage_users` 或 `owner_role_ids & (scope.view_roles | scope.manage_roles)` → True。
7. 否则 False。

`can_manage`：
1. 超级管理员 → True。
2. 本人 → True。
3. `"manage" in acl_levels` → True。
4. `scope.manage == ALL` → True。
5. CUSTOM：`owner_id in scope.manage_users` 或 `owner_role_ids & scope.manage_roles` → True。
6. 否则 False。

`acl_levels_for` 查询 `ResourceAcl` 中主体为当前用户或其角色的条目，返回 `{"view"}` / `{"manage"}` / `{"view","manage"}`。
`acl_levels_map` 一次查询 `resource_id.in_(ids)` 后分组。
`is_shared_map` 只查是否存在任意 ACL 条目。

`assert_can_*_resource`：
- 资源为 `None` → `logger.warning` 记录用户、资源类型、资源 ID、时间，再抛 403。
- 取 `owner_role_ids = {r.id for r in resource.owner.roles}`（`resource.owner` 为 `None` 时为空集）。
- 取 ACL levels。
- 不通过 → `logger.warning` 记录用户、资源类型、资源 ID、判定维度、时间，再抛 `BizException(403, "资源不存在或无权限访问")`。

- [ ] **Step 6: 运行测试确认通过**

Run: `pytest test/test_data_auth_predicates.py -v`
Expected: 7 passed。

- [ ] **Step 7: 提交**

```bash
git add src/core/data_auth.py src/core/base_repository.py test/test_data_auth_predicates.py
git commit -m "feat: 增加数据可见性 SQL 过滤、管理权判定与带条件分页"
```

---

### Task 4: 角色数据范围接口

**Files:**
- Create: `src/modules/data_auth/schema.py`, `src/modules/data_auth/repository.py`, `src/modules/data_auth/service.py`
- Modify: `src/modules/role/api.py`
- Test: `test/test_data_scope_api.py`

**Interfaces:**
- Consumes: `RoleDataScope`、`RoleDataScopeTarget`、`invalidate_role_users_cache`。
- Produces:
  - `ScopeTarget`（请求）、`ScopeTargetRead`（响应，含 `subject_name`）
  - `RoleDataScopeItem`、`RoleDataScopesUpdate`、`RoleDataScopeRead`
  - `DataScopeService.get_role_scopes(role_id) -> list[RoleDataScopeRead]`
  - `DataScopeService.replace_role_scopes(role_id, items, redis) -> list[RoleDataScopeRead]`
  - `DataScopeService.list_subject_options(subject_type, keyword) -> list[SubjectOption]`（供 `GET /share/subjects` 使用）
  - `GET /api/v1/roles/{role_id}/data-scopes`（`role:view`）
  - `PUT /api/v1/roles/{role_id}/data-scopes`（`role:update`）

- [ ] **Step 1: 写失败测试**

`test/test_data_scope_api.py`：

```python
import pytest
from src.core.exceptions import BizException
from src.modules.role.model import Role
from src.modules.data_auth.service import DataScopeService
from src.modules.data_auth.schema import RoleDataScopeItem, ScopeTarget

async def test_get_returns_four_resource_rows(db_session):
    role = Role(code="dev", name="开发", is_system=False)
    db_session.add(role); await db_session.flush()
    rows = await DataScopeService(db_session).get_role_scopes(role.id)
    assert [r.resource_type for r in rows] == ["agent", "prompt", "knowledge", "tool"]
    assert all(r.view_scope == "SELF" for r in rows)

async def test_replace_custom_scope_and_invalidate(db_session, fake_redis):
    role = Role(code="dev", name="开发", is_system=False)
    target_role = Role(code="ops", name="运营", is_system=False)
    db_session.add_all([role, target_role]); await db_session.flush()
    item = RoleDataScopeItem(
        resource_type="agent", view_scope="CUSTOM", manage_scope="SELF",
        view_targets=[ScopeTarget(subject_type="role", subject_id=target_role.id)],
    )
    rows = await DataScopeService(db_session).replace_role_scopes(role.id, [item], fake_redis)
    agent_row = next(r for r in rows if r.resource_type == "agent")
    assert agent_row.view_scope == "CUSTOM"
    assert agent_row.view_targets[0].subject_id == target_role.id
    assert agent_row.view_targets[0].subject_name == "运营"

async def test_reject_unknown_subject(db_session, fake_redis):
    role = Role(code="dev", name="开发", is_system=False)
    db_session.add(role); await db_session.flush()
    item = RoleDataScopeItem(
        resource_type="agent", view_scope="CUSTOM", manage_scope="SELF",
        view_targets=[ScopeTarget(subject_type="user", subject_id=9999)],
    )
    with pytest.raises(BizException):
        await DataScopeService(db_session).replace_role_scopes(role.id, [item], fake_redis)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_data_scope_api.py -v`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 Schema 与服务**

`RoleDataScopeItem` 使用 `Literal` 约束：

```python
ResourceType = Literal["agent", "prompt", "knowledge", "tool"]
ScopeLevelLiteral = Literal["ALL", "SELF", "CUSTOM"]

class ScopeTarget(BaseModel):
    subject_type: Literal["user", "role"]
    subject_id: int

class ScopeTargetRead(ScopeTarget):
    subject_name: str

class RoleDataScopeItem(BaseModel):
    resource_type: ResourceType
    view_scope: ScopeLevelLiteral
    manage_scope: ScopeLevelLiteral
    view_targets: list[ScopeTarget] = []
    manage_targets: list[ScopeTarget] = []

class RoleDataScopeRead(BaseModel):
    resource_type: ResourceType
    view_scope: ScopeLevelLiteral
    manage_scope: ScopeLevelLiteral
    view_targets: list[ScopeTargetRead] = []
    manage_targets: list[ScopeTargetRead] = []

class RoleDataScopesUpdate(BaseModel):
    scopes: list[RoleDataScopeItem]

class SubjectOption(BaseModel):
    id: int
    name: str
    type: Literal["user", "role"]
```

`get_role_scopes` / `replace_role_scopes` 返回的 `ScopeTargetRead.subject_name` 通过批量查询 `users.username` / `roles.name` 填充；主体不存在时显示 `#<id>`。`RoleDataScopeRead` 不继承 `RoleDataScopeItem`，避免请求/响应目标类型混用。

`replace_role_scopes` 规则：

1. 角色不存在 → 404 业务码。
2. `resource_type` 不得重复。
3. 目标用户/角色必须存在；失效目标 → `BizException(400, "指定用户或角色不存在")`。
4. 单角色单资源类别（view + manage 去重后）目标数 > 1000 → `BizException(400, "自定义目标数量超过上限 1000")`。
5. 全量覆盖：删除该角色本次未提交的资源范围；提交的资源类型 upsert scope 与 targets。
6. 失效该角色下所有用户缓存。
7. 返回 4 行（未提交的资源类型按 `SELF/SELF` 返回）。
8. `logger.info` 记录操作者、角色、变更后的范围摘要（§5.4 R6）。

`list_subject_options(subject_type, keyword)`：
- `user`：按 `username` / `email` 模糊匹配，返回 `{id, name, type}`，限 20 条。
- `role`：按 `code` / `name` 模糊匹配，返回 `{id, name, type}`，限 20 条。

- [ ] **Step 4: 接入角色路由**

```python
@router.get("/{role_id}/data-scopes", response_model=ResponseSchema[list[RoleDataScopeRead]])
@require_permission("role:view")
async def get_role_data_scopes(role_id: int, db=Depends(get_db), svc=...):
    ...

@router.put("/{role_id}/data-scopes", response_model=ResponseSchema[list[RoleDataScopeRead]])
@require_permission("role:update")
async def put_role_data_scopes(role_id: int, data: RoleDataScopesUpdate, ...):
    await DataScopeService(db).replace_role_scopes(role_id, data.scopes, redis)
    ...
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pytest test/test_data_scope_api.py -v`
Expected: 3 passed。

- [ ] **Step 6: 提交**

```bash
git add src/modules/data_auth src/modules/role/api.py test/test_data_scope_api.py
git commit -m "feat: 增加角色数据范围查询与全量覆盖接口"
```

---

### Task 5: ACL 服务与通用路由工厂

**Files:**
- Modify: `src/modules/data_auth/schema.py`, `src/modules/data_auth/repository.py`, `src/modules/data_auth/service.py`
- Create: `src/modules/data_auth/router.py`
- Test: `test/test_acl_service.py`

**Interfaces:**
- Consumes: `ResourceAcl`、`assert_can_manage_resource`、`can_manage`。
- Produces:

```python
class AclCreate(BaseModel):
    subject_type: Literal["user", "role"]
    subject_id: int
    access_level: Literal["view", "manage"]

class AclRead(BaseModel):
    id: int
    resource_type: str
    resource_id: int
    subject_type: str
    subject_id: int
    subject_name: str
    access_level: str
    granted_by: int | None
    granted_by_name: str | None
    granted_at: datetime
    updated_at: datetime

class AclService:
    async def list(self, resource_type, resource_id) -> list[AclRead]
    async def upsert(self, resource_type, resource_id, owner_id, data, ctx) -> AclRead
    async def delete(self, resource_type, resource_id, acl_id) -> None

async def delete_acl_for_resource(db, resource_type: str, resource_id: int) -> None

def make_acl_router(
    *, resource_type: str, view_permission: str, update_permission: str,
    load_resource: Callable[[AsyncSession, int], Awaitable[Any | None]],
) -> APIRouter

# 共享对象搜索：仅要求登录，供普通开发者（无 user:view / role:view）在共享抽屉中搜索
share_subjects_router: APIRouter  # GET /share/subjects?subject_type=user|role&keyword=
```

- 共享对象搜索返回 `list[SubjectOption]`：`{id: int, name: str, type: "user" | "role"}`，最多 20 条；`user` 匹配 `username` / `email`，`role` 匹配 `code` / `name`。
- 该路由在 `main.py` 用 `register_api_router` 注册，并加入 RBAC 白名单 `GET /api/v1/share/subjects`；接口内部必须 `Depends(get_current_user)`，保证仅登录可访问。

- [ ] **Step 1: 写失败测试**

`test/test_acl_service.py`：

```python
import pytest
from src.core.exceptions import BizException
from src.modules.agent.model import Agent
from src.modules.data_auth.service import AclService
from src.modules.data_auth.schema import AclCreate
from src.modules.user.model import User
from src.core.rbac import PermissionContext

def ctx_for(user):
    return PermissionContext(user=user, permissions=frozenset(), role_ids=frozenset(r.id for r in user.roles))

async def test_share_to_user_and_update_level(db_session):
    owner = User(username="owner", email="o@example.com", hashed_password="x")
    target = User(username="target", email="t@example.com", hashed_password="x")
    db_session.add_all([owner, target]); await db_session.flush()
    agent = Agent(name="a", type="conversation", owner_id=owner.id)
    db_session.add(agent); await db_session.flush()

    svc = AclService(db_session)
    acl = await svc.upsert("agent", agent.id, owner.id, AclCreate(subject_type="user", subject_id=target.id, access_level="view"), ctx_for(owner))
    assert acl.access_level == "view"

    acl2 = await svc.upsert("agent", agent.id, owner.id, AclCreate(subject_type="user", subject_id=target.id, access_level="manage"), ctx_for(owner))
    assert acl2.id == acl.id and acl2.access_level == "manage"

async def test_cannot_share_to_self(db_session):
    owner = User(username="owner", email="o@example.com", hashed_password="x")
    db_session.add(owner); await db_session.flush()
    agent = Agent(name="a", type="conversation", owner_id=owner.id)
    db_session.add(agent); await db_session.flush()
    with pytest.raises(BizException):
        await AclService(db_session).upsert("agent", agent.id, owner.id, AclCreate(subject_type="user", subject_id=owner.id, access_level="view"), ctx_for(owner))

async def test_delete_removes_acl(db_session):
    owner = User(username="owner", email="o@example.com", hashed_password="x")
    target = User(username="target", email="t@example.com", hashed_password="x")
    db_session.add_all([owner, target]); await db_session.flush()
    agent = Agent(name="a", type="conversation", owner_id=owner.id)
    db_session.add(agent); await db_session.flush()
    svc = AclService(db_session)
    acl = await svc.upsert("agent", agent.id, owner.id, AclCreate(subject_type="user", subject_id=target.id, access_level="view"), ctx_for(owner))
    await svc.delete("agent", agent.id, acl.id)
    assert await svc.list("agent", agent.id) == []
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_acl_service.py -v`
Expected: FAIL，`AclService` 不存在。

- [ ] **Step 3: 实现 `AclService`**

`upsert` 规则：

1. `subject_type=user`：用户必须存在且启用；`subject_id == ctx.user.id` → 400「不能共享给自己」；`subject_id == owner_id` → 400「所有者无需共享」。
2. `subject_type=role`：角色必须存在；角色即当前用户拥有的角色也允许（用于给团队共享）。
3. 查询 `(resource_type, resource_id, subject_type, subject_id)` 是否存在：存在则更新 `access_level` 与 `updated_at`；不存在则插入。
4. `granted_by = ctx.user.id`。
5. 记录 `logger.info`（资源、主体、级别、操作者）；单个资源 ACL 条目达到 200 时额外记录 warning（建议值，不阻断）。

`list` 返回按 `id` 升序，`subject_name` / `granted_by_name` 批量查询用户与角色名称；主体不存在时名称显示 `#<id>`。

`delete` 先按 `id + resource_type + resource_id` 查询，不存在 → 404；删除后写日志。

`delete_acl_for_resource(db, resource_type, resource_id)` 删除某资源的所有 ACL 条目；资源删除时由各业务模块调用（`resource_acl` 没有跨表外键，必须应用层清理）。

- [ ] **Step 4: 实现通用路由工厂**

`src/modules/data_auth/router.py`：

```python
def make_acl_router(*, resource_type, view_permission, update_permission, load_resource) -> APIRouter:
    router = APIRouter(tags=["资源共享"])

    @router.get("/{resource_id}/acl", response_model=ResponseSchema[list[AclRead]])
    @require_permission(view_permission)
    async def list_acl(resource_id: int, ctx=Depends(get_permission_context), db=Depends(get_db)):
        resource = await load_resource(db, resource_id)
        await assert_can_manage_resource(db, resource_type, resource, ctx)
        return ResponseSchema(data=await AclService(db).list(resource_type, resource_id))

    @router.post("/{resource_id}/acl", response_model=ResponseSchema[AclRead])
    @require_permission(update_permission)
    async def add_acl(resource_id: int, data: AclCreate, ctx=..., db=...):
        resource = await load_resource(db, resource_id)
        await assert_can_manage_resource(db, resource_type, resource, ctx)
        return ResponseSchema(data=await AclService(db).upsert(resource_type, resource_id, resource.owner_id, data, ctx))

    @router.delete("/{resource_id}/acl/{acl_id}", response_model=ResponseSchema[None])
    @require_permission(update_permission)
    async def remove_acl(resource_id: int, acl_id: int, ctx=..., db=...):
        resource = await load_resource(db, resource_id)
        await assert_can_manage_resource(db, resource_type, resource, ctx)
        await AclService(db).delete(resource_type, resource_id, acl_id)
        return ResponseSchema(data=None)
    return router
```

> 工厂本身不设置 path prefix；调用方把它 include 进已有模块路由（如 `/agents`），得到 `/agents/{resource_id}/acl`。

- [ ] **Step 5: 实现共享对象搜索**

`src/modules/data_auth/router.py` 增加：

```python
share_subjects_router = APIRouter(prefix="/share", tags=["资源共享"])

@share_subjects_router.get("/subjects", response_model=ResponseSchema[list[SubjectOption]])
async def search_share_subjects(
    subject_type: Literal["user", "role"],
    keyword: str = "",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    options = await DataScopeService(db).list_subject_options(subject_type, keyword)
    return ResponseSchema(data=options)
```

在 `src/main.py` 中 `register_api_router(app, share_subjects_router)`；无需 `@require_permission`，由 `current_user` 依赖保证登录。

- [ ] **Step 6: 运行测试确认通过**

Run: `pytest test/test_acl_service.py -v`
Expected: 3 passed。

- [ ] **Step 7: 提交**

```bash
git add src/modules/data_auth test/test_acl_service.py
git commit -m "feat: 增加资源级共享 ACL 服务、通用路由工厂与共享对象搜索"
```

---

### Task 6: 归属转移

**Files:**
- Modify: `src/modules/data_auth/service.py`, `src/modules/data_auth/router.py`, `src/modules/data_auth/schema.py`
- Test: `test/test_transfer_and_delete.py`

**Interfaces:**
- Consumes: `assert_can_manage_resource`、`User`。
- Produces:
  - `class TransferRequest(BaseModel): new_owner_id: int`
  - `DataAuthService.transfer_owner(resource_type, resource, new_owner_id, ctx) -> None`
  - `POST /{resource_id}/transfer`（挂在 `make_acl_router` 中，权限为 `<资源>:update`）

- [ ] **Step 1: 写失败测试**

`test/test_transfer_and_delete.py`：

```python
import pytest
from src.core.exceptions import BizException
from src.core.rbac import PermissionContext
from src.modules.agent.model import Agent
from src.modules.data_auth.service import DataAuthService
from src.modules.user.model import User

def ctx_for(user):
    return PermissionContext(user=user, permissions=frozenset(), role_ids=frozenset())

async def test_transfer_owner(db_session):
    owner = User(username="owner", email="o@example.com", hashed_password="x")
    target = User(username="target", email="t@example.com", hashed_password="x")
    db_session.add_all([owner, target]); await db_session.flush()
    agent = Agent(name="a", type="conversation", owner_id=owner.id)
    db_session.add(agent); await db_session.flush()

    await DataAuthService(db_session).transfer_owner("agent", agent, target.id, ctx_for(owner))
    assert agent.owner_id == target.id

async def test_cannot_transfer_to_self(db_session):
    owner = User(username="owner", email="o@example.com", hashed_password="x")
    db_session.add(owner); await db_session.flush()
    agent = Agent(name="a", type="conversation", owner_id=owner.id)
    db_session.add(agent); await db_session.flush()
    with pytest.raises(BizException):
        await DataAuthService(db_session).transfer_owner("agent", agent, owner.id, ctx_for(owner))

async def test_cannot_transfer_to_disabled_user(db_session):
    owner = User(username="owner", email="o@example.com", hashed_password="x")
    target = User(username="target", email="t@example.com", hashed_password="x", is_active=False)
    db_session.add_all([owner, target]); await db_session.flush()
    agent = Agent(name="a", type="conversation", owner_id=owner.id)
    db_session.add(agent); await db_session.flush()
    with pytest.raises(BizException):
        await DataAuthService(db_session).transfer_owner("agent", agent, target.id, ctx_for(owner))
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_transfer_and_delete.py -v`
Expected: FAIL，`transfer_owner` 不存在。

- [ ] **Step 3: 实现转移**

规则：

1. `assert_can_manage_resource` 在路由层先执行；服务层再次调用保证直接调用安全。
2. `new_owner_id == ctx.user.id` → 400「不能转移给自己」。
3. `new_owner_id == resource.owner_id` → 400「新所有者与当前所有者相同」。
4. 新用户不存在或 `is_active=False` → 400「新所有者不存在或已禁用」。
5. 只更新 `resource.owner_id`，不修改 `created_by`，不删除 ACL。
6. 写应用日志（资源类型、ID、原 owner、新 owner、操作者）。

路由加入 `make_acl_router`：

```python
@router.post("/{resource_id}/transfer", response_model=ResponseSchema[None])
@require_permission(update_permission)
async def transfer(resource_id: int, data: TransferRequest, ctx=..., db=...):
    resource = await load_resource(db, resource_id)
    await assert_can_manage_resource(db, resource_type, resource, ctx)
    await DataAuthService(db).transfer_owner(resource_type, resource, data.new_owner_id, ctx)
    return ResponseSchema(data=None)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest test/test_transfer_and_delete.py -v`
Expected: 3 passed。

- [ ] **Step 5: 提交**

```bash
git add src/modules/data_auth test/test_transfer_and_delete.py
git commit -m "feat: 增加资源归属转移接口"
```

---

### Task 7: 用户/角色删除约束与归属统计

**Files:**
- Modify: `src/core/data_auth.py`, `src/modules/user/service.py`, `src/modules/role/service.py`
- Test: `test/test_transfer_and_delete.py`（追加）

**Interfaces:**
- Consumes: 四张业务表、`ResourceAcl`、`RoleDataScopeTarget`。
- Produces:
  - `count_owned_resources(db, user_id) -> dict[str, int]`
  - `count_owned_resources_bulk(db, user_ids: list[int]) -> dict[int, int]`
  - `UserService.delete_user` 拒绝仍有资源的用户，并清理 ACL / scope target 主体
  - `RoleService.delete_role` 清理 ACL / scope target 主体

- [ ] **Step 1: 追加失败测试**

```python
async def test_cannot_delete_user_with_resources(db_session):
    from src.core.exceptions import BizException
    from src.modules.user.service import UserService
    owner = User(username="owner", email="o@example.com", hashed_password="x")
    db_session.add(owner); await db_session.flush()
    db_session.add(Agent(name="a", type="conversation", owner_id=owner.id))
    await db_session.flush()
    with pytest.raises(BizException) as exc:
        await UserService(db_session).delete_user(owner.id, operator=owner)
    assert "资源" in exc.value.message or "自己" in exc.value.message

async def test_role_delete_cleans_acl_and_targets(db_session):
    from src.modules.role.model import Role
    from src.modules.role.service import RoleService
    from src.modules.data_auth.model import ResourceAcl, RoleDataScope, RoleDataScopeTarget
    role = Role(code="temp", name="临时", is_system=False)
    db_session.add(role); await db_session.flush()
    db_session.add(ResourceAcl(resource_type="agent", resource_id=1, subject_type="role",
                               subject_id=role.id, access_level="view", granted_by=1))
    scope = RoleDataScope(role_id=role.id, resource_type="agent", view_scope="SELF", manage_scope="SELF")
    db_session.add(scope); await db_session.flush()
    db_session.add(RoleDataScopeTarget(role_data_scope_id=scope.id, applies_to="VIEW",
                                       subject_type="role", subject_id=role.id))
    await db_session.flush()
    await RoleService(db_session).delete_role(role.id)
    assert (await db_session.execute(select(ResourceAcl))).scalars().all() == []
    assert (await db_session.execute(select(RoleDataScopeTarget))).scalars().all() == []
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_transfer_and_delete.py -v`
Expected: FAIL，删除未检查资源、未清理 ACL。

- [ ] **Step 3: 实现归属统计**

```python
RESOURCE_MODELS = {
    "agent": Agent, "prompt": Prompt, "knowledge": KnowledgeBase, "tool": Tool,
}

async def count_owned_resources(db, user_id: int) -> dict[str, int]:
    return {
        rt: (await db.execute(select(func.count()).select_from(model).where(model.owner_id == user_id))).scalar_one()
        for rt, model in RESOURCE_MODELS.items()
    }
```

`count_owned_resources_bulk` 用 4 条 `GROUP BY owner_id` 查询合并为 `{user_id: total}`；供用户列表展示。

- [ ] **Step 4: 接入删除约束**

`UserService.delete_user`：

1. 保留 RBAC 内核的“不能删除自己 / 最后一个超级管理员”保护。
2. `counts = await count_owned_resources(db, user.id)`；任一 > 0 → `BizException(400, f"请先转移其名下资源（Agent {a}、Prompt {p}、知识库 {k}、工具 {t}）")`。
3. 删除 `resource_acl` 中 `subject_type='user' and subject_id=user_id` 的条目。
4. 删除 `role_data_scope_targets` 中 `subject_type='user' and subject_id=user_id` 的条目。
5. 该用户作为 `granted_by` 的 ACL 条目保留，`granted_by` 由外键 `ON DELETE SET NULL` 自动置空。
6. 失效该用户缓存后删除用户。

`RoleService.delete_role`：

1. 保留内置角色、仍有用户保护。
2. 删除 `resource_acl` 中 `subject_type='role' and subject_id=role_id`。
3. 删除 `role_data_scope_targets` 中 `subject_type='role' and subject_id=role_id`。
4. `role_data_scopes` 通过 FK `ON DELETE CASCADE` 自动清理。
5. 删除角色前失效原角色用户缓存。

- [ ] **Step 5: 运行测试确认通过**

Run: `pytest test/test_transfer_and_delete.py -v`
Expected: 5 passed。

- [ ] **Step 6: 提交**

```bash
git add src/core/data_auth.py src/modules/user/service.py src/modules/role/service.py test/test_transfer_and_delete.py
git commit -m "feat: 用户删除校验资源归属并清理角色授权残留"
```

---

### Task 8: 数据级授权验收

**Files:**
- Test: `test/test_data_auth_flow.py`

**Interfaces:**
- Consumes: Task 1-7 的全部能力，以及 `Agent` 模型。
- Produces: 跨用户、范围、共享、转移的验收测试。

- [ ] **Step 1: 写验收测试**

`test/test_data_auth_flow.py`：

```python
from sqlalchemy import select
from src.core.rbac import load_permission_context
from src.core.data_auth import visible_condition, assert_can_view_resource, assert_can_manage_resource
from src.core.exceptions import BizException
from src.modules.agent.model import Agent
from src.modules.data_auth.model import ResourceAcl, RoleDataScope
from src.modules.role.model import Role
from src.modules.user.model import User
import pytest

async def setup_users(db_session):
    dev = Role(code="developer", name="开发者", is_system=True)
    a = User(username="a", email="a@example.com", hashed_password="x", roles=[dev])
    b = User(username="b", email="b@example.com", hashed_password="x", roles=[dev])
    db_session.add_all([dev, a, b]); await db_session.flush()
    db_session.add_all([
        Agent(name="a-agent", type="conversation", owner_id=a.id),
        Agent(name="b-agent", type="conversation", owner_id=b.id),
    ])
    await db_session.flush()
    return dev, a, b

async def list_names(db_session, ctx):
    rows = (await db_session.execute(select(Agent).where(visible_condition(Agent, "agent", ctx)))).scalars().all()
    return sorted(r.name for r in rows)

async def test_view_all_manage_self(db_session, fake_redis):
    dev, a, b = await setup_users(db_session)
    db_session.add(RoleDataScope(role_id=dev.id, resource_type="agent", view_scope="ALL", manage_scope="SELF"))
    await db_session.flush()
    ctx = await load_permission_context(a, db_session, fake_redis)
    assert await list_names(db_session, ctx) == ["a-agent", "b-agent"]
    b_agent = (await db_session.execute(select(Agent).where(Agent.name == "b-agent"))).scalar_one()
    await assert_can_view_resource(db_session, "agent", b_agent, ctx)
    with pytest.raises(BizException):
        await assert_can_manage_resource(db_session, "agent", b_agent, ctx)

async def test_view_self_hides_other(db_session, fake_redis):
    dev, a, b = await setup_users(db_session)
    db_session.add(RoleDataScope(role_id=dev.id, resource_type="agent", view_scope="SELF", manage_scope="SELF"))
    await db_session.flush()
    ctx = await load_permission_context(a, db_session, fake_redis)
    assert await list_names(db_session, ctx) == ["a-agent"]
    b_agent = (await db_session.execute(select(Agent).where(Agent.name == "b-agent"))).scalar_one()
    with pytest.raises(BizException):
        await assert_can_view_resource(db_session, "agent", b_agent, ctx)

async def test_acl_share_view_then_manage_then_remove(db_session, fake_redis):
    dev, a, b = await setup_users(db_session)
    db_session.add(RoleDataScope(role_id=dev.id, resource_type="agent", view_scope="SELF", manage_scope="SELF"))
    await db_session.flush()
    a_agent = (await db_session.execute(select(Agent).where(Agent.name == "a-agent"))).scalar_one()

    acl = ResourceAcl(resource_type="agent", resource_id=a_agent.id, subject_type="user",
                      subject_id=b.id, access_level="view", granted_by=a.id)
    db_session.add(acl); await db_session.flush()

    ctx_b = await load_permission_context(b, db_session, fake_redis)
    assert "a-agent" in await list_names(db_session, ctx_b)
    await assert_can_view_resource(db_session, "agent", a_agent, ctx_b)
    with pytest.raises(BizException):
        await assert_can_manage_resource(db_session, "agent", a_agent, ctx_b)

    acl.access_level = "manage"; await db_session.flush()
    await assert_can_manage_resource(db_session, "agent", a_agent, ctx_b)

    await db_session.delete(acl); await db_session.flush()
    with pytest.raises(BizException):
        await assert_can_view_resource(db_session, "agent", a_agent, ctx_b)
```

- [ ] **Step 2: 运行测试确认通过**

Run: `pytest test/test_data_auth_flow.py -v`
Expected: 3 passed。

- [ ] **Step 3: 运行相关全部测试**

Run: `pytest test/test_data_auth_seed.py test/test_data_scope_compile.py test/test_data_auth_predicates.py test/test_data_scope_api.py test/test_acl_service.py test/test_transfer_and_delete.py test/test_data_auth_flow.py -v`
Expected: 全部通过。

- [ ] **Step 4: 索引与缓存性能检查**

1. SQLite 开发库执行 `EXPLAIN QUERY PLAN SELECT * FROM agents WHERE owner_id = 1;`，输出应使用 `ix_agents_owner_id`。
2. 执行 `EXPLAIN QUERY PLAN SELECT * FROM resource_acl WHERE resource_type='agent' AND resource_id=1;`，输出应使用 `ix_resource_acl_resource`。
3. 在 `test/test_permission_context.py` 增加缓存命中测试：对同一用户连续调用两次 `load_permission_context`，用 SQLAlchemy `event.listen(engine, "before_cursor_execute", counter)` 统计第二次的 SQL 数量为 0。
4. 10,000 行 Agent 的列表过滤 P95 ≤ 200ms、缓存命中鉴权 P95 ≤ 10ms 作为上线前压测项；本计划只保证索引存在与缓存命中不查库，压测在联调阶段执行。

- [ ] **Step 5: 提交**

```bash
git add test/test_data_auth_flow.py
git commit -m "test: 增加数据级授权跨用户共享与范围验收"
```

---

## 验收对照

| 验收项 | 落点 |
|---|---|
| AC-17 开发者 view SELF 只看本人，total 正确 | Task 3、Task 8 |
| AC-18 直连他人详情 403 | Task 3 |
| AC-19 修改/删除他人资源 403 | Task 3 |
| AC-20 view ALL / manage SELF 可看不可改 | Task 3、Task 8 |
| AC-21 管理员全量 | Task 2 |
| AC-22 运营知识库 manage ALL | Task 1 默认值、Task 2 |
| AC-23/24 CUSTOM 用户/角色 | Task 2、Task 4 |
| AC-25 多角色并集 | Task 2 |
| AC-26/27/28 共享只读、可管理、取消即时生效 | Task 5、Task 8 |
| AC-29 共享给角色 | Task 5 |
| AC-30 非管理者共享 403 | Task 5 路由层 `assert_can_manage_resource` |
| AC-31 转移归属 | Task 6 |
| AC-32 删除有资源用户拒绝 | Task 7 |
| AC-33 删除角色清理范围与 ACL | Task 7 |
| AC-34 知识库文档/分段继承 | 各业务模块计划 |
| AC-37 详情返回 owner_id/owner_name/can_manage/is_shared | 各业务模块计划 |
| AC-38 created_by 与 owner_id | Task 1、各业务模块计划 |

## 依赖与顺序

1. 必须先完成 `RBAC权限内核-plan.md`。
2. 本计划的 Task 1-7 完成后，四个业务模块计划才能接入 `owner_id`、`visible_condition`、`assert_can_*`、`make_acl_router`。
3. `前端权限控制-plan.md` 的共享/转移组件依赖 Task 5-6 的接口。
4. `系统管理-plan.md` 的角色双 Tab 依赖 Task 4 的数据范围接口。

## 风险与决策

| 项 | 决策 |
|---|---|
| `manage` 是否隐含 `view` | 是。管理者必须能看到自己可管理的数据；与原型 §6.3 一致 |
| 无角色用户 | 默认 `SELF/SELF`，避免“没有角色反而看全部” |
| CUSTOM 角色目标的计算 | 查询时实时按 `user_roles` 计算，不做快照 |
| ACL 是否进缓存 | 不进；列表用 `EXISTS`、详情实时查，保证即时生效 |
| 列表逐行 `can_manage` | 分页查询后对当前页资源 ID 做一次 ACL 批量查询，再在 Python 合并范围判定，避免 N+1 |
| 历史数据归属 | 统一归初始 admin；开发者默认 `view ALL`，避免迁移后看不到数据（RK-02） |
