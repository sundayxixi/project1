# 工具管理 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把工具模块接入功能权限与数据级授权，支持归属展示、按行管理权控制编辑/启停/测试/删除，以及资源级共享与归属转移。

**Architecture:** 后端在 `ToolService` 中注入 `PermissionContext`，创建写入 `owner_id`/`created_by`，列表用 `visible_condition` 过滤并返回 `can_manage`/`is_shared`，详情/写操作统一断言；ACL 与转移通过通用路由工厂挂载。前端列表增加归属列与按钮门禁，详情页接入共享抽屉、转移弹窗与 JSON 测试。

**Tech Stack:** FastAPI / SQLAlchemy 2.0 async / pytest；React 19 / TypeScript 5.9 / Vite 7 / shadcn-ui。

**Spec:** `docs/spec/PROJECT_SPEC_V2.md`（§5.1 特殊操作归属、§6 数据授权、FR-14~17、§9.3 工具接口映射）、`docs/design/ui/RBAC原型设计说明书.md`（§5.8）。

**前置计划:** `RBAC权限内核-plan.md`、`数据级授权内核-plan.md`、`前端权限控制-plan.md`。

---

## 模块说明（产品视角）

### 目标

| 编号 | 目标 | 本计划落点 |
|---|---|---|
| G9 | 创建工具自动写入所有者 | `create_tool` |
| G10/G11 | 列表过滤、详情/写操作判定 | `visible_condition` + `assert_can_*` |
| G12 | 单个工具可共享 | `make_acl_router` |
| FR-09 | 行内编辑/启停/测试/删除按 `can_manage` | 列表返回 `can_manage` |
| FR-14 | 详情返回归属字段 | `ToolRead` 扩展 |

### 交付物

1. `ToolRead` 增加 `owner_id`、`owner_name`、`can_manage`、`is_shared`。
2. 工具 CRUD、启用/禁用、测试接入功能权限与数据权限。
3. ACL 与转移路由。
4. 前端类型、列表、创建、详情页面改造。
5. 后端测试与前端手测清单。

### 不在本期范围

- 工具运行时编排与调用日志（当前无对应后端接口）。
- 内置工具（`builtin`）的特权逻辑；本期所有工具按同一套归属与范围规则处理。

---

## Global Constraints

- 权限码：`tool:view/create/update/delete`。
- 启用/禁用/测试调用 → `tool:update` + 该工具的 `manage` 数据权限；删除 → `tool:delete` + manage。
- 创建只校验功能权限，写入 `owner_id = ctx.user.id`、`created_by = ctx.user.username`。
- 列表 `total` 必须是过滤后的数量；每行返回 `owner_id`、`owner_name`、`can_manage`、`is_shared`。
- 无权限统一 `BizException(403, "资源不存在或无权限访问")`。
- 响应保持 HTTP 200 + body `code`。
- 前端 `strict` + `noUnusedLocals` + `noUnusedParameters`；lint/build 必须通过；暂无前端测试运行器，使用手测清单。
- 每个任务提交一次，提交信息使用中文摘要。

---

## Review Focus

1. **工具测试越权**：测试调用是 POST，但归入 `tool:update`；只有只读共享的用户不能测试工具。
2. **列表 total**：过滤后的分页总数正确。
3. **共享即时性**：只读/可管理/取消共享在下一次请求立即生效，测试与启停接口同样受影响。
4. **名称唯一性**：创建时 `name` 唯一冲突仍返回原有业务错误，不能被权限错误覆盖。
5. **详情字段**：详情返回 `owner_id`、`owner_name`、`can_manage`、`is_shared`，前端不自行推断。

---

## File Structure

**修改**

