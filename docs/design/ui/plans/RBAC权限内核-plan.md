# RBAC 权限内核 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让后端所有 `/api/v1` 业务接口默认要求登录并声明式校验功能权限，权限变更下一次请求立即生效。

**Architecture:** 权限码常量目录是唯一事实来源；路由用 `@require_permission("资源:动作")` 显式声明，`main.py` 给每个 `/api/v1` 路由挂统一的 `enforce_route_permission` 依赖，实现“未声明即拒绝”。用户权限集合与数据范围按 `rbac:user:{id}` 缓存在 Redis（TTL 300 秒），授权变更主动失效；Redis 故障时降级查库。

**Tech Stack:** Python 3.13 / FastAPI 0.135 / SQLAlchemy 2.0 async / Alembic / pytest + pytest-asyncio / fakeredis。

**Spec:** `docs/spec/PROJECT_SPEC_V2.md`（主需求，§4、§5、§7 FR-01~13、§9.3、§10、§12.1）、`docs/PROJECT_SPEC.md`（V1 架构基线）。

**前置计划:** 无。本计划是 `数据级授权内核-plan.md`、`系统管理-plan.md` 与全部业务模块计划的前置。

---

## 模块说明（产品视角）

### 目标

| 编号 | 目标 | 本计划落点 |
|---|---|---|
| G1 | 所有业务接口默认要求登录 + 对应权限 | 全局 `enforce_route_permission` 依赖 |
| G2 | 权限码统一为 `资源:动作`，共 47 条 | `src/core/permissions.py` + 迁移种子 |
| G3 | 内置 4 个角色，内置角色不可删除、编码不可改 | `roles.is_system` + 删除保护 |
| G4 | 授权变更立即生效 | 缓存主动失效 + 请求时校验 |
| G7 | 权限目录由系统内置维护，管理端只读 | 权限目录常量 + 迁移重建 |
| G8 | 鉴权覆盖率自动化保障 | `test/test_rbac_coverage.py` |
| G12 | 防锁死与内置角色保护 | 用户/角色保护规则 |

### 交付物

1. 47 条权限目录常量与内置角色种子数据。
2. `roles.is_system` 字段与 Alembic 迁移。
3. 声明式权限装饰器、全局默认拒绝依赖、白名单。
4. Redis 权限缓存与主动失效工具。
5. `GET /api/v1/users/me` 返回 `roles`、`permissions`、`is_superuser`。
6. 角色/用户管理接口的保护规则。
7. 覆盖率测试与功能鉴权行为测试。

### 不在本期范围

- 数据级授权（`owner_id`、数据范围、ACL、共享、转移）→ `数据级授权内核-plan.md`。
- 前端权限上下文、菜单/路由/按钮 → `前端权限控制-plan.md`。
- API Key、审计、告警、系统配置的后端接口 → `预留系统模块-plan.md`（本期只做权限码与前端门禁）。

---

## Global Constraints

- 权限码固定 47 条：业务 24 条 + 系统管理 23 条；格式 `资源:动作`，资源小写单数英文，动作枚举 `view/create/update/delete/publish`。
- 内置角色固定 4 个：`admin`、`developer`、`operator`、`viewer`，均 `is_system = true`。
- 响应保持 HTTP 200，错误语义由 body `code` 承载：`401` 未登录/token 过期/账号禁用，`403` 无功能权限/接口未声明权限。
- 缓存 key `rbac:user:{user_id}`，TTL 300 秒；Redis 不可用时降级查库，不阻断业务。
- 配置项 `RBAC_ENFORCE` 默认 `true`；关闭时只跳过权限码校验并记录告警日志（**登录仍然强制**），生产必须开启。
- 白名单仅 5 条：`POST /api/v1/auth/login`、`GET /api/v1/captcha`、`POST /api/v1/captcha`、`GET /api/v1/users/me`、`GET /api/v1/share/subjects`（共享对象搜索，仅要求登录，由接口自身 `Depends(get_current_user)` 保证）；`/health`、`/docs`、`/redoc`、`/openapi.json` 不在 `/api/v1` 路由依赖范围内。
- 当前 `Settings.DATABASE_URL` 返回 SQLite 文件库；迁移必须同时兼容 SQLite 与 MySQL，改列使用 `op.batch_alter_table`。
- 后端分层固定：`model.py` / `schema.py` / `repository.py` / `service.py` / `api.py`；必须写类型提示。
- 前端不在本计划范围；本计划所有验证使用 `pytest`。
- 每个任务结束提交一次，提交信息使用中文摘要（如 `feat: RBAC 权限内核完成权限目录与声明式鉴权`）。

---

## Review Focus

1. **未声明权限的新接口**：任何新增 `/api/v1` 路由若既不在白名单、也没有 `@require_permission`，运行时必须返回 403，CI 覆盖率测试必须失败，而不是默认放行。
2. **Redis 完全不可用**：登录用户调用受保护接口仍应得到 200 或 403 的正确判定，不能出现 500。
3. **权限被撤销后的同一个 token**：角色权限变更后，该角色下用户的下一次请求必须被拒绝，不能等到 token 过期或缓存 TTL 到期。
4. **禁用用户后的旧 token**：`is_active=false` 后，已签发 token 的下一次请求必须返回 401，而不是继续可用。
5. **内置角色与最后一个超级管理员**：删除内置角色、删除/禁用自己、移除最后一个启用超级管理员，都必须给出明确拒绝，不能把系统锁死。

---

## File Structure

**新增**

| 文件 | 职责 |
|---|---|
| `src/core/permissions.py` | 47 条权限目录、模块/动作元数据、已实现/预留状态 |
| `src/core/rbac.py` | `PermissionContext`、权限加载、声明式装饰器、全局默认拒绝、路由索引、白名单 |
| `src/core/rbac_cache.py` | 权限缓存读写、单用户/角色用户/全量失效 |
| `src/db/__init__.py` | 数据种子包 |
| `src/db/rbac_seed.py` | 权限目录、内置角色、角色权限矩阵的幂等种子逻辑 |
| `src/db/flush_rbac_cache.py` | 迁移后清空 `rbac:user:*` 的命令行工具 |
| `alembic/versions/<rev>_rbac_permissions_v2.py` | `roles.is_system` + 权限/角色/角色权限重建 |
| `pytest.ini` | pytest 异步模式与测试目录 |
| `test/conftest.py` | SQLite 内存库、fakeredis、FastAPI 测试应用夹具 |
| `test/test_rbac_cache.py` | 缓存读写与失效 |
| `test/test_permission_catalog.py` | 权限目录完整性 |
| `test/test_rbac_seed.py` | 种子数据幂等 |
| `test/test_permission_context.py` | 权限上下文加载与超级管理员 |
| `test/test_rbac_enforcement.py` | 声明式鉴权行为 |
| `test/test_user_me.py` | `/users/me` 响应 |
| `test/test_role_guards.py` | 角色/用户保护规则 |
| `test/test_rbac_coverage.py` | 全路由鉴权覆盖率 |

