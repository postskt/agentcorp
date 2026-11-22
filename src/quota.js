// Balance / quota probe for connected agents.
// Reads only LOCAL, non-secret cache fields. Never prints tokens or keys.
//
// Verified on this machine:
//   DSH          -> .dshw-api.json / .dshw-usage.json hold balance + usage (readable)
//   ZCode        -> local cache has plan *structure* but no numeric balance
//   Antigravity  -> quota lives in Google cloud, needs the local LS + csrf auth
//   WorkBuddy    -> no local balance cache at all, needs official API
//
// The probe is honest: for agents it cannot read, it returns a clear status and
// the exact next step instead of inventing numbers.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();

function safeReadJson(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return null;
}

function dshBalance() {
  const base = path.join(HOME, '.dsh');
  const api = safeReadJson(path.join(base, '.dshw-api.json'));
  const usage = safeReadJson(path.join(base, '.dshw-usage.json'));
  if (!api && !usage) {
    return { agent: 'dsh', readable: false, status: 'no local cache found',
      next: 'Open DeepSeek Harness once so it writes ~/.dsh/.dshw-api.json' };
  }
  const balance = pick(api, ['balance', 'remaining', 'credit']) ??
    pick(usage, ['lastBalance', 'balance']);
  const used = pick(usage, ['todayUsage', 'used']);
  const total = pick(api, ['total']);
  const currency = pick(api, ['currency']) || 'CNY';
  return {
    agent: 'dsh',
    readable: balance !== null,
    balance, used, total, currency,
    source: '~/.dsh/.dshw-api.json + .dshw-usage.json (local cache, no secret printed)',
    status: balance !== null ? 'ok' : 'cache present but no balance field',
    next: balance !== null ? null : 'Check DSH account login inside the app.',
  };
}

function zcodeBalance() {
  const base = path.join(HOME, '.zcode');
  const hasConfig = fs.existsSync(path.join(base, 'provider_config.json'));
  const hasCred = fs.existsSync(path.join(base, 'credentials.json'));
  return {
    agent: 'zcode',
    readable: false,
    status: 'local cache has plan structure only, no numeric balance',
    detected: { providerConfig: hasConfig, credentials: hasCred },
    source: '~/.zcode/v2/cache/.../quota.js (renderer only)',
    next: 'ZCode quota needs its authenticated account endpoint. Provide ZCode account auth, or read quota in the ZCode UI. No secret is read or stored by this probe.',
  };
}

function antigravityBalance() {
  const base = path.join(HOME, '.gemini', 'antigravity', 'daemon');
  let discovery = null;
  try {
    discovery = fs.readdirSync(base).find(f => /^hub_\d+\.json$/.test(f)) || null;
  } catch { /* no daemon yet */ }
  return {
    agent: 'antigravity',
    readable: false,
    status: 'quota lives in Google cloud and needs local language-server auth',
    detected: { daemonDiscovery: discovery ? path.join(base, discovery) : null },
    source: 'Antigravity UI "Context and Quota Indicator"; local LS on 11770/11771',
    next: 'Read quota from the Antigravity App UI, or explicitly authorize this plugin to use the local language-server endpoint. No csrfToken is read or printed by default.',
  };
}

function workbuddyBalance() {
  return {
    agent: 'workbuddy',
    readable: false,
    status: 'no local balance cache; host exposes credit events but not to third-party plugins',
    source: 'wb-guest-sdk wb:conversation:creditChanged (host-internal)',
    next: 'Check quota in WorkBuddy account settings, or provide an official API credential through the proper authorization flow.',
  };
}

const PROBES = { dsh: dshBalance, zcode: zcodeBalance, antigravity: antigravityBalance, workbuddy: workbuddyBalance };

/**
 * Query balance/quota for one agent, or all if none given.
 * @param {{agent?: string}} args
 */
export function balance({ agent } = {}) {
  if (agent) {
    const probe = PROBES[agent];
    if (!probe) return { error: `Unknown agent ${agent}` };
    return probe();
  }
  return { agents: Object.values(PROBES).map(fn => fn()),
    note: 'Only locally-readable, non-secret fields are used. Nothing is transmitted.' };
}

export const BALANCE_AGENTS = Object.keys(PROBES);
