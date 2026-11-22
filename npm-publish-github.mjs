#!/usr/bin/env node
// Publish AgentCorp to GitHub Packages (npm registry at npm.pkg.github.com).
//
// GitHub Packages requires a SCOPED package name; we temporarily rename
// package.json to @postskt/agentcorp, publish, then restore the original
// "agentcorp" name (DSH's cordis.patch.yml depends on that name).
//
// Auth: uses GITHUB_TOKEN env if set, else the token from git credential.
// The token is written to a temporary .npmrc and always removed afterwards.
//
// Usage:
//   GITHUB_TOKEN=ghp_xxx node npm-publish-github.mjs --dry-run
//   node npm-publish-github.mjs            # uses git credential token
//
// IMPORTANT: the token needs the `write:packages` scope (classic PAT).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.join(ROOT, 'package.json');
const NPMRC = path.join(ROOT, '.npmrc');
const REGISTRY = 'https://npm.pkg.github.com';
const SCOPE = '@postskt';
const TARGET = `${SCOPE}/agentcorp`;
const dryRun = process.argv.includes('--dry-run');

function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'],
    });
    return out.split('\n').find(l => l.startsWith('password='))?.slice('password='.length);
  } catch { return null; }
}

const token = getToken();
if (!token) {
  console.error('No GitHub token found. Set GITHUB_TOKEN or configure git credential.');
  process.exit(1);
}

const original = fs.readFileSync(PKG, 'utf8');
const pkg = JSON.parse(original);
const npmrcExisted = fs.existsSync(NPMRC);
const originalNpmrc = npmrcExisted ? fs.readFileSync(NPMRC, 'utf8') : null;

try {
  const renamed = {
    ...pkg,
    name: TARGET,
    publishConfig: { ...(pkg.publishConfig || {}), registry: REGISTRY, access: 'public' },
  };
  fs.writeFileSync(PKG, JSON.stringify(renamed, null, 2) + '\n', 'utf8');
  fs.writeFileSync(NPMRC,
    `${SCOPE}:registry=${REGISTRY}\n//npm.pkg.github.com/:_authToken=${token}\n`, 'utf8');

  console.log(`Publishing ${TARGET}@${pkg.version} to GitHub Packages...`);
  const args = ['publish', '--registry', REGISTRY];
  if (dryRun) args.push('--dry-run');
  execFileSync('npm', args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  console.log(dryRun ? 'DRY RUN complete (nothing published).' : `PUBLISHED ${TARGET}@${pkg.version}`);
} catch (e) {
  console.error('PUBLISH FAILED:', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally {
  // Always restore package.json and remove the temporary .npmrc (never leave the token behind).
  fs.writeFileSync(PKG, original, 'utf8');
  if (npmrcExisted) fs.writeFileSync(NPMRC, originalNpmrc, 'utf8');
  else { try { fs.unlinkSync(NPMRC); } catch {} }
  console.log('Restored package.json name:', JSON.parse(fs.readFileSync(PKG, 'utf8')).name);
  console.log('Temporary .npmrc removed:', !fs.existsSync(NPMRC) || npmrcExisted);
}
