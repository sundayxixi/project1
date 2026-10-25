# 仓库指南

## 项目结构与模块组织

**后端 (FastAPI + Python 3.13)** 位于 `/src`：
- `core/` — 共享基础设施：配置 (pydantic-settings)、依赖注入 (DI、分页、认证)、异常、日志、基类 (Model、Repository、Schema)
- `infra/` — 数据库 (SQLAlchemy async + asyncmy)、Redis 缓存、MinIO 客户端
- `modules/` — 功能模块 (user、auth、captcha、permission、role、provider、model、prompt、knowledge、tool、agent)，每个模块包含 `model.py` (ORM)、`schema.py` (Pydantic)、`repository.py` (数据访问)、`service.py` (业务逻辑)、`api.py` (路由)
- `main.py` — 应用工厂，包含生命周期管理、CORS、路由注册、异常处理器

**前端 (React 19 + TypeScript + Vite)** 位于 `/app`：
- `src/pages/` — 模块级路由页面 (agent/、knowledge/、model/、analytics/ 等)
- `src/services/` — API 层，通过 `VITE_USE_MOCK` 切换 mock/真实调用；`api/` 用于真实请求，`mock/` 用于开发
- `src/components/ui/` — shadcn/Radix UI 基础组件 (button、table、dialog 等)
- `src/layouts/` — DashboardLayout 含侧边栏
- 路径别名 `@/*` → `./src/*`

**数据库**：MySQL 8.4 通过 Docker Compose 运行。迁移文件在 `/alembic/versions/` (共 13 个迁移)。使用 `alembic upgrade head` 应用。

## 构建、测试与开发命令

| 任务 | 命令 |
|------|------|
| 后端开发服务器 | `uvicorn src.main:app --port 8080 --reload` |
| 前端开发服务器 | `cd app && npm run dev` |
| 前端构建 | `cd app && npm run build` |
| 前端代码检查 | `cd app && npm run lint` |
| 前端预览 | `cd app && npm run preview` |
| 运行后端测试 | `pytest` (或 `pytest -v`) |
| 运行单个测试 | `pytest test/test_jwt.py::test_encode_jwt` |
| 生成数据库迁移 | `alembic revision --autogenerate -m "msg"` |
| 应用数据库迁移 | `alembic upgrade head` |
| 启动基础设施 (MySQL、Redis、MinIO) | `docker compose -f docker/docker-compose.yaml up -d` |

## 代码风格与命名约定

**后端 (Python)**：
- 遵循 PEP 8 / PEP 257
- 必须使用类型提示 (Pydantic v2、SQLAlchemy 2.0 类型化)
- 模块模式：`model.py` (ORM)、`schema.py` (Pydantic)、`repository.py` (数据访问)、`service.py` (业务逻辑)、`api.py` (路由)
- 通过 `Depends` 进行依赖注入 (`core/deps.py` 中的 `get_db`、`get_current_user`、`PageParams`)
- 自定义异常：`BizException(code, message)` 来自 `core/exceptions.py`

**前端 (TypeScript/React)**：
- ESLint 扁平配置 (`eslint.config.js`)：`js.configs.recommended`、`tseslint.configs.recommended`、`react-hooks`、`react-refresh`
- TypeScript 严格模式 (见 `tsconfig.app.json`)：`strict: true`、`noUnusedLocals: true`、`noUnusedParameters: true`
- 组件：PascalCase，单文件一个组件，hooks/utils 同目录
- 服务：`serviceName.ts` 导出单例 `serviceName`
- API 类型镜像后端 Pydantic Schema

## 测试指南

- 后端：pytest 配合 `pytest-asyncio` (测试在 `/test/`)。运行 `pytest` 执行全部，`pytest test/test_jwt.py` 执行单文件
- 前端：暂未配置测试运行器 (Vitest/Jest 尚未引入)，按需添加
- 测试数据库：建议使用独立测试库或事务回滚 (尚未实现)

## 提交与 PR 规范

**提交格式** (来自 git 历史)：
```
<中文摘要>          # 如："前端更新"、"知识库文件上传完成"、"后端crud接口照着飞书笔记复制完成"
```

**分支命名**：`Feat_xxx` 用于功能分支 (参考 README)。

**PR 流程**：Fork → 功能分支 → 提交 → 创建 PR。

## 环境与配置

- 复制 `.env.example` → `.env` 并调整
- 设置通过 `pydantic_settings.BaseSettings` 加载，带 `lru_cache` 单例 (`core/config.py:get_settings()`)
- 前端环境变量：`VITE_API_BASE` (默认 `http://localhost:8080/api`)、`VITE_USE_MOCK` (默认 `true`)

## 关键模式

- **Repository 模式**：`BaseRepository[T]` 提供 CRUD + `get_page(offset, limit, keyword, search_fields)`
- **Service 模式**：Repository 之上的薄层；负责 ORM → Pydantic Schema 转换
- **版本控制**：Agent 使用语义化版本字符串 (`v1.0`、`v1.1`)；发布会创建 `AgentVersion` 快照
- **认证**：JWT 放在 `Authorization: Bearer <token>`；在 `deps.py:get_current_user()` 中验证
- **分页**：`PageParams` (page、page_size、keyword) → `PageResult<T>` (items、total、page、page_size)