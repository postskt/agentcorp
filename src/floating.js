// Real desktop floating window: a frameless Chromium "app" window showing the
// compact dashboard, pinned above other windows. It can be dragged anywhere
// over the agent UI with the mouse, unlike an in-page widget.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { ensureDashboard } from './web.js';

const TITLE = 'AgentCorp Floating';

function browserCandidates() {
  if (process.env.AGENTCORP_BROWSER && fs.existsSync(process.env.AGENTCORP_BROWSER)) {
    return [process.env.AGENTCORP_BROWSER];
  }
  if (process.platform !== 'win32') return [];
  const pf = process.env['ProgramFiles'] || 'C:/Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
  const local = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:/Users/Default', 'AppData/Local');
  return [
    path.join(pf86, 'Microsoft/Edge/Application/msedge.exe'),
    path.join(pf, 'Microsoft/Edge/Application/msedge.exe'),
    path.join(pf, 'Google/Chrome/Application/chrome.exe'),
    path.join(pf86, 'Google/Chrome/Application/chrome.exe'),
    path.join(local, 'Google/Chrome/Application/chrome.exe'),
  ].filter(p => fs.existsSync(p));
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Make the newly opened window always-on-top. Uses only built-in PowerShell +
// Win32, so no extra npm dependency is needed on Windows.
async function pinWindow() {
  if (process.platform !== 'win32') return { ok: false, reason: 'windows-only' };
  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class AgentCorpWin32 {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@
for ($i = 0; $i -lt 25; $i++) {
  $p = Get-Process | Where-Object { $_.MainWindowTitle -like '*${TITLE}*' } | Select-Object -First 1
  if ($p) {
    $ok = [AgentCorpWin32]::SetWindowPos($p.MainWindowHandle, (New-Object IntPtr -1), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0040)
    if ($ok) { 'pinned'; exit }
  }
  Start-Sleep -Milliseconds 300
}
'not-found'
`;
  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps,
    ], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] });
    const status = String(out || '').trim();
    return { ok: status === 'pinned', status };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 500) };
  }
}

function openFallback(url) {
  try {
    let child;
    if (process.platform === 'win32') {
      child = spawn('cmd', ['/c', 'start', '', '/b', url], { detached: true, stdio: 'ignore', windowsHide: true });
    } else if (process.platform === 'darwin') {
      child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    } else {
      child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }
    child.on('error', () => {});
    child.unref?.();
    return true;
  } catch { return false; }
}

export async function openFloatingDashboard({ port, url } = {}) {
  if (process.env.AGENTCORP_DASHBOARD_NO_BROWSER === '1') {
    return { ok: false, reason: 'browser disabled by environment' };
  }
  try {
    const oldSilent = process.env.AGENTCORP_SILENT;
    process.env.AGENTCORP_SILENT = '1';
    let info;
    try { info = ensureDashboard(Number(port || process.env.AGENTCORP_DASHBOARD_PORT || 7788)); }
    finally {
      if (oldSilent === undefined) delete process.env.AGENTCORP_SILENT;
      else process.env.AGENTCORP_SILENT = oldSilent;
    }
    const target = url || `${info.url}/mini.html?float=1`;
    const exe = browserCandidates()[0];

    if (!exe) {
      const opened = openFallback(target);
      return { ok: opened, url: target, floating: false, reason: 'no chromium browser found; opened normal window' };
    }

    const child = spawn(exe, [
      `--app=${target}`,
      '--window-size=390,600',
      '--window-position=1280,120',
      '--no-first-run',
      '--disable-features=TranslateUI',
    ], { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', () => {});
    child.unref?.();

    await delay(600);
    const pinned = await pinWindow();
    return {
      ok: true, url: target, floating: pinned.ok, pinned,
      browser: exe, alreadyRunning: !!info.alreadyRunning,
      note: pinned.ok ? 'Drag the window title area to move it over any agent UI.'
        : 'Window opened, but always-on-top could not be applied; drag it manually.',
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}
