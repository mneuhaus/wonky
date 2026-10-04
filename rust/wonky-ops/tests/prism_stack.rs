//! Booleans of line/arc prisms with a common extrusion axis: exact closed
//! forms from first principles (areas of discs, lenses and rectangles times
//! exact heights), replay binding, and named refusals for what stays out.
use wonky_contract::{Body, BodyKey};
use wonky_ops::{
    affine::Affine,
    analytic::{self, Solid},
    arc_profile, mesh, orthogonal,
};

fn key() -> BodyKey {
    BodyKey { id: [4, 1, 8, 2], revision: 0 }
}
fn wire(body: &Body) -> wonky_contract::CheckedBody {
    wonky_wire::v3::decode(&wonky_wire::v3::encode(body).unwrap()).unwrap()
}
fn solid(body: Body) -> Solid {
    analytic::audit(&wire(&body)).unwrap()
}
fn arcs(frame: Affine, lines: &[[f64; 4]], arcs: &[[f64; 6]], depth: f64) -> Solid {
    solid(arc_profile::build(key(), frame, lines, arcs, depth, false).unwrap())
}
/// Full circle as four three-point arcs through 3-4-5 points (exact for
/// r = 5 or 2.5 about integer centres).
fn disc(frame: Affine, c: [f64; 2], r: f64, depth: f64) -> Solid {
    let [x, y] = c;
    let p = |u: f64, v: f64| [x + r * u, y + r * v];
    let arc = |a: [f64; 2], m: [f64; 2], b: [f64; 2]| [a[0], a[1], m[0], m[1], b[0], b[1]];
    arcs(
        frame,
        &[],
        &[
            arc(p(1., 0.), p(0.8, 0.6), p(0., 1.)),
            arc(p(0., 1.), p(-0.6, 0.8), p(-1., 0.)),
            arc(p(-1., 0.), p(-0.8, -0.6), p(0., -1.)),
            arc(p(0., -1.), p(0.6, -0.8), p(1., 0.)),
        ],
        depth,
    )
}
/// Full circle as two three-point semicircles: the selected sketch region,
/// as the interpreter builds it for a two-arc circle.
fn disc2(frame: Affine, c: [f64; 2], r: f64, depth: f64) -> Solid {
    let [x, y] = c;
    let arcs = [[x + r, y, x, y + r, x - r, y], [x - r, y, x, y - r, x + r, y]];
    solid(arc_profile::build_region(key(), frame, &[], &arcs, depth, false, 0).unwrap())
}
fn cuboid(a: [f64; 3], b: [f64; 3]) -> Solid {
    solid(orthogonal::cuboid(key(), a, b).unwrap())
}
fn run(op: u8, bodies: &[Solid]) -> Solid {
    let mut out = analytic::boolean(key(), op, bodies).unwrap();
    assert_eq!(out.len(), 1);
    solid(out.remove(0))
}
fn refusal(op: u8, bodies: &[Solid]) -> String {
    analytic::boolean(key(), op, bodies).err().expect("refusal").0
}
fn measure(s: &Solid) -> serde_like::Json {
    serde_like::Json(s.measure(None, &[]).unwrap())
}
/// Minimal field reader; the measure JSON is produced by this crate.
mod serde_like {
    pub struct Json(pub String);
    impl Json {
        pub fn num(&self, field: &str) -> f64 {
            let at = self.0.find(&format!("\"{field}\":")).expect(field) + field.len() + 3;
            let rest = &self.0[at..];
            let end = rest.find(|c: char| c == ',' || c == '}').unwrap();
            rest[..end].parse().unwrap()
        }
        pub fn topo(&self, field: &str) -> i64 {
            let t = &self.0[self.0.find("\"topology\"").unwrap()..];
            let at = t.find(&format!("\"{field}\":")).unwrap() + field.len() + 3;
            let rest = &t[at..];
            let end = rest.find(|c: char| c == ',' || c == '}').unwrap();
            rest[..end].parse().unwrap()
        }
    }
}
fn near(actual: f64, expected: f64) {
    assert!((actual - expected).abs() <= expected.abs() * 1e-12, "{actual} != {expected}");
}
const PI: f64 = std::f64::consts::PI;
const MM3: f64 = 1e9;
fn stadium(depth: f64) -> Solid {
    // 20 x 10 rectangle with semicircular ends of radius 5: area 200 + 25 pi.
    arcs(
        Affine::IDENTITY,
        &[[-10., -5., 10., -5.], [10., 5., -10., 5.]],
        &[[10., -5., 15., 0., 10., 5.], [-10., 5., -15., 0., -10., -5.]],
        depth,
    )
}
fn rounded_rectangle(depth: f64) -> Solid {
    // [0,30] x [0,20] with corner radius 5 (mid points on 3-4-5 triangles):
    // area 600 - (4 - pi) 25.
    arcs(
        Affine::IDENTITY,
        &[[5., 0., 25., 0.], [30., 5., 30., 15.], [25., 20., 5., 20.], [0., 15., 0., 5.]],
        &[
            [25., 0., 28., 1., 30., 5.],
            [30., 15., 29., 18., 25., 20.],
            [5., 20., 2., 19., 0., 15.],
            [0., 5., 1., 2., 5., 0.],
        ],
        depth,
    )
}

