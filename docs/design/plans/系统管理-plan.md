# 系统管理 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 `/system/users`、`/system/roles`、`/system/permissions` 三个页面的 RBAC 改造：角色双 Tab 配置（功能权限矩阵 + 数据范围）、权限目录只读化、用户多角色与自操作保护。

**Architecture:** 后端复用 `RBAC权限内核` 与 `数据级授权内核` 的接口，仅补充用户列表的角色/资源计数与归属资源明细。前端把角色配置拆成 `PermissionMatrix`、`DataScopeEditor`、`SubjectPicker` 三个组件，两个 Tab 共用一次保存；权限页移除全部写入口；用户页增加多角色标签、拥有资源数、自我操作保护与禁用/启用。

**Tech Stack:** FastAPI / SQLAlchemy async / React 19 / TypeScript 5.9 / Vite 7 / shadcn-ui。

**Spec:** `docs/spec/PROJECT_SPEC_V2.md`（§5.3 权限矩阵、§5.4 保护规则、§8.1~8.3、§9.1~9.2）、`docs/design/ui/RBAC原型设计说明书.md`（§5.12~5.14、§7.9）。

**前置计划:** `RBAC权限内核-plan.md`、`数据级授权内核-plan.md`、`前端权限控制-plan.md`。

---

## 模块说明（产品视角）

### 目标

| 编号 | 目标 | 本计划落点 |
|---|---|---|
| G3 | 内置角色不可删除、编码不可改 | 角色列表“内置”标签与禁用删除 |
| G6 | 角色权限以「模块 × 动作」矩阵呈现 | `PermissionMatrix` |
| G10 | 角色可配置四类资源的数据范围 | `DataScopeEditor` |
| R4/R5 | 不能删除/禁用自己，至少保留一个启用超级管理员 | 用户页与后端保护 |
| FR-06 | 权限目录只读 | `Permissions.tsx` 移除写入口 |
| FR-07 | 用户多角色、不能改自己的角色 | 用户页角色标签与编辑禁用 |

### 交付物

1. 用户列表/详情的 `roles`、`is_superuser`、`owned_resource_count` 与归属资源明细接口。
2. 角色页双 Tab 配置弹窗。
3. 权限页只读化与模块/动作/状态列。
4. 用户页多角色、拥有资源数、禁用/启用、编辑、删除阻断。
5. Mock 数据与服务同步适配。
6. 页面验收清单。

### 不在本期范围

- 角色权限与数据范围的后端内核 → 前两个后端计划。
- 业务资源页面的归属列与共享入口 → 各业务模块计划。
- API Key、审计、告警、系统配置页面 → `预留系统模块-plan.md`。

---

## Global Constraints

- 角色配置保存使用两个接口：`PUT /roles/{id}/permissions` 与 `PUT /roles/{id}/data-scopes`；两者都成功后提示“配置已更新，对该角色下用户立即生效”。
- 内置角色 `is_system=true`：删除按钮禁用并显示原因；`code` 只读；`name` / `description` 可改。
- 当前登录账号行：不能删除、禁用自己，不能修改自己的角色；编辑弹窗内角色选择整体禁用。
- 至少保留一个 `is_superuser=true` 且启用的账号；最后一个超级管理员不可删除、禁用或移除管理员角色。
- 权限目录只读：不渲染创建/编辑/删除入口；预留权限显示“未上线”标签。
- 用户删除前若拥有业务资源，弹窗进入“暂时不能删除”状态并展示 Agent / Prompt / 知识库 / 工具数量。
- 前端 `strict` + `noUnusedLocals` + `noUnusedParameters`；`npm run lint` 与 `npm run build` 必须通过。
- 项目暂无前端测试运行器；验证门禁为 lint/build + 手测清单。
- 每个任务提交一次，提交信息使用中文摘要。

---

## Review Focus

1. **内置角色删除**：按钮禁用必须同时给出 `title` 或可见说明，不能只显示一个无法点击的图标。
2. **最后一个超级管理员**：删除、禁用、移除管理员角色三条路径都要阻断，并在弹窗内说明原因。
3. **双 Tab 保存一致性**：功能权限保存成功、数据范围保存失败时，不能提示“已保存”；应明确哪一部分失败并保留弹窗。
4. **权限页只读**：页面不应残留创建/编辑/删除按钮或可调用的旧接口入口；预留权限必须可区分。
5. **拥有资源数的准确性**：用户列表的数量与删除阻断弹窗中的数量必须来自同一统计口径，避免“列表显示 0、删除被拒”。

