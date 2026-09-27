# ESOLID: exact boundary evaluation for low-degree curved solids

- **Kind:** research system plus papers. There is no maintained code.
- **Project page:** http://gamma.cs.unc.edu/ESOLID/
- **Journal paper:** Keyser, Culver, Foskey, Krishnan, Manocha, "ESOLID - A System for Exact Boundary Evaluation", Computer-Aided Design 36(2), 2004. Preprint dated 2003-09-02: http://gamma-web.iacs.umd.edu/papers/documents/articles/2003/keyser03b.pdf
- **Conference version:** ACM Solid Modeling 2002, pp. 23-34. http://gamma.cs.unc.edu/ESOLID/keyser02.pdf
- **Foundations:**
  - MAPC. Keyser, Culver, Manocha, Krishnan, CAD 32(12):649-662, 2000, and SoCG 1999. Tech report TR98-038: ftp://ftp.cs.unc.edu/pub/users/geom/papers/INTERSECT/98-038.pdf
  - Keyser, Krishnan, Manocha, CAGD 16(9), 1999, parts I (representations, pp. 841-859) and II (computation, pp. 861-882).
- **Code:** an unofficial GitHub mirror of the Texas A&M release "ESOLID Version 0.3" (GMP and CLAPACK, g++ 4.1, Fedora Core 5) is at https://github.com/kanzure/esolid. The mirror was created and last pushed 2013-04-14; it has 4 stars and about 39k lines of C++.
  - Its `url.txt` lists the original release URLs, which are now dead: research.cs.tamu.edu/keyser/geom/esolid/releases/version_0.1 to 0.3. Shallow clone: tmp/research/esolid/.
- **License:** none. The repo has no LICENSE file and no copyright or license header anywhere (DOCUMENTED: grep of the clone). Legally that means all rights reserved.
  - Porting implication: read the code for understanding, re-derive from the papers, copy nothing.
- **Status:** dead since the mid-2000s. The UNC page only lists papers; the TAMU download pages are gone (DOCUMENTED by fetching both pages on 2026-09-22).

## What it is

ESOLID is the canonical "exact computation paradigm" B-rep Boolean system for curved solids.

- **Input:** CSG trees of low-degree primitives (polyhedra, cylinders, cones, ellipsoids, tori), with rational 4x4 transforms.
- **Output:** the B-rep of the result. No numerical decision is ever wrong.
- **Target set by the authors:** at most two orders of magnitude slower than their earlier floating-point system BOOLE.
- **Validation data:** real parts from the BRL-CAD Bradley Fighting Vehicle model.
- Everything is rational arithmetic: LiDIA in the paper, GMP in v0.3. Algebraic numbers are isolating intervals that get refined on demand.

(DOCUMENTED: project page; journal sections 1, 3.1.)

## How it works

**Representation** (journal section 3.1 "Architecture" and 4.1; v0.3 `include/kpatch.h`, `ksurf.h`, `kcurve.h`, `kpoint2d.h`)

- `K_SURF` stores both forms of a surface:
  - the rational parametric form X/W, Y/W, Z/W, with polynomials over Q;
  - the implicit form, one polynomial over Q.
- `K_PATCH` is a surface plus:
  - a rational (s,t) domain box;
  - trimming curves and intersection curves;
  - parallel arrays of the adjacent surfaces and patches for each curve.

  Every curve on a patch knows which other patch it came from (DOCUMENTED: `kpatch.h` lines 26-50).
- **Curves are never parameterized.** A trim or intersection curve is an implicit algebraic plane curve f(s,t)=0 in the patch domain, cut into segments. Each segment runs between two `K_POINT2D` endpoints.
- A `K_POINT2D` is an algebraic point: a rational 2D box guaranteed to contain exactly one intersection of two given plane curves, refined lazily (DOCUMENTED: MAPC paper; journal section 4.1).
- **Associations** tie together the "same" 3D point or curve as seen from different patch domains, without ever computing 3D coordinates. This is the topological glue.
- **One-to-one restriction:** every patch must map one-to-one over its domain. Primitives are split so this holds. For example, a cylinder side is split into pieces and the caps are ellipses whose trim curves all use the polynomial s^2 - s + t^2 - t + 1/4 (DOCUMENTED: journal sections 3.3 and 4.2; v0.3 `src/gencyl.cc` comments at lines 56-110).

**Boundary evaluation** (journal section 3.2; details in 4.2 "Transferring Data Between Patches")

- **Stage 1, per pair of patches:**
  1. **Intersection curve.** Substitute the parametric form of patch A into the implicit form of patch B. This gives a plane algebraic curve in A's (s,t) domain, and symmetrically one in B's.
  2. **Curve topology.** Find turning points and singular points by solving f = f_s = 0 or f = f_t = 0 with resultants and Sturm sequences. Cut the curve into monotone segments.
  3. Intersect with A's trimming curves (2D curve-curve intersection).
  4. **Point inversion.** Find where an intersection point on A lies in B's domain. It is reduced from a 4D problem to a 2D curve-curve intersection in B's domain, plus matching of isolating intervals in 3D.
  5. **Curve correspondence.** Match curve pieces in A with their partners in B using the already inverted points, with 2-3 points per curve. There is no marching or tracing.
  6. Clip the curve to the portion inside both patches.
