# House style after v1: KS01, KS04, KS09, FP14, FP06

## Kurzfassung (für Marc)

Stand 25. September 2026. Das ist ein Plan, noch kein Code. Onshape habe ich
nicht aufgerufen: Die Geometrie stammt aus Onshapes gespeicherten STL-Netzen
(jeder Netzpunkt liegt auf einer Onshape-Fläche), die Volumina habe ich
geschlossen nachgerechnet.

- **KS09 (P1):** Onshape setzt die Fase an der Kante und die Kegelfase am
  Senkbohrungsrand einfach auf Gehrung. Die Gehrungskurve ist eine
  **Parabel**. Die geschlossene Form trifft Onshape auf 8,7e-10. v1 fehlt der
  Kurventyp Parabel und die Gehrung Ebene × Kegel. Eine Probe ist nicht
  nötig.
- **FP14 (P2):** Die konvexen Rundungen laufen als **Torus** um das obere Ende
  der konkaven Rundung (Hauptradius r_konkav + r_konvex). Es kommen nur
  vorhandene Flächentypen vor. Die geschlossene Form trifft Onshape auf
  2e-16.
- **FP06:** Die kurze Kante verschwindet. Ihre Nachbarn treffen sich auf
  Gehrung an der gedachten Ecke, und die kurze Seitenfläche kappt beide.
  Auch hier reichen die vorhandenen Typen. Für Fasen fehlt noch eine Probe.
- **KS04 (P4):** Die beiden 0,42-Fasen auf dem 0,2-mm-Steg werden an ihrer
  Schnittkurve gegeneinander getrimmt, es entsteht ein Grat. Der Grat ist der
  Schnitt zweier Kegel mit parallelen Achsen. Das ist eine Kurve 4. Grades,
  exakt darstellbar mit einer Wurzel pro Punkt. Die geschlossene Form trifft
  Onshape auf 5e-8, innerhalb von Onshapes Fehlerschranke. Dazu braucht KS04
  die Parabel-Gehrung aus KS09 und `qContainsPoint` über Kegelflächen.
- **KS01 (P1) ist nicht analytisch**, aus zwei Gründen:
  - Der Wiegenschnitt erzeugt schon vor der Fase Schnittkurven 4. Grades
    zwischen Zylindern.
  - Auf einer Kette mit wechselndem Flächenwinkel hält Onshape nicht den
    Abstand 0,42 ein. Es hält zwei feste Offsets (gemessen 0,289 und 0,284 mm).
    An den Bögen ergibt das 0,28 statt 0,42, an der spitzen Kante 0,54.

  KS01 braucht deshalb deine Entscheidung (Toleranz-Stufe oder ein großes
  exaktes Programm) und zwei Probes.
- **Nebenbefund:**
  - Onshapes Volumenwert ist bei Gehrungen und Kegelschnitten nur genähert:
    FP06 1,6e-5, KS07 2e-5, FP08 9e-7.
  - Die Netzpunkte liegen dagegen exakt auf der Konstruktion.
  - KS07 ist deshalb genau OCCTs Ergebnis mit normalen Gehrungen. A verweigert
    es nur, weil die Breitenprüfung ein Hindernis hinter der Gehrung
    mitzählt.
  - Abnahme künftig: exakte geschlossene Form, Onshapes Intervall und
    Onshapes Netzpunkte auf unseren Flächen.
- **Reihenfolge der Pakete** (je Paket ein Lauf mit Checkpoint, HS-2 und
  HS-3c je zwei):
  1. HS-0 und HS-1: Überverweigerungen auf Union-Körpern und KS07;
  2. HS-2: KS09;
  3. HS-4: FP06;
  4. HS-5: FP14;
  5. HS-3: Stege, zuletzt KS04;
  6. HS-6: KS01.

## 1. Scope, sources and method

This plan extends the production fillet (`kernel/fillet`, prototype A of
[fillet-plan.md](fillet-plan.md) §1) past v1 for Marc's printed-part rules
(docs of the R20 session cad-31, 24 September 2026):

- **P1:** 0.42 mm EQUAL_OFFSETS chamfers on rims, crossed by bores and
  counterbores;
- **P2:** R2 at concave junctions, mixed with convex edges;
- **P3:** R4.2 on vertical silhouette edges;
- **P4:** chamfer next to chamfer on narrow lands, and chamfer after fillet.

The targets are KS01, KS04 and KS09 (built by Onshape, refused or blocked in
v1, fillet-plan "Step 5 measured") and the probes FP14 and FP06. It also
takes in the four findings of verify-3 and KS07, the must-build R20 case
that v1 still refuses.

**Method (measured).** Onshape's tessellation vertices lie on Onshape's
B-rep faces and edges, to float32 precision (about 1e-6 mm at these sizes).
For each case I did three things:

- wrote down the candidate construction;
- checked Onshape's vertices against it;
- computed the construction's volume in closed form.

The closed form comes from exact slice areas (Green's theorem on lines and
arcs) integrated over z by Gauss-Legendre, converged to 1e-12 and checked
against an independent scanline integration. The scripts read the
`~/Workspace/cad` meshes read-only and live in `tmp/fillet-prod/housestyle/`.
The worklog is local development evidence.

| case | command (`node tmp/fillet-prod/housestyle/…`) | what the mesh shows | closed form | Onshape value [min, max] | rel. diff |
|---|---|---|---|---|---|
| KS09 | `ks09-mesh.mjs`, `ks09-volume.mjs` | mitre vertices on plane x + z = 34.58 and on cone z = ρ − 0.92, all residuals ≤ 2e-6 | 8374.638733077 | 8374.638740377 [8374.226, 8375.052] | −8.7e-10 |
| KS04 | `ks04-mesh.mjs`, `ks04-volume.mjs`, `ks04-check.mjs` | 57 vertices on both cones (the ridge); every contact at float32 | 2811.923144934 | 2811.923286638 [2811.707, 2812.140] | −5.0e-8 |
| FP14 | `fp14-mesh.mjs`, `fp14-volume.mjs` | 361/361 corner vertices on the torus (axis (9, 9), R 2, r 1, tube centres at z 9) | 4152.7203490632 | 4152.720349063201 | −2.2e-16 |
| FP06 | `fp06-mesh.mjs`, `fp06-onmodel.mjs`, `fp06-volume.mjs` | 121/121 vertices above z 5 on the model, worst 2.2e-6 | 1186.8365165437 | 1186.8551725305 [1186.580, 1187.130] | −1.6e-5 |
| KS07 | `ks07-onmodel.mjs`, `ks07-volume.mjs` | 308/308 vertices above z 8 on plain mitres, worst 6.7e-6 | 8663.819321628 (= build123d/OCCT 8663.819) | 8663.989699363 [8661.007, 8666.973] | −2.0e-5 |
| KS01 | `ks01-rims.mjs`, `ks01-line.mjs`, `ks01-ref.mjs` | contact curves of the chamfer chains (§2.2) | none (non-analytic) | 11040.497 [11038.477, 11042.517] | - |