---

## File Structure

**新增**

| 文件 | 职责 |
|---|---|
| `app/src/pages/system/components/PermissionMatrix.tsx` | 模块 × 动作权限矩阵 |
| `app/src/auth/permissionLabels.ts` | **复用**（由前端权限控制计划创建）：模块/动作中文标签与模块顺序 |
| `app/src/pages/system/components/DataScopeEditor.tsx` | 四类资源 × 查看/管理范围编辑 |
| `app/src/pages/system/components/SubjectPicker.tsx` | 用户/角色多选弹窗 |
| `app/src/pages/system/components/UserFormDialog.tsx` | 创建/编辑用户 |
| `app/src/pages/system/components/AssignRolesDialog.tsx` | 分配角色 |
| `app/src/pages/system/components/OwnedResourcesDialog.tsx` | 删除阻断时展示归属资源 |

**修改**

| 文件 | 变更 |
|---|---|
| `src/modules/user/schema.py` | `UserRead` 增加 `is_superuser`、`roles`、`owned_resource_count`；新增 `OwnedResourcesRead` |
| `src/modules/user/service.py` | `to_read_list` 填充角色与资源计数 |
| `src/modules/user/api.py` | 列表/详情返回新字段；新增 `GET /users/{id}/owned-resources` |
| `src/modules/role/schema.py` | `RoleRead` 已由 RBAC 内核扩展，本计划只消费 |
| `app/src/services/api/system.ts` | 用户/角色/权限类型与新方法 |
| `app/src/services/mock/system.ts`、`app/src/services/mock/data/system.ts` | Mock 数据同步 |
| `app/src/pages/system/Roles.tsx` | 双 Tab 配置弹窗、列表列与内置保护 |
| `app/src/pages/system/Permissions.tsx` | 只读化、模块/动作/状态列 |
| `app/src/pages/system/Users.tsx` | 多角色、资源数、禁用/启用、自操作保护 |

---

### Task 1: 用户列表/详情补充角色与资源计数

**Files:**
- Modify: `src/modules/user/schema.py`, `src/modules/user/service.py`, `src/modules/user/api.py`
- Test: `test/test_user_management_dto.py`

**Interfaces:**
- Consumes: `count_owned_resources_bulk`（数据级授权内核 Task 7）、`User.roles`、`RoleBrief`。
- Produces:
  - `UserRead`：新增 `is_superuser: bool = False`、`roles: list[RoleBrief] = []`、`owned_resource_count: int = 0`
  - `UserCreate`：新增 `role_ids: list[int] = []`
  - `OwnedResourcesRead`：`agent/prompt/knowledge/tool/total: int`
  - `UserService.to_read_list(users: list[User]) -> list[UserRead]`
  - `GET /api/v1/users/{user_id}/owned-resources`（`user:view`）

- [ ] **Step 1: 写失败测试**

`test/test_user_management_dto.py`：

```python
from src.modules.user.model import User
from src.modules.user.schema import UserCreate
from src.modules.role.model import Role
from src.modules.user.service import UserService
from src.modules.agent.model import Agent

async def test_user_read_includes_roles_and_resource_count(db_session):
    role = Role(code="developer", name="开发者", is_system=True)
    user = User(username="dev", email="dev@example.com", hashed_password="x", roles=[role])
    db_session.add_all([role, user]); await db_session.flush()
    db_session.add(Agent(name="a", type="conversation", owner_id=user.id))
    await db_session.flush()

    reads = await UserService(db_session).to_read_list([user])
    assert reads[0].roles[0].code == "developer"
    assert reads[0].owned_resource_count == 1

async def test_create_user_with_roles(db_session):
    role = Role(code="developer", name="开发者", is_system=True)
    db_session.add(role); await db_session.flush()
    user = await UserService(db_session).create_user(UserCreate(
        username="newdev", email="newdev@example.com", password="pass1234", role_ids=[role.id],
    ))
    assert [r.code for r in user.roles] == ["developer"]

async def test_owned_resources_breakdown(db_session):
    user = User(username="dev", email="dev@example.com", hashed_password="x")
    db_session.add(user); await db_session.flush()
    db_session.add(Agent(name="a", type="conversation", owner_id=user.id))
    await db_session.flush()
    data = await UserService(db_session).get_owned_resources(user.id)
    assert data.agent == 1 and data.total == 1
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest test/test_user_management_dto.py -v`
Expected: FAIL，字段/方法不存在。

