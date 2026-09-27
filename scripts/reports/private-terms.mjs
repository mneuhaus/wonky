// Private terms (client/customer/company/account names) that must never reach public output.
// The list lives outside the repository; the public tree contains no term.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const PRIVATE_TERMS_FILE = process.env.WONKY_PRIVATE_TERMS ?? join(homedir(), '.config/wonky/private-terms.txt');

export function loadPrivateTerms(file = PRIVATE_TERMS_FILE) {
  if (!existsSync(file)) {
    if (process.env.WONKY_REQUIRE_PRIVATE_TERMS === '1') throw new Error(`private terms file missing: ${file}`);
    return [];
  }
  return readFileSync(file, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Fresh RegExp per call: no shared lastIndex state between test() and replace().
export function privateTermPattern(terms = loadPrivateTerms(), flags = 'i') {
  return terms.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.map(escape).join('|')})(?![\\p{L}\\p{N}])`, `${flags}u`) : null;
}
// Never echo the matched term: error text ends up in CI logs.
export function assertNoPrivateTerms(text, label, pattern = privateTermPattern()) {
  if (pattern) pattern.lastIndex = 0;
  if (pattern?.test(text)) throw new Error(`Private term (local list) in ${label}`);
}
export function redactPrivateTerms(text, replacement, pattern = privateTermPattern(undefined, 'gi')) {
  return pattern ? text.replace(pattern, replacement) : text;
}
