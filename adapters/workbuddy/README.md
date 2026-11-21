# WorkBuddy adapter

WorkBuddy reads MCP servers from `~/.workbuddy/mcp.json` (note: no leading dot on `mcp.json`).

## One-click install

From the AgentCorp repo root, with a shared workspace path:

```bash
AGENTCORP_WORKSPACE=/path/to/shared/workspace node src/cli.js config workbuddy
```

This prints the snippet. Merge it into `~/.workbuddy/mcp.json` under `mcpServers`:

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

If `mcp.json` already has other servers, keep them — just add the `agentcorp` key.

## Enable it

WorkBuddy will NOT activate a newly written MCP server automatically. Open the
connector/custom-connector entry at the top-right of the connector management page
and click **Trust** on `agentcorp` to enable it. Restart if the tools don't appear.

## Verify

Ask WorkBuddy: "使用 agentcorp 的 org_info 工具查看协作总线状态".
It should return the AgentCorp version, workspace, and connected agent roster.