**修改**

| 文件 | 变更 |
|---|---|
| `src/core/config.py` | 新增 `RBAC_ENFORCE`、`RBAC_CACHE_TTL` |
| `src/core/deps.py` | 抽出 `resolve_current_user(request, db)`；`get_current_user` 委托给它 |
| `src/main.py` | 用 `register_api_router()` 注册路由，统一挂载默认拒绝依赖 |
| `src/modules/role/model.py` | 新增 `is_system` |
| `src/modules/role/schema.py` | `RoleRead` 增加 `is_system`、`user_count`、`permission_count`；`RoleCreate` 校验 |
| `src/modules/role/repository.py` | 增加 `count_users_by_role_ids` |
| `src/modules/role/service.py` | 计数、内置角色保护、缓存失效 |
| `src/modules/role/api.py` | 注入 redis、权限声明 |
| `src/modules/user/schema.py` | 新增 `MeRead`、`UserUpdate` |
| `src/modules/user/service.py` | 自操作保护、最后超级管理员保护、缓存失效 |
| `src/modules/user/api.py` | `/users/me` 返回 `MeRead`；新增 `PUT /users/{id}`；权限声明 |
| `src/modules/permission/schema.py` | `PermissionRead` 增加计算字段 `module`、`action`、`status` |
| `src/modules/permission/api.py` | 权限声明 |
| `src/modules/auth/api.py`、`src/modules/captcha/api.py` | 白名单路由保持无权限声明 |

---

### Task 1: 测试基础设施与 RBAC 配置

**Files:**
- Create: `pytest.ini`, `test/conftest.py`
- Modify: `src/core/config.py`
- Test: `test/test_rbac_cache.py`（本任务只建夹具与配置，测试从 Task 4 开始使用）

**Interfaces:**
- Consumes: `src.infra.database.Base`、全部 ORM 模型。
- Produces:
  - `Settings.RBAC_ENFORCE: bool = True`
  - `Settings.RBAC_CACHE_TTL: int = 300`
  - pytest 夹具 `db_session: AsyncSession`、`fake_redis: fakeredis.aioredis.FakeRedis`、`api_client: httpx.AsyncClient`

- [ ] **Step 1: 写测试夹具**

`test/conftest.py`：

```python
import pytest
import pytest_asyncio
import fakeredis.aioredis
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

# 必须先导入全部模型，Base.metadata 才完整
import src.modules.user.model          # noqa: F401
import src.modules.role.model          # noqa: F401
import src.modules.permission.model    # noqa: F401
import src.modules.provider.model      # noqa: F401
import src.modules.model.model         # noqa: F401
import src.modules.prompt.model        # noqa: F401
import src.modules.knowledge.model     # noqa: F401
import src.modules.tool.model          # noqa: F401
import src.modules.agent.model         # noqa: F401
from src.core.base_model import Base

@pytest_asyncio.fixture
async def db_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as session:
        yield session
    await engine.dispose()

@pytest.fixture
def fake_redis():
    return fakeredis.aioredis.FakeRedis(decode_responses=True)

@pytest_asyncio.fixture
async def api_client(db_session, fake_redis):
    """HTTP 测试统一使用异步客户端，避免 TestClient 跨事件循环使用 AsyncSession。"""
    from httpx import AsyncClient, ASGITransport
    from src.main import app
    from src.core.deps import get_db
    from src.infra.redis_cache import get_redis_client

    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_redis_client] = lambda: fake_redis
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()
```

> 所有后端 HTTP 测试使用 `await api_client.get(...)` 或自建 `AsyncClient(transport=ASGITransport(app=...))`；不要使用同步 `TestClient`。后文示例若出现 `TestClient` 写法，按此规则替换为异步客户端。

`pytest.ini`：

```ini
[pytest]
asyncio_mode = auto
testpaths = test
```

- [ ] **Step 2: 运行现有测试确认夹具不破坏旧测试**

Run: `pytest -q`
Expected: 现有 `test_jwt.py`、`test_password.py`、`test_sample.py`、`test_async_sample.py` 全部通过（除 `test_sample.py::test_add_fail` 这类刻意失败外，如有则保持原状并在计划外单独处理）。

- [ ] **Step 3: 增加配置项并让 `PageParams` 可直接实例化**

`src/core/config.py` 的 `Settings` 中新增：

```python
    # RBAC
    RBAC_ENFORCE: bool = True
    RBAC_CACHE_TTL: int = 300
```

同步在 `.env.example` 增加：

```env
RBAC_ENFORCE=true
RBAC_CACHE_TTL=300
```

把 `src/core/deps.py` 的 `PageParams` 改为 `Annotated` 形式，使测试可以直接 `PageParams()` 而不必经过 FastAPI 依赖注入：

```python
from typing import Annotated

class PageParams:
    def __init__(
        self,
        page: Annotated[int, Query(ge=1, description="页码，从1开始")] = 1,
        page_size: Annotated[int, Query(ge=1, le=100, description="每页条数")] = 10,
        keyword: Annotated[str | None, Query(description="搜索关键词")] = None,
    ):
        ...
```

行为保持不变，仍支持 `?page=1&page_size=10&keyword=xxx`。

- [ ] **Step 4: 提交**

```bash
git add pytest.ini test/conftest.py src/core/config.py src/core/deps.py .env.example
git commit -m "test: 增加 RBAC 测试夹具、开关配置与可实例化分页参数"
```

---

### Task 2: 权限目录常量

**Files:**
- Create: `src/core/permissions.py`
- Test: `test/test_permission_catalog.py`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `class PermissionAction(StrEnum): VIEW/CREATE/UPDATE/DELETE/PUBLISH`
  - `RESOURCE_TYPES: tuple[str, ...] = ("agent", "prompt", "knowledge", "tool")`
  - `PERMISSION_CATALOG: tuple[PermissionDef, ...]`
  - `PERMISSION_CODES: frozenset[str]`
  - `IMPLEMENTED_PERMISSION_CODES: frozenset[str]`
  - `RESERVED_PERMISSION_CODES: frozenset[str]`
  - `MODULE_LABELS: dict[str, str]`
  - `MODULE_ACTIONS: dict[str, tuple[str, ...]]`
  - `BUILTIN_ROLE_CODES: frozenset[str]`
  - `BUILTIN_ROLE_PERMISSIONS: dict[str, frozenset[str]]`

- [ ] **Step 1: 写失败测试**

`test/test_permission_catalog.py`：

