# Boolean reference ports and comparison

Status: implementation in progress, 22 September 2026. Marc authorized three
native Bend reference ports (OCCT, SolveSpace, Truck), common tests, and an
evidence-based combination of their strengths. This means an algorithmic hybrid
inside Bend. It does not authorize a production OCCT/Rust/C++ backend.

## Scope and completion criteria

The first common unit is a complete regularized halfspace clip of a closed
B-rep. The shared API is in `kernel/ports/types.bend`: immutable source geometry,
explicit curve domains, a plane, numerical tolerance and source tolerance enter;
a complete closed B-rep with face/edge provenance, Empty, or an explicit
Unresolved result leaves. Wires, diagnostics and partial shells are not success.

The variants start with bounded planar faces and straight edges and then expand
toward plane/cylinder input. This is a scoped porting program, not three complete
CAD kernels or a completed r10b claim. Existing convex clipping may serve as a
reference but must not be wrapped and relabeled as three independent ports.

Each variant must identify the pinned upstream routines and decisions it adapts,
the numerical/backend differences, unsupported cases and applicable licenses.
Shared arithmetic/serialization is acceptable; the construction algorithms must
be distinguishable. Original reference strengths and guarantees do not transfer
automatically to the Bend implementation.

## Validation and selection

Run all variants on identical inputs and record success, explicit rejection,
invalid output, topology, geometry, source immutability and separate timing.
Include analytic known-volume solids, concave faces, holes/disconnected results,
face/edge/vertex contacts, perturbations, rigid transforms and repeated cuts.
Validate actual STEP exports independently. Keep real imported r10b operands in
the comparison even while unsupported, and retain the unchanged r10b gate.

A hybrid must be selected from observed behavior, have an explicit dispatch or
shared-algorithm design, and run the same checks again. Agreement among ports
alone is not an independent correctness oracle. Unresolved must not trigger
silent approximation, tolerance enlargement or acceptance of a partial model.

The source review and initial architecture are in
[boolean-strategy.md](boolean-strategy.md). Per-port evidence and comparison
results will be linked here once available.

## First executed comparison

`node scripts/compare-boolean-ports.mjs` runs the common corpus and independent
STEP validation. The initial stable snapshot is recorded in
`out/boolean-ports/baseline/report.json`, including implementation hashes,
identical-input hashes, individual outcomes, raw warmed timing samples and
export hashes. There were 36 cases per variant:

| Variant | Valid nonempty STEP outputs | Correct empty results | Explicit unresolved | Correct invalid-input rejection | Invalid accepted output found |
|---|---:|---:|---:|---:|---:|
| OCCT adaptation | 18 | 2 | 12 | 4 | 0 |
| SolveSpace adaptation | 16 | 2 | 14 | 4 | 0 |
| Truck adaptation | 14 | 1 | 17 | 4 | 0 |

All 48 nonempty exports passed the independent STEP reader/validator. Known
reference cases also passed the independently computed volume and component
count checks. This is a finite corpus, not proof of general robustness. Unresolved
cases include three cylinders and six actual frozen P10/box planes: no imported
curved Boolean was completed by these initial variants. Invalid-source checks
do not constitute a complete 3D self-intersection validator for arbitrary shells.

Observed differences: OCCT handles tested exact vertex/edge contacts and separate
components. SolveSpace handles tested contacts but rejects disconnected output.
Truck constructs separate components but deliberately rejects contacts. Median
warmed native JS calls in this run were 3.99/3.81/2.85 ms for the transverse box
(OCCT/SolveSpace/Truck), and 7.69/unsupported/4.49 ms for the separated U shape.
These are nine-sample process-local measurements, not isolated CPU benchmarks,
upstream kernel benchmarks, startup measurements or native/GPU evidence.

Source mapping, licensing, supported domains and focused checks:
[OCCT](port-occt.md), [SolveSpace](port-solvespace.md), [Truck](port-truck.md).
The [hybrid](port-hybrid.md) has seven shared focused integration tests and a
separate [solid-intersection integration](solid-intersection.md). The exact
predicate and full-cylinder implementations have independent reviews.
The generic [curved constructor](curved-clip.md) remains separate; the baseline
variants remain available for comparison.

## Stricter comparison and export repair

The stable 37-case comparison in `out/boolean-ports/comparison/report.json`
adds a zero-volume double-sided-shell rejection and uses the exact
CurveOnSurface STEP check. All 48 planar baseline exports pass that check.
Each of the three variants rejects all five invalid inputs. The hybrid records
19 strictly valid nonempty exports, two empty results, ten unresolved cases,
five correct invalid-input rejections and **one failed oblique STEP export**.
That report is intentionally a failing comparison, not a completed hybrid gate.

The failure exposed an inaccurate pcurve reconstructed by the STEP reader.
After implementing explicit native Bend pcurves, the normal exporter now passes
all nine full-cylinder-band cases under the stronger check, including oblique,
repeated and rotated cuts. The fixed analytic 3D supports remain unchanged;
the 2D approximation has a declared budget of at most 1e-8 mm.
Evidence: `out/step-pcurves/integrated-step-validation.json` and
[STEP validation](step-validation.md).

The fresh source-stable run in `out/boolean-ports/hybrid-pcurves/report.json`
retains all 37 cases per variant. OCCT, SolveSpace and Truck have respectively
18, 16 and 14 strictly valid nonempty exports. The hybrid now has **20 strictly
valid nonempty exports, two empty results, ten unresolved cases, five correct
invalid-input rejections and zero invalid exports**. The previous failing
report remains intact. The full integrated suite passes 400/400 tests.
Timing samples in this correctness run partly overlapped the full test suite;
they are not used to establish a performance comparison.
