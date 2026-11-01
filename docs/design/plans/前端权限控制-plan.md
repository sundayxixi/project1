# 前端权限控制 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 前端根据 `/users/me` 下发的权限集合与数据范围，统一控制菜单、路由、按钮，并提供 403 页面、401/403 拦截、资源级共享与归属转移的通用组件。

**Architecture:** 登录后的布局外包裹 `PermissionProvider`，在内存中保存当前用户、权限码集合与四类资源的数据范围；每次路由切换刷新一次。路由用集中式 `ROUTE_PERMISSIONS` 映射 + `PermissionGuard` 拦截，按钮用 `hasPermission()` / `<Can>` 控制，数据级按钮改用接口返回的 `can_manage`。`apiClient` 统一解析 body 中的 `code=401/403`，401 清 token 跳登录，403 派发全局事件并刷新权限。

**Tech Stack:** React 19 / TypeScript 5.9 / Vite 7 / React Router 7 / Tailwind 4 / shadcn-ui（Radix）。

**Spec:** `docs/spec/PROJECT_SPEC_V2.md`（§7 FR-01、FR-08~10、§8 页面需求、§9.4 前端路由映射）、`docs/design/ui/RBAC原型设计说明书.md`（§5、§6、§7）。

**前置计划:** `RBAC权限内核-plan.md`、`数据级授权内核-plan.md`（共享/转移接口）。

---

## 模块说明（产品视角）

### 目标

| 编号 | 目标 | 本计划落点 |
|---|---|---|
| G5 | 前端按权限控制菜单可见性、路由访问、页面内操作按钮 | Provider + Guard + `Can` |
| G12 | 资源所有者可共享单个资源 | `ShareDrawer` |
| G13 | 数据级授权变更立即生效 | 403 后刷新权限、共享后刷新列表 |
| FR-01 | 401 清 token 跳登录 | `apiClient` |
| FR-08 | 登录后与每次路由切换拉取 `/users/me` | `PermissionProvider` |
| FR-09 | 无功能权限按钮不渲染；行内按钮按 `can_manage` | `Can` + `row.can_manage` |
| FR-10 | 403 页面与操作级提示 | `PermissionGuard` + Toast |

### 交付物

1. 权限相关 TypeScript 类型与 `permissionService`。
2. `PermissionProvider`、`usePermission`、`<Can>`。
3. `ROUTE_PERMISSIONS`、`PermissionGuard`、`/403` 页面。
4. 侧边栏菜单按权限过滤。
5. `apiClient` 对 `code=401/403` 的统一处理与全局 Toast。
6. `ShareDrawer`、`TransferOwnerDialog`、`OwnerBadge`。
7. Mock 模式身份模拟（管理员默认，可切开发者/运营/只读）。

### 不在本期范围

- 各业务页面接入 `Can` / 归属列 / 共享入口 → 各业务模块计划。
- 用户/角色/权限管理页面的具体改版 → `系统管理-plan.md`。
- 后端权限判定 → `RBAC权限内核-plan.md`、`数据级授权内核-plan.md`。

---

## Global Constraints

- 权限上下文只存内存，不写 `localStorage`；退出登录时由 Provider 卸载自然清空。
- 服务端是唯一判定来源；前端隐藏按钮只影响体验，不能替代接口校验。
- 路由无权限跳 `/403`，操作无权限提示并刷新权限；两者都使用 body `code=403` 语义。
- 菜单项无权限不生成 DOM；系统管理分组无任何可见项时整组隐藏。
- 行内编辑/删除按钮按接口返回的 `can_manage` 渲染，不根据角色名猜测。
- 前端 `strict: true`、`noUnusedLocals: true`、`noUnusedParameters: true`；`npm run build` 必须通过。
- 项目暂未配置前端测试运行器；本计划的验证门禁为 `npm run lint` + `npm run build` + 明确的手测清单。引入 Vitest 后，应把手测项转为组件测试。
- 提交信息使用中文摘要，每个任务提交一次。

---

## Review Focus

1. **直接输入无权 URL**：只隐藏菜单不够，`/system/users` 等路由必须在渲染前跳 `/403`，刷新页面同样生效。
2. **HTTP 200 + body code=403**：`apiClient` 必须先解析 body 再判断 `res.ok`，否则所有权限拒绝都会退化成普通“请求失败”，不会刷新权限或跳 403。
3. **权限刷新时的页面抖动**：路由切换触发的后台刷新不能把已渲染页面清空；只有首次加载显示加载态。
4. **数据范围收紧后的旧数据**：下一次列表请求应只返回可见数据；前端不得缓存上一轮列表或在客户端二次过滤冒充权限。
5. **Mock 身份切换的一致性**：切换身份后菜单、路由、按钮、数据范围必须同时变化，不能只改按钮显示。

---

## File Structure

**新增**

