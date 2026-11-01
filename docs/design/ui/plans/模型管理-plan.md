# 模型管理 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把模型与供应商接口接入功能权限，并在前端按权限隐藏写操作；模型/供应商是平台级共享资产，不做数据级隔离。

**Architecture:** 后端在 `model` 与 `provider` 两个模块的路由上声明 `model:view/create/update/delete`，供应商“测试连接”归入 `model:update`；不新增 `owner_id`、归属列、共享或转移。前端模型列表/供应商页面只按功能权限控制按钮，并明确展示“平台级资源，仅受功能权限控制”。

**Tech Stack:** FastAPI / SQLAlchemy 2.0 async / pytest；React 19 / TypeScript 5.9 / Vite 7 / shadcn-ui。

**Spec:** `docs/spec/PROJECT_SPEC_V2.md`（§4.2 平台资源、§5.1 特殊操作归属、NG10、§9.3 模型与供应商接口映射）、`docs/design/ui/RBAC原型设计说明书.md`（§5.9）。

**前置计划:** `RBAC权限内核-plan.md`、`前端权限控制-plan.md`。

---

## 模块说明（产品视角）

### 目标

| 编号 | 目标 | 本计划落点 |
|---|---|---|
| G1 | 模型/供应商接口要求登录 + 功能权限 | 路由声明 |
| G2 | 权限码统一 `model:动作` | 4 条权限码 |
| NG10 | 平台资源不做行级隔离 | 不新增 owner/ACL |
| FR-09 | 无权限按钮不渲染 | 前端 `Can` |

### 交付物

1. 模型与供应商全部路由的权限声明。
2. 供应商测试连接归入 `model:update`。
3. 后端 401/403 测试。
4. 前端模型列表、供应商、创建、测试页面的按钮门禁。
5. 前端手测清单。

### 不在本期范围

- 模型/供应商的数据归属、共享、转移（平台级资源，NG10）。
- 真实模型调用与连接测试实现（沿用现有实现/模拟）。
- 模型价格、能力标签的业务校验。

---

## Global Constraints

- 权限码固定 4 条：`model:view`、`model:create`、`model:update`、`model:delete`。
- 供应商测试连接 → `model:update`；模型/供应商均不区分行级权限。
- 不新增 `owner_id`、`can_manage`、`is_shared`、ACL、转移。
- 列表/详情不按数据范围过滤；所有具备 `model:view` 的用户看到同一份平台资产。
- 响应保持 HTTP 200 + body `code`；无权限统一 403。
- 前端 `strict` + `noUnusedLocals` + `noUnusedParameters`；lint/build 必须通过；暂无前端测试运行器，使用手测清单。
- 每个任务提交一次，提交信息使用中文摘要。

---

## Review Focus

1. **供应商测试连接**：POST `/providers/{id}/test` 必须要求 `model:update`，不能因为路径像“测试”就放行只读用户。
2. **平台级属性**：模型/供应商页面不应出现归属列、共享入口或“仅本人”范围提示，避免误导用户以为可共享。
3. **前端按钮与接口一致**：隐藏按钮的同时，接口仍必须拒绝无权限请求，不能只靠前端。
4. **移除 pending 前缀**：模型与供应商接入后，覆盖率测试不能再依赖豁免。
5. **删除供应商的级联**：删除供应商会级联删除模型；只有 `model:delete` 可执行，前端需二次确认。

---

## File Structure

**修改**

| 文件 | 变更 |
|---|---|
| `src/modules/model/api.py` | 4 个 CRUD 路由声明 `model:*` |
| `src/modules/provider/api.py` | 5 个路由声明 `model:*`；测试连接用 `model:update` |
| `src/core/rbac.py` | 从 pending 列表移除 `/api/v1/models`、`/api/v1/providers` |
| `app/src/pages/model/List.tsx` | 新建/编辑/删除按钮门禁；平台资源说明 |
| `app/src/pages/model/Providers.tsx` | 新建/编辑/删除/测试按钮门禁；平台资源说明 |
| `app/src/pages/model/Create.tsx` | 保存按钮门禁（路由已守卫） |
| `app/src/pages/model/Test.tsx` | 测试操作归入 `model:update` |

**新增测试**

| 文件 | 职责 |
|---|---|
| `test/test_model_permissions.py` | 模型/供应商 401/403 与测试连接权限 |

---

### Task 1: 模型与供应商后端权限声明

**Files:**
- Modify: `src/modules/model/api.py`, `src/modules/provider/api.py`, `src/core/rbac.py`
- Test: `test/test_model_permissions.py`

**Interfaces:**
- Consumes: `require_permission`。
- Produces: 全部模型/供应商路由声明权限。

- [ ] **Step 1: 写失败测试**

> HTTP 测试使用 `httpx.AsyncClient` + `ASGITransport`（夹具见 `RBAC权限内核-plan.md` Task 1），不要使用同步 `TestClient`。

`test/test_model_permissions.py`：

```python
from src.utils.jwt_utils import encode_jwt
from src.modules.user.model import User

async def test_model_create_without_permission_403(db_session, api_client):
    user = User(username="viewer", email="v@example.com", hashed_password="x")
    db_session.add(user); await db_session.flush()
    headers = {"Authorization": f"Bearer {encode_jwt({'sub': str(user.id)})}"}
    res = await api_client.post(
        "/api/v1/models",
        json={"name": "m", "model_id": "gpt-x", "provider_id": 1},
        headers=headers,
    )
    assert res.json()["code"] == 403
    assert "model:create" in res.json()["message"]

async def test_provider_test_requires_model_update(db_session, api_client):
    user = User(username="dev", email="d@example.com", hashed_password="x")
    db_session.add(user); await db_session.flush()
    headers = {"Authorization": f"Bearer {encode_jwt({'sub': str(user.id)})}"}
    res = await api_client.post("/api/v1/providers/1/test", headers=headers)
    assert res.json()["code"] == 403
    assert "model:update" in res.json()["message"]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_model_permissions.py -v`
