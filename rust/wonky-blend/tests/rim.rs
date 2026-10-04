//! F2 rim blends on Model: exact torus/sphere bands from ring fillets of
//! revolution Models, checked against closed forms (fixtures/fillet/cases.json
//! pc-* rows and AC33, Pappus) and against the full Model audit.
use num_traits::{ToPrimitive, Zero};
use wonky_blend::rim::{ring_chamfer, ring_fillet};
use wonky_geom::frame::Frame;
use wonky_geom::model::{revolution::revolution, Bounds, Carrier3, Curve3, EdgeId, Membership, Model, PiValue, Torus3};
use wonky_curve::radical::Radical;
use wonky_geom::{point, Q};

fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn r(x: f64) -> Q {
    Q::from_float(x).unwrap()
}
fn model(profile: &[[i64; 2]]) -> Model {
    let p: Vec<[Q; 2]> = profile.iter().map(|p| [q(p[0]), q(p[1])]).collect();
    revolution(Frame::identity(), Frame::identity(), &p, 0).unwrap().check().unwrap()
}
/// The ring edge of radius `rho` at height `z`.
fn ring(m: &Model, rho: i64, z: i64) -> EdgeId {
    let d = m.draft();
    let found: Vec<_> = (0..d.edges.len())
        .filter(|&i| {
            let e = &d.edges[i];
            matches!(e.bounds, Bounds::Ring)
                && matches!(&d.curves[e.curve.index()].geometry, Curve3::Circle(c)
                    if c.radius2() == q(rho * rho) && c.frame().is_ok_and(|f| f.origin()[2] == q(z)))
        })
        .collect();
    assert_eq!(found.len(), 1, "ring ({rho},{z})");
    EdgeId(found[0] as u32)
}
fn post() -> Model {
    model(&[[0, 0], [5, 0], [5, 10], [0, 10]])
}
fn kinds(m: &Model) -> Vec<&'static str> {
    m.draft()
        .faces
        .iter()
        .map(|f| match &m.draft().surfaces[f.surface.index()].carrier {
            Carrier3::Plane(_) | Carrier3::RadicalPlane(_) => "plane",
            Carrier3::Cylinder(_) | Carrier3::TranslatedCylinder(_) => "cylinder",
            Carrier3::Cone(_) => "cone",
            Carrier3::Sphere(_) => "sphere",
            Carrier3::Torus(_) => "torus",
            Carrier3::Rotated(_) => "rotated",
        })
        .collect()
}
fn pi(v: &PiValue) -> (Q, Q, Q) {
    (v.rational.clone(), v.pi.clone(), v.pi2.clone())
}
fn approx(v: &PiValue) -> f64 {
    let p = std::f64::consts::PI;
    v.rational.to_f64().unwrap() + v.pi.to_f64().unwrap() * p + v.pi2.to_f64().unwrap() * p * p
}
fn volume6(m: &Model) -> PiValue {
    m.volume6_pi().unwrap().remove(0)
}

