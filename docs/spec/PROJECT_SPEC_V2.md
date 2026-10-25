# 辰光 Agent 平台 — 产品需求文档 V2（RBAC 功能授权）

| 项目 | 内容 |
|---|---|
| 文档名称 | PROJECT_SPEC_V2.md |
| 版本 | v2.0 |
| 状态 | 需求已对齐，待评审 |
| 编写日期 | 2026-10-25 |
| 需求主题 | 在现有用户/角色/权限数据模型之上，补齐 **RBAC 功能授权**（接口鉴权 + 前端菜单/路由/按钮控制） |
| 关联文档 | `docs/PROJECT_SPEC.md`（项目说明书 V1）、`app/docs/09-系统管理.md`（系统管理 UI 设计） |
| 约束 | 本文档为需求文档，不含实现代码；实现阶段另行编写技术方案与任务计划 |

---

## 一、背景

平台已经具备 RBAC 的**数据基础**：`users`、`roles`、`permissions` 三张表以及 `user_roles`、`role_permissions` 两张关联表已落库，用户/角色/权限的增删改查接口可正常调用，种子数据中已有管理员与运营人员两类角色。

但当前 RBAC 只停留在"**能配置**"，没有进入"**能生效**"：

- 全项目只有 `/api/v1/users/me` 与一个知识库上传接口使用了 `get_current_user`，其余业务接口（Agent、模型、Prompt、知识库、工具、供应商、系统管理）**均未校验登录态，更未校验权限**。
- 登录成功后只下发 JWT，前端拿不到"我是谁、我有哪些权限"，侧边栏和路由只判断"是否已登录"，任何登录用户都能看到并进入全部菜单。
- 权限码粒度不统一：`user:list` 是细粒度，`agent:*` / `model:*` 等是整模块通配，且与 `app/docs/09-系统管理.md` 中已设计好的「模块 × 查看/创建/编辑/删除/发布」权限矩阵对不上。
- 后端没有任何授权执行点，权限的增删改对系统行为没有任何影响。

因此本次需求的目标是把 RBAC 从"配置数据"变成"强制执行的控制面"。

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

---

## 二、目标与非目标

### 2.1 目标

| 编号 | 目标 |
|---|---|
| G1 | 所有 `/api/v1` 业务接口默认要求登录 + 对应权限，未授权访问返回明确错误 |
| G2 | 权限码统一为 `资源:动作` 细粒度，覆盖设计稿的 8 个业务域与系统管理子域 |
| G3 | 内置 4 个角色（管理员/开发者/运营/只读），内置角色不可删除、编码不可修改 |
| G4 | 授权变更（改角色权限、改用户角色、删角色、禁用/删除用户）**立即生效**，无需等待用户重新登录或 token 过期 |
| G5 | 前端根据权限集合控制菜单可见性、路由访问、页面内操作按钮 |
| G6 | 角色权限配置以「模块 × 动作」矩阵方式呈现，与设计稿一致 |
| G7 | 权限目录由系统内置维护，管理端只读展示，避免与后端执行点漂移 |
| G8 | 提供自动化保障：新增接口若未声明权限且不在白名单，测试直接失败 |

### 2.2 非目标（本期不做）

| 编号 | 非目标 | 说明 |
|---|---|---|
| NG1 | 数据权限 / 行级权限 | 不做"只能看自己创建的 Agent/知识库"这类按归属过滤；本期所有授权均为功能级 |
| NG2 | 多租户、部门/组织架构 | 不引入 tenant、department 概念 |
| NG3 | SSO / LDAP / OAuth 第三方登录 | 继续使用用户名 + 密码 + 验证码 |
| NG4 | API Key 的权限范围与鉴权 | `/system/api-keys` 仅保留页面与菜单控制，OpenAPI Key 鉴权后续单独立项 |
| NG5 | 权限申请 / 审批流 / 临时授权 / 授权到期 | 不做 |
| NG6 | 审计日志落库 | 越权访问仅写应用日志，审计模块未实现前不建表 |
| NG7 | 字段级权限、接口限流 | 不做 |
| NG8 | 修改现有 API 响应结构 | 除 `/users/me` 增加字段外，其余接口响应格式保持不变 |

### 2.3 成功标准

1. 未登录访问任意受保护接口返回 401 语义错误；登录但无权限返回 403 语义错误。
2. 管理员在角色页取消某角色的 `agent:delete` 后，该角色下的在线用户**下一次请求**即无法删除 Agent。
3. 只读角色登录后，侧边栏只显示其有权访问的模块，直接输入无权 URL 被拦截到 403 页，页面内创建/编辑/删除按钮不渲染。
4. 新增一个未声明权限的接口时，CI 中的鉴权覆盖率测试失败。

---

## 三、用户与典型场景

### 3.1 角色画像

