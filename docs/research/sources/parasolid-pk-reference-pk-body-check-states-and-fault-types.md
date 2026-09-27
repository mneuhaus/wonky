# Parasolid PK reference: PK_BODY_check states and fault types (`PK_check_state_t`, `PK_check_fault_t`, `PK_BODY_check_o_t`)

- Kind: vendor API reference (C header documentation pages, HTML).
- Canonical URLs (all HTTP 200 with `curl -A "Mozilla/5.0"` on 2026-09-22):
  - http://www.q-solid.com/Parasolid_Docs/headers/pk_check_state_t.html
  - http://www.q-solid.com/Parasolid_Docs/headers/pk_check_fault_t.html
  - http://www.q-solid.com/Parasolid_Docs/headers/pk_body_check_o_t.html (options structure, fetched as context)
  - http://www.q-solid.com/Parasolid_Docs/headers/pk_body_check.html (the function page, HTTP 200 on 2026-09-23 and read in full; the earlier run had hit a 404 at a different path)
  - http://www.q-solid.com/Parasolid_Docs/headers/pk_check_geom_t.html, `pk_check_bgeom_t.html`, `pk_check_fa_fa_t.html`, `pk_check_size_box_t.html` (option enums)
  - Local copies: `tmp/research/parasolid-pk/*.html`.
- Organization: Siemens Digital Industries Software (Parasolid). These are mirror pages without a version number in the path. The footer is a JavaScript "Generated on: <document.lastModified>" stub, so the version and date are unknown. INFERRED: the content matches the V35-era checker described in the Overview (`overview-of-parasolid-v35-july-2022.md`, §3.7.3).
- License: proprietary API documentation. Porting implication: the code and headers cannot be copied. A fault *taxonomy* and a record shape are functional facts. Reimplementing a similar classification with wonky's own names is unproblematic. INFERRED; not legal advice.
- Status: part of the shipping PK interface. The kernel is actively developed (V38 in 2025; see the Parasolid overview note). DOCUMENTED (secondary).

## What it is

The data contract of Parasolid's body checker:

```
PK_ERROR_code_t PK_BODY_check(PK_BODY_t body, const PK_BODY_check_o_t *options,
                              int *n_faults, PK_check_fault_t **faults)
```

There are three data pieces plus the function contract (§4 below). DOCUMENTED on the URLs above.

### 1. `PK_check_state_t` (`typedef int`)
A flat enum of fault states, namespaced by entity class:
- **BODY**:
  - `corrupt_c` ("data structure is corrupt");
  - `invalid_ident_c` (invalid or duplicate identifiers);
  - `inside_out_c`;
  - `bad_regions_c`;
  - `ok_c`.
- **EDGE**:
  - `open_c` ("open or non-periodic curve on ring edge");
  - `bad_vertex_c` ("vertex does not lie on edge's curve");
  - `reversed_c`;
  - `bad_spcurve_c` ("spcurve not within edge's tolerance");
  - `vertices_touch_c`;
  - `bad_face_order_c` (non-manifold edge: "the face order around the edge does not match the order of the faces' surfaces");
  - `bad_wire_ed_ed_c` (wire edges intersect away from a vertex);
  - nominal-geometry twins `open_nmnl_c`, `bad_vertex_nmnl_c`, `bad_sp_nmnl_c`, `reversed_nmnl_c`;
  - `bad_order_c` ("edges incorrectly ordered at vertex").