#[test]
fn post_top_rim_is_an_exact_ring_torus() {
    let m = post();
    let (f, rim) = ring_fillet(&m, ring(&m, 5, 10), &q(1), 7).unwrap();
    assert!(rim.convex);
    assert_eq!((rim.major.rational().unwrap(), rim.minor.clone()), (q(4), q(1)));
    let mut k = kinds(&f);
    k.sort();
    assert_eq!(k, ["cylinder", "plane", "plane", "torus"]);
    // 6V = 2(250π − 2π(25/6 − π)) ·3 = 1450π + 12π² (Pappus, pc-post-top-rim-r1).
    assert_eq!(pi(&volume6(&f)), (q(0), q(1450), q(12)));
    let delta = approx(&volume6(&f)) / 6. - 250. * std::f64::consts::PI;
    assert!((delta - -6.440729977736223).abs() < 1e-11, "{delta}");
    // Area: 25π + 90π + 16π + 2π·1·(4·π/2 + 1).
    assert_eq!(pi(&f.area_pi().unwrap().remove(0)), (q(0), q(133), q(4)));
    let at = |x: f64, z: f64| f.membership(&point([x, 0., z]).unwrap(), false).unwrap();
    assert_eq!(at(4.5, 9.5), Membership::Inside);
    assert_eq!(at(4.9, 9.9), Membership::Outside);
    assert_eq!(at(2., 5.), Membership::Inside);
    // On the torus face at tube half-angle 1/2: (cos, sin) = (3/5, 4/5).
    let exact = [Q::new(23.into(), 5.into()), q(0), Q::new(49.into(), 5.into())];
    let Membership::Boundary(face) = f.membership(&exact, false).unwrap() else { panic!("torus point") };
    assert!(matches!(f.draft().surfaces[f.draft().faces[face.index()].surface.index()].carrier, Carrier3::Torus(_)));
    // A spring-ring point lies on two faces: the edge refusal, not a guess.
    let e = f.membership(&point([4., 0., 10.]).unwrap(), false).unwrap_err();
    assert_eq!(e.0, "boolean/contract-violation:classify/witness-on-edge");
}

#[test]
fn spindle_and_near_sphere_rims_use_the_apple_sheet() {
    let m = post();
    for (radius, closed) in [(3.5, -69.67513459197049), (4.99, -130.45161422724163)] {
        let (f, rim) = ring_fillet(&m, ring(&m, 5, 10), &r(radius), 1).unwrap();
        assert!(rim.major < Radical::from(rim.minor.clone()), "spindle expected");
        let delta = approx(&volume6(&f)) / 6. - 250. * std::f64::consts::PI;
        assert!((delta - closed).abs() < 1e-10 * closed.abs(), "{radius}: {delta} vs {closed}");
        // A point inside the lemon (mirrored sheet) region of the spindle is
        // still material: only the apple sheet bounds the face.
        assert_eq!(f.membership(&point([0., 0., 9.9]).unwrap(), false).unwrap(), Membership::Inside);
    }
}

#[test]
fn radius_equal_to_the_rim_emits_a_sphere_and_larger_refuses_by_name() {
    let m = post();
    let (f, rim) = ring_fillet(&m, ring(&m, 5, 10), &q(5), 1).unwrap();
    assert!(rim.major.is_zero());
    let mut k = kinds(&f);
    k.sort();
    assert_eq!(k, ["cylinder", "plane", "sphere"]);
    let delta = approx(&volume6(&f)) / 6. - 250. * std::f64::consts::PI;
    assert!((delta - -130.89969389957463).abs() < 1e-10, "{delta}");
    let e = ring_fillet(&m, ring(&m, 5, 10), &q(6), 1).unwrap_err();
    assert_eq!(e.0, "blend/radius-exceeds-rim(6,5)");
    // The band is consumed before the post is: a refusal, not a clamp.
    let short = model(&[[0, 0], [5, 0], [5, 2], [0, 2]]);
    let e = ring_fillet(&short, ring(&short, 5, 2), &q(2), 1).unwrap_err();
    assert!(e.0.starts_with("blend/overflow:band-consumed"), "{e:?}");
}

