# Agent 管理 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Agent 模块接入功能权限与数据级授权，并在列表/详情页展示归属、共享状态与按行权限渲染的操作按钮。

**Architecture:** 后端在现有 `Agent` CRUD 上增加 `PermissionContext` 参数：创建写入 `owner_id`/`created_by`，列表用 `visible_condition` 过滤并逐行返回 `can_manage`/`is_shared`，详情与写操作统一走 `assert_can_view_resource` / `assert_can_manage_resource`；ACL 与归属转移通过通用路由工厂挂载。前端在列表增加归属列与行内按钮门禁，在详情页接入共享抽屉与转移弹窗。

**Tech Stack:** FastAPI / SQLAlchemy 2.0 async / pytest；React 19 / TypeScript 5.9 / Vite 7 / shadcn-ui。

**Spec:** `docs/spec/PROJECT_SPEC_V2.md`（§4.2 资源分类、§6 数据授权、FR-14~17、§9.3 Agent 接口映射、§9.4 路由映射）、`docs/design/ui/RBAC原型设计说明书.md`（§5.4、§5.5、§7.4、§7.5）。

**前置计划:** `RBAC权限内核-plan.md`、`数据级授权内核-plan.md`、`前端权限控制-plan.md`。

---

## 模块说明（产品视角）

### 目标

| 编号 | 目标 | 本计划落点 |
|---|---|---|
| G9 | 创建 Agent 自动写入所有者 | `create_agent` 写入 `owner_id`/`created_by` |
| G10/G11 | 列表按范围过滤，详情/写操作按范围拒绝 | `visible_condition` + `assert_can_*` |
| G12 | 所有者可共享单个 Agent | `make_acl_router` |
| G13 | 共享、取消共享、转移立即生效 | ACL 实时查询、转移即时写库 |
| FR-09 | 行内编辑/删除按钮按 `can_manage` 渲染 | 列表返回 `can_manage` |
| FR-14 | 详情返回 `owner_id`/`owner_name`/`can_manage`/`is_shared` | `AgentRead` 扩展 |

### 交付物

1. `AgentRead` 增加归属与权限标记字段。
2. Agent CRUD、启停、发布、回滚、版本列表接入功能权限与数据权限。
3. `GET/POST/DELETE /agents/{id}/acl` 与 `POST /agents/{id}/transfer`。
4. 前端 Agent 服务类型更新。
5. Agent 列表归属列、空状态、按钮门禁。
6. Agent 详情共享抽屉、转移弹窗、编辑/发布门禁。
7. 后端测试与前端手测清单。

### 不在本期范围

- Agent 运行时调用鉴权（NG8）。
- 对话日志/数据统计随 Agent 可见性联动 → 各自的预留计划。
- 模型选择器的权限（模型为平台级资源，仅功能权限）。

---

## Global Constraints

- 权限码：`agent:view/create/update/delete/publish`。
- 特殊操作归属：启动/停止 → `agent:update`；发布/回滚 → `agent:publish`；共享/转移 → `agent:update` + 对该 Agent 的 `manage` 数据权限。
- 版本列表继承父 Agent 的查看权；发布/回滚继承父 Agent 的管理权。
- 创建只校验功能权限，写入 `owner_id = ctx.user.id`、`created_by = ctx.user.username`。
- 列表 `total` 必须是过滤后的数量；每行返回 `owner_id`、`owner_name`、`can_manage`、`is_shared`。
- 详情/写操作无权限统一 `BizException(403, "资源不存在或无权限访问")`。
- 不提供任何“查看全部”请求参数；前端不得在客户端二次过滤冒充权限。
- 响应保持 HTTP 200 + body `code`。
- 前端 `strict` + `noUnusedLocals` + `noUnusedParameters`；lint/build 必须通过；暂无前端测试运行器，使用手测清单。
- 每个任务提交一次，提交信息使用中文摘要。

---

