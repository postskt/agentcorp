// First-install convenience: start the local dashboard and open a draggable,
// always-on-top floating window exactly once. Never throws; a UI failure is
// non-fatal.
import fs from 'node:fs';
import path from 'node:path';
import { ensureDashboard } from './web.js';
import { openNativeDashboard } from './native-ui.js';
import { openFloatingDashboard } from './floating.js';
import { VERSION } from './constants.js';

const FLAG_REL = path.join('.agentcorp', 'dashboard-autoopen.json');

function markerPath(workspace) {
  return path.join(workspace || process.cwd(), FLAG_REL);
}

export async function maybeAutoOpenDashboard({ workspace = process.cwd(), port, trigger = 'install' } = {}) {
  if (process.env.AGENTCORP_NO_AUTOOPEN === '1' || process.env.NODE_ENV === 'test') {
    return { opened: false, reason: 'disabled' };
  }
  try {
    const flag = markerPath(workspace);
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(flag, 'utf8')); } catch { /* first install */ }
    const usePort = Number(port || process.env.AGENTCORP_DASHBOARD_PORT || 7788);

    // Temporarily silence the HTTP server log: MCP runs over stdio and any
    // stray console output would corrupt the JSON-RPC stream.
    const oldSilent = process.env.AGENTCORP_SILENT;
    process.env.AGENTCORP_SILENT = '1';
    let info;
    try { info = ensureDashboard(usePort); }
    finally {
      if (oldSilent === undefined) delete process.env.AGENTCORP_SILENT;
      else process.env.AGENTCORP_SILENT = oldSilent;
    }

    if (prev?.version === VERSION && prev?.url === info.url) {
      return { opened: false, alreadyOpened: true, url: info.url, version: VERSION };
    }
    const target = info.url;
    let result = await openNativeDashboard({ workspace, url: target });
    let mode = 'native';
    if (!result.ok) {
      result = await openFloatingDashboard({ url: `${target}/mini.html?float=1` });
      mode = 'browser-fallback';
    }
    fs.mkdirSync(path.dirname(flag), { recursive: true });
    fs.writeFileSync(flag, JSON.stringify({
      version: VERSION, url: target, mode,
      openedAt: new Date().toISOString(), trigger,
      launched: result.ok,
    }, null, 2), 'utf8');
    return {
      opened: result.ok, mode, native: mode === 'native', url: target,
      version: VERSION, alreadyRunning: !!info.alreadyRunning, detail: result,
    };
  } catch (e) {
    return { opened: false, error: String(e && e.message ? e.message : e) };
  }
}

export function resetAutoOpen(workspace = process.cwd()) {
  try { fs.unlinkSync(markerPath(workspace)); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
}
