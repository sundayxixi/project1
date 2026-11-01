# 预留系统模块 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 API Key、审计日志、告警规则、系统配置四个后端模块尚未实现的前提下，完成 `apikey:*`、`audit:view`、`alert:*`、`settings:*` 的菜单/路由门禁与页面只读化，明确“菜单可见 ≠ 功能可用”。

**Architecture:** 后端本期不新增接口、不建表。前端保留现有四个 Mock 页面骨架，路由与菜单由对应 `:view` 权限控制；页面统一插入 `ReservedModuleNotice`，所有写操作禁用并说明“后端未实现”。系统配置页只读展示，不提供可提交表单。

**Tech Stack:** React 19 / TypeScript 5.9 / Vite 7 / shadcn-ui；后端无本期改动。

**Spec:** `docs/spec/PROJECT_SPEC_V2.md`（§5.2 系统管理预留权限、NG5、NG7、§9.3 预留模块）、`docs/design/ui/RBAC原型设计说明书.md`（§5.15、§8 状态设计）。

**前置计划:** `前端权限控制-plan.md`、`对话日志-plan.md`（复用 `ReservedModuleNotice`）。

---

## 模块说明（产品视角）

### 目标

| 编号 | 目标 | 本计划落点 |
|---|---|---|
| G5 | 菜单/路由按权限控制 | 复用前端路由映射 |
| NG5 | API Key 本期仅保留页面与菜单控制 | 页面只读化 |
| NG7 | 审计日志本期不落库 | 无后端、无写操作 |
| FR-10 | 无权限路由跳 403 | `PermissionGuard` |

### 覆盖页面

| 路由 | 权限 | 页面 |
|---|---|---|
| `/system/api-keys` | `apikey:view` | `app/src/pages/system/ApiKeys.tsx` |
| `/system/audit` | `audit:view` | `app/src/pages/system/Audit.tsx` |
| `/system/alerts` | `alert:view` | `app/src/pages/system/Alerts.tsx` |
| `/system/settings` | `settings:view` | `app/src/pages/system/Settings.tsx` |

> 个人设置 `/settings`（`app/src/pages/Settings.tsx`）仅要求登录，不属于本计划。

### 交付物

1. 四个页面顶部“未上线”说明。
2. 写操作禁用与原因提示。
3. 页面只读化，不产生假的保存成功。
4. 手测清单。

### 不在本期范围

- API Key 的创建、吊销、权限范围与鉴权。
- 审计日志落库、查询、导出。
- 告警规则 CRUD 与触发。
- 系统配置的持久化与生效。
- 四个模块的后端接口与数据表。

---

## Global Constraints

- 权限码：`apikey:view/create/update/delete`、`audit:view`、`alert:view/create/update/delete`、`settings:view/update`。
- 本期只使用 `:view` 控制菜单/路由；写权限码仅用于按钮条件，不接后端。
- 页面必须明确标注“后端接口未实现”，不得展示可提交的写操作，不得伪造保存成功。
- 后端无任何改动；不新增接口、表、迁移。
- 前端 `strict` + `noUnusedLocals` + `noUnusedParameters`；lint/build 必须通过。
- 每个任务提交一次，提交信息使用中文摘要。

---

## Review Focus

1. **假的保存成功**：系统配置页点击“保存”不能只弹 Toast 就结束；本期必须禁用保存并说明后端未实现。
2. **API Key 泄露错觉**：页面上的 Mock Key 必须标注“演示数据”，不能显示成可复制使用的真实密钥。
3. **无权限直达**：四个 URL 在无对应 `:view` 时均跳 `/403`，刷新同样生效。
4. **写按钮门禁**：无 `alert:create` 等权限时按钮不渲染；即使有权限，后端未实现时按钮也应禁用。
5. **菜单分组**：四个页面都无权限时，“系统设置”分组整体隐藏，不留空分组。

---

## File Structure

**修改**