- [ ] **Step 3: 实现 DTO 与服务**

`UserRead`：

```python
class UserRead(BaseModel):
    id: int
    username: str
    email: str
    is_active: bool
    is_superuser: bool = False
    roles: list[RoleBrief] = []
    owned_resource_count: int = 0
    model_config = {"from_attributes": True}
```

`RoleBrief` 复用 `src/modules/user/schema.py` 中 RBAC 内核定义（`id/code/name`），并加 `model_config = {"from_attributes": True}`。

`UserService.to_read_list`：

```python
async def to_read_list(self, users: list[User]) -> list[UserRead]:
    counts = await count_owned_resources_bulk(self.repo.db, [u.id for u in users])
    return [
        UserRead(
            id=u.id, username=u.username, email=u.email, is_active=u.is_active,
            is_superuser=u.is_superuser,
            roles=[RoleBrief.model_validate(r) for r in u.roles],
            owned_resource_count=counts.get(u.id, 0),
        )
        for u in users
    ]
```

`get_owned_resources(user_id)` 返回四类计数与合计；用户不存在 → 404。

`UserCreate` 增加 `role_ids: list[int] = []`；`create_user` 用 `RoleRepository.get_by_ids` 校验全部角色存在，赋值 `user.roles`，再创建用户。角色不存在 → `BizException(400, "有部分角色不存在")`。

- [ ] **Step 4: 接入接口**

- `GET /users/search`、`GET /users` 使用 `to_read_list`。
- `GET /users/{user_id}` 也返回新字段（`UserWithRolesRead` 可继承 `UserRead`）。
- 新增 `GET /users/{user_id}/owned-resources`，`@require_permission("user:view")`。
- 路由顺序：`/users/me`、`/users/search`、`/users/{user_id}/owned-resources` 必须在 `/users/{user_id}` 之前注册。

- [ ] **Step 5: 运行测试确认通过**

Run: `pytest test/test_user_management_dto.py -v`
Expected: 3 passed。

- [ ] **Step 6: 提交**

```bash
git add src/modules/user test/test_user_management_dto.py
git commit -m "feat: 用户列表补充多角色与归属资源计数"
```

---

### Task 2: 前端系统服务类型与方法

**Files:**
- Modify: `app/src/services/api/system.ts`, `app/src/services/system.ts`
- Test: `npm run lint`

**Interfaces:**
- Consumes: `dataAuthService`（共享对象搜索）。
- Produces:

```ts
import type { RoleBrief } from './permission'

export interface BackendUser {
  id: number; username: string; email: string; is_active: boolean
  is_superuser: boolean
  roles: RoleBrief[]
  owned_resource_count: number
}
export interface BackendRole {
  id: number; code: string; name: string; description: string | null
  is_system: boolean; user_count: number; permission_count: number
  permissions: BackendPermission[]
}
export interface BackendPermission {
  id: number; code: string; name: string; description: string | null
  module: string; action: string; status: 'implemented' | 'reserved'
}
export interface OwnedResources { agent: number; prompt: number; knowledge: number; tool: number; total: number }
export interface ScopeTarget { subject_type: 'user' | 'role'; subject_id: number }
export interface ScopeTargetRead extends ScopeTarget { subject_name: string }
export interface RoleDataScopeItem {
  resource_type: 'agent' | 'prompt' | 'knowledge' | 'tool'
  view_scope: 'ALL' | 'SELF' | 'CUSTOM'
  manage_scope: 'ALL' | 'SELF' | 'CUSTOM'
  view_targets: ScopeTargetRead[]
  manage_targets: ScopeTargetRead[]
}
```

方法：

| 方法 | 接口 |
|---|---|
| `createUser({ username, email, password, role_ids })` | `POST /users` |
| `updateUser(id, { email?, is_active? })` | `PUT /users/{id}` |
| `getOwnedResources(id)` | `GET /users/{id}/owned-resources` |
| `getRoleDataScopes(roleId)` | `GET /roles/{roleId}/data-scopes` |
| `updateRoleDataScopes(roleId, scopes)` | `PUT /roles/{roleId}/data-scopes` |

- [ ] **Step 1: 更新类型与方法**

在 `apiSystemService` 中追加上述方法；所有类型字段用 snake_case，与后端 Pydantic 一致。

