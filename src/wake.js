// Auto-wake: nudge a target AI when a command/task is sent to it.
//
// Reality check (verified on this machine): none of the four agents exposes a
// CLI that can start with a prompt, and none has a deeplink that carries a task.
// So waking is a two-part best effort:
//   1. RELIABLE: drop a wake ticket into the shared hub inbox + append an event.
//      The target agent polls its inbox / org_events and picks it up.
//   2. BEST-EFFORT: launch/focus the target app via its registered URL scheme
//      (or ZCode workspace deeplink) so the window is actually up. This only
//      brings the window forward; it cannot force the agent to start a turn.
// Failure to launch never breaks the task flow.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { AGENTS, now } from './constants.js';

// Registered URL schemes (HKCU\Software\Classes) observed on this machine.
const WAKE = {
  workbuddy: { scheme: 'workbuddy://', name: 'WorkBuddy' },
  dsh: { scheme: 'dsh://open', name: 'DeepSeek Harness' },
  zcode: { scheme: 'zcode://', name: 'ZCode' },
  antigravity: { scheme: 'antigravity://', name: 'Antigravity' },
};

function launchUrl(url) {
  try {
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', url], {
        detached: true, stdio: 'ignore', windowsHide: true,
      });
      child.on('error', () => {});
      child.unref?.();
      return true;
    }
    if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref?.();
      return true;
    }
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref?.();
    return true;
  } catch {
    return false;
  }
}

/**
 * Wake a target agent.
 * @param {object} opts
 * @param {string} opts.agent      target agent id
 * @param {string} [opts.taskId]   related task
 * @param {string} [opts.message]  wake note / instruction summary
 * @param {string} [opts.from]     originating agent
 * @param {boolean} [opts.launch=true]  also try to bring the app window up
 * @param {string} [opts.workspace]     hub root (inbox lives here)
 */
export function wakeAgent({ agent, taskId, message, from, launch = true, workspace } = {}) {
  if (!agent || !AGENTS[agent]) return { ok: false, error: `Unknown agent ${agent}` };
  const hubRoot = workspace || process.env.AGENTCORP_HUB_ROOT || process.env.AGENTCORP_WORKSPACE;
  const ticket = {
    id: `wake-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'wake',
    agent,
    from: from || 'ceo',
    taskId: taskId || null,
    message: message || '',
    createdAt: now(),
  };

  // 1) Reliable channel: a wake ticket file in the target's inbox.
  let fileWritten = false;
  let filePath = null;
  try {
    const dir = hubRoot
      ? path.join(hubRoot, 'inbox', agent)
      : path.join(process.cwd(), 'inbox', agent);
    fs.mkdirSync(dir, { recursive: true });
    filePath = path.join(dir, `${ticket.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(ticket, null, 2), 'utf8');
    fileWritten = true;
  } catch { /* hub may not be initialised yet — event still emitted */ }

  // 2) Best effort: bring the app window forward.
  let launched = false;
  let launchUrlUsed = null;
  let launchNote = null;
  if (launch) {
    const w = WAKE[agent];
    if (!w) {
      launchNote = 'no deeplink registered for this agent';
    } else {
      launchUrlUsed = w.scheme;
      launched = launchUrl(launchUrlUsed);
      if (!launched) launchNote = 'failed to open deeplink';
    }
  }

  return {
    ok: true,
    ...ticket,
    inboxTicket: fileWritten ? filePath : null,
    launched,
    launchUrl: launchUrlUsed,
    launchNote,
    note: 'Wake ticket queued in shared inbox; app window focus is best-effort. ' +
          'Execution still requires the target agent session to poll its inbox / org_events.',
  };
}

/** Wake all agents that are currently offline. Roster provided by caller. */
export function wakeOffline(roster, opts = {}) {
  const offline = (roster?.agents || []).filter(a => !a.online).map(a => a.id);
  return {
    targets: offline,
    results: offline.map(id => wakeAgent({ ...opts, agent: id })),
  };
}

export { WAKE as WAKE_SCHEMES };
