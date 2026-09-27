#!/usr/bin/env node
// Format rules for the viewer code (spec section 2):
//   - lines at most 100 characters (JS, MJS, CSS)
//   - no inline style attributes in markup (style="…" in JS strings or HTML)
//   - no imports from one feature directory into another
//   - no CDN or other remote URLs in viewer/**
//
//   node scripts/viewer/check-format.mjs [--list]
// Exit code 1 on any violation; --list prints the checked files.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const MAX = 100;

const walk = directory => readdirSync(directory).flatMap(name => {
  const path = join(directory, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const within = (...parts) => {
  const path = join(root, ...parts);
  try {
    return statSync(path).isDirectory() ? walk(path) : [path];
  } catch {
    return [];
  }
};

const lengthScope = [
  ...within('viewer'),
  ...within('src', 'viewer'),
  ...within('src', 'review-server.mjs'),
  ...within('bin', 'wonky-view.mjs'),
  ...within('scripts', 'viewer', 'check-format.mjs'),
  ...within('scripts', 'viewer', 'check-contracts.mjs'),
  ...within('scripts', 'viewer', 'qa'),
  ...within('scripts', 'viewer', 'test-support'),
  ...within('test', 'viewer-server.test.mjs'),
  ...within('test', 'viewer-core.test.mjs'),
].filter(path => /\.(m?js|css)$/.test(path));
const viewerFiles = within('viewer');

const violations = [];
const report = (path, line, message) => {
  violations.push(`${relative(root, path)}:${line}: ${message}`);
};

for (const path of lengthScope) {
  readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
    if (line.length > MAX) {
      report(path, index + 1, `line has ${line.length} characters (max ${MAX})`);
    }
  });
}

const INLINE_STYLE = /\bstyle\s*=\s*\\?["'`]/;
const LOCAL_HOSTS = '127\\.0\\.0\\.1|localhost|www\\.w3\\.org';
const REMOTE_URL = new RegExp(`\\b(?:https?:)?//(?!${LOCAL_HOSTS})[a-z0-9-]+\\.[a-z]{2,}`, 'i');
const STATIC_IMPORT = String.raw`\b(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]`;
const DYNAMIC_IMPORT = String.raw`\bimport\(\s*['"]([^'"]+)['"]\s*\)`;
const IMPORT = new RegExp(`${STATIC_IMPORT}|${DYNAMIC_IMPORT}`, 'g');
const featureOf = path => {
  const parts = relative(join(root, 'viewer', 'features'), path).split(sep);
  return parts.length > 1 && !parts[0].startsWith('..') ? parts[0] : null;
};

for (const path of viewerFiles) {
  if (!/\.(m?js|css|html)$/.test(path)) continue;
  const text = readFileSync(path, 'utf8');
  text.split('\n').forEach((line, index) => {
    if (/\.(m?js|html)$/.test(path) && INLINE_STYLE.test(line)) {
      report(path, index + 1, 'inline style attribute (use a class in the feature CSS)');
    }
    const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '');
    if (REMOTE_URL.test(code)) report(path, index + 1, 'remote URL (no CDN, no network assets)');
  });
  if (!/\.m?js$/.test(path)) continue;
  const owner = featureOf(path);
  if (!owner) continue;
  for (const match of text.matchAll(IMPORT)) {
    const specifier = match[1] ?? match[2];
    if (!specifier.startsWith('.')) {
      report(path, 1, `bare or remote import ${specifier}`);
      continue;
    }
    const target = resolve(dirname(path), specifier);
    const targetFeature = featureOf(target);
    if (targetFeature && targetFeature !== owner) {
      report(path, 1, `feature ${owner} imports feature ${targetFeature} (${specifier})`);
    }
  }
}

if (process.argv.includes('--list')) {
  const files = [...new Set([...lengthScope, ...viewerFiles])];
  console.log(files.map(path => relative(root, path)).join('\n'));
}
if (violations.length) {
  console.error(violations.join('\n'));
  console.error(`${violations.length} format violation(s)`);
  process.exitCode = 1;
} else {
  console.log(`check-format: ${new Set([...lengthScope, ...viewerFiles]).size} files ok`);
}
