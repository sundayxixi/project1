# 对话日志 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在对话日志后端模块尚未实现的前提下，完成 `conversation:view` 的菜单/路由门禁与页面“未上线”标识，并明确上线后的数据口径。

**Architecture:** 后端本期不新增接口、不建表。前端保留现有 Mock 页面骨架，路由与菜单由 `前端权限控制-plan.md` 的 `conversation:view` 控制；页面顶部展示“后端未实现”的说明，避免用户误以为功能可用。上线时按“所属 Agent 对当前用户可见”在服务端过滤。

**Tech Stack:** React 19 / TypeScript 5.9 / Vite 7 / shadcn-ui；后端无本期改动。

**Spec:** `docs/spec/PROJECT_SPEC_V2.md`（§5.2 预留权限、FR-18、§9.3 预留模块、NG7）、`docs/design/ui/RBAC原型设计说明书.md`（§5.10、§5.15）。

**前置计划:** `前端权限控制-plan.md`。本计划不依赖后端数据授权，但上线设计需遵循其判定。

---

## 模块说明（产品视角）

### 目标

| 编号 | 目标 | 本计划落点 |
|---|---|---|
| G5 | 无 `conversation:view` 时菜单/路由不可用 | 复用前端路由映射 |
| FR-18 | 对话日志只显示可见 Agent 的会话 | 页面说明 + 上线契约 |
| NG7 | 审计日志本期不落库 | 不新增后端表 |

### 交付物

1. 对话日志列表/详情页的“未上线”说明。
2. 列表页按 `conversation:view` 守卫（复用 `前端权限控制-plan.md`）。
3. 上线后的接口与数据口径记录。
4. 手测清单。

### 不在本期范围

- 对话表、会话详情、链路追踪、标注、导出的后端实现。
- 真实数据范围过滤（后端无接口，无法在服务端执行）。
- 运行时对话采集。

---

## Global Constraints

- 权限码：`conversation:view`，本期仅用于菜单/路由控制。
- 页面必须明确标注“后端接口未实现”，不得展示可提交的写操作。
- 数据范围口径：上线后仅显示当前用户可见 Agent 产生的会话；列表按可见 Agent 过滤，详情继承所属 Agent 判定。
- 前端 `strict` + `noUnusedLocals` + `noUnusedParameters`；lint/build 必须通过。
- 不新增任何后端接口或数据库表。
- 每个任务提交一次，提交信息使用中文摘要。

---

## Review Focus

1. **菜单可见 ≠ 功能可用**：有 `conversation:view` 的用户进入页面后必须看到“未上线”说明，不能只显示一张看似正常的 Mock 表格。
2. **无权限访问**：直接输入 `/conversations` 必须跳 `/403`，与菜单隐藏一致。
3. **写操作**：页面不得出现“导出”“标注”等可点击但无后端的按钮；如保留，必须禁用并说明。
4. **数据口径误导**：Mock 数字不能暗示已经按数据权限统计；页面需注明“演示数据”。
5. **权限撤销**：`conversation:view` 被撤销后，下一次路由切换应跳 403。

---

## File Structure

**修改**

| 文件 | 变更 |
|---|---|
| `app/src/pages/conversation/List.tsx` | 增加未上线说明、演示数据标注、移除/禁用无后端操作 |
| `app/src/pages/conversation/Detail.tsx` | 增加未上线说明、链路追踪标注 |
| `app/src/pages/conversation/index.ts` | 无需变更，确认导出 |

**新增**

| 文件 | 职责 |
|---|---|
| `app/src/components/ReservedModuleNotice.tsx` | 通用“未上线”提示条，供对话/统计/预留系统模块复用 |

---

### Task 1: 通用“未上线”提示组件

**Files:**
- Create: `app/src/components/ReservedModuleNotice.tsx`
- Test: `npm run lint`

**Interfaces:**
- Consumes: 无。
- Produces:

```tsx
export function ReservedModuleNotice(props: {
  moduleName: string
  requiredPermission: string
  plannedApis?: string[]
  note?: string
}): JSX.Element
```

- [ ] **Step 1: 实现组件**

样式建议：

- 浅琥珀底 + 左侧竖线，不使用大面积警告色。
- 标题：“{moduleName} 后端接口未实现”。
- 正文：“本页仅用于菜单与权限验证，当前数据为演示数据，不代表真实统计。”
- 列出所需权限码与规划中的接口（可选）。
- 不允许出现“保存/提交/导出”等可点击写操作。

