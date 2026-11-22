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
    const hub = await import('./workspace-hub.js');
    const hubRoot = process.env.AGENTCORP_HUB_ROOT || hub.pickHubRoot();
    const layout = hub.initHub(hubRoot);
    const store = new Store(ws);
    const s = store.readState();
    s.workspace = ws;
    store.writeState(s);
    console.log(`AgentCorp ${VERSION} initialized.`);
    console.log(`Shared hub : ${layout.root}`);
    console.log(`  subfolders: ${layout.dirs.join(' ')}`);
    console.log(`  git repo  : ${layout.gitInitialized ? 'created' : (fs.existsSync(path.join(layout.root, '.git')) ? 'exists' : 'unavailable')}`);
    console.log(`Workspace  : ${ws}`);
    console.log(`State dir  : ${store.dir}`);
    console.log('All agents should use the SAME hub root as their AGENTCORP_WORKSPACE.');
    console.log('Add the MCP server to each agent (see: agentcorp config <platform>).');
    const auto = await import('./autoopen.js');
    const opened = auto.maybeAutoOpenDashboard({ workspace: hubRoot, trigger: 'cli-init' });
    console.log(`Dashboard : ${opened.url || '(not started)'}${opened.opened ? ' — opened in browser' : ''}`);
    break;
  }
  case 'hub': {
    const hub = await import('./workspace-hub.js');
    const root = process.env.AGENTCORP_HUB_ROOT || hub.pickHubRoot();
    const sub = process.argv[3] || 'info';
    if (sub === 'init') {
      console.log(JSON.stringify(hub.initHub(root), null, 2));
    } else if (sub === 'path') {
      console.log(root);
    } else if (sub === 'files') {
      const agent = process.argv[4];
      console.log(JSON.stringify(hub.hubTree({ root, agent, depth: Number(process.argv[5]) || 3 }), null, 2));
    } else {
      console.log(JSON.stringify({ root, exists: fs.existsSync(root),
        subfolders: Object.keys(AGENTS).map(id => `${id}/`).concat(['inbox/', 'worklog/', 'shared/']) }, null, 2));
    }
    break;
  }
  case 'repo': {
    const hub = await import('./workspace-hub.js');
    const root = process.env.AGENTCORP_HUB_ROOT || hub.pickHubRoot();
    const sub = process.argv[3] || 'status';
    if (sub === 'status') console.log(JSON.stringify(hub.repoStatus({ root }), null, 2));
    else if (sub === 'commit') console.log(JSON.stringify(hub.repoCommit({ root, message: process.argv[4] }), null, 2));
    else if (sub === 'log') console.log(JSON.stringify(hub.repoLog({ root, limit: Number(process.argv[4]) || 10 }), null, 2));
    else if (sub === 'remote') console.log(JSON.stringify(hub.repoSetRemote({ root, url: process.argv[4] }), null, 2));
    else if (sub === 'sync') console.log(JSON.stringify(hub.repoSync({ root, message: process.argv[4] }), null, 2));
    else console.log('Usage: agentcorp repo status|commit [msg]|log|remote <url>|sync [msg]');
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
  case 'float': {
    const port = Number(process.argv[3] || 7788);
    const { openFloatingDashboard } = await import('./floating.js');
    console.log(JSON.stringify(await openFloatingDashboard({ port }), null, 2));
    break;
  }
  case 'ui': {
    const hub = await import('./workspace-hub.js');
    const root = process.env.AGENTCORP_WORKSPACE || process.env.AGENTCORP_HUB_ROOT || hub.pickHubRoot();
    const { openNativeDashboard } = await import('./native-ui.js');
    console.log(JSON.stringify(openNativeDashboard({ workspace: root }), null, 2));
    if (process.env.AGENTCORP_UI_DEBUG === '1') await new Promise(r => setTimeout(r, 6000));
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
  case 'doctor': {
    const { doctor } = await import('./updater.js');
    const d = doctor(ws);
    console.log(`=== AgentCorp 诊断 (工作区: ${d.currentWorkspace}) ===`);
    console.log(`已装 ${d.installedCount} 家 | 工作区一致: ${d.aligned ? '是 ✓' : '否 ✗'}`);
    console.log('\n各 Agent 配置:');
    for (const p of d.plugins) {
      const mark = p.agentcorpRegistered ? (p.workspace && path.resolve(p.workspace) === path.resolve(ws) ? '✓' : '⚠') : '✗';
      console.log(`  ${mark} ${p.id.padEnd(12)} ${p.agentcorpRegistered ? (p.workspace || '(未设工作区)') : '未安装'}`);
    }
    if (d.problems.length) {
      console.log('\n⚠ 发现的问题:');
      for (const pr of d.problems) console.log(`  - ${pr}`);
      console.log(`\n修复: ${d.fix}`);
    } else {
      console.log('\n✓ 所有已安装 Agent 共享同一工作区。打开各家调用 agent_hello 即可上线。');
    }
    break;
  }
  case 'align': {
    const { alignWorkspaces } = await import('./updater.js');
    const hub = await import('./workspace-hub.js');
    // Default target = the auto-picked shared hub (next drive after C:).
    const target = process.argv[3] || process.env.AGENTCORP_HUB_ROOT || hub.pickHubRoot();
    hub.initHub(target); // ensure layout exists before pointing agents at it
    const r = alignWorkspaces(target);
    console.log(JSON.stringify({ ...r, target }, null, 2));
    break;
  }
  case 'help':
  default:
    console.log(`AgentCorp ${VERSION} — AI collaboration bus
Usage:
  agentcorp init                 Init shared hub (next drive after C:) + .agentcorp
  agentcorp hub [path|init|files] Show/create shared hub (agent-link)
  agentcorp repo status|commit|log|remote|sync   Save/upload the shared hub to git
  agentcorp status               Show company status
  agentcorp doctor               Diagnose why agents can't see each other
  agentcorp align [workspace]    Unify all installed agents onto one workspace
  agentcorp config <platform>    Print MCP config for one platform
  agentcorp install [platform]   Print MCP config for all/one platform
  agentcorp web [port]           Start web dashboard (default 7788)
  agentcorp ui                   Open the native always-on-top desktop widget
  agentcorp float [port]         Open the browser-based floating fallback
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
