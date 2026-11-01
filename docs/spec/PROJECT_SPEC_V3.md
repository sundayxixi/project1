# 辰光 Agent 平台 — 产品需求与技术说明书 V3

| 项目 | 内容 |
|---|---|
| 文档名称 | PROJECT_SPEC_V3.md |
| 版本 | v3.0 |
| 状态 | 整合完成，作为唯一需求与架构基线（待评审） |
| 编写日期 | 2026-11-01 |
| 整合来源 | `docs/PROJECT_SPEC.md`（项目说明书 V1）、`docs/spec/PROJECT_SPEC_V2.md`（RBAC 功能授权 + 数据级授权 V2.0） |
| 覆盖承诺 | 本文档完整覆盖上述两份文档的全部章节、表格、清单与验收标准；凡 V1/V2 中未被本文档显式修订的内容，继续有效 |
| 关联文档 | `app/docs/00-架构总览.md` 及 `01`~`10` 系列设计文档、`app/docs/知识库后端开发流程.md`、`docs/design/plans/`（12 个模块实施计划） |
| 约束 | 第 12~25 章为 RBAC 需求基线，不含实现代码；实现阶段另行编写技术方案与任务计划 |

> **文档定位**：V3 是 V1（项目全貌与工程基线）与 V2（RBAC 功能授权 + 数据级授权）的整合版本。V1 描述的架构、技术栈、目录、开发规范、环境与依赖继续作为开发参考；V2 描述的授权模型、权限码、数据范围、接口映射与验收标准作为需求基线。原两份文档保留作历史追溯，后续以本文档为准。

---

## 阅读指引

| 部分 | 章节 | 内容 | 用途 |
|---|---|---|---|
| 第一部分 架构与工程基线 | 第 1~11 章 | 项目概述、目录结构、后端/前端架构、数据模型速查、开发约定、环境搭建、依赖、前端 API 规范、设计文档索引、基线待办 | 快速理解项目全貌，指导日常开发与扩展 |
| 第二部分 RBAC 授权需求 | 第 12~25 章 | 背景与问题、目标/非目标、角色与场景、授权模型、功能授权、数据级授权、FR、页面、接口、数据模型与迁移、非功能、验收、实施阶段、风险 | 需求对齐、评审、验收与实施排期 |
| 第三部分 收口与追溯 | 第 26~28 章 | 文档关系、合并后的变更记录、V1/V2 → V3 覆盖对照表 | 追溯来源、确认无遗漏 |

---

# 第一部分 架构与工程基线

## 1. 项目概述

辰光 Agent 平台是一个**企业级 AI Agent 管理平台**，提供 Agent 全生命周期管理、知识库（RAG）管理、Prompt 工程、模型管理、工具编排、对话日志分析等能力。

项目采用**前后端分离**架构：

- **后端**：Python 3.13 + FastAPI（异步），位于根目录 `src/`
- **前端**：React 19 + TypeScript + Vite，位于 `app/` 目录
- **数据库**：MySQL（通过 SQLAlchemy 异步 ORM）
- **缓存**：Redis（验证码存储、RBAC 权限缓存等）
- **数据库迁移**：Alembic

### 1.1 当前开发状态

| 层 | V1（2026-03 编写时）状态 | V3 对账（2026-11-01） |
|---|---|---|
| 后端 — RBAC 模块（用户/角色/权限/认证/验证码） | ✅ 已实现 | ✅ 数据模型与 CRUD 已落库；**功能鉴权与数据级授权尚未生效**，见第 12 章问题清单 P1~P14 |
| 后端 — Agent/模型/Prompt/知识库/工具等业务模块 | ❌ 待实现 | ⚠️ 截至 V2 需求对齐，CRUD 接口已落地（仓库 `src/modules/` 已含 agent、model、provider、prompt、knowledge、tool），但接口普遍未校验登录/权限，且无数据归属过滤（见 12.1） |
| 前端 — 全部页面 UI + Mock 数据 | ✅ 已实现 | ✅ 已实现，Mock 模式默认开启 |
| 前端 — 对接真实后端 API | ❌ 待实现（已预留 API 层） | ⚠️ 认证、系统管理、业务模块创建/编辑页面已对接（见 27.1 变更记录）；RBAC 控制面（菜单/路由/按钮/403）待实现（见 19 章） |

> 上述「对账」结论综合了 V1 变更记录、V2 背景描述与当前仓库目录结构。若实现进度与此不符，以代码与最新提交为准，并同步更新本表。

---

## 2. 目录结构

> 目录树在 V1 基础上按当前仓库实际结构补全（V1 编写时业务模块目录尚未创建）。

```
chenguang-agent-platform/
├── .env / .env.example          # 后端环境变量
├── alembic.ini                  # Alembic配置
├── alembic/                     # 数据库迁移脚本
│   ├── env.py                   # 迁移环境（异步引擎）
│   └── versions/                # 迁移版本文件
├── requirements.txt             # Python依赖
├── src/                         # ===== 后端源码 =====
│   ├── main.py                  # FastAPI入口，注册路由/中间件/异常处理
│   ├── core/                    # 核心基础设施
│   │   ├── config.py            # 配置管理（pydantic-settings）
│   │   ├── base_model.py        # ORM基类（id + created_at + updated_at）
│   │   ├── base_repository.py   # 通用Repository（CRUD + 分页搜索）
│   │   ├── base_schema.py       # 通用响应Schema（ResponseSchema + PageResult）
│   │   ├── deps.py              # FastAPI依赖注入（get_current_user, PageParams）
│   │   ├── exceptions.py        # 业务异常 + 全局异常处理器
│   │   └── logger.py            # Loguru日志配置
│   ├── infra/                   # 基础设施
│   │   ├── database.py          # SQLAlchemy异步引擎 + 会话工厂
│   │   ├── redis_cache.py       # Redis异步客户端
│   │   └── minio_client.py      # MinIO对象存储客户端
│   ├── middlewares/
│   │   └── logging.py           # 请求日志中间件
│   ├── modules/                 # ===== 业务模块 =====
│   │   ├── auth/                # 认证模块
│   │   ├── captcha/             # 验证码模块
│   │   ├── user/                # 用户模块
│   │   ├── role/                # 角色模块
│   │   ├── permission/          # 权限模块
│   │   ├── agent/               # Agent模块（CRUD/版本/启停/发布）
│   │   ├── model/               # 模型模块
│   │   ├── provider/            # 模型供应商模块
│   │   ├── prompt/              # Prompt模块
│   │   ├── knowledge/           # 知识库模块（文档/分段/检索）
│   │   └── tool/                # 工具模块
│   └── utils/
│       ├── jwt_utils.py         # JWT编解码
│       └── password_utils.py    # bcrypt密码加密
├── app/                         # ===== 前端源码 =====
│   ├── .env                     # 前端环境变量（VITE_USE_MOCK=true）
│   ├── package.json             # 前端依赖
│   ├── src/
│   │   ├── main.tsx             # 入口
│   │   ├── App.tsx              # 路由定义
│   │   ├── layouts/
│   │   │   └── DashboardLayout.tsx  # 主布局（侧边栏+面包屑+内容区）
│   │   ├── pages/               # 页面组件（按模块分目录）
│   │   ├── components/ui/       # Shadcn UI组件
│   │   ├── services/            # 数据服务层（核心抽象）
│   │   └── hooks/               # 自定义Hooks
│   └── docs/                    # 前端设计文档（各模块详细设计）
├── docs/                        # 项目文档
│   ├── PROJECT_SPEC.md          # V1 项目说明书（历史）
│   ├── spec/
│   │   ├── PROJECT_SPEC_V2.md   # V2 RBAC 需求（历史）
│   │   └── PROJECT_SPEC_V3.md   # V3 整合版（本文档）
│   ├── design/
│   │   ├── plans/               # 12 个模块实施计划
│   │   └── ui/                  # UI 原型设计
│   ├── deployment/              # 部署相关文档
│   └── ui/                      # UI 产物
└── README.md
```

---

## 3. 后端架构详解

### 3.1 启动入口 (`src/main.py`)

```python
# 启动命令
uvicorn src.main:app --port 8080 --reload
```

`create_app()` 函数中：

1. 创建 FastAPI 实例
2. 注册 `LoggingMiddleware`（请求耗时日志）
3. 注册全局异常处理器（`BizException` → 200 + 错误码，`Exception` → 500）
4. 注册路由（所有模块统一 `/api/v1` 前缀）
5. `lifespan` 上下文管理器负责启动/关闭时的资源管理

### 3.2 已注册的 API 路由

> 下表为 V1 编写时已注册的路由。Agent/模型/Prompt/知识库/工具等业务模块路由在后续迭代中追加，完整的「接口 → 权限」映射见 20.3 节。