- [ ] **Step 2: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add app/src/services/api/system.ts app/src/services/system.ts
git commit -m "feat: 前端系统管理服务补充用户与数据范围类型"
```

---

### Task 3: 角色页双 Tab 配置

**Files:**
- Create: `app/src/pages/system/components/PermissionMatrix.tsx`, `DataScopeEditor.tsx`, `SubjectPicker.tsx`
- 复用: `app/src/auth/permissionLabels.ts`（由 `前端权限控制-plan.md` Task 3 创建）
- Modify: `app/src/pages/system/Roles.tsx`
- Test: `npm run lint` + 手测

**Interfaces:**
- Consumes: `apiSystemService.getPermissions()`、`getRole()`、`assignRolePermissions()`、`getRoleDataScopes()`、`updateRoleDataScopes()`、`dataAuthService.searchSubjects()`。
- Produces:

```tsx
export interface PermissionMatrixProps {
  permissions: BackendPermission[]
  selectedIds: number[]
  onChange: (ids: number[]) => void
}
export function PermissionMatrix(props: PermissionMatrixProps): JSX.Element

export interface DataScopeEditorProps {
  scopes: RoleDataScopeItem[]
  onChange: (scopes: RoleDataScopeItem[]) => void
  onAddTarget: (resourceType: ResourceType, dimension: 'view' | 'manage') => void
}
export function DataScopeEditor(props: DataScopeEditorProps): JSX.Element

