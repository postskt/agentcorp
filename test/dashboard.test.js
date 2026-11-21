import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { createActions } from '../src/actions.js';
import { updatePlugin, pluginStatus, localVersion } from '../src/updater.js';

function tmpStore() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-dash-'));
  return { ws, store: new Store(ws), actions: createActions(new Store(ws), ws) };
}

test('dashboard aggregates tasks per agent, artifacts and columns', () => {
  const { actions } = tmpStore();
  actions.orgGoal({ title: '目标', direction: '方向' });
  const plan = actions.taskPlan({ tasks: [
    { type: 'code', title: '写登录', spec: 'JWT', files: ['a.js'] },
  ] });
  const id = plan.created[0].id;
  actions.taskAssign({ taskId: id, agent: 'dsh' });
  actions.taskClaim({ taskId: id, agent: 'dsh' });
  actions.taskSubmit({ taskId: id, agent: 'dsh', summary: 'done', artifacts: [{ path: 'a.js', kind: 'code' }] });
  actions.reviewSubmit({ taskId: id, reviewer: 'workbuddy', verdict: 'pass', comments: 'ok' });

  const d = actions.dashboard();
  assert.equal(d.goal.title, '目标');
  assert.equal(d.columns.done.length, 1);
  assert.equal(d.artifacts.length, 1);
  assert.equal(d.artifacts[0].review, 'pass');
  assert.equal(d.stats.tasksDone, 1);
  assert.ok(d.perAgent.dsh);
  assert.ok(d.latestSeq >= 6);
});

test('CEO decision from dashboard resolves escalated task', () => {
  const { actions } = tmpStore();
  const plan = actions.taskPlan({ tasks: [{ type: 'code', title: 'T', spec: 's' }] });
  const id = plan.created[0].id;
  actions.orgEscalate({ taskId: id, reason: '冲突', options: ['A', 'B'] });
  assert.equal(actions.dashboard().columns.escalated.length, 1);
  const r = actions.orgDecide({ taskId: id, decision: 'assign', agent: 'zcode', note: 'CEO 拍板' });
  assert.equal(r.status, 'doing');
  const t = actions.taskGet({ taskId: id });
  assert.equal(t.assignee, 'zcode');
  assert.equal(t.review.ceoNote, 'CEO 拍板');
});

test('file_content is bounded and rejects path escape', () => {
  const { ws, actions } = tmpStore();
  fs.writeFileSync(path.join(ws, 'safe.txt'), 'hello');
  const ok = actions.fileContent({ path: 'safe.txt' });
  assert.equal(ok.content, 'hello');
  const bad = actions.fileContent({ path: '../../secret' });
  assert.ok(bad.error);
});

test('plugin hot-update writes agentcorp entry and preserves other servers', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-home-'));
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  try {
    fs.mkdirSync(path.join(home, '.workbuddy'), { recursive: true });
    const cfgPath = path.join(home, '.workbuddy', 'mcp.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
    const r = updatePlugin('workbuddy', '/some/ws');
    assert.equal(r.ok, true);
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    assert.equal(cfg.mcpServers.agentcorp.env.AGENTCORP_WORKSPACE, '/some/ws');
    assert.equal(cfg.mcpServers.other.command, 'x');
    const statuses = pluginStatus('/some/ws');
    assert.equal(statuses.find(s => s.id === 'workbuddy').agentcorpRegistered, true);
  } finally {
    process.env.HOME = prevHome;
  }
});

test('localVersion reads package.json', () => {
  assert.match(localVersion(), /^\d+\.\d+\.\d+$/);
});
