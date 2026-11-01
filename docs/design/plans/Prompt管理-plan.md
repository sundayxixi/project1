# Prompt 管理 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Prompt 模块接入功能权限与数据级授权，支持归属展示、按行管理权控制编辑/删除/发布/回滚，以及资源级共享与归属转移。

**Architecture:** 后端在 `PromptService` 中注入 `PermissionContext`，创建写入 `owner_id`/`created_by`，列表用 `visible_condition` 过滤并返回 `can_manage`/`is_shared`，详情/写操作用统一断言；ACL 与转移通过通用路由工厂挂载。前端列表增加归属列与按钮门禁，创建/版本页面按 `can_manage` 与 `prompt:publish` 控制。

**Tech Stack:** FastAPI / SQLAlchemy 2.0 async / pytest；React 19 / TypeScript 5.9 / Vite 7 / shadcn-ui。

**Spec:** `docs/spec/PROJECT_SPEC_V2.md`（§5.3 权限矩阵、§6 数据授权、FR-14~17、§9.3 Prompt 接口映射）、`docs/design/ui/RBAC原型设计说明书.md`（§5.6）。

**前置计划:** `RBAC权限内核-plan.md`、`数据级授权内核-plan.md`、`前端权限控制-plan.md`。

---

## 模块说明（产品视角）

### 目标

| 编号 | 目标 | 本计划落点 |
|---|---|---|
| G9 | 创建 Prompt 自动写入所有者 | `create_prompt` |
| G10/G11 | 列表过滤、详情/写操作判定 | `visible_condition` + `assert_can_*` |
| G12 | 单个 Prompt 可共享 | `make_acl_router` |
| G13 | 共享/转移立即生效 | ACL 实时查询 |
| FR-09 | 按钮按 `can_manage` 渲染 | 列表返回 `can_manage` |
| FR-14 | 详情返回归属字段 | `PromptRead` 扩展 |

### 交付物

1. `PromptRead` 增加 `owner_id`、`owner_name`、`can_manage`、`is_shared`。
2. Prompt CRUD、发布、回滚、版本列表接入功能权限与数据权限。
3. ACL 与转移路由。
4. 前端类型、列表、创建/编辑、版本页面改造。
5. 后端测试与前端手测清单。

### 不在本期范围

- Prompt 调试/运行时调用链（当前无对应后端接口）。
- 对话日志/统计联动。

---

## Global Constraints

- 权限码：`prompt:view/create/update/delete/publish`。
- 发布/回滚 → `prompt:publish` + 父 Prompt 的 `manage` 数据权限；编辑 → `prompt:update` + manage；删除 → `prompt:delete` + manage。
- 版本列表继承父 Prompt 的查看权。
- 创建只校验功能权限，写入 `owner_id = ctx.user.id`、`created_by = ctx.user.username`。
- 列表 `total` 必须是过滤后的数量；每行返回 `owner_id`、`owner_name`、`can_manage`、`is_shared`。
- 无权限统一 `BizException(403, "资源不存在或无权限访问")`。
- 响应保持 HTTP 200 + body `code`；缓存策略沿用 RBAC 内核。
- 前端 `strict` + `noUnusedLocals` + `noUnusedParameters`；lint/build 必须通过；暂无前端测试运行器，使用手测清单。
- 每个任务提交一次，提交信息使用中文摘要。

---

## Review Focus

1. **开发者删除 Prompt**：开发者默认拥有 `prompt:delete`，但只能删除本人或共享为可管理的 Prompt；他人可见但不可删除的行不能出现删除按钮。
2. **版本页回滚越权**：能查看他人 Prompt 的版本，但不能回滚；回滚按钮必须同时满足 `prompt:publish` 与 `can_manage`。
3. **列表 total**：过滤后的分页总数必须正确。
4. **共享即时性**：共享只读/可管理、取消共享在下一次请求立即生效。
5. **创建归属**：创建后 `owner_id` 为本人，`created_by` 为用户名，不能被请求体覆盖。

---

## File Structure

**修改**

