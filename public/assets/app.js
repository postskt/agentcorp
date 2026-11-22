// AgentCorp dashboard frontend.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let DASH = null;
let latestSeq = 0;
let paused = false;
let reloadTimer = null;
let stream = null;

const STATUS_LABEL = {
  inbox: '待认领', assigned: '已派活', doing: '进行中', review: '待审核',
  rejected: '打回重做', done: '已完成', escalated: '待CEO决策',
};
const TYPE_LABEL = { plan: '规划', code: '代码', review: '审核', test: '测试', fix: '修复' };
const EVENT_LABEL = {
  goal_set: '下达目标', task_created: '创建任务', task_assigned: '派活',
  task_started: '开始执行', task_submitted: '提交产物', review_passed: '审核通过',
  review_rejected: '审核打回', escalated: '升级给CEO', ceo_decision: 'CEO决策',
  message: '发消息', update_available: '发现新版本', update_applied: '已更新',
  plugin_updated: '插件更新', connected: '已连接', agent_online: 'Agent上线',
  workspaces_aligned: '工作区已对齐', hub_initialized: '共享目录已初始化',
  hub_file_written: '写入共享文件', worklog_added: '新增工作记录',
};
const AGENT_LABELS = { workbuddy: 'WorkBuddy', dsh: 'DeepSeek Harness', zcode: 'ZCode', antigravity: 'Antigravity' };
const STALL_MS = 15 * 60 * 1000;