- **Stage 2, per patch:**
  1. Merge all intersection curves on the patch.
  2. Partition the patch into subpatches along them (`K_PARTITION`).
  3. Classify one sample point per subpatch as inside or outside the other solid by ray shooting. Propagate the classification to neighbours through the topology (`K_GRAPH`).
  4. Select the subpatches the Boolean op needs and assemble the result `K_SOLID`.

**Speedup layers** (journal section 5; this is the most reusable engineering content)

- **Root isolation for simple roots:** sign tests at interval endpoints, first through a floating-point filter and only then exactly.
  - v0.3 `src/fpfilter.cc` shows the filter. `horner_with_err` evaluates the polynomial by Horner's rule, then evaluates the absolute-value polynomial with rounding towards +infinity to get a running error bound. `sign_given_err` returns 0, meaning "don't know", when |value| is at most the error bound (DOCUMENTED: code lines 130-209).
- **Otherwise:** a Sturm sequence, cascading from the floating-point filter to PRECISE (Aberth-Schaefer arbitrary-precision range arithmetic) to exact rationals.
- **Floating-point guided computation:** compute a candidate root with floating-point Newton plus bisection (`newton_for_pseudoroot`), then certify it with a Sturm count on a tiny rational interval around it.
- **Lazy evaluation:** refine an interval only until the current decision is certain.
- **Cheap rejection:** bounding boxes and affine arithmetic.
- Qualitative tags make equality tests cheap, for example "this point is known to be the same point as that one".
- Special-case code for horizontal and vertical curves.
- **Speedups interact.** Lazy evaluation wants intervals to stay wide; guided computation shrinks them. The combination had to be tuned by testing (DOCUMENTED: journal sections 5.2-5.3 and 7.2).

## Robustness and guarantees

- **Guaranteed:** every sign, comparison and topological decision is exact for non-degenerate input.
  - BOOLE (double precision with tolerances) failed on 5 of the 9 Bradley parts in Table 2.
  - Its failures were "curves did not close" on a near-tangent case, and a false singularity error on two nearly degenerate cylinders whose intersection curve has two components (DOCUMENTED: journal section 6).
- **Not guaranteed: degeneracies.** "ESOLID input is restricted to non-degenerate configurations... Many real-world examples (including several from the Bradley Fighting Vehicle) contain numerous degeneracies. ESOLID cannot be considered a robust system" (DOCUMENTED: journal section 3.3 "Input Considerations").
  - Unsupported cases include tangent surfaces, overlapping or coincident faces, and singular intersection curves.
- **Workaround in the code:** a `perturb_factor` offsets primitives outward or inward before the Boolean:
  - union: both outward;
  - intersection: both inward;
  - difference: A outward, B inward.

  The default is 0. The values 1/512 and 1/1024 are commented out in `main/esolid_main.cc` lines 38-64 (DOCUMENTED). It is symbolic "make the degeneracy go away" by moving the input, which is only safe at the input stage (journal: "As long as such interpretation is made only at the original input stage... consistency... is maintained").
- **Precision actually needed** (journal section 6.3, Tables 1, 3, 4):
  - 41-87 bits on the synthetic and Bradley cases;
  - 20-141 bits for two barely interpenetrating cylinders as the interpenetration shrinks.

  This is DOCUMENTED, and it is the key number for wonky. F32x2 (about 48 bits) covers the easy half; the near-tangent cylinder cases need 3-5 U32 limbs or more.

## Parallelism and performance

- All numbers are on a 300 MHz MIPS R12000, single-threaded.
- **Table 1 (synthetic differences):** from 0.39 s (box-box) to 49.41 s (ellipsoid-cylinder), with up to 2,248 roots isolated.
- **Table 2 (Bradley parts):**
  - ESOLID without PRECISE: 10.23-633.42 s.
  - ESOLID with PRECISE: 10.95-137.64 s.
  - BOOLE: 2.23-27.74 s, with 5 of 9 failed.
  - Overall: under 10x slower than BOOLE with PRECISE, and under 100x in the worst case.
- **Table 3:** 54-98% of the time goes into 2D curve-curve intersection, which is resultants plus Sturm root isolation.
- **Table 4:** the near-tangent cylinder series grows from 8.6 s to 446 s.
- There is no parallelism in the system. The structure is naturally a map over patch pairs (stage 1) and a map over patches (stage 2), with one global merge (INFERRED).
- Inside, the numeric kernels are scalar, branchy and data-dependent: Sturm chains, subresultants, interval bisection to varying depth. They are poor candidates for uniform GPU work (INFERRED).

## Known failures, limitations, war stories

