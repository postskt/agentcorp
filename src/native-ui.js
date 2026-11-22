// Native Windows desktop widget for AgentCorp.
// No browser and no web server required: it reads the shared .agentcorp state
// directly, stays always-on-top, and can be dragged anywhere over an agent UI.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

function psq(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

export function buildPowerShell({ root, url }) {
  const rootLit = psq(root);
  const urlLit = psq(url);
  const logLit = psq(path.join(root, '.agentcorp', 'native-ui-error.log'));
  const traceLit = psq(path.join(root, '.agentcorp', 'native-ui-trace.log'));
  return `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  $root = ${rootLit}
  $url = ${urlLit}
  $statePath = Join-Path $root '.agentcorp\\state.json'
  $nl = [Environment]::NewLine
  $diagPath = ${traceLit}
  function Trace($message) {
    try { [System.IO.File]::AppendAllText($diagPath, ([DateTime]::Now.ToString('o') + ' ' + $message + $nl)) } catch {}
  }
  Trace 'script-start'

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'AgentCorp Native'
  $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
  $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  $form.Location = New-Object System.Drawing.Point(1300, 120)
  $form.Size = New-Object System.Drawing.Size(380, 500)
  $form.BackColor = [System.Drawing.Color]::FromArgb(248, 249, 251)
  $form.TopMost = $true
  $form.ShowInTaskbar = $true

  $title = New-Object System.Windows.Forms.Label
  $title.Text = 'AgentCorp 实时控制台'
  $title.Location = New-Object System.Drawing.Point(12, 10)
  $title.Size = New-Object System.Drawing.Size(250, 24)
  $title.ForeColor = [System.Drawing.Color]::FromArgb(29, 36, 48)
  $title.Font = New-Object System.Drawing.Font('Microsoft YaHei', 11, [System.Drawing.FontStyle]::Bold)

  $goalLabel = New-Object System.Windows.Forms.Label
  $goalLabel.Location = New-Object System.Drawing.Point(12, 36)
  $goalLabel.Size = New-Object System.Drawing.Size(356, 38)
  $goalLabel.ForeColor = [System.Drawing.Color]::FromArgb(59, 111, 212)
  $goalLabel.Font = New-Object System.Drawing.Font('Microsoft YaHei', 9)

  $agentsBox = New-Object System.Windows.Forms.RichTextBox
  $agentsBox.Location = New-Object System.Drawing.Point(12, 80)
  $agentsBox.Size = New-Object System.Drawing.Size(356, 170)
  $agentsBox.ReadOnly = $true
  $agentsBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
  $agentsBox.BackColor = [System.Drawing.Color]::White
  $agentsBox.Font = New-Object System.Drawing.Font('Microsoft YaHei', 9)

  $alertsBox = New-Object System.Windows.Forms.RichTextBox
  $alertsBox.Location = New-Object System.Drawing.Point(12, 258)
  $alertsBox.Size = New-Object System.Drawing.Size(356, 150)
  $alertsBox.ReadOnly = $true
  $alertsBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
  $alertsBox.BackColor = [System.Drawing.Color]::White
  $alertsBox.Font = New-Object System.Drawing.Font('Microsoft YaHei', 9)

  $btnOpen = New-Object System.Windows.Forms.Button
  $btnOpen.Text = '完整看板'
  $btnOpen.Location = New-Object System.Drawing.Point(12, 420)
  $btnOpen.Size = New-Object System.Drawing.Size(100, 30)
  $btnOpen.Add_Click({ Start-Process $url })

  $btnPin = New-Object System.Windows.Forms.Button
  $btnPin.Text = '置顶：开'
  $btnPin.Location = New-Object System.Drawing.Point(120, 420)
  $btnPin.Size = New-Object System.Drawing.Size(100, 30)
  $btnPin.Add_Click({
    $form.TopMost = -not $form.TopMost
    if ($form.TopMost) { $btnPin.Text = '置顶：开' } else { $btnPin.Text = '置顶：关' }
  })

  $btnClose = New-Object System.Windows.Forms.Button
  $btnClose.Text = '关闭'
  $btnClose.Location = New-Object System.Drawing.Point(268, 420)
  $btnClose.Size = New-Object System.Drawing.Size(100, 30)
  $btnClose.Add_Click({ $form.Close() })

  $form.Controls.Add($title)
  $form.Controls.Add($goalLabel)
  $form.Controls.Add($agentsBox)
  $form.Controls.Add($alertsBox)
  $form.Controls.Add($btnOpen)
  $form.Controls.Add($btnPin)
  $form.Controls.Add($btnClose)

  $script:dragging = $false
  $script:mouseStart = [System.Drawing.Point]::Empty
  $script:formStart = [System.Drawing.Point]::Empty
  function Start-Drag($sender, $e) {
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
      $script:dragging = $true
      $script:mouseStart = [System.Windows.Forms.Control]::MousePosition
      $script:formStart = $form.Location
    }
  }
  function Move-Drag($sender, $e) {
    if ($script:dragging) {
      $p = [System.Windows.Forms.Control]::MousePosition
      $x = $script:formStart.X + $p.X - $script:mouseStart.X
      $y = $script:formStart.Y + $p.Y - $script:mouseStart.Y
      $form.Location = New-Object System.Drawing.Point($x, $y)
    }
  }
  function End-Drag($sender, $e) { $script:dragging = $false }
  foreach ($c in @($form, $title, $goalLabel, $agentsBox, $alertsBox)) {
    $c.Add_MouseDown({ param($s, $e) Start-Drag $s $e })
    $c.Add_MouseMove({ param($s, $e) Move-Drag $s $e })
    $c.Add_MouseUp({ param($s, $e) End-Drag $s $e })
  }

  function Parse-Time($value) {
    if (-not $value) { return $null }
    try { return [DateTimeOffset]::Parse([string]$value).ToUnixTimeMilliseconds() } catch { return $null }
  }

  function Update-UI {
    $goalText = '目标未设置'
    $agentsText = ''
    $alertsText = ''
    if (Test-Path -LiteralPath $statePath) {
      try {
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        if ($state.goal -and $state.goal.title) { $goalText = [string]$state.goal.title }

        $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $ttl = 120000
        foreach ($id in @('workbuddy', 'dsh', 'zcode', 'antigravity')) {
          $p = $null
          if ($state.presence -and $state.presence.PSObject.Properties.Name -contains $id) { $p = $state.presence.$id }
          $seen = 0
          if ($p) { $seen = Parse-Time $p.lastSeen }
          $online = ($seen -and (($nowMs - $seen) -le $ttl))
          if ($online) { $mark = '在线' } else { $mark = '离线' }
          $agentsText += ($id + ' : ' + $mark + $nl)
        }

        $doing = 0; $review = 0; $escalated = 0; $stalled = 0
        if ($state.tasks) {
          foreach ($t in $state.tasks.PSObject.Properties.Value) {
            $status = [string]$t.status
            if ($status -eq 'doing') {
              $doing++
              $updated = Parse-Time $t.updatedAt
              if ($updated -and (($nowMs - $updated) -gt 900000)) { $stalled++ }
            } elseif ($status -eq 'review') { $review++ }
            elseif ($status -eq 'escalated') { $escalated++ }
          }
        }
        $alertsText = ('进行中 ' + $doing + '    待审 ' + $review + '    待决策 ' + $escalated + $nl)
        if ($stalled -gt 0) { $alertsText += ('疑似卡住：' + $stalled + ' 个任务' + $nl) }
        if ($escalated -gt 0) { $alertsText += '有任务等待你拍板' + $nl }
        if ($review -gt 0) { $alertsText += '有产物等待审核' + $nl }
        if ($stalled -eq 0 -and $escalated -eq 0 -and $review -eq 0) { $alertsText += '暂无异常' + $nl }
      } catch {
        $alertsText = '状态读取失败：' + $_.Exception.Message
      }
    } else {
      $agentsText = '状态文件不存在'
      $alertsText = '请先运行 agentcorp init'
    }
    $goalLabel.Text = $goalText
    $agentsBox.Text = $agentsText
    $alertsBox.Text = $alertsText
  }

  Update-UI
  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 2000
  $timer.Add_Tick({ Update-UI })
  $timer.Start()

  Trace 'before-run'
  [System.Windows.Forms.Application]::Run($form)
  Trace 'after-run'
} catch {
  $msg = $_.Exception.Message
  try { [System.IO.File]::AppendAllText(${logLit}, ([DateTime]::Now.ToString('o') + ' ' + $msg + [Environment]::NewLine)) } catch {}
  throw $msg
}
`;
}

export function openNativeDashboard({ workspace = process.cwd(), url } = {}) {
  try {
    const root = path.resolve(workspace);
    const target = url || 'http://localhost:7788';
    fs.mkdirSync(path.join(root, '.agentcorp'), { recursive: true });
    const ps = buildPowerShell({ root, url: target });
    const diag = path.join(root, '.agentcorp', 'native-ui-diag.log');
    const debug = process.env.AGENTCORP_UI_DEBUG === '1';
    const diagFd = fs.openSync(diag, 'a');
    const scriptPath = path.join(root, '.agentcorp', 'native-ui.ps1');
    fs.writeFileSync(scriptPath, `\uFEFF${ps}`, 'utf8');
    const psArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath];
    const child = spawn('powershell.exe', psArgs, {
      detached: true, stdio: debug ? ['ignore', 'pipe', 'pipe'] : ['ignore', diagFd, diagFd], windowsHide: false,
    });
    child.on('error', e => fs.appendFileSync(diag, `spawn error: ${e.message}\n`));
    if (debug) {
      let out = '', err = '';
      child.stdout?.on('data', c => { out += String(c); });
      child.stderr?.on('data', c => { err += String(c); });
      child.on('close', code => fs.appendFileSync(diag, `[close] exit=${code}\nstdout=${out}\nstderr=${err}\n---\n`));
    } else {
      child.unref?.();
    }
    return { ok: true, native: true, pid: child.pid, root, url: target };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}