#[test]
fn hole_rims_both_post_rims_and_a_concave_boss_root() {
    let pi = std::f64::consts::PI;
    // Washer: hole rim ρ = 4 at the top, plane outside the ring (pc-hole-rim-r1 section).
    let washer = model(&[[4, 0], [10, 0], [10, 6], [4, 6]]);
    let v0 = approx(&volume6(&washer)) / 6.;
    let (f, rim) = ring_fillet(&washer, ring(&washer, 4, 6), &q(1), 1).unwrap();
    assert!(rim.convex && rim.major == q(5));
    assert!((approx(&volume6(&f)) / 6. - v0 - -5.6947179819779254).abs() < 1e-11);
    let (g, _) = ring_fillet(&f, ring(&f, 4, 0), &q(1), 2).unwrap();
    assert!((approx(&volume6(&g)) / 6. - v0 - -11.389435963955851).abs() < 1e-11);
    // Both rims of a post (pc-post-both-rims-r1).
    let m = post();
    let (f, _) = ring_fillet(&m, ring(&m, 5, 10), &q(1), 1).unwrap();
    let (g, _) = ring_fillet(&f, ring(&f, 5, 0), &q(1), 2).unwrap();
    assert!((approx(&volume6(&g)) / 6. - 250. * pi - -12.881459955472446).abs() < 1e-11);
    // Boss root on a disk: concave, adds material (pc-post-base-concave-r1).
    let boss = model(&[[0, 0], [10, 0], [10, 3], [4, 3], [4, 13], [0, 13]]);
    let v0 = approx(&volume6(&boss)) / 6.;
    let (f, rim) = ring_fillet(&boss, ring(&boss, 4, 3), &q(1), 1).unwrap();
    assert!(!rim.convex && rim.major == q(5));
    assert!((approx(&volume6(&f)) / 6. - v0 - 5.6947179819779254).abs() < 1e-11);
    assert_eq!(f.membership(&point([4.1, 0., 3.1]).unwrap(), false).unwrap(), Membership::Inside);
    assert_eq!(f.membership(&point([4.9, 0., 3.9]).unwrap(), false).unwrap(), Membership::Outside);
}

/// Planted negative: a torus whose major radius went through an f64 square
/// root (the rounded value of an exact rational) must fail the Model's
/// identity audit: its spring rings are no longer on the carrier.
#[test]
fn an_f64_sqrt_major_radius_fails_the_identity_audit() {
    let m = post();
    let radius = r(0.1);
    let (f, rim) = ring_fillet(&m, ring(&m, 5, 10), &radius, 1).unwrap();
    let exact = rim.major.rational().unwrap();
    let rounded = r((&exact * &exact).to_f64().unwrap().sqrt());
    assert_ne!(rounded, exact, "vacuous: the f64 route must differ");
    let mut d = f.into_draft();
    let s = d
        .surfaces
        .iter_mut()
        .find(|s| matches!(s.carrier, Carrier3::Torus(_)))
        .unwrap();
    let Carrier3::Torus(t) = &s.carrier else { unreachable!() };
    s.carrier = Carrier3::Torus(Torus3::new(t.frame.clone(), rounded, t.minor().clone()).unwrap());
    let e = d.check().unwrap_err();
    assert_eq!(e.0, "model/g2-curve-off-carrier");
}

/// A face sense flipped on the tube band is caught by the band audit.
#[test]
fn a_flipped_tube_face_fails_the_band_orientation_audit() {
    let m = post();
    let (f, _) = ring_fillet(&m, ring(&m, 5, 10), &q(1), 1).unwrap();
    let mut d = f.into_draft();
    let i = d
        .faces
        .iter()
        .position(|f| matches!(d.surfaces[f.surface.index()].carrier, Carrier3::Torus(_)))
        .unwrap();
    d.faces[i].forward = !d.faces[i].forward;
    assert!(d.check().is_err());
}

/// AC33: an equal-offset chamfer of a circular rim is one cone band through
/// the two spring rings, exact in Q + Qπ (Pappus: 512π − 2π·(22/3)·2).
#[test]
fn ac33_rim_chamfer_is_an_exact_cone_band() {
    let m = model(&[[0, 0], [8, 0], [8, 8], [0, 8]]);
    let (f, rim) = ring_chamfer(&m, ring(&m, 8, 8), &q(2), 7).unwrap();
    assert!(rim.convex);
    assert_eq!((rim.major.rational().unwrap(), rim.minor.clone()), (q(6), q(2)));
    let mut k = kinds(&f);
    k.sort();
    assert_eq!(k, ["cone", "cylinder", "plane", "plane"]);
    assert_eq!(pi(&volume6(&f)), (q(0), q(2896), q(0)));
    let closed = 1516.34205413267353643130253966;
    assert!((approx(&volume6(&f)) / 6. - closed).abs() < 1e-10, "AC33 volume");
    // The cone is the meridian line ρ + z = 14 between (6, 8) and (8, 6).
    let at = |x: f64, z: f64| f.membership(&point([x, 0., z]).unwrap(), false).unwrap();
    assert_eq!(at(7.5, 7.5), Membership::Outside);
    assert_eq!(at(6.5, 7.4), Membership::Inside);
    let Membership::Boundary(face) = at(7., 7.) else { panic!("cone point") };
    assert!(matches!(f.draft().surfaces[f.draft().faces[face.index()].surface.index()].carrier, Carrier3::Cone(_)));
    // Same input and distance as a fillet: a different solid (non-vacuous).
    let (g, _) = ring_fillet(&m, ring(&m, 8, 8), &q(2), 7).unwrap();
    assert_ne!(pi(&volume6(&g)), pi(&volume6(&f)));
}