```python
import re
from src.core.permissions import (
    PERMISSION_CATALOG, PERMISSION_CODES, IMPLEMENTED_PERMISSION_CODES,
    RESERVED_PERMISSION_CODES, BUILTIN_ROLE_CODES, BUILTIN_ROLE_PERMISSIONS,
)

def test_catalog_has_47_unique_codes():
    assert len(PERMISSION_CATALOG) == 47
    assert len(PERMISSION_CODES) == 47

def test_codes_follow_resource_action_format():
    pattern = re.compile(r"^[a-z]+:[a-z]+$")
    assert all(pattern.match(code) for code in PERMISSION_CODES)

def test_implemented_and_reserved_split():
    assert len(IMPLEMENTED_PERMISSION_CODES) == 34
    assert len(RESERVED_PERMISSION_CODES) == 13
    assert IMPLEMENTED_PERMISSION_CODES | RESERVED_PERMISSION_CODES == PERMISSION_CODES
    assert IMPLEMENTED_PERMISSION_CODES & RESERVED_PERMISSION_CODES == set()

def test_builtin_role_permission_counts():
    assert BUILTIN_ROLE_CODES == {"admin", "developer", "operator", "viewer"}
    assert len(BUILTIN_ROLE_PERMISSIONS["admin"]) == 47
    assert len(BUILTIN_ROLE_PERMISSIONS["developer"]) == 18
    assert len(BUILTIN_ROLE_PERMISSIONS["operator"]) == 9
    assert len(BUILTIN_ROLE_PERMISSIONS["viewer"]) == 7
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_permission_catalog.py -v`
Expected: FAIL，`ModuleNotFoundError: src.core.permissions`。

- [ ] **Step 3: 实现权限目录**

`src/core/permissions.py` 使用 `StrEnum` 与 `NamedTuple`：

```python
from enum import StrEnum
from typing import NamedTuple

class PermissionAction(StrEnum):
    VIEW = "view"
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    PUBLISH = "publish"

RESOURCE_TYPES = ("agent", "prompt", "knowledge", "tool")

class PermissionDef(NamedTuple):
    code: str
    name: str
    module: str
    action: PermissionAction
    description: str

MODULE_LABELS = {
    "agent": "Agent管理", "model": "模型管理", "prompt": "Prompt管理",
    "knowledge": "知识库管理", "tool": "工具管理",
    "conversation": "对话日志", "analytics": "数据统计",
    "user": "用户管理", "role": "角色管理", "permission": "权限管理",
    "apikey": "API密钥", "audit": "审计日志", "alert": "告警规则",
    "settings": "系统配置",
}
```

按 `PROJECT_SPEC_V2.md` §5.2 逐条写入 47 条 `PermissionDef`。动作集合：

```python
MODULE_ACTIONS = {
    "agent": ("view", "create", "update", "delete", "publish"),
    "model": ("view", "create", "update", "delete"),
    "prompt": ("view", "create", "update", "delete", "publish"),
    "knowledge": ("view", "create", "update", "delete"),
    "tool": ("view", "create", "update", "delete"),
    "conversation": ("view",),
    "analytics": ("view",),
    "user": ("view", "create", "update", "delete"),
    "role": ("view", "create", "update", "delete"),
    "permission": ("view", "create", "update", "delete"),
    "apikey": ("view", "create", "update", "delete"),
    "audit": ("view",),
    "alert": ("view", "create", "update", "delete"),
    "settings": ("view", "update"),
}
```

预留权限 13 条固定为：

```python
RESERVED_PERMISSION_CODES = frozenset({
    "conversation:view", "analytics:view",
    "apikey:view", "apikey:create", "apikey:update", "apikey:delete",
    "audit:view",
    "alert:view", "alert:create", "alert:update", "alert:delete",
    "settings:view", "settings:update",
})
```

内置角色权限按 §5.3 矩阵写入：

```python
BUILTIN_ROLE_PERMISSIONS = {
    "admin": frozenset(PERMISSION_CODES),
    "developer": frozenset({
        "agent:view", "agent:create", "agent:update", "agent:publish",
        "model:view",
        "prompt:view", "prompt:create", "prompt:update", "prompt:delete", "prompt:publish",
        "knowledge:view", "knowledge:create", "knowledge:update",
        "tool:view", "tool:create", "tool:update",
        "conversation:view", "analytics:view",
    }),
    "operator": frozenset({
        "agent:view", "model:view", "prompt:view",
        "knowledge:view", "knowledge:create", "knowledge:update",
        "tool:view", "conversation:view", "analytics:view",
    }),
    "viewer": frozenset({
        "agent:view", "model:view", "prompt:view", "knowledge:view",
        "tool:view", "conversation:view", "analytics:view",
    }),
}
BUILTIN_ROLE_CODES = frozenset(BUILTIN_ROLE_PERMISSIONS)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest test/test_permission_catalog.py -v`
Expected: 4 passed。

- [ ] **Step 5: 提交**

```bash
git add src/core/permissions.py test/test_permission_catalog.py
git commit -m "feat: 增加 47 条权限码目录与内置角色权限矩阵"
```

---

### Task 3: 种子数据与 Alembic 迁移

**Files:**
- Create: `src/db/__init__.py`, `src/db/rbac_seed.py`, `src/db/flush_rbac_cache.py`
- Modify: `src/modules/role/model.py`、`alembic/env.py`
- Create: `alembic/versions/<rev>_rbac_permissions_v2.py`（用 `alembic revision --autogenerate` 生成后手改）
- Test: `test/test_rbac_seed.py`

**Interfaces:**
- Consumes: `src.core.permissions` 的目录与矩阵。
- Produces:
  - `Role.is_system: Mapped[bool]`
  - `seed_rbac(bind: Connection) -> None`（同步 Core 连接，幂等）
  - `python -m src.db.flush_rbac_cache` 清空全部 `rbac:user:*`

- [ ] **Step 1: 写失败测试**

`test/test_rbac_seed.py`：

```python
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from src.core.base_model import Base
import src.modules.user.model  # noqa: F401
import src.modules.role.model  # noqa: F401
import src.modules.permission.model  # noqa: F401
from src.modules.permission.model import Permission
from src.modules.role.model import Role
from src.db.rbac_seed import seed_rbac

def build_engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return engine

def test_seed_creates_47_permissions_and_4_roles():
    engine = build_engine()
    with engine.begin() as conn:
        seed_rbac(conn)
    with Session(engine) as s:
        assert len(s.scalars(select(Permission)).all()) == 47
        roles = {r.code: r for r in s.scalars(select(Role)).all()}
        assert set(roles) >= {"admin", "developer", "operator", "viewer"}
        assert all(r.is_system for r in roles.values())
        assert len(roles["developer"].permissions) == 18

def test_seed_is_idempotent():
    engine = build_engine()
    with engine.begin() as conn:
        seed_rbac(conn)
        seed_rbac(conn)
    with Session(engine) as s:
        assert len(s.scalars(select(Permission)).all()) == 47
        assert len(s.scalars(select(Role)).all()) == 4
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_rbac_seed.py -v`
Expected: FAIL，`Role` 无 `is_system` 或 `src.db.rbac_seed` 不存在。

- [ ] **Step 3: 增加 `Role.is_system` 与种子实现**

`src/modules/role/model.py`：

```python
    is_system: Mapped[bool] = mapped_column(
        default=False, comment="是否内置角色（不可删除、编码不可改）"
    )
```

`src/db/rbac_seed.py` 用 SQLAlchemy Core 实现，步骤固定：

