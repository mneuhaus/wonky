# Fillets and chamfers: mathematics and algorithms

Status: 23 September 2026, fillet landscape part 1 (survey). Nothing in this
document is implemented. It is the theory that the prototype ports of part 2
should be built from and judged against.

**Labels.** Every claim that matters carries one of:

- **DOCUMENTED**: stated in a source that was read (the deep-read notes in
  `docs/research/sources/`, a paper, vendor docs, or kernel code).
- **MEASURED**: checked by running something in this repo. The numeric checks
  are in `tmp/fillet/theory-checks.mjs` (run with `node`).
- **INFERRED**: derived here from documented facts. The derivations are
  written out so that they can be checked.
- **HEARSAY**: remembered or second-hand and not verified in this pass.

The sources are cited by their note name, for example
`occt-modeling-algorithms-guide-and-tkfillet-chfi3d-fillets-c.md` (short:
"OCCT note"). The notes carry the URLs, licences and page references.

**Licences, short form** (the notes have the details):

| source | licence | what may be used |
|---|---|---|
| OCCT (ChFiKPart, BlendFunc, ChFi3d) | LGPL-2.1 + exception | ideas and algorithms only; AGENTS.md forbids OCCT in production, and translated code would be LGPL-derived. OCCT is an oracle via `uv run`, never a dependency |
| monstertruck / truck | Apache-2.0 | may be ported with attribution |
| remus | Apache-2.0 | contract layer and types may be ported with attribution |
| Onshape std library (`fillet.fs`, enums, bounds) | MIT | may be copied with the notice |
| Parasolid FD, ACIS docs | proprietary documentation | vocabulary and behaviour only, no text |
| HP/CoCreate patents US5615317A, US6133922A | expired | methods free to implement |
| Geomagic setback patent US8004517B1 | in force until 2027-12-17 | check before any commercial release |
| papers (Choi-Ju, Kós-Martin-Várady, Lukács, Dahl, Shene, Wallner-Pottmann, Rossignac-Requicha) | journal copyright | mathematics may be re-derived freely |

## 0. Reading guide and the one-page summary

1. A constant-radius fillet is the envelope of a ball of radius `r` that
   touches both faces. Its **spine** (the ball-centre path) is the
   intersection of the two faces' offsets by `r` toward the ball; its **contact
   curves** are the spine moved back by `r` along each face normal; its cross
   section is a circular arc. Everything else in this document is a special
   case, an existence condition, or what happens at the ends (section 2).
2. **Two symmetry theorems decide when the fillet is analytic** (section 4):
   - if both faces are invariant under one translation direction `d` (planes
     containing `d`, cylinders with axis parallel to `d`) the problem is a 2D
     fillet in the plane perpendicular to `d`, and the fillet is a
     **cylinder**;
   - if both faces are surfaces of revolution about one common axis (plane
     perpendicular to it, coaxial cylinder, cone, torus, sphere centred on it)
     the problem is a 2D fillet in the meridian half-plane, and the fillet is a
     **torus** (a **sphere** when the arc centre lies on the axis).

   Every other pair gives a pipe surface around a non-circular spine. That is
   exact only as a procedural surface or a rational B-spline, never as a
   plane, cylinder, cone, sphere or torus.
3. Chamfers follow the same two theorems: **plane** in the translation family,
   **cone** (or plane or cylinder) in the rotation family, a rational ruled
   surface otherwise.
4. The dihedral angle enters through the angle `θ` between the face normals:
   contact setback `r·tan(θ/2)`, centre distance `r/cos(θ/2)`, arc angle `θ`,
   section area `r²(tan(θ/2) − θ/2)` (section 3).
5. Vertices: a **sphere** corner exists whenever three blends of equal radius
   and uniform convexity meet (section 6). Everything else (unequal radii,
   mixed convexity, valence ≥ 4 without a common point) needs a setback
   n-sided patch, which is a new non-analytic surface type.
6. **wonky today** (MEASURED by reading `kernel/analytic.bend` and grepping
   `src/`): surfaces `Plane`, `Cylinder`, `Cone`; curves `Line`, `Circle`,
   `Ellipse`. Sphere and torus exist only in `kernel/proto/recover/geom.bend`
   (`SSphere`, `STorus`) and the bake-off test serializer. So wonky can hold
   exactly, today: every chamfer of the two symmetric families, plane/plane and
   other translation-family fillets, and linear variable-radius plane/plane
   fillets (a cone, section 8). It needs `Torus` and `Sphere` for cap-edge
   fillets and sphere corners, which are the most common FDM cases after
   plane/plane (section 11).

## 1. Conventions and definitions

### 1.1 Orientation

- A face `F` has a carrier surface and a `same_sense` flag
  (`kernel/analytic.bend`, type `Face`). `n_F(p)` is the **outward** unit
  normal of the face at `p`: the surface normal, negated when `same_sense` is
  false.
- Loops run counter-clockwise when viewed from outside, i.e. looking along
  `−n_F`, so material is on the left of each coedge. (INFERRED as the kernel
  convention; confirm against `kernel/topology.bend` before implementing.)
- An edge `E` between faces `F1` and `F2` has a unit tangent `t(p)` oriented
  **as the coedge of `F1`**.

### 1.2 Convexity

The edge is **convex** at `p` iff

```
(n1 × n2) · t > 0          n_i = n_{F_i}(p), t oriented along F1's coedge
```

concave iff `< 0`, and smooth (tangent faces) iff `n1 × n2 = 0`. INFERRED;
checked on a box: top face `n1 = +z`, front face `n2 = −y`, the top face's
counter-clockwise loop runs along `+x` on the front edge, and
`(z × −y)·x = +1`, which is convex, as it should be.

- Onshape's `EdgeConvexityType` has a fourth value, `VARIABLE`, for an edge
  whose convexity changes along its length (DOCUMENTED, Onshape FS note). ACIS
  refuses such edges with `BL_NON_U_CVXTY` and asks the user to split them
  (DOCUMENTED, ACIS note). The same test gives it: the sign of
  `(n1 × n2)·t` changes along the edge.
- The sign test is an exact-predicate candidate. Near zero the edge is nearly
  smooth and the fillet nearly vanishes (section 3.2). Decide with the
  filtered or exact path and return "smooth or undecidable" rather than
  guessing.

### 1.3 Ball side and oriented offsets

- The ball of a **convex** edge lies inside the material; it removes material
  (a *round*). The ball of a **concave** edge lies outside the material; it
  adds material (a *fillet*). DOCUMENTED (ACIS `…ad`, Rossignac thesis
  property 3.35).
- The **ball-side normal** of face `F_i` is `m_i = −n_i` for a convex edge and
  `m_i = +n_i` for a concave edge. It points from the surface toward the ball
  centre.
- The **oriented offset** of face `F_i` by `r` is `O_i = { p + r·m_i(p) }`.
  Dahl's thesis handles the same choice by oriented surfaces and signed ball
  radii (DOCUMENTED, Dahl §2.2, Fig. 2.2): the ball is placed where its
  orientation agrees with both surfaces.

### 1.4 Two semantics of "fillet"

- **Global (morphological)**, Rossignac & Requicha (DOCUMENTED, Rossignac
  note):
  - rounding `R_r(S) = (S↓r)↑r`, the opening: the union of all balls of
    radius `r` inside `S`;
  - filleting `F_r(S) = (S↑r)↓r`, the closing.
  - Properties: `R_r(S) ⊂ S ⊂ F_r(S)`, idempotence, `R_a(R_r S) = R_r S` for
    `a ≤ r`.
  - Side effects: global rounding disconnects thin necks (< 2r), global
    filleting bridges gaps (< 2r) between disjoint features and fills slots.
- **Edge-local (what CAD does)**: only the selected edges are blended; the ball
  touches exactly the two faces of the edge (plus overflow rules, section 10).
  This is Onshape/Parasolid, ACIS, OCCT.
- **Relation (INFERRED, from the Rossignac note):** away from the edge ends,
  and when the ball fits, the edge-local fillet equals the boundary of
  `R_r(Q)` (convex) or `F_r(Q)` (concave) for the local wedge `Q` at the edge.
  That makes the global operators a **test oracle** for the local operation.
  They are not the semantics wonky should implement for `opFillet`.

### 1.5 Vocabulary

Wonky should use the shared vocabulary of Parasolid, ACIS and Onshape so that
errors and docs line up with public material (DOCUMENTED terms, see the Vida,
ACIS and Parasolid notes):

| term | meaning |
|---|---|
| primary / support faces | the two faces being blended |
| spine | the path of the ball centre |
| spring curve / contact curve / trimline | where the blend touches a support |
| cross section / profile | the blend's curve in a plane transverse to the spine |
| cross curve | the blend's boundary where it stops (setback plane, cap face) |
| range | a blend's distance from a support (two ranges = asymmetric) |
| terminal / internal vertex | one / several blended edges end there |
| bi-blend | two blends meeting tangentially at a vertex |
| miter | two blends meeting non-tangentially |
| end cap / side cap | a face that terminates a blend / trims one side of it |
| setback | distance from a vertex at which an edge blend is stopped |
| overflow (smooth, cliff, cliff-end, notch) | Parasolid's names for a blend leaving its support faces |
| cliff edge | an existing edge that forms a blend boundary without tangency |

## 2. Constant-radius rolling-ball blends

### 2.1 Construction

For supports `S1`, `S2` with ball-side normals `m1`, `m2` and radius `r`
(DOCUMENTED as the standard construction: Choi-Ju note, Kós-Martin-Várady
§3.2 Fig. 6, Dahl Remark 2.1, ACIS `…bg`, Parasolid FD §29.2):

1. **Offsets.** `O_i = S_i + r·m_i`.
2. **Spine.** `s(t) ∈ O1 ∩ O2`. For each spine point there are parameters
   `(u_i, v_i)` with `S_i(u_i, v_i) + r·m_i(u_i, v_i) = s(t)`.
3. **Contacts.** `P_i(t) = s(t) − r·m_i(u_i(t), v_i(t))`. They come with their
   surface parameters, i.e. they are exact pcurves up to the accuracy of the
   spine.
4. **Section.** The characteristic circle of the ball at `s(t)` is the great
   circle in the plane through `s(t)` perpendicular to `s'(t)`. Both contacts
   lie on it: `s − P_i = r·m_i`, and `m_i ⟂ s'` because `s` moves on the
   offset `O_i`, whose normal at `s` is `m_i`. (INFERRED, standard.)
