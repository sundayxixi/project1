# 知识库管理 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把知识库、文档、分段接入功能权限与数据级授权，保证文档/分段完全继承知识库的可见性与管理权，并支持知识库级共享与归属转移。

**Architecture:** 后端在 `KnowledgeService` 中统一先加载知识库并做 `assert_can_view_resource` / `assert_can_manage_resource`，文档与分段操作复用父知识库判定；列表用 `visible_condition` 过滤并返回 `can_manage`/`is_shared`；ACL 与转移通过通用路由工厂挂载。前端在知识库列表/详情/文档/分段/检索测试页面按 `can_manage` 与权限码控制所有写操作。

**Tech Stack:** FastAPI / SQLAlchemy 2.0 async / pytest；React 19 / TypeScript 5.9 / Vite 7 / shadcn-ui。

**Spec:** `docs/spec/PROJECT_SPEC_V2.md`（§4.2 派生资源、§6.6 派生资源口径、FR-14~17、§9.3 知识库接口映射）、`docs/design/ui/RBAC原型设计说明书.md`（§5.7、§7.4）。

**前置计划:** `RBAC权限内核-plan.md`、`数据级授权内核-plan.md`、`前端权限控制-plan.md`。

---

## 模块说明（产品视角）

### 目标

| 编号 | 目标 | 本计划落点 |
|---|---|---|
| G9 | 创建知识库自动写入所有者 | `create_kb` |
| G10/G11 | 列表过滤、详情/写操作判定 | `visible_condition` + `assert_can_*` |
| G12 | 知识库级共享 | `make_acl_router` |
| FR-15 | 文档上传/删除、分段编辑/删除、重试继承知识库判定 | 每个子资源操作先加载 KB |
| FR-16 | 共享抽屉 | 详情页 `ShareDrawer` |
| FR-17 | 归属转移 | `TransferOwnerDialog` |

### 交付物

1. `KnowledgeBaseRead` 增加 `owner_id`、`owner_name`、`can_manage`、`is_shared`。
2. 知识库 CRUD、配置更新、删除接入数据权限。
3. 文档上传/列表/删除/重试、分段列表/编辑/删除、检索测试继承知识库判定。
4. ACL 与转移路由。
5. 前端列表、详情、文档、分段、检索测试页面改造。
6. 后端测试与前端手测清单。

### 不在本期范围

- 文档解析、向量化、pgvector 检索的实现（当前为预留/简化实现）。
- 对话日志/统计联动。
- 运行时检索调用鉴权（NG8）。

---

## Global Constraints

- 权限码：`knowledge:view/create/update/delete`。
- 上传文档＝`knowledge:create` 功能权限 **且** 对知识库有 `manage` 数据权限。
- 知识库编辑/配置/重试/编辑分段＝`knowledge:update` + manage；删除知识库/文档/分段＝`knowledge:delete` + manage；检索测试＝`knowledge:view` + view。
- 文档、分段、文档分段列表完全继承父知识库的查看/管理判定，不单独配置数据范围。
- 创建只校验功能权限，写入 `owner_id = ctx.user.id`、`created_by = ctx.user.username`。
- 列表 `total` 必须是过滤后的数量；每行返回 `owner_id`、`owner_name`、`can_manage`、`is_shared`。
- 无权限统一 `BizException(403, "资源不存在或无权限访问")`。
- 响应保持 HTTP 200 + body `code`。
- 前端 `strict` + `noUnusedLocals` + `noUnusedParameters`；lint/build 必须通过；暂无前端测试运行器，使用手测清单。
- 每个任务提交一次，提交信息使用中文摘要。

---

## Review Focus

1. **文档/分段继承**：用户能看知识库但不能管理时，上传、删除、重试、编辑分段、删除分段全部 403；不能通过子资源接口绕过。
2. **上传的双重条件**：仅有 `knowledge:create` 但对目标知识库无 manage 时，上传必须被拒绝。
3. **列表 total**：知识库列表过滤后分页总数正确；文档/分段列表只在父知识库可见时返回。
4. **共享即时性**：共享只读/可管理、取消共享在下一次请求立即生效，包括文档与分段接口。
5. **检索测试**：只要求 `knowledge:view` + view；不能因为测试接口是 POST 就被误判为写操作。

