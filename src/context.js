// Context management: length estimate + compact / new-session guidance.
//
// There is no cross-host standard for "compact context" or "start a new chat"
// from a third-party MCP plugin. Each host differs:
//   WorkBuddy    -> host-internal /compact (guest SDK), not reachable by plugins
//   Antigravity  -> sendMessage with _meta com.google.antigravity/message target:"new"
//   ZCode        -> ext-apps ui/message + updateModelContext (runtime capability gated)
// So this module does the part WE control well: build a compact, token-light
// summary of the shared bus and hand the host an exact, copy-paste action.

import { now } from './constants.js';

/** Rough token estimate: CJK ~1.5 chars/token, ASCII ~4 chars/token. */
export function estimateTokens(text) {
  if (!text) return 0;
  const s = String(text);
  const cjk = (s.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) || []).length;
  const other = s.length - cjk;
  return Math.ceil(cjk / 1.5 + other / 4);
}

/** Build a compact summary string from a dashboard payload. */
export function buildSummary(d) {
  if (!d) return 'AgentCorp: no state yet.';
  const goal = d.goal?.title || '未设定目标';
  const dir = d.goal?.direction ? ` | 方向:${d.goal.direction}` : '';
  const s = d.stats || {};
  const online = d.roster?.agents?.filter(a => a.online).map(a => a.id).join(',') || '无';
  const cols = d.columns || {};
  const active = (cols.doing || []).map(t => `#${t.id}:${t.title}`).slice(0, 8).join('; ') || '无';
  const review = (cols.review || []).map(t => `#${t.id}`).slice(0, 8).join(',') || '无';
  const esc = (cols.escalated || []).map(t => `#${t.id}`).slice(0, 8).join(',') || '无';
  const stalled = (d.stalled || []).map(t => `#${t.id}`).slice(0, 8).join(',') || '无';
  return [
    `【AgentCorp 上下文摘要 ${now()}】`,
    `目标:${goal}${dir}`,
    `统计:进行中${s.doing || 0} 待审${s.review || 0} 待决策${s.escalated || 0} 完成${s.done || 0}`,
    `在线AI:${online}`,
    `进行中:${active}`,
    `待审:${review} | 待决策:${esc} | 卡住:${stalled}`,
    `共享Hub:${d.hub?.root || '未初始化'} | v${d.version || '?'}`,
  ].join('\n');
}

/** Host-specific instructions for compacting context / starting a new chat. */
export function contextActions(host = 'workbuddy', summary) {
  const s = summary || '';
  const common = {
    summary,
    summaryTokens: estimateTokens(s),
    note: 'Context compaction and new-session are host-controlled. This plugin cannot force them; it prepares a compact summary and gives the exact host action.',
  };
  if (host === 'workbuddy') {
    return { ...common, host,
      compact: { possible: true, how: 'Type /compact in the chat, or ask WorkBuddy to compress the conversation.', prompt: '请压缩上下文，只保留当前目标和未完成任务' },
      newChat: { possible: true, how: 'Use WorkBuddy "新建对话" button.', prompt: '开一个新对话窗口，并把下面的摘要作为第一条上下文' },
      inject: { method: 'ui/update-model-context', supportedByPlugin: false, fallback: 'Paste the summary into your next message.' },
    };
  }
  if (host === 'antigravity') {
    return { ...common, host,
      compact: { possible: false, how: 'Antigravity has no plugin-reachable compact command.', alternative: 'Attach the summary via updateModelContext, then ask the model to continue.' },
      newChat: { possible: true, how: 'App.sendMessage with _meta {"com.google.antigravity/message":{"target":"new"}} starts a new background session in the same project.', requiresCapability: 'message' },
      inject: { method: 'ui/update-model-context', requiresCapability: 'updateModelContext', supportedByPlugin: true },
    };
  }
  if (host === 'zcode') {
    return { ...common, host,
      compact: { possible: false, how: 'No plugin-reachable compact command confirmed.', alternative: 'Attach the summary via updateModelContext.' },
      newChat: { possible: 'runtime-dependent', how: 'ext-apps ui/message is available; new-session creation is not confirmed from a plugin.', requiresCapability: 'message' },
      inject: { method: 'ui/update-model-context', requiresCapability: 'updateModelContext', supportedByPlugin: true },
    };
  }
  return { ...common, host,
    compact: { possible: false, how: 'Unknown host.' },
    newChat: { possible: false, how: 'Unknown host.' },
    inject: { method: 'ui/update-model-context', supportedByPlugin: false },
  };
}

/** One-call helper used by the MCP tool. */
export function contextStatus({ d, host } = {}) {
  const summary = buildSummary(d);
  const raw = d ? JSON.stringify(d) : '';
  return {
    generatedAt: now(),
    rawBytes: Buffer.byteLength(raw, 'utf8'),
    rawTokensApprox: estimateTokens(raw),
    summary,
    summaryTokens: estimateTokens(summary),
    hosts: ['workbuddy', 'antigravity', 'zcode'].map(h => contextActions(h, summary)),
    tip: 'Copy the summary into a new chat to continue work with a fraction of the tokens.',
  };
}