| 前缀 | 模块 | 关键接口 |
|------|------|---------|
| `/api/v1/auth` | 认证 | `POST /login` |
| `/api/v1/captcha` | 验证码 | `GET /`（获取）、`POST /`（验证） |
| `/api/v1/users` | 用户 | CRUD、`GET /me`、`GET /search`、`PUT /{id}/roles` |
| `/api/v1/roles` | 角色 | CRUD、`GET /search`、`PUT /{id}/permissions` |
| `/api/v1/permissions` | 权限 | CRUD、`GET /search` |

### 3.3 分层架构（每个模块统一结构）

```
modules/<module_name>/
├── api.py          # 路由层：接收请求 → 调用Service → 封装ResponseSchema返回
├── service.py      # 业务层：业务逻辑 + 校验 → 调用Repository
├── repository.py   # 数据层：继承BaseRepository，提供特定查询方法
├── model.py        # ORM模型：继承BaseModel（自带id/created_at/updated_at）
└── schema.py       # Pydantic模型：请求体(Create/Update) + 响应体(Read)
```

**依赖注入链**：

```
API层 ← Depends(get_xxx_service)
  └── Service ← __init__(db: AsyncSession)
        └── Repository ← __init__(Model, db)
              └── BaseRepository（通用CRUD + 分页搜索）
```

### 3.4 核心基类

**BaseModel** (`src/core/base_model.py`)：

- 所有 ORM 模型继承此类
- 自带字段：`id`（BigInteger，自增主键）、`created_at`、`updated_at`（数据库自动维护）

**BaseRepository** (`src/core/base_repository.py`)：

- 泛型类 `BaseRepository[T]`，T 必须是 BaseModel 子类
- 提供：`get_by_id`、`get_all`、`create`、`update`、`delete`、`delete_by_id`
- 核心方法 `get_page(offset, limit, keyword, search_fields)` → 通用分页 + 模糊搜索

**ResponseSchema** (`src/core/base_schema.py`)：

```python
class ResponseSchema(BaseModel, Generic[T]):
    code: int = 200
    message: str = "success"
    data: Optional[T] = None

class PageResult(BaseModel, Generic[T]):
    items: list[T] = []
    total: int = 0
    page: int = 1
    page_size: int = 20
```

### 3.5 认证机制

1. **登录流程**：`POST /api/v1/auth/login`
   - 前端提交 `{username, password, captcha_key, captcha_code}`
   - 后端先验证验证码（Redis 存储，5 分钟过期）
   - 再校验用户名/密码（bcrypt）
   - 成功返回 JWT token（30 分钟有效期，HS256 算法）

2. **接口鉴权**：通过 `Depends(get_current_user)` 注入
   - 从 `Authorization: Bearer <token>` 提取 token
   - 解码 JWT 获取 `user_id`
   - 查询数据库返回完整 User 对象（含角色信息，`lazy="selectin"` 立即加载）

3. **验证码**：`GET /api/v1/captcha`
   - 生成 4 位随机字符 + UUID key
   - 存入 Redis（`captcha:{uuid}` → code，5 分钟过期）
   - 返回 base64 图片 + key

> 以上为 V1 基线的认证能力。RBAC 引入后的鉴权执行链、权限缓存与白名单见 18 章（FR-01~FR-03）。

### 3.6 数据库模型关系

```
Users ──M:N──> Roles ──M:N──> Permissions
       (user_roles)     (role_permissions)
```

- `user_roles`：用户-角色关联表（复合主键 `user_id` + `role_id`）
- `role_permissions`：角色-权限关联表（复合主键 `role_id` + `permission_id`）
- 关联关系使用 `lazy="selectin"` 立即加载

> RBAC 另外新增 `role_data_scopes`、`role_data_scope_targets`、`resource_acl`，并为业务表增加 `owner_id`，见 21 章。

### 3.7 配置管理

通过 `.env` 文件 + `pydantic-settings` 管理：

```env
APP_NAME=辰光Agent
APP_ENV=dev
APP_DEBUG=true
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=123456
DB_NAME=chenguang
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=123456
REDIS_DB=0
LOG_LEVEL=DEBUG
LOG_DIR=logs
```

数据库连接串自动拼接：`mysql+asyncmy://{user}:{password}@{host}:{port}/{db}?charset=utf8mb4`

> RBAC 新增配置项 `RBAC_ENFORCE`（默认 `true`），见 FR-12 与第 22 章。

### 3.8 数据库迁移（Alembic）

```bash
# 生成迁移脚本
alembic revision --autogenerate -m "描述本次变更"
# 执行迁移
alembic upgrade head
# 回滚
alembic downgrade -1
```

`alembic/env.py` 已配置异步引擎，从 `.env` 读取数据库 URL。

---

## 4. 前端架构详解

### 4.1 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 框架 | React + TypeScript | React 19, TS 5.9 |
| 构建 | Vite | 7.x |
| 路由 | React Router | v7 |
| UI 组件库 | Shadcn UI (Radix UI) | 最新 |
| 样式 | Tailwind CSS | v4 |
| 图标 | Lucide React | 最新 |
| 状态管理 | React useState（无全局状态库） | - |
| HTTP 客户端 | 原生 fetch 封装 | - |

### 4.2 启动方式

```bash
cd app
npm install
npm run dev          # Mock模式（默认）

# 连接真实后端
VITE_USE_MOCK=false VITE_API_BASE=http://localhost:8080/api npm run dev
```

### 4.3 路由结构 (`App.tsx`)

```
/login                          → Login（独立页面，无侧边栏）
/                               → DashboardLayout 包裹
  ├── /                         → Dashboard（工作台）
  ├── /profile                  → Profile（个人信息）
  ├── /settings                 → Settings（个人设置）
  ├── /agents                   → AgentList
  ├── /agents/create            → AgentCreate
  ├── /agents/:id               → AgentDetail
  ├── /agents/:id/edit          → AgentCreate（复用）
  ├── /agents/:id/test          → AgentTest
  ├── /agents/:id/versions      → AgentVersions
  ├── /agents/:id/monitor       → AgentMonitor
  ├── /models                   → ModelList
  ├── /models/providers         → ModelProviders
  ├── /prompts                  → PromptList
  ├── /prompts/create           → PromptCreate
  ├── /prompts/:id              → PromptCreate（复用）
  ├── /prompts/:id/versions     → PromptVersions
  ├── /knowledge                → KnowledgeList
  ├── /knowledge/create         → KnowledgeCreate
  ├── /knowledge/:id            → KnowledgeDetail
  ├── /knowledge/:id/documents  → KnowledgeDocuments
  ├── /knowledge/:id/segments   → KnowledgeSegments
  ├── /knowledge/:id/test       → KnowledgeTest
  ├── /tools                    → ToolList
  ├── /tools/create             → ToolCreate
  ├── /tools/:id                → ToolDetail
  ├── /conversations            → ConversationList
  ├── /conversations/:id        → ConversationDetail
  ├── /analytics                → AnalyticsUsage
  ├── /analytics/costs          → AnalyticsCosts
  ├── /analytics/evaluation     → AnalyticsEvaluation
  ├── /system/users             → SystemUsers
  ├── /system/roles             → SystemRoles
  ├── /system/permissions       → SystemPermissions
  ├── /system/api-keys          → SystemApiKeys
  ├── /system/audit             → SystemAudit
  ├── /system/alerts            → SystemAlerts
  └── /system/settings          → SystemSettings
```

> RBAC 实施后，以上路由的访问权限映射及 `/403` 页面见 19、20.4 节。

### 4.4 数据服务层（核心设计）

这是前端最重要的架构设计——**Mock/API 无缝切换**。

```
app/src/services/
├── config.ts              # USE_MOCK 开关 + API_BASE
├── agent.ts               # 对外暴露：export const agentService = USE_MOCK ? mock : api
├── model.ts               # 同上模式
├── prompt.ts
├── knowledge.ts
├── tool.ts
├── conversation.ts
├── analytics.ts
├── dashboard.ts
├── system.ts
├── types/                 # TypeScript类型定义（所有接口的数据结构）
│   ├── common.ts          # ApiResponse, PaginatedResponse, PaginationParams
│   ├── agent.ts           # Agent, AgentConfig, AgentVersion, AgentStats
│   ├── model.ts           # Model, ModelProvider, ModelCapability
│   ├── prompt.ts          # Prompt, PromptVariable, PromptVersion
│   ├── knowledge.ts       # KnowledgeBase, Document, Segment, RetrievalResult
│   ├── tool.ts            # Tool, ToolDetail, HttpApiConfig, FunctionDefinition
│   ├── conversation.ts    # Conversation, ConversationTurn, TurnTrace
│   ├── analytics.ts       # AnalyticsOverview, DailyStats, CostAnalysis, Evaluation
│   ├── dashboard.ts       # DashboardStats, TrendData, AgentRanking, Alert
│   └── system.ts          # User, Role, Permission, ApiKey, AuditLog, AlertRule
├── mock/                  # Mock实现（带模拟延迟，内存数据操作）
│   ├── agent.ts
│   ├── model.ts
│   ├── ...
│   └── data/              # Mock静态数据（中文内容，15-20条/列表）
└── api/                   # 真实API实现（调用apiClient）
    ├── client.ts          # fetch封装（GET/POST/PUT/DELETE，自动解析data字段）
    ├── agent.ts
    ├── model.ts
    └── ...
```