| 文件 | 职责 |
|---|---|
| `app/src/services/api/permission.ts` | `/users/me` 类型与真实请求 |
| `app/src/services/mock/permission.ts` | Mock 身份与权限/数据范围 |
| `app/src/services/permission.ts` | Mock/API 切换出口 |
| `app/src/services/api/dataAuth.ts` | ACL、转移、数据范围、共享对象搜索 |
| `app/src/services/mock/dataAuth.ts` | Mock ACL 内存实现 |
| `app/src/services/dataAuth.ts` | Mock/API 切换出口 |
| `app/src/auth/PermissionContext.tsx` | `PermissionProvider`、`usePermission` |
| `app/src/auth/Can.tsx` | 按钮级权限组件 |
| `app/src/auth/permissionLabels.ts` | 模块/动作中文标签与模块顺序，权限矩阵、权限页、个人中心共用 |
| `app/src/auth/routePermissions.ts` | 路由 → 权限映射与匹配函数 |
| `app/src/components/PermissionGuard.tsx` | 路由守卫 |
| `app/src/components/ToastProvider.tsx` | 轻量全局提示 |
| `app/src/pages/Forbidden.tsx` | `/403` 页面 |
| `app/src/components/OwnerBadge.tsx` | 归属名章与共享标签 |
| `app/src/components/ShareDrawer.tsx` | 共享抽屉 |
| `app/src/components/TransferOwnerDialog.tsx` | 归属转移弹窗 |

**修改**

| 文件 | 变更 |
|---|---|
| `app/src/services/api/client.ts` | 解析 body `code=401/403`，抛出带 code 的错误，派发 403 事件 |
| `app/src/App.tsx` | 包裹 `PermissionProvider`；新增 `/403` 路由 |
| `app/src/layouts/DashboardLayout.tsx` | 菜单按权限过滤；内容区包裹 `PermissionGuard` |
| `app/src/layouts/menuConfig.ts`（新增） | 菜单项 → 权限码映射 |
| `app/src/services/auth.ts`、`app/src/services/mock/auth.ts` | Mock 登录身份与 `getMe` 兼容 |

---

### Task 1: 权限类型与 `/users/me` 服务

**Files:**
- Create: `app/src/services/api/permission.ts`, `app/src/services/permission.ts`
- Test: `npm run lint`

**Interfaces:**
- Consumes: `apiClient`、`USE_MOCK`。
- Produces:

```ts
export type ResourceType = 'agent' | 'prompt' | 'knowledge' | 'tool'
export type DataScopeLevel = 'ALL' | 'SELF' | 'CUSTOM'
export interface DataScopeSummary { view: DataScopeLevel; manage: DataScopeLevel }
export interface RoleBrief { id: number; code: string; name: string }
export interface MeResponse {
  id: number
  username: string
  email: string
  is_active: boolean
  is_superuser: boolean
  roles: RoleBrief[]
  permissions: string[]
  data_scopes: Record<ResourceType, DataScopeSummary>
}
export const apiPermissionService = {
  getMe(): Promise<MeResponse>,
}
```

- [ ] **Step 1: 写类型与真实请求**

`app/src/services/api/permission.ts`：

```ts
import { apiClient } from './client'

export type ResourceType = 'agent' | 'prompt' | 'knowledge' | 'tool'
export type DataScopeLevel = 'ALL' | 'SELF' | 'CUSTOM'
export interface DataScopeSummary { view: DataScopeLevel; manage: DataScopeLevel }
export interface RoleBrief { id: number; code: string; name: string }
export interface MeResponse {
  id: number
  username: string
  email: string
  is_active: boolean
  is_superuser: boolean
  roles: RoleBrief[]
  permissions: string[]
  data_scopes: Record<ResourceType, DataScopeSummary>
}

export const apiPermissionService = {
  getMe(): Promise<MeResponse> {
    return apiClient.get<MeResponse>('/users/me')
  },
}
```

`app/src/services/permission.ts`：

```ts
import { USE_MOCK } from './config'
import { apiPermissionService } from './api/permission'
import { mockPermissionService } from './mock/permission'

export const permissionService = USE_MOCK ? mockPermissionService : apiPermissionService
export * from './api/permission'
```

- [ ] **Step 2: 运行类型检查**

Run: `cd app && npm run build`
Expected: 构建通过（Task 8 会补 `mock/permission.ts`；本步骤先把 Mock 文件建为空壳，避免导入失败）。

- [ ] **Step 3: 提交**

```bash
git add app/src/services/api/permission.ts app/src/services/permission.ts app/src/services/mock/permission.ts
git commit -m "feat: 前端增加权限类型与 /users/me 服务"
```

---

### Task 2: `PermissionProvider`

**Files:**
- Create: `app/src/auth/PermissionContext.tsx`
- Modify: `app/src/App.tsx`
- Test: `npm run lint` + 手测

**Interfaces:**
- Consumes: `permissionService.getMe()`、`useLocation`。
- Produces:

