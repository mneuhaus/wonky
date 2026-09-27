# Dupin cyclide blends: Shene 1998 (two cones), Shene 2000 (offsets), Foufou & Garnier 2004 (between quadrics), Chandru-Dutta-Hoffmann (geometry)

- Kind: papers.
  - **Shene 1998**, "Blending two cones with Dupin cyclides", *CAGD* 15(7):643-673. Canonical https://www.sciencedirect.com/science/article/abs/pii/S0167839697000290 . Open author scan (31 pp.): https://pages.mtu.edu/~shene/PUBLICATIONS/1998/Cyclide-Cone-Blending.pdf (local `tmp/research/pdf/shene-1998-cyclide-cone-blending.pdf`; read pp. 1-15 and 22-29).
  - **Shene 2000**, "Do blending and offsetting commute for Dupin cyclides?", *CAGD* 17(9):891-910. Open preprint https://pages.mtu.edu/~shene/PUBLICATIONS/2000/blend.pdf (local `shene-2000-blend.pdf`; read §§1-3).
  - **Shene 1997**, "Blending with affine and projective Dupin cyclides", *Neural, Parallel & Scientific Computations* 5:121-152. Open scan https://cs.mtu.edu/~shene/PUBLICATIONS/1997/Cyclide-Affine-Proj-Blending.pdf (177 MB). Only the abstract and introduction were read, kept as local `shene-1997-affine-proj-blending-p1-2.pdf`.
  - **Foufou & Garnier 2004**, "Dupin cyclide blends between quadric surfaces for shape modeling", *Computer Graphics Forum* 23(3):321-330 (Eurographics 2004). https://onlinelibrary.wiley.com/doi/10.1111/j.1467-8659.2004.00763.x . Paywalled; only the abstract was read (via OpenAlex). Follow-up: Garnier, Barki, Foufou 2014, "Dupin cyclide blends between non-natural quadrics of revolution and concrete shape modeling applications", HAL record without file: https://ube.hal.science/hal-03545503v1
  - **Chandru, Dutta, Hoffmann**, "On the geometry of Dupin cyclides", *The Visual Computer* 5(5):277-290, 1989. https://link.springer.com/article/10.1007/BF01914786 . Open tech report CSD-TR-818 (1988): https://docs.lib.purdue.edu/cstech/697 (local `chandru-dutta-hoffmann-1989-dupin.pdf`).
  - Supporting open source for the rational Bézier form: Garnier, Druoton, Bécar, Fuchs, Morin 2021, "Subdivisions of ring Dupin cyclides using Bézier curves with mass points", *WSEAS Trans. Math.* 20. https://ube.hal.science/hal-03521704/document (local `garnier-2021-ring-cyclide-subdivision.pdf`).
- Authors and organizations: C.-K. Shene (Michigan Tech); S. Foufou and L. Garnier (Univ. de Bourgogne, Le2i); V. Chandru, D. Dutta, C. M. Hoffmann (Purdue). 1988-2004.
- License: journal copyright. Classical geometry (Dupin 1822, Maxwell 1868, Cayley 1873), free to re-derive. No code in any of them.
- Status: historical and niche. OpenAlex citations: Shene 1998 38, Chandru et al. 67, Foufou & Garnier 15. Research continues in the French school (Garnier, Druoton, Langevin; HAL 2011-2021) and in Laguerre-geometry form (Krasauskas; Dahl 2014).

## What it is

- A **Dupin cyclide** is a surface all of whose lines of curvature are circles (DOCUMENTED, Shene 1998 §2.1). It is the envelope of spheres in **two** different ways; each family of spheres has centers on a conic (the directrix conics: an ellipse and a hyperbola, confocal, in perpendicular planes). It is a quartic, or a cubic when one principal circle degenerates to a line. Torus, circular cylinder and circular cone are degenerate cases.
- **Cyclide blending** (Shene 1998, Definition 1): a cyclide Z blends two cones C_1 and C_2 iff Z is tangent to C_1 and C_2 along circles, and the two circles belong to the same family of lines of curvature of Z. Humbert's theorem makes this the only option: the common tangent curve of a cyclide and a quadric must be a line of curvature of the cyclide. So **the contact (trim) curves are always circles**, and on a cone they are the cross-section circles perpendicular to its axis.
- **The key fact for wonky:** a cyclide blend is **not** a constant-radius rolling-ball fillet, except when it is a torus (coaxial case). It is a **variable-radius** rolling-ball blend.
  - DOCUMENTED (Chandru-Dutta-Hoffmann TR p. 14): "if the cyclide is to be used for a variable radius rolling-ball blend of a cylinder and inclined-plane intersection … the extreme circles … represent the minimum and maximum diameter of the rolling ball".
  - DOCUMENTED (Shene 1998, Thm 16): "Two cones can be blended by a torus if and only if their axes are identical."
  - INFERRED consequence: the brief's claim that "the rolling-ball blend of cone/cone and cylinder/cylinder with intersecting axes is a cyclide" is wrong for constant-radius fillets. For the same configurations (a common inscribed sphere), the **constant-radius** rolling-ball blend is a **pipe surface around a conic spine**, which is rational but not a cyclide. Dahl & Krasauskas 2012 give it bidegree (6,2) (see `peternell-pottmann-computing-rational-parametrizations-of-ca.md`). A constant-radius canal surface with a conic spine is a cyclide only if the spine is a circle (a torus).