| 文件 | 变更 |
|---|---|
| `src/modules/tool/schema.py` | `ToolRead` 增加归属/权限标记 |
| `src/modules/tool/repository.py` | `search_page` 接受 `where` |
| `src/modules/tool/service.py` | 注入 `PermissionContext`、数据过滤与断言 |
| `src/modules/tool/api.py` | 权限声明、`ctx` 注入、ACL/转移路由 |
| `src/core/rbac.py` | 从 pending 列表移除 `/api/v1/tools` |
| `app/src/services/api/tool.ts` | `ToolRead` 新字段 |
| `app/src/pages/tool/List.tsx` | 归属列、按钮门禁、空状态 |
| `app/src/pages/tool/Create.tsx` | 创建按钮门禁 |
| `app/src/pages/tool/Detail.tsx` | 归属/共享、测试/启停/编辑/删除门禁 |

**新增测试**

| 文件 | 职责 |
|---|---|
| `test/test_tool_data_auth.py` | 创建归属、列表过滤、详情/写操作 403 |
| `test/test_tool_permissions.py` | 功能权限 401/403 与 ACL 接口 |

---

### Task 1: `ToolRead` 归属与权限标记

**Files:**
- Modify: `src/modules/tool/schema.py`, `src/modules/tool/service.py`
- Test: `test/test_tool_data_auth.py`

**Interfaces:**
- Consumes: `Tool.owner`、`Tool.owner_id`。
- Produces:

```python
class ToolRead(BaseModel):
    # 原有字段不变
    owner_id: int
    owner_name: str | None
    can_manage: bool = False
    is_shared: bool = False
```

- [ ] **Step 1: 写失败测试**

```python
from src.modules.tool.model import Tool
from src.modules.tool.service import ToolService
from src.modules.user.model import User

async def test_tool_read_owner_fields(db_session):
    owner = User(username="owner", email="o@example.com", hashed_password="x")
    db_session.add(owner); await db_session.flush()
    tool = Tool(name="t", type="http_api", owner_id=owner.id)
    db_session.add(tool); await db_session.flush()
    read = ToolService(db_session)._to_read(tool)
    assert read.owner_id == owner.id
    assert read.owner_name == "owner"
    assert read.can_manage is False
    assert read.is_shared is False
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_tool_data_auth.py -v`
Expected: FAIL。

- [ ] **Step 3: 扩展 Schema 与 `_to_read`**

`ToolService._to_read(tool, *, can_manage=False, is_shared=False)` 填充 `owner_name=tool.owner.username if tool.owner else None`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest test/test_tool_data_auth.py -v`
Expected: 1 passed。

- [ ] **Step 5: 提交**

```bash
git add src/modules/tool/schema.py src/modules/tool/service.py test/test_tool_data_auth.py
git commit -m "feat: 工具响应增加归属人与权限标记"
```

---

### Task 2: Tool 服务接入数据权限

**Files:**
- Modify: `src/modules/tool/repository.py`, `src/modules/tool/service.py`
- Test: `test/test_tool_data_auth.py`（追加）

**Interfaces:**
- Consumes: `PermissionContext`、`visible_condition`、`assert_can_view_resource`、`assert_can_manage_resource`、`acl_levels_map`、`is_shared_map`、`can_manage`、`delete_acl_for_resource`、`BaseRepository.get_page_where`。
- Produces:

```python
class ToolService:
    async def create_tool(self, data: ToolCreate, ctx: PermissionContext) -> ToolRead
    async def list_tools(self, params: PageParams, ctx: PermissionContext) -> PageResult[ToolRead]
    async def get_tool(self, tool_id: int, ctx: PermissionContext) -> ToolRead
    async def update_tool(self, tool_id: int, data: ToolUpdate, ctx: PermissionContext) -> ToolRead
    async def delete_tool(self, tool_id: int, ctx: PermissionContext) -> None
    async def enable_tool(self, tool_id: int, ctx: PermissionContext) -> ToolRead
    async def disable_tool(self, tool_id: int, ctx: PermissionContext) -> ToolRead
    async def test_tool(self, tool_id: int, data: ToolTestRequest, ctx: PermissionContext) -> ToolTestResponse