---

## File Structure

**修改**

| 文件 | 变更 |
|---|---|
| `src/modules/knowledge/schema.py` | `KnowledgeBaseRead` 增加归属/权限标记 |
| `src/modules/knowledge/repository.py` | `KnowledgeBaseRepository.search_page` 接受 `where` |
| `src/modules/knowledge/service.py` | 注入 `PermissionContext`；所有 KB/文档/分段方法先做父资源判定 |
| `src/modules/knowledge/api.py` | 权限声明、`ctx` 注入、ACL/转移路由 |
| `src/core/rbac.py` | 从 pending 列表移除 `/api/v1/knowledge-bases` |
| `app/src/services/api/knowledge.ts` | `KnowledgeBaseRead` 新字段 |
| `app/src/pages/knowledge/List.tsx` | 归属列、按钮门禁、空状态 |
| `app/src/pages/knowledge/Detail.tsx` | 归属/共享、配置/删除门禁、共享/转移 |
| `app/src/pages/knowledge/Documents.tsx` | 上传/删除/重试门禁 |
| `app/src/pages/knowledge/Segments.tsx` | 编辑/删除门禁 |
| `app/src/pages/knowledge/Test.tsx` | 只读检索测试 |
| `app/src/pages/knowledge/Create.tsx` | 创建按钮门禁 |

**新增测试**

| 文件 | 职责 |
|---|---|
| `test/test_knowledge_data_auth.py` | 创建归属、列表过滤、详情/写操作 403 |
| `test/test_knowledge_child_auth.py` | 文档/分段继承判定 |
| `test/test_knowledge_permissions.py` | 功能权限 401/403 与 ACL 接口 |

---

### Task 1: `KnowledgeBaseRead` 归属与权限标记

**Files:**
- Modify: `src/modules/knowledge/schema.py`, `src/modules/knowledge/service.py`
- Test: `test/test_knowledge_data_auth.py`

**Interfaces:**
- Consumes: `KnowledgeBase.owner`、`KnowledgeBase.owner_id`。
- Produces:

```python
class KnowledgeBaseRead(BaseModel):
    # 原有字段不变
    owner_id: int
    owner_name: str | None
    can_manage: bool = False
    is_shared: bool = False
```

- [ ] **Step 1: 写失败测试**

```python
from src.modules.knowledge.model import KnowledgeBase
from src.modules.knowledge.service import KnowledgeService
from src.modules.user.model import User

async def test_kb_read_owner_fields(db_session):
    owner = User(username="owner", email="o@example.com", hashed_password="x")
    db_session.add(owner); await db_session.flush()
    kb = KnowledgeBase(name="kb", owner_id=owner.id)
    db_session.add(kb); await db_session.flush()
    read = KnowledgeService(db_session)._to_read(kb)
    assert read.owner_id == owner.id
    assert read.owner_name == "owner"
    assert read.can_manage is False
    assert read.is_shared is False
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_knowledge_data_auth.py -v`
Expected: FAIL。

- [ ] **Step 3: 扩展 Schema 与转换**

`KnowledgeService` 增加：

```python
def _to_read(self, kb: KnowledgeBase, *, can_manage: bool = False, is_shared: bool = False) -> KnowledgeBaseRead:
    data = KnowledgeBaseRead.model_validate(kb)
    data.owner_id = kb.owner_id
    data.owner_name = kb.owner.username if kb.owner else None
    data.can_manage = can_manage
    data.is_shared = is_shared
    return data
```

