// AgentCorp shared constants and data shapes.

export const VERSION = '0.2.0';

export const ROLES = {
  CEO: 'ceo',
  PM: 'pm',
  CODER: 'coder',
  REVIEWER: 'reviewer',
  TESTER: 'tester',
};

export const TASK_STATUS = {
  INBOX: 'inbox',       // created, not yet picked up
  ASSIGNED: 'assigned', // routed to an agent
  DOING: 'doing',       // agent is working
  REVIEW: 'review',     // submitted, awaiting review
  REJECTED: 'rejected', // review failed, sent back to coder
  DONE: 'done',         // accepted
  ESCALATED: 'escalated', // conflict, needs CEO decision
};

export const TASK_TYPE = {
  PLAN: 'plan',
  CODE: 'code',
  REVIEW: 'review',
  TEST: 'test',
  FIX: 'fix',
};

export const AGENTS = {
  workbuddy: { id: 'workbuddy', name: 'WorkBuddy', transport: 'stdio', can: ['plan', 'code', 'review', 'test'] },
  dsh: { id: 'dsh', name: 'DeepSeek Harness', transport: 'stdio|acp', can: ['code', 'review', 'test', 'fix'] },
  zcode: { id: 'zcode', name: 'ZCode', transport: 'stdio', can: ['plan', 'code', 'review', 'test'] },
  antigravity: { id: 'antigravity', name: 'Google Antigravity', transport: 'stdio', can: ['plan', 'code', 'review', 'test'] },
};

export const ROLE_REVIEW_STAGES = [ROLES.REVIEWER, ROLES.TESTER];

// An agent is considered "online" if it has been seen within this window.
// Tool calls refresh the heartbeat (throttled), so active agents stay online.
export const PRESENCE_TTL_MS = 2 * 60 * 1000;

export function defaultState() {
  return {
    version: VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    workspace: null,
    goal: null,
    tasks: {},
    events: [],
    locks: {},
    presence: {},   // agentId -> { role, firstSeen, lastSeen }
    seq: 0,
    stats: { tasksCreated: 0, tasksDone: 0, reworkCycles: 0, escalations: 0 },
  };
}

export function newId(prefix = 'id') {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${ts}${rnd}`;
}

export function now() {
  return new Date().toISOString();
}
