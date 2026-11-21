// Shared workspace hub: pick the next drive after C:, lay out one folder per
// agent, expose cross-agent file access, worklog and git save/upload helpers.
// Everything stays under a single shared root so every agent sees the same files.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { AGENTS } from './constants.js';

export const HUB_NAME = 'agent-link'; // English name for "agnet联动"
const SUBDIRS = ['inbox', 'worklog', 'shared']; // common areas besides per-agent dirs

// Pick the first drive letter after C: that actually exists (D, E, F...).
// On non-Windows, fall back to <home>/agent-link. Override via AGENTCORP_HUB_ROOT.
export function pickHubRoot() {
  if (process.env.AGENTCORP_HUB_ROOT) return path.resolve(process.env.AGENTCORP_HUB_ROOT);
  if (process.platform === 'win32') {
    // Try D..Z; the first existing drive root wins.
    for (let code = 'D'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code++) {
      const drive = `${String.fromCharCode(code)}:/`;
      try { if (fs.existsSync(drive)) return path.join(drive, HUB_NAME); } catch { /* skip */ }
    }
    // Fallback if no other drive: C:/agent-link
    return path.join('C:/', HUB_NAME);
  }
  return path.join(process.env.HOME || process.cwd(), HUB_NAME);
}

// Create the full layout: <root>/<agent>/ for each agent + common dirs + git repo.
export function initHub(root = pickHubRoot()) {
  const abs = path.resolve(root);
  fs.mkdirSync(abs, { recursive: true });
  const dirs = [];
  for (const id of Object.keys(AGENTS)) {
    const d = path.join(abs, id);
    fs.mkdirSync(d, { recursive: true });
    dirs.push(`${id}/`);
  }
  for (const sub of SUBDIRS) {
    const d = path.join(abs, sub);
    fs.mkdirSync(d, { recursive: true });
    dirs.push(`${sub}/`);
  }
  // .agentcorp = communication/task state (managed by Store)
  fs.mkdirSync(path.join(abs, '.agentcorp'), { recursive: true });
  // .gitignore: keep logs but ignore OS junk
  const gi = path.join(abs, '.gitignore');
  if (!fs.existsSync(gi)) {
    fs.writeFileSync(gi, ['node_modules/', '.DS_Store', 'Thumbs.db', '*.tmp', ''].join('\n'), 'utf8');
  }
  // init git repo if not present
  let gitInitialized = false;
  try {
    if (!fs.existsSync(path.join(abs, '.git'))) {
      execFileSync('git', ['init', '-q'], { cwd: abs, stdio: 'ignore' });
      gitInitialized = true;
    }
  } catch { /* git not available — non-fatal */ }
  // README describing the layout
  const readme = path.join(abs, 'README.md');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, [
      `# ${HUB_NAME}`,
      '',
      'AgentCorp 共享工作区。所有 Agent 读写同一个目录，彼此可见。',
      '',
      '- `.agentcorp/` — 通讯、任务分派、在线名单（中心状态）',
      '- `inbox/` — 待处理的新任务或文件',
      '- `shared/` — 公共文件',
      '- `worklog/` — 工作记录（按日期）',
      ...Object.keys(AGENTS).map(id => `- \`${id}/\` — ${AGENTS[id].name} 的工作目录（其他 Agent 可读）`),
      '',
      '保存与上传：让任意 Agent 调用 `repo_commit`，或运行 `node src/cli.js repo commit "说明"`。',
      '',
    ].join('\n'), 'utf8');
  }
  return { root: abs, dirs, gitInitialized, hubName: HUB_NAME };
}

// Resolve a path inside the hub and refuse traversal outside it.
function safePath(root, rel) {
  const abs = path.resolve(root, rel || '.');
  const base = path.resolve(root);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  return abs;
}