所有 `KnowledgeBaseRead.model_validate(kb)` 替换为 `self._to_read(kb, ...)`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest test/test_knowledge_data_auth.py -v`
Expected: 1 passed。

- [ ] **Step 5: 提交**

```bash
git add src/modules/knowledge/schema.py src/modules/knowledge/service.py test/test_knowledge_data_auth.py
git commit -m "feat: 知识库响应增加归属人与权限标记"
```

---

### Task 2: 知识库 CRUD 接入数据权限

**Files:**
- Modify: `src/modules/knowledge/repository.py`, `src/modules/knowledge/service.py`
- Test: `test/test_knowledge_data_auth.py`（追加）

**Interfaces:**
- Consumes: `PermissionContext`、`visible_condition`、`assert_can_view_resource`、`assert_can_manage_resource`、`acl_levels_map`、`is_shared_map`、`can_manage`、`delete_acl_for_resource`、`BaseRepository.get_page_where`。
- Produces:

```python
class KnowledgeService:
    async def create_kb(self, data: KnowledgeBaseCreate, ctx: PermissionContext) -> KnowledgeBaseRead
    async def list_kbs(self, params: PageParams, ctx: PermissionContext) -> PageResult[KnowledgeBaseRead]
    async def get_kb(self, kb_id: int, ctx: PermissionContext) -> KnowledgeBaseRead
    async def update_kb(self, kb_id: int, data: KnowledgeBaseUpdate, ctx: PermissionContext) -> KnowledgeBaseRead
    async def update_kb_config(self, kb_id: int, data: KnowledgeBaseConfigUpdate, ctx: PermissionContext) -> KnowledgeBaseRead
    async def delete_kb(self, kb_id: int, ctx: PermissionContext) -> None
```

- [ ] **Step 1: 追加失败测试**

```python
from src.core.rbac import PermissionContext
from src.core.data_scope import DataScope, ScopeLevel
from src.core.exceptions import BizException
from src.modules.knowledge.schema import KnowledgeBaseCreate, KnowledgeBaseUpdate
from src.modules.knowledge.service import KnowledgeService
from src.core.deps import PageParams
import pytest

def ctx_for(user, view="SELF", manage="SELF"):
    return PermissionContext(
        user=user, permissions=frozenset(), role_ids=frozenset(),
        data_scopes={"knowledge": DataScope(view=ScopeLevel(view), manage=ScopeLevel(manage))},
    )

async def test_create_kb_writes_owner(db_session):
    user = User(username="dev", email="dev@example.com", hashed_password="x")
    db_session.add(user); await db_session.flush()
    read = await KnowledgeService(db_session).create_kb(KnowledgeBaseCreate(name="kb"), ctx_for(user))
    assert read.owner_id == user.id and read.created_by == "dev"

async def test_list_kbs_filters(db_session):
    a = User(username="a", email="a@example.com", hashed_password="x")
    b = User(username="b", email="b@example.com", hashed_password="x")
    db_session.add_all([a, b]); await db_session.flush()
    db_session.add_all([
        KnowledgeBase(name="a-kb", owner_id=a.id),
        KnowledgeBase(name="b-kb", owner_id=b.id),
    ])
    await db_session.flush()
    page = await KnowledgeService(db_session).list_kbs(PageParams(), ctx_for(a))
    assert page.total == 1 and page.items[0].name == "a-kb"

async def test_update_other_kb_403(db_session):
    a = User(username="a", email="a@example.com", hashed_password="x")
    b = User(username="b", email="b@example.com", hashed_password="x")
    db_session.add_all([a, b]); await db_session.flush()
    kb = KnowledgeBase(name="b-kb", owner_id=b.id)
    db_session.add(kb); await db_session.flush()
    with pytest.raises(BizException):
        await KnowledgeService(db_session).update_kb(kb.id, KnowledgeBaseUpdate(name="x"), ctx_for(a, view="ALL", manage="SELF"))
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_knowledge_data_auth.py -v`
Expected: FAIL，签名不接受 `ctx`。

- [ ] **Step 3: 实现 KB 层过滤与判定**

- `KnowledgeBaseRepository.search_page` 增加 `where`，调用 `get_page_where`。
- `create_kb`：写入 owner/created_by；`can_manage=True`。
- `list_kbs`：`where=visible_condition(KnowledgeBase, "knowledge", ctx)`；当前页分别调用 `acl_levels_map` 与 `is_shared_map`；逐行标记。
- `get_kb`：加载后 `assert_can_view_resource`；计算标记。
- `update_kb/update_kb_config`：加载后 `assert_can_manage_resource`。
- `delete_kb`：加载后 `assert_can_manage_resource`，删除知识库后调用 `delete_acl_for_resource(self.db, "knowledge", kb_id)`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest test/test_knowledge_data_auth.py -v`
Expected: 4 passed。

