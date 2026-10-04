FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

// Slide-in servo mount for a skeleton jaw, assembled from behind (through the opening in the back of the skull).
// 1. Coupler: glued onto the jaw's hinge peg; a fork on top takes the servo's single-arm horn.
// 2. Bracket: glued to the inside of the skull wall around the peg (the peg turns freely in its hole).
//    Its two rails have grooves that take the servo's ears; the grooves are open at the back, closed at the front.
// 3. Servo (horn fitted, arm pointing forward) slides in from behind: ears into the grooves, horn arm into the fork.
// 4. Gate: screwed onto the back of the bracket with two M2 self-tapping screws, locks the servo in.
// Assembly frame: skull wall = z 0, peg axis = z axis, +y = backwards (towards the opening), servo long axis = x.
// The shaft sits shaftOff off the case centre, towards +x. Mirror the parts in the slicer if your peg is on the other side.
// All sizes are dialog parameters (bound-spec defaults = a 9 g SG90-class servo; measure yours).
const PEG_D     = { (millimeter) : [1, 6.5, 20] } as LengthBoundSpec;    // square peg window in the bracket plate (peg + its boss)
const PEG_FIT   = { (millimeter) : [1, 4.2, 20] } as LengthBoundSpec;    // coupler bore = peg diameter + glue gap
const PEG_L     = { (millimeter) : [3, 8, 40] } as LengthBoundSpec;      // peg length above the wall
const CAP_L     = { (millimeter) : [2, 5, 30] } as LengthBoundSpec;      // coupler height (peg end flush with its top)
const HORN_EAR  = { (millimeter) : [1, 10, 40] } as LengthBoundSpec;     // horn outer face -> ear face on the horn side
const BODY_L    = { (millimeter) : [5, 23, 60] } as LengthBoundSpec;     // case length (x)
const BODY_W    = { (millimeter) : [5, 12.5, 40] } as LengthBoundSpec;  // case width (y) + clearance
const EAR_SPAN  = { (millimeter) : [10, 32, 80] } as LengthBoundSpec;    // over the ears (x)
const EAR_T     = { (millimeter) : [0.5, 2.5, 10] } as LengthBoundSpec;  // ear thickness
const SHAFT_OFF = { (millimeter) : [0, 5.5, 30] } as LengthBoundSpec;    // shaft axis from case centre
const PLATE_T   = { (millimeter) : [0.8, 2, 10] } as LengthBoundSpec;    // bracket plate thickness
const MARGIN    = { (millimeter) : [0, 4, 20] } as LengthBoundSpec;      // glue flange around the bracket
const ARM_W     = { (millimeter) : [1, 5, 20] } as LengthBoundSpec;      // horn arm width 4.5..9.5 mm from the shaft
const ARM_T     = { (millimeter) : [0.5, 1.8, 6] } as LengthBoundSpec;   // horn arm thickness
const HUB_R     = { (millimeter) : [1, 4, 10] } as LengthBoundSpec;      // horn hub radius (the fork starts outside it)

function sizes(definition is map) returns map
{
    const mm = millimeter;
    const halfW = definition.bodyW / 2;
    const hornZ = definition.pegL + 0.4 * mm;              // horn face 0.4 mm above the coupler top
    const earTop = hornZ + definition.hornEar;             // groove floor = ear face on the horn side
    const earOut = definition.earSpan / 2 + 0.3 * mm;      // groove reaches 0.3 mm past the ear tips
    return {
        "cx" : -definition.shaftOff, "halfW" : halfW, "hornZ" : hornZ, "earTop" : earTop, "earOut" : earOut,
        "grooveTop" : earTop + definition.earT + 0.3 * mm,
        "legTop" : earTop + definition.earT + 2.3 * mm,     // 2 mm cap over the ears
        "legIn" : definition.bodyL / 2 + 0.5 * mm,          // rails start just outside the case
        "halfSpan" : earOut + 4 * mm,                       // 4 mm outer column (takes the gate screw)
        "shelfZ" : earTop - 2 * mm,                         // 2 mm shelf under the ears; below it the coupler swings free
        "front" : -halfW - 1.5 * mm,                        // 1.5 mm front stop
        "forkIn" : definition.armW / 2 + 0.15 * mm,
        "forkR0" : definition.hubR + 0.3 * mm,
        "forkR1" : definition.hubR + 5.3 * mm,
        "capHalf" : max(definition.pegFit / 2 + 1.6 * mm, definition.armW / 2 + 1.75 * mm)
    };
}

