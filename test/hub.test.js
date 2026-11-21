import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initHub, hubTree, hubRead, hubWrite, worklogWrite, repoStatus, repoCommit } from '../src/workspace-hub.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-hub-'));
const root = path.join(tmp, 'agent-link');

test('initHub lays out one folder per agent plus common dirs and git', () => {
  const r = initHub(root);
  for (const d of ['workbuddy','dsh','zcode','antigravity','inbox','worklog','shared','.agentcorp']) {
    assert.ok(fs.existsSync(path.join(root, d)), `missing ${d}`);
  }
  assert.ok(fs.existsSync(path.join(root, '.gitignore')));
  assert.ok(fs.existsSync(path.join(root, 'README.md')));
  assert.equal(r.dirs.length, 7);
});

test('any agent can write and read any other agent file', () => {
  const w = hubWrite({ root, file: 'dsh/notes.txt', content: 'from workbuddy', agent: 'workbuddy' });
  assert.equal(w.ok, true);
  const r = hubRead({ root, file: 'dsh/notes.txt' });
  assert.equal(r.content, 'from workbuddy');
});

test('path traversal outside hub is refused', () => {
  const r = hubWrite({ root, file: '../escape.txt', content: 'x' });
  assert.ok(r.error);
  assert.match(r.error, /escapes hub/);
});

test('hubTree lists files across agents', () => {
  hubWrite({ root, file: 'zcode/code.js', content: 'console.log(1)' });
  const t = hubTree({ root, agent: 'zcode' });
  assert.ok(t.entries.some(e => e.path === 'code.js'));
});

test('worklog appends dated notes', () => {
  const r = worklogWrite({ root, agent: 'dsh', text: 'did work' });
  assert.equal(r.ok, true);
  assert.match(r.path, /worklog\/\d{4}-\d{2}-\d{2}\.md/);
  const content = hubRead({ root, file: r.path }).content;
  assert.match(content, /dsh/);
  assert.match(content, /did work/);
});

test('git repo commits hub changes', () => {
  const st = repoStatus({ root });
  assert.equal(st.root, root);
  const c = repoCommit({ root, message: 'test snapshot' });
  assert.equal(c.ok, true);
});