/// Arc slot plate minus a blind box pocket from the top and a through window.
fn slot_plate_tools() -> [Solid; 3] {
    [stadium(4.), cuboid([-4., -2., 2.], [4., 2., 6.]), cuboid([-9., -1., -1.], [-7., 1., 5.])]
}
const SLOT_PLATE: f64 = (200. + 25. * PI) * 4. - 8. * 4. * 2. - 2. * 2. * 4.;

#[test]
fn arc_slot_plate_minus_box_pockets_is_exact() {
    let result = run(1, &slot_plate_tools());
    assert!(matches!(result, Solid::PrismStack(_)));
    let m = measure(&result);
    near(m.num("volumeMm3"), SLOT_PLATE * MM3);
    // Bottom and top (both around the window), 2 planar + 2 cylindrical
    // sides, pocket floor and 4 walls, 4 window walls; genus 1 (the window).
    assert_eq!(m.topo("faces"), 15);
    assert_eq!(m.topo("genus"), 1);
    let step = analytic::step(&[("plate".into(), result.clone())], "plate").unwrap();
    assert_eq!(step.matches("CYLINDRICAL_SURFACE").count(), 2);
    assert_eq!(step.matches("ADVANCED_FACE").count(), 15);
}

#[test]
fn stacked_prism_mesh_is_watertight_within_budget() {
    let body = analytic::boolean(key(), 1, &slot_plate_tools()).unwrap().remove(0);
    let deviation = 0.01;
    let m = mesh::tessellate(&wire(&body), deviation).unwrap();
    mesh::check_watertight(&m).unwrap();
    // Divergence theorem on the triangles: inscribed chords lose at most the
    // sagitta band, deviation times the curved side area (2 * pi * 5 m * 4 m).
    let mut volume = 0.;
    for t in &m.triangles {
        let [a, b, c] = t.map(|i| m.vertices[i]);
        volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0])
            + a[2] * (b[0] * c[1] - b[1] * c[0]))
            / 6.;
    }
    let exact = SLOT_PLATE * MM3;
    assert!(volume <= exact && exact - volume <= deviation * 2. * PI * 5e3 * 4e3, "{volume} vs {exact}");
    assert!(!mesh::binary_stl(&[m], deviation).unwrap().is_empty());
}