Planted negatives, all run. Each must fail and did:

- `PLANT=r node ks07-onmodel.mjs` (R 2.001 instead of 2) leaves 200 of 308
  vertices off the model, worst 8.3e-2.
- `PLANT=nocap node fp06-onmodel.mjs` (no cap by the short face) leaves
  vertices 7.0e-4 off.
- The KS04 countermodel without the mutual trim gives 2811.323186. That is
  outside Onshape's interval.

## 2. Three findings that change the plan

### 2.1 Onshape's volume value is approximate on mitred and conic bodies (measured)

On FP06 and KS07, every Onshape mesh vertex lies on the construction to
≤ 6.7e-6 mm. The closed form of that construction still differs from
Onshape's mass-property value by 1.6e-5 and 2.0e-5 relative. That is inside
Onshape's stated interval.

- **KS07:** the closed form equals build123d/OCCT (8663.819,
  `~/Workspace/cad/…/kernel-cases/matrix.md`). So the fillet-plan step 5 row
  "volume = Onshape 8,663.990 within 1e-9 × V (OCCT is 0.170 mm³ off)" rests
  on a wrong premise. OCCT is right; Onshape's value is off by 0.170.
- **Other cases:** KS04 (5e-8), KS09 (8.7e-10) and FP08 (9e-7, known) show
  the same pattern. FP14, whose boundaries are all circles and lines, agrees
  to 2e-16.

**Rule for every acceptance test in this plan.** Three checks, all required:

1. The exact closed form, met by the divergence volume to ≤ 1e-12 × V.
2. Onshape's value inside its [min, max].
3. Onshape's STL vertices on our faces, within the float32 bound plus 1e-6
   mm.

The r20 gate already accepts Onshape's interval (`scripts/r20/acceptance.mjs`,
`EXACT_RELATIVE` or `inInterval`). The fillet harness must not demand
1e-9 × V against Onshape's value where that value is approximate. That is a
gate change, and it is listed per package.

### 2.2 EQUAL_OFFSETS on a G1 chain with varying dihedral keeps two ranges, not the setback (measured on KS01)

Onshape's KS01 mesh gives these contact positions of the one 0.42 chamfer:

| chain, place | dihedral | setback on the wall face | setback on the other face |
|---|---|---|---|
| bottom outline, 90° lines | 90° | side contact z = 0.42000 | - |
| countersink rim (plane/cone) | 135° | bottom r 6.92000 (0.42) | cone contact z 0.29698 = 0.42 cos 45° (0.42 along the slant) |
| cradle chain, rim arc on y = 9 | 90° | 0.28449 (radius 26.58449) | 0.28886 on the cradle (y 8.71114) |
| cradle chain, line on x = 15 | 55.23° | 0.540102 (z 25.456888) | chord 0.5395 (contact (14.553711, 25.693848)) |

- **The model that fits both cradle sections to float32.**
  - Hold two offset ranges constant along the chain: r_wall = 0.28886
    (planes y = ±9, x = ±15 and the R4.2 cylinders) and r_cradle = 0.28449.
  - The spine is offset(wall, r_wall) ∩ offset(cradle, r_cradle).
  - The contacts are the feet of the spine on each face.
  - The chamfer is the chord between the two feet.
  - Check on the line: spine (14.71114, 25.45689); side foot z 25.45689
    (mesh 25.456888); cradle foot (14.55372, 25.69385), mesh (14.553711,
    25.693848).
- **Constant-dihedral chains.** Every chain in A's scope has a constant
  dihedral: plane/plane lines, and rims of a plane ⟂ axis. There this model
  gives setback = w on both faces. That matches FP-a, KS02, KS03 and the
  90° and 135° rows above. So A's setback reading is right for everything
  A builds.
- **Where the model differs.** It matters only on chains whose dihedral
  varies: KS01's cradle loop (90° to 55.23°) and its bore/cradle loop.
- **Conversion from w to the ranges.** It is not found. Walking the quartic
  (`ks01-ref.mjs`), the two chord setbacks are equal near 52° of the corner
  cylinder (0.391) and both near 0.42 near 44°, but never both exactly 0.42.
  The reference point and rule need probe FP17 (§5).
- **Consistency with OCCT (a rough estimate, not a closed form).** OCCT keeps
  the setback per point: 0.42 on the arcs, less on the knife edge. That
  explains the sign and size of build123d's Δ −1.005 mm³ against Onshape on
  KS01.

### 2.3 KS07 is plain mitres; A's refusal is a bounds conservatism (measured)

Onshape's top face of KS07 has 7 vertices. They are exactly the corners of
the top-face polygon offset by 2 with sharp corners
(`ks07-mesh2.mjs`: (2, 2), (28, 2), (28, 2.38337), …).

- **The 0.614 mm step keeps its own R2 cylinder** (axis x = 28, z = 8). It
  is mitred at the convex corner (plane x + y = 30) and at the 263°
  reflex corner.
- **Its offset contact segment is positive:** 0.383 long at r = 2, from y 2
  to 2.383. Nothing is consumed.
- **A refuses it** as `overflow` ("edge 9 limits the face to 0.614"). The
  width bound counts B's front top edge, which touches the end of edge 7's
  slab at (30, 0.614), as an obstacle. That point lies beyond the mitre
  plane x + y = 30 that ends the stripe, so the stripe never reaches it.
- **The same conservatism, twice more:**
  - verify-2's cut-corner chamfer c ≤ d < c(1 + 1/√2) is refused
    `blend-overlap`, because the partner's spring lies behind the mitre
    (development evidence kept locally);
  - verify-3's riser certificate (finding D).

