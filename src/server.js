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

const WS = process.env.AGENTCORP_WORKSPACE || process.cwd();
const store = new Store(WS);
const a = createActions(store, WS);

function call(fn, args = {}) {
  try {
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
  server.tool('agent_message', 'Send a direct instruction to another agent.', {
    from: z.enum(['workbuddy', 'dsh', 'zcode', 'antigravity', 'ceo']),
    to: agent, message: z.string(), taskId: z.string().optional(),
  }, async (args) => call(a.agentMessage, args));

  // ---- web dashboard ----
  server.tool('dashboard_open', 'Start (or get the URL of) the web dashboard.', {
    port: z.number().optional(),
  }, async ({ port }) => {
    const mod = await import('./web.js');
    const info = mod.ensureDashboard(port || 7788);
    return call(() => info);
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
