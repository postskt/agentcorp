---
name: agentcorp
description: 把 ZCode 接入 AgentCorp AI 协作总线：与其他 AI（WorkBuddy/DSH/Antigravity）共享任务、文件、在线名单，按 CEO→PM→写代码→审核的流水线协作。当用户说"接入协作总线""和其他 AI 协作""认领任务""提交审核""看谁在线""共享工作区"时使用。
when_to_use: 当用户想在 ZCode 里参与多 AI 协作、认领/提交任务、查看其他 AI 的工作文件与在线状态、写入共享工作记录时使用。
---

# AgentCorp 协作总线（ZCode 接入）

AgentCorp 把多个 AI 连成一家"公司"：你（CEO）定目标，PM 拆任务，写代码的执行，审核员把关，不通过自动打回。所有 AI 共享同一个文件中心。

## 第一步：上线报到
每次开始协作相关工作时，先报到（你的身份是 `zcode`）：
```
agent_hello(agent="zcode", role="coder")   // role 可为 ceo/pm/coder/reviewer/tester
agent_roster()                              // 看谁现在在线
```
"在线"= 2 分钟内调过工具；"已安装"= 配置里有 agentcorp 但没在运行。两者不同。

## 第二步：按角色干活
- **写代码**：`task_list(agent="zcode")` → `task_get(taskId)` 拉完整规格 → 改共享目录里的文件 → `task_submit(taskId, agent, summary, artifacts)`
- **审核**：`task_list_review()` → 检查实际文件/跑测试 → `review_submit(taskId, reviewer="zcode", verdict="pass|fail", comments)`；fail 会自动打回给写代码的人
- **PM**：`task_plan(tasks=[...])` → `task_route` → `task_assign(taskId, agent)`
- **CEO**：`org_goal(title, direction)` 定方向；`org_decide` 拍板升级项

## 共享文件中心（能看到其他 AI 的所有文件）
共享根目录在 C 盘之后第一个盘的 `agent-link`（本机 `E:\agent-link`），每个 AI 一个子文件夹：
```
agent-link/{workbuddy,dsh,zcode,antigravity}/   ← 各家工作目录，彼此可读
agent-link/inbox/  shared/  worklog/  .agentcorp/
```
- `hub_files(agent="dsh")` 列出 DSH 的文件；`hub_file_read(file="dsh/xxx")` 读任意文件
- `hub_file_write(file="zcode/xxx", content=...)` 写自己的目录
- `worklog_add(agent="zcode", text="...")` 写工作记录（按日期归档）
- `repo_save(message=...)` 提交到 git；`repo_sync()` 上传 GitHub

## 轻量上下文原则
默认只看任务摘要（`task_list`/`dashboard_data`），需要详情再 `task_get`/`hub_file_read` 拉取。不要把其他 AI 的全部对话塞进上下文——那会烧 token。

## 找不到别人？
`agent_doctor()` 诊断：如果各家指向不同的共享目录，心跳碰不到。`workspace_align(workspace="E:/agent-link")` 一键统一（改完需重启各家）。
