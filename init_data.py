import asyncio
from datetime import datetime
from sqlalchemy import func, select, insert as sa_insert

from src.core.base_model import Base
from src.infra.database import AsyncSessionLocal, engine
from src.modules.user.model import User, user_roles
from src.modules.role.model import Role, role_permissions
from src.modules.permission.model import Permission
from src.modules.provider.model import ModelProvider
from src.modules.model.model import LLMModel
from src.modules.prompt.model import Prompt, PromptVersion
from src.modules.knowledge.model import KnowledgeBase, Document, Segment
from src.modules.tool.model import Tool
from src.modules.agent.model import Agent, AgentVersion
from src.utils.password_utils import hash_password

# 导入全部 ORM 模块，确保 Base.metadata 包含所有表
import src.modules.provider.model  # noqa: F401
import src.modules.model.model  # noqa: F401
import src.modules.prompt.model  # noqa: F401
import src.modules.knowledge.model  # noqa: F401
import src.modules.tool.model  # noqa: F401
import src.modules.agent.model  # noqa: F401

ROLE_DEFS = [
    ("admin", "管理员", "系统管理员,拥有全部权限"),
    ("operator", "运营人员", "日常业务操作人员"),
]

PERM_DEFS = [
    ("user:list", "查看用户", "用户列表与详情查询"),
    ("user:create", "创建用户", ""),
    ("user:update", "修改用户", ""),
    ("user:delete", "删除用户", ""),
    ("role:list", "查看角色", ""),
    ("role:assign", "分配角色", ""),
    ("permission:list", "查看权限", ""),
    ("agent:*", "Agent管理", "Agent 的增删改查与版本管理"),
    ("model:*", "模型管理", ""),
    ("prompt:*", "Prompt管理", ""),
    ("knowledge:*", "知识库管理", ""),
    ("tool:*", "工具管理", ""),
]

ADMIN_CREDENTIALS = ("admin", "123456", "admin@example.com")


# ==================== 业务演示数据 ====================

PROVIDER_DEFS = [
    {
        "name": "OpenAI",
        "type": "openai",
        "status": "connected",
        "endpoint": "https://api.openai.com/v1",
        "api_key": "sk-demo-openai-key",
        "description": "OpenAI 官方 API，支持 GPT-4o 等模型",
    },
    {
        "name": "Anthropic",
        "type": "anthropic",
        "status": "connected",
        "endpoint": "https://api.anthropic.com",
        "api_key": "sk-ant-demo-key",
        "description": "Anthropic Claude 系列模型",
    },
    {
        "name": "阿里云通义千问",
        "type": "aliyun",
        "status": "connected",
        "endpoint": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "api_key": "sk-demo-aliyun-key",
        "description": "阿里云通义千问大模型服务",
    },
    {
        "name": "智谱AI",
        "type": "custom",
        "status": "connected",
        "endpoint": "https://open.bigmodel.cn/api/paas/v4",
        "api_key": "sk-demo-zhipu-key",
        "description": "智谱 AI GLM 系列模型",
    },
    {
        "name": "DeepSeek",
        "type": "custom",
        "status": "connected",
        "endpoint": "https://api.deepseek.com",
        "api_key": "sk-demo-deepseek-key",
        "description": "深度求索 DeepSeek 大模型",
    },
]

# (name, model_id, provider_idx, capabilities, context_length, input_price, output_price, is_default, description)
MODEL_DEFS = [
    ("GPT-4o", "gpt-4o", 0, "function_call,vision,streaming", 128000, 5.0, 15.0, True,
     "OpenAI 旗舰多模态模型，支持视觉与工具调用"),
    ("GPT-4o Mini", "gpt-4o-mini", 0, "function_call,streaming", 128000, 0.15, 0.6, False,
     "轻量高效，适合日常对话与简单任务"),
    ("Claude 3.5 Sonnet", "claude-3-5-sonnet-20241022", 1, "function_call,streaming", 200000, 3.0, 15.0, False,
     "Anthropic 新一代主力模型，长上下文表现优秀"),
    ("Claude 3.5 Haiku", "claude-3-5-haiku-20241022", 1, "streaming", 200000, 0.8, 4.0, False,
     "Anthropic 轻量快速模型"),
    ("通义千问 Qwen-Max", "qwen-max", 2, "function_call,streaming", 32000, 0.8, 2.0, False,
     "阿里云旗舰推理模型"),
    ("通义千问 Qwen-Plus", "qwen-plus", 2, "function_call,streaming", 128000, 0.28, 0.92, False,
     "通义千问高性价比模型"),
    ("智谱 GLM-4", "glm-4", 3, "function_call,streaming", 128000, 1.0, 1.0, False,
     "智谱 AI 通用大模型"),
    ("智谱 GLM-4-Flash", "glm-4-flash", 3, "streaming", 128000, 0.05, 0.05, False,
     "智谱免费轻量模型"),
    ("DeepSeek Chat", "deepseek-chat", 4, "function_call,streaming", 64000, 0.05, 0.28, False,
     "DeepSeek 通用对话模型"),
    ("DeepSeek Coder", "deepseek-coder", 4, "function_call,streaming", 128000, 0.14, 0.28, False,
     "DeepSeek 代码生成专用模型"),
]

