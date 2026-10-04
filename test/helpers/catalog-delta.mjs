import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {ROOT, catalogBySha} from '../../scripts/acid/common.mjs';

// Delta-scoped catalog package checks. A package is one zones.json history
// entry; it is bound to the exact frozen catalog it was based on
// (previousSha256) and to the frozen catalog it produced (the archived
// catalog-history snapshot whose history is the base history plus that entry).
// Its scope is the zones it declares as added, amended or withdrawn. A package
// test checks that scope only, so later packages may add or amend other zones
// without breaking it, while any undeclared change to its own zones fails.

const HISTORY_DIR = path.join(ROOT, 'fixtures/cad-acid/catalog-history');
const byId = (catalog, id) => catalog.zones.find(z => z.id === id);
const ids = catalog => catalog.zones.map(z => z.id);

export function packageScope(entry) {
  const [added, amended, withdrawn] = ['addedZones', 'amendedZones', 'withdrawnZones'].map(k => entry[k] ?? []);
  return {added, amended, withdrawn, all: new Set([...added, ...amended, ...withdrawn])};
}

// The base and post-change catalogs of the package recorded under `version`
// in the live catalog, both recovered with their exact archived bytes.
export function packageCatalogs(catalog, version) {
  const index = catalog.history.findIndex(h => h.version === version);
  assert.ok(index >= 0, `${version}: history entry`);
  const entry = catalog.history[index];
  const base = catalogBySha(entry.previousSha256);
  assert.ok(base, `${version}: frozen base catalog ${entry.previousSha256}`);
  const history = [...base.history, entry];
  const after = fs.readdirSync(HISTORY_DIR).filter(f => /^[a-f0-9]{64}\.json$/.test(f))
    .map(f => catalogBySha(f.slice(0, 64))).filter(c => isDeepStrictEqual(c.history, history));
  assert.equal(after.length, 1, `${version}: exactly one archived post-change catalog`);
  return {index, entry, base, after: after[0]};
}

// At the time of the change: the package touched exactly its declared zones,
// left every other zone, the catalog's other fields and the zone order intact,
// and only grew groups by its own zones.
export function assertScopedChange(base, after, entry) {
  const scope = packageScope(entry), v = entry.version;
  for (const id of scope.added) assert.ok(!byId(base, id) && byId(after, id), `${v}: ${id} added`);
  for (const id of scope.amended) assert.ok(byId(base, id) && byId(after, id) && !isDeepStrictEqual(byId(base, id), byId(after, id)), `${v}: ${id} amended`);
  for (const id of scope.withdrawn) assert.ok(byId(base, id) && !byId(after, id), `${v}: ${id} withdrawn`);
  for (const z of base.zones) if (!scope.all.has(z.id)) assert.deepEqual(byId(after, z.id), z, `${v}: ${z.id} outside scope`);
  assert.deepEqual(ids(after).filter(id => !scope.all.has(id)), ids(base).filter(id => !scope.all.has(id)), `${v}: zone order outside scope`);
  assert.deepEqual(ids(after).filter(id => !byId(base, id)).sort(), [...scope.added].sort(), `${v}: no undeclared zones`);
  const {version: _a, groups: ga, zones: _za, history: _ha, ...restAfter} = after;
  const {version: _b, groups: gb, zones: _zb, history: _hb, ...restBase} = base;
  assert.deepEqual(restAfter, restBase, `${v}: catalog fields outside zones`);
  // A group may list its member zones in several places (zoneIds, enum values).
  const strip = x => Array.isArray(x) ? x.filter(e => !scope.all.has(e)).map(strip)
    : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, e]) => [k, strip(e)])) : x;
  for (const g of gb) assert.deepEqual(strip(ga.find(n => n.id === g.id)), strip(g), `${v}: group ${g.id}`);
  for (const g of ga.filter(g => !gb.some(n => n.id === g.id))) assert.ok(g.zoneIds.every(id => scope.added.includes(id)), `${v}: new group ${g.id}`);
}

// In the live catalog: the package's own zones still carry the exact
// post-change contract unless a later history entry declares that it amends,
// withdraws or re-adds them. Other zones are not this package's concern.
export function assertOwnZonesLive(catalog, {index, entry, after}) {
  const scope = packageScope(entry);
  assertZonesLiveSince(catalog, after, index, [...scope.added, ...scope.amended], entry.version);
  const redeclared = laterDeclared(catalog, index);
  for (const id of scope.withdrawn) if (!redeclared(id)) assert.equal(byId(catalog, id), undefined, `${entry.version}: ${id} stays withdrawn`);
}

const laterDeclared = (catalog, index) => {
  const later = catalog.history.slice(index + 1).map(packageScope);
  return id => later.some(s => s.all.has(id));
};

// The zones `ids` of a frozen catalog, recorded at live history position
// `index`, are unchanged in the live catalog (optionally only the projection
// `pick`) unless a later history entry declares them.
export function assertZonesLiveSince(catalog, frozen, index, ids, label, pick = z => z) {
  const redeclared = laterDeclared(catalog, index);
  for (const id of ids) {
    if (!redeclared(id)) assert.deepEqual(pick(byId(catalog, id)), pick(byId(frozen, id)), `${label}: ${id} undeclared later change`);
  }
}

export function assertPackageDelta(catalog, version, declared) {
  const pkg = packageCatalogs(catalog, version), scope = packageScope(pkg.entry);
  for (const k of ['added', 'amended', 'withdrawn']) assert.deepEqual(scope[k], declared[k] ?? [], `${version}: declared ${k}`);
  assertScopedChange(pkg.base, pkg.after, pkg.entry);
  assertOwnZonesLive(catalog, pkg);
  return pkg;
}
