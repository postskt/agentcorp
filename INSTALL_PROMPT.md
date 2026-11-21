# AgentCorp 一键安装提示词

把本文件的链接发给任意一个 AI Agent（WorkBuddy / DeepSeek Harness / ZCode / Google Antigravity），
它照着下面的指令做，就能把自己接入 AgentCorp 协作总线并完成自检。

**分享链接：**
`https://raw.githubusercontent.com/postskt/agentcorp/main/INSTALL_PROMPT.md`

---

## 给 AI 的指令（从这里开始复制）

```
请帮我安装 AgentCorp 协作总线，让本 Agent 接入一个多 AI 协作网络。请严格按步骤执行，并把每步结果告诉我。

【第 0 步：确认环境】
- 确认本机有 Node.js >= 18（运行 node --version）。没有就告诉我，不要继续。
- 【极其重要】所有 AI 必须共用同一个共享目录，方便彼此看到对方的文件、互相访问、传任务和保存工作记录。
  运行 node src/cli.js hub path 得到自动选定的共享目录（默认在 C 盘之后第一个可用盘，
  名字叫 agent-link，例如 E:/agent-link）。把它记为 WORKSPACE，不要用自己的默认目录。
  该目录已按 agent 分好子文件夹（workbuddy/ dsh/ zcode/ antigravity/），并初始化为 git 仓库，
  每个 AI 可以把自己的文件放进去，也能读其他 AI 的文件。
  工作区不一致将导致谁都看不到谁——这是最常见的失败原因。
  不确定就运行 node src/cli.js doctor 查看各家指向哪里。

【第 1 步：获取 AgentCorp】
- 从 https://github.com/postskt/agentcorp 获取代码到本地，例如：
  git clone https://github.com/postskt/agentcorp.git
- 进入 agentcorp 目录，运行 npm install 安装依赖。
- 如果你的环境无法 git clone，告诉我，我会改用 GitHub API 获取文件。

【第 2 步：初始化共享工作区】
- 运行：node src/cli.js hub init   创建 agent-link 目录（自动选盘、分 agent 子目录、git 仓库）
- 运行：AGENTCORP_WORKSPACE=<WORKSPACE> node src/cli.js init
- 这会在 <WORKSPACE>/.agentcorp 下创建状态文件，四个 AI 共用它。

【第 3 步：把自己注册进 MCP 配置】
先判断你自己是哪个平台（WorkBuddy / DSH / ZCode / Antigravity），只改你自己的配置文件：
- 运行：AGENTCORP_WORKSPACE=<WORKSPACE> node src/cli.js config <平台名>
  得到 agentcorp 的 MCP 配置片段。
- 把该片段合并进你自己的 MCP 配置文件，保留已有的其他 server 配置，不要覆盖：
  * WorkBuddy : ~/.workbuddy/mcp.json        （写入后需在连接器页面点 Trust 启用）
  * DSH       : 你的 DSH MCP 配置（可能是 ~/.deepseek-harness/mcp.json 或插件目录）
  * ZCode     : ZCode 的 MCP 配置            （形如 mcpServers.agentcorp）
  * Antigravity: ~/.gemini/config/mcp_config.json
- 配置里的 args[0] 必须是 agentcorp/src/index.js 的绝对路径，env.AGENTCORP_WORKSPACE 必须是 <WORKSPACE> 的绝对路径。

【第 4 步：验证接入】
- 重启你自己（或重新加载 MCP 配置），让新工具生效。
- 调用 agent_hello，参数 agent 填你的平台名，role 填你担任的角色（pm/coder/reviewer/tester）。
- 调用 agent_roster，确认名单里你的条目 online=true、installed=true。
- 调用 org_info，确认返回 product=AgentCorp、版本和共享工作区路径。
- 调用 org_status 看一眼公司当前状态。

【第 5 步：汇报】
告诉我：平台名、角色、是否 online/installed、共享工作区路径、以及 roster 里其他 AI 的在线情况。
如果任何一步失败，原样报错信息给我，不要自行跳过。

【第 6 步：共享文件与保存（装好后随时可用）】
- hub_files：列出任意 agent 工作区的文件（agent 参数指定谁，不填列整个 hub）。
- hub_file_read / hub_file_write：读写共享目录里的任意文件——你能看到其他 AI 的所有文件。
- worklog_add：把工作记录写到共享的 worklog/按日期归档。
- 保存与上传：repo_save 提交到 git；需要上传 GitHub 时先 repo_remote_set 设置远端，再 repo_sync 推送。
  这样工作记录和重要文件既在 git 本地留档，也能上传 GitHub。

【注意事项】
- 不要修改其他 AI 的配置文件，只改你自己的。
- 不要删除 .agentcorp 目录，那是共享状态。
- 自己的产物放进自己名字的子文件夹（如 dsh/），要给别人看就放 shared/ 或直接写进对方子目录。
- 上下文保持轻量：默认只看任务摘要，需要详情再用 task_get 拉取。
```

## 给人的速查

- 想让某个 AI 自安装：把上面的分享链接发给它，说"按这个链接里的指令安装 AgentCorp"。
- 想手动装：见 [README 快速开始](README.md) 和各平台 [适配说明](adapters/)。
- 装完看谁在线：让任意 AI 调用 `agent_roster`，或打开网页看板 `node src/cli.js web`。
