# DeepSeek Harness (DSH) adapter

DSH runs on the Cordis plugin architecture: everything is a plugin, and it has a
first-class MCP client plus ACP support. It is the most flexible of the four to wire up.

## Option A — MCP stdio bridge (recommended, lowest latency)

DSH's MCP client can launch a local stdio server. Generate the config:

```bash
AGENTCORP_WORKSPACE=/path/to/shared/workspace node src/cli.js config dsh
```

Register the server in DSH's MCP config. With the DSH plugin `dsh-mcp-client`:

```bash
export DSH_HOME=/path/to/dsh-home
dsh plugin add @deepseek-ai/dsh-mcp-client
```

Then add an MCP entry pointing at the AgentCorp stdio process:

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

## Option B — streamable-http (if you run a resident service)

DSH examples show MCP servers exposed as `streamable-http` at e.g.
`http://127.0.0.1:5225/mcp`. If you prefer a resident AgentCorp service, point
DSH's MCP client at that URL instead of spawning stdio. (A thin HTTP wrapper
around `src/server.js` is all that's needed; kept out of v0.1 for simplicity.)

## Option C — ACP

DSH speaks ACP (Agent Client Protocol). AgentCorp itself is an MCP server, not an
ACP client, so use ACP only if you want DSH to *delegate into* another ACP agent.
For joining the company, MCP is the correct path.

## Why DSH is a good coder/reviewer

DSH has persistent sessions, trajectory replay, and cheap DeepSeek inference —
ideal for the high-volume code/review/fix roles in the pipeline.