PROMPT_DEFS = [
    {
        "name": "智能客服助手",
        "description": "通用智能客服系统提示词",
        "category": "customer_service",
        "tags": ["客服", "问答", "通用"],
        "content": (
            "你是一位专业、耐心的智能客服助手。\n"
            "请遵循以下原则：\n"
            "1. 始终使用礼貌、友好的语气回复用户。\n"
            "2. 当不确定答案时，诚实告知并建议联系人工客服。\n"
            "3. 优先使用知识库中的信息回答，不要编造事实。\n"
            "4. 回复简洁明了，避免长篇大论。\n\n"
            "用户问题：{{question}}"
        ),
        "variables": [{"name": "question", "description": "用户提出的问题", "type": "string"}],
        "status": "published",
    },
    {
        "name": "代码审查专家",
        "description": "对代码进行专业审查并给出改进建议",
        "category": "development",
        "tags": ["代码", "审查", "开发"],
        "content": (
            "你是一位资深代码审查专家。请对以下代码进行审查：\n\n"
            "代码：\n```{{language}}\n{{code}}\n```\n\n"
            "请从以下维度分析：\n"
            "1. 正确性：是否存在逻辑错误或边界问题\n"
            "2. 性能：是否有可优化的空间\n"
            "3. 安全性：是否存在潜在安全隐患\n"
            "4. 可读性：命名、结构是否清晰\n"
            "5. 给出具体改进建议"
        ),
        "variables": [
            {"name": "language", "description": "编程语言", "type": "string"},
            {"name": "code", "description": "待审查的代码", "type": "text"},
        ],
        "status": "published",
    },
    {
        "name": "文案润色助手",
        "description": "润色和优化中文文案",
        "category": "writing",
        "tags": ["文案", "润色", "中文"],
        "content": (
            "你是一位资深中文文案编辑。请对以下文案进行润色优化：\n\n"
            "原文：\n{{text}}\n\n"
            "要求：\n"
            "- 保持原意不变\n"
            "- 语言更流畅、专业\n"
            "- 突出核心卖点\n"
            "- 控制在 {{max_length}} 字以内"
        ),
        "variables": [
            {"name": "text", "description": "原始文案", "type": "text"},
            {"name": "max_length", "description": "最大字数", "type": "number"},
        ],
        "status": "published",
    },
    {
        "name": "多语言翻译",
        "description": "将文本翻译为指定语言",
        "category": "translation",
        "tags": ["翻译", "多语言"],
        "content": (
            "你是一位专业翻译。请将以下文本翻译为 {{target_language}}。\n"
            "要求：\n- 准确传达原意\n- 符合目标语言表达习惯\n- 保留专业术语\n\n"
            "原文：\n{{text}}"
        ),
        "variables": [
            {"name": "target_language", "description": "目标语言", "type": "string"},
            {"name": "text", "description": "待翻译文本", "type": "text"},
        ],
        "status": "draft",
    },
]