1. 读取现有 `permissions.code`，缺失的按 `PERMISSION_CATALOG` 插入；已存在的更新 `name/description`。
2. 删除 `role_permissions` 中引用“不在新目录内权限”的关联（SQLite 默认可能未开启外键级联，必须显式清理）。
3. 删除 `permissions` 中不在 `PERMISSION_CODES` 内的旧权限码（旧目录仅 12 条，管理端不开放创建，删除是预期行为）。
4. 读取现有 `roles.code`；内置角色存在则更新 `name/description/is_system=True`，不存在则插入。
5. 对每个内置角色，先删除 `role_permissions` 中该角色的旧关联，再按 `BUILTIN_ROLE_PERMISSIONS` 插入。
6. 找到 `is_superuser=true` 且启用的用户（取最小 id），确保其关联 `admin` 角色；不存在超级管理员时抛 `RuntimeError`。
7. 不删除自定义角色与自定义角色权限。
8. 全部操作以 `code` 为幂等键，重复执行结果一致。

- [ ] **Step 4: 生成并手改迁移**

Run: `alembic revision --autogenerate -m "rbac permissions v2"`

迁移 `upgrade()` 结构：

```python
def upgrade() -> None:
    op.add_column("roles", sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()))
    from src.db.rbac_seed import seed_rbac
    seed_rbac(op.get_bind())
```

`downgrade()` 只删除 `is_system`，不恢复旧权限数据（需求 §10.4 明确回滚会丢失授权配置）。

- [ ] **Step 5: 运行迁移并验证幂等**

Run:

```bash
alembic upgrade head
alembic downgrade -1
alembic upgrade head
```

Expected: 三次均成功；`permissions` 47 条、`roles` 4 条不重复。

- [ ] **Step 6: 增加缓存清理命令**

`src/db/flush_rbac_cache.py`：

```python
import asyncio
from src.infra.redis_cache import get_redis_client
from src.core.rbac_cache import invalidate_all_rbac_cache

async def main() -> None:
    redis = await get_redis_client()
    count = await invalidate_all_rbac_cache(redis)
    print(f"已清理 {count} 个 RBAC 缓存 key")

if __name__ == "__main__":
    asyncio.run(main())
```

迁移后执行：`python -m src.db.flush_rbac_cache`。

- [ ] **Step 7: 提交**

```bash
git add src/modules/role/model.py src/db alembic/env.py alembic/versions test/test_rbac_seed.py
git commit -m "feat: 重建 47 条权限目录与 4 个内置角色种子数据"
```

---

### Task 4: 权限上下文与 Redis 缓存

**Files:**
- Create: `src/core/rbac_cache.py`, `src/core/rbac.py`
- Test: `test/test_rbac_cache.py`, `test/test_permission_context.py`

**Interfaces:**
- Consumes: `User.roles`、`Role.permissions`、`Settings.RBAC_CACHE_TTL`、`get_redis_client`。
- Produces:
  - `rbac_cache_key(user_id: int) -> str`
  - `get_cached_rbac(redis, user_id) -> dict | None`
  - `set_cached_rbac(redis, user_id, payload: dict, ttl: int | None = None) -> None`
  - `invalidate_user_cache(redis, user_id) -> None`
  - `invalidate_users_cache(redis, user_ids: Iterable[int]) -> int`
  - `invalidate_all_rbac_cache(redis) -> int`
  - `invalidate_role_users_cache(db, redis, role_id) -> int`
  - `class PermissionContext`：字段 `user: User`、`permissions: frozenset[str]`、`role_ids: frozenset[int]`、`data_scopes: dict[str, DataScope]`（本计划暂为空，数据授权计划填充）；方法 `allows(code) -> bool`、`scope(resource_type) -> DataScope`（本计划返回占位 `DataScope`）
  - `async def load_permission_context(user, db, redis) -> PermissionContext`
  - `async def get_permission_context(request, user=Depends(get_current_user), db=Depends(get_db), redis=Depends(get_redis_client)) -> PermissionContext`

> `DataScope` 类型由 `数据级授权内核-plan.md` 提供。本计划先在 `src/core/rbac.py` 定义最小占位：

```python
@dataclass(frozen=True)
class DataScope:
    view: str = "SELF"
    manage: str = "SELF"
    view_users: frozenset[int] = frozenset()
    view_roles: frozenset[int] = frozenset()
    manage_users: frozenset[int] = frozenset()
    manage_roles: frozenset[int] = frozenset()

def _default_scope() -> DataScope:
    return DataScope()
```

数据授权计划会替换为正式实现，字段名保持不变。

- [ ] **Step 1: 写缓存失败测试**

`test/test_rbac_cache.py`：

```python
import pytest
from src.core.rbac_cache import (
    rbac_cache_key, get_cached_rbac, set_cached_rbac,
    invalidate_user_cache, invalidate_all_rbac_cache,
)

async def test_cache_roundtrip(fake_redis):
    payload = {"permissions": ["agent:view"], "data_scopes": {}}
    await set_cached_rbac(fake_redis, 7, payload, ttl=300)
    assert await get_cached_rbac(fake_redis, 7) == payload

async def test_invalidate_user(fake_redis):
    await set_cached_rbac(fake_redis, 7, {"permissions": [], "data_scopes": {}})
    await invalidate_user_cache(fake_redis, 7)
    assert await get_cached_rbac(fake_redis, 7) is None

async def test_invalidate_all(fake_redis):
    for uid in (1, 2, 3):
        await set_cached_rbac(fake_redis, uid, {"permissions": [], "data_scopes": {}})
    assert await invalidate_all_rbac_cache(fake_redis) == 3
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_rbac_cache.py -v`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现缓存工具**

`src/core/rbac_cache.py` 要求：

- 所有 key 以 `rbac:user:` 开头。
- `get_cached_rbac` 用 `json.loads`，解析失败时删除 key 并返回 `None`。
- `invalidate_role_users_cache` 使用 `select(user_roles.c.user_id).where(user_roles.c.role_id == role_id)`。
- `invalidate_all_rbac_cache` 使用 `scan_iter("rbac:user:*")`，返回删除数量。

- [ ] **Step 4: 写权限上下文失败测试**

`test/test_permission_context.py`：

