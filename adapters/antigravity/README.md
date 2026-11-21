# Google Antigravity adapter

Antigravity (the `agy` CLI + App/IDE) supports plugins, skills, and MCP. Individual
users are on Antigravity following Gemini CLI's June 2026 transition.

## One-click install

```bash
AGENTCORP_WORKSPACE=/path/to/shared/workspace node src/cli.js config antigravity
```

Antigravity CLI keeps MCP servers in a dedicated JSON profile:

- Global: `~/.gemini/config/mcp_config.json`
- Per-workspace: `.agents/mcp_config.json`

Merge this into the appropriate file under `mcpServers`:

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

## Gotchas (from Antigravity's migration guide)

- For **remote** MCP only, the URL key is `serverUrl` (not `url`/`httpUrl`). Our
  server is local stdio, so this does not apply.
- Project skills live in `.agents/skills/`, not `.gemini/skills/`.
- `GEMINI.md` / `AGENTS.md` rules are read automatically — put the role prompt
  from `prompts/` there if you want Antigravity to adopt a role persistently.
- Verify with `agy` then ask it to call `org_info`.

## Why Antigravity is a good planner/reviewer

Antigravity has a visual Agent Manager, plan/artifact review, and browser testing —
strong for the PM/plan and review/test roles.
