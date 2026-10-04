//! boolean3d G13: placement closure. `transform` and `pattern` of a general
//! Boolean Model compose one exact map: the replayed Model is moved by the
//! product of the binary64 coefficient matrices, evaluated in Q and never
//! rounded in between. Expected placements are products computed here from
//! the request coefficients; expected measures are closed forms.
//!
//! Planted negative: `--features plant_placement_f64_compose` rounds the
//! composed map to binary64 and fails
//! `transform_then_pattern_of_a_model_composes_one_exact_map`.
use num_rational::BigRational as Q;
use wonky_contract::{BodyKey, Frame as WireFrame};
use wonky_geom::frame::Frame;
use wonky_ops::{
    affine::Affine,
    analytic::{self, Solid},
    cylinder::{self, Spec},
    model_boolean, orthogonal, polyhedron,
    placement::Post,
};

fn key(revision: u32) -> BodyKey {
    BodyKey { id: [13, 1, 2, 3], revision }
}
fn audit(body: wonky_contract::Body) -> Solid {
    analytic::audit(&body.check().unwrap()).unwrap()
}
fn cuboid(lo: [f64; 3], hi: [f64; 3]) -> Solid {
    Solid::Planar(polyhedron::audit(&orthogonal::cuboid(key(0), lo, hi).unwrap().check().unwrap()).unwrap())
}
/// AC66's construction in metres (as in general_routing.rs): box 32 x 18 x
/// 10 mm, a through bore r 2 at (8, 9), then a pocket [20,28] x [4,14] x
/// [6,12]. Volume 5440 - 40 pi mm^3; a curved general-Boolean Model.
fn drilled() -> Solid {
    let base = cuboid([0.; 3], [0.032, 0.018, 0.010]);
    let c = cylinder::audit(&cylinder::create(key(0), Spec { bottom: [0.008, 0.009, -0.001], top: [0.008, 0.009, 0.011], radius: 0.002 }).unwrap().check().unwrap()).unwrap();
    let once = analytic::boolean(key(0), 1, &[base, Solid::Cylinder(c)]).unwrap();
    let pocket = cuboid([0.020, 0.004, 0.006], [0.028, 0.014, 0.012]);
    let out = analytic::boolean(key(0), 1, &[audit(once[0].clone()), pocket]).unwrap();
    let solid = audit(out[0].clone());
    assert!(solid.curved_model(), "the source is a curved general-Boolean Model");
    solid
}
/// Two overlapping unit cubes (metres): a planar rule-6 Model, volume 1.5 m^3.
fn planar_model() -> Solid {
    let a = |lo: [f64; 3], hi| polyhedron::audit(&orthogonal::cuboid(key(0), lo, hi).unwrap().check().unwrap()).unwrap();
    let mut cache = model_boolean::ReplayCache::default();
    let b = model_boolean::boolean(key(0), 0, &[a([0.; 3], [1.; 3]), a([0.5, 0., 0.], [1.5, 1., 1.])], &mut cache).unwrap();
    let solid = audit(b);
    assert!(matches!(solid, Solid::Model(..)) && !solid.curved_model());
    solid
}
fn frames() -> [Affine; 3] {
    let (c, s) = (0.3f64.cos(), 0.3f64.sin());
    [
        Affine::IDENTITY,
        Affine { origin: [0.06553625, -0.0327685, 0.016384125], x: [0., 0., 1.], z: [0., -1., 0.] },
        // A binary64 rotation: its exact product with any further map has
        // more significant bits than binary64 holds.
        Affine { origin: [-0.031, 0.012, 0.007], x: [c, s, 0.], z: [0., 0., 1.] },
    ]
}
fn q(x: f64) -> Q {
    Q::from_float(x).unwrap()
}
fn cross(a: &[Q; 3], b: &[Q; 3]) -> [Q; 3] {
    [&a[1] * &b[2] - &a[2] * &b[1], &a[2] * &b[0] - &a[0] * &b[2], &a[0] * &b[1] - &a[1] * &b[0]]
}
/// An interpreter image `origin + q.x x + q.y (z cross x) + q.z z`, exactly.
fn interpreter(a: &Affine) -> Frame {
    let (x, z) = (a.x.map(q), a.z.map(q));
    let y = cross(&z, &x);
    Frame::new(a.origin.map(q), [x, y, z]).unwrap()
}
/// A pattern image `translation + rows q`, exactly.
fn rows(translation: [f64; 3], rows: [[f64; 3]; 3]) -> Frame {
    Frame::new(translation.map(q), [0, 1, 2].map(|j| [0, 1, 2].map(|k| q(rows[k][j])))).unwrap()
}
/// `f` applied after `p`.
fn after(f: &Frame, p: &Frame) -> Frame {
    Frame::new(f.point(p.origin()), p.columns().clone().map(|c| f.vector(&c))).unwrap()
}
fn model(s: &Solid) -> wonky_geom::model::Model {
    assert!(matches!(s, Solid::Model(..)), "a placed Model stays a replay-owned Model");
    s.model().unwrap()
}
fn number(json: &str, field: &str) -> f64 {
    let at = json.find(&format!("\"{field}\":")).unwrap_or_else(|| panic!("{field} in {json}")) + field.len() + 3;
    let end = json[at..].find(|c: char| c == ',' || c == '}' || c == ']').unwrap() + at;
    json[at..end].parse().unwrap()
}
fn triple(json: &str, field: &str) -> [f64; 3] {
    let at = json.find(&format!("\"{field}\":[")).unwrap_or_else(|| panic!("{field} in {json}")) + field.len() + 4;
    let end = json[at..].find(']').unwrap() + at;
    let v: Vec<f64> = json[at..end].split(',').map(|x| x.parse().unwrap()).collect();
    [v[0], v[1], v[2]]
}
fn close(got: f64, want: f64) {
    assert!((got - want).abs() <= 1e-9 * (1. + want.abs()), "{got} vs {want}");
}
fn place(s: &Solid, post: &Post) -> Result<Solid, String> {
    let Solid::Model(a, _) = s else { panic!("Model operand") };
    model_boolean::place(a, key(7), post).map(audit).map_err(|e| e.0)
}
const SHIFT: [f64; 3] = [0.04, 0.0003, -0.0001];
const ID: [[f64; 3]; 3] = [[1., 0., 0.], [0., 1., 0.], [0., 0., 1.]];