| 文件 | 变更 |
|---|---|
| `src/modules/prompt/schema.py` | `PromptRead` 增加归属/权限标记 |
| `src/modules/prompt/repository.py` | `search_page` 接受 `where` |
| `src/modules/prompt/service.py` | 注入 `PermissionContext`、数据过滤与断言 |
| `src/modules/prompt/api.py` | 权限声明、`ctx` 注入、ACL/转移路由 |
| `src/core/rbac.py` | 从 pending 列表移除 `/api/v1/prompts` |
| `app/src/services/api/prompt.ts` | `PromptRead` 新字段 |
| `app/src/pages/prompt/List.tsx` | 归属列、按钮门禁、空状态 |
| `app/src/pages/prompt/Create.tsx` | 编辑模式 `can_manage` 校验 |
| `app/src/pages/prompt/Versions.tsx` | 回滚按钮门禁 |

**新增测试**

| 文件 | 职责 |
|---|---|
| `test/test_prompt_data_auth.py` | 创建归属、列表过滤、详情/写操作 403 |
| `test/test_prompt_permissions.py` | 功能权限 401/403 与 ACL 接口 |

---

### Task 1: `PromptRead` 归属与权限标记

**Files:**
- Modify: `src/modules/prompt/schema.py`, `src/modules/prompt/service.py`
- Test: `test/test_prompt_data_auth.py`

**Interfaces:**
- Consumes: `Prompt.owner`、`Prompt.owner_id`。
- Produces:

```python
class PromptRead(BaseModel):
    # 原有字段不变
    owner_id: int
    owner_name: str | None
    can_manage: bool = False
    is_shared: bool = False
```

- [ ] **Step 1: 写失败测试**

```python
from src.modules.prompt.model import Prompt
from src.modules.prompt.service import PromptService
from src.modules.user.model import User

async def test_prompt_read_owner_fields(db_session):
    owner = User(username="owner", email="o@example.com", hashed_password="x")
    db_session.add(owner); await db_session.flush()
    prompt = Prompt(name="p", content="hello", owner_id=owner.id)
    db_session.add(prompt); await db_session.flush()
    read = PromptService(db_session)._to_read(prompt)
    assert read.owner_id == owner.id
    assert read.owner_name == "owner"
    assert read.can_manage is False
    assert read.is_shared is False
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_prompt_data_auth.py -v`
Expected: FAIL，字段不存在。

- [ ] **Step 3: 扩展 Schema 与 `_to_read`**

`PromptService._to_read(prompt, *, can_manage=False, is_shared=False)` 填充 `owner_name=prompt.owner.username if prompt.owner else None`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest test/test_prompt_data_auth.py -v`
Expected: 1 passed。

- [ ] **Step 5: 提交**

```bash
git add src/modules/prompt/schema.py src/modules/prompt/service.py test/test_prompt_data_auth.py
git commit -m "feat: Prompt 响应增加归属人与权限标记"
```

---

### Task 2: Prompt 服务接入数据权限

**Files:**
- Modify: `src/modules/prompt/repository.py`, `src/modules/prompt/service.py`
- Test: `test/test_prompt_data_auth.py`（追加）

**Interfaces:**
- Consumes: `PermissionContext`、`visible_condition`、`assert_can_view_resource`、`assert_can_manage_resource`、`acl_levels_map`、`is_shared_map`、`can_manage`、`delete_acl_for_resource`、`BaseRepository.get_page_where`。
- Produces:

```python
class PromptService:
    async def create_prompt(self, data: PromptCreate, ctx: PermissionContext) -> PromptRead
    async def list_prompts(self, params: PageParams, ctx: PermissionContext) -> PageResult[PromptRead]
    async def get_prompt(self, prompt_id: int, ctx: PermissionContext) -> PromptRead
    async def update_prompt(self, prompt_id: int, data: PromptUpdate, ctx: PermissionContext) -> PromptRead
    async def delete_prompt(self, prompt_id: int, ctx: PermissionContext) -> None
    async def publish(self, prompt_id: int, data: PublishRequest, ctx: PermissionContext) -> PromptRead
    async def rollback(self, prompt_id: int, data: RollbackRequest, ctx: PermissionContext) -> PromptRead
    async def get_versions(self, prompt_id: int, ctx: PermissionContext) -> list[PromptVersionRead]
