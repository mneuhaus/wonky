#!/usr/bin/env node
// Mutation check for the pilot batch: does kernel/laws/pilot/PROOF.bend stop
// checking when the kernel code a pilot law talks about drifts?
//
// Each mutant copies kernel/*.bend, kernel/ports/*.bend and kernel/laws/{pilot,spike}
// into tmp/laws/pilot-mutants/<name>/ (same relative layout, so imports resolve),
// applies ONE textual edit and runs the pinned checker on the copied pilot
// PROOF.bend. Production files are only read. Runs one checker at a time.
//
// When a mutant is caught, the law it is meant to be caught by is then checked
// ALONE (kernel/laws/pilot-one/ in the copy: the pilot header plus that one law
// and its proof), so "caught" is attributed to the stated law and not only to
// whichever definition the checker happened to report first. Entries marked
// "(proof only)" model drift that keeps the law true; the proof still breaks
// because a lemma mirrors the implementation.
//
// Usage: node scripts/laws/pilot-mutants.mjs [name ...]
// Writes out/laws/pilot-mutants.json and prints one line per mutant:
//   PASSES/BROKEN for the controls, CAUGHT/MISSED for the mutants,
//   plus the first failing definition reported by the checker.
import { spawnSync, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeSubset } from './pilot-split.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { version } = JSON.parse(readFileSync(join(root, 'bend.lock.json'), 'utf8'));
const bend = join(root, '.tools', `bend-${version}`, 'bin', 'bend');