- [ ] **Step 5: 提交**

```bash
git add src/modules/knowledge test/test_knowledge_data_auth.py
git commit -m "feat: 知识库 CRUD 接入数据范围过滤与管理权判定"
```

---

### Task 3: 文档、分段与检索测试继承知识库判定

**Files:**
- Modify: `src/modules/knowledge/service.py`
- Test: `test/test_knowledge_child_auth.py`

**Interfaces:**
- Consumes: Task 2 的 `_load_visible` / `_load_manageable` 辅助方法。
- Produces:

```python
class KnowledgeService:
    async def upload_document(self, kb_id, file_name, file_type, file_bytes, ctx, background_tasks=None) -> DocumentRead
    async def list_documents(self, kb_id, params, ctx) -> PageResult[DocumentRead]
    async def delete_document(self, kb_id, doc_id, ctx) -> None
    async def retry_document(self, kb_id, doc_id, ctx, background_tasks) -> DocumentRead
    async def list_document_segments(self, kb_id, doc_id, params, ctx) -> PageResult[SegmentRead]
    async def list_segments(self, kb_id, params, ctx, document_id=None) -> PageResult[SegmentRead]
    async def update_segment(self, kb_id, seg_id, data, ctx) -> SegmentRead
    async def delete_segment(self, kb_id, seg_id, ctx) -> None
    async def retrieval_test(self, kb_id, data, ctx) -> list[RetrievalTestResult]
```

- [ ] **Step 1: 写失败测试**

`test/test_knowledge_child_auth.py`：

```python
import pytest
from src.core.rbac import PermissionContext
from src.core.data_scope import DataScope, ScopeLevel
from src.core.exceptions import BizException
from src.core.deps import PageParams
from src.modules.knowledge.model import KnowledgeBase, Document
from src.modules.knowledge.service import KnowledgeService
from src.modules.user.model import User

def ctx_for(user, view="ALL", manage="SELF"):
    return PermissionContext(
        user=user, permissions=frozenset(), role_ids=frozenset(),
        data_scopes={"knowledge": DataScope(view=ScopeLevel(view), manage=ScopeLevel(manage))},
    )

async def setup(db_session):
    a = User(username="a", email="a@example.com", hashed_password="x")
    b = User(username="b", email="b@example.com", hashed_password="x")
    db_session.add_all([a, b]); await db_session.flush()
    kb = KnowledgeBase(name="b-kb", owner_id=b.id)
    db_session.add(kb); await db_session.flush()
    doc = Document(knowledge_base_id=kb.id, file_name="x.pdf", file_type="pdf", status="completed")
    db_session.add(doc); await db_session.flush()
    return a, b, kb, doc

async def test_document_list_requires_kb_view(db_session):
    a, b, kb, doc = await setup(db_session)
    page = await KnowledgeService(db_session).list_documents(kb.id, PageParams(), ctx_for(a, view="ALL"))
    assert page.total == 1

async def test_document_list_hidden_when_kb_not_visible(db_session):
    a, b, kb, doc = await setup(db_session)
    with pytest.raises(BizException):
        await KnowledgeService(db_session).list_documents(kb.id, PageParams(), ctx_for(a, view="SELF"))

async def test_upload_requires_manage(db_session):
    a, b, kb, doc = await setup(db_session)
    with pytest.raises(BizException):
        await KnowledgeService(db_session).upload_document(
            kb.id, "n.txt", "text/plain", b"hi", ctx_for(a, view="ALL", manage="SELF"),
        )

async def test_delete_segment_requires_manage(db_session):
    a, b, kb, doc = await setup(db_session)
    with pytest.raises(BizException):
        await KnowledgeService(db_session).delete_segment(kb.id, 999, ctx_for(a, view="ALL", manage="SELF"))
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_knowledge_child_auth.py -v`
Expected: FAIL，签名不接受 `ctx`。

- [ ] **Step 3: 改造子资源方法**

统一模式：

