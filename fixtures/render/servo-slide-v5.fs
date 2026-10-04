FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

// Slide-in servo mount for a skeleton jaw (Bones), assembled from behind through the opening in the back of the skull.
// 1. Coupler: glued onto the jaw's hinge peg. On top, a pocket in the shape of the servo's single-arm horn: a channel
//    for the round hub, open at the back so the horn slides in, narrowing like the arm towards the front.
// 2. Bracket: glued to the inside of the skull wall around the peg (the peg turns freely in its window).
//    Two rails with grooves for the servo's ears: open at the back, closed at the front (the front stop puts the
//    shaft exactly on the peg axis).
// 3. Servo (horn fitted, arm pointing forward, servo at its middle position) slides in from behind.
// 4. Gate: screwed onto the back of the bracket with two M2 self-tapping screws.
// Assembly frame: skull wall = z 0, peg axis = z axis, +y = backwards (towards the opening), servo long axis = x.
// v4 (2026-09-30): servo and horn dimensions measured on the SG90 reference model of the FreeCAD library
// (Electrical Parts/Servos/SG-90: Servo-sg90.step, SG90-1-arm-horn.step), see tmp/servo-bracket/ref/measure.py:
// case 11.8 x 22.5 x 22.7, ears 2.5 thick at 15.9..18.4 from the case bottom, 32.4 over the ears, round top boss
// d 11.8 x 4 plus a d 5 bump 6.3 mm towards the case centre, shaft 16.6 mm from one case end (5.35 off centre),
// horn 5 mm high: hub d 8, arm 2 mm thick on the outer side, 7.9 mm wide at the hub tapering to 3 mm at 17 mm.
// Horn outer face to ear face = 13.5 on the reference model, 14.5 from the TowerPro drawing (A 32 - F 19.5 + arm 2):
// the design takes 14 +- 0.5 (both extremes fit, see FIT_HORN_LOW / FIT_HORN_HIGH).
// v5 (2026-09-30, from the Revopoint scan of the head, tmp/servo-bracket/scan): the peg is d 5.46 (coupler bore 5.8),
// and the wall around it is not flat: the plate rests on the ridge at the peg root about 5 mm above the peg's lowest
// point, so the peg ends ~8 mm above the plate underside (PEG_L) without cutting; the gaps below are filled with hot
// glue. The plate starts 2 mm inside the -x rail (no -x glue flange): the wall rises to 10-12 mm at that front corner.
const PEG_D      = { (millimeter) : [1, 7, 20] } as LengthBoundSpec;      // square peg window in the bracket plate
const PEG_FIT    = { (millimeter) : [1, 5.8, 20] } as LengthBoundSpec;    // coupler bore = peg diameter (scan: 5.46) + glue gap
const PEG_L      = { (millimeter) : [3, 8, 40] } as LengthBoundSpec;      // peg length above the wall (nominal)
const HEADROOM   = { (millimeter) : [0, 3, 15] } as LengthBoundSpec;      // coupler reaches this far past the peg end
const CAP_L      = { (millimeter) : [2, 5, 30] } as LengthBoundSpec;      // coupler depth below the peg end
const HORN_GAP   = { (millimeter) : [0, 1.5, 10] } as LengthBoundSpec;    // air under the horn at its lowest position
const HORN_EAR   = { (millimeter) : [5, 14, 40] } as LengthBoundSpec;     // horn outer face -> ear face (nominal)
const HORN_TOL   = { (millimeter) : [0, 0.5, 5] } as LengthBoundSpec;     // +- range of HORN_EAR the design accepts
const HUB_R      = { (millimeter) : [1, 4, 10] } as LengthBoundSpec;      // horn hub radius
const ARM_T      = { (millimeter) : [0.5, 2, 6] } as LengthBoundSpec;     // horn arm thickness
const FIT_CLR    = { (millimeter) : [0, 0.5, 2] } as LengthBoundSpec;     // play around hub and arm in the pocket
const POCKET_LEN = { (millimeter) : [4, 10.5, 30] } as LengthBoundSpec;   // pocket length in front of the shaft
const POCKET_TIP = { (millimeter) : [1, 3, 10] } as LengthBoundSpec;      // pocket half width at its front end (arm 2.48 + play)
const WALL_T     = { (millimeter) : [1, 2.8, 10] } as LengthBoundSpec;    // pocket wall thickness beside the hub channel
const BODY_L     = { (millimeter) : [5, 22.5, 60] } as LengthBoundSpec;   // case length (x)
const BODY_W     = { (millimeter) : [5, 11.8, 40] } as LengthBoundSpec;   // case width (y)
const EAR_SPAN   = { (millimeter) : [10, 32.4, 80] } as LengthBoundSpec;  // over the ears (x)
const EAR_T      = { (millimeter) : [0.5, 2.5, 10] } as LengthBoundSpec;  // ear thickness
const SHAFT_OFF  = { (millimeter) : [0, 5.35, 30] } as LengthBoundSpec;   // shaft axis from case centre
const PLATE_T    = { (millimeter) : [0.8, 2, 10] } as LengthBoundSpec;    // bracket plate thickness
const MARGIN     = { (millimeter) : [0, 4, 20] } as LengthBoundSpec;      // glue flange around the bracket
const SLIDE_Y    = { (millimeter) : [0, 0, 80] } as LengthBoundSpec;      // fit checks only: servo pulled back by this much

