# Same-source build123d performance

`scripts/benchmark-build123d.mjs` executes each frozen Python file unchanged through two independent paths:

- Production Wonky `buildPython`: the existing `build123d` compatibility shim, private RPC pipes, and real Bend geometry compiled to JavaScript.
- An isolated Python worker with real `build123d==0.10.0` and `cadquery-ocp==7.8.1.1.post1`. This worker only constructs reference benchmark geometry. It never supplies shapes or fallbacks to Wonky.

Both use the same Python 3.13 interpreter, filename, source SHA-256 and literal parameters. Wonky retains its production `-I -S` runner, external-geometry import rejection, eager construction/validation and source tracking. No production source or kernel changes are required.

## Run

From the repository root, prepare the independent reference environment once:

```sh
uv venv --python 3.13 out/build123d-performance/reference-venv
uv pip sync --python out/build123d-performance/reference-venv/bin/python fixtures/performance-build123d/reference.lock
node --test test/benchmark-build123d.test.mjs
node scripts/benchmark-build123d.mjs --check --out out/build123d-performance/check-new
node scripts/benchmark-build123d.mjs --out out/build123d-performance/run-new
```

Each report directory must be new, preserving earlier failures and measurements. `--python PATH` selects an alternative isolated environment; installed versions must match the frozen lock. `--case ID` can be repeated for diagnosis. `--check` only tests geometry and makes no performance claim. Defaults are three warmup rounds, seven measured rounds, three cache-disabled Bend startup rounds and three fresh/cached startup rounds. At least three measured rounds are required for every timing population. Run the principal series after tests and other competing work finish; the harness itself executes engines sequentially.

The environment lock also pins `ocp-gordon==0.1.17`: unconstrained resolution currently selects 0.3.1, whose `OCP.collections` import requires OCCT 8 and breaks build123d 0.10's OCCT 7.8 environment. All transitive package versions, the lock hash and observed loaded module paths are recorded. The existing independent STEP validator separately uses its own pinned OCCT 8 environment.

## Workloads and correctness

The original local files in `fixtures/performance-build123d/cases/` range from one primitive to three primitives and two Boolean operations. They are a selected diagnostic subset, not the upstream build123d test suite or a CADBench score.

| File | Work | Analytic volume, mm³ |
|---|---|---:|
| `box.py` | One minimum-aligned box | 12000 |
| `translated-cylinder.py` | One cylinder and translation | 1280π |
| `coaxial-bore.py` | Two coaxial cylinders, subtraction | 2380π |
| `planar-union.py` | Two translated overlapping boxes, union | 15500 |
| `planar-pocket.py` | Two boxes, blind pocket subtraction | 18240 |
| `frame-with-tab.py` | Through opening followed by a tab union | 13840 |

`unsupported-fillet.py` and `unsupported-box-bore.py` are executed by both engines and retained as capability probes. Unsupported operations are recorded with their errors and never assigned timing ratios. A future implementation that supports them is reported explicitly; they do not automatically enter the frozen timed cohort.

Before timing, both engines must agree on solid count, volume and bounds against independent analytic expectations. Real OCCT construction must pass exact `BRepCheck_Analyzer`, and its point classifications must match the expected inside/outside probes. The existing `scripts/validate-step.py` then reads the Wonky STEP, checks strict validity, topology and volume, and classifies the same points. This reader does not report a bounding box; bounding agreement uses the separate native metrics. The volume tolerance is max(1e-5 mm³, 2e-5 relative), bounds tolerance 1e-5 mm and point tolerance 1e-7 mm. Probes avoid boundaries and distinguish pockets, bores, tabs and missing regions.

Every warmup and measured construction is checked again. Final timed Wonky exports pass independent validation again. Source files and the complete implementation snapshot must remain unchanged before any ratios are accepted. Failures, raw samples, STEP/B-rep files, strict validation reports and logs stay in the output directory. A failed candidate prevents overall acceptance; partial validated rows are not a full-cohort claim.

The planar B-reps may partition the same checked volume into different faces. Native face/edge/vertex counts are retained for each engine. Agreement of volume, bounds and selected point probes is not an exhaustive proof of arbitrary shape equality; the strict reader independently checks each Wonky boundary representation as exported.

## What the timers measure

| Phase | Observed boundary and limits |
|---|---|
| Cold Bend startup | New Node process to fully loaded adapter, kernel and exporter, with persistent compiled-Bend cache disabled. OS filesystem/page caches remain warm. |
| Cached startup | New Node process with persistent Bend cache; separately, a new Python process importing real build123d/OCCT. Repeated process-to-ready wall times include the benchmark worker's initialization and version reporting. |
| Warmed build | Existing public `buildPython(source)` boundary versus real Python compile+exec in a fresh namespace with imported build123d. Both include actual eager geometry construction. |
| Frontend | Reference Python compile time is observed directly. Wonky frontend, per-call Python startup, geometry and RPC cannot be individually timed through its existing adapter, so their fields remain `null`. They are included in the warmed build total. No subtraction estimate is presented. |
| Native revalidation | Additional validity checks after construction, timed separately. The two validators have different scopes; this is not an accuracy-equivalent validity benchmark. Eager construction checks remain inside build time. |
| STEP export | Serialization/export plus file write. Wonky also performs mandatory exporter revalidation. No fsync; ordinary OS cache effects apply. B-rep JSON output, hash reads and observations are outside this timer. |
| Independent validation | Fresh `uv run scripts/validate-step.py` wall time: imports, reader, strict validation, volume and point classification. It is a separate phase, not isolated reader computation. |

