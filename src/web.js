// Web dashboard server: static UI + REST API + SSE live feed.
// Shares the exact same actions as the MCP tools (single source of truth).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { createActions } from './actions.js';
import { VERSION } from './constants.js';

let server = null;
let state = { port: null, startedAt: null, clients: new Set() };

export function ensureDashboard(port = 7788) {
  if (server && server.listening) {
    return { ok: true, url: `http://localhost:${state.port}`, alreadyRunning: true, version: VERSION };
  }
  const WS = process.env.AGENTCORP_WORKSPACE || process.cwd();
  const store = new Store(WS);
  const a = createActions(store, WS);
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
  const clients = state.clients;

  function send(res, status, data, type = 'application/json') {
    res.writeHead(status, {
      'Content-Type': type,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(Buffer.isBuffer(data) ? data : (typeof data === 'string' ? data : JSON.stringify(data)));
  }

  function broadcast(event) {
    const line = `data: ${JSON.stringify(event)}\n\n`;
    for (const c of clients) { try { c.write(line); } catch { clients.delete(c); } }
  }

  // Push newly appended events to connected browsers (short poll of the jsonl file).
  let lastSeq = store.tailEvents(1)[0]?.seq || 0;
  const pusher = setInterval(() => {
    const evts = store.readEvents(lastSeq, 200);
    for (const e of evts) { lastSeq = e.seq; broadcast(e); }
  }, 400);
  pusher.unref?.();

  function readBody(req) {
    return new Promise((resolve) => {
      let buf = '';
      req.on('data', c => { buf += c; if (buf.length > 1e6) req.destroy(); });
      req.on('end', () => { try { resolve(JSON.parse(buf || '{}')); } catch { resolve({}); } });
    });
  }

  // Route POST actions -> shared actions layer.
  async function handleAction(req, res, name) {
    const body = await readBody(req);
    const map = {
      goal: a.orgGoal,
      plan: a.taskPlan,
      assign: a.taskAssign,
      claim: a.taskClaim,
      submit: a.taskSubmit,
      review: a.reviewSubmit,
      escalate: a.orgEscalate,
      decide: a.orgDecide,
      message: a.agentMessage,
      lock: a.fileLock,
      unlock: a.fileUnlock,
      worklog: a.worklogAdd,
      hub_files: a.hubFiles,
      hub_read: a.hubFileRead,
      repo_save: a.repoSave,
      repo_sync: a.repoPush,
      plugin_update: a.pluginUpdate,
      float: async ({ port }) => (await import('./floating.js')).openFloatingDashboard({ port }),
      native_ui: async ({ url }) => (await import('./native-ui.js')).openNativeDashboard({
        workspace: WS, url: url || `http://localhost:${state.port || port}`,
      }),
    };
    const fn = map[name];
    if (!fn) return send(res, 404, { error: `Unknown action ${name}` });
    const result = await fn(body);
    if (result?.error) return send(res, 400, result);
    send(res, 200, result);
  }

  server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, `http://localhost:${port}`);
    const pathname = urlObj.pathname;
    if (req.method === 'OPTIONS') return send(res, 204, '');

    try {
      // Static UI
      if (pathname === '/' || pathname === '/index.html' || pathname === '/mini.html') {
        const name = pathname === '/mini.html' ? 'mini.html' : 'index.html';
        const html = fs.readFileSync(path.join(publicDir, name), 'utf8');
        return send(res, 200, html, 'text/html; charset=utf-8');
      }
      if (pathname.startsWith('/assets/')) {
        const file = path.join(publicDir, pathname.replace(/^\//, ''));
        if (!file.startsWith(publicDir) || !fs.existsSync(file)) return send(res, 404, 'not found', 'text/plain');
        const ext = path.extname(file);
        const mime = ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream';
        return send(res, 200, fs.readFileSync(file), mime);
      }
      // API
      if (pathname === '/api/dashboard') return send(res, 200, a.dashboard());
      if (pathname === '/api/status') return send(res, 200, a.orgStatus());
      if (pathname === '/api/info') return send(res, 200, a.orgInfo());
      if (pathname === '/api/events') {
        return send(res, 200, a.orgEvents({ afterSeq: Number(urlObj.searchParams.get('after') || 0), limit: 200 }));
      }
      if (pathname === '/api/task') return send(res, 200, a.taskGet({ taskId: urlObj.searchParams.get('id') }));
      if (pathname === '/api/file') return send(res, 200, a.fileContent({ path: urlObj.searchParams.get('path') }));
      if (pathname === '/api/diff') return send(res, 200, a.gitDiff({ path: urlObj.searchParams.get('path') || undefined }));
      if (pathname === '/api/hub/files') return send(res, 200, a.hubFiles({
        agent: urlObj.searchParams.get('agent') || undefined,
        depth: Number(urlObj.searchParams.get('depth') || 2),
      }));
      if (pathname === '/api/hub/file') return send(res, 200, a.hubFileRead({ file: urlObj.searchParams.get('file') }));
      if (pathname === '/api/plugins') return send(res, 200, a.pluginInfo());
      if (pathname === '/api/repo') return send(res, 200, a.repoInfo());
      if (pathname === '/api/stream') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
        res.write(`data: ${JSON.stringify({ type: 'connected', ts: new Date().toISOString() })}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (req.method === 'POST' && pathname.startsWith('/api/')) {
        return await handleAction(req, res, pathname.slice('/api/'.length));
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, 500, { error: String(e.message || e) });
    }
  });

  const silent = !!process.env.AGENTCORP_SILENT;
  server.listen(port, () => {
    if (!silent) console.log(`AgentCorp dashboard: http://localhost:${port}`);
  });
  server.on('error', (e) => {
    if (!silent && e.code === 'EADDRINUSE') console.error(`Port ${port} in use. Try another port.`);
  });
  state = { port, startedAt: new Date().toISOString(), clients };
  return { ok: true, url: `http://localhost:${port}`, port, version: VERSION, alreadyRunning: false };
}

export function dashboardInfo() {
  const running = !!(server && server.listening);
  return { running, ...state, clients: state.clients.size };
}
