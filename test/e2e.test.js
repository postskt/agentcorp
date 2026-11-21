import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { createTask, taskSummary } from '../src/tasks.js';
import { suggestAssignee, detectConflicts, routingAdvice } from '../src/router.js';
import { TASK_STATUS, TASK_TYPE } from '../src/constants.js';

function tmpStore() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'agentcorp-'));
  return { ws, store: new Store(ws) };
}

test('store persists goal and emits monotonic events', () => {
  const { store } = tmpStore();
  store.update(s => { s.goal = { title: 'Build feature X' }; });
  const e1 = store.emit('goal_set', { title: 'Build feature X' }, 'ceo');
  const e2 = store.emit('task_created', { id: 't1' }, 'pm');
  assert.equal(e2.seq, e1.seq + 1);
  const events = store.readEvents(0);
  assert.equal(events.length, 2);
  assert.equal(store.readState().goal.title, 'Build feature X');
});

test('file lock prevents conflicting owners', () => {
  const { store } = tmpStore();
  const first = store.acquireLock('src/app.js', 'dsh');
  assert.equal(first.ok, true);
  const second = store.acquireLock('src/app.js', 'zcode');
  assert.equal(second.ok, false);
  assert.equal(second.lockedBy, 'dsh');
  const released = store.releaseLock('src/app.js', 'dsh');
  assert.equal(released.ok, true);
  assert.equal(store.acquireLock('src/app.js', 'zcode').ok, true);
});

test('rework loop: rejected task goes back to coder with incremented revision', () => {
  const { store } = tmpStore();
  const t = createTask({
    type: TASK_TYPE.CODE,
    title: 'Implement login',
    spec: 'Login form works',
    files: ['src/login.js'],
  });
  t.assignee = 'dsh';
  t.status = TASK_STATUS.DOING;
  store.update(s => { s.tasks[t.id] = t; });

  // submit -> review
  store.update(s => { s.tasks[t.id].status = TASK_STATUS.REVIEW; });
  assert.equal(store.readState().tasks[t.id].status, TASK_STATUS.REVIEW);

  // fail -> rejected + revision++
  store.update(s => {
    const c = s.tasks[t.id];
    c.status = TASK_STATUS.REJECTED;
    c.review = { verdict: 'fail', comments: 'missing validation', reviewer: 'workbuddy' };
    c.revision++;
  });
  const after = store.readState().tasks[t.id];
  assert.equal(after.status, TASK_STATUS.REJECTED);
  assert.equal(after.revision, 1);
  assert.equal(after.review.comments, 'missing validation');

  // re-claim and pass
  store.update(s => { s.tasks[t.id].status = TASK_STATUS.DOING; });
  store.update(s => {
    const c = s.tasks[t.id];
    c.status = TASK_STATUS.DONE;
    c.review = { verdict: 'pass', reviewer: 'workbuddy' };
  });
  assert.equal(store.readState().tasks[t.id].status, TASK_STATUS.DONE);
});

test('router picks capable agent and detects file conflicts', () => {
  const { store } = tmpStore();
  const a = createTask({ type: TASK_TYPE.CODE, title: 'A', spec: 'a', files: ['shared.js'] });
  a.assignee = 'dsh'; a.status = TASK_STATUS.DOING;
  const b = createTask({ type: TASK_TYPE.CODE, title: 'B', spec: 'b', files: ['shared.js'] });
  b.assignee = 'zcode'; b.status = TASK_STATUS.ASSIGNED;
  store.update(s => { s.tasks[a.id] = a; s.tasks[b.id] = b; });

  const conflicts = detectConflicts(store.readState());
  assert.ok(conflicts.some(c => c.file === 'shared.js'));

  const suggestion = suggestAssignee(store.readState(), createTask({ type: TASK_TYPE.TEST, title: 'T', spec: 't' }));
  assert.ok(['dsh', 'zcode', 'workbuddy', 'antigravity'].includes(suggestion));
  const advice = routingAdvice(store.readState(), a);
  assert.ok(advice.conflicts.length >= 1);
});

test('lightweight summary hides result payload', () => {
  const t = createTask({ type: TASK_TYPE.CODE, title: 'X', spec: 'do x' });
  t.result = { summary: 'huge data', artifacts: [] };
  const s = taskSummary(t);
  assert.equal(s.result, undefined);
  assert.equal(s.spec, 'do x');
});
