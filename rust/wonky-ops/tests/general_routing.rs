//! boolean3d G12: family capability refusals routed to the general exact
//! Boolean. Expected values are independent closed forms (box, cylinder and
//! pocket volumes, areas and first moments), never a second run of the
//! constructor under test.
use wonky_contract::BodyKey;
use wonky_ops::{
    affine::Affine,
    analytic::{self, Solid},
    cylinder::{self, Spec},
    orthogonal, polyhedron,
};

fn key() -> BodyKey {
    BodyKey { id: [12, 1, 2, 3], revision: 0 }
}
fn frames() -> [Affine; 3] {
    [
        Affine::IDENTITY,
        Affine { origin: [65.53625, -32.7685, 16.384125], x: [0., 0., 1.], z: [0., -1., 0.] },
        Affine { origin: [-0.031, 0.012, 0.007], x: [0.6, 0.8, 0.], z: [0., 0., 1.] },
    ]
}
fn cuboid(lo: [f64; 3], hi: [f64; 3], frame: Affine) -> Solid {
    let a = polyhedron::audit(&orthogonal::cuboid(key(), lo, hi).unwrap().check().unwrap()).unwrap();
    Solid::Planar(polyhedron::audit(&orthogonal::transform(&a, frame).unwrap().check().unwrap()).unwrap())
}
fn bore(s: Spec, frame: Affine) -> Solid {
    let c = cylinder::audit(&cylinder::create(key(), s).unwrap().check().unwrap()).unwrap();
    Solid::Cylinder(cylinder::audit(&cylinder::transform(&c, frame).unwrap().check().unwrap()).unwrap())
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
fn audit(body: wonky_contract::Body) -> Solid {
    analytic::audit(&body.check().unwrap()).unwrap()
}
/// AC66's construction in metres: box 32 x 18 x 10 mm, a through bore r 2 at
/// (8, 9), then a pocket box [20,28] x [4,14] x [6,12] cut after the bore.
fn pocket_after_bore(frame: Affine) -> Vec<wonky_contract::Body> {
    let base = cuboid([0.; 3], [0.032, 0.018, 0.010], frame);
    let tool = bore(Spec { bottom: [0.008, 0.009, -0.001], top: [0.008, 0.009, 0.011], radius: 0.002 }, frame);
    let drilled = analytic::boolean(key(), 1, &[base, tool]).unwrap();
    assert_eq!(drilled.len(), 1);
    let pocket = cuboid([0.020, 0.004, 0.006], [0.028, 0.014, 0.012], frame);
    analytic::boolean(key(), 1, &[audit(drilled[0].clone()), pocket]).unwrap()
}

#[test]
fn pocket_after_bore_builds_exactly_through_the_general_boolean() {
    let pi = std::f64::consts::PI;
    for frame in frames() {
        let out = pocket_after_bore(frame);
        assert_eq!(out.len(), 1);
        let solid = audit(out[0].clone());
        assert!(solid.curved_model(), "routed result is a curved general-Boolean Model");
        let m = solid.measure(None, &[]).unwrap();
        let volume = 5440. - 40. * pi;
        assert!((number(&m, "volumeMm3") - volume).abs() <= 1e-9 * volume, "{m}");
        let area = 2296. + 32. * pi;
        assert!((number(&m, "areaMm2") - area).abs() <= 1e-9 * area, "{m}");
        for (field, want) in [("faces", 12.), ("edges", 26.), ("vertices", 16.), ("ringEdges", 2.), ("genus", 1.), ("shells", 1.), ("bodies", 1.)] {
            assert_eq!(number(&m, field), want, "{field}: {m}");
        }
        // Closed-form first moments: box minus the bore inside it minus the
        // pocket inside it, mapped by the placement.
        let moment = |v: f64, c: [f64; 3]| c.map(|x| v * x);
        let (b, h, p) = (moment(5760., [16., 9., 5.]), moment(40. * pi, [8., 9., 5.]), moment(320., [24., 9., 8.]));
        let local: [f64; 3] = std::array::from_fn(|k| (b[k] - h[k] - p[k]) / volume);
        let y = [frame.z[1] * frame.x[2] - frame.z[2] * frame.x[1], frame.z[2] * frame.x[0] - frame.z[0] * frame.x[2], frame.z[0] * frame.x[1] - frame.z[1] * frame.x[0]];
        let world: [f64; 3] = std::array::from_fn(|k| 1000. * frame.origin[k] + local[0] * frame.x[k] + local[1] * y[k] + local[2] * frame.z[k]);
        let got = triple(&m, "centroidMm");
        for k in 0..3 {
            assert!((got[k] - world[k]).abs() <= 1e-9 * (1. + world[k].abs()), "centroid {got:?} vs {world:?}");
        }
        // The box bounds the result: its 8 corners in world millimetres.
        let (lo, hi) = (triple(&m, "min"), triple(&m, "max"));
        for k in 0..3 {
            let corners = (0..8).map(|i| {
                let l = [32. * (i & 1) as f64, 18. * ((i >> 1) & 1) as f64, 10. * ((i >> 2) & 1) as f64];
                1000. * frame.origin[k] + l[0] * frame.x[k] + l[1] * y[k] + l[2] * frame.z[k]
            });
            let (want_lo, want_hi) = corners.fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), x| (a.min(x), b.max(x)));
            assert!((lo[k] - want_lo).abs() <= 1e-9 * (1. + want_lo.abs()) && (hi[k] - want_hi).abs() <= 1e-9 * (1. + want_hi.abs()), "{lo:?} {hi:?}");
        }
        // Analytic STEP: the bore is a cylinder, never a polygon or a spline.
        let step = analytic::step(&[("r".into(), solid.clone())], "g12").unwrap();
        assert!(step.contains("CYLINDRICAL_SURFACE") && step.contains("CIRCLE(") && !step.contains("B_SPLINE"), "{step}");
        let mesh = wonky_ops::mesh::tessellate(&out[0].clone().check().unwrap(), 0.01).unwrap();
        assert!(!mesh.triangles.is_empty());
    }
}

