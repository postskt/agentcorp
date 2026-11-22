// AgentCorp — native DeepSeek Harness (DSH) bundle.
//
// This is the DSH plugin entry point. It registers AgentCorp's collaboration
// tools directly into the harness tool system via `apply(ctx)`, so the plugin
// is visible in the Plugins page, has a version, and updates via the plugin
// manager. The business logic is the SAME `actions.js` core used by the MCP
// server and web dashboard — one source of truth, no separate implementation.
//
// Install (no AI / no tokens involved — the host downloads and registers it):
//   dsh plugin --profile web add github:postskt/agentcorp
// or in the DSH UI: Plugins -> Add plugin -> github:postskt/agentcorp

import { Store } from './src/store.js';
import { createActions } from './src/actions.js';
import { AGENTS, VERSION } from './src/constants.js';
import { pickHubRoot } from './src/workspace-hub.js';
import { maybeAutoOpenDashboard } from './src/autoopen.js';

export const name = 'agentcorp';

// Shared state lives in the auto-picked hub (next drive after C:, e.g. E:\agent-link),
// so every agent that installs AgentCorp reads/writes the same .agentcorp/state.json.
const WS = process.env.AGENTCORP_WORKSPACE || pickHubRoot();

let _actions = null;
function actions() {
  if (!_actions) {
    const store = new Store(WS);
    _actions = createActions(store, WS);
    store.update((s) => { s.workspace = WS; });
  }
  return _actions;
}

const AGENT_ENUM = Object.keys(AGENTS);
const ROLE_ENUM = ['ceo', 'pm', 'coder', 'reviewer', 'tester'];
const STATUS_ENUM = ['inbox', 'assigned', 'doing', 'review', 'rejected', 'done', 'escalated'];
const TYPE_ENUM = ['plan', 'code', 'review', 'test', 'fix'];

const S = (type, extra = {}) => ({ type, ...extra });
const str = () => S('string');
const num = () => S('number');
const bool = () => S('boolean');
const en = (values) => S('string', { enum: values });
const arr = (items) => S('array', { items });

