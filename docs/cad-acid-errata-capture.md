# CE13 / CE14: prepared Onshape captures

Consumer: Claude, the CAD-Acid catalog owner. This brief gates removal of the
AC111/AC129 DISPUTED overlay (errata CE13, CE14). It keeps two FeatureScript
twin defects from being presented as Onshape geometry failures. Delete it once
both corrected live captures are frozen and the two errata resolve. The builder
makes no Onshape requests.

Upload the two corrected Feature Studios. The originals stay frozen history for
the other zones of their groups:

| Erratum | Corrected file | Custom feature | Zone enum | Only change against the original |
|---|---|---|---|---|
| CE13 | `fixtures/cad-acid/fs/acid-boolean-z1-errata.fs` | `acidBooleanZ1` | `AcidBooleanZ1Zone.AC111` | `fSphere(center: Vector)` becomes `opSphere` with the same center (10,2,10) mm and radius `4 + acidRadiusDelta(variant)` mm |
| CE14 | `fixtures/cad-acid/fs/acid-sweep-zw1-errata.fs` | `acidSweepZW1` | `AcidSweepZW1Zone.AC129` | loft connection vertices come from `qAdjacent(qSketchRegion(sketch,false), VERTEX, VERTEX)` (one region vertex per corner) instead of `qCreatedBy(sketch, VERTEX)` |

Neither `onshape-push.mjs --groups` nor the N24 `capture.mjs` can be used
unchanged: both upload the catalog's group default file. Use the corrected
studios and the immutable namespaces returned when they are compiled.

Capture exactly eleven isolated features (never ALL):

| Zone | Variants | Feature parameters |
|---|---|---|
| AC111 | V0, V1, V2, V3, V4 | `variant` = `AcidVariant.<V>`, `zone` = `AcidBooleanZ1Zone.AC111` |
| AC129 | V0, V1, V2, V3, V4, V5 | `variant` = `AcidVariant.<V>`, `zone` = `AcidSweepZW1Zone.AC129` |

Feature write (POST `/api/v9/partstudios/d/<d>/w/<w>/e/<ps>/features`), as in
the N24 capture:

```json
{
  "btType": "BTFeatureDefinitionCall-1406",
  "feature": {
    "btType": "BTMFeature-134",
    "featureType": "<acidBooleanZ1|acidSweepZW1>",
    "name": "<group>-<variant>-<zone>",
    "namespace": "e<corrected-studio>::m<immutable-microversion>",
    "parameters": [
      {"btType":"BTMParameterEnum-145","parameterId":"variant","enumName":"AcidVariant","namespace":"<same>","value":"<V>"},
      {"btType":"BTMParameterEnum-145","parameterId":"zone","enumName":"<AcidBooleanZ1Zone|AcidSweepZW1Zone>","namespace":"<same>","value":"<AC111|AC129>"}
    ],
    "suppressed": false
  }
}
```

Freeze per cell the write response and feature status, STEP, parts, grouped
mass properties, bodydetails and bounding boxes, with the immutable microversion
checked across STEP translation. For a failed cell, also freeze
`getFeatureError` and, if available, the feature status message: N24 recorded
only the enum, so the AC129 throw site is inferred from source, not observed.
Record genuine errors rather than omitting cells. Freeze provenance, the current
catalog bytes, the corrected FS bytes and SHA256SUMS in a new
`fixtures/cad-acid/onshape-ext/<batch>/`. Keep N24 unchanged.

Predictions from the unchanged contracts. These are not substitutes for a live
result:
- AC111 V0-V3: one body, V = 4000 - 36π mm³ ≈ 3886.9027, topology B1 S1 F7 E15
  V10. V4 has its own closed form (radius 161/40).
- AC129 V0-V3, V5: one body, V = 256 + 64√2 mm³ ≈ 346.5097, topology B1 S1 F6
  E12 V8 (four nonplanar lateral strips). V4 has its own closed form (half-width
  4.025).

If a corrected twin still fails, that capture is the Onshape outcome for the
zone and the erratum resolves to it. Both zones stay DISPUTED for every kernel
until then, with reason "awaiting live Onshape re-capture of the corrected twin".
The admission binding needs one catalog step at resolution time: the zone's
`twin.fs` must name the corrected file, as CE9 did for its OCCT twin.

Not an erratum: AC115 V0-V3 `BOOLEAN_NON_MANIFOLD_RESULT` is genuine. The bore
axis sits 2^-30 mm (≈ 9.3e-10 mm) from the front face, below Parasolid's linear
resolution and the std `TOLERANCE.zeroLength` = 1e-8 m (`math.fs:35-38`). V4
(radius +0.025 mm) breaks through and builds. `acid-ac115.fs` keeps the same
`fSphere` call in its AC111 copy, but that file is the twin only for AC115.