```ts
interface PermissionState {
  user: MeResponse | null
  permissions: Set<string>
  dataScopes: Record<ResourceType, DataScopeSummary>
  isSuperuser: boolean
  loading: boolean
  refresh: () => Promise<void>
  hasPermission: (code: string) => boolean
  hasAny: (codes: string[]) => boolean
}
export function PermissionProvider({ children }: { children: React.ReactNode }): JSX.Element
export function usePermission(): PermissionState
```

- [ ] **Step 1: 实现 Provider**

要点：

1. `useState<MeResponse | null>(null)`、`const [loading, setLoading] = useState(true)`。
2. `refresh()`：调用 `permissionService.getMe()`，成功后 `setUser`；失败时保留旧数据并 `console.error`。
3. 首次挂载 `useEffect(() => { void refresh().finally(() => setLoading(false)) }, [])`。
4. 路由切换刷新：`const location = useLocation(); useEffect(() => { if (user) void refresh() }, [location.pathname])`。刷新期间不清空 `user`，避免页面抖动。
5. `hasPermission(code) = user?.is_superuser || permissions.has(code)`；`is_superuser` 时无需遍历全量权限。
6. 监听 `window` 的 `rbac:forbidden` 事件，调用 `refresh()`。
7. `dataScopes = user?.data_scopes ?? {}`；提供 `scopeFor(resourceType)`，缺失时回退 `{ view: 'SELF', manage: 'SELF' }`，兼容后端尚未下发数据范围的迁移期。
8. `usePermission()` 在 Provider 外调用时抛 `Error('usePermission 必须在 PermissionProvider 内使用')`。

- [ ] **Step 2: 接入 App.tsx**

```tsx
<Route path="/" element={
  <AuthGuard>
    <PermissionProvider>
      <DashboardLayout />
    </PermissionProvider>
  </AuthGuard>
}>
```

同时新增：`<Route path="403" element={<Forbidden />} />`（Task 4 创建页面）。

- [ ] **Step 3: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 4: 手测**

1. 登录后 Network 面板出现 `GET /users/me`。
2. 切换到 `/agents`、`/prompts`，每次路由切换各出现一次 `/users/me`。
3. 刷新页面后权限上下文重新加载，不出现空白闪烁。

- [ ] **Step 5: 提交**

```bash
git add app/src/auth/PermissionContext.tsx app/src/App.tsx
git commit -m "feat: 增加前端权限上下文并在路由切换时刷新"
```

---

### Task 3: `usePermission` 与 `<Can>`

**Files:**
- Create: `app/src/auth/Can.tsx`, `app/src/auth/permissionLabels.ts`
- Test: `npm run lint`

**Interfaces:**
- Consumes: `usePermission()`。
- Produces:

```tsx
export function Can(props: {
  code: string
  fallback?: React.ReactNode
  children: React.ReactNode
}): JSX.Element | null
```

- [ ] **Step 1: 实现 `Can`**

```tsx
import type { ReactNode } from 'react'
import { usePermission } from './PermissionContext'

export function Can({ code, fallback = null, children }: {
  code: string
  fallback?: ReactNode
  children: ReactNode
}) {
  const { hasPermission } = usePermission()
  return hasPermission(code) ? <>{children}</> : <>{fallback}</>
}
```

- [ ] **Step 2: 创建权限标签常量**

`app/src/auth/permissionLabels.ts`：

```ts
export const MODULE_ORDER = [
  'agent', 'model', 'prompt', 'knowledge', 'tool', 'conversation', 'analytics',
  'user', 'role', 'permission', 'apikey', 'audit', 'alert', 'settings',
] as const

export const MODULE_LABELS: Record<string, string> = {
  agent: 'Agent管理', model: '模型管理', prompt: 'Prompt管理',
  knowledge: '知识库管理', tool: '工具管理',
  conversation: '对话日志', analytics: '数据统计',
  user: '用户管理', role: '角色管理', permission: '权限管理',
  apikey: 'API密钥', audit: '审计日志', alert: '告警规则', settings: '系统配置',
}

export const ACTION_LABELS: Record<string, string> = {
  view: '查看', create: '创建', update: '编辑', delete: '删除', publish: '发布',
}
```

权限矩阵、权限目录页、个人中心统一从这里导入，不各自维护中文标签。

