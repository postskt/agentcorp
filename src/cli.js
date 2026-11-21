#!/usr/bin/env node
// CLI for setup and inspection: agentcorp init / status / config / install
import fs from 'node:fs';
import path from 'node:path';
import { Store } from './store.js';
import { AGENTS, VERSION } from './constants.js';

const cmd = process.argv[2] || 'help';
const ws = process.env.AGENTCORP_WORKSPACE || process.cwd();

function configFor(platform) {
  const abs = path.resolve('src/index.js').replace(/\\/g, '/');
  const base = {
    command: 'node',
    args: [abs],
    env: { AGENTCORP_WORKSPACE: ws },
    transport: 'stdio',
  };
  const map = {
    workbuddy: {
      where: '~/.workbuddy/mcp.json  →  mcpServers.agentcorp',
      snippet: { mcpServers: { agentcorp: base } },
    },
    dsh: {
      where: 'DSH MCP config (streamable-http or stdio bridge)',
      snippet: base,
      note: 'DSH supports stdio via its MCP SDK; add as a local MCP server. DSH also speaks ACP.',
    },
    zcode: {
      where: 'ZCode MCP config  →  mcpServers.agentcorp',
      snippet: { mcpServers: { agentcorp: base } },
      note: 'ZCode can @-reference this MCP in conversation via its plugin system.',
    },
    antigravity: {
      where: '~/.gemini/config/mcp_config.json  →  mcpServers.agentcorp',
      snippet: { mcpServers: { agentcorp: base } },
      note: 'Antigravity CLI uses mcp_config.json; note the serverUrl key is for remote MCP only.',
    },
  };
  return map[platform] || null;
}

switch (cmd) {
  case 'init': {
    const store = new Store(ws);
    const s = store.readState();
    s.workspace = ws;
    store.writeState(s);
    console.log(`AgentCorp ${VERSION} initialized.`);
    console.log(`Workspace: ${ws}`);
    console.log(`State dir: ${store.dir}`);
    console.log('Now add the MCP server to each agent (see: agentcorp config <platform>).');
    break;
  }
  case 'status': {
    const store = new Store(ws);
    const s = store.readState();
    console.log(JSON.stringify({
      workspace: ws,
      goal: s.goal,
      tasks: Object.keys(s.tasks).length,
      stats: s.stats,
      recent: store.tailEvents(5),
    }, null, 2));
    break;
  }
  case 'config': {
    const p = process.argv[3];
    if (!p || !AGENTS[p]) {
      console.log('Usage: agentcorp config <workbuddy|dsh|zcode|antigravity>');
      process.exit(1);
    }
    const c = configFor(p);
    console.log(`# ${AGENTS[p].name}`);
    console.log(`# Add to: ${c.where}`);
    if (c.note) console.log(`# Note: ${c.note}`);
    console.log(JSON.stringify(c.snippet, null, 2));
    break;
  }
  case 'install': {
    const p = process.argv[3];
    const targets = p && AGENTS[p] ? [p] : Object.keys(AGENTS);
    for (const t of targets) {
      const c = configFor(t);
      console.log(`\n=== ${AGENTS[t].name} ===`);
      console.log(`Add to: ${c.where}`);
      console.log(JSON.stringify(c.snippet, null, 2));
    }
    console.log('\nAuto-writing configs is platform-specific; see adapters/*/README.md for one-click snippets.');
    break;
  }
  case 'web': {
    const port = Number(process.argv[3] || 7788);
    const { ensureDashboard } = await import('./web.js');
    ensureDashboard(port);
    break;
  }
  case 'update': {
    const sub = process.argv[3] || 'check';
    const u = await import('./updater.js');
    if (sub === 'check') {
      const r = await u.checkForUpdates();
      console.log(JSON.stringify(r, null, 2));
    } else if (sub === 'apply') {
      console.log(JSON.stringify(u.applyUpdate(), null, 2));
    } else if (sub === 'plugins') {
      console.log(JSON.stringify(u.pluginStatus(ws), null, 2));
    } else if (sub === 'plugin') {
      const p = process.argv[4];
      console.log(JSON.stringify(u.updatePlugin(p, ws), null, 2));
    } else {
      console.log('Usage: agentcorp update check|apply|plugins|plugin <id>');
    }
    break;
  }
  case 'help':
  default:
    console.log(`AgentCorp ${VERSION} — AI collaboration bus
Usage:
  agentcorp init                 Initialize .agentcorp in current workspace
  agentcorp status               Show company status
  agentcorp config <platform>    Print MCP config for one platform
  agentcorp install [platform]   Print MCP config for all/one platform
  agentcorp web [port]           Start web dashboard (default 7788)
  agentcorp update check         Check GitHub for a newer version
  agentcorp update apply         Apply core update (git pull)
  agentcorp update plugins       Show plugin registration status
  agentcorp update plugin <id>   Hot-update one adapter plugin
  agentcorp help                 This help

Environment:
  AGENTCORP_WORKSPACE   Shared workspace path (defaults to cwd)
  AGENTCORP_REPO        GitHub owner/repo for update checks
  AGENTCORP_NO_AUTOCHECK=1  Disable startup/background update checks`);
    break;
}