The reported Wonky/reference build ratio includes different API overhead: Wonky starts a fresh isolated Python shim process for **every** call, uses RPC, performs eager validation and retains source tracking; real build123d executes in an already imported Python process. This is an observed build API ratio, **not an isolated Bend/OCCT kernel speed ratio**. There is no fair pure-kernel measurement hidden behind it. Startup populations are reported separately rather than subtracted from build samples.

Case order rotates and engine order alternates across rounds. The report retains medians, interpolated quartiles, min/max and every raw sample; small populations are not confidence intervals. Hardware, OS, Node/Python/Bend/OCCT versions, free memory, CPU counters, load averages and macOS thermal status are recorded. Background activity, scheduling, frequency changes and power management are observed but not controlled. No native or GPU speed inference is made from Bend's JavaScript target.

## Recorded run: 22 September 2026

The principal run, [report.json](../out/build123d-performance/principal-1/report.json), ran from 10:15:46 to 10:24:34 UTC after the full repository tests finished and other project load jobs paused. Hardware: Apple M5 Pro, 18 logical CPUs, 64 GiB, arm64/Darwin 25.6.0. Software: Node 22.23.1, Python 3.13.3, Bend 2.0.25 JavaScript target, build123d 0.10.0, OCCT/OCP 7.8.1.1. Three warmup rounds preceded seven measured rounds per case. All six candidates passed both geometric gates; the implementation snapshot remained unchanged.

**Real build123d was faster at the measured construction API boundary in every shared case.** Values below are medians in milliseconds, with the interquartile interval in parentheses. The ratio is Wonky time divided by reference time; it includes the process/RPC/validation differences explained above.

| Same Python file | Wonky build, ms (IQR) | Real build123d, ms (IQR) | Wonky/reference |
|---|---:|---:|---:|
| `box.py` | 26.65 (26.53–31.21) | 0.4115 (0.3930–0.4280) | 64.8× |
| `translated-cylinder.py` | 25.70 (25.31–28.39) | 0.4429 (0.4371–0.4616) | 58.0× |
| `coaxial-bore.py` | 27.29 (27.00–29.27) | 2.529 (2.279–2.578) | 10.8× |
| `planar-union.py` | 1829.79 (1819.14–1982.13) | 4.872 (4.691–5.703) | 375.6× |
| `planar-pocket.py` | 3475.25 (3458.21–3548.63) | 3.655 (3.289–3.685) | 950.8× |
| `frame-with-tab.py` | 15851.09 (15653.60–15888.84) | 9.430 (8.551–10.438) | 1680.9× |

The small primitive results include approximately 26 ms of exposed Wonky build time, whose internal process/RPC/geometry components are not separately observable. The planar cases take much longer and retain more subdivisions: Wonky/reference face counts are 26/10 for the union, 46/11 for the pocket and 64/14 for frame+tab. These are observed differences, not a profile proving a specific internal bottleneck.

| Separate startup population, 3 samples | Median | Full range |
|---|---:|---:|
| Wonky, persistent Bend cache disabled | 93.653 s | 92.511–94.814 s |
| Wonky, compiled Bend cache enabled | 0.694 s | 0.691–0.779 s |
| Real build123d, fresh Python process | 1.078 s | 1.020–1.557 s |

STEP export-and-write medians for Wonky/reference were 0.309/4.125 ms (box), 1.852/3.752 ms (cylinder), 4.351/3.978 ms (bore), 0.407/4.729 ms (union), 0.611/4.782 ms (pocket) and 0.772/5.366 ms (frame+tab). These exporter timings do not reverse the construction result. Native revalidation and reference compile-only statistics remain separate in the report. The independent six-model strict STEP/probe validation took 1.331 s before timing and 1.381 s after timing, including fresh-process/import overhead.

Background activity remained observable: the one-minute system load average was 12.08 before warmed sampling and 11.59 afterward; macOS reported no recorded thermal/performance warning. One reference union sample was 22.05 ms against a 4.87 ms median. All samples and spread are retained; this is a local run rather than a hardware-independent speed estimate.

Fillet failed explicitly as `unsupported-api` (`Shape.edges`), and box/cylinder subtraction failed as `unsupported-geometry`; both reference constructions passed. Neither receives a speed ratio. The earlier [geometry-only preflight](../out/build123d-performance/geometry-check-1/report.json) also passed all six shared workloads, but its incidental durations were collected during repository tests and are not performance results. The [initial dependency-resolution failure](../out/build123d-performance/reference-initial-resolution-failure.json) is retained as setup evidence.

## Native CPU/Metal follow-up status — 22 September 2026

The table above measures the Bend JavaScript modeling path. No accepted
ARM64/Metal timings exist yet for these six programs. The separate
[historical hardware benchmark](hardware-performance.md) uses large batches of
independent cylinder comparisons and coaxial bores, not these planar workloads.
Its speed ratios cannot be applied to this table.

The [capture](../out/performance/native-build123d/captured.json) currently records
production calls/operands for union, pocket and frame-with-tab. It does not
contain a completed native executable or timing populations. The frame capture
explicitly reports `nativeChainExact: false`: the existing host B-rep roundtrip
changes low F32x2 words. Replaying separately captured operands can measure
those kernel calls, but excludes host adaptation and is not an equivalent
complete native model pipeline. Resolve and document that measurement boundary
before publishing a comparison.

The broader [prepared-solid optimization](../out/performance/prepared-solids/STATUS.md)
is also staging only, currently blocked at its first compile by a forward
reference. The production profiles exist; no optimization speedup or completed
integration is claimed. The dated status retains the
source hashes, evidence and next actions. The principal report's recorded
production file hashes still match at this documentation checkpoint.
