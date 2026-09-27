// Cluster fs-needs-partstudio-input: per-file blocker ladder.
// Merges
//   out/corpus/cluster-fs-needs-partstudio-input.json          level 0 (the guard) and level 1 (stand-in seeded next blocker)
//   out/corpus/fs-needs-partstudio-input/deep-next-blocker-pass-all.jsonl    level 2: first blocker that is not a Boolean
//   out/corpus/fs-needs-partstudio-input/deep-next-blocker-hybrid-all.jsonl  level 2': bake-off corefine+recover route
// into out/corpus/fs-needs-partstudio-input/files.json and prints the tallies.
//   node scripts/corpus/fs-needs-partstudio-input/summarize.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = 'out/corpus/fs-needs-partstudio-input';
const base = JSON.parse(readFileSync('out/corpus/cluster-fs-needs-partstudio-input.json', 'utf8'));
const jsonl = file => readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const passAll = jsonl(`${DIR}/deep-next-blocker-pass-all.jsonl`);
const hybrid = jsonl(`${DIR}/deep-next-blocker-hybrid-all.jsonl`);
// Each cluster file has exactly one unit in this cluster (51 units, 51 files), so
// the join is by path; the base file stores feature null for single-feature files.
const byPath = rows => new Map(rows.filter(r => !r.meta).map(r => [r.path, r]));
const P = byPath(passAll), H = byPath(hybrid);

// Owner of a blocker message, by the corpus run's cluster keys (docs/corpus/run.md section 3).
const OWNERS = [
  [/Native planar arrangement .* InvalidTopology \(stage 1/, 'boolean-invalid-topology (F32 operands)'],
  [/Native planar arrangement|convex-tool intersection|general trimmed-face|opBoolean supports coaxial|currently requires two tools|through hole needs/, 'boolean-capability'],
  [/SelfIntersectionOrTouch|collinear|Plane frame is not orthonormal|opLoft currently requires/, 'kernel-sketch-and-ops'],
  [/is not defined or not implemented/, 'fs-missing-builtin'],
  [/Bend Real serialization/, 'kernel-sketch-and-ops (pierce-after-copy crash, next-pierce-after-copy.fs)'],
  [/Tight bounds over analytic imported faces|Volume integration over analytic imported faces/, 'library: ev* over analytic topology'],
  [/Expected '\(', found '\{'/, 'fs-parser-syntax (catch without binding)'],
  [/unitless|vector/, 'fs-interpreter-semantics'],
];
const owner = message => OWNERS.find(([re]) => re.test(String(message ?? '')))?.[1] ?? 'model check / stand-in (indicative)';
const level = r => r ? {
  ok: r.ok === true, bodies: r.bodies ?? null, operation: r.failedOperation?.name ?? null, line: r.line ?? null,
  message: r.ok ? null : String(r.message ?? r.stage ?? '').slice(0, 220), owner: r.ok ? null : owner(r.message),
  completed: r.completed ?? null, booleanCalls: r.booleanCalls ?? null,
  stubbedBooleans: r.stubbedBooleans?.length ?? 0,
  hybridBuilt: r.stubbedBooleans?.filter(s => s.kind === 'hybrid' && !s.refused).length ?? 0,
  hybridRefused: r.stubbedBooleans?.find(s => s.kind === 'hybrid' && s.refused)?.refused ?? null,
  possiblyStubArtifact: r.possiblyStubArtifact ?? false,
} : null;

const files = base.files.map(f => {
  const key = f.path;
  const l1 = f.probe ? { ok: f.probe.ok, operation: f.probe.nextOperation, line: f.probe.nextLine, message: f.probe.nextMessage,
    owner: f.probe.ok ? null : owner(f.probe.nextMessage), seed: f.probe.seed, stubs: f.probe.stubs, seedIndependent: f.probe.seedIndependent } : null;
  return { path: f.path, feature: f.feature, family: f.family, lineage: f.lineage, firstBlocker: f.firstBlocker,
    level1: l1, level2PassAll: level(P.get(key)), level2Hybrid: level(H.get(key)) };
});
const tally = pick => files.reduce((m, f) => { const k = pick(f); if (k) m[k] = (m[k] ?? 0) + 1; return m; }, {});
const summary = {
  schema: 'wonky-corpus-cluster-ladder/1', cluster: 'fs-needs-partstudio-input', generatedAt: new Date().toISOString(),
  sources: ['out/corpus/cluster-fs-needs-partstudio-input.json', `${DIR}/deep-next-blocker-pass-all.jsonl`, `${DIR}/deep-next-blocker-hybrid-all.jsonl`],
  note: 'Levels past the guard use stand-in parts (tmp/corpus/cluster-partstudio/seeds/standins.fs) and, for level 2, Boolean stubs; they rank work, they are not builds.',
  tallies: {
    firstBlockerCorrect: tally(f => f.firstBlocker?.correctCluster),
    level1Owner: tally(f => f.level1 && (f.level1.ok ? 'ok' : f.level1.owner)),
    level2PassAllOwner: tally(f => f.level2PassAll && (f.level2PassAll.ok ? 'ok' : f.level2PassAll.owner)),
    level2HybridOwner: tally(f => f.level2Hybrid && (f.level2Hybrid.ok ? 'ok' : f.level2Hybrid.owner)),
  },
  files,
};
writeFileSync(`${DIR}/files.json`, JSON.stringify(summary, null, 1) + '\n');
console.log(JSON.stringify(summary.tallies, null, 1));