## How it works

### Cyclide equations (DOCUMENTED; the parametric form was verified numerically against the implicit form here)
- Implicit form (Pratt's, as quoted in Shene 2000 eq. 1): Z(a,c,μ): (x²+y²+z²−μ²+b²)² = 4(ax − cμ)² + 4b²y², with b² = a² − c², 0 ≤ c < a.
  - Longitudinal principal circles have centers (±a,0,0) and radii μ ∓ c.
  - Latitudinal principal circles have centers (±c,0,0) and radii a ∓ μ.
- Parametric form (standard; checked with random (u,v), max relative residual 1e-15 against the implicit form above):
  - x = [μ(c − a cos u cos v) + b² cos u] / (a − c cos u cos v)
  - y = b sin u (a − μ cos v) / (a − c cos u cos v)
  - z = b sin v (c cos u − μ) / (a − c cos u cos v)
  - Torus check: c = 0 gives major radius a and minor radius μ.
- Rational form: with cos = (1−s²)/(1+s²) and sin = 2s/(1+s²), all homogeneous coordinates become bidegree (2,2) polynomials. Cyclide patches are **rational biquadratic Bézier surfaces**, and "four patches are necessary to model the whole cyclide" (DOCUMENTED, Garnier et al. 2021 §1).
- **Offsets are cyclides** (DOCUMENTED, Shene 2000 Lemma 1): Z(a,c,μ_2) is the (μ_2 − μ_1)-offset of Z(a,c,μ_1). Two cyclides are offsets of each other iff they share a and c (the same directrix conics). Chandru et al. property P7 says the same for the Maxwell (f, a, r) form. The type depends on μ: 2S for μ < −a, 1S at −a, ring R for (−a,−c), singly horned SH at −c, doubly horned DH for (−c,c), then symmetric.
- Classical constructions (DOCUMENTED, Chandru et al. §5):
  - **Maxwell's**: from the anticonic ellipse and hyperbola, point R on segment PQ with QR = r − a sec β, or PR = r − f cos α, traces the circles.
  - **Cayley's**: from two extreme (principal) circles on a symmetry plane and a center of similitude, draw circles on diameters cut by lines through that center.
  - Maxwell's implicit form: (x²+y²+z²−r²)² − 2(x²+r²)(f²+a²) − 2(y²−z²)(a²−f²) + 8afrx + (a²−f²)² = 0.

### Existence condition and construction for two cones (Shene 1998)
- Notation: C(V, ℓ, α) is the cone with vertex V, axis ℓ and half-angle α.
- **Necessary and sufficient condition** (§1, §6-8): apart from one exception, two cones have a blending cyclide **iff they have planar intersection** (their intersection splits into conics or lines). The exception is a double line with parallel axes, which has no blending cyclide (Lemma 19). For distinct axes and vertices, planar intersection ⇔ **a common inscribed sphere** if the axes intersect, or **equal cone angles** if the axes are parallel. See also Shene & Johnstone 1994 in `shene-johnstone-1994-on-the-lower-degree-intersections-of-tw.md`.
- Lemmas 3/4: a cone tangent to a cyclide along a circle has its axis in a symmetry plane of the cyclide. So **blendable cones have coplanar axes**. The plane of the axes (the "axial plane") cuts both cones in two pairs of lines, the **skeletal quadrilateral**; its two diagonals not through a vertex lie in the planes of the intersection conics.
- **Construction algorithm** (§4.2, Fig. 5), for cones C_1(V_1,ℓ_1,α_1) and C_2(V_2,ℓ_2,α_2):
  1. Let d = RS be a diagonal with diagonal points R, S. Choose a point X on d. This is the one free parameter.
  2. From X drop a perpendicular to ℓ_1 meeting lines V_1R and V_1S at A and B.
  3. From X drop a perpendicular to ℓ_2 meeting V_2R and V_2S at C and D.
  4. There is a circle Z_1 tangent to V_1R and V_2R at A and C, and a circle Z_2 tangent to V_1S and V_2S at B and D. These are the two principal circles in the axial plane.
  5. C_1 is the circle of cone 1 in the plane through AB perpendicular to ℓ_1; C_2 likewise through CD. The unique cyclide with principal circles Z_1 and Z_2 is tangent to the cones along C_1 and C_2 (Specification Lemma 11 for quartic cyclides, Lemma 13 for cubic).
- **Completeness** (Lemma 34): every blending cyclide arises this way. All blends form 1 to 4 one-parameter families, one per diagonal, and each family contains infinitely many **ring** (singularity-free) cyclides (§9). Table 1 gives the family count by configuration:
  - identical axes: 3-4 families;
  - common vertex: 2-4;
  - distinct vertices with a double line: 1 if the axes intersect, 0 if parallel;
  - no double line: 2 if the axes intersect, 1 if parallel.
- Degenerate member: choosing X at the concurrency point X' gives the common inscribed sphere itself (Remark 32). Choosing X = R or S gives a horned or spindle cyclide.
- Cubic cyclides occur iff the two cones share a double line (Lemma 18).
- **The offset shortcut is unsafe** (Shene 2000). Offset both cones by −r so they share a vertex, blend there, then offset back ("the offset construction", used by Boehm, Pratt, Allen & Dutta). This commutes only for ε = −r with a properly chosen pair of principal circles. For half-cones some blends cannot be reached at all. Shene's "diagonal construction" above is the complete and reliable one.
- **Beyond cones is finite and rare** (DOCUMENTED, Shene 1997 intro): "there exists only finite number of blending Dupin cyclides for the cases of cone-torus, torus-torus, and Dupin cyclide-Dupin cyclide". Shene 1998 §10 shows that for general quadrics of revolution a common inscribed sphere does **not** guarantee a blend (ellipsoid/cylinder counterexample). Affine and projective cyclides (Shene 1997) extend this to plane/quadric-cone blends along an ellipse or other conic.

### Foufou & Garnier 2004 (abstract only, DOCUMENTED via OpenAlex)
- A Dupin cyclide is fully characterized by its principal circles. They construct **principal circles tangent to both quadrics** to get a G1 blend.
- The circles are rational quadratic Bézier curves, so each circle is 3 control points.
- Blending primitives A and B is split into two operations, A-cylinder and cylinder-B. The result is two cyclides and a (usually degenerate) cylinder per blend. Demo: the Eurographics'04 "Hugo" figure built from quadrics and cyclide blends. This is a **shape-design** (joining) tool, not an edge-fillet operator.

## Robustness and guarantees

- Shene's results are **proved theorems** (existence, characterization, completeness) under exact geometry. The constructions are ruler-and-compass: line intersections, perpendicular feet, and circles tangent to two lines at given points. The numerics are a handful of linear solves and square roots, with no iteration.
- Degeneracies are explicit in the theory: double lines, parallel axes, common vertex, identical axes, and singular (horned or spindle) members. An implementation can fail explicitly on each.
- Only G1: "Definition 1 only defines a C1 (i.e., tangent continuous) blend" (Shene 1998 §3.1). G2 needs other surfaces.
- Singularity-free choice: each family contains infinitely many ring cyclides (§9). The designer, or a heuristic, must pick X so that the chosen patch has no singular point.

## Parallelism and performance

- No measurements in any of the papers. INFERRED: construction is O(1) closed-form geometry per blend. Evaluation is a rational biquadratic patch: uniform work, trivially GPU-friendly. A point-in or point-on test is one quartic polynomial evaluation.

## Known failures, limitations, war stories

- Pratt pointed out that offsets of some blending cyclides of the offset cones do not blend the original cones (DOCUMENTED, Shene 2000 §1). A published shortcut that fails silently is a good warning for any "offset the problem, solve, offset back" trick in wonky.
- Some real configurations are impossible with one cyclide: "the Cranfield object (Pratt, 1990) is now provably impossible to be blended with a single piece of Dupin cyclide". Boehm needed two cyclide patches and planes (DOCUMENTED, Shene 1998 §3.1).
- Fixing both contact circles overdetermines the problem (Shene 1998 Remark 15). Only one circle and the family parameter are free, so the designer cannot pick both trim lines. This is a UX mismatch with fillet semantics, where the radius is the input.

## Relevance for wonky

- **Not a replacement for opFillet.** FeatureScript `opFillet` with a constant radius means a rolling ball of that radius (Onshape and Parasolid semantics, see `onshape-help-fillet-and-face-blend.md`). A cyclide blend has variable ball radius and circular trims, so it gives **different geometry**. Using it for opFillet would break parity with Onshape (INFERRED). For constant-radius fillets of the same configurations, use the exact pipe-around-conic blends of Dahl & Krasauskas.
- **Where cyclides do fit:**
  1. **Exact torus tier (now).** The torus is the degenerate cyclide, and Shene's Thm 16 confirms coaxial cones (including planes as cones of half-angle 90° and cylinders) are exactly the torus-blend cases. That is the plane/cylinder cap-edge fillet wonky needs first.
  2. **An explicit "transition" or "elbow" feature (later).** Joining two cones or cylinders with coplanar, intersecting axes (hose adapters, nozzles, bent ducts: Shene 1998 Plates 6-8) with circular trims and one exact rational biquadratic surface. It is useful for FDM parts and exports exactly to STEP as a rational B-spline surface.
  3. **Corner blends.** Dahl 2014 uses a cyclide patch to blend a single edge blend against the opposing face at a heterogeneous corner (DOCUMENTED, thesis p. 10).
  4. **Offset/shell closure.** Cyclides are offset-closed (μ ↦ μ + d), so a shell or thicken of a body containing cyclide faces stays exact. This is the same property natural quadrics and tori have.
- **Bend fit.**
  - Construction: about 20 F32x2 operations (line intersections, one circle-tangent-to-two-lines solve per principal circle). No iteration. Fork-join is irrelevant at this size.
  - Evaluation: rational biquadratic tensor patches. Uniform per-sample de Casteljau in homogeneous coordinates, ideal for GPU call trees.
  - Exact predicates: point classification by the sign of the quartic implicit F(x,y,z) in the cyclide frame. With inputs quantized to integer grid coordinates and (a, c, μ) rational, the sign is an exact multi-limb integer computation of degree 4. The frame rotation must be rational (e.g., a Cayley or rational-angle rotation) or handled with filtered evaluation plus exact fallback (INFERRED).
  - SSI with other faces: a cyclide/plane intersection is a quartic in general, but planes through an axis or perpendicular to a symmetry plane give circle pairs (Villarceau-like). Plane/cyclide in general needs the Boolean's curved-face path. That is a real cost of adding the type.
- **Priority:** below the torus and sphere, and below the conic-spine pipe blends that serve actual constant-radius fillets. Add the cyclide type only when a transition or elbow feature is on the roadmap.

## Pointers worth porting or studying

- Shene 1998 §4.2 construction algorithm and Lemma 11 (specification lemma); Table 1 (family counts); §9 (choosing ring cyclides).
- Shene 2000 eq. 1 plus Lemma 1: one parametrized family Z(a,c,μ) covers a cyclide and all its offsets. Store (frame, a, c, μ) as the surface record; offset = μ + d.
- Chandru-Dutta-Hoffmann §5 (Maxwell and Cayley constructions), §6 properties P5-P9 (planes of circles, rationality, offsets, inversion).
- Garnier et al. 2021 for the rational biquadratic subdivision (mass points, conics in Minkowski-Lorentz space). This is the path to exact NURBS export and to splitting patches at arbitrary circles.
- Dahl 2014 thesis p. 8-10: a cyclide is a pseudo-Euclidean circle in R^{3,1}. This unifies cyclides with the canal-surface machinery in the Peternell-Pottmann note.

## Verdict: learn-from (adapt later for a transition or elbow feature; keep only the torus special case now)

The theory is complete, closed-form and exact, which fits wonky's ethos well. Cyclide blends are variable-radius with circular trims, so they cannot implement constant-radius `opFillet` without breaking Onshape parity. The immediately usable parts are the torus-blend characterization (coaxial only) and offset closure. A full cyclide surface type is justified only by a dedicated transition feature.