| 内置角色 | code | 画像 | 主要诉求 |
|---|---|---|---|
| 管理员 | `admin` | 平台负责人 / 运维 | 管理用户与角色、全平台配置 |
| 开发者 | `developer` | Agent / Prompt 开发者 | 创建与调试 Agent、Prompt、知识库、工具 |
| 运营 | `operator` | 业务运营人员 | 查看业务数据、维护知识库内容 |
| 只读 | `viewer` | 观察者 / 外部协作方 | 只查看，不产生任何变更 |

> 说明：`is_superuser=true` 的账号（初始 admin 账号）拥有全部权限，跳过一切权限校验，作为系统防锁死的最终兜底。该标记不通过界面下发，仅由种子数据或运维操作设置。

### 3.2 典型场景

- **S1 管理员配置权限**：管理员进入「角色管理」，打开「开发者」的权限矩阵，勾选/取消 `知识库-删除`，保存后立即生效。
- **S2 撤销权限即时生效**：运营人员正在使用系统，管理员取消其「知识库-编辑」权限；运营下一次提交编辑请求即被拒绝，前端提示无权限并刷新其按钮状态。
- **S3 只读用户访问**：只读用户登录后只看到业务菜单的查看入口；直接访问 `/system/users` 被导向 403 页。
- **S4 新员工入职**：管理员创建用户并分配「运营」角色；用户首次登录即可看到对应菜单。
- **S5 离职/停用**：管理员禁用某用户后，其后续请求立即返回 401（账号已禁用），已签发的 token 不再有效。
- **S6 新增接口**：开发者新增一个 Agent 导出接口，必须声明所需权限，否则覆盖率测试失败，阻止合入。

---

## 四、权限模型

### 4.1 模型关系

```
User ──M:N──> Role ──M:N──> Permission
      user_roles     role_permissions

用户的有效权限 = 其所有角色权限的并集（去重）
is_superuser = true 的用户跳过权限校验（拥有全部权限）
无任何角色的用户：可登录，仅能访问工作台、个人中心、个人设置
```

规则：

- 一个用户可拥有多个角色，权限取并集。
- 一个角色可拥有多个权限。
- 角色权限、用户角色的变更都必须在**同一业务操作完成后立即失效相关缓存**（见 FR-03）。
- 删除角色时，若仍有用户关联，拒绝删除并提示先解绑（避免静默夺权）。
- 删除权限在管理端不可操作（权限目录只读，见 FR-06）。

### 4.2 权限码规范

**格式**：`资源:动作`，全小写英文，资源名使用单数英文名词，动作为固定枚举。

**动作枚举**（与设计稿矩阵列一致）：

| 动作 | 含义 | 典型接口 |
|---|---|---|
| `view` | 查看列表 / 详情 / 版本 / 统计 | GET |
| `create` | 新建资源、上传、注册 | POST（创建类） |
| `update` | 编辑配置、启停、重试、测试连接 | PUT / PATCH / 部分 POST |
| `delete` | 删除资源 | DELETE |
| `publish` | 发布新版本、回滚版本 | POST（发布/回滚） |

**特殊操作的归属规则**（矩阵只有 5 列，以下操作按此映射）：

| 特殊操作 | 归属权限 | 理由 |
|---|---|---|
| Agent 启动 / 停止 | `agent:update` | 改变运行状态，非发布 |
| Agent / Prompt 发布、回滚 | `agent:publish` / `prompt:publish` | 产生或切换线上版本 |
| Agent / Prompt 版本列表 | `<资源>:view` | 只读 |
| 供应商测试连接 | `model:update` | 使用凭据发起调用，属配置操作 |
| 知识库重试文档、编辑分段、更新配置 | `knowledge:update` | 修改数据 |
| 知识库删除文档 / 删除分段 | `knowledge:delete` | 删除数据 |
| 知识库检索测试 | `knowledge:view` | 只读查询 |
| 工具启用 / 禁用 / 测试调用 | `tool:update` | 改变状态或产生外部调用 |
| 给用户分配角色 | `user:update` | 用户信息的一部分 |
| 给角色分配权限 | `role:update` | 角色信息的一部分 |

**命名示例**：`agent:view`、`prompt:publish`、`knowledge:delete`、`user:update`。

### 4.3 权限码总表（47 条）

> 「状态」为 **已实现** 表示后端已有对应接口并纳入后端强制校验；**预留** 表示后端模块尚未实现，本期仅用于前端菜单/路由控制，待后端接口实现后自动纳入强制校验。

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
| 角色管理 | `role:update` | 编辑角色 / 分配权限 | 已实现 |
| 角色管理 | `role:delete` | 删除角色 | 已实现 |
| 权限管理 | `permission:view` | 查看权限目录 | 已实现 |
| 权限管理 | `permission:create` | 创建权限 | 已实现（不开放，见 FR-06） |
| 权限管理 | `permission:update` | 编辑权限 | 已实现（不开放，见 FR-06） |
| 权限管理 | `permission:delete` | 删除权限 | 已实现（不开放，见 FR-06） |
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

> `permission:create/update/delete` 三条权限保留在目录中，但管理端不开放写操作（见 FR-06），后端仍保留对应接口并按权限校验，供未来受控的目录扩容使用。