#[test]
fn rounded_rectangle_plate_union_box_rib_is_exact() {
    let plate = rounded_rectangle(3.);
    let rib = cuboid([5., 8., 2.], [25., 12., 10.]);
    let result = run(0, &[plate, rib]);
    let m = measure(&result);
    near(m.num("volumeMm3"), ((500. + 25. * PI) * 3. + 20. * 4. * 7.) * MM3);
    // Plate bottom, plate top around the rib, 4 planar + 4 cylindrical plate
    // sides, rib top and 4 rib sides.
    assert_eq!(m.topo("faces"), 15);
    assert_eq!(m.topo("genus"), 0);
}

#[test]
fn arc_prism_minus_arc_prism_is_exact_through_and_blind() {
    // Radius-5 discs 6 apart cross at (3, +-4): a lens of area
    // 2 (25 acos(3/5) - 3 * 4).
    let lens = 2. * (25. * (0.6f64).acos() - 12.);
    let through = run(1, &[disc(Affine::IDENTITY, [0., 0.], 5., 4.), {
        let mut f = Affine::IDENTITY;
        f.origin = [0., 0., -1.];
        disc2(f, [6., 0.], 5., 6.)
    }]);
    near(measure(&through).num("volumeMm3"), (25. * PI - lens) * 4. * MM3);
    // Four kept convex quarter pieces and the two concave halves of the
    // two-arc tool meet along plain generator lines, never seams.
    let step = analytic::step(&[("lune".into(), through.clone())], "lune").unwrap();
    assert_eq!(step.matches("CYLINDRICAL_SURFACE").count(), 6);
    assert_eq!(step.matches("SEAM_CURVE").count(), 0);
    let blind = run(1, &[disc(Affine::IDENTITY, [0., 0.], 5., 4.), {
        let mut f = Affine::IDENTITY;
        f.origin = [0., 0., 2.];
        disc(f, [6., 0.], 5., 6.)
    }]);
    let m = measure(&blind);
    near(m.num("volumeMm3"), (25. * PI * 4. - lens * 2.) * MM3);
    assert_eq!(m.topo("genus"), 0);
}

#[test]
fn curved_prism_boolean_with_coincident_sides_is_exact_not_chords() {
    // Quarter disc of radius 5 and a 2-cube sharing its x=0 and y=0 sides.
    let quarter = arcs(Affine::IDENTITY, &[[0., 5., 0., 0.], [0., 0., 5., 0.]], &[[5., 0., 3., 4., 0., 5.]], 2.);
    let cube = cuboid([0.; 3], [2.; 3]);
    let disc_part = 25. * PI / 4. * 2.;
    for (op, expected) in [(0, disc_part), (1, disc_part - 8.), (2, 8.)] {
        let r = run(op, &[quarter.clone(), cube.clone()]);
        near(measure(&r).num("volumeMm3"), expected * MM3);
    }
}

#[test]
fn stacked_result_is_a_replayed_operand_and_rejects_changed_caches() {
    let once = run(1, &slot_plate_tools());
    // (A - B) - C through the stacked operand equals the closed form.
    let twice = run(1, &[once.clone(), disc(Affine::IDENTITY, [10., 0.], 2.5, 4.)]);
    near(measure(&twice).num("volumeMm3"), (SLOT_PLATE - 6.25 * PI * 4.) * MM3);
    let Solid::PrismStack(s) = once else { panic!() };
    let mut body = s.body.clone();
    let p = body.vertices[0].point[0].get();
    body.vertices[0].point[0] = wonky_contract::Binary64::new(p + p.abs().max(1.) * 1e-12).unwrap();
    assert_eq!(analytic::audit(&wire(&body)).err().unwrap().0, "prism-stack/construction-mismatch");
}

