#!/usr/bin/env node
// MCP stdio entrypoint. Each connected agent spawns this process; state is shared
// through the workspace's .agentcorp directory, so all agents see the same company.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './server.js';
import { pickHubRoot } from './workspace-hub.js';
import { maybeAutoOpenDashboard } from './autoopen.js';

const server = buildServer();
const transport = new StdioServerTransport();
await server.connect(transport);
void maybeAutoOpenDashboard({
  workspace: process.env.AGENTCORP_WORKSPACE || pickHubRoot(),
  trigger: 'mcp-server',
});
// Keep process alive; stdio transport handles the event loop.
