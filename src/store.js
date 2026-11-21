// Persistent state store.
// Design goals: lightweight (KB-level metadata only), concurrency-safe, no external deps.
// - state.json  : tasks / goal / locks / stats (single source of truth)
// - events.jsonl: append-only event log, agents tail it for "real-time" visibility
import fs from 'node:fs';
import path from 'node:path';
import { defaultState, now, newId } from './constants.js';

export class Store {
  constructor(workspace) {
    this.workspace = workspace;
    this.dir = path.join(workspace, '.agentcorp');
    this.statePath = path.join(this.dir, 'state.json');
    this.eventsPath = path.join(this.dir, 'events.jsonl');
    this._writeQueue = Promise.resolve();
    this.ensure();
  }

  ensure() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.statePath)) {
      this.writeState(defaultState());
    }
    if (!fs.existsSync(this.eventsPath)) {
      fs.writeFileSync(this.eventsPath, '', 'utf8');
    }
  }

  readState() {
    try {
      const raw = fs.readFileSync(this.statePath, 'utf8');
      const s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return defaultState();
      return s;
    } catch {
      return defaultState();
    }
  }

  // Serialize all writes through a queue so concurrent MCP clients don't corrupt state.
  writeState(state) {
    state.updatedAt = now();
    const tmp = `${this.statePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, this.statePath);
  }

  update(mutator) {
    const state = this.readState();
    const result = mutator(state);
    this.writeState(state);
    return result;
  }

  // Append an event and return it. Events are the "activity feed" other agents watch.
  emit(type, payload = {}, actor = 'system') {
    if (this._seqCache === undefined) this._seqCache = this._countEvents();
    const event = {
      id: newId('evt'),
      seq: ++this._seqCache,
      ts: now(),
      type,
      actor,
      payload,
    };
    fs.appendFileSync(this.eventsPath, JSON.stringify(event) + '\n', 'utf8');
    return event;
  }

  _countEvents() {
    try {
      return fs.readFileSync(this.eventsPath, 'utf8').split('\n').filter(Boolean).length;
    } catch {
      return 0;
    }
  }

  // Read events after a given sequence. This powers polling-based "real-time" views.
  readEvents(afterSeq = 0, limit = 200) {
    let lines = [];
    try {
      lines = fs.readFileSync(this.eventsPath, 'utf8').split('\n').filter(Boolean);
    } catch {
      return [];
    }
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try {
        const e = JSON.parse(lines[i]);
        if (e.seq > afterSeq) out.push(e);
      } catch { /* skip corrupt line */ }
    }
    return out.reverse();
  }

  tailEvents(limit = 50) {
    let lines = [];
    try {
      lines = fs.readFileSync(this.eventsPath, 'utf8').split('\n').filter(Boolean);
    } catch {
      return [];
    }
    return lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }

  // ---- file locks: prevent two agents editing the same path at once ----
  acquireLock(relPath, owner, ttlMs = 5 * 60 * 1000) {
    return this.update(s => {
      const key = path.normalize(relPath);
      const existing = s.locks[key];
      if (existing && existing.expiresAt > Date.now() && existing.owner !== owner) {
        return { ok: false, lockedBy: existing.owner, expiresAt: existing.expiresAt };
      }
      s.locks[key] = { owner, acquiredAt: Date.now(), expiresAt: Date.now() + ttlMs };
      return { ok: true, path: key };
    });
  }

  releaseLock(relPath, owner) {
    return this.update(s => {
      const key = path.normalize(relPath);
      const existing = s.locks[key];
      if (!existing) return { ok: true, note: 'no lock existed' };
      if (existing.owner !== owner) return { ok: false, lockedBy: existing.owner };
      delete s.locks[key];
      return { ok: true };
    });
  }

  listLocks() {
    const s = this.readState();
    const nowMs = Date.now();
    return Object.entries(s.locks)
      .filter(([, v]) => v.expiresAt > nowMs)
      .map(([k, v]) => ({ path: k, owner: v.owner, expiresAt: v.expiresAt }));
  }
}