## 3. The cases

### 3.1 KS09 severed rim (P1)

**Input.** A plate 60 × 30 × 5 with two counterbores (Ø11 × 3.2 over Ø6.4
through) at (±25, 12).

- Each counterbore breaks the long edge y = 15 and the short edge x = ±30.
- The disc misses the plate corner (distance 5.831 > 5.5). This leaves a
  0.130 mm² island at (±30, 15), a separate top face that is not selected.
- The chamfer is 0.42 on every edge of the main top face.

**What Onshape builds (measured).**

- All setbacks are 0.42. Every chain has a constant 90° dihedral.
- The chamfer faces:
  - plane chamfers on the four line pieces;
  - two cone chamfers (45°, axis of the counterbore) on the counterbore rim
    arcs.
- Box corners (±30, −15): trimmed plane/plane mitres (lines).
- Counterbore corners: four trimmed mitres of a plane chamfer against a cone
  chamfer.
  - The third edge at each is a convex knife: the side face against the
    counterbore wall, 24.62° at x = ±30 and 56.94° at y = 15. It is not
    selected.
  - The mitre curve is chamfer plane ∩ chamfer cone, for example x + z =
    34.58 ∩ z = ρ − 0.92. The plane meets the axis at the cone's half angle,
    so the curve is a **parabola**. For 90° walls and 45° chamfers it always
    is.
  - Both outer springs end on the knife edge at depth 0.42, at (30, 9.70871,
    4.58) and (20.39023, 15, 4.58). So the mitre closes as A's plane mitres
    do.
- No vertex-blend face. The islands keep their sharp edges.

**What v1 misses.**

- `corners.bend tip_mitre` mitres only two translation stripes on a plane
  shared face. Anything else is `not-implemented` "the mitre curve is not a
  planar conic". The same class refuses verify-2's
  `v2-p1-dshape-top-loop-0.42`.
- `A.Curve` has Line, Circle and Ellipse, but no parabola or hyperbola.

**Smallest exact extension.**

1. Add `Parabola{origin, normal, x, focal}` and `Hyperbola{origin, normal, x,
   major, minor}` to `kernel/analytic.bend` (additive). They mirror STEP's
   PARABOLA and HYPERBOLA.
