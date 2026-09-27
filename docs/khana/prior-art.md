# prior-art

Committed copy of the literature synthesis (41 sources with URLs, 12 ranked ideas): [evidence/prior-art-literature-synthesis.json](evidence/prior-art-literature-synthesis.json). The larger files below (findings.json 663 KB, local-baseline.json, name-accounting.json) stay under the git-ignored tmp/ of the machine that ran the workflow.

Pointer written by the maintainer. The prior-art agent runs on Codex (gpt-astra), and its instructions forbid Markdown reports. Its complete findings are in JSON:

- `tmp/khana/prior-art/findings.json` (full findings: read it completely)
- `tmp/khana/prior-art/worklog.json` (checkpoint)

If findings.json is missing or incomplete, read the worklog and the agent'project-component-32f60153 evidence under `tmp/khana/prior-art/`.

Cautions the agent reported to the maintainer while it worked (primary sources; verify in findings.json):
- Parasolid v35 distance options (public mirror, http://www.q-solid.com/Parasolid_Docs_V35/chapters/fd_chap.029.html; archived at tmp/khana/prior-art/sources/parasolid-range.html:492-497). The default PK_range_opt_performance_c may return a local rather than a global extremum. Accuracy mode only "may return more accurate" results, which is not certification. Consequence: commercial clearance is not certified, and wonky's certified bound would be a real improvement.
- Krishnamurthy/McMains/Haller, bounded NURBS distance (TVCG 2010), Sec. 5.3 (tmp/khana/prior-art/sources/distance-tvcg2010.txt:610-650). Trim-texture culling can drop a surviving feature smaller than the resolution, and the paper leaves it to the user to notice this visually. A certified trimmed query in wonky must not inherit that gap.

Key findings the agent reported before writing findings.json:
- cad_khana's clash and clearance checks are already OCCT B-rep queries (BRepAlgoAPI common + volume, BRepExtrema), not tessellated approximations. The native improvement there is certified threshold intervals, witness points or faces with provenance, and caching, not just "exact instead of sampled".
- Printability heuristics to replace:
  - Every bore of 12 mm or less is exempt from the overhang check, unconditionally.
  - Bridges of 10 mm or less are detected with two point probes.
  - Better: layer sections, anchor reachability and calibrated printer profiles. The PrusaSlicer and Cura sources confirm layer-aware support.
- Onshape now has native thickness analysis: ray, rolling-ball and gradient thickness. A single sampled min-wall value falls below today's UX baseline.
- Published bounded-distance methods (TVCG 2010) admit that trim features smaller than the resolution can vanish. Their bounds cannot justify silent pruning in wonky.

Written artifacts (as reported by the agent):
- `tmp/khana/prior-art/literature-synthesis.json`: all five topics, 41 source URLs with access caveats, 12 ranked ideas, formulas, test proposals and code-cited cross-cutting fixes. Read it in full.
- `tmp/khana/prior-art/local-baseline.json`: source audit of cad_khana, with 475 verified citation ranges covering 22 modules, 48 functions and 25 classes.
- `tmp/khana/prior-art/findings.json`: the canonical findings; both files above are embedded.
- The agent's top priorities:
  - truthful tri-state diagnostics (pass / fail / not decided) linked to their sources;
  - shared certified clearance and clash queries in Bend;
  - calibrated directional FDM fits;
  - a defined wall-thickness measure;
  - layer-aware bridging that checks both anchors.

Integration guard (verified by the maintainer):
- The "bound" in kernel/volume.bend (uncommitted r20-gate work) is not a rigorous interval certificate everywhere.
  - Curved quadrature uses whole-versus-halves error ESTIMATES (volume.bend:666-736, `Est{ef, eg}`).
  - The pole and mesh guards are finite samples (840-901, 1129-1185).
- src/exactness.mjs labels transport provenance, not accumulated geometric error proofs.
- Consequence: do not build "certified" check verdicts on today's volume bound. Separate existing estimates from future certified query bounds, and label them honestly.

Final file set (maintainer, 10:05):
- `findings.json` (335 KB): the canonical complete five-topic artifact, with public_api_inventory and local_source_audit.
- `literature-synthesis.json`: an independent second synthesis, 41 sources and 12 priorities.
- `local-baseline.json`: the source audit, with complete import, namespace and shim accounting.
- `name-accounting.json`, if present: the updated name accounting.

Where the syntheses differ, prefer claims that carry a source URL or a file:line citation.