### 4.4 内置角色权限矩阵

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
| 用户管理 | view | ✅ | — | — | — |
| 用户管理 | create | ✅ | — | — | — |
| 用户管理 | update | ✅ | — | — | — |
| 用户管理 | delete | ✅ | — | — | — |
| 角色管理 | view | ✅ | — | — | — |
| 角色管理 | create | ✅ | — | — | — |
| 角色管理 | update | ✅ | — | — | — |
| 角色管理 | delete | ✅ | — | — | — |
| 权限管理 | view | ✅ | — | — | — |
| 权限管理 | create/update/delete | ✅ | — | — | — |
| API 密钥 | 全部 | ✅ | — | — | — |
| 审计日志 | view | ✅ | — | — | — |
| 告警规则 | 全部 | ✅ | — | — | — |
| 系统配置 | view/update | ✅ | — | — | — |

> 内置角色的权限集是**初始默认值**，管理员可在角色页调整（内置角色本身不可删除、编码不可修改）。
> 管理员角色的权限集不包含"绕过校验"的特殊能力，其全量权限来自实际分配的 47 条权限；防锁死依靠 `is_superuser` 账号。

### 4.5 角色与权限的保护规则

| 规则 | 说明 |
|---|---|
| R1 | `roles.is_system = true` 的角色不可删除，`code` 不可修改，`name`/`description` 可修改 |
| R2 | 内置角色（admin/developer/operator/viewer）由系统迁移脚本创建，不允许重复创建同 code 角色 |
| R3 | 删除角色前必须无关联用户，否则拒绝并提示 |
| R4 | 用户不能删除自己、不能禁用自己 |
| R5 | 系统至少保留一个 `is_superuser = true` 且启用的用户；不允许取消最后一个超级管理员的标记或将其禁用/删除 |
| R6 | 内置权限目录只读；任何角色与权限的变更记录到应用日志（审计模块上线后再落库） |

---

## 五、功能需求

### FR-01 认证与身份

- 登录仍为 `POST /api/v1/auth/login`（验证码 + 用户名密码），成功后返回 JWT。
- JWT 载荷**不包含权限集合**，仅保留 `sub`（用户 ID）、username、email。
- 所有受保护接口通过统一的当前用户依赖解析身份；token 无效/过期返回 `code=401`，账号不存在/被禁用返回 `code=401`。
- 前端收到 401 语义错误（HTTP 401 或 `code=401`）时清除本地 token 并跳转登录页。

### FR-02 接口鉴权

- 除白名单外，所有 `/api/v1` 接口必须声明所需权限码。
- 校验顺序：解析 token → 校验账号存在且启用 → 超级管理员直接放行 → 取用户权限集合 → 判断所需权限是否在集合内。
- 未登录：`code=401`，消息"未登录或登录已过期"。
- 已登录但无权限：`code=403`，消息包含所需权限码，例如 `无权限访问（需要 agent:create）`。**沿用项目现有的 HTTP 200 + body code 响应约定**，前端统一拦截 `code=403`。
- 超级管理员（`is_superuser=true`）跳过权限判断，但仍需有效 token 与启用状态。
- **白名单（免权限码校验）**（固定）：

| 接口 | 说明 |
|---|---|
| `POST /api/v1/auth/login` | 登录 |
| `GET /api/v1/captcha`、`POST /api/v1/captcha` | 验证码 |
| `GET /api/v1/users/me` | 仅要求登录，不要求权限码 |
| `GET /health` | 健康检查 |
| `/docs`、`/redoc`、`/openapi.json` | 接口文档（生产环境可通过配置关闭） |

- 未在权限映射中登记的接口，默认**拒绝**（403），不允许"未声明即放行"。

### FR-03 权限缓存与即时失效

- 用户权限集合缓存于 Redis，key 建议 `rbac:perms:user:{user_id}`，TTL 300 秒，仅作为兜底。
- 缓存未命中时从数据库读取用户角色及其权限并集，回填缓存。
- Redis 不可用时降级为每次查库，不阻断业务。
- **授权变更必须同步失效缓存**，保证"立即生效"：

| 变更操作 | 失效范围 |
|---|---|
| 给角色分配权限 | 该角色下所有用户的权限缓存 |
| 给用户分配角色 | 该用户的权限缓存 |
| 删除角色 | 原关联该角色的所有用户 |
| 禁用 / 删除用户 | 该用户（禁用后 401 由身份校验兜底） |
| 修改角色权限后批量影响 | 同上，按角色反查用户 |
| 数据迁移 / 种子执行 | 清空全部 `rbac:perms:user:*` |

- 缓存失效在授权变更事务提交后执行；失效失败时记录错误日志，并依赖 300 秒 TTL 最终收敛。
- 多实例部署时共享同一 Redis，失效对所有实例生效。

### FR-04 当前用户权限接口

- `GET /api/v1/users/me` 响应在现有字段基础上**新增**：