#[test]
fn routed_results_compose_with_later_booleans() {
    // A further pocket on the routed Model is a Model operand, replayed from
    // its own source DAG, never from its caches.
    let out = pocket_after_bore(Affine::IDENTITY);
    let again = analytic::boolean(key(), 1, &[audit(out[0].clone()), cuboid([0.0, 0.0, 0.008], [0.004, 0.004, 0.012], Affine::IDENTITY)]).unwrap();
    let m = audit(again[0].clone()).measure(None, &[]).unwrap();
    let volume = 5440. - 40. * std::f64::consts::PI - 32.;
    assert!((number(&m, "volumeMm3") - volume).abs() <= 1e-9 * volume, "{m}");
}

#[test]
fn a_tampered_source_leaf_is_refused_not_rebuilt_from_caches() {
    // Planted negative: the bore radius inside the result's embedded source
    // DAG is changed; replay rebuilds a different Model and the emitted
    // caches no longer match, so the audit must refuse.
    let mut body = pocket_after_bore(Affine::IDENTITY).remove(0);
    let n = body.constructions.iter().position(|n| n.parameters.iter().any(|p| p.get() == 0.002)).expect("bore radius node");
    for p in &mut body.constructions[n].parameters {
        if p.get() == 0.002 {
            *p = wonky_contract::Binary64::new(0.0021).unwrap();
        }
    }
    match body.check() {
        Err(_) => {}
        Ok(checked) => assert!(analytic::audit(&checked).is_err(), "tampered source leaf accepted"),
    }
}

#[test]
fn a_routed_cone_beside_an_offset_parallel_bore_refuses_by_row() {
    // A plate united with a countersink revolve and a parallel offset rod
    // whose wall crosses the cone: the family refuses with the routed
    // `revolve/full/boolean-arrangement-unimplemented`; the general path has
    // no cone x offset cylinder row yet and must refuse `ssi-row-unavailable`,
    // never build.
    // Keep the z=6..8 mm cone exposed. An 8 mm plate swallows it in the
    // first union, so a later partial-circle refusal does not test this row.
    let base = cuboid([0.; 3], [0.032, 0.024, 0.002], Affine::IDENTITY);
    let countersink = wonky_ops::revolve_full::build(
        key(), [0; 4], Affine { origin: [0.016, 0.012, 0.], x: [1., 0., 0.], z: [0., 0., 1.] }, 2,
        &[[0., -0.001, 0.002, -0.001], [0.002, -0.001, 0.002, 0.006], [0.002, 0.006, 0.004, 0.008], [0.004, 0.008, 0.004, 0.010], [0.004, 0.010, 0., 0.010], [0., 0.010, 0., -0.001]],
        std::f64::consts::TAU,
    ).unwrap();
    let countersink = audit(countersink);
    let offset = bore(Spec { bottom: [0.0195, 0.012, -0.001], top: [0.0195, 0.012, 0.010], radius: 0.001 }, Affine::IDENTITY);
    let refusal = analytic::boolean(key(), 0, &[base, countersink, offset]).unwrap_err().0;
    assert_eq!(refusal, "boolean/ssi-row-unavailable:revolution×revolution/parallel-offset");
}