KNOWLEDGE_DEFS = [
    {
        "name": "产品帮助中心",
        "description": "产品使用文档、常见问题与操作指南",
        "status": "ready",
        "document_count": 2,
        "segment_count": 4,
        "embedding_model": "text-embedding-ada-002",
        "chunk_method": "paragraph",
        "chunk_size": 500,
        "chunk_overlap": 50,
        "retrieval_strategy": "hybrid",
        "top_k": 5,
        "similarity_threshold": 0.7,
        "documents": [
            {
                "file_name": "快速入门指南.md",
                "file_type": "md",
                "file_size": "4.2 KB",
                "status": "completed",
                "segment_count": 2,
                "word_count": 320,
                "segments": [
                    "辰光Agent平台是一个一站式 AI Agent 管理平台，支持模型管理、Prompt 编排、知识库 RAG、工具调用和 Agent 版本发布。登录后，管理员可在左侧导航栏进入各模块。",
                    "快速创建第一个 Agent：进入「Agent 管理」点击「新建」，填写名称、选择绑定模型和知识库，配置系统提示词后保存即可。发布版本后可在对话测试中体验效果。",
                ],
            },
            {
                "file_name": "常见问题FAQ.md",
                "file_type": "md",
                "file_size": "2.8 KB",
                "status": "completed",
                "segment_count": 2,
                "word_count": 280,
                "segments": [
                    "如何重置密码？管理员可在「用户管理」中对指定用户执行重置密码操作，重置后密码为 123456，建议用户首次登录后修改。",
                    "知识库支持哪些文件格式？目前支持 TXT、Markdown、PDF、DOCX、HTML、CSV 六种格式，单个文件建议不超过 10MB。",
                ],
            },
        ],
    },
    {
        "name": "公司规章制度",
        "description": "公司内部制度、考勤、报销等规范文档",
        "status": "ready",
        "document_count": 1,
        "segment_count": 2,
        "embedding_model": "text-embedding-ada-002",
        "chunk_method": "fixed",
        "chunk_size": 500,
        "chunk_overlap": 50,
        "retrieval_strategy": "vector",
        "top_k": 3,
        "similarity_threshold": 0.75,
        "documents": [
            {
                "file_name": "员工考勤制度.pdf",
                "file_type": "pdf",
                "file_size": "156 KB",
                "status": "completed",
                "segment_count": 2,
                "word_count": 410,
                "segments": [
                    "公司实行标准工时制，工作日为周一至周五，上午 9:00 至下午 18:00，午休 12:00-13:30。迟到 30 分钟以内扣半天年假，超过 30 分钟计旷工半天。",
                    "报销流程：员工在 OA 系统提交报销单，附发票原件照片，经部门主管审批后转交财务复核，一般 5 个工作日内到账。单次报销超过 5000 元需总监加签。",
                ],
            },
        ],
    },
    {
        "name": "技术知识库",
        "description": "研发团队技术文档、架构设计与最佳实践",
        "status": "indexing",
        "document_count": 1,
        "segment_count": 2,
        "embedding_model": "text-embedding-ada-002",
        "chunk_method": "sentence",
        "chunk_size": 300,
        "chunk_overlap": 30,
        "retrieval_strategy": "hybrid",
        "top_k": 5,
        "similarity_threshold": 0.7,
        "documents": [
            {
                "file_name": "后端架构设计.md",
                "file_type": "md",
                "file_size": "6.5 KB",
                "status": "completed",
                "segment_count": 2,
                "word_count": 580,
                "segments": [
                    "后端采用 FastAPI + SQLAlchemy 2.0 异步架构，按模块划分 model/schema/repository/service/api 五层结构。数据库支持 MySQL 8.4，缓存使用 Redis，对象存储使用 MinIO。",
                    "认证采用 JWT Bearer Token，登录态与验证码存储于 Redis。接口统一返回 ResponseSchema 结构 {code, message, data}，业务异常通过 BizException 抛出。",
                ],
            },
        ],
    },
]

TOOL_DEFS = [
    {
        "name": "天气查询",
        "description": "查询指定城市的实时天气信息",
        "type": "http_api",
        "status": "enabled",
        "config": {
            "method": "GET",
            "url": "https://api.weather.example.com/current",
            "headers": {"X-API-Key": "demo-key"},
        },
        "function_definition": {
            "name": "get_weather",
            "description": "查询指定城市的天气",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "城市名称，如 北京"},
                },
                "required": ["city"],
            },
        },
        "call_count_7d": 128,
        "success_rate": 98.50,
        "avg_latency": 230,
    },
    {
        "name": "网络搜索",
        "description": "调用搜索引擎获取最新信息",
        "type": "http_api",
        "status": "enabled",
        "config": {
            "method": "POST",
            "url": "https://api.search.example.com/v1/search",
        },
        "function_definition": {
            "name": "web_search",
            "description": "搜索互联网信息",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"},
                    "num": {"type": "integer", "description": "返回结果数", "default": 5},
                },
                "required": ["query"],
            },
        },
        "call_count_7d": 356,
        "success_rate": 95.20,
        "avg_latency": 480,
    },
    {
        "name": "计算器",
        "description": "执行数学表达式计算",
        "type": "builtin",
        "status": "enabled",
        "config": {"precision": 10},
        "function_definition": {
            "name": "calculator",
            "description": "计算数学表达式",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {"type": "string", "description": "数学表达式，如 2+3*4"},
                },
                "required": ["expression"],
            },
        },
        "call_count_7d": 89,
        "success_rate": 99.80,
        "avg_latency": 12,
    },
    {
        "name": "代码执行器",
        "description": "在沙箱环境中执行 Python 代码并返回结果",
        "type": "builtin",
        "status": "disabled",
        "config": {"timeout": 30, "memory_limit": "512M"},
        "function_definition": {
            "name": "run_code",
            "description": "执行 Python 代码",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {"type": "string", "description": "Python 代码"},
                },
                "required": ["code"],
            },
        },
        "call_count_7d": 0,
        "success_rate": 0.0,
        "avg_latency": 0,
    },
]