// Tool contract table. Each entry: name, description, properties, required, handler.
// Parameters are plain JSON Schema (DSH native), mirroring src/server.js exactly.
const DEFS = [
  // ---- info / goal ----
  { n: 'org_info', d: 'Identify yourself and inspect the collaboration bus (goal, stats, roster).', p: {}, r: [], f: (_a, a) => a.orgInfo() },
  { n: 'org_goal', d: 'CEO sets or updates the company goal.', p: { title: str(), direction: str(), constraints: str() }, r: ['title', 'direction'], f: (x, a) => a.orgGoal(x) },

  // ---- PM ----
  { n: 'task_plan', d: 'PM decomposes the goal into structured task cards.', p: { tasks: arr(S('object', { properties: { type: en(TYPE_ENUM), title: str(), spec: str(), files: arr(str()), dependsOn: arr(str()), priority: en(['low', 'normal', 'high']) }, required: ['type', 'title', 'spec'] })) }, r: ['tasks'], f: (x, a) => a.taskPlan(x) },
  { n: 'task_route', d: 'Ask which AI should take a task, and check file conflicts.', p: { taskId: str(), type: en(TYPE_ENUM) }, r: [], f: (x, a) => a.taskRoute(x) },
  { n: 'task_assign', d: 'PM assigns a task to a specific agent.', p: { taskId: str(), agent: en(AGENT_ENUM), force: bool() }, r: ['taskId', 'agent'], f: (x, a) => a.taskAssign(x) },

  // ---- worker ----
  { n: 'task_list', d: 'List lightweight task cards (summary only).', p: { agent: en(AGENT_ENUM), status: en(STATUS_ENUM) }, r: ['agent'], f: (x, a) => a.taskList(x) },
  { n: 'task_get', d: 'Pull the full task card on demand.', p: { taskId: str() }, r: ['taskId'], f: (x, a) => a.taskGet(x) },
  { n: 'task_claim', d: 'Worker claims a task and starts it.', p: { taskId: str(), agent: en(AGENT_ENUM) }, r: ['taskId', 'agent'], f: (x, a) => a.taskClaim(x) },
  { n: 'task_submit', d: 'Worker submits a finished task with summary and artifacts.', p: { taskId: str(), agent: en(AGENT_ENUM), summary: str(), artifacts: arr(S('object', { properties: { path: str(), kind: en(['code', 'doc', 'test', 'config', 'other']), note: str() }, required: ['path'] })) }, r: ['taskId', 'agent', 'summary'], f: (x, a) => a.taskSubmit(x) },

  // ---- reviewer ----
  { n: 'task_list_review', d: 'List tasks submitted and awaiting review.', p: { reviewer: en(AGENT_ENUM) }, r: [], f: (x, a) => a.taskListReview(x) },
  { n: 'review_submit', d: 'Accept or reject; reject sends the task back to the coder.', p: { taskId: str(), reviewer: en(AGENT_ENUM), verdict: en(['pass', 'fail']), comments: str() }, r: ['taskId', 'reviewer', 'verdict', 'comments'], f: (x, a) => a.reviewSubmit(x) },

  // ---- escalation ----
  { n: 'org_escalate', d: 'Escalate a task to the CEO.', p: { taskId: str(), reason: str(), options: arr(str()) }, r: ['taskId', 'reason'], f: (x, a) => a.orgEscalate(x) },
  { n: 'org_decide', d: 'CEO resolves an escalated task.', p: { taskId: str(), decision: en(['assign', 'rework', 'drop']), agent: en(AGENT_ENUM), note: str() }, r: ['taskId', 'decision'], f: (x, a) => a.orgDecide(x) },

  // ---- presence / roster ----
  { n: 'agent_hello', d: 'Announce yourself online (call on startup; any tool call keeps you online).', p: { agent: en(AGENT_ENUM), role: en(ROLE_ENUM) }, r: ['agent'], f: (x, a) => ({ announced: !!a.touchPresence(x.agent, x.role), roster: a.agentRoster() }) },
  { n: 'agent_roster', d: 'Which AIs are installed and which are online right now.', p: {}, r: [], f: (_a, a) => a.agentRoster() },

  // ---- shared hub ----
  { n: 'hub_init', d: 'Create the shared agent-link hub (next drive after C:), one folder per agent, with git.', p: { root: str() }, r: [], f: (x, a) => a.hubInit(x) },
  { n: 'hub_info', d: 'Show the shared hub root and layout.', p: {}, r: [], f: (_a, a) => a.hubInfo() },
  { n: 'hub_files', d: 'List files in any agent workspace (all agents share one root).', p: { agent: en(AGENT_ENUM), depth: num(), content: bool() }, r: ['agent'], f: (x, a) => a.hubFiles(x) },
  { n: 'hub_file_read', d: 'Read any file in the shared hub on demand.', p: { file: str(), maxBytes: num() }, r: ['file'], f: (x, a) => a.hubFileRead(x) },
  { n: 'hub_file_write', d: 'Write a file anywhere in the shared hub (path limited to hub root).', p: { file: str(), content: str(), agent: en(AGENT_ENUM) }, r: ['file', 'content'], f: (x, a) => a.hubFileWrite(x) },
  { n: 'worklog_add', d: 'Append a timestamped work note to the shared worklog.', p: { agent: en(AGENT_ENUM), text: str(), file: str() }, r: ['text'], f: (x, a) => a.worklogAdd(x) },
  { n: 'repo_info', d: 'Show git status/branch/remote of the shared hub.', p: {}, r: [], f: (_a, a) => a.repoInfo() },
  { n: 'repo_save', d: 'Commit all shared-hub changes to git.', p: { message: str() }, r: [], f: (x, a) => a.repoSave(x) },
  { n: 'repo_history', d: 'Show recent git commits in the shared hub.', p: { limit: num() }, r: [], f: (x, a) => a.repoHistory(x) },
  { n: 'repo_remote_set', d: 'Set the GitHub remote URL for the shared hub.', p: { url: str() }, r: ['url'], f: (x, a) => a.repoRemoteSet(x) },
  { n: 'repo_sync', d: 'Commit and push the shared hub to GitHub.', p: { message: str() }, r: [], f: (x, a) => a.repoPush(x) },
  { n: 'agent_doctor', d: 'Diagnose why agents cannot see each other (workspace drift / not installed).', p: {}, r: [], f: (_a, a) => a.doctor() },
  { n: 'workspace_align', d: 'Point every installed agent at one shared workspace so heartbeats meet.', p: { workspace: str() }, r: [], f: (x, a) => a.workspaceAlign(x) },

  // ---- observability ----
  { n: 'org_status', d: 'Company-wide status snapshot.', p: {}, r: [], f: (_a, a) => a.orgStatus() },
  { n: 'org_events', d: 'Poll the activity feed.', p: { afterSeq: num(), limit: num() }, r: [], f: (x, a) => a.orgEvents(x) },
  { n: 'workspace_scan', d: 'Scan shared workspace (metadata only).', p: { depth: num() }, r: [], f: (x, a) => a.workspaceScan(x) },
  { n: 'dashboard_data', d: 'Aggregated dashboard payload (tasks, agents, artifacts, events).', p: {}, r: [], f: (_a, a) => a.dashboard() },
  { n: 'file_content', d: 'Read a file in the shared workspace on demand (bounded).', p: { path: str(), maxBytes: num() }, r: ['path'], f: (x, a) => a.fileContent(x) },
  { n: 'git_diff', d: 'Get git diff for the shared workspace.', p: { path: str() }, r: [], f: (x, a) => a.gitDiff(x) },

  // ---- locks / messages ----
  { n: 'file_lock', d: 'Acquire a file lock before editing.', p: { path: str(), agent: en(AGENT_ENUM) }, r: ['path', 'agent'], f: (x, a) => a.fileLock(x) },
  { n: 'file_unlock', d: 'Release a file lock you hold.', p: { path: str(), agent: en(AGENT_ENUM) }, r: ['path', 'agent'], f: (x, a) => a.fileUnlock(x) },
  { n: 'agent_message', d: 'Send a direct instruction to another agent.', p: { from: en([...AGENT_ENUM, 'ceo']), to: en(AGENT_ENUM), message: str(), taskId: str() }, r: ['from', 'to', 'message'], f: (x, a) => a.agentMessage(x) },

  // ---- dashboard ----
  { n: 'dashboard_open', d: 'Start (or get the URL of) the web dashboard.', p: { port: num() }, r: [], f: async (x) => {
    const mod = await import('./src/web.js');
    return mod.ensureDashboard(x.port || 7788);
  } },
  { n: 'dashboard_float', d: 'Open a draggable always-on-top mini dashboard over the agent UI.', p: { port: num() }, r: [], f: async (x) => {
    const mod = await import('./src/floating.js');
    return mod.openFloatingDashboard({ port: x.port || 7788 });
  } },
  { n: 'dashboard_native', d: 'Open the native Windows desktop widget (no browser, always-on-top, draggable).', p: {}, r: [], f: async () => {
    const mod = await import('./src/native-ui.js');
    return mod.openNativeDashboard({ workspace: WS });
  } },
];