- [ ] **Step 3: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add app/src/auth/Can.tsx app/src/auth/permissionLabels.ts
git commit -m "feat: 增加按钮级权限组件与权限标签常量"
```

---

### Task 4: 路由权限映射、守卫与 403 页面

**Files:**
- Create: `app/src/auth/routePermissions.ts`, `app/src/components/PermissionGuard.tsx`, `app/src/pages/Forbidden.tsx`
- Modify: `app/src/layouts/DashboardLayout.tsx`, `app/src/App.tsx`
- Test: `npm run lint` + 手测

**Interfaces:**
- Consumes: `matchPath`、`usePermission`。
- Produces:

```ts
export interface RoutePermission { pattern: string; code: string | null }
export const ROUTE_PERMISSIONS: RoutePermission[]
export function requiredPermissionFor(pathname: string): string | null
export function PermissionGuard({ children }: { children: React.ReactNode })
```

- [ ] **Step 1: 建立路由映射**

`app/src/auth/routePermissions.ts` 按 V2 §9.4 写入，顺序必须“静态段优先、长路径优先”：

```ts
export const ROUTE_PERMISSIONS = [
  { pattern: '/', code: null },
  { pattern: '/profile', code: null },
  { pattern: '/settings', code: null },
  { pattern: '/403', code: null },

  { pattern: '/agents/create', code: 'agent:create' },
  { pattern: '/agents/:id/edit', code: 'agent:update' },
  { pattern: '/agents/:id/test', code: 'agent:view' },
  { pattern: '/agents/:id/versions', code: 'agent:view' },
  { pattern: '/agents/:id/monitor', code: 'agent:view' },
  { pattern: '/agents/:id', code: 'agent:view' },
  { pattern: '/agents', code: 'agent:view' },

  { pattern: '/models/providers', code: 'model:view' },
  { pattern: '/models/create', code: 'model:create' },
  { pattern: '/models/:id/edit', code: 'model:update' },
  { pattern: '/models/:id/test', code: 'model:view' },
  { pattern: '/models', code: 'model:view' },

  { pattern: '/prompts/create', code: 'prompt:create' },
  { pattern: '/prompts/:id/edit', code: 'prompt:update' },
  { pattern: '/prompts/:id/versions', code: 'prompt:view' },
  { pattern: '/prompts', code: 'prompt:view' },

  { pattern: '/knowledge/create', code: 'knowledge:create' },
  { pattern: '/knowledge/:id/documents', code: 'knowledge:view' },
  { pattern: '/knowledge/:id/segments', code: 'knowledge:view' },
  { pattern: '/knowledge/:id/test', code: 'knowledge:view' },
  { pattern: '/knowledge/:id', code: 'knowledge:view' },
  { pattern: '/knowledge', code: 'knowledge:view' },

  { pattern: '/tools/create', code: 'tool:create' },
  { pattern: '/tools/:id', code: 'tool:view' },
  { pattern: '/tools', code: 'tool:view' },

  { pattern: '/conversations/:id', code: 'conversation:view' },
  { pattern: '/conversations', code: 'conversation:view' },

  { pattern: '/analytics/costs', code: 'analytics:view' },
  { pattern: '/analytics/evaluation', code: 'analytics:view' },
  { pattern: '/analytics', code: 'analytics:view' },

  { pattern: '/system/users', code: 'user:view' },
  { pattern: '/system/roles', code: 'role:view' },
  { pattern: '/system/permissions', code: 'permission:view' },
  { pattern: '/system/api-keys', code: 'apikey:view' },
  { pattern: '/system/audit', code: 'audit:view' },
  { pattern: '/system/alerts', code: 'alert:view' },
  { pattern: '/system/settings', code: 'settings:view' },
] as const

export function requiredPermissionFor(pathname: string): string | null {
  const match = ROUTE_PERMISSIONS.find(item => matchPath({ path: item.pattern, end: true }, pathname))
  return match?.code ?? null
}
```

- [ ] **Step 2: 实现守卫**

`PermissionGuard`：

```tsx
export default function PermissionGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const { hasPermission, loading } = usePermission()
  if (loading) return <div className="p-6 text-muted-foreground">加载权限中...</div>
  const required = requiredPermissionFor(location.pathname)
  if (required && !hasPermission(required)) {
    return <Navigate to={`/403?need=${encodeURIComponent(required)}`} replace />
  }
  return <>{children}</>
}
```

在 `DashboardLayout` 的 `<main>` 内包裹 `<Outlet />`：

```tsx
<main ...>
  <PermissionGuard>
    <Outlet />
  </PermissionGuard>
