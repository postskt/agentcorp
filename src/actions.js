// Shared business actions. Both the MCP server and the web dashboard call these,
// so there is a single source of truth for workflow logic.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTask, taskSummary, findTasks } from './tasks.js';
import { routingAdvice, suggestAssignee, detectConflicts } from './router.js';
import { TASK_STATUS, TASK_TYPE, AGENTS, VERSION, PRESENCE_TTL_MS, now } from './constants.js';
import { pluginStatus } from './updater.js';

const err = (message) => ({ error: message });

export function createActions(store, workspace) {
  // ---- presence: which AIs are actually installed and online ----
  // Two independent signals, because "installed" != "running right now":
  //   installed = the platform's MCP config has an agentcorp entry
  //   online    = the agent called a tool within PRESENCE_TTL_MS
  function touchPresence(agentId, role) {
    if (!agentId || !AGENTS[agentId]) return null;
    return store.update(s => {
      s.presence = s.presence || {};
      const prev = s.presence[agentId] || {};
      const wasOffline = !prev.lastSeen || (Date.now() - Date.parse(prev.lastSeen)) > PRESENCE_TTL_MS;
      const rec = {
        role: role || prev.role || null,
        firstSeen: prev.firstSeen || now(),
        lastSeen: now(),
        calls: (prev.calls || 0) + 1,
      };
      s.presence[agentId] = rec;
      if (wasOffline) store.emit('agent_online', { agent: agentId, role: rec.role }, agentId);
      return rec;
    });
  }

  function agentRoster() {
    const s = store.readState();
    const install = {};
    for (const p of pluginStatus(workspace)) install[p.id] = p;
    const tasks = Object.values(s.tasks);
    const ts = Date.now();
    const agents = Object.keys(AGENTS).map(id => {
      const p = (s.presence || {})[id] || {};
      const age = p.lastSeen ? ts - Date.parse(p.lastSeen) : null;
      const online = age !== null && age <= PRESENCE_TTL_MS;
      return {
        id, name: AGENTS[id].name, can: AGENTS[id].can,
        role: p.role || null,
        installed: !!(install[id]?.agentcorpRegistered),
        configPath: install[id]?.configPath || null,
        online,
        lastSeen: p.lastSeen || null,
        firstSeen: p.firstSeen || null,
        calls: p.calls || 0,
        activeTasks: tasks.filter(t => t.assignee === id &&
          [TASK_STATUS.ASSIGNED, TASK_STATUS.DOING].includes(t.status)).length,
      };
    });
    return {
      agents,
      onlineCount: agents.filter(a => a.online).length,
      installedCount: agents.filter(a => a.installed).length,
      ttlMs: PRESENCE_TTL_MS,
      note: 'online = called a tool recently; installed = MCP config entry present',
    };
  }

  function orgInfo() {
    const s = store.readState();
    return {
      product: 'AgentCorp', version: VERSION, workspace,
      connectedAgents: AGENTS,
      roster: agentRoster(),
      goal: s.goal, stats: s.stats,
      howto: [
        'CEO: org_goal -> org_status',
        'PM: task_plan -> task_route -> task_assign',
        'Worker: task_list -> task_get -> task_claim -> task_submit',
        'Reviewer: task_list_review -> review_submit (reject sends back to coder)',
        'Anyone: org_events (activity feed) / org_status (company state)',
      ],
    };
  }

  function orgGoal({ title, direction, constraints }) {
    const goal = store.update(s => {
      s.goal = { title, direction, constraints: constraints || '', setBy: 'ceo', at: new Date().toISOString() };
      return s.goal;
    });
    store.emit('goal_set', { title, direction }, 'ceo');
    return { goal, message: 'Goal recorded. PM should now call task_plan to decompose it.' };
  }

  function taskPlan({ tasks }) {
    const created = store.update(s => {
      const out = [];
      for (const t of tasks) {
        const card = createTask({
          goalId: s.goal?.title || null, type: t.type, title: t.title, spec: t.spec,
          files: t.files || [], dependsOn: t.dependsOn || [], priority: t.priority || 'normal',
        });
        s.tasks[card.id] = card;
        s.stats.tasksCreated++;
        out.push(card);
      }
      return out;
    });
    for (const t of created) store.emit('task_created', { id: t.id, type: t.type, title: t.title }, 'pm');
    return { created: created.map(taskSummary), message: 'Next: task_route for each, then task_assign.' };
  }

  function taskRoute({ taskId, type }) {
    const s = store.readState();
    const task = taskId ? s.tasks[taskId] : null;
    if (taskId && !task) return err(`Task ${taskId} not found.`);
    const probe = task || { id: '(hypothetical)', type: type || 'code', files: [] };
    return routingAdvice(s, probe);
  }

  function taskAssign({ taskId, agent, force }) {
    const s = store.readState();
    const task = s.tasks[taskId];
    if (!task) return err(`Task ${taskId} not found.`);
    const conflicts = detectConflicts(s).filter(c => c.assignments.some(a => a.taskId === taskId));
    if (conflicts.length && !force) {
      return {
        blocked: true,
        reason: 'Assigning this agent would create a file conflict.',
        conflicts,
        suggestion: 'Pick a different agent, restructure the tasks, or escalate to CEO via org_escalate.',
      };
    }
    store.update(st => {
      const t = st.tasks[taskId];
      t.assignee = agent; t.status = TASK_STATUS.ASSIGNED; t.updatedAt = new Date().toISOString();
    });
    store.emit('task_assigned', { taskId, agent, forced: !!force }, 'pm');
    return { taskId, agent, conflicts: conflicts.length, message: `Task assigned to ${AGENTS[agent].name}.` };
  }

  function taskList({ agent, status }) {
    const s = store.readState();
    const tasks = findTasks(s, { status }).filter(t => !t.assignee || t.assignee === agent);
    return { count: tasks.length, tasks: tasks.map(taskSummary) };
  }

  function taskGet({ taskId }) {
    const s = store.readState();
    const t = s.tasks[taskId];
    if (!t) return err(`Task ${taskId} not found.`);
    return t;
  }

  function taskClaim({ taskId, agent }) {
    const s = store.readState();
    const t = s.tasks[taskId];
    if (!t) return err(`Task ${taskId} not found.`);
    if (t.assignee && t.assignee !== agent) return err(`Task is assigned to ${t.assignee}, not ${agent}.`);
    if (![TASK_STATUS.ASSIGNED, TASK_STATUS.REJECTED, TASK_STATUS.ESCALATED].includes(t.status)) {
      return err(`Task is in status ${t.status}; cannot claim.`);
    }
    store.update(st => {
      const card = st.tasks[taskId];
      card.assignee = agent; card.status = TASK_STATUS.DOING; card.updatedAt = new Date().toISOString();
    });
    store.emit('task_started', { taskId, agent, revision: t.revision }, agent);
    return { taskId, status: TASK_STATUS.DOING, spec: t.spec, message: 'Task claimed. Work in the shared workspace.' };
  }

  function taskSubmit({ taskId, agent, summary, artifacts }) {
    const s = store.readState();
    const t = s.tasks[taskId];
    if (!t) return err(`Task ${taskId} not found.`);
    if (t.status !== TASK_STATUS.DOING) return err(`Task is in status ${t.status}; expected doing.`);
    store.update(st => {
      const card = st.tasks[taskId];
      card.status = TASK_STATUS.REVIEW;
      card.result = { summary, artifacts: artifacts || [], at: new Date().toISOString() };
      card.updatedAt = new Date().toISOString();
    });
    store.emit('task_submitted', { taskId, agent, summary, artifacts: artifacts || [] }, agent);
    return { taskId, status: TASK_STATUS.REVIEW, message: 'Submitted. Reviewer will check; rejection sends it back to you.' };
  }

  function taskListReview({ reviewer }) {
    const s = store.readState();
    return findTasks(s, { status: TASK_STATUS.REVIEW }).reduce((acc, t) => {
      acc.count++; acc.tasks.push(taskSummary(t)); return acc;
    }, { count: 0, tasks: [] });
  }

  function reviewSubmit({ taskId, reviewer, verdict, comments }) {
    const s = store.readState();
    const t = s.tasks[taskId];
    if (!t) return err(`Task ${taskId} not found.`);
    if (t.status !== TASK_STATUS.REVIEW) return err(`Task is in status ${t.status}; expected review.`);
    const nextStatus = verdict === 'pass' ? TASK_STATUS.DONE : TASK_STATUS.REJECTED;
    store.update(st => {
      const card = st.tasks[taskId];
      card.review = { verdict, reviewer, comments, at: new Date().toISOString() };
      card.status = nextStatus;
      if (verdict === 'fail') { card.revision++; st.stats.reworkCycles++; }
      else st.stats.tasksDone++;
      card.updatedAt = new Date().toISOString();
    });
    store.emit(verdict === 'pass' ? 'review_passed' : 'review_rejected',
      { taskId, reviewer, comments, revision: t.revision + (verdict === 'fail' ? 1 : 0) }, reviewer);
    return {
      taskId, status: nextStatus,
      message: verdict === 'pass' ? 'Accepted. Task done.'
        : `Rejected and sent back to ${t.assignee || 'coder'} for rework (revision ${t.revision + 1}).`,
    };
  }

  function orgEscalate({ taskId, reason, options }) {
    const s = store.readState();
    if (!s.tasks[taskId]) return err(`Task ${taskId} not found.`);
    store.update(st => {
      st.tasks[taskId].status = TASK_STATUS.ESCALATED;
      st.tasks[taskId].updatedAt = new Date().toISOString();
      st.stats.escalations++;
    });
    store.emit('escalated', { taskId, reason, options: options || [] }, 'system');
    return { taskId, status: TASK_STATUS.ESCALATED, message: 'Escalated to CEO. Awaiting org_decide.' };
  }

  function orgDecide({ taskId, decision, agent, note }) {
    const s = store.readState();
    const t = s.tasks[taskId];
    if (!t) return err(`Task ${taskId} not found.`);
    let status = TASK_STATUS.DOING;
    if (decision === 'rework') status = TASK_STATUS.REJECTED;
    if (decision === 'drop') status = TASK_STATUS.DONE;
    store.update(st => {
      const card = st.tasks[taskId];
      card.status = status;
      if (agent) card.assignee = agent;
      if (note) card.review = { ...(card.review || {}), ceoNote: note, at: new Date().toISOString() };
      card.updatedAt = new Date().toISOString();
    });
    store.emit('ceo_decision', { taskId, decision, agent: agent || null, note: note || '' }, 'ceo');
    return { taskId, status, message: 'CEO decision applied.' };
  }

  function orgStatus() {
    const s = store.readState();
    const tasks = Object.values(s.tasks);
    const byStatus = {}, byAgent = {};
    for (const t of tasks) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    for (const t of tasks) {
      if (t.assignee && [TASK_STATUS.ASSIGNED, TASK_STATUS.DOING].includes(t.status)) {
        byAgent[t.assignee] = (byAgent[t.assignee] || 0) + 1;
      }
    }
    return {
      goal: s.goal, totalTasks: tasks.length, byStatus, activeWorkByAgent: byAgent,
      roster: agentRoster(),
      conflicts: detectConflicts(s), locks: store.listLocks(), stats: s.stats,
      recentEvents: store.tailEvents(8).map(e => ({ seq: e.seq, type: e.type, actor: e.actor, ts: e.ts })),
    };
  }

  function orgEvents({ afterSeq, limit }) {
    const events = store.readEvents(afterSeq || 0, limit || 100);
    const latest = events.length ? events[events.length - 1].seq : (store.tailEvents(1)[0]?.seq || 0);
    return { latestSeq: latest, count: events.length, events };
  }

  function workspaceScan({ depth }) {
    const maxDepth = depth || 2;
    const out = [];
    function walk(dir, d, rel) {
      if (d > maxDepth) return;
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const full = path.join(dir, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          const isRepo = fs.existsSync(path.join(full, '.git'));
          out.push({ path: r, kind: isRepo ? 'repo' : 'dir' });
          walk(full, d + 1, r);
        } else {
          let mtime, size;
          try { const st = fs.statSync(full); mtime = st.mtime.toISOString(); size = st.size; } catch {}
          out.push({ path: r, kind: 'file', mtime, size });
        }
      }
    }
    walk(workspace, 0, '');
    return { workspace, entries: out.slice(0, 300), message: 'Metadata only — no file contents loaded.' };
  }

  function fileLock({ path: p, agent }) { return store.acquireLock(p, agent); }
  function fileUnlock({ path: p, agent }) { return store.releaseLock(p, agent); }

  function agentMessage({ from, to, message, taskId }) {
    store.emit('message', { from, to, message, taskId: taskId || null }, from);
    return { delivered: true, to, message, note: 'Visible via org_events filtered by recipient.' };
  }

  // Aggregated dashboard payload for the web UI.
  function dashboard() {
    const s = store.readState();
    const tasks = Object.values(s.tasks);
    const columns = { inbox: [], assigned: [], doing: [], review: [], rejected: [], done: [], escalated: [] };
    for (const t of tasks) {
      (columns[t.status] || (columns[t.status] = [])).push(taskSummary(t));
    }
    const roster = agentRoster();
    const perAgent = {};
    for (const a of roster.agents) {
      const id = a.id;
      perAgent[id] = {
        name: a.name, can: a.can, online: a.online, installed: a.installed,
        lastSeen: a.lastSeen, calls: a.calls,
        doing: tasks.filter(t => t.assignee === id && t.status === 'doing').map(taskSummary),
        queued: tasks.filter(t => t.assignee === id && t.status === 'assigned').map(taskSummary),
      };
    }
    const artifacts = [];
    for (const t of tasks) {
      for (const a of (t.result?.artifacts || [])) {
        artifacts.push({ ...a, taskId: t.id, taskTitle: t.title, author: t.assignee, review: t.review?.verdict || 'pending' });
      }
    }
    return {
      goal: s.goal, stats: s.stats, columns, perAgent, roster,
      conflicts: detectConflicts(s), locks: store.listLocks(),
      events: store.tailEvents(120), artifacts,
      latestSeq: store.tailEvents(1)[0]?.seq || 0,
    };
  }

  function fileContent({ path: relPath, maxBytes }) {
    const full = path.resolve(workspace, relPath);
    if (!full.startsWith(path.resolve(workspace))) return err('Path escapes workspace.');
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) return err('Not a file.');
      const limit = maxBytes || 200000;
      const content = st.size > limit
        ? fs.readFileSync(full, 'utf8').slice(0, limit) + '\n... (truncated)'
        : fs.readFileSync(full, 'utf8');
      return { path: relPath, size: st.size, content };
    } catch (e) { return err(String(e.message || e)); }
  }

  function gitDiff({ path: relPath }) {
    try {
      const args = relPath ? ['diff', '--', relPath] : ['diff'];
      const out = execFileSync('git', args, { cwd: workspace, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
      return { path: relPath || '(all)', diff: out || '(no uncommitted changes)' };
    } catch (e) { return err(String(e.message || e)); }
  }

  return {
    orgInfo, orgGoal, taskPlan, taskRoute, taskAssign, taskList, taskGet, taskClaim,
    taskSubmit, taskListReview, reviewSubmit, orgEscalate, orgDecide, orgStatus,
    orgEvents, workspaceScan, fileLock, fileUnlock, agentMessage, dashboard,
    fileContent, gitDiff, touchPresence, agentRoster,
  };
}