function sizes(definition is map) returns map
{
    const mm = millimeter;
    const capTop = definition.pegL + definition.headroom;            // coupler top
    const faceLow = capTop + definition.hornGap;                     // horn outer face, lowest (longest horn-to-ear)
    const earTop = faceLow + definition.hornEar + definition.hornTol; // groove floor = ear face on the horn side
    const faceHigh = earTop - (definition.hornEar - definition.hornTol);
    const channel = definition.hubR + definition.fitClr;             // pocket half width behind the shaft (hub channel)
    return {
        "cx" : -definition.shaftOff, "capTop" : capTop, "faceLow" : faceLow, "faceHigh" : faceHigh, "earTop" : earTop,
        "faceNom" : earTop - definition.hornEar,
        "z0" : definition.pegL - definition.capL,
        // walls hold the arm with 1 mm to spare at the highest horn; the servo's boss is >= 1.2 mm above them at the lowest
        "wallsTop" : faceHigh + definition.armT + 1 * mm,
        "channel" : channel,
        "pocketFront" : -definition.pocketLen,
        "cradleHalf" : channel + definition.wallT,
        "couplerBack" : channel,
        "earFront" : -definition.bodyW / 2,                          // front stop: puts the shaft on the peg axis
        "back" : definition.bodyW / 2 + 0.4 * mm,                    // gate face, 0.4 mm behind the case
        "front" : -definition.bodyW / 2 - 1.5 * mm,                  // rails' front face (1.5 mm stop wall)
        "earOut" : definition.earSpan / 2 + 0.5 * mm,                // grooves reach 0.5 mm past the ear tips
        "grooveTop" : earTop + definition.earT + 0.5 * mm,           // 0.5 mm vertical play for the ears
        "legTop" : earTop + definition.earT + 2.5 * mm,              // 2 mm cap over the grooves
        "legIn" : definition.bodyL / 2 + 0.8 * mm,                   // 0.8 mm play beside the case
        "shelfZ" : earTop - 2 * mm                                   // 2 mm shelf under the ears; below it the coupler swings free
    };
}