## Review Focus

1. **列表分页总数**：数据范围收紧后 `total` 必须与可见行一致，不能出现“3 行数据、总数 100”。
2. **他人 Agent 直连**：知道 ID 请求详情、编辑、删除、启停、发布，全部返回 403，消息不泄露资源是否存在。
3. **编辑页越权提交**：开发者能查看他人的 Agent，但打开编辑页后保存必须被后端拒绝；前端应在 `can_manage=false` 时禁用保存。
4. **共享即时性**：共享为只读后对方立即可见但不可编辑；改为可管理后立即能编辑；取消后下一次请求即 403。
5. **版本接口继承**：不能通过 `/agents/{id}/versions` 或回滚接口绕过父 Agent 的查看/管理判定。

---

## File Structure

**修改**

| 文件 | 变更 |
|---|---|
| `src/modules/agent/schema.py` | `AgentRead` 增加归属/权限标记 |
| `src/modules/agent/repository.py` | `search_page` 接受可选 `where` 条件 |
| `src/modules/agent/service.py` | 注入 `PermissionContext`，数据过滤与断言 |
| `src/modules/agent/api.py` | 权限声明、`ctx` 注入、ACL/转移路由 |
| `src/core/rbac.py` | 从 `RBAC_PENDING_PREFIXES` 移除 `/api/v1/agents` |
| `app/src/services/api/agent.ts` | `AgentRead` 新字段 |
| `app/src/pages/agent/List.tsx` | 归属列、空状态、按钮门禁 |
| `app/src/pages/agent/Detail.tsx` | 归属/共享信息、共享抽屉、转移弹窗 |
| `app/src/pages/agent/Create.tsx` | 编辑模式 `can_manage` 校验 |
| `app/src/pages/agent/Versions.tsx` | 回滚按钮按 `can_manage` + `agent:publish` |
| `app/src/pages/agent/Test.tsx`、`Monitor.tsx` | 仅查看；不新增写入口 |

**新增测试**

| 文件 | 职责 |
|---|---|
| `test/test_agent_data_auth.py` | 创建归属、列表过滤、详情/写操作 403 |
| `test/test_agent_acl_api.py` | ACL 与转移接口 |
| `test/test_agent_permissions.py` | 功能权限 401/403 与 `can_manage` 标记 |

---

### Task 1: `AgentRead` 归属与权限标记

**Files:**
- Modify: `src/modules/agent/schema.py`, `src/modules/agent/service.py`
- Test: `test/test_agent_data_auth.py`

**Interfaces:**
- Consumes: `Agent.owner`、`Agent.owner_id`。
- Produces:

```python
class AgentRead(BaseModel):
    # 原有字段不变
    owner_id: int
    owner_name: str | None
    can_manage: bool = False
    is_shared: bool = False
```

- [ ] **Step 1: 写失败测试**

`test/test_agent_data_auth.py`：

```python
from src.modules.agent.model import Agent
from src.modules.agent.service import AgentService
from src.modules.user.model import User

async def test_agent_read_contains_owner_fields(db_session):
    owner = User(username="owner", email="o@example.com", hashed_password="x")
    db_session.add(owner); await db_session.flush()
    agent = Agent(name="a", type="conversation", owner_id=owner.id)
    db_session.add(agent); await db_session.flush()
    read = AgentService(db_session)._to_read(agent)
    assert read.owner_id == owner.id
    assert read.owner_name == "owner"
    assert read.can_manage is False
    assert read.is_shared is False
```

> `owner_name` 由 `AgentService._to_read` 从 `agent.owner.username` 填充；不要直接用 `AgentRead.model_validate(agent)` 断言该字段。

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_agent_data_auth.py -v`
Expected: FAIL，`owner_id` 等字段不存在。

- [ ] **Step 3: 扩展 Schema 与转换**

`AgentRead` 增加四个字段。`AgentService._to_read` 改为：

```python
def _to_read(self, agent: Agent, *, can_manage: bool = False, is_shared: bool = False) -> AgentRead:
    return AgentRead(
        ...,  # 原有字段
        owner_id=agent.owner_id,
        owner_name=agent.owner.username if agent.owner else None,
        can_manage=can_manage,
        is_shared=is_shared,
    )