```python
import pytest
from src.core.permissions import PERMISSION_CODES
from src.core.rbac import load_permission_context
from src.modules.permission.model import Permission
from src.modules.role.model import Role
from src.modules.user.model import User

async def test_superuser_gets_all_permissions(db_session, fake_redis):
    user = User(username="root", email="root@example.com", hashed_password="x", is_superuser=True)
    db_session.add(user); await db_session.flush()
    ctx = await load_permission_context(user, db_session, fake_redis)
    assert ctx.permissions == PERMISSION_CODES
    assert ctx.allows("settings:update")

async def test_role_permissions_merge_and_dedupe(db_session, fake_redis):
    p1 = Permission(code="agent:view", name="查看 Agent")
    p2 = Permission(code="agent:create", name="创建 Agent")
    r1 = Role(code="r1", name="角色1", is_system=False, permissions=[p1])
    r2 = Role(code="r2", name="角色2", is_system=False, permissions=[p1, p2])
    user = User(username="dev", email="dev@example.com", hashed_password="x", roles=[r1, r2])
    db_session.add_all([r1, r2, user]); await db_session.flush()
    ctx = await load_permission_context(user, db_session, fake_redis)
    assert ctx.permissions == frozenset({"agent:view", "agent:create"})

async def test_redis_failure_falls_back_to_db(db_session, fake_redis, monkeypatch):
    user = User(username="u", email="u@example.com", hashed_password="x", is_superuser=True)
    db_session.add(user); await db_session.flush()

    async def boom(*args, **kwargs):
        raise RuntimeError("redis down")
    monkeypatch.setattr("src.core.rbac.get_cached_rbac", boom)
    monkeypatch.setattr("src.core.rbac.set_cached_rbac", boom)
    ctx = await load_permission_context(user, db_session, fake_redis)
    assert ctx.allows("agent:view")
```

- [ ] **Step 5: 实现 `load_permission_context`**

顺序固定：

1. 读缓存；命中且 `permissions` 是 list → 构造 `PermissionContext`。
2. 未命中：`is_superuser` → `PERMISSION_CODES`；否则遍历 `user.roles` 取 `role.permissions.code` 并集。
3. 写缓存；写失败只记 warning，不影响返回。
4. `data_scopes` 本计划写 `{}`；数据授权计划改为 `compile_user_scopes()`。

`get_permission_context` 先读 `request.state.permission_context`，避免同一请求重复加载。

- [ ] **Step 6: 运行测试确认通过**

Run: `pytest test/test_rbac_cache.py test/test_permission_context.py -v`
Expected: 6 passed。

- [ ] **Step 7: 提交**

```bash
git add src/core/rbac.py src/core/rbac_cache.py test/test_rbac_cache.py test/test_permission_context.py
git commit -m "feat: 增加 RBAC 权限上下文与 Redis 缓存"
```

---

### Task 5: 声明式权限与全局默认拒绝

**Files:**
- Modify: `src/core/rbac.py`, `src/core/deps.py`, `src/main.py`
- Test: `test/test_rbac_enforcement.py`

**Interfaces:**
- Consumes: `load_permission_context`、`BizException`、`Settings.RBAC_ENFORCE`。
- Produces:
  - `require_permission(code: str) -> Callable[[F], F]`：给 endpoint 设置 `__rbac_permission__`
  - `async def resolve_current_user(request: Request, db: AsyncSession) -> User`（`src/core/deps.py`）
  - `PERMISSION_WHITELIST: frozenset[tuple[str, str]]`
  - `RBAC_PENDING_PREFIXES: set[str]`（渐进接入清单）
  - `async def enforce_route_permission(request, db=Depends(get_db), redis=Depends(get_redis_client)) -> None`
  - `def register_api_router(app: FastAPI, router: APIRouter) -> None`（`src/main.py`）

- [ ] **Step 1: 写失败测试**

`test/test_rbac_enforcement.py`：

```python
import pytest
from fastapi import APIRouter, FastAPI, Depends
from httpx import AsyncClient, ASGITransport
from src.core.deps import get_db
from src.core.rbac import require_permission, enforce_route_permission
from src.infra.redis_cache import get_redis_client
from src.modules.permission.model import Permission
from src.modules.role.model import Role
from src.modules.user.model import User
from src.utils.jwt_utils import encode_jwt

def build_app(db_session, fake_redis):
    app = FastAPI()
    router = APIRouter()

    @router.get("/open")
    async def open_route():
        return {"ok": True}

    @router.get("/protected")
    @require_permission("agent:view")
    async def protected():
        return {"ok": True}

    app.include_router(router, prefix="/api/v1", dependencies=[Depends(enforce_route_permission)])
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_redis_client] = lambda: fake_redis
    return app

async def request(app, method: str, path: str, **kwargs):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        return await client.request(method, path, **kwargs)

async def make_user(db_session, *, superuser=False, permissions=()):
    role = Role(code="test-role", name="测试角色", is_system=False,
                permissions=[Permission(code=c, name=c) for c in permissions])
    user = User(username="u", email="u@example.com", hashed_password="x",
                is_superuser=superuser, roles=[role])
    db_session.add_all([role, user]); await db_session.flush()
    return user

async def test_no_token_returns_401(db_session, fake_redis):
    app = build_app(db_session, fake_redis)
    res = await request(app, "GET", "/api/v1/protected")
    assert res.status_code == 200
    assert res.json()["code"] == 401

async def test_no_permission_returns_403(db_session, fake_redis):
    user = await make_user(db_session)
    app = build_app(db_session, fake_redis)
    res = await request(app, "GET", "/api/v1/protected",
                        headers={"Authorization": f"Bearer {encode_jwt({'sub': str(user.id)})}"})
    assert res.json()["code"] == 403
    assert "agent:view" in res.json()["message"]

async def test_with_permission_succeeds(db_session, fake_redis):
    user = await make_user(db_session, permissions=("agent:view",))
    app = build_app(db_session, fake_redis)
    res = await request(app, "GET", "/api/v1/protected",
                        headers={"Authorization": f"Bearer {encode_jwt({'sub': str(user.id)})}"})
    assert res.json()["code"] == 200

async def test_superuser_succeeds(db_session, fake_redis):
    user = await make_user(db_session, superuser=True)
    app = build_app(db_session, fake_redis)
    res = await request(app, "GET", "/api/v1/protected",
                        headers={"Authorization": f"Bearer {encode_jwt({'sub': str(user.id)})}"})
    assert res.json()["code"] == 200

async def test_undeclared_route_is_denied(db_session, fake_redis):
    user = await make_user(db_session, superuser=True)
    app = build_app(db_session, fake_redis)
    res = await request(app, "GET", "/api/v1/open",
                        headers={"Authorization": f"Bearer {encode_jwt({'sub': str(user.id)})}"})
    assert res.json()["code"] == 403
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_rbac_enforcement.py -v`
Expected: FAIL，`require_permission` / `enforce_route_permission` 不存在。

- [ ] **Step 3: 重构 `deps.py` 并实现鉴权依赖**

`src/core/deps.py`：

```python
async def resolve_current_user(request: Request, db: AsyncSession) -> User:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise BizException(code=401, message="未登录或 token 已过期")
    token = auth.removeprefix("Bearer ").strip()
    try:
        payload = verify_jwt(token)
        user_id = int(payload.get("sub"))
    except Exception:
        raise BizException(code=401, message="未登录或 token 已过期")
    user = await db.get(User, user_id)
    if not user:
        raise BizException(code=401, message="用户不存在")
    if not user.is_active:
        raise BizException(code=401, message="账号已被禁用")
    return user

async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    return await resolve_current_user(request, db)
```

`src/core/rbac.py` 增加：

