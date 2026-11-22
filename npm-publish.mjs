#!/usr/bin/env node
// Publish AgentCorp to npmjs.org without changing the repo's package name.
//
// Why this script exists:
//   - The unscoped name "agentcorp" is already taken on npm (an unrelated package).
//   - The repo's package.json name MUST stay "agentcorp": DSH's cordis.patch.yml
//     matches the plugin row name to the package name, so changing it would break
//     `dsh plugin add github:postskt/agentcorp`.
//   - So we temporarily rename for `npm publish`, then always restore the original.
//
// Usage:
//   npm login                       # once, if not logged in
//   node npm-publish.mjs            # publishes as postskt-agentcorp (default)
//   NPM_PKG_NAME=@postskt/agentcorp node npm-publish.mjs
//   node npm-publish.mjs --dry-run  # show what would be published, no network write
//
// Requires: npm logged in (`npm whoami` works). Never stores credentials.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.join(ROOT, 'package.json');
const dryRun = process.argv.includes('--dry-run');
const targetName = process.env.NPM_PKG_NAME || 'postskt-agentcorp';

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', ...opts,
  });
}

const original = fs.readFileSync(PKG, 'utf8');
const pkg = JSON.parse(original);

if (pkg.name === targetName) {
  console.error(`package.json is already named "${targetName}". Refusing to overwrite.`);
  process.exit(1);
}

// Verify npm login before touching the file.
if (!dryRun) {
  const who = spawnSync('npm', ['whoami'], {
    cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32',
  });
  if (who.status !== 0 || !who.stdout.trim()) {
    console.error('Not logged in to npm. Run `npm login` first, then retry.');
    process.exit(1);
  }
  console.log(`Publishing as npm user: ${who.stdout.trim()}`);
}

const renamed = {
  ...pkg,
  name: targetName,
  // npmjs consumers install by name; keep provenance links to the real repo.
  publishConfig: { ...(pkg.publishConfig || {}), access: 'public' },
};

try {
  fs.writeFileSync(PKG, JSON.stringify(renamed, null, 2) + '\n', 'utf8');
  console.log(`Temporarily renamed package: ${pkg.name} -> ${targetName}`);

  const publishArgs = ['publish'];
  if (dryRun) publishArgs.push('--dry-run');
  publishArgs.push('--access', 'public');

  run('npm', publishArgs);
  console.log(dryRun ? 'DRY RUN complete (nothing published).' : `PUBLISHED ${targetName}@${pkg.version} to npmjs.org`);
} finally {
  // Always restore the original package.json so the repo/DSH name is intact.
  fs.writeFileSync(PKG, original, 'utf8');
  console.log('Restored original package.json name:', JSON.parse(fs.readFileSync(PKG, 'utf8')).name);
}