```

`owner_name` 使用 `username`（当前 `User` 模型无姓名字段），与 PRD 的显示口径一致。

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest test/test_agent_data_auth.py -v`
Expected: 1 passed。

- [ ] **Step 5: 提交**

```bash
git add src/modules/agent/schema.py src/modules/agent/service.py test/test_agent_data_auth.py
git commit -m "feat: Agent 响应增加归属人与权限标记"
```

---

### Task 2: Agent 服务接入功能权限与数据权限

**Files:**
- Modify: `src/modules/agent/repository.py`, `src/modules/agent/service.py`
- Test: `test/test_agent_data_auth.py`（追加）

**Interfaces:**
- Consumes:
  - `PermissionContext`、`assert_can_view_resource`、`assert_can_manage_resource`
  - `visible_condition`、`can_manage`
  - `acl_levels_map`、`is_shared_map`、`can_manage`、`delete_acl_for_resource`
  - `BaseRepository.get_page_where`
- Produces:

```python
class AgentService:
    async def create_agent(self, data: AgentCreate, ctx: PermissionContext) -> AgentRead
    async def list_agents(self, params: PageParams, ctx: PermissionContext) -> PageResult[AgentRead]
    async def get_agent(self, agent_id: int, ctx: PermissionContext) -> AgentRead
    async def update_agent(self, agent_id: int, data: AgentUpdate, ctx: PermissionContext) -> AgentRead
    async def delete_agent(self, agent_id: int, ctx: PermissionContext) -> None
    async def start_agent(self, agent_id: int, ctx: PermissionContext) -> AgentRead
    async def stop_agent(self, agent_id: int, ctx: PermissionContext) -> AgentRead
    async def publish(self, agent_id: int, data: PublishRequest, ctx: PermissionContext) -> AgentRead
    async def rollback(self, agent_id: int, data: RollbackRequest, ctx: PermissionContext) -> AgentRead
    async def get_versions(self, agent_id: int, ctx: PermissionContext) -> list[AgentVersionRead]
```

- [ ] **Step 1: 追加失败测试**

```python
from src.core.rbac import PermissionContext
from src.core.data_scope import DataScope, ScopeLevel
from src.core.exceptions import BizException
import pytest

def ctx_for(user, view="SELF", manage="SELF"):
    return PermissionContext(
        user=user, permissions=frozenset(), role_ids=frozenset(),
        data_scopes={"agent": DataScope(view=ScopeLevel(view), manage=ScopeLevel(manage))},
    )

async def test_create_writes_owner_and_created_by(db_session):
    user = User(username="dev", email="dev@example.com", hashed_password="x")
    db_session.add(user); await db_session.flush()
    svc = AgentService(db_session)
    read = await svc.create_agent(AgentCreate(name="a", type="conversation"), ctx_for(user))
    assert read.owner_id == user.id
    assert read.created_by == "dev"
    assert read.can_manage is True

async def test_list_filters_by_self_scope(db_session):
    from src.modules.agent.schema import AgentCreate
    a = User(username="a", email="a@example.com", hashed_password="x")
    b = User(username="b", email="b@example.com", hashed_password="x")
    db_session.add_all([a, b]); await db_session.flush()
    db_session.add_all([
        Agent(name="a-agent", type="conversation", owner_id=a.id),
        Agent(name="b-agent", type="conversation", owner_id=b.id),
    ])
    await db_session.flush()
    from src.core.deps import PageParams
    page = await AgentService(db_session).list_agents(PageParams(), ctx_for(a))
    assert page.total == 1
    assert page.items[0].name == "a-agent"

async def test_get_other_agent_raises_403(db_session):
    a = User(username="a", email="a@example.com", hashed_password="x")
    b = User(username="b", email="b@example.com", hashed_password="x")
    db_session.add_all([a, b]); await db_session.flush()
    agent = Agent(name="b-agent", type="conversation", owner_id=b.id)
    db_session.add(agent); await db_session.flush()
    with pytest.raises(BizException) as exc:
        await AgentService(db_session).get_agent(agent.id, ctx_for(a))
    assert exc.value.code == 403

async def test_update_other_agent_raises_403_even_with_view_all(db_session):
    a = User(username="a", email="a@example.com", hashed_password="x")
    b = User(username="b", email="b@example.com", hashed_password="x")
    db_session.add_all([a, b]); await db_session.flush()
    agent = Agent(name="b-agent", type="conversation", owner_id=b.id)
    db_session.add(agent); await db_session.flush()
    with pytest.raises(BizException):
        await AgentService(db_session).update_agent(agent.id, AgentUpdate(name="x"), ctx_for(a, view="ALL", manage="SELF"))
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_agent_data_auth.py -v`
Expected: FAIL，服务签名不接受 `ctx`。