```python
async def _load_visible(self, kb_id: int, ctx: PermissionContext) -> KnowledgeBase:
    kb = await self.kb_repo.get_by_id(kb_id)
    await assert_can_view_resource(self.db, "knowledge", kb, ctx)
    return kb

async def _load_manageable(self, kb_id: int, ctx: PermissionContext) -> KnowledgeBase:
    kb = await self.kb_repo.get_by_id(kb_id)
    await assert_can_manage_resource(self.db, "knowledge", kb, ctx)
    return kb
```

- `list_documents`、`list_document_segments`、`list_segments`、`retrieval_test`：先 `_load_visible`。
- `upload_document`：先 `_load_manageable`；`uploaded_by = ctx.user.username`（替换原 `current_user` 参数）。
- `delete_document`、`retry_document`、`update_segment`、`delete_segment`：先 `_load_manageable`。
- 文档/分段不存在仍返回原有业务码；父知识库无权限统一 403。
- 删除/重试前仍校验 `doc.knowledge_base_id == kb_id`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest test/test_knowledge_child_auth.py -v`
Expected: 4 passed。

- [ ] **Step 5: 提交**

```bash
git add src/modules/knowledge/service.py test/test_knowledge_child_auth.py
git commit -m "feat: 知识库文档与分段操作继承父资源数据权限"
```

---

### Task 4: 知识库接口权限声明与 ACL/转移路由

**Files:**
- Modify: `src/modules/knowledge/api.py`, `src/core/rbac.py`
- Test: `test/test_knowledge_permissions.py`

**Interfaces:**
- Consumes: `require_permission`、`get_permission_context`、`make_acl_router`。
- Produces: 全部知识库路由声明权限；ACL/转移路由挂载。

- [ ] **Step 1: 写失败测试**

> HTTP 测试使用 `httpx.AsyncClient` + `ASGITransport`（夹具见 `RBAC权限内核-plan.md` Task 1），不要使用同步 `TestClient`。

```python
from src.utils.jwt_utils import encode_jwt
from src.modules.user.model import User
from src.modules.role.model import Role
from src.modules.permission.model import Permission
from src.modules.knowledge.model import KnowledgeBase

async def test_kb_create_without_permission_403(db_session, api_client):
    user = User(username="viewer", email="v@example.com", hashed_password="x")
    db_session.add(user); await db_session.flush()
    headers = {"Authorization": f"Bearer {encode_jwt({'sub': str(user.id)})}"}
    res = await api_client.post("/api/v1/knowledge-bases", json={"name": "kb"}, headers=headers)
    assert res.json()["code"] == 403
    assert "knowledge:create" in res.json()["message"]

async def test_owner_can_share_kb(db_session, api_client):
    role = Role(
        code="kb-owner", name="知识库所有者", is_system=False,
        permissions=[
            Permission(code="knowledge:view", name="查看知识库"),
            Permission(code="knowledge:update", name="编辑知识库"),
        ],
    )
    owner = User(username="owner", email="o@example.com", hashed_password="x", roles=[role])
    target = User(username="target", email="t@example.com", hashed_password="x")
    db_session.add_all([role, owner, target]); await db_session.flush()
    kb = KnowledgeBase(name="kb", owner_id=owner.id)
    db_session.add(kb); await db_session.flush()

    headers = {"Authorization": f"Bearer {encode_jwt({'sub': str(owner.id)})}"}
    res = await api_client.post(
        f"/api/v1/knowledge-bases/{kb.id}/acl",
        json={"subject_type": "user", "subject_id": target.id, "access_level": "manage"},
        headers=headers,
    )
    assert res.json()["code"] == 200
```

> 测试通过真实 JWT 走完整鉴权链路，不要覆盖 `get_current_user` 绕过。

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_knowledge_permissions.py -v`
Expected: FAIL。

