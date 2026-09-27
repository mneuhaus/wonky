# Design doctrine for printed parts and mechanisms: draft for wonky

Draft, 2026-09-24, workflow `khana-design` (architect; updated by task
`revise` after the reviews, design.md section 16). Proposal only. The
skills `~/.claude/skills/cad-fdm-design/` and `~/.claude/skills/cad-khana/`
are not changed; other sessions use them today (directive item 6). They
switch to this doctrine only when wonky can replace Marc's loop (package K20
of [design.md](design.md)).

This draft merges the two skills into one doctrine whose rules are verified
by the checks of design.md. Every rule states:

- **check**: which check verifies it (C1 to C11 of design.md §2.3), or
  "review" when no geometric check can decide it;
- **gate** (fails the report unless waived) or **advisory**;
- **profile field** that holds its number (design.md §5.6), so the doctrine
  and the checks can never disagree about a value;
- **evidence**: `tested` (physically confirmed on a print), `observed` (seen
  in a project, not a controlled test) or `starter` (a published rule of
  thumb, not calibrated for Marc's printers). The source skill asks to
  "record which were physically tested" (`cad-fdm-design/SKILL.md:154`).

Sources: `cad-fdm-design/SKILL.md` (FDM, house style, Formschluss,
mass-production and validation rules), its references `assembly-review.md`,
`fit-and-snap-review.md`, `bambu-preparation.md`, `project-layout.md`, and
`cad-khana/SKILL.md` (workflow and agent conventions). Line numbers refer to
the installed copies.

## 1. The loop

1. **One model file per design, one live viewer.** `wonky view assembly.py`
   (or the `.fs` model with its `*.checks.json`). It rebuilds on save, runs
   the main block including `check()` and `inspect()`, and shows verdicts and
   witnesses. `watch.py`, the OCP viewer and the separate `khana check` run
   are no longer needed (replaces `cad-fdm-design/SKILL.md:53-62`).
2. **Script structure stays**: parameters and derived values at the top, pure
   part functions, the assembly with explicit placements, then one `inspect()`
   per printed part; document the coordinate frame
   (`cad-khana/SKILL.md:144-158`, `:305-318`).
3. **Assertions state intent; coverage is automatic.** Every pair of parts is
   classified by `check()` anyway, and an unexpected overlap fails. Write
   assertions for what the design means: fit classes on the mating faces
   of moving pairs (`assert_fit`), expected contacts, expected overlaps with
   a reason, their region (`within=`) and a bound, poses named explicitly
   (`lid`, `lid@entry`, `lid@*`), motion ranges. (Replaces "assert every candidate pair", `cad-khana/SKILL.md:173-177`.)
4. **Iterate until the checks are green, then look at shape.** Read the
   stderr lines and the checks panel first. `unresolved`,
   `waived-unresolved`, `refused` and `not-run` are not green. An `estimate`
   never proves a pass. A passed global clearance is a minimum distance, not
   proof of play.
5. **Declare what you print.** Every slicer file is a print target
   (`print_target`: part, variant, print pose, count, path, and the check
   that covers it, or a declared proxy relation with a reason). Targets are
   written from the checked revision; `wonky check` lists stale, undeclared
   and unchecked files in `out/`. Until a project declares its targets, its
   export script stays. Slicer verification stays a separate, explicit step
   (section 9).
6. **Stop rule.** Cap the repair loop at 3 to 5 attempts on the same failure,
   carry the failing record forward, then stop with one line
   `HUMAN_REVIEW: <why>, last failure: <record>` (`cad-khana/SKILL.md:661-694`).
7. **Log paper cuts** in a wonky field-notes file, as the khana skill asks
   today (`cad-khana/SKILL.md:740-754`).

## 2. The profile

One `wonky-print-profile.json` per printer and material, found upward from the
model directory or given with `--profile`. Starter values (all `starter`
unless marked):

| field | value | source |
| --- | --- | --- |
| nozzle, line width, layer, first layer | 0.4, 0.45, 0.2, 0.2 mm | prior-art Prusa guidance (`tmp/khana/prior-art/literature-synthesis.json`, dfam rule table) |
| `walls.wall_min_mm` | 1.5 | cad_khana default, three perimeters (`cad-khana/SKILL.md:567-572`) |
| `walls.feature_min_mm` | 0.8 | LEGO module-1 teeth waiver (`cad-fdm-design/SKILL.md:230`); Marc's most used value (67 of 175 outputs) `observed` |
| `walls.min_web_mm` | 1.0 | "keeps ≥ 1 mm web" (`cad-fdm-design/SKILL.md:85-87`) `observed` |
| `overhang.alpha_max_deg` | 45 (slicer β = 45) | `cad-khana/SKILL.md:573-578` |
| `bridge.max_span_mm`, `bridge.min_anchor_mm` | 10, 0.4 | cad_khana `BRIDGE_MAX_MM`; one line width, measured along the anchoring edge (design.md §5.7) |
| `fits.sliding` (per side) | 0.2 | `cad-fdm-design/SKILL.md:185` `observed` |
| `fits.rib_line_contact` (per side) | 0.1 (cavity +0.3/side, ribs 0.2 proud, rib width ≥ 1.6) | `SKILL.md:185-187` `observed` |
| `fits.moving_min` | 0.2 | `cad-khana/SKILL.md:178-181` |
| `holes.vertical_undersize` | 0.1 to 0.3 | `cad-fdm-design/SKILL.md:183` `observed` |
| `holes.horizontal_sag` | 0.1 to 0.2 | `SKILL.md:181-183` `observed` |
| `style.vertical_fillet_mm`, `style.deburr_chamfer_mm` | 4.2, 0.42 | `SKILL.md:79-83` (house style) |
| `style.feather_mm`, `style.knife_deg` | 0.5, 60° | `SKILL.md:174-178`; 60° is the complement of the wall opposition rule (design.md §5.8) |
| `style.notch_fillet_mm` | 2 to 6 | `SKILL.md:104-108` |
| `solids.overlap_skirt_mm` | 1.0 | `SKILL.md:139-142` |
| calibration | empty | fill from coupons (section 8) |

## 3. Assembly, access and motion

| rule | check | gate | field | evidence |
| --- | --- | --- | --- | --- |
| No two parts overlap unless the overlap is declared with a reason, its region and a bound; every other overlap of the same pair still fails | C1, C2 | gate | contact tolerance | `cad-khana/SKILL.md:343-363` |
| Parts meant to touch are declared as contacts, not left to chance | C1 `expect_contact` | gate | | R20 `flange_contact`; khana "tangent contact reads as zero clearance" (`SKILL.md:623-626`) |
| Every moving pair keeps its fit class along the whole travel, not only at rest; sliding contacts the joint leaves invariant are allowed, cams and ramps are reviewed | C4, `assert_fit` | gate | `fits.*` | `assembly-review.md:60-64`; `fit-and-snap-review.md:60-62` |
| Alternate states (seated, mid-slide, entry) are poses of one part, each checked against the rest; the seated placement is the base pose and each assertion names its poses | C3 | gate | | pose ghosts in 3 projects (design.md §5.3) |
| A clear final pose does not prove assemblability: check fastener installation, subassembly joining and operation as three separate geometries | C1, C4 with the fastener and tool envelopes as bodies | gate where modeled | | `assembly-review.md:50-64` |
| Purchased hardware keeps its real envelope (collars, washers, head protrusion, screw tips) | review; checks run on the envelopes you model | | | `assembly-review.md:13-14`, `:66-69` |
| Contacts are recorded narrowly, by pair and region, never by exempting a whole pair or deleting "small" bodies | waivers (design.md §5.13) | | | `assembly-review.md:93-97` |
| Anti-racking: guide length ≥ 1.5 to 2 × the lever arm | review | | | `cad-fdm-design/SKILL.md:194-196` `observed` |

## 4. Fits, slide-ins and snaps

| rule | check | gate | field | evidence |
| --- | --- | --- | --- | --- |
| Sliding fits 0.2 per side; rib line contacts 0.1; measured on the guide faces, not as the pair's global minimum (a seated part touches its stop) | C1 `assert_fit(fit="sliding", faces_a=, faces_b=)` | gate | `fits.*` | `observed` |
| A fit passes on nominal geometry only as "nominally clear, not calibrated" until the profile is calibrated | C1 fit row | | calibration | prior-art rank 3 |
| Horizontal bores that must fit a pin or axle are teardropped (45° apex toward up) | C10 note on fit bores; C6 treats the apex as a narrow bridge | advisory | `holes.horizontal_sag` | `SKILL.md:181-183` `observed` |
| Vertical fit bores expect undersize; oversize or ream | C10 note | advisory | `holes.vertical_undersize` | `observed` |
| An elastic squeeze or snap engagement is an expected overlap with a reason and a bound, limited to the intended region; the remaining neighbour contacts stay checked | C1 `assert_interference(..., within=, max_depth_mm=)`, C2 | gate | | `SKILL.md:222-227`; `fit-and-snap-review.md:63-68` |
| Separate rigid location from elastic retention; check the three states (print geometry, insertion path, seated assembly) | C9 (one solid), C4 or poses along the path (insertion), C1/C2 (seated) | gate | | `fit-and-snap-review.md:25-68` |
| Slide-in beats snap-on for box and tray; detents stay in the profile family (no spheres against a round ridge) | review | | | `SKILL.md:164-173` `observed` |
| Compliance beats precision: thin flexible fins absorb the tolerance band | review; C7 knows fins as thin features | | `walls.feature_min_mm` | `SKILL.md:205-209` |
| PLA under preload relaxes; report "geometry and slicing checked, physical fit and retained preload open" until tested | report wording | | | `fit-and-snap-review.md:84-87` |

## 5. Orientation, bed and first layer

| rule | check | gate | field | evidence |
| --- | --- | --- | --- | --- |
| Pick the bed face first; "vertical" is relative to it | `FDM(up_axis=)` per inspect; C11 proposes | | | `SKILL.md:77` |
| Compare orientations before choosing: support versus bore quality versus contact versus height | C11 Pareto set | advisory | | `SKILL.md:217-221` |
| A small projecting pad must not lift a plate off the bed | C6 bed contact and first-layer islands | advisory | `layers.first_layer` | `assembly-review.md:46-48`; `bambu-preparation.md:55-57` |
| Simple, small first layer; no text or spikes on layer 1 | C6 first-layer islands | advisory | | `SKILL.md:200-201` |
| A bore that starts on the plate gets a bottom chamfer against elephant foot | C10 note | advisory | `holes.elephant_foot` | cad_khana note, prior-art rank 6 |

## 6. Overhangs and bridges

| rule | check | gate | field | evidence |
| --- | --- | --- | --- | --- |
| No downward region steeper than α_max unless it is bed-supported or a bridge | C6 | gate | `overhang.alpha_max_deg` | `starter` |
| A bridge spans at most the profile's span and is anchored on both ends (chords of the region end on anchored material); a cantilever is not a bridge; "support-free" needs the layer-and-anchor test (K8b), before that a pass is a geometric pre-check | C6 | gate | `bridge.*` | `starter`; `bambu-preparation.md:78-96` for slicer-side checks |
| Chamfer under every protrusion instead of accepting an overhang | C6 flags it; C8 suggests | | | `SKILL.md:200` |
| 45° chamfers and countersinks are fine, planar or conical | C6 exact bands | | | fixes cad_khana's cone false positive |
| Lateral protrusions on end-printed parts are 45° trapezoid profiles, not boxes with step chamfers | C6 flags boxes | | | `SKILL.md:179-180` `observed` |
| Waive locally, with a reason and an area budget; never raise a global threshold to silence a check you have not located | waivers | | | `SKILL.md:228-231` |

## 7. Walls, edges and solids

| rule | check | gate | field | evidence |
| --- | --- | --- | --- | --- |
| Walls at least `wall_min` (features at least `feature_min`, webs at least `min_web`) | C7 | gate | `walls.*` | `starter`, 0.8 `observed` |
| No feather edges, ever: nothing tapers below 0.5 mm at a tangent or a knife edge | C7 knife edges | gate | `style.feather_mm`, `style.knife_deg` | `SKILL.md:174-178` `observed` |
| Every thin vertical feature on a plate gets a base fillet or haunch | C8 notch rule (later) | advisory | `style.notch_fillet_mm` | `SKILL.md:156-159` `observed` |
| Every re-entrant junction gets a fillet R2 to R6, except the swing envelope around joint axes | C8 notch rule (later); motion envelope from C4 | advisory | `style.notch_fillet_mm` | `SKILL.md:104-108` |
| Vertical rising edges R4.2 | C8 | advisory | `style.vertical_fillet_mm` | house style |
| All other non-critical edges 0.42 chamfer, as continuous rings including corner arcs | C8 (rims on lines and circles); ring continuity is review | advisory | `style.deburr_chamfer_mm` | house style |
| Dimension-critical edges (mating faces, teeth, slide ribs) stay sharp | style waiver per edge chain, reason "function beats style" | | | `SKILL.md:84-87` |
| Edge treatment order: raw, notch fillets, blends, one deburr pass at the end | review | | | `SKILL.md:109-112` |
| A printed part is one connected solid; glued-on bodies overlap their neighbour by ≥ 1 mm | C9 lumps with the reason | gate | `solids.overlap_skirt_mm` | `SKILL.md:139-142` |
| No sealed internal voids | by construction (wonky refuses the Boolean) | | | `SKILL.md:202-203` |

## 8. Formschluss and form (review rules)

These are Marc's taste and structure rules; no check decides them, the review
does (`cad-fdm-design/SKILL.md:89-129`):

- adjoining bodies close flush; derive dimensions from each other instead of
  picking two numbers that almost match;
- silhouette-defining features are one profile, with sketch vertex fillets for
  tangent blends;
- patterns are committed (one lattice, anchored at the part centre), not
  token;
- printed screws where size, load and access permit (Tr12x3 / Tr11x3,
  teardropped nut bore, wing screw printed lying);
- friction ridges added last and declared as a fidelity tier, so the checks
  see the part with ridges or record the proxy relation explicitly (design.md
  §5.14; replaces the silent `ridges=False` check variant, `SKILL.md:127-129`).

## 9. Slicer verification and physical tests

The geometric checks cannot certify supports actually generated, bridge
toolpaths, adhesion, strength or retained preload
(`bambu-preparation.md:64-103`, `fit-and-snap-review.md:75-87`). Keep:

- slicer preparation with the resolved machine profile and inspection of the
  exported 3MF (`bambu-preparation.md:9-37`);
- "support enabled is not support generated"; "a bridge-labelled path is not
  its unsupported span" (`bambu-preparation.md:64-103`);
- the first physical check is a complete mating set; report which states were
  tested;
- calibration coupons per fit class, orientation and material fill the
  profile's `calibration` list; only then does a fit report "calibrated".

## 10. build123d and OCCT gotchas that no longer apply in wonky

For models built in wonky, these notes of `cad-fdm-design/SKILL.md:131-152`
become obsolete, because the kernel answers exactly or refuses with a
capability error:

- edges without `topo_parent` and silent chamfer no-ops (a wonky operation
  either changes the model or refuses);
- tangent and coplanar Boolean "lottery" (exact, or refused with the case);
- batch chamfer segfaults;
- the bisector and diagonal convexity probes (exact convexity, C8);
- `Part + Part` returning mixed types.

They stay valid for projects still built with the real build123d.

## 11. Open points for Marc

- Which starter values are wrong for the current printers (A1 and the
  others)? The first coupon series should calibrate `fits.sliding`,
  `holes.*` and `bridge.max_span_mm`.
- Should the notch-fillet and base-fillet rules become gates once the C8
  notch rule exists?
- Knife-edge threshold: 60° (the wall opposition rule) or stricter?