- [ ] **Step 3: repository 支持过滤条件**

`AgentRepository.search_page` 增加 `where` 参数并调用 `get_page_where`：

```python
async def search_page(self, offset, limit, keyword, where=None):
    return await self.get_page_where(
        offset=offset, limit=limit, keyword=keyword,
        search_fields=self.SEARCH_FIELDS, where=where,
    )
```

- [ ] **Step 4: 改造服务方法**

统一模式：

```python
async def _load_visible(self, agent_id: int, ctx: PermissionContext) -> Agent:
    agent = await self.repo.get_by_id(agent_id)
    await assert_can_view_resource(self.db, "agent", agent, ctx)
    return agent

async def _load_manageable(self, agent_id: int, ctx: PermissionContext) -> Agent:
    agent = await self.repo.get_by_id(agent_id)
    await assert_can_manage_resource(self.db, "agent", agent, ctx)
    return agent
```

- `create_agent`：写入 `owner_id=ctx.user.id`、`created_by=ctx.user.username`；返回 `can_manage=True`。
- `list_agents`：`where=visible_condition(Agent, "agent", ctx)`；取当前页 ID 后分别调用 `acl_levels_map(...)` 与 `is_shared_map(...)`；逐行 `can_manage(...)`、`is_shared` 取自 `is_shared_map`。
- `get_agent`：`_load_visible`；计算 `can_manage` 与 `is_shared`。
- `update/delete/start/stop`：`_load_manageable`；`delete_agent` 在删除资源后调用 `delete_acl_for_resource(self.db, "agent", agent_id)` 清理共享条目。
- `publish/rollback`：`_load_manageable`，并在路由层声明 `agent:publish`。
- `get_versions`：先 `_load_visible`，再查版本。
- 错误消息统一为 `资源不存在或无权限访问`（由 `assert_*` 抛出）。

- [ ] **Step 5: 运行测试确认通过**

Run: `pytest test/test_agent_data_auth.py -v`
Expected: 5 passed。

- [ ] **Step 6: 提交**

```bash
git add src/modules/agent test/test_agent_data_auth.py
git commit -m "feat: Agent 服务接入数据范围过滤与管理权判定"
```

---

### Task 3: Agent 接口权限声明与 ACL/转移路由

**Files:**
- Modify: `src/modules/agent/api.py`, `src/core/rbac.py`
- Test: `test/test_agent_acl_api.py`, `test/test_agent_permissions.py`

**Interfaces:**
- Consumes: `require_permission`、`get_permission_context`、`make_acl_router`。
- Produces: 全部 Agent 路由声明权限；ACL/转移路由挂载。

- [ ] **Step 1: 写失败测试**