/// AC74's countersink tool in metres: a full-turn revolve about the vertical
/// line through (16, 12) mm, profile (0,-1) (r,-1) (r,6) (r+2,8) (r+2,10) (0,10).
fn countersink(r: f64) -> Solid {
    let p = [[0., -0.001], [r, -0.001], [r, 0.006], [r + 0.002, 0.008], [r + 0.002, 0.010], [0., 0.010]];
    let segments = (0..p.len()).map(|i| { let (a, b) = (p[i], p[(i + 1) % p.len()]); [a[0], a[1], b[0], b[1]] }).collect::<Vec<_>>();
    audit(wonky_ops::revolve_full::build(
        key(), [0; 4], Affine { origin: [0.016, 0.012, 0.], x: [1., 0., 0.], z: [0., 0., 1.] }, 2, &segments, std::f64::consts::TAU,
    ).unwrap())
}

#[test]
fn a_placed_revolve_tool_cuts_exactly_through_the_general_boolean() {
    // AC74: box [0,32]x[0,24]x[0,8] mm minus the countersink, both placed by
    // the same frame. The revolve has no family placement: it is placed by
    // its exact image chain and enters the general Boolean as a source leaf.
    // Removed: bore 4 pi * 6 plus frustum pi * 2 / 3 * (4 + 8 + 16), i.e.
    // 128 pi / 3. Area: 2432 - 4 pi - 16 pi + bore wall 24 pi + cone
    // pi * (2 + 4) * 2 sqrt 2.
    let pi = std::f64::consts::PI;
    for frame in frames() {
        let base = cuboid([0.; 3], [0.032, 0.024, 0.008], frame);
        let tool = countersink(0.002);
        assert!(matches!(tool, Solid::Revolved(_)), "the countersink audits as a full revolve");
        let placed = audit(tool.transform(frame).unwrap());
        assert!(matches!(placed, Solid::Placed(_)), "a placed revolve keeps its source and is read through its Model");
        let out = analytic::boolean(key(), 1, &[base, placed]).unwrap();
        assert_eq!(out.len(), 1);
        let solid = audit(out[0].clone());
        assert!(solid.curved_model());
        let m = solid.measure(None, &[]).unwrap();
        let volume = 6144. - 128. * pi / 3.;
        assert!((number(&m, "volumeMm3") - volume).abs() <= 1e-9 * volume, "{m}");
        let area = 4. * pi + 12. * 2f64.sqrt() * pi + 2432.;
        assert!((number(&m, "areaMm2") - area).abs() <= 1e-9 * area, "{m}");
        for (field, want) in [("faces", 8.), ("edges", 15.), ("vertices", 8.), ("ringEdges", 3.), ("genus", 1.), ("shells", 1.), ("bodies", 1.)] {
            assert_eq!(number(&m, field), want, "{field}: {m}");
        }
    }
}

#[test]
fn a_placed_revolve_is_moved_not_left_in_its_source_frame() {
    // The tool alone is placed 4 mm along x; the box is not. If the image
    // chain were ignored, the removed material would stay centred at x = 16
    // and the centroid would stay at x = 16 exactly.
    let pi = std::f64::consts::PI;
    let base = cuboid([0.; 3], [0.032, 0.024, 0.008], Affine::IDENTITY);
    let shifted = Affine { origin: [0.004, 0., 0.], ..Affine::IDENTITY };
    let placed = audit(countersink(0.002).transform(shifted).unwrap());
    let m = audit(analytic::boolean(key(), 1, &[base, placed]).unwrap().remove(0)).measure(None, &[]).unwrap();
    let removed = 128. * pi / 3.;
    let want = (6144. * 16. - removed * 20.) / (6144. - removed);
    let c = triple(&m, "centroidMm");
    assert!((c[0] - want).abs() <= 1e-9 * want, "{m}");
}