</main>
```

- [ ] **Step 3: 实现 403 页面**

`app/src/pages/Forbidden.tsx`：

- 从 `useSearchParams()` 读取 `need`。
- 展示“无权访问该页面 / 资源”、所需权限码、当前用户名。
- 按钮“返回工作台” → `navigate('/')`。
- 文案不区分“资源不存在”与“无权限”。

- [ ] **Step 4: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 5: 手测**

1. Mock 身份切到 `viewer`，直接访问 `/system/users` → 跳 `/403?need=user:view`。
2. 刷新 `/403` 页面仍能渲染。
3. `/`、`/profile`、`/settings` 仅要求登录。

- [ ] **Step 6: 提交**

```bash
git add app/src/auth/routePermissions.ts app/src/components/PermissionGuard.tsx app/src/pages/Forbidden.tsx app/src/layouts/DashboardLayout.tsx app/src/App.tsx
git commit -m "feat: 增加路由权限映射、守卫与 403 页面"
```

---

### Task 5: 侧边栏菜单按权限过滤

**Files:**
- Create: `app/src/layouts/menuConfig.ts`
- Modify: `app/src/layouts/DashboardLayout.tsx`
- Test: `npm run lint` + 手测

**Interfaces:**
- Consumes: `usePermission()`、`LucideIcon`。
- Produces:

```ts
export interface MenuItem { path: string; icon: LucideIcon; label: string; permission: string | null }
export const PLATFORM_MENU: MenuItem[]
export const SYSTEM_MENU: MenuItem[]
```

- [ ] **Step 1: 抽离菜单配置**

`PLATFORM_MENU`：

| 路径 | 权限 |
|---|---|
| `/` | `null` |
| `/agents` | `agent:view` |
| `/models` | `model:view` |
| `/prompts` | `prompt:view` |
| `/knowledge` | `knowledge:view` |
| `/tools` | `tool:view` |
| `/conversations` | `conversation:view` |
| `/analytics` | `analytics:view` |

`SYSTEM_MENU`：

| 路径 | 权限 |
|---|---|
| `/system/users` | `user:view` |
| `/system/roles` | `role:view` |
| `/system/permissions` | `permission:view` |
| `/system/api-keys` | `apikey:view` |
| `/system/audit` | `audit:view` |
| `/system/alerts` | `alert:view` |
| `/system/settings` | `settings:view` |

- [ ] **Step 2: 过滤渲染**

- `visiblePlatform = PLATFORM_MENU.filter(i => !i.permission || hasPermission(i.permission))`
- `visibleSystem = SYSTEM_MENU.filter(i => !i.permission || hasPermission(i.permission))`
- `visibleSystem.length === 0` 时整组“系统设置”不渲染。
- 面包屑从 `visiblePlatform/visibleSystem` 中查找；被过滤的菜单不会生成面包屑。

- [ ] **Step 3: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 4: 手测**

1. `viewer` 身份：只显示 Agent/模型/Prompt/知识库/工具/对话/统计，系统设置整组消失。
2. `operator` 身份：系统设置整组消失。
3. `admin` 身份：全部菜单可见。

- [ ] **Step 5: 提交**

```bash
git add app/src/layouts/menuConfig.ts app/src/layouts/DashboardLayout.tsx
git commit -m "feat: 侧边栏菜单按功能权限过滤"
```

---

### Task 6: `apiClient` 401/403 处理与全局 Toast

**Files:**
- Create: `app/src/components/ToastProvider.tsx`
- Modify: `app/src/services/api/client.ts`, `app/src/App.tsx`, `app/src/auth/PermissionContext.tsx`
- Test: `npm run lint` + 手测

**Interfaces:**
- Consumes: 无。
- Produces:
  - `class ApiBusinessError extends Error { code: number }`
  - `ToastProvider`、`useToast()`
  - 全局事件 `rbac:forbidden`，`detail: { message: string }`

- [ ] **Step 1: 实现 `ApiBusinessError`**

`client.ts`：

```ts
export class ApiBusinessError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
    this.name = 'ApiBusinessError'
  }
}
```

`handleResponse` 顺序改为：

1. 先判断 `res.status === 204` 或响应体为空，直接返回 `undefined`，避免 `res.json()` 抛错。
2. 尝试 `res.json()`（失败则按 HTTP 状态抛错）。
3. `json.code === 401`：`tokenStorage.remove()`；`window.location.href = '/login'`；抛 `ApiBusinessError(401, message)`。
4. `json.code === 403`：`window.dispatchEvent(new CustomEvent('rbac:forbidden', { detail: { message } }))`；抛 `ApiBusinessError(403, message)`。
5. `json.code !== 200 && json.code !== 0`：抛 `ApiBusinessError(json.code, message)`。
6. HTTP 401 仍走原逻辑；HTTP 403 也派发事件。
7. 返回 `json.data ?? json`。

- [ ] **Step 2: 实现 Toast**

`ToastProvider` 提供：

```ts
interface ToastItem { id: number; message: string; variant: 'success' | 'error' }
interface ToastState { showToast: (message: string, variant?: 'success' | 'error') => void }
```

渲染固定右下角堆栈，3 秒自动消失；`useToast()` 在 Provider 外调用时抛错。

- [ ] **Step 3: 接入 App 与 403 事件**

- `App.tsx` 最外层包 `<ToastProvider>`。
- `PermissionProvider` 监听 `rbac:forbidden`：`showToast(detail.message, 'error')` + `void refresh()`。
- 401 事件不需要 Toast，直接跳登录。

- [ ] **Step 4: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 5: 手测**

1. 后端返回 `code=403` 时，页面右下角出现错误提示，且权限被刷新。
2. 后端返回 `code=401` 时，token 被清除并跳 `/login`。
3. 普通业务错误仍以 `ApiBusinessError` 抛出，页面原有 catch 逻辑可用。

- [ ] **Step 6: 提交**

```bash
git add app/src/services/api/client.ts app/src/components/ToastProvider.tsx app/src/App.tsx app/src/auth/PermissionContext.tsx
git commit -m "feat: 前端统一处理 401/403 并增加全局提示"
```

---

### Task 7: 共享/转移通用组件与 `dataAuth` 服务

**Files:**
- Create: `app/src/services/api/dataAuth.ts`, `app/src/services/mock/dataAuth.ts`, `app/src/services/dataAuth.ts`
- Create: `app/src/components/OwnerBadge.tsx`, `app/src/components/ShareDrawer.tsx`, `app/src/components/TransferOwnerDialog.tsx`
- Test: `npm run lint` + 手测

**Interfaces:**
- Consumes: `apiClient`、`usePermission`、`useToast`。
- Produces:

```ts
export type AclAccessLevel = 'view' | 'manage'
export interface AclEntry {
  id: number; resource_type: string; resource_id: number
  subject_type: 'user' | 'role'; subject_id: number; subject_name: string
  access_level: AclAccessLevel; granted_by: number | null; granted_by_name: string | null
  granted_at: string; updated_at: string
}
export interface AclCreate {
  subject_type: 'user' | 'role'; subject_id: number; access_level: AclAccessLevel
}
export interface SubjectOption { id: number; name: string; type: 'user' | 'role' }

