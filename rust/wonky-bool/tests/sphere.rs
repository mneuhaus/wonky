//! G14: sphere rows end to end on Models (plane × sphere with K1 circles,
//! sphere pairs, point contact) through the stereographic face split, the
//! sewing of Q(√d) arcs and the patch audit and measures.
use wonky_bool::{curved, Op};
use wonky_geom::frame::Frame;
use wonky_geom::model::{
    polyhedron, Carrier3, Draft, Face, FaceId, Label, Model, Plane3, PolyFace, Provenance, Shell, ShellId, Solid, Sphere3,
    Surface, SurfaceId, VertexDef,
};
use wonky_geom::{Point, Q};

fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn qr(n: i64, d: i64) -> Q {
    Q::new(n.into(), d.into())
}
fn pv(p: [i64; 3]) -> Point {
    p.map(q)
}
fn prov(node: u32, slot: u32) -> Provenance {
    Provenance { node, slot }
}
/// The axis box [lo, hi] with unit plane charts (isometric, as the family
/// adapters emit them).
fn cuboid(lo: [i64; 3], hi: [i64; 3], node: u32) -> Model {
    let mut faces = vec![];
    for k in 0..3 {
        for upper in [false, true] {
            let (i, j) = ((k + 1) % 3, (k + 2) % 3);
            let level = if upper { hi[k] } else { lo[k] };
            let corner = |a: i64, b: i64| {
                let mut p = [0; 3];
                p[k] = level;
                p[i] = a;
                p[j] = b;
                VertexDef::Rational(pv(p))
            };
            let mut cycle = vec![corner(lo[i], lo[j]), corner(hi[i], lo[j]), corner(hi[i], hi[j]), corner(lo[i], hi[j])];
            let mut n = [0; 3];
            n[k] = if upper { 1 } else { -1 };
            if !upper {
                cycle.reverse();
            }
            let mut x = [0; 3];
            x[i] = 1;
            let mut o = [0; 3];
            o[k] = level;
            faces.push(PolyFace {
                carrier: Plane3 { o: pv(o), x: pv(x), n: pv(n) },
                forward: true,
                loops: vec![cycle],
                provenance: prov(node, faces.len() as u32),
            });
        }
    }
    polyhedron(Frame::identity(), Label::Exact, node, faces).unwrap().check().unwrap()
}
fn ball(c: [Q; 3], r: Q, node: u32) -> Model {
    let frame = Frame::new(c, [pv([1, 0, 0]), pv([0, 1, 0]), pv([0, 0, 1])]).unwrap();
    let d = Draft {
        placement: Frame::identity(),
        label: Label::Exact,
        surfaces: vec![Surface { carrier: Carrier3::Sphere(Sphere3::new(frame, &r * &r).unwrap()), provenance: prov(node, 0) }],
        curves: vec![],
        vertices: vec![],
        edges: vec![],
        coedges: vec![],
        loops: vec![],
        faces: vec![Face { surface: SurfaceId(0), forward: true, loops: vec![], provenance: prov(node, 0) }],
        shells: vec![Shell { faces: vec![FaceId(0)], provenance: prov(node, 0) }],
        solids: vec![Solid { shells: vec![ShellId(0)], provenance: prov(node, 0) }],
    };
    d.check().unwrap_or_else(|e| panic!("{}", e.0))
}
fn counts(m: &Model) -> [usize; 3] {
    let d = m.draft();
    [d.faces.len(), d.edges.len(), d.vertices.len()]
}
fn measures(m: &Model) -> (f64, f64) {
    let (v6, a) = m.patch_measures().unwrap_or_else(|e| panic!("{}", e.0))[0];
    assert!(v6.r < 1e-9 && a.r < 1e-9, "enclosures too wide: {v6:?} {a:?}");
    (v6.m / 6., a.m)
}
fn close(x: f64, y: f64) {
    assert!((x - y).abs() <= 1e-9 * y.abs().max(1.), "{x} vs {y}");
}