#[test]
fn transform_then_pattern_of_a_model_composes_one_exact_map() {
    let pi = std::f64::consts::PI;
    let source = drilled();
    let m0 = model(&source);
    let p0 = m0.draft().placement.clone();
    for f in frames() {
        // opTransform, then an AC71-style translation pattern of the moved Model.
        let moved = audit(source.transform(f).unwrap());
        let copied = place(&moved, &Post::Rows { translation: SHIFT, rows: ID }).unwrap();
        for (solid, want) in [(&moved, after(&interpreter(&f), &p0)), (&copied, after(&rows(SHIFT, ID), &after(&interpreter(&f), &p0)))] {
            let m = model(solid);
            assert!(solid.curved_model());
            // The exact product, never a rounded intermediate map.
            assert_eq!(m.draft().placement, want, "placement in {f:?}");
            // Only the placement moves: the chart-local Model is the source's.
            assert_eq!(m.canonical(), m0.canonical());
        }
        // Closed forms of the copy: volume, and the source centroid mapped by
        // the frame and then shifted by the pattern translation.
        let m = copied.measure(None, &[]).unwrap();
        let volume = 5440. - 40. * pi;
        close(number(&m, "volumeMm3"), volume);
        let moment = |v: f64, c: [f64; 3]| c.map(|x| v * x);
        let (b, h, p) = (moment(5760., [16., 9., 5.]), moment(40. * pi, [8., 9., 5.]), moment(320., [24., 9., 8.]));
        let local: [f64; 3] = std::array::from_fn(|k| (b[k] - h[k] - p[k]) / volume);
        let y = [f.z[1] * f.x[2] - f.z[2] * f.x[1], f.z[2] * f.x[0] - f.z[0] * f.x[2], f.z[0] * f.x[1] - f.z[1] * f.x[0]];
        let got = triple(&m, "centroidMm");
        for k in 0..3 {
            close(got[k], 1000. * (f.origin[k] + SHIFT[k]) + local[0] * f.x[k] + local[1] * y[k] + local[2] * f.z[k]);
        }
        let step = analytic::step(&[("copy".into(), copied.clone())], "g13").unwrap();
        assert!(step.contains("CYLINDRICAL_SURFACE") && step.contains("CIRCLE(") && !step.contains("B_SPLINE"));
    }
}