// [name, file (relative to kernel/), from, to, law expected to catch it, what it models]
// from === null: unmodified control that must still check.
const mutants = [
  ['control', 'topology.bend', null, null, null, 'unmodified copy: must still check (validates the harness)'],
  ['open-law', 'laws/pilot/PROOF.bend', 'def Laws.revolve_refuses_empty(t, o, axis, x):\n  {==}\n', '',
    'revolve_refuses_empty', 'proof of one law deleted: the law becomes an open claim'],
  // group 1
  ['intersection-is-union', 'boolean.bend', 'U32.is_eq(op, 1), Bool.and(a, b),', 'U32.is_eq(op, 1), Bool.or(a, b),',
    'boolean_selected_intersection', 'op 1 computes union (survives the root laws)'],
  ['intersection-is-a', 'boolean.bend', 'U32.is_eq(op, 1), Bool.and(a, b),', 'U32.is_eq(op, 1), a,',
    'boolean_selected_intersection', 'op 1 keeps every cell of a (survives the root laws)'],
  ['difference-is-and', 'boolean.bend', 'Bool.and(a, Bool.not(b))))', 'Bool.and(a, b)))',
    'boolean_selected_difference', 'op 2 computes intersection'],
  ['union-is-xor', 'boolean.bend', 'U32.is_eq(op, 0), Bool.or(a, b),', 'U32.is_eq(op, 0), Bool.xor(a, b),',
    'boolean_selected_union', 'op 0 drops the overlap cells'],
  ['flip-identity', 'topology.bend', 'Use{edge, Bool.not(forward)}\n\ndef next', 'Use{edge, forward}\n\ndef next',
    'coedge_flip_toggles_direction', 'flip does nothing (survives the root involution law)'],
  // group 2
  ['reverse-no-flip', 'topology.bend', 'reverse_uses(tail, flip(use) <> acc)', 'reverse_uses(tail, use <> acc)',
    'reverse_uses_swaps_use_counts', 'bottom loop reversed without flipping coedge orientation'],
  ['side-wrong-vertical', 'topology.bend', 'Use{(2 * n + next(i, n) : U32), True{}}', 'Use{(2 * n + i : U32), True{}}',
    'extrude_triangle_well_formed', 'side face uses the wrong vertical edge'],
  ['next-off-by-one', 'topology.bend', 'U32.is_eq((i + 1 : U32), n)', 'U32.is_eq(i, n)',
    'extrude_triangle_well_formed', 'ring successor wraps one step late'],
  ['top-face-shares-bottom-ring', 'topology.bend', 'top = {Face{G.add(first, delta), normal, ref, ring_uses(count, n, 0)} : Face}',
    'top = {Face{G.add(first, delta), normal, ref, ring_uses(count, 0, 0)} : Face}', 'extrude_triangle_well_formed',
    'top face reuses the bottom ring edges'],
  ['transform-reverses-loops', 'topology.bend', 'G.rotate(x, rotation), boundary}', 'G.rotate(x, rotation), reverse_uses(boundary, Nil{})}',
    'transform_preserves_well_formed (proof only)', 'rigid transform reverses every loop: the LAW stays true, only its proof breaks'],
  ['frustum-seam-twice-forward', 'analytic.bend', 'T.Use{1, False{}}, T.Use{2, False{}}]}]}]}', 'T.Use{1, False{}}, T.Use{2, True{}}]}]}]}',
    'frustum_edges_closed', 'frustum side loop uses the seam twice forward'],
  ['frustum-extra-vertex', 'analytic.bend', 'Solid{[p0, p1],\n', 'Solid{[p0, p1, p1],\n',
    'frustum_euler_poincare', 'frustum publishes an unreferenced vertex'],
  ['frustum-top-cap-reversed', 'analytic.bend', '[Loop{True{}, [T.Use{1, True{}}]}]}', '[Loop{True{}, [T.Use{1, False{}}]}]}',
    'frustum_edges_closed', 'top cap walks its circle the wrong way (edge 1 used backward twice)'],
  ['revolve-loop-by-height', 'revolve.bend', 'T.Use{end_circle, False{}}', 'T.Use{end_circle, True{}}',
    'revolve_triangle_edges_closed', '8b21014 class: a circle used twice in one direction'],
  ['revolve-accepts-two-points', 'revolve.bend', 'U32.is_lt(2, U32.from_nat', 'U32.is_lt(1, U32.from_nat',
    'revolve_refuses_two_points', '9467cfb: 2-point profile admitted to the geometric checks'],
  ['revolve-empty-reason-0', 'revolve.bend', '    case Nil{}:\n      1\n', '    case Nil{}:\n      0\n',
    'revolve_refuses_empty', 'empty profile reported as admissible'],
  ['revolve-extra-vertex', 'revolve.bend', '  A.Solid{seam_points(profile, origin, axis, x),', '  A.Solid{origin <> seam_points(profile, origin, axis, x),',
    'revolve_quad_genus_one', 'revolve publishes an extra, unreferenced vertex'],
  // group 3
  ['sub-drops-negation', 'robust-predicates.bend', 'def sub(a: Big, b: Big) -> Big:\n  add(a, neg(b))', 'def sub(a: Big, b: Big) -> Big:\n  add(a, b)',
    'exact_self_difference_is_zero', 'exact subtraction forgets to negate'],
  ['make-keeps-negative-zero', 'robust-predicates.bend', 'Big{Bool.and(negative, Bool.not(empty(digits))), digits}', 'Big{negative, digits}',
    'exact_difference_normal', 'normalization keeps a negative sign on zero'],
  ['neg-keeps-sign', 'robust-predicates.bend', '  make(Bool.not(negative), digits)\n', '  make(negative, digits)\n',
    'big_sign_neg', 'negation forgets to flip the sign'],
  ['mag-cmp-finish-swapped', 'robust-predicates.bend', '      U32.cmp(a, b)\n    case _:\n      high', '      U32.cmp(b, a)\n    case _:\n      high',
    'mag_cmp_antisymmetric (proof only)', 'digit tie-break compares the wrong way round: antisymmetry still holds, only the proof breaks'],
  ['mag-add-carry-shift-11', 'robust-predicates.bend', 'digit(U32.and(sum, 4095), mag_add(at, bt, U32.shrn(sum, 12n)))', 'digit(U32.and(sum, 4095), mag_add(at, bt, U32.shrn(sum, 11n)))',
    'mag_add_exact', 'multi-limb adder carries with the wrong shift'],
  ['mag-add-drops-carry-in', 'robust-predicates.bend', '+sum = (ah + bh + carry : U32)', '+sum = (ah + bh : U32)',
    'mag_add_exact', 'multi-limb adder ignores the incoming carry'],
  ['mag-add-mask-4094', 'robust-predicates.bend', 'digit(U32.and(sum, 4095), mag_add(at, Nil{}, U32.shrn(sum, 12n)))', 'digit(U32.and(sum, 4094), mag_add(at, Nil{}, U32.shrn(sum, 12n)))',
    'mag_add_exact', 'one-sided limb loses its lowest bit'],
  ['exact-decision-tagged-filter', 'robust-predicates.bend', 'Decision{sign(dot_delta(normal, a, b)), ExactDyadic{}}', 'Decision{sign(dot_delta(normal, a, b)), FloatFilter{}}',
    'exact_decision_on_plane_origin', 'exact fallback mislabels its evidence'],
  ['point-plane-skips-normal-check', 'robust-predicates.bend', 'point_plane_valid(Bool.and(vec_valid(normal), Bool.and(vec_valid(point), vec_valid(origin))), normal, point, origin)',
    'point_plane_valid(Bool.and(vec_valid(point), vec_valid(origin)), normal, point, origin)',
    'point_plane_invalid_normal', 'an invalid normal reaches the float filter'],
  ['expansion-zero-ignores-safe', 'intersections.bend', '  Bool.and(safe, expansion_empty(words))\n', '  expansion_empty(words)\n',
    'expansion_zero_needs_safe', 'an unsafe expansion certifies zero'],
  // group 4
  ['choose-subtraction-is-union', 'ports/planar-boolean-selection.bend', 'Bool.pick(Bool, subtraction, Bool.and(ai, Bool.not(bi)), Bool.or(ai, bi))',
    'Bool.pick(Bool, subtraction, Bool.or(ai, bi), Bool.or(ai, bi))', 'planar_choose_subtraction', 'planar subtraction keeps union cells'],
  ['choose-union-is-and', 'ports/planar-boolean-selection.bend', 'Bool.pick(Bool, subtraction, Bool.and(ai, Bool.not(bi)), Bool.or(ai, bi))',
    'Bool.pick(Bool, subtraction, Bool.and(ai, Bool.not(bi)), Bool.and(ai, bi))', 'planar_choose_union', 'planar union keeps only the overlap'],
  ['choose-count-not-incremented', 'ports/planar-boolean-selection.bend', 'Bool.pick(U32, keep, 1, 0)', 'Bool.pick(U32, keep, 0, 0)',
    'planar_choose_subtraction', 'kept cells are not counted'],
  ['choose-ignores-first-validity', 'ports/planar-boolean-selection.bend', 'case Membership{True{}, +ai} Membership{True{}, +bi} Selection{+before, count}:',
    'case Membership{_, +ai} Membership{True{}, +bi} Selection{+before, count}:', 'planar_choose_rejects_invalid_first',
    'unresolved first membership treated as a decision (silent fallback)'],
  ['add-body-left-dropped', 'ports/planar-boolean.bend', '    case T.Unresolved{reason, stage, detail, budget, stats} _:\n      T.Unresolved{reason, stage, detail, budget, stats}\n',
    '    case T.Unresolved{_, _, _, _, _} other:\n      other\n', 'planar_add_body_unresolved_left', 'a failed component is replaced by the rest'],
  ['add-body-right-swallowed', 'ports/planar-boolean.bend', '    case _ T.Unresolved{reason, stage, detail, budget, stats}:\n      T.Unresolved{reason, stage, detail, budget, stats}\n',
    '    case T.Bodies{a, budget, stats} T.Unresolved{_, _, _, _, _}:\n      T.Bodies{a, budget, stats}\n', 'planar_add_body_unresolved_right',
    'earlier bodies swallow a later failure (partial result)'],
  ['hybrid-undefined-keeps-valid', 'ports/hybrid.bend', '    case Exact.Undefined{} ContactState{_, contact}:\n      ContactState{False{}, contact}',
    '    case Exact.Undefined{} ContactState{valid, contact}:\n      ContactState{valid, contact}', 'hybrid_undefined_sign_invalidates',
    'an undecidable contact sign is ignored'],
  ['hybrid-invalid-routes-cylinder', 'ports/hybrid.bend', 'CylindricalCandidate{}), InvalidRoute{})', 'CylindricalCandidate{}), CylindricalCandidate{})',
    'hybrid_invalid_contact_route', 'an invalid contact still picks a constructor route'],
  ['bounds-unknown-with-empty', 'face-bounds.bend', '    case UnknownBounds{} _:\n      UnknownBounds{}\n',
    '    case UnknownBounds{} EmptyBounds{}:\n      EmptyBounds{}\n    case UnknownBounds{} _:\n      UnknownBounds{}\n', 'bounds_join_unknown_left',
    'unknown joined with empty becomes empty (known)'],
  ['bounds-unknown-right-dropped', 'face-bounds.bend', '    case _ UnknownBounds{}:\n      UnknownBounds{}\n', '    case _ UnknownBounds{}:\n      a\n',
    'bounds_join_unknown_right', 'unknown right operand is dropped'],
  ['threshold-claims-exact', 'curve-band.bend', 'Resolved{ToleratedBand{}, evidence}', 'Resolved{ExactCurveInPlane{}, evidence}',
    'threshold_never_exact', 'a tolerance decision is published as an exact certificate'],
  // group 5
  ['transformed-renames-origin', 'identity.bend', '  EntityIdentity{origin, instance, revision, kind, role, stability, operation,\n    "rigid-transform"',
    '  EntityIdentity{key_text(key("moved", [origin, operation])), instance, revision, kind, role, stability, operation,\n    "rigid-transform"',
    'transformed_keeps_origin', 'a transform derives a new logical origin'],
  ['semantic-origin-uses-revision', 'identity.bend', '  scope = Bool.pick(String, persistent(stability), "", revision)\n  +origin = key_text(key("origin",',
    '  scope = revision\n  +origin = key_text(key("origin",', 'semantic_origin_ignores_revision', 'semantic names change with every geometry revision'],
];