2. Build the mitre of a translation chamfer and a rotation chamfer on a
   shared plane face. The cut curve is the conic chamfer plane ∩ chamfer
   cone. Its end points are:
   - the intersection of the two contact curves on the shared face (line ∩
     circle, one square root);
   - the common end of the outer springs on the third edge.

   It has two forms, trimmed (KS09) and extended (the third edge concave,
   KS04's reflex corners).
3. Classify the conic by the exact sign of (cos² of the plane-to-axis angle
   − cos² of the half angle). Near zero, route it to `decide.bend`: exact
   where the words allow, otherwise `undecidable`.
4. Leave fillets as they are. Their translation × rotation mitre is cylinder
   ∩ torus, not a planar curve, and it stays refused.

**Probe:** none. The mesh and the closed form settle the semantics.

### 3.2 KS04 cam lever (P4)

**Input.** An outline: disc Ø14 ∪ bar 40 × 10 ∪ tip R5 (G1 into the bar), 6
thick.

- A bore Ø8.4 at (0, 2) with 0.6 rim chamfers.
- Then 0.42 on every edge of the top and bottom faces, including the
  135° edge between the top and the 0.6 cone.
- After the 0.6 chamfer the land between the chamfer rim (r 4.8 about (0,
  2)) and the disc edge (r 7 about (0, 0)) is 0.2 at +Y.

**What Onshape builds (measured).**

- Setback 0.42 everywhere: the top contact of the 135° chamfer at r 5.22,
  its cone contact at z 5.70302 = 6 − 0.42/√2, the disc chamfer at r 6.58 /
  z 5.58, the tip at 4.58.
- The chamfer faces:
  - a 45° cone about (0, 0) on the disc arc;
  - planes on the bar lines;
  - a cone on the tip (G1 chain);
  - on the 135° edge, a cone about (0, 2) with slope dr/dz = 1 + √2.
- **The two chamfers overlap on the land and are trimmed at their mutual
  intersection** (the ridge):
  - 57 mesh vertices lie on both cones.
  - The ridge runs from (−4.26336, 5.012, 6) over +Y to (4.26, 5.01, 6),
    lowest at z 5.8125 at x = 0 (y 6.7675). There it lies inside both
    chamfers' ranges: r1 6.7675 ∈ [6.58, 7] and r2 4.7675 ∈ [4.503, 5.22].
  - Its end points are where the two top contact circles meet.
  - The top face stays one C-shaped face.
  - The same happens at the bottom.
- **The ridge curve.** It is the intersection of two cones with parallel
  axes 2 mm apart, h = 12.58 − ρ1 and h = 6 − (√2 − 1)(5.22 − ρ2).
  - Eliminating h gives k1 ρ1 − k2 ρ2 = c. With ρ2² = ρ1² + D² − 2 ρ1 D
    cos(ψ − ψ0), that is a quadratic in ρ1 for every polar angle ψ.
  - So it is an explicit curve of degree 4 (a lifted Cartesian oval) with
    one square root per point. It is not a conic.
- **Reflex corners (4.899, ±5), top and bottom.** Here the disc cone meets
  the bar plane chamfer in an extended mitre. The third edge is the concave
  vertical union edge.
  - The mesh has (4.7244, 4.58, 6) → (4.89898, 5, 5.58) on cone ∩ plane
    y + z = 10.58.
  - That is a parabola again, as in KS09.

**What v1 misses.** Measured in step 5 with a diagnostic selection:

- The overlap is refused as `overflow`, "chamfer overflow is not a notch in
  v1". A takes the selected disc edge as a boundary obstacle (`bounds.bend
  obs_edges`, by 1) instead of treating the two chamfers as a meet.
- The meet in `notch.bend` covers only equal blends with parallel spines
  (the ridge is a line, FP05).
- Before the fillet is reached, `qContainsPoint` over cone faces stops the
  case's own face selection (`src/queries.mjs:168`: the Bend face
  classification covers plane and cylinder faces only).

**Smallest exact extension, in three steps by curve type.**

1. **Meets with line or circle ridges.** Two plane chamfers on parallel
   edges (the chamfer form of FP05, thin walls). Two rim chamfers or fillets
   on coaxial rims (washer lands narrower than 2d; verify-3's
   `washer2-d`/land cases are `blend-overlap` today). Existing types only.
2. **A plane chamfer against a cone chamfer** (a bore near a straight edge).
   The ridge is plane ∩ cone, a conic. This needs step 1 above and the
   Parabola/Hyperbola of §3.1.
3. **Two rotation chamfers with parallel, distinct axes (KS04).**
   - Add a new curve kind `RevolutionPair`: the intersection of two surfaces
     of revolution with parallel axes whose meridians are lines (plane ⟂
     axis, cylinder, cone). It is parametrised by the polar angle about the
     first axis, with the root branch fixed by the sign condition.
   - The meet is admitted only when the ridge stays inside both chamfers'
     ranges. That is decided exactly at the extreme point (the quadratic's
     discriminant and the branch sign on the job's words, or `undecidable`).
     Outside the ranges it is a typed refusal.
   - STEP writes it as an INTERSECTION_CURVE of the two cones, whose
     curve_3d is a B-spline with a deviation certified in Bend and stated in
     the file. That is an export approximation; the B-rep stays exact.

**Correction to fillet-plan §4.** KS04 was assigned to candidate B. B would
run the hybrid Boolean, which turns cone/cone quartics into certified meshes
(hybrid-boolean-plan §2.3). So B cannot build KS04 exactly. The route above
can.

**Probes.**

- None for the KS04 semantics.
- FP21 (§5) only before admitting meets where the ridge would leave a range,
  and to confirm the plane × cone meet.

### 3.3 KS01 clamp (P1; blocked, not analytic)

**Input.** A block 30 × 18 × 26 with R4.2 vertical corner fillets.

- An R26.3 cradle (axis Y) cuts 4.7 deep. At x = ±15 it lies at z
  25.99699, so it removes the whole top face and leaves a 55.23° knife
  along x = ±15.
- An M6 countersink from below.
- Then one 0.42 chamfer over the bottom outline and every edge of the cradle
  face.

**What Onshape builds (measured contacts, derived faces).**

- **Bottom outline** (4 lines + 4 R4.2 arcs, G1, 90°) and **countersink
  rim** (135°): setback 0.42. These are plane and cone chamfers, all inside
  A's v1 scope.
- **Cradle loop:** a G1 chain of
  - arc on y = ±9 (90°);
  - quartic on each R4.2 cylinder (the dihedral varies from 90° to 55.23°);
  - line on x = ±15 (55.23°).

  Onshape chamfers it with the constant ranges of §2.2:
  - a cone on the arcs, whose contacts are circles (measured);
  - a plane on the lines (constant section, derived);
  - non-analytic ruled surfaces on the four quartic pieces (derived).
- **Bore/cradle loop:** a closed quartic, chamfered as its own chain with
  its own ranges.

**What blocks it, in order.**

1. The hybrid `opBoolean` stops at the cradle cut ("through holes do not
   admit arc edges yet", step 5). That belongs to hybrid-robust.
2. The cut itself creates cylinder/cylinder space quartics: cradle ∩ the
   four R4.2 fillets, and cradle ∩ bore.
   - `A.Curve` cannot hold them.
   - The hybrid plan (step 9) would represent them as B-spline curves with
     a stated bound or as a certified mesh.
   - Either way the body the chamfer starts from is not exact.
3. The chamfer on the quartic pieces is non-analytic in Onshape's own
   result.
4. The conversion from w = 0.42 to the chain's ranges is unknown (§2.2).

**Smallest route.** There is no small exact extension. Marc has two options:

- **(a) Tolerance route.** After the hybrid holds the quartics, implement the
  constant-range chamfer (spine of two offsets, chord between the feet) as a
  ruled B-spline face in the opt-in tolerance stage (decision 3). It carries
  a certified stated tolerance and is never labelled exact.
- **(b) Exact route.** Add procedural intersection curves and a procedural
  chord surface to the production kernel, as Parasolid does. That program
  touches the Boolean, tessellation, classification, volume and STEP. It is
  not a fillet package.

**Recommendation: (a).** The input body is already approximate on the
quartics, so an exact chamfer on it buys nothing.

**Probes first:** FP17 and FP18 (§5), before any KS01 work.

### 3.4 FP14 mixed-convexity corner (P2)

**Input.** An L profile, 10 high. At (8, 8, 10) three selected edges meet:
the concave vertical edge and the two convex top edges of the inner faces.
All three are R1.

**What Onshape builds (measured).** 3 cylinders, 1 torus and 8 planes.

- The concave cylinder (axis (9, 9)) runs from z 0 to z 9 = H − r_convex.
  It ends in a latitude circle of radius r_concave.
- The two convex top fillets continue around that end as one quarter torus:
  - axis = the concave axis;
  - major radius r_concave + r_convex = 2;
  - minor radius r_convex = 1;
  - tube centres at z 9.
- The torus's boundaries are four circles:
  - the top contact, radius 2 on the top face;
  - the inner latitude, the concave cylinder's end;
  - two meridians, where the convex cylinders end.
- Each inner side face gets a corner vertex (9, 8, 9) of valence 4.

**What v1 misses.** `bounds.bend end.two` refuses "corner of mixed
convexity". The class is `mixed-convexity`.

**Smallest exact extension.** A corner kind "rim roll", with these
conditions:

- three selected edges, one concave and two convex;
- the two convex edges bound the two faces adjacent to the concave edge;
- the top face is a plane ⟂ the concave spine.

The corner:

- caps the concave stripe at the latitude plane;
- cuts the convex stripes at the meridian planes through the concave axis;
- places the torus between them.

It needs only existing types (Torus, Circle, Line) and existing surgery
operations (cap, trim, new face).

**Probe.** None for equal radii. For unequal radii the construction is the
same (major r_c + r_v); FP22 confirms it before unequal radii are admitted.

### 3.5 FP06 short edge in a loop (P1 as a chamfer, fillets confirmed)

**Input.** A 20 × 10 × 6 block. The top loop has a 0.707 edge (a 45° cut, legs
c = 0.5) and is filleted R1 with propagation.

**What Onshape builds (measured).** 4 cylinders and 7 planes.

- **The short edge's stripe is consumed.** Its offset contact would have
  length c√2 − 2r tan 22.5° < 0 for r ≥ c(1 + 1/√2) = 0.854.
- **Its neighbours mitre at the virtual corner.** The mitre is an ellipse in
  the plane x − y = 10, from (19, 9, 6) to (19.75, 9.75, 5.661438).
- **The short side face x + y = 29.5 caps both neighbours.** The caps are
  ellipse arcs, and the face grows to 3.8561 mm² (mesh 3.855731).
- The face areas of the construction (30.274, 14.566, 30.036, 14.328)
  match Onshape's mesh areas.

This is regime (ii). Regime (i), c ≤ d < c(1 + 1/√2), has no consumption.
It is plain mitres and belongs to HS-1 (§2.3).

**What v1 misses.** It is refused as `blend-overlap`. For chamfers, verify-2's
`v2-p1-cut-corner-c0.125-top-loop-0.42` (regime ii) is refused the same way.

**Smallest exact extension.** A consumed stripe between two mitring
neighbours is dropped:

- The neighbours mitre at the intersection of their offset contacts. This
  is the existing translation mitre, the bisector plane of the neighbours.
- Each neighbour is capped by the consumed stripe's other face. That is the
  existing oblique planar cap: an ellipse for cylinders, a line for plane
  chamfers.
- It is decided exactly by the sign of the offset length, and the sliver
  band applies there.

**Probe.** FP19 before the chamfer form is enabled (P1). The fillet form is
settled.

### 3.6 v1 closure: verify-3 findings and KS07

| finding | effect on house style | fix |
|---|---|---|
| A: fragment edges are width obstacles; at r = their distance the surgery refuses "consumed face is one of the coplanar fragments" | P1/P3 refused on union-built plain boxes (FS, build123d, harness) | `bounds.bend obs_edges` skips `L.is_fragment` edges; the surgery consumes a fragment region as one face |
| B: edges split at fragment vertices are separate edges | Marc's `ksEdgesAt` plus the default `tangentPropagation` false gives `vertex-blend` on one Onshape edge (P3 R4.2, P1 rim) | the selection extends a selected piece through vertices whose other edges are all fragment edges, with the same carrier, regardless of `tangentPropagation`; note `fragment-joined a b` |
| C: STEP writer gap for ellipse-bounded cylinders in bodies with a torus or cone; the STEP volume is off 2e-5 to 3.2e-4 | strict STEP of P2 rib + boss roots | not fillet-prod's (`kernel/step-cylinder-pcurves.bend`); follow-up F-S |
| D: the riser certificate refuses a vertical R4.2 edge ending on a step lower than r√2 = 5.94; C-tori builds all 6 = closed form | P3 refused | an exact clearance test instead of the ball (§4 HS-1) |
| KS07: obstacle beyond the mitre (§2.3) | R20 must-build refused | defer an obstacle whose limiting point lies beyond the stripe's end cut to the corner stage (HS-1) |

## 4. Packages

Order: P1 before P2 before P4, with dependencies first. Each package fits
one checkpointed run unless marked, and each works in its own worktree
(AGENTS.md).

- **Targets.** js and cpu1 while developing; cpuN in the integrate stage.
  Metal is not a fillet target.
- **Byte identity.** All targets stay byte-identical, and every suite text
  outside the package's cases stays byte-identical to the
  `out/bakeoff/fillet` baseline.
- **Frozen oracles.** Every closed form here enters `fixtures/fillet` as
  INFERRED, citing its script. Onshape meshes that a test needs are frozen
  into `fixtures/fillet/onshape/<case>/` with sha256 and source path.
- **Evidence scripts.** The scripts in `tmp/fillet-prod/housestyle/` are
  evidence, not tests.

### HS-0: coplanar fragments in bounds, surgery and selection (P1, P3; one run)

- **Cases:**
  - verify-3's `v3-f4-split-y2-front-top-r3`, `-r2`,
    `v3-f4-split-y0.25-front-top-0.42`, `v3-f4-split-y0.25-top-loop-0.42`,
    `v3-f3-step-into-split-riser-r3` and `-0.42`;
  - `v3-f1-stacked-lower-piece-noprop-r4.2` and
    `v3-f2-sbs-front-top-piece-noprop-0.42`;
  - FS FA1-FA3, FB1, FS1-FS3 (`tmp/fillet-prod/verify-3/fe3.mjs`);
  - build123d P3, P5 (`py3.mjs`).
- **Files:**
  - `kernel/fillet/bounds.bend` (`obs_edges`);
  - `kernel/fillet/surgery.bend` (a consumed fragment region);
  - `kernel/fillet/main.bend` (selection);
  - regression cases appended to
    `fixtures/fillet/adversarial-fillet-kpart.json` (group `regression`,
    verify-3's closed forms);
  - `test/fs-fillet.test.mjs`, `test/python-fillet.test.mjs`.
- **Acceptance.**
  - *Positive:* each case builds and equals the one-box control's closed
    form by divergence volume (≤ 1e-12 × V). Tight check and strict STEP
    pass. js = cpu1.
    `node scripts/fillet/run-adversarial.mjs --file fixtures/fillet/adversarial-fillet-kpart.json --cases <ids> --proto fillet --targets js,cpu1`.
    FA2 builds inside `try silent`.
  - *Planted negatives:*
    - `obs_edges` keeping fragment edges fails the split cases;
    - the fragment join applied to a real G1 vertex (not only fragment
      vertices) makes FP11 build, and FP11 must stay `vertex-blend`
      (Onshape builds FP11 with a curved cap that A does not have).
  - *No-Claim:* curved fragments (a split cylinder) stay
    `tangent-undecided`. The native backend's `qAdjacent` stays per
    fragment.

### HS-1: obstacles the corner network resolves, and the exact riser (P1, P2, P3; one run)

- **Cases:**
  - KS07 (pre-blend body `tmp/fillet-prod/s5/ks07-preblend.fs` as a harness
    job; FS through `node scripts/r20/acceptance.mjs --cases ks07`);
  - the cut corner c = 0.5, d ∈ {0.6, 0.8} (verify-2 `probe-size.mjs`,
    regime i);
  - `v3-f5-riser-tower-right-edge-y0-r4.2`,
    `v3-f5-riser-tower-left-edge-y12-r4.2` and FS FH h = 5.9.
- **Construction.**
  - Stage 1 marks an overflow or overlap as *provisional* when its limiting
    point lies beyond the plane of a tip that ends the stripe there (a
    mitre or cap with a known cut plane).
  - After the corner network, the bound is recomputed over the stripe's
    extent between its tip planes. It is decided exactly on the job's
    words, like the width bounds of step 3.
  - The riser test replaces the ball with the same clipped clearance.
- **Files:** `kernel/fillet/bounds.bend`, `corners.bend`, `main.bend`;
  fixtures; `test/fillet-port.test.mjs`.
- **Acceptance.**
  - *Positive:*
    - KS07 builds:
      - divergence volume = 8663.819321628 (≤ 1e-12 × V) = OCCT;
      - Onshape's value inside [8661.007, 8666.973];
      - the 308 frozen Onshape vertices above z 8 on our faces (≤ 1e-5).
      The step-5 KS07 acceptance "within 1e-9 × V of Onshape" is replaced by
      this rule (a gate change, §2.1).
    - The cut corners build to their closed forms.
    - The four riser cases equal C-tori and the closed form.
  - *Planted negatives:*
    - `adv-rb-hole-near-edge-sampled-overflow` (a real hole in the strip)
      stays `overflow`;
    - the tip-plane test with its sign flipped fails KS07 or the hole case;
    - a riser with a real edge inside the spandrel end stays refused.
  - *No-Claim:* the chamfer form of the cut corner is not probed in Onshape
    (FP19).

### HS-2: planar-conic mitres, KS09 (P1; two runs)

**HS-2a (kernel and harness).**

- **Work:**
  - add `Parabola` and `Hyperbola` to `A.Curve` (additive) and to every
    `match` inside `kernel/fillet`;
  - the translation × rotation chamfer mitre of §3.1, trimmed and extended;
  - harness support in `brepfmt.mjs`, `validate.mjs`, `tightcheck.mjs` and
    `divvolume.mjs` (a parabola arc gives polynomial boundary integrals,
    exact).
- **Cases:**
  - a KS09 harness job, `ks09-severed-rim-top-loop-0.42`, pre-chamfer body
    from `case.fs`;
  - `v2-p1-dshape-top-loop-0.42`;
  - an extended-mitre job (the KS04 outline without the bore).
- **Acceptance.**
  - *Positive:* KS09 divergence volume 8374.638733077 (≤ 1e-12 × V); tight
    check; js = cpu1. The frozen Onshape mitre vertices lie on our parabola
    arcs (≤ 1e-5).
  - *Planted negatives:*
    - the focal length scaled by 1 + 1e-6 fails the tight check;
    - a cylinder × torus fillet mitre stays `not-implemented`.
  - *No-Claim:* no production export yet.

**HS-2b (production and consumers).**

- **Work:**
  - `production.bend` maps the conics; `src/fillet.mjs` decodes them.
  - STEP: PARABOLA and HYPERBOLA, pcurves on the plane (the 2D conic,
    exact) and on the cone (planner or B-spline chart with a certified
    bound) in `kernel/step-pcurves.bend` and `src/exporters.mjs`.
  - An audit of every consumer of `A.Curve`. The wonky-bend rule: every
    `match` gets the new constructors or a `case _:` typed refusal. In JS,
    every `curve.$` switch supports the kind or refuses by name; no silent
    fallthrough.
  - Consumers outside ownership become follow-ups F-H1 and F-C (§6).
    Counted with `grep -rl Ellipse`: 18 kernel files outside
    `kernel/fillet` (among them `kernel/hybrid/recover/{geom,main}.bend`)
    and 18 `src/` files besides `src/fillet-op.mjs` handle `Ellipse`.
- **Acceptance.**
  - *Positive:*
    - KS09 through FeatureScript with `node scripts/r20/acceptance.mjs
      --cases ks09`: must-build, volume inside Onshape's interval and
      within 1e-6;
    - strict `uv run scripts/validate-step.py` on the KS09 export;
    - `test/fs-fillet.test.mjs` gains KS09's body with the closed form.

    Moving KS09 from designed refusal to must-build in the r20 gate is a
    gate change for hybrid-robust (F-R20).
  - *Planted negative:* a consumer switch without the new kind fails the
    audit test (a test that feeds a parabola edge to each consumer and
    expects support or a named refusal).
  - *No-Claim:* `kernel/volume.bend`, classification and print meshing of
    parabola-bounded faces, unless their owners take F-V/F-C.

**Cross-owner risk.** Adding a constructor breaks the Bend compile of every
exhaustive `match` on `A.Curve`. HS-2b can only land together with the
owners' `case _:` patches (F-C, F-H1). Plan it as a joint integration step,
not as a fillet-only run.

### HS-4: consumed stripe between mitring neighbours, FP06 (P1; one run; after FP19 for chamfers)

- **Cases:**
  - FP06 (`hard-short-edge-in-loop-r1`);
  - the cut corners c = 0.5 with r ∈ {0.9, 1.2};
  - after FP19, `v2-p1-cut-corner-c0.125-top-loop-0.42` and c = 0.5,
    d = 0.9.
- **Files:** `kernel/fillet/corners.bend`, `notch.bend` or `main.bend`,
  `surgery.bend`; `cases.json` (FP06 gets a closed form, and its expect
  moves from `either` to `ok`; listed as a gate change).
- **Acceptance.**
  - *Positive:*
    - FP06 builds with Onshape's 11 faces;
    - divergence volume 1186.8365165437 (≤ 1e-12 × V), inside Onshape's
      interval;
    - face areas as in §3.5;
    - the frozen 121 vertices on our faces.
  - *Planted negative:* the sweep r = c(1 + 1/√2) ± {1e-3, 1e-6, 1e-9}
    changes verdict only at the exact boundary or becomes `sliver`.
    Dropping the cap makes FP06 fail on volume.
  - *No-Claim:* a consumed stripe between a convex and a reflex corner,
    and consumption of two adjacent short stripes.

### HS-5: mixed-convexity rim roll, FP14 (P2; one run)

- **Cases:**
  - FP14 (`hard-mixed-convexity-corner-r1`);
  - the same corner inside a rib/plate union (P2 style, concave R2 with
    convex R2);
  - after FP22, unequal radii.
- **Files:** `kernel/fillet/bounds.bend` (`end.two`), `corners.bend`,
  `surgery.bend`.
- **Acceptance.**
  - *Positive:*
    - FP14 builds with Onshape's 12 faces (3 cylinders, 1 torus, 8 planes);
    - volume 4152.7203490632 (= Onshape to 2e-16, OCCT replay 2.7e-12);
    - the frozen 361 corner vertices on our torus;
    - strict STEP (every torus boundary is a latitude or a meridian).
  - *Planted negatives:*
    - a torus major of r_c instead of r_c + r_v fails on volume;
    - a mixed corner whose convex edges are not the top edges of the
      concave edge's faces stays `mixed-convexity`.
  - *No-Claim:* the two-edge mixed vertex (a concave root running into a
    selected convex edge, `end.one`), rib-into-boss (cylinder × torus mitre),
    mixed chamfer corners.

### HS-3: meets on narrow lands (P4)

**HS-3a (one run).**

- **Work:** meets with line and circle ridges (§3.2, step 1). Chamfer
  overflow onto a selected neighbour becomes a meet, not an `overflow`.
- **Cases:** a thin wall with chamfers, the washer land 0.6 with d 0.42, the
  coaxial washer.
- **Acceptance:**
  - closed forms (Green per slice) by divergence volume;
  - the planted negative: the land at exactly 2d decides exactly or is a
    `sliver`;
  - the ridge leaving a range stays refused.

**HS-3b (one run, after HS-2).**

- **Work:** the plane × cone meet (conic ridge).
- **Cases:** a bore near a straight edge, land 0.3.
- **Acceptance:** after FP21a matches.

**HS-3c (two runs, after HS-2 and the cone query, F-Q).**

- **Work:**
  - the `RevolutionPair` curve kind (kernel, fillet, harness quadrature
    with a stated bound in `divvolume.mjs`);
  - the KS04 meet;
  - production and STEP (INTERSECTION_CURVE with a certified B-spline
    curve_3d), with the same consumer audit as HS-2b.
- **Cases:** a KS04 harness job; verify-3's off-axis washer family
  (`v3-p4-offaxis-washer-both-top-rims-0.42` and the `offaxis-d` sweep,
  `blend-overlap` beyond the land today); KS04 through FS.
- **Acceptance.**
  - *Positive:*
    - divergence volume 2811.923144934 (quadrature bound ≤ 1e-12 × V);
    - Onshape inside [2811.707, 2812.140];
    - the 57 frozen ridge vertices on our ridge (≤ 1e-5);
    - `node scripts/r20/acceptance.mjs --cases ks04` must-build (F-R20).
  - *Planted negatives:*
    - the other root branch fails the volume;
    - the countermodel without trimming (2811.323186) is rejected;
    - a land where the ridge leaves the disc chamfer's range stays refused.
  - *No-Claim:* exact STEP. The file's curve_3d is approximate at its
    stated bound.

### HS-6: KS01 (P1; a program, not a package)

1. **Hybrid (hybrid-robust):** arcs on through holes, and the quartic
   edges of the cradle cut.
2. **Probes:** FP17 and FP18.
3. **Marc's decision** between the tolerance route and the exact route
   (§3.3).
4. **Under (a):**
   - the constant-range chamfer in the tolerance stage, run behind the
     opt-in flag and after A refuses `unsupported-surface`;
   - the analytic pieces stay A's: bottom loop, countersink rim, and the
     rim arcs and knife lines once the ranges are known.
   - *Acceptance:* Onshape's interval; the frozen KS01 contact vertices on
     our faces within the stated tolerance; never labelled exact.

## 5. Onshape probe documents (session bridge; not called here)

Every probe must store the STL together with the volume interval, because
§2.1 makes the mesh the sharper oracle. There are six documents, each with
2-4 parts, in the style of FP01-FP16 (`make_fillet_probes.py`).

| probe | parts | settles | gates |
|---|---|---|---|
| FP17 variable-dihedral chamfer chain | (a) KS01 without the bore: cradle loop only, 0.42; (b) the same with the query's edge order reversed; (c) Ø20 boss cut by a 20° plane, 0.42 on the ellipse rim; (d) (a) with w = 1.0 | the conversion w → ranges, the reference point, and any dependence on selection order | HS-6 |
| FP18 curved-section setback | (a) D-flat Ø20 depth 3, chamfer 1 on both flat edges; (b) R10 groove (concave), chamfer 1 on one line edge | chord, arc or range reading on one constant-dihedral line edge (KS01 knife lines, KS05-type edges) | HS-6, `ladder.bend:320` |
| FP19 cut-corner chamfers | 20 × 10 × 6 top loop with a 45° cut: c 0.5, d 0.6 (regime i); c 0.5, d 0.9 (regime ii); c 0.125, d 0.42 | the chamfer forms of HS-1 and HS-4 | HS-1 chamfer claim, HS-4 chamfers |
| FP20 small corner radius | rounded rectangle, corner R0.3125, top loop 0.42 (R < d; verify-2 refuses `overflow`) | what Onshape does when the cone chamfer passes its apex | a later P1 package |
| FP21 meet boundaries | (a) bore near a straight edge, land 0.3, 0.42 (plane × cone ridge); (b) KS04 with land 0.05 | the conic ridge; behaviour when the ridge leaves a range | HS-3b, widening HS-3c |
| FP22 mixed corner, unequal radii | FP14 with concave R2 + convex R1, and concave R1 + convex R2 | major = r_c + r_v | HS-5 unequal radii |

The probes of fillet-plan §8 step 7 (setback mitres, pinched face) stay as
planned. "A finer volume query for FP08" is no longer needed: the mesh check
of §2.1 replaces it.

**RS reflex seam, P2.** A public reference model with unchanged account counters. A plate 30 wide with a backer 20 wide unioned onto its face (the shape
of R20 `edge.fs:807`); the concave seam ends at the plate face's reflex
corners. RS-F (R2) and RS-C (EQUAL_OFFSETS 2) build: volumes 6617.168146928204
and 6640 = input 6600 + L r²(1 − π/4) and + L d²/2 (L 20), 11 faces each (RS-F
10 planes and 1 cylinder), 27 edges, 18 vertices. The backer's end planes
are one face each, grown over the spandrel ends. Input and record:
`fixtures/fillet/reflex-setback.fs`, `fixtures/fillet/reflex-setback-reference.json`;
wonky builds it as the riser cap's concave dual (fillet-plan, "Fix: reflex
seams"). No STL was fetched: the volume equals the closed form to the
printed digits, and the face list fixes the topology.

**FP17-FP22.** Six public reference models with unchanged account counters. Each probe has its
input in `fixtures/fillet/fpNN.fs` (one parametric feature; the same file
runs in wonky) and its record in `fixtures/fillet/fpNN-reference.json`:
volume interval, face and edge types, the Onshape STL
(`fixtures/fillet/onshape/fpNN/`, triangles grouped per face), and wonky's
result next to Onshape's. The documents are kept; their ids are in the
records.

- **FP17 run.** All four build. Selection order matters: (a) removes
  13.573 mm³, (b) with the same 8 edges reversed 6.368. (a) and (d) keep
  both ranges at w (rim contacts 0.42 / 1.0 on wall and cradle, rim cone
  45°). (b) keeps 0.284413 on the wall and 0.288788 on the cradle, close to
  KS01's 0.28449 / 0.28886 (§2.2). The chamfer on the quartic pieces is 4
  faces of type "other". (c): the ellipse-rim chamfer is one "other" face,
  and Onshape's interval is wide (±0.12 %). Which edge is the reference was
  not read. wonky refuses (a, b, d) at the cradle Boolean and (c) as
  `unsupported-edge`.
- **FP18 run.** A third part added: the groove with its axis 5 below the
  top (a 60° knife) next to 5 above (120°). All build with plane chamfer
  faces. w is measured along the plane and as a **chord** on the cylinder
  (chord 1 to 5e-10 in all three, from the printed end points). The D-flat closed form with the chord
  reading, 5676.889051025038, equals Onshape's 5676.88905102504; the arc
  reading (5676.895979) is also inside Onshape's interval, so only the value
  and the contact points separate them. wonky: `not-implemented` (curved
  section setback).
- **FP19 run.** All three build. Regime i (c 0.5, d 0.6) keeps the short
  edge's face (12 planes); regime ii (d 0.9) and c 0.125 / d 0.42 consume
  it (11 planes). wonky: `blend-overlap` in all three.
- **FP20 run.** Two controls added (r = d = 0.42, r 0.5). r 0.3125 < d:
  Onshape refuses, `CHAMFER_FACE_RANGE_TOO_LARGE`. r = d builds, each
  corner cone ending in its apex (20 vertices instead of 24). wonky: r 0.3125
  `overflow`, r = d `undecidable`, r 0.5 builds to 2e-15.
- **FP21 run.** Both build. The plane × cone ridge of (a) is one `icurve`
  edge; KS04 with land 0.05 builds with 6 `icurve` edges (two ridges, four
  reflex-corner mitres). Whether a ridge left a range was not evaluated
  here. wonky: (a) `overflow`, (b) stops at `qContainsPoint` over a cone
  face (F-Q).
- **FP22 run.** Two sequential fillets (one opFillet takes one radius),
  plus the equal-radius control. All build a torus of major r_c + r_v, minor
  r_v (3/1, 3/2, 2/1), 12 faces. The control equals FP14's single fillet
  (4152.720349063199 against 4152.720349063201). wonky builds all three with
  the same surfaces and counts; its volume matches for R2/R1 (5e-16), and its
  volume integration returns a non-finite value for the other two.

## 6. Cross-owner follow-ups

Each is written as a patch under `tmp/fillet-prod/followups/` when its
package starts.

| id | owner | what |
|---|---|---|
| F-H1 | hybrid-robust | `kernel/hybrid/recover/{geom,main}.bend`: `case _:` typed refusal for the new `A.Curve` kinds; `src/hybrid.mjs`, `src/boolean.mjs`: named refusal (HS-2b, HS-3c) |
| F-C | owners of `kernel/{curve-plane,face-classification,cylinder-classification,face-bounds,face-plane,section,pierce,junction,intersections}.bend`, `kernel/ports/*`, `kernel/lang/wk/real.bend`, `kernel/step-cylinder-pcurves-geometry.bend`, and the JS consumers (`src/viewer/*`, `src/volume.mjs`, `src/analytic.mjs`, `src/curve-plane.mjs`, `src/curved-intersection.mjs`, `src/review-scene.mjs`, `src/lang/**`, `src/native/surface.json`) | support or named refusal for the new curve kinds |
| F-V | owner of `kernel/volume.bend` (not fillet-prod; compare F2 of step 1) | volume of faces bounded by conics (exact) and `RevolutionPair` (quadrature with a stated bound) |
| F-S | owner of `kernel/step-cylinder-pcurves.bend` | verify-3 C: ellipse-bounded cylinders in bodies with a torus or cone (strict STEP, P2) |
| F-Q | owner of `src/queries.mjs` (fillet-prod edited it in Regression reviews 1-2, but it is not in this workflow's list; confirm) | `qContainsPoint` over cone, torus and sphere faces; KS04's and every P4 "select after blend" case stop there |
| F-R20 | hybrid-robust (`scripts/r20/acceptance.mjs`) | KS09 and KS04 move from designed refusal to must-build when HS-2b / HS-3c land; KS07 is judged by the interval, which the gate already does. The pending `s5-r20-acceptance-ks.patch` needs this update |
| F-HY | hybrid-robust | KS01's cradle cut: arcs on through holes, then quartic edges (hybrid-boolean-plan step 9) |

## 7. What this plan does not claim

- **Nothing here is implemented or tested.** The packages are proposals.
  The measured statements are the mesh and closed-form checks of §1, run by
  the commands listed.
- **The closed forms are derivations (INFERRED).** They agree with Onshape's
  meshes to float32 precision and with OCCT on KS07 and FP14. Onshape's
  volume values agree only within their intervals, except FP14.
- **The KS01 range model rests on two sections of one mesh.** The
  conversion rule from w is unknown.
- **The face types of KS01's quartic chamfer pieces are derived, not
  measured.** The STL carries no face types.
- **No Onshape probe was run.** FP17-FP22 are proposals.
- **Package sizes are estimates.** They come from the step 2-5 stages, which
  each took one run.