function bracket(context is Context, id is Id, definition is map, withHoles is boolean)
{
    const mm = millimeter;
    const s = sizes(definition);
    const cx = s.cx;
    const halfW = s.halfW;
    fCuboid(context, id + "plate", { "corner1" : vector(cx - s.halfSpan - definition.margin, s.front - definition.margin, 0 * mm), "corner2" : vector(cx + s.halfSpan + definition.margin, halfW, definition.plateT) });
    fCuboid(context, id + "railA", { "corner1" : vector(cx - s.halfSpan, s.front, 0 * mm), "corner2" : vector(cx - s.legIn, halfW, s.legTop) });
    fCuboid(context, id + "railB", { "corner1" : vector(cx + s.legIn, s.front, 0 * mm), "corner2" : vector(cx + s.halfSpan, halfW, s.legTop) });
    opBoolean(context, id + "join", {
        "tools" : qUnion([qCreatedBy(id + "plate", EntityType.BODY), qCreatedBy(id + "railA", EntityType.BODY), qCreatedBy(id + "railB", EntityType.BODY)]),
        "operationType" : BooleanOperationType.UNION
    });
    // Ear grooves (open at the back and towards the case) and the swing pockets under the shelves.
    fCuboid(context, id + "grooveA", { "corner1" : vector(cx - s.earOut, -halfW, s.earTop), "corner2" : vector(cx - s.legIn + 1 * mm, halfW + 1 * mm, s.grooveTop) });
    fCuboid(context, id + "grooveB", { "corner1" : vector(cx + s.legIn - 1 * mm, -halfW, s.earTop), "corner2" : vector(cx + s.earOut, halfW + 1 * mm, s.grooveTop) });
    fCuboid(context, id + "pocketA", { "corner1" : vector(cx - s.earOut, s.front - 1 * mm, definition.plateT), "corner2" : vector(cx - s.legIn + 1 * mm, halfW + 1 * mm, s.shelfZ) });
    fCuboid(context, id + "pocketB", { "corner1" : vector(cx + s.legIn - 1 * mm, s.front - 1 * mm, definition.plateT), "corner2" : vector(cx + s.earOut, halfW + 1 * mm, s.shelfZ) });
    var tools = [qCreatedBy(id + "grooveA", EntityType.BODY), qCreatedBy(id + "grooveB", EntityType.BODY), qCreatedBy(id + "pocketA", EntityType.BODY), qCreatedBy(id + "pocketB", EntityType.BODY)];
    if (withHoles)
    {
        const colX = s.earOut + 2 * mm;                     // gate screws in the middle of the outer columns
        const screwZ = s.earTop / 2;
        // Square peg window (the peg turns freely in it) and 1.5 mm square pilots for M2 self-tapping screws:
        // all cuts stay planar, so the whole bracket is one exact box Boolean.
        const pegHalf = definition.pegD / 2;
        const p = 0.75 * mm;
        fCuboid(context, id + "peg", { "corner1" : vector(-pegHalf, -pegHalf, -1 * mm), "corner2" : vector(pegHalf, pegHalf, definition.plateT + 1 * mm) });
        fCuboid(context, id + "pilotA", { "corner1" : vector(cx - colX - p, s.front - 1 * mm, screwZ - p), "corner2" : vector(cx - colX + p, halfW + 1 * mm, screwZ + p) });
        fCuboid(context, id + "pilotB", { "corner1" : vector(cx + colX - p, s.front - 1 * mm, screwZ - p), "corner2" : vector(cx + colX + p, halfW + 1 * mm, screwZ + p) });
        tools = concatenateArrays([tools, [qCreatedBy(id + "peg", EntityType.BODY), qCreatedBy(id + "pilotA", EntityType.BODY), qCreatedBy(id + "pilotB", EntityType.BODY)]]);
    }
    opBoolean(context, id + "cut", { "targets" : qCreatedBy(id + "plate", EntityType.BODY), "tools" : qUnion(tools), "operationType" : BooleanOperationType.SUBTRACTION });
}