// List files under a path (metadata only by default). agent may be an id or null for whole hub.
export function hubTree({ root, agent, depth = 3, content = false } = {}) {
  const start = agent ? safePath(root, agent) : safePath(root, '.');
  if (!start) return { error: 'Path escapes hub.' };
  if (!fs.existsSync(start)) return { error: `No such directory: ${agent || '.'}` };
  const out = [];
  const base = path.resolve(root);
  function walk(dir, d, rel) {
    if (d > depth) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        out.push({ path: r, kind: 'dir' });
        walk(full, d + 1, r);
      } else {
        let size = 0, mtime = null, text;
        try { const st = fs.statSync(full); size = st.size; mtime = st.mtime.toISOString(); } catch { /* skip */ }
        const item = { path: r, kind: 'file', size, mtime };
        if (content && size <= 200000) {
          try { item.text = fs.readFileSync(full, 'utf8'); } catch { item.text = null; }
        }
        out.push(item);
      }
    }
  }
  walk(start, 0, '');
  return { root: base, agent: agent || '(all)', count: out.length, entries: out.slice(0, 500),
    note: 'All agents share this root; any agent may read any file here.' };
}

export function hubRead({ root, file, maxBytes = 200000 } = {}) {
  const abs = safePath(root, file);
  if (!abs) return { error: 'Path escapes hub.' };
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) return { error: 'Not a file.' };
    const content = st.size > maxBytes
      ? fs.readFileSync(abs, 'utf8').slice(0, maxBytes) + '\n... (truncated)'
      : fs.readFileSync(abs, 'utf8');
    return { path: file, size: st.size, content };
  } catch (e) { return { error: String(e.message || e) }; }
}

export function hubWrite({ root, file, content, agent } = {}) {
  const abs = safePath(root, file);
  if (!abs) return { error: 'Path escapes hub.' };
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content ?? '', 'utf8');
    return { ok: true, path: file, bytes: Buffer.byteLength(content ?? '', 'utf8'), agent: agent || null };
  } catch (e) { return { error: String(e.message || e) }; }
}

// Append a timestamped note to worklog/YYYY-MM-DD.md (or a custom file).
export function worklogWrite({ root, agent = 'system', text, file } = {}) {
  const day = new Date().toISOString().slice(0, 10);
  const rel = file || `worklog/${day}.md`;
  const abs = safePath(root, rel);
  if (!abs) return { error: 'Path escapes hub.' };
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const line = `\n## ${new Date().toISOString()} — ${agent}\n\n${text || ''}\n`;
    fs.appendFileSync(abs, line, 'utf8');
    return { ok: true, path: rel, agent };
  } catch (e) { return { error: String(e.message || e) }; }
}

// ---- git helpers: save worklog/important files and sync to GitHub ----
function git(args, root) {
  try {
    const out = execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, out: out.trim() };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 800), out: (e.stdout || '').toString().trim() };
  }
}

export function repoStatus({ root } = {}) {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
  const changes = git(['status', '--short'], root);
  const remote = git(['remote', 'get-url', 'origin'], root);
  return {
    root,
    branch: branch.ok ? branch.out : '(no commits yet)',
    changes: changes.ok ? changes.out.split('\n').filter(Boolean) : [],
    remote: remote.ok ? remote.out : null,
  };
}

export function repoCommit({ root, message } = {}) {
  const msg = message || `worklog: snapshot ${new Date().toISOString()}`;
  const add = git(['add', '-A'], root);
  if (!add.ok) return add;
  // Ensure commits work even on a fresh machine with no global git identity.
  git(['config', 'user.name', 'AgentCorp'], root);
  git(['config', 'user.email', 'agentcorp@local'], root);
  const committed = git(['commit', '-m', msg], root);
  if (!committed.ok && /nothing to commit/i.test(committed.error || '')) {
    return { ok: true, nothingToCommit: true, message };
  }
  return { ...committed, message };
}

export function repoLog({ root, limit = 10 } = {}) {
  const r = git(['log', '--oneline', '-n', String(limit)], root);
  return r.ok ? { ok: true, log: r.out.split('\n').filter(Boolean) } : r;
}

export function repoSetRemote({ root, url } = {}) {
  const existing = git(['remote', 'get-url', 'origin'], root);
  const args = existing.ok ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url];
  return git(args, root);
}

export function repoSync({ root, message } = {}) {
  const c = repoCommit({ root, message });
  if (!c.ok) return { ...c, stage: 'commit' };
  const remote = git(['remote', 'get-url', 'origin'], root);
  if (!remote.ok) return { ok: true, committed: c, pushed: false, note: 'No git remote configured. Set one with repo_remote_set, then repo_sync.' };
  const push = git(['push', '-u', 'origin', 'HEAD'], root);
  return { ok: push.ok, committed: c, pushed: push.ok, pushError: push.ok ? null : push.error, remote: remote.out };
}
