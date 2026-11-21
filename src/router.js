// Dynamic routing: a single command asks the PM to decide which AI executes.
// This pre-empts file conflicts by assigning one owner per task, before coding starts.
import { AGENTS, TASK_TYPE, TASK_STATUS } from './constants.js';

// Capabilities per task type — used by the PM heuristic and exposed to the PM agent.
const TYPE_PREFERENCE = {
  [TASK_TYPE.PLAN]: ['workbuddy', 'zcode', 'antigravity'],
  [TASK_TYPE.CODE]: ['dsh', 'zcode', 'workbuddy', 'antigravity'],
  [TASK_TYPE.REVIEW]: ['workbuddy', 'dsh', 'zcode', 'antigravity'],
  [TASK_TYPE.TEST]: ['dsh', 'antigravity', 'zcode', 'workbuddy'],
  [TASK_TYPE.FIX]: ['dsh', 'zcode', 'workbuddy', 'antigravity'],
};

// Workload weight: prefer the agent with fewer active tasks.
function activeLoad(state, agentId) {
  return Object.values(state.tasks).filter(
    t => t.assignee === agentId && [TASK_STATUS.ASSIGNED, TASK_STATUS.DOING].includes(t.status)
  ).length;
}

// Deterministic default router. The PM agent may override via an explicit assign command.
export function suggestAssignee(state, task) {
  const prefs = TYPE_PREFERENCE[task.type] || Object.keys(AGENTS);
  let best = null;
  let bestScore = Infinity;
  for (const id of prefs) {
    const agent = AGENTS[id];
    if (!agent) continue;
    if (!agent.can.includes(task.type)) continue;
    const load = activeLoad(state, id);
    // Lower load wins; ties broken by preference order (index).
    const score = load * 10 + prefs.indexOf(id);
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

// Detect potential file conflicts: two active tasks touching the same path.
export function detectConflicts(state) {
  const active = Object.values(state.tasks).filter(
    t => [TASK_STATUS.ASSIGNED, TASK_STATUS.DOING].includes(t.status) && t.files?.length
  );
  const byFile = new Map();
  for (const t of active) {
    for (const f of t.files) {
      if (!byFile.has(f)) byFile.set(f, []);
      byFile.get(f).push({ taskId: t.id, assignee: t.assignee });
    }
  }
  const conflicts = [];
  for (const [file, assignments] of byFile.entries()) {
    const owners = new Set(assignments.map(a => a.assignee));
    if (owners.size > 1) conflicts.push({ file, assignments });
  }
  return conflicts;
}

export function routingAdvice(state, task) {
  const suggested = suggestAssignee(state, task);
  return {
    taskId: task.id,
    taskType: task.type,
    suggested,
    reason: suggested
      ? `PM heuristic: ${AGENTS[suggested].name} supports ${task.type} and has the lowest active load.`
      : 'No capable agent found.',
    conflicts: detectConflicts(state),
    note: 'PM agent may override with assign. Real conflicts are escalated to CEO.',
  };
}