function coupler(context is Context, id is Id, definition is map, withBore is boolean)
{
    const mm = millimeter;
    const s = sizes(definition);
    const z0 = definition.pegL - definition.capL;
    const top = definition.pegL;
    const forkTop = s.hornZ + definition.armT + 0.8 * mm;
    const outer = s.forkIn + 1.6 * mm;
    fCuboid(context, id + "cap", { "corner1" : vector(-s.capHalf, -s.forkR1, z0), "corner2" : vector(s.capHalf, s.capHalf, top) });
    fCuboid(context, id + "prongA", { "corner1" : vector(-outer, -s.forkR1, top), "corner2" : vector(-s.forkIn, -s.forkR0, forkTop) });
    fCuboid(context, id + "prongB", { "corner1" : vector(s.forkIn, -s.forkR1, top), "corner2" : vector(outer, -s.forkR0, forkTop) });
    opBoolean(context, id + "join", {
        "tools" : qUnion([qCreatedBy(id + "cap", EntityType.BODY), qCreatedBy(id + "prongA", EntityType.BODY), qCreatedBy(id + "prongB", EntityType.BODY)]),
        "operationType" : BooleanOperationType.UNION
    });
    if (withBore)
    {
        fCylinder(context, id + "bore", { "bottomCenter" : vector(0 * mm, 0 * mm, z0 - 1 * mm), "topCenter" : vector(0 * mm, 0 * mm, top + 1 * mm), "radius" : definition.pegFit / 2 });
        opBoolean(context, id + "cut", { "targets" : qCreatedBy(id + "cap", EntityType.BODY), "tools" : qCreatedBy(id + "bore", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    }
}

function gate(context is Context, id is Id, definition is map, withHoles is boolean)
{
    const mm = millimeter;
    const s = sizes(definition);
    const cx = s.cx;
    fCuboid(context, id + "plate", { "corner1" : vector(cx - s.halfSpan, s.halfW, 0 * mm), "corner2" : vector(cx + s.halfSpan, s.halfW + 2 * mm, s.legTop) });
    if (withHoles)
    {
        const colX = s.earOut + 2 * mm;
        const screwZ = s.earTop / 2;
        fCylinder(context, id + "holeA", { "bottomCenter" : vector(cx - colX, s.halfW - 1 * mm, screwZ), "topCenter" : vector(cx - colX, s.halfW + 3 * mm, screwZ), "radius" : 1.2 * mm });
        fCylinder(context, id + "holeB", { "bottomCenter" : vector(cx + colX, s.halfW - 1 * mm, screwZ), "topCenter" : vector(cx + colX, s.halfW + 3 * mm, screwZ), "radius" : 1.2 * mm });
        opBoolean(context, id + "cut", { "targets" : qCreatedBy(id + "plate", EntityType.BODY), "tools" : qUnion([qCreatedBy(id + "holeA", EntityType.BODY), qCreatedBy(id + "holeB", EntityType.BODY)]), "operationType" : BooleanOperationType.SUBTRACTION });
    }
}

// The bracket and coupler as separate convex boxes (the exact distance under a rotation needs convex solids).
function convexParts(context is Context, id is Id, definition is map)
{
    const mm = millimeter;
    const s = sizes(definition);
    const cx = s.cx;
    fCuboid(context, id + "plate", { "corner1" : vector(cx - s.halfSpan - definition.margin, s.front - definition.margin, 0 * mm), "corner2" : vector(cx + s.halfSpan + definition.margin, s.halfW, definition.plateT) });
    for (var side in [-1, 1])
    {
        const n = side < 0 ? "A" : "B";
        const inner = cx + side * s.legIn;
        const mid = cx + side * s.earOut;
        const outer = cx + side * s.halfSpan;
        fCuboid(context, id + ("column" ~ n), { "corner1" : vector(min(mid, outer), s.front, 0 * mm), "corner2" : vector(max(mid, outer), s.halfW, s.legTop) });
        fCuboid(context, id + ("shelf" ~ n), { "corner1" : vector(min(inner, mid), s.front, s.shelfZ), "corner2" : vector(max(inner, mid), s.halfW, s.earTop) });
        fCuboid(context, id + ("cap" ~ n), { "corner1" : vector(min(inner, mid), s.front, s.grooveTop), "corner2" : vector(max(inner, mid), s.halfW, s.legTop) });
        fCuboid(context, id + ("stop" ~ n), { "corner1" : vector(min(inner, mid), s.front, s.earTop), "corner2" : vector(max(inner, mid), -s.halfW, s.grooveTop) });
    }
    const z0 = definition.pegL - definition.capL;
    const forkTop = s.hornZ + definition.armT + 0.8 * mm;
    const outerFork = s.forkIn + 1.6 * mm;
    fCuboid(context, id + "cCap", { "corner1" : vector(-s.capHalf, -s.forkR1, z0), "corner2" : vector(s.capHalf, s.capHalf, definition.pegL) });
    fCuboid(context, id + "cProngA", { "corner1" : vector(-outerFork, -s.forkR1, definition.pegL), "corner2" : vector(-s.forkIn, -s.forkR0, forkTop) });
    fCuboid(context, id + "cProngB", { "corner1" : vector(s.forkIn, -s.forkR1, definition.pegL), "corner2" : vector(outerFork, -s.forkR0, forkTop) });
}

// Box mock-up of an SG90 with its single-arm horn, seated in the bracket (for the interference check).
function servoMock(context is Context, id is Id, definition is map)
{
    const mm = millimeter;
    const s = sizes(definition);
    const cx = s.cx;
    const hw = 6.1 * mm;
    const caseL = 11.5 * mm;
    fCuboid(context, id + "ears", { "corner1" : vector(cx - definition.earSpan / 2, -hw, s.earTop), "corner2" : vector(cx + definition.earSpan / 2, hw, s.earTop + definition.earT) });
    fCuboid(context, id + "case", { "corner1" : vector(cx - caseL, -hw, s.earTop + definition.earT), "corner2" : vector(cx + caseL, hw, s.earTop + definition.earT + 16 * mm) });
    fCuboid(context, id + "gearTop", { "corner1" : vector(cx - caseL, -hw, s.earTop - 4.3 * mm), "corner2" : vector(cx + caseL, hw, s.earTop) });
    fCuboid(context, id + "hub", { "corner1" : vector(-3.5 * mm, -3.5 * mm, s.hornZ), "corner2" : vector(3.5 * mm, 3.5 * mm, s.earTop - 4.3 * mm) });
    fCuboid(context, id + "arm", { "corner1" : vector(-definition.armW / 2, -15 * mm, s.hornZ), "corner2" : vector(definition.armW / 2, -3.5 * mm, s.hornZ + definition.armT) });
}

export enum SlidePart
{
    annotation { "Name" : "Bracket (glue to the wall)" } BRACKET,
    annotation { "Name" : "Peg coupler (glue onto the peg)" } COUPLER,
    annotation { "Name" : "Gate (screw on from behind)" } GATE,
    annotation { "Name" : "Fit check (all parts + servo, boxes)" } FIT,
    annotation { "Name" : "Fit check, jaw swung +22.6 deg" } FIT_SWING_POS,
    annotation { "Name" : "Fit check, jaw swung -22.6 deg" } FIT_SWING_NEG,
    annotation { "Name" : "Exploded view (servo and gate pulled out backwards)" } EXPLODED,
    annotation { "Name" : "Coupling close-up (peg, cap, horn arm half slid in)" } COUPLING
}

annotation { "Feature Type Name" : "Jaw servo slide mount" }
export const jawSlideMount = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Part" } definition.part is SlidePart;
        
        annotation { "Name" : "Peg window (square)" } isLength(definition.pegD, PEG_D);
        annotation { "Name" : "Coupler bore" } isLength(definition.pegFit, PEG_FIT);
        annotation { "Name" : "Peg length" } isLength(definition.pegL, PEG_L);
        annotation { "Name" : "Coupler height" } isLength(definition.capL, CAP_L);
        annotation { "Name" : "Horn face to ear face" } isLength(definition.hornEar, HORN_EAR);
        annotation { "Name" : "Case length" } isLength(definition.bodyL, BODY_L);
        annotation { "Name" : "Case width" } isLength(definition.bodyW, BODY_W);
        annotation { "Name" : "Span over ears" } isLength(definition.earSpan, EAR_SPAN);
        annotation { "Name" : "Ear thickness" } isLength(definition.earT, EAR_T);
        annotation { "Name" : "Shaft offset from case centre" } isLength(definition.shaftOff, SHAFT_OFF);
        annotation { "Name" : "Plate thickness" } isLength(definition.plateT, PLATE_T);
        annotation { "Name" : "Glue flange" } isLength(definition.margin, MARGIN);
        annotation { "Name" : "Horn arm width" } isLength(definition.armW, ARM_W);
        annotation { "Name" : "Horn arm thickness" } isLength(definition.armT, ARM_T);
        annotation { "Name" : "Horn hub radius" } isLength(definition.hubR, HUB_R);
    }
    {
        const swing = definition.part == SlidePart.FIT_SWING_POS || definition.part == SlidePart.FIT_SWING_NEG;
        const exploded = definition.part == SlidePart.EXPLODED;
        const fit = definition.part == SlidePart.FIT || exploded;
        if (definition.part == SlidePart.BRACKET || fit)
            bracket(context, id + "b", definition, !fit);
        if (definition.part == SlidePart.COUPLER || fit)
            coupler(context, id + "c", definition, !fit);
        if (definition.part == SlidePart.GATE || fit)
            gate(context, id + "g", definition, !fit);
        if (fit || swing)
            servoMock(context, id + "s", definition);
        if (definition.part == SlidePart.COUPLING)
        {
            // Wall patch, the jaw peg, the cap glued onto it, and the servo's horn (hub + arm) 8 mm before its end position.
            const mm = millimeter;
            fCuboid(context, id + "wall", { "corner1" : vector(-14, -18, -2) * mm, "corner2" : vector(14, 22, 0) * mm });
            fCylinder(context, id + "pin", { "bottomCenter" : vector(0, 0, 0) * mm, "topCenter" : vector(0 * mm, 0 * mm, definition.pegL), "radius" : definition.pegFit / 2 - 0.1 * mm });
            coupler(context, id + "c", definition, true);
            const sz = sizes(definition);
            fCuboid(context, id + "s" + "hub", { "corner1" : vector(-3.5 * mm, -3.5 * mm, sz.hornZ), "corner2" : vector(3.5 * mm, 3.5 * mm, sz.hornZ + 4 * mm) });
            fCuboid(context, id + "s" + "arm", { "corner1" : vector(-definition.armW / 2, -15 * mm, sz.hornZ), "corner2" : vector(definition.armW / 2, -3.5 * mm, sz.hornZ + definition.armT) });
            opTransform(context, id + "pullHorn", { "bodies" : qUnion([qCreatedBy(id + "s" + "hub", EntityType.BODY), qCreatedBy(id + "s" + "arm", EntityType.BODY)]), "transform" : toWorld(coordSystem(vector(0, 8, 0) * mm, vector(1, 0, 0), vector(0, 0, 1))) });
        }
        if (exploded)
        {
            // Pull the servo 30 mm and the gate 50 mm out backwards (+y), the way they are slid in.
            opTransform(context, id + "pullServo", { "bodies" : qUnion([qCreatedBy(id + "s" + "ears", EntityType.BODY), qCreatedBy(id + "s" + "case", EntityType.BODY), qCreatedBy(id + "s" + "gearTop", EntityType.BODY), qCreatedBy(id + "s" + "hub", EntityType.BODY), qCreatedBy(id + "s" + "arm", EntityType.BODY)]), "transform" : toWorld(coordSystem(vector(0, 30, 0) * millimeter, vector(1, 0, 0), vector(0, 0, 1))) });
            opTransform(context, id + "pullGate", { "bodies" : qCreatedBy(id + "g" + "plate", EntityType.BODY), "transform" : toWorld(coordSystem(vector(0, 50, 0) * millimeter, vector(1, 0, 0), vector(0, 0, 1))) });
        }
        if (swing)
        {
            bracket(context, id + "b", definition, false);
            coupler(context, id + "c", definition, false);
            // Swing the peg side (coupler, horn hub, horn arm) about the peg axis by atan(5/12) = 22.6 deg, an exact rational rotation.
            const sign = definition.part == SlidePart.FIT_SWING_POS ? 1 : -1;
            opTransform(context, id + "swing", {
                "bodies" : qUnion([qCreatedBy(id + "c" + "cap", EntityType.BODY), qCreatedBy(id + "s" + "hub", EntityType.BODY), qCreatedBy(id + "s" + "arm", EntityType.BODY)]),
                "transform" : toWorld(coordSystem(vector(0, 0, 0) * millimeter, vector(12, 5 * sign, 0), vector(0, 0, 1)))
            });
        }
    });