#[test]
fn a_cone_band_ring_charted_in_a_cutting_plane_is_written_on_the_band_seam() {
    // A frustum narrowing upward, r(z) = (7 - z) / 8 mm, united with a plate.
    // Each cone band has one ring of the revolve and one cut by a plate face,
    // charted in that plane's axes: their chart-angle-0 points lie on
    // different generators. The writer re-charts the plane ring onto the
    // band's generator (same circle, proved exactly) instead of refusing
    // `export/model/seam-off-generator`, as it did before.
    // Closed forms: V = 72 + pi (169 + 61) / 192 = 72 + 115 pi / 96.
    // A = 120 + pi (1 + 1/4 - 49/64 - 25/64) + pi (15 + 9) / 64 sqrt 65
    //   = 120 + 3 pi / 32 + 3 sqrt(65) pi / 8 (slant sqrt(65) / 8 per mm).
    let pi = std::f64::consts::PI;
    let plate = cuboid([-0.003, -0.003, 0.], [0.003, 0.003, 0.002], Affine::IDENTITY);
    let frustum = audit(wonky_ops::revolve_full::build(
        key(), [0; 4], Affine::IDENTITY, 2,
        &[[0., -0.001, 0.001, -0.001], [0.001, -0.001, 0.0005, 0.003], [0.0005, 0.003, 0., 0.003], [0., 0.003, 0., -0.001]],
        std::f64::consts::TAU,
    ).unwrap());
    let out = analytic::boolean(key(), 0, &[plate, frustum]).unwrap();
    assert_eq!(out.len(), 1);
    let solid = audit(out[0].clone());
    let m = solid.measure(None, &[]).unwrap();
    let volume = 72. + 115. * pi / 96.;
    assert!((number(&m, "volumeMm3") - volume).abs() <= 1e-9 * volume, "{m}");
    let area = 120. + 3. * pi / 32. + 3. * 65f64.sqrt() * pi / 8.;
    assert!((number(&m, "areaMm2") - area).abs() <= 1e-9 * area, "{m}");
    for (field, want) in [("faces", 10.), ("edges", 16.), ("vertices", 8.), ("ringEdges", 4.), ("genus", 0.), ("shells", 1.), ("bodies", 1.)] {
        assert_eq!(number(&m, field), want, "{field}: {m}");
    }
    let step = analytic::step(&[("u".into(), solid)], "u").unwrap();
    assert_eq!(step.matches("CONICAL_SURFACE").count(), 2, "both cone bands are written as cones");
}

/// A rounded block: [0,10]^2 with its (10,10) corner replaced by a quarter
/// arc of radius 5 about (5,5) through (9,8), extruded 30 along z.
fn rounded_block() -> Solid {
    audit(wonky_ops::arc_profile::build(
        key(), Affine::IDENTITY,
        &[[0., 0., 10., 0.], [10., 0., 10., 5.], [5., 10., 0., 10.], [0., 10., 0., 0.]],
        &[[10., 5., 9., 8., 5., 10.]],
        30., false,
    ).unwrap())
}

#[test]
fn an_arc_profile_prism_has_the_exact_model_of_its_sketch() {
    // The rule-7 leaf of an arc prism rebuilds the replayed sketch cycle as an
    // exact extrusion: area 100 - 25 + 25 pi / 4, so 6 V = 13500 + 1125 pi.
    let solid = rounded_block();
    assert!(matches!(solid, Solid::Planar(_)));
    let v = solid.model().unwrap().volume6_pi().unwrap();
    assert_eq!(v.len(), 1);
    assert_eq!((v[0].rational.to_string(), v[0].pi.to_string()), ("13500".into(), "1125".into()));
}

