# 辰光 Agent 平台 — 产品需求文档 V2（RBAC 功能授权 + 数据级授权）

| 项目 | 内容 |
|---|---|
| 文档名称 | PROJECT_SPEC_V2.md |
| 版本 | v2.0（含数据级授权） |
| 状态 | 需求已对齐，待评审 |
| 编写日期 | 2026-10-25 |
| 需求主题 | 在现有用户/角色/权限数据模型之上，补齐 **RBAC 功能授权**（接口 + 前端菜单/路由/按钮）与 **数据级授权**（数据归属、数据范围、资源级共享） |
| 关联文档 | `docs/PROJECT_SPEC.md`（项目说明书 V1）、`app/docs/09-系统管理.md`（系统管理 UI 设计） |
| 约束 | 本文档为需求文档，不含实现代码；实现阶段另行编写技术方案与任务计划 |

---

## 一、背景

平台已经具备 RBAC 的**数据基础**：`users`、`roles`、`permissions` 三张表以及 `user_roles`、`role_permissions` 两张关联表已落库，用户/角色/权限的增删改查接口可正常调用，种子数据中有管理员与运营人员两类角色。

但当前 RBAC 只停留在"**能配置**"，没有进入"**能生效**"：

- 全项目只有 `/api/v1/users/me` 与一个知识库上传接口使用了 `get_current_user`，其余业务接口（Agent、模型、Prompt、知识库、工具、供应商、系统管理）**均未校验登录态，更未校验权限**。
- 登录成功后只下发 JWT，前端拿不到"我是谁、我有哪些权限"，侧边栏和路由只判断"是否已登录"。
- 权限码粒度不统一：`user:list` 是细粒度，`agent:*` / `model:*` 等是整模块通配，与 `app/docs/09-系统管理.md` 中已设计的「模块 × 查看/创建/编辑/删除/发布」矩阵对不上。
- **数据层面完全没有隔离**：业务资源没有可靠的所有者字段。`agents`、`prompts`、`knowledge_bases`、`tools` 表中虽有 `created_by`（String），但创建接口从未传入当前用户（[agent/service.py:31](src/modules/agent/service.py#L31)），实际值恒为 `NULL`；列表与详情接口也不做任何归属过滤。任何登录用户只要知道 ID，就能读取、修改、删除他人的 Agent / Prompt / 知识库 / 工具。

因此本次需求分为两层：

1. **功能授权**：谁可以调用哪个接口、看到哪个菜单、点击哪个按钮。
2. **数据级授权**：在通过功能授权的前提下，能操作**哪些数据行**——自己的、指定人的、指定角色创建的，还是全部；以及单个资源可以额外共享给谁。

### 1.1 现状问题清单

| 编号 | 问题 | 影响 |
|---|---|---|
| P1 | 无统一鉴权入口，业务接口不校验权限 | 任何登录用户可执行任意操作；未登录也可调用大部分接口 |
| P2 | 大量接口连登录态都不校验 | 接口裸奔，安全风险 |
| P3 | 权限码粒度混乱（细粒度与通配混用） | 无法表达"可查看不可删除"这类最小权限 |
| P4 | Permission 无模块/动作元数据 | 前端权限页靠 code 前缀猜测分组，无法渲染权限矩阵 |
| P5 | Role 无 `is_system` 字段 | 内置角色（含 admin）可被删除/改编码，存在把管理员锁死的风险 |
| P6 | 登录仅返回 token | 前端无法做菜单/按钮级控制 |
| P7 | 前端只有登录守卫，无权限守卫 | 越权页面可通过直接输入 URL 进入 |
| P8 | 后端业务异常统一返回 HTTP 200 + body `code`，而前端仅对 HTTP 401 跳登录 | token 过期时前端不会跳转登录，401 处理实际失效 |
| P9 | 权限目录与 UI 设计稿不一致（现 2 角色 / 12 码，设计稿 4 角色 / 模块×动作矩阵） | 管理端页面无法按设计稿落地 |
| P10 | 对话日志、数据统计、API Key、审计日志、告警规则、系统配置在后端尚无接口 | 权限矩阵需要明确这些模块的控制范围 |
| P11 | 业务资源无可靠所有者：`created_by` 存在但从未写入 | 无法判断"这是谁的数据"，数据隔离无从谈起 |
| P12 | 列表/详情/写接口无数据过滤 | 知道 ID 即可越权访问他人资源 |
| P13 | 无资源级共享能力 | 协作只能靠"给全部权限"，违反最小权限 |
| P14 | 角色只有功能权限配置，无数据范围配置 | 无法表达"开发者只能管理自己创建的 Agent" |

---

## 二、目标与非目标

### 2.1 目标

| 编号 | 目标 |
|---|---|
| G1 | 所有 `/api/v1` 业务接口默认要求登录 + 对应权限，未授权访问返回明确错误 |
| G2 | 权限码统一为 `资源:动作` 细粒度，覆盖设计稿的 8 个业务域与系统管理子域 |
| G3 | 内置 4 个角色（管理员/开发者/运营/只读），内置角色不可删除、编码不可修改 |
| G4 | 授权变更（改角色权限、改用户角色、删角色、禁用/删除用户）**立即生效** |
| G5 | 前端根据权限集合控制菜单可见性、路由访问、页面内操作按钮 |
| G6 | 角色权限配置以「模块 × 动作」矩阵方式呈现，与设计稿一致 |
| G7 | 权限目录由系统内置维护，管理端只读展示，避免与后端执行点漂移 |
| G8 | 提供鉴权覆盖率自动化保障：新增接口未声明权限且不在白名单时测试失败 |
| G9 | 业务资源有明确所有者（`owner_id`），创建时自动写入 |
| G10 | 角色可配置每个资源类别的**查看范围**与**管理范围**：全部 / 本人 / 指定用户 / 指定角色 |
| G11 | 列表、详情、写操作均按数据范围过滤或拒绝，不能靠前端绕过 |
| G12 | 资源所有者可将单个资源共享给指定用户或角色（只读 / 可管理），共享立即生效 |
| G13 | 数据级授权的变更同样立即生效，无缓存延迟 |

### 2.2 非目标（本期不做）

| 编号 | 非目标 | 说明 |
|---|---|---|
| NG1 | 部门/组织架构 | 不以部门树为单位隔离数据；数据范围用「全部/本人/指定用户/指定角色」表达。未来可扩展 `subject_type=department` |
| NG2 | 字段级权限 | 不做"隐藏某个字段"级别的控制 |
| NG3 | 多租户 | 不引入 tenant 概念 |
| NG4 | SSO / LDAP / OAuth 第三方登录 | 继续使用用户名 + 密码 + 验证码 |
| NG5 | API Key 的权限范围与鉴权 | `/system/api-keys` 仅保留页面与菜单控制，后续单独立项 |
| NG6 | 权限申请 / 审批流 / 临时授权 / 授权到期 | 不做 |
| NG7 | 审计日志落库 | 越权访问仅写应用日志，审计模块未实现前不建表 |
| NG8 | 运行时数据隔离 | 数据授权只作用于**管理端 API**；已发布 Agent 对终端用户的运行时调用不受影响（后续单独立项） |
| NG9 | 跨用户的"公开市场/资源广场" | 不做对外公开资源浏览，仅支持点对点共享 |
| NG10 | 系统管理资源的数据隔离 | 用户、角色、权限、模型、供应商等平台级资源仍由功能权限控制，不做行级隔离 |
| NG11 | 修改现有 API 响应结构 | 除新增字段外，响应格式保持不变 |

### 2.3 成功标准

1. 未登录访问任意受保护接口返回 401 语义错误；登录但无功能权限返回 403。
2. 管理员取消某角色的 `agent:delete` 后，该角色下的在线用户**下一次请求**即无法删除 Agent。
3. 只读角色登录后只显示有权访问的模块，直接输入无权 URL 被拦截到 403 页，写操作按钮不渲染。
4. 数据范围为「本人」的开发者，在 Agent 列表中**看不到**他人的 Agent，直接访问他人 Agent 详情返回 403，修改/删除同样被拒。
5. 管理员把某知识库共享给运营角色后，运营用户**下一次请求**即可在列表中看到并编辑该知识库。
6. 新增一个未声明权限的接口时，CI 中的鉴权覆盖率测试失败。

---

## 三、用户与典型场景

### 3.1 角色画像

| 内置角色 | code | 画像 | 主要诉求 |
|---|---|---|---|
| 管理员 | `admin` | 平台负责人 / 运维 | 管理用户与角色、全平台配置、查看全部数据 |
| 开发者 | `developer` | Agent / Prompt 开发者 | 创建与调试 Agent、Prompt、知识库、工具；协作时共享资源 |
| 运营 | `operator` | 业务运营人员 | 查看业务数据、维护知识库内容 |
| 只读 | `viewer` | 观察者 / 外部协作方 | 只查看，不产生任何变更 |

> `is_superuser=true` 的账号（初始 admin 账号）拥有全部功能权限与全部数据，跳过一切校验，作为防锁死的最终兜底。

### 3.2 典型场景

- **S1 配置功能权限**：管理员打开「开发者」的权限矩阵，取消 `知识库-删除`，保存后立即生效。
- **S2 功能权限即时撤销**：运营人员正在使用系统，管理员取消其「知识库-编辑」；运营下一次提交编辑请求即被拒绝。
- **S3 只读用户访问**：只读用户只看到业务菜单的查看入口；直接访问 `/system/users` 被导向 403 页。
- **S4 数据隔离**：开发者 A 的数据范围为「本人」，只能看到自己创建的 Agent / Prompt / 知识库 / 工具；看不到开发者 B 的资源。
- **S5 资源分享**：开发者 A 把自己创建的知识库共享给开发者 B（可管理）；B 的列表中立刻出现该知识库并可编辑，B 仍不能删除 A 的其他资源。
- **S6 指定角色范围**：运营角色的知识库查看范围配置为「指定角色：开发者」，运营可查看所有开发者创建的知识库，但看不到管理员创建的。
- **S7 撤销授权即时生效**：管理员取消某用户的「运营」角色，该用户下一次请求即失去对应功能权限与数据范围。
- **S8 归属转移**：开发者离职，管理员把其名下的 Agent 转移给另一位开发者。
- **S9 停用账号**：管理员禁用某用户后，其后续请求立即返回 401，已签发 token 失效。
- **S10 新接口**：开发者新增一个 Agent 导出接口，必须声明权限并接入数据过滤，否则覆盖率测试失败。

---

## 四、授权模型总览

### 4.1 两层授权

```
第一层：功能授权（能不能做这件事）
  User ──M:N──> Role ──M:N──> Permission（资源:动作）
  例：developer 拥有 agent:create / agent:update / agent:delete

第二层：数据授权（能做的话，能对哪些数据做）
  1) 数据归属：每条业务资源有 owner_id
  2) 角色数据范围：每个角色对每类资源配置「查看范围 / 管理范围」
       ALL    全部数据
       SELF   本人创建
       CUSTOM 指定用户 + 指定角色创建的数据
  3) 资源级共享：单个资源额外授权给指定用户/角色（view / manage）

最终判定：
  功能权限通过 AND 数据访问通过  → 允许
```

### 4.2 资源分类

| 类别 | 资源 | 是否做数据级授权 | 说明 |
|---|---|---|---|
| 业务资源 | Agent、Prompt、知识库、工具 | ✅ | 有归属、可配置数据范围、可共享 |
| 派生资源 | 知识库文档/分段、Agent/Prompt 版本 | ✅（继承） | 可见性完全继承父资源，不单独授权 |
| 统计资源 | 对话日志、数据统计 | ✅（派生） | 对话日志随所属 Agent 的可见性；统计只聚合可见数据 |
| 平台资源 | 模型、供应商、用户、角色、权限、API Key、审计、告警、系统配置 | ❌ | 仅受功能权限控制；模型/供应商为平台级共享资产 |

### 4.3 数据归属

- `agents`、`prompts`、`knowledge_bases`、`tools` 增加 `owner_id`（BIGINT，FK `users.id`，索引，迁移后非空）。
- 创建接口必须写入 `owner_id = 当前登录用户`，同时把 `created_by` 同步为用户名（保留字段以兼容前端展示）。
- 现有 `created_by` 为 NULL 的历史数据，迁移时统一归属给初始 admin 用户。
- 归属只在两种情况下变化：管理员/所有者执行「转移归属」；用户删除时的受控处理（见 FR-17）。

---

## 五、功能授权

### 5.1 权限码规范

**格式**：`资源:动作`，全小写英文，资源名使用单数英文名词，动作为固定枚举。

| 动作 | 含义 | 典型接口 |
|---|---|---|
| `view` | 查看列表 / 详情 / 版本 / 统计 | GET |
| `create` | 新建资源、上传、注册 | POST（创建类） |
| `update` | 编辑配置、启停、重试、测试连接 | PUT / PATCH / 部分 POST |
| `delete` | 删除资源 | DELETE |
| `publish` | 发布新版本、回滚版本 | POST（发布/回滚） |

**特殊操作归属**：

| 特殊操作 | 归属权限 |
|---|---|
| Agent 启动 / 停止 | `agent:update` |
| Agent / Prompt 发布、回滚 | `agent:publish` / `prompt:publish` |
| 供应商测试连接 | `model:update` |
| 知识库重试文档、编辑分段、更新配置 | `knowledge:update` |
| 知识库删除文档 / 分段 | `knowledge:delete` |
| 知识库检索测试 | `knowledge:view` |
| 工具启用 / 禁用 / 测试调用 | `tool:update` |
| 给用户分配角色 | `user:update` |
| 给角色分配权限 / 数据范围 | `role:update` |
| 共享资源 / 转移归属 | `<资源>:update` + 数据管理权限 |

### 5.2 权限码总表（47 条）

> 「状态」为 **已实现** 表示后端已有对应接口并纳入强制校验；**预留** 表示后端模块尚未实现，本期仅用于前端菜单/路由控制。

#### 业务模块（24 条）

| 模块 | 权限码 | 名称 | 状态 |
|---|---|---|---|
| Agent | `agent:view` | 查看 Agent | 已实现 |
| Agent | `agent:create` | 创建 Agent | 已实现 |
| Agent | `agent:update` | 编辑 Agent / 启停 | 已实现 |
| Agent | `agent:delete` | 删除 Agent | 已实现 |
| Agent | `agent:publish` | 发布 / 回滚版本 | 已实现 |
| 模型 | `model:view` | 查看模型与供应商 | 已实现 |
| 模型 | `model:create` | 添加模型 / 供应商 | 已实现 |
| 模型 | `model:update` | 编辑模型 / 测试连接 | 已实现 |
| 模型 | `model:delete` | 删除模型 / 供应商 | 已实现 |
| Prompt | `prompt:view` | 查看 Prompt | 已实现 |
| Prompt | `prompt:create` | 创建 Prompt | 已实现 |
| Prompt | `prompt:update` | 编辑 Prompt | 已实现 |
| Prompt | `prompt:delete` | 删除 Prompt | 已实现 |
| Prompt | `prompt:publish` | 发布 / 回滚版本 | 已实现 |
| 知识库 | `knowledge:view` | 查看知识库 / 文档 / 分段 | 已实现 |
| 知识库 | `knowledge:create` | 创建知识库 / 上传文档 | 已实现 |
| 知识库 | `knowledge:update` | 编辑配置 / 分段 / 重试 | 已实现 |
| 知识库 | `knowledge:delete` | 删除知识库 / 文档 / 分段 | 已实现 |
| 工具 | `tool:view` | 查看工具 | 已实现 |
| 工具 | `tool:create` | 注册工具 | 已实现 |
| 工具 | `tool:update` | 编辑 / 启停 / 测试工具 | 已实现 |
| 工具 | `tool:delete` | 删除工具 | 已实现 |
| 对话日志 | `conversation:view` | 查看对话记录 | 预留 |
| 数据统计 | `analytics:view` | 查看用量与费用统计 | 预留 |

#### 系统管理（23 条）

| 模块 | 权限码 | 名称 | 状态 |
|---|---|---|---|
| 用户管理 | `user:view` | 查看用户 | 已实现 |
| 用户管理 | `user:create` | 创建用户 | 已实现 |
| 用户管理 | `user:update` | 编辑用户 / 分配角色 | 已实现 |
| 用户管理 | `user:delete` | 删除用户 | 已实现 |
| 角色管理 | `role:view` | 查看角色 | 已实现 |
| 角色管理 | `role:create` | 创建角色 | 已实现 |
| 角色管理 | `role:update` | 编辑角色 / 分配权限 / 数据范围 | 已实现 |
| 角色管理 | `role:delete` | 删除角色 | 已实现 |
| 权限管理 | `permission:view` | 查看权限目录 | 已实现 |
| 权限管理 | `permission:create` | 创建权限 | 已实现（管理端不开放） |
| 权限管理 | `permission:update` | 编辑权限 | 已实现（管理端不开放） |
| 权限管理 | `permission:delete` | 删除权限 | 已实现（管理端不开放） |
| API 密钥 | `apikey:view` | 查看 API Key | 预留 |
| API 密钥 | `apikey:create` | 创建 API Key | 预留 |
| API 密钥 | `apikey:update` | 启用 / 禁用 API Key | 预留 |
| API 密钥 | `apikey:delete` | 删除 API Key | 预留 |
| 审计日志 | `audit:view` | 查看审计日志 | 预留 |
| 告警规则 | `alert:view` | 查看告警规则 | 预留 |
| 告警规则 | `alert:create` | 创建告警规则 | 预留 |
| 告警规则 | `alert:update` | 编辑告警规则 | 预留 |
| 告警规则 | `alert:delete` | 删除告警规则 | 预留 |
| 系统配置 | `settings:view` | 查看系统配置 | 预留 |
| 系统配置 | `settings:update` | 修改系统配置 | 预留 |

### 5.3 内置角色功能权限矩阵

图例：✅ 有权限，— 无权限。

| 模块 | 动作 | 管理员 admin | 开发者 developer | 运营 operator | 只读 viewer |
|---|---|:--:|:--:|:--:|:--:|
| Agent | view | ✅ | ✅ | ✅ | ✅ |
| Agent | create | ✅ | ✅ | — | — |
| Agent | update | ✅ | ✅ | — | — |
| Agent | delete | ✅ | — | — | — |
| Agent | publish | ✅ | ✅ | — | — |
| 模型 | view | ✅ | ✅ | ✅ | ✅ |
| 模型 | create | ✅ | — | — | — |
| 模型 | update | ✅ | — | — | — |
| 模型 | delete | ✅ | — | — | — |
| Prompt | view | ✅ | ✅ | ✅ | ✅ |
| Prompt | create | ✅ | ✅ | — | — |
| Prompt | update | ✅ | ✅ | — | — |
| Prompt | delete | ✅ | ✅ | — | — |
| Prompt | publish | ✅ | ✅ | — | — |
| 知识库 | view | ✅ | ✅ | ✅ | ✅ |
| 知识库 | create | ✅ | ✅ | ✅ | — |
| 知识库 | update | ✅ | ✅ | ✅ | — |
| 知识库 | delete | ✅ | — | — | — |
| 工具 | view | ✅ | ✅ | ✅ | ✅ |
| 工具 | create | ✅ | ✅ | — | — |
| 工具 | update | ✅ | ✅ | — | — |
| 工具 | delete | ✅ | — | — | — |
| 对话日志 | view | ✅ | ✅ | ✅ | ✅ |
| 数据统计 | view | ✅ | ✅ | ✅ | ✅ |
| 系统管理（用户/角色/权限/APIKey/审计/告警/配置） | 全部 | ✅ | — | — | — |

> 内置角色的权限集是初始默认值，管理员可在角色页调整；内置角色本身不可删除、编码不可修改。
> 管理员的全量能力来自实际分配的权限与数据范围，防锁死依靠 `is_superuser` 账号。

### 5.4 角色与权限的保护规则

| 规则 | 说明 |
|---|---|
| R1 | `roles.is_system = true` 的角色不可删除，`code` 不可修改，`name`/`description` 可修改 |
| R2 | 内置角色（admin/developer/operator/viewer）由迁移脚本创建，不允许重复创建同 code 角色 |
| R3 | 删除角色前必须无关联用户，否则拒绝并提示 |
| R4 | 用户不能删除自己、不能禁用自己、不能修改自己的角色 |
| R5 | 系统至少保留一个 `is_superuser = true` 且启用的用户 |
| R6 | 内置权限目录只读；角色与权限的变更记录到应用日志 |
| R7 | 角色的数据范围配置随角色删除一并清理；引用该角色的 ACL 条目失效 |

---

## 六、数据级授权

### 6.1 数据范围（Data Scope）

**作用对象**：角色 × 资源类别。

**资源类别**（可配置数据范围的 4 类）：`agent`、`prompt`、`knowledge`、`tool`。

**两个维度**：

| 维度 | 作用 | 说明 |
|---|---|---|
| 查看范围 `view_scope` | 能否在列表看到、能否读取详情 | 作用于 GET |
| 管理范围 `manage_scope` | 能否编辑、删除、发布、启停、上传、共享、转移 | 作用于写操作 |

**创建不受数据范围限制**：只要拥有 `<资源>:create` 功能权限即可创建，创建后 `owner_id` 自动为本人。

**范围取值**：

| 取值 | 含义 | 匹配规则 |
|---|---|---|
| `ALL` | 全部数据 | 不限制 |
| `SELF` | 仅本人数据 | `owner_id = 当前用户` |
| `CUSTOM` | 指定用户 + 指定角色 | `owner_id ∈ 指定用户` 或 `owner_id 所属角色 ∩ 指定角色 ≠ ∅` |

**CUSTOM 语义说明**：

- 「指定用户」表示**这些用户创建的数据**可见/可管理。
- 「指定角色」表示**当前拥有这些角色的用户所创建的数据**可见/可管理；按查询时的角色归属实时计算，不做快照。
- 目标用户/角色被删除后自动失效；角色被删除时其作为 ACL 主体的条目同步清理。

### 6.2 多角色合并规则

用户可能拥有多个角色，有效数据范围按**并集**计算，逐维度（view / manage）独立计算：

1. 任一角色的该维度范围为 `ALL` → 结果为 `ALL`。
2. 否则，合并所有角色的 `SELF` 与 `CUSTOM` 目标 → 结果为「本人 + 各角色自定义目标」的并集。
3. `is_superuser=true` → 两维度均为 `ALL`。

> 只有并集，没有显式拒绝（deny）规则。

### 6.3 资源级共享（ACL）

数据范围解决"按角色批量授权"，资源级共享解决"单个资源点对点协作"。

| 项 | 规则 |
|---|---|
| 可共享的资源 | Agent、Prompt、知识库、工具 |
| 授权主体 | 用户（`user`）或角色（`role`） |
| 访问级别 | `view`（只读）/ `manage`（可管理，隐含只读） |
| 授予人 | 资源所有者，或对资源拥有管理数据权限且具备 `<资源>:update` 功能权限的用户 |
| 生效时机 | 立即生效，无缓存延迟 |
| 与功能权限的关系 | ACL 只解决数据层；用户仍需具备对应的功能权限才能执行操作 |
| 与数据范围的关系 | 取并集：数据范围 + 共享授权 |
| 禁止事项 | 不能共享给"所有人"；如需全员可见，使用数据范围 `ALL` |
| 生命周期 | 资源删除时级联删除 ACL；主体用户/角色删除时清理对应条目 |
| 权限级别变更 | 支持 view ↔ manage 调整，由授予人或管理员操作 |

### 6.4 有效数据访问判定

对某条资源 `R`、当前用户 `U`、操作维度 `D`（view / manage）：

```
1. U.is_superuser                      → 允许
2. R.owner_id == U.id                  → 允许（所有者天然拥有 manage，含 view）
3. ACL：
   - 存在 ACL(U, R, manage)            → D 允许
   - 存在 ACL(U, R, view) 且 D = view   → 允许
   - 存在 ACL(role ∈ U.roles, R, level) → 同级别判定
4. 角色数据范围：
   - 合并后的 D 维度范围为 ALL          → 允许
   - 范围为 SELF                        → owner_id == U.id 才允许
   - 范围为 CUSTOM                      → owner_id 命中目标用户/角色才允许
5. 以上均不满足                        → 拒绝
```

**最终放行条件** = 功能权限通过 **且** 对应维度的数据访问通过。

> 示例：开发者 B 拥有 `knowledge:update`，但知识库 A 的 owner 是开发者 A、B 既不在数据范围内也没有 ACL → B 可以点"编辑"（按钮是否显示取决于 ACL/范围，见 FR-09），但提交时后端返回 403。

### 6.5 内置角色数据范围默认值

| 资源类别 | 管理员 | 开发者 | 运营 | 只读 |
|---|---|---|---|---|
| Agent | view ALL / manage ALL | view ALL / manage SELF | view ALL / manage SELF | view ALL / manage SELF |
| Prompt | view ALL / manage ALL | view ALL / manage SELF | view ALL / manage SELF | view ALL / manage SELF |
| 知识库 | view ALL / manage ALL | view ALL / manage SELF | view ALL / **manage ALL** | view ALL / manage SELF |
| 工具 | view ALL / manage ALL | view ALL / manage SELF | view ALL / manage SELF | view ALL / manage SELF |

说明：

- 开发者「查看全部、管理本人」：便于复用他人的 Agent/Prompt，但不能修改他人资产；需要协作时由所有者共享（ACL）或管理员调整数据范围。
- 运营「知识库管理全部」：符合运营维护知识库内容的职责；其余资源无写功能权限，范围不产生实际影响。
- 只读角色没有写功能权限，manage 范围仅作为配置完整性保留。
- 以上均为初始默认值，管理员可调整。

### 6.6 派生资源与统计口径

| 资源 | 数据访问口径 |
|---|---|
| 知识库文档、分段 | 完全继承所属知识库的访问判定；对知识库有 manage 才能上传/删除/编辑文档与分段 |
| Agent 版本、Prompt 版本 | 继承父资源；查看版本需父资源 view，发布/回滚需父资源 manage |
| 工具调用测试 | 需工具 manage |
| 对话日志 | 需 `conversation:view` 功能权限 **且** 所属 Agent 对当前用户可见；列表按可见 Agent 过滤 |
| 数据统计 | 仅聚合当前用户可见的 Agent / 对话；无可见数据时展示空状态 |
| 模型、供应商 | 平台级资源，不做数据隔离，由功能权限控制 |

### 6.7 数据授权的生效与缓存

- 功能权限与数据范围合并缓存在 Redis（key `rbac:user:{user_id}`，TTL 300 秒），内容包含权限码集合与编译后的数据范围。
- 以下变更必须同步失效缓存：角色权限变更、角色数据范围变更、用户角色变更、角色删除、用户禁用/删除、权限目录迁移。
- ACL **不进入用户缓存**：资源详情/写操作实时查询 ACL；列表查询通过 SQL `EXISTS` 子查询实时判定，保证共享与取消共享立即生效。
- ACL 数据量较大时通过索引保障：`(resource_type, resource_id)`、`(subject_type, subject_id)`。

### 6.8 边界规则

| 场景 | 规则 |
|---|---|
| 用户删除 | 若该用户仍拥有业务资源 → 拒绝删除，提示先转移归属；若仅出现在 ACL 主体中 → 清理其 ACL 条目 |
| 角色删除 | 清理该角色的数据范围配置；清理以该角色为主体的 ACL；该角色下用户需先解绑（R3） |
| 用户禁用 | 不影响资源归属；其资源仍按原 owner 判定，管理员可转移 |
| 归属转移 | 需要操作者对资源有 manage 数据权限且具备 `<资源>:update`；新所有者必须是启用状态的用户；记录应用日志 |
| 数据范围被收紧 | 立即生效；原先可见的资源从列表消失，详情请求返回 403 |
| 资源 owner 被删除 | 删除用户前必须转移，避免产生无主资源 |
| 多个 CUSTOM 目标重叠 | 并集去重 |
| 自定义目标数量 | 单角色单资源类别的自定义用户+角色总数上限 1000，超出时配置保存失败并提示 |
| 资源不存在 vs 无权限 | 统一返回"资源不存在或无权限访问"（403 + 业务码），不区分，避免通过响应差异探测资源是否存在 |

---

## 七、功能需求

### FR-01 认证与身份

- 登录仍为 `POST /api/v1/auth/login`（验证码 + 用户名密码），成功后返回 JWT。
- JWT 载荷**不包含权限集合与数据范围**，仅保留 `sub`、username、email。
- 受保护接口统一解析身份；token 无效/过期返回 `code=401`，账号不存在/被禁用返回 `code=401`。
- 前端收到 401 语义错误（HTTP 401 或 `code=401`）时清除本地 token 并跳转登录页。

### FR-02 接口功能鉴权

- 除白名单外，所有 `/api/v1` 接口必须声明所需权限码。
- 校验顺序：解析 token → 校验账号启用 → 超级管理员放行 → 取权限集合 → 判断权限 → 数据层判定。
- 未登录：`code=401`；无功能权限：`code=403`，消息包含所需权限码，如 `无权限访问（需要 agent:create）`。
- 沿用项目现有的 HTTP 200 + body code 响应约定；前端统一拦截 `code=403`。
- 白名单（免权限码校验）：

| 接口 | 说明 |
|---|---|
| `POST /api/v1/auth/login` | 登录 |
| `GET /api/v1/captcha`、`POST /api/v1/captcha` | 验证码 |
| `GET /api/v1/users/me` | 仅要求登录 |
| `GET /health` | 健康检查 |
| `/docs`、`/redoc`、`/openapi.json` | 接口文档（生产可关闭） |

- 未在权限映射中登记的接口默认**拒绝**（403）。

### FR-03 权限缓存与即时失效

- 缓存 key `rbac:user:{user_id}`，TTL 300 秒，内容：权限码集合 + 编译后的数据范围（每类资源的 view/manage 范围与目标集合）。
- 未命中时查库计算并回填；Redis 不可用时降级查库，不阻断业务。
- 授权变更同步失效缓存：

| 变更操作 | 失效范围 |
|---|---|
| 给角色分配权限 | 该角色下所有用户 |
| 修改角色数据范围 | 该角色下所有用户 |
| 给用户分配角色 | 该用户 |
| 删除角色 | 原关联该角色的所有用户 |
| 禁用 / 删除用户 | 该用户 |
| 数据迁移 / 种子执行 | 全部 `rbac:user:*` |
| 资源分享 / 取消分享 | 不涉及用户缓存；ACL 实时查询，立即生效 |

- 失效失败时记录错误日志，依赖 TTL 最终收敛；多实例共享 Redis。

### FR-04 当前用户权限接口

- `GET /api/v1/users/me` 新增字段：

```json
{
  "id": 1,
  "username": "admin",
  "email": "admin@example.com",
  "is_active": true,
  "is_superuser": true,
  "roles": [{ "id": 1, "code": "admin", "name": "管理员" }],
  "permissions": ["agent:view", "agent:create", "..."],
  "data_scopes": {
    "agent":     { "view": "ALL", "manage": "ALL" },
    "prompt":    { "view": "ALL", "manage": "ALL" },
    "knowledge": { "view": "ALL", "manage": "ALL" },
    "tool":      { "view": "ALL", "manage": "ALL" }
  }
}
```

- `permissions` 为合并去重后的权限码；超级管理员返回全量权限码，`data_scopes` 全部为 `ALL`。
- 该接口走缓存，可被前端在路由切换时频繁调用。

### FR-05 角色管理

- 角色 CRUD 保持不变，新增 `is_system`；列表返回 `user_count`、`permission_count`。
- 「配置功能权限」：`PUT /api/v1/roles/{id}/permissions`，全量覆盖；保存后失效该角色下所有用户缓存。
- 「配置数据范围」：`PUT /api/v1/roles/{id}/data-scopes`，全量覆盖 4 类资源的 view/manage 范围与自定义目标；保存后失效该角色下所有用户缓存。
- 角色页配置弹窗分为两个 Tab：
  - **功能权限**：模块 × 动作矩阵（见 8.1）；
  - **数据范围**：4 类资源 × 两个范围下拉 + 自定义对象选择。
- 保存前提示影响范围（该角色下用户数）。

### FR-06 权限目录（只读）

- 权限定义与后端执行点强耦合，不允许在管理端增删改。
- 权限管理页只读：列表、搜索、按模块分组、状态（已实现/预留）展示；移除创建/编辑/删除入口。
- 权限的增删变更随版本升级通过数据库迁移完成。
- 后端写接口保留并受 `permission:create/update/delete` 保护（管理员角色持有），管理端页面不暴露入口。

### FR-07 用户角色分配

- 沿用 `PUT /api/v1/users/{user_id}/roles`，全量覆盖；保存后立即失效该用户缓存。
- 禁止用户修改自己的角色；禁止移除最后一个超级管理员的 `is_superuser`。
- 用户列表展示角色名称；无角色标记"未分配角色"。

### FR-08 前端菜单与路由控制

- 登录后与每次路由切换时调用 `/users/me`，权限集合与数据范围存内存上下文，不写 localStorage。
- 菜单按功能权限过滤；无任何系统管理权限时隐藏整个分组。
- 路由守卫：无功能权限跳 `/403`；`/`、`/profile`、`/settings` 仅要求登录。

### FR-09 前端按钮级控制

- 统一提供 `hasPermission(code)` 与 `<Can code="agent:create">`。
- 写操作按钮无功能权限时不渲染：新建、编辑、删除、发布、回滚、启停、上传、重试、测试、共享、转移。
- **数据级按钮的显示规则**：
  - 列表行内的编辑/删除按钮：仅当当前用户对**该行资源**拥有 manage 数据权限时显示；
  - 详情页的共享/转移按钮：仅当对资源拥有 manage 且具备 `<资源>:update` 时显示；
  - 列表接口需在每行返回 `can_manage`（布尔）与 `owner_id`/`owner_name`，供前端渲染；数据判定仍以服务端为准。
- 列表页顶部"新建"按钮仅受功能权限控制。

### FR-10 无权限反馈

- `code=403` 统一拦截：操作类请求提示"无权限执行该操作（需要 xxx）"并刷新权限；路由级跳 `/403`。
- 数据级拒绝与功能级拒绝共用 403；消息区分"缺少权限"与"无权访问该资源"。
- 新增 `/403` 页面，提供"返回工作台"。

### FR-11 鉴权覆盖率保障

- 自动化测试遍历全部路由，断言每个 `/api/v1` 路由已声明权限码或属于白名单，否则失败。
- 数据级测试：
  1. 每个返回业务资源的列表接口必须接入数据过滤（测试用两个用户交叉验证）；
  2. 详情/写接口无数据权限时返回 403；
  3. 共享后立即可访问，取消共享后立即拒绝。
- 功能级测试用例：无 token → 401；无权限 → 403；有权限 → 成功；超级管理员 → 成功；撤销权限后同一 token 下一次请求 → 403；禁用用户后 → 401；白名单无需登录；未声明权限的新接口 → 覆盖率失败。

### FR-12 防锁死与内置角色保护

- `is_system` 角色不可删除、编码不可修改。
- 禁止删除/禁用自己；禁止移除最后一个超级管理员。
- 初始化保证至少一个 `is_superuser=true` 且拥有 admin 角色的账号。
- 配置项 `RBAC_ENFORCE`（默认开启）：关闭时只记录告警日志，用于迁移期排查；生产必须开启。

### FR-13 种子数据与数据迁移

- 权限目录重置为 47 条，删除旧的 12 条权限码。
- 内置角色重置为 admin / developer / operator / viewer，均 `is_system=true`；旧 `operator` 保留 code，名称改为"运营人员/运营"，权限集重写。
- 初始 admin 账号继续关联 admin 角色，`is_superuser=true`。
- 内置角色写入 6.5 节的数据范围默认值。
- 迁移幂等，可重复执行；迁移完成后清空权限缓存。
- 旧权限码映射：`agent:*` → 5 条；`model:*` → 4 条；`prompt:*` → 5 条；`knowledge:*` → 4 条；`tool:*` → 4 条；`user:list` → `user:view`；`role:list` → `role:view`；`permission:list` → `permission:view`；`role:assign` → `role:update`。

### FR-14 数据归属写入与返回

- 创建 Agent / Prompt / 知识库 / 工具时：`owner_id = 当前用户`，`created_by = 当前用户名`。
- 列表与详情响应新增 `owner_id`、`owner_name`、`can_manage`（当前用户视角）、`is_shared`（是否存在 ACL 条目）。
- 历史数据 `owner_id` 为空的，迁移统一归属 admin 用户。
- `owner_id` 建立索引；列表按 owner 过滤时使用索引。

### FR-15 数据过滤与拒绝

| 接口类型 | 规则 |
|---|---|
| 列表（GET 集合） | 结果为「功能权限可见 ∩ 数据访问可见」；同时在分页 `total` 中体现过滤结果 |
| 详情（GET 单条） | 无 view 数据权限 → 403（消息"资源不存在或无权限访问"） |
| 创建（POST） | 只校验功能权限；写入 owner |
| 更新 / 删除 / 发布 / 回滚 / 启停 | 功能权限 **且** manage 数据权限 |
| 文档上传 / 删除、分段编辑 / 删除、重试 | 继承知识库数据判定；上传还需 `knowledge:create` |
| 版本列表 / 版本详情 | 继承父资源 view |
| 统计类接口 | 仅聚合可见数据 |
| 导出（未来） | 必须按相同数据范围过滤，且覆盖率测试覆盖 |

- 所有数据过滤必须发生在服务端查询层，前端参数不得影响范围（不提供"查看全部"之类的可绕过参数）。

### FR-16 资源级共享

- 详情页提供「共享」入口；弹窗支持：
  - 添加用户或角色（可搜索）；
  - 选择访问级别：只读 / 可管理；
  - 查看现有共享列表（主体、级别、授予人、时间）；
  - 修改级别、移除共享。
- 权限控制：授予人需对资源有 manage 数据权限且具备 `<资源>:update`；管理员（ALL）满足条件。
- 共享立即生效，不需要用户重新登录。
- 不可把自己作为共享对象；重复添加同一主体时更新级别而非新增。
- 共享不改变所有者与 `created_by`。
- 共享条目的 ACL 变更写应用日志。

### FR-17 归属转移与用户删除约束

- 归属转移接口：`POST /api/v1/{resource}/{id}/transfer`，入参 `new_owner_id`。
- 条件：操作者对资源有 manage；具备 `<资源>:update`；新所有者存在且启用；不能转移给自己。
- 转移不影响 ACL（已有共享继续有效），但响应与列表需立即反映新 owner。
- 删除用户：若其拥有任何业务资源，拒绝并提示"请先转移其名下资源"；若无资源，清理其 ACL 主体条目并删除。
- 禁用用户：不改变归属；该用户无法登录，其资源仍归其所有，管理员可转移。

### FR-18 对话日志与数据统计的数据口径

- 对话日志：`conversation:view` 功能权限 + 所属 Agent 对当前用户可见；列表按可见 Agent 过滤。后端模块未实现前，前端页面按 Agent 权限做菜单/路由控制。
- 数据统计：仅统计当前用户可见的 Agent 及其对话；不同用户看到的汇总数字可以不同。后端模块未实现前，页面保留并标注"按数据权限统计"。
- 这两类资源不单独配置数据范围，跟随 `agent` 的判定。

---

## 八、页面需求

### 8.1 角色管理 `/system/roles`

- 列表列：角色名称、编码、描述、用户数、权限数、类型（内置/自定义）、操作。
- 内置角色显示"内置"标签，删除按钮禁用并提示原因。
- 「配置」弹窗两个 Tab：

**Tab 1 功能权限（模块 × 动作矩阵）**

```
┌─ 配置功能权限：开发者 ────────────────────────────┐
│ 模块          查看   创建   编辑   删除   发布      │
│ Agent管理      ☑     ☑     ☑     ☐     ☑         │
│ 模型管理       ☑     ☐     ☐     ☐     —         │
│ Prompt管理     ☑     ☑     ☑     ☑     ☑         │
│ 知识库管理     ☑     ☑     ☑     ☐     —         │
│ 工具管理       ☑     ☑     ☑     ☐     —         │
│ 对话日志       ☑     —     —     —     —  待实现   │
│ 数据统计       ☑     —     —     —     —  待实现   │
│ 系统管理       ☐     ☐     ☐     ☐     —         │
│                                                    │
│ 已选 15 项 / 该角色下 3 名用户                      │
│                              [取消]  [保存]        │
└────────────────────────────────────────────────────┘
```

**Tab 2 数据范围**

```
┌─ 配置数据范围：开发者 ────────────────────────────┐
│ 资源       查看范围        管理范围                 │
│ Agent      [全部数据 ▼]   [仅本人 ▼]               │
│ Prompt     [全部数据 ▼]   [仅本人 ▼]               │
│ 知识库      [指定用户/角色 ▼] [仅本人 ▼]           │
│            已选：张三、李四、角色「运营」           │
│ 工具        [全部数据 ▼]   [仅本人 ▼]               │
│                                                    │
│ 说明：数据范围只影响「哪些数据」，不替代功能权限。  │
│                              [取消]  [保存]        │
└────────────────────────────────────────────────────┘
```

- 选择「指定用户/角色」时打开对象选择器：可搜索用户（用户名/邮箱）与角色，多选。
- 保存成功提示"配置已更新，对该角色下用户立即生效"。

### 8.2 权限管理 `/system/permissions`

- 列表列：ID、模块、权限码、名称、动作、状态、说明。
- 支持按模块筛选与关键词搜索。
- 移除创建/编辑/删除按钮；顶部说明"权限目录由系统维护，如需新增请联系版本升级"。
- 预留权限显示"未上线"标签。

### 8.3 用户管理 `/system/users`

- 列表增加角色列（多角色标签）与"拥有资源数"（可选，用于删除提示）。
- 禁止操作自己（编辑角色、删除）。
- 删除仍拥有资源的用户时，提示先转移。

### 8.4 业务资源页面（Agent / Prompt / 知识库 / 工具）

- 列表新增"归属人"列；无 view 数据权限的数据不出现。
- 列表行内编辑/删除按钮按行的 `can_manage` 渲染。
- 详情页显示所有者、共享状态；提供「共享」「转移归属」（按权限）入口。
- 共享弹窗：

```
┌─ 共享「产品知识库」 ──────────────────────────────┐
│ 成员/角色：[搜索用户或角色________________] [添加] │
│                                                    │
│ 主体            类型    级别        操作            │
│ 开发者李四       用户    可管理       [改级别][移除]│
│ 运营             角色    只读         [改级别][移除]│
│                                                    │
│ 所有者：开发者张三                                  │
│                                     [关闭]         │
└────────────────────────────────────────────────────┘
```

- 数据为空且并非真的没有数据时，给出"当前数据范围内暂无数据"的提示，避免误解为系统故障。

### 8.5 403 页面 `/403`

- 文案：无权访问该页面 / 资源；展示所需权限（若可得）；按钮"返回工作台"。

### 8.6 侧边栏与个人中心

- 菜单按功能权限过滤；系统设置分组整体隐藏规则不变。
- 个人中心可展示当前角色与数据范围（只读展示，便于排查）。

---

## 九、接口需求

### 9.1 新增 / 变更接口

| 接口 | 类型 | 说明 |
|---|---|---|
| `GET /api/v1/users/me` | 变更 | 增加 `is_superuser`、`roles`、`permissions`、`data_scopes` |
| `GET /api/v1/roles/{id}`、`GET /api/v1/roles/`、`GET /api/v1/roles/search` | 变更 | 增加 `is_system`、`user_count`、`permission_count` |
| `PUT /api/v1/roles/{id}/permissions` | 语义明确 | 全量覆盖；失效该角色用户缓存 |
| `PUT /api/v1/roles/{id}/data-scopes` | 新增 | 全量覆盖数据范围；失效该角色用户缓存 |
| `GET /api/v1/roles/{id}/data-scopes` | 新增 | 查询角色数据范围配置 |
| `GET /api/v1/{resource}/{id}/acl` | 新增 | 查询共享列表（agent/prompt/knowledge-bases/tools） |
| `POST /api/v1/{resource}/{id}/acl` | 新增 | 添加或更新共享 |
| `DELETE /api/v1/{resource}/{id}/acl/{acl_id}` | 新增 | 移除共享 |
| `POST /api/v1/{resource}/{id}/transfer` | 新增 | 转移归属 |
| 资源列表接口 | 变更 | 新增 `owner_id`、`owner_name`、`can_manage`、`is_shared`；接入数据过滤 |
| 资源详情接口 | 变更 | 同上，并接入数据访问判定 |
| 资源写接口 | 变更 | 功能权限 + manage 数据权限 |
| `DELETE /api/v1/roles/{id}` | 变更 | 内置角色拒绝；有用户拒绝；清理数据范围与 ACL |
| `DELETE /api/v1/users/{id}` | 变更 | 禁止删除自己/最后一个超管；有资源时拒绝 |
| 全部受保护接口 | 变更 | 增加功能权限校验 |

**数据范围接口示例**

```json
PUT /api/v1/roles/3/data-scopes
{
  "scopes": [
    {
      "resource_type": "knowledge",
      "view_scope": "CUSTOM",
      "manage_scope": "SELF",
      "view_targets": [
        { "subject_type": "user", "subject_id": 12 },
        { "subject_type": "role", "subject_id": 4 }
      ],
      "manage_targets": []
    }
  ]
}
```

**共享接口示例**

```json
POST /api/v1/knowledge-bases/8/acl
{ "subject_type": "user", "subject_id": 12, "access_level": "manage" }

响应 data:
{
  "id": 31,
  "resource_type": "knowledge",
  "resource_id": 8,
  "subject_type": "user",
  "subject_id": 12,
  "subject_name": "李四",
  "access_level": "manage",
  "granted_by": 1,
  "granted_at": "2026-10-25T10:00:00"
}
```

### 9.2 错误码（新增约定）

| code | HTTP 状态 | 含义 | 前端行为 |
|---|---|---|---|
| 401 | 200（沿用现有约定） | 未登录 / token 过期 / 账号禁用 | 清除 token，跳登录 |
| 403 | 200（沿用现有约定） | 无功能权限 / 无数据权限 / 接口未声明权限 | 提示；路由级跳 /403；刷新权限 |

> 保持 HTTP 200 是为了兼容现有前端与全局异常处理器；错误语义由 body `code` 承载。前端 `apiClient` 需显式处理 `code=401` 与 `code=403`。

### 9.3 全量接口 → 功能权限映射

> 以下 prefix 均为 `/api/v1`。

#### 认证与验证码（白名单，无需登录）

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | `/auth/login` | — |
| GET | `/captcha` | — |
| POST | `/captcha` | — |

#### 用户

| 方法 | 路径 | 权限 | 数据层 |
|---|---|---|---|
| GET | `/users/me` | 仅登录 | — |
| POST | `/users` | `user:create` | 平台级，不隔离 |
| GET | `/users` | `user:view` | 不隔离 |
| GET | `/users/search` | `user:view` | 不隔离 |
| GET | `/users/{user_id}` | `user:view` | 不隔离 |
| GET | `/users/{user_id}/roles` | `user:view` | 不隔离 |
| PUT | `/users/{user_id}/roles` | `user:update` | 不隔离 |
| DELETE | `/users/{user_id}` | `user:delete` | 见 FR-17 |

#### 角色

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/roles/` | `role:view` |
| GET | `/roles/search` | `role:view` |
| GET | `/roles/{role_id}` | `role:view` |
| GET | `/roles/{role_id}/data-scopes` | `role:view` |
| POST | `/roles` | `role:create` |
| PUT | `/roles/{role_id}` | `role:update` |
| PUT | `/roles/{role_id}/permissions` | `role:update` |
| PUT | `/roles/{role_id}/data-scopes` | `role:update` |
| DELETE | `/roles/{role_id}` | `role:delete` |

#### 权限

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/permissions/` | `permission:view` |
| GET | `/permissions/search` | `permission:view` |
| GET | `/permissions/{permission_id}` | `permission:view` |
| POST | `/permissions` | `permission:create` |
| PUT | `/permissions/{permission_id}` | `permission:update` |
| DELETE | `/permissions/{permission_id}` | `permission:delete` |

#### Agent

| 方法 | 路径 | 权限 | 数据层 |
|---|---|---|---|
| POST | `/agents` | `agent:create` | 写入 owner |
| GET | `/agents` | `agent:view` | view 范围过滤 |
| GET | `/agents/{id}` | `agent:view` | view 判定 |
| GET | `/agents/{id}/versions` | `agent:view` | 继承 Agent |
| PUT | `/agents/{id}` | `agent:update` | manage 判定 |
| POST | `/agents/{id}/start` | `agent:update` | manage 判定 |
| POST | `/agents/{id}/stop` | `agent:update` | manage 判定 |
| POST | `/agents/{id}/publish` | `agent:publish` | manage 判定 |
| POST | `/agents/{id}/rollback` | `agent:publish` | manage 判定 |
| DELETE | `/agents/{id}` | `agent:delete` | manage 判定 |
| GET | `/agents/{id}/acl` | `agent:view` | manage 判定（查看共享亦需管理权） |
| POST | `/agents/{id}/acl` | `agent:update` | manage 判定 |
| DELETE | `/agents/{id}/acl/{acl_id}` | `agent:update` | manage 判定 |
| POST | `/agents/{id}/transfer` | `agent:update` | manage 判定 |

#### 模型与供应商（平台级，不做数据隔离）

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | `/models` | `model:create` |
| GET | `/models` | `model:view` |
| GET | `/models/{model_id}` | `model:view` |
| PUT | `/models/{model_id}` | `model:update` |
| DELETE | `/models/{model_id}` | `model:delete` |
| POST | `/providers` | `model:create` |
| GET | `/providers` | `model:view` |
| GET | `/providers/{provider_id}` | `model:view` |
| PUT | `/providers/{provider_id}` | `model:update` |
| POST | `/providers/{provider_id}/test` | `model:update` |
| DELETE | `/providers/{provider_id}` | `model:delete` |

#### Prompt

| 方法 | 路径 | 权限 | 数据层 |
|---|---|---|---|
| POST | `/prompts` | `prompt:create` | 写入 owner |
| GET | `/prompts` | `prompt:view` | view 范围过滤 |
| GET | `/prompts/{id}` | `prompt:view` | view 判定 |
| GET | `/prompts/{id}/versions` | `prompt:view` | 继承 Prompt |
| PUT | `/prompts/{id}` | `prompt:update` | manage 判定 |
| POST | `/prompts/{id}/publish` | `prompt:publish` | manage 判定 |
| POST | `/prompts/{id}/rollback` | `prompt:publish` | manage 判定 |
| DELETE | `/prompts/{id}` | `prompt:delete` | manage 判定 |
| GET/POST/DELETE | `/prompts/{id}/acl` | `prompt:view` / `prompt:update` | manage 判定 |
| POST | `/prompts/{id}/transfer` | `prompt:update` | manage 判定 |

#### 知识库

| 方法 | 路径 | 权限 | 数据层 |
|---|---|---|---|
| POST | `/knowledge-bases` | `knowledge:create` | 写入 owner |
| GET | `/knowledge-bases` | `knowledge:view` | view 范围过滤 |
| GET | `/knowledge-bases/{kb_id}` | `knowledge:view` | view 判定 |
| PUT | `/knowledge-bases/{kb_id}` | `knowledge:update` | manage 判定 |
| PUT | `/knowledge-bases/{kb_id}/config` | `knowledge:update` | manage 判定 |
| DELETE | `/knowledge-bases/{kb_id}` | `knowledge:delete` | manage 判定 |
| POST | `/knowledge-bases/{kb_id}/documents` | `knowledge:create` | manage 判定 |
| GET | `/knowledge-bases/{kb_id}/documents` | `knowledge:view` | 继承知识库 |
| DELETE | `/knowledge-bases/{kb_id}/documents/{doc_id}` | `knowledge:delete` | manage 判定 |
| POST | `/knowledge-bases/{kb_id}/documents/{doc_id}/retry` | `knowledge:update` | manage 判定 |
| GET | `/knowledge-bases/{kb_id}/documents/{doc_id}/segments` | `knowledge:view` | 继承知识库 |
| GET | `/knowledge-bases/{kb_id}/segments` | `knowledge:view` | 继承知识库 |
| PUT | `/knowledge-bases/{kb_id}/segments/{seg_id}` | `knowledge:update` | manage 判定 |
| DELETE | `/knowledge-bases/{kb_id}/segments/{seg_id}` | `knowledge:delete` | manage 判定 |
| POST | `/knowledge-bases/{kb_id}/retrieval-test` | `knowledge:view` | view 判定 |
| GET/POST/DELETE | `/knowledge-bases/{id}/acl` | `knowledge:view` / `knowledge:update` | manage 判定 |
| POST | `/knowledge-bases/{id}/transfer` | `knowledge:update` | manage 判定 |

#### 工具

| 方法 | 路径 | 权限 | 数据层 |
|---|---|---|---|
| POST | `/tools` | `tool:create` | 写入 owner |
| GET | `/tools` | `tool:view` | view 范围过滤 |
| GET | `/tools/{id}` | `tool:view` | view 判定 |
| PUT | `/tools/{id}` | `tool:update` | manage 判定 |
| POST | `/tools/{id}/enable` | `tool:update` | manage 判定 |
| POST | `/tools/{id}/disable` | `tool:update` | manage 判定 |
| POST | `/tools/{id}/test` | `tool:update` | manage 判定 |
| DELETE | `/tools/{id}` | `tool:delete` | manage 判定 |
| GET/POST/DELETE | `/tools/{id}/acl` | `tool:view` / `tool:update` | manage 判定 |
| POST | `/tools/{id}/transfer` | `tool:update` | manage 判定 |

#### 预留模块（后端暂无接口）

对话日志、数据统计、API Key、审计日志、告警规则、系统配置：本期不新增后端接口；对话日志与数据统计的数据口径见 FR-18，其余仅用于前端菜单/路由控制。模块上线时必须声明权限、接入数据过滤并纳入覆盖率测试。

### 9.4 前端路由 → 权限映射

| 路由 | 所需权限 |
|---|---|
| `/`、`/profile`、`/settings` | 仅登录 |
| `/agents`、`/agents/:id`、`/agents/:id/versions`、`/agents/:id/test`、`/agents/:id/monitor` | `agent:view` |
| `/agents/create` | `agent:create` |
| `/agents/:id/edit` | `agent:update` |
| `/models`、`/models/providers`、`/models/test` | `model:view` |
| `/prompts`、`/prompts/:id/versions` | `prompt:view` |
| `/prompts/create` | `prompt:create` |
| `/knowledge`、`/knowledge/:id`、`/knowledge/:id/documents`、`/knowledge/:id/segments`、`/knowledge/:id/test` | `knowledge:view` |
| `/knowledge/create` | `knowledge:create` |
| `/tools`、`/tools/:id` | `tool:view` |
| `/tools/create` | `tool:create` |
| `/conversations`、`/conversations/:id` | `conversation:view`（预留） |
| `/analytics`、`/analytics/costs`、`/analytics/evaluation` | `analytics:view`（预留） |
| `/system/users` | `user:view` |
| `/system/roles` | `role:view` |
| `/system/permissions` | `permission:view` |
| `/system/api-keys` | `apikey:view`（预留） |
| `/system/audit` | `audit:view`（预留） |
| `/system/alerts` | `alert:view`（预留） |
| `/system/settings` | `settings:view`（预留） |

> 复用同一组件的路由（如 `/prompts/:id`）在页面内按权限区分按钮；数据级可见性由接口返回的数据决定。

---

## 十、数据模型与迁移

### 10.1 表结构变更

| 表 | 变更 | 说明 |
|---|---|---|
| `roles` | 新增 `is_system` BOOLEAN NOT NULL DEFAULT 0 | 内置角色保护 |
| `permissions` | 数据重建，无结构变更 | 47 条内置权限 |
| `role_permissions` | 数据重建 | 按 5.3 节矩阵写入 |
| `agents` | 新增 `owner_id` BIGINT FK users.id，索引 | 数据归属；`created_by` 保留为显示名 |
| `prompts` | 新增 `owner_id` | 同上 |
| `knowledge_bases` | 新增 `owner_id` | 同上 |
| `tools` | 新增 `owner_id` | 同上 |
| `role_data_scopes` | 新增 | 角色 × 资源类别的数据范围 |
| `role_data_scope_targets` | 新增 | CUSTOM 范围的指定用户/角色 |
| `resource_acl` | 新增 | 资源级共享 |
| `user_roles` | 保留 | 初始 admin 维持 admin 角色 |

### 10.2 新增表定义（逻辑）

**role_data_scopes**

| 字段 | 类型 | 说明 |
|---|---|---|
| id | BIGINT PK | |
| role_id | BIGINT FK roles.id ON DELETE CASCADE | |
| resource_type | VARCHAR(32) | agent / prompt / knowledge / tool |
| view_scope | VARCHAR(16) | ALL / SELF / CUSTOM |
| manage_scope | VARCHAR(16) | ALL / SELF / CUSTOM |
| created_at / updated_at | DATETIME | |

唯一约束：`(role_id, resource_type)`。

**role_data_scope_targets**

| 字段 | 类型 | 说明 |
|---|---|---|
| id | BIGINT PK | |
| role_data_scope_id | BIGINT FK role_data_scopes.id ON DELETE CASCADE | |
| applies_to | VARCHAR(8) | VIEW / MANAGE |
| subject_type | VARCHAR(8) | user / role |
| subject_id | BIGINT | 用户或角色 ID |
| created_at | DATETIME | |

唯一约束：`(role_data_scope_id, applies_to, subject_type, subject_id)`。

**resource_acl**

| 字段 | 类型 | 说明 |
|---|---|---|
| id | BIGINT PK | |
| resource_type | VARCHAR(32) | agent / prompt / knowledge / tool |
| resource_id | BIGINT | 资源 ID（不建跨表外键，应用层保证） |
| subject_type | VARCHAR(8) | user / role |
| subject_id | BIGINT | |
| access_level | VARCHAR(8) | view / manage |
| granted_by | BIGINT FK users.id | 授予人 |
| created_at / updated_at | DATETIME | |

唯一约束：`(resource_type, resource_id, subject_type, subject_id)`；索引：`(resource_type, resource_id)`、`(subject_type, subject_id)`。

### 10.3 迁移步骤（Alembic）

1. `roles` 增加 `is_system`（默认 false）。
2. 四张业务表增加 `owner_id`（先可空），以初始 admin 用户回填，再改为非空并建索引。
3. 创建 `role_data_scopes`、`role_data_scope_targets`、`resource_acl` 三张表及约束/索引。
4. 重建权限目录（47 条）与内置角色权限。
5. 写入内置角色的数据范围默认值（6.5 节）。
6. 保证 admin 账号存在、`is_superuser=true`、关联 admin 角色。
7. 清空权限缓存。
8. 迁移幂等；全部在 RBAC 相关表与业务表 owner 字段内完成，不删除业务数据。

### 10.4 回滚

- down 迁移删除新增表与 `owner_id` 列，恢复旧权限与角色数据。
- 回滚会丢失数据范围、ACL、归属信息，生产回滚前必须备份并评估。

---

## 十一、非功能需求

| 类别 | 要求 |
|---|---|
| 安全 | 默认拒绝；权限与数据范围不写入 JWT；数据过滤在服务端完成，前端参数无法扩大范围；越权访问写应用日志（用户、路径、所需权限、资源 ID、IP、时间） |
| 性能 | 有缓存时功能鉴权附加耗时 P95 ≤ 10ms；列表数据过滤在 1 万行量级下 P95 ≤ 200ms；ACL 判定走索引 |
| 可用性 | Redis 故障不影响鉴权正确性（降级查库）；数据库故障返回 500 |
| 一致性 | 授权变更（含数据范围、ACL）后，任何实例上的下一次请求不得再放行已撤销权限 |
| 可维护性 | 权限码与接口映射唯一来源；覆盖率测试纳入 CI；新增资源类别必须同步数据范围配置与过滤 |
| 兼容性 | 前端 Mock 模式继续可用：Mock 登录默认返回管理员全量权限与 ALL 数据范围，并支持模拟受限角色；后端响应除新增字段外不变 |
| 可观测性 | 记录鉴权失败与数据拒绝日志；可选暴露缓存命中率指标 |
| 部署 | 新增配置项 `RBAC_ENFORCE`（默认 true）；生产必须开启 |
| 数据规模约束 | 单角色单资源自定义目标 ≤ 1000；单资源 ACL 条目建议 ≤ 200 |

---

## 十二、验收标准

### 12.1 功能授权

| 编号 | 场景 | 预期 |
|---|---|---|
| AC-01 | 未登录调用 `GET /api/v1/agents` | `code=401` |
| AC-02 | 无 `agent:create` 调用 `POST /api/v1/agents` | `code=403`，消息含 `agent:create` |
| AC-03 | 有 `agent:create` 的用户调用同一接口 | 成功，且 `owner_id` 为本人 |
| AC-04 | 只读角色查看侧边栏 | 仅业务模块查看入口，无系统设置分组 |
| AC-05 | 只读角色直接访问 `/system/users` | 跳转 `/403` |
| AC-06 | 只读角色进入 Agent 列表 | 无新建/编辑/删除/发布按钮 |
| AC-07 | 取消开发者 `knowledge:delete` | 开发者下一次删除请求即 `code=403` |
| AC-08 | 禁用用户后再次请求 | `code=401`，前端跳登录 |
| AC-09 | 删除内置角色 admin | 拒绝 |
| AC-10 | 删除自己 | 拒绝 |
| AC-11 | 取消最后一个超级管理员标记 | 拒绝 |
| AC-12 | `/users/me` | 返回 roles、permissions、data_scopes、is_superuser |
| AC-13 | 超级管理员（无任何角色权限）调用受保护接口 | 成功 |
| AC-14 | 新增未声明权限的 `/api/v1` 接口并运行测试 | 覆盖率测试失败 |
| AC-15 | 迁移脚本执行两次 | 数据不重复 |
| AC-16 | Redis 停止后调用受保护接口 | 鉴权仍正确，无 500 |

### 12.2 数据级授权

| 编号 | 场景 | 预期 |
|---|---|---|
| AC-17 | 开发者 A（Agent view SELF）查看列表 | 只看到自己的 Agent，分页 total 正确 |
| AC-18 | 开发者 A 直接访问开发者 B 的 Agent 详情 | `code=403`，消息"资源不存在或无权限访问" |
| AC-19 | 开发者 A 修改/删除 B 的 Agent | `code=403` |
| AC-20 | 开发者 A（view ALL / manage SELF）编辑 B 的 Agent | `code=403`；列表能看到但行内无编辑按钮 |
| AC-21 | 管理员将所有资源改为 view/manage ALL | 能看到并操作全部数据 |
| AC-22 | 运营角色知识库范围 manage ALL | 运营可编辑任意知识库 |
| AC-23 | 角色范围改为 CUSTOM（指定用户张三） | 张三创建的数据可见；他人数据不可见 |
| AC-24 | 角色范围改为 CUSTOM（指定角色「开发者」） | 所有开发者创建的数据可见，取消角色后立即不可见 |
| AC-25 | 用户拥有两个角色，一个 ALL 一个 SELF | 有效范围为 ALL |
| AC-26 | 所有者把知识库共享给用户 B（只读） | B 列表立即出现；B 可查看、不能编辑；B 无行内编辑按钮 |
| AC-27 | 共享改为可管理 | B 可编辑/上传文档，但仍不能共享（除非有 update 功能权限） |
| AC-28 | 取消共享 | B 下一次请求即 403，列表中消失 |
| AC-29 | 共享给角色 | 该角色下所有用户立即获得对应数据访问 |
| AC-30 | 非所有者、无管理权限尝试共享 | `code=403` |
| AC-31 | 管理员转移归属给用户 C | 列表归属人变为 C；C 获得 manage；原所有者失去 manage |
| AC-32 | 删除仍拥有资源的用户 | 拒绝，提示先转移 |
| AC-33 | 删除角色 | 该角色数据范围与相关 ACL 清理；角色下用户需先解绑 |
| AC-34 | 知识库文档/分段操作 | 随知识库数据判定；无 manage 时上传/删除/编辑均 403 |
| AC-35 | 对话日志 | 仅显示当前用户可见 Agent 的对话（后端实现后验证） |
| AC-36 | 数据统计 | 汇总仅包含可见数据（后端实现后验证） |
| AC-37 | 资源详情响应 | 包含 `owner_id`、`owner_name`、`can_manage`、`is_shared` |
| AC-38 | `created_by` | 创建后等于当前用户名；历史数据迁移后 `owner_id` 指向 admin |

---

## 十三、实施阶段建议

| 阶段 | 内容 | 交付物 |
|---|---|---|
| P0 | 权限目录、内置角色、数据归属字段、数据范围/ACL 表、数据迁移 | Alembic 迁移 + 种子数据 |
| P1 | 功能鉴权内核（依赖、校验顺序、缓存、白名单）、覆盖率测试 | 后端功能鉴权能力 + 测试 |
| P2 | 数据授权内核（范围编译、列表过滤、详情/写判定、ACL、共享、转移） | 后端数据授权能力 + 测试 |
| P3 | 按模块接入全部业务接口（功能 + 数据） | 接口接入 + 联调用例 |
| P4 | `/users/me` 扩展、前端权限上下文、菜单/路由、403 页 | 前端功能控制面 |
| P5 | 按钮级控制、角色双 Tab 配置、权限页只读化、归属列、共享/转移弹窗 | 管理端与业务页面 |
| P6 | 联调、验收、Mock 模式适配 | 验收报告 |

> 建议 P3 按「系统管理 → Agent → Prompt/知识库 → 模型/工具」灰度接入，配合 `RBAC_ENFORCE` 开关排查遗漏接口。

---

## 十四、风险与开放问题

### 14.1 风险

| 编号 | 风险 | 应对 |
|---|---|---|
| RK-01 | 一次性加鉴权导致联调中断 | `RBAC_ENFORCE` 灰度开关；分模块接入；覆盖率测试 |
| RK-02 | 历史数据全部归属 admin，开发者按 SELF 看不到数据 | 迁移前确认归属策略；开发者默认 view ALL；提供归属转移工具 |
| RK-03 | 数据范围配置错误导致"数据消失" | 列表空状态提示"当前数据范围内暂无数据"；角色页展示影响范围；管理员可 ALL 兜底 |
| RK-04 | ACL 与数据范围叠加后结果难以理解 | 详情页展示当前用户的有效权限来源（所有者/共享/范围）；文档给出判定公式 |
| RK-05 | 自定义范围目标过大影响查询性能 | 目标数上限 1000；SQL 使用 EXISTS/IN 子查询并建索引 |
| RK-06 | 权限缓存与数据库不一致 | 主动失效 + 300 秒 TTL + 即时生效测试 |
| RK-07 | 旧权限码迁移遗漏 | 导出、映射表、幂等执行、迁移后校验矩阵 |
| RK-08 | 预留模块权限与实际接口不符 | 目录标注"未上线"；上线时同步接入 |
| RK-09 | 运行时调用被误伤 | 明确非目标 NG8；运行时鉴权独立立项 |

### 14.2 已决问题

| 问题 | 决策 |
|---|---|
| 授权范围 | 功能授权 + 数据级授权（行级/归属级） |
| 部门/组织 | 本期不引入，数据范围用 全部/本人/指定用户/指定角色 表达 |
| 权限码粒度 | 统一 `资源:动作` 细粒度 |
| 撤销生效时机 | 立即生效（请求时校验 + 缓存主动失效） |
| 内置角色 | 4 个：admin / developer / operator / viewer |
| 数据归属 | 新增 `owner_id`，创建时写入；历史数据归 admin |
| 数据范围维度 | 查看范围 + 管理范围，各支持 ALL/SELF/CUSTOM |
| 资源共享 | 资源级 ACL，用户/角色，view/manage，立即生效 |
| 系统管理资源 | 不做数据隔离，仅功能权限 |
| 接口鉴权实现方式 | 建议"接口级显式声明 + 覆盖率测试"；作为技术方案输入 |

### 14.3 待后续确认

| 编号 | 问题 | 影响 |
|---|---|---|
| Q1 | 是否需要按部门/组织隔离 | 若需要，新增 departments 表与 `subject_type=department` |
| Q2 | 运行时（终端用户调用 Agent）是否要数据隔离 | 影响对外 API 设计 |
| Q3 | 共享是否需要有效期 | 可扩展 ACL 的 `expires_at` |
| Q4 | 审计日志是否落库 | 数据共享/转移目前仅写应用日志 |
| Q5 | 数据范围是否需要"排除指定数据"的 deny 规则 | 当前仅并集授权，无显式拒绝 |

---

## 十五、与现有文档的关系

- `docs/PROJECT_SPEC.md`：项目说明书 V1，描述架构与已完成能力，继续作为开发参考。
- 本文档：V2 需求基线，覆盖 RBAC 功能授权与数据级授权，替换上一版仅含功能授权的 V2。
- `app/docs/09-系统管理.md`：系统管理 UI 设计；本文档与其权限矩阵一致，并在其上补充数据范围配置与资源共享。

---

## 十六、变更记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-10-25 | v2.0 | 第一版：完成功能授权需求对齐（权限码、内置角色矩阵、接口映射、即时失效、前端控制、验收标准） |
| 2026-10-25 | v2.0 | 第二版：在功能授权基础上补齐数据级授权——数据归属 `owner_id`、角色数据范围（查看/管理 × 全部/本人/指定用户/指定角色）、资源级共享 ACL、归属转移与用户删除约束、派生资源与统计口径；更新数据模型、迁移、接口映射、页面与验收标准 |