```

- [ ] **Step 1: 追加失败测试**

```python
from src.core.rbac import PermissionContext
from src.core.data_scope import DataScope, ScopeLevel
from src.core.exceptions import BizException
from src.modules.prompt.schema import PromptCreate, PromptUpdate
from src.modules.prompt.service import PromptService
import pytest

def ctx_for(user, view="SELF", manage="SELF"):
    return PermissionContext(
        user=user, permissions=frozenset(), role_ids=frozenset(),
        data_scopes={"prompt": DataScope(view=ScopeLevel(view), manage=ScopeLevel(manage))},
    )

async def test_create_writes_owner(db_session):
    user = User(username="dev", email="dev@example.com", hashed_password="x")
    db_session.add(user); await db_session.flush()
    read = await PromptService(db_session).create_prompt(PromptCreate(name="p", content="hi"), ctx_for(user))
    assert read.owner_id == user.id and read.created_by == "dev"

async def test_list_filters_other_prompts(db_session):
    a = User(username="a", email="a@example.com", hashed_password="x")
    b = User(username="b", email="b@example.com", hashed_password="x")
    db_session.add_all([a, b]); await db_session.flush()
    db_session.add_all([
        Prompt(name="a-p", content="x", owner_id=a.id),
        Prompt(name="b-p", content="x", owner_id=b.id),
    ])
    await db_session.flush()
    from src.core.deps import PageParams
    page = await PromptService(db_session).list_prompts(PageParams(), ctx_for(a))
    assert page.total == 1 and page.items[0].name == "a-p"

async def test_update_other_prompt_403(db_session):
    a = User(username="a", email="a@example.com", hashed_password="x")
    b = User(username="b", email="b@example.com", hashed_password="x")
    db_session.add_all([a, b]); await db_session.flush()
    prompt = Prompt(name="b-p", content="x", owner_id=b.id)
    db_session.add(prompt); await db_session.flush()
    with pytest.raises(BizException):
        await PromptService(db_session).update_prompt(prompt.id, PromptUpdate(name="x"), ctx_for(a, view="ALL", manage="SELF"))
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_prompt_data_auth.py -v`
Expected: FAIL，服务签名不接受 `ctx`。

- [ ] **Step 3: repository 支持过滤**

`PromptRepository.search_page` 增加 `where` 参数并调用 `get_page_where`。

- [ ] **Step 4: 改造服务**

- `create_prompt`：写入 owner/created_by，`can_manage=True`。
- `list_prompts`：`visible_condition(Prompt, "prompt", ctx)`；当前页分别调用 `acl_levels_map` 与 `is_shared_map`；逐行标记。
- `get_prompt`：先 `assert_can_view_resource`，再计算标记。
- `update/delete/publish/rollback`：先 `assert_can_manage_resource`；`delete_prompt` 删除后调用 `delete_acl_for_resource(self.db, "prompt", prompt_id)`。
- `get_versions`：先加载父 Prompt 并 `assert_can_view_resource`。

- [ ] **Step 5: 运行测试确认通过**

Run: `pytest test/test_prompt_data_auth.py -v`
Expected: 4 passed。

- [ ] **Step 6: 提交**

```bash
git add src/modules/prompt test/test_prompt_data_auth.py
git commit -m "feat: Prompt 服务接入数据范围过滤与管理权判定"
```

---

### Task 3: Prompt 接口权限与 ACL/转移路由

**Files:**
- Modify: `src/modules/prompt/api.py`, `src/core/rbac.py`
- Test: `test/test_prompt_permissions.py`

**Interfaces:**
- Consumes: `require_permission`、`get_permission_context`、`make_acl_router`。
- Produces: 全部 Prompt 路由声明权限；ACL/转移路由挂载。

- [ ] **Step 1: 写失败测试**

> HTTP 测试使用 `httpx.AsyncClient` + `ASGITransport`（夹具见 `RBAC权限内核-plan.md` Task 1），不要使用同步 `TestClient`。

```python
from src.utils.jwt_utils import encode_jwt
from src.modules.user.model import User
from src.modules.role.model import Role
from src.modules.permission.model import Permission
from src.modules.prompt.model import Prompt