async function api(path, opts) {
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}
function post(action, body) {
  return api(`/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
// JSON string safe to place inside an inline onclick="" attribute.
function js(s) {
  return JSON.stringify(String(s ?? '')).replace(/"/g, '&quot;').replace(/</g, '\\u003c');
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}
function timeAgo(iso) {
  if (!iso) return '—';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.max(0, s)}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  if (s < 86400) return `${Math.floor(s / 3600)}小时前`;
  return `${Math.floor(s / 86400)}天前`;
}
function isTyping() {
  const el = document.activeElement;
  return el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}
function scheduleLoad(delay = 250) {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    if (paused) return;
    if (isTyping()) return scheduleLoad(1200); // don't interrupt typing
    load();
  }, delay);
}

// ---------- loading / rendering ----------
async function load() {
  try {
    const d = await api('/api/dashboard');
    DASH = d;
    latestSeq = d.latestSeq || latestSeq;
    renderAll();
  } catch (e) {
    toast('加载失败: ' + e.message);
  }
}
function renderAll() {
  if (!DASH) return;
  renderStats(); renderAgents(); renderColumns(); renderFeed();
  renderArtifacts(); renderHub(); renderDecisions(); renderGoal(); renderInfo(); renderFloat();
}
function renderInfo() {
  const attention = (DASH.columns.escalated?.length || 0)
    + (DASH.columns.review?.length || 0)
    + (DASH.stalled?.length || 0);
  $('#decisionBadge').textContent = attention;
  $('#btnGoal').textContent = DASH.goal ? '修改目标' : '下达目标';
  $('#liveDot').textContent = paused ? '○ 已暂停' : '● 实时';
  $$('.tab').forEach(t => { if (t.dataset.tab === 'decision') t.title = `${attention} 项需要关注`; });
}
function renderGoal() {
  const g = DASH.goal;
  $('#goalBar').innerHTML = g
    ? `<b>${esc(g.title)}</b>　<span class="muted">${esc(g.direction || '')}</span>${g.constraints ? `　<span class="muted small">约束：${esc(g.constraints)}</span>` : ''}`
    : '<span class="muted">目标未设置 — CEO 在下方下达方向</span>';
}
function renderStats() {
  const c = DASH.columns;
  const items = [
    ['总任务', DASH.stats.tasksCreated],
    ['在线 AI', `${DASH.roster?.onlineCount || 0}/${DASH.roster?.agents?.length || 0}`],
    ['进行中', (c.doing || []).length],
    ['待审核', (c.review || []).length],
    ['已完成', DASH.stats.tasksDone],
    ['疑似卡住', (DASH.stalled || []).length],
    ['升级决策', (c.escalated || []).length],
  ];
  $('#stats').innerHTML = items.map(([l, n]) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');
}
function renderAgents() {
  const byId = Object.fromEntries((DASH.roster?.agents || []).map(a => [a.id, a]));
  const html = Object.entries(DASH.perAgent || {}).map(([id, info]) => {
    const r = byId[id] || {};
    const state = r.online ? '在线' : r.installed ? '已装·离线' : '未安装';
    const dot = r.online ? 'on' : r.installed ? 'idle' : 'off';
    const doing = info.doing[0];
    const queued = info.queued.length;
    return `<div class="agent-card">
      <h4><span class="dot ${dot}"></span>${esc(info.name)} <span class="muted small">${state} · 心跳 ${timeAgo(r.lastSeen)}</span></h4>
      <div class="agent-line">正在做：<b>${doing ? esc(doing.title) : '—'}</b></div>
      <div class="agent-line">排队：<b>${queued}</b>　能力：${(info.can || []).join('/')}　调用：${r.calls || 0}</div>
    </div>`;
  }).join('');
  $('#agentsStrip').innerHTML = html || '<div class="empty">暂无 Agent 状态</div>';
}
function renderColumns() {
  const cols = DASH.columns || {};
  $('#columns').innerHTML = Object.entries(cols).map(([status, tasks]) => {
    const cards = tasks.map(t => {
      const age = t.updatedAt ? Date.now() - Date.parse(t.updatedAt) : 0;
      const stall = t.status === 'doing' && age > STALL_MS
        ? `<span class="tag stall">卡住 ${Math.round(age / 60000)} 分</span>` : '';
      return `<div class="card" onclick="showTask(${js(t.id)})">
        <div class="t">${esc(t.title)}</div>
        <div class="meta"><span class="tag ${t.type}">${TYPE_LABEL[t.type] || t.type}</span>
        <span>${t.assignee ? esc(t.assignee) : '未分配'}</span>${t.revision ? `<span class="tag">打回${t.revision}次</span>` : ''}${stall}</div>
        <div class="meta small">更新 ${timeAgo(t.updatedAt)}</div>
      </div>`;
    }).join('');
    return `<div class="column"><h3>${STATUS_LABEL[status] || status}<span class="cnt">${tasks.length}</span></h3>${cards || '<div class="empty">空</div>'}</div>`;
  }).join('');
}
function renderFeed() {
  const evts = [...(DASH.events || [])].reverse();
  $('#feed').innerHTML = evts.map(e => {
    let what = EVENT_LABEL[e.type] || e.type;
    const p = e.payload || {};
    if (p.title) what += `：${esc(p.title)}`;
    else if (p.agent) what += ` → ${esc(p.agent)}`;
    else if (p.message) what += `：${esc(p.message)}`;
    else if (p.verdict) what += `：${p.verdict === 'pass' ? '通过' : '打回'}`;
    if (p.comments) what += `（${esc(p.comments)}）`;
    return `<div class="feed-item"><span class="seq">#${e.seq}</span><span class="who">${esc(e.actor)}</span><span class="what">${what}</span><span class="when">${timeAgo(e.ts)}</span></div>`;
  }).join('') || '<div class="empty">暂无活动</div>';
}
function renderArtifacts() {
  const arts = DASH.artifacts || [];
  $('#artifactList').innerHTML = arts.map(x => `<div class="list-item">
    <div class="row"><b>${esc(x.path)}</b><span class="tag">${x.review === 'pass' ? '已通过' : x.review === 'fail' ? '被打回' : '待审'}</span></div>
    <div class="sub">${esc(x.taskTitle || '')} · ${esc(x.author || '')} · ${esc(x.kind || 'code')}</div>
    <div class="acts"><button class="btn sm" onclick="viewFile(${js(x.path)})">查看文件</button><button class="btn sm" onclick="viewDiff(${js(x.path)})">看 diff</button></div>
  </div>`).join('') || '<div class="empty">还没有产物登记</div>';
}