#[test]
fn quadratic_circle_crossing_is_exact_and_cross_axis_prisms_still_refuse_by_name() {
    // Discs 7 apart cross at y = +-sqrt(12.75), stored exactly.
    let far = {
        let mut f = Affine::IDENTITY;
        f.origin = [0., 0., -1.];
        disc(f, [7., 0.], 5., 6.)
    };
    let difference = run(1, &[disc(Affine::IDENTITY, [0., 0.], 5., 4.), far]);
    let lens = 50. * 0.7_f64.acos() - 3.5 * 51_f64.sqrt();
    let exact = (25. * PI - lens) * 4. * MM3;
    near(measure(&difference).num("volumeMm3"), exact);
    let Solid::PrismStack(stack) = &difference else { panic!("quadratic stack") };
    let deviation = 0.1;
    let mesh = mesh::tessellate(&wire(&stack.body), deviation).unwrap();
    mesh::check_watertight(&mesh).unwrap();
    assert!((mesh_volume(&mesh) - exact).abs() <= deviation * 200e6);
    assert!(analytic::step(&[("lens-cut".into(), difference)], "lens-cut").unwrap().contains("CYLINDRICAL_SURFACE"));
    // A slot extruded along x cannot share the stadium's z-axis arrangement.
    let along_x = arcs(
        Affine { origin: [0., 0., 0.], x: [0., 1., 0.], z: [1., 0., 0.] },
        &[[-1., 0., 1., 0.], [1., 2., -1., 2.]],
        &[[1., 0., 2., 1., 1., 2.], [-1., 2., -2., 1., -1., 0.]],
        3.,
    );
    // Routed to the general Boolean (boolean3d G12): the stadium's exact
    // arc-prism Model now builds (half arcs framed off the chart pole), the
    // cross-axis operand reframes exactly (F2c: radical lines and planar arcs
    // map under the rational frame change), and the chart arrangement then
    // refuses by its own name.
    assert_eq!(refusal(1, &[stadium(4.), along_x]), "prism-stack/unresolved-cycle-orientation");
    // Disjoint union: two bodies are not one stacked solid.
    assert_eq!(refusal(0, &[stadium(4.), disc(Affine::IDENTITY, [40., 0.], 2.5, 4.)]), "prism-stack/multiple-result-bodies");
}

// ------------------------------------------------------------ revolve tools

/// Full-turn revolve about the local z axis through `c` (mode 2); the
/// meridian is (radius, height) in m, counter-clockwise.
fn revolve_z(c: [f64; 2], points: &[[f64; 2]]) -> Solid {
    let lines = (0..points.len())
        .map(|i| {
            let (a, b) = (points[i], points[(i + 1) % points.len()]);
            [a[0], a[1], b[0], b[1]]
        })
        .collect::<Vec<_>>();
    let frame = Affine { origin: [c[0], c[1], 0.], x: [1., 0., 0.], z: [0., 0., 1.] };
    solid(wonky_ops::revolve_full::build(key(), [0; 4], frame, 2, &lines, std::f64::consts::TAU).unwrap())
}
/// Countersink from the top of a z in [0, 4] plate: bore r 1 up to z 3, then
/// a 45 deg cone that leaves the top at r 2 (overruns to r 3 at z 5).
fn countersink(c: [f64; 2]) -> Solid {
    revolve_z(c, &[[0., -1.], [1., -1.], [1., 3.], [3., 5.], [0., 5.]])
}
/// Blind counterbore from the top: bore r 1 from z 1, step to r 2 at z 3.
fn counterbore(c: [f64; 2]) -> Solid {
    revolve_z(c, &[[0., 1.], [1., 1.], [1., 3.], [2., 3.], [2., 5.], [0., 5.]])
}

// ---------------------------------------------------------------- round leaves