5. **Blend** = the shorter arc of the characteristic circle from `P1` to
   `P2` ("the portion of the pipe between the spring curves with smaller arc
   length", DOCUMENTED ACIS `…bg`).

The whole ball envelope is a **pipe surface**
`F(t, v) = s(t) + r·(cos v·N(t) + sin v·B(t))` with `(T, N, B)` the Frenet
frame of the spine (DOCUMENTED, Patrikalakis-Maekawa-Cho 11.6).

### 2.2 The exact cross-section arc

With `a = (P1 − s)/r`, `b = (P2 − s)/r`, `cos θ = a·b` (`θ` is the arc angle;
section 3 shows it equals the angle between the face normals):

- control points `P1`, `T`, `P2` with the apex
  `T = s + r·(a + b)/(1 + a·b)`, the intersection of the two contact tangents
  in the section plane, at distance `r/cos(θ/2)` from `s`;
- weights `(1, w, 1)` with `w = cos(θ/2) = sqrt((1 + a·b)/2)`;
- `B(σ) = [(1−σ)²P1 + 2σ(1−σ)w·T + σ²P2] / [(1−σ)² + 2σ(1−σ)w + σ²]`.

DOCUMENTED (Choi-Ju note, citing Lee 1987; the same arc is in monstertruck's
`ContactCircle`). The arc is exact for every `θ < π`. A single rational
quadratic cannot represent `θ ≥ π`; fillet arcs are always `< π` because
`θ < π` (section 3).

- Wonky has `Circle` curves already, so a cross curve that is an arc needs no
  rational form in the kernel. The rational form matters for (a) conic
  profiles (section 9), (b) NURBS export of non-analytic blends, and (c) the
  G1 end conditions of n-sided corner patches.

### 2.3 Existence conditions

A blend of radius `r` exists and is a regular surface when all of these hold.
Each is a named failure when it does not (section 10).

1. **Regular offsets.** The offset of `S_i` toward the ball must not have a
   cusp in the contact region:

   ```
   1 − r·κ_i > 0   for both principal curvatures κ_i of S_i,
   κ measured positive when S_i bends toward the ball
   ```

   DOCUMENTED as the offset singularity condition `κ = −1/d` (Patrikalakis
   11.3.1-11.3.2) and as ACIS's "geometric limitation on the blend radius"
   (a convex support whose radius is below the blend radius makes the spring
   curve loop; ACIS fails). For wonky's surfaces this is a scalar test
   (INFERRED):
   - plane: always true;
   - cylinder or cone of radius `ρ` with the ball **inside** it (`m` points to
     the axis): `r < ρ` (for a cone, `ρ` is the local radius divided by the
     cosine of the half-angle, the principal radius of curvature, evaluated
     over the contact region);
   - ball outside a cylinder or cone: always true;
   - sphere of radius `ρ`, ball inside: `r < ρ`;
   - torus: the tightest principal radius toward the ball, which is the minor
     radius (tube side) or `major − minor` on the inner equator
     (Patrikalakis note, "κmax is attained on the inner equator").
2. **The offsets intersect.** `O1 ∩ O2` must be non-empty near the edge. It
   is empty when, for example, the ball is larger than the available gap
   (a plane and a cylinder whose offsets miss each other).
3. **The pipe is regular on the used arc.** The pipe `F(t, v)` above has
   `|F_t × F_v| = r·|1 − r·κ_s(t)·cos v|·|s'|` (standard canal-surface
   Jacobian). With `v` measured from the spine's principal normal `N`
   (toward the spine's centre of curvature), the used arc must satisfy

   ```
   r·κ_s(t)·cos v < 1    for every v on the arc from P1 to P2
   ```

   DOCUMENTED for the whole pipe as "local self-intersection iff r·κ ≥ 1"
   (Patrikalakis 11.6; Dahl Thm 3.26). The **restriction to the used arc** is
   INFERRED and matters: remus found that the old bound `r ≤ ρ/2` for an inside
   plane/cylinder torus "refused sound geometry" because the used quarter tube
   never reaches the self-intersecting part of a spindle torus (DOCUMENTED,
   remus note). Section 4.6 works this out.
4. **No global self-intersection.** Two distant parts of the pipe must not
   meet: spine self-distance `> 2r` between non-neighbouring parameters,
   plus end-circle checks (DOCUMENTED, Patrikalakis 11.6.3 body/body,
   end/body, end/end).
5. **Contacts stay on their faces.** `P_i(t)` must lie inside face `F_i` for
   every `t` of the edge. When it does not, the blend overflows (section 10.3).

### 2.4 The general (non-closed-form) solver

For pairs outside the symmetric families the spine has no closed form. Two
documented residual systems solve one section at a time:

- **OCCT `BlendFunc_ConstRad`** (DOCUMENTED, OCCT note, LGPL, ideas only).
  Unknowns `(u1, v1, u2, v2)`; guide point `G(t)` on a guide curve, section
  plane normal `ν = G'/|G'|`:
  - `E1 = ν·(P1 + P2)/2 − ν·G(t) = 0`: the contact midpoint lies in the
    section plane;
  - `E2..4 = P1 + r·(ν·n1·ν − n1)/|ν × n1| − P2 − r·(ν·n2·ν − n2)/|ν × n2| = 0`:
    the centres computed from both contacts, with normals projected into the
    section plane, coincide.

  Newton per section, marching along `t` (`BRepBlend_Walking`).
- **monstertruck contact circle** (DOCUMENTED, monstertruck note, Apache-2.0,
  portable). For a point `p` on the edge and current contacts `p0`, `p1` with
  normals `n0`, `n1`:
  - solve the 3×3 linear system with rows `(e', n0, n1)` (edge tangent, then
    the two normals) and right-hand side
    `(e'·p, n0·p0 − s·r, n1·p1 − s·r)` for the centre `c`;
  - target contacts `q_i = c + s·r·n_i`;
  - project each surface onto its target by one Gauss-Newton step with the
    first fundamental form, `[Su·Su Su·Sv; Su·Sv Sv·Sv]·Δ = [Su·d, Sv·d]`;
  - iterate (up to 100 times in monstertruck).

  v-derivatives of any order come from differentiating the linear system by
  Leibniz expansion (DOCUMENTED, `der_routine`).
- **Kós-Martin-Várady inner projection** (DOCUMENTED, Kós note §3.2.3): move a
  point onto the spine by `x ← x + α·v1 + β·v2` with
  `[1 g; g 1]·[α β]ᵀ = [r − d1, r − d2]ᵀ`, `g = v1·v2`, then slide along
  `v1 × v2`. Its sensitivity `dc/dR = (v1 + v2)/(1 + v1·v2)` is the spine's
  derivative with respect to the radius, useful for radius sweeps and for the
  "largest radius that fits" diagnostic.

**Section-plane choice matters.** OCCT and monstertruck put the section plane
perpendicular to a guide (the original edge). The rolling-ball definition puts
it perpendicular to the spine. They coincide in both symmetric families
(section 4) and differ in general. For constant radius the surface is the same
pipe either way; only its parametrisation differs. For variable radius the
choice changes the geometry (section 8). INFERRED.

**Bend fit** (INFERRED, consistent with the notes): the per-section work is
small, uniform and branch-light (3×3 or 4×4 solves, surface evaluation), so
sample sections at fixed `t`, solve each independently (fork-join or GPU
lanes), certify chord deviation between samples, and subdivide failing
intervals. That replaces the sequential marcher. The existence tests of
section 2.3 are per-sample and should run before any construction.

### 2.5 Certification oracle for any constant-radius blend

Independent of how a blend was built (INFERRED from the Kós and Choi-Ju
notes; the maximum-ball residual is DOCUMENTED in Kós §3.3):

- sample points `x` on the blend face; for each, the ball centre is
  `c = x + r·N_blend(x)` (with the blend normal pointing to the ball side);
- assert `dist(c, S1) = dist(c, S2) = r` (to tolerance), with the closest
  points inside `F1`, `F2`;
- assert the blend normal equals `m_i` at the contacts (G1);
- the plane/plane closed form of the maximum-ball radius (DOCUMENTED, Kós
  §3.3.1, elimination INFERRED there):
  `(R−d1)² − 2g(R−d1)(R−d2) + (R−d2)² = (1−g²)R²`, larger root.

This catches wrong side, wrong spine, wrong radius and wrong trim without
reusing construction code.

## 3. The dihedral angle

Let `θ ∈ [0, π)` be the angle between the face normals at the edge point,
`cos θ = n1·n2 = m1·m2` (the `m`s differ from the `n`s by the same sign), and
`φ = π − θ` the opening angle of the wedge the ball sits in (the material
angle for a convex edge, the air angle for a concave one).

### 3.1 Plane/plane quantities

With `e` a point on the edge (INFERRED; the centre formula MEASURED in
`tmp/fillet/theory-checks.mjs`):

| quantity | formula | note |
|---|---|---|
| ball centre | `c = e + r·(m1 + m2)/(1 + m1·m2)` | satisfies `m_i·(c − e) = r`; no trig |
| centre distance from the edge | `r/cos(θ/2) = r/sin(φ/2)` | Onshape `findRadiusToOffsetRatio` uses `1/cos(θ/2)` (DOCUMENTED) |
| contact distance along each face | `r·tan(θ/2) = r·cot(φ/2)` | at 90° this is `r` |
| contact chord ("width") | `r·|m1 − m2| = 2r·sin(θ/2)` | Onshape converts width to radius by `radius = width/|n0 − n1|` (DOCUMENTED) |
| arc angle | `θ` | |
| arc length | `r·θ` | |
| section area between the corner and the arc | `r²·(tan(θ/2) − θ/2)` | MEASURED at `θ = 60°` (0.0537514 sampled vs 0.0537515) |
| volume removed or added along a straight edge of length `L` | `L·r²·(tan(θ/2) − θ/2)` | at 90°: `L·r²(1 − π/4)` |

Numerically stable forms (INFERRED): `tan(θ/2) = |n1 × n2|/(1 + n1·n2)`,
`cos(θ/2) = sqrt((1 + n1·n2)/2)`. No `acos` is needed except for the arc
angle itself, and the rational arc of section 2.2 needs only `cos(θ/2)`.

**A documented bug to avoid.** remus computed the contact setback from half
the normal angle where it needed the wedge half-angle. The two coincide only
at 90°; on a 178.9° ridge the contacts landed about `100·r` away instead of
about `0.01·r` (DOCUMENTED, remus note). Write every formula in terms of `m1`,
`m2` as above and test at 10°, 90°, 170° and 179°.

### 3.2 What the angle does

- **Sharp edges** (`θ → π`, wedge `φ → 0`, a knife edge): contacts run away as
  `r·tan(θ/2) → ∞`. The fillet needs ever wider faces; it overflows or fails
  with `FILLET_FACE_RANGE_TOO_LARGE` long before the formulas degenerate.
  The largest radius that fits a face of available width `w` is
  `r_max = w/tan(θ/2)`. INFERRED; this is also the useful diagnostic value
  ("radius 3 does not fit; 2.4 would").
- **Nearly smooth edges** (`θ → 0`): the fillet shrinks to nothing:
  contact distance `≈ r·θ/2`, section area `≈ r²θ³/24`. The blend is
  numerically delicate (two nearly equal normals) and topologically delicate
  (the fillet face is a sliver tangent to both supports). An exactly smooth
  edge has nothing to fillet: Onshape reports `FILLET_FAIL_SMOOTH` "Could not
  fillet smooth edges" (DOCUMENTED, Onshape FS note).
- **Right angle**: every quantity simplifies (`r`, `r·√2`, `π/2`); this is the
  dominant FDM case and must never be the only test angle.
- **Chamfer width** depends on the chamfer definition (section 5): for
  `FACE_OFFSET` it shrinks as the dihedral opens, for in-face distances it does
  not (DOCUMENTED, ACIS and Parasolid notes).
- **Convex vs concave with the same `θ`**: the section geometry is identical;
  only the side of the ball, the offset direction, the Boolean sign
  (remove vs add), and the curvature condition of section 2.3 change.

### 3.3 Convex vs concave in practice

| | convex edge (round) | concave edge (fillet) |
|---|---|---|
| ball | inside material | outside material |
| `m_i` | `−n_i` | `+n_i` |
| effect | removes material | adds material |
| offset regularity (section 2.3) bites when | a support curves toward the inside of the material, e.g. the top edge of a thin boss (ball inside the cylinder: `r < ρ`) | a support curves toward the air, e.g. the floor edge of a blind hole (ball inside the hole: `r < ρ`) |
| global side effect (section 1.4) | can consume faces and obliterate holes | can fill slots and bury small features |
| terminal-vertex capping (section 6.1) | an extended tool that leaves the body removes nothing, so over-extension is harmless when the neighbours are also convex | an extended tool that leaves the body adds material, so the blend must be cut by the cap face |

Plane/cylinder convexity is easy to get wrong; remus records it as a real
bug: reading the cylinder's `reversed` flag alone as "concave" (DOCUMENTED,
remus note). The convexity of section 1.2 decides, and the table below is its
consequence:

| configuration | edge | ball |
|---|---|---|
| top edge of a boss (cylinder's own end cap) | convex | inside the cylinder |
| rim of a through hole | convex | outside the hole cylinder |
| base of a post standing on a plate | concave | outside the post cylinder |
| floor edge of a blind hole | concave | inside the hole cylinder |

DOCUMENTED (remus `analytic.rs:798-814` table); the ball column INFERRED.

## 4. Analytic special cases

### 4.1 The two symmetry theorems

A constant-radius pipe is a cylinder iff its spine is a line, a torus iff its
spine is a circle, and a sphere iff the spine degenerates to a point.
(DOCUMENTED, ACIS `…bg`: "a straight-line spine gives a cylinder, a
circular-arc spine a torus, a point spine a sphere".) So the question "when is
a fillet analytic" is "when is `O1 ∩ O2` a line or a circle".

**Translation family (INFERRED, standard).** A surface is invariant under
translation along a unit direction `d` if it is a plane containing `d` or a
cylinder with axis parallel to `d`. If both supports are invariant under the
same `d`:

- their offsets are invariant too (offsets commute with the translation);
- their intersection, and therefore the spine, is a union of lines parallel
  to `d`;
- the whole construction is the extrusion along `d` of a 2D fillet in a plane
  perpendicular to `d`;
- the fillet is a **cylinder** of radius `r` with axis parallel to `d`; the
  contacts are lines; a chamfer is a **plane**.

Pairs: plane/plane (`d = n1 × n2`, always); plane/cylinder with the axis
parallel to the plane (`a·n = 0`); cylinder/cylinder with parallel axes.

**Rotation family (INFERRED, standard).** A surface is invariant under
rotation about an axis line `A` if it is a plane perpendicular to `A`, or a
cylinder, cone or torus with axis `A` (the same line, not only a parallel
one), or a sphere whose centre lies on `A`. If both supports are invariant
about the same `A`:

- the spine is a union of circles about `A` (parallels);
- the construction is the revolution about `A` of a 2D fillet in the meridian
  half-plane;
- the fillet is a **torus** with axis `A`, major radius = the radial coordinate
  of the 2D arc centre, minor radius `r`; a **sphere** when that radial
  coordinate is zero; the contacts are circles; a chamfer is a **cone** (a
  plane when the chamfer segment is perpendicular to `A`, a cylinder when it
  is parallel).

Common axes: plane + any coaxial surface → that surface's axis; plane + sphere
→ the line through the centre along the plane normal (always exists); sphere +
sphere → the line through both centres (always exists); sphere + cylinder,
cone or torus → that axis iff the centre lies on it; cylinder/cone/torus pairs
→ iff their axes are the same line.

**Evidence that this is the complete analytic list** (DOCUMENTED): Kós et al.
§4 table ("the blend is a cylinder: plane–plane (any angle); plane–cylinder
with axis ∥ plane; cylinder–cylinder with parallel axes. Torus: plane–sphere;
plane–{cylinder, cone, torus} with axis ⟂ plane; sphere–{cylinder, cone,
torus} with the sphere centre on the axis; coaxial {cylinder, cone, torus}
pairs"), Shene 1998 Thm 16 ("two cones can be blended by a torus if and only
if their axes are identical"), and OCCT's `ChFi3d_KParticular` table, which is
a subset. The claim that nothing outside the two families has a line or
circle spine is INFERRED; no counter-example is known.

**Degenerate spines.** A plane/cylinder pair whose plane contains the axis is
in the translation family. Its rotation-family look-alike, a plane containing
a torus or cone axis, is **not**: the offset plane no longer contains the axis
and the spine becomes a spiric or conic section. The same trap applies to
line edges in general: **a line edge does not imply a cylinder fillet.** A
plane through a cone's apex cuts the cone in generator lines, but the offset
plane misses the offset cone's (shifted) apex, the spine is a conic, and the
fillet is a pipe around a conic (INFERRED).

### 4.2 The 2D fillet solver

Both families reduce to one 2D problem: a circle of radius `r` tangent to two
oriented primitives in a plane. Primitives (INFERRED; each case is a textbook
construction, and Kós §4.3 gives the same bisector view):

- a **line** `{x : ν·x = δ}` with unit `ν` pointing to the ball side;
- a **circle** `{x : |x − q| = ρ}` with `σ = +1` if the ball is outside it,
  `σ = −1` if inside.

Offsets: line → `ν·x = δ + r`; circle → `|x − q| = ρ + σ·r`. The offset
circle must have positive radius: `σ = −1` needs `r < ρ` (section 2.3,
condition 1; equality is a degenerate case, see below).

Centre `c` = intersection of the two offsets:

| pair | solve | failure / degeneracy |
|---|---|---|
| line/line | 2×2 linear: `[ν1; ν2]·c = [δ1 + r; δ2 + r]` | `det = ν1 × ν2 → 0`: parallel lines, a smooth edge |
| line/circle | parametrise the offset line `x(s) = p0 + s·τ` (`p0 = (δ + r)ν`, `τ ⟂ ν`); `s² + 2s·τ·(p0 − q) + |p0 − q|² − (ρ + σr)² = 0` | discriminant `< 0`: the offsets miss, no spine; `= 0`: tangent offsets |
| circle/circle | offset radii `R_i = ρ_i + σ_i r`, `d = |q2 − q1|`, `a = (d² + R1² − R2²)/(2d)`, `h² = R1² − a²`, `c = q1 + a·u ± h·u⊥` | `h² < 0`: no spine; `d = 0`: concentric, no edge |

- **Root choice.** Two roots are the normal case (a line cuts a circle
  twice). Take the root whose contacts lie on the actual face segments
  adjacent to the corner `e` (the 2D image of the edge), i.e. whose ball sits
  in the wedge at `e`. Nearest-to-`e` is the usual heuristic (OCCT takes the
  intersection "closest to the spine start", DOCUMENTED); the contact-on-face
  test is the correct criterion and doubles as the range check.
- **Contacts.** Line: `c − r·ν`. Circle: `q + ρ·(c − q)/|c − q|` (the same
  formula for both `σ`).
- **Arc.** The arc of the circle `(c, r)` between the contacts that faces `e`.
  Its angle equals the angle between the primitives' ball-side normals at
  the contacts.

Extrusion (translation family): the fillet is the cylinder through `c` with
axis `d`, radius `r`; the contact lines are the contacts extruded along `d`.

Revolution (rotation family), in the meridian half-plane with coordinates
`(ρ, h)` (radial, axial):

- torus centre = axis origin `+ h_c·a`, axis `a`, **major `= ρ_c`, minor `= r`**;
- contact circles: the parallels at the two contacts' `(ρ, h)`;
- **sphere** when `ρ_c = 0` (radius `r`, centre on the axis);
- `ρ_c < 0` means the ball crosses the axis: refuse;
- regularity on the used arc (section 2.3, condition 3, specialised; see 4.6):
  every point of the used arc must have `ρ > 0`, except a single touching
  point on the axis in the sphere case.

### 4.3 Plane/plane

- Always the translation family, for any angle. Fillet: **cylinder**, axis
  `c + λ·t` with `c = e + r·(m1 + m2)/(1 + m1·m2)`, radius `r`. Contacts:
  lines `c − r·m_i + λ·t`. DOCUMENTED (OCCT `FilPlnPln`:
  `C = Pv + (R/cos(θ/2))·normalize(D1 + D2)`, which is the same point).
- Chamfer: **plane** (section 5).
- Representation today: exact (`Cylinder`, `Line`). End cross curves: a
  `Circle` arc when the cap face is a plane perpendicular to the edge, an
  `Ellipse` arc for an oblique planar cap (the plane/cylinder section,
  `kernel/analytic.bend` `plane_cylinder`), a quartic for a cylindrical cap
  that is not coaxial (not representable; section 11).
- FDM: box edges, `roundX` in `fixtures/r10b/r10b.fs` (DOCUMENTED, Onshape FS
  note), every edge of an extruded polygon.

### 4.4 Plane/cylinder

Three configurations (DOCUMENTED as a list in the Kós §4 table and the OCCT
eligibility table; the oblique case in the Choi-Ju note and Dahl Thm 2.6):

1. **Axis parallel to the plane** (plane normal `⟂` axis; the edge is a
   generator line; the plane at distance `δ < ρ` from the axis cuts the
   cylinder in two lines, `δ = ρ` is tangent): translation family,
   line/circle 2D solve, **cylinder** fillet. OCCT `FilPlnCyl` line overload:
   offset the cylinder to `ρ ± r`, fail if the concave case gives `r ≥ ρ`
   ("the fillet does not pass"), intersect with the offset plane, take the
   line closest to the spine start (DOCUMENTED).
2. **Axis perpendicular to the plane** (the cap edge, a circle): rotation
   family, **torus** or **sphere**. Closed form (DOCUMENTED, OCCT
   `FilPlnCyl` circle overload; signs INFERRED): plane at height `h0`,
   cylinder radius `ρ`, axis `a`.
   - `σ_h = sign(m_plane·a)` (ball above or below the plane), `σ_r = +1` if
     the ball is outside the cylinder (`m_cyl` points away from the axis).
   - Centre height `h0 + σ_h·r`; **major `= ρ + σ_r·r`**, minor `r`.
   - Contacts: circle of radius `ρ + σ_r·r` on the plane at height `h0`;
     circle of radius `ρ` on the cylinder at height `h0 + σ_h·r`.
   - `σ_r = −1` (boss top, blind-hole floor): valid iff `r < ρ` for a torus;
     `r = ρ` gives a **sphere** (OCCT switches to a sphere when
     `|ρ − r| ≤ Precision::Confusion()`, DOCUMENTED); `r > ρ` fails.
   - `σ_r = +1` (hole rim, post base): always a ring torus.
   - `ρ/2 < r < ρ` with `σ_r = −1` gives a **spindle torus** (major < minor).
     It is valid because the used band never reaches the self-intersection
     (section 4.6), but see section 11.2 for the STEP consequence.
3. **Oblique axis**: the edge is an ellipse; offset plane ∩ offset cylinder is
   an **ellipse** spine; the fillet is a pipe around an ellipse, which is not
   analytic. DOCUMENTED (Kós §3.2.5: plane/cylinder spines are conics;
   Dahl Thm 2.6: the plane/cone blend, cylinders included as cones with the
   apex at infinity, is rational of minimal bidegree (4, 2)).
   - Contact on the plane: the spine ellipse translated by `−r·m_plane`, an
     ellipse (DOCUMENTED, Choi-Ju note citing Dahl-Krasauskas eq. 2.10).
   - Contact on the cylinder: the spine point scaled radially from
     `ρ ± r` to `ρ`; because every spine point is at radius `ρ ± r`, the
     scaling factor is constant, so the contact is an affine image of a planar
     ellipse, i.e. a planar **ellipse** (INFERRED, derivation in the Choi-Ju
     note).
   - So both trim curves are types wonky has (`Ellipse`); only the surface is
     new. FDM: a boss or hole meeting a sloped face, a pipe through an
     inclined wall.

### 4.5 Plane/cone, cylinder/cylinder, cylinder/cone, cone/cone

- **Plane/cone.** Plane perpendicular to the cone axis: rotation family, 2D
  line/line in the meridian plane, **torus** (or sphere). OCCT `FilPlnCon`
  does exactly this (DOCUMENTED). Every other plane: the spine is a conic
  (ellipse, parabola or hyperbola, DOCUMENTED Kós §3.2.5, Dahl §2.3), the
  fillet is a rational pipe of bidegree (4, 2) (DOCUMENTED, Dahl Thm 2.6 for
  the ellipse; the hyperbolic and parabolic cases "can be derived using the
  same approach"). Wonky has no `Hyperbola` or `Parabola` curve; the hybrid
  Boolean plan already lists the plane/cone hyperbola as an Unresolved cause
  (hex-nut; DOCUMENTED, `docs/hybrid-boolean-plan.md` §2.3).
- **Cylinder/cylinder, "coaxial vs crossed".**
  - Coaxial cylinders of different radii never share an edge; equal radii are
    the same surface. So "coaxial cylinder/cylinder" has no fillet; its
    rotation-family relatives are cylinder/plane (cap edges), cylinder/cone
    and cylinder/torus.
  - **Parallel axes**: translation family, 2D circle/circle, **cylinder**
    fillet. FDM: vertical edges between arc segments of an extruded profile.
  - **Crossed axes (intersecting)**: the edge is a space quartic in general
    (two ellipses when the radii are equal, the Steinmetz case). The spine is
    the intersection of the two **offset** cylinders, radii `ρ1 ± r` and
    `ρ2 ± r`. It is a pair of planar ellipses iff the offset radii are equal
    and the axes intersect; otherwise a space quartic (INFERRED from the
    Steinmetz fact applied to the offsets). Equal offset radii happen for a
    concave tee of equal pipes (`ρ + r` on both sides) but not for a
    cross-drilled hole in a boss unless `ρ_boss − ρ_hole = 2r`.
    - With two points of oriented contact the blend is rational of minimal
      bidegree (6, 2); with one, (12, 2) (DOCUMENTED, Dahl §2.6, cones
      including cylinders).
    - Dahl's classification: fixed-radius blends of natural quadrics are
      rational **for every r** only in four configurations: plane/cone,
      cone/cone with two or with one point of oriented contact, cone/sphere
      with one point of oriented contact (DOCUMENTED, Dahl §1.1.1, §2.7).
      INFERRED consequence: a general unequal-radius tee has no rational
      blend; it must be approximated with a certified tolerance or refused.
    - remus refuses cross-drilled cylinder/cylinder rim fillets (DOCUMENTED,
      remus README); OCCT routes all cylinder/cylinder to walking (DOCUMENTED).
  - **Skew axes**: quartic spine, not rational in general (INFERRED).
- **Cylinder/cone, cone/cone.** Coaxial: rotation family, **torus**
  (DOCUMENTED, Kós table; Shene Thm 16). Otherwise quartic or conic spines as
  above.
- **Dupin cyclides are not constant-radius fillets.** A cyclide blending two
  cones with a common inscribed sphere is a *variable*-radius rolling-ball
  blend with circular trims (DOCUMENTED, Dupin note: Chandru-Dutta-Hoffmann
  p. 14, Shene Thm 16). Using one for `opFillet` would not reproduce Onshape's
  geometry. They are relevant for an explicit "transition" feature and for
  corner patches (Dahl 2014 uses one at a heterogeneous corner), not for
  constant-radius fillets.

### 4.6 Sphere and torus supports; the spindle-torus bound

- **Plane/sphere**: always rotation family (axis through the centre along the
  plane normal): **torus** (or sphere). The spine is a circle (DOCUMENTED,
  Kós §3.2.5 lists plane-sphere as a conic spine; Kós §4: torus).
- **Sphere/sphere**: always rotation family (axis through both centres):
  2D circle/circle, **torus** or sphere. monstertruck tests its generic
  rolling-ball surface against the closed form of exactly this case
  (DOCUMENTED, `tests/rbf_surface.rs`).
- **Sphere/cylinder, sphere/cone, sphere/torus**: torus iff the sphere centre
  is on the axis; otherwise a space quartic spine (the proto recover code
  already refuses the off-axis sphere/cylinder *intersection* as "a space
  quartic (curve type missing)", DOCUMENTED `kernel/proto/recover/geom.bend`).
- **Plane/torus**: torus iff the plane is perpendicular to the torus axis.
  A plane containing the axis cuts the torus in meridian circles, but the
  fillet is not a torus (section 4.1, degenerate spines). This is the
  "fillet of a fillet" case: e.g. a second fillet between a plate and an
  earlier cap-edge fillet.
- **Torus/cylinder, torus/cone, torus/torus**: torus iff coaxial.

**The used-arc bound for an inside torus (INFERRED; matches remus's
DOCUMENTED argument).** For `σ_r = −1` the spine circle has radius
`M = ρ − r` and curvature `κ_s = 1/M`; the principal normal points to the
axis. The used arc runs from the plane contact (the section direction along
the axis, `cos v = 0`) to the cylinder contact (radially outward,
`cos v = −1`). So `r·κ_s·cos v ≤ 0 < 1` on the whole used arc for every
`M > 0`. Equivalently, every point of the used band has radial coordinate
`M − r·cos v ≥ M > 0`. The self-intersecting part of a spindle torus
(`M + r cos v' < 0` in the outward convention) lies on the inner side of the
tube, which the fillet never uses. Hence the correct admission bound is
`r < ρ` (plus `r = ρ` as the sphere), not `r ≤ ρ/2`.

### 4.7 Case table

Legend for the last column: **today** = representable with wonky's current
types; **+T/S** = needs `Torus` and/or `Sphere`; **+pipe** = needs a
non-analytic pipe surface (procedural or rational B-spline); **+curve** = also
needs a curve type wonky lacks.

| supports | configuration | spine | fillet | contacts | chamfer | wonky |
|---|---|---|---|---|---|---|
| plane/plane | any angle | line | cylinder | lines | plane | today |
| plane/cylinder | axis ∥ plane | line | cylinder | lines | plane | today |
| plane/cylinder | axis ⟂ plane (cap edge) | circle | torus; sphere at `r = ρ` inside | circles | cone | +T/S (chamfer today) |
| plane/cylinder | oblique | ellipse | pipe, rational (4,2) | ellipses | rational ruled | +pipe |
| plane/cone | axis ⟂ plane | circle | torus / sphere | circles | cone | +T/S (chamfer today) |
| plane/cone | other planes | conic | pipe, rational (4,2) | conics | rational ruled | +pipe, +curve (hyperbola, parabola) |
| plane/sphere | any | circle | torus / sphere | circles | cone | +T/S |
| plane/torus | plane ⟂ axis | circle | torus / sphere | circles | cone | +T/S |
| plane/torus | other | spiric (quartic) | pipe | quartics | ruled | +pipe, +curve |
| cylinder/cylinder | parallel axes | line | cylinder | lines | plane | today |
| cylinder/cylinder | crossed, equal offset radii | two ellipses | pipe, rational (6,2) | quartics | ruled | +pipe, +curve |
| cylinder/cylinder | crossed or skew, general | quartic | pipe, not rational in general | quartics | ruled | +pipe (approximate), +curve |
| cylinder/cone, cone/cone | coaxial | circle | torus / sphere | circles | cone / plane / cylinder | +T/S (chamfer today) |
| cylinder/cone, cone/cone | other | conic or quartic | pipe | | ruled | +pipe, +curve |
| sphere/sphere | any | circle | torus / sphere | circles | cone | +T/S |
| sphere/{cyl, cone, torus} | centre on axis | circle | torus / sphere | circles | cone | +T/S |
| sphere/{cyl, cone} | centre off axis | quartic (rational for one oriented contact point, (8,2)) | pipe | | | +pipe, +curve |
| torus/{cyl, cone, torus} | coaxial | circle | torus / sphere | circles | cone | +T/S |

Sources: section 4.1-4.6 (DOCUMENTED Kós, OCCT, Dahl, Shene; INFERRED
completeness).

## 5. Chamfers

### 5.1 Three definitions of "distance"

Chamfers are simpler than fillets geometrically (a ruled surface between two
contact curves) and harder semantically, because kernels disagree on what the
distance measures (DOCUMENTED, ACIS note §2, Parasolid FD §29.2.2, Onshape
help):

| definition | contacts | who |
|---|---|---|
| **face offset** | offset the supports by `d1`, `d2` toward the chamfer side, intersect the offsets (a spine, as for fillets), project the spine back onto each support | Parasolid ("offset surfaces … intersected; the resulting curves … projected"), Onshape `ChamferMethod.FACE_OFFSET` (the default, UI "Offset"), ACIS R10 and R17-advanced as "two balls of different radii rolling together" |
| **in-support distance** | the contact on each face lies at distance `a_i` from the edge, measured in that face | ACIS R17 standard chamfer; Onshape `APEX_RANGE` (UI "Tangent", "measured from the intersection of the tangent of the two adjacent faces") |
| **distance + angle** | distance `a` on one face, chamfer at angle `α` to that face | Onshape `OFFSET_ANGLE` (bounds 0.1° to 179.9°, default 45°) |

The mapping of Onshape's two methods onto the kernel definitions is INFERRED
(Onshape FS and help notes). For planar faces at 90° all definitions agree;
off 90° and on curved supports they differ. Which of Onshape's `width1` /
`width2` belongs to which face under `TWO_OFFSETS` must be probed with the
Onshape bridge, as must `APEX_RANGE` on curved faces (HEARSAY that it projects
tangent-line points onto the faces; not documented anywhere read).

### 5.2 Plane/plane formulas

In the section plane, edge at the origin, face 1 along the positive x axis,
face 2 along `(cos φ, sin φ)`, the chamfer on the wedge side (`φ` the wedge
angle, section 3). INFERRED derivation; the face-offset and distance-plus-angle formulas are MEASURED numerically in `tmp/fillet/theory-checks.mjs`:

- **Face offset** `d1`, `d2`: the spine point is `(x, d1)` with
  `x·sin φ − d1·cos φ = d2`, so the in-face contact distances are

  ```
  s1 = (d2 + d1·cos φ)/sin φ     on face 1
  s2 = (d1 + d2·cos φ)/sin φ     on face 2
  ```

  - Symmetric `d`: `s = d·cot(φ/2) = d·tan(θ/2)`. At 90°, `s = d`; the chamfer
    narrows as the dihedral opens, which is Parasolid's documented behaviour.
  - At 90° the offset of face 1 appears as the in-face distance on face 2.
    Naming must be pinned by an oracle.
  - **Undefined chamfer**: `s1 ≤ 0` iff `d2 ≤ −d1·cos φ`, which can only happen
    for an obtuse wedge (`φ > 90°`) and `d2/d1 ≤ |cos φ|`. This is Parasolid's
    "if there is a great difference between the ranges … the chamfer is not
    defined at all" (Fig. 29-5) as a formula.
- **In-support** `a1`, `a2`: contacts at `(a1, 0)` and `a2·(cos φ, sin φ)`
  directly.
- **Distance + angle** `a`, `α`: contact 1 at `(a, 0)`; the chamfer line leaves
  it at angle `α` to face 1 (the triangle's interior angle at contact 1);
  contact 2 is its intersection with face 2:
  `a2 = a·sin α / sin(φ + α)`, valid iff `0 < α < π − φ` (law of sines in the
  triangle edge, contact 1, contact 2, whose angles are `φ`, `α` and
  `π − φ − α`). At 90° and 45° this gives `a2 = a`.
- The chamfer surface is the **plane** through the two contact lines. It is
  not tangent to either support ("In general, chamfer blends are not tangent
  continuous with the faces adjoining the original edge", DOCUMENTED Parasolid
  §29.2).

### 5.3 The families

- **Translation family**: contacts are two lines parallel to `d`, so the
  chamfer is a **plane**. The 2D contacts come from the same line/line,
  line/circle, circle/circle offsets as section 4.2 with the ranges `d1`, `d2`
  in place of `r` (face offset), or from arc length along the 2D primitives
  (in-support).
- **Rotation family**: the chamfer segment in the meridian half-plane from
  `(ρ1, h1)` to `(ρ2, h2)` revolves into a **cone** with half-angle
  `α = atan2(ρ2 − ρ1, h2 − h1)` measured from the axis; a **plane** (annulus)
  when `h1 = h2`, a **cylinder** when `ρ1 = ρ2`. Cap-edge chamfers of holes
  and bosses, the most common FDM chamfer (the 45° countersink-like edge),
  are cones. DOCUMENTED as OCCT's `ChPlnCyl` → cone or plane and `ChPlnCon` →
  cone; ACIS limits standard chamfers to plane and cone.
  - Wonky's `Cone{origin, axis, x, radius, angle}` holds this exactly.
    Put `origin` at the axis point at `h1`, `radius = ρ1`, and the half-angle
    with the sign convention of `kernel/analytic.bend` (confirm whether
    `angle` is signed before implementing).
- **Everything else**: the chamfer is the ruled surface joining corresponding
  contact points. For the oblique plane/cylinder face-offset chamfer the two
  contacts are planar ellipses (section 4.4), and the correspondence through
  the rationally parametrised spine ellipse is rational, so the chamfer is a
  rational ruled surface of bidegree (2, 1) (INFERRED). It needs a B-spline
  or ruled-surface type; it is not a quadric in general.

### 5.4 Representation today

Every chamfer of the two symmetric families is representable **today**:
planes, cones, cylinders, with line and circle trims. This is the cheapest
complete tier of the whole fillet/chamfer feature, and for FDM (45° chamfers
on down-facing edges to avoid overhangs) it is as important as fillets
(INFERRED, Onshape help note: "Chamfers matter as much as fillets").

## 6. Vertex blends

### 6.1 Terminal vertices: one blended edge ends

The blend runs until the ball stops rolling onto the faces it meets and is
trimmed there by a **capping face** (DOCUMENTED, ACIS `…ca`). For each end:

- **Cap face perpendicular to the edge** (Marc's `roundX`: X-parallel edges of
  a box end at the ±X faces): the cross curve is the blend surface cut by the
  cap plane, a **circular arc** for a cylinder fillet. The cap face loses a
  corner and gains the arc. Exact today.
- **Oblique planar cap**: cylinder ∩ plane is an **ellipse** arc
  (`plane_cylinder` in `kernel/analytic.bend`). Exact today. For a torus
  fillet cut by a plane the section is a circle only when the plane contains
  the axis or is perpendicular to it; otherwise a spiric quartic
  (DOCUMENTED as a refusal reason in `kernel/proto/recover/geom.bend`,
  "plane/torus section is a spiric curve").
- **Curved cap**: cylinder fillet ∩ non-coaxial cylinder is a space quartic
  (not representable).
- **Capping by extension.** When the end face does not reach the blend (the
  blend is wider than the end face locally, typical at mixed-convexity
  vertices), the cap face's carrier is extended until it cuts the blend
  (DOCUMENTED, ACIS: "Extending capping faces"; Parasolid: "extending at most
  two of the adjoining faces"). For analytic carriers extension is free (the
  carrier is unbounded); for B-spline carriers it is a known failure source
  (`FILLET_REQUIRES_SURFACE_EXTENSION`, Parasolid `bsurf_c`).
- **Convexity decides whether over-extension is harmless** (INFERRED; section
  3.3): a convex blend's removal region extended beyond a convex end face lies
  in the air and removes nothing, so a Boolean construction does not need an
  exact cap there; a concave blend's added region extended beyond the end face
  adds material in the air, so it must be cut by the end face's half-space;
  a convex blend ending at a **concave** corner would cut into the neighbouring
  material if extended, so it must be capped exactly (this is the
  mixed-convexity capping that ACIS special-cases, DOCUMENTED `…ca`).

Parasolid: one blended edge at a 3-edge vertex "normally possible", failing
when "the end surface is undefined"; at a vertex with more edges only if the
ranges are small enough that the blend ends on edges at that vertex
(DOCUMENTED, Parasolid FD §29.3-29.4).

### 6.2 Two blended edges at a vertex

- **Tangent (bi-blend)**: the edges continue each other with G1 faces; the two
  blends share the characteristic circle at the vertex and "mate exactly"
  (DOCUMENTED, ACIS `…se`). See section 7.
- **Mitered**: the edges meet at an angle, both of the **same convexity**.
  The two blend surfaces are cut along their mutual intersection, the miter
  curve. For two equal-radius cylinder fillets whose axes intersect (two
  top edges of a box meeting at a corner whose vertical edge stays sharp) the
  two cylinders have equal radii and intersecting axes, so they meet in
  **planar ellipses** in the bisector planes (INFERRED, the Steinmetz fact);
  the miter is an `Ellipse` arc, exact today. ACIS uses a "curved miter" for
  constant rounds on coplanar straight or circular edges and requires at most
  two other, non-smooth edges (DOCUMENTED). Parasolid: two of three edges at
  a vertex are legal only if both add or both remove material (DOCUMENTED
  §29.4). Whether Onshape's result equals the intersection miter must be
  checked with an oracle.
- **Mixed convexity** (one convex, one concave): not unique. ACIS refuses to
  fix a mixed-convexity miter in one step; the order in which the user
  applies the blends gives two different valid shapes (DOCUMENTED, ACIS
  `…ve`, Figs. 1-33/1-34). Parasolid returns `PK_blend_fault_edge_c`
  (`FILLET_ADJOINING_EDGE_NOT_FILLETED`) for mixed two-of-three. Wonky should
  refuse with a "non-unique; sequence the fillets" error.

### 6.3 Blend meeting a sharp edge of opposite convexity: the horn torus

A common FDM case: a rectangular boss on a plate, the concave base edges
filleted, the boss's vertical (convex) edges left sharp. At the vertex where a
vertical edge meets the plate, the ball rolling along one base edge must get
round the sharp convex edge to the next base edge.

- By the closing definition (section 1.4) the ball stays outside the material,
  touching the plate and the **edge line** itself while it pivots. Its centre
  is at height `r` above the plate and at distance `r` from the edge line, so
  it moves on a circle of radius `r` about the edge line (INFERRED).
- The envelope is a **horn torus** (major radius = minor radius = `r`) with the
  vertical edge as its axis, used over the exterior angle of the corner
  (90° of sweep for a right-angled boss). It is tangent to the plate, meets
  both base-edge cylinders G1 along their end cross circles, and touches the
  vertical edge at a single point at height `r`, where the horn torus is
  singular.
- DOCUMENTED support: ACIS entity-entity blending allows exactly one
  "stationary blend", "the osculating torus of a plane against a line normal
  to it", and vertex-face geometry is "only the torus against a plane"
  (ACIS note §9). Parasolid's `vx_blend_data` smooths blends "past sharp
  edges of opposite convexity" (DOCUMENTED §30.3.8). Whether Onshape
  produces the horn torus by default is HEARSAY; it needs an oracle fixture.
- If the sharp edge is **not perpendicular** to the plate, the centre locus is
  offset plane ∩ cylinder of radius `r` about the edge line, an ellipse: a
  pipe around an ellipse, not a torus (INFERRED).
- The dual case: convex rounds on the top edges of an L-shaped extrusion
  meeting at a sharp **concave** vertical edge give the same horn torus with
  the ball inside the material.
- Representation: `Torus` with major = minor, plus a degenerate vertex where
  the torus touches its axis. STEP needs care (section 11.2).

### 6.4 Three or more blended edges: the sphere corner

**Planar corner** (DOCUMENTED as OCCT `ChFiKPart_Sphere`, Parasolid "a piece
of sphere at the vertex", ACIS "simple vertex blend surfaces … spheres, tori";
the linear system is from the Várady-Rockwood note):

- all faces at the vertex planes `n_i·x = d_i`, all blended edges the same
  radius `r`, uniform convexity (all convex or all concave);
- the centre `c` solves `m_i·c = m_i·p_i + r` for every face (`p_i` on face
  `i`), i.e. `n_i·c = d_i − r` for convex, `d_i + r` for concave;
- valence 3: a 3×3 solve, solvable whenever the three normals are independent
  (a genuine corner);
- valence ≥ 4: overdetermined; a sphere exists iff the offset planes share a
  point (true for symmetric pyramids, false in general). Decide by an exact
  rank test on the plane coefficients (Várady-Rockwood note);
- the corner face is a **spherical polygon** bounded by the edge fillets'
  cross curves. Each edge cylinder's axis passes through `c` (its axis is the
  locus at distance `r` from its two planes on the ball side, and `c` is on
  it), so each cylinder is tangent to the sphere along the **great circle** in
  the plane through `c` perpendicular to that axis. The corner is bounded by
  arcs of those great circles; for a box, a spherical octant with three 90°
  arcs.

**Curved corners** (INFERRED generalisation): for any three faces blended
pairwise with the same `r` and uniform convexity, the three spines
`O1∩O2`, `O2∩O3`, `O1∩O3` meet at the point `O1∩O2∩O3` (three equations,
three unknowns; generically isolated). The ball there touches all three faces,
and each edge blend's characteristic circle at that point is a great circle of
that ball. So the sphere corner exists whenever the point exists and the three
great-circle arcs bound a proper spherical triangle (angles below `π`). This
covers, for example, a box corner where one edge was already a cylinder fillet
of the same radius. Check the triangle condition explicitly; OCCT implements
only the planar case (DOCUMENTED).

**Oracle.** Rounding all edges of a convex polyhedron with one radius equals
`(S↓r) ⊕ ball(r)` (Minkowski sum of the inner parallel body with a ball;
Rossignac: `S = R_r(S) ⇔ S = A↑r`). For an `a×b×c` box,
`V = a'b'c' + 2r(a'b' + b'c' + a'c') + πr²(a' + b' + c') + (4/3)πr³` with
`a' = a − 2r` etc. (DOCUMENTED formula in the Rossignac note, from the Steiner
formula).

Representation: `Sphere` surface plus great-circle `Circle` arcs; the vertices
where three arcs meet are the contact points. Needs `Sphere` (not in
production today).

### 6.5 Unequal radii, mixed convexity, valence ≥ 4: setback patches

No sphere fits when the radii differ or convexity is mixed. The options,
cheapest first:

1. **Sequential blending (order semantics).** Blend the edges one feature at
   a time; later blends see earlier blend faces as supports. Parasolid and
   ACIS both document that results depend on the order and that overlapping
   blends that fail together can succeed one after another (DOCUMENTED:
   Parasolid `overlap_c`, ACIS "Vertex Blend Order"). This is how most
   Onshape users build parts anyway (one fillet feature per radius), and it
   **stays analytic in the common FDM case**. INFERRED example: an extruded
   rounded rectangle (vertical edges already arcs of radius `R_v`, i.e.
   cylinder faces) whose top edges are then filleted with `r`:
   - along the flat sides: plane/plane → cylinders;
   - around each corner: top plane / vertical cylinder, axis perpendicular to
     the plane → a cap-edge torus with major `R_v − r` (ball inside, convex);
   - a **sphere** when `r = R_v`; **refuse or overflow** when `r > R_v`
     (condition 1 of section 2.3; what Onshape does there is HEARSAY and a
     fixture);
   - the chain cylinder → torus → cylinder is G1 (section 7).
2. **Setback vertex blend** (Várady-Rockwood; ACIS `VBL_SURF`; Parasolid
   setbacks). Each edge blend is stopped at a setback distance from the
   vertex by a cross curve; the hole is filled by one multi-sided patch.
   - Boundary structure: up to `2n` sides, `n` cross (profile) curves
     alternating with `n` spring curves on the primary faces; a
     uniform-convexity vertex gives `n` sides (the springs shrink to points),
     a mixed one more (DOCUMENTED, ACIS and the Geomagic patent via the
     Várady-Rockwood note).
   - **No-setback rule** (DOCUMENTED, ACIS): intersect each edge's spring
     curves with the neighbouring edges' spring curves, take the intersection
     farther from the vertex, put the cross curve through it: "the smallest
     practical setback". INFERRED planar formula: on a face where edge `e1`
     (spring line at distance `s1 = r1·tan(θ1/2)` inside the face) and edge
     `e2` (spring line at `s2`) meet at angle `β`, the spring lines cross at
     distance `x = (s2 + s1·cos β)/sin β` along `e1` from the vertex; take the
     larger `x` of `e1`'s two faces.
   - **Setback plane**: perpendicular to the edge through the point at the
     setback distance; its section of a constant-radius blend is a circular
     arc (DOCUMENTED, ACIS). Oblique setbacks tilt it.
   - **Patch**: an n-sided transfinite surface interpolating position and
     cross-boundary derivative ("ribbons") on every side. The classic form is a
     convex combination of linear Taylor interpolants,
     `Σ_k W_k(p)·(C_k(s_k(p)) + d_k(p)·D_k(s_k(p)))` with Charrot-Gregory
     weights `W_k = Π_{j≠k} d_j² / Σ_m Π_{j≠m} d_j²` (Choi-Ju note; the exact
     domain mapping is unverified there). ACIS adds a **bulge** factor in
     `[0, 2]` for interior fullness, 0 suggested for mixed convexity
     (DOCUMENTED).
   - Guarantees: G1 only as good as the ribbon compatibility at the corners;
     no fairness or non-self-intersection guarantee (DOCUMENTED, Choi-Ju and
     Várady-Rockwood notes). ACIS exports the patch as `n` four-sided
     B-splines (DOCUMENTED).
3. **Explicit refusal** with the Onshape names:
   `FILLET_VERTEX_EDGES_COMPLICATED` for complex vertices (Parasolid
   `vertex_c`: some 4-valent vertices and valence ≥ 5 unless every edge is
   blended), `FILLET_ADJOINING_EDGE_NOT_FILLETED` for illegal two-of-three.

Representation: a setback patch is a **new non-analytic surface type**
(Gregory or multi-sided Bézier, exported as B-splines). It can satisfy wonky's
"approximations need explicit tolerances" rule only if the patch is *exact by
definition*: its defining data (ribbons, weights, bulge) is the model, and
there is no "true" surface being approximated (INFERRED, Várady-Rockwood
note). Every other kernel with open source stops here: OCCT fills unequal
corners with approximated Plate/Coons surfaces, monstertruck has no corner
logic, ogeom-rs discards the corner state (DOCUMENTED, Várady-Rockwood note).

## 7. Edge chains and tangent continuation

- **Chains.** A fillet request on one edge normally extends to the maximal
  chain of edges connected G1 (tangent-continuing) with it ("The fillet is
  automatically extended to all edges in a smooth continuity with the original
  edge", DOCUMENTED OCCT guide; OCCT's `ChFiDS_Spine`). Onshape makes this
  `tangentPropagation`: default **false** in `opFillet` and in the
  programmatic `fillet(...)` defaults, but **true** in the UI (DOCUMENTED,
  Onshape FS note). Wonky must report which edges a propagation added.
- **The ACIS six situations** are a precise propagation rule at each vertex of
  a candidate chain (DOCUMENTED, ACIS `…sm`):

  | situation | at the vertex | result |
  |---|---|---|
  | 1 | exactly two tangent-continuing non-smooth edges, same convexity | continue; the vertex disappears from the blend |
  | 2 | two tangent-continuing edges of different convexity | stop |
  | 3 | two non-smooth edges not tangent-continuing, needing a G1-discontinuous face without an edge | unsupported |
  | 4 | more edges: the two same-convexity edges continue, the rest are smooth "slant" edges | continue; blend faces join G1 across iso-parametric cross edges where the springs hit the slant edges |
  | 5 | as 4 but some other edges are non-smooth | stop; miter where the springs meet the unblended edges |
  | 6 | no tangent-continuing edge | stop |

- **Why a tangent chain is G1** (INFERRED): at a shared vertex of two
  tangent-continuing edges, the supports on each side are G1 across the
  vertex, so both blends have the same ball there, and both are tangent to
  that ball along the same characteristic circle. Two surfaces tangent to one
  sphere along one circle are G1 along it. The join is **not G2** in general
  (a cylinder meets a torus with a curvature jump across the circle).
- **Supports change along the chain** (situation 4). The top-edge chain of a
  rounded rectangle keeps the top plane on one side while the other side
  changes plane → cylinder → plane across smooth slant edges. The blend
  changes type (cylinder → torus → cylinder) at cross circles where the
  springs cross the slant edges. Each piece is analytic; the pieces meet along
  exact circles. That is the most common FDM fillet chain, and it is
  representable with `Cylinder` + `Torus` + `Circle`.
- **Closed chains.** A circular cap edge is one closed edge; its torus fillet
  is a full band with a seam. The seam needs care (OCCT #1371: a closed rim
  with a seam vertex returned a self-intersecting solid while reporting
  success, DOCUMENTED). A closed chain of several edges (the top of a rounded
  rectangle) has no end caps at all ("periodic" in ACIS terms when it has no
  miters or vertex blends).
- **Radius along a chain.** A constant-radius request keeps `r` across the
  chain. Different radii on consecutive tangent edges need a variable-radius
  transition or a vertex treatment; Parasolid's `range_c`
  (`FILLET_RANGE_INCONSISTENT_EDGE`) is the fault when radii clash at a
  vertex with a tangent third edge (DOCUMENTED).
- **Convexity along a chain** must stay uniform (situation 2 stops). An edge
  whose own convexity changes is `VARIABLE` and must be split (section 1.2).

## 8. Variable radius

### 8.1 Canal surfaces

A variable-radius rolling-ball blend is the envelope of spheres with centre
`m(t)` and radius `r(t)` (DOCUMENTED, Lukács note via Peternell-Pottmann eqs.
2.1-2.4 and Dahl ch. 3):

- sphere `(x − m)² − r² = 0`, envelope condition `(x − m)·ṁ + r·ṙ = 0`;
- the characteristic circle is a **small** circle of the sphere, in a plane
  perpendicular to `ṁ` offset from the centre; the tangent cone half-angle
  `φ` satisfies `sin φ = ṙ/|ṁ|` (DOCUMENTED, Dahl p. 53);
- **reality**: the envelope exists iff `|ṁ|² − ṙ² > 0` (a radius ramp faster
  than the spine advances collapses the section). Evaluate it as
  `(|ṁ| − ṙ)(|ṁ| + ṙ)` to avoid cancellation (Lukács note);
- **regularity**: Dahl eq. 3.45, `|r| < Λ1/(cos θ − Λ1Λ2)` for all `t`, `θ`,
  reducing to `r·κ_spine < 1` for constant `r`;
- **G1 / G2 between canal pieces**: iff their curves `(m(t); r(t))` in
  Minkowski space `R^{3,1}` share tangent lines (G1) or are G2 (DOCUMENTED,
  Dahl §3.3).

The spine is no longer an offset intersection ("a variable offset is
ill-defined on a surface", DOCUMENTED ACIS `…bg`): it is a curve on the
**bisector** of the two supports, the set of centres of spheres in oriented
contact with both (Dahl p. 9-10: a 2-dimensional surface in `R^{3,1}`;
choosing a radius law is choosing a curve on it).

### 8.2 How the radius law is attached

- Onshape: radii at vertices and at points on the edge by arc length
  (`vertexSettings`, `pointOnEdgeSettings`), `smoothTransition`; zero radius
  allowed only at the ends of a chain (`VRFILLET_INTERNAL_ZERO`); bounds
  `[0, 500] m` (DOCUMENTED, Onshape FS note). The interpolation law between
  the given radii is not documented (HEARSAY; it needs probing).
- ACIS: radius as a function of the **edge** parameter; the ball of radius
  `r(v)` has its centre in the plane perpendicular to the edge at `v`
  (DOCUMENTED). OCCT `BlendFunc_EvolRad` does the same with a guide.
- Consequence (INFERRED): the section plane follows the edge, not the spine,
  so the same law on the same edge gives different surfaces in different
  kernels unless the spine is a translate of the edge. Pin the definition and
  compare to Onshape.
- Parasolid VRB rules (DOCUMENTED): radii at ≥ 2 points including both
  vertices; zero allowed at the ends, not in the middle; not on an edge
  without vertices; rho all zero or all non-zero.

### 8.3 Exact special cases

- **Linear radius along a straight plane/plane edge** (INFERRED): the centres
  lie on a line in the bisector plane (distance `r(t)/sin(φ/2)` from the edge),
  and the radius is linear in the position along that line, so the envelope
  of the spheres is a **right circular cone** whose axis is the centre line.
  The cone is tangent to both planes (every sphere is), and the contacts are
  lines through the cone apex. `Cone` holds it exactly **today**. This only
  holds if the kernel's radius law is linear in arc length along the edge;
  Onshape's default law must be checked first.
- **Rotation family with a radius varying around the axis**: not analytic.
- **Dupin cyclides** are variable-radius blends with circular trims between
  cones with a common inscribed sphere (DOCUMENTED, Dupin note). They are
  exact rational biquadratic patches, but their radius law is imposed by the
  geometry, not chosen by the user, so they do not implement Onshape's
  variable fillet.
- Everything else: a canal surface, rational only if `m` and `r` are rational
  (Dahl Lemma 3.6 / Alg. 3.8, DOCUMENTED via the Lukács note), otherwise
  approximated.

### 8.4 Failure modes specific to variable radius

- ramp too steep (`|ṙ| → |ṁ|`): the section collapses (DOCUMENTED);
- snapshot and sliding-disc surfaces leave "a slight crease" across a
  G1-but-not-G2 support edge (DOCUMENTED, ACIS `…bg`);
- OCCT routes all variable radius through walking with no closed form;
  monstertruck rejects closed wires with `f(0) ≠ f(1)` (DOCUMENTED).

Priority for FDM: low. Constant-radius plane/plane and cap-edge fillets
dominate (DOCUMENTED as a judgement in the OCCT and Lukács notes).

## 9. Cross-section profiles

### 9.1 Circular

The rolling-ball arc of section 2.2. Asymmetric circular fillets do not exist
as such: two different ranges make the section an **ellipse** (Parasolid: "Unequal
ranges with rho = 0 give an elliptical section", DOCUMENTED §29.2).

### 9.2 Conic (rho)

Keep the control triangle `P1`, `T`, `P2` of section 2.2 and change the middle
weight (DOCUMENTED, Choi-Ju note; the relation checked here):

- `w_ρ = ρ/(1 − ρ)`, equivalently `ρ = w/(1 + w)`;
- `ρ` is the **shoulder ratio**: the curve point at `σ = 1/2` is
  `S = M/(1 + w) + T·w/(1 + w)` with `M` the chord midpoint, so
  `|MS|/|MT| = w/(1 + w) = ρ` (INFERRED algebra);
- `ρ < 0.5` ellipse, `ρ = 0.5` parabola, `ρ > 0.5` hyperbola;
- the circle is the ellipse with `ρ = cos(θ/2)/(1 + cos(θ/2))`, 0.41421 at 90°
  (MEASURED);
- `ρ → 0` flattens to the chord (a chamfer), `ρ → 1` approaches the sharp
  corner `T`. This matches Onshape's help ("0.01 creates a flat,
  nearly-chamfered shape; 0.99 creates a pointed, nearly-unchanged shape";
  bounds `[0, 0.99999]`, default 0.5, DOCUMENTED).
- **Convention clash**: in Parasolid's VRB, `rho = 0` means *circular*
  (DOCUMENTED §29.2), not "chord". Never map one kernel's rho onto another's
  without a conversion.
- In the conic fillet the apex `T` is still the tangent-line intersection, so
  the contacts are those of the rolling ball of radius `r` (Onshape reads the
  size from `nonCircularRadius`, DOCUMENTED). Whether Onshape keeps the
  rolling-ball contacts for conic sections is INFERRED and must be probed.

### 9.3 Curvature-continuous (G2)

A G2 profile must match the supports' normal curvature in the section plane at
both contacts: zero for a plane, the support's normal curvature in the
section direction otherwise. A conic cannot do this against a plane (a
non-degenerate conic has non-zero curvature at its ends).

- **Quartic construction for plane/plane** (INFERRED; textbook Bézier
  curvature formula): curvature at an end of a Bézier curve is proportional to
  the area of the triangle of its first three control points. Zero curvature
  at both ends of a quartic `Q0..Q4` needs `Q2` on the line `Q0Q1` and on the
  line `Q3Q4`, i.e. `Q2 = T`. So `Q0 = P1`, `Q1 = P1 + λ(T − P1)`, `Q2 = T`,
  `Q3 = P2 + λ(T − P2)`, `Q4 = P2`, with one shape parameter `λ ∈ (0, 1)`.
  This resembles Onshape's `magnitude ∈ [0, 0.999]`, but the actual Onshape
  law is not documented (HEARSAY; probe).
- For curved supports the end curvature must equal the support's normal
  curvature, which fixes the second-row control point off the tangent line;
  the construction generalises with one more degree of freedom per end.
- G2 blends are not rolling-ball blends. Onshape forces
  `allowEdgeOverflow = true` for `CURVATURE` (DOCUMENTED).

### 9.4 One representation for every profile in the symmetric families

INFERRED design point. In the translation family the blend is the extrusion of
a 2D profile curve; in the rotation family it is the revolution of the profile.
So two surface types with a rational 2D profile cover **every** profile
(circle, conic, chamfer line, G2 quartic, the elliptic asymmetric section):

- `Extrusion{profile: rational Bézier/B-spline in a plane, direction}`;
- `Revolution{profile in a meridian half-plane, axis}`.

The circular profile reduces to `Cylinder`/`Torus`/`Sphere`, the line to
`Plane`/`Cone`/`Cylinder`, so the analytic types stay canonical. STEP has
`SURFACE_OF_LINEAR_EXTRUSION` and `SURFACE_OF_REVOLUTION` (HEARSAY from
memory of ISO 10303-42; verify against the schema). Offsets of these surfaces
are exact only for circular and linear profiles; the offset of a conic is a
degree-8 curve, not a conic (DOCUMENTED in general form: Patrikalakis 11.1.1,
offsets of NURBS are non-NURBS except special cases), so shelling a
conic-filleted body is not exact in this representation (section 12).

Outside the symmetric families, non-circular profiles are sweeps along a
non-circular spine: only a procedural blend record or an approximating
B-spline represents them.

## 10. Failure taxonomy

Every class below has a geometric criterion, the name other kernels use, and
the behaviour a first cut should have. The Onshape names are the Parasolid
fault codes nearly word for word (DOCUMENTED, Onshape FS note), so FS code
that catches them keeps working. remus codes are DOCUMENTED in the remus note;
ACIS codes in the ACIS note.

| # | class | criterion | Onshape / Parasolid | ACIS / remus |
|---|---|---|---|---|
| 10.1 | radius too large for a support's curvature | `1 − r·κ ≤ 0` on a support toward the ball (section 2.3, condition 1): boss top or blind-hole floor with `r > ρ` | (general "radius too large" / `FILLET_FAILED`) | `BL_BLEND_TOO_BIG`; `RadiusTooLarge{edge, max_radius}` |
| 10.2 | no spine | `O1 ∩ O2 = ∅` near the edge; 2D solve with negative discriminant | `PK_blend_fault_unknown_c` "may be possible if the blend radius is changed" | `BL_BAD_SPINE`, `BL_CHAMF_ERR` |
| 10.3 | contacts leave the faces | a contact curve crosses a boundary edge of its support; plane/plane: `r·tan(θ/2)` > available width | `FILLET_FACE_RANGE_TOO_LARGE` (`face_c`), overflow handling | remote blending; `CliffEncountered{edge, face, requested_radius, available_radius}` |
| 10.4 | overlapping blends | two blend surfaces intersect away from a shared vertex | `FILLET_OVERLAP` (`overlap_c`), `FILLET_BOUNDARY_OVERLAP` | global interference check |
| 10.5 | self-intersecting blend | used arc violates `r·κ_s·cos v < 1`; spine self-distance `< 2r` | `FILLET_PRODUCED_SELF_INT_SURFACE` (`self_int_c`, only with checks on) | `BL_GEOM_CONSTRUCTION_FAILED`; `TwistedSurface` |
| 10.6 | tangent, near-tangent, variable-convexity edges | `n1 × n2 ≈ 0`; sign change of `(n1 × n2)·t` | `FILLET_FAIL_SMOOTH`; `VARIABLE` convexity | `BL_NON_U_CVXTY` |
| 10.7 | obliterated topology | the blend covers a whole loop, face or hole | `FILLET_OVERLAPS_EDGE_LOOP` (`loop_c`), `FILLET_EDGE_OVERLAPPED_BY_FILLET` | "pocket lost" |
| 10.8 | vertex too complex | section 6.5 | `FILLET_VERTEX_EDGES_COMPLICATED` (`vertex_c`), `FILLET_ADJOINING_EDGE_NOT_FILLETED` (`edge_c`), `FILLET_RANGE_INCONSISTENT_EDGE` (`range_c`) | `BL_MITRE_TOO_CMPLX`, `BL_NO_MITRE_MIXED`; `UnsupportedVertexBlend{vertex, stripes}` |
| 10.9 | end boundary problems | cap face cannot terminate the blend; end boundary hits an unblended edge | `FILLET_ILLEGAL_END_BOUNDARY` (`end_c`), `FILLET_BOUNDARY_INTERSECTS_EDGE` (`edge_intsec_c`), `FILLET_REQUIRES_SURFACE_EXTENSION` (`bsurf_c`) | `BL_NO_CAP`, `BL_NO_CAP_EXTN`, `BL_END_TOO_CMPLX` |
| 10.10 | degenerate geometry | cone apex, sphere pole or seam inside the blend region; edges shorter than the setback | (numerical failures) | `BL_NOT_IMPLEM` (vertex blend at a cone apex), `BL_SETBACK_TOO_LARGE` |

### 10.1 Radius too large for the support

- Exact scalar tests for the analytic supports (section 2.3, condition 1). With the ball
  inside a cylinder: `r < ρ` gives a torus, `r = ρ` a sphere and **face
  consumption** at the same time (the cap face shrinks to a point: a dome),
  `r > ρ` fails.
- The diagnostic value is the bound itself: "radius 3.0 exceeds support radius
  2.5 of face #F12". ACIS's error model pairs each error with a type
  (IMPS impossible / LIMT limitation / USER / PROG) and this is IMPS
  (DOCUMENTED classification, ACIS note).

### 10.2 No spine

- For the 2D solver: negative discriminant (line/circle) or `h² < 0`
  (circle/circle). Plane/plane always has a spine unless the planes are
  parallel.
- In the general solver: Newton fails to converge. OCCT reports
  `ChFiDS_StartsolFailure` / `WalkingFailure`; remus reports
  `WalkingFailure{edge, t, residual}` (DOCUMENTED). A certified solver should
  distinguish "no solution exists" (excluded by bounds) from "did not
  converge" (budget exhausted), in line with remus's "nonconvergence reports
  budget and consumed" (DOCUMENTED).

### 10.3 Face consumption and overflow

A contact curve reaching the boundary of its face is the single most
important failure class (Parasolid devotes a chapter to it; ACIS remote
blending, OCCT #1177).

**Exactly consumed faces** (INFERRED). When the contact lines of two blends
meet exactly on a face, the face shrinks to a curve and must be removed. If
the two blends then share a carrier, their faces merge. Example: a plate of
thickness `t`, both edges of the end face filleted with `r = t/2`. The two
contact lines meet in the middle of the end face; both fillet cylinders have
their axis at mid-thickness, distance `r` from the end face, so they are the
**same cylinder**, and the result is one half-cylinder face (a full round).
OCCT fails exactly here (#1177: `r = 5` on a 10 mm face fails, 4.99 works and
leaves a sliver; DOCUMENTED). This is common in FDM (rounded plate ends, slot
ends) and has an exact analytic answer.

**Overflow** (DOCUMENTED, Parasolid FD ch. 31). A blend "would leave one or
both of the faces adjacent to the edge being blended".

- *Internal* if the blend lies in the adjacent face on both sides of the
  overflow, *external* at an end. *Bounds* are the edges bounding the
  overflow region; *convexity* is theirs relative to the blended edge.
- The four types:
  - **smooth**: the blend continues as an equivalent blend on the overflow
    faces (the ball rolls onto a new support pair; bounds and overflow edges
    must be smooth);
  - **cliff**: the blend becomes a *cliffedge* blend, tangent to one face and
    running along the edge of the other (the other face is consumed);
  - **cliff-end**: cliff and overflow at the ends of edges;
  - **notch**: "the blend surface remains the same, and the blend is trimmed
    using the faces in the notch".
- Default attempt order: smooth → cliff → notch; tokens allow or forbid each;
  "When no allowed overflow type can be created, the blend operation fails".
- Default by configuration:

  | overflow | bound | bound convexity | default |
  |---|---|---|---|
  | internal | sharp | opposite | cliffedge, turning into notch as the radius grows |
  | internal | smooth | opposite | smooth |
  | internal | sharp | same | notch |
  | internal | smooth | same | notch |
  | external | sharp | opposite | notch |
  | external | smooth | opposite | smooth |
  | external | sharp | same | notch |
  | external | smooth | same | notch |

- **Cliffedge geometry for straight edges on planes** (INFERRED): the blend is
  tangent to plane 1 and contains the cliff line `L` (an edge of the consumed
  face, parallel to the blended edge). In the section plane: a circle of
  radius `r` tangent to a line and passing through a point, so the centre lies
  on the offset line at distance `r` from the point, a quadratic. The result
  is a **cylinder**, still analytic, not tangent to the consumed side.
- **Notch**: the rolling-ball surface is unchanged and trimmed by other faces:
  a Boolean trim of analytic surfaces. This is where "fillet via Boolean"
  (section 13.1) is the natural implementation.
- Onshape's default is `allowEdgeOverflow = true` (DOCUMENTED). A first cut
  that cannot overflow must fail explicitly, never return a different shape
  silently; best with the overflow type Parasolid would have chosen, from the
  table above, in the message.

### 10.4 Overlapping blends

- Two blends on non-adjacent edges whose blend surfaces intersect, e.g. both
  top edges of a thin rib with `r > t_rib/2`, or fillets on both sides of a
  narrow slot.
- Parasolid: overlapping blends "fixed simultaneously" fail with `overlap_c`
  and "succeed when fixed one after another" (DOCUMENTED §32). So the
  sequential semantics (a later blend sees the earlier blend faces) resolves
  many overlaps, at the cost of order dependence. ACIS rebuilds "as though the
  larger radius blend had been done before the smaller radius blends"
  (DOCUMENTED, blend reordering).
- Detection must be global: ACIS's default local check (spring curves against
  nearby geometry) misses cases and silently drops a pocket (DOCUMENTED,
  "pocket lost"). Wonky should always intersect the blend sheet with the whole
  body (a BVH broad phase; section 13.4).

### 10.5 Self-intersection

- **Local**: the used arc must satisfy `r·κ_s(t)·cos v < 1` (section 2.3, condition 3).
  For the analytic cases this is a scalar check; the inside torus needs only
  `major > 0` (section 4.6). For a pipe around an ellipse with semi-axes
  `A ≥ B`, `κ_s` peaks at `A/B²` at the ends of the major axis
  (INFERRED, standard ellipse curvature), so `r < B²/A` bounds the whole
  pipe; the used arc may allow more.
- **Global**: spine self-distance `< 2r` (body/body), and end-circle cases
  (DOCUMENTED, Patrikalakis 11.6.3). Example: a fillet around a tight U-shaped
  edge chain.
- Onshape's face blend exposes "detached" output that "resolves
  self-intersecting surface errors" (DOCUMENTED): an admission that the
  kernel gives up attaching self-intersecting blends.

### 10.6 Tangent and near-tangent edges

- **Exactly smooth edge** (`n1 × n2 = 0` along the edge): nothing to fillet;
  `FILLET_FAIL_SMOOTH`. Smooth edges are *passed through* by tangent chains
  (section 7), never blended themselves.
- **Near-smooth**: the fillet is a sliver tangent to both supports, width
  `≈ r·θ`. Two hazards:
  - numerical: `tan(θ/2)` from `|n1 × n2|/(1 + n1·n2)` is stable; formulas via
    `acos` are not (remus's `dihedral_half_angle` bug, section 3.1);
  - Boolean: the hybrid Boolean's pre-certificate refuses "near-tangent,
    near-coincident or grazing" carrier pairs (DOCUMENTED,
    `docs/hybrid-boolean-plan.md` §2 stage [C]), and a fillet is by
    construction tangent to its supports (section 13.1).
- **Edge ending at a point of tangency** (the faces become tangent at the
  vertex): Parasolid allows it except for asymmetric chamfers and asymmetric
  conics (DOCUMENTED §29.3); the blend width tends to zero at that end.
- **Variable convexity**: split the edge at the sign change or refuse
  (`VARIABLE`, `BL_NON_U_CVXTY`).
- **Grazing contacts** (a spring curve touching an edge tangentially) are
  unsupported in ACIS entity-entity blending (DOCUMENTED); they are exactly the
  degenerate predicate cases that need an exact decision or an explicit
  ambiguity error.

### 10.7 Obliterated topology

- A convex blend can remove a hole or a small face entirely; a concave blend
  can bury one. Parasolid deletes "any topology in the region completely
  overlapped by the blend" by default; with `transfer` a deep enough hole is
  kept and moved into the blend face (DOCUMENTED §30.3.6).
  `FILLET_OVERLAPS_EDGE_LOOP` is the refusal for loops.
- ACIS's "pocket lost" (DOCUMENTED, with exact Scheme coordinates in the ACIS
  note): with the default local check a round of 20 on a cube edge swallows a
  blind pocket and **reports success**. The correct answer keeps the pocket.
  It is a ready-made regression fixture.
- HP patent US5615317A is the recipe for the shrink/swallow case: walk the
  edges around each end vertex, `kev` every edge the blend boundary does not
  hit, `kbfv` faces that lose all edges (DOCUMENTED, HP note).

### 10.8 Silent failure is the worst failure

Documented cases where kernels return wrong geometry and report success:

- OCCT #1371: a closed B-spline rim fillet returns a self-intersecting solid
  with `IsDone` and zero faulty contours (DOCUMENTED);
- monstertruck `fillet_edges` swallows `GeometryFailed` and restores
  checkpoints, so requested fillets can simply be missing (DOCUMENTED);
- ACIS "pocket lost" with default local interference (DOCUMENTED);
- Parasolid keeps flagged self-intersecting results when checks fire ("the
  blend is fixed to the body", DOCUMENTED).

Parasolid's own conclusion, "the only guaranteed test of a blend is to FIX
it" (DOCUMENTED), is the right rule for wonky: compute, validate the result
(closed, oriented, no self-intersection, certification oracle of section 2.5,
global interference), and fail with the class above and the entity ids.

## 11. What wonky can hold exactly

### 11.1 The map

Current production types (MEASURED, `kernel/analytic.bend`, and `grep` over
`src/*.mjs` finds no torus or sphere): surfaces `Plane`, `Cylinder`, `Cone`;
curves `Line`, `Circle`, `Ellipse`.

| item | exact today | needs |
|---|---|---|
| chamfers, translation family (plane/plane, plane/cyl ∥, parallel cylinders) | yes: `Plane`, `Line` | — |
| chamfers, rotation family (cap edges of holes and bosses, coaxial steps) | yes: `Cone`, `Plane`, `Cylinder`, `Circle` | — (supports that are spheres or tori need those types anyway) |
| fillets, translation family | yes: `Cylinder`, `Line`; caps give `Circle` or `Ellipse` arcs | a curved cap face: space quartic cross curve |
| linear variable-radius plane/plane fillet | yes: `Cone` (section 8.3) | confirm Onshape's radius law first |
| fillets, rotation family (cap edges, coaxial) | no | `Torus` (ring, spindle, horn), `Sphere` |
| sphere corners | no | `Sphere` |
| horn-torus corner past an opposite-convexity sharp edge | no | `Torus` with major = minor, a singular vertex |
| mitered two-of-three plane corners | yes: `Ellipse` miters | oracle check of the expected miter |
| tangent chains of the above | yes / with `Torus` | — |
| conic, G2, asymmetric (elliptic) profiles in the symmetric families | no | `Extrusion` and `Revolution` of a rational 2D profile (section 9.4), or B-spline surfaces |
| oblique plane/cylinder and plane/cone fillets | no | pipe surface (procedural, or rational B-spline bidegree (4,2)); `Hyperbola`/`Parabola` curves for the cone |
| crossed cylinders, off-axis sphere pairs, other quadric pairs | no | pipe surface; rational (6,2)/(8,2)/(12,2) in Dahl's configurations, approximated with a certified bound otherwise; space-quartic or B-spline curves |
| setback vertex blends, unequal-radius corners, mixed convexity | no | n-sided patch type, B-spline export |
| general variable radius | no | canal surface (procedural) or B-spline |

### 11.2 Adding Torus and Sphere

- Parameters: `Torus{origin, axis, x, major, minor}` (the OCCT/STEP form,
  DOCUMENTED in the OCCT note), `Sphere{origin, axis, x, radius}`. The proto
  recover code already carries `SSphere{o, r}` and `STorus{o, a, big, small}`
  and the plane/sphere, sphere/sphere, coaxial sphere/cylinder/cone,
  plane/torus (perpendicular or through the axis) and coaxial torus/cylinder
  sections, all as circles (DOCUMENTED, `kernel/proto/recover/geom.bend`).
- Topology rules exist in proto recover (DOCUMENTED, `docs/proto-recover.md`):
  a full sphere gets two pole vertices and a pole-to-pole meridian seam; a full
  torus one vertex and two closed seams; torus bands between meridian rims.
- **STEP**: `SPHERICAL_SURFACE` and `TOROIDAL_SURFACE`. For a spindle torus
  (major < minor, the inside cap fillet with `ρ/2 < r < ρ`) and a horn torus
  (major = minor) STEP has `DEGENERATE_TOROIDAL_SURFACE` with a
  `select_outer` flag (HEARSAY, from memory of ISO 10303-42; verify against
  the schema and with `uv run scripts/validate-step.py` before relying on it).
  The hybrid plan notes that sphere and torus faces currently reach STEP only
  through the bake-off test serializer (DOCUMENTED, §8 step 9).
- **Construction exactness**: centres and radii involve `sqrt` (normalising,
  `r/cos(θ/2)`) and are F32x2 constructions, not exact rationals. Decisions
  that depend on them (does the ball fit, which root, is the arc proper) need
  the filtered path with an explicit "undecidable" outcome (INFERRED,
  consistent with `docs/robust-predicates.md`'s policy).
- **Downstream cost** (INFERRED from the hybrid plan's Unresolved list): every
  new face type must survive later Booleans. Torus SSI with a plane is a
  circle only for planes perpendicular to or containing the axis, and with a
  cylinder or cone only when coaxial; everything else is a quartic, which is
  Unresolved today and gives a CertifiedMesh at best. So "fillet the boss,
  then cut it with an oblique plane" will stay approximate until quartic
  curves exist. Feature order in the model decides whether a result stays
  exact.

### 11.3 Beyond the analytic tier

- **Procedural blend record as the source of truth.** Parasolid stores every
  rolling-ball blend as one type, the *blended edge*: `geom_1`, `geom_2`,
  `radii`, `spine`, `spine_ext`, simplifying to tori and cylinders "wherever
  possible" (DOCUMENTED, Parasolid FD §29.6; XT format note). The Choi-Ju note
  recommends the same for wonky: keep `(supports, radius law, section law)` as
  the definition and treat any B-spline as a derived artefact with a stated
  tolerance.
- **Exact rational forms** exist for the configurations in Dahl's list
  (bidegrees (4,2), (6,2), (8,2), (12,2), DOCUMENTED). They need a rational
  B-spline surface type and exact rational pcurves; the Wallner-Pottmann
  kinematic maps give exact rational curves on spheres and cylinders
  (DOCUMENTED, Wallner-Pottmann note).
- **Certified approximation** otherwise: monstertruck's adaptive scheme
  (contact circles at span ends and midpoint, cubic B-spline rows, check the
  midpoints at `u ∈ {0, ½, 1}` against the exact surface, insert, at most 16
  rounds, else `None`) is the explicit-tolerance, explicit-failure pattern
  (DOCUMENTED, Apache-2.0).
- **Rossignac's PCC**: approximate a non-circular spine by G1 bi-arcs, so the
  canal surface becomes G1-joined **exact tori and cylinders** with a stated
  tolerance (DOCUMENTED, Rossignac thesis ch. 7-9). It keeps every face in the
  analytic zoo, and therefore inside what the Boolean and STEP already handle,
  at the price of an approximation bound. A candidate for oblique fillets and
  for offsets of elliptic edges (INFERRED).

## 12. Offsets and shelling

### 12.1 Definitions and the analytic zoo

- `S↑d` (grow) = all points within `d` of `S`; `S↓d` (shrink) = the complement
  of the grown complement (DOCUMENTED, Rossignac note). Grow and shrink are not
  inverses: `(S↓d)↑d ⊂ S ⊂ (S↑d)↓d`, and those two composites are exactly
  rounding and filleting (section 1.4).
- The boundary of `S↑d` lies in: the normal offsets of the faces, **pipes of
  radius `d` around convex edges**, and **spheres around convex vertices**
  (DOCUMENTED, Rossignac p. 8-11; Patrikalakis 11.1.4). Shrinking is the
  same on the complement: pipes around concave edges.
- Offsets of the analytic surfaces are analytic of the same type (DOCUMENTED,
  Patrikalakis 11.3.3; formulas INFERRED):

  | surface | offset by `d` along the outward normal |
  |---|---|
  | plane | same normal, shifted by `d` |
  | cylinder `ρ` | coaxial, `ρ + d` (collapses at `ρ + d = 0`) |
  | cone, half-angle `α`, radius `ρ0` at the axis origin | same axis and `α`, `ρ0 + d/cos α` at the same axis origin |
  | sphere `ρ` | `ρ + d` |
  | torus `(M, m)` | `(M, m + d)` for the tube side |
  | pipe of radius `r` around spine `s` | same spine, `r + d` |
  | Dupin cyclide `Z(a, c, μ)` | `Z(a, c, μ + d)` (DOCUMENTED, Shene 2000 Lemma 1) |
  | extrusion or revolution of a conic profile | **not** closed: the offset of a conic is not a conic |

  The cone formula: a point `(ρ, h)` of the meridian moves by
  `d·(cos α, −sin α)`; the new meridian has radius
  `ρ0 + h'·tan α + d/cos α` at height `h'`.
- The edge pipes are the same objects as fillet pipes, with the **edge itself
  as spine**: a line edge gives a cylinder, a circle a torus, an ellipse a
  pipe around an ellipse. So the Euclidean offset of a body with an oblique
  hole needs the same non-analytic type as the oblique fillet (INFERRED).

### 12.2 Arc join vs intersection join

- **Arc join** (Euclidean, rolling-ball offset): convex edges get pipes,
  vertices spheres. Semantics of clearance and tolerance checks.
- **Intersection join** (extend-and-intersect): offset faces are extended and
  intersected, so edges stay sharp. OCCT offers both (`GeomAbs_Arc`,
  `GeomAbs_Intersection`, DOCUMENTED); Onshape/Parasolid shells are believed
  to be intersection-join (INFERRED in the Rossignac note; needs an Onshape
  probe).
- New edges of an intersection-join offset are intersections of offset
  carriers: the same SSI types as the originals (an offset plane cutting an
  offset cylinder obliquely is again an ellipse), so the Boolean's curve
  coverage decides exactness, not the offset itself.

### 12.3 Shell and its interaction with fillets

- Onshape `opShell`: positive thickness outward, negative inward; the `shell`
  feature flips the sign so the UI default is inward; `isHollow` hollows
  without opening faces; bounds `[1e-5, 0.0025, 500] m` (DOCUMENTED, Onshape
  FS note).
- An inward shell of thickness `t` offsets every face by `−t` (INFERRED from
  the table above):
  - a convex fillet cylinder of radius `r` becomes a concentric inner fillet of
    radius `r − t` if `r > t`; at `r ≤ t` the inner face **collapses**, the
    inner corner becomes sharp, and the face disappears from the cavity
    (a topology change, decided by one scalar comparison);
  - a concave fillet `r` becomes `r + t`;
  - a cap-edge torus keeps its major radius and changes its minor radius the
    same way;
  - with the arc join, the concave edges of the body (convex edges of the
    cavity seen from inside) would instead get new rounds of radius `t`.
- Face degeneracies (a cylinder offset to zero radius, a cone apex, a torus
  tube collapsing) must be detected exactly and handled by removing the face or
  failing explicitly (DOCUMENTED as conditions in the Patrikalakis note).
- The failure enumeration of OCCT's `BRepOffset_Error` (bad normals, C0
  geometry, cannot trim or fuse, mixed connectivity) is a good checklist for
  wonky's offset errors (DOCUMENTED, OCCT note).

### 12.4 Offsets as fillet machinery

- Fillets use offsets (section 2.1) and are compositions of offsets in the
  global sense (section 1.4). An edge-local fillet is not an offset
  composition, but a **convex body with every edge rounded by one radius** is
  exactly `(S↓r)↑r = (S↓r) ⊕ ball(r)`, which gives both a construction and an
  oracle for "round all edges" on convex parts (INFERRED from the Rossignac
  note).
- Shape interrogation's canonical failure applies to both: an untrimmed offset
  gouges, a trimmed one undercuts (DOCUMENTED, Patrikalakis Fig. 11.10).

## 13. Integrating a blend into the body

### 13.1 Pipeline

A functional version of the staged architecture that ACIS, Parasolid and
Braid describe (DOCUMENTED stages; the Bend shape INFERRED in the Braid note):

```
fillet(body, edges, spec) -> Result<body, FilletFault>
  1. resolve queries to edge ids; propagate tangent chains (section 7),
     report added edges
  2. classify each edge: convexity (1.2); refuse VARIABLE / smooth (10.6)
  3. classify each touched vertex: terminal | bi-blend | miter |
     sphere corner | horn torus | refuse (section 6)
  4. per edge piece, in parallel:
       family = translation | rotation | other      (4.1)
       2D solve -> Cylinder | Torus | Sphere; chamfer -> Plane | Cone | Cylinder
       existence checks (2.3), contact-on-face range check (10.3)
       other -> UnsupportedSurfacePair (until a pipe tier exists)
  5. cross curves at vertex ends: caps, miters, sphere-corner arcs (6)
  6. attach (13.2 or 13.3), then validate: closed, oriented,
     no self-intersection, global interference, certification (2.5)
  7. tag every new face (source edge | vertex, role, spec)
```

Steps 4 and 5 are uniform per edge and per vertex; step 6 is the irregular
graph work.

### 13.2 Attach by Boolean (blend primitives)

- Rossignac's recipe (DOCUMENTED, thesis §2.3): form an oversized blend
  primitive from a simple sub-solid `Q` around the edge (`F_r(Q) − Q` for
  concave, `Q − R_r(Q)` for convex), trim it with a box, then `S ∪ P` or
  `S − P`. Braid/ACIS: build the blend sheet first, merge it with the Boolean
  in stage 2 (DOCUMENTED, "staged evaluation … existing Boolean code").
- **Tools per case** (INFERRED):
  - plane/plane, convex: the prism over the section "kite minus disc" (corner,
    two contacts, centre; minus the ball's disc), extruded along the edge;
    subtract. Concave: the same region; unite.
  - cap edge: the same section revolved: a torus sliver (spandrel of
    revolution).
  - sphere corner: the corner box from `c` to the vertex minus the ball,
    united with the edge tools.
  - Extending a convex tool beyond a convex end face is harmless; a concave
    tool must be cut by the cap face; at a concave end the convex tool must be
    capped exactly (section 6.1).
  - Sequential Booleans of edge tools give the intersection miter at a
    two-of-three vertex, but **not** the sphere corner at three-of-three: the
    corner tool is required.
- **Pros**: reuses the Boolean; trims, notches, obliterated holes and
  interference with distant faces fall out of the Boolean.
- **The catch**: the tool's blend face is exactly tangent to both supports
  along the spring curves, and its flat faces are coplanar with the supports.
  The hybrid Boolean's stage [C] refuses near-tangent and near-coincident
  carrier pairs, and "both corpus tangent cases are refused"; the plan lists
  fillets-through-tangent-cylinder-Booleans as a conjecture (DOCUMENTED,
  `docs/hybrid-boolean-plan.md` §2 and §5). So this route needs the Boolean to
  accept *declared* tangencies: tool faces that reuse the support carriers
  (same records) and spring curves supplied as known exact edges
  (provenance), not rediscovered from a mesh. INFERRED requirement.

### 13.3 Attach by local surgery

- HP US5615317A (shrink/swallow) and US6133922A (growing neighbours, gaps,
  DFS trimming paths with backtracking) are the concrete public recipes for
  the topological half (DOCUMENTED, HP note, both expired).
- In a persistent B-rep the Euler operators (`kev`, `kbfv`, `adef`) become
  pure rewrites, and backtracking is free (keep the old version). Exit
  invariant: every loop geometrically closed (the patent's gap test holds
  everywhere), no edge with pending geometry (INFERRED, HP note).
- Surgery gives exact face identity and explicit provenance events ("F1
  swallowed", "F4 grew") and avoids the Boolean's tangency problem, because
  the spring curves are placed, not found.

### 13.4 A hybrid worth prototyping

INFERRED: attach by surgery when every contact stays on its face and every cap
is simple (the common FDM case, no Boolean, exact tangencies by
construction), and hand only overflow, notch and interference cases to the
Boolean with declared tangencies. Run the global interference check (blend
sheet against every face through a BVH broad phase) always, never a local
one (ACIS "pocket lost").

## 14. Oracles and invariants for tests

- **Closed-form volumes** (INFERRED; the constants MEASURED in
  `tmp/fillet/theory-checks.mjs`):
  - straight edge of length `L`, full-length, ending at perpendicular faces:
    `ΔV = L·r²·(tan(θ/2) − θ/2)`; at 90°: `L·r²·(1 − π/4)`;
  - Marc's `roundX` on an `a×b×c` box (4 X-parallel edges):
    `V = abc − (4 − π)·r²·a` (DOCUMENTED formula, Onshape FS note);
  - all 12 box edges plus 8 sphere corners: the Steiner formula of section 6.4;
  - cap-edge fillet or round at 90° (Pappus): section area `r²(1 − π/4)`,
    centroid at radius `ρ + σ_r·r·(1 − k)` with `k = 2/(3(4 − π)) ≈ 0.77663`
    (the spandrel centroid's distance from the ball centre, MEASURED), so
    `ΔV = 2π·(ρ + σ_r·r·(1 − k))·r²·(1 − π/4)`; `σ_r = −1` for a boss top or a
    blind-hole floor, `+1` for a hole rim or a post base.
- **Topology counts** (INFERRED, Euler-checked):
  - `roundX` box: 10 faces, 24 edges (8 spring lines, 8 shortened end-face
    lines, 8 arcs), 16 vertices;
  - all edges of a box: 26 faces (6 planes, 12 cylinders, 8 spheres), 48
    edges (24 lines, 24 arcs), 24 vertices.
- **Certification** (section 2.5): maximum-ball residual, contacts on the
  supports, G1 at the springs.
- **Algebra** (DOCUMENTED properties, Rossignac): `R_r(S) ⊂ S ⊂ F_r(S)`;
  idempotence; re-rounding with `a ≤ r` changes nothing.
- **Boundaries of admission**: sweep `r` across `ρ` (inside torus → sphere →
  failure), across `w/tan(θ/2)` (fits → consumed → overflow), and the
  chamfer's `d2/d1 = |cos φ|` (section 5.2); the kernel must switch from
  success to the named failure exactly there (Lukács note: "sweep r across
  1/κ_spine and assert … a named failure at the right place").
- **Metamorphic** (DOCUMENTED list in the remus note): rigid-motion and
  uniform-scale invariance, mirror images (Onshape carried an asymmetric
  chamfer mirror bug, `V414_ASYMMETRIC_CHAMFER_MIRROR_BUG`, DOCUMENTED),
  perturbations of 1e-13 to 1e-6 keep the verdict or refuse typed.
- **Differential**: OCCT through build123d (`uv run`) for its closed-form set
  (plane/plane, plane/cylinder ∥ and ⟂, plane/cone ⟂, sphere corners) and as a
  walking reference elsewhere; the Onshape bridge for Parasolid behaviour
  (overflow defaults, chamfer naming, conic and G2 laws, horn torus corners,
  unequal-radius corners).

## 15. Open questions for part 2

Each needs an oracle probe or a decision, not more reading:

1. Onshape `TWO_OFFSETS` naming (which width belongs to which face) and
   `APEX_RANGE` on curved faces (section 5.1).
2. Onshape's variable-radius interpolation law, and whether a linear law on a
   plane/plane edge gives a cone (section 8.3).
3. Onshape's conic (rho) contacts and its `CURVATURE` / `magnitude` law
   (sections 9.2, 9.3).
4. What Onshape does at: a concave fillet past a sharp convex edge (horn
   torus?), a top-edge fillet larger than the vertical corner radius,
   two-of-three miters (sections 6.2, 6.3, 6.5).
5. Whether Onshape's shell is intersection-join (section 12.2).
6. STEP entities for spindle and horn tori (section 11.2).
7. Attach by surgery, by Boolean with declared tangencies, or the hybrid of
   13.4: the natural subject of the part-2 bake-off.
8. The pipe tier: procedural record plus certified B-spline, exact rational
   Dahl forms, or Rossignac's bi-arc tori (section 11.3). Oblique
   plane/cylinder fillets are the first FDM case that needs it.
