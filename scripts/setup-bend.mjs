import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(readFileSync(join(root, 'bend.lock.json'), 'utf8'));
const platform = `${process.platform}-${process.arch}`;
const expected = lock.sha256[platform];
if (!expected) throw new Error(`Bend ${lock.version} has no build for ${platform}. Use macOS, Linux, or WSL.`);
const destination = join(root, '.tools', `bend-${lock.version}`);
if (existsSync(join(destination, 'bin', 'bend'))) {
  console.log(`Bend ${lock.version} is already installed locally.`);
} else {
const archive = `bend-${lock.version}-${platform}.tar.gz`;
const url = `${lock.repository}/releases/download/v${lock.version}/${archive}`;
console.log(`Downloading pinned Bend ${lock.version} for ${platform}…`);
const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== expected) {
  throw new Error('Bend download failed SHA-256 verification. Nothing was installed.');
}
const staging = `${destination}.staging`;
mkdirSync(staging, { recursive: true });
try {
  const path = join(staging, archive);
  writeFileSync(path, bytes);
  execFileSync('tar', ['-xzf', path, '-C', staging]);
  mkdirSync(dirname(destination), { recursive: true });
  renameSync(join(staging, 'bend'), destination);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
console.log(`Installed ${destination} (SHA-256 verified).`);
}

// Official releases contain the native CLI and Base, but not the JS loader.
// Install the matching source tag, independently pinned by commit and hash.
const source = join(root, '.tools', `bend-source-${lock.version}`);
if (!existsSync(join(source, 'bend2', 'main.ts'))) {
  console.log(`Downloading Bend JS interop source at ${lock.sourceCommit}…`);
  const url = `https://codeload.github.com/bendlang/bend/tar.gz/${lock.sourceCommit}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Source download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== lock.sourceSha256) {
    throw new Error('Bend source failed SHA-256 verification.');
  }
  const staging = `${source}.staging`;
  mkdirSync(staging, { recursive: true });
  try {
    const archive = join(staging, 'source.tar.gz');
    writeFileSync(archive, bytes);
    execFileSync('tar', ['-xzf', archive, '-C', staging]);
    renameSync(join(staging, `bend-${lock.sourceCommit}`), source);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  console.log('Bend JavaScript interop is ready (SHA-256 verified).');
}
