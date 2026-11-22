// AgentCorp MCP Server — the collaboration bus.
// Every capability is exposed as an MCP tool so any connected agent (WorkBuddy,
// DSH, ZCode, Antigravity) can drive the same workflow through stdio.
// Business logic lives in actions.js (shared with the web dashboard).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Store } from './store.js';
import { createActions } from './actions.js';
import { AGENTS, VERSION } from './constants.js';
import {
  checkForUpdates, applyUpdate, pluginStatus, updatePlugin, startBackgroundChecks,
} from './updater.js';
import {
  APP_URI, APP_MIME, APP_TOOL, APP_RESOURCE_META, APP_TOOL_META, buildConsoleHtml,
} from './mcp-app.js';

const WS = process.env.AGENTCORP_WORKSPACE || process.cwd();
const store = new Store(WS);
const a = createActions(store, WS);

function call(fn, args = {}) {
  try {
    // Every tool call that carries an agent identity is a heartbeat. This makes
    // "online" mean "actually used the bus recently", not just "configured".
    const who = args.agent || args.reviewer || args.from;
    if (who && AGENTS[who]) a.touchPresence(who, args.role);
    const result = fn(args);
    if (result?.error) return { content: [{ type: 'text', text: `ERROR: ${result.error}` }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `ERROR: ${e.message || e}` }], isError: true };
  }
}

// Non-blocking startup + periodic update checks (failures are silent, never crash the bus).
const AUTO_CHECK = process.env.AGENTCORP_NO_AUTOCHECK !== '1';
let latestUpdate = null;
if (AUTO_CHECK) {
  setTimeout(async () => {
    try {
      const r = await checkForUpdates();
      if (r.available) {
        latestUpdate = r;
        store.emit('update_available', { latest: r.latestVersion, current: r.localVersion, url: r.url }, 'updater');
      }
    } catch { /* silent */ }
  }, 3000).unref?.();
  startBackgroundChecks({
    intervalMs: 30 * 60 * 1000,
    onUpdate: (r) => {
      latestUpdate = r;
      store.emit('update_available', { latest: r.latestVersion, current: r.localVersion, url: r.url }, 'updater');
    },
  });
}

