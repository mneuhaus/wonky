# Viewer audit: daily use

Date: 22 September 2026. Role: daily-use auditor. The audit compares the current
viewer (`viewer/`, `src/review-server.mjs`, `bin/wonky-view.mjs`) with Marc's
working loop for real FDM parts. No production code was changed.

Method: I built real models with the production CLIs. Then I ran my own viewer
instances on ports 4337 (one model, live-edit test) and 4338 (ten models) and
drove them with `agent-browser` at 1536 × 900 CSS pixels. Both instances are
stopped. The viewers on 4310 and 4311 were not touched.
The machine was shared and loaded (load average 11 to 14), so build times are
upper-bound samples, not benchmarks.

- Models and sources: `tmp/viewer/audit/daily-use/`. The files directly in
  `tmp/viewer/audit/` belong to another workflow.
- Screenshots: `out/viewer/audit/daily-use/NN-*.png`. They are cited below as
  `[NN]`.
- Saved test review: `tmp/viewer/audit/daily-use/reviews/WKR-84FBDBED23.*`.

## The bar: Marc's loop today

Sources: `~/Workspace/cad/cad-khana` (README, CLAUDE.md, `skills/cad-khana/SKILL.md`), the
`watch.py` and `assembly.py` files in `cad-project-046`, `cad-project-048`, `cad-project-025`,
`cad-project-032` and `cad-project-043/skills/cad-fdm-design/references/`, the workspace README and
HANDOFF, and wonky's `docs/personal-adoption.md`.

- **Edit, save, look.** `uv run watch.py` polls the mtimes of all project `*.py` files. On a
  change it purges project-local modules from `sys.modules`, reruns `assembly.py` and pushes
  the `Assembly` to the OCP viewer on port 3939. It also re-pushes the cached assembly every 5 s,
  so a reloaded tab fills itself. If a build fails, the watcher keeps the last good assembly and
  prints the traceback **only in the terminal**. The browser shows nothing wrong.
- **What the viewer shows.** Named parts in a tree, with colors set via
  `.with_part(..., color=...)`, visibility toggles, clipping planes, measurement, axes and grid,
  ortho or perspective view, transparency and black edges. OCP selection reports face and edge
  indices. `khana pick --part X --faces 12,30` turns them into exact facts (plane offset,
  parallel/angle, radius). That is the shared review language between Marc and the agent.
- **Checks outside the viewer.** `check()` asserts interference and clearance. `inspect(part,
  FDM(up_axis, overhang_max_deg, wall_min_mm))` checks printability, and waivers are
  written down with a reason. `khana draw` writes HLR drawings, and `khana diff` compares
  diagnostics runs.
- **Onshape and Fusion.** Marc also uses FeatureScript through the Onshape bridge (r10b and its
  print packages) and Fusion with cad-project-019 (for example the cad-project-012 shaft). There, the
  print orientation is a design decision: "Kopf auf dem Bett" removes a 46 % support overhang.

Wonky's own strengths, which the rework should keep: exact per-entity B-rep data, source
excerpts with frozen snapshots, revision-bound identity, reviews with view-bound annotations
and compact LLM context.

## Models built for the audit