```

- [ ] **Step 1: 追加失败测试**

```python
from src.core.rbac import PermissionContext
from src.core.data_scope import DataScope, ScopeLevel
from src.core.exceptions import BizException
from src.core.deps import PageParams
from src.modules.tool.schema import ToolCreate, ToolUpdate
from src.modules.tool.service import ToolService
import pytest

def ctx_for(user, view="SELF", manage="SELF"):
    return PermissionContext(
        user=user, permissions=frozenset(), role_ids=frozenset(),
        data_scopes={"tool": DataScope(view=ScopeLevel(view), manage=ScopeLevel(manage))},
    )

async def test_create_tool_writes_owner(db_session):
    user = User(username="dev", email="dev@example.com", hashed_password="x")
    db_session.add(user); await db_session.flush()
    read = await ToolService(db_session).create_tool(ToolCreate(name="t", type="http_api"), ctx_for(user))
    assert read.owner_id == user.id and read.created_by == "dev"

async def test_list_tools_filters(db_session):
    a = User(username="a", email="a@example.com", hashed_password="x")
    b = User(username="b", email="b@example.com", hashed_password="x")
    db_session.add_all([a, b]); await db_session.flush()
    db_session.add_all([
        Tool(name="a-t", type="http_api", owner_id=a.id),
        Tool(name="b-t", type="http_api", owner_id=b.id),
    ])
    await db_session.flush()
    page = await ToolService(db_session).list_tools(PageParams(), ctx_for(a))
    assert page.total == 1 and page.items[0].name == "a-t"

async def test_test_other_tool_403(db_session):
    a = User(username="a", email="a@example.com", hashed_password="x")
    b = User(username="b", email="b@example.com", hashed_password="x")
    db_session.add_all([a, b]); await db_session.flush()
    tool = Tool(name="b-t", type="http_api", owner_id=b.id)
    db_session.add(tool); await db_session.flush()
    from src.modules.tool.schema import ToolTestRequest
    with pytest.raises(BizException):
        await ToolService(db_session).test_tool(tool.id, ToolTestRequest(input={}), ctx_for(a, view="ALL", manage="SELF"))
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_tool_data_auth.py -v`
Expected: FAIL。

- [ ] **Step 3: 实现过滤与判定**

- `ToolRepository.search_page` 增加 `where`，调用 `get_page_where`。
- `create_tool`：写入 owner/created_by；`can_manage=True`。
- `list_tools`：`visible_condition(Tool, "tool", ctx)`；当前页分别调用 `acl_levels_map` 与 `is_shared_map`；逐行标记。
- `get_tool`：`assert_can_view_resource` + 标记。
- `update/delete/enable/disable/test`：`assert_can_manage_resource`；`delete_tool` 删除后调用 `delete_acl_for_resource(self.db, "tool", tool_id)`。
- 名称唯一冲突等原有业务异常保持不变。

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest test/test_tool_data_auth.py -v`
Expected: 4 passed。

- [ ] **Step 5: 提交**

```bash
git add src/modules/tool test/test_tool_data_auth.py
git commit -m "feat: 工具服务接入数据范围过滤与管理权判定"
```

---

### Task 3: 工具接口权限声明与 ACL/转移路由

**Files:**
- Modify: `src/modules/tool/api.py`, `src/core/rbac.py`
- Test: `test/test_tool_permissions.py`

**Interfaces:**
- Consumes: `require_permission`、`get_permission_context`、`make_acl_router`。
- Produces: 全部工具路由声明权限；ACL/转移路由挂载。

- [ ] **Step 1: 写失败测试**

> HTTP 测试使用 `httpx.AsyncClient` + `ASGITransport`（夹具见 `RBAC权限内核-plan.md` Task 1），不要使用同步 `TestClient`。

