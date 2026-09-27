# GEOS/JTS XML test suite and GEOS OSS-Fuzz target

- Kind: declarative regression corpus, Java/C++ test runners and C fuzz harnesses. Canonical [GEOS testing documentation](https://libgeos.org/project/development/tests/); [GEOS XML runner](https://github.com/libgeos/geos/tree/main/tests/xmltester), [fuzz targets](https://github.com/libgeos/geos/tree/main/tests/fuzz), [OSS-Fuzz integration](https://github.com/google/oss-fuzz/tree/master/projects/geos), [JTS](https://github.com/locationtech/jts).
- Organizations/authors: GEOS/OSGeo contributors, LocationTech JTS (originally Vivid Solutions), Google OSS-Fuzz. Ongoing development; project-specific OSS-Fuzz Dockerfile copyright begins in 2021. DOCUMENTED in linked repositories.
- Licensing: GEOS LGPL-2.1; OSS-Fuzz integration Apache-2.0. Important correction: [JTS LICENSES.md](https://github.com/locationtech/jts/blob/master/LICENSES.md) explicitly offers **either EPL-2.0 or EDL-1.0**, the latter BSD-style, with separately identified GeoTools material under OSGeo BSD. JTS is not necessarily copyleft. INFERRED: format ideas can be independently implemented; code or fixtures require per-file provenance and retained notices, but suitable JTS material can be reused under the permissive option. A GEOS-hosted fixture is not automatically covered by JTS licensing.
- Activity snapshot, 2026-09-24: DOCUMENTED [GEOS API](https://api.github.com/repos/libgeos/geos): C++, size 112280 KiB, 1507 stars, 106 contributor records including anonymous, latest commit [ae9cdd98be4e0bae552b918d4d14c94a9ce99c58](https://github.com/libgeos/geos/commit/ae9cdd98be4e0bae552b918d4d14c94a9ce99c58), 2026-09-21; [3.15.0 release](https://github.com/libgeos/geos/releases/tag/3.15.0), 2026-09-01. [JTS API](https://api.github.com/repos/locationtech/jts): Java, size 45928 KiB, 2237 stars, 63 contributor records; latest commit [3ea61f8cf2103f454c9cf3962df75fb6ef3ebecd](https://github.com/locationtech/jts/commit/3ea61f8cf2103f454c9cf3962df75fb6ef3ebecd), 2026-09-23; latest [1.20.0 release](https://github.com/locationtech/jts/releases/tag/1.20.0), 2024-08-30. Both active, mature libraries. Counts obtained from paginated `/contributors?per_page=100&anon=true`. Sizes are GitHub repository metrics, not source LOC.
- Ancillary [OSS-Fuzz API](https://api.github.com/repos/google/oss-fuzz): Shell is primary language, size 53178 KiB, 12667 stars, 1317 contributor records, latest default-branch commit [e3b9558f4c6126c1228b7f20a0270d4ff1f0f2fd](https://github.com/google/oss-fuzz/commit/e3b9558f4c6126c1228b7f20a0270d4ff1f0f2fd), 2026-09-22; no release returned by releases endpoint. Whole-project metrics are not GEOS-specific fuzzing activity.

## What it is

DOCUMENTED: portable XML cases express operands as WKT/WKB, an operation name and arguments, and expected Boolean, scalar or geometry results. GEOS docs explicitly call the suite portable between GEOS and JTS. It is a useful *architecture* for backend-independent testing, but **the current runners do not have identical oracle semantics**. [Docs](https://libgeos.org/project/development/tests/), [GEOS implementation at inspected revision](https://github.com/libgeos/geos/blob/ae9cdd98be4e0bae552b918d4d14c94a9ce99c58/tests/xmltester/XMLTester.cpp), [JTS TestReader](https://github.com/locationtech/jts/blob/3ea61f8cf2103f454c9cf3962df75fb6ef3ebecd/modules/tests/src/main/java/org/locationtech/jtstest/testrunner/TestReader.java).

DOCUMENTED local inventory at the pinned GEOS revision: **176 .xml files**, not the brief's 184, under `tests/xmltester/tests`; only **14 files** contain `<tolerance>`. A tolerance declaration is optional, not present in every run. These counts can be reproduced from the [tree](https://github.com/libgeos/geos/tree/ae9cdd98be4e0bae552b918d4d14c94a9ce99c58/tests/xmltester/tests); no test execution was performed.

## How it works

### Declarative corpus and actual tolerance semantics

DOCUMENTED [issue-derived fixture](https://github.com/libgeos/geos/blob/ae9cdd98be4e0bae552b918d4d14c94a9ce99c58/tests/xmltester/tests/robust/overlay/TestOverlay-geos-837.xml): run description links original ticket 837, declares `<tolerance>1</tolerance>`, supplies a large geometry A, and expects `<op name="unionArea" arg1="A">9709811.15121037</op>`. In GEOS, this operation calls unary `OverlayNGRobust::Union(A)->getArea()`, not binary union of A and B. The fixture combines immutable input, expected measurement and bug provenance.

DOCUMENTED JTS: `TestReader.parseTolerance` defaults to 0, reads the optional run-level value and passes it to every Test. `DoubleResult.equals` uses absolute error `abs(actual-expected) <= tolerance`. `GeometryResult.equals` clones and normalizes both geometries, then calls `equalsExact(other, tolerance)`: canonical component/ring ordering plus coordinatewise comparison, **not arbitrary geometric-set equality**. Binary predicate results do not get a numeric epsilon. [TestReader](https://github.com/locationtech/jts/blob/3ea61f8cf2103f454c9cf3962df75fb6ef3ebecd/modules/tests/src/main/java/org/locationtech/jtstest/testrunner/TestReader.java), [DoubleResult](https://github.com/locationtech/jts/blob/3ea61f8cf2103f454c9cf3962df75fb6ef3ebecd/modules/tests/src/main/java/org/locationtech/jtstest/testrunner/DoubleResult.java), [GeometryResult](https://github.com/locationtech/jts/blob/3ea61f8cf2103f454c9cf3962df75fb6ef3ebecd/modules/tests/src/main/java/org/locationtech/jtstest/testrunner/GeometryResult.java).

DOCUMENTED GEOS: `parseRun` reads precisionModel, geometryOperation and cases, but **does not parse `<tolerance>`** in the inspected implementation. `Test::checkResult(double)` special-cases zero, NaN and exact equality; otherwise uses `abs(expected-actual)/expected < 1e-3`. Thus the 837 scalar oracle effectively allows roughly 9709.8 area units, not the declared absolute tolerance 1. INFERRED from the literal formula: a negative finite expected value can also produce a negative ratio and accidentally accept a large error. Do not copy this oracle. Default non-curved geometry matching normalizes and uses `compareTo == 0`; union matching instead allows topological equality or size-based snapping tolerance. The code itself notes empty-type false equivalences. Input/output validity testing defaults false. [XMLTester.cpp](https://github.com/libgeos/geos/blob/ae9cdd98be4e0bae552b918d4d14c94a9ce99c58/tests/xmltester/XMLTester.cpp).

DOCUMENTED additional semantic oracle: `overlayareatest` computes union U, intersection I, differences Dab and Dba, and symmetric difference SD. It checks the largest absolute residual among `A=I+Dab`, `B=I+Dba`, `SD=Dab+Dba`, `U=I+SD`, `U=I+Dab+Dba`, divided by `area(A)+area(B)`, against 1e-6. This is a useful metamorphic test already present in XMLTester, not in the fuzz target. INFERRED: a port needs explicit zero-denominator/non-finite handling and checks beyond area because spatially wrong sets can have the right area. [areaDelta and overlayareatest](https://github.com/libgeos/geos/blob/ae9cdd98be4e0bae552b918d4d14c94a9ce99c58/tests/xmltester/XMLTester.cpp).

DOCUMENTED buffer comparison uses symmetric-difference area **and** a densified oriented discrete Hausdorff distance between boundaries (`densifyFraction=0.25`). Comments acknowledge tiny boundary tears can escape area-only comparison. This is still a sampled distance, not a certified continuous Hausdorff bound. [BufferResultMatcher.cpp](https://github.com/libgeos/geos/blob/ae9cdd98be4e0bae552b918d4d14c94a9ce99c58/tests/xmltester/BufferResultMatcher.cpp).

### Fuzz input encoding and coverage

DOCUMENTED [fuzz_geo_ops.c](https://github.com/libgeos/geos/blob/ae9cdd98be4e0bae552b918d4d14c94a9ce99c58/tests/fuzz/fuzz_geo_ops.c):

1. Require at least two bytes. Byte 0 chooses WKB when its low bit is one, otherwise null-terminate the remainder as WKT; failed parsing returns normally.
2. Reuse bits to generate width `(Data[1]-128)/16`, tolerance `(selector>>1)/8`, segment count `(selector&7)+1`, style `(selector%3)+1`, clip range equal to body byte length. Numeric parameters therefore correlate with serialized geometry bytes.
3. Call buffer/styled buffer/offset, hulls, minimum rectangles/width, simplifiers, Delaunay/Voronoi, MakeValid, unary union, clipping, node/boundary/centroid/interior-point/reverse, distance to self, nearest points, area/length/clearance and validity. Destroy outputs.
4. **Discard every semantic result**. In particular GEOSisValid's return is ignored; scalar values are not asserted; failed operations can return null without failing the test. Error callbacks only write to `/dev/null`, despite one callback's name `log_and_exit`.

DOCUMENTED [fuzz_geo2.c](https://github.com/libgeos/geos/blob/ae9cdd98be4e0bae552b918d4d14c94a9ce99c58/tests/fuzz/fuzz_geo2.c) supplies binary operations: split input at a NUL byte, parse the prefix as WKT and suffix as WKB, call intersection/difference/union and serialization, then discard outputs. A third target fuzzes GeoJSON. CMake builds targets only if `LIB_FUZZING_ENGINE` exists. [Fuzz CMake](https://github.com/libgeos/geos/blob/ae9cdd98be4e0bae552b918d4d14c94a9ce99c58/tests/fuzz/CMakeLists.txt).

DOCUMENTED [OSS-Fuzz project.yaml](https://github.com/google/oss-fuzz/blob/e3b9558f4c6126c1228b7f20a0270d4ff1f0f2fd/projects/geos/project.yaml) enables address/undefined sanitizers and AFL, Honggfuzz, libFuzzer. [build.sh](https://github.com/google/oss-fuzz/blob/e3b9558f4c6126c1228b7f20a0270d4ff1f0f2fd/projects/geos/build.sh) builds static GEOS, copies fuzz executables, and explicitly packages only the GeoJSON dictionary/seed corpus. The checked-out repository also contains a geo_ops seed directory; this inspected integration script does not package it. No build or fuzzing was run here.

## Robustness and guarantees

DOCUMENTED: these fuzz targets are crash/sanitizer/termination stressors, **not Boolean-correctness oracles**. The XML suite does have semantic expectations and some metamorphic checks, but runner differences, sampling, optional validity checking, and permissive equality rules weaken any claim of cross-implementation equivalence. Source citations are the implementations above.

INFERRED: independent implementations can share both fixtures and a faulty assumption. GEOS is derived from JTS algorithms, so agreement between them is not fully independent evidence. Use a mix of exact small cases, analytic expectations, set-algebra properties and cross-backend comparisons. A decimal golden value is only as meaningful as its units, input quantization and explicit error contract.

## Parallelism and performance

DOCUMENTED: docs list unit, XML, memory and performance harnesses but give no measured throughput for these targets. The C fuzz target runs operations sequentially per input. No performance numbers were fabricated or local tests run. [Testing docs](https://libgeos.org/project/development/tests/), [target](https://github.com/libgeos/geos/blob/ae9cdd98be4e0bae552b918d4d14c94a9ce99c58/tests/fuzz/fuzz_geo_ops.c).

INFERRED: independent cases map well to Bend balanced fork-join, but arbitrarily different geometry sizes do not make uniform GPU work. Bucket by operation, entity counts and numeric escalation level; keep parser corruption fuzzing on a separate host-side path from uniform predicate/geometry batches.

## Known failures, limitations, war stories

- DOCUMENTED first-person [GEOS #1020](https://github.com/libgeos/geos/issues/1020): malformed polygon with empty holes causes a largest-empty-circle null dereference under fuzzing.
- DOCUMENTED first-person [GEOS #1021](https://github.com/libgeos/geos/issues/1021): huge coordinates around 1e149 to 1e155 and NaNs cause intersection heap-buffer-overflow in reported revision. These are outside F32 exponent range; wonky must reject or explicitly rescale such input before any exact-filter claims.
- DOCUMENTED [GEOS #606](https://github.com/libgeos/geos/issues/606): fuzz_geo2 finds heap-use-after-free in PlanarGraph destruction. Memory safety is a separate, valuable fuzzing goal even with no semantic oracle.
- DOCUMENTED first-person [GEOS #1515](https://github.com/libgeos/geos/issues/1515): topology-preserving simplification degenerates to one recursion level per repeated/equidistant vertex, causing stack overflow on realistic repeated GPS coordinates. Important Bend lesson: balanced input splitting must remain balanced in degenerate cases. Not locally reproduced.
- DOCUMENTED [JTS #310](https://github.com/locationtech/jts/issues/310) explicitly identifies the need for a Delaunay validator and robust inCircle tests, not merely a DD precision switch; [#1106](https://github.com/locationtech/jts/issues/1106) collects outstanding point-line orientation robustness reports.

## Relevance for wonky

INFERRED implementation plan, grounded in the corpus and runner contrasts above:

- Create a kernel-neutral case schema (JSON is sufficient; XML compatibility is optional) with source issue, operation, typed operands or feature sequence, backend-independent units, supported-feature requirements, numeric input encoding and expected refusal category.
- Define **one oracle specification**, not three runner-specific approximations: exact topology/shape-kind checks; scalar `abs(a-e) <= absTol + relTol*abs(e)` with non-finite policy; geometric deviation with explicit certification level; independent validity and operation-semantic checks. Length, area and volume need different units and scaling.
- Persist raw F32 input bits or exact dyadic/rational construction parameters so JS, native C and Metal evaluate the same geometry. GEOS/JTS binary64 decimal fixtures cannot be silently cast to F32 and keep their original golden answer. Store original and transformed cases separately and regenerate expected values when quantization changes geometry. F32x2 gives extra mantissa, not binary64 exponent range.
- Port the area identities to **volume identities** for solid Booleans, with nonzero-scale guards; add idempotence, commutativity for union/intersection, A minus A empty, containment witnesses, shell closure/orientation, pcurve agreement and provenance preservation. Measure topology separately from geometry because two triangulations of the same set need not match structurally.
- Split fuzzing into parser/serialization safety, structured valid-model semantic fuzzing, and intentionally invalid-model explicit-refusal fuzzing. Grammar-aware sketch/extrude generators should prevent most time being lost to parser rejection. Shrink failing construction histories, retain minimized original seeds and replay on all backends.
- Do not link GEOS/JTS into production Bend. Test corpus concepts are pure data, and native Bend validation can run without FFI; development-time reference measurements may be produced by external standalone tools subject to project policy.

## Pointers worth porting or studying

GEOS `XMLTester.cpp`: parseRun, Test::checkResult overloads, areaDelta, overlayareatest, unionarea; `BufferResultMatcher.cpp`; `tests/robust/overlay/TestOverlay-geos-837.xml`; `tests/fuzz/fuzz_geo_ops.c` and fuzz_geo2.c. JTS `TestReader.parseTolerance`, `GeometryResult.equals`, `DoubleResult.equals`, and LICENSES.md. Exact source links appear above.

## Verdict: adapt

Adopt issue-linked declarative cases, layered semantic/safety testing and minimized fuzz regressions. **Do not assume shared XML means shared tolerance semantics**, and do not mistake calling GEOSisValid for asserting it. JTS's EDL option makes selected implementation material more reusable than the brief suggests; GEOS licensing and fixture provenance still need review.

