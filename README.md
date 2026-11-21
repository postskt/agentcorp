# AgentCorp

> 一套协议、多端适配的 AI 协作总线。把 WorkBuddy、DeepSeek Harness (DSH)、智谱 ZCode、Google Antigravity 接成一家"AI 公司"：你当 CEO 只管方向，AI 之间自动分工、互发指令、互审产物、打回重做。

## 为什么能做成

这四款 Agent 有一个共同点：**都支持 MCP（Model Context Protocol）**，且都能作为本地 stdio 进程启动。AgentCorp 就是一个 MCP Server，把"协作能力"做成一组标准工具，四家各自接入即可。不需要任何一家开放私有接口。

| 你的说法 | 实际产品 | 接入方式 |
|---|---|---|
| WorkBuddy | 当前平台 | `~/.workbuddy/mcp.json` |
| DSH | DeepSeek Harness | MCP stdio 插件 / ACP |
| zcode | 智谱 ZCode | 插件体系 + MCP |
| Google agent | Google Antigravity | `~/.gemini/config/mcp_config.json` |

## 组织架构（你定的）

```
CEO（你，只定方向）
  └─ 项目经理 PM（动态路由，决定代码怎么写、谁来执行）
       └─ 写代码 Agent
            └─ 审核员 / 测试员  ──不通过──▶ 打回写代码（自动重做）
```

- **动态路由**：一个命令让 PM 决定哪个 AI 执行，按"能力匹配 + 当前负载"选人，从源头减少冲突。
- **冲突处理**：PM 分配时一人一文件；检测到冲突会拦截；实在解决不了才升级给你（`org_escalate` → `org_decide`）。
- **方向归你，代码质量归 AI**：打回重做在 coder 和 reviewer 之间自动循环，不占用你。

## 核心设计

- **轻量上下文**：任务卡默认是摘要（id/类型/状态/负责人/验收标准），完整卡片按需 `task_get` 拉取。看得到 ≠ 全塞进脑子，token 可控。
- **低存储**：中心只存 KB 级元数据（`state.json` + `events.jsonl`），产物文件只有一份，在共享工作区里。1 万条事件也就几 MB。
- **低延迟**：stdio MCP 直连；`org_events` 按 seq 增量拉取活动流，可高频轮询做到近实时。
- **共享工作区**：四家读写同一个目录，`file_lock`/`file_unlock` 防止并发改同一文件。
- **跟着 Agent 走**：每个 Agent 启动一个 AgentCorp stdio 进程，状态通过共享目录同步，无需常驻后台服务。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 在共享工作区初始化
AGENTCORP_WORKSPACE=/path/to/shared/workspace node src/cli.js init

# 3. 给每家 Agent 生成 MCP 配置
node src/cli.js config workbuddy
node src/cli.js config dsh
node src/cli.js config zcode
node src/cli.js config antigravity

# 4. 按 adapters/<platform>/README.md 把配置写进各自位置
#    WorkBuddy: 写完后需在连接器管理页点 Trust 启用
```

详见 [端到端演示](examples/walkthrough.md) 和 [角色提示词](prompts/)。

## MCP 工具一览

**CEO**：`org_info` `org_goal` `org_status` `org_events` `org_escalate` `org_decide`
**PM**：`task_plan` `task_route` `task_assign`
**Worker**：`task_list` `task_get` `task_claim` `task_submit` `file_lock` `file_unlock`
**Reviewer**：`task_list_review` `review_submit`
**通用**：`workspace_scan` `agent_message` `dashboard_data` `file_content` `git_diff`
**看板**：`dashboard_open`　**更新**：`update_check` `update_apply` `plugin_status` `plugin_update`（共 27 个工具）

## 可视化看板（网页）

```bash
node src/cli.js web          # 默认 7788 端口
# 或让任意 Agent 调用 MCP 工具 dashboard_open
```
打开 `http://localhost:7788`。四个页签：

- **任务看板**：统计卡片 + "各 AI 正在做什么"（谁在做、排队多少）+ 七列流水线（点卡片看详情）
- **实时活动流**：时间线滚动显示每个 Agent 的动作，SSE 推送，事件产生后约 0.5 秒自动刷新
- **产物与变更**：产物登记簿（作者/审核结论）+ git diff + 按路径读文件内容（都在共享工作区，只读）
- **CEO 决策中心**：待拍板/冲突升级项（指定继续 / 打回 / 放弃）、待审任务（通过 / 打回）、给 Agent 发指令、手动派活

看板与 MCP 工具共用同一套 `actions.js` 逻辑，所以你在网页上做的操作和 Agent 通过工具做的是同一件事。

## 自动更新与插件热更新

- **启动时检查**：AgentCorp 启动 3 秒后静默检查 GitHub Release；发现新版写入 `update_available` 事件（看板能看到）
- **定时后台检查**：每 30 分钟一次，同样只发事件、不打断工作
- **核心更新**：`update apply`（git pull --ff-only）或 MCP `update_apply`
- **插件热更新**：MCP `plugin_update`（可选 workbuddy/dsh/zcode/antigravity/all）或 `agentcorp update plugin <id>`——只重写该平台的 MCP 配置条目，保留其他 server 配置，无需重启服务
- **配置更新源**：`package.json` 的 `repository` 或环境变量 `AGENTCORP_REPO=owner/repo`；`AGENTCORP_NO_AUTOCHECK=1` 可关闭自动检查

在任意 Agent 里说"用 agentcorp 检查更新 / 更新 DSH 插件"即可触发，无需手动操作。

## 测试

```bash
npm test
```

10 项测试全部通过：状态持久化、文件锁互斥、打回重做状态机、动态路由与冲突检测、轻量摘要、看板聚合、CEO 决策、文件路径安全、插件热更新（保留其他配置）、版本读取。另经真实 HTTP + MCP 客户端验证：看板 4 页签 API、SSE 实时推送、CEO 派活/发消息、27 个 MCP 工具、插件热更新与看板启动。

##  roadmap（后续）

- 会话摘要层：把各家完整会话自动摘要后再入事件流，进一步压 token
- 会话窗口读取适配（DSH trajectory / Antigravity artifacts）—— 屏幕画面为可选
- CI：任务卡与 GitHub Issues / PR 双向同步

## License

MIT