```python
from src.utils.jwt_utils import encode_jwt
from src.modules.user.model import User
from src.modules.role.model import Role
from src.modules.permission.model import Permission
from src.modules.tool.model import Tool

async def test_tool_create_without_permission_403(db_session, api_client):
    user = User(username="viewer", email="v@example.com", hashed_password="x")
    db_session.add(user); await db_session.flush()
    headers = {"Authorization": f"Bearer {encode_jwt({'sub': str(user.id)})}"}
    res = await api_client.post("/api/v1/tools", json={"name": "t", "type": "http_api"}, headers=headers)
    assert res.json()["code"] == 403
    assert "tool:create" in res.json()["message"]

async def test_owner_can_share_tool(db_session, api_client):
    role = Role(
        code="tool-owner", name="工具所有者", is_system=False,
        permissions=[
            Permission(code="tool:view", name="查看工具"),
            Permission(code="tool:update", name="编辑工具"),
        ],
    )
    owner = User(username="owner", email="o@example.com", hashed_password="x", roles=[role])
    target = User(username="target", email="t@example.com", hashed_password="x")
    db_session.add_all([role, owner, target]); await db_session.flush()
    tool = Tool(name="t", type="http_api", owner_id=owner.id)
    db_session.add(tool); await db_session.flush()

    headers = {"Authorization": f"Bearer {encode_jwt({'sub': str(owner.id)})}"}
    res = await api_client.post(
        f"/api/v1/tools/{tool.id}/acl",
        json={"subject_type": "user", "subject_id": target.id, "access_level": "view"},
        headers=headers,
    )
    assert res.json()["code"] == 200
```

> 测试通过真实 JWT 走完整鉴权链路，不要覆盖 `get_current_user` 绕过。

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_tool_permissions.py -v`
Expected: FAIL。

- [ ] **Step 3: 加权限声明与 `ctx`**

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | `/tools` | `tool:create` |
| GET | `/tools` | `tool:view` |
| GET | `/tools/{id}` | `tool:view` |
| PUT | `/tools/{id}` | `tool:update` |
| POST | `/tools/{id}/enable` | `tool:update` |
| POST | `/tools/{id}/disable` | `tool:update` |
| POST | `/tools/{id}/test` | `tool:update` |
| DELETE | `/tools/{id}` | `tool:delete` |

- [ ] **Step 4: 挂载 ACL/转移路由**

```python
router.include_router(make_acl_router(
    resource_type="tool",
    view_permission="tool:view",
    update_permission="tool:update",
    load_resource=lambda db, rid: ToolRepository(db).get_by_id(rid),
))
```

- [ ] **Step 5: 移除 pending 前缀**

从 `RBAC_PENDING_PREFIXES` 移除 `/api/v1/tools`。

- [ ] **Step 6: 运行测试确认通过**

Run: `pytest test/test_tool_permissions.py -v`
Expected: 2 passed。

- [ ] **Step 7: 提交**

```bash
git add src/modules/tool/api.py src/core/rbac.py test/test_tool_permissions.py
git commit -m "feat: 工具接口接入功能权限与共享转移路由"
```

---

### Task 4: 前端工具服务类型

**Files:**
- Modify: `app/src/services/api/tool.ts`, `app/src/services/tool.ts`
- Test: `npm run lint`

- [ ] **Step 1: 扩展 `ToolRead`**

```ts
export interface ToolRead {
  // 原有字段
  owner_id: number
  owner_name: string | null
  can_manage: boolean
  is_shared: boolean
}
```

- [ ] **Step 2: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add app/src/services/api/tool.ts app/src/services/tool.ts
git commit -m "feat: 前端工具类型增加归属与权限标记"
```

---

### Task 5: 工具列表页

**Files:**
- Modify: `app/src/pages/tool/List.tsx`
- Test: `npm run lint` + 手测

- [ ] **Step 1: 归属列与按钮门禁**

- 增加“归属人”列，使用 `<OwnerBadge>`。
- 顶部“注册工具”包 `<Can code="tool:create">`。
- 编辑：`tool.can_manage && <Can code="tool:update">`。
- 启用/禁用：`tool.can_manage && <Can code="tool:update">`。
- 测试：`tool.can_manage && <Can code="tool:update">`。
- 删除：`tool.can_manage && <Can code="tool:delete">`。
- 只读共享的行只保留“查看详情”。

