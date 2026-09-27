# QI: exact quadric intersection library (LORIA VEGAS / Gamble)

- Kind: C++ research library plus a web parameterization server. Canonical project page: https://gamble.loria.fr/qi/
  - Download page: https://gamble.loria.fr/qi/new_server/download.html
  - Online server form: https://gamble.loria.fr/qi/server/ (posts to `qi.php`)
  - Licence text: https://gamble.loria.fr/qi/distrib/QI/COPYING (local copy tmp/research/qi/COPYING, Latin-1)
- Paper: S. Lazard, L. M. Peñaranda, S. Petitjean, "Intersecting quadrics: an efficient and exact implementation", Computational Geometry: Theory and Applications 35(1-2):74-99, 2006.
  - DOI: https://doi.org/10.1016/j.comgeo.2005.10.004
  - Open copy: https://inria.hal.science/inria-00000380 (read in full; local tmp/research/pdf/lazard2006-qi-cgta.pdf/.txt). A preliminary version appeared at SoCG 2004.
- Authors/org:
  - Designers named in COPYING: Sylvain Petitjean (CNRS), Sylvain Lazard (INRIA Lorraine), Laurent Dupont (Nancy 1), Daniel Lazard (Paris 6) and Guillaume Hanrot (INRIA). Implementation mostly by Luis Peñaranda (DOCUMENTED, https://gamble.loria.fr/qi/distrib/QI/COPYING and the paper).
  - Owners: INRIA, CNRS, Université Nancy 1 and Université Paris 6. APP registration IDDN.FR.001.430028.000.R.P.2004.000.10000 (DOCUMENTED, COPYING).
- License: proprietary, non-commercial (DOCUMENTED, COPYING).
  - "QI version 1.0 of June 2004". The owners "freely grant the right to use the Software for non-commercial purposes".
  - Any commercial use requires prior express authorization.
  - Reproduction or modification is allowed only within the limits of the Berne-convention exceptions quoted in the file (clauses 9/10).
  - The bundled Uspensky root solver is LGPL (DOCUMENTED, noted in the distribution; earlier session reading of the QI distribution notes).
  - **Implication for wonky: no code may be ported or translated.** The algorithm is published (Dupont et al. 2008) and can be re-implemented from the papers. QI output could be used as a test oracle if run locally for research only; re-check the "non-commercial" wording before shipping any derived fixtures (INFERRED).
- Status: dormant.
  - First release 2004-06-02; last release 0.9.0 on 2007-01-09 (DOCUMENTED, download page).
  - Requires GMP ≥ 4.2 and LiDIA ≥ 2.2.0. The page warns "LiDIA may not compile easily on Windows and Mac OS X, and may not work at all on 64 bits architecture" and says a next release without LiDIA is being worked on. No such release exists (INFERRED from the page, unchanged since 2007).
  - Tarballs were hosted on INRIA gforge (https://gforge.inria.fr/frs/?group_id=498), which returns 403. INRIA shut gforge down (INFERRED). `/qi/distrib/` returns 403 and guessed tarball names return 404 (DOCUMENTED, curl 2026-09-22).
  - No GitHub or other public mirror was found (`gh search repos/code`, 2026-09-22). The only name-alike, Canjia-Huang/simple-quadrics-intersection (MIT, 1 star, last push 2025-01-02), only handles equal-radius plane/cylinder/sphere cases and is unrelated.
  - Re-checked 2026-09-24 (DOCUMENTED):
    - The Wayback CDX index holds no `gforge.inria.fr/frs/download.php/*` QI tarball and no `www.loria.fr/equipes/vegas/qi*` archive. Its only `gamble.loria.fr/qi/distrib/` capture is `QI/COPYING` (2025-06-25).
    - Software Heritage origin search ("quadric intersection", "libqi", "gforge.inria.fr/qi") finds only unrelated projects, e.g. spbu-math-cs/Quadric-Intersection, AISTATS 2022 manifold learning.
    - `gh search repos "quadric intersection"` adds only visualisers and student projects: AleksMa/InterSect, dpoloqb/quadric_intersection, and enriqueartal/SingularQuadricIntersections (GPL-3, computational checks of singular quadric intersections).
    - So the QI source is effectively lost to the public.
  - **The online server is alive and computes (DOCUMENTED, probed 2026-09-23 and again 2026-09-24).**
    - Send `POST https://gamble.loria.fr/qi/server/qi.php` with form fields `q1`, `q2` (polynomials in x, y, z, w with integer coefficients), `noise=0` and `launch=Launch`.
    - It returns the real and complex type, one exact parameterization per component, and an OPTIMAL or NEAR-OPTIMAL flag, reporting "CPU Time: 0 ms".
    - The trailing "error occured when communicating with the QI database server" only affects the server's logging, not the result.
    - Raw outputs of seven cylinder/cone probes are saved in `tmp/research/qi/server-probes-2026-09-23.txt` (see the table under "Relevance for wonky").
  - Known users listed on the site (HEARSAY): Imperial College photochemistry modelling, spacecraft thermal analysis, IRIT catadioptric camera calibration.

## What it is

The first complete, exact and efficient implementation of parameterizing the intersection of two implicit quadrics with integer coefficients of arbitrary size (DOCUMENTED, abstract, https://inria.hal.science/inria-00000380). It implements the Dupont/Lazard/Lazard/Petitjean algorithm; see [dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz.md](dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz.md).

- Output: for each component of the intersection in P³(R), its real type and an exact parameterization with coefficients in Z[√δ], possibly times √Δ(ξ), plus the domain of real parameter values.

## How it works

(DOCUMENTED, paper §6, https://inria.hal.science/inria-00000380)

- **Code size: more than 17,000 lines of C++ on LiDIA with GMP bigints:**
  - Data structures: 1,500 lines.
  - Elementary operations: 2,000 lines. Inertia, determinantal equation, gcd of the derivatives of D, adjoint, singular space, intersection of linear spaces, Descartes' rule, Gauss decomposition, and Uspensky root isolation.
  - Number theory and simplification: 1,500 lines. Content/gcd reduction of vectors and matrices, and reparameterizing lines to small height.
  - Quadric parameterizations: 2,000 lines. (2,2) quadrics through a rational point, cones, conics, pairs of planes.
  - Intersection parameterizations: 9,000 lines. D with no multiple root 1,500; one multiple root 3,000; two multiple roots 1,500; D ≡ 0 3,000.
  - Printing and debugging: 1,000 lines. This includes a DEBUG mode that checks computed parameterizations.
- **Three variants:**
  - Unsimplified.
  - Mildly simplified: early gcds on D's coefficients and roots, singular and rational points.
  - Strongly simplified: additionally extracts square factors of bigints (√(ab²) → b√a) by trial factoring, and gcd-simplifies the final parameterizations.
  - A fourth variant using full integer factoring was not worthwhile: for small inputs trial division already finds the factors, and for large inputs factoring is too expensive (§6.2).
- **Random typed test generation** (§6.3):
  - Smooth quartics come from random coefficients, which gives a smooth quartic or empty with probability 1.
  - Every other type starts from a canonical pair (S, T) of that type. Apply `S′ = Pᵀ(r1 S + r2 T)P`, `T′ = Pᵀ(r3 S + r4 T)P` with r1r4 − r2r3 ≠ 0 and a random integer projective P.
  - Caveat from the authors: this does not sample integer quadric pairs uniformly. E.g. the pairs (x²−w², xy+z²) and (x²−2w², xy+z²) have the same type but cannot be mapped to each other by a rational P.

## Robustness and guarantees

- **Exact:** bigints throughout, and the type is decided with rational arithmetic only (DOCUMENTED, §1 and §6).
- **Complete:** all real types, including D ≡ 0 (36 of the 120 test pairs had a vanishing determinantal equation) (DOCUMENTED, §7.1).
- **Output height** (Table 1, §5). Asymptotic output height relative to input height h:

  | Case | Height |
  |---|---|
  | Smooth quartic | 38 + 50hp |
  | Nodal quartic | 22 |
  | Cuspidal quartic | 38 |
  | Cubic and secant line | 22 / 9 |
  | Two tangent conics | 20 + 16 |
  | Two double lines | 12 |

  Experiments with inputs up to 10,000 digits saw a limit of 36, not 38, when gcds are performed. The authors had "no explanation" for the gap (DOCUMENTED, §4).
- **Correctness checking:** the DEBUG mode verifies that computed parameterizations lie on both quadrics (DOCUMENTED, §6.1).
- **Floating-point input:** QI takes integers only. Floats must be scaled, which the authors call trivial (§1). Floating-point filters were future work, and "many classes and data structures have already been templated for a future use with floating point coefficients" (DOCUMENTED, §9 conclusion). A CGAL port was also planned; no evidence either was released (INFERRED).

## Parallelism and performance

(DOCUMENTED, §7, 2.6 GHz Pentium 4, https://inria.hal.science/inria-00000380)

- **Smooth quartics:** 10-digit coefficients in under 50 ms; 400 digits in about 1 s; 1,000 digits in about 5 s on average.
- **Coefficient size is the main cost driver:** "values of 10⁵ and higher have a dramatic impact on computation time while all values less than 10⁴ are acceptable".
- **120 pairs covering all types:** about 0.6 s per intersection at large input sizes, versus 1.7 s for smooth quartics of the same size. Degenerate cases are faster.
- **Memory:** under 64 KB total allocations for input size ≤ 20; about 1 MB only above 700-digit inputs.
- **Real CSG data (SGDL), strongly simplified variant:**

  | Scene | Quadrics | Pairs | Time | Per pair | Components | Max output height |
  |---|---|---|---|---|---|---|
  | Teapot | 18 | 153 | 450 ms | 2.9 ms | 51 smooth quartics, 31 nodal, 35 cuspidal, 65 conics, 101 lines, 9 points | 6 |
  | Pencil box | 61 | 1,830 | 6.25 s | 3.4 ms | 65 smooth, 356 nodal, 119 cubics, 612 conics, 2,797 lines, 139 points | 11 |
  | Chess set | per piece | 971 | 3.33 s | 3.4 ms | ... | 8 |

- **Parallelism:** single-threaded. Pairs are independent, so a per-pair map is trivially parallel (INFERRED).

## Known failures, limitations, war stories

- **Dead dependency:** LiDIA is unmaintained and may not work on 64-bit (DOCUMENTED, download page). The code cannot be obtained from any public source any more (DOCUMENTED, 403/404 checks 2026-09-22).
- **Non-commercial licence** blocks any code reuse in wonky (DOCUMENTED, COPYING).
- **Heights and trimming:**
  - Observed heights deviate from the predicted ones, and the authors do not understand why (DOCUMENTED, §4 and §9).
  - QI handles full quadrics only. There is no trimming, no bounded faces and no affine endpoint computation.
- **The comparison with floating-point methods is the useful war story** (DOCUMENTED, §8.1):
  - For Example 4 of Wang/Joe/Goldman (elliptic cylinder vs hyperboloid), the plane-cubic method gives float coefficients with a reported error of about 1e-7.
  - QI outputs a short exact parameterization in under 10 ms.

## Relevance for wonky

- **Oracle, not dependency.** For cylinder/cylinder, cylinder/cone and cone/cone pairs, the live QI server gives ground-truth real type, component count and exact curves. Use it for a regression corpus to test a Bend port of DLLP (INFERRED).
  - It is research use of a public web service. Store only the returned types and formulas as fixtures, and keep the non-commercial licence in mind if wonky is ever distributed (INFERRED).
  - Probes run on 2026-09-23 (DOCUMENTED, raw text in `tmp/research/qi/server-probes-2026-09-23.txt`). Each row maps to a case `docs/proto-recover.md` currently refuses or handles specially:

    | q1 | q2 | FDM meaning | QI real type | exact output |
    |---|---|---|---|---|
    | x²+y²−w² | x²+z²−w² | Steinmetz / equal-radius pipe tee | two secant conics, affinely finite | `[u²−1, 2u, ±2u, u²+1]`, OPTIMAL (rational) |
    | x²+y²−w² | y²+z²−4w² | pipe tee, r = 1 into r = 2 | smooth quartic, two finite components | coefficients in Q(√14) plus √Δ, Δ = 32u⁴ − 784u² + 98, NEAR-OPTIMAL |
    | x²+y²−w² | 4x²−4xw+4z²−3w² | offset cross hole: two r = 1 cylinders, perpendicular axes offset by 1/2 ((x−½)² + z² = 1) | smooth quartic, one finite component | `x = −u³ − u ± √Δ`, ..., Δ = 15u⁴ + 14u² − 1, OPTIMAL |
    | x²+y²−4w² | x²−2xw+z² | small cylinder internally tangent to big one | nodal quartic, affinely finite | `[8u², −2u⁴+8, −4u³+8u, u⁴+4]`, OPTIMAL (rational) |
    | x²+y²−w² | x²−4xw+z²+3w² | externally tangent, skew perpendicular axes | a single point (nodal quartic over C) | `[1, 0, 0, 1]` |
    | x²+y²−w² | x²−4xw+y²+3w² | parallel axes, touching | double line (over C: two concurrent lines + double line) | `[1, 0, −u, 1]` |
    | x²+y²−w² | x²+y²−z² | cylinder ∩ coaxial cone | two non-secant conics (circles at z = ±1) | two rational conics, OPTIMAL |

  - Four more probes on 2026-09-24 (DOCUMENTED, raw text in `tmp/research/qi/server-probes-2026-09-24.txt`). They cover the sphere, a production face type since that day's product decision, plus cone pairs:

    | q1 | q2 | FDM meaning | QI real type | exact output |
    |---|---|---|---|---|
    | x²+y²+z²−4w² | x²−2xw+y² | Viviani: ball r = 2 cut by an r = 1 bore whose wall passes through the ball centre and touches the sphere at (2,0,0) | nodal quartic, affinely finite | `[2(u²−1)², 4u(u²−1), −4u(u²+1), (u²+1)²]`, OPTIMAL (rational). Node (2,0,0) at u = 0 and u = ∞ |
    | x²+y²+z²−4w² | 4x²−4xw+4y²−9w² | ball r = 2 cut by an off-centre bore, (x − ½)² + y² = 10/4 (r ≈ 1.58, axis offset 0.5) | smooth quartic, one finite component | coefficients in Q(√2), Δ = 10u⁴ + 20u² − 6, NEAR-OPTIMAL |
    | x²+y²−z² | y²+z²−6zw+8w² | 45° cone (countersink) crossed by an r = 1 bore at height 3 | smooth quartic, two finite components | coefficients in Q(√2) with 4-digit integers (1904, 1560, 1296), Δ = −324u⁴ + 324u² − 49, NEAR-OPTIMAL |
    | x²+y²−z² | x²+z²−y² | two 45° cones, common apex, perpendicular axes | two concurrent double lines | `[0, 1, ±1, u]`: the cones touch along two lines |

  - Lessons from these probes:
    - **Degenerate types are exact.** Tangent contacts come back as exact degenerate types (point, double line, nodal quartic), not as near-miss numerics.
    - **The irrational fields are partly QI artefacts, not intrinsic.**
      - Everyday FDM features (a pipe tee with unequal radii) come back from QI with an irrational coefficient field (√14), even for integer input.
      - But that √14 is avoidable. Parameterizing the pipe tee by the input cylinder's own generators gives `[1 − u², 2u, ±2√(u⁴ + u² + 1), 1 + u²]`, with rational coefficients and only √Δ (INFERRED derivation, see [dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz.md](dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz.md)).
      - So QI's NEAR-OPTIMAL flag marks a real, avoidable extra square root. That is a practical reason to prefer the input ruled surface as the parameterizing pencil member for CAD data.
    - **Coefficient growth is real.** A modest countersink/bore pair already produces 4-digit coefficients from 1-digit input. This matches the 22-38x height growth in Table 1 and is the reason to evaluate in F32x2 rather than carry exact curves.
- **Test design to copy:** the typed random generation via canonical pairs plus random pencil and projective transforms (§6.3). The server page lists canonical example pairs for each type. Together they give a fixture generator for every degenerate intersection type. Wonky's fixtures would restrict to cylinders and cones in general position, plus deliberately coaxial and tangent pairs (INFERRED).
- **Implementation blueprint for Bend** (INFERRED):
  - The 17k-line breakdown shows where the effort goes. Over half is the per-type intersection code (9,000 lines), and number-theoretic simplification is non-trivial.
  - For wonky, topology plus F32x2 evaluation, most simplification can be dropped. Exact classification plus approximate evaluation needs the "elementary operations" layer (inertia, D, gcd, Descartes, Uspensky, Gauss) and the type dispatch, not the height-minimizing machinery.
- **Performance calibration:** about 3 ms per pair on 2005 hardware with bigints suggests exact classification per candidate face pair is affordable, even in wonky's interpreted Bend setting, if applied only to pairs that survive bounding-box filtering (INFERRED).

## Pointers worth porting or studying

- Paper §6.1: the module breakdown, as a checklist of exact primitives to build in U32-limb bigints.
- Paper §6.3: typed random generation, including its bias caveat.
- Paper Table 1 and §5: why to use the lowest-rank rational pencil member (heights 22 versus 27+ for (2,2)).
- Server example pairs per type (https://gamble.loria.fr/qi/server/): fixtures.
- §8 examples: exact outputs for published float examples, as golden tests.

## Verdict: learn-from

The code is unobtainable, depends on a dead library, and is licensed non-commercial only, so nothing can be adopted. Its value is as:
- validation of the DLLP algorithm at CAD scale (about 3 ms per pair on real CSG scenes);
- a checklist of exact primitives;
- a test-generation recipe;
- a **working** research-only oracle: the web server answered all seven probes on 2026-09-23 and four more (sphere and cone pairs) on 2026-09-24.

Re-implement from the DLLP papers, and add trimming per [shao-chen-2024-topologically-correct-intersection-curves-of-.md](shao-chen-2024-topologically-correct-intersection-curves-of-.md). Generate fixtures now, while the server is up.