**切换原理**：

```typescript
// services/config.ts
export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'
export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080/api'

// services/agent.ts（每个模块都是这个模式）
import { USE_MOCK } from './config'
import { mockAgentService } from './mock/agent'
import { apiAgentService } from './api/agent'
export const agentService = USE_MOCK ? mockAgentService : apiAgentService
```

**页面调用方式**（所有页面统一）：

```typescript
import { agentService } from '@/services/agent'
const data = await agentService.getAgentList({ page: 1, pageSize: 20 })
```

### 4.5 API 客户端 (`services/api/client.ts`)

基于原生 `fetch` 封装的 `ApiClient` 类：

- 支持 `get`、`post`、`put`、`delete` 方法
- GET 请求自动拼接 query params
- 自动解析响应中的 `data` 字段
- 统一 `Content-Type: application/json`
- **自动注入 `Authorization: Bearer <token>`**（从 `localStorage` 读取）
- **401 自动跳转 `/login`**（token 过期处理）
- 业务错误码（`code !== 200`）自动抛出 `Error`

Token 管理通过 `tokenStorage` 工具统一操作：

```typescript
import { tokenStorage } from '@/services/api/client'
tokenStorage.set(token)   // 登录后存储
tokenStorage.get()        // 读取
tokenStorage.remove()     // 退出时清除
```

> RBAC 实施后，`apiClient` 还需显式识别 `code=401` 与 `code=403`（后端沿用 HTTP 200 + body code 约定，见 20.2），并支持权限上下文刷新。

### 4.5.1 认证服务 (`services/auth.ts`)

新增认证服务，统一管理登录/登出/验证码：

```typescript
import { authService } from '@/services/auth'

// 获取验证码（返回 { key, image } ）
const captcha = await authService.getCaptcha()

// 登录（成功后自动存储 token）
await authService.login({ username, password, captcha_key, captcha_code })

// 退出（清除 token）
authService.logout()

// 检查是否已登录
authService.isLoggedIn()
```

Mock 模式下：验证码前端自生成（4 位随机字符），登录不校验密码强度，直接生成 mock token。

> RBAC 适配要求：Mock 登录默认返回管理员全量权限与 `ALL` 数据范围，并支持模拟受限角色（见第 22 章兼容性要求）。

### 4.6 主布局 (`layouts/DashboardLayout.tsx`)

- 左侧固定侧边栏：导航菜单（工作台/Agent 管理/模型管理/…）+ 系统管理子菜单
- 顶部面包屑导航（根据路由自动生成）
- 右上角用户头像下拉菜单（个人信息/设置/退出）
- 内容区通过 `<Outlet />` 渲染子路由

> RBAC 实施后，侧边栏菜单按功能权限过滤；无任何系统管理权限时隐藏整个分组（见 FR-08、19.6）。

### 4.7 页面组件结构

每个模块的页面文件位于 `app/src/pages/<module>/`，通过 `index.ts` 统一导出：

```typescript
// pages/agent/index.ts
export { default as AgentList } from './List'
export { default as AgentCreate } from './Create'
export { default as AgentDetail } from './Detail'
// ...
```

页面组件的通用模式：

1. `useState` 管理本地状态
2. `useEffect` 中调用 service 加载数据
3. 使用 Shadcn UI 组件（Card、Table、Badge、Button 等）构建 UI
4. 列表页支持搜索、筛选、分页
5. 详情页支持编辑、删除确认对话框

---

## 5. 数据模型速查（基线）

### 5.1 后端 ORM 模型（已实现）

| 表名 | 模型类 | 关键字段 |
|------|--------|---------|
| `users` | `User` | username, email, hashed_password, is_active, is_superuser, last_login, roles(M:N) |
| `roles` | `Role` | code, name, description, permissions(M:N) |
| `permissions` | `Permission` | code, name, description |
| `user_roles` | 关联表 | user_id, role_id（复合主键） |
| `role_permissions` | 关联表 | role_id, permission_id（复合主键） |

> RBAC 新增字段与表（`roles.is_system`、业务表 `owner_id`、`role_data_scopes`、`role_data_scope_targets`、`resource_acl`）见 21 章。

### 5.2 前端类型定义（完整，对应未来后端模型）

**Agent** (`types/agent.ts`)：

- `Agent`：id, name, description, type（conversation/tool/analysis/creative/workflow）, status（active/inactive/error/draft）, modelId, config(AgentConfig), successRate, callCount7d, version, …
- `AgentConfig`：model（模型参数）, prompt（系统提示词）, rag（知识库检索配置）, tools（工具列表）, advanced（欢迎语/建议问题/超时）
- `AgentVersion`：版本管理，含 changelog, isCurrent

**Model** (`types/model.ts`)：

- `Model`：id, name, modelId, providerId, capabilities[], contextLength, status, inputPrice, outputPrice, callCount7d, isDefault
- `ModelProvider`：id, name, type（openai/anthropic/aliyun/azure/local/custom）, status, endpoint, modelCount

**Prompt** (`types/prompt.ts`)：

- `Prompt`：id, name, description, category, tags[], content, variables(PromptVariable[]), version, status（draft/published）, usageCount
- `PromptVariable`：name, type（string/number/boolean/text）, description, defaultValue, required

**KnowledgeBase** (`types/knowledge.ts`)：

- `KnowledgeBase`：id, name, description, status（ready/indexing/error/empty）, documentCount, segmentCount, vectorCount, storageSize, embeddingModel
- `Document`：id, fileName, fileType（pdf/docx/md/txt/html/csv）, status（pending/processing/completed/failed）, segmentCount, wordCount
- `Segment`：id, content, wordCount, tokenCount, keywords[], hitCount

**Tool** (`types/tool.ts`)：

- `Tool`：id, name, description, type（builtin/http_api/custom_function）, status, callCount7d, successRate, avgLatency
- `ToolDetail`：extends Tool + config(HttpApiConfig | CustomFunctionConfig) + functionDefinition

**Conversation** (`types/conversation.ts`)：

- `Conversation`：id, agentId, agentName, turnCount, totalTokens, totalCost, satisfaction
- `ConversationTurn`：role（user/assistant）, content, trace(TurnTrace)
- `TurnTrace`：steps[]（receive/retrieval/tool_call/prompt_build/llm_call/response）, inputTokens, outputTokens

**System** (`types/system.ts`)：

- `User`：id, username, name, email, roleId, roleName, status
- `Role`：id, name, description, permissions[], userCount, isSystem
- `ApiKey`：id, name, key, permissions, status, rateLimit, callCount
- `AuditLog`：id, userId, action, module, targetId, detail, ipAddress
- `AlertRule`：id, name, condition（metric/operator/threshold/duration）, status
- `SystemSettings`：systemName, defaultModel, defaultTemperature, smtpServer, …

> 注意：上表为 V1 时前端类型设计；V2 迭代后业务页面已切换到后端 snake_case 类型（如 `model_id`、`call_count_7d`、`success_rate`、`avg_latency`），详见 27.1 变更记录。RBAC 引入后，资源类型新增 `owner_id`、`owner_name`、`can_manage`、`is_shared`（见 FR-14）。

---

## 6. 开发约定与规范

### 6.1 后端开发规范

**新增业务模块的标准步骤**：

1. 在 `src/modules/` 下创建模块目录
2. 创建 `model.py`（继承 `BaseModel`）
3. 创建 `schema.py`（Pydantic: XxxCreate, XxxUpdate, XxxRead）
4. 创建 `repository.py`（继承 `BaseRepository[Model]`，定义 `SEARCH_FIELDS`）
5. 创建 `service.py`（注入 Repository，实现业务逻辑）
6. 创建 `api.py`（定义路由，通过 `Depends` 注入 Service）
7. 在 `src/main.py` 中注册路由：`app.include_router(router, prefix="/api/v1")`
8. 在 `alembic/env.py` 中导入新模型
9. 执行 `alembic revision --autogenerate -m "xxx"` + `alembic upgrade head`

> RBAC 接入后的补充要求：新增接口必须声明权限码（或加入白名单），列表接口必须接入数据过滤，详情/写接口必须做数据访问判定；新增未声明权限的接口会导致覆盖率测试失败（见 FR-02、FR-11）。

**API 响应格式**（统一）：

```json
{
  "code": 200,
  "message": "success",
  "data": { ... }
}
```

