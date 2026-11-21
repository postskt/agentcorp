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

function pluginStatus(workspace) {
  const home = process.env.HOME || process.env.USERPROFILE;
  return Object.entries(PLUGIN_CONFIG_PATH).map(([id, fn]) => {
    const p = fn({ home });
    let installed = false, hasAgentcorp = false;
    try {
      installed = fs.existsSync(p);
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
      hasAgentcorp = !!(cfg.mcpServers && cfg.mcpServers.agentcorp);
    } catch { /* unreadable */ }
    return { id, configPath: p, configExists: installed, agentcorpRegistered: hasAgentcorp };
  });
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
  pluginStatus, updatePlugin, startBackgroundChecks, localVersion,
};