export interface SubjectPickerProps {
  open: boolean
  onClose: () => void
  onConfirm: (subjects: SubjectOption[]) => void
}
export function SubjectPicker(props: SubjectPickerProps): JSX.Element
```

- [ ] **Step 1: 实现 `PermissionMatrix`**

- 模块顺序固定：Agent、模型、Prompt、知识库、工具、对话日志、数据统计、用户、角色、权限、API 密钥、审计日志、告警规则、系统配置。
- 列固定：查看、创建、编辑、删除、发布。
- 从 `app/src/auth/permissionLabels.ts` 导入 `MODULE_LABELS`、`ACTION_LABELS`、`MODULE_ORDER`，与权限页共用，避免两套中文标签漂移。
- 从 `permissions` 按 `module` 分组、按 `action` 建索引。
- 单元格：存在对应权限 → 复选框；不存在 → `—`。
- 预留模块（`status === 'reserved'`）行加"待实现"标签，复选框仍可勾选（用于控制菜单/路由）。
- 顶部显示“已选 N 项”。

- [ ] **Step 2: 实现 `DataScopeEditor`**

- 4 行固定资源：Agent、Prompt、知识库、工具。
- 每行两个下拉：查看范围、管理范围，选项“全部数据 / 仅本人 / 指定用户/角色”。
- 选择 `CUSTOM` 时展示标签：主体名 + 类型 + 移除按钮；末尾“添加用户或角色”调用 `onAddTarget`。
- 任一行使用 `CUSTOM` 时展开标签区；说明文字“数据范围只影响哪些数据，不替代功能权限”。

- [ ] **Step 3: 实现 `SubjectPicker`**

- Tabs：用户 / 角色。
- 搜索输入 300ms 防抖调用 `dataAuthService.searchSubjects(type, keyword)`。
- 多选列表，确认后 `onConfirm(selected)`。
- 空状态“未找到匹配的用户或角色”。

- [ ] **Step 4: 改造 `Roles.tsx`**

- 列表列：角色名称、编码、描述、用户数、权限数、类型（内置/自定义）、操作。
- 内置角色：`Badge` 显示“内置”；删除按钮 `disabled` 且 `title="内置角色不可删除"`。
- 操作：编辑、配置、删除。配置打开弹窗。
- 配置弹窗：
  - 打开时并行加载 `getPermissions()`、`getRole(id)`、`getRoleDataScopes(id)`。
  - 两个 Tab：功能权限（`PermissionMatrix`）、数据范围（`DataScopeEditor`）。
  - 单个保存按钮：先 `assignRolePermissions(roleId, selectedIds)`，成功后 `updateRoleDataScopes(roleId, scopes)`；两步都成功才关闭并 Toast“配置已更新，对该角色下用户立即生效”。
  - 保存中禁用按钮；失败显示错误并保持弹窗。
  - 弹窗底部显示“已选 N 项 / 该角色下 M 名用户”。
- 删除确认文案包含“该角色下仍有用户时无法删除”。

- [ ] **Step 5: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 6: 手测**

1. 打开“开发者”配置：功能权限矩阵显示 18 项；数据范围显示 Agent/Prompt/知识库/工具四行。
2. 勾选/取消权限，已选数量实时变化。
3. 数据范围选择“指定用户/角色”，添加一个用户，保存成功。
4. 删除内置角色按钮禁用且有原因提示。
5. 保存后刷新页面，配置仍在。

- [ ] **Step 7: 提交**

```bash
git add app/src/pages/system/Roles.tsx app/src/pages/system/components
git commit -m "feat: 角色管理改为功能权限与数据范围双 Tab 配置"
```

---

### Task 4: 权限页只读化

**Files:**
- Modify: `app/src/pages/system/Permissions.tsx`
- Test: `npm run lint` + 手测

**Interfaces:**
- Consumes: `BackendPermission.module/action/status`。
- Produces: 只读权限目录页面。

- [ ] **Step 1: 移除写入口**

- 删除 `PermissionFormDialog` 组件与创建/编辑/删除按钮、`AlertDialog`、相关状态与处理函数。
- 保留搜索与分页。

- [ ] **Step 2: 调整列**

| 列 | 内容 |
|---|---|
| ID | 权限 ID |
| 模块 | `MODULE_LABELS` 映射 |
| 权限码 | `code` 等宽展示 |
| 名称 | `name` |
| 动作 | `action` 中文映射（查看/创建/编辑/删除/发布） |
| 状态 | `implemented` → “已实现”；`reserved` → Badge“未上线” |
| 说明 | `description` |

模块与动作中文标签从 `app/src/auth/permissionLabels.ts` 导入，不在此页重复定义。

- [ ] **Step 3: 增加模块筛选与说明**

- 顶部说明：“权限目录由系统维护，如需新增请联系版本升级。”
- 模块下拉筛选 + 关键词搜索。
- 统计卡片：总权限数、已实现、未上线。

- [ ] **Step 4: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 5: 手测**

1. 页面没有任何创建/编辑/删除按钮。
2. 47 条权限按模块分组展示；13 条预留权限显示“未上线”。
3. 关键词与模块筛选可用。

- [ ] **Step 6: 提交**

```bash
git add app/src/pages/system/Permissions.tsx
git commit -m "feat: 权限目录页改为只读并展示模块动作状态"
```

---

### Task 5: 用户页多角色、资源数与账号保护

**Files:**
- Create: `app/src/pages/system/components/UserFormDialog.tsx`, `AssignRolesDialog.tsx`, `OwnedResourcesDialog.tsx`
- Modify: `app/src/pages/system/Users.tsx`
- Test: `npm run lint` + 手测

**Interfaces:**
- Consumes: `apiSystemService` 与 `usePermission()`。
- Produces: 用户管理页面。

- [ ] **Step 1: 用户列表列**

| 列 | 内容 |
|---|---|
| 用户 | 名章 + username |
| 邮箱 | email |
| 角色 | 多角色标签；无角色显示“未分配角色”；内置角色带“内置” |
| 拥有资源 | `owned_resource_count` |
| 状态 | 启用/禁用 |
| 最后登录 | 后端暂未返回时显示 `—` |
| 操作 | 编辑、分配角色、启用/禁用、删除 |

- [ ] **Step 2: 自操作保护**

- 当前账号行：隐藏“启用/禁用”和“删除”，显示“不可操作自己”。
- 编辑弹窗中角色选择整体禁用，并提示“不能修改自己的角色”。
- 最后一个超级管理员：管理员角色不可移除；禁用/删除按钮禁用并说明原因。

- [ ] **Step 3: 创建/编辑用户**

`UserFormDialog`：

- 创建：用户名、邮箱、密码、角色（多选，至少一个）。
- 编辑：用户名只读；邮箱可改；角色可改（自己除外）。
- 校验：用户名 3–20 位 `[a-z0-9._-]`；邮箱格式；密码最少 8 位。
- 错误就地显示并聚焦第一个错误字段。

`AssignRolesDialog`：

- 多选角色卡片，展示角色名、编码、内置标签。
- 保存前校验“至少一个角色”；自己不可修改角色。

- [ ] **Step 4: 启用/禁用与删除阻断**

- 禁用：确认弹窗说明“后续请求返回 401，资源归属不变”。
- 删除：
  1. 先调用 `getOwnedResources(user.id)`。
  2. `total > 0` → 打开 `OwnedResourcesDialog`，展示四类数量，确认按钮禁用，文案“请先转移其名下资源”。
  3. `total === 0` → 正常二次确认删除。
  4. 自己或最后一个超级管理员 → 直接禁用删除并说明。

- [ ] **Step 5: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 6: 手测**

1. 当前账号行不能删除/禁用自己。
2. 创建多角色用户，列表显示多个角色标签。
3. 删除有资源的用户，弹窗展示资源数量且无法确认。
4. 删除无资源用户成功。
5. 禁用/启用切换后状态更新。

- [ ] **Step 7: 提交**

```bash
git add app/src/pages/system/Users.tsx app/src/pages/system/components
git commit -m "feat: 用户管理增加多角色资源计数与账号保护"
```

---

### Task 6: Mock 数据与服务适配

**Files:**
- Modify: `app/src/services/mock/system.ts`, `app/src/services/mock/data/system.ts`
- Test: `npm run lint` + 手测

- [ ] **Step 1: 扩展角色 Mock**

- 5 个角色：管理员、开发者、运营、只读、数据标注员。
- 字段：`is_system`（前 4 个为 true）、`user_count`、`permission_count`、`permissions`。
- 新增 `getRoleDataScopes` / `updateRoleDataScopes` 内存实现，默认值按 V2 §6.5。

- [ ] **Step 2: 扩展权限 Mock**

- 47 条权限，字段 `module/action/status`。
- 保留现有 `getPermissionsPaged`，返回新字段。

- [ ] **Step 3: 扩展用户 Mock**

- 12 个账号，字段 `roles`（多角色）、`is_superuser`、`owned_resource_count`。
- 新增 `getOwnedResources` 返回四类计数。

- [ ] **Step 4: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 5: 手测**

Mock 模式下三个页面与真实模式结构一致；角色双 Tab、权限只读、用户删除阻断均可演示。

- [ ] **Step 6: 提交**

```bash
git add app/src/services/mock
git commit -m "feat: 系统管理 Mock 数据同步多角色与数据范围"
```

---

### Task 7: 系统管理验收

- [ ] **Step 1: 逐项手测**

| 验收项 | 操作 | 预期 |
|---|---|---|
| AC-09 | 删除内置角色 | 按钮禁用，提示“内置角色不可删除” |
| AC-10 | 删除自己 | 禁用，提示“不可操作自己” |
| AC-11 | 移除最后一个超级管理员 | 阻断并说明 |
| AC-32 | 删除仍拥有资源的用户 | 弹窗展示数量，确认按钮禁用 |
| G6 | 角色配置 | 模块 × 动作矩阵，14 个模块 |
| G10 | 数据范围 | 4 资源 × 2 范围，CUSTOM 可添加对象 |
| FR-06 | 权限页 | 无写入口，预留权限“未上线” |

- [ ] **Step 2: 构建验证**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add -A app/src/pages/system app/src/services
git commit -m "test: 系统管理 RBAC 页面验收与构建验证"
```