```json
{
  "id": 1,
  "username": "admin",
  "email": "admin@example.com",
  "is_active": true,
  "is_superuser": true,
  "roles": [
    { "id": 1, "code": "admin", "name": "管理员" }
  ],
  "permissions": ["agent:view", "agent:create", "..."]
}
```

- `permissions` 为合并去重后的权限码数组；超级管理员返回全量权限码（便于前端统一控制），同时 `is_superuser=true` 可作为额外判断依据。
- 该接口必须轻量（走缓存），可被前端在路由切换时频繁调用。

### FR-05 角色管理

- 角色 CRUD 保持不变，新增字段 `is_system`。
- 角色列表/详情返回权限列表与关联用户数（用户数用于删除前提示）。
- 角色权限分配接口 `PUT /api/v1/roles/{role_id}/permissions` 由"勾选列表"改为矩阵数据的提交，入参仍为权限 ID 数组，语义为**全量覆盖**。
- 保存后立即失效该角色下所有用户的权限缓存。
- 角色页提供「模块 × 动作」矩阵编辑器：
  - 行：Agent、模型、Prompt、知识库、工具、对话日志、数据统计、系统管理（用户/角色/权限/API Key/审计/告警/配置分组）；
  - 列：查看、创建、编辑、删除、发布；
  - 仅展示该模块实际存在的动作组合，不存在的组合显示为不可选；
  - 预留模块（对话日志、数据统计、API Key、审计日志、告警规则、系统配置）整行标注"待后端实现"，可勾选但提示仅控制前端入口；
  - 提供"全选/清空/按模块全选"辅助操作；
  - 保存前提示影响范围（该角色下用户数）。

### FR-06 权限目录（只读）

- 权限定义与后端执行点强耦合，**不允许在管理端随意增删改**，否则会出现"有权限码但无接口"或"接口有校验但目录里没有"的漂移。
- 权限管理页改为**只读目录**：
  - 保留列表、搜索、按模块分组、状态（已实现/预留）展示；
  - 移除创建、编辑、删除入口；
  - 展示权限码、名称、所属模块、动作、说明。
- 权限的增删变更随版本升级通过数据库迁移完成。
- 后端权限写接口保留并受 `permission:create/update/delete` 保护（管理员角色持有这三条权限，便于运维排障），管理端页面不暴露入口。

### FR-07 用户角色分配

- 沿用 `PUT /api/v1/users/{user_id}/roles`，全量覆盖用户的角色列表。
- 用户管理页可查看用户当前角色，分配时以多选方式提交。
- 保存后立即失效该用户权限缓存。
- 用户列表展示角色名称；无角色用户标记为"未分配角色"。
- 禁止用户修改自己的角色（避免自行提权），由后端校验。

### FR-08 前端菜单与路由控制

- 登录成功后（或刷新页面时）调用 `/users/me` 获取角色与权限集合，存入内存中的全局上下文；**不写入 localStorage**，避免权限数据被手工篡改后误导 UI（后端仍是最终裁决）。
- 每次路由切换时重新拉取（可由服务端缓存承担开销），保证撤销权限后一次导航内 UI 同步。
- 侧边栏菜单按权限过滤：菜单项与所需权限的映射见第七节。
- 系统管理子菜单：没有任何系统管理权限时整个分组隐藏。
- 路由守卫：直接输入无权 URL，重定向到 403 页面（不跳登录页）。
- 以下页面仅要求登录，不要求权限码：工作台 `/`、个人中心 `/profile`、个人设置 `/settings`。

### FR-09 前端按钮级控制

- 提供统一的权限判断能力（如 `<Can code="agent:create">` 或 `hasPermission()`），页面内操作按钮按权限渲染：
  - 创建、编辑、删除、发布、启停、上传、重试、测试等写操作按钮，无权限时**不渲染**；
  - 表格操作列若无任何可用操作，保留列但不显示按钮；
  - 列表页的"新建"按钮同理。
- 典型页面清单（全部页面均需覆盖）：

| 页面 | 需要控制的关键按钮 |
|---|---|
| Agent 列表/详情/创建/版本/测试 | 新建、编辑、删除、发布、回滚、启动、停止 |
| 模型列表/供应商/创建/测试 | 添加模型、编辑、删除、测试连接、添加供应商 |
| Prompt 列表/创建/版本 | 新建、编辑、删除、发布、回滚 |
| 知识库列表/详情/创建/文档/分段/测试 | 新建、编辑、删除、上传文档、重试、删除文档/分段、编辑分段、检索测试 |
| 工具列表/详情/创建 | 注册、编辑、删除、启用、禁用、测试 |
| 对话日志 | 查看（预留） |
| 数据统计 | 查看（预留） |
| 用户管理 | 添加用户、编辑、删除、分配角色 |
| 角色管理 | 创建角色、编辑、删除、配置权限 |
| 权限管理 | 仅查看（写入口移除） |
| API 密钥 / 审计日志 / 告警规则 / 系统配置 | 对应操作（预留） |

### FR-10 无权限反馈