async def test_prompt_create_without_permission_403(db_session, api_client):
    user = User(username="viewer", email="v@example.com", hashed_password="x")
    db_session.add(user); await db_session.flush()
    headers = {"Authorization": f"Bearer {encode_jwt({'sub': str(user.id)})}"}
    res = await api_client.post("/api/v1/prompts", json={"name": "p", "content": "hi"}, headers=headers)
    assert res.json()["code"] == 403
    assert "prompt:create" in res.json()["message"]

async def test_owner_can_share_prompt(db_session, api_client):
    role = Role(
        code="prompt-owner", name="Prompt 所有者", is_system=False,
        permissions=[
            Permission(code="prompt:view", name="查看 Prompt"),
            Permission(code="prompt:update", name="编辑 Prompt"),
        ],
    )
    owner = User(username="owner", email="o@example.com", hashed_password="x", roles=[role])
    target = User(username="target", email="t@example.com", hashed_password="x")
    db_session.add_all([role, owner, target]); await db_session.flush()
    prompt = Prompt(name="p", content="hi", owner_id=owner.id)
    db_session.add(prompt); await db_session.flush()

    headers = {"Authorization": f"Bearer {encode_jwt({'sub': str(owner.id)})}"}
    res = await api_client.post(
        f"/api/v1/prompts/{prompt.id}/acl",
        json={"subject_type": "user", "subject_id": target.id, "access_level": "view"},
        headers=headers,
    )
    assert res.json()["code"] == 200
    assert res.json()["data"]["subject_id"] == target.id
```

> 测试通过真实 JWT 走完整的全局鉴权链路，不要覆盖 `get_current_user` 绕过。

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_prompt_permissions.py -v`
Expected: FAIL。

- [ ] **Step 3: 加权限声明与 `ctx`**

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | `/prompts` | `prompt:create` |
| GET | `/prompts` | `prompt:view` |
| GET | `/prompts/{id}` | `prompt:view` |
| GET | `/prompts/{id}/versions` | `prompt:view` |
| PUT | `/prompts/{id}` | `prompt:update` |
| POST | `/prompts/{id}/publish` | `prompt:publish` |
| POST | `/prompts/{id}/rollback` | `prompt:publish` |
| DELETE | `/prompts/{id}` | `prompt:delete` |

每个接口注入 `ctx: PermissionContext = Depends(get_permission_context)` 并传给 service。

- [ ] **Step 4: 挂载 ACL/转移路由**

```python
router.include_router(make_acl_router(
    resource_type="prompt",
    view_permission="prompt:view",
    update_permission="prompt:update",
    load_resource=lambda db, rid: PromptRepository(db).get_by_id(rid),
))
```

- [ ] **Step 5: 移除 pending 前缀**

从 `RBAC_PENDING_PREFIXES` 移除 `/api/v1/prompts`。

- [ ] **Step 6: 运行测试确认通过**

Run: `pytest test/test_prompt_permissions.py -v`
Expected: 2 passed。

- [ ] **Step 7: 提交**

```bash
git add src/modules/prompt/api.py src/core/rbac.py test/test_prompt_permissions.py
git commit -m "feat: Prompt 接口接入功能权限与共享转移路由"
```

---

### Task 4: 前端 Prompt 服务类型

**Files:**
- Modify: `app/src/services/api/prompt.ts`, `app/src/services/prompt.ts`
- Test: `npm run lint`

- [ ] **Step 1: 扩展 `PromptRead`**

```ts
export interface PromptRead {
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
git add app/src/services/api/prompt.ts app/src/services/prompt.ts
git commit -m "feat: 前端 Prompt 类型增加归属与权限标记"
```

---

### Task 5: Prompt 列表页

**Files:**
- Modify: `app/src/pages/prompt/List.tsx`
- Test: `npm run lint` + 手测