export const dataAuthService = {
  listAcl(resourceType: ResourceType, id: number): Promise<AclEntry[]>
  addAcl(resourceType: ResourceType, id: number, data: AclCreate): Promise<AclEntry>
  removeAcl(resourceType: ResourceType, id: number, aclId: number): Promise<void>
  transferOwner(resourceType: ResourceType, id: number, newOwnerId: number): Promise<void>
  searchSubjects(subjectType: 'user' | 'role', keyword: string): Promise<SubjectOption[]>
}

export function OwnerBadge(props: {
  ownerId: number; ownerName: string | null
  isShared?: boolean; sharedLevel?: 'view' | 'manage' | null
}): JSX.Element

export function ShareDrawer(props: {
  open: boolean; resourceType: ResourceType; resourceId: number; resourceName: string
  onClose: () => void; onChanged?: () => void
}): JSX.Element

export function TransferOwnerDialog(props: {
  open: boolean; resourceType: ResourceType; resourceId: number; resourceName: string
  onClose: () => void; onTransferred?: () => void
}): JSX.Element
```

- [ ] **Step 1: 实现 `dataAuth` 服务**

路径映射：

```ts
const RESOURCE_PATH: Record<ResourceType, string> = {
  agent: 'agents',
  prompt: 'prompts',
  knowledge: 'knowledge-bases',
  tool: 'tools',
}
```

真实请求：

| 方法 | 接口 |
|---|---|
| `listAcl` | `GET /{path}/{id}/acl` |
| `addAcl` | `POST /{path}/{id}/acl` |
| `removeAcl` | `DELETE /{path}/{id}/acl/{aclId}` |
| `transferOwner` | `POST /{path}/{id}/transfer` |
| `searchSubjects` | `GET /share/subjects?subject_type=&keyword=` |

Mock 实现使用模块级 `Map<string, AclEntry[]>`，键为 `${resourceType}:${id}`；`addAcl` 重复主体更新级别；`removeAcl` 过滤；`transferOwner` 只记录日志并返回成功。

- [ ] **Step 2: 实现 `OwnerBadge`**

- 方形名章：`ownerName` 首字，1px 边框，1px 圆角，衬线字体。
- `ownerId === usePermission().user?.id` 时显示“（我）”并使用蓝色描边。
- `isShared` 时追加标签 `共享 · 只读` / `共享 · 可管理`。
- 无 owner 时显示“未知归属”。

- [ ] **Step 3: 实现 `ShareDrawer`**

结构：

1. 标题“共享「{resourceName}」”。
2. 添加行：主体类型下拉（用户/角色）、搜索输入、候选列表、级别下拉（只读/可管理）、添加按钮。
3. 现有共享表格：主体、类型、级别、授予人、时间、操作（改级别、移除）。
4. 底部说明：“共享只解决数据层；不能共享给所有人。”
5. 空状态：“尚未共享给任何人”。

规则：

- 搜索输入 300ms 防抖调用 `searchSubjects`。
- 添加成功后 `showToast('已添加共享，立即生效', 'success')` 并刷新列表；`onChanged?.()`。
- 改级别调用 `addAcl` 同一主体 + 新级别；移除调用 `removeAcl`。
- 所有操作失败由 `ApiBusinessError` 捕获并 `showToast(message, 'error')`。

- [ ] **Step 4: 实现 `TransferOwnerDialog`**

- 输入搜索启用用户（只查 `user`）。
- 显示当前所有者，不能选择自己。
- 确认按钮调用 `transferOwner`，成功 Toast“归属已转移，立即生效”。
- 失败展示后端消息（如“新所有者不存在或已禁用”）。

- [ ] **Step 5: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 6: 手测**

1. Mock 模式下打开共享抽屉，添加用户 → 列表出现；改级别 → 级别变化；移除 → 消失。
2. 转移弹窗不能选中自己；成功后调用 `onTransferred`。
3. 真实模式下接口路径与后端一致（`/agents/1/acl` 等）。

- [ ] **Step 7: 提交**

```bash
git add app/src/services/api/dataAuth.ts app/src/services/mock/dataAuth.ts app/src/services/dataAuth.ts app/src/components/OwnerBadge.tsx app/src/components/ShareDrawer.tsx app/src/components/TransferOwnerDialog.tsx
git commit -m "feat: 增加共享抽屉、归属名章与转移弹窗"
```

---

### Task 8: Mock 身份与权限模拟

**Files:**
- Create/Modify: `app/src/services/mock/permission.ts`
- Modify: `app/src/services/mock/auth.ts`
- Test: `npm run lint` + 手测

**Interfaces:**
- Consumes: `MeResponse`。
- Produces:
  - `mockPermissionService.getMe(): Promise<MeResponse>`
  - `MOCK_IDENTITIES: Record<'admin' | 'developer' | 'developerSelf' | 'operator' | 'viewer', MeResponse>`
  - `setMockIdentity(key: MockIdentityKey): void`（写 `localStorage['mock_identity']`）

- [ ] **Step 1: 定义 5 个身份**

按原型 §6.1：

| key | 用户名 | 权限数 | Agent 查看/管理 | 知识库查看/管理 |
|---|---|---|---|---|
| `admin` | 陈晓 | 47 | ALL / ALL | ALL / ALL |
| `developer` | 李四 | 18 | ALL / SELF | ALL / SELF |
| `developerSelf` | 李四 | 18 | SELF / SELF | SELF / SELF |
| `operator` | 王敏 | 9 | ALL / SELF | ALL / ALL |
| `viewer` | 赵宁 | 7 | ALL / SELF | ALL / SELF |

权限码数组必须与 `RBAC权限内核-plan.md` 的内置角色矩阵一致：

- `developer` 18：agent view/create/update/publish；model view；prompt view/create/update/delete/publish；knowledge view/create/update；tool view/create/update；conversation view；analytics view。
- `operator` 9：agent view；model view；prompt view；knowledge view/create/update；tool view；conversation view；analytics view。
- `viewer` 7：agent/model/prompt/knowledge/tool/conversation/analytics 的 view。
- `admin` 47：从 `ALL_PERMISSIONS` 常量取全量。

- [ ] **Step 2: 实现身份读取**

```ts
const KEY = 'mock_identity'
export type MockIdentityKey = keyof typeof MOCK_IDENTITIES

