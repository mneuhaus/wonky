# Boolean stress corpus

Run `node scripts/boolean-stress.mjs --full --out out/boolean-stress/current`.
The process exits 1 while any selected case is unsupported, incorrect, or lacks
independent validation. A test of the runner itself passing is not full coverage
of the geometry corpus.

The first corpus has 34 complete solid/solid operations:

- Concave comb prisms with 2, 4, 8, 16 and 32 teeth, cut below, on and above their
  reflex vertices and close to the tooth tips. Connected input may yield up to
  32 separate bodies. Expected volumes and component counts are analytical.
- Operand reversal and rigid transformation of a multicomponent case.
- Analytic cylinder sections, including cuts close to tangency. Cylinders remain
  analytic; deliberately faceted comb profiles are represented as authored.
- Actual frozen r10b `g7` operands, with overlapping coplanar top faces and a
  concave profile. UNION and SUBTRACTION have independent volume expectations.

Requested and represented F32 cut positions are recorded separately. The
expected volumes use the actual represented inputs. This exposes input precision
without misreporting a rounded parameter as a distinct representable case.

`fixtures/boolean-stress/provenance.json` binds the actual operand snapshot to
the unchanged original FeatureScript and its hash. For `g7`, the box has volume
47023.20153808594 mm³; the added prism has profile area 1156 mm² and thickness
4.790000915527344 mm. Their common profile area is 120 mm². Consequently UNION
must produce one body of 51985.642486572266 mm³. Those operands are not replaced
with an easier version.

The report separates native resolved results, unsupported capabilities, wrong
reference results and invalid exports. STEP checking uses the project's strict
independent validator. Geometry production stays in Bend. Source/fixture hashes,
source stability, topology counts, actual volumes and individual error stages
are retained. The run removes its selected cases' stale exports before execution.

Times for kernel loading, input preparation, Boolean plus validation, STEP
serialization and independent reader validation are separate. The measured
Boolean phase includes JavaScript interop and native audits; it is not a pure
native arithmetic measurement. Single-run observations under current system load
do not establish a hardware speedup or a comparison against another kernel.

Baseline: `out/boolean-stress/baseline/report.json` has **32 independently valid
results, two unsupported operations, zero incorrect accepted results**. The two
unsupported cases are the real r10b UNION and SUBTRACTION. The implementation
hash in that report identifies the run; later changes need new evidence.

Public upstream regression sources and the separate CADBench pilot are described
in [cadbench.md](cadbench.md). Future corpus additions should retain the full
original challenge and oracle, including holes, enclosed cavities, shared faces,
tiny empty gaps, thin retained walls and repeated operations. Any minimization
keeps the original failure as well as the reduced reproducer.