| Model | Source | Frontend | Result | Build time |
|---|---|---|---|---|
| bracket, tilted-plate, line-sketch | `examples/*.fs` | FeatureScript | OK, planar, STL/HTML written | 0.80–0.88 s |
| bored-spacer, conical-spacer, compare-before/-after, concave-intersection | `examples/*.fs` | FeatureScript | OK; curved, so no STL/HTML ("use --format print") | 0.79–0.97 s |
| python-spacer | `examples/python-spacer.py` | build123d subset | OK | 0.86 s |
| py-coaxial-bore / py-planar-pocket | `fixtures/performance-build123d/cases/` | build123d subset | OK | 0.84 s / 3.73 s |
| py-frame-with-tab | same | build123d subset | OK, but **64 faces** for a frame plus tab | **13.6 s, rerun 13.8 s** |
| py-unsupported-box-bore | same | build123d subset | now builds; the fixture name is out of date | 0.85 s |
| py-unsupported-fillet | same | build123d subset | explicit failure: `4:1: Shape.edges is not implemented by the Python frontend` | 0.81 s |
| r10b-retained | `out/acceptance/r10b-retained.brep.json` (existing) | FeatureScript | 5 bodies, 172 faces; scene payload **9.07 MB** | not rebuilt |
| **Real:** cad-project-025, unmodified | copy of `~/Workspace/cad/cad-project-025/beam_frame.py` plus `result = frame(7, 5, optimize=False)` | build123d subset | fails: `30:1: build123d.Part is not implemented by the Python frontend` (the file also uses `extrude`, `RectangleRounded`, `Rot`, `Polygon`, `Circle`) | 1.0 s |
| **Real:** beam-frame port | `tmp/.../beam-frame.fs`, donor values unchanged | FeatureScript | builds **only** as a square-cornered frame with an opening: 32 faces, 9241.6 mm³. R3.8 corner arcs plus the opening cut fail, and so does the first Ø4.94 bore into the frame. | 4.4 s |
| **Real:** cad-project-012 drive shaft port | `tmp/.../cad-project-012-shaft.fs` (SW 5 hex + SW 12 head, Fusion original) | FeatureScript | fails: `Native planar arrangement union unresolved: InvalidTopology (stage 1, detail 0)` with a flush contact (`cad-project-012-shaft-flush-contact.fs`), an embedded overlap and a 30° phase. Chamfers are also missing. | 0.9 s |

The error text of the failed beam-frame bore is `opBoolean supports coaxial cylinder
primitives, admitted planar arrangement unions/subtractions, plane/cylinder intersections
with a convex tool and a round through hole in a planar body; general trimmed-face booleans are
not implemented`. The location points at the helper `cut()` (line 42), not at the call site,
and there is no call chain. `bin/wonky-python.mjs` defaults to `--python python3`, which the
project rules forbid. I passed `--python "$(uv python find)"`.

Consequence for the viewer: none of Marc's real parts builds unmodified today. The live loop
will therefore show failures more often than models, so the way it presents errors matters
as much as the way it renders models.

## Task table

Times: "machine" was measured. "Human" is my estimate for someone who knows the tool,
counted from the steps I actually had to take.