#[test]
fn ac111_box_minus_sphere_crosses_two_faces() {
    let pi = std::f64::consts::PI;
    let out = curved::boolean(&cuboid([0, 0, 0], [20, 20, 10], 1), &ball(pv([10, 2, 10]), q(4), 2), Op::Subtraction, 3)
        .unwrap_or_else(|e| panic!("{}", e.0));
    assert_eq!(out.len(), 1);
    assert_eq!(counts(&out[0]), [7, 15, 10], "F7 E15 V10: front face notched, top cut");
    let (v, a) = measures(&out[0]);
    close(v, 4000. - 36. * pi);
    close(a, -4. * 3f64.sqrt() + 22. * pi / 3. + 1600.);
    // The two crossing vertices are (10 ± 2√3, 0, 10): Q(√3), no rational point.
    let irrational = (0..out[0].draft().vertices.len())
        .filter(|&i| out[0].key(wonky_geom::model::VertexId(i as u32)).rational().is_err())
        .count();
    assert_eq!(irrational, 2);
    // Exact containment in the patch face (bounding boxes rely on it): the
    // pocket bottom is in it, a point of the removed outer cap is not, a
    // point of its equator trim is in its closure, the top pole is not.
    let fi = (0..out[0].draft().faces.len()).map(|i| FaceId(i as u32)).find(|&f| out[0].is_sphere_patch(f)).unwrap();
    let at = |p: [i64; 3]| p.map(|x| wonky_curve::radical::Radical::from(q(x)));
    for (p, inside) in [([10, 2, 6], true), ([10, -2, 10], false), ([10, 6, 10], true), ([10, 2, 14], false), ([14, 2, 10], true)] {
        assert_eq!(out[0].sphere_face_contains(fi, &at(p)).unwrap_or_else(|e| panic!("{p:?}: {}", e.0)), inside, "{p:?}");
    }
}
#[test]
fn ac111_v4_radius_has_an_acos_area() {
    let out = curved::boolean(&cuboid([0, 0, 0], [20, 20, 10], 1), &ball(pv([10, 2, 10]), qr(161, 40), 2), Op::Subtraction, 3)
        .unwrap_or_else(|e| panic!("{}", e.0));
    assert_eq!(counts(&out[0]), [7, 15, 10]);
    let (v, a) = measures(&out[0]);
    close(v, 3885.0078750391094);
    close(a, 1616.1625361196488);
}
#[test]
fn e5_and_b4_octants_have_three_great_arcs() {
    let pi = std::f64::consts::PI;
    let e5 = curved::boolean(&cuboid([0, 0, 0], [20, 20, 10], 1), &ball(pv([0, 0, 10]), q(4), 2), Op::Subtraction, 3)
        .unwrap_or_else(|e| panic!("{}", e.0));
    // The centre is a box corner: the corner goes, its three edges end at
    // the three new vertices, and three great arcs bound the octant face.
    assert_eq!(counts(&e5[0]), [7, 15, 10]);
    close(measures(&e5[0]).0, 4000. - 32. * pi / 3.);
    // Centroid: the box's minus the octant's (3a/8 from the corner along
    // each of its three directions), weighted by volume.
    let (m, v) = e5[0].patch_moments().unwrap_or_else(|e| panic!("{}", e.0))[0];
    let vo = 32. * pi / 3.;
    let expect = [(4000. * 10. - vo * 1.5) / (4000. - vo), (4000. * 10. - vo * 1.5) / (4000. - vo), (4000. * 5. - vo * 8.5) / (4000. - vo)];
    for k in 0..3 {
        assert!(m[k].r < 1e-8, "moment enclosure {:?}", m[k]);
        close(m[k].m / v.m, expect[k]);
    }
    let b4 = curved::boolean(&cuboid([0, 0, 0], [20, 20, 20], 1), &ball(pv([20, 20, 20]), q(8), 2), Op::Subtraction, 3)
        .unwrap_or_else(|e| panic!("{}", e.0));
    assert_eq!(counts(&b4[0]), [7, 15, 10]);
    close(measures(&b4[0]).0, 8000. - 256. * pi / 3.);
}
#[test]
fn a_fabricated_rational_point_on_r2_12_is_caught_by_the_identity_audit() {
    let out = curved::boolean(&cuboid([0, 0, 0], [20, 20, 10], 1), &ball(pv([10, 2, 10]), q(4), 2), Op::Subtraction, 3).unwrap();
    let mut d = out[0].clone().into_draft();
    let i = (0..d.vertices.len())
        .find(|&i| out[0].key(wonky_geom::model::VertexId(i as u32)).rational().is_err())
        .unwrap();
    // 10 + 2√3 = 13.4641016…, replaced by its binary64 value: a rational
    // point that does not lie on x² + z² = 12 about (10, 0, 10).
    let x = 10. + 2. * 3f64.sqrt();
    d.vertices[i].def = VertexDef::Rational([Q::from_float(x).unwrap(), q(0), q(10)]);
    // G3 compares each vertex's exact chart image with its coedges' piece
    // ends before G4 tests it on its curves: the identity audit refuses here.
    let e = d.check().unwrap_err();
    assert_eq!(e.0, "model/g3-pcurve-ends");
}
#[test]
fn sphere_pair_lens_and_point_contact() {
    let pi = std::f64::consts::PI;
    // Two r 5 spheres 6 apart: the lens of two caps of height 2, V = 2·π·4·(15−2)/3.
    let lens = curved::boolean(&ball(pv([0, 0, 0]), q(5), 1), &ball(pv([6, 0, 0]), q(5), 2), Op::Intersection, 3)
        .unwrap_or_else(|e| panic!("{}", e.0));
    assert_eq!(counts(&lens[0]), [2, 1, 0]);
    let six = lens[0].volume6_surd().unwrap_or_else(|e| panic!("{}", e.0));
    let (lo, hi) = six[0].enclosure(64).unwrap();
    let v = (lo + hi) / q(12);
    close(num_traits::ToPrimitive::to_f64(&v).unwrap(), 2. * pi * 4. * 13. / 3.);
    // E3: a ball resting on a box top touches it in one point.
    let e = curved::boolean(&cuboid([-10, -10, -4], [10, 10, 0], 1), &ball(pv([0, 0, 5]), q(5), 2), Op::Union, 3).unwrap_err();
    assert_eq!(e.0, "non-manifold-result");
}
#[cfg(feature = "plant_sphere_f64_radius")]
#[test]
fn planted_f64_sphere_radius_fails_the_substitution_identity() {
    let e = curved::boolean(&cuboid([0, 0, 0], [20, 20, 10], 1), &ball(pv([10, 2, 10]), q(4), 2), Op::Subtraction, 3).unwrap_err();
    assert_eq!(e.0, "boolean/contract-violation:ssi/identity");
}
#[test]
fn g8_sphere_union_coaxial_cylinder_meets_at_a_radical_height() {
    // Probe G8: r 5 ball ∪ r 2 pin along z from −10 to 0. They meet in the
    // ring z = −√21 (Q(√21), r 2); V = π (370/3 + 14√21).
    let frame = Frame::identity();
    let profile = [[q(0), q(-10)], [q(2), q(-10)], [q(2), q(0)], [q(0), q(0)]];
    let pin = wonky_geom::model::revolution::revolution(Frame::identity(), frame, &profile, 1).unwrap().check().unwrap();
    let out = curved::boolean(&ball(pv([0, 0, 0]), q(5), 2), &pin, Op::Union, 3).unwrap_or_else(|e| panic!("{}", e.0));
    assert_eq!(out.len(), 1);
    let d = out[0].draft();
    assert_eq!([d.faces.len(), d.edges.len(), d.vertices.len()], [3, 2, 0]);
    let six = out[0].volume6_surd().unwrap_or_else(|e| panic!("{}", e.0));
    let (lo, hi) = six[0].enclosure(64).unwrap();
    let v = num_traits::ToPrimitive::to_f64(&((lo + hi) / q(12))).unwrap();
    close(v, std::f64::consts::PI * (370. / 3. + 14. * 21f64.sqrt()));
}