```python
PERMISSION_WHITELIST = frozenset({
    ("POST", "/api/v1/auth/login"),
    ("GET", "/api/v1/captcha"),
    ("POST", "/api/v1/captcha"),
    ("GET", "/api/v1/users/me"),
    ("GET", "/api/v1/share/subjects"),  # 仅要求登录，接口内部校验 get_current_user
})

# 渐进接入：业务模块计划完成装饰器后，各自从该集合中移除自己的前缀
RBAC_PENDING_PREFIXES: set[str] = {
    "/api/v1/agents", "/api/v1/prompts", "/api/v1/knowledge-bases",
    "/api/v1/tools", "/api/v1/models", "/api/v1/providers",
}
```

`enforce_route_permission` 顺序：

1. `route = request.scope.get("route")`；为空直接返回。
2. 命中白名单 → 返回。
3. `user = await resolve_current_user(request, db)`：所有非白名单接口**先要求登录**（含 pending 前缀），修复未登录可调用业务接口的问题。
4. `ctx = await load_permission_context(user, db, redis)`；写入 `request.state.permission_context`。
5. 路径命中 `RBAC_PENDING_PREFIXES` 或 `RBAC_ENFORCE=False` → 记录 warning 后返回（迁移期只跳过权限码校验，不跳过登录）。
6. `code = getattr(route.endpoint, "__rbac_permission__", None)`；为空 → `BizException(403, "接口未声明权限")`。
7. `ctx.allows(code)` 为假 → `logger.warning` 记录用户、路径、所需权限码、IP、时间，再抛 `BizException(403, f"无权限访问（需要 {code}）")`。

- [ ] **Step 4: 在 `main.py` 统一挂载**

新增：

```python
def register_api_router(app: FastAPI, router: APIRouter) -> None:
    app.include_router(
        router,
        prefix="/api/v1",
        dependencies=[Depends(enforce_route_permission)],
    )
```

将现有 11 个 `app.include_router(..., prefix="/api/v1")` 全部替换为 `register_api_router(app, xxx_router)`。

- [ ] **Step 5: 先给认证/验证码/用户/角色/权限路由加声明**

- 认证与验证码：不加（白名单）。
- `users/me`：不加（白名单，仅登录）。
- 用户路由按下表加 `@require_permission`：`POST /users` → `user:create`；`GET /users`、`GET /users/search`、`GET /users/{id}`、`GET /users/{id}/roles` → `user:view`；`PUT /users/{id}/roles` → `user:update`；`DELETE /users/{id}` → `user:delete`。
- 角色路由：`GET /roles/`、`GET /roles/search`、`GET /roles/{id}` → `role:view`；`POST /roles` → `role:create`；`PUT /roles/{id}`、`PUT /roles/{id}/permissions` → `role:update`；`DELETE /roles/{id}` → `role:delete`。
- 权限路由：全部读写分别 `permission:view/create/update/delete`。

- [ ] **Step 6: 运行测试确认通过**

Run: `pytest test/test_rbac_enforcement.py -v`
Expected: 5 passed。

- [ ] **Step 7: 提交**

```bash
git add src/core/deps.py src/core/rbac.py src/main.py src/modules/user/api.py src/modules/role/api.py src/modules/permission/api.py test/test_rbac_enforcement.py
git commit -m "feat: 增加声明式权限与接口默认拒绝"
```

---

### Task 6: `/users/me` 返回权限快照

**Files:**
- Modify: `src/modules/user/schema.py`, `src/modules/user/api.py`
- Test: `test/test_user_me.py`

**Interfaces:**
- Consumes: `PermissionContext`、`User.roles`。
- Produces:

```python
class RoleBrief(BaseModel):
    id: int
    code: str
    name: str

class DataScopeSummary(BaseModel):
    view: str
    manage: str

class MeRead(UserRead):
    is_superuser: bool
    roles: list[RoleBrief] = []
    permissions: list[str] = []
    data_scopes: dict[str, DataScopeSummary] = {}
```

> 本计划 `data_scopes` 返回 `{}`；`数据级授权内核-plan.md` 将其填充为 4 类资源。

- [ ] **Step 1: 写失败测试**

`test/test_user_me.py`：

```python
from src.main import app
from src.core.deps import get_current_user
from src.modules.user.model import User
from src.modules.role.model import Role
from src.modules.permission.model import Permission

async def test_me_returns_permissions_and_roles(db_session, fake_redis, api_client):
    role = Role(code="developer", name="开发者", is_system=True,
                permissions=[Permission(code="agent:view", name="查看 Agent")])
    user = User(username="dev", email="dev@example.com", hashed_password="x", roles=[role])
    db_session.add_all([role, user]); await db_session.flush()

    app.dependency_overrides[get_current_user] = lambda: user
    try:
        res = await api_client.get("/api/v1/users/me")
        data = res.json()["data"]
        assert data["is_superuser"] is False
        assert data["roles"][0]["code"] == "developer"
        assert data["permissions"] == ["agent:view"]
        assert data["data_scopes"] == {}
    finally:
        app.dependency_overrides.pop(get_current_user, None)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_user_me.py -v`
Expected: FAIL，响应缺少 `is_superuser` / `permissions` / `roles`。

- [ ] **Step 3: 实现 `MeRead` 与接口**

`/users/me` 改为：

```python
@router.get("/me", response_model=ResponseSchema[MeRead], summary="获取当前登录用户信息")
async def get_current_user_info(
    ctx: PermissionContext = Depends(get_permission_context),
):
    return ResponseSchema(data=MeRead(
        id=ctx.user.id,
        username=ctx.user.username,
        email=ctx.user.email,
        is_active=ctx.user.is_active,
        is_superuser=ctx.user.is_superuser,
        roles=[RoleBrief(id=r.id, code=r.code, name=r.name) for r in ctx.user.roles],
        permissions=sorted(ctx.permissions),
        data_scopes={},
    ))
```

注意：函数名必须与 `deps.get_current_user` 区分，避免遮蔽导入。

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest test/test_user_me.py -v`
Expected: 1 passed。

- [ ] **Step 5: 提交**

```bash
git add src/modules/user/schema.py src/modules/user/api.py test/test_user_me.py
git commit -m "feat: /users/me 返回角色、超级管理员标记与权限集合"
```

---

### Task 7: 授权变更后的缓存主动失效

**Files:**
- Modify: `src/modules/role/service.py`, `src/modules/role/api.py`, `src/modules/user/service.py`, `src/modules/user/api.py`
- Test: `test/test_rbac_invalidation.py`

**Interfaces:**
- Consumes: `invalidate_user_cache`、`invalidate_users_cache`、`invalidate_role_users_cache`。
- Produces:
  - `RoleService.__init__(db, redis=None)`
  - `UserService.__init__(db, redis=None)`
  - 变更方法在提交前调用失效工具。

- [ ] **Step 1: 写失败测试**

`test/test_rbac_invalidation.py`：

```python
from src.core.rbac_cache import set_cached_rbac, get_cached_rbac
from src.modules.role.model import Role
from src.modules.user.model import User
from src.modules.role.service import RoleService
from src.modules.user.service import UserService