#[test]
fn chamfers_of_hole_rims_both_rims_and_a_concave_boss_root() {
    // Washer hole rim ρ = 4 at the top: removes 2π(4 + 1/3)·1/2 = 13π/3.
    let washer = model(&[[4, 0], [10, 0], [10, 6], [4, 6]]);
    let v0 = pi(&volume6(&washer));
    let (f, rim) = ring_chamfer(&washer, ring(&washer, 4, 6), &q(1), 1).unwrap();
    assert!(rim.convex && rim.major == q(5));
    assert_eq!(pi(&volume6(&f)), (q(0), &v0.1 - q(26), q(0)));
    let (g, _) = ring_chamfer(&f, ring(&f, 4, 0), &q(1), 2).unwrap();
    assert_eq!(pi(&volume6(&g)), (q(0), &v0.1 - q(52), q(0)));
    // Boss root on a disk: concave, adds 13π/3.
    let boss = model(&[[0, 0], [10, 0], [10, 3], [4, 3], [4, 13], [0, 13]]);
    let v0 = pi(&volume6(&boss));
    let (f, rim) = ring_chamfer(&boss, ring(&boss, 4, 3), &q(1), 1).unwrap();
    assert!(!rim.convex && rim.major == q(5));
    assert_eq!(pi(&volume6(&f)), (q(0), &v0.1 + q(26), q(0)));
    assert_eq!(f.membership(&point([4.2, 0., 3.2]).unwrap(), false).unwrap(), Membership::Inside);
    assert_eq!(f.membership(&point([4.6, 0., 3.6]).unwrap(), false).unwrap(), Membership::Outside);
}

#[test]
fn a_chamfer_as_wide_as_the_rim_ends_in_a_cone_apex_and_wider_refuses() {
    let m = post();
    let (f, rim) = ring_chamfer(&m, ring(&m, 5, 10), &q(5), 1).unwrap();
    assert!(rim.major.is_zero());
    let mut k = kinds(&f);
    k.sort();
    assert_eq!(k, ["cone", "cylinder", "plane"]);
    // 250π − 2π(5 − 5/3)·25/2 = 500π/3.
    assert_eq!(pi(&volume6(&f)), (q(0), q(1000), q(0)));
    let e = ring_chamfer(&m, ring(&m, 5, 10), &q(6), 1).unwrap_err();
    assert_eq!(e.0, "blend/width-exceeds-rim(6,5)");
    let short = model(&[[0, 0], [5, 0], [5, 2], [0, 2]]);
    let e = ring_chamfer(&short, ring(&short, 5, 2), &q(2), 1).unwrap_err();
    assert!(e.0.starts_with("blend/overflow:band-consumed"), "{e:?}");
}

/// A face sense flipped on the cone band is caught by the Model audit.
#[test]
fn a_flipped_chamfer_cone_fails_the_audit() {
    let m = post();
    let (f, _) = ring_chamfer(&m, ring(&m, 5, 10), &q(1), 1).unwrap();
    let mut d = f.into_draft();
    let i = d
        .faces
        .iter()
        .position(|f| matches!(d.surfaces[f.surface.index()].carrier, Carrier3::Cone(_)))
        .unwrap();
    d.faces[i].forward = !d.faces[i].forward;
    assert!(d.check().is_err());
}