function bracket(context is Context, id is Id, definition is map, withHoles is boolean)
{
    const mm = millimeter;
    const s = sizes(definition);
    const cx = s.cx;
    const halfSpan = s.earOut + 4 * mm;                              // 4 mm outer column (takes the gate screw)
    fCuboid(context, id + "plate", { "corner1" : vector(cx - halfSpan + 2 * mm, s.front - definition.margin, 0 * mm), "corner2" : vector(cx + halfSpan + definition.margin, s.back, definition.plateT) });
    fCuboid(context, id + "railA", { "corner1" : vector(cx - halfSpan, s.front, 0 * mm), "corner2" : vector(cx - s.legIn, s.back, s.legTop) });
    fCuboid(context, id + "railB", { "corner1" : vector(cx + s.legIn, s.front, 0 * mm), "corner2" : vector(cx + halfSpan, s.back, s.legTop) });
    opBoolean(context, id + "join", {
        "tools" : qUnion([qCreatedBy(id + "plate", EntityType.BODY), qCreatedBy(id + "railA", EntityType.BODY), qCreatedBy(id + "railB", EntityType.BODY)]),
        "operationType" : BooleanOperationType.UNION
    });
    // Ear grooves (open at the back and towards the case, closed at the front) and the swing pockets under the shelves.
    fCuboid(context, id + "grooveA", { "corner1" : vector(cx - s.earOut, s.earFront, s.earTop), "corner2" : vector(cx - s.legIn + 1 * mm, s.back + 1 * mm, s.grooveTop) });
    fCuboid(context, id + "grooveB", { "corner1" : vector(cx + s.legIn - 1 * mm, s.earFront, s.earTop), "corner2" : vector(cx + s.earOut, s.back + 1 * mm, s.grooveTop) });
    fCuboid(context, id + "pocketA", { "corner1" : vector(cx - s.earOut, s.front - 1 * mm, definition.plateT), "corner2" : vector(cx - s.legIn + 1 * mm, s.back + 1 * mm, s.shelfZ) });
    fCuboid(context, id + "pocketB", { "corner1" : vector(cx + s.legIn - 1 * mm, s.front - 1 * mm, definition.plateT), "corner2" : vector(cx + s.earOut, s.back + 1 * mm, s.shelfZ) });
    var tools = [qCreatedBy(id + "grooveA", EntityType.BODY), qCreatedBy(id + "grooveB", EntityType.BODY), qCreatedBy(id + "pocketA", EntityType.BODY), qCreatedBy(id + "pocketB", EntityType.BODY)];
    if (withHoles)
    {
        const colX = s.earOut + 2 * mm;                              // gate screws in the middle of the outer columns
        const screwZ = s.earTop / 2;
        // Square peg window (the peg turns freely in it) and 1.5 mm square pilots for M2 self-tapping screws.
        const pegHalf = definition.pegD / 2;
        const p = 0.75 * mm;
        fCuboid(context, id + "peg", { "corner1" : vector(-pegHalf, -pegHalf, -1 * mm), "corner2" : vector(pegHalf, pegHalf, definition.plateT + 1 * mm) });
        fCuboid(context, id + "pilotA", { "corner1" : vector(cx - colX - p, s.front - 1 * mm, screwZ - p), "corner2" : vector(cx - colX + p, s.back + 1 * mm, screwZ + p) });
        fCuboid(context, id + "pilotB", { "corner1" : vector(cx + colX - p, s.front - 1 * mm, screwZ - p), "corner2" : vector(cx + colX + p, s.back + 1 * mm, screwZ + p) });
        tools = concatenateArrays([tools, [qCreatedBy(id + "peg", EntityType.BODY), qCreatedBy(id + "pilotA", EntityType.BODY), qCreatedBy(id + "pilotB", EntityType.BODY)]]);
    }
    opBoolean(context, id + "cut", { "targets" : qCreatedBy(id + "plate", EntityType.BODY), "tools" : qUnion(tools), "operationType" : BooleanOperationType.SUBTRACTION });
}

// Rounded rectangle from lines and exact quarter arcs: each arc's mid point sits at (0.6 r, 0.8 r) from its corner
// centre, a 3-4-5 point exactly on the circle, so radius and tangency are exact.
function roundedRect(sk is Sketch, p is string, x0, y0, x1, y1, r)
{
    skLineSegment(sk, p ~ "b", { "start" : vector(x0 + r, y0), "end" : vector(x1 - r, y0) });
    skArc(sk, p ~ "c1", { "start" : vector(x1 - r, y0), "mid" : vector(x1 - 0.4 * r, y0 + 0.2 * r), "end" : vector(x1, y0 + r) });
    skLineSegment(sk, p ~ "r", { "start" : vector(x1, y0 + r), "end" : vector(x1, y1 - r) });
    skArc(sk, p ~ "c2", { "start" : vector(x1, y1 - r), "mid" : vector(x1 - 0.4 * r, y1 - 0.2 * r), "end" : vector(x1 - r, y1) });
    skLineSegment(sk, p ~ "t", { "start" : vector(x1 - r, y1), "end" : vector(x0 + r, y1) });
    skArc(sk, p ~ "c3", { "start" : vector(x0 + r, y1), "mid" : vector(x0 + 0.4 * r, y1 - 0.2 * r), "end" : vector(x0, y1 - r) });
    skLineSegment(sk, p ~ "l", { "start" : vector(x0, y1 - r), "end" : vector(x0, y0 + r) });
    skArc(sk, p ~ "c4", { "start" : vector(x0, y0 + r), "mid" : vector(x0 + 0.4 * r, y0 + 0.2 * r), "end" : vector(x0 + r, y0) });
}