/// The shadow measure leg (`periodic::measure_model`, `surface_area_model`)
/// on ring-bounded sphere faces: six times the volume and the area in Q·π,
/// against the closed forms and against the tube-band route of the Model.
fn green(m: &Model) -> (Q, Q) {
    let budget = wonky_bool::split::BUDGET;
    let [v] = &wonky_bool::periodic::measure_model(m, budget).unwrap_or_else(|e| panic!("{}", e.0))[..] else { panic!("one solid") };
    let [a] = &wonky_bool::periodic::surface_area_model(m, budget).unwrap_or_else(|e| panic!("{}", e.0))[..] else { panic!("one solid") };
    assert!(v.rational == q(0) && v.pi2 == q(0) && a.rational == q(0) && a.pi2 == q(0), "{v:?} {a:?}");
    let tube = m.volume6_pi().unwrap_or_else(|e| panic!("{}", e.0));
    assert_eq!(tube[0].pi, v.pi, "Green and tube-band volumes differ");
    let area = m.area_pi().unwrap_or_else(|e| panic!("{}", e.0));
    assert_eq!(area[0].pi, a.pi, "Green and closed-form areas differ");
    (v.pi.clone(), a.pi.clone())
}
fn pin(r: i64, z0: i64, z1: i64, node: u32) -> Model {
    let profile = [[q(0), q(z0)], [q(r), q(z0)], [q(r), q(z1)], [q(0), q(z1)]];
    wonky_geom::model::revolution::revolution(Frame::identity(), Frame::identity(), &profile, node).unwrap().check().unwrap()
}
#[test]
fn sphere_zone_green_measures_match_the_closed_forms() {
    // AC24-type: ball (1, 2, 3) r 5 above z = 0, a cap of height 8 over a
    // disc of r² 16: V = π·64·(15 − 8)/3, A = 2π·5·8 + 16π.
    let cap = curved::boolean(&ball(pv([1, 2, 3]), q(5), 1), &cuboid([-10, -10, 0], [10, 10, 20], 2), Op::Intersection, 3)
        .unwrap_or_else(|e| panic!("{}", e.0));
    assert_eq!(green(&cap[0]), (q(896), q(96)));
    // Its complement keeps the other cap (the face sense of the disc flips).
    let rest = curved::boolean(&ball(pv([1, 2, 3]), q(5), 1), &cuboid([-10, -10, 0], [10, 10, 20], 2), Op::Subtraction, 3)
        .unwrap_or_else(|e| panic!("{}", e.0));
    // 6V = 6·(500/3 − 448/3)π, A = 2π·5·2 + 16π.
    assert_eq!(green(&rest[0]), (q(104), q(36)));
    // AC27-type lens with a Q(√21) ring radius: r 5 balls 4 apart, caps of
    // height 3: V = 2·π·9·12/3, A = 2·2π·5·3.
    let lens = curved::boolean(&ball(pv([0, 0, 0]), q(5), 1), &ball(pv([4, 0, 0]), q(5), 2), Op::Intersection, 3)
        .unwrap_or_else(|e| panic!("{}", e.0));
    assert!(lens[0].draft().curves.iter().any(|c| matches!(c.geometry, wonky_geom::model::Curve3::RadicalCircle(_))));
    assert_eq!(green(&lens[0]), (q(432), q(60)));
    // AC28-type napkin ring: r 10 ball minus an r 6 bore, height 16:
    // V = π·16³/6, A = 2π·10·16 + 2π·6·16.
    let ring = curved::boolean(&ball(pv([0, 0, 0]), q(10), 1), &pin(6, -20, 20, 2), Op::Subtraction, 3)
        .unwrap_or_else(|e| panic!("{}", e.0));
    assert_eq!(green(&ring[0]), (q(4096), q(512)));
}
#[test]
fn sphere_models_reframe_by_similarities_only() {
    let lens = curved::boolean(&ball(pv([0, 0, 0]), q(5), 1), &ball(pv([4, 0, 0]), q(5), 2), Op::Intersection, 3)
        .unwrap_or_else(|e| panic!("{}", e.0));
    // A rotated, translated target: the Q(√21) ring moves with its frame.
    let target = Frame::new(pv([3, 4, 5]), [pv([0, 1, 0]), pv([-1, 0, 0]), pv([0, 0, 1])]).unwrap();
    let moved = lens[0].reframed(&target).unwrap_or_else(|e| panic!("{}", e.0));
    assert_eq!(moved.canonical(), lens[0].canonical_in(&target).unwrap());
    assert_eq!(green(&moved), (q(432), q(60)));
    // A non-similar image is no sphere.
    let sheared = Frame::new(pv([0, 0, 0]), [pv([1, 0, 0]), pv([1, 1, 0]), pv([0, 0, 1])]).unwrap();
    assert_eq!(lens[0].reframed(&sheared).unwrap_err().0, "boolean/ssi-row-unavailable:sphere/reframe-chart");
}