- [ ] **Step 2: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add app/src/components/ReservedModuleNotice.tsx
git commit -m "feat: 增加预留模块未上线提示组件"
```

---

### Task 2: 对话日志列表与详情

**Files:**
- Modify: `app/src/pages/conversation/List.tsx`, `app/src/pages/conversation/Detail.tsx`
- Test: `npm run lint` + 手测

**Interfaces:**
- Consumes: `ReservedModuleNotice`、`Can`、`usePermission`。
- Produces: 带未上线标识的页面骨架。

- [ ] **Step 1: 列表页**

- 页面顶部插入：

```tsx
<ReservedModuleNotice
  moduleName="对话日志"
  requiredPermission="conversation:view"
  plannedApis={[
    "GET /api/v1/conversations",
    "GET /api/v1/conversations/{id}",
  ]}
  note="上线后仅显示当前用户可见 Agent 产生的会话。"
/>
```

- 保留现有 Mock 列表与筛选；表格标题旁增加“演示数据”标签。
- 移除“导出”按钮；如保留，改为 `disabled` 并 `title="后端未实现"`。
- 行内“标注”入口移除或禁用并说明。

- [ ] **Step 2: 详情页**

- 顶部同样插入 `ReservedModuleNotice`。
- 链路追踪步骤保留展示，但标注“演示数据，后端未接入”。
- 不提供任何保存/提交操作。

- [ ] **Step 3: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 4: 手测**

1. `viewer` 进入 `/conversations`：显示页面与未上线说明。
2. 无 `conversation:view` 的身份直接访问：跳 `/403?need=conversation:view`。
3. 页面无可用写操作。

- [ ] **Step 5: 提交**

```bash
git add app/src/pages/conversation
git commit -m "feat: 对话日志页面增加未上线说明与演示数据标注"
```

---

### Task 3: 上线契约记录

**Files:**
- 本文档“上线契约”章节（无需新增代码文件）

- [ ] **Step 1: 确认上线时必须完成的三步**

1. 在 `src/core/permissions.py` 中把 `conversation:view` 从 `RESERVED_PERMISSION_CODES` 移入已实现集合（保留权限码不变）。
2. 新增 `/api/v1/conversations` 路由，声明 `conversation:view`；列表按 `visible_condition(Agent, "agent", ctx)` 过滤所属 Agent。
3. 把对话接口纳入 `test/test_rbac_coverage.py` 与数据授权交叉测试。

- [ ] **Step 2: 确认数据口径**

| 资源 | 口径 |
|---|---|
| 会话列表 | `conversation:view` + 所属 Agent 对当前用户可见 |
| 会话详情 | 继承所属 Agent 的 view 判定 |
| 链路追踪 | 随会话详情返回；不单独授权 |
| 导出（未来） | 必须复用同一过滤条件，不得绕过 |

- [ ] **Step 3: 提交文档更新**

```bash
git add docs/design/ui/plans/对话日志-plan.md
git commit -m "docs: 补充对话日志上线契约"
```

---

### Task 4: 验收

- [ ] **Step 1: 前端构建**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 2: 手测清单**

| 场景 | 预期 |
|---|---|
| 有 `conversation:view` | 菜单可见，页面显示未上线说明 |
| 无权限直接访问 | 跳 `/403` |
| 写操作 | 无可用按钮 |
| 数据标注 | 明确“演示数据” |
| 权限撤销 | 下一次路由切换跳 403 |

- [ ] **Step 3: 提交**

```bash
git add -A app/src/pages/conversation
git commit -m "test: 对话日志预留页面权限与未上线标识验收"
```

---

## 依赖与顺序

1. 依赖 `前端权限控制-plan.md` 的路由映射、菜单过滤与 `PermissionGuard`。
2. `ReservedModuleNotice` 会被 `数据统计-plan.md`、`预留系统模块-plan.md` 复用；建议先完成本计划 Task 1。
3. 后端上线时再启动独立计划，必须遵循 `数据级授权内核-plan.md` 的判定方式。

## 风险与决策

| 项 | 决策 |
|---|---|
| 是否保留 Mock 对话数据 | 保留，但明确标注“演示数据”，避免误认为真实统计 |
| 是否在 Mock 中模拟数据范围 | 不做；后端无接口时客户端过滤会制造“已实现”的错觉 |
| 导出/标注 | 本期移除或禁用；上线时随接口一起接入 |
| 权限码 | 沿用 47 条目录中的 `conversation:view`，不新增 |