- [ ] **Step 1: 归属列与按钮门禁**

- 增加“归属人”列，使用 `<OwnerBadge>`。
- 顶部“新建 Prompt”包 `<Can code="prompt:create">`。
- 编辑：`prompt.can_manage && <Can code="prompt:update">`。
- 删除：`prompt.can_manage && <Can code="prompt:delete">`。
- 发布入口（若有快捷发布）：`prompt.can_manage && <Can code="prompt:publish">`。

- [ ] **Step 2: 空状态**

- 无数据且无关键词：显示“当前数据范围内暂无数据”+ 查看权限链接。
- 有关键词：显示“没有匹配的 Prompt”。

- [ ] **Step 3: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 4: 手测**

1. 开发者：本人 Prompt 有编辑/删除/发布；他人 Prompt 只有查看。
2. 只读：无新建/编辑/删除/发布。
3. 搜索与分页正常，total 随范围变化。

- [ ] **Step 5: 提交**

```bash
git add app/src/pages/prompt/List.tsx
git commit -m "feat: Prompt 列表增加归属列与行级权限门禁"
```

---

### Task 6: Prompt 创建/编辑与版本页

**Files:**
- Modify: `app/src/pages/prompt/Create.tsx`, `app/src/pages/prompt/Versions.tsx`
- Test: `npm run lint` + 手测

- [ ] **Step 1: 创建/编辑页**

- 编辑模式加载 Prompt 后，`can_manage === false` 时显示“你只能查看该 Prompt，无权编辑”，保存与发布按钮禁用。
- 保存/发布失败且 `ApiBusinessError.code === 403` 时提示“无权访问该资源”并返回列表。

- [ ] **Step 2: 版本页**

- 版本列表只读渲染。
- 回滚按钮：`prompt.can_manage && <Can code="prompt:publish">`。
- 无管理权时显示“仅可查看版本历史”。

- [ ] **Step 3: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 4: 手测**

1. 所有者可发布、回滚。
2. 他人只读 Prompt 的版本页无回滚按钮。
3. 开发者有 `prompt:publish` 但对他人的 Prompt 不能回滚。

- [ ] **Step 5: 提交**

```bash
git add app/src/pages/prompt/Create.tsx app/src/pages/prompt/Versions.tsx
git commit -m "feat: Prompt 编辑与版本页按管理权控制发布回滚"
```

---

### Task 7: Prompt 模块验收

- [ ] **Step 1: 后端测试**

Run: `pytest test/test_prompt_data_auth.py test/test_prompt_permissions.py -v`
Expected: 全部通过。

- [ ] **Step 2: 前端构建**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 3: 手测清单**

| 场景 | 预期 |
|---|---|
| 创建 Prompt | owner_id 为本人，created_by 为用户名 |
| view SELF 列表 | 只看到本人及共享可见的 Prompt |
| 直连他人 Prompt | 403 |
| 编辑他人 Prompt | 403 |
| 删除本人 Prompt（开发者） | 成功 |
| 删除他人 Prompt | 403，无删除按钮 |
| 共享只读/可管理/取消 | 立即生效 |
| 版本回滚 | 需 `prompt:publish` + manage |

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "test: Prompt 模块数据授权与前端门禁验收"
```

---

## 依赖与顺序

1. 依赖 `RBAC权限内核-plan.md`、`数据级授权内核-plan.md`、`前端权限控制-plan.md`。
2. 与 `Agent管理-plan.md` 可并行，但两者都要修改 `RBAC_PENDING_PREFIXES`；合并时注意保留对方的移除结果。
3. 移除 `/api/v1/prompts` 后，覆盖率测试仍需通过。

## 风险与决策

| 项 | 决策 |
|---|---|
| 开发者拥有 `prompt:delete` | 删除按钮同时受功能权限与 `can_manage` 限制，不能删除他人 Prompt |
| 版本回滚 | 父 Prompt 的 manage 判定优先于功能权限，二者都满足才允许 |
| `owner_name` | 使用 `User.username` |
| 发布后状态 | 沿用现有 `draft/published` 逻辑，不改变版本号规则 |
