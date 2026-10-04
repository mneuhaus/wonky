//! boolean3d G12b: line/arc prisms whose partial-cylinder strips meet other
//! operands in the general Boolean (latitude and ruling sections in the
//! strip chart, partial arcs, coplanar imprint, healing of section vertices,
//! latitude splits of apex bands), and the exact measures of strips and
//! planar arcs off the quarter grid (atan terms).
use std::f64::consts::PI;
use wonky_contract::{Body, BodyKey};
use wonky_ops::{
    affine::Affine,
    analytic::{self, Solid},
    arc_profile,
};

/// Lengths are metres: mm^3 per m^3.
const MM3: f64 = 1e9;
const MM2: f64 = 1e6;

fn key() -> BodyKey {
    BodyKey { id: [4, 1, 8, 12], revision: 0 }
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
/// A sketch region as the interpreter builds it (a two-arc circle stays two
/// arcs).
fn region(frame: Affine, lines: &[[f64; 4]], arcs: &[[f64; 6]], depth: f64) -> Solid {
    solid(arc_profile::build_region(key(), frame, lines, arcs, depth, false, 0).unwrap())
}
fn revolve_z(c: [f64; 2], profile: &[[f64; 2]]) -> Solid {
    let lines = (0..profile.len())
        .map(|i| {
            let (a, b) = (profile[i], profile[(i + 1) % profile.len()]);
            [a[0], a[1], b[0], b[1]]
        })
        .collect::<Vec<_>>();
    let frame = Affine { origin: [c[0], c[1], 0.], x: [1., 0., 0.], z: [0., 0., 1.] };
    solid(wonky_ops::revolve_full::build(key(), [0; 4], frame, 2, &lines, std::f64::consts::TAU).unwrap())
}
fn polygon_prism(z0: f64, pts: &[[f64; 2]], depth: f64) -> Solid {
    let lines = (0..pts.len())
        .map(|i| {
            let (a, b) = (pts[i], pts[(i + 1) % pts.len()]);
            [a[0], a[1], b[0], b[1]]
        })
        .collect::<Vec<_>>();
    arcs(Affine { origin: [0., 0., z0], x: [1., 0., 0.], z: [0., 0., 1.] }, &lines, &[], depth)
}
/// Profile plane spanned by world y (u) and world z (v), extruded along +x.
const ALONG_X: Affine = Affine { origin: [0., 0., 0.], x: [0., 1., 0.], z: [1., 0., 0.] };

fn run(op: u8, bodies: &[Solid]) -> Solid {
    let mut out = analytic::boolean(key(), op, bodies).unwrap();
    assert_eq!(out.len(), 1);
    solid(out.remove(0))
}
fn refusal(op: u8, bodies: &[Solid]) -> String {
    analytic::boolean(key(), op, bodies).err().expect("refusal").0
}
fn num(json: &str, field: &str) -> f64 {
    let at = json.find(&format!("\"{field}\":")).expect(field) + field.len() + 3;
    let rest = &json[at..];
    rest[..rest.find([',', '}']).unwrap()].parse().unwrap()
}
fn topo(json: &str, field: &str) -> i64 {
    num(&json[json.find("\"topology\"").unwrap()..], field) as i64
}
fn near(actual: f64, expected: f64) {
    assert!((actual - expected).abs() <= expected.abs() * 1e-12, "{actual} != {expected}");
}

/// Probe G3 (boolean3d families): a pin drawn as two semicircle arcs, z in
/// [0, 8], r 1.6, union a coaxial cone revolve from its apex at z 5.9 to r
/// 2.1 at z 8. The cone meets the pin wall on the latitude z 7.5 (a chart
/// line on both half strips), the cone's apex cell lies inside the pin, and
/// the pin top lies on the cone's top disc (coplanar imprint). Exact: pin
/// pi r^2 7.5 plus the frustum pi h/3 (R^2 + R r + r^2) over h 0.5.
#[test]
fn two_arc_pin_union_coaxial_cone_builds_one_band_per_carrier() {
    let pin = region(Affine::IDENTITY, &[], &[[1.6, 0., 0., 1.6, -1.6, 0.], [-1.6, 0., 0., -1.6, 1.6, 0.]], 8.);
    let cone = revolve_z([0., 0.], &[[0., 5.9], [2.1, 8.], [0., 8.]]);
    let out = run(0, &[pin, cone]);
    let m = out.measure(None, &[]).unwrap();
    // The apex height, radii and top level are binary64 inputs: the exact
    // values are their rationals; the closed form in f64 is within 1e-12.
    let (r, big, top, apex) = (1.6f64, 2.1f64, 8.0f64, 5.9f64);
    let meet = apex + r * (top - apex) / big;
    let h = top - meet;
    let frustum = PI * h / 3. * (big * big + big * r + r * r);
    near(num(&m, "volumeMm3"), (PI * r * r * meet + frustum) * MM3);
    let slant = (h * h + (big - r) * (big - r)).sqrt();
    near(num(&m, "areaMm2"), (PI * r * r + 2. * PI * r * meet + PI * (big + r) * slant + PI * big * big) * MM2);
    // Bottom disc, one cylinder band (the two half strips merged, their
    // section vertices healed into rings), the cone band and one top disc
    // (the pin top and the cone-top annulus merged): no vertex survives.
    assert_eq!(topo(&m, "faces"), 4);
    assert_eq!(topo(&m, "vertices"), 0);
    assert_eq!(topo(&m, "edges"), 3);
    assert_eq!(topo(&m, "genus"), 0);
}

/// Planted negative for the apex admission: the same cone with a D-shaped
/// pin, whose flat wall lies on a plane through the cone's axis and meets
/// the cone in two rulings through the apex. Only latitude sections split an
/// apex band; this case must keep refusing by name.
#[test]
fn rulings_through_an_apex_band_still_refuse_by_name() {
    let pin = region(Affine::IDENTITY, &[[-1.6, 0., 1.6, 0.]], &[[1.6, 0., 0., 1.6, -1.6, 0.]], 8.);
    let cone = revolve_z([0., 0.], &[[0., 5.9], [2.1, 8.], [0., 8.]]);
    assert_eq!(refusal(0, &[pin, cone]), "boolean/chart-singularity:apex");
}

/// Probe G6's shape: an arch prism along x (rectangle 30 x 10 under a
/// circular arc through (30, 10), (15, 14), (0, 10): centre (15, -129/8),
/// radius 241/8) union a 15 x 20 x 4 lug along z that leaves the arch end
/// x = 40. The roof strip is cut by the lug planes y = 5, y = 25 (rulings)
/// and x = 35 (a latitude); its sweeps are off the quarter grid, so the
/// volume, area and moments carry atan terms. Closed form: 40 A + 1200 - 400
/// with the profile area A = 300 + R²(α - sin α)/2, α = 2 asin(15/R).
fn g6_closed_form(scale: f64) -> (f64, f64) {
    let r = 241.0f64 / 8.0;
    let alpha = 2.0 * (15.0 / r).asin();
    let profile = 300.0 + r * r * (alpha - alpha.sin()) / 2.0;
    let volume = 40.0 * profile + 800.0;
    // Arch ends (the x = 40 end less the lug section), bottom, two walls,
    // roof, and the lug's free top, bottom, sides and end.
    let area = 2.0 * profile - 80.0 + 1200.0 + 800.0 + 40.0 * r * alpha + 400.0 + 80.0 + 80.0;
    (volume * scale.powi(3), area * scale.powi(2))
}
fn g6(scale: f64) -> Solid {
    let s = scale;
    let arch = arcs(ALONG_X, &[[0., 0., 30. * s, 0.], [30. * s, 0., 30. * s, 10. * s], [0., 10. * s, 0., 0.]], &[[30. * s, 10. * s, 15. * s, 14. * s, 0., 10. * s]], 40. * s);
    let lug = polygon_prism(2. * s, &[[35. * s, 5. * s], [50. * s, 5. * s], [50. * s, 25. * s], [35. * s, 25. * s]], 4. * s);
    run(0, &[arch, lug])
}

/// Exact dyadic lengths (metres): the strip pieces have rational ends.
#[test]
fn arc_prism_along_x_union_lug_builds_exactly() {
    let out = g6(1.0);
    let m = out.measure(None, &[]).unwrap();
    let (volume, area) = g6_closed_form(1.0);
    near(num(&m, "volumeMm3"), volume * MM3);
    near(num(&m, "areaMm2"), area * MM2);
    assert_eq!(topo(&m, "faces"), 11);
    assert_eq!(topo(&m, "genus"), 0);
}

/// Probe G6 at the interpreter's millimetre lengths (binary64 values of
/// 0.015 etc.): the arc centre is no longer exactly 15 across, so the rulings
/// y = 5 and y = 25 lie in two different quadratic fields; a latitude piece
/// between them needs a rational interior witness, not their midpoint.
#[test]
fn probe_g6_millimetre_lengths_build_exactly() {
    let out = g6(1e-3);
    let m = out.measure(None, &[]).unwrap();
    let (volume, area) = g6_closed_form(1.0);
    near(num(&m, "volumeMm3"), volume);
    near(num(&m, "areaMm2"), area);
    assert_eq!(topo(&m, "faces"), 11);
    assert_eq!(topo(&m, "genus"), 0);
    analytic::step(&[("g6".into(), out)], "g6").unwrap();
}

/// AC113 (catalog closed form, first principles): an arch prism along x
/// (rectangle 2r x 6 under a half circle of radius r about (0, 6), length 30)
/// union the L prism along z. The y = -4 wall cuts the roof in a ruling off
/// the quarter grid (at angle acos(4/5) from the spring line for r = 5).
/// Volume -75 acos(4/5) + 325π + 3320, area -30 acos(4/5) + 130π + 1692,
/// B1 S1 F16 E42 V28.
fn ac113(scale: f64, r: f64, frame: Option<Affine>) -> Solid {
    let s = scale;
    let arch = arcs(ALONG_X, &[[-r * s, 0., r * s, 0.], [r * s, 0., r * s, 6. * s], [-r * s, 6. * s, -r * s, 0.]], &[[r * s, 6. * s, 0., (6. + r) * s, -r * s, 6. * s]], 30. * s);
    let pts: Vec<[f64; 2]> = [[10., -8.], [20., -8.], [20., 8.], [16., 8.], [16., -4.], [10., -4.]].iter().map(|p| [p[0] * s, p[1] * s]).collect();
    let l = polygon_prism(0., &pts, 20. * s);
    match frame {
        Some(f) => run(0, &[solid(arch.transform(f).unwrap()), solid(l.transform(f).unwrap())]),
        None => run(0, &[arch, l]),
    }
}
fn ac113_check(out: &Solid, unit: f64, volume: f64, area: f64) {
    let m = out.measure(None, &[]).unwrap();
    near(num(&m, "volumeMm3"), volume * unit.powi(3));
    near(num(&m, "areaMm2"), area * unit.powi(2));
    for (field, value) in [("bodies", 1), ("shells", 1), ("faces", 16), ("edges", 42), ("vertices", 28), ("genus", 0)] {
        assert_eq!(topo(&m, field), value, "{field}");
    }
}
fn ac113_v0() -> (f64, f64) {
    let a = 0.8f64.acos();
    (-75. * a + 325. * PI + 3320., -30. * a + 130. * PI + 1692.)
}

/// Exact dyadic lengths (metres): the far roof face is a quarter-grid chart
/// rectangle (patch rows), the near one a strip with the y = -4 ruling.
#[test]
fn arch_union_l_prism_builds_exactly() {
    let (volume, area) = ac113_v0();
    ac113_check(&ac113(1.0, 5.0, None), 1e3, volume, area);
}

/// AC113 V0 at millimetre lengths (binary64 0.005 etc.): both roof faces are
/// strips; the STEP writer takes them as cylindrical faces.
#[test]
fn ac113_millimetre_lengths_build_exactly() {
    let (volume, area) = ac113_v0();
    let out = ac113(1e-3, 5.0, None);
    ac113_check(&out, 1.0, volume, area);
    analytic::step(&[("ac113".into(), out)], "ac113").unwrap();
}

/// AC113 V3's frame: a binary64 rotation by 0.1 rad about (1, 2, 3) through
/// (3, -2, 5) mm, in the cell at (1000, 3750, 0) mm. A roof strip's chart
/// pole lies just off its ruling at the spring line; the divergence check
/// must take that ruling's written angle on the branch of its exact chart
/// parameter (it observes across ±π in this frame).
#[test]
fn ac113_rotated_frame_builds_exactly() {
    let s = 1e-3f64;
    let n = {
        let l = 14f64.sqrt();
        [1. / l, 2. / l, 3. / l]
    };
    let (c, si) = (0.1f64.cos(), 0.1f64.sin());
    let rot = |v: [f64; 3]| -> [f64; 3] {
        let d = n[0] * v[0] + n[1] * v[1] + n[2] * v[2];
        let x = [n[1] * v[2] - n[2] * v[1], n[2] * v[0] - n[0] * v[2], n[0] * v[1] - n[1] * v[0]];
        std::array::from_fn(|i| v[i] * c + x[i] * si + n[i] * d * (1. - c))
    };
    let p = [3. * s, -2. * s, 5. * s];
    let rp = rot(p);
    let origin = [1000. * s + p[0] - rp[0], 3750. * s + p[1] - rp[1], p[2] - rp[2]];
    let frame = Affine { origin, x: rot([1., 0., 0.]), z: rot([0., 0., 1.]) };
    let (volume, area) = ac113_v0();
    ac113_check(&ac113(s, 5.0, Some(frame)), 1.0, volume, area);
}

/// AC113 V4: radius 201/40 mm, so the y = -4 ruling meets the roof at
/// z = 6 + √14801/40: irrational strip vertices and Q(√14801) chart values.
/// Catalog closed form (fixtures/cad-acid/zones.json, AC113 V4; two
/// independent first-principles routes agree to 20 digits).
#[test]
fn ac113_irrational_ruling_builds_exactly() {
    ac113_check(&ac113(1e-3, 5.025, None), 1.0, 4309.4044057476274534, 2083.7494929757582582);
}
