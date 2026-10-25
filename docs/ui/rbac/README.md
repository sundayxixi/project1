# RBAC 页面原型

依据 `docs/spec/PROJECT_SPEC_V2.md` 制作的静态页面原型，覆盖功能授权、数据范围与资源级共享。所有数据为演示数据，不连接后端。

## 目录

```
docs/ui/rbac/
├── index.html                  原型目录与授权模型总览
├── login.html                  登录与四种角色快捷体验
├── dashboard.html              工作台
├── agents.html                 Agent 列表
├── agent-detail.html           Agent 详情、版本、共享抽屉、转移归属
├── prompts.html                Prompt 列表
├── knowledge.html              知识库列表、共享抽屉
├── tools.html                  工具列表
├── models.html                 模型与供应商（平台级资源）
├── conversations.html          对话日志（预留模块）
├── analytics.html              数据统计（预留模块）
├── system-users.html           用户管理、分配角色
├── system-roles.html           角色管理、双 Tab 配置弹窗
├── system-permissions.html     权限目录（只读，47 条）
├── reserved.html               预留模块说明（?module=apikey|audit|alert|settings）
├── forbidden.html              403 页面
├── profile.html                个人中心：角色、权限集合、数据范围
├── assets/                     共享样式、交互脚本、favicon
└── images/                     28 张页面与关键弹窗截图
```

## 打开方式

推荐在本地起一个静态服务器：

```bash
cd docs/ui/rbac
python -m http.server 8123
# 打开 http://127.0.0.1:8123/index.html
```

直接双击 HTML 也能浏览，但建议用服务器方式，避免个别浏览器对本地文件 origin 的限制。

## 身份模拟

页面右下角有「原型评审」面板（也可通过 URL 参数指定身份）。切换身份后整页按该角色的权限与数据范围重新渲染。

| 参数 | 取值 | 说明 |
|---|---|---|
| `as` | `admin` / `developer` / `developerSelf` / `operator` / `viewer` | 以指定身份打开 |
| `ghost` | `1` | 用虚线标出本应隐藏的无权限控件，悬停可看所需权限码 |
| `open` | `share` / `transfer` / `share-kb` / `role-config` / `user-roles` / `delete-user` | 直接打开对应弹窗或抽屉 |
| `tab` | `perm` / `scope` | 配合 `role-config` 打开指定 Tab |
| `role` | `admin` / `developer` / `operator` / `viewer` / `labeler` | 配合 `role-config` 显示对应角色的配置 |
| `module` | `apikey` / `audit` / `alert` / `settings` | 预留模块页的模块标识 |
| `review` | `1` | 首次加载时展开评审面板 |
| `tool` | `0` | 隐藏评审工具（截图用） |

示例：

```text
agents.html?as=developerSelf
agents.html?as=viewer&ghost=1
system-roles.html?open=role-config&tab=scope&role=developer
knowledge.html?open=share-kb
system-users.html?as=viewer          # 会被守卫导向 403
```

## 交互范围

- 侧边栏按功能权限过滤；无任何系统管理权限时整个分组隐藏。
- 页面路由守卫：无 `data-page-perm` 声明的权限时跳转 `forbidden.html`。
- 列表按数据范围、资源级共享与当前身份过滤，分页文案同步更新。
- 行内编辑、删除、发布、启停等按钮同时受功能权限与该行 `can_manage` 控制。
- 角色配置的双 Tab：14 个模块 × 5 个动作矩阵，以及 4 类资源的查看/管理范围与指定对象。
- 共享抽屉支持添加、改级别、移除；操作以 Toast 反馈“立即生效”。
- 用户管理会隐藏当前账号的危险操作，并对仍拥有资源的用户拒绝删除。

## 图片资产

`images/` 下为 PNG 截图，包含管理员基线、开发者默认范围、开发者仅本人范围、只读身份与无权限控件标记，以及角色配置、共享、转移、分配角色等关键弹窗，共 31 张。完整清单与说明见 `docs/design/ui/RBAC原型设计说明书.md`。

## 相关文档

- 需求：`docs/spec/PROJECT_SPEC_V2.md`
- 设计说明书：`docs/design/ui/RBAC原型设计说明书.md`
- 既有系统管理 UI 设计：`app/docs/09-系统管理.md`
