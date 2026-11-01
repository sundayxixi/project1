# 数据统计 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在数据统计后端模块尚未实现的前提下，完成 `analytics:view` 的菜单/路由门禁与页面“未上线”标识，并明确上线后的数据口径。

**Architecture:** 后端本期不新增接口、不建表。前端保留用量、费用、效果评估三个 Mock 页面骨架，路由与菜单由 `analytics:view` 控制；页面顶部展示“后端未实现、当前为演示数据”，并明确上线后只聚合当前用户可见 Agent 的数据。

**Tech Stack:** React 19 / TypeScript 5.9 / Vite 7 / shadcn-ui；后端无本期改动。

**Spec:** `docs/spec/PROJECT_SPEC_V2.md`（§5.2 预留权限、FR-18、§9.3 预留模块）、`docs/design/ui/RBAC原型设计说明书.md`（§5.11、§5.15）。

**前置计划:** `前端权限控制-plan.md`、`对话日志-plan.md`（复用 `ReservedModuleNotice`）。

---

## 模块说明（产品视角）

### 目标

| 编号 | 目标 | 本计划落点 |
|---|---|---|
| G5 | 无 `analytics:view` 时菜单/路由不可用 | 复用前端路由映射 |
| FR-18 | 统计只聚合当前用户可见 Agent 的数据 | 页面说明 + 上线契约 |
| NG7 | 本期不新增后端接口 | 无后端改动 |

### 交付物

1. 用量、费用、效果评估页面的未上线说明与演示数据标注。
2. 移除或禁用无后端的导出/配置操作。
3. 上线后的统计口径记录。
4. 手测清单。

### 不在本期范围

- 统计聚合表、定时任务、费用计算、评估任务的实现。
- 真实数据范围统计（后端无接口）。
- 图表库接入（V1 待办；本期不引入 Recharts）。

---

## Global Constraints

- 权限码：`analytics:view`，本期仅用于菜单/路由控制。
- 页面必须标注“后端接口未实现、当前为演示数据”，不得暗示已按数据权限统计。
- 上线后统计口径：仅聚合当前用户可见的 Agent 及其对话；不同用户看到的汇总数字可以不同；无可见数据时展示“当前数据范围内暂无可统计的数据”。
- 前端 `strict` + `noUnusedLocals` + `noUnusedParameters`；lint/build 必须通过。
- 不新增后端接口或数据库表。
- 每个任务提交一次，提交信息使用中文摘要。

---

## Review Focus

1. **数字权威错觉**：Mock 汇总数字必须旁注“演示数据”，避免被当成真实经营数据。
2. **无权限访问**：直接输入 `/analytics`、`/analytics/costs`、`/analytics/evaluation` 均跳 `/403`。
3. **写操作**：页面不得出现可点击的导出、保存、配置按钮；如保留必须禁用并说明。
4. **数据范围说明**：页面需明确“上线后按数据权限统计”，不能让用户以为所有人看到同一份汇总。
5. **图表缺失**：未引入图表库时用现有卡片/表格展示，不伪造趋势图。

---

## File Structure

**修改**

| 文件 | 变更 |
|---|---|
| `app/src/pages/analytics/Usage.tsx` | 未上线说明、演示数据标注、移除无后端操作 |
| `app/src/pages/analytics/Costs.tsx` | 同上 |
| `app/src/pages/analytics/Evaluation.tsx` | 同上 |
| `app/src/pages/analytics/index.ts` | 确认导出 |

**复用**

| 文件 | 用途 |
|---|---|
| `app/src/components/ReservedModuleNotice.tsx` | 统一提示条（对话日志计划 Task 1 创建） |

---

### Task 1: 用量统计页

**Files:**
- Modify: `app/src/pages/analytics/Usage.tsx`
- Test: `npm run lint` + 手测

- [ ] **Step 1: 增加提示与标注**

页面顶部：

```tsx
<ReservedModuleNotice
  moduleName="数据统计"
  requiredPermission="analytics:view"
  plannedApis={[
    "GET /api/v1/analytics/usage",
    "GET /api/v1/analytics/agents",
  ]}
  note="上线后仅聚合当前用户可见 Agent 的数据。"
/>
```

- 所有汇总卡片旁增加“演示数据”小标签。
- 表格标题使用“按 Agent 的用量（演示）”。

- [ ] **Step 2: 清理无后端操作**

- 移除“导出 CSV”按钮；如保留，改为 `disabled` + `title="后端未实现"`。
- 移除时间范围选择器的“保存为默认”之类写操作；时间筛选可以保留为纯前端演示。