- 后端返回 `code=403` 时，前端统一拦截：
  - 页面内操作被拒：弹出提示"无权限执行该操作（需要 xxx）"，并刷新当前用户权限集合；
  - 路由级无权：跳转 403 页面，提供"返回工作台"按钮；
  - 不得静默失败，不得跳转登录页。
- 新增 403 页面路由 `/403`。
- 前端 API 客户端需同时修正 P8：识别 `code=401`（HTTP 200 场景）并跳转登录，识别 `code=403` 并统一提示。

### FR-11 鉴权覆盖率保障

- 提供一条自动化测试：遍历应用注册的全部路由，对每个 `/api/v1` 路由断言其已声明权限码或属于白名单；否则测试失败。
- 权限码与接口的映射需有唯一来源（代码中的权限声明），管理端目录数据从同一来源生成/校验。
- 提供测试用例覆盖：
  1. 无 token 访问受保护接口 → 401；
  2. 有 token 无权限 → 403；
  3. 有对应权限 → 成功；
  4. 超级管理员无角色权限 → 成功；
  5. 撤销角色权限后，同一 token 下一次请求 → 403（即时失效）；
  6. 禁用用户后，已签发 token → 401；
  7. 白名单接口无需登录即可访问；
  8. 未声明权限的新接口 → 覆盖率测试失败。

### FR-12 防锁死与内置角色保护

- `is_system` 角色不可删除、编码不可修改（FR 见 4.5）。
- 不允许删除/禁用自己。
- 不允许移除最后一个超级管理员（`is_superuser`）。
- 初始化数据保证至少一个 `is_superuser=true` 且拥有 admin 角色的账号。
- 提供配置项 `RBAC_ENFORCE`（默认开启）：关闭时仅记录"应校验但放行"的告警日志，用于迁移期排查；**生产环境必须开启**，启动时若关闭需打印显著警告。

### FR-13 种子数据与数据迁移

- 权限目录重置为 4.3 节的 47 条，删除旧的 12 条通配/半细粒度权限码。
- 内置角色重置为 `admin` / `developer` / `operator` / `viewer` 四个，均标记 `is_system=true`。
- 旧 `operator` 角色保留 code，名称改为"运营人员/运营"，权限集按 4.4 节重写。
- 新增 `developer`、`viewer` 两个角色。
- 初始 `admin` 账号（`is_superuser=true`）继续关联 `admin` 角色。
- 迁移要求：
  - 新建 Alembic 迁移：为 `roles` 增加 `is_system` 字段；执行权限码与角色种子数据的重建；
  - 迁移可重复执行（幂等），重复执行不产生重复数据；
  - 旧权限码到新权限码的映射规则：`agent:*` → `agent:view/create/update/delete/publish`；`model:*` → `model:view/create/update/delete`；`prompt:*` → 全部 5 条；`knowledge:*` → `knowledge:view/create/update/delete`；`tool:*` → 全部 4 条；`user:list` → `user:view`；`role:list` → `role:view`；`permission:list` → `permission:view`；`role:assign` → `role:update`；
  - 迁移完成后清空权限缓存。

---

## 六、页面需求

### 6.1 角色管理 `/system/roles`

- 列表列：角色名称、编码、描述、用户数、权限数、类型（内置/自定义）、操作。
- 内置角色显示"内置"标签，删除按钮禁用并提示原因。
- 「配置权限」打开矩阵弹窗（替代现有勾选列表）：