/// A `Solid::Cylinder`: whole-circle profile in the stack, centre, levels and radius in metres like the other fixtures.
fn round(c: [f64; 2], z: [f64; 2], radius: f64) -> Solid {
    solid(
        wonky_ops::cylinder::create(
            key(),
            wonky_ops::cylinder::Spec { bottom: [c[0], c[1], z[0]], top: [c[0], c[1], z[1]], radius },
        )
        .unwrap(),
    )
}
/// Volume of the triangle soup by the divergence theorem.
fn mesh_volume(m: &mesh::Mesh) -> f64 {
    m.triangles
        .iter()
        .map(|t| {
            let [a, b, c] = t.map(|i| m.vertices[i]);
            (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6.
        })
        .sum()
}
fn stack_body(s: &Solid) -> Body {
    match s {
        Solid::PrismStack(p) => p.body.clone(),
        _ => panic!("not a stacked prism"),
    }
}

#[test]
fn disc_with_two_off_axis_bores_keeps_three_whole_circles() {
    // Three whole circles, none cut: bores 2 m off the axis of a radius-5 disc.
    let bored = run(1, &[round([0., 0.], [0., 4.], 5.), round([2., 0.], [-1., 5.], 1.), round([-2., 0.], [-1., 5.], 1.)]);
    assert!(matches!(bored, Solid::PrismStack(_)));
    let m = measure(&bored);
    near(m.num("volumeMm3"), (25. - 2.) * PI * 4. * MM3);
    // Bottom and top, the outer wall and one wall per bore.
    assert_eq!(m.topo("faces"), 5);
    assert_eq!(m.topo("genus"), 2);
    // Raw WC0 still has one seam per wall, two anchors and two ring edges.
    assert_eq!(stack_body(&bored).vertices.len(), 6);
    assert_eq!(stack_body(&bored).edges.len(), 9);
    // Native measurements quotient chart seams, as full-turn revolutions do.
    assert_eq!(m.topo("vertices"), 0);
    assert_eq!(m.topo("edges"), 6);
    assert_eq!(m.topo("loops"), 12);
    assert_eq!(m.topo("ringEdges"), 6);
    let step = analytic::step(&[("bored".into(), bored.clone())], "bored").unwrap();
    assert_eq!(step.matches("CYLINDRICAL_SURFACE").count(), 3);
    assert_eq!(step.matches("SEAM_CURVE").count(), 3);
    assert_eq!(step.matches("ADVANCED_FACE").count(), 5);
    // The audit replays the construction: the served body is the exact one.
    assert!(matches!(analytic::audit(&wire(&stack_body(&bored))).unwrap(), Solid::PrismStack(_)));
}

#[test]
fn disc_with_square_pocket_and_boss_is_exact_with_a_watertight_mesh() {
    // A square through hole inside a radius-5 disc: the ring stays whole beside line pieces.
    let holed = run(1, &[round([0., 0.], [0., 4.], 5.), cuboid([-1., -1., -1.], [1., 1., 5.])]);
    let m = measure(&holed);
    near(m.num("volumeMm3"), (25. * PI - 4.) * 4. * MM3);
    assert_eq!(m.topo("faces"), 7);
    assert_eq!(m.topo("genus"), 1);
    // A square boss on the disc top.
    let boss = run(0, &[round([0., 0.], [0., 4.], 5.), cuboid([-1., -1., 4.], [1., 1., 8.])]);
    let m = measure(&boss);
    near(m.num("volumeMm3"), (25. * PI * 4. + 16.) * MM3);
    assert_eq!(m.topo("faces"), 8);
    assert_eq!(m.topo("genus"), 0);
    let deviation = 0.01;
    let mesh = mesh::tessellate(&wire(&stack_body(&boss)), deviation).unwrap();
    mesh::check_watertight(&mesh).unwrap();
    let exact = (25. * PI * 4. + 16.) * MM3;
    let volume = mesh_volume(&mesh);
    // Inscribed chords lose at most the sagitta band of the curved wall.
    assert!(volume <= exact && exact - volume <= deviation * 2. * PI * 5e3 * 4e3, "{volume} vs {exact}");
    assert!(!mesh::binary_stl(&[mesh], deviation).unwrap().is_empty());
}

#[test]
fn stacked_coincident_rings_merge_and_a_crossing_box_cuts_them_once() {
    // Two radius-5 discs one above the other share their circle; a box crossing the rim at
    // (3, +-4) leaves that circle in two arcs and no ring.
    let union = run(0, &[round([0., 0.], [0., 2.], 5.), round([0., 0.], [2., 4.], 5.), cuboid([3., -4., 0.], [8., 4., 4.])]);
    let segment = 25. * (0.6f64).acos() - 12.;
    near(measure(&union).num("volumeMm3"), (25. * PI * 4. + (40. - segment) * 4.) * MM3);
}

#[test]
fn round_leaf_planted_negatives_and_no_claims_keep_their_names() {
    // A binary64 tilt is no isometry the arrangement can carry exactly.
    let tilted = solid(match round([6., 0.], [-1., 5.], 5.) {
        Solid::Cylinder(c) => {
            let (s, cos) = (0.1f64.sin(), 0.1f64.cos());
            wonky_ops::cylinder::transform(&c, Affine { origin: [0., 0., 0.], x: [1., 0., 0.], z: [0., -s, cos] }).unwrap()
        }
        _ => unreachable!(),
    });
    let disc = round([0., 0.], [0., 4.], 5.);
    assert_eq!(
        refusal(1, &[disc.clone(), cuboid([-1., -1., -1.], [1., 1., 5.]), tilted]),
        "prism-stack/non-isometric-frame-relation"
    );
    // The general arrangement now retains exact irrational crossings for both
    // the union and a subtraction alongside a separate blind round pocket.
    let bar = || cuboid([3.5, -1., 0.], [9., 1., 4.]);
    let clipped_bar = 24_f64.sqrt() + 25. * 0.2_f64.asin() - 7.;
    let joined = run(0, &[disc.clone(), bar()]);
    near(measure(&joined).num("volumeMm3"), (25. * PI + 11. - clipped_bar) * 4. * MM3);
    // An entirely internal tool still creates an unsupported enclosed void.
    assert_eq!(refusal(1, &[disc.clone(), bar(), round([-2., 0.], [1., 3.], 1.)]), "prism-stack/enclosed-void");
    let crossing = run(1, &[disc, bar(), round([-2., 0.], [1., 4.], 1.)]);
    near(measure(&crossing).num("volumeMm3"), (97. * PI - 4. * clipped_bar) * MM3);
}

#[test]
fn coaxial_countersink_and_counterbore_in_curved_plate_are_exact() {
    let plate = (200. + 25. * PI) * 4.;
    // Bore pi * 1 * 3 plus frustum pi * 1 * (1 + 2 + 4) / 3 inside the plate.
    let sunk = run(1, &[stadium(4.), countersink([2., 0.])]);
    assert!(matches!(sunk, Solid::PrismStack(_)));
    let m = measure(&sunk);
    near(m.num("volumeMm3"), (plate - 16. * PI / 3.) * MM3);
    // 6 plate faces + two bore halves + two cone halves, one through hole.
    assert_eq!(m.topo("faces"), 10);
    assert_eq!(m.topo("genus"), 1);
    let step = analytic::step(&[("sunk".into(), sunk.clone())], "sunk").unwrap();
    assert_eq!(step.matches("CONICAL_SURFACE").count(), 2);
    assert_eq!(step.matches("CYLINDRICAL_SURFACE").count(), 4);
    // A blind counterbore through the replayed stack: bore pi * 1 * 2 and
    // step pi * 4 * 1; a floor disc and a step annulus face up.
    let both = run(1, &[sunk, counterbore([-5., 0.])]);
    let m = measure(&both);
    near(m.num("volumeMm3"), (plate - 16. * PI / 3. - 6. * PI) * MM3);
    assert_eq!(m.topo("faces"), 16);
    assert_eq!(m.topo("genus"), 1);
    // Divergence theorem on the mesh: inscribed rings of the plate and the
    // holes shift volume by at most the deviation band over the curved area
    // (below 500 m^2).
    let Solid::PrismStack(s) = both else { panic!() };
    let deviation = 0.1;
    let mesh = mesh::tessellate(&wire(&s.body), deviation).unwrap();
    mesh::check_watertight(&mesh).unwrap();
    assert!(mesh.faces.windows(2).all(|f| f[0] <= f[1]), "deferred caps must preserve B-rep face order");
    let (v, exact) = (mesh_volume(&mesh), (plate - 16. * PI / 3. - 6. * PI) * MM3);
    assert!((exact - v).abs() <= deviation * 500e6, "{v} vs {exact}");
}

#[test]
fn tools_in_opposite_walls_overlap_in_plan_but_not_in_level() {
    // Stadium z in [0, 10] minus a box cavity z in [1, 9] open through
    // y = 5: a bottom and a top wall. A countersink from inside each wall,
    // 1 m apart in plan (their discs overlap), each cone crossing the
    // cavity level where it is clipped: bore pi/8 + frustum 7 pi/24 each.
    let cavity = cuboid([-8., -3., 1.], [8., 6., 9.]);
    let bottom = revolve_z([1., 0.], &[[0., -1.], [0.5, -1.], [0.5, 0.5], [1.5, 1.5], [0., 1.5]]);
    let top = revolve_z([2., 0.], &[[0., 8.5], [1.5, 8.5], [0.5, 9.5], [0.5, 11.], [0., 11.]]);
    let shell = run(1, &[stadium(10.), cavity]);
    let result = run(1, &[run(1, &[shell, bottom]), top]);
    let m = measure(&result);
    near(m.num("volumeMm3"), ((200. + 25. * PI) * 10. - 16. * 8. * 8. - 5. * PI / 6.) * MM3);
    assert_eq!(m.topo("genus"), 2);
}

#[test]
fn planted_tool_contacts_still_refuse_by_name() {
    // The cone's reach touches the stadium's cylindrical end: a conic trim.
    assert_eq!(refusal(1, &[stadium(4.), countersink([12., 0.])]), "prism-stack/tool-crosses-boundary");
    // Overlapping tools in one level range.
    let once = run(1, &[stadium(4.), countersink([0., 0.])]);
    assert_eq!(refusal(1, &[once, countersink([4., 0.])]), "prism-stack/tool-overlap");
    // A revolve about x is not coaxial with the stadium's z extrusion. The
    // general Boolean takes the stadium as an exact arc-prism Model; the
    // rulings its planes cut are clipped in their charts (boolean3d G12b),
    // and the stadium's arc walls against the revolve's cylinder (crossed
    // axes) are refused by name.
    let lines = [[0., -1., 1., -1.], [1., -1., 1., 5.], [1., 5., 0., 5.], [0., 5., 0., -1.]];
    let across = solid(wonky_ops::revolve_full::build(key(), [0; 4], Affine::IDENTITY, 0, &lines, std::f64::consts::TAU).unwrap());
    assert_eq!(refusal(1, &[stadium(4.), across]), "boolean/ssi-row-unavailable:revolution×revolution/non-parallel-or-metric");
    // Only subtracted tools enter the stack; the union's family refusal routes
    // to the general Boolean (boolean3d G12), which now sews partial circles
    // (G12b) and refuses the stadium's arc wall against the parallel, offset
    // bore cylinder by name.
    assert_eq!(refusal(0, &[stadium(4.), countersink([2., 0.])]), "boolean/ssi-row-unavailable:revolution×revolution/parallel-offset");
}

/// The column owner's overlap limit is not a limit of the shared arrangement.
/// Lens area of r=5 discs at distance 6: 50 acos(3/5) - 24.
#[test]
fn overlapping_bosses_route_from_source_geometry() {
    let boss = |x| solid(wonky_ops::cylinder::create(key(), wonky_ops::cylinder::Spec {
        bottom: [x, 0., 1.], top: [x, 0., 4.], radius: 5.,
    }).unwrap());
    let out = run(0, &[cuboid([-10., -10., 0.], [10., 10., 2.]), boss(-3.), boss(3.)]);
    let measured = measure(&out);
    let expected = (848. + 100. * std::f64::consts::PI - 100. * 0.6f64.acos()) * 1e9;
    let actual = measured.num("volumeMm3");
    assert!((actual - expected).abs() < expected * 1e-12, "{actual} != {expected}");
    assert!(matches!(out, Solid::PrismStack(_)));
    let step = analytic::step(&[("overlapping-bosses".into(), out)], "overlapping-bosses").unwrap();
    assert!(step.contains("CYLINDRICAL_SURFACE("));
}

/// Empty and non-manifold results are proved verdicts, not missing carriers.
/// Dispatch must preserve them even when the sources also admit a stack.
#[test]
fn exact_geometric_verdicts_are_terminal_across_boolean_mechanisms() {
    use wonky_ops::polyhedron::RefusalKind;
    let a = || cuboid([0., 0., 0.], [2., 2., 2.]);
    for (op, other, expected) in [
        (0, cuboid([2., 2., 0.], [4., 4., 2.]), "orthogonal/non-manifold-result"),
        (2, cuboid([2., 0., 0.], [4., 2., 2.]), "orthogonal/empty-result"),
        (1, a(), "orthogonal/empty-result"),
    ] {
        let error = analytic::boolean(key(), op, &[a(), other]).unwrap_err();
        assert_eq!(error.0, expected);
        assert_eq!(error.1, RefusalKind::GeometricVerdict);
    }
}

#[test]
fn periodic_window_pcurves_match_their_3d_edges_across_the_seam() {
    use wonky_contract::{CurveGeometry, SurfaceGeometry, PcurveGeometry, Limit};
    let body = analytic::boolean(key(), 1, &[
        round([0.,0.], [0.,0.030], 0.005),
        cuboid([0.003,-0.003,0.008], [0.007,0.003,0.022]),
    ]).unwrap().remove(0);
    let mut checked = 0;
    for pc in &body.pcurves {
        let CurveGeometry::Circle { origin: co, x: cx, radius: cr, .. } = &body.curves[pc.curve.0 as usize].geometry else { continue };
        let SurfaceGeometry::Cylinder { origin: so, x: sx, radius: sr, .. } = &body.surfaces[pc.surface.0 as usize].geometry else { continue };
        let PcurveGeometry::Line { a, b } = &pc.geometry else { panic!("cylinder chart must be unrolled") };
        let Limit::Finite { value: end, .. } = body.curves[pc.curve.0 as usize].domain.upper else { panic!() };
        for fraction in [0.,0.25,0.5,0.75,1.] {
            let t = end.get() * fraction * 2. * PI;
            let u = (a[0].get() + fraction * (b[0].get() - a[0].get())) * 2. * PI;
            let cv = [co[0].get()+cr.get()*(cx[0].get()*t.cos()-cx[1].get()*t.sin()),
                co[1].get()+cr.get()*(cx[1].get()*t.cos()+cx[0].get()*t.sin()),co[2].get()];
            let sv = [so[0].get()+sr.get()*(sx[0].get()*u.cos()-sx[1].get()*u.sin()),
                so[1].get()+sr.get()*(sx[1].get()*u.cos()+sx[0].get()*u.sin()),
                so[2].get()+a[1].get()+fraction*(b[1].get()-a[1].get())];
            for j in 0..3 { assert!((cv[j]-sv[j]).abs()<1e-12,"pc={pc:?}: {cv:?} != {sv:?}"); }
        }
        checked += 1;
    }
    assert!(checked >= 4);
}

#[test]
fn owner_handoff_preserves_resolution_refusal() {
    assert_eq!(refusal(1, &[
        round([0.,0.], [0.,4.], 2.),
        cuboid([-3., 2.-2f64.powi(-40), 1.], [3.,3.,5.]),
    ]), "curve2/sub-resolution-feature");
}