#[test]
fn placements_chain_without_rounding_and_replay_once_per_node() {
    // Three placements in a row: the result is the exact product of all
    // three, and replaying the wire body rebuilds the same body.
    let [_, a, b] = frames();
    let source = drilled();
    let p0 = model(&source).draft().placement.clone();
    let one = audit(source.transform(a).unwrap());
    let two = place(&one, &Post::Rows { translation: SHIFT, rows: ID }).unwrap();
    let three = audit(two.transform(b).unwrap());
    let want = after(&interpreter(&b), &after(&rows(SHIFT, ID), &after(&interpreter(&a), &p0)));
    assert_eq!(model(&three).draft().placement, want);
    let Solid::Model(view, _) = &three else { unreachable!() };
    let again = audit(view.body.clone());
    assert_eq!(model(&again).canonical(), model(&three).canonical());
    assert_eq!(model(&again).draft().placement, want);
}

#[test]
fn a_placed_model_is_a_later_boolean_operand() {
    // A pocket on the translated copy, placed where the copy is: the general
    // Boolean replays the placement node inside its own DAG.
    let pi = std::f64::consts::PI;
    let copy = place(&drilled(), &Post::Rows { translation: [0.04, 0., 0.], rows: ID }).unwrap();
    let pocket = cuboid([0.040, 0.0, 0.008], [0.044, 0.004, 0.012]);
    let out = analytic::boolean(key(9), 1, &[copy, pocket]).unwrap();
    assert_eq!(out.len(), 1);
    let m = audit(out[0].clone()).measure(None, &[]).unwrap();
    let volume = 5440. - 40. * pi - 32.;
    close(number(&m, "volumeMm3"), volume);
    // The removed 2 x 2 x 2 corner lowers the centroid x of the copy.
    let x = (5760. * 56. - 40. * pi * 48. - 320. * 64. - 32. * 42.) / volume;
    close(triple(&m, "centroidMm")[0], x);
}

#[test]
fn the_host_pattern_request_serves_a_model() {
    let source = drilled();
    let p0 = model(&source).draft().placement.clone();
    let Solid::Model(a, _) = &source else { unreachable!() };
    let reply = host_pattern(&wonky_wire::v3::encode(&a.body).unwrap(), SHIFT);
    let solid = analytic::audit(&wonky_wire::v3::decode(&reply).unwrap()).unwrap();
    assert_eq!(model(&solid).draft().placement, after(&rows(SHIFT, ID), &p0));
}

#[test]
fn a_placed_planar_model_keeps_its_planar_consumers() {
    let f = frames()[2];
    let moved = audit(planar_model().transform(f).unwrap());
    assert!(!moved.curved_model());
    let Solid::Model(view, _) = &moved else { panic!("Model") };
    // The exact planar observation in the placed frame: source extents.
    assert_eq!(moved.extents().unwrap(), [1500., 1000., 1000.]);
    let m = moved.measure(None, &[]).unwrap();
    close(number(&m, "volumeMm3"), 1.5e9);
    // Closed-form extents: the 1.5 x 1 x 1 m block rotated about z.
    let (lo, hi) = (triple(&m, "min"), triple(&m, "max"));
    let corners: Vec<[f64; 2]> = (0..4).map(|i| {
        let (u, v) = (1.5 * (i & 1) as f64, ((i >> 1) & 1) as f64);
        [1000. * (f.origin[0] + u * f.x[0] - v * f.x[1]), 1000. * (f.origin[1] + u * f.x[1] + v * f.x[0])]
    }).collect();
    for k in 0..2 {
        close(lo[k], corners.iter().map(|c| c[k]).fold(f64::INFINITY, f64::min));
        close(hi[k], corners.iter().map(|c| c[k]).fold(f64::NEG_INFINITY, f64::max));
    }
    assert!(analytic::step(&[("planar".into(), moved.clone())], "g13").unwrap().contains("MANIFOLD_SOLID_BREP"));
    let mesh = wonky_ops::mesh::tessellate(&view.body.clone().check().unwrap(), 1e-8).unwrap();
    wonky_ops::mesh::check_watertight(&mesh).unwrap();
}

