import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { createActions } from '../src/actions.js';

function fresh() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-presence-'));
  return { ws, store: new Store(ws), actions: createActions(new Store(ws), ws) };
}

test('agent_hello marks an agent online and records a heartbeat', () => {
  const { store, actions } = fresh();
  const a = createActions(store, '/tmp/ws');
  a.touchPresence('dsh', 'coder');
  const roster = a.agentRoster();
  const dsh = roster.agents.find(x => x.id === 'dsh');
  assert.equal(dsh.online, true);
  assert.equal(dsh.calls, 1);
  assert.equal(dsh.role, 'coder');
  assert.equal(roster.onlineCount, 1);
});

test('roster distinguishes installed from online', () => {
  const { store } = fresh();
  const a = createActions(store, '/tmp/ws');
  const roster = a.agentRoster();
  assert.equal(roster.agents.length, 4);
  assert.equal(roster.onlineCount, 0);
  for (const ag of roster.agents) assert.equal(typeof ag.installed, 'boolean');
  assert.ok(roster.ttlMs > 0);
});

test('every tool call carrying an agent refreshes its heartbeat', () => {
  const { store } = fresh();
  const a = createActions(store, '/tmp/ws');
  a.touchPresence('zcode', 'coder');
  a.touchPresence('zcode', 'coder');
  const z = a.agentRoster().agents.find(x => x.id === 'zcode');
  assert.equal(z.calls, 2);
  assert.equal(z.online, true);
});

test('orgInfo and dashboard both expose roster', () => {
  const { store } = fresh();
  const a = createActions(store, '/tmp/ws');
  assert.ok(a.orgInfo().roster);
  assert.ok(a.dashboard().roster);
  assert.ok(a.orgStatus().roster);
});