```
┌─ 配置权限：开发者 ────────────────────────────────┐
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

- 保存成功提示"权限已更新，对该角色下用户立即生效"。

### 6.2 权限管理 `/system/permissions`

- 列表列：ID、模块、权限码、名称、动作、状态、说明。
- 支持按模块筛选与关键词搜索。
- 移除创建/编辑/删除按钮；页面顶部说明"权限目录由系统维护，如需新增请联系版本升级"。
- 预留权限显示"未上线"标签。

### 6.3 用户管理 `/system/users`

- 列表增加角色列（多角色以标签展示），无角色显示"未分配角色"。
- 分配角色弹窗保留，改为展示角色名称与编码。
- 禁止操作自己（编辑角色、删除）。

### 6.4 403 页面 `/403`

- 文案：无权访问该页面；展示当前账号与所需权限（若可得）；按钮"返回工作台"。

### 6.5 侧边栏

- 菜单项按权限过滤，映射见 7.3。
- 「系统设置」分组在用户无任何系统管理查看权限时整体隐藏。
- 用户下拉菜单显示当前角色（可选）。

### 6.6 各业务页面

- 按 FR-09 的按钮清单接入权限控制。
- 无权限的数据请求若因历史原因仍被发出，后端 403 由统一拦截处理。

---

## 七、接口需求

### 7.1 新增 / 变更接口

| 接口 | 变更 | 说明 |
|---|---|---|
| `GET /api/v1/users/me` | 变更 | 增加 `is_superuser`、`roles`、`permissions` |
| `GET /api/v1/roles/{id}`、`GET /api/v1/roles/`、`GET /api/v1/roles/search` | 变更 | Role 增加 `is_system`、`user_count` |
| `PUT /api/v1/roles/{id}/permissions` | 语义明确 | 全量覆盖；成功后失效该角色用户缓存 |
| `PUT /api/v1/users/{id}/roles` | 语义明确 | 全量覆盖；成功后失效该用户缓存；禁止修改自己 |
| `DELETE /api/v1/roles/{id}` | 变更 | `is_system` 角色拒绝；存在关联用户拒绝 |
| `DELETE /api/v1/users/{id}` | 变更 | 禁止删除自己；禁止删除最后一个超级管理员 |
| 所有受保护接口 | 变更 | 增加权限校验；错误码 401/403 |

### 7.2 统一错误码（新增约定）

| code | HTTP 状态 | 含义 | 前端行为 |
|---|---|---|---|
| 401 | 200（沿用现有约定） | 未登录 / token 过期 / 账号禁用 | 清除 token，跳登录 |
| 403 | 200（沿用现有约定） | 已登录但无权限 / 接口未声明权限 | 提示无权限，刷新权限集合；路由级跳 /403 |

> 保持 HTTP 200 是为了兼容现有前端与全局异常处理器；错误语义由 body `code` 承载。前端 `apiClient` 需显式处理 `code=401` 与 `code=403`。

### 7.3 全量接口 → 权限映射

> 以下为 V2 实施完成的校验关系。`prefix` 均为 `/api/v1`。

#### 认证与验证码（白名单，无需登录）

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | `/auth/login` | — |
| GET | `/captcha` | — |
| POST | `/captcha` | — |

#### 用户

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/users/me` | 仅登录 |
| POST | `/users` | `user:create` |
| GET | `/users` | `user:view` |
| GET | `/users/search` | `user:view` |
| GET | `/users/{user_id}` | `user:view` |
| GET | `/users/{user_id}/roles` | `user:view` |
| PUT | `/users/{user_id}/roles` | `user:update` |
| DELETE | `/users/{user_id}` | `user:delete` |