Expected: FAIL，接口未声明权限或未登录也会进入业务逻辑。

- [ ] **Step 3: 给模型路由加声明**

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | `/models` | `model:create` |
| GET | `/models` | `model:view` |
| GET | `/models/{id}` | `model:view` |
| PUT | `/models/{id}` | `model:update` |
| DELETE | `/models/{id}` | `model:delete` |

- [ ] **Step 4: 给供应商路由加声明**

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | `/providers` | `model:create` |
| GET | `/providers` | `model:view` |
| GET | `/providers/{id}` | `model:view` |
| PUT | `/providers/{id}` | `model:update` |
| POST | `/providers/{id}/test` | `model:update` |
| DELETE | `/providers/{id}` | `model:delete` |

- [ ] **Step 5: 移除 pending 前缀**

`src/core/rbac.py` 中移除 `/api/v1/models`、`/api/v1/providers`。

- [ ] **Step 6: 运行测试确认通过**

Run: `pytest test/test_model_permissions.py -v`
Expected: 2 passed。

- [ ] **Step 7: 提交**

```bash
git add src/modules/model/api.py src/modules/provider/api.py src/core/rbac.py test/test_model_permissions.py
git commit -m "feat: 模型与供应商接口接入功能权限"
```

---

### Task 2: 前端模型列表与供应商页面

**Files:**
- Modify: `app/src/pages/model/List.tsx`, `app/src/pages/model/Providers.tsx`, `app/src/pages/model/Create.tsx`, `app/src/pages/model/Test.tsx`
- Test: `npm run lint` + 手测

- [ ] **Step 1: 模型列表**

- 顶部“添加模型”包 `<Can code="model:create">`。
- 行内编辑：`<Can code="model:update">`；删除：`<Can code="model:delete">`；测试：`<Can code="model:view">`（只读查看测试结果）。
- 不增加归属列。
- 页头说明：“模型与供应商是平台级共享资产，仅受功能权限控制。”

- [ ] **Step 2: 供应商页面**

- 顶部“添加供应商”包 `<Can code="model:create">`。
- 编辑：`<Can code="model:update">`；删除：`<Can code="model:delete">`。
- “测试连接”按钮：`<Can code="model:update">`。
- 不增加归属列、共享入口。
- 删除确认文案说明“删除供应商会同时删除其下模型”。

- [ ] **Step 3: 创建/测试页**

- `Create.tsx`：保存按钮包 `<Can code="model:create">`（编辑模式用 `model:update`）。
- `Test.tsx`：提交测试要求 `model:update`；无权限时不渲染提交按钮并提示“需要 model:update”。

- [ ] **Step 4: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 5: 手测**

1. 管理员：模型/供应商全部按钮可用。
2. 开发者：只有查看；新建/编辑/删除/测试连接全部不渲染（开发者只有 `model:view`）。
3. 页面无归属列、无共享入口。
4. 删除供应商二次确认包含级联说明。

- [ ] **Step 6: 提交**

```bash
git add app/src/pages/model
git commit -m "feat: 模型与供应商页面按功能权限控制操作"
```

---

### Task 3: 模型模块验收

- [ ] **Step 1: 后端测试**

Run: `pytest test/test_model_permissions.py test/test_rbac_coverage.py -v`
Expected: 全部通过；pending 前缀只剩业务模块中尚未接入的部分（此时应为空或仅剩未完成模块）。

- [ ] **Step 2: 前端构建**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 3: 手测清单**

| 场景 | 预期 |
|---|---|
| 开发者访问模型页 | 仅查看，无写按钮 |
| 管理员删除供应商 | 二次确认含级联说明，成功 |
| 供应商测试连接无 `model:update` | 403，按钮不渲染 |
| 页面说明 | 明确“平台级共享资产，仅受功能权限控制” |
| 数据隔离 | 无归属列、无共享、无转移 |

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "test: 模型管理功能权限与平台资源边界验收"
```

---

## 依赖与顺序

1. 依赖 `RBAC权限内核-plan.md` 的声明式权限与 `/users/me`。
2. 依赖 `前端权限控制-plan.md` 的 `Can` 与权限上下文。
3. 与四个业务资源模块可并行；共同修改 `RBAC_PENDING_PREFIXES`，合并时保留所有移除结果。
4. 本计划完成后，`RBAC_PENDING_PREFIXES` 应只剩尚未完成的业务前缀；全部完成后为空。

## 风险与决策

| 项 | 决策 |
|---|---|
| 模型/供应商是否共享 | 不共享；平台级资产由功能权限控制（NG10） |
| 供应商测试连接权限 | `model:update`，因为它会发起外部请求并可能修改连接状态 |
| 删除供应商 | 级联删除模型；前端二次确认，后端沿用现有 `ondelete=CASCADE` |
| 开发者默认权限 | 仅 `model:view`；写操作全部不渲染 |
| 测试页 | 查看测试结果不单独设权限，随 `model:view`；提交测试需 `model:update` |