function kv(pairs) {
  return pairs.map(([k, v]) => `<div class="kv"><div class="k">${esc(k)}</div><div>${v}</div></div>`).join('');
}
function renderHub() {
  const h = DASH.hub || {}, repo = DASH.repo || {}, plugins = DASH.plugins || {};
  $('#hubInfo').innerHTML = kv([
    ['根目录', `<code>${esc(h.root || '—')}</code>`],
    ['状态', h.exists ? '<span class="ok">已创建</span>' : '<span class="warn">未创建</span>'],
    ['Git 仓库', h.gitRepo ? '<span class="ok">是</span>' : '<span class="warn">否</span>'],
    ['布局', esc((h.layout || []).join('  '))],
  ]);
  $('#hubAgents').innerHTML = (DASH.roster?.agents || []).map(a => {
    const active = a.activeTasks || 0;
    return `<div class="list-item"><div class="row"><b>${esc(a.id)}/</b><span class="muted small">${a.online ? '在线' : a.installed ? '已装·离线' : '未安装'}</span></div>
      <div class="sub">${esc(a.name)} · ${active} 个进行中任务 · ${timeAgo(a.lastSeen)}</div></div>`;
  }).join('') || '<div class="empty">暂无 Agent</div>';
  $('#repoInfo').innerHTML = kv([
    ['分支', esc(repo.branch || '—')],
    ['未提交', repo.changes?.length ? `<span class="warn">${repo.changes.length} 项</span>` : '<span class="ok">干净</span>'],
    ['远端', repo.remote ? `<code>${esc(repo.remote)}</code>` : '<span class="muted small">未设置</span>'],
  ]);
  const pl = (plugins.plugins || []).map(p => `<div class="list-item">
    <div class="row"><b>${esc(p.id)}</b><span class="tag">${p.agentcorpRegistered ? '已注册' : '未注册'}</span></div>
    <div class="sub">${esc(p.configPath || '')}</div>
    ${p.agentcorpRegistered ? `<div class="acts"><button class="btn sm" onclick="updatePluginFromDashboard(${js(p.id)})">刷新配置</button></div>` : ''}
  </div>`).join('');
  $('#pluginInfo').innerHTML = `<div class="muted small" style="margin-bottom:6px">核心版本 v${esc(plugins.version || '?')}（常量 v${esc(plugins.constantsVersion || '?')}）</div>
    <div class="list">${pl || '<div class="empty">暂无插件状态</div>'}</div>`;
}
function renderDecisions() {
  const escTasks = DASH.columns.escalated || [];
  const revTasks = DASH.columns.review || [];
  $('#decisionList').innerHTML = escTasks.map(t => `<div class="list-item">
    <div class="row"><b>${esc(t.title)}</b><span class="tag">待决策</span></div>
    <div class="sub">${esc(t.spec || '')}</div>
    <div class="acts">
      <button class="btn sm primary" onclick="decide(${js(t.id)},'assign')">指定继续</button>
      <button class="btn sm" onclick="decide(${js(t.id)},'rework')">打回重做</button>
      <button class="btn sm danger" onclick="decide(${js(t.id)},'drop')">放弃</button>
      <button class="btn sm" onclick="showTask(${js(t.id)})">详情</button>
    </div>
  </div>`).join('') || '<div class="empty">没有需要你决策的事项</div>';

  $('#reviewList').innerHTML = revTasks.map(t => `<div class="list-item">
    <div class="row"><b>${esc(t.title)}</b><span class="muted small">${esc(t.assignee || '')} · ${timeAgo(t.submittedAt)}</span></div>
    <div class="sub">${esc(t.spec || '')}</div>
    <div class="acts">
      <button class="btn sm primary" onclick="review(${js(t.id)},'pass')">通过</button>
      <button class="btn sm" onclick="review(${js(t.id)},'fail')">打回</button>
      <button class="btn sm" onclick="showTask(${js(t.id)})">详情</button>
    </div>
  </div>`).join('') || '<div class="empty">没有待审任务</div>';

  const all = Object.values(DASH.columns || {}).flat();
  const dl = $('#taskOptions') || document.createElement('datalist');
  dl.id = 'taskOptions';
  dl.innerHTML = all.map(t => `<option value="${esc(t.id)}">${esc(t.title)} · ${esc(t.assignee || '未分配')}</option>`).join('');
  if (!dl.parentNode) document.body.appendChild(dl);
  $('#assignTaskId').setAttribute('list', 'taskOptions');
}

// ---------- task / decision interactions ----------
window.showTask = async function (id) {
  try {
    const t = await api(`/api/task?id=${encodeURIComponent(id)}`);
    const rev = t.review ? `<div class="kv"><div class="k">审核</div><div>${esc(t.review.verdict || '')} · ${esc(t.review.comments || t.review.ceoNote || '')}</div></div>` : '';
    const res = t.result ? `<div class="kv"><div class="k">提交说明</div><div>${esc(t.result.summary || '')}</div></div>` : '';
    openModal(`<h2>${esc(t.title)}</h2>
      ${kv([
        ['类型/状态', `${TYPE_LABEL[t.type] || t.type} / ${STATUS_LABEL[t.status] || t.status}`],
        ['负责人', esc(t.assignee || '未分配')],
        ['创建时间', `${timeAgo(t.createdAt)} · ${esc(t.createdAt || '—')}`],
        ['最后更新', `${timeAgo(t.updatedAt)} · ${esc(t.updatedAt || '—')}`],
        ['验收标准', esc(t.spec || '')],
        ['涉及文件', esc((t.files || []).join(', ') || '—')],
        ['打回次数', esc(t.revision || 0)],
      ])}${res}${rev}
      <div class="modal-acts"><button class="btn" onclick="closeModal()">关闭</button></div>`);
  } catch (e) { toast(e.message); }
};