AGENT_DEFS = [
    {
        "name": "智能客服助手",
        "description": "基于知识库的智能客服，回答产品使用问题",
        "type": "conversation",
        "status": "active",
        "model_idx": 0,  # GPT-4o
        "config": {
            "system_prompt": "你是辰光Agent平台的智能客服助手，请基于知识库回答用户问题。",
            "temperature": 0.7,
            "max_tokens": 2048,
            "knowledge_base": "产品帮助中心",
        },
        "success_rate": 96.80,
        "call_count_7d": 1240,
        "version": "v1.2",
    },
    {
        "name": "代码审查助手",
        "description": "自动审查代码质量并给出改进建议",
        "type": "analysis",
        "status": "active",
        "model_idx": 8,  # DeepSeek Coder
        "config": {
            "system_prompt": "你是资深代码审查专家，从正确性、性能、安全、可读性维度审查代码。",
            "temperature": 0.3,
            "max_tokens": 4096,
        },
        "success_rate": 92.30,
        "call_count_7d": 568,
        "version": "v1.0",
    },
    {
        "name": "营销文案生成器",
        "description": "根据产品信息生成营销推广文案",
        "type": "creative",
        "status": "active",
        "model_idx": 5,  # Qwen-Plus
        "config": {
            "system_prompt": "你是资深营销文案编辑，擅长撰写吸引人的产品推广文案。",
            "temperature": 0.9,
            "max_tokens": 1500,
        },
        "success_rate": 88.50,
        "call_count_7d": 320,
        "version": "v1.1",
    },
    {
        "name": "数据分析助手",
        "description": "帮助分析数据并生成可视化报告建议",
        "type": "analysis",
        "status": "draft",
        "model_idx": 2,  # Claude Sonnet
        "config": {
            "system_prompt": "你是数据分析专家，能够解读数据并给出业务洞察。",
            "temperature": 0.5,
            "max_tokens": 3000,
        },
        "success_rate": 0.0,
        "call_count_7d": 0,
        "version": "v0.1",
    },
]


async def _count(db, model) -> int:
    return (await db.execute(select(func.count()).select_from(model))).scalar() or 0


async def seed_auth(db) -> None:
    """初始化用户/角色/权限"""
    if await _count(db, User):
        return
    roles: dict[str, Role] = {}
    for code, name, desc in ROLE_DEFS:
        role = Role(code=code, name=name, description=desc)
        db.add(role)
        roles[code] = role
    await db.flush()

    for code, name, desc in PERM_DEFS:
        db.add(Permission(code=code, name=name, description=desc or None))
    await db.flush()

    viewer_perms = {"user:list", "role:list", "permission:list"}
    perm_rows = (await db.execute(select(Permission.code, Permission.id))).all()
    perm_id_map = {row[0]: row[1] for row in perm_rows}
    for code, name, _ in ROLE_DEFS:
        rid = roles[code].id
        for pcode, _, _ in PERM_DEFS:
            if code == "admin" or pcode in viewer_perms:
                pid = perm_id_map[pcode]
                await db.execute(sa_insert(role_permissions).values(role_id=rid, permission_id=pid))

    username, password, email = ADMIN_CREDENTIALS
    admin_user = User(
        username=username,
        email=email,
        hashed_password=hash_password(password),
        is_superuser=True,
    )
    db.add(admin_user)
    await db.flush()
    await db.execute(sa_insert(user_roles).values(user_id=admin_user.id, role_id=roles["admin"].id))
    print(f"[auth] 创建用户 [{username}/{password}], 角色 {len(ROLE_DEFS)}, 权限 {len(PERM_DEFS)}")