| 文件 | 变更 |
|---|---|
| `app/src/pages/system/ApiKeys.tsx` | 未上线说明、演示数据标注、写操作禁用 |
| `app/src/pages/system/Audit.tsx` | 未上线说明、只读化 |
| `app/src/pages/system/Alerts.tsx` | 未上线说明、写操作禁用 |
| `app/src/pages/system/Settings.tsx` | 未上线说明、表单只读、保存禁用 |
| `app/src/pages/system/index.ts` | 确认导出 |

**复用**

| 文件 | 用途 |
|---|---|
| `app/src/components/ReservedModuleNotice.tsx` | 统一提示条 |

---

### Task 1: API Keys 页面只读化

**Files:**
- Modify: `app/src/pages/system/ApiKeys.tsx`
- Test: `npm run lint` + 手测

- [ ] **Step 1: 增加未上线说明**

```tsx
<ReservedModuleNotice
  moduleName="API 密钥"
  requiredPermission="apikey:view"
  plannedApis={[
    "GET /api/v1/api-keys",
    "POST /api/v1/api-keys",
    "PUT /api/v1/api-keys/{id}",
    "DELETE /api/v1/api-keys/{id}",
  ]}
  note="本期仅保留页面与菜单控制；密钥的权限范围与鉴权后续单独立项。"
/>
```

- [ ] **Step 2: 演示数据标注与写操作禁用**

- 列表标题旁增加“演示数据”标签。
- Key 列显示掩码（如 `sk-****demo`），不提供复制按钮；如需展示，`title="演示数据，不可使用"`。
- “创建密钥”按钮：无 `apikey:create` 时不渲染；有权限时 `disabled` + `title="后端未实现"`。
- 行内启用/禁用、删除：同理，无权限不渲染，有权限但后端未实现时禁用。
- 移除任何实际调用 Mock 写入的逻辑，避免刷新后“看起来保存成功”。

- [ ] **Step 3: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 4: 手测**

1. 页面显示未上线说明与演示标签。
2. 有 `apikey:view` 的用户可查看列表。
3. 无 `apikey:view` 直接访问 `/system/api-keys` 跳 403。
4. 所有写按钮不可用且有原因提示。

- [ ] **Step 5: 提交**

```bash
git add app/src/pages/system/ApiKeys.tsx
git commit -m "feat: API 密钥页只读化并标注未上线"
```

---

### Task 2: 审计日志页面只读化

**Files:**
- Modify: `app/src/pages/system/Audit.tsx`
- Test: `npm run lint` + 手测

- [ ] **Step 1: 增加未上线说明**

```tsx
<ReservedModuleNotice
  moduleName="审计日志"
  requiredPermission="audit:view"
  plannedApis={["GET /api/v1/audit-logs"]}
  note="本期越权访问仅写应用日志；审计模块未实现前不建表。"
/>
```

- [ ] **Step 2: 只读化**

- 保留搜索、时间筛选、表格与分页；数据标注“演示数据”。
- 移除“导出”“清理日志”等写操作；如保留，禁用并说明。
- 不提供删除/编辑入口。

- [ ] **Step 3: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 4: 手测**

1. 页面可查看演示审计记录。
2. 无 `audit:view` 直接访问跳 403。
3. 无可用写操作。

- [ ] **Step 5: 提交**

```bash
git add app/src/pages/system/Audit.tsx
git commit -m "feat: 审计日志页只读化并标注未上线"
```

---

### Task 3: 告警规则页面只读化

**Files:**
- Modify: `app/src/pages/system/Alerts.tsx`
- Test: `npm run lint` + 手测

- [ ] **Step 1: 增加未上线说明**

```tsx
<ReservedModuleNotice
  moduleName="告警规则"
  requiredPermission="alert:view"
  plannedApis={[
    "GET /api/v1/alert-rules",
    "POST /api/v1/alert-rules",
    "PUT /api/v1/alert-rules/{id}",
    "DELETE /api/v1/alert-rules/{id}",
  ]}
/>
```

