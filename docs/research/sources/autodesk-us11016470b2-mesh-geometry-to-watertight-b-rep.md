# Autodesk US11016470B2: mesh geometry to watertight B-rep

- **Kind / canonical URL:** granted US patent, [US11016470B2](https://patents.google.com/patent/US11016470B2/en) [P]; [grant PDF](https://patentimages.storage.googleapis.com/88/0f/ee/28423b30f6c7f3/US11016470.pdf) [PDF]. Read all 27 PDF pages, including all 20 issued claims.
- **Inventors / organization / dates — DOCUMENTED:** Martin Cvetanov Marinov, Marco Amagliani, Peter Hugh Charrot; Autodesk Inc. Application 16/388,771 filed 2019-04-18; priority to provisional 62/758,053 dated 2018-11-09; grant 2021-05-25. The reference list includes Gregory and P. Charrot's 1980 C1 triangular interpolant paper, but the bibliographic coincidence alone is not an independently verified identity history. [PDF pp.1–2](https://patentimages.storage.googleapis.com/88/0f/ee/28423b30f6c7f3/US11016470.pdf).
- **License / status — DOCUMENTED:** Google lists Active, with the usual disclaimer that status is not a legal conclusion. This is a patent, not permissively licensed code. Public availability, research intent and independent implementation do not establish freedom to practice. Review the issued claims and relevant patent family before reproducing the pipeline; no legal conclusion is offered here. [P metadata/claims](https://patents.google.com/patent/US11016470B2/en).
- **Activity / maturity:** granted technical disclosure with diagrams, one timing example and citations, not a public implementation or issue tracker. Repository language, size, stars, contributors, commits and releases are not applicable. A related 2019 paper, *Boundary Conforming Mesh to T-NURCC Surface Conversion*, Computers & Graphics 82:95–105, is cited but was not independently read. [PDF p.2 and cols.21–22](https://patentimages.storage.googleapis.com/88/0f/ee/28423b30f6c7f3/US11016470.pdf).

## What it is

**DOCUMENTED:** boundary-constrained mesh-to-smooth-surface conversion. Inputs are a polygon mesh and smooth boundary curves associated with existing B-rep solids. A transfinite-interpolation quad patch network first reconciles the faceted interior with the prescribed curves; a locally refinable smooth representation is then fitted with a **tight boundary tolerance and a much looser interior tolerance**, and stitched to the original solid. The purpose is usable editable CAD, not merely watertight triangles. [P, description of Figs.2A–3A; PDF cols.9–14](https://patents.google.com/patent/US11016470B2/en).

**Important distinction — DOCUMENTED:** unlike US11886165B2 claim 1, issued **method claim 1 here is not limited to generative design**; generative design is added by dependent claim 2. Scanned meshes and other polygonal inputs are described. The method therefore cannot be dismissed as irrelevant patent scope merely because wonky's input is not topology optimization. This is a textual claim observation, not an infringement assessment. [PDF cols.26–29, claims 1–20](https://patentimages.storage.googleapis.com/88/0f/ee/28423b30f6c7f3/US11016470.pdf).

## How it works

### Domain and boundary representation

**DOCUMENTED:** use an orientable 2-manifold triangle mesh M=(V,E,T), potentially open, with oriented C1 curve segments C_i assigned to its boundary edges. Obtain a globally continuous quantized quad parameterization φ:M→Ω, for example an Integer Grid Map. Store, for each quad, the triangles overlapping its parameter domain so φ⁻¹ can locate/evaluate the source mesh efficiently. The quads are **parameter domains**, not a replacement 3D quad mesh: M remains the geometric reference. [P, discussion of steps 405–425 / Fig.4A; PDF cols.13–15](https://patents.google.com/patent/US11016470B2/en).

**DOCUMENTED:** for each boundary edge of Ω, concatenate the corresponding source curve segments into a composite Γ. Reparameterize by normalized arc length on [0,1] to reduce sensitivity to the original curves' parameterizations; the source discusses cached spline approximations for arc-length functions when numerical integration is needed. This correspondence, rather than nearest-neighbor sampling alone, ties parameter-domain boundaries to prescribed CAD curves. [P, Fig.4B; PDF col.15](https://patents.google.com/patent/US11016470B2/en).

### First create a C0 target that honors the curves

**DOCUMENTED:** for each quad side, form a displacement μ_i(t)=Γ_i(t)−φ⁻¹(side_i(t)) where that side is on the constrained boundary; use zero displacement on unconstrained sides. Construct a Coons-style transfinite displacement patch Ξ(u,v) and define the adjusted target M̃(u,v)=φ⁻¹(u,v)+Ξ(u,v). Neighboring patches share boundary data, yielding a C0 network interpolating the prescribed boundary and returning to the original mesh away from it. The displayed construction uses the compatible side/corner setup of the input; arbitrary inconsistent corner displacements need their own handling. [P, Fig.4B; PDF col.15](https://patents.google.com/patent/US11016470B2/en).

**DOCUMENTED:** applying interpolation only to boundary-adjacent triangles gives a jagged, tessellation-dependent transition region. A global quad parameterization produces an influence region controlled by a size field rather than by individual triangles. Fig.3C varies quad size to demonstrate this independently of fitting/refinement. [P, Figs.3B–3C; PDF cols.12–14](https://patents.google.com/patent/US11016470B2/en).

### Then fit boundary first, freeze it, and fit the interior

**DOCUMENTED:** initialize a locally refinable surface S from the quad layout; examples are T-NURCCs, T-splines, LR B-splines and hierarchical B-splines. The algorithm is not restricted to analytic planes/cylinders. Its central error targets are approximately L∞(∂S,∂M̃)≤ξ and L∞(S,M̃)<δ, with δ≫ξ. Fit the boundary with constrained least squares, estimate its maximum error, and insert local knots on violating spans. Once boundary requirements are met, **freeze boundary control points** and fit only interior degrees of freedom. This prevents an interior approximation step from reopening the CAD interface. [P, Fig.5A and associated description; PDF cols.16–21](https://patents.google.com/patent/US11016470B2/en).

**DOCUMENTED:** boundary controls use a zero-knot channel. Repeated local knots permit corner discontinuities and derivative constraints; newly split boundary spans propagate into neighboring channel/interior patches when needed to avoid extreme knot ratios and poor basis-function support. Non-corner boundary cross-field indices can be constrained to zero. Negative boundary singularities at concave corners may be moved to a nearby interior vertex, preferably near the corner bisector, to avoid undesirable derivative discontinuity propagation. [P, Figs.5B–5E; PDF cols.16–19](https://patents.google.com/patent/US11016470B2/en).

### Error estimation and refinement are concrete but not exact certification

**DOCUMENTED:** boundary least-squares integrals use Newton–Cotes quadrature; maximum boundary error can use nonlinear numerical optimization or dyadically subdivided parameter intervals sharing the quadrature samples. A geometric Hausdorff comparison of corresponding boundary loops can reduce unnecessary refinement caused solely by parameterization, but is more expensive. [P, PDF cols.18–19](https://patents.google.com/patent/US11016470B2/en).

**DOCUMENTED:** interior least squares uses a 5×5 sample grid per quad and trapezoidal cubature for the C0 target. The patent says multi-variate optimization for continuous maximum interior error is too expensive in many applications, and substitutes a **9×9 distance-sample grid**; these grids nest when resolution doubles, allowing reuse. Quads whose sampled error exceeds δ are subdivided, along with additional quads required to balance parameter spacing/support. The alternative greedy refinement can cause excessive interior refinement. [P, PDF cols.20–22](https://patents.google.com/patent/US11016470B2/en).

**INFERRED:** a sampled maximum, even on a nested grid, is not a certified sup-norm or Hausdorff bound between samples. The text's phrase “interval subdivision” is not by itself an interval-arithmetic enclosure proof. A wonky adaptation requiring certified deviation would need independent derivative/convex-hull/interval bounds and explicit failure when the budget cannot be certified. [P, error-estimation passages, cols.18–21](https://patents.google.com/patent/US11016470B2/en).

### Kernel resolution is a modeling contract, not the floating-point unit roundoff

**DOCUMENTED:** ε denotes the modeling kernel's smallest representable model distance/resolution. Boundary tolerance ξ is at least ε and within the kernel's tolerated coincidence range. The specification discusses values around 10ε, 100ε and in some embodiments up to 1000ε; it argues that shrinking gaps below ε adds complexity without useful accuracy. Interior δ is chosen no tighter than the accuracy of the scan/generative input, often 10–1000 times ξ. Method claim 6 requires at least one order of magnitude separation, while independent system claim 14 specifies at least three orders. There is **not one universal tolerance ratio** for all embodiments/claims. [P, description of steps 510–520; PDF cols.17–20 and claims 6,14](https://patents.google.com/patent/US11016470B2/en).

**DOCUMENTED:** the final “watertight” B-rep is produced by a kernel stitching operation using its coincidence/tolerant-modeling rules; other embodiments allow Booleans/rolling. The boundaries are approximated extremely tightly, not proved identical real-number functions. Assertions that sufficiently small gaps behave like precise models are the inventors' engineering claims, not a theorem guaranteeing every downstream Boolean/fillet. [P, PDF cols.10–12](https://patents.google.com/patent/US11016470B2/en).

## Robustness and guarantees

- **DOCUMENTED:** freezing boundary controls structurally decouples subsequent interior fitting from already fitted contacts. Compatible transfinite data yields a C0 target, and explicit corner handling avoids treating corners as smooth constraints. [P, Figs.4B,5A–5C](https://patents.google.com/patent/US11016470B2/en).
- **DOCUMENTED:** the source assumes a suitable oriented manifold mesh and boundary/parameterization correspondence. It describes numerical minimization, local refinement and kernel stitching, not exact arithmetic, exact rational geometry, all-input injectivity or proof of absence of global self-intersections. No f32/f64 scalar format is prescribed. [P, PDF cols.14–22](https://patents.google.com/patent/US11016470B2/en).
- **INFERRED:** “editable,” “smooth,” “within sampled tolerance” and “watertight under tolerant sewing” are independent properties. They must not replace wonky's exact analytic semantics or certified mesh deviation. Surface smoothness also does not guarantee tangency to the adjoining original solid. [P, separate construction/fitting/stitching stages](https://patents.google.com/patent/US11016470B2/en).

## Parallelism and performance

**DOCUMENTED, measured examples as reported by the patent:**

- Fig.2B has **5,287 patches**, with a reported largest boundary deviation of **4.9×10⁻⁶ times the input mesh bounding-sphere diameter**. The text contrasts this with roughly **2.8×10⁵ patches** for trying to impose a similarly tight global error on that example. This is an illustrative complexity comparison, not a controlled implementation benchmark. [PDF cols.11,13](https://patentimages.storage.googleapis.com/88/0f/ee/28423b30f6c7f3/US11016470.pdf).
- Figs.6A–6C describe a different example with **34,532 final patches and 42 minutes total runtime**, including IGM computation; ξ is set to 100ε and reported relative boundary tolerance is about 3×10⁻⁶, with δ=100ξ. CPU model, thread count, memory and timing breakdown are not provided. Do not merge the 5,287-patch and 34,532-patch examples or convert this into a claimed speedup. [PDF col.22 / Fig.6C](https://patentimages.storage.googleapis.com/88/0f/ee/28423b30f6c7f3/US11016470.pdf).

**INFERRED:** per-quad basis evaluation and error sampling are regular candidates for fork-join/GPU batches; global parameterization, sparse least-squares assembly/solution, boundary constraints and adaptive refinement remain coordinated, irregular work. The generic multiple-processor text supplies no measured parallel scaling. [P, PDF cols.14–22](https://patents.google.com/patent/US11016470B2/en).

## Known failures, limitations, war stories

**DOCUMENTED:** a single tight global tolerance can cause prohibitive patch counts; negative boundary singularity relocation can fail when the input mesh is too coarse to supply a suitable interior vertex; for a sufficiently large accumulated angle (example >2π with singularity index below −1), relocation may cause substantial parameter distortion and poor surface quality, making derivative discontinuities preferable; boundary-only refinement can produce tiny-support basis functions and surface-quality problems; greedy interior refinement can overgrow the output. No public issue tracker is supplied. [P, PDF cols.13,17,19,22](https://patents.google.com/patent/US11016470B2/en).

## Relevance for wonky

**INFERRED, useful contract but low immediate implementation priority:** separate attachment-curve accuracy from interior visual/manufacturing approximation. If wonky later adds free-form fitted patches, blending or scan reconstruction, solve and lock the exact interface constraints first, and only then spend an independent error budget on the interior. This is especially useful for keeping FDM hole/mating interfaces stable while allowing looser exterior fitting. It is **not** a substitute for analytic SSI or a fillet algorithm; the source neither computes rolling-ball fillets nor supplies curvature-continuous joins to arbitrary existing faces. [P, staged boundary/interior fit and stitch](https://patents.google.com/patent/US11016470B2/en).

**INFERRED Bend fit:** U32 patch/vertex IDs, immutable quad descriptors, dyadic refinement addresses and cached nested samples fit functional arrays. Fixed 5×5 or 9×9 evaluation grids give uniform per-patch work; schedule refinement in bounded rounds and rebuild arrays using scans rather than in-place knot insertion. F32x2 may support normalized basis evaluation and residual accumulation, but sparse fitting conditioning, derivative constraints and very disparate knot lengths require a separate precision/error analysis. U32-limb exact predicates help topology and dyadic coordinates, not arbitrary spline root completeness or floating least-squares error. Kernel ε must be an explicit scale-aware capability, not confused with F32 machine epsilon. [P, Figs.5D–5E and numeric methods, cols.18–22](https://patents.google.com/patent/US11016470B2/en).

**INFERRED test/diagnostic plan:** report boundary max-error bound separately from interior deviation, record whether each is certified or sampled, preserve corner constraints, and reject noninjective layouts or excessive refinement explicitly. Include tests for concave/reentrant corners, tiny neighboring spans, equal shapes with different curve parameterizations and post-interior-fit seam drift. Do not silently replace analytic faces by thousands of fitted patches merely to obtain something the kernel accepts as sewn. Patent clearance remains a separate prerequisite for a materially similar implementation. [P, failure and tolerance passages](https://patents.google.com/patent/US11016470B2/en).

## Pointers worth porting or studying

- **Figs.3A–3C, cols.12–15:** distinction between a parameter-domain quad network and the input mesh; tessellation-independent influence band; displacement-based transfinite construction.
- **Figs.5A–5C, cols.16–18:** boundary-first/freeze/interior pipeline, zero-knot channels, corner and singularity handling.
- **Figs.5D–5E, cols.19–21:** local knot propagation, nested grids, balancing and the precise place where sampled error replaces optimization.
- **Fig.6C, col.22:** convergence/patch-count example and the 42-minute result.
- **Claims 1,14,18 (independent), 6 and 20:** actual claimed combinations and tolerance-ratio distinctions. All pointers refer to the [issued PDF](https://patentimages.storage.googleapis.com/88/0f/ee/28423b30f6c7f3/US11016470.pdf).

## Verdict: learn-from

Retain the two-error-budget and boundary-locking insight; defer full quad parameterization/T-NURCC reconstruction until wonky actually needs free-form fitted faces. This disclosure is more numerically concrete than its abstract suggests, but its sampled interior checks and tolerant stitching are weaker than wonky's intended certification contract, and the patented combination cannot be treated as licensed implementation material.

## Sources and local evidence

- [Full patent description, timeline and claims](https://patents.google.com/patent/US11016470B2/en).
- [Issued PDF, 27 pages](https://patentimages.storage.googleapis.com/88/0f/ee/28423b30f6c7f3/US11016470.pdf).
- Local PDF: `<repo>/tmp/research/pdf/US11016470B2.pdf`.
- Local HTML/text: `<repo>/tmp/research/commercial-kernels-2/US11016470B2.html` and `<repo>/tmp/research/commercial-kernels-2/US11016470B2.txt`.