async def seed_providers_and_models(db) -> None:
    """初始化供应商与模型"""
    if await _count(db, ModelProvider):
        return
    providers: list[ModelProvider] = []
    for p in PROVIDER_DEFS:
        provider = ModelProvider(**p)
        db.add(provider)
        providers.append(provider)
    await db.flush()

    for name, model_id, pidx, caps, ctx, ip, op, is_def, desc in MODEL_DEFS:
        db.add(LLMModel(
            name=name, model_id=model_id, provider_id=providers[pidx].id,
            capabilities=caps, context_length=ctx, input_price=ip, output_price=op,
            currency="USD", is_default=is_def, description=desc,
        ))
    print(f"[model] 创建供应商 {len(providers)} 个, 模型 {len(MODEL_DEFS)} 个")


async def seed_prompts(db) -> None:
    """初始化 Prompt 及版本"""
    if await _count(db, Prompt):
        return
    for pd in PROMPT_DEFS:
        prompt = Prompt(
            name=pd["name"], description=pd["description"], category=pd["category"],
            tags=pd["tags"], content=pd["content"], variables=pd["variables"],
            version="v1.0", status=pd["status"], created_by="admin",
        )
        db.add(prompt)
        await db.flush()
        db.add(PromptVersion(
            prompt_id=prompt.id, version="v1.0", content=pd["content"],
            changelog="初始版本", is_current=True, published_by="admin",
            published_at=datetime.now(),
        ))
    print(f"[prompt] 创建 Prompt {len(PROMPT_DEFS)} 个")


async def seed_knowledge(db) -> None:
    """初始化知识库、文档、分段"""
    if await _count(db, KnowledgeBase):
        return
    now = datetime.now()
    for kd in KNOWLEDGE_DEFS:
        docs = kd.pop("documents")
        kb = KnowledgeBase(**kd, created_by="admin")
        db.add(kb)
        await db.flush()
        for dd in docs:
            segs = dd.pop("segments")
            doc = Document(
                knowledge_base_id=kb.id, **dd,
                minio_path=f"{kb.id}/{dd['file_name']}", uploaded_by="admin",
                processed_at=now,
            )
            db.add(doc)
            await db.flush()
            for i, content in enumerate(segs, 1):
                db.add(Segment(
                    knowledge_base_id=kb.id, document_id=doc.id,
                    position=i, content=content,
                    word_count=len(content), token_count=len(content) // 2,
                    hit_count=max(0, 10 - i * 3),
                ))
    print(f"[knowledge] 创建知识库 {len(KNOWLEDGE_DEFS)} 个")


async def seed_tools(db) -> None:
    """初始化工具"""
    if await _count(db, Tool):
        return
    for td in TOOL_DEFS:
        db.add(Tool(**td, created_by="admin"))
    print(f"[tool] 创建工具 {len(TOOL_DEFS)} 个")


async def seed_agents(db) -> None:
    """初始化 Agent 及版本"""
    if await _count(db, Agent):
        return
    models = (await db.execute(select(LLMModel))).scalars().all()
    model_ids = [m.id for m in models]
    now = datetime.now()
    for ad in AGENT_DEFS:
        midx = ad.pop("model_idx")
        model_id = model_ids[midx] if midx < len(model_ids) else None
        agent = Agent(
            **ad, model_id=model_id, created_by="admin",
        )
        db.add(agent)
        await db.flush()
        db.add(AgentVersion(
            agent_id=agent.id, version=ad["version"], config=ad["config"],
            changelog="初始发布版本", is_current=True, published_by="admin",
            published_at=now,
        ))
    print(f"[agent] 创建 Agent {len(AGENT_DEFS)} 个")


async def main() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        await seed_auth(db)
        await seed_providers_and_models(db)
        await seed_prompts(db)
        await seed_knowledge(db)
        await seed_tools(db)
        await seed_agents(db)
        await db.commit()

    # 统计汇总
    async with AsyncSessionLocal() as db:
        counts = {
            "用户": await _count(db, User),
            "供应商": await _count(db, ModelProvider),
            "模型": await _count(db, LLMModel),
            "Prompt": await _count(db, Prompt),
            "知识库": await _count(db, KnowledgeBase),
            "文档": await _count(db, Document),
            "分段": await _count(db, Segment),
            "工具": await _count(db, Tool),
            "Agent": await _count(db, Agent),
        }
    print("\n===== 数据统计 =====")
    for name, cnt in counts.items():
        print(f"  {name}: {cnt} 条")
    print("====================")


if __name__ == "__main__":
    asyncio.run(main())