- [ ] **Step 3: 空状态**

在 Mock 数据为空时展示：

> 当前数据范围内暂无可统计的数据。

- [ ] **Step 4: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 5: 提交**

```bash
git add app/src/pages/analytics/Usage.tsx
git commit -m "feat: 用量统计页增加未上线说明与演示数据标注"
```

---

### Task 2: 费用分析页与效果评估页

**Files:**
- Modify: `app/src/pages/analytics/Costs.tsx`, `app/src/pages/analytics/Evaluation.tsx`
- Test: `npm run lint` + 手测

- [ ] **Step 1: 费用分析页**

- 顶部同样的 `ReservedModuleNotice`，规划接口：
  - `GET /api/v1/analytics/costs`
  - `GET /api/v1/analytics/costs/by-agent`
- 汇总与明细标注“演示数据”。
- 移除“设置预算/保存”等写操作；如保留，禁用并说明。
- 说明“费用由输入/输出 Token × 模型单价计算，范围跟随 Agent 可见性”。

- [ ] **Step 2: 效果评估页**

- 顶部 `ReservedModuleNotice`，规划接口：
  - `GET /api/v1/analytics/evaluation`
- 评估结果表格标注“演示数据”。
- 移除“发起评估/保存评估”等写操作；如保留，禁用并说明。

- [ ] **Step 3: 运行检查**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 4: 手测**

1. 三个统计页面均显示未上线说明。
2. 所有汇总数字带“演示数据”标签。
3. 无可用写操作。
4. 无权限身份直接访问三个 URL 均跳 `/403`。

- [ ] **Step 5: 提交**

```bash
git add app/src/pages/analytics
git commit -m "feat: 费用与评估页增加未上线说明并移除无后端操作"
```

---

### Task 3: 上线契约记录

- [ ] **Step 1: 确认上线时必须完成的三步**

1. 把 `analytics:view` 从 `RESERVED_PERMISSION_CODES` 移入已实现集合。
2. 新增统计接口，声明 `analytics:view`；所有聚合查询先按 `visible_condition(Agent, "agent", ctx)` 过滤 Agent，再聚合对话与费用。
3. 纳入覆盖率测试与数据授权交叉测试（两个用户看到不同汇总）。

- [ ] **Step 2: 确认统计口径**

| 指标 | 口径 |
|---|---|
| Agent 数 | 当前用户可见 Agent 数 |
| 会话数 | 可见 Agent 的会话数 |
| Token | 可见 Agent 的输入 + 输出 Token |
| 费用 | 可见 Agent 的 Token × 模型单价 |
| 评估 | 仅评估可见 Agent 的样本 |
| 无可见数据 | 展示空状态，不显示 0 作为“真实经营数据” |

- [ ] **Step 3: 提交文档更新**

```bash
git add docs/design/ui/plans/数据统计-plan.md
git commit -m "docs: 补充数据统计上线口径"
```

---

### Task 4: 验收

- [ ] **Step 1: 前端构建**

Run: `cd app && npm run lint && npm run build`
Expected: 通过。

- [ ] **Step 2: 手测清单**

| 场景 | 预期 |
|---|---|
| 有 `analytics:view` | 菜单可见，三个页面显示未上线说明 |
| 无权限直接访问 | 跳 `/403?need=analytics:view` |
| 汇总数字 | 带“演示数据”标签 |
| 写操作 | 无可用按钮 |
| 空状态 | 显示“当前数据范围内暂无可统计的数据” |

- [ ] **Step 3: 提交**

```bash
git add -A app/src/pages/analytics
git commit -m "test: 数据统计预留页面权限与未上线标识验收"
```

---

## 依赖与顺序

1. 依赖 `前端权限控制-plan.md` 的路由映射与 `PermissionGuard`。
2. 依赖 `对话日志-plan.md` Task 1 的 `ReservedModuleNotice`。
3. 后端上线时再启动独立计划，必须复用数据授权内核的可见性过滤。

## 风险与决策

| 项 | 决策 |
|---|---|
| 是否伪造趋势图 | 不伪造；未引入图表库前用卡片/表格 |
| 是否在 Mock 中模拟数据范围 | 不做；页面明确“上线后按数据权限统计” |
| 导出/预算/评估写操作 | 本期移除或禁用，上线时随接口接入 |
| 权限码 | 沿用 47 条目录中的 `analytics:view`，不新增 |