- [ ] **Step 2: 空状态**

- 无数据且无关键词：“当前数据范围内暂无数据”+ 查看权限链接。
- 有关键词：“没有匹配的工具”。

- [ ] **Step 3: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 4: 手测**

1. 开发者：本人工具可编辑/测试/启停；他人工具只读。
2. 开发者无 `tool:delete`：删除按钮完全不渲染。
3. 只读：无任何写按钮。

- [ ] **Step 5: 提交**

```bash
git add app/src/pages/tool/List.tsx
git commit -m "feat: 工具列表增加归属列与行级权限门禁"
```

---

### Task 6: 工具创建与详情页

**Files:**
- Modify: `app/src/pages/tool/Create.tsx`, `app/src/pages/tool/Detail.tsx`
- Test: `npm run lint` + 手测

- [ ] **Step 1: 创建页**

- 创建按钮包 `<Can code="tool:create">`；路由已守卫。
- 不在表单中暴露 owner；后端写入。

- [ ] **Step 2: 详情页**

- 顶部显示 `<OwnerBadge ... isShared={tool.is_shared} />`。
- 编辑：`tool.can_manage && <Can code="tool:update">`。
- 启用/禁用：`tool.can_manage && <Can code="tool:update">`。
- JSON 参数测试：`tool.can_manage && <Can code="tool:update">`。
- 删除：`tool.can_manage && <Can code="tool:delete">`。
- 共享：`tool.can_manage && <Can code="tool:update">`，打开 `ShareDrawer`。
- 转移：`tool.can_manage && <Can code="tool:update">`，打开 `TransferOwnerDialog`。
- 共享/转移成功后重新加载详情。

- [ ] **Step 3: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 4: 手测**

1. 所有者详情可测试、启停、编辑、共享、转移。
2. 只读共享：详情可看，测试/启停/编辑/共享/转移全部不渲染。
3. 可管理共享：测试/启停/编辑可用，删除仍要求 `tool:delete`（开发者没有）。

- [ ] **Step 5: 提交**

```bash
git add app/src/pages/tool
git commit -m "feat: 工具详情接入共享转移与测试权限门禁"
```

---

### Task 7: 工具模块验收

- [ ] **Step 1: 后端测试**

Run: `pytest test/test_tool_data_auth.py test/test_tool_permissions.py -v`
Expected: 全部通过。

- [ ] **Step 2: 前端构建**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 3: 手测清单**

| 场景 | 预期 |
|---|---|
| 创建工具 | owner_id 为本人，created_by 为用户名 |
| view SELF 列表 | 只看到本人及共享可见的工具 |
| 直连他人工具 | 403 |
| 他人工具测试 | 403，无测试按钮 |
| 开发者删除 | 无删除按钮（无 `tool:delete`） |
| 共享只读/可管理/取消 | 立即生效，测试接口同样受控 |
| 详情字段 | 含 owner_id/owner_name/can_manage/is_shared |

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "test: 工具模块数据授权与前端门禁验收"
```

---

## 依赖与顺序

1. 依赖 `RBAC权限内核-plan.md`、`数据级授权内核-plan.md`、`前端权限控制-plan.md`。
2. 与 Agent/Prompt/知识库模块可并行，但共同修改 `RBAC_PENDING_PREFIXES`，合并时保留所有移除结果。
3. 移除 `/api/v1/tools` 后，覆盖率测试仍需通过。

## 风险与决策

| 项 | 决策 |
|---|---|
| 测试调用是否算写操作 | 是，归入 `tool:update` + manage，避免只读用户触发外部请求 |
| 内置工具 | 本期不设特权；如需全局可用，由管理员把数据范围调为 ALL |
| 名称唯一冲突 | 保持原有业务错误，不被 403 覆盖 |
| `owner_name` | 使用 `User.username` |
| 工具配置中的敏感字段 | 本期不在响应中脱敏；后续单独立项，不在 RBAC 范围 |
