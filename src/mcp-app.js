// AgentCorp Embedded Panel — a native MCP App rendered INSIDE the host UI.
//
// Unlike the old web dashboard (external browser) or the desktop widget
// (floating ON TOP of the agent), this is an MCP Apps UI resource. WorkBuddy
// loads it in a sandboxed webview inside the conversation / artifact area.
// No browser, no local HTTP server, no desktop window, no token cost to install.

export const APP_URI = 'ui://agentcorp/console.html';
export const APP_MIME = 'text/html;profile=mcp-app';
export const APP_TOOL = 'org_console';

// Resource metadata: CSP is empty because the app is fully self-contained
// (inline CSS/JS, no external resources). prefersBorder false = edge-to-edge.
export const APP_RESOURCE_META = {
  ui: {
    csp: { frameDomains: [], connectDomains: [], resourceDomains: [] },
    permissions: {},
    prefersBorder: false,
  },
};

// Tool metadata that tells an MCP Apps host to render the linked UI.
// The same ui:// resource is rendered by every MCP Apps-capable host:
//   - WorkBuddy:          reads _meta.ui.resourceUri
//   - ZCode 3.16+:        reads _meta.ui.resourceUri + ui.surface (see manifest ui.surfaces)
//   - Antigravity 2.34+:  reads _meta.ui.resourceUri + com.google.antigravity/ui.entrypoints
// Extra vendor keys are ignored by hosts that do not understand them.
export const APP_TOOL_META = {
  ui: {
    resourceUri: APP_URI,
    surface: 'console',
    visibility: ['model', 'app'],
  },
  'com.google.antigravity/ui': {
    entrypoints: [
      { type: 'aux_pane', title: 'AgentCorp' },
      { type: 'global', title: 'AgentCorp' },
    ],
  },
};

