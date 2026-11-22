// Task card lifecycle: the structured "work order" agents exchange.
// Lightweight by default: summary = id/type/status/assignee + acceptance criteria only.
// Full card (with context refs) is pulled on demand -> keeps token usage low.
import { TASK_STATUS, newId, now } from './constants.js';

export function createTask({ goalId, type, title, spec, files = [], dependsOn = [], priority = 'normal', parentId = null }) {
  const id = newId('task');
  return {
    id,
    goalId: goalId || null,
    parentId,
    type,
    title,
    spec,            // acceptance criteria — the core of a lightweight task card
    files,           // file paths this task touches (for file-lock planning)
    dependsOn,
    priority,
    status: TASK_STATUS.INBOX,
    assignee: null,
    revision: 0,     // number of times rejected/sent back
    result: null,    // { summary, artifacts: [...] } filled on submit
    review: null,    // { verdict, reviewer, comments } filled on review
    createdAt: now(),
    updatedAt: now(),
  };
}

export function taskSummary(t) {
  return {
    id: t.id,
    type: t.type,
    title: t.title,
    spec: t.spec,
    status: t.status,
    assignee: t.assignee,
    revision: t.revision,
    priority: t.priority,
    files: t.files,
    dependsOn: t.dependsOn,
    createdAt: t.createdAt || null,
    updatedAt: t.updatedAt || null,
    submittedAt: t.result?.at || null,
    reviewedAt: t.review?.at || null,
  };
}

export function canTransition(from, to) {
  const allowed = {
    [TASK_STATUS.INBOX]: [TASK_STATUS.ASSIGNED],
    [TASK_STATUS.ASSIGNED]: [TASK_STATUS.DOING, TASK_STATUS.ASSIGNED],
    [TASK_STATUS.DOING]: [TASK_STATUS.REVIEW, TASK_STATUS.DOING],
    [TASK_STATUS.REVIEW]: [TASK_STATUS.DONE, TASK_STATUS.REJECTED, TASK_STATUS.ESCALATED],
    [TASK_STATUS.REJECTED]: [TASK_STATUS.DOING, TASK_STATUS.ASSIGNED],
    [TASK_STATUS.ESCALATED]: [TASK_STATUS.DOING, TASK_STATUS.REJECTED, TASK_STATUS.ASSIGNED],
    [TASK_STATUS.DONE]: [],
  };
  return (allowed[from] || []).includes(to);
}

export function allTasks(state) {
  return Object.values(state.tasks);
}

export function findTasks(state, filter = {}) {
  return allTasks(state).filter(t => {
    if (filter.status && t.status !== filter.status) return false;
    if (filter.type && t.type !== filter.type) return false;
    if (filter.assignee && t.assignee !== filter.assignee) return false;
    if (filter.goalId && t.goalId !== filter.goalId) return false;
    return true;
  });
}