export const mockPermissionService = {
  async getMe(): Promise<MeResponse> {
    const key = (localStorage.getItem(KEY) as MockIdentityKey) || 'admin'
    return structuredClone(MOCK_IDENTITIES[key] ?? MOCK_IDENTITIES.admin)
  },
}
```

- [ ] **Step 3: Mock 登录兼容**

`mock/auth.ts` 的登录成功后，默认写入 `mock_identity=admin`（若用户未手动选择）。不要覆盖已存在的身份，便于评审时固定受限身份刷新。

- [ ] **Step 4: Mock 业务数据补齐归属字段**

Mock 身份需要固定数值 ID，供归属名章与数据范围模拟使用：

| 身份 | user id |
|---|---|
| `admin` | 1 |
| `developer` | 2 |
| `developerSelf` | 3 |
| `operator` | 4 |
| `viewer` | 5 |

修改以下文件：

| 文件 | 变更 |
|---|---|
| `app/src/services/mock/data/agents.ts` | 每条数据增加 `owner_id`、`owner_name`、`is_shared`；归属分散到 5 个身份 |
| `app/src/services/mock/data/prompts.ts` | 同上 |
| `app/src/services/mock/data/knowledge.ts` | 同上 |
| `app/src/services/mock/data/tools.ts` | 同上 |
| `app/src/services/mock/agent.ts` | 列表按当前身份的 `data_scopes.agent.view` 过滤；按 `manage` 计算 `can_manage` |
| `app/src/services/mock/prompt.ts` | 同上（`prompt`） |
| `app/src/services/mock/knowledge.ts` | 同上（`knowledge`） |
| `app/src/services/mock/tool.ts` | 同上（`tool`） |

过滤规则：

- `view=ALL`：返回全部行。
- `view=SELF`：只返回 `owner_id === 当前身份 id` 的行，以及 `mock/dataAuth` 中共享给该身份的行。
- `can_manage`：`owner_id === 当前身份 id` 或 `manage=ALL`，或共享级别为 `manage`。
- `is_shared`：`mock/dataAuth` 中存在该资源任意 ACL 条目。

Mock 列表与 `mock/dataAuth` 共用同一个模块级 ACL Map，保证共享后立即出现在列表中。

- [ ] **Step 5: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 6: 手测**

在浏览器控制台执行：

```js
localStorage.setItem('mock_identity', 'viewer'); location.reload()
```

预期：侧边栏只剩 7 个查看入口；`/system/users` 直接访问跳 `/403`；Agent 列表无新建/编辑/删除按钮。

再切 `developer`：Agent 列表有新建/编辑，无删除；知识库有新建/编辑，无删除。

再切 `developerSelf`：Agent/知识库列表只剩本人与共享可见的数据，行内按钮按共享级别变化。

- [ ] **Step 7: 提交**

```bash
git add app/src/services/mock
git commit -m "feat: Mock 模式支持五种身份、归属字段与数据范围模拟"
```

---

### Task 9: 个人中心展示权限与数据范围

**Files:**
- Modify: `app/src/pages/Profile.tsx`
- Test: `npm run lint` + 手测

**Interfaces:**
- Consumes: `usePermission()`。
- Produces: 个人中心只读权限摘要。

- [ ] **Step 1: 展示身份与角色**

- 显示用户名、邮箱、`is_superuser` 标签。
- 角色以标签展示；无角色显示“未分配角色”。
- 说明“角色与权限的修改请前往用户管理 / 角色管理”。

- [ ] **Step 2: 展示权限集合**

- 按模块分组展示 `permissions`；模块名从 `app/src/auth/permissionLabels.ts` 的 `MODULE_LABELS` 映射（与权限页一致）。
- 显示“共 N 项权限”。
- 超级管理员显示“拥有全部权限”。

- [ ] **Step 3: 展示四类资源范围**

- `agent / prompt / knowledge / tool` 四行，每行“查看：全部数据/仅本人/指定用户或角色；管理：…”。
- 范围缺失时回退 `SELF/SELF` 并标注“默认收紧”。
- 只读展示，不提供编辑入口。

- [ ] **Step 4: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 5: 手测**

1. `admin`：显示 47 项权限、四类资源 ALL/ALL。
2. `viewer`：显示 7 项权限、四类资源 ALL/SELF。
3. 页面无写操作。

- [ ] **Step 6: 提交**

```bash
git add app/src/pages/Profile.tsx
git commit -m "feat: 个人中心展示角色、权限与数据范围"
```

---

### Task 10: 前端权限验收

**Files:**
- Test: `npm run lint`、`npm run build` + 手测清单

- [ ] **Step 1: 逐项手测并记录**

| 验收项 | 操作 | 预期 |
|---|---|---|
| AC-04 | `viewer` 登录 | 只显示业务菜单查看入口；系统设置分组隐藏 |
| AC-05 | `viewer` 直接访问 `/system/users` | 跳 `/403?need=user:view` |
| AC-06 | `viewer` 进入 Agent 列表 | 无新建/编辑/删除/发布按钮 |
| AC-08 | 模拟后端 `code=401` | 清 token，跳 `/login` |
| AC-12 | 打开 `/profile` | 显示角色、权限数量、四类资源范围 |
| FR-09 | `developer` 身份看他人 Agent | 可查看，行内无编辑/删除 |
| FR-16 | 所有者打开共享抽屉 | 可添加用户/角色、改级别、移除 |

- [ ] **Step 2: 运行构建**

Run: `cd app && npm run lint && npm run build`
Expected: 均通过，无 `noUnusedLocals` / 类型错误。

- [ ] **Step 3: 提交**

```bash
git add -A app/src
git commit -m "test: 前端权限控制手测清单与构建验证"
```

---

## 验收对照

| 验收项 | 落点 |
|---|---|
| AC-04 只读角色菜单 | Task 5 |
| AC-05 直接访问无权路由跳 403 | Task 4 |
| AC-06 只读角色无写按钮 | 各业务模块计划 + `Can` |
| AC-08 401 跳登录 | Task 6 |
| AC-10 删除自己（前端提示） | `系统管理-plan.md` |
| AC-12 `/profile` 展示权限与范围 | Task 9 |
| FR-09 行内按钮按 `can_manage` | 各业务模块计划 |
| FR-10 403 操作提示 | Task 6 + Toast |
| FR-16 共享抽屉 | Task 7 |
| NG 兼容性：Mock 模式可用 | Task 8 |

## 依赖与顺序

1. 依赖 `RBAC权限内核-plan.md` 的 `/users/me` 响应结构。
2. Task 7 依赖 `数据级授权内核-plan.md` 的 ACL/转移接口与 `GET /share/subjects`。
3. 各业务模块计划在 Task 7 完成后接入共享入口与 `can_manage` 按钮。
4. `系统管理-plan.md` 依赖本计划的 `usePermission`、`Can`、`Toast`。

## 风险与决策

| 项 | 决策 |
|---|---|
| 每次路由切换都请求 `/users/me` | 按 FR-08 执行；后台刷新不清空旧数据，避免页面抖动；后端可依赖缓存保证开销 |
| 权限上下文存储 | 仅内存；不写 localStorage，降低篡改与过期风险 |
| 403 与 401 的区分 | 以 body `code` 为准；HTTP 200 也算业务错误 |
| Mock 身份切换 | 通过 `localStorage['mock_identity']`，便于评审固定身份；真实模式完全忽略 |
| 共享对象搜索 | 新增 `GET /share/subjects`（仅要求登录），避免要求 `user:view` / `role:view` 导致普通开发者无法共享 |