> HTTP 测试使用 `httpx.AsyncClient` + `ASGITransport`（夹具见 `RBAC权限内核-plan.md` Task 1），不要使用同步 `TestClient`。

`test/test_agent_permissions.py`：

```python
from src.utils.jwt_utils import encode_jwt
from src.modules.user.model import User

async def test_agent_create_without_permission_returns_403(db_session, api_client):
    user = User(username="viewer", email="v@example.com", hashed_password="x")
    db_session.add(user); await db_session.flush()
    headers = {"Authorization": f"Bearer {encode_jwt({'sub': str(user.id)})}"}
    res = await api_client.post("/api/v1/agents", json={"name": "a", "type": "conversation"}, headers=headers)
    assert res.json()["code"] == 403
    assert "agent:create" in res.json()["message"]
```

`test/test_agent_acl_api.py`：

```python
from src.utils.jwt_utils import encode_jwt
from src.modules.user.model import User
from src.modules.role.model import Role
from src.modules.permission.model import Permission
from src.modules.agent.model import Agent

async def test_owner_can_add_and_remove_acl(db_session, api_client):
    role = Role(
        code="agent-owner", name="Agent 所有者", is_system=False,
        permissions=[
            Permission(code="agent:view", name="查看 Agent"),
            Permission(code="agent:update", name="编辑 Agent"),
        ],
    )
    owner = User(username="owner", email="o@example.com", hashed_password="x", roles=[role])
    target = User(username="target", email="t@example.com", hashed_password="x")
    db_session.add_all([role, owner, target]); await db_session.flush()
    agent = Agent(name="a", type="conversation", owner_id=owner.id)
    db_session.add(agent); await db_session.flush()

    headers = {"Authorization": f"Bearer {encode_jwt({'sub': str(owner.id)})}"}
    res = await api_client.post(
        f"/api/v1/agents/{agent.id}/acl",
        json={"subject_type": "user", "subject_id": target.id, "access_level": "view"},
        headers=headers,
    )
    acl_id = res.json()["data"]["id"]
    assert res.json()["code"] == 200

    res2 = await api_client.delete(f"/api/v1/agents/{agent.id}/acl/{acl_id}", headers=headers)
    assert res2.json()["code"] == 200
```

> 测试通过真实 JWT 让全局鉴权依赖走完“解析用户 → 加载权限 → 校验权限码”的完整路径；不要再通过覆盖 `get_current_user` 绕过全局依赖。

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_agent_permissions.py test/test_agent_acl_api.py -v`
Expected: FAIL，接口未声明权限/ACL 路由不存在。

- [ ] **Step 3: 给路由加权限声明与 `ctx`**

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | `/agents` | `agent:create` |
| GET | `/agents` | `agent:view` |
| GET | `/agents/{id}` | `agent:view` |
| GET | `/agents/{id}/versions` | `agent:view` |
| PUT | `/agents/{id}` | `agent:update` |
| POST | `/agents/{id}/start` | `agent:update` |
| POST | `/agents/{id}/stop` | `agent:update` |
| POST | `/agents/{id}/publish` | `agent:publish` |
| POST | `/agents/{id}/rollback` | `agent:publish` |
| DELETE | `/agents/{id}` | `agent:delete` |

每个接口增加：

```python
ctx: PermissionContext = Depends(get_permission_context),
```

并传入 service，例如：

```python
result = await svc.create_agent(data, ctx)
```

- [ ] **Step 4: 挂载 ACL/转移路由**

`api.py` 末尾：

```python
from src.modules.data_auth.router import make_acl_router