**分页响应**：

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "items": [...],
    "total": 100,
    "page": 1,
    "page_size": 20
  }
}
```

**业务异常**：

```python
raise BizException(code=10001, message="验证码不存在或已过期")
# 返回 HTTP 200，body: {"code": 10001, "message": "...", "data": null}
```

> RBAC 错误码约定（401/403，仍沿用 HTTP 200 + body code）见 20.2 节。

### 6.2 前端开发规范

**新增页面的标准步骤**：

1. 在 `app/src/pages/<module>/` 下创建页面组件
2. 在 `index.ts` 中导出
3. 在 `App.tsx` 中添加路由
4. 在 `DashboardLayout.tsx` 中添加导航菜单项（如需要）

> RBAC 接入后：页面还需在路由表中声明所需权限（见 20.4），页面内写操作按钮使用 `hasPermission` / `<Can>` 控制（见 FR-09）。

**新增服务接口的标准步骤**：

1. 在 `services/types/<module>.ts` 中定义类型
2. 在 `services/mock/<module>.ts` 中实现 Mock 版本
3. 在 `services/api/<module>.ts` 中实现 API 版本
4. 在 `services/<module>.ts` 中做 Mock/API 切换导出

**文件命名**：

- 页面组件：PascalCase（`AgentList.tsx`）
- 服务文件：camelCase（`agent.ts`）
- 类型文件：camelCase（`agent.ts`）

**路径别名**：`@/` 映射到 `app/src/`

---

## 7. 环境搭建

### 7.1 后端

```bash
# 1. 创建Python环境
conda create -n chenguang python=3.13
conda activate chenguang

# 2. 安装依赖
pip install -r requirements.txt

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，填入MySQL和Redis连接信息

# 4. 执行数据库迁移
alembic upgrade head

# 5. 启动
uvicorn src.main:app --port 8080 --reload
```

### 7.2 前端

```bash
cd app
npm install
npm run dev    # 默认Mock模式，访问 http://localhost:5173
```

### 7.3 健康检查

- 后端：`GET http://localhost:8080/health`
- 前端：浏览器访问 `http://localhost:5173`

> 本地基础设施（MySQL/Redis/MinIO）可通过 `docker compose -f docker/docker-compose.yaml up -d` 启动。

---

## 8. 关键依赖清单

### 8.1 后端 (Python)

| 包 | 用途 |
|---|---|
| fastapi | Web 框架 |
| uvicorn | ASGI 服务器 |
| sqlalchemy | 异步 ORM |
| asyncmy | MySQL 异步驱动 |
| alembic | 数据库迁移 |
| pydantic / pydantic-settings | 数据校验 / 配置管理 |
| redis | 异步 Redis 客户端 |
| PyJWT | JWT 编解码 |
| bcrypt | 密码加密 |
| captcha + pillow | 图片验证码生成 |
| loguru | 日志 |

### 8.2 前端 (Node.js)

| 包 | 用途 |
|---|---|
| react / react-dom | UI 框架 |
| react-router-dom | 路由 |
| radix-ui | 无样式 UI 原语（Shadcn 底层） |
| tailwindcss | 原子 CSS |
| lucide-react | 图标库 |
| class-variance-authority + clsx + tailwind-merge | 样式工具 |
| vite | 构建工具 |
| typescript | 类型系统 |

---

## 9. 前端 API 接口规范（后端实现参考）

前端已定义的完整 API 接口列表，后端实现时需遵循此规范。详见 `app/docs/10-API接口规范.md`。

通用响应格式：

```typescript
interface ApiResponse<T> {
  code: 0          // 成功
  message: 'success'
  data: T
}

interface PaginatedResponse<T> {
  data: T[]        // Mock层简化版
  total: number
  page: number
  pageSize: number
}
```

**注意**：前端 `apiClient` 会自动提取 `response.data`，所以后端返回 `{"code": 200, "message": "success", "data": {...}}` 即可，前端拿到的就是 `data` 部分。

> **口径说明（V3 整合对账）**：V1 此处前端类型将成功码写作 `code: 0`，而后端实际约定为 `code: 200`（见 6.1、3.4）。由于 `apiClient` 优先提取 `data` 字段，两者实际兼容。V3 基线**统一以 `code=200` 为成功码**；Mock 层如保留 `code=0`，应在 `apiClient` 中同样视为成功，避免误判。RBAC 的 401/403 语义见 20.2 节。

---

## 10. 设计文档索引

前端详细设计文档位于 `app/docs/`：

| 文件 | 内容 |
|------|------|
| `00-架构总览.md` | 系统架构、路由、技术栈、数据服务层设计、开发约定 |
| `01-工作台.md` | Dashboard 数据大盘设计 |
| `02-Agent管理.md` | Agent 全生命周期管理设计 |
| `03-模型管理.md` | 模型和供应商管理设计 |
| `04-Prompt管理.md` | Prompt 工程化管理设计 |
| `05-知识库管理.md` | RAG 知识库全流程设计 |
| `06-工具管理.md` | 工具注册和编排设计 |
| `07-对话日志.md` | 对话记录和链路追踪设计 |
| `08-数据统计.md` | 用量、费用、效果评估设计 |
| `09-系统管理.md` | 用户、角色、安全、审计设计 |
| `10-API接口规范.md` | 完整接口定义、Mock 层设计、切换方案 |
| `知识库后端开发流程.md` | 知识库后端完整开发流程（MinIO、异步分段处理、pgvector） |

其他相关文档：

| 文件/目录 | 内容 |
|---|---|
| `docs/design/plans/` | 12 个模块实施计划（Agent、Prompt、知识库、工具、模型、系统管理、RBAC 权限内核、数据级授权内核、前端权限控制、对话日志、数据统计、预留系统模块） |
| `docs/design/ui/`、`docs/ui/` | UI 原型产物与原型设计说明 |
| `docs/deployment/` | 部署相关文档 |
| `docs/openapi.json`、`docs/全模块更新后crud.json` | 接口快照 |

---

## 11. 基线待实现功能清单（V1 §9）

> 本清单为 V1 基线待办，保留作历史对照。其中第 5~8 项已在 2026-03 的迭代中完成；RBAC 相关的新增工作以第 24 章实施阶段与第 18 章 FR 为准。

### 11.1 后端待实现模块

以下模块前端 UI 和 Mock 数据已就绪，需要后端实现对应的 API → Service → Repository → Model：

1. **Agent 管理**：Agent CRUD、版本管理、启动/停止、发布、测试、监控
2. **模型管理**：模型 CRUD、供应商管理、连接测试
3. **Prompt 管理**：Prompt CRUD、版本管理、发布、测试
4. **知识库管理**：知识库 CRUD、文档上传/处理、分段管理、检索测试、重新索引
5. **工具管理**：工具注册/CRUD、测试、启用/禁用、调用日志
6. **对话日志**：对话列表/详情、标注、导出
7. **数据统计**：用量统计、费用分析、效果评估
8. **系统管理扩展**：API Key 管理、审计日志、告警规则、系统配置

### 11.2 前端待完善

1. ~~**API 客户端增强**：添加 Authorization header（JWT token 注入）~~ ✅ 已完成
2. ~~**登录页对接**：调用真实 `/api/v1/auth/login`，存储 token~~ ✅ 已完成
3. ~~**路由守卫**：未登录重定向到 `/login`~~ ✅ 已完成
4. ~~**错误处理**：统一处理 401（token 过期）→ 跳转登录~~ ✅ 已完成
5. ~~**用户管理页对接**：`/system/users` 对接真实后端 CRUD + 分配角色 + 分页~~ ✅ 已完成
6. ~~**角色管理页对接**：`/system/roles` 对接真实后端 CRUD + 分配权限 + 分页~~ ✅ 已完成
7. ~~**权限管理页**：`/system/permissions` 完整 CRUD + 分页 + 模块分类~~ ✅ 已完成
8. ~~**业务模块页面对接**：Agent/Prompt/Knowledge/Tool 的创建、详情、版本管理页面全部使用新 API 类型~~ ✅ 已完成
9. **表单校验**：集成 React Hook Form + Zod
10. **图表集成**：集成 Recharts 展示趋势图

> RBAC 相关的前端待办（权限上下文、菜单/路由/按钮控制、角色双 Tab 配置、权限页只读化、归属列、共享/转移弹窗、403 页）不属于本清单，见第 19 章与第 24 章 P4/P5。

---

# 第二部分 RBAC 功能授权与数据级授权

## 12. 背景

平台已经具备 RBAC 的**数据基础**：`users`、`roles`、`permissions` 三张表以及 `user_roles`、`role_permissions` 两张关联表已落库，用户/角色/权限的增删改查接口可正常调用，种子数据中有管理员与运营人员两类角色。

但当前 RBAC 只停留在「**能配置**」，没有进入「**能生效**」：

