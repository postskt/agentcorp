# ZCode adapter

ZCode (智谱 Z.ai) is an Agentic Development Environment with Goal mode, Subagents,
project memory, a plugin system, and MCP support. Tasks can be @-referenced in chat.

## One-click install

```bash
AGENTCORP_WORKSPACE=/path/to/shared/workspace node src/cli.js config zcode
```

Merge the snippet into ZCode's MCP config (`mcpServers.agentcorp`):

```json
{
  "mcpServers": {
    "agentcorp": {
      "command": "node",
      "args": ["/absolute/path/to/agentcorp/src/index.js"],
      "env": { "AGENTCORP_WORKSPACE": "/path/to/shared/workspace" }
    }
  }
}
```

## Using it inside ZCode

- ZCode supports `@` references to plugins/files/history. Reference the AgentCorp
  tools in a Goal: "用 agentcorp 的 task_list 领取任务并完成".
- ZCode's Goal mode is a natural fit for a whole task card: paste the `spec` as
  the goal, let it plan/execute/verify, then call `task_submit`.
- ZCode can also be triggered remotely via WeCom/Feishu/Telegram — useful for the
  CEO to set direction while away from the desk.

## Note

ZCode's plugin/MCP ecosystem is still maturing. If a config key differs in your
version, keep the same `command`/`args`/`env` values and just place them under
whatever `mcpServers` key ZCode expects.