export function apply(ctx) {
  const tools = ctx.get('tools');
  if (tools !== undefined) {
    for (const def of DEFS) {
      ctx.effect(() => tools.register({
        name: def.n,
        description: def.d,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: def.p,
          required: def.r,
        },
        async execute(args = {}) {
          // Any call carrying an agent identity doubles as an online heartbeat.
          const who = args.agent || args.reviewer || args.from;
          const a = actions();
          if (who && AGENTS[who]) a.touchPresence(who, args.role);
          try {
            const result = await def.f(args, a, ctx);
            return result && typeof result === 'object' ? result : { result };
          } catch (e) {
            return { error: String(e && e.message ? e.message : e) };
          }
        },
      }), `agentcorp: ${def.n}`);
    }
  }

  const systemPrompt = ctx.get('systemPrompt');
  if (systemPrompt !== undefined) {
    ctx.effect(() => systemPrompt.section({
      name: 'agentcorp:bus',
      order: 3102,
      text: 'AgentCorp collaboration bus is installed. Call agent_hello(agent, role) on startup to appear online. Use agent_roster to see which AIs are online. Use org_goal/task_plan/task_assign to run the CEO->PM->coder->reviewer pipeline. Call dashboard_native for the native always-on-top desktop widget (no browser), or dashboard_float for the browser fallback. Shared files live in the agent-link hub; use hub_files/hub_file_read to inspect other agents\' work, and worklog_add/repo_save to persist work. Version ' + VERSION + '.',
    }), 'agentcorp prompt section');
  }

  // First install / first run: pop the draggable floating console automatically.
  // The one-time marker lives in the shared hub, so all agents open it only once.
  void maybeAutoOpenDashboard({ workspace: WS, trigger: 'dsh-plugin' });

  return () => { /* disposer: tools registrations are disposed via ctx.effect */ };
}
