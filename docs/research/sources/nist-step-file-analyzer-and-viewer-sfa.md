# NIST STEP File Analyzer and Viewer (SFA)

- Kind: standalone STEP (ISO 10303-21) analysis, conformance and viewing tool (GUI plus command-line `sfa-cl.exe`). Canonical: https://github.com/usnistgov/SFA . Other: https://www.nist.gov/services-resources/software/step-file-analyzer-and-viewer , User Guide (Update 7) https://doi.org/10.6028/NIST.AMS.200-12 (PDF also in the repo at `Release/SFA-User-Guide-v7.pdf`, 87 pp., last modified 2025-12-17), background paper Lipman & Lubell, "Conformance checking of PMI representation in CAD model STEP data exchange files", Computer-Aided Design 66 (2015), https://doi.org/10.1016/j.cad.2015.04.002 .
- Authors/organization: Robert R. Lipman, NIST Smart Connected Systems Division; 2016 (GitHub repo created 2016-06-10) to today. The B-rep viewer backend `stp2x3d` was written by Soonjo Kwon (former NIST associate), https://www.nist.gov/services-resources/software/step-x3d-translator .
- License: GitHub reports no SPDX license. The NIST statement applies: "The software developed by NIST employees is not subject to copyright protection within the United States" (17 U.S.C. 105), use/copy/modify/distribute allowed, "Please explicitly acknowledge the National Institute of Standards and Technology as the source of the software"; may be subject to foreign copyright (DOCUMENTED, https://www.nist.gov/open/copyright-fair-use-and-licensing-statements-srd-data-software-and-technical-series-publications ). BUT the running tool bundles third-party parts with their own licenses: IFCsvr ActiveX component "Copyright 1999, 2005 SECOM Co., Ltd.", modified by NIST to include STEP schemas; Microsoft Excel (optional); `stp2x3d`, "software based on Open Cascade" (DOCUMENTED, help text in `source/sfa-cl.tcl`). Implication for wonky: reading and porting SFA's own Tcl logic is unencumbered (public domain in the US, attribution requested); the actual STEP parsing/schema checking lives in the closed IFCsvr binary, which cannot be ported. Running SFA as a separate process is not linking and does not touch wonky's licensing (INFERRED).
- Status and activity (DOCUMENTED via `gh api repos/usnistgov/SFA`, 2026-09-24): Tcl, 197 stars, 39 forks, 0 open issues, 9 issues ever, 1 contributor (robert-lipman, 286 commits). Last commit 2026-09-14 "Version 5.51". The repo is ~1.1 GB because every release zip (~77-80 MB each, SFA-5.28 to 5.51) is committed under `Release/Old/`. The NIST page states that from January 2026 new releases are posted only on GitHub. IFCsvr schema bundle version string in code: `20260820`.
- Local copy: sparse shallow clone (only `source/*.tcl`, READMEs, PDFs) at `tmp/research/nist-step-file-analyzer-and-viewer-sfa/`.

## What it is

A free, vendor-neutral tool that takes a STEP Part 21 file (AP203, AP214 `AUTOMOTIVE_DESIGN`, AP242, AP209, AP238 and other EXPRESS schemas; also AP242 XML `.stpx` for the viewer) and produces four things (User Guide sec. 1, DOCUMENTED):

1. **Viewer**: an X3D/X3DOM HTML page showing B-rep part geometry, assemblies, graphic PMI, sketch/supplemental geometry, tessellated geometry, AP209 FEA models.
2. **Spreadsheet/CSV dump**: every entity and attribute on per-entity worksheets (Excel via COM, CSV if Excel is absent).
3. **Analyzer**: reports and checks semantic PMI, graphic PMI and *validation properties* against CAx-IF recommended practices, with messages that cite the RP section.
4. **Syntax Checker**: "basic syntax errors and warnings ... related to missing or extra attributes, incompatible and unresolved entity references, select value types, illegal and unexpected characters, and other problems with entity attributes" (User Guide sec. 7).

It is an *independent reader*: the Part 21 parser and schema binding come from IFCsvr, not from any CAD kernel, so it shares no code with wonky or with OCCT for the syntax and semantic checks. The B-rep viewer path (`stp2x3d`) is OCCT-based, so the viewer is *not* independent of OCCT.

## How it works

**Process model (DOCUMENTED, `source/README.md`, `source/sfa-cl.tcl`):** about 26 Tcl files wrapped by freewrap 6.51 into a Windows `.exe`. Packages `tcom` (COM), `twapi`, `Tclx` are required, so it is Windows-only. On first run it installs `ifcsvrr300_setup_1008_en-update.msi` (32-bit ActiveX, needs admin) and checks the version in the registry (`installIFCsvr`, `source/sfa-proc.tcl:1243`). STEP files are opened through the IFCsvr COM object model: `$objEntity Type`, `P21ID`, `Attributes`, `NodeType`, etc. (see `valPropReport`, `source/sfa-valprop.tcl:265`).

**Command line (DOCUMENTED, `sfa-cl.tcl`):** `sfa-cl.exe myfile.stp [view|syntax|tree|stats] [noopen] [nolog] [csv] [optionsfile]`. `syntax` runs only the syntax checker and exits; `stats` reports file characteristics; `csv` avoids Excel. Options otherwise come from `STEP-File-Analyzer-options.dat` written by the last GUI run.

**Syntax Checker (DOCUMENTED, `syntaxChecker`, `source/sfa-step.tcl:571-730`):** it sets `ROSE_SCHEMAS` to the IFCsvr directory (INFERRED: IFCsvr is built on a ROSE-style EXPRESS runtime), spawns `sfa-cl.exe <file> stats nolog`, and scrapes every stdout line containing `error:` or `warning:` that the loader emits. Output format: message plus "(line number)". Caps: 5000 messages, 500 "Converting 'integer' value" warnings (integer written where REAL is expected; the RP for PMI sec. 10.1 is cited). `entity ignored` lines are collected as *unknown entity types* (not in schema). File size limit about 430 MB. Results go to `myfile-sfa-err.log`.

**What the syntax checker does NOT check (DOCUMENTED, User Guide sec. 7):** "where, uniqueness, and global rules, inverses, derived attributes, and aggregates". It is therefore a Part 21 grammar plus attribute-type conformance check, not a full EXPRESS rule evaluator (for WHERE rules you need STEP Tools ST-Developer / Express Engine class tools, out of scope here).

**Recommended-practice checks ("Syntax Error:" messages in the analyzer):** about 190 message sites, dominated by PMI: `sfa-geotol.tcl` 72, `sfa-grafpmi.tcl` 31, `sfa-dimtol.tcl` 30, `sfa-valprop.tcl` 21, `sfa-hole.tcl` 10, `sfa-geom.tcl` 7 (counted with grep, DOCUMENTED). The pure-geometry checks are thin: for example `axis2_placement_3d` axis or ref_direction of length 0, or axis parallel to ref_direction (`veclen [veccross axis refdir] == 0`, `sfa-grafx3d.tcl:2334-2346`).

**Validation properties (DOCUMENTED, `sfa-valprop.tcl:1-100`, User Guide sec. 6.3):** a table `valPropNames(...)` enumerates every CAx-IF property name the tool recognizes: geometric (`volume`/`volume measure`, `surface area`/`surface area measure` or `wetted area measure`, `centroid`/`centre point`, `bounding box`/`bounding box corner point`, `independent curve length`, `smooth sampling points`, `sharp sampling points`, ...), assembly (`number of children`, `notional solids centroid`), PMI, attribute, tessellated, composite and FEA sets. `valPropReport` walks `property_definition` -> `property_definition_representation` -> `representation` -> items and flags:
- missing `unit_component` ("No units set for property values"),
- wrong units (a length unit on a mass property),
- area/volume measures whose unit is not `area_unit`/`volume_unit`/`derived_unit` ("Missing units exponent for a 'volume' property"),
- a missing `property_definition.definition`,
- a missing `dependent_environment` on material properties.

Crucially, SFA **reports** the values but **does not recompute** volume, area or centroid from the B-rep and compare them. The User Guide says the *receiving CAD system* recomputes and compares (sec. 6.3). A grep for any recompute path finds none (INFERRED from code). So SFA validates the *form* of valprops, not their *truth*.

**Viewer path (DOCUMENTED, `x3dBrepGeom`, `source/sfa-part.tcl:1-200`):** it runs `stp2x3d-part.exe --input f --quality q --edge ... --tess ... --tsolid ...` and parses stdout for `MinXYZ`/`MaxXYZ` (bbox), "Number of Materials", assembly indents, and OCCT reader failures (`ERR StepFile`, `ERR StepReaderData` -> "There are possible syntax errors"). Tessellation is OCCT's.

**NIST test models:** `Release/NIST-PMI-STEP-Files.zip` (12.9 MB) holds STEP files of the NIST MBE PMI test cases (CTC/FTC). The analyzer color-codes semantic PMI against expected PMI stored in `sfa-nist.tcl` (User Guide sec. 6.6). Useful only if wonky ever imports STEP with PMI.

## Robustness and guarantees

- Syntax checker: the loader-level conformance of an independent parser. That is a strong signal that other CAD systems will *parse* the file, but it proves nothing about geometric validity (orientation, closed shells, pcurve consistency, tolerances). WHERE rules are excluded, so an `ADVANCED_FACE` violating AP rules (for example, the rule that advanced-face geometry must be elementary/swept/B-spline, or edge geometry consistency) is not caught (DOCUMENTED exclusion, INFERRED consequence).
- RP checks are heuristic and PMI-centric, and they are version-coupled to the CAx-IF RPs that the code encodes.
- No tolerance checks of any geometric value: valprop numbers are displayed, not verified.
- Windows only. Issue #5 (2024) "Build SFA for linux": maintainer answers "SFA is dependent on a toolkit that only runs on Windows" and suggests Open STEP Viewer or OCCT's CAD Assistant (https://github.com/usnistgov/SFA/issues/5). Issue #8: Windows Server 2025 "not supported".

## Parallelism and performance

No numbers are published. The code is single-threaded Tcl over COM. The GUI warns that files >200 MB "could take several minutes" (`sfa-part.tcl`). The syntax checker refuses files >430 MB. Irrelevant at wonky scale (KB-MB STEP files) (INFERRED).

## Known failures, limitations, war stories

- Windows-only toolkit, no Linux/macOS build: https://github.com/usnistgov/SFA/issues/5 .
- Self-built `sfa-cl` needs freewrapTCLSH and a separate file list: https://github.com/usnistgov/SFA/issues/4 . freewrap versions newer than 6.51 "will not work" (`source/README.md`). A user build still needs the NIST release installed first (IFCsvr, stp2x3d).
- Short entity names (NX "short names", e.g. `ADVFC`, `EDGCRV`) are unsupported with "NO plans to add support": https://github.com/usnistgov/SFA/issues/7 . Irrelevant, wonky writes long names.
- AP209 viewer runs out of memory on large meshes: https://github.com/usnistgov/SFA/issues/9 .
- IFCsvr install triggers antivirus warnings and needs admin; reinstall on schema updates requires a manual REMOVE (`installIFCsvr`).

## Relevance for wonky

- **Where it plugs in: testing of the STEP exporter only** (`src/exporters.mjs` writes `FILE_SCHEMA(('AUTOMOTIVE_DESIGN'))`, `ADVANCED_FACE`, `PCURVE`, `UNCERTAINTY_MEASURE_WITH_UNIT`). Nothing here is geometry to port into Bend, and nothing touches F32/U32, fork-join or GPU constraints: SFA is an external oracle process.
- wonky already has an independent STEP oracle: `scripts/validate-step.py` runs OCCT (`cadquery-ocp==8.0.1.0.0`) `STEPControl_Reader` + `BRepCheck_Analyzer` + `BRepGProp` + point classification, and `scripts/cadbench.mjs` gates acceptance on it. SFA adds a *second, OCCT-independent parser* (IFCsvr) for Part 21/schema conformance, plus CAx-IF valprop form checks. The two oracles are complementary: OCCT checks that the geometry reads and is valid, SFA checks that the file conforms to the schema and the RPs (INFERRED).
- **Most valuable use:** once wonky writes CAx-IF geometric validation properties (volume, surface area, centroid, bbox; see the note `cax-if-recommended-practices-for-geometric-and-assembly-vali`), SFA is the reference checker that they are *encoded* correctly (units, `derived_unit` exponents, `property_definition.definition` present). The OCCT oracle then checks that they are *true* (recompute and compare within the RP thresholds). This gives a full sender-side CAx-IF loop without any vendor CAD.
- **Practical cost on Marc's Mac:** needs a Windows VM or a Windows CI runner. An untested path: GitHub Actions `windows-latest` has admin, so `msiexec /i ifcsvrr300_setup_1008_en-update.msi /qn` plus `sfa-cl.exe out.step syntax nolog` could run headless, with no Excel needed for `syntax`/`csv` (INFERRED, unverified; IFCsvr is 32-bit COM and may require an interactive first run). Wine is untested (no evidence found).
- **LLM ergonomics:** its error lines (message + P21 line number + RP section reference) are a good model for how wonky's own STEP self-check should report problems, because an agent can map a line number back to an entity id (INFERRED).
- FDM: irrelevant (the print path is mesh/3MF, not STEP).

## Pointers worth porting or studying

- `source/sfa-valprop.tcl:6-100`: the complete, current list of CAx-IF validation-property names and measure names. Reuse it verbatim as the name table for wonky's valprop writer and self-check (public domain, attribute NIST).
- `source/sfa-valprop.tcl:328-400`: the unit/exponent checks (a checklist for wonky's writer tests).
- `source/sfa-step.tcl:571-730`: the syntax-checker driver, which shows the message classes (`entity ignored` = unknown type; integer-for-real conversion) worth reproducing in a pure-JS Part 21 self-lint.
- `source/sfa-grafx3d.tcl:2330-2346`: placement sanity (zero or parallel axis/ref_direction). Trivial to add to wonky's exporter asserts.
- User Guide sec. 6.3 (valprop semantics), sec. 7 (explicit list of unchecked EXPRESS rule classes), sec. 9 (command line).
- `Release/NIST-PMI-STEP-Files.zip`: real multi-vendor AP203/AP242 files, a potential future STEP-*import* corpus.

## Verdict: learn-from

Use SFA as an occasional, out-of-process conformance oracle for wonky's STEP export (especially once valprops are written), and copy its valprop name table and unit checks into wonky's own writer tests. Do not make it a routine local gate: it is Windows-only with a closed 32-bit COM parser, it checks no WHERE rules, and it does not recompute any geometry, so it cannot replace the existing OCCT-based `validate-step.py` oracle. There is no code to port into Bend.