export function buildConsoleHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentCorp Console</title>
<style>
  :root{color-scheme:light dark}
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;height:100%}
  body{font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
       color:#1f2430;background:#f7f8fa}
  :root.dark body,body{background:light-dark(#f7f8fa,#141821);color:light-dark(#1f2430,#e6e9f0)}
  .wrap{padding:14px;min-height:100%}
  .hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
  .hd h1{font-size:15px;margin:0;font-weight:650}
  .hd .ver{font-size:11px;opacity:.55}
  .hd .sp{flex:1}
  button{font:inherit;cursor:pointer;border:1px solid light-dark(#d5dae3,#3a4252);
         background:light-dark(#fff,#202634);color:inherit;border-radius:7px;padding:5px 10px}
  button:hover{border-color:#4f7cff}
  button.primary{background:#3b6ff5;color:#fff;border-color:#3b6ff5}
  button.danger{color:#e04040}
  .row{display:flex;gap:10px;flex-wrap:wrap}
  .card{background:light-dark(#fff,#1c2230);border:1px solid light-dark(#e5e9f0,#2c3444);
        border-radius:10px;padding:12px;flex:1;min-width:180px}
  .card h2{font-size:12px;margin:0 0 8px;opacity:.65;text-transform:uppercase;letter-spacing:.04em}
  .goal{font-size:13px;font-weight:600;margin-bottom:6px}
  .stats{display:flex;gap:14px;flex-wrap:wrap;margin-top:6px}
  .stat b{font-size:16px}
  .stat span{font-size:11px;opacity:.6}
  .agents{display:flex;gap:8px;flex-wrap:wrap}
  .agent{border:1px solid light-dark(#e5e9f0,#2c3444);border-radius:8px;padding:6px 9px;min-width:110px}
  .agent .nm{font-weight:600}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}
  .on{background:#22a35a}.off{background:#9aa3b2}.no{background:#e0a020}
  .agent .meta{font-size:11px;opacity:.6}
  .sec{margin-top:14px}
  .sec h2{font-size:13px;margin:0 0 8px}
  .tasks{display:flex;gap:8px;flex-wrap:wrap}
  .task{border:1px solid light-dark(#e5e9f0,#2c3444);border-radius:8px;padding:8px;min-width:200px;flex:1}
  .task .t{font-weight:600;margin-bottom:4px}
  .task .m{font-size:11px;opacity:.6}
  .tag{display:inline-block;font-size:10px;padding:1px 6px;border-radius:5px;background:#eef2ff;color:#3b5bdb;margin-right:4px}
  :root.dark .tag{background:#232c45;color:#8aa4ff}
  .tag.warn{background:#fff2e0;color:#c47a00}:root.dark .tag.warn{background:#3a2c14;color:#ffc46b}
  .tag.ok{background:#e6f7ee;color:#12864a}:root.dark .tag.ok{background:#143526;color:#5fe0a0}
  .tag.bad{background:#fdeaea;color:#c53030}:root.dark .tag.bad{background:#3a1818;color:#ff8a8a}
  .feed{max-height:180px;overflow:auto;border:1px solid light-dark(#e5e9f0,#2c3444);border-radius:8px}
  .ev{padding:5px 8px;border-bottom:1px solid light-dark(#eef1f5,#262e3c);font-size:12px}
  .ev:last-child{border-bottom:0}
  .ev .who{opacity:.55;margin-right:6px}
  .empty{opacity:.5;padding:8px;font-size:12px}
  .toast{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);
         background:#1d2430;color:#fff;padding:8px 14px;border-radius:8px;font-size:12px;
         opacity:0;pointer-events:none;transition:opacity .2s;z-index:9}
  .toast.show{opacity:1}
  .decision{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px}
  select,input,textarea{font:inherit;padding:4px 7px;border:1px solid light-dark(#d5dae3,#3a4252);
         border-radius:6px;background:light-dark(#fff,#202634);color:inherit}
  textarea{width:100%;min-height:52px;resize:vertical}
  .formrow{margin-top:6px}
  .formrow label{display:block;font-size:11px;opacity:.6;margin-bottom:2px}
  .toolbar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
  .bal{font-size:11px;padding:4px 7px;border:1px solid light-dark(#e5e9f0,#2c3444);border-radius:6px}
  .bal b{color:#3b6ff5}
  .assign{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px}
  .ctxbar{background:light-dark(#eef4ff,#182238);border:1px solid light-dark(#dbe6ff,#2a3a5c);
          border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:12px}
  .ctxbar pre{white-space:pre-wrap;word-break:break-word;max-height:120px;overflow:auto;
              font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;opacity:.85;margin:6px 0 0}
</style>
</head>
<body>
<div class="wrap">
  <div class="hd">
    <h1>⚡ AgentCorp</h1>
    <span class="ver" id="ver"></span>
    <span class="sp"></span>
    <button id="btnBalance">查余额</button>
    <button id="btnCtx">上下文</button>
    <button id="btnRefresh">刷新</button>
  </div>

  <div class="toolbar" id="balBar" style="display:none"></div>
  <div class="ctxbar" id="ctxBar" style="display:none">
    <div><b>上下文摘要</b> <span id="ctxStat"></span></div>
    <pre id="ctxText"></pre>
    <div class="assign" style="margin-top:8px">
      <button id="btnCopyCtx">复制摘要</button>
      <button id="btnNewChat">新对话并带入摘要</button>
      <button id="btnCompactHint">压缩方法</button>
      <span class="m" id="ctxHint" style="opacity:.6"></span>
    </div>
  </div>

  <div class="row">
    <div class="card" style="flex:2">
      <h2>公司目标</h2>
      <div class="goal" id="goal">—</div>
      <div class="stats" id="stats"></div>
    </div>
    <div class="card" style="flex:2">
      <h2>AI 在线状态</h2>
      <div class="agents" id="agents"></div>
    </div>
  </div>

  <div class="sec">
    <h2>任务看板</h2>
    <div class="assign">
      <span class="m">手动派活：</span>
      <select id="asTask"></select>
      <span class="m">工作AI</span><select id="asWorker"></select>
      <span class="m">审核AI</span><select id="asReviewer"></select>
      <label class="m"><input type="checkbox" id="asWake" checked> 唤醒</label>
      <button class="primary" id="btnAssign">派发</button>
    </div>
    <div class="tasks" id="tasks"></div>
  </div>

  <div class="sec" id="decisionSec" style="display:none">
    <h2>CEO 决策中心</h2>
    <div id="decisions"></div>
  </div>

  <div class="sec">
    <h2>实时活动</h2>
    <div class="feed" id="feed"></div>
  </div>
</div>
<div class="toast" id="toast"></div>
<script>
(function(){
  'use strict';
  var SEQ=0, PENDING={}, DATA=null, HOST_CTX=null, CTX_SUMMARY='', HOST_ACTION=null;
  var $=function(id){return document.getElementById(id)};

  function rpc(method,params){
    return new Promise(function(resolve,reject){
      var id='ac'+(++SEQ);
      PENDING[id]={resolve:resolve,reject:reject};
      window.parent.postMessage({jsonrpc:'2.0',id:id,method:method,params:params||{}},'*');
    });
  }
  function notify(method,params){
    window.parent.postMessage({jsonrpc:'2.0',method:method,params:params||{}},'*');
  }
  function callTool(name,args){
    return rpc('tools/call',{name:name,arguments:args||{}});
  }
  function toast(msg){
    var t=$('toast'); t.textContent=msg; t.classList.add('show');
    setTimeout(function(){t.classList.remove('show')},2200);
  }
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  function size(){
    try{ notify('ui/notifications/size-changed',{height:document.documentElement.scrollHeight}) }catch(e){}
  }

  // ---- bridge: host -> app ----
  window.addEventListener('message',function(ev){
    var d=ev && ev.data;
    if(!d || d.jsonrpc!=='2.0') return;
    if(d.id!==undefined && (d.result!==undefined||d.error!==undefined)){
      var p=PENDING[String(d.id)];
      if(p){ delete PENDING[String(d.id)];
        if(d.error) p.reject(d.error); else p.resolve(d.result); }
      return;
    }
    if(d.method==='ui/notifications/host-context-changed'){
      HOST_CTX=(d.params&&d.params.hostContext)||HOST_CTX;
    } else if(d.method==='ui/notifications/tool-input'){
      // arguments passed to the tool that opened this app
      if(d.params&&d.params.hostContext) HOST_CTX=d.params.hostContext;
    } else if(d.method==='ui/notifications/tool-result'){
      // the tool result is pushed here; structuredContent holds our payload
      var r=d.params||{};
      var sc=r.structuredContent || (r.result&&r.result.structuredContent);
      if(sc && typeof sc==='object'){ DATA=sc; render(); }
    }
  });

  function unwrap(res){
    if(!res) return null;
    if(res.structuredContent) return res.structuredContent;
    var c=res.content||[];
    for(var i=0;i<c.length;i++){ if(c[i].type==='text'){
      try{ return JSON.parse(c[i].text) }catch(e){ return {text:c[i].text} }
    }}
    return null;
  }

  function refresh(){
    return callTool('dashboard_data',{}).then(function(res){
      var d=unwrap(res);
      if(d && d.stats){ DATA=d; render(); }
    }).catch(function(e){ toast('刷新失败: '+(e&&e.message||e)) });
  }

  function render(){
    if(!DATA) return;
    var s=DATA.stats||{}, g=DATA.goal||{}, roster=DATA.roster||{};
    $('ver').textContent='v'+(DATA.version||'?');
    $('goal').textContent = g.title ? (g.title+(g.direction?' — '+g.direction:'')) : '尚未下达目标';

    var st=[['进行中',s.doing],['待审',s.review],['待决策',s.escalated],['已完成',s.done]];
    $('stats').innerHTML=st.map(function(x){return '<div class="stat"><b>'+(x[1]||0)+'</b> <span>'+x[0]+'</span></div>'}).join('');

    var agents=roster.agents||[];
    $('agents').innerHTML = agents.length? agents.map(function(a){
      var cls=a.online?'on':(a.installed?'off':'no');
      var lab=a.online?'在线':(a.installed?'已装·离线':'未安装');
      return '<div class="agent"><div class="nm"><span class="dot '+cls+'"></span>'+esc(a.name||a.id)+'</div>'+
             '<div class="meta">'+lab+' · '+(a.calls||0)+' 次调用</div></div>';
    }).join('') : '<div class="empty">暂无 Agent 数据</div>';

    var cols=DATA.columns||{}, order=['escalated','review','doing','assigned','inbox','done'];
    var names={escalated:'待决策',review:'待审核',doing:'进行中',assigned:'已派发',inbox:'收件箱',done:'已完成'};
    var html='';
    order.forEach(function(k){
      var list=cols[k]||[]; if(!list.length) return;
      html+='<div class="task"><div class="t">'+names[k]+' <span class="tag">'+list.length+'</span></div>';
      list.slice(0,5).forEach(function(t){
        var tag = t.status==='escalated'?'<span class="tag warn">升级</span>':'';
        if(t.updatedAt && (Date.now()-Date.parse(t.updatedAt))>900000) tag+='<span class="tag bad">卡住</span>';
        html+='<div class="m" style="margin:3px 0">'+tag+esc(t.title)+' <span style="opacity:.5">#'+esc(t.id)+'</span></div>';
      });
      if(list.length>5) html+='<div class="m" style="opacity:.5">…另有 '+(list.length-5)+' 项</div>';
      html+='</div>';
    });
    $('tasks').innerHTML = html || '<div class="empty">暂无任务</div>';

    var escList=cols.escalated||[];
    if(escList.length){
      $('decisionSec').style.display='';
      $('decisions').innerHTML=escList.map(function(t){
        return '<div class="task" style="margin-bottom:8px"><div class="t">'+esc(t.title)+' <span class="tag warn">#'+esc(t.id)+'</span></div>'+
          '<div class="m">'+esc((t.spec||'').slice(0,140))+'</div>'+
          '<div class="decision"><select data-sel="'+esc(t.id)+'"><option value="rework">打回重做</option>'+
          '<option value="assign">改派 Agent</option><option value="drop">放弃</option></select>'+
          '<input data-agent="'+esc(t.id)+'" placeholder="Agent: workbuddy/dsh/zcode" size="18">'+
          '<input data-note="'+esc(t.id)+'" placeholder="决策说明" size="20">'+
          '<button class="primary" data-decide="'+esc(t.id)+'">执行</button></div></div>';
      }).join('');
    } else { $('decisionSec').style.display='none'; }

    var ev=DATA.events||[];
    $('feed').innerHTML = ev.length? ev.slice(0,40).reverse().map(function(e){
      return '<div class="ev"><span class="who">'+esc(e.actor||e.agent||e.source||'system')+'</span>'+esc(e.type||e.kind||'event')+
             (e.summary?' · '+esc(e.summary):'')+'</div>';
    }).join('') : '<div class="empty">暂无活动</div>';

    // fill manual-assign dropdowns (worker + reviewer chosen by the CEO)
    var allTasks=[].concat.apply([],Object.keys(cols).map(function(k){return cols[k]||[]}));
    var taskSel=$('asTask');
    var prevTask=taskSel.value;
    taskSel.innerHTML=allTasks.length? allTasks.map(function(t){
      return '<option value="'+esc(t.id)+'">#'+esc(t.id)+' '+esc((t.title||'').slice(0,28))+'</option>'
    }).join(''):'<option value="">无任务</option>';
    if(prevTask) taskSel.value=prevTask;
    var agentIds=['workbuddy','dsh','zcode','antigravity'];
    var opts=agentIds.map(function(x){return '<option value="'+x+'">'+x+'</option>'}).join('');
    var w=$('asWorker'), rv=$('asReviewer');
    if(!w.innerHTML) w.innerHTML=opts;
    if(!rv.innerHTML) rv.innerHTML=opts;

    // wire decision buttons
    Array.prototype.forEach.call(document.querySelectorAll('[data-decide]'),function(b){
      b.onclick=function(){
        var id=b.getAttribute('data-decide');
        var decision=document.querySelector('[data-sel="'+id+'"]').value;
        var agent=document.querySelector('[data-agent="'+id+'"]').value.trim();
        var note=document.querySelector('[data-note="'+id+'"]').value.trim();
        var args={taskId:id,decision:decision};
        if(agent) args.agent=agent;
        if(note) args.note=note;
        callTool('org_decide',args).then(function(){ toast('决策已提交'); return refresh(); })
          .catch(function(e){ toast('提交失败: '+(e&&e.message||e)) });
      };
    });
    size();
  }

  function currentHost(){
    // best-effort detection from the app context supplied by the host
    var h=(HOST_CTX&&HOST_CTX.hostInfo&&HOST_CTX.hostInfo.name)||'';
    if(/antigravity/i.test(h)) return 'antigravity';
    if(/zcode|z\.ai/i.test(h)) return 'zcode';
    return 'workbuddy';
  }

  function showBalance(){
    var bar=$('balBar');
    bar.style.display=''; bar.innerHTML='<span class="m">查询中…</span>'; size();
    callTool('balance_query',{}).then(function(res){
      var d=unwrap(res)||{}; var list=d.agents||[];
      bar.innerHTML=list.map(function(x){
        var bal=x.balance!=null?('<b>'+esc(x.balance)+'</b> '+(x.currency||'')):
          (x.readable?'可读':esc(x.status||'未知'));
        return '<span class="bal" title="'+esc(x.next||x.source||'')+'">'+esc(x.agent)+': '+bal+'</span>';
      }).join('')||'<span class="m">无数据</span>';
      size();
    }).catch(function(e){ bar.innerHTML='<span class="m">查询失败: '+esc(e&&e.message||e)+'</span>'; size(); });
  }

  function showContext(){
    var bar=$('ctxBar');
    bar.style.display=''; $('ctxText').textContent='生成中…'; size();
    var host=currentHost();
    callTool('context_prepare',{host:host}).then(function(res){
      var d=unwrap(res)||{};
      $('ctxText').textContent=d.summary||'无摘要';
      $('ctxStat').textContent='原文约 '+(d.rawTokensApprox||0)+' tokens → 摘要约 '+(d.summaryTokens||0)+' tokens';
      var h=(d.hosts||[]).filter(function(x){return x.host===host})[0]||{};
      var nc=h.newChat||{};
      $('ctxHint').textContent=nc.possible===true?(nc.how||''):(h.compact&&h.compact.how)||'';
      CTX_SUMMARY=d.summary||''; HOST_ACTION=nc;
      size();
    }).catch(function(e){ $('ctxText').textContent='生成失败: '+(e&&e.message||e); size(); });
  }

  function copyText(t){
    try{
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t);return}
    }catch(e){}
    var ta=document.createElement('textarea'); ta.value=t; document.body.appendChild(ta);
    ta.select(); try{document.execCommand('copy')}catch(e){} document.body.removeChild(ta);
  }

  $('btnRefresh').onclick=function(){ toast('刷新中…'); refresh() };

  // ---- MCP Apps handshake ----
  rpc('ui/initialize',{
    protocolVersion:'2026-01-26',
    appInfo:{name:'agentcorp',version:'1.0.0'},
    appCapabilities:{}
  }).then(function(r){
    if(r&&r.hostContext) HOST_CTX=r.hostContext;
    notify('ui/notifications/initialized',{});
    return refresh();
  }).catch(function(){ refresh() });

  $('btnBalance').onclick=showBalance;
  $('btnCtx').onclick=showContext;
  $('btnCopyCtx').onclick=function(){ copyText(CTX_SUMMARY); toast('摘要已复制') };
  $('btnNewChat').onclick=function(){
    copyText(CTX_SUMMARY);
    var hint=(HOST_ACTION&&HOST_ACTION.how)||'';
    toast(hint?('已复制摘要：'+hint.slice(0,40)):'摘要已复制，请开新对话后粘贴');
  };
  $('btnCompactHint').onclick=function(){
    var h=currentHost();
    callTool('context_prepare',{host:h}).then(function(res){
      var d=unwrap(res)||{}; var one=(d.hosts||[]).filter(function(x){return x.host===h})[0]||{};
      var c=one.compact||{}; var msg=(c.how||'')+(c.prompt?'；建议输入：'+c.prompt:'');
      $('ctxHint').textContent=msg||'当前宿主无插件可触发的压缩命令';
      toast('压缩方法已显示');
    });
  };
  $('btnAssign').onclick=function(){
    var taskId=$('asTask').value; if(!taskId){toast('没有可派发的任务');return}
    var worker=$('asWorker').value; var reviewer=$('asReviewer').value;
    var wake=$('asWake').checked;
    var chain=callTool('task_assign',{taskId:taskId,agent:worker,force:true});
    if(reviewer && reviewer!==worker){
      chain=chain.then(function(){ return callTool('agent_message',{
        from:'ceo',to:reviewer,taskId:taskId,
        message:'请作为审核AI审查任务 '+taskId,wake:wake}); });
    } else if(wake){
      chain=chain.then(function(){ return callTool('agent_wake',{agent:worker,taskId:taskId,from:'ceo',launch:true}); });
    }
    chain.then(function(){toast('已派给 '+worker+(reviewer?'，审核 '+reviewer:''));return refresh();})
      .catch(function(e){toast('派发失败: '+(e&&e.message||e))});
  };

  size();
})();
</script>
</body>
</html>`;
}
