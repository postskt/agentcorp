// AgentCorp dashboard frontend.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let DASH = null;
let latestSeq = 0;

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
  plugin_updated: '插件更新', connected: '已连接',
};

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
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  return `${Math.floor(s / 3600)}小时前`;
}

// ---------- loading / rendering ----------
async function load() {
  try {
    const d = await api('/api/dashboard');
    DASH = d;
    latestSeq = d.latestSeq || latestSeq;
    renderStats(); renderAgents(); renderColumns(); renderFeed();
    renderArtifacts(); renderDecisions(); renderGoal(); renderInfo();
  } catch (e) {
    toast('加载失败: ' + e.message);
  }
}

function renderInfo() {
  const r = DASH.stats?.reworkCycles ?? 0;
  $('#decisionBadge').textContent = (DASH.columns.escalated?.length || 0) + (DASH.columns.review?.length || 0);
  $('#btnGoal').textContent = DASH.goal ? '修改目标' : '下达目标';
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
    ['总任务', DASH.stats.tasksCreated], ['进行中', (c.doing || []).length],
    ['待审核', (c.review || []).length], ['已完成', DASH.stats.tasksDone],
    ['打回重做', DASH.stats.reworkCycles], ['升级决策', (c.escalated || []).length],
  ];
  $('#stats').innerHTML = items.map(([l, n]) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');
}

function renderAgents() {
  const html = Object.entries(DASH.perAgent || {}).map(([id, info]) => {
    const busy = info.doing.length > 0;
    const doing = info.doing[0];
    const queued = info.queued.length;
    return `<div class="agent-card">
      <h4><span class="dot ${busy ? 'busy' : queued ? 'queued' : ''}"></span>${esc(info.name)} <span class="muted small">${busy ? '工作中' : queued ? '有排队任务' : '空闲'}</span></h4>
      <div class="agent-line">正在做：<b>${doing ? esc(doing.title) : '—'}</b></div>
      <div class="agent-line">排队任务：<b>${queued}</b>　能力：${info.can.join('/')}</div>
    </div>`;
  }).join('');
  $('#agentsStrip').innerHTML = html || '<div class="empty">暂无 Agent 状态</div>';
}

function renderColumns() {
  const cols = DASH.columns || {};
  $('#columns').innerHTML = Object.entries(cols).map(([status, tasks]) => {
    const cards = tasks.map(t => `<div class="card" onclick="showTask('${t.id}')">
      <div class="t">${esc(t.title)}</div>
      <div class="meta"><span class="tag ${t.type}">${TYPE_LABEL[t.type] || t.type}</span>
      <span>${t.assignee ? esc(t.assignee) : '未分配'}</span>${t.revision ? `<span class="tag">打回${t.revision}次</span>` : ''}</div>
    </div>`).join('');
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
    <div class="acts"><button class="btn sm" onclick="viewFile('${esc(x.path)}')">查看文件</button><button class="btn sm" onclick="viewDiff('${esc(x.path)}')">看 diff</button></div>
  </div>`).join('') || '<div class="empty">还没有产物登记</div>';
}

function renderDecisions() {
  const escTasks = DASH.columns.escalated || [];
  const revTasks = DASH.columns.review || [];
  $('#decisionList').innerHTML = escTasks.map(t => `<div class="list-item">
    <div class="row"><b>${esc(t.title)}</b><span class="tag">待决策</span></div>
    <div class="sub">${esc(t.spec || '')}</div>
    <div class="acts">
      <button class="btn sm primary" onclick="decide('${t.id}','assign')">指定继续</button>
      <button class="btn sm" onclick="decide('${t.id}','rework')">打回重做</button>
      <button class="btn sm danger" onclick="decide('${t.id}','drop')">放弃</button>
      <button class="btn sm" onclick="showTask('${t.id}')">详情</button>
    </div>
  </div>`).join('') || '<div class="empty">没有需要你决策的事项</div>';

  $('#reviewList').innerHTML = revTasks.map(t => `<div class="list-item">
    <div class="row"><b>${esc(t.title)}</b><span class="muted small">${esc(t.assignee || '')}</span></div>
    <div class="sub">${esc(t.spec || '')}</div>
    <div class="acts">
      <button class="btn sm primary" onclick="review('${t.id}','pass')">通过</button>
      <button class="btn sm" onclick="review('${t.id}','fail')">打回</button>
      <button class="btn sm" onclick="showTask('${t.id}')">详情</button>
    </div>
  </div>`).join('') || '<div class="empty">没有待审任务</div>';
}

// ---------- interactions ----------
window.showTask = async function (id) {
  try {
    const t = await api(`/api/task?id=${encodeURIComponent(id)}`);
    const rev = t.review ? `<div class="kv"><div class="k">审核</div><div>${esc(t.review.verdict || '')} · ${esc(t.review.comments || t.review.ceoNote || '')}</div></div>` : '';
    const res = t.result ? `<div class="kv"><div class="k">提交说明</div><div>${esc(t.result.summary || '')}</div></div>` : '';
    openModal(`<h2>${esc(t.title)}</h2>
      <div class="kv"><div class="k">类型/状态</div><div>${TYPE_LABEL[t.type] || t.type} / ${STATUS_LABEL[t.status] || t.status}</div></div>
      <div class="kv"><div class="k">负责人</div><div>${esc(t.assignee || '未分配')}</div></div>
      <div class="kv"><div class="k">验收标准</div><div>${esc(t.spec || '')}</div></div>
      <div class="kv"><div class="k">涉及文件</div><div>${esc((t.files || []).join(', ') || '—')}</div></div>
      <div class="kv"><div class="k">打回次数</div><div>${t.revision}</div></div>
      ${res}${rev}
      <div class="modal-acts"><button class="btn" onclick="closeModal()">关闭</button></div>`);
  } catch (e) { toast(e.message); }
};

window.decide = async function (id, decision) {
  try {
    let agent;
    if (decision === 'assign') {
      agent = prompt('指定给哪个 Agent？(workbuddy/dsh/zcode/antigravity)', 'dsh');
      if (!agent) return;
    }
    await post('decide', { taskId: id, decision, agent: agent || undefined, note: 'CEO 看板决策' });
    toast('决策已生效'); closeModal(); load();
  } catch (e) { toast(e.message); }
};

window.review = async function (id, verdict) {
  const comments = prompt(verdict === 'pass' ? '通过意见（可选）' : '打回原因（越具体越好）', verdict === 'pass' ? 'OK' : '');
  if (comments === null) return;
  try {
    await post('review', { taskId: id, reviewer: 'ceo', verdict, comments: comments || '-' });
    toast(verdict === 'pass' ? '已通过' : '已打回，自动退回重做'); load();
  } catch (e) { toast(e.message); }
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
  if (!taskId) return toast('请输入任务 ID');
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

function switchTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.pane').forEach(p => p.classList.toggle('active', p.id === `pane-${name}`));
}
$$('.tab').forEach(t => t.onclick = () => switchTab(t.dataset.tab));

// ---------- SSE live updates ----------
function connectStream() {
  const es = new EventSource('/api/stream');
  es.onmessage = (e) => {
    try {
      const evt = JSON.parse(e.data);
      if (evt.type === 'connected') { $('#liveDot').textContent = '● 实时'; return; }
      if (evt.seq && evt.seq > latestSeq) { latestSeq = evt.seq; load(); }
    } catch {}
  };
  es.onerror = () => { $('#liveDot').textContent = '○ 重连中'; };
}

load();
connectStream();
setInterval(load, 15000);
