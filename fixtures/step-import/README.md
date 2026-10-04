These repository-authored fixtures describe one tetrahedron in three source
encodings: AP214 Part 21 with SI millimetres, Part 21 with conversion-based
inches, and the JSON bodydetails schema used by frozen R20 context captures.
The JSON is a synthetic fixture, not evidence of a live Onshape capture.
`provenance.json` binds the original bytes and unit rationale.

The importer is `wonky_geom::import::ImportDraft::{step,capture}`. Supply the
expected SHA-256, optional revision, instance path and resource limits, then
call `check()`. Both decoders feed the same identity-preserving planar Model
admission, including the unchanged G1–G8 checks. `ImportedModel::replay` verifies
source bytes and repeats decoding and admission. Coordinates lift binary64
words into rationals before exact unit conversion. Decimal lexemes and words
remain in the import state; unit definitions use exact conversion ratios.

I0 admits one selected, closed planar solid with straight edges. It preserves
source topology IDs, face/coedge senses and holes, derives exact line pcurves,
and never heals inconsistent incidences. STEP support includes bounded syntax,
forward references, complex unit/context entities, SI and conversion-based
inch units, and declared length uncertainty. Capture coordinates are metres
by the frozen API contract; absent tolerance remains unknown. Curved surfaces,
supplied pcurves, assemblies, multiple solid selection and repair are named
refusals pending subsequent stages. This does not connect the FeatureScript
lazy captured-body accessor yet (I3), nor claim SG90/R20 completion.