/// pc-cone-rim-r1 (fixtures/fillet/cases.json; frustum R 8 → 5 over 10,
/// fillet r 1 on the top rim): the ball centre is at height 9 and one radius
/// off the generator of length √109/10, so the torus major is
/// R = (53 − √109)/10 and the cone spring is (R + 10/√109, 9 + 3/√109). The
/// tube band runs from the cone normal's angle (tan = 3/10) to 90°, so the
/// volume is exact in Q(√109)[π] plus π·atan(3/10); its value is checked
/// against the catalogue closed form (Pappus) ΔV = −3.2038500816319346.
#[test]
fn frustum_top_fillet_is_exact_in_q_sqrt_109_and_atan() {
    let frustum = model(&[[0, 0], [8, 0], [5, 10], [0, 10]]);
    let (f, rim) = ring_fillet(&frustum, ring(&frustum, 5, 10), &q(1), 3).unwrap();
    assert!(rim.convex);
    let major = Radical::quadratic(Q::new(53.into(), 10.into()), Q::new((-1).into(), 10.into()), q(109)).unwrap();
    assert_eq!(rim.major, major);
    let mut k = kinds(&f);
    k.sort();
    assert_eq!(k, ["cone", "plane", "plane", "torus"]);
    let radical = f.draft().curves.iter().filter(|c| matches!(c.geometry, Curve3::RadicalCircle(_))).count();
    assert_eq!(radical, 2, "cone spring and plane spring");
    assert_eq!(f.volume6_pi().unwrap_err().0, "boolean/ssi-row-unavailable:measure/transcendental-angle");
    let v = f.volume6_surd().unwrap().remove(0);
    assert_eq!(v.angle, Q::new(3.into(), 10.into()));
    assert!(!v.angle_pi[0].is_zero());
    assert_eq!(v.sign().unwrap(), std::cmp::Ordering::Greater);
    let delta = v.to_f64() / 6. - 430. * std::f64::consts::PI;
    assert!((delta - -3.2038500816319346).abs() < 1e-11, "{delta}");
    let (lo, hi) = v.enclosure(64).unwrap();
    assert!(hi - lo < Q::new(1.into(), 1_000_000_000_000i64.into()));
    let at = |x: f64, z: f64| f.membership(&point([x, 0., z]).unwrap(), false).unwrap();
    assert_eq!(at(4.9, 9.95), Membership::Outside);
    assert_eq!(at(4.3, 9.5), Membership::Inside);
    assert_eq!(at(2., 5.), Membership::Inside);
    // A flipped tube face fails the audit.
    let mut d = f.into_draft();
    let i = d.faces.len() - 1;
    d.faces[i].forward = !d.faces[i].forward;
    assert!(d.check().is_err());
    // Too large: the tube centre circle would pass the axis (R = 5 − 0.744·7 < 0).
    let e = ring_fillet(&frustum, ring(&frustum, 5, 10), &q(7), 3).unwrap_err();
    assert!(e.0.starts_with("blend/radius-exceeds-rim("), "{e:?}");
}