| # | Task | Possible today? | Steps today | Time | Friction (evidence) | Severity |
|---|---|---|---|---|---|---|
| 1 | Open a single part and look at it | Yes | 1. `node bin/wonky.mjs part.fs --out tmp/x`; 2. `node bin/wonky-view.mjs tmp/x.brep.json --port N`; 3. open the URL. In a multi-model workspace also click the model and then "Compare" to leave wipe mode. | Machine 0.84 s build + 0.99 s viewer start (2.0 s with five models incl. r10b) + 2.5 s first page load. Human ≈ 30 s. | The viewer takes no `.fs` or `.py`, needs two commands and does not open the browser. Even one model gets BEFORE/MODEL chrome and a Compare button [01]. The multi-model workspace opens in **wipe against an unrelated model**, so half the viewport shows the wrong part [03][04][17]. Turning Compare off is lost on reload [17]. No axes, grid, view cube or build plate; ortho only. "Checks 5" lists global kernel reports that have nothing to do with the part [02]. The FS body colors present in the data are ignored: all r10b parts render green [19]. | High |
| 2 | Find a hole and read its diameter | **No** in the UI (workaround only) | Click the bore face: the inspector shows "Face 3, Surface cylinder, Boundary edges 3, Role unmatched-face/2" and **no radius** [06]. Workaround: "Copy selected geometry" and search the JSON for `geometry.surface.radius` (2 mm → Ø4), or `curl /api/models/<sha>/entities/B1.F3`, or `wonky-inspect --detail B1.F3 --revision <64 hex>`. | UI: 3 clicks, no answer. Workaround ≈ 1–2 min. | The exact value exists server-side but is not shown. The inspector is dominated by the orange split/merge notice on every Boolean face [06]. The cylinder seam is drawn as a line inside the bore [05]. | High |
| 3 | Check a wall thickness | **No** | Click the inner wall: "Face 32 · plane", with no normal or offset [08]. Only one selection at a time, no measure tool. Workaround: the `wonky-inspect` overview lists 64 plane descriptors; find the parallel pair and subtract by hand (y 40 − 32 = 8 mm). | Workaround ≈ 3–5 min, error-prone | Fragmented planar faces (64 for frame-with-tab, 32 for beam-frame) turn "the" wall into one of several coplanar pieces [07][17]. | High |
| 4 | Change a parameter in the source and see the result | Partly (manual) | Edit `bracket-live.fs` (thickness 8 → 14 mm, arm 40 → 55 mm), rerun the CLI, click "Refresh workspace", then find and click the new revision [11][12]. | Machine: edit + rebuild 0.84 s. Human ≈ 15–25 s per iteration. The OCP loop is hands-free (build time + ≤5 s poll). Python frame-with-tab: 13.8 s per build. | The browser does nothing on rebuild (screenshots [09] and [10] are byte-identical). Refresh resets the camera to default iso [11]. The new revision is a second "bracket-live" entry that differs only by hash; the view stays on the old one. In the multi-model workspace it is appended at the bottom, not grouped [23][24]. **A failed build is invisible:** the CLI exits 1, and Refresh shows "Workspace refreshed" with the old model and no stale or error hint [22]. | High (adoption blocker) |
| 5 | Compare before and after | Partly (visual only) | Click Compare for wipe [13], then "Side by side" with a linked camera [14]. | 5–10 s once the pair is set; 30–60 s to set it through dropdowns with identical labels | For a new revision, "Before" stays on the unrelated `compare-before` instead of the previous revision of the same model [24]. No numeric deltas: the bbox change (50×40×8 → 50×55×14) is readable only by switching models, and volume is not shown at all. No geometric diff overlay. `wonky-compare` takes only `.fs` with one coaxial cylinder primitive per input ("Expected 'FeatureScript', found '{'" for `.brep.json`). | Medium–high |
| 6 | Find the source line of a face | Yes (body level) | Click the face: "Operation source" shows file:line and an excerpt. "Open frozen source" opens a drawer with the line highlighted [15][16]. | ≈ 10 s | It shows the body's **last operation**, not the feature that formed the face: the bore face points to `opBoolean` line 21, not the tool extrude at lines 19–20 (circle at line 17), and the frame inner wall points to `frame + tab` (line 7), not the opening cut (line 5). Role `profile-side/4` is not mapped to its sketch segment. r10b parts show only "Source location, Line 20:2", i.e. the helper `copyBody`, with no file name (`file: null`). The recorded call chain (`copyBody` called at line 1382 from `buildRetainedContext`) is not the headline [20]. No open-in-editor link and no source-to-geometry highlight. Recorded parameters are in SI metres (`endDepth 0.014`). | Medium |
| 7 | Judge printability (orientation, overhangs) | **No** | Only 4 view presets: iso, front, top, side; no bottom view [18]. No build plate, no axis triad, no overhang shading, ortho only. In the default iso view the picked +Y end face appears at the lower right; the orientation is readable only from the inspector JSON. `--format print` writes STL and a chord deviation manifest, but no overhang data. | n/a | No equivalent of `inspect(FDM(up_axis, overhang_max_deg))` or of the "Kopf auf dem Bett" decision. | High (FDM) |
| 8 | Copy context for an LLM | Yes | "Copy model overview" (953 B for the spacer, 2.7 KB at bodies level for r10b-retained, 44.5 KB at full level), or comment + "Save review" → `WKR-….context.md` (5.1 KB) + "Copy LLM context" [21] | ≈ 15–30 s | The review context includes the **unrelated "before" model** although Compare was off. r10b entries read `source=<unknown file>:1375:1` and `volume=unknown`. The annotation line reads "comment on B4 (body 0, …)", mixing an alias and an index. Selected entity data is only linked (route or CLI command), not inlined. "Unsaved changes" appears after merely toggling Compare. | Low–medium |

## Cross-cutting findings

- **Display tolerance is not labelled.** The scene payload carries
  `display.toleranceMm = 0.02` and the purpose "Approximate display only". The UI shows only
  the boundary-only-face notice, never the tolerance, and cylinder banding is visible [05].
  AGENTS.md requires approximations to be labelled with their tolerance.
- **Edges are thin, low-contrast lines, and some are not feature edges.** They are drawn in
  dark green at about 1 px. They include cylinder seams and coplanar fragment boundaries from
  the planar arrangement [05][07][17]. These are real B-rep edges, so they must stay
  inspectable, but they should not look like feature edges.
- **Payload size.** r10b-retained (5 plate parts) sends a 9.07 MB JSON scene. A 4-face spacer
  sends 336 KB. A live push of the full r10b (35 parts) as JSON floats would be slow.