---

## 依赖与顺序

1. 依赖 `RBAC权限内核-plan.md` 的 `RoleRead` 新字段、`PUT /users/{id}`、用户保护规则。
2. 依赖 `数据级授权内核-plan.md` 的 `GET/PUT /roles/{id}/data-scopes`、`GET /share/subjects`、`GET /users/{id}/owned-resources` 数据来源。
3. 依赖 `前端权限控制-plan.md` 的 `usePermission`、`Can`、`Toast`、`ApiBusinessError`。
4. 完成后清理 `RBAC_PENDING_PREFIXES` 中不存在的系统前缀（系统路由已在 RBAC 内核接入）。

## 风险与决策

| 项 | 决策 |
|---|---|
| 角色配置两个接口如何一次保存 | 前端串行调用，权限成功、范围失败时保持弹窗并提示“功能权限已保存，数据范围保存失败”，避免误报成功 |
| 权限页写接口 | 后端保留受 `permission:*` 保护，前端不暴露入口（FR-06） |
| 用户列表资源计数性能 | 使用 `count_owned_resources_bulk` 一次分组统计，避免每行 4 次查询 |
| 最后登录字段 | 后端 `last_login` 已有字段；若列表暂未返回，前端显示 `—`，不造数据 |
| 多角色展示 | 使用关联表真实角色；不沿用 `app/docs/09-系统管理.md` 中的单 `roleId` 旧模型 |