#[test]
fn singular_and_reflecting_maps_refuse_by_name() {
    let source = drilled();
    // det 0: the first two columns are equal.
    let singular = [[1., 1., 0.], [0., 0., 0.], [0., 0., 1.]];
    assert_eq!(place(&source, &Post::Rows { translation: [0.; 3], rows: singular }).unwrap_err(), "pattern/metric-not-near-isometric");
    // A mirror is isometric, but a moved Model never reverses its faces.
    let mirror = [[1., 0., 0.], [0., 1., 0.], [0., 0., -1.]];
    assert_eq!(place(&source, &Post::Rows { translation: [0.; 3], rows: mirror }).unwrap_err(), "model/placement-reflection");
    // A singular map written straight into the wire body (past the metric
    // gate of `place`) is not admitted as a body at all.
    let Solid::Model(a, _) = place(&source, &Post::Rows { translation: SHIFT, rows: ID }).unwrap() else { unreachable!() };
    let mut body = a.body.clone();
    let Some(WireFrame::AffineImage { rows, .. }) = body.frames.last_mut() else { panic!("image frame") };
    rows[1] = rows[0].clone();
    assert_eq!(body.check().unwrap_err(), wonky_contract::ContractError::Invalid("singular affine image"));
}

#[test]
fn tampered_placements_are_refused_not_trusted() {
    let Solid::Model(a, _) = place(&drilled(), &Post::Rows { translation: SHIFT, rows: ID }).unwrap() else { unreachable!() };
    // The placement node must sit on an image frame of its parent's frame.
    let mut body = a.body.clone();
    let last = body.constructions.len() - 1;
    body.constructions[last].frame = body.constructions[last - 1].frame;
    assert!(body.check().is_err(), "a placement node off its image frame is not a body");
    // The observation is rebuilt from the construction, never read back.
    let mut body = a.body.clone();
    let p = &mut body.vertices[0].point;
    p[0] = wonky_contract::Binary64::new(p[0].get() + 1e-6).unwrap();
    assert_eq!(analytic::audit(&body.check().unwrap()).unwrap_err().0, "boolean/contract-violation:observation-cache");
}

/// One host pattern request: `words` copied by `translation`, reply words.
fn host_pattern(words: &[u32], translation: [f64; 3]) -> Vec<u32> {
    use wonky_ops::host::{host_op, MAGIC, OP_PATTERN, STATUS_OK, VERSION};
    let mut request = vec![MAGIC, VERSION, OP_PATTERN, words.len() as u32];
    request.extend(words);
    request.extend([13, 1, 2, 3, 4]);
    for x in [ID[0], ID[1], ID[2], translation].concat() {
        let b = x.to_bits();
        request.extend([b as u32, (b >> 32) as u32]);
    }
    let reply = host_op(&request);
    assert_eq!(reply[0], STATUS_OK, "{}", reply[1..].iter().filter_map(|&c| char::from_u32(c)).collect::<String>());
    reply[1..].to_vec()
}

#[test]
fn a_patterned_revolve_is_read_through_its_exactly_moved_source_model() {
    // AC74's countersink (bore r 2 at (16, 12) mm, cone to r 4), patterned
    // twice by 4 mm along x through the host. A revolve owns no placement:
    // each copy keeps its source and is read through its moved Model. Cut
    // from the box [0,32] x [0,24] x [0,8], the removed 128 pi / 3 mm^3 is
    // centred at x = 24, not at the source's x = 16.
    let pi = std::f64::consts::PI;
    let p = [[0., -0.001], [0.002, -0.001], [0.002, 0.006], [0.004, 0.008], [0.004, 0.010], [0., 0.010]];
    let segments = (0..p.len()).map(|i| { let (a, b) = (p[i], p[(i + 1) % p.len()]); [a[0], a[1], b[0], b[1]] }).collect::<Vec<_>>();
    let source = wonky_ops::revolve_full::build(key(0), [0; 4], Affine { origin: [0.016, 0.012, 0.], ..Affine::IDENTITY }, 2, &segments, std::f64::consts::TAU).unwrap();
    assert!(matches!(audit(source.clone()), Solid::Revolved(_)));
    let once = host_pattern(&wonky_wire::v3::encode(&source).unwrap(), [0.004, 0., 0.]);
    let twice = host_pattern(&once, [0.004, 0., 0.]);
    let tool = analytic::audit(&wonky_wire::v3::decode(&twice).unwrap()).unwrap();
    assert!(matches!(tool, Solid::Placed(_)), "a patterned revolve is read through its Model");
    let out = analytic::boolean(key(9), 1, &[cuboid([0.; 3], [0.032, 0.024, 0.008]), tool]).unwrap();
    let m = audit(out[0].clone()).measure(None, &[]).unwrap();
    let removed = 128. * pi / 3.;
    close(number(&m, "volumeMm3"), 6144. - removed);
    close(triple(&m, "centroidMm")[0], (6144. * 16. - removed * 24.) / (6144. - removed));
}
