# 端到端演示：一次完整的代码协作

场景：CEO 要"加用户认证"，PM 拆解并派活，coder 写代码，reviewer 打回一次再放行。
所有步骤都是各 Agent 通过 MCP 调用 AgentCorp 工具完成的（以下为工具调用序列）。

---

## 1. CEO 定方向

```jsonc
// 工具: org_goal
{ "title": "加用户认证", "direction": "邮箱+密码登录，JWT 会话", "constraints": "不改支付模块" }
```
→ 记录目标，广播 `goal_set` 事件。CEO 到此为止，不再插手。

## 2. PM 拆解 + 路由 + 派活

```jsonc
// 工具: task_plan
{ "tasks": [
  { "type": "code", "title": "实现登录接口",
    "spec": "POST /login 返回 JWT；密码 bcrypt 校验；错误返回 401",
    "files": ["src/auth.js"] },
  { "type": "review", "title": "审查登录接口",
    "spec": "验证 JWT 正确性与错误处理", "files": ["src/auth.js"] }
]}
```
→ 生成两张任务卡（code / review），各带验收标准。

```jsonc
// 工具: task_route  { "taskId": "<code任务ID>" }
```
→ 返回 `suggested: "dsh"`（DeepSeek 支持 code 且负载最低），附冲突检查。

```jsonc
// 工具: task_assign  { "taskId": "<code任务ID>", "agent": "dsh" }
```
→ 任务归 dsh；若与其他任务在 `src/auth.js` 冲突会被拦截。

## 3. Coder 认领 + 干活 + 提交

```jsonc
// task_list { "agent": "dsh" }        → 看到自己的任务摘要
// task_get  { "taskId": "..." }        → 按需拉完整 spec（只看这一张）
// file_lock { "path": "src/auth.js", "agent": "dsh" }
// ... 在共享工作区写代码 ...
// file_unlock { "path": "src/auth.js", "agent": "dsh" }
// task_submit { "taskId": "...", "agent": "dsh",
//   "summary": "登录接口完成", "artifacts": [{ "path": "src/auth.js", "kind": "code" }] }
```
→ 任务进入 `review`。

## 4. Reviewer 打回 → 自动重做

```jsonc
// task_list_review {}   → 看到待审任务
// review_submit { "taskId": "...", "reviewer": "workbuddy",
//   "verdict": "fail", "comments": "缺少 bcrypt 校验" }
```
→ 任务变 `rejected`，revision +1，**自动退回 dsh**。CEO 完全不用介入。

dsh 再次 `task_list` 会看到这张被打回的卡，`task_get` 读到 reviewer 意见，修复后重新
`task_claim` → `task_submit`。Reviewer 再审，通过后 `review_submit verdict=pass`
→ 任务变 `done`。

## 5. 任意时刻：实时查看

```jsonc
// org_status {}     → 公司全局：目标、各状态任务数、谁在干活、冲突、统计
// org_events { "afterSeq": 0 }  → 活动流：goal_set / task_created / task_assigned /
//                                  task_started / task_submitted / review_rejected ...
// agent_message { "from": "ceo", "to": "dsh", "message": "顺手补个单元测试" }
```

## 关键收益

- CEO 只做了 1 次工具调用（定方向 + 必要时决策）。
- 代码质量的循环在 AI 之间自动完成，不烧 CEO 的上下文。
- 每步都有事件留痕，任何人可随时 `org_events` 回放"谁做了什么"。
- 任务卡默认摘要 + 按需拉详情，token 与硬盘都可控。
