FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// Parts-tree QA fixture (viewer package parts-tree): four separate solid
// bodies, as in a small FDM assembly.
//   B1 "Base plate"  appearance sage; a pad is unioned onto the plate, so the
//                    plate top is split into coplanar fragments and the body
//                    has more raw faces than logical faces.
//   B2 "Bracket"     appearance copper; an extruded L profile.
//   B3 "Pin"         named, no appearance: the viewer palette ("viewer color").
//   B4               no name and no appearance: listed by its body id.
export function multiBody(context is Context, id is Id, definition is map)
{
    fCuboid(context, id + "plate", {
        "corner1" : vector(0, 0, 0) * millimeter,
        "corner2" : vector(60, 40, 4) * millimeter
    });
    fCuboid(context, id + "pad", {
        "corner1" : vector(8, 8, 3) * millimeter,
        "corner2" : vector(24, 32, 9) * millimeter
    });
    opBoolean(context, id + "base", {
        "tools" : qUnion([qCreatedBy(id + "plate", EntityType.BODY),
            qCreatedBy(id + "pad", EntityType.BODY)]),
        "operationType" : BooleanOperationType.UNION
    });
    const base = qCreatedBy(id + "base", EntityType.BODY);
    setProperty(context, { "entities" : base, "propertyType" : PropertyType.NAME,
        "value" : "Base plate" });
    setProperty(context, { "entities" : base, "propertyType" : PropertyType.APPEARANCE,
        "value" : color(0.55, 0.68, 0.58) });

    var profile = newSketchOnPlane(context, id + "bracketProfile", {
        "sketchPlane" : plane(vector(0, 2, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0))
    });
    skPolyline(profile, "outline", {
        "points" : [
            vector(34, 4) * millimeter,
            vector(56, 4) * millimeter,
            vector(56, 8) * millimeter,
            vector(38, 8) * millimeter,
            vector(38, 26) * millimeter,
            vector(34, 26) * millimeter,
            vector(34, 4) * millimeter
        ]
    });
    skSolve(profile);
    opExtrude(context, id + "bracket", {
        "entities" : qSketchRegion(id + "bracketProfile"),
        "direction" : vector(0, 1, 0),
        "endBound" : BoundingType.BLIND,
        "endDepth" : 12 * millimeter
    });
    const bracket = qCreatedBy(id + "bracket", EntityType.BODY);
    setProperty(context, { "entities" : bracket, "propertyType" : PropertyType.NAME,
        "value" : "Bracket" });
    setProperty(context, { "entities" : bracket, "propertyType" : PropertyType.APPEARANCE,
        "value" : color(0.80, 0.52, 0.32) });

    var pin = newSketchOnPlane(context, id + "pinSketch", {
        "sketchPlane" : plane(vector(0, 0, 9) * millimeter, vector(0, 0, 1))
    });
    skCircle(pin, "pin", { "center" : vector(16, 20) * millimeter, "radius" : 3 * millimeter });
    skSolve(pin);
    opExtrude(context, id + "pin", {
        "entities" : qSketchRegion(id + "pinSketch"),
        "direction" : vector(0, 0, 1),
        "endBound" : BoundingType.BLIND,
        "endDepth" : 14 * millimeter
    });
    setProperty(context, { "entities" : qCreatedBy(id + "pin", EntityType.BODY),
        "propertyType" : PropertyType.NAME, "value" : "Pin" });

    fCuboid(context, id + "spacer", {
        "corner1" : vector(44, 26, 4) * millimeter,
        "corner2" : vector(54, 36, 10) * millimeter
    });
}