- [ ] **Step 3: 加权限声明与 `ctx`**

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | `/knowledge-bases` | `knowledge:create` |
| GET | `/knowledge-bases` | `knowledge:view` |
| GET | `/knowledge-bases/{id}` | `knowledge:view` |
| PUT | `/knowledge-bases/{id}` | `knowledge:update` |
| PUT | `/knowledge-bases/{id}/config` | `knowledge:update` |
| DELETE | `/knowledge-bases/{id}` | `knowledge:delete` |
| POST | `/knowledge-bases/{id}/documents` | `knowledge:create` |
| GET | `/knowledge-bases/{id}/documents` | `knowledge:view` |
| DELETE | `/knowledge-bases/{id}/documents/{doc_id}` | `knowledge:delete` |
| POST | `/knowledge-bases/{id}/documents/{doc_id}/retry` | `knowledge:update` |
| GET | `/knowledge-bases/{id}/documents/{doc_id}/segments` | `knowledge:view` |
| GET | `/knowledge-bases/{id}/segments` | `knowledge:view` |
| PUT | `/knowledge-bases/{id}/segments/{seg_id}` | `knowledge:update` |
| DELETE | `/knowledge-bases/{id}/segments/{seg_id}` | `knowledge:delete` |
| POST | `/knowledge-bases/{id}/retrieval-test` | `knowledge:view` |

上传接口的 service 调用改为 `ctx=ctx`，不再传 `current_user`。

- [ ] **Step 4: 挂载 ACL/转移路由**

```python
router.include_router(make_acl_router(
    resource_type="knowledge",
    view_permission="knowledge:view",
    update_permission="knowledge:update",
    load_resource=lambda db, rid: KnowledgeBaseRepository(db).get_by_id(rid),
))
```

- [ ] **Step 5: 移除 pending 前缀**

从 `RBAC_PENDING_PREFIXES` 移除 `/api/v1/knowledge-bases`。

- [ ] **Step 6: 运行测试确认通过**

Run: `pytest test/test_knowledge_permissions.py -v`
Expected: 2 passed。

- [ ] **Step 7: 提交**

```bash
git add src/modules/knowledge/api.py src/core/rbac.py test/test_knowledge_permissions.py
git commit -m "feat: 知识库接口接入功能权限与共享转移路由"
```

---

### Task 5: 前端知识库服务类型

**Files:**
- Modify: `app/src/services/api/knowledge.ts`, `app/src/services/knowledge.ts`
- Test: `npm run lint`

- [ ] **Step 1: 扩展 `KnowledgeBaseRead`**

```ts
export interface KnowledgeBaseRead {
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
git add app/src/services/api/knowledge.ts app/src/services/knowledge.ts
git commit -m "feat: 前端知识库类型增加归属与权限标记"
```

---

### Task 6: 知识库列表页

**Files:**
- Modify: `app/src/pages/knowledge/List.tsx`
- Test: `npm run lint` + 手测

- [ ] **Step 1: 归属列与按钮门禁**

- 增加“归属人”列，使用 `<OwnerBadge>`。
- 顶部“新建知识库”包 `<Can code="knowledge:create">`。
- 编辑/配置：`kb.can_manage && <Can code="knowledge:update">`。
- 删除：`kb.can_manage && <Can code="knowledge:delete">`。
- 进入详情始终可用（路由 `knowledge:view`）。

- [ ] **Step 2: 空状态**

- 无数据且无关键词：“当前数据范围内暂无数据。资源可能存在，只是不在你的查看范围内。”
- 有关键词：“没有匹配的知识库”。

- [ ] **Step 3: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 4: 手测**

1. 运营（knowledge manage ALL）：6 个知识库全部可编辑，无删除按钮。
2. 开发者（manage SELF）：本人知识库可编辑；共享只读的只可查看。
3. 只读：无新建/编辑/删除。
4. 范围 SELF 且无数据：显示范围空状态。

- [ ] **Step 5: 提交**

```bash
git add app/src/pages/knowledge/List.tsx
git commit -m "feat: 知识库列表增加归属列与行级权限门禁"
```

---

### Task 7: 知识库详情、文档、分段与检索页

**Files:**
- Modify: `app/src/pages/knowledge/Detail.tsx`, `Documents.tsx`, `Segments.tsx`, `Test.tsx`, `Create.tsx`
- Test: `npm run lint` + 手测

- [ ] **Step 1: 详情页**