/// ch-cone-rim-0.42 (fixtures/fillet/cases.json; frustum R 8 → 5 over 10,
/// EQUAL_OFFSETS 0.42 on the top rim): the cone spring is set back 0.42
/// along the generator of length √109, so the spring ring and the chamfer
/// cone are in Q(√109). Pappus on the removed meridian triangle
/// E (5, 10), P (5 − w, 10), C (5 + 3w/√109, 10 − 10w/√109):
/// 6ΔV = −20π w² (15 − w + 3w/√109)/√109, exactly
/// 6V = (2580 − 60w³/109)π − (20w²(15 − w)/109)·√109·π.
#[test]
fn frustum_top_chamfer_is_exact_in_q_sqrt_109() {
    use wonky_geom::model::SurdPiValue;
    let frustum = model(&[[0, 0], [8, 0], [5, 10], [0, 10]]);
    let w = Q::new(21.into(), 50.into());
    let (f, rim) = ring_chamfer(&frustum, ring(&frustum, 5, 10), &w, 3).unwrap();
    assert!(rim.convex);
    assert_eq!((rim.major.rational().unwrap(), rim.minor.clone()), (q(5) - &w, w.clone()));
    let mut k = kinds(&f);
    k.sort();
    assert_eq!(k, ["cone", "cone", "plane", "plane"]);
    // The spring ring is a Q(√109) latitude shared by both cone bands.
    let radical = f.draft().curves.iter().filter(|c| matches!(c.geometry, Curve3::RadicalCircle(_))).count();
    assert_eq!(radical, 1);
    // A rational consumer refuses the Q(√d) volume by name.
    assert_eq!(f.volume6_pi().unwrap_err().0, "boolean/ssi-row-unavailable:measure/quadratic-surd");
    let v: SurdPiValue = f.volume6_surd().unwrap().remove(0);
    let w3 = &w * &w * &w;
    assert_eq!(pi(&v.base), (q(0), q(2580) - q(60) * &w3 / q(109), q(0)));
    let root = q(20) * &w * &w * (q(15) - &w) / q(109);
    // root·√surd = −root_expected·√109, in whichever representative of the
    // square class the measure stores.
    assert_eq!((v.root.rational.clone(), v.root.pi2.clone()), (q(0), q(0)));
    assert!(v.root.pi < q(0));
    assert_eq!(&v.root.pi * &v.root.pi * &v.surd, &root * &root * q(109));
    let delta = v.to_f64() / 6. - 430. * std::f64::consts::PI;
    assert!((delta - -2.601067091480044).abs() < 1e-11, "{delta}");
    assert_eq!(v.sign().unwrap(), std::cmp::Ordering::Greater);
    // Membership by exact rays through the Q(√109) cone (quartic roots).
    let at = |x: f64, z: f64| f.membership(&point([x, 0., z]).unwrap(), false).unwrap();
    assert_eq!(at(4.5, 9.9), Membership::Inside);
    assert_eq!(at(5.0, 9.9), Membership::Outside);
    assert_eq!(at(5.2, 9.0), Membership::Inside);
    assert_eq!(at(2., 5.), Membership::Inside);
    // A flipped chamfer face fails the audit (outward by coherence).
    let mut d = f.clone().into_draft();
    let i = d.faces.len() - 1;
    d.faces[i].forward = !d.faces[i].forward;
    assert!(d.check().is_err());
}

/// Planted negative: the Q(√109) spring ring replaced by its binary64
/// rounding (an f64 sqrt) is off both cones and fails the identity audit.
#[test]
fn an_f64_rounded_cone_spring_fails_the_identity_audit() {
    use wonky_geom::model::RadicalCircle3;
    let frustum = model(&[[0, 0], [8, 0], [5, 10], [0, 10]]);
    let (f, _) = ring_chamfer(&frustum, ring(&frustum, 5, 10), &Q::new(21.into(), 50.into()), 3).unwrap();
    let mut d = f.into_draft();
    let i = d.curves.iter().position(|c| matches!(c.geometry, Curve3::RadicalCircle(_))).unwrap();
    let Curve3::RadicalCircle(c) = &d.curves[i].geometry else { unreachable!() };
    let rounded = |x: &Radical| Radical::from(r(x.enclosure().unwrap().m));
    let planted = RadicalCircle3::new(c.frame.clone(), rounded(c.height()), rounded(c.radius())).unwrap();
    d.curves[i].geometry = Curve3::RadicalCircle(planted);
    assert!(d.check().is_err());
}