- **ENTITY**: `invalid_c` ("the entity, usually geometric, is invalid").
- **FACE**:
  - `bad_vertex_c` / `bad_edge_c` (does not lie on the face's surface);
  - `bad_edge_order_c`;
  - `no_vtx_at_sing_c` ("a surface singularity has no accompanying vertex");
  - `bad_loops_c`;
  - `self_int_c`;
  - `bad_wire_fa_ed_c`;
  - `check_fail_c` ("checker failure during face/face check");
  - `bad_face_face_c` ("face face inconsistency");
  - `redundant_c` ("face redundant with respect to tolerances").
- **GEOM**: `self_int_c`, `degenerate_c`.
- **REGION**: `bad_shells_c`.
- **SHELL**:
  - `bad_topol_geom_c` ("a topological entity belonging to a shell is not geometrically within the shell");
  - `bad_sh_sh_c`.
- **TOPOL**:
  - `not_G1_c`;
  - `size_box_c` (outside the 1000-unit size box);
  - `check_fail_c` ("checker failure");
  - `no_geom_c`.
- **Misc**:
  - `CURVE_state_inconsistent_c` (inconsistent loop directions of curves);
  - `LOOP_state_invalid_c` ("invalid loop combination for surface type");
  - `ATTDEF_state_bad_name_c` and `ATTRIB_state_bad_string_c` (not transmissible in text XT).

### 2. `PK_check_fault_t`
```
{ PK_check_state_t state; PK_ENTITY_t entity_1 /* always present */;
  PK_ENTITY_t entity_2 /* may be PK_ENTITY_null */; PK_VECTOR_t position /* "position within faulty volume" */ }
```
- Unused `entity_2` is `PK_ENTITY_null`. Unused `position` is `(0.0, 0.0, 0.0)`.
- A per-state table fixes which fields are populated:
  - `entity_2` is set for:
    - EDGE `bad_vertex` (vertex);
    - FACE `bad_vertex` (vertex), `bad_edge` (edge), `bad_wire_fa_ed` (edge), `check_fail` (face), `bad_face_face` (face);
    - EDGE `bad_wire_ed_ed` (edge);
    - SHELL `bad_sh_sh` (shell).
  - `position` is set for:
    - `bad_wire_ed_ed`, FACE `self_int`, `bad_wire_fa_ed`, `bad_face_face`, `bad_sh_sh` ("point in region of inconsistency");
    - `no_vtx_at_sing` ("point at singularity");
    - GEOM `self_int` ("point on self-intersection");
    - GEOM `degenerate` ("point in degenerate region").

### 3. `PK_BODY_check_o_t` (options)
- `o_t_version`.
- `max_faults` (default 10).
- Independent toggles, all defaulting to "yes":
  - `geom`, `bgeom` (B-geometry);
  - `top_geo` (topology/geometry inconsistency);
  - `size_box`;
  - `fa_X` (face self-intersection);
  - `loops`;
  - `fa_fa` (face-face inconsistency);
  - `sh` (negated or inconsistent shells);
  - `corrupt`.
- Not all toggles are binary. DOCUMENTED (`pk_check_geom_t.html`, `pk_body_check.html`):
  - `geom` has five levels:
    - `no`;
    - `basic` ("invalid or degenerate geometry");
    - `lazy` (adds self-intersection);
    - `full` ("as for lazy but ignore the results of pre-V5 checks");
    - `yes` ("do all geometry checks regardless of previous checks or interface parameters").
  - `top_geo` has four levels: `no`, `edge`, `face`, `yes`.
  - `fa_fa` (`pk_check_fa_fa_t.html`), `size_box` (`pk_check_size_box_t.html`) and `bgeom` (`pk_check_bgeom_t.html`, "check continuity of B-geometry") are plain two-valued no/yes enums (re-read 2026-09-24).

### 4. `PK_BODY_check` function contract. DOCUMENTED (`pk_body_check.html`).
- **Errors:**
  - `PK_ERROR_check_error`: a fault was found while `max_faults = 0`, which makes the check fail-fast. The first faulty entity is returned in the error structure.
  - `PK_ERROR_check_failure` / `check_fail`: checker failure.
  - `PK_ERROR_bad_option_data`: `max_faults < 0`.
- **No options** means "all checks appropriate to the body".
- **Verdict caching on geometry:**
  - "Geometry which passes these tests is marked so that the cost of these tests need only be incurred once. Geometry which fails is also marked for the same reason."
  - `lazy` trusts the marks; `full` distrusts marks written by pre-V5 checkers; `yes` ignores all marks.
  - The XT format stores this mark as a self-intersection enum including `SCH_checked_ok_in_old_version` (XT V35 text, lines ~1849-1863).
- **B-curve restrictions** (with `bgeom`):
  1. no zero-length first derivative;
  2. no self-intersection;
  3. no cusp interior to a segment;
  4. at least G0.
- **B-surface restrictions** (with `bgeom`):
  1. no zero-length first derivative except at a legal degeneracy;
  2. no self-intersection;
  3. no ridge or cusp interior to a patch;
  4. at least G0;
  5. a surface closing on itself must do so along the whole boundary, never at a single point;
  6. a legal degeneracy collapses a whole boundary span between knots to one point;
  7. no corner degenerate in both parameters.

  Offset surfaces of B-surfaces are also checked for self-intersection.
- **`top_geo` checks on attached geometry:**
  - edge curves must be G1, and periodic if closed;
  - face surfaces must be G1, with G1 constant-parameter lines, periodic if closed, and degenerate only along an entire boundary.

  Failures give `TOPOL_state_not_G1_c`.
- **Per-group fault tables** fix `entity_1`, `entity_2` and `position` for every state (see §2).
- `bad_wire_fa_ed`, `EDGE bad_face_order`, `SHELL bad_topol_geom` and `SHELL bad_sh_sh` "can only occur for general bodies" (non-manifold).
- **Caveats:**
  - "If there is more than one fault in the body then the function does not guarantee to return all the faults."
  - "When some types of check are omitted, a body which would fail them may produce misleading results or checker failures when other checks are applied."
  - "Very occasionally, checker failures are caused by difficult geometric configurations or the unexpected failure of an internal numerical algorithm; such failures should not be taken to indicate that the body is invalid."

## How it works

- DOCUMENTED (Overview V35 §3.7.3, http://www.q-solid.com/Parasolid_Docs_V35/pdf/ov.pdf, p. 43):
  - Checks run in groups in sequence. A group only runs if earlier groups passed.
  - The options struct selects the groups.
  - Faults are returned as an array of `PK_check_fault_t`, up to `max_faults`.
- INFERRED: the toggle list mirrors that group order, from cheapest structural checks to the expensive global ones:
  1. corrupt / identifiers;
  2. geometry;
  3. topology-geometry;
  4. loops;
  5. face self-intersection;
  6. face-face;
  7. shells.

  Some states in `PK_check_state_t` (`FACE redundant`, `CURVE inconsistent`, `LOOP invalid`, `EDGE bad_order`) do not appear in the body fault table. They are probably emitted by other entity-level check functions (for example face, edge or geometry checks).

## Robustness and guarantees

- DOCUMENTED: the checker reports its own failure as a fault:
  - `PK_FACE_state_check_fail_c` ("checker failure during face/face check");
  - `PK_TOPOL_state_check_fail_c` ("checker failure").

  "Could not decide" is thus distinct from "valid" and from "invalid".
- DOCUMENTED (Overview §3.7.3): local checking does not guarantee finding pre-existing invalidity.
- DOCUMENTED (`pk_body_check.html`): there is explicitly no completeness guarantee.
  - "the function does not guarantee to return all the faults";
  - omitted check groups can cause "misleading results or checker failures" in the remaining groups;
  - checker failures from "difficult geometric configurations or the unexpected failure of an internal numerical algorithm ... should not be taken to indicate that the body is invalid".

## Parallelism and performance

- DOCUMENTED (Overview §17.2.3): validity checking is SMP-enabled "at the face level", with at most 8 threads. It helps even for a single body, "because several faces can be checked together", and applies wherever checking is called internally by other PK functions (Functional Description V35 §114.3, http://www.q-solid.com/Parasolid_Docs_V35/chapters/fd_chap.115.html).
- DOCUMENTED (same chapter, §114.2.5): "If PK_BODY_check returns several errors, the order of the errors in the return structure may vary if SMP is enabled". Combined with `max_faults` truncation, INFERRED: with SMP on, *which* ten faults a broken body reports can also vary between runs.
- DOCUMENTED: `max_faults` (default 10) and the per-group toggles are the cost controls.
- INFERRED: face-face and shell-shell checks are the quadratic, expensive parts, and they are the ones that carry a `position`.

## Known failures, limitations, war stories

- DOCUMENTED:
  - Nominal-geometry fault twins exist because tolerant edges without a 3D curve needed an optional accurate curve (Overview §3.6.2). The fault taxonomy grew with the tolerant-modelling retrofit.
  - `size_box_c` shows that Parasolid's fixed 1000-unit box is a hard validity constraint.
  - Attribute string and name faults (XT text transmissibility) show that "valid" includes "serializable".
- INFERRED:
  - With `max_faults` = 10 by default, a badly broken body reports only its first ten faults.
  - The gated groups mean downstream faults are hidden until upstream ones are fixed.

## Relevance for wonky

1. **Structured validation output (compare/interference is missing).**
   - Adopt the shape `{state, entity_1, entity_2?, position?}` with a per-state schema of populated fields.
   - Wonky's failures today are a FeatureScript source location (for example `fixtures/r10b/r10b.fs:25:2`) plus a reason. The hybrid Boolean already has two typed refusal classes in Bend, `BCert` (the tagged mesh is not certified as the Boolean's solid, answer `unresolved`) and `BNo` (only exact recovery refused, answer a certified mesh), each with a reason string (`docs/proto-recover.md`, type `Out` in `kernel/hybrid/recover/topo.bend`). The PK taxonomy is the finer layer below that: a stable state per reason, with the entities and witness point it involves. A typed fault record makes acceptance tests assert *which* invariant broke, and gives interference results (`bad_face_face` with a witness point) the same format. INFERRED.
2. **Explicit "checker failed" state.**
   - Wonky's rule is "unsupported cases must fail explicitly".
   - Parasolid already distinguishes checker failure from invalidity. Wonky's exact/F32x2 predicates should return `undecided` → `check_fail` instead of guessing. INFERRED.
3. **Witness positions.**
   - Every geometric fault carries a 3D point in the inconsistent region.
   - For a pure, deterministic kernel this is ideal: tests can pin the witness, and the FeatureScript debugger can highlight it. INFERRED.
4. **Tolerance-aware states.**
   - `bad_spcurve_c` (pcurve outside the edge tolerance) and `FACE redundant_c` correspond directly to wonky's contract 2 (numeric uncertainty vs modeled tolerance) and contract 3 (3D curve plus per-face pcurves).
   - Wonky's STEP pcurve export (`docs/step-pcurves.md`) needs exactly the `bad_spcurve` check before writing. INFERRED.
5. **Cheap-to-expensive gated groups with toggles and a fault cap.** These fit fork-join. Each group is one parallel map over faces or face pairs, followed by a deterministic merge sorted by (state, entity ids). Apply the `max_faults` cap *after* sorting, so the reported subset is stable across thread counts; Parasolid does not guarantee this under SMP (see "Parallelism"). INFERRED.
6. **Bend fit.**
   - States map to a plain Bend ADT, with one constructor per state carrying exactly its fields. That is stricter than the C struct with null and zero sentinels.
   - U32 entity ids plus an F32x2 position fit the numeric model.
   - No mutation or FFI is needed. INFERRED.
7. **Verdict caching without mutation.**
   - Parasolid marks geometry in place as checked, and later needs `full`/`yes` levels to distrust marks written by older checker versions.
   - In wonky's immutable data model this becomes a memo table keyed by (content hash of the geometry record, checker version). Stale verdicts are impossible by construction, and "re-check pre-V5 marks" becomes "bump the checker version". INFERRED.
8. **Fail-fast mode.** `max_faults = 0` turns the checker into a first-fault error. That is the right production default for wonky's "fail explicitly" rule, with the full fault list reserved for tests and debugging. INFERRED.
9. **Ready-made B-spline validity rules.** The seven B-surface and four B-curve restrictions, plus the `top_geo` G1 and periodicity rules, are a concise acceptance spec for when wonky adds B-spline or procedural surfaces (fillets, SSI curves). Each rule is a per-patch, per-segment test and so a uniform parallel map. INFERRED.
10. **"Checker failure is not invalidity"** (DOCUMENTED quote above). Wonky's validator must keep the third outcome, `undecided`, as its own fault state and never collapse it into pass or fail.

## Pointers worth porting or studying

- The full state list as a checklist for wonky's validator coverage. For each state, ask "do we check this?" In particular: `inside_out`, `bad_regions`, `no_vtx_at_sing` (cone apex), `bad_face_order` on non-manifold edges, `bad_topol_geom`, `vertices_touch`, `redundant`.
- The per-state field table (which states carry `entity_2` and `position`).
- The options struct as a model for check tiers, `max_faults`, and a versioned option record (`o_t_version`) for forward compatibility.
- Related: ACIS's checker levels and insanity IDs (`acis-r17-checker-and-intersectors-articles.md`). Parasolid groups by entity/check type; ACIS by cost level.

## Verdict: adapt

A compact, battle-tested fault taxonomy and record shape. It maps straight onto wonky's need for structured validation and compare/interference output, and onto the explicit-failure rule via the `check_fail` states.

It is proprietary header documentation, so reimplement the idea as native Bend types with wonky names. Do not copy the headers. The Parasolid-specific parts (size box, XT text transmissibility) should be dropped or replaced with wonky's own constraints (serialization of the operation record, F32 range).