// Coupler: one block around the peg with the horn-shaped pocket cut from its top: a convex hexagon (hub channel,
// then tapering like the arm), extended past the block's front and back so the pocket is open at both ends.
// Pocket first, then the peg bore (each its own subtraction along z).
function coupler(context is Context, id is Id, definition is map, withBore is boolean)
{
    const mm = millimeter;
    const s = sizes(definition);
    const W = s.cradleHalf;
    const F = s.pocketFront;
    const B = s.couplerBack;
    // The block is an extruded rounded rectangle (1 mm vertical edge radius): an arc profile, so pocket and bore are cut
    // in the one prism stack along z (a plain box routes to the drilled-box family, which refuses the pocket).
    var block = newSketchOnPlane(context, id + "blockSk", { "sketchPlane" : plane(vector(0 * mm, 0 * mm, s.z0), vector(0, 0, 1), vector(1, 0, 0)) });
    roundedRect(block, "outline", -W, F, W, B, 1 * mm);
    skSolve(block);
    opExtrude(context, id + "base", { "entities" : qSketchRegion(id + "blockSk"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : s.wallsTop - s.z0 });
    opDeleteBodies(context, id + "dropBlockSk", { "entities" : qCreatedBy(id + "blockSk", EntityType.BODY) });
    // Continue the taper past the front face by a sixth of the pocket length (keeps the slope 1:7 edge exact).
    const ext = definition.pocketLen / 6;
    const tipOut = definition.pocketTip - (s.channel - definition.pocketTip) * ext / definition.pocketLen;
    var pocket = newSketchOnPlane(context, id + "pocketSk", { "sketchPlane" : plane(vector(0 * mm, 0 * mm, s.capTop), vector(0, 0, 1), vector(1, 0, 0)) });
    skPolyline(pocket, "pocket", { "points" : [
        vector(-s.channel, B + 1 * mm), vector(-s.channel, 0 * mm), vector(-tipOut, F - ext), vector(tipOut, F - ext),
        vector(s.channel, 0 * mm), vector(s.channel, B + 1 * mm), vector(-s.channel, B + 1 * mm)] });
    skSolve(pocket);
    opExtrude(context, id + "pocket", { "entities" : qSketchRegion(id + "pocketSk"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : s.wallsTop - s.capTop + 1 * mm });
    opDeleteBodies(context, id + "dropPocketSk", { "entities" : qCreatedBy(id + "pocketSk", EntityType.BODY) });
    opBoolean(context, id + "cutPocket", { "targets" : qCreatedBy(id + "base", EntityType.BODY), "tools" : qCreatedBy(id + "pocket", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    if (withBore)
    {
        fCylinder(context, id + "bore", { "bottomCenter" : vector(0 * mm, 0 * mm, s.z0 - 1 * mm), "topCenter" : vector(0 * mm, 0 * mm, s.capTop + 1 * mm), "radius" : definition.pegFit / 2 });
        opBoolean(context, id + "cutBore", { "targets" : qCreatedBy(id + "base", EntityType.BODY), "tools" : qCreatedBy(id + "bore", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    }
}

function gate(context is Context, id is Id, definition is map, withHoles is boolean)
{
    const mm = millimeter;
    const s = sizes(definition);
    const cx = s.cx;
    const halfSpan = s.earOut + 4 * mm;
    fCuboid(context, id + "plate", { "corner1" : vector(cx - halfSpan, s.back, 0 * mm), "corner2" : vector(cx + halfSpan, s.back + 2 * mm, s.legTop) });
    if (withHoles)
    {
        const colX = s.earOut + 2 * mm;
        const screwZ = s.earTop / 2;
        fCylinder(context, id + "holeA", { "bottomCenter" : vector(cx - colX, s.back - 1 * mm, screwZ), "topCenter" : vector(cx - colX, s.back + 3 * mm, screwZ), "radius" : 1.2 * mm });
        fCylinder(context, id + "holeB", { "bottomCenter" : vector(cx + colX, s.back - 1 * mm, screwZ), "topCenter" : vector(cx + colX, s.back + 3 * mm, screwZ), "radius" : 1.2 * mm });
        opBoolean(context, id + "cut", { "targets" : qCreatedBy(id + "plate", EntityType.BODY), "tools" : qUnion([qCreatedBy(id + "holeA", EntityType.BODY), qCreatedBy(id + "holeB", EntityType.BODY)]), "operationType" : BooleanOperationType.SUBTRACTION });
    }
}

// SG90 with its single-arm horn, from the reference measurements above, seated in the bracket; hornEar sets the horn height.
// The arm outline is rounded outwards to straight edges (a conservative envelope of the real tapered arm with its d 3 tip).
function servoMock(context is Context, id is Id, definition is map, hornEar)
{
    const mm = millimeter;
    const s = sizes(definition);
    const cx = s.cx;
    const e = s.earTop;
    const caseStart = cx - definition.bodyL / 2;                     // the case end away from the shaft
    const hw = definition.bodyW / 2;
    fCuboid(context, id + "ears", { "corner1" : vector(caseStart - 4.7 * mm, -hw, e), "corner2" : vector(caseStart + definition.bodyL + 5.2 * mm, hw, e + definition.earT) });
    fCuboid(context, id + "caseUpper", { "corner1" : vector(caseStart, -hw, e + definition.earT), "corner2" : vector(caseStart + definition.bodyL, hw, e + 18.4 * mm) });
    fCuboid(context, id + "caseLower", { "corner1" : vector(caseStart, -hw, e - 4.3 * mm), "corner2" : vector(caseStart + definition.bodyL, hw, e) });
    fCylinder(context, id + "boss", { "bottomCenter" : vector(0 * mm, 0 * mm, e - 8.3 * mm), "topCenter" : vector(0 * mm, 0 * mm, e - 4.3 * mm), "radius" : 5.9 * mm });
    fCylinder(context, id + "bump", { "bottomCenter" : vector(-6.3 * mm, 0 * mm, e - 8.3 * mm), "topCenter" : vector(-6.3 * mm, 0 * mm, e - 4.3 * mm), "radius" : 2.5 * mm });
    const face = e - hornEar;
    fCylinder(context, id + "hub", { "bottomCenter" : vector(0 * mm, 0 * mm, face), "topCenter" : vector(0 * mm, 0 * mm, face + 5 * mm), "radius" : definition.hubR });
    var arm = newSketchOnPlane(context, id + "armSk", { "sketchPlane" : plane(vector(0 * mm, 0 * mm, face), vector(0, 0, 1), vector(1, 0, 0)) });
    skPolyline(arm, "arm", { "points" : [vector(-4, 0) * mm, vector(-1.5, -17) * mm, vector(-1.5, -18.5) * mm, vector(1.5, -18.5) * mm, vector(1.5, -17) * mm, vector(4, 0) * mm, vector(-4, 0) * mm] });
    skSolve(arm);
    opExtrude(context, id + "arm", { "entities" : qSketchRegion(id + "armSk"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : definition.armT });
    opDeleteBodies(context, id + "dropArmSk", { "entities" : qCreatedBy(id + "armSk", EntityType.BODY) });
}

// Convex boxes for the exact distance under a rotation: bracket pieces, coupler base, and the coupler walls as their
// bounding boxes (they contain the real walls, so a clear box means a clear wall).
function convexParts(context is Context, id is Id, definition is map)
{
    const mm = millimeter;
    const s = sizes(definition);
    const cx = s.cx;
    const halfSpan = s.earOut + 4 * mm;
    fCuboid(context, id + "plate", { "corner1" : vector(cx - halfSpan + 2 * mm, s.front - definition.margin, 0 * mm), "corner2" : vector(cx + halfSpan + definition.margin, s.back, definition.plateT) });
    for (var side in [-1, 1])
    {
        const n = side < 0 ? "A" : "B";
        const inner = cx + side * s.legIn;
        const mid = cx + side * s.earOut;
        const outer = cx + side * halfSpan;
        fCuboid(context, id + ("column" ~ n), { "corner1" : vector(min(mid, outer), s.front, 0 * mm), "corner2" : vector(max(mid, outer), s.back, s.legTop) });
        fCuboid(context, id + ("shelf" ~ n), { "corner1" : vector(min(inner, mid), s.front, s.shelfZ), "corner2" : vector(max(inner, mid), s.back, s.earTop) });
        fCuboid(context, id + ("cap" ~ n), { "corner1" : vector(min(inner, mid), s.front, s.grooveTop), "corner2" : vector(max(inner, mid), s.back, s.legTop) });
        fCuboid(context, id + ("stop" ~ n), { "corner1" : vector(min(inner, mid), s.front, s.earTop), "corner2" : vector(max(inner, mid), s.earFront, s.grooveTop) });
    }
    fCuboid(context, id + "cCap", { "corner1" : vector(-s.cradleHalf, s.pocketFront, s.z0), "corner2" : vector(s.cradleHalf, s.couplerBack, s.capTop) });
    fCuboid(context, id + "cProngA", { "corner1" : vector(-s.cradleHalf, s.pocketFront, s.capTop), "corner2" : vector(-definition.pocketTip, s.couplerBack, s.wallsTop) });
    fCuboid(context, id + "cProngB", { "corner1" : vector(definition.pocketTip, s.pocketFront, s.capTop), "corner2" : vector(s.cradleHalf, s.couplerBack, s.wallsTop) });
}

export enum SlidePart
{
    annotation { "Name" : "Bracket (glue to the wall)" } BRACKET,
    annotation { "Name" : "Peg coupler (glue onto the peg)" } COUPLER,
    annotation { "Name" : "Gate (screw on from behind)" } GATE,
    annotation { "Name" : "Fit check (all parts + SG90, nominal horn height)" } FIT,
    annotation { "Name" : "Fit check, horn at its lowest (horn-to-ear + tol)" } FIT_HORN_LOW,
    annotation { "Name" : "Fit check, horn at its highest (horn-to-ear - tol)" } FIT_HORN_HIGH,
    annotation { "Name" : "Fit check, jaw swung +22.6 deg" } FIT_SWING_POS,
    annotation { "Name" : "Fit check, jaw swung -22.6 deg" } FIT_SWING_NEG,
    annotation { "Name" : "Exploded view (servo and gate pulled out backwards)" } EXPLODED
}

annotation { "Feature Type Name" : "Jaw servo slide mount" }
export const jawSlideMount = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Part" } definition.part is SlidePart;
        annotation { "Name" : "Peg window (square)" } isLength(definition.pegD, PEG_D);
        annotation { "Name" : "Coupler bore" } isLength(definition.pegFit, PEG_FIT);
        annotation { "Name" : "Peg length" } isLength(definition.pegL, PEG_L);
        annotation { "Name" : "Room past the peg end" } isLength(definition.headroom, HEADROOM);
        annotation { "Name" : "Coupler depth below the peg end" } isLength(definition.capL, CAP_L);
        annotation { "Name" : "Air under the horn (lowest)" } isLength(definition.hornGap, HORN_GAP);
        annotation { "Name" : "Horn face to ear face (nominal)" } isLength(definition.hornEar, HORN_EAR);
        annotation { "Name" : "Horn height tolerance (+-)" } isLength(definition.hornTol, HORN_TOL);
        annotation { "Name" : "Horn hub radius" } isLength(definition.hubR, HUB_R);
        annotation { "Name" : "Horn arm thickness" } isLength(definition.armT, ARM_T);
        annotation { "Name" : "Play around the horn" } isLength(definition.fitClr, FIT_CLR);
        annotation { "Name" : "Pocket length in front of the shaft" } isLength(definition.pocketLen, POCKET_LEN);
        annotation { "Name" : "Pocket half width at the front" } isLength(definition.pocketTip, POCKET_TIP);
        annotation { "Name" : "Pocket wall thickness" } isLength(definition.wallT, WALL_T);
        annotation { "Name" : "Case length" } isLength(definition.bodyL, BODY_L);
        annotation { "Name" : "Case width" } isLength(definition.bodyW, BODY_W);
        annotation { "Name" : "Span over ears" } isLength(definition.earSpan, EAR_SPAN);
        annotation { "Name" : "Ear thickness" } isLength(definition.earT, EAR_T);
        annotation { "Name" : "Shaft offset from case centre" } isLength(definition.shaftOff, SHAFT_OFF);
        annotation { "Name" : "Plate thickness" } isLength(definition.plateT, PLATE_T);
        annotation { "Name" : "Glue flange" } isLength(definition.margin, MARGIN);
        annotation { "Name" : "Fit check: servo pulled back by" } isLength(definition.slideY, SLIDE_Y);
    }
    {
        const swing = definition.part == SlidePart.FIT_SWING_POS || definition.part == SlidePart.FIT_SWING_NEG;
        const exploded = definition.part == SlidePart.EXPLODED;
        const fit = definition.part == SlidePart.FIT || definition.part == SlidePart.FIT_HORN_LOW || definition.part == SlidePart.FIT_HORN_HIGH || exploded;
        if (definition.part == SlidePart.BRACKET || fit)
            bracket(context, id + "b", definition, !fit);
        if (definition.part == SlidePart.COUPLER || fit)
            coupler(context, id + "c", definition, !fit);
        if (definition.part == SlidePart.GATE || fit)
            gate(context, id + "g", definition, !fit);
        var hornEar = definition.hornEar;
        if (definition.part == SlidePart.FIT_HORN_LOW)
            hornEar = definition.hornEar + definition.hornTol;
        if (definition.part == SlidePart.FIT_HORN_HIGH)
            hornEar = definition.hornEar - definition.hornTol;
        if (fit || swing)
            servoMock(context, id + "s", definition, hornEar);
        if (fit && !exploded && definition.slideY > 0 * millimeter)
            opTransform(context, id + "slide", { "bodies" : qUnion([qCreatedBy(id + "s" + "ears", EntityType.BODY), qCreatedBy(id + "s" + "caseUpper", EntityType.BODY), qCreatedBy(id + "s" + "caseLower", EntityType.BODY), qCreatedBy(id + "s" + "boss", EntityType.BODY), qCreatedBy(id + "s" + "bump", EntityType.BODY), qCreatedBy(id + "s" + "hub", EntityType.BODY), qCreatedBy(id + "s" + "arm", EntityType.BODY)]), "transform" : toWorld(coordSystem(vector(0 * millimeter, definition.slideY, 0 * millimeter), vector(1, 0, 0), vector(0, 0, 1))) });
        if (exploded)
        {
            // Pull the servo 35 mm and the gate 55 mm out backwards (+y), the way they are slid in.
            opTransform(context, id + "pullServo", { "bodies" : qUnion([qCreatedBy(id + "s" + "ears", EntityType.BODY), qCreatedBy(id + "s" + "caseUpper", EntityType.BODY), qCreatedBy(id + "s" + "caseLower", EntityType.BODY), qCreatedBy(id + "s" + "boss", EntityType.BODY), qCreatedBy(id + "s" + "bump", EntityType.BODY), qCreatedBy(id + "s" + "hub", EntityType.BODY), qCreatedBy(id + "s" + "arm", EntityType.BODY)]), "transform" : toWorld(coordSystem(vector(0, 35, 0) * millimeter, vector(1, 0, 0), vector(0, 0, 1))) });
            opTransform(context, id + "pullGate", { "bodies" : qCreatedBy(id + "g" + "plate", EntityType.BODY), "transform" : toWorld(coordSystem(vector(0, 55, 0) * millimeter, vector(1, 0, 0), vector(0, 0, 1))) });
        }
        if (swing)
        {
            convexParts(context, id + "k", definition);
            // Swing the peg side (coupler, horn) about the peg axis by atan(5/12) = 22.6 deg, an exact rational rotation.
            const sign = definition.part == SlidePart.FIT_SWING_POS ? 1 : -1;
            opTransform(context, id + "swing", {
                "bodies" : qUnion([qCreatedBy(id + "k" + "cCap", EntityType.BODY), qCreatedBy(id + "k" + "cProngA", EntityType.BODY), qCreatedBy(id + "k" + "cProngB", EntityType.BODY), qCreatedBy(id + "s" + "hub", EntityType.BODY), qCreatedBy(id + "s" + "arm", EntityType.BODY)]),
                "transform" : toWorld(coordSystem(vector(0, 0, 0) * millimeter, vector(12, 5 * sign, 0), vector(0, 0, 1)))
            });
        }
    });