- **The API is fast.** `GET /api/workspace` takes 7–8 ms and entity detail about 2 ms. The
  server is not the bottleneck; the UI does not surface what it already has.
- **Keep:** frozen source snapshots worked across the live edit (both source hashes frozen
  under `reviews-single/sources/`). Body picking from the Bodies list highlights the part
  [20], wipe and side by side stay in sync [13][14], and saved reviews reopen.

## Top 10 improvements, ranked by value for Marc's daily FDM work

1. **Live loop from source.** `wonky-view part.fs|part.py` opens the browser, watches the source
   and its imports, rebuilds in a worker and cancels superseded builds. It pushes over SSE and
   keeps camera and selection. While building it shows a busy state; during an error it shows
   the last good model with a clear "stale" banner and the error in the viewport, with
   file:line:col **and call chain**. This beats OCP, which hides failures in the terminal.
   Evidence: tasks 1 and 4, [09]=[10], [22].
2. **Model-first default.** One model, no BEFORE/AFTER chrome, and a persisted mode. Compare
   only on request, or automatically against the **previous live revision of the same source**.
   Revisions grouped per source with a revision number and time. Evidence: [03][04][17][24].
3. **Exact measurement from B-rep data.** Show surface parameters in the inspector (cylinder
   Ø/r and axis, plane normal and offset, circle Ø, line length). Add two-pick measurement
   evaluated server-side from analytic data: parallel planes give wall thickness, plus
   coaxial or cylinder-to-plane distance, angle, and point-to-point. Label results "exact" and
   keep display-mesh picks visibly separate. Evidence: tasks 2 and 3, [06][08].
4. **Print orientation aids.** A build plate (Bambu A1 256 × 256 mm, configurable), an axis
   triad, a view cube with a bottom view, and overhang shading from exact normals with the
   threshold on screen (default 45° from vertical, configurable). Mark the faces that touch the
   bed. Do not claim overhangs for surfaces without exact normals. Evidence: task 7, [18].
5. **Crisp, honest edges.** Dark feature edges with a width setting. Show seams and coplanar
   fragment edges dimmed or only in a "topology" mode, never hidden from picking. Label the
   display tolerance (0.02 mm) in the viewport. Evidence: [05][07][17].
6. **Parts tree.** Bodies with their FS names, **appearance colors honored** (the data already
   has them), visibility, isolate and per-part transparency. This matches the OCP tree that
   `cad_khana.viewer.push` fills. Evidence: [19][20].
7. **Numeric compare deltas.** Volume (kernel-recorded), bbox, face/edge counts and body
   added/removed next to wipe or side by side. Add a geometric diff overlay only where
   `wonky-compare` really supports the pair. Evidence: task 5, [13][14].
8. **Section and clipping.** X/Y/Z planes with offset and flip, for walls, inserts and bores
   inside parts. The cut is a display operation and must say so. Its mesh-based caps are
   labelled with the display tolerance.
9. **Source links in both directions.** An open-in-editor link (`zed://file/…:line`,
   `vscode://file/…:line`), the face-forming feature where lineage supports it (tool extrude,
   sketch segment for `profile-side/n`), the recorded call chain as the headline for
   helper-created bodies, the missing file name for r10b, and "highlight geometry from this
   line". Evidence: task 6, [15][16][20].
10. **Scoped LLM context and less noise.** Context for exactly the visible model and selection,
    with the selected entity's exact data inlined, and no unrelated "before" model. Scope the
    Checks tab to the model. Show "Unsaved changes" only for real review edits.
    Evidence: task 8, [02][21].

## Kernel and CLI blockers seen on the way (outside the viewer, for the product owner)

- A round bore into the beam frame after its opening cut fails as a general trimmed-face
  boolean. A plate with two bores (`tmp/plate-holes.fs`) fails on the second one: "opBoolean
  requires coaxial cylinders".
- An outline with arcs (R3.8 corners) followed by a planar cut fails the same way.
- The union of two stacked hex prisms fails with `InvalidTopology`, whether flush, overlapping
  or rotated (cad-project-012 shaft).
- Planar results are fragmented: 64 faces for frame-with-tab, 32 for a plain frame.
- frame-with-tab takes 13.8 s through the Python frontend under load.
- Error locations lack the call chain. `wonky-python` defaults to `python3`.
- Curved models need `--format print` before an STL for the slicer is written.