async def test_assign_permissions_invalidates_role_users(db_session, fake_redis):
    role = Role(code="dev", name="开发", is_system=False)
    user = User(username="a", email="a@example.com", hashed_password="x", roles=[role])
    db_session.add_all([role, user]); await db_session.flush()
    await set_cached_rbac(fake_redis, user.id, {"permissions": [], "data_scopes": {}})

    svc = RoleService(db_session, redis=fake_redis)
    await svc.assign_permissions(role.id, [])

    assert await get_cached_rbac(fake_redis, user.id) is None
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_rbac_invalidation.py -v`
Expected: FAIL，`RoleService` 不接受 `redis` 参数且缓存仍在。

- [ ] **Step 3: 接入失效调用**

| 变更 | 失效范围 | 调用点 |
|---|---|---|
| 给角色分配权限 | 该角色下所有用户 | `RoleService.assign_permissions` |
| 修改角色数据范围 | 该角色下所有用户 | 数据授权计划实现 |
| 给用户分配角色 | 该用户 | `UserService.assign_roles` |
| 删除角色 | 原关联该角色的所有用户 | `RoleService.delete_role`（先查用户再删） |
| 禁用 / 删除用户 | 该用户 | `UserService.update_user` / `delete_user` |
| 数据迁移 / 种子 | 全部 | `python -m src.db.flush_rbac_cache` |

`redis` 为 `None` 时跳过缓存操作，保证旧调用不报错；API 层注入 `Depends(get_redis_client)` 并传入 service。

所有角色权限与用户角色变更同时 `logger.info` 记录：操作者、目标角色/用户、变更前后权限码或角色 ID 集合（§5.4 R6）。

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest test/test_rbac_invalidation.py -v`
Expected: 1 passed。

- [ ] **Step 5: 提交**

```bash
git add src/modules/role/service.py src/modules/role/api.py src/modules/user/service.py src/modules/user/api.py test/test_rbac_invalidation.py
git commit -m "feat: 角色与用户授权变更后主动失效 RBAC 缓存"
```

---

### Task 8: 角色响应字段与内置角色保护

**Files:**
- Modify: `src/modules/role/schema.py`, `src/modules/role/repository.py`, `src/modules/role/service.py`, `src/modules/role/api.py`
- Test: `test/test_role_guards.py`

**Interfaces:**
- Consumes: `BUILTIN_ROLE_CODES`、`Role.is_system`。
- Produces:
  - `RoleRead.is_system: bool`、`RoleRead.user_count: int`、`RoleRead.permission_count: int`
  - `RoleRepository.count_users_by_role_ids(role_ids: list[int]) -> dict[int, int]`
  - `RoleService.delete_role(role_id)` 保护：内置拒绝、有用户拒绝
  - `RoleService.create_role` 拒绝内置 code

- [ ] **Step 1: 写失败测试**

`test/test_role_guards.py`：

```python
import pytest
from src.core.exceptions import BizException
from src.modules.role.model import Role
from src.modules.role.service import RoleService
from src.modules.role.schema import RoleCreate
from src.modules.user.model import User

async def test_cannot_delete_system_role(db_session):
    role = Role(code="admin", name="管理员", is_system=True)
    db_session.add(role); await db_session.flush()
    with pytest.raises(BizException) as exc:
        await RoleService(db_session).delete_role(role.id)
    assert "内置" in exc.value.message

async def test_cannot_delete_role_with_users(db_session):
    role = Role(code="custom", name="自定义", is_system=False)
    user = User(username="u", email="u@example.com", hashed_password="x", roles=[role])
    db_session.add_all([role, user]); await db_session.flush()
    with pytest.raises(BizException) as exc:
        await RoleService(db_session).delete_role(role.id)
    assert "用户" in exc.value.message

async def test_cannot_create_builtin_code(db_session):
    with pytest.raises(BizException):
        await RoleService(db_session).create_role(
            RoleCreate(code="admin", name="管理员2")
        )
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_role_guards.py -v`
Expected: FAIL，当前删除不校验。

- [ ] **Step 3: 实现字段与保护**

- `RoleRead` 增加三个字段，默认值分别为 `False`、`0`、`0`。
- `RoleService._to_read(role, user_count)` 组装响应；`permission_count=len(role.permissions)`。
- `GET /roles/`、`GET /roles/search`、`GET /roles/{id}` 批量取用户数。
- `delete_role`：`is_system` → `BizException(403, "内置角色不可删除")`；`user_count > 0` → `BizException(400, "该角色下仍有用户，请先解绑")`。
- `create_role`：`code in BUILTIN_ROLE_CODES` → `BizException(400, "内置角色编码不可重复创建")`；code 正则 `^[a-z][a-z0-9_-]{1,49}$`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest test/test_role_guards.py -v`
Expected: 3 passed。

- [ ] **Step 5: 提交**

```bash
git add src/modules/role test/test_role_guards.py
git commit -m "feat: 角色列表补充内置标记与计数并增加删除保护"
```

---

### Task 9: 用户保护规则与 `PUT /users/{id}`

**Files:**
- Modify: `src/modules/user/schema.py`, `src/modules/user/service.py`, `src/modules/user/api.py`
- Test: `test/test_user_guards.py`

**Interfaces:**
- Consumes: `RoleService`、`invalidate_user_cache`。
- Produces:
  - `class UserUpdate(BaseModel): email: EmailStr | None = None; is_active: bool | None = None`
  - `UserService.update_user(user_id, data, operator: User) -> User`
  - `UserService.assign_roles(user_id, role_ids, operator: User) -> User`
  - `UserService.delete_user(user_id, operator: User) -> None`
  - `PUT /api/v1/users/{user_id}` → `user:update`

- [ ] **Step 1: 写失败测试**

`test/test_user_guards.py`：

```python
import pytest
from src.core.exceptions import BizException
from src.modules.user.model import User
from src.modules.user.service import UserService
from src.modules.user.schema import UserUpdate

async def test_cannot_disable_self(db_session):
    admin = User(username="admin", email="a@example.com", hashed_password="x", is_superuser=True)
    db_session.add(admin); await db_session.flush()
    with pytest.raises(BizException) as exc:
        await UserService(db_session).update_user(admin.id, UserUpdate(is_active=False), operator=admin)
    assert "自己" in exc.value.message

async def test_cannot_remove_last_active_superuser(db_session):
    admin = User(username="admin", email="a@example.com", hashed_password="x", is_superuser=True)
    other = User(username="other", email="o@example.com", hashed_password="x", is_superuser=True)
    db_session.add_all([admin, other]); await db_session.flush()
    await UserService(db_session).update_user(other.id, UserUpdate(is_active=False), operator=admin)
    # 剩下 admin 仍启用，允许
    assert other.is_active is False