- [ ] **Step 2: 写操作禁用**

- “创建规则”：无 `alert:create` 不渲染；有权限时 `disabled` + `title="后端未实现"`。
- 行内编辑：无 `alert:update` 不渲染；有权限时禁用。
- 行内删除：无 `alert:delete` 不渲染；有权限时禁用。
- 启用/禁用开关：按 `alert:update` 控制，后端未实现时禁用。
- 规则列表标注“演示数据”。

- [ ] **Step 3: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 4: 手测**

1. 页面可查看演示规则。
2. 无 `alert:view` 直接访问跳 403。
3. 写操作全部不可用并说明原因。

- [ ] **Step 5: 提交**

```bash
git add app/src/pages/system/Alerts.tsx
git commit -m "feat: 告警规则页写操作禁用并标注未上线"
```

---

### Task 4: 系统配置页面只读化

**Files:**
- Modify: `app/src/pages/system/Settings.tsx`
- Test: `npm run lint` + 手测

- [ ] **Step 1: 增加未上线说明**

```tsx
<ReservedModuleNotice
  moduleName="系统配置"
  requiredPermission="settings:view"
  plannedApis={[
    "GET /api/v1/system/settings",
    "PUT /api/v1/system/settings",
  ]}
  note="本期配置不可修改；保存需要 settings:update 且后端接口上线。"
/>
```

- [ ] **Step 2: 表单只读**

- 所有输入框 `disabled` 或 `readOnly`。
- “保存”按钮：无 `settings:update` 不渲染；有权限时 `disabled` + `title="后端未实现"`。
- 移除本地状态保存与“保存成功”Toast。
- 字段旁标注“当前为默认值/演示值”。

- [ ] **Step 3: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 4: 手测**

1. 页面可查看配置项，全部不可编辑。
2. 无 `settings:view` 直接访问跳 403。
3. 保存按钮不可用，点击无“保存成功”提示。
4. 个人 `/settings` 页面不受影响，仍可访问（仅登录）。

- [ ] **Step 5: 提交**

```bash
git add app/src/pages/system/Settings.tsx
git commit -m "feat: 系统配置页只读化并禁用保存"
```

---

### Task 5: 预留模块验收

- [ ] **Step 1: 前端构建**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 2: 手测清单**

| 场景 | 预期 |
|---|---|
| `viewer` 访问四个页面 | 全部跳 403（无对应 view 权限） |
| 管理员访问四个页面 | 页面可见，显示未上线说明 |
| 写操作 | 按钮不渲染或禁用并说明 |
| 系统配置保存 | 不可点击，无成功提示 |
| 权限撤销 | 下一次路由切换跳 403 |
| 菜单分组 | 四个页面全部无权限时，“系统设置”分组隐藏 |

- [ ] **Step 3: 提交**

```bash
git add -A app/src/pages/system
git commit -m "test: 预留系统模块权限与只读化验收"
```

---

## 依赖与顺序

1. 依赖 `前端权限控制-plan.md` 的路由映射、菜单过滤与 `PermissionGuard`。
2. 依赖 `对话日志-plan.md` Task 1 的 `ReservedModuleNotice`。
3. 四个模块后续上线时各自独立立项，必须：
   - 把对应权限码从 `RESERVED_PERMISSION_CODES` 移入已实现集合；
   - 声明路由权限并纳入覆盖率测试；
   - 如涉及业务资源，接入数据过滤；
   - 前端恢复写操作并移除 `ReservedModuleNotice`。

## 风险与决策

| 项 | 决策 |
|---|---|
| API Key 是否可用 | 本期不可用；只保留页面与菜单控制（NG5） |
| 审计是否落库 | 不落库；越权仅写应用日志（NG7） |
| 告警是否触发 | 不触发；本期只读演示 |
| 系统配置是否可改 | 不可改；避免前端本地保存制造生效错觉 |
| 个人设置 | `/settings` 仅登录，不属于本计划，保持现有行为 |
