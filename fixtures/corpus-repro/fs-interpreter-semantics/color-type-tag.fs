FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
// Cluster fs-interpreter-semantics, 2 units (project-component-9eb7ee7f lochwand r2 fs161,
// cad-project-043/fsocct/cases/workspace/lochwand.fs fs554). color() returns an
// untagged map in wonky, so a parameter typed 'c is Color' fails with
// "Expected Color". In Onshape color() returns a Color-tagged map.
function paint(context is Context, q is Query, c is Color)
{
    setProperty(context, { "entities" : q, "propertyType" : PropertyType.APPEARANCE, "value" : c });
}
annotation { "Feature Type Name" : "Repro" }
export const repro = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "c", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 10) * millimeter });
        paint(context, qCreatedBy(id + "c", EntityType.BODY), color(0.65, 0.57, 0.43));
    });