- 全项目只有 `/api/v1/users/me` 与一个知识库上传接口使用了 `get_current_user`，其余业务接口（Agent、模型、Prompt、知识库、工具、供应商、系统管理）**均未校验登录态，更未校验权限**。
- 登录成功后只下发 JWT，前端拿不到「我是谁、我有哪些权限」，侧边栏和路由只判断「是否已登录」。
- 权限码粒度不统一：`user:list` 是细粒度，`agent:*` / `model:*` 等是整模块通配，与 `app/docs/09-系统管理.md` 中已设计的「模块 × 查看/创建/编辑/删除/发布」矩阵对不上。
- **数据层面完全没有隔离**：业务资源没有可靠的所有者字段。`agents`、`prompts`、`knowledge_bases`、`tools` 表中虽有 `created_by`（String），但创建接口从未传入当前用户（[agent/service.py:31](src/modules/agent/service.py#L31)），实际值恒为 `NULL`；列表与详情接口也不做任何归属过滤。任何登录用户只要知道 ID，就能读取、修改、删除他人的 Agent / Prompt / 知识库 / 工具。

因此本次需求分为两层：

1. **功能授权**：谁可以调用哪个接口、看到哪个菜单、点击哪个按钮。
2. **数据级授权**：在通过功能授权的前提下，能操作**哪些数据行**——自己的、指定人的、指定角色创建的，还是全部；以及单个资源可以额外共享给谁。

### 12.1 现状问题清单

| 编号 | 问题 | 影响 |
|---|---|---|
| P1 | 无统一鉴权入口，业务接口不校验权限 | 任何登录用户可执行任意操作；未登录也可调用大部分接口 |
| P2 | 大量接口连登录态都不校验 | 接口裸奔，安全风险 |
| P3 | 权限码粒度混乱（细粒度与通配混用） | 无法表达「可查看不可删除」这类最小权限 |
| P4 | Permission 无模块/动作元数据 | 前端权限页靠 code 前缀猜测分组，无法渲染权限矩阵 |
| P5 | Role 无 `is_system` 字段 | 内置角色（含 admin）可被删除/改编码，存在把管理员锁死的风险 |
| P6 | 登录仅返回 token | 前端无法做菜单/按钮级控制 |
| P7 | 前端只有登录守卫，无权限守卫 | 越权页面可通过直接输入 URL 进入 |
| P8 | 后端业务异常统一返回 HTTP 200 + body `code`，而前端仅对 HTTP 401 跳登录 | token 过期时前端不会跳转登录，401 处理实际失效 |
| P9 | 权限目录与 UI 设计稿不一致（现 2 角色 / 12 码，设计稿 4 角色 / 模块×动作矩阵） | 管理端页面无法按设计稿落地 |
| P10 | 对话日志、数据统计、API Key、审计日志、告警规则、系统配置在后端尚无接口 | 权限矩阵需要明确这些模块的控制范围 |
| P11 | 业务资源无可靠所有者：`created_by` 存在但从未写入 | 无法判断「这是谁的数据」，数据隔离无从谈起 |
| P12 | 列表/详情/写接口无数据过滤 | 知道 ID 即可越权访问他人资源 |
| P13 | 无资源级共享能力 | 协作只能靠「给全部权限」，违反最小权限 |
| P14 | 角色只有功能权限配置，无数据范围配置 | 无法表达「开发者只能管理自己创建的 Agent」 |

---

## 13. 目标与非目标

### 13.1 目标

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

### 13.2 非目标（本期不做）

| 编号 | 非目标 | 说明 |
|---|---|---|
| NG1 | 部门/组织架构 | 不以部门树为单位隔离数据；数据范围用「全部/本人/指定用户/指定角色」表达。未来可扩展 `subject_type=department` |
| NG2 | 字段级权限 | 不做「隐藏某个字段」级别的控制 |
| NG3 | 多租户 | 不引入 tenant 概念 |
| NG4 | SSO / LDAP / OAuth 第三方登录 | 继续使用用户名 + 密码 + 验证码 |
| NG5 | API Key 的权限范围与鉴权 | `/system/api-keys` 仅保留页面与菜单控制，后续单独立项 |
| NG6 | 权限申请 / 审批流 / 临时授权 / 授权到期 | 不做 |
| NG7 | 审计日志落库 | 越权访问仅写应用日志，审计模块未实现前不建表 |
| NG8 | 运行时数据隔离 | 数据授权只作用于**管理端 API**；已发布 Agent 对终端用户的运行时调用不受影响（后续单独立项） |
| NG9 | 跨用户的「公开市场/资源广场」 | 不做对外公开资源浏览，仅支持点对点共享 |
| NG10 | 系统管理资源的数据隔离 | 用户、角色、权限、模型、供应商等平台级资源仍由功能权限控制，不做行级隔离 |
| NG11 | 修改现有 API 响应结构 | 除新增字段外，响应格式保持不变 |

### 13.3 成功标准

1. 未登录访问任意受保护接口返回 401 语义错误；登录但无功能权限返回 403。
2. 管理员取消某角色的 `agent:delete` 后，该角色下的在线用户**下一次请求**即无法删除 Agent。
3. 只读角色登录后只显示有权访问的模块，直接输入无权 URL 被拦截到 403 页，写操作按钮不渲染。
4. 数据范围为「本人」的开发者，在 Agent 列表中**看不到**他人的 Agent，直接访问他人 Agent 详情返回 403，修改/删除同样被拒。
5. 管理员把某知识库共享给运营角色后，运营用户**下一次请求**即可在列表中看到并编辑该知识库。
6. 新增一个未声明权限的接口时，CI 中的鉴权覆盖率测试失败。

---

## 14. 用户与典型场景

### 14.1 角色画像

| 内置角色 | code | 画像 | 主要诉求 |
|---|---|---|---|
| 管理员 | `admin` | 平台负责人 / 运维 | 管理用户与角色、全平台配置、查看全部数据 |
| 开发者 | `developer` | Agent / Prompt 开发者 | 创建与调试 Agent、Prompt、知识库、工具；协作时共享资源 |
| 运营 | `operator` | 业务运营人员 | 查看业务数据、维护知识库内容 |
| 只读 | `viewer` | 观察者 / 外部协作方 | 只查看，不产生任何变更 |

> `is_superuser=true` 的账号（初始 admin 账号）拥有全部功能权限与全部数据，跳过一切校验，作为防锁死的最终兜底。

### 14.2 典型场景

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

## 15. 授权模型总览

### 15.1 两层授权

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

### 15.2 资源分类

| 类别 | 资源 | 是否做数据级授权 | 说明 |
|---|---|---|---|
| 业务资源 | Agent、Prompt、知识库、工具 | ✅ | 有归属、可配置数据范围、可共享 |
| 派生资源 | 知识库文档/分段、Agent/Prompt 版本 | ✅（继承） | 可见性完全继承父资源，不单独授权 |
| 统计资源 | 对话日志、数据统计 | ✅（派生） | 对话日志随所属 Agent 的可见性；统计只聚合可见数据 |
| 平台资源 | 模型、供应商、用户、角色、权限、API Key、审计、告警、系统配置 | ❌ | 仅受功能权限控制；模型/供应商为平台级共享资产 |

### 15.3 数据归属

- `agents`、`prompts`、`knowledge_bases`、`tools` 增加 `owner_id`（BIGINT，FK `users.id`，索引，迁移后非空）。
- 创建接口必须写入 `owner_id = 当前登录用户`，同时把 `created_by` 同步为用户名（保留字段以兼容前端展示）。
- 现有 `created_by` 为 NULL 的历史数据，迁移时统一归属给初始 admin 用户。
- 归属只在两种情况下变化：管理员/所有者执行「转移归属」；用户删除时的受控处理（见 FR-17）。

---

## 16. 功能授权

### 16.1 权限码规范

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

### 16.2 权限码总表（47 条）

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

### 16.3 内置角色功能权限矩阵

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

### 16.4 角色与权限的保护规则

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

## 17. 数据级授权

### 17.1 数据范围（Data Scope）

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

### 17.2 多角色合并规则

用户可能拥有多个角色，有效数据范围按**并集**计算，逐维度（view / manage）独立计算：

1. 任一角色的该维度范围为 `ALL` → 结果为 `ALL`。
2. 否则，合并所有角色的 `SELF` 与 `CUSTOM` 目标 → 结果为「本人 + 各角色自定义目标」的并集。
3. `is_superuser=true` → 两维度均为 `ALL`。

> 只有并集，没有显式拒绝（deny）规则。

### 17.3 资源级共享（ACL）

数据范围解决「按角色批量授权」，资源级共享解决「单个资源点对点协作」。

| 项 | 规则 |
|---|---|
| 可共享的资源 | Agent、Prompt、知识库、工具 |
| 授权主体 | 用户（`user`）或角色（`role`） |
| 访问级别 | `view`（只读）/ `manage`（可管理，隐含只读） |
| 授予人 | 资源所有者，或对资源拥有管理数据权限且具备 `<资源>:update` 功能权限的用户 |
| 生效时机 | 立即生效，无缓存延迟 |
| 与功能权限的关系 | ACL 只解决数据层；用户仍需具备对应的功能权限才能执行操作 |
| 与数据范围的关系 | 取并集：数据范围 + 共享授权 |
| 禁止事项 | 不能共享给「所有人」；如需全员可见，使用数据范围 `ALL` |
| 生命周期 | 资源删除时级联删除 ACL；主体用户/角色删除时清理对应条目 |
| 权限级别变更 | 支持 view ↔ manage 调整，由授予人或管理员操作 |

### 17.4 有效数据访问判定

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

> 示例：开发者 B 拥有 `knowledge:update`，但知识库 A 的 owner 是开发者 A、B 既不在数据范围内也没有 ACL → B 可以点「编辑」（按钮是否显示取决于 ACL/范围，见 FR-09），但提交时后端返回 403。

### 17.5 内置角色数据范围默认值

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

### 17.6 派生资源与统计口径

| 资源 | 数据访问口径 |
|---|---|
| 知识库文档、分段 | 完全继承所属知识库的访问判定；对知识库有 manage 才能上传/删除/编辑文档与分段 |
| Agent 版本、Prompt 版本 | 继承父资源；查看版本需父资源 view，发布/回滚需父资源 manage |
| 工具调用测试 | 需工具 manage |
| 对话日志 | 需 `conversation:view` 功能权限 **且** 所属 Agent 对当前用户可见；列表按可见 Agent 过滤 |
| 数据统计 | 仅聚合当前用户可见的 Agent / 对话；无可见数据时展示空状态 |
| 模型、供应商 | 平台级资源，不做数据隔离，由功能权限控制 |

### 17.7 数据授权的生效与缓存

- 功能权限与数据范围合并缓存在 Redis（key `rbac:user:{user_id}`，TTL 300 秒），内容包含权限码集合与编译后的数据范围。
- 以下变更必须同步失效缓存：角色权限变更、角色数据范围变更、用户角色变更、角色删除、用户禁用/删除、权限目录迁移。
- ACL **不进入用户缓存**：资源详情/写操作实时查询 ACL；列表查询通过 SQL `EXISTS` 子查询实时判定，保证共享与取消共享立即生效。
- ACL 数据量较大时通过索引保障：`(resource_type, resource_id)`、`(subject_type, subject_id)`。

### 17.8 边界规则

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
| 资源不存在 vs 无权限 | 统一返回「资源不存在或无权限访问」（403 + 业务码），不区分，避免通过响应差异探测资源是否存在 |

---

## 18. 功能需求

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
  - **功能权限**：模块 × 动作矩阵（见 19.1）；
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
- 用户列表展示角色名称；无角色标记「未分配角色」。

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
- 列表页顶部「新建」按钮仅受功能权限控制。

### FR-10 无权限反馈

- `code=403` 统一拦截：操作类请求提示「无权限执行该操作（需要 xxx）」并刷新权限；路由级跳 `/403`。
- 数据级拒绝与功能级拒绝共用 403；消息区分「缺少权限」与「无权访问该资源」。
- 新增 `/403` 页面，提供「返回工作台」。

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
- 内置角色重置为 admin / developer / operator / viewer，均 `is_system=true`；旧 `operator` 保留 code，名称改为「运营人员/运营」，权限集重写。
- 初始 admin 账号继续关联 admin 角色，`is_superuser=true`。
- 内置角色写入 17.5 节的数据范围默认值。
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
| 详情（GET 单条） | 无 view 数据权限 → 403（消息「资源不存在或无权限访问」） |
| 创建（POST） | 只校验功能权限；写入 owner |
| 更新 / 删除 / 发布 / 回滚 / 启停 | 功能权限 **且** manage 数据权限 |
| 文档上传 / 删除、分段编辑 / 删除、重试 | 继承知识库数据判定；上传还需 `knowledge:create` |
| 版本列表 / 版本详情 | 继承父资源 view |
| 统计类接口 | 仅聚合可见数据 |
| 导出（未来） | 必须按相同数据范围过滤，且覆盖率测试覆盖 |

- 所有数据过滤必须发生在服务端查询层，前端参数不得影响范围（不提供「查看全部」之类的可绕过参数）。

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
- 删除用户：若其拥有任何业务资源，拒绝并提示「请先转移其名下资源」；若无资源，清理其 ACL 主体条目并删除。
- 禁用用户：不改变归属；该用户无法登录，其资源仍归其所有，管理员可转移。

### FR-18 对话日志与数据统计的数据口径

- 对话日志：`conversation:view` 功能权限 + 所属 Agent 对当前用户可见；列表按可见 Agent 过滤。后端模块未实现前，前端页面按 Agent 权限做菜单/路由控制。
- 数据统计：仅统计当前用户可见的 Agent 及其对话；不同用户看到的汇总数字可以不同。后端模块未实现前，页面保留并标注「按数据权限统计」。
- 这两类资源不单独配置数据范围，跟随 `agent` 的判定。

---

## 19. 页面需求

### 19.1 角色管理 `/system/roles`

- 列表列：角色名称、编码、描述、用户数、权限数、类型（内置/自定义）、操作。
- 内置角色显示「内置」标签，删除按钮禁用并提示原因。
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
- 保存成功提示「配置已更新，对该角色下用户立即生效」。

### 19.2 权限管理 `/system/permissions`

- 列表列：ID、模块、权限码、名称、动作、状态、说明。
- 支持按模块筛选与关键词搜索。
- 移除创建/编辑/删除按钮；顶部说明「权限目录由系统维护，如需新增请联系版本升级」。
- 预留权限显示「未上线」标签。

### 19.3 用户管理 `/system/users`

- 列表增加角色列（多角色标签）与「拥有资源数」（可选，用于删除提示）。
- 禁止操作自己（编辑角色、删除）。
- 删除仍拥有资源的用户时，提示先转移。

### 19.4 业务资源页面（Agent / Prompt / 知识库 / 工具）

- 列表新增「归属人」列；无 view 数据权限的数据不出现。
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

- 数据为空且并非真的没有数据时，给出「当前数据范围内暂无数据」的提示，避免误解为系统故障。

### 19.5 403 页面 `/403`

- 文案：无权访问该页面 / 资源；展示所需权限（若可得）；按钮「返回工作台」。

### 19.6 侧边栏与个人中心

- 菜单按功能权限过滤；系统设置分组整体隐藏规则不变。
- 个人中心可展示当前角色与数据范围（只读展示，便于排查）。

---

## 20. 接口需求

### 20.1 新增 / 变更接口

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

### 20.2 错误码（新增约定）

| code | HTTP 状态 | 含义 | 前端行为 |
|---|---|---|---|
| 401 | 200（沿用现有约定） | 未登录 / token 过期 / 账号禁用 | 清除 token，跳登录 |
| 403 | 200（沿用现有约定） | 无功能权限 / 无数据权限 / 接口未声明权限 | 提示；路由级跳 /403；刷新权限 |

> 保持 HTTP 200 是为了兼容现有前端与全局异常处理器；错误语义由 body `code` 承载。前端 `apiClient` 需显式处理 `code=401` 与 `code=403`。

### 20.3 全量接口 → 功能权限映射

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

### 20.4 前端路由 → 权限映射

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

## 21. 数据模型与迁移

### 21.1 表结构变更

| 表 | 变更 | 说明 |
|---|---|---|
| `roles` | 新增 `is_system` BOOLEAN NOT NULL DEFAULT 0 | 内置角色保护 |
| `permissions` | 数据重建，无结构变更 | 47 条内置权限 |
| `role_permissions` | 数据重建 | 按 16.3 节矩阵写入 |
| `agents` | 新增 `owner_id` BIGINT FK users.id，索引 | 数据归属；`created_by` 保留为显示名 |
| `prompts` | 新增 `owner_id` | 同上 |
| `knowledge_bases` | 新增 `owner_id` | 同上 |
| `tools` | 新增 `owner_id` | 同上 |
| `role_data_scopes` | 新增 | 角色 × 资源类别的数据范围 |
| `role_data_scope_targets` | 新增 | CUSTOM 范围的指定用户/角色 |
| `resource_acl` | 新增 | 资源级共享 |
| `user_roles` | 保留 | 初始 admin 维持 admin 角色 |

### 21.2 新增表定义（逻辑）

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

### 21.3 迁移步骤（Alembic）

1. `roles` 增加 `is_system`（默认 false）。
2. 四张业务表增加 `owner_id`（先可空），以初始 admin 用户回填，再改为非空并建索引。
3. 创建 `role_data_scopes`、`role_data_scope_targets`、`resource_acl` 三张表及约束/索引。
4. 重建权限目录（47 条）与内置角色权限。
5. 写入内置角色的数据范围默认值（17.5 节）。
6. 保证 admin 账号存在、`is_superuser=true`、关联 admin 角色。
7. 清空权限缓存。
8. 迁移幂等；全部在 RBAC 相关表与业务表 owner 字段内完成，不删除业务数据。

### 21.4 回滚

- down 迁移删除新增表与 `owner_id` 列，恢复旧权限与角色数据。
- 回滚会丢失数据范围、ACL、归属信息，生产回滚前必须备份并评估。

---

## 22. 非功能需求

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

## 23. 验收标准

### 23.1 功能授权

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

### 23.2 数据级授权

| 编号 | 场景 | 预期 |
|---|---|---|
| AC-17 | 开发者 A（Agent view SELF）查看列表 | 只看到自己的 Agent，分页 total 正确 |
| AC-18 | 开发者 A 直接访问开发者 B 的 Agent 详情 | `code=403`，消息「资源不存在或无权限访问」 |
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

## 24. 实施阶段建议

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

> 与 `docs/design/plans/` 的对应关系：`RBAC权限内核-plan.md`、`数据级授权内核-plan.md`、`前端权限控制-plan.md` 分别覆盖 P1/P2、P3 数据部分、P4/P5；其余 9 个业务模块计划覆盖 P3 的接口接入与既有功能完善。

---

## 25. 风险与开放问题

### 25.1 风险

| 编号 | 风险 | 应对 |
|---|---|---|
| RK-01 | 一次性加鉴权导致联调中断 | `RBAC_ENFORCE` 灰度开关；分模块接入；覆盖率测试 |
| RK-02 | 历史数据全部归属 admin，开发者按 SELF 看不到数据 | 迁移前确认归属策略；开发者默认 view ALL；提供归属转移工具 |
| RK-03 | 数据范围配置错误导致「数据消失」 | 列表空状态提示「当前数据范围内暂无数据」；角色页展示影响范围；管理员可 ALL 兜底 |
| RK-04 | ACL 与数据范围叠加后结果难以理解 | 详情页展示当前用户的有效权限来源（所有者/共享/范围）；文档给出判定公式 |
| RK-05 | 自定义范围目标过大影响查询性能 | 目标数上限 1000；SQL 使用 EXISTS/IN 子查询并建索引 |
| RK-06 | 权限缓存与数据库不一致 | 主动失效 + 300 秒 TTL + 即时生效测试 |
| RK-07 | 旧权限码迁移遗漏 | 导出、映射表、幂等执行、迁移后校验矩阵 |
| RK-08 | 预留模块权限与实际接口不符 | 目录标注「未上线」；上线时同步接入 |
| RK-09 | 运行时调用被误伤 | 明确非目标 NG8；运行时鉴权独立立项 |

### 25.2 已决问题

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
| 接口鉴权实现方式 | 建议「接口级显式声明 + 覆盖率测试」；作为技术方案输入 |

### 25.3 待后续确认

| 编号 | 问题 | 影响 |
|---|---|---|
| Q1 | 是否需要按部门/组织隔离 | 若需要，新增 departments 表与 `subject_type=department` |
| Q2 | 运行时（终端用户调用 Agent）是否要数据隔离 | 影响对外 API 设计 |
| Q3 | 共享是否需要有效期 | 可扩展 ACL 的 `expires_at` |
| Q4 | 审计日志是否落库 | 数据共享/转移目前仅写应用日志 |
| Q5 | 数据范围是否需要「排除指定数据」的 deny 规则 | 当前仅并集授权，无显式拒绝 |

---

# 第三部分 收口与追溯

## 26. 与现有文档的关系

- `docs/PROJECT_SPEC.md`：项目说明书 V1，描述架构与已完成能力；其第 1~11 章内容已完整纳入本文档第一部分，继续作为开发参考。
- `docs/spec/PROJECT_SPEC_V2.md`：V2 需求基线，覆盖 RBAC 功能授权与数据级授权；其第 1~16 章内容已完整纳入本文档第二部分，作为需求基线。
- 本文档（V3）：V1 + V2 的整合版本，**作为后续唯一的 PRD 与技术说明书基线**；与两份原文档冲突时以本文档为准（V3 中的「口径说明」「对账」段落给出解释）。
- `app/docs/09-系统管理.md`：系统管理 UI 设计；本文档与其权限矩阵一致，并在其上补充数据范围配置与资源共享。
- `docs/design/plans/`：12 个模块实施计划；对应关系见第 24 章末尾说明。

---

## 27. 变更记录

### 27.1 V1 变更记录（2026-03）

#### 2026-03-19 — 前端对接真实后端（认证 + 系统管理）

**涉及文件**：

| 文件 | 变更内容 |
|------|---------|
| `app/src/services/api/client.ts` | 重写：自动注入 JWT token、401 自动跳转登录、业务错误码处理 |
| `app/src/services/api/auth.ts` | 新增：对接 `/api/v1/captcha`、`/api/v1/auth/login` |
| `app/src/services/mock/auth.ts` | 新增：Mock 认证服务（前端自生成验证码） |
| `app/src/services/auth.ts` | 新增：Mock/API 切换入口 |
| `app/src/services/api/system.ts` | 重写：对接真实后端用户/角色/权限 CRUD 接口 |
| `app/src/services/system.ts` | 更新：导出真实后端类型 |
| `app/src/components/AuthGuard.tsx` | 新增：路由守卫，未登录跳转 `/login` |
| `app/src/App.tsx` | 更新：所有受保护路由包裹 `AuthGuard` |
| `app/src/pages/Login.tsx` | 重写：对接真实验证码图片 + 登录接口，Mock 模式兼容 |
| `app/src/pages/system/Users.tsx` | 重写：支持真实后端分页搜索、创建用户、分配角色 |
| `app/src/pages/system/Roles.tsx` | 重写：支持真实后端 CRUD、分配权限 |
| `app/src/layouts/DashboardLayout.tsx` | 更新：退出登录调用 `authService.logout()` |

**接口对应关系**：

| 功能 | 前端调用 | 后端接口 |
|------|---------|---------|
| 获取验证码 | `authService.getCaptcha()` | `GET /api/v1/captcha` |
| 用户登录 | `authService.login(...)` | `POST /api/v1/auth/login` |
| 用户列表（分页） | `apiSystemService.getUsers(...)` | `GET /api/v1/users/search` |
| 创建用户 | `apiSystemService.createUser(...)` | `POST /api/v1/users` |
| 删除用户 | `apiSystemService.deleteUser(id)` | `DELETE /api/v1/users/{id}` |
| 分配用户角色 | `apiSystemService.assignUserRoles(...)` | `PUT /api/v1/users/{id}/roles` |
| 角色列表 | `apiSystemService.getRoles()` | `GET /api/v1/roles/` |
| 创建角色 | `apiSystemService.createRole(...)` | `POST /api/v1/roles` |
| 更新角色 | `apiSystemService.updateRole(...)` | `PUT /api/v1/roles/{id}` |
| 删除角色 | `apiSystemService.deleteRole(id)` | `DELETE /api/v1/roles/{id}` |
| 分配角色权限 | `apiSystemService.assignRolePermissions(...)` | `PUT /api/v1/roles/{id}/permissions` |
| 权限列表 | `apiSystemService.getPermissions()` | `GET /api/v1/permissions/` |
| 创建权限 | `apiSystemService.createPermission(...)` | `POST /api/v1/permissions` |
| 更新权限 | `apiSystemService.updatePermission(...)` | `PUT /api/v1/permissions/{id}` |
| 删除权限 | `apiSystemService.deletePermission(id)` | `DELETE /api/v1/permissions/{id}` |

**切换到真实后端**：

```bash
cd app
VITE_USE_MOCK=false VITE_API_BASE=http://localhost:8080/api npm run dev
```

#### 2026-03-20 — 业务模块页面全面对接新 API 类型

**涉及文件**：

| 文件 | 变更内容 |
|------|---------|
| `app/src/pages/agent/Create.tsx` | 重写：支持创建/编辑模式，使用 snake_case 字段（`model_id`, `config.system_prompt` 等），加载已有 Agent 数据回填 |
| `app/src/pages/agent/Detail.tsx` | 重写：使用 `AgentRead` 类型，展示 `call_count_7d`/`success_rate`，内嵌版本历史列表 |
| `app/src/pages/agent/Versions.tsx` | 重写：调用真实 `getAgentVersions` + `rollbackAgent` API，支持回滚操作 |
| `app/src/pages/prompt/Create.tsx` | 重写：支持创建/编辑/发布，使用 `PromptVariableSchema` 类型，变量管理 + 预览 |
| `app/src/pages/prompt/Versions.tsx` | 重写：调用真实 `getPromptVersions` + `rollbackPrompt` API，点击版本查看内容 |
| `app/src/pages/knowledge/Create.tsx` | 重写：调用真实 `createKnowledgeBase` API，创建后跳转详情页 |
| `app/src/pages/tool/Create.tsx` | 重写：调用真实 `createTool` API，自动生成 `function_definition` |
| `app/src/pages/tool/Detail.tsx` | 重写：使用 `ToolRead` 类型，展示统计数据，支持 JSON 参数测试工具 |

**关键变化**：

- 所有页面不再引用旧 `@/services/types/` 目录下的类型，改用各模块 API 服务导出的类型
- 字段名全部改为 snake_case（`model_id`, `call_count_7d`, `success_rate`, `avg_latency` 等）
- 版本管理页面（Agent/Prompt）均支持真实回滚操作
- Tool Detail 支持 JSON 格式参数输入并调用 `testTool` API

#### 2026-03-19（二）— 用户/角色/权限分页 + 权限管理完整页面

**变更内容**：

| 文件 | 变更内容 |
|------|---------|
| `app/src/components/Pagination.tsx` | 新增：通用分页组件，支持省略号、页码跳转 |
| `app/src/pages/system/Users.tsx` | 重写：加入分页（PAGE_SIZE=10），搜索时自动重置页码 |
| `app/src/pages/system/Roles.tsx` | 重写：加入分页，支持关键词搜索，编辑/删除/分配权限 |
| `app/src/pages/system/Permissions.tsx` | 新增：权限完整 CRUD 页面，含分页、模块分类标签、创建/编辑/删除弹窗 |
| `app/src/pages/system/index.ts` | 更新：导出 `SystemPermissions` |
| `app/src/App.tsx` | 更新：注册 `/system/permissions` 路由 |
| `app/src/layouts/DashboardLayout.tsx` | 更新：侧边栏加入「权限管理」菜单项 |
| `app/src/services/mock/system.ts` | 更新：新增 `getRolesPaged`、`getPermissionsPaged`、`createPermission`、`updatePermission`、`deletePermission` |
| `app/src/services/mock/data/system.ts` | 更新：新增 25 条 `mockPermissions` 数据 |

**分页组件使用方式**：

```tsx
import Pagination from '@/components/Pagination'

<Pagination page={page} total={total} pageSize={10} onChange={setPage} />
```

**权限页面功能**：

- 列表展示：ID、模块标签（颜色区分）、权限编码（code 格式）、名称、描述
- 搜索：按编码/名称关键词过滤，搜索时自动回到第 1 页
- 创建：填写编码（格式建议 `模块:操作`）、名称、描述
- 编辑：可修改名称和描述（编码不可改）
- 删除：二次确认，提示影响范围
- 统计卡片：总权限数 + 当前页前 3 个模块的权限数

#### 2026-03-20（二）— 知识库管理完整功能（MinIO + 配置 + 分段预览）

**涉及文件**：

| 文件 | 变更内容 |
|------|---------|
| `app/src/services/api/knowledge.ts` | 扩展类型：`KnowledgeBaseRead` 新增分段策略/检索策略字段；`DocumentRead` 新增 `minio_path`；新增 `KnowledgeBaseConfig`、`RetrievalTestResult` 类型；新增 `updateKnowledgeBaseConfig`、`retryDocument`、`getDocumentSegments`、`testRetrieval` 接口 |
| `app/src/services/mock/knowledge.ts` | 对应补充所有新接口的 Mock 实现 |
| `app/src/services/knowledge.ts` | 重新导出新类型和方法 |
| `app/src/pages/knowledge/Create.tsx` | 重写：左右两栏，左=基本信息+Embedding，右=分段策略+检索策略 |
| `app/src/pages/knowledge/Detail.tsx` | 重写：文档管理 Tab（表格+分页+Sheet 分段预览）、概览 Tab、配置 Tab（可编辑） |
| `app/src/pages/knowledge/Documents.tsx` | 重写：文档列表分页，「查看分段」打开 Sheet 抽屉，支持重试失败文档 |
| `app/src/pages/knowledge/Segments.tsx` | 重写：新增文档下拉过滤，支持 `document_id` 参数 |
| `app/src/pages/knowledge/Test.tsx` | 重写：左右两栏，调用真实 `testRetrieval` API |
| `app/docs/知识库后端开发流程.md` | 新增：后端完整开发流程文档（MinIO、异步分段处理、pgvector） |

**新增 API 接口**：

| 接口 | 说明 |
|------|------|
| `PUT /knowledge-bases/{id}/config` | 更新分段策略/检索策略配置 |
| `POST /knowledge-bases/{kb_id}/documents/{doc_id}/retry` | 重试失败文档 |
| `GET /knowledge-bases/{kb_id}/documents/{doc_id}/segments` | 按文档查询分段 |
| `GET /knowledge-bases/{kb_id}/segments?document_id=` | 按文档过滤分段 |
| `POST /knowledge-bases/{kb_id}/retrieval-test` | 检索测试 |

### 27.2 V2 变更记录（2026-10-25）

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-10-25 | v2.0 | 第一版：完成功能授权需求对齐（权限码、内置角色矩阵、接口映射、即时失效、前端控制、验收标准） |
| 2026-10-25 | v2.0 | 第二版：在功能授权基础上补齐数据级授权——数据归属 `owner_id`、角色数据范围（查看/管理 × 全部/本人/指定用户/指定角色）、资源级共享 ACL、归属转移与用户删除约束、派生资源与统计口径；更新数据模型、迁移、接口映射、页面与验收标准 |

### 27.3 V3 整合记录（2026-11-01）

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-11-01 | v3.0 | 整合 `docs/PROJECT_SPEC.md`（V1）与 `docs/spec/PROJECT_SPEC_V2.md`（V2.0），生成唯一基线文档；完整保留 V1 的项目概述、目录结构、后端/前端架构、数据模型速查、开发约定、环境搭建、依赖清单、前端 API 规范、设计文档索引、基线待办与全部变更记录；完整保留 V2 的背景问题清单、目标/非目标、角色与场景、授权模型、功能授权、数据级授权、FR-01~FR-18、页面需求、接口需求、数据模型与迁移、非功能需求、AC-01~AC-38、实施阶段、风险与开放问题；新增「V3 对账」状态说明、成功码口径统一说明、V1/V2 → V3 覆盖对照表；修正跨文档章节引用编号 |

---

## 28. V1 / V2 → V3 覆盖对照表

### 28.1 V1 → V3

| V1 章节 | V3 章节 | 状态 |
|---|---|---|
| 一、项目概述 | 1. 项目概述 | ✅ 完整覆盖，并补充 V3 对账 |
| 二、目录结构 | 2. 目录结构 | ✅ 完整覆盖，按仓库实际结构补全模块目录 |
| 三、后端架构详解（3.1~3.8） | 3.1~3.8 | ✅ 完整覆盖，补充 RBAC 交叉引用 |
| 四、前端架构详解（4.1~4.7） | 4.1~4.7（含 4.5.1） | ✅ 完整覆盖，补充 RBAC 适配说明 |
| 五、数据模型速查（5.1~5.2） | 5.1~5.2 | ✅ 完整覆盖，注明 RBAC 新增模型 |
| 六、开发约定与规范（6.1~6.2） | 6.1~6.2 | ✅ 完整覆盖，补充 RBAC 接入约束 |
| 七、环境搭建 | 7.1~7.3 | ✅ 完整覆盖，补充 Docker Compose 提示 |
| 八、关键依赖清单 | 8.1~8.2 | ✅ 完整覆盖 |
| 九、待实现功能清单 | 11.1~11.2 | ✅ 完整覆盖 |
| 十、前端 API 接口规范 | 9 | ✅ 完整覆盖，补充成功码口径说明 |
| 十一、设计文档索引 | 10 | ✅ 完整覆盖，补充 plans/ui/deployment |
| 十二、变更记录 | 27.1 | ✅ 完整覆盖（4 条记录及全部表格） |

### 28.2 V2 → V3

| V2 章节 | V3 章节 | 状态 |
|---|---|---|
| 一、背景（含 1.1 问题清单） | 12.1（含 P1~P14） | ✅ 完整覆盖 |
| 二、目标与非目标（含成功标准） | 13.1~13.3（G1~G13、NG1~NG11、6 条成功标准） | ✅ 完整覆盖 |
| 三、用户与典型场景 | 14.1~14.2（角色画像、S1~S10） | ✅ 完整覆盖 |
| 四、授权模型总览 | 15.1~15.3 | ✅ 完整覆盖 |
| 五、功能授权 | 16.1~16.4（权限码规范、47 条总表、矩阵、R1~R7） | ✅ 完整覆盖 |
| 六、数据级授权 | 17.1~17.8 | ✅ 完整覆盖 |
| 七、功能需求（FR-01~FR-18） | 18（FR-01~FR-18） | ✅ 完整覆盖，引用编号同步更新 |
| 八、页面需求 | 19.1~19.6 | ✅ 完整覆盖 |
| 九、接口需求 | 20.1~20.4 | ✅ 完整覆盖 |
| 十、数据模型与迁移 | 21.1~21.4 | ✅ 完整覆盖 |
| 十一、非功能需求 | 22 | ✅ 完整覆盖 |
| 十二、验收标准（AC-01~AC-38） | 23.1~23.2 | ✅ 完整覆盖 |
| 十三、实施阶段建议 | 24 | ✅ 完整覆盖，补充 plans 对应关系 |
| 十四、风险与开放问题 | 25.1~25.3 | ✅ 完整覆盖 |
| 十五、与现有文档的关系 | 26 | ✅ 完整覆盖并更新为 V3 视角 |
| 十六、变更记录 | 27.2 | ✅ 完整覆盖 |

---

*文档结束。*