window.decide = function (id, decision) {
  const label = { assign: '指定继续', rework: '打回重做', drop: '放弃任务' }[decision] || '决策';
  openModal(`<h2>${label}</h2>
    <div class="inline-form col">
      ${decision === 'assign' ? `<select id="dAgent">${Object.entries(AGENT_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>` : ''}
      <textarea id="dNote" rows="3" placeholder="决策说明（会写入审核记录）"></textarea>
      <div class="modal-acts">
        <button class="btn" onclick="closeModal()">取消</button>
        <button class="btn primary" id="dSave">确认</button>
      </div>
    </div>`);
  $('#dSave').onclick = async () => {
    try {
      await post('decide', {
        taskId: id, decision,
        agent: decision === 'assign' ? $('#dAgent').value : undefined,
        note: $('#dNote').value || `CEO 看板决策：${label}`,
      });
      toast('决策已生效'); closeModal(); load();
    } catch (e) { toast(e.message); }
  };
};

window.review = function (id, verdict) {
  const pass = verdict === 'pass';
  openModal(`<h2>${pass ? '通过任务' : '打回重做'}</h2>
    <div class="inline-form col">
      <textarea id="rNote" rows="4" placeholder="${pass ? '通过意见（可选）' : '打回原因（越具体越好，例如：缺少错误处理、未覆盖边界条件）'}"></textarea>
      ${pass ? '' : '<div class="muted small">常用：缺少错误处理 / 验收标准未满足 / 需要补充测试 / 与现有代码冲突</div>'}
      <div class="modal-acts">
        <button class="btn" onclick="closeModal()">取消</button>
        <button class="btn ${pass ? 'primary' : 'danger'}" id="rSave">${pass ? '确认通过' : '确认打回'}</button>
      </div>
    </div>`);
  $('#rSave').onclick = async () => {
    try {
      const comments = $('#rNote').value || (pass ? 'OK' : '请按验收标准补充后再提交');
      await post('review', { taskId: id, reviewer: 'ceo', verdict, comments });
      toast(pass ? '已通过' : '已打回，自动退回重做'); closeModal(); load();
    } catch (e) { toast(e.message); }
  };
};

window.viewFile = async function (p) {
  try {
    const d = await api(`/api/file?path=${encodeURIComponent(p)}`);
    openModal(`<h2>${esc(p)}</h2><pre class="diff">${esc(d.content)}</pre><div class="modal-acts"><button class="btn" onclick="closeModal()">关闭</button></div>`);
  } catch (e) { toast(e.message); }
};
window.viewDiff = async function (p) {
  try {
    const d = await api(`/api/diff?path=${encodeURIComponent(p)}`);
    $('#diffBox').textContent = d.diff; switchTab('artifacts');
  } catch (e) { toast(e.message); }
};

function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').classList.add('open'); }
window.closeModal = function () { $('#modal').classList.remove('open'); };
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

// ---------- shared hub interactions ----------
async function loadHubFiles() {
  try {
    const agent = $('#hubAgent')?.value || '';
    const d = await api(`/api/hub/files?agent=${encodeURIComponent(agent)}&depth=2`);
    const files = (d.entries || []).filter(e => e.kind === 'file').slice(0, 100);
    $('#hubFiles').innerHTML = files.map(f => `<div class="list-item file-row" onclick="viewHubFile(${js(f.path)})">
      <b>${esc(f.path)}</b><span class="muted small">${f.size ?? 0} B · ${timeAgo(f.mtime)}</span></div>`).join('') || '<div class="empty">该目录暂无文件</div>';
  } catch (e) { toast(e.message); }
}
window.viewHubFile = async function (file) {
  const agent = $('#hubAgent')?.value || '';
  const rel = agent ? `${agent}/${file}` : file;
  try {
    const d = await api(`/api/hub/file?file=${encodeURIComponent(rel)}`);
    openModal(`<h2>${esc(rel)}</h2><pre class="diff">${esc(d.content)}</pre><div class="modal-acts"><button class="btn" onclick="closeModal()">关闭</button></div>`);
  } catch (e) { toast(e.message); }
};
window.updatePluginFromDashboard = async function (id) {
  try {
    const r = await post('plugin_update', { id });
    $('#repoResult').textContent = JSON.stringify(r, null, 2);
    toast(r.ok ? `${id} 配置已刷新` : (r.error || '刷新失败')); load();
  } catch (e) { toast(e.message); }
};

$('#btnGoal').onclick = () => {
  openModal(`<h2>下达方向</h2>
    <div class="inline-form col">
      <input id="gTitle" placeholder="目标标题，如：加用户认证" value="${esc(DASH?.goal?.title || '')}">
      <textarea id="gDir" rows="3" placeholder="方向（做什么、为什么）">${esc(DASH?.goal?.direction || '')}</textarea>
      <input id="gCon" placeholder="约束（可选）" value="${esc(DASH?.goal?.constraints || '')}">
      <button class="btn primary" id="gSave">下达给 PM</button>
    </div>`);
  $('#gSave').onclick = async () => {
    try {
      await post('goal', { title: $('#gTitle').value, direction: $('#gDir').value, constraints: $('#gCon').value });
      toast('目标已下达，PM 开始拆解'); closeModal(); load();
    } catch (e) { toast(e.message); }
  };
};
$('#btnSend').onclick = async () => {
  const to = $('#msgTo').value, message = $('#msgText').value;
  if (!message.trim()) return toast('请输入指令内容');
  try {
    await post('message', { from: 'ceo', to, message });
    toast(`已发给 ${to}`); $('#msgText').value = ''; load();
  } catch (e) { toast(e.message); }
};
$('#btnAssign').onclick = async () => {
  const taskId = $('#assignTaskId').value.trim(), agent = $('#assignAgent').value;
  if (!taskId) return toast('请从下拉列表选择任务');
  try {
    const r = await post('assign', { taskId, agent, force: false });
    if (r.blocked) { if (confirm(r.reason + '\n仍要强制派活吗？')) await post('assign', { taskId, agent, force: true }); }
    toast('派活完成'); load();
  } catch (e) { toast(e.message); }
};
$('#btnDiff').onclick = async () => {
  try { const d = await api('/api/diff'); $('#diffBox').textContent = d.diff; } catch (e) { toast(e.message); }
};
$('#btnFile').onclick = async () => {
  const p = $('#filePathInput').value.trim(); if (!p) return toast('请输入路径');
  try { const d = await api(`/api/file?path=${encodeURIComponent(p)}`); $('#fileBox').textContent = d.content; } catch (e) { toast(e.message); }
};
$('#btnHubFiles').onclick = loadHubFiles;
$('#btnRepoSave').onclick = async () => {
  try {
    const r = await post('repo_save', { message: $('#commitMsg').value || undefined });
    $('#repoResult').textContent = JSON.stringify(r, null, 2);
    toast(r.ok ? '已保存到 git' : (r.error || '保存失败')); load();
  } catch (e) { toast(e.message); }
};
$('#btnRepoSync').onclick = async () => {
  try {
    const r = await post('repo_sync', { message: $('#commitMsg').value || undefined });
    $('#repoResult').textContent = JSON.stringify(r, null, 2);
    toast(r.ok && r.pushed !== false ? '已提交并上传' : '已提交，上传状态见结果'); load();
  } catch (e) { toast(e.message); }
};
$('#btnWorklog').onclick = async () => {
  const text = $('#logText').value.trim();
  if (!text) return toast('请输入工作记录内容');
  try {
    const r = await post('worklog', { agent: $('#logAgent').value, text });
    toast(r.ok ? `已写入 ${r.path}` : (r.error || '写入失败'));
    if (r.ok) { $('#logText').value = ''; load(); }
  } catch (e) { toast(e.message); }
};

// ---------- tabs / live updates ----------
window.switchTab = function (name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.pane').forEach(p => p.classList.toggle('active', p.id === `pane-${name}`));
  if (name === 'hub') loadHubFiles();
};
$$('.tab').forEach(t => t.onclick = () => switchTab(t.dataset.tab));
$('#liveDot').onclick = () => { paused = !paused; renderInfo(); if (!paused) load(); };

function connectStream() {
  if (stream) stream.close();
  stream = new EventSource('/api/stream');
  stream.onmessage = (e) => {
    try {
      const evt = JSON.parse(e.data);
      if (evt.type === 'connected') return;
      if (evt.seq && evt.seq > latestSeq) { latestSeq = evt.seq; scheduleLoad(); }
    } catch {}
  };
  stream.onerror = () => { $('#liveDot').textContent = '○ 重连中'; };
}

// ---------- floating modes ----------
function buildAlerts() {
  const out = [];
  const escN = (DASH.columns?.escalated || []).length;
  const revN = (DASH.columns?.review || []).length;
  const stalled = DASH.stalled || [];
  const offline = (DASH.roster?.agents || []).filter(a => a.installed && !a.online);
  if (escN) out.push(`${escN} 个任务等待 CEO 决策`);
  if (revN) out.push(`${revN} 个任务等待审核`);
  if (stalled.length) out.push(`${stalled.length} 个任务疑似卡住：${stalled[0].title}`);
  if (offline.length) out.push(`${offline.length} 个 Agent 已安装但离线`);
  return out;
}
function renderFloat() {
  const w = $('#floatWidget');
  if (!w || w.hidden || !DASH) return;
  const agents = DASH.roster?.agents || [];
  const alerts = buildAlerts();
  w.innerHTML = `<div class="float-head" id="floatHead"><span>AgentCorp 悬浮窗</span><button class="btn sm" id="floatClose">×</button></div>
    <div class="float-body">
      <div class="muted small">${esc(DASH.goal?.title || '目标未设置')}</div>
      ${agents.map(a => `<div class="float-agent"><span class="dot ${a.online ? 'on' : a.installed ? 'idle' : 'off'}"></span>
        <span class="name">${esc(a.name)}</span><span class="muted small">${a.online ? '在线' : a.installed ? '离线' : '未装'}</span></div>`).join('')}
      ${alerts.length ? `<div class="float-alert">${alerts.map(esc).join('<br>')}</div>` : '<div class="muted small" style="margin-top:8px">暂无异常</div>'}
      <div class="float-actions">
        <button class="btn sm primary" id="floatExpand">展开看板</button>
        <button class="btn sm" id="floatMini">独立小窗</button>
      </div>
    </div>`;
  $('#floatClose').onclick = () => toggleFloat(false);
  $('#floatExpand').onclick = () => toggleFloat(false);
  $('#floatMini').onclick = openMini;
  makeDraggable($('#floatHead'), w);
}
function toggleFloat(force) {
  const w = $('#floatWidget');
  const on = force === undefined ? w.hidden : force;
  document.body.classList.toggle('floated', on);
  w.hidden = !on;
  if (on) renderFloat();
}
function makeDraggable(handle, target) {
  if (!handle || handle.dataset.draggable === '1') return;
  handle.dataset.draggable = '1';
  let sx = 0, sy = 0, ox = 0, oy = 0;
  const down = (e) => {
    if (e.target.closest('button')) return;
    const r = target.getBoundingClientRect();
    target.style.left = `${r.left}px`; target.style.top = `${r.top}px`;
    target.style.right = 'auto'; target.style.bottom = 'auto';
    sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up, { once: true });
  };
  const move = (e) => {
    target.style.left = `${Math.max(0, ox + e.clientX - sx)}px`;
    target.style.top = `${Math.max(0, oy + e.clientY - sy)}px`;
  };
  const up = () => document.removeEventListener('mousemove', move);
  handle.addEventListener('mousedown', down);
}
async function openMini() {
  try {
    const r = await post('native_ui', {});
    if (r.ok) return toast('原生悬浮窗已打开，可直接拖到 Agent 界面上');
  } catch {}
  try {
    const r = await post('float', {});
    if (r.ok && r.floating) toast('浏览器悬浮窗已打开，可直接拖动');
    else if (r.ok) toast('小窗已打开；若未置顶，请手动拖动窗口');
    else toast(r.reason || r.error || '无法打开悬浮窗');
  } catch (e) {
    const win = window.open('/mini.html', 'agentcorp_floating', 'popup=yes,width=380,height=560');
    if (!win) { toggleFloat(true); toast('浏览器拦截了弹窗，已收起为页内浮窗'); }
  }
}
$('#btnFloat').onclick = () => toggleFloat();
$('#btnMini').onclick = openMini;

load();
connectStream();
setInterval(() => { if (!paused) scheduleLoad(0); }, 15000);