export function buildServer() {
  const server = new McpServer({ name: 'agentcorp', version: VERSION });
  const agent = z.enum(['workbuddy', 'dsh', 'zcode', 'antigravity']);

  // ---- embedded MCP App (rendered INSIDE the host UI, no browser/window) ----
  // WorkBuddy sees _meta.ui.resourceUri and loads the ui:// resource in a
  // sandboxed webview. The tool result's structuredContent feeds the panel.
  server.registerResource('agentcorp-console', APP_URI, {
    title: 'AgentCorp Console',
    description: 'Embedded collaboration console for the agent-link hub.',
    mimeType: APP_MIME,
    _meta: APP_RESOURCE_META,
  }, async () => ({
    contents: [{
      uri: APP_URI,
      mimeType: APP_MIME,
      text: buildConsoleHtml(),
      _meta: APP_RESOURCE_META,
    }],
  }));
  server.registerTool(APP_TOOL, {
    title: 'Open AgentCorp Console',
    description: 'Open the embedded AgentCorp console inside this chat to see goals, agent online status, tasks and activity, and make CEO decisions — without leaving the conversation.',
    inputSchema: {},
    _meta: APP_TOOL_META,
  }, async () => {
    const data = a.dashboard();
    return {
      content: [{ type: 'text', text: 'AgentCorp 控制台已打开。' }],
      structuredContent: data,
    };
  });

  // ---- info / goal ----
  server.tool('org_info', 'Identify yourself and inspect the collaboration bus.', {}, async () => call(a.orgInfo));
  server.tool('org_goal', 'CEO sets or updates the company goal.', {
    title: z.string(), direction: z.string(), constraints: z.string().optional(),
  }, async (args) => call(a.orgGoal, args));

  // ---- PM ----
  server.tool('task_plan', 'PM decomposes the goal into structured task cards.', {
    tasks: z.array(z.object({
      type: z.enum(['plan', 'code', 'review', 'test', 'fix']),
      title: z.string(), spec: z.string(),
      files: z.array(z.string()).optional(), dependsOn: z.array(z.string()).optional(),
      priority: z.enum(['low', 'normal', 'high']).optional(),
    })),
  }, async (args) => call(a.taskPlan, args));
  server.tool('task_route', 'Ask the PM router which AI should take a task, and check conflicts.', {
    taskId: z.string().optional(), type: z.enum(['plan', 'code', 'review', 'test', 'fix']).optional(),
  }, async (args) => call(a.taskRoute, args));
  server.tool('task_assign', 'PM assigns a task to a specific agent.', {
    taskId: z.string(), agent, force: z.boolean().optional(),
  }, async (args) => call(a.taskAssign, args));

  // ---- worker ----
  server.tool('task_list', 'List lightweight task cards (summary only).', {
    agent, status: z.enum(['inbox', 'assigned', 'doing', 'review', 'rejected', 'done', 'escalated']).optional(),
  }, async (args) => call(a.taskList, args));
  server.tool('task_get', 'Pull the full task card on demand.', { taskId: z.string() }, async (args) => call(a.taskGet, args));
  server.tool('task_claim', 'Worker claims a task and starts it.', {
    taskId: z.string(), agent,
  }, async (args) => call(a.taskClaim, args));
  server.tool('task_submit', 'Worker submits a finished task with summary and artifacts.', {
    taskId: z.string(), agent, summary: z.string(),
    artifacts: z.array(z.object({
      path: z.string(), kind: z.enum(['code', 'doc', 'test', 'config', 'other']).optional(), note: z.string().optional(),
    })).optional(),
  }, async (args) => call(a.taskSubmit, args));

  // ---- reviewer ----
  server.tool('task_list_review', 'List tasks waiting for review.', { reviewer: agent.optional() }, async (args) => call(a.taskListReview, args));
  server.tool('review_submit', 'Accept or reject; reject sends the task back to the coder.', {
    taskId: z.string(), reviewer: agent, verdict: z.enum(['pass', 'fail']), comments: z.string(),
  }, async (args) => call(a.reviewSubmit, args));

  // ---- escalation ----
  server.tool('org_escalate', 'Escalate a task to the CEO.', {
    taskId: z.string(), reason: z.string(), options: z.array(z.string()).optional(),
  }, async (args) => call(a.orgEscalate, args));
  server.tool('org_decide', 'CEO resolves an escalated task.', {
    taskId: z.string(), decision: z.enum(['assign', 'rework', 'drop']), agent: agent.optional(), note: z.string().optional(),
  }, async (args) => call(a.orgDecide, args));

  // ---- presence / roster ----
  server.tool('agent_hello', 'Announce yourself as online (call on startup, then any tool call keeps you online).', {
    agent, role: z.enum(['ceo', 'pm', 'coder', 'reviewer', 'tester']).optional(),
  }, async (args) => call(() => ({ announced: true, roster: a.agentRoster() }), args));
  server.tool('agent_roster', 'Which AIs are installed and which are online right now.', {}, async () => call(a.agentRoster));

  // ---- shared hub (one folder per agent, all files mutually accessible) ----
  server.tool('hub_init', 'Create the shared agent-link hub on the next drive after C:, with a subfolder per agent and a git repo.', {
    root: z.string().optional(),
  }, async (args) => call(a.hubInit, args));
  server.tool('hub_info', 'Show the shared hub root and layout.', {}, async () => call(a.hubInfo));
  server.tool('hub_files', 'List files in any agent workspace (or the whole hub). All agents share this root.', {
    agent, depth: z.number().optional(), content: z.boolean().optional(),
  }, async (args) => call(a.hubFiles, args));
  server.tool('hub_file_read', 'Read any file in the shared hub on demand.', {
    file: z.string(), maxBytes: z.number().optional(),
  }, async (args) => call(a.hubFileRead, args));
  server.tool('hub_file_write', 'Write a file anywhere in the shared hub (path limited to hub root).', {
    file: z.string(), content: z.string(), agent: agent.optional(),
  }, async (args) => call(a.hubFileWrite, args));
  server.tool('worklog_add', 'Append a timestamped work note to the shared worklog.', {
    agent: agent.optional(), text: z.string(), file: z.string().optional(),
  }, async (args) => call(a.worklogAdd, args));
  server.tool('repo_info', 'Show git status/branch/remote of the shared hub.', {}, async () => call(a.repoInfo));
  server.tool('repo_save', 'Commit all shared-hub changes (worklog and important files) to git.', {
    message: z.string().optional(),
  }, async (args) => call(a.repoSave, args));
  server.tool('repo_history', 'Show recent git commits in the shared hub.', {
    limit: z.number().optional(),
  }, async (args) => call(a.repoHistory, args));
  server.tool('repo_remote_set', 'Set the GitHub remote URL for the shared hub.', {
    url: z.string(),
  }, async (args) => call(a.repoRemoteSet, args));
  server.tool('repo_sync', 'Commit and push the shared hub to GitHub.', {
    message: z.string().optional(),
  }, async (args) => call(a.repoPush, args));
  server.tool('agent_doctor', 'Diagnose why agents cannot see each other (workspace drift, not installed).', {}, async () => call(a.doctor));
  server.tool('workspace_align', 'Point every installed agent at one shared workspace so heartbeats meet.', {
    workspace: z.string().optional(),
  }, async (args) => call(a.workspaceAlign, args));

  // ---- observability ----
  server.tool('org_status', 'Company-wide status snapshot.', {}, async () => call(a.orgStatus));
  server.tool('org_events', 'Poll the activity feed.', {
    afterSeq: z.number().optional(), limit: z.number().optional(),
  }, async (args) => call(a.orgEvents, args));
  server.tool('workspace_scan', 'Scan shared workspace (metadata only).', {
    depth: z.number().optional(),
  }, async (args) => call(a.workspaceScan, args));
  server.tool('dashboard_data', 'Get aggregated dashboard payload (tasks, agents, artifacts, events).', {}, async () => call(a.dashboard));
  server.tool('file_content', 'Read a file in the shared workspace on demand (bounded).', {
    path: z.string(), maxBytes: z.number().optional(),
  }, async (args) => call(a.fileContent, args));
  server.tool('git_diff', 'Get git diff for the shared workspace.', { path: z.string().optional() }, async (args) => call(a.gitDiff, args));

  // ---- locks / messages ----
  server.tool('file_lock', 'Acquire a file lock before editing.', { path: z.string(), agent }, async (args) => call(a.fileLock, args));
  server.tool('file_unlock', 'Release a file lock you hold.', { path: z.string(), agent }, async (args) => call(a.fileUnlock, args));
  server.tool('agent_message', 'Send a direct instruction to another agent. Set wake=true to also nudge its window.', {
    from: z.enum(['workbuddy', 'dsh', 'zcode', 'antigravity', 'ceo']),
    to: agent, message: z.string(), taskId: z.string().optional(), wake: z.boolean().optional(),
  }, async (args) => call(a.agentMessage, args));

  // ---- wake / balance / context ----
  server.tool('agent_wake', 'Wake a target AI: queue a wake ticket in its shared inbox and try to bring its window forward.', {
    agent, taskId: z.string().optional(), message: z.string().optional(),
    from: z.enum(['workbuddy', 'dsh', 'zcode', 'antigravity', 'ceo']).optional(),
    launch: z.boolean().optional(),
  }, async (args) => call(a.agentWake, args));
  server.tool('agent_wake_offline', 'Wake every AI that is currently offline (best effort).', {
    message: z.string().optional(),
    from: z.enum(['workbuddy', 'dsh', 'zcode', 'antigravity', 'ceo']).optional(),
    launch: z.boolean().optional(),
  }, async (args) => call(a.wakeAllOffline, args));
  server.tool('balance_query', 'Query AI balance/quota. DSH reads a local cache; others report status and next step. No secrets are read or printed.', {
    agent: agent.optional(),
  }, async (args) => call(a.balance, args));
  server.tool('context_prepare', 'Get a compact context summary plus exact compact/new-chat actions per host.', {
    host: z.enum(['workbuddy', 'antigravity', 'zcode']).optional(),
  }, async (args) => call(a.contextPrepare, args));

  // ---- web dashboard ----
  server.tool('dashboard_open', 'Start (or get the URL of) the web dashboard.', {
    port: z.number().optional(),
  }, async ({ port }) => {
    const mod = await import('./web.js');
    const info = mod.ensureDashboard(port || 7788);
    return call(() => info);
  });
  server.tool('dashboard_float', 'Open a draggable always-on-top mini dashboard over the agent UI.', {
    port: z.number().optional(),
  }, async ({ port }) => {
    const mod = await import('./floating.js');
    return call(() => mod.openFloatingDashboard({ port: port || 7788 }));
  });
  server.tool('dashboard_native', 'Open the native Windows desktop widget (no browser, always-on-top, draggable).', {}, async () => {
    const mod = await import('./native-ui.js');
    const hub = await import('./workspace-hub.js');
    return call(() => mod.openNativeDashboard({
      workspace: process.env.AGENTCORP_WORKSPACE || hub.pickHubRoot(),
    }));
  });

  // ---- updates / plugins ----
  server.tool('update_check', 'Check GitHub for a newer AgentCorp version.', {}, async () => {
    const r = await checkForUpdates();
    return call(() => ({ ...r, knownUpdate: latestUpdate }));
  });
  server.tool('update_apply', 'Apply the core update (git pull). Requires git checkout.', {}, async () => {
    const r = applyUpdate();
    store.emit('update_applied', { ok: r.ok, restartNeeded: !!r.restartNeeded }, 'updater');
    return call(() => r);
  });
  server.tool('plugin_status', 'Show install/registration status of each adapter plugin.', {}, async () => call(() => ({ plugins: pluginStatus(WS) })));
  server.tool('plugin_update', 'Hot-update one adapter plugin config (no restart needed).', {
    plugin: z.enum(['workbuddy', 'dsh', 'zcode', 'antigravity', 'all']),
  }, async ({ plugin }) => {
    const targets = plugin === 'all' ? Object.keys(AGENTS) : [plugin];
    const results = targets.map(id => updatePlugin(id, WS));
    store.emit('plugin_updated', { targets, results: results.map(r => ({ plugin: r.plugin, ok: r.ok })) }, 'ceo');
    return call(() => ({ results }));
  });

  return server;
}