router.include_router(make_acl_router(
    resource_type="agent",
    view_permission="agent:view",
    update_permission="agent:update",
    load_resource=lambda db, rid: AgentRepository(db).get_by_id(rid),
))
```

得到 `GET/POST/DELETE /agents/{id}/acl` 与 `POST /agents/{id}/transfer`。

- [ ] **Step 5: 移除 pending 前缀**

`src/core/rbac.py`：

```python
RBAC_PENDING_PREFIXES = {
    "/api/v1/prompts", "/api/v1/knowledge-bases",
    "/api/v1/tools", "/api/v1/models", "/api/v1/providers",
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `pytest test/test_agent_permissions.py test/test_agent_acl_api.py -v`
Expected: 2 passed。

- [ ] **Step 7: 提交**

```bash
git add src/modules/agent/api.py src/core/rbac.py test/test_agent_permissions.py test/test_agent_acl_api.py
git commit -m "feat: Agent 接口接入功能权限与共享转移路由"
```

---

### Task 4: 前端 Agent 服务类型

**Files:**
- Modify: `app/src/services/api/agent.ts`, `app/src/services/agent.ts`
- Test: `npm run lint`

- [ ] **Step 1: 扩展 `AgentRead`**

```ts
export interface AgentRead {
  // 原有字段
  owner_id: number
  owner_name: string | null
  can_manage: boolean
  is_shared: boolean
}
```

- [ ] **Step 2: 确认导出**

`app/src/services/agent.ts` 继续通过 `export * from './api/agent'`（或等价方式）导出新类型；页面只从 `@/services/agent` 导入。

- [ ] **Step 3: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add app/src/services/api/agent.ts app/src/services/agent.ts
git commit -m "feat: 前端 Agent 类型增加归属与权限标记"
```

---

### Task 5: Agent 列表页

**Files:**
- Modify: `app/src/pages/agent/List.tsx`
- Test: `npm run lint` + 手测

- [ ] **Step 1: 增加归属列**

- 在“版本”后增加“归属人”列，渲染：

```tsx
<OwnerBadge
  ownerId={agent.owner_id}
  ownerName={agent.owner_name}
  isShared={agent.is_shared}
/>
```

- [ ] **Step 2: 按钮门禁**

- 顶部“新建 Agent”包 `<Can code="agent:create">`。
- 行内启动/停止：

```tsx
{agent.can_manage && (
  <Can code="agent:update">
    <Button ... onClick={() => handleToggleStatus(agent)}>...</Button>
  </Can>
)}
```

- 编辑：`agent.can_manage && <Can code="agent:update">`。
- 删除：`agent.can_manage && <Can code="agent:delete">`。
- 无 `can_manage` 时整组操作只保留“查看”（行点击进入详情）。

- [ ] **Step 3: 空状态**

- `agents.length === 0` 且无关键词：
  “当前数据范围内暂无数据。资源可能存在，只是不在你的查看范围内。”
  提供“查看我的权限”链接到 `/profile`。
- 有关键词：“没有匹配的 Agent”。

- [ ] **Step 4: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 5: 手测**

1. 管理员：所有行有启停/编辑/删除。
2. 开发者（view ALL / manage SELF）：他人 Agent 行只有查看；本人行有编辑/发布，无删除。
3. 只读：所有行无写按钮，顶部无新建。
4. 数据范围 SELF 且无数据：显示范围空状态。

- [ ] **Step 6: 提交**

```bash
git add app/src/pages/agent/List.tsx
git commit -m "feat: Agent 列表增加归属列与行级权限门禁"
```

---

### Task 6: Agent 详情页

**Files:**
- Modify: `app/src/pages/agent/Detail.tsx`, `app/src/pages/agent/Create.tsx`, `app/src/pages/agent/Versions.tsx`
- Test: `npm run lint` + 手测

- [ ] **Step 1: 详情页展示归属与共享**

- 顶部信息区增加 `<OwnerBadge ... isShared={agent.is_shared} />`。
- 有共享时显示“共享中”标签；无共享不显示。

- [ ] **Step 2: 操作按钮门禁**

- 编辑：`agent.can_manage && <Can code="agent:update">`。
- 发布/回滚：`agent.can_manage && <Can code="agent:publish">`。
- 启停：`agent.can_manage && <Can code="agent:update">`。
- 删除：`agent.can_manage && <Can code="agent:delete">`。
- 共享：`agent.can_manage && <Can code="agent:update">`，打开 `ShareDrawer`。
- 转移：`agent.can_manage && <Can code="agent:update">`，打开 `TransferOwnerDialog`。
- 共享/转移成功后重新加载详情。

- [ ] **Step 3: 编辑页越权保护**

`Create.tsx` 编辑模式：

- 加载 Agent 后若 `agent.can_manage === false`，显示提示“你只能查看该 Agent，无权编辑”，保存按钮禁用。
- 保存失败若为 `ApiBusinessError.code === 403`，展示“无权访问该资源”并返回详情。

- [ ] **Step 4: 版本页门禁**

`Versions.tsx`：

- 版本列表本身只需 `agent:view`（路由已守卫）。
- 回滚按钮：`agent.can_manage && <Can code="agent:publish">`。
- 无管理权时只展示版本内容。

- [ ] **Step 5: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 6: 手测**

1. 管理员详情页可见共享、转移、编辑、发布。
2. 他人共享为只读的 Agent：详情可见，共享/转移/编辑全部不渲染。
3. 共享为可管理：编辑可用，共享仍要求 `agent:update`。
4. 转移后列表归属人立即变化。

- [ ] **Step 7: 提交**

```bash
git add app/src/pages/agent
git commit -m "feat: Agent 详情接入共享转移与操作门禁"
```

---

### Task 7: Agent 模块验收

- [ ] **Step 1: 后端测试**

Run:

```bash
pytest test/test_agent_data_auth.py test/test_agent_permissions.py test/test_agent_acl_api.py test/test_data_auth_flow.py -v
```

Expected: 全部通过。

- [ ] **Step 2: 前端构建**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 3: 手测清单**

| 场景 | 预期 |
|---|---|
| AC-03 有 `agent:create` 创建 | 成功，`owner_id` 为本人 |
| AC-17 view SELF 列表 | 只看到自己的 Agent，total 正确 |
| AC-18 直连他人详情 | 403 |
| AC-19 修改/删除他人 | 403 |
| AC-20 view ALL/manage SELF | 可看不可改，行内无编辑 |
| AC-26 共享只读 | 对方可见不可编辑 |
| AC-27 共享可管理 | 对方可编辑 |
| AC-28 取消共享 | 对方下一次请求 403 |
| AC-31 转移归属 | 归属人立即变化 |
| AC-37 详情字段 | 含 owner_id/owner_name/can_manage/is_shared |

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "test: Agent 模块数据授权与前端门禁验收"
```

---

## 依赖与顺序

1. 依赖 `RBAC权限内核-plan.md` 的声明式权限与 `/users/me`。
2. 依赖 `数据级授权内核-plan.md` 的 `owner_id`、`visible_condition`、`assert_can_*`、`make_acl_router`、`BaseRepository.get_page_where`。
3. 依赖 `前端权限控制-plan.md` 的 `Can`、`OwnerBadge`、`ShareDrawer`、`TransferOwnerDialog`。
4. 本计划移除 `/api/v1/agents` 的 pending 豁免；覆盖率测试仍需通过。

## 风险与决策

| 项 | 决策 |
|---|---|
| `owner_name` 来源 | 使用 `User.username`；当前模型无姓名/昵称字段 |
| 列表 `can_manage` 计算 | 当前页 ID 一次 ACL 批量查询 + Python 范围判定，避免 N+1 |
| 编辑页先加载后 403 | 详情允许 view ALL 用户查看；编辑保存由后端 manage 判定拒绝，前端提前禁用保存 |
| 版本接口 | 统一先加载父 Agent 再判定，避免子资源绕过 |
| 发布后状态 | 沿用现有逻辑：发布后 `inactive`，需手动启动 |