#[test]
fn an_arc_prism_united_with_a_crossing_prism_builds_exactly() {
    // AC113's shape class: an L prism along y crossing the arc prism's
    // partial-cylinder wall. The strip and partial-circle rows (boolean3d
    // G12b) build it exactly. The leg meets the block only in x in [7, 10],
    // z in [12, 15], where the block's section is 15 plus the circular cap
    // ∫_2^5 √(25 − u²) du = 25π/4 − √21 − 12.5 asin(2/5): the ruling x = 7
    // meets the rounded wall at y = 5 + √21, off the quarter grid.
    let leg = audit(wonky_ops::arc_profile::build(
        key(), Affine { origin: [0., -8., 0.], x: [1., 0., 0.], z: [0., 1., 0.] },
        &[[7., -15., 14., -15.], [14., -15., 14., -5.], [14., -5., 12., -5.], [12., -5., 12., -12.], [12., -12., 7., -12.], [7., -12., 7., -15.]],
        &[], 20., false,
    ).unwrap());
    let mut out = analytic::boolean(key(), 0, &[rounded_block(), leg]).unwrap();
    assert_eq!(out.len(), 1);
    let solid = analytic::audit(&out.remove(0).check().unwrap()).unwrap();
    let m = solid.measure(None, &[]).unwrap();
    let pi = std::f64::consts::PI;
    let common = 3.0 * (15.0 + 25.0 * pi / 4.0 - 21f64.sqrt() - 12.5 * 0.4f64.asin());
    let volume = 2250.0 + 187.5 * pi + 700.0 - common;
    let v = number(&m, "volumeMm3") / 1e9;
    assert!((v - volume).abs() <= volume * 1e-12, "{v} != {volume}");
    assert!(m.contains("\"bodies\":1") && m.contains("\"genus\":0"), "{m}");
}

#[test]
fn curved_model_geometric_queries_refuse_instead_of_reading_caches() {
    use wonky_ops::query;
    let solid = audit(pocket_after_bore(Affine::IDENTITY).remove(0));
    assert!(solid.curved_model());
    let edges = query::owned(&solid, query::EDGE).unwrap();
    let faces = query::owned(&solid, query::FACE).unwrap();
    // This body has eight x-parallel edges. The old cache path skipped its
    // ConstructionLine entries and silently returned an empty selection.
    assert_eq!(query::parallel_edges(&solid, &edges, [1., 0., 0.]).unwrap_err().0, "query/curved-model-geometry-unimplemented");
    assert_eq!(query::coincides(&solid, &faces, [0.; 3], [0., 0., 1.]).unwrap_err().0, "query/curved-model-geometry-unimplemented");
    assert_eq!(query::coincides_in_frame(&solid, &faces, Affine::IDENTITY, [0.; 3], [0., 0., 1.]).unwrap_err().0, "query/curved-model-geometry-unimplemented");
}

#[test]
fn the_centroid_bound_encloses_the_exact_symmetry_plane_far_from_the_origin() {
    // The review counterexample (2026-10-03): AC66 placed 60 m from the
    // origin, built in absolute coordinates. Box, bore and pocket are
    // symmetric about one plane y = c exactly (checked below in Q), so the
    // exact centroid has y = 1000 c mm. The former f64 moment sum missed it
    // by 1.49e-8 mm against an advertised bound of 1.04e-8 mm.
    use num_traits::Signed;
    use wonky_geom::Q;
    let exact = |x: f64| Q::from_float(x).unwrap();
    let (lo, hi) = ([60., 60., 60.], [60.032, 60.018, 60.01]);
    let (pocket_lo, pocket_hi) = ([60.02, 60.004, 60.006], [60.028, 60.014, 60.012]);
    let c = exact(60.009);
    let two = Q::from_integer(2.into());
    assert_eq!((exact(lo[1]) + exact(hi[1])) / &two, c);
    assert_eq!((exact(pocket_lo[1]) + exact(pocket_hi[1])) / &two, c);
    let base = cuboid(lo, hi, Affine::IDENTITY);
    let tool = bore(Spec { bottom: [60.008, 60.009, 59.999], top: [60.008, 60.009, 60.011], radius: 0.002 }, Affine::IDENTITY);
    let drilled = analytic::boolean(key(), 1, &[base, tool]).unwrap();
    let out = analytic::boolean(key(), 1, &[audit(drilled[0].clone()), cuboid(pocket_lo, pocket_hi, Affine::IDENTITY)]).unwrap();
    let solid = audit(out[0].clone());
    assert!(solid.curved_model());
    let m = solid.measure(None, &[]).unwrap();
    let (got, bound) = (triple(&m, "centroidMm"), triple(&m, "centroidBoundMm"));
    let error = (exact(got[1]) - c * Q::from_integer(1000.into())).abs();
    assert!(error <= exact(bound[1]), "centroid y {} misses the symmetry plane by {error} > bound {}", got[1], bound[1]);
    // An enclosure, not a blanket tolerance: a few binary64 steps at 60 m.
    assert!(bound.iter().all(|&b| b > 0. && b <= 1e-10), "{bound:?}");
}