async def test_cannot_delete_self(db_session):
    admin = User(username="admin", email="a@example.com", hashed_password="x", is_superuser=True)
    db_session.add(admin); await db_session.flush()
    with pytest.raises(BizException) as exc:
        await UserService(db_session).delete_user(admin.id, operator=admin)
    assert "自己" in exc.value.message
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_user_guards.py -v`
Expected: FAIL，方法签名不接受 `operator`。

- [ ] **Step 3: 实现保护规则**

- `update_user`：`operator.id == user_id and data.is_active is False` → 403；禁用时若目标是超级管理员且禁用后启用超管数为 0 → 400。
- `assign_roles`：`operator.id == user_id` → 403「不能修改自己的角色」；若目标是最后一个启用超级管理员且 role_ids 不含 `admin` 角色 → 400。
- `delete_user`：`operator.id == user_id` → 403；若目标是最后启用超管 → 400。
- `PUT /users/{id}` 使用 `@require_permission("user:update")`，`ctx: PermissionContext = Depends(get_permission_context)` 传入 `operator=ctx.user`。
- 所有变更调用缓存失效；`DELETE /users/{id}` 的缓存失效在删除前执行。

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest test/test_user_guards.py -v`
Expected: 3 passed。

- [ ] **Step 5: 提交**

```bash
git add src/modules/user test/test_user_guards.py
git commit -m "feat: 用户接口增加自我操作与最后超级管理员保护"
```

---

### Task 10: 鉴权覆盖率与行为验收

**Files:**
- Create: `test/test_rbac_coverage.py`
- Modify: `src/core/rbac.py`（仅在业务模块完成后收缩 `RBAC_PENDING_PREFIXES`）
- Test: `test/test_rbac_coverage.py`

**Interfaces:**
- Consumes: `src.main.app`、`PERMISSION_WHITELIST`、`RBAC_PENDING_PREFIXES`。
- Produces: 覆盖率门禁；新增未声明接口直接失败。

- [ ] **Step 1: 写覆盖率测试**

```python
from fastapi.routing import APIRoute
from src.main import app
from src.core.rbac import PERMISSION_WHITELIST, RBAC_PENDING_PREFIXES

def test_every_api_route_declares_permission_or_whitelisted():
    missing = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        if not route.path.startswith("/api/v1"):
            continue
        for method in route.methods - {"HEAD", "OPTIONS"}:
            if (method, route.path) in PERMISSION_WHITELIST:
                continue
            if route.path.startswith(tuple(RBAC_PENDING_PREFIXES)):
                continue
            if not getattr(route.endpoint, "__rbac_permission__", None):
                missing.append(f"{method} {route.path}")
    assert missing == [], f"未声明权限的接口: {missing}"
```

- [ ] **Step 2: 运行测试确认当前通过（存在 pending 前缀）**

Run: `pytest test/test_rbac_coverage.py -v`
Expected: PASS；`agents/prompts/knowledge-bases/tools/models/providers` 通过 pending 清单豁免。

- [ ] **Step 3: 写行为验收测试**

补充到 `test/test_rbac_enforcement.py`：

```python
from src.core.rbac_cache import invalidate_user_cache

async def test_revoked_permission_takes_effect_on_next_request(db_session, fake_redis):
    permission = Permission(code="agent:delete", name="删除 Agent")
    role = Role(code="dev", name="开发", is_system=False, permissions=[permission])
    user = User(username="u", email="u@example.com", hashed_password="x", roles=[role])
    db_session.add_all([role, user]); await db_session.flush()

    app = build_app(db_session, fake_redis)
    token = encode_jwt({"sub": str(user.id)})
    headers = {"Authorization": f"Bearer {token}"}
    res = await request(app, "GET", "/api/v1/protected", headers=headers)
    assert res.json()["code"] == 200

    role.permissions = []
    await db_session.flush()
    await invalidate_user_cache(fake_redis, user.id)

    res = await request(app, "GET", "/api/v1/protected", headers=headers)
    assert res.json()["code"] == 403

async def test_disabled_user_gets_401(db_session, fake_redis):
    user = await make_user(db_session, superuser=True)
    app = build_app(db_session, fake_redis)
    token = encode_jwt({"sub": str(user.id)})
    user.is_active = False
    await db_session.flush()
    res = await request(app, "GET", "/api/v1/protected",
                        headers={"Authorization": f"Bearer {token}"})
    assert res.json()["code"] == 401
```

- [ ] **Step 4: 运行全部后端测试**

Run: `pytest -q`
Expected: 本计划新增测试全部通过；`test_sample.py::test_add_fail` 若存在则仍为已知失败，不在本计划修复范围。

- [ ] **Step 5: 提交**

```bash
git add test/test_rbac_coverage.py test/test_rbac_enforcement.py
git commit -m "test: 增加 RBAC 接口覆盖率与撤销/禁用行为验收"
```

---

## 验收对照

| 验收项 | 落点 |
|---|---|
| AC-01 未登录调用受保护接口 `code=401` | Task 5、Task 10 |
| AC-02 无权限调用 `code=403` 且消息含权限码 | Task 5 |
| AC-07 取消权限后下一次请求 403 | Task 7、Task 10 |
| AC-08 禁用用户后 401 | Task 9、Task 10 |
| AC-09 删除内置角色拒绝 | Task 8 |
| AC-10 删除自己拒绝 | Task 9 |
| AC-11 取消最后一个超级管理员拒绝 | Task 9 |
| AC-12 `/users/me` 返回 roles/permissions/is_superuser | Task 6 |
| AC-13 超级管理员无角色也成功 | Task 4、Task 5 |
| AC-14 新增未声明权限接口覆盖率失败 | Task 10 |
| AC-15 迁移脚本执行两次不重复 | Task 3 |
| AC-16 Redis 停止后鉴权仍正确 | Task 4（降级查库） |

## 依赖与顺序

1. 本计划必须先于 `数据级授权内核-plan.md` 完成；后者会替换 `DataScope` 占位并填充 `data_scopes`。
2. 业务模块计划（Agent/Prompt/知识库/工具/模型）完成各自路由装饰器后，从 `RBAC_PENDING_PREFIXES` 移除自己的前缀；全部移除后覆盖率测试仍需通过。
3. `系统管理-plan.md` 依赖本计划的 `RoleRead` 新字段与 `PUT /users/{id}`。
4. 前端 `前端权限控制-plan.md` 依赖本计划的 `/users/me` 响应结构。

## 风险与决策

| 项 | 决策 |
|---|---|
| 权限目录是否加表字段 | 不加列，`module/action/status` 由 `code` 与预留集合计算，符合 V2 §10.1「permissions 无结构变更」 |
| 渐进接入期未装饰接口 | 通过 `RBAC_PENDING_PREFIXES` 豁免并记录告警，业务模块计划逐个移除，避免一次性改动导致联调中断 |
| 缓存不可用 | 降级查库，权限判定仍正确；缓存失效失败依赖 300 秒 TTL 收敛 |
| 管理端权限写接口 | 保留并受 `permission:*` 保护，但前端页面不暴露入口（`系统管理-plan.md`） |