- **Degeneracies:** see above. It is the authors' own headline limitation.
- **Degree wall:** "only low-degree (algebraic degree four or less) surfaces are practical - higher degree surfaces (such as bicubic patches) tend to take unreasonable amounts of time and memory". Most NURBS have too high an implicit degree (DOCUMENTED: journal sections 3 and 3.3).
- **Memory:** "several megabytes on simple problems" in 2003 terms. Missing reference counting and the choice to store intermediate results early made later memory fixes hard. The authors recommend designing memory use up front (DOCUMENTED: journal section 7.2).
- **Testing:** "exact computations are just as prone (if not more so) to programming errors as inexact ones". They used a computer algebra system as the test oracle (DOCUMENTED).
- **Point equality is the expensive primitive:** two algebraic points produced along different routes must be proven equal, and the design has to avoid needing that (DOCUMENTED: journal section 7.2).
- **Output:** exact only as text in ESOLID's own format. For downstream use it is exported as approximate trimmed Bezier patches (`Bezier_output` in v0.3). There is no exact interchange (DOCUMENTED).
- **Upside:** redundant data such as plane equations plus vertices becomes safe once arithmetic is exact (DOCUMENTED: journal section 7.2).

## Relevance for wonky

Wonky's exact analytic B-rep uses plane, cylinder and cone, which is exactly ESOLID's sweet spot and actually easier.

- **Low degrees.**
  - Plane against quadric gives a conic in the patch domain.
  - Quadric against quadric gives a degree-4 space curve. Its image in a rationally parameterized (u,v) domain is a low-degree plane curve.
  - Resultants stay small, far below ESOLID's ellipsoid and torus cases (INFERRED).
- **Layered-filter cascade.** Map ESOLID's three layers onto Bend as follows:
  1. An F32x2 value with a running error bound, the `horner_with_err` style. Bend has no rounding-mode control, so the bound must be a static or running error bound rather than directed rounding (INFERRED).
  2. Multi-limb U32 big integers after scaling rationals to a common denominator, as the exact tier.
  3. Skip PRECISE. A middle tier of about 96-128-bit fixed-limb integer or interval arithmetic plays its role.
- **Bit budget.** Table 4 is a direct warning for the plane/cylinder union blocker: near-tangent cylinders need up to 141 bits. Size the limb count from worst-case resultant bit growth, not from typical cases (DOCUMENTED numbers, INFERRED mapping).
- **Architecture to borrow for the "recover" or analytic Boolean path.**
  - Keep intersection curves as implicit curves in each face's (u,v) domain.
  - Store segment endpoints as isolating boxes.
  - Glue across faces by explicit associations (edge identity), not by 3D proximity.
  - Classify one sample per region and propagate through adjacency.

  All four are pure functions over immutable arrays: stage 1 is a fork-join map over face pairs, stage 2 a map over faces. That fits Bend well (INFERRED).
- **Point inversion and curve correspondence without tracing.** No marching means no step-size heuristics. It is a good fit for a no-mutation language (INFERRED).
- **Degeneracy policy.** ESOLID confirms that exactness alone does not solve coplanar, coaxial and tangent cases, which dominate real FDM parts: flush faces, coaxial holes, tangent fillets.
  - Wonky must handle these explicitly as special cases, as it already does with its analytic special-case Booleans, or raise a capability error.
  - The symbolic perturbation trick (union outward, difference B inward) is a cheap fallback for the mesh or tagged path, but it changes geometry. Use it only at input, with a flag (INFERRED).
- **Memory.** Immutable Bend arrays plus big-integer coefficients amplify ESOLID's memory problem. Keep exact data lazy, meaning compute bits only on filter failure, and never store fully expanded resultants per face pair (INFERRED).

## Pointers worth porting or studying

- Journal section 4.2 "Transferring Data Between Patches": point inversion reduced to 2D curve-curve intersection plus 3D interval matching, and curve correspondence from inverted points.
- Journal section 5.2 "Layering Speedups" (filter, then PRECISE, then exact Sturm), and Table 3 for where the time really goes.
- v0.3 `src/fpfilter.cc` (`horner_with_err`, `sign_given_err`, `newton_for_pseudoroot`): about 250 lines. It is the pattern for "floating-point guess, then exact certify". Re-implement it; do not copy, since there is no license.
- v0.3 `src/kpoint1d.cc` (Sturm-based root isolation and refinement) and `src/kpoint2d.cc` (2D algebraic points): read them for structure only.
- v0.3 `src/gencyl.cc`: how a cylinder is cut into one-to-one rational patches, and how perturbation is applied.
- MAPC paper (TR98-038) for the K_POINT and K_CURVE abstractions.
- Rouillier-Zimmermann root isolation (Descartes and Bernstein, cited in the journal as a future speedup) is a better fit than Sturm for fixed-limb integers.

## Verdict: learn-from

- Do not port it: the system is dead and unlicensed, targets general low-degree algebraic surfaces, and refuses degeneracies.
- Do adopt its architecture lessons and the three-tier numeric cascade for any exact analytic plane/cylinder/cone Boolean or B-rep recovery step:
  - implicit curves in (u,v);
  - association-based edge identity;
  - classify-and-propagate;
  - filter, then guided exact certification.
- Size wonky's limb counts from Table 4 (up to 141 bits for near-tangent cylinders).