#### 角色

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/roles/` | `role:view` |
| GET | `/roles/search` | `role:view` |
| GET | `/roles/{role_id}` | `role:view` |
| POST | `/roles` | `role:create` |
| PUT | `/roles/{role_id}` | `role:update` |
| PUT | `/roles/{role_id}/permissions` | `role:update` |
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

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | `/agents` | `agent:create` |
| GET | `/agents` | `agent:view` |
| GET | `/agents/{agent_id}` | `agent:view` |
| GET | `/agents/{agent_id}/versions` | `agent:view` |
| PUT | `/agents/{agent_id}` | `agent:update` |
| POST | `/agents/{agent_id}/start` | `agent:update` |
| POST | `/agents/{agent_id}/stop` | `agent:update` |
| POST | `/agents/{agent_id}/publish` | `agent:publish` |
| POST | `/agents/{agent_id}/rollback` | `agent:publish` |
| DELETE | `/agents/{agent_id}` | `agent:delete` |

#### 模型与供应商

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

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | `/prompts` | `prompt:create` |
| GET | `/prompts` | `prompt:view` |
| GET | `/prompts/{prompt_id}` | `prompt:view` |
| GET | `/prompts/{prompt_id}/versions` | `prompt:view` |
| PUT | `/prompts/{prompt_id}` | `prompt:update` |
| POST | `/prompts/{prompt_id}/publish` | `prompt:publish` |
| POST | `/prompts/{prompt_id}/rollback` | `prompt:publish` |
| DELETE | `/prompts/{prompt_id}` | `prompt:delete` |

#### 知识库

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | `/knowledge-bases` | `knowledge:create` |
| GET | `/knowledge-bases` | `knowledge:view` |
| GET | `/knowledge-bases/{kb_id}` | `knowledge:view` |
| PUT | `/knowledge-bases/{kb_id}` | `knowledge:update` |
| PUT | `/knowledge-bases/{kb_id}/config` | `knowledge:update` |
| DELETE | `/knowledge-bases/{kb_id}` | `knowledge:delete` |
| POST | `/knowledge-bases/{kb_id}/documents` | `knowledge:create` |
| GET | `/knowledge-bases/{kb_id}/documents` | `knowledge:view` |
| DELETE | `/knowledge-bases/{kb_id}/documents/{doc_id}` | `knowledge:delete` |
| POST | `/knowledge-bases/{kb_id}/documents/{doc_id}/retry` | `knowledge:update` |
| GET | `/knowledge-bases/{kb_id}/documents/{doc_id}/segments` | `knowledge:view` |
| GET | `/knowledge-bases/{kb_id}/segments` | `knowledge:view` |
| PUT | `/knowledge-bases/{kb_id}/segments/{seg_id}` | `knowledge:update` |
| DELETE | `/knowledge-bases/{kb_id}/segments/{seg_id}` | `knowledge:delete` |
| POST | `/knowledge-bases/{kb_id}/retrieval-test` | `knowledge:view` |

#### 工具

| 方法 | 路径 | 权限 |
|---|---|---|
| POST | `/tools` | `tool:create` |
| GET | `/tools` | `tool:view` |
| GET | `/tools/{tool_id}` | `tool:view` |
| PUT | `/tools/{tool_id}` | `tool:update` |
| POST | `/tools/{tool_id}/enable` | `tool:update` |
| POST | `/tools/{tool_id}/disable` | `tool:update` |
| POST | `/tools/{tool_id}/test` | `tool:update` |
| DELETE | `/tools/{tool_id}` | `tool:delete` |

#### 预留模块（后端暂无接口）

对话日志、数据统计、API Key、审计日志、告警规则、系统配置：本期不新增后端接口，对应权限仅用于前端菜单与路由控制；模块上线时必须按同样规则声明权限并纳入覆盖率测试。

### 7.4 前端路由 → 权限映射

| 路由 | 所需权限 |
|---|---|
| `/`、`/profile`、`/settings` | 仅登录 |
| `/agents`、`/agents/:id`、`/agents/:id/versions`、`/agents/:id/test`、`/agents/:id/monitor` | `agent:view` |
| `/agents/create` | `agent:create` |
| `/agents/:id/edit` | `agent:update` |
| `/models`、`/models/providers`、`/models/test` | `model:view` |
| `/models/create`（若有） | `model:create` |
| `/prompts`、`/prompts/:id/versions` | `prompt:view` |
| `/prompts/create` | `prompt:create` |
| `/prompts/:id` | `prompt:update`（编辑）或 `prompt:view` |
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

> 复用同一组件的路由（如 `/prompts/:id` 同时承担查看与编辑）需在页面内按权限区分按钮，不做路由级拒绝。

---

## 八、数据模型与迁移

### 8.1 表结构变更

| 表 | 变更 | 说明 |
|---|---|---|
| `roles` | 新增 `is_system` BOOLEAN NOT NULL DEFAULT 0 | 内置角色保护 |
| `permissions` | 数据重建，无结构变更 | 47 条内置权限；模块/动作从 code 解析 |
| `role_permissions` | 数据重建 | 按 4.4 节矩阵写入 |
| `user_roles` | 保留 | 初始 admin 账号维持 admin 角色 |

> 不改动 `permissions` 表结构，`模块` 与 `动作` 由 `code` 按 `:` 拆分得到；前端按资源前缀归组到 8 个业务域 + 系统管理分组。

### 8.2 迁移步骤（Alembic）

1. 新增 `is_system` 字段（默认 false）。
2. 删除旧权限与旧关联数据（或按映射改写）。
3. 写入 47 条新权限（幂等 upsert）。
4. 写入/更新 4 个内置角色并标记 `is_system=true`。
5. 按矩阵重建内置角色的 `role_permissions`。
6. 保证 admin 账号存在且 `is_superuser=true`、关联 admin 角色。
7. 清空权限缓存。

> 迁移不得破坏业务表数据（Agent、知识库等），只处理 RBAC 相关表。

### 8.3 回滚

- Alembic down 迁移恢复旧结构与旧种子；生产环境回滚前需评估角色权限配置数据丢失风险。

---

## 九、非功能需求

| 类别 | 要求 |
|---|---|
| 安全 | 默认拒绝；权限不写入 JWT；403 消息可包含所需权限码（内部系统可接受）；越权访问写应用日志（用户、路径、所需权限、IP、时间） |
| 性能 | 有缓存时单次鉴权附加耗时 P95 ≤ 10ms；缓存未命中查库 P95 ≤ 50ms；缓存失效对下一次请求生效 |
| 可用性 | Redis 故障不影响鉴权正确性（降级查库）；数据库故障返回 500 |
| 一致性 | 授权变更后，任何实例上的下一次请求不得再放行已撤销权限 |
| 可维护性 | 权限码与接口映射唯一来源；覆盖率测试纳入 CI；新增模块必须同步权限目录 |
| 兼容性 | 前端 Mock 模式继续可用：Mock 登录默认返回管理员全量权限，并支持模拟受限角色用于演示；后端响应除 `/users/me` 与 Role 字段外不变 |
| 可观测性 | 记录鉴权失败日志；可选暴露鉴权缓存命中率指标（后续） |
| 部署 | 新增配置项 `RBAC_ENFORCE`（默认 true）；生产必须开启 |

---

## 十、验收标准

| 编号 | 场景 | 预期 |
|---|---|---|
| AC-01 | 未登录调用 `GET /api/v1/agents` | `code=401`，不返回数据 |
| AC-02 | 登录用户无 `agent:create` 调用 `POST /api/v1/agents` | `code=403`，消息含 `agent:create` |
| AC-03 | 拥有 `agent:create` 的用户调用同一接口 | 成功 |
| AC-04 | 只读角色登录后查看侧边栏 | 仅显示业务模块查看入口，无系统设置分组 |
| AC-05 | 只读角色直接访问 `/system/users` | 跳转 `/403` |
| AC-06 | 只读角色进入 Agent 列表 | 无"新建/编辑/删除/发布"按钮 |
| AC-07 | 管理员取消开发者 `knowledge:delete` | 开发者下一次删除请求即 `code=403`（≤1 次请求延迟） |
| AC-08 | 管理员禁用某用户后该用户再次请求 | `code=401`，前端跳登录 |
| AC-09 | 管理员删除内置角色 admin | 拒绝，提示内置角色不可删除 |
| AC-10 | 管理员尝试删除自己 | 拒绝 |
| AC-11 | 管理员尝试取消最后一个超级管理员标记 | 拒绝 |
| AC-12 | 访问 `/users/me` | 返回 roles、permissions、is_superuser |
| AC-13 | 超级管理员（无任何角色权限）调用任意受保护接口 | 成功 |
| AC-14 | 新增一个未声明权限的 `/api/v1` 接口并运行测试 | 覆盖率测试失败 |
| AC-15 | 迁移脚本执行两次 | 数据不重复，结果一致 |
| AC-16 | Redis 停止后调用受保护接口 | 鉴权仍正确（查库降级），无 500 |
| AC-17 | 角色页保存权限矩阵 | 提示立即生效，且缓存已失效 |
| AC-18 | 权限管理页 | 无创建/编辑/删除入口，预留权限有标注 |

---

## 十一、实施阶段建议

| 阶段 | 内容 | 交付物 |
|---|---|---|
| P0 | 权限目录、内置角色、数据迁移 | Alembic 迁移 + 种子数据 |
| P1 | 鉴权内核（依赖、校验顺序、缓存、白名单）、覆盖率测试 | 后端鉴权基础能力 + 测试 |
| P2 | 按模块接入全部业务接口鉴权 | 接口权限声明 + 联调用例 |
| P3 | `/users/me` 扩展、前端权限上下文、菜单与路由守卫、403 页 | 前端控制面 |
| P4 | 按钮级控制、角色矩阵页改造、权限页只读化、用户页角色展示 | 管理端页面 |
| P5 | 联调、验收、Mock 模式适配 | 验收报告 |

> 建议 P2 按"系统管理 → Agent → Prompt/知识库 → 模型/工具"的顺序灰度接入，配合 `RBAC_ENFORCE` 开关排查遗漏接口。

---

## 十二、风险与开放问题

### 12.1 风险

| 编号 | 风险 | 应对 |
|---|---|---|
| RK-01 | 一次性为全部接口加鉴权，现有前端联调中断 | `RBAC_ENFORCE` 灰度开关；P2 分模块接入；覆盖率测试兜底 |
| RK-02 | 权限缓存与数据库不一致导致越权或误拒 | 事务提交后主动失效 + 300 秒 TTL + 即时生效测试用例 |
| RK-03 | 旧权限码迁移遗漏，导致自定义角色权限丢失 | 迁移前导出、映射表明确、幂等执行、迁移后校验内置角色矩阵 |
| RK-04 | 预留模块权限与实际接口不符 | 目录标注"未上线"；模块上线时必须同步接口声明 |
| RK-05 | 前端仅在内存保存权限，刷新后短暂空白 | 刷新时先拉 `/users/me` 再渲染受保护布局，加载态处理 |
| RK-06 | 管理员误操作导致无人可管理 | 内置角色保护 + 禁止删除/禁用自己 + 保留最后一个超级管理员 |

### 12.2 已决问题

| 问题 | 决策 |
|---|---|
| 授权范围 | 仅功能授权，不做数据权限 |
| 权限码粒度 | 统一 `资源:动作` 细粒度 |
| 撤销生效时机 | 立即生效（请求时校验 + 缓存主动失效） |
| 内置角色 | 4 个：admin / developer / operator / viewer |
| 接口鉴权实现方式 | **建议采用"接口级显式声明 + 覆盖率测试"**；作为技术方案输入，最终由实现阶段确认 |

### 12.3 待后续确认

| 编号 | 问题 | 影响 |
|---|---|---|
| Q1 | API Key 的权限范围与鉴权何时立项 | 影响 `/system/api-keys` 的最终形态 |
| Q2 | 数据权限（按归属/部门过滤）是否需要 | 后续版本可能引入，需预留 owner 字段设计 |
| Q3 | 审计日志是否落库 | 越权访问当前仅写应用日志 |
| Q4 | 是否需要权限变更的审批流 | 企业版可能有需求 |

---

## 十三、与现有文档的关系

- `docs/PROJECT_SPEC.md`：项目说明书 V1，描述架构与已完成能力，继续作为开发参考。
- 本文档：V2 需求基线，新增 RBAC 功能授权的需求、接口映射、数据迁移与验收标准。
- `app/docs/09-系统管理.md`：系统管理 UI 设计，本文档与其权限矩阵保持一致，并修正了"4 角色 vs 现有 2 角色"的差异。

---

## 十四、变更记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-10-25 | v2.0 | 首次发布：基于 PROJECT_SPEC.md 与现有 RBAC 数据模型，完成功能授权需求对齐，定义权限码体系、内置角色矩阵、接口映射、即时失效策略、前端控制与验收标准 |