/// A 45° countersink (AC119 class: plate R 10 × 5 with a cone hole from
/// (2, 2) to (5, 5) over a bore r 2): the top rim chamfer sets back w along
/// the plate and w along the cone generator of length √2. Removed meridian
/// triangle E (5, 5), P (5 + w, 5), C (5 − w/√2, 5 − w/√2), so with w = 1:
/// 6V = 6·453π + π − 16√2·π = 2719π − 16√2·π.
#[test]
fn countersink_rim_chamfer_is_exact_in_q_sqrt_2() {
    let plate = model(&[[2, 0], [10, 0], [10, 5], [5, 5], [2, 2]]);
    assert_eq!(pi(&volume6(&plate)), (q(0), q(2718), q(0)));
    let (f, rim) = ring_chamfer(&plate, ring(&plate, 5, 5), &q(1), 4).unwrap();
    assert!(rim.convex);
    assert_eq!(rim.major, q(6));
    let v = f.volume6_surd().unwrap().remove(0);
    assert_eq!(pi(&v.base), (q(0), q(2719), q(0)));
    assert_eq!((v.root.rational.clone(), v.root.pi2.clone()), (q(0), q(0)));
    assert!(v.root.pi < q(0));
    assert_eq!(&v.root.pi * &v.root.pi * &v.surd, q(512));
    let at = |x: f64, z: f64| f.membership(&point([x, 0., z]).unwrap(), false).unwrap();
    assert_eq!(at(5.2, 4.9), Membership::Outside);
    assert_eq!(at(6.5, 4.5), Membership::Inside);
    assert_eq!(at(2.2, 2.5), Membership::Outside);
}

/// A concave root: a cone boss (R 5 → 3 over z 2 → 5) on a plate R 10 × 2.
/// The chamfer adds the meridian triangle E (5, 2), P (5 + w, 2),
/// C (5 − 2w/√13, 2 + 3w/√13) (generator length √13/3), in Q(√13).
#[test]
fn cone_boss_root_chamfer_adds_material_in_q_sqrt_13() {
    let boss = model(&[[0, 0], [10, 0], [10, 2], [5, 2], [3, 5], [0, 5]]);
    let before = volume6(&boss);
    let (f, rim) = ring_chamfer(&boss, ring(&boss, 5, 2), &q(1), 4).unwrap();
    assert!(!rim.convex);
    let v = f.volume6_surd().unwrap().remove(0);
    let s13 = 13f64.sqrt();
    let added = 2. * std::f64::consts::PI * (16. - 2. / s13) / 3. * (1.5 / s13);
    let delta = (v.to_f64() - approx(&before)) / 6.;
    assert!((delta - added).abs() < 1e-12, "{delta} vs {added}");
    assert_eq!(f.draft().curves.iter().filter(|c| matches!(c.geometry, Curve3::RadicalCircle(_))).count(), 1);
}

/// A 3-4-5 frustum (R 8 → 5 over 4): the generator length 5/4 is rational,
/// so the same construction stays in Q: zc = 4 − 4w/5, ρc = 5 + 3w/5;
/// w = 1: 6V = 1032π − 6·2π·(14.6/3)·0.4 = (25216/25)π.
#[test]
fn pythagorean_frustum_chamfer_stays_rational() {
    let pythagorean = model(&[[0, 0], [8, 0], [5, 4], [0, 4]]);
    let (f, rim) = ring_chamfer(&pythagorean, ring(&pythagorean, 5, 4), &q(1), 1).unwrap();
    assert!(rim.convex);
    assert!(f.draft().curves.iter().all(|c| !matches!(c.geometry, Curve3::RadicalCircle(_))));
    assert_eq!(pi(&volume6(&f)), (q(0), Q::new(25216.into(), 25.into()), q(0)));
    // Too wide: the plane ring would pass the axis; the band would be consumed.
    let e = ring_chamfer(&pythagorean, ring(&pythagorean, 5, 4), &q(5), 1).unwrap_err();
    assert!(e.0.starts_with("blend/width-exceeds-rim("), "{e:?}");
    // A low frustum (k = −3): the spring passes the base before the plane ring
    // reaches the axis.
    let low = model(&[[0, 0], [8, 0], [5, 1], [0, 1]]);
    let e = ring_chamfer(&low, ring(&low, 5, 1), &q(4), 1).unwrap_err();
    assert!(e.0.starts_with("blend/overflow:band-consumed("), "{e:?}");
}