const wanted = new Set(process.argv.slice(2));
const uptime = () => execFileSync('uptime', { encoding: 'utf8' }).trim();
const copyBend = (from, to) => {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) if (name.endsWith('.bend')) cpSync(join(from, name), join(to, name));
};
const results = [];
function check(cwd) {
  const start = process.hrtime.bigint();
  const run = spawnSync(bend, ['PROOF.bend', '--check-only'], {
    cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 << 20,
    env: { ...process.env, BEND_NO_TELEMETRY: '1' },
  });
  const seconds = Number((Number(process.hrtime.bigint() - start) / 1e9).toFixed(2));
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const passed = run.status === 0 && output.trim().split('\n').at(-1) === 'All terms check.';
  const location = /Location: (\S+)/.exec(output)?.[1] ?? /\d+ TODO found/.exec(output)?.[0] ?? null;
  return { caught: !passed, location, output, seconds };
}
for (const [name, file, from, to, expected, models] of mutants) {
  if (wanted.size && !wanted.has(name)) continue;
  const dir = join(root, 'tmp/laws/pilot-mutants', name);
  rmSync(dir, { recursive: true, force: true });
  copyBend(join(root, 'kernel'), join(dir, 'kernel'));
  copyBend(join(root, 'kernel/ports'), join(dir, 'kernel/ports'));
  cpSync(join(root, 'kernel/laws/pilot'), join(dir, 'kernel/laws/pilot'), { recursive: true });
  cpSync(join(root, 'kernel/laws/spike'), join(dir, 'kernel/laws/spike'), { recursive: true });
  const target = join(dir, 'kernel', file);
  const source = readFileSync(target, 'utf8');
  if (from !== null) {
    const count = source.split(from).length - 1;
    if (count !== 1) throw new Error(`${name}: expected exactly one match in kernel/${file}, found ${count}`);
    writeFileSync(target, source.replace(from, to));
  }
  const before = uptime();
  const full = check(join(dir, 'kernel/laws/pilot'));
  const law = expected?.split(' ')[0];
  let alone = null;
  if (full.caught && law && name !== 'open-law') {
    writeSubset(join(dir, 'kernel/laws/pilot'), join(dir, 'kernel/laws/pilot-one'), [law]);
    alone = check(join(dir, 'kernel/laws/pilot-one'));
  }
  const record = { name, file: `kernel/${file}`, models, expected, caught: full.caught, location: full.location,
    caughtByExpectedLawAlone: alone ? alone.caught : null, aloneLocation: alone?.location ?? null,
    firstError: full.output.split('\n').slice(0, 4).join('\n').slice(0, 600), seconds: full.seconds, uptime: before };
  results.push(record);
  const verdict = from === null ? (record.caught ? 'BROKEN ' : 'PASSES ') : (record.caught ? 'CAUGHT ' : 'MISSED ');
  const attributed = alone === null ? '' : alone.caught ? `  alone: ${law} fails (${alone.location})` : `  alone: ${law} STILL CHECKS`;
  console.log(`${verdict} ${name.padEnd(32)} ${String(full.location).padEnd(50)} ${full.seconds}s${attributed}`);
}
mkdirSync(join(root, 'out/laws'), { recursive: true });
writeFileSync(join(root, 'out/laws/pilot-mutants.json'), JSON.stringify(results, null, 2) + '\n');