- 顶部显示 `<OwnerBadge ... isShared={kb.is_shared} />`。
- “编辑配置”：`kb.can_manage && <Can code="knowledge:update">`。
- “删除”：`kb.can_manage && <Can code="knowledge:delete">`。
- “共享”：`kb.can_manage && <Can code="knowledge:update">`，打开 `ShareDrawer`。
- “转移归属”：`kb.can_manage && <Can code="knowledge:update">`，打开 `TransferOwnerDialog`。
- 共享/转移成功后重新加载知识库与文档列表。

- [ ] **Step 2: 文档页**

页面加载时同时获取知识库详情（拿 `can_manage`）。

- 上传：`kb.can_manage && <Can code="knowledge:create">`。
- 删除文档：`kb.can_manage && <Can code="knowledge:delete">`。
- 重试失败文档：`kb.can_manage && <Can code="knowledge:update">`。
- 查看分段：始终可用（继承 view）。
- 无管理权时隐藏上传区与行内写操作。

- [ ] **Step 3: 分段页**

- 编辑分段：`kb.can_manage && <Can code="knowledge:update">`。
- 删除分段：`kb.can_manage && <Can code="knowledge:delete">`。
- 只读时保留筛选与查看。

- [ ] **Step 4: 检索测试页**

- 路由守卫 `knowledge:view`。
- 检索按钮只要求 view，不额外要求 update。
- 后端返回 403 时展示“无权访问该资源”。

- [ ] **Step 5: 创建页**

- 创建按钮包 `<Can code="knowledge:create">`；路由已守卫。
- 创建成功后跳转详情；后端写入 owner，不在表单中暴露 owner 字段。

- [ ] **Step 6: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 7: 手测**

1. 只读共享的知识库：详情可看，配置/删除/共享/转移全部不渲染；文档页无上传/删除/重试。
2. 可管理共享：文档上传/删除/重试可用；共享入口仍要求 `knowledge:update`。
3. 运营：可编辑全部知识库，无删除。
4. 检索测试对只读用户可用。

- [ ] **Step 8: 提交**

```bash
git add app/src/pages/knowledge
git commit -m "feat: 知识库详情文档分段页面接入共享与权限门禁"
```

---

### Task 8: 知识库模块验收

- [ ] **Step 1: 后端测试**

Run:

```bash
pytest test/test_knowledge_data_auth.py test/test_knowledge_child_auth.py test/test_knowledge_permissions.py -v
```

Expected: 全部通过。

- [ ] **Step 2: 前端构建**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 3: 手测清单**

| 场景 | 预期 |
|---|---|
| AC-22 运营 manage ALL | 可编辑任意知识库 |
| AC-26 共享只读 | 对方可见，不能编辑/上传/删除 |
| AC-27 共享可管理 | 对方可编辑、上传文档 |
| AC-28 取消共享 | 文档与分段接口下一次请求 403 |
| AC-34 文档/分段继承 | 无 manage 时上传/删除/编辑/重试均 403 |
| AC-37 详情字段 | 含 owner_id/owner_name/can_manage/is_shared |
| 检索测试 | 仅需 `knowledge:view` |

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "test: 知识库模块数据授权与派生资源继承验收"
```

---

## 依赖与顺序

1. 依赖 `RBAC权限内核-plan.md`、`数据级授权内核-plan.md`、`前端权限控制-plan.md`。
2. 与 Agent/Prompt/工具模块可并行，但共同修改 `RBAC_PENDING_PREFIXES`，合并时保留所有移除结果。
3. 文档上传功能依赖 MinIO；本地开发使用现有 `mock_minio`，权限判定不依赖存储。

## 风险与决策

| 项 | 决策 |
|---|---|
| 文档/分段是否单独授权 | 不单独；完全继承知识库，符合 §6.6 |
| 上传权限 | `knowledge:create` + 父知识库 manage，二者缺一不可 |
| 检索测试的权限 | 归入 `knowledge:view`，因为不产生数据变更 |
| 文档不存在与无权限 | 父知识库无权限统一 403；父知识库可见但文档不存在用原有业务码 |
| 上传者字段 | 由 `ctx.user.username` 写入 `uploaded_by`，不使用用户 ID |
| 历史文档 | `owner_id` 回填到 admin（数据授权内核 Task 1） |
