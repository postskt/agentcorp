// Compact floating dashboard window.
const $ = (s) => document.querySelector(s);
let DASH = null;
let latestSeq = 0;
let paused = false;
let timer = null;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function ago(iso) {
  if (!iso) return '从未';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  return `${Math.floor(s / 3600)}小时前`;
}
async function api(path) {
  const r = await fetch(path);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

async function load() {
  try {
    DASH = await api('/api/dashboard');
    latestSeq = DASH.latestSeq || latestSeq;
    render();
    $('#miniLive').textContent = paused ? '○ 已暂停' : '● 实时';
  } catch (e) {
    $('#miniGoal').textContent = '加载失败：' + e.message;
  }
}

function render() {
  const g = DASH.goal;
  $('#miniGoal').innerHTML = g
    ? `<b>${esc(g.title)}</b><div class="muted small">${esc(g.direction || '')}</div>`
    : '<span class="muted">目标未设置</span>';

  const agents = DASH.roster?.agents || [];
  $('#miniAgents').innerHTML = agents.map(a => {
    const cls = a.online ? 'on' : (a.installed ? 'idle' : 'off');
    const label = a.online ? '在线' : (a.installed ? '已装·离线' : '未安装');
    return `<div class="mini-agent"><span class="dot ${cls}"></span><b>${esc(a.name)}</b><span class="muted small">${label} · ${ago(a.lastSeen)}</span></div>`;
  }).join('') || '<div class="empty">暂无 Agent</div>';

  const alerts = [];
  const escCount = (DASH.columns?.escalated || []).length;
  const revCount = (DASH.columns?.review || []).length;
  const stalled = DASH.stalled || [];
  const offline = agents.filter(a => a.installed && !a.online);
  if (escCount) alerts.push(`<div class="alert danger">${escCount} 个任务等待 CEO 决策</div>`);
  if (revCount) alerts.push(`<div class="alert warn">${revCount} 个任务等待审核</div>`);
  if (stalled.length) alerts.push(`<div class="alert warn">${stalled.length} 个任务疑似卡住：${esc(stalled[0].title)}</div>`);
  if (offline.length) alerts.push(`<div class="alert">${offline.length} 个 Agent 已安装但离线</div>`);
  $('#miniAlerts').innerHTML = alerts.join('') || '<div class="empty">暂无异常，一切正常</div>';
  $('#miniTime').textContent = `在线 ${DASH.roster?.onlineCount || 0}/${agents.length} · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
}

function connect() {
  const es = new EventSource('/api/stream');
  es.onmessage = (e) => {
    try {
      const evt = JSON.parse(e.data);
      if (evt.type === 'connected') return;
      if (paused) return;
      if (evt.seq && evt.seq > latestSeq) {
        latestSeq = evt.seq;
        clearTimeout(connect._t);
        connect._t = setTimeout(load, 250);
      }
    } catch {}
  };
  es.onerror = () => { $('#miniLive').textContent = '○ 重连中'; };
}

$('#btnClose').onclick = () => window.close();
$('#btnFull').onclick = () => {
  if (window.opener && !window.opener.closed) {
    window.opener.focus();
    if (window.opener.switchTab) window.opener.switchTab('board');
  } else {
    window.open('/', '_blank');
  }
  window.close();
};
$('#miniLive').onclick = () => { paused = !paused; load(); };

load();
connect();
timer = setInterval(() => { if (!paused) load(); }, 10000);
window.addEventListener('beforeunload', () => clearInterval(timer));
