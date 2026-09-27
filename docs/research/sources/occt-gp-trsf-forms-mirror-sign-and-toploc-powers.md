# OCCT gp_Trsf forms, mirror-as-negative-scale, and TopLoc_Location powers

- Kind: library source code. Files actually read (OCCT `master`, fetched 2026-09-24 into `<repo>/tmp/research/occt-toploc/`): [gp_TrsfForm.hxx](https://github.com/Open-Cascade-SAS/OCCT/blob/master/src/FoundationClasses/TKMath/gp/gp_TrsfForm.hxx), [gp_Trsf.hxx](https://github.com/Open-Cascade-SAS/OCCT/blob/master/src/FoundationClasses/TKMath/gp/gp_Trsf.hxx) / [gp_Trsf.cxx](https://github.com/Open-Cascade-SAS/OCCT/blob/master/src/FoundationClasses/TKMath/gp/gp_Trsf.cxx) (l.59-140), [TopLoc_Location.hxx](https://github.com/Open-Cascade-SAS/OCCT/blob/master/src/FoundationClasses/TKMath/TopLoc/TopLoc_Location.hxx) / [.cxx](https://github.com/Open-Cascade-SAS/OCCT/blob/master/src/FoundationClasses/TKMath/TopLoc/TopLoc_Location.cxx) (l.62-218), `TopLoc_Datum3D.hxx`, `TopLoc_ItemLocation.hxx`. Complements the existing [OCCT Modeling Data note](occt-modeling-data-guide-topods-tshape-location-orientation.md), which covers TopoDS sharing and location equality.
- Organization: Open Cascade SAS. License: **LGPL-2.1 with the OCCT exception** (GitHub reports LGPL-2.1). Per project rules OCCT may be studied and adapted, not linked.
- Activity (DOCUMENTED, `gh api` 2026-09-24): 2,910 stars, last push 2026-09-05.

## What it is

How a mature B-rep kernel types and composes rigid placements: a transform carries a **form tag**, a **scale** (whose sign encodes reflection) and a 3×3 matrix plus translation in binary64; shapes carry **locations** that are symbolic chains of shared datums raised to integer powers.

## How it works (DOCUMENTED)

- **Form tags** (`gp_TrsfForm.hxx`): `gp_Identity, gp_Rotation, gp_Translation, gp_PntMirror, gp_Ax1Mirror, gp_Ax2Mirror, gp_Scale, gp_CompoundTrsf, gp_Other` ("Transformation with not-orthogonal matrix"). Setters assign the form; composition downgrades to `gp_CompoundTrsf`.
- **Rotation** (`gp_Trsf.cxx:90-99`): `SetRotation(Ax1, Ang)` builds the matrix from axis and angle in binary64 (`matrix.SetRotation`), translation `loc = p − R·p`; quaternion variants `SetRotation(gp_Quaternion)` use `R.GetMatrix()`.
- **Mirrors keep a proper rotation matrix** (`gp_Trsf.cxx:59-86`): plane mirror `SetMirror(gp_Ax2)` sets `scale = −1` and `matrix = 2nnᵀ − I` (a half-turn about the plane normal), so the reflection is `−1 · (half-turn)`; axis mirror `SetMirror(gp_Ax1)` is a half-turn with `scale = 1`. `IsNegative()` is `scale < 0` (`gp_Trsf.hxx:218`). Orientation reversal is thus a sign bit, not a determinant test on a rounded matrix.
- **Locations** (`TopLoc_Location.hxx:30-35`): "A Location is a composite transition. It comprises a series of elementary reference coordinates, i.e. objects of type TopLoc_Datum3D, and the powers to which these objects are raised." `TopLoc_Datum3D(const gp_Trsf&)` raises an error "if the Trsf is not a rigid transformation".
- **Composition is word reduction** (`TopLoc_Location.cxx:88-121`): `Multiplied` prepends the other chain and merges adjacent equal datums by adding powers, dropping zero powers; `Inverted` reverses the chain with negated powers; `Powered(n)` repeats. `IsEqual` compares datum identities and powers, not matrices. `ScalePrec() = 1e-14`.

## Robustness and guarantees

- DOCUMENTED: symbolic equality is exact for identical construction chains (same datum objects), independent of rounding.
- INFERRED: the chain algebra is a **free group** on datums: it knows `D·D⁻¹ = I` but not `D^N = I` for an N-fold rotation, nor that two differently constructed datums are equal. A full circular pattern's last instance is therefore not recognized as the seed, and two users' "rotate 90° about z" are different datums.
- DOCUMENTED (Modeling Data note): numerically equal but differently built locations compare unequal; this is by design.
- The numbers themselves are binary64 matrices from `sin/cos` of radians: exactness at special angles is not attempted.

## Parallelism and performance

Not applicable; locations are cheap persistent lists (shared tails).

## Known failures, limitations, war stories

- INFERRED from the code: floating matrices plus symbolic chains give two notions of "same placement" that can disagree; kernels built on OCCT resolve the disagreement with tolerances downstream (BOP fuzzy value, the tolerant B-rep of the [OCCT BRep format note](occt-brep-format-specification-tolerant-modeling-semantics.md)).

## Relevance for wonky

- **Mirror handling (unblocks the refused `mirrorAcross`):** represent a reflection as (proper rotation, parity bit). A plane mirror becomes `parity = −1` with the half-turn `2nnᵀ/|n|² − I`, which is **exactly rational for any integer or dyadic normal n** (no square root; INFERRED), so a mirror across a plane with a dyadic normal is exactly representable, and orientation reversal is a flag the topology layer applies (face sense, loop order) rather than a determinant sign on rounded words. wonky's `opPattern` currently refuses reflections ("Only proper rigid transforms are implemented"; `docs/corpus/cluster-fs-missing-builtin.md`); 21 `mirrorAcross` uses exist in Marc's corpus.
- **Placement typing:** a form tag (identity / translation / signed-axis permutation / rotation about a coordinate axis by an exact angle / general rational rotation / pattern element) lets wonky choose exact paths cheaply, exactly like `isIdentityRotation` already does for translations (src/kernel.mjs).
- **Symbolic locations with relations:** adopt OCCT's datum-power chains but add the relation `D^N = I` for pattern datums created as N-fold (a cyclic group element `k mod N`), which OCCT lacks. Equality of placements then reduces exactly: same axis datum and `k ≡ k' (mod N)`.
- Bend fit: tags and powers are U32; chain reduction is a list fold (fork-join friendly per body); matrices are only materialized for evaluation.

## Pointers worth porting or studying

- `gp_Trsf.cxx:59-86` (mirror as negative scale plus half-turn), `gp_TrsfForm.hxx` (tag set), `TopLoc_Location.cxx:88-218` (chain multiply, invert, power).

## Verdict: adapt

Adopt the form tag and the reflection-as-parity-bit representation; adopt datum-power chains extended with cyclic relations for patterns. Do not adopt binary64 radian matrices as the source of truth.
