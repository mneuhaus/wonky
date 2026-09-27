#!/usr/bin/env node
// Kernel change proposals from docs/laws/pilot.md, each checked on a COPY.
// Production code is not changed. For every proposal the script copies
// kernel/*.bend, kernel/ports/*.bend and kernel/laws/spike/ to
// tmp/laws/proposal-<id>/, applies the proposed edit to the copy, writes the
// laws the edit makes provable (kernel/laws/<id>/ in the copy) and runs the
// pinned checker. The edit is saved as a unified diff next to it.
//
//   K-1  boolean.bend: refuse unknown op codes (BOO-05) instead of computing a difference
//   K-2  topology.bend: extrude_checked refuses profiles with fewer than 3 points
//
// Usage: node scripts/laws/kernel-proposals.mjs [k1|k2 ...]   (exit 0 iff every proposal checks)
import { spawnSync, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { version } = JSON.parse(readFileSync(join(root, 'bend.lock.json'), 'utf8'));
const bend = join(root, '.tools', `bend-${version}`, 'bin', 'bend');

const once = (source, from, to, what) => {
  if (source.split(from).length !== 2) throw new Error(`${what}: anchor not found exactly once; update the proposal`);
  return source.replace(from, to);
};

const proposals = {
  k1: {
    file: 'boolean.bend',
    edit(source) {
      const head = 'def coaxial(+a0: G.Vec3, +a1: G.Vec3, +ra: R.Real, +b0: G.Vec3, +b1: G.Vec3, +rb: R.Real, +op: U32) -> BooleanResult:\n';
      if (!/bodies\(components\(6n, material\)[^\n]*\n$/.test(source)) throw new Error('k1: coaxial is no longer the last def; update the proposal');
      return once(source, head, head.replace('def coaxial', 'def arrangement'), 'k1') + `
# Op codes: 0 union, 1 intersection, 2 difference. Any other code is refused
# (supported = False) instead of being evaluated as a difference.
def admit(+op: U32, result: BooleanResult) -> BooleanResult:
  BooleanResult{supported, enclosed_void, bodies} = result
  BooleanResult{Bool.and(U32.is_lt(op, 3), supported), enclosed_void, bodies}

def coaxial(+a0: G.Vec3, +a1: G.Vec3, +ra: R.Real, +b0: G.Vec3, +b1: G.Vec3, +rb: R.Real, +op: U32) -> BooleanResult:
  admit(op, arrangement(a0, a1, ra, b0, b1, rb, op))
`;
    },
    laws: `import Base
import ../../precise.bend as PG
import ../../real.bend as R
import ../../boolean.bend as B

def supported(r: B.BooleanResult) -> Bool:
  B.BooleanResult{s, _, _} = r
  s

law boolean_refuses_unknown_op:
  for +op: U32
  for +r: B.BooleanResult
  for h: {U32.is_lt(op, 3) == False{} : Bool}
  {supported(B.admit(op, r)) == False{} : Bool}

law boolean_known_op_passes_through:
  for +op: U32
  for +r: B.BooleanResult
  for h: {U32.is_lt(op, 3) == True{} : Bool}
  {supported(B.admit(op, r)) == supported(r) : Bool}

law coaxial_is_admitted:
  for +a0: PG.Vec3
  for +a1: PG.Vec3
  for +ra: R.Real
  for +b0: PG.Vec3
  for +b1: PG.Vec3
  for +rb: R.Real
  for +op: U32
  {B.coaxial(a0, a1, ra, b0, b1, rb, op) == B.admit(op, B.arrangement(a0, a1, ra, b0, b1, rb, op)) : B.BooleanResult}
`,
    proof: `import Base
import ./LAWS.bend as Laws
import ../../boolean.bend as B

def Laws.boolean_refuses_unknown_op(op, r, h):
  match r:
    case B.BooleanResult{s, v, bs}:
      %Equal.sym(Bool, U32.is_lt(op, 3), False{}, h) : {Bool.and(_, s) == False{} : Bool}
      {==}

def Laws.boolean_known_op_passes_through(op, r, h):
  match r:
    case B.BooleanResult{s, v, bs}:
      %Equal.sym(Bool, U32.is_lt(op, 3), True{}, h) : {Bool.and(_, s) == s : Bool}
      {==}

def Laws.coaxial_is_admitted(a0, a1, ra, b0, b1, rb, op):
  {==}
`,
  },
  k2: {
    file: 'topology.bend',
    edit(source) {
      const anchor = 'def transform_faces(';
      return once(source, anchor, `type Extruded is Data:
  Built{solid: Solid}
  Refused{reason: U32}

# A profile needs at least three points. Shorter profiles are refused with
# reason 1 instead of producing an ill-formed solid.
def extrude_checked(+points: List<&2, G.Vec3>, +delta: G.Vec3) -> Extruded:
  Bool.pick(Extruded, Nat.is_ge(List.length(&2, G.Vec3, points), 3n), Built{extrude(points, delta)}, Refused{1})

${anchor}`, 'k2');
    },
    laws: `import Base
import ../../geometry.bend as G
import ../../topology.bend as T
import ../spike/topology-spec.bend as W

def built_ok(e: T.Extruded) -> Bool:
  match e:
    case T.Built{s}:
      W.solid_ok(s)
    case T.Refused{_}:
      False{}

law extrude_refuses_short_profiles:
  for +points: List<&2, G.Vec3>
  for +delta: G.Vec3
  for h: {Nat.is_ge(List.length(&2, G.Vec3, points), 3n) == False{} : Bool}
  {T.extrude_checked(points, delta) == T.Refused{1} : T.Extruded}

law extrude_checked_triangle_well_formed:
  for +a: G.Vec3
  for +b: G.Vec3
  for +c: G.Vec3
  for +delta: G.Vec3
  {built_ok(T.extrude_checked([a, b, c], delta)) == True{} : Bool}

law extrude_checked_quad_well_formed:
  for +a: G.Vec3
  for +b: G.Vec3
  for +c: G.Vec3
  for +d: G.Vec3
  for +delta: G.Vec3
  {built_ok(T.extrude_checked([a, b, c, d], delta)) == True{} : Bool}
`,
    proof: `import Base
import ./LAWS.bend as Laws
import ../../geometry.bend as G
import ../../topology.bend as T

def Laws.extrude_refuses_short_profiles(points, delta, h):
  %Equal.sym(Bool, Nat.is_ge(List.length(&2, G.Vec3, points), 3n), False{}, h) :
    {Bool.pick(T.Extruded, _, T.Built{T.extrude(points, delta)}, T.Refused{1}) == T.Refused{1} : T.Extruded}
  {==}

def Laws.extrude_checked_triangle_well_formed(a, b, c, delta):
  {==}

def Laws.extrude_checked_quad_well_formed(a, b, c, d, delta):
  {==}
`,
  },
};

const wanted = process.argv.slice(2);
let failed = 0;
for (const [id, p] of Object.entries(proposals)) {
  if (wanted.length && !wanted.includes(id)) continue;
  const work = join(root, `tmp/laws/proposal-${id}`);
  rmSync(work, { recursive: true, force: true });
  for (const sub of ['', 'ports', 'laws/spike']) {
    mkdirSync(join(work, 'kernel', sub), { recursive: true });
    for (const name of readdirSync(join(root, 'kernel', sub))) if (name.endsWith('.bend')) cpSync(join(root, 'kernel', sub, name), join(work, 'kernel', sub, name));
  }
  const target = join(work, 'kernel', p.file);
  writeFileSync(target, p.edit(readFileSync(target, 'utf8')));
  const diff = spawnSync('diff', ['-u', '--label', `a/kernel/${p.file}`, '--label', `b/kernel/${p.file}`, join(root, 'kernel', p.file), target], { encoding: 'utf8' });
  writeFileSync(join(work, `${p.file.replace('.bend', '')}.diff`), diff.stdout);
  const laws = join(work, 'kernel/laws', id);
  mkdirSync(laws, { recursive: true });
  writeFileSync(join(laws, 'LAWS.bend'), p.laws);
  writeFileSync(join(laws, 'PROOF.bend'), p.proof);
  const before = execFileSync('uptime', { encoding: 'utf8' }).trim();
  const start = process.hrtime.bigint();
  const run = spawnSync(bend, ['PROOF.bend', '--check-only'], { cwd: laws, encoding: 'utf8', timeout: 300_000, env: { ...process.env, BEND_NO_TELEMETRY: '1' } });
  const seconds = (Number(process.hrtime.bigint() - start) / 1e9).toFixed(2);
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const ok = run.status === 0 && output.trim().split('\n').at(-1) === 'All terms check.';
  if (!ok) { failed++; console.log(output.split('\n').slice(0, 30).join('\n')); }
  console.log(`proposal ${id.toUpperCase()}: ${(p.laws.match(/^law /gm) ?? []).length} laws, ${ok ? 'All terms check.' : 'REJECTED'} (${seconds} s, ${before}); diff: tmp/laws/proposal-${id}/${p.file.replace('.bend', '')}.diff`);
}
process.exit(failed ? 1 : 0);
