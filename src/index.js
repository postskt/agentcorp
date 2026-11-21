#!/usr/bin/env node
// MCP stdio entrypoint. Each connected agent spawns this process; state is shared
// through the workspace's .agentcorp directory, so all agents see the same company.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './server.js';

const server = buildServer();
const transport = new StdioServerTransport();
await server.connect(transport);
// Keep process alive; stdio transport handles the event loop.
