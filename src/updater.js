// Auto-update + plugin hot-update.
// - Version source: package.json "version" locally, GitHub Releases API remotely.
// - Repo is configurable via package.json repository.url or AGENTCORP_REPO env.
// - Update applies by running `git pull` (if it is a git checkout) or a provided
//   installer; plugin hot-update rewrites the adapter MCP config without a restart.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERSION } from './constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(ROOT, 'package.json');

function repoUrl() {
  if (process.env.AGENTCORP_REPO) return process.env.AGENTCORP_REPO;
  try {
    const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
    const url = pkg.repository?.url || '';
    if (url.includes('YOUR_USERNAME')) return null;
    return url.replace(/^git\+/, '').replace(/\.git$/, '');
  } catch { return null; }
}

function ownerRepo() {
  const url = repoUrl();
  if (!url) return null;
  const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function parseVer(v = '') {
  return v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
}
function isNewer(latest, local) {
  const a = parseVer(latest), b = parseVer(local);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

async function checkForUpdates() {
  const target = ownerRepo();
  localVersion();
  if (!target) {
    return {
      available: false, localVersion: VERSION, latestVersion: null,
      note: 'No GitHub repo configured. Set "repository" in package.json or AGENTCORP_REPO=owner/repo.',
    };
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${target.owner}/${target.repo}/releases/latest`, {
      headers: { 'User-Agent': 'agentcorp-updater', 'Accept': 'application/vnd.github+json' },
    });
    if (res.status === 404) {
      return { available: false, localVersion: VERSION, latestVersion: null, note: 'No releases published yet.' };
    }
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = await res.json();
    const latest = data.tag_name || VERSION;
    return {
      available: isNewer(latest, VERSION),
      localVersion: VERSION, latestVersion: latest,
      publishedAt: data.published_at, notes: (data.body || '').slice(0, 1500),
      url: data.html_url,
    };
  } catch (e) {
    return { available: false, localVersion: VERSION, latestVersion: null, error: String(e.message || e) };
  }
}

function localVersion() {
  try { return JSON.parse(fs.readFileSync(PKG, 'utf8')).version || VERSION; } catch { return VERSION; }
}

// Apply a core update via git pull. Returns an actionable result; never throws.
function applyUpdate() {
  const gitDir = path.join(ROOT, '.git');
  if (!fs.existsSync(gitDir)) {
    return { ok: false, message: 'Not a git checkout. Download the latest release and replace the folder manually.' };
  }
  try {
    const out = execFileSync('git', ['pull', '--ff-only'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    return { ok: true, message: 'git pull succeeded.', output: out.trim().slice(-2000), restartNeeded: true };
  } catch (e) {
    return { ok: false, message: 'git pull failed.', error: String(e.message || e).slice(0, 1000) };
  }
}

// ---- plugin hot-update: rewrite a single adapter's MCP config in place ----
const PLUGIN_CONFIG_PATH = {
  workbuddy: ({ home }) => path.join(home, '.workbuddy', 'mcp.json'),
  dsh: ({ home }) => path.join(home, '.dsh', 'mcp_config.json'),
  zcode: ({ home }) => path.join(home, '.zcode', 'mcp_config.json'),
  antigravity: ({ home }) => path.join(home, '.gemini', 'config', 'mcp_config.json'),
};

function readAgentcorpEntry(p) {
  try {
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    const entry = cfg?.mcpServers?.agentcorp;
    if (!entry) return null;
    return {
      registered: true,
      workspace: entry.env?.AGENTCORP_WORKSPACE || null,
      serverPath: Array.isArray(entry.args) ? entry.args[0] : null,
    };
  } catch { return null; }
}

function pluginStatus(workspace) {
  const home = process.env.HOME || process.env.USERPROFILE;
  return Object.entries(PLUGIN_CONFIG_PATH).map(([id, fn]) => {
    const p = fn({ home });
    let configExists = false;
    try { configExists = fs.existsSync(p); } catch { /* unreadable */ }
    const entry = configExists ? readAgentcorpEntry(p) : null;
    return {
      id, configPath: p, configExists,
      agentcorpRegistered: !!entry,
      workspace: entry?.workspace || null,
      serverPath: entry?.serverPath || null,
    };
  });
}

// Doctor: explain why agents can't see each other. The #1 cause is that each
// platform was installed with a DIFFERENT AGENTCORP_WORKSPACE, so they read
// different .agentcorp/state.json files and heartbeats never meet.
function doctor(workspace) {
  const plugins = pluginStatus(workspace);
  const norm = p => p ? path.resolve(String(p)).replace(/\\/g, '/').toLowerCase() : null;
  const target = norm(workspace);
  const installed = plugins.filter(p => p.agentcorpRegistered);
  const groups = {};
  for (const p of installed) {
    const key = norm(p.workspace) || '(unset)';
    (groups[key] ||= []).push(p.id);
  }
  const shared = installed.filter(p => norm(p.workspace) === target);
  const drifted = installed.filter(p => norm(p.workspace) !== target);
  const problems = [];
  if (drifted.length) problems.push(
    `${drifted.length} agent(s) point to a different workspace than the current one (${target}).`
  );
  if (Object.keys(groups).length > 1) problems.push(
    `Installed agents are split across ${Object.keys(groups).length} different workspaces — their heartbeats cannot see each other.`
  );
  const notInstalled = plugins.filter(p => !p.agentcorpRegistered).map(p => p.id);
  if (notInstalled.length) problems.push(`Not installed: ${notInstalled.join(', ')}.`);
  return {
    currentWorkspace: workspace,
    plugins,
    installedCount: installed.length,
    onlineCount: null, // filled by actions layer from presence
    workspaceGroups: groups,
    aligned: drifted.length === 0,
    alignedAgents: shared.map(p => p.id),
    driftedAgents: drifted.map(p => ({ id: p.id, workspace: p.workspace })),
    notInstalled,
    problems,
    fix: problems.length
      ? 'Run agentcorp align --workspace <shared-dir> (or call workspace_align tool) to point all installed agents at one shared directory, then restart each agent.'
      : 'All installed agents share the same workspace. Open each agent and call agent_hello to go online.',
  };
}

// Align: rewrite every installed agent's AGENTCORP_WORKSPACE to one shared dir.
// Only touches entries that already have agentcorp registered; never adds to
// platforms that never installed it. Preserves all other MCP servers.
function alignWorkspaces(workspace) {
  const home = process.env.HOME || process.env.USERPROFILE;
  const results = [];
  for (const [id, fn] of Object.entries(PLUGIN_CONFIG_PATH)) {
    const p = fn({ home });
    if (!fs.existsSync(p)) { results.push({ id, ok: false, reason: 'not installed' }); continue; }
    try {
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!cfg?.mcpServers?.agentcorp) { results.push({ id, ok: false, reason: 'agentcorp not registered' }); continue; }
      cfg.mcpServers.agentcorp.env = cfg.mcpServers.agentcorp.env || {};
      const before = cfg.mcpServers.agentcorp.env.AGENTCORP_WORKSPACE || null;
      cfg.mcpServers.agentcorp.env.AGENTCORP_WORKSPACE = workspace;
      const tmp = `${p}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
      fs.renameSync(tmp, p);
      results.push({ id, ok: true, before, after: workspace });
    } catch (e) { results.push({ id, ok: false, error: String(e.message || e) }); }
  }
  // Ensure shared state exists at the target workspace.
  try {
    fs.mkdirSync(path.join(workspace, '.agentcorp'), { recursive: true });
  } catch { /* non-fatal */ }
  return { workspace, results, changed: results.filter(r => r.ok && r.before !== workspace).length };
}

// Hot-update = rewrite the agentcorp entry with the current server path/version,
// preserving every other MCP server. No service restart required for config changes.
function updatePlugin(id, workspace) {
  if (!PLUGIN_CONFIG_PATH[id]) return { ok: false, message: `Unknown plugin: ${id}` };
  const home = process.env.HOME || process.env.USERPROFILE;
  const p = PLUGIN_CONFIG_PATH[id]({ home });
  const entryPath = path.resolve(ROOT, 'src', 'index.js').replace(/\\/g, '/');
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { cfg = {}; }
    if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') cfg.mcpServers = {};
    cfg.mcpServers.agentcorp = {
      command: 'node',
      args: [entryPath],
      env: { AGENTCORP_WORKSPACE: workspace || process.cwd() },
      transport: 'stdio',
    };
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
    fs.renameSync(tmp, p);
    return {
      ok: true, plugin: id, configPath: p, version: localVersion(),
      message: `Plugin ${id} config refreshed to v${localVersion()}. Re-enable/Trust in the host if required.`,
    };
  } catch (e) {
    return { ok: false, plugin: id, error: String(e.message || e) };
  }
}

function startBackgroundChecks({ intervalMs = 30 * 60 * 1000, onUpdate } = {}) {
  async function run() {
    const result = await checkForUpdates();
    if (result.available && onUpdate) onUpdate(result);
    return result;
  }
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return { timer, checkNow: run };
}

export {
  VERSION, repoUrl, ownerRepo, checkForUpdates, applyUpdate,
  pluginStatus, updatePlugin, startBackgroundChecks, localVersion, doctor, alignWorkspaces,
};
