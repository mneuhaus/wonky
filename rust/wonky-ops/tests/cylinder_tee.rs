//! Native owner: unequal-cylinder Boolean geometry, adjacent-input refusals,
//! replay binding and certified measurements. JS owns interpreter transport.
use wonky_contract::{
    Binary64, BodyKey, ContractError, CurveGeometry, PcurveGeometry, SurfaceGeometry,
};
use wonky_ops::{
    affine::Affine,
    analytic::{self, Solid},
    cylinder::{self, Spec},
    cylinder_tee::{self, Tee},
};
fn key() -> BodyKey {
    BodyKey {
        id: [3, 7, 11, 19],
        revision: 0,
    }
}
fn cylinder(spec: Spec) -> cylinder::Cylinder {
    cylinder::audit(&cylinder::create(key(), spec).unwrap().check().unwrap()).unwrap()
}
fn tools(i: usize, j: usize, sign: f64, r: f64, end: f64) -> [cylinder::Cylinder; 2] {
    let mut a = Spec {
        bottom: [0.; 3],
        top: [0.; 3],
        radius: 0.007,
    };
    a.bottom[i] = -0.011;
    a.top[i] = 0.011;
    let mut b = Spec {
        bottom: [0.; 3],
        top: [0.; 3],
        radius: r,
    };
    b.top[j] = sign * end;
    [cylinder(a), cylinder(b)]
}
fn union(a: &cylinder::Cylinder, b: &cylinder::Cylinder) -> Tee {
    let body = analytic::boolean(
        key(),
        0,
        &[Solid::Cylinder(a.clone()), Solid::Cylinder(b.clone())],
    )
    .unwrap()
    .pop()
    .unwrap();
    let words = wonky_wire::v3::encode(&body).unwrap();
    match analytic::audit(&wonky_wire::v3::decode(&words).unwrap()).unwrap() {
        Solid::CylinderTee(t) => t,
        _ => panic!("wrong carrier"),
    }
}
#[test]
fn transverse_union_is_exact_closed_and_independent_of_axis_order_and_direction() {
    // Independent 60-digit elliptic integral reference, R=7,r=3,H=22,L=19 mm.
    let (volume, area) = (3730.583826656932174495, 1507.26782154419240908);
    for i in 0..3 {
        for j in 0..3 {
            if i == j {
                continue;
            }
            for sign in [-1., 1.] {
                let [a, b] = tools(i, j, sign, 0.003, 0.019);
                let t = union(&b, &a);
                assert_eq!(t.body.faces.len(), 5);
                assert_eq!(t.body.edges.len(), 4);
                assert_eq!(t.body.vertices.len(), 0);
                let (v, s) = t.measures_mm().unwrap();
                assert!((v.m - volume).abs() < v.r + 1e-11, "{} +/- {}", v.m, v.r);
                assert!((s.m - area).abs() < s.r + 1e-11, "{} +/- {}", s.m, s.r);
                assert!(v.r / v.m < 1e-9 && s.r / s.m < 1e-9);
                for e in 0..4 {
                    let uses = t
                        .body
                        .coedges
                        .iter()
                        .filter(|c| c.edge.0 == e)
                        .collect::<Vec<_>>();
                    assert_eq!(uses.len(), 2);
                    assert_ne!(uses[0].forward, uses[1].forward);
                }
                let mut q = [0.; 3];
                q[j] = sign * 15.;
                q[i] = 5.;
                let (d, inside, bound) = t.probe(q).unwrap();
                assert!(!inside);
                assert!((d - 2.).abs() <= bound + 1e-12);
                let mut q = [0.; 3];
                q[i] = 15.;
                assert!((t.probe(q).unwrap().0 - 4.).abs() < 1e-10);
            }
        }
    }
}
#[test]
fn exact_transversality_and_cap_admission_do_not_weld_adjacent_inputs() {
    let [a, b] = tools(2, 0, 1., 0.003, 0.019);
    union(&a, &b);
    for end in [0.007, 0.007_f64.next_down()] {
        let [a, b] = tools(2, 0, 1., 0.003, end);
        assert_eq!(
            cylinder_tee::union(key(), &a, &b).unwrap_err().0,
            "cylinder-tee/end-cap-arrangement"
        );
    }
    let [a, b] = tools(2, 0, 1., 0.003, 0.007_f64.next_up());
    union(&a, &b);
    let [a, b] = tools(2, 0, 1., 0.007, 0.019);
    assert_eq!(
        cylinder_tee::union(key(), &a, &b).unwrap_err().0,
        "cylinder-tee/equal-radius-tangency"
    );
    let [a, b] = tools(2, 0, 1., 0.007_f64.next_down(), 0.019);
    union(&a, &b); // topology, no ill-conditioned integration claim
    let mut skew = b.spec;
    skew.bottom[1] = f64::EPSILON;
    skew.top[1] = f64::EPSILON;
    assert_eq!(
        cylinder_tee::union(key(), &a, &cylinder(skew))
            .unwrap_err()
            .0,
        "cylinder-tee/skew-axes"
    );
    let shifted = cylinder::audit(
        &cylinder::transform(
            &b,
            Affine {
                origin: [f64::EPSILON, 0., 0.],
                ..Affine::IDENTITY
            },
        )
        .unwrap()
        .check()
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        cylinder_tee::union(key(), &a, &shifted).unwrap_err().0,
        "cylinder-tee/different-exact-frames"
    );
}
#[test]
fn replay_rejects_forged_radical_and_open_hole() {
    let [a, b] = tools(2, 0, 1., 0.003, 0.019);
    let t = union(&a, &b);
    let forge = |body: &mut wonky_contract::Body, r: f64| {
        if let CurveGeometry::CylinderIntersection { small_radius, .. } = &mut body.curves[3].geometry {
            *small_radius = Binary64::new(r).unwrap();
        }
    };
    // A lone forged radical no longer matches its support cylinder's input.
    let mut body = t.body.clone();
    forge(&mut body, 0.004);
    assert_eq!(
        body.check().unwrap_err(),
        ContractError::Invalid("intersection pcurve support")
    );
    for mode in 0..2 {
        let mut body = t.body.clone();
        if mode == 0 {
            // Self-consistent forgery of every branch-radius record: the
            // contract cannot see it, replay of the source cylinders does.
            forge(&mut body, 0.004);
            if let SurfaceGeometry::Cylinder { radius, .. } = &mut body.surfaces[1].geometry {
                *radius = Binary64::new(0.004).unwrap();
            }
            if let CurveGeometry::Circle { radius, .. } = &mut body.curves[2].geometry {
                *radius = Binary64::new(0.004).unwrap();
            }
            if let PcurveGeometry::Circle { radius, .. } = &mut body.pcurves[5].geometry {
                *radius = Binary64::new(0.004).unwrap();
            }
        } else {
            body.coedges[2].forward = !body.coedges[2].forward;
        }
        assert_eq!(
            cylinder_tee::audit(&body.check().unwrap()).unwrap_err().0,
            "cylinder-tee/construction-carrier-mismatch"
        );
    }
}
#[test]
fn vertex_free_circles_must_be_exact_sections_of_a_supporting_cylinder() {
    // Cap rings carry no seam vertex. The contract admits that only because each
    // circle is literally its cylinder's cross-section: identical radius input,
    // parallel normal, centre on the axis, one-turn constant-height chart. Any
    // single-ulp departure is a free binary64 circle and refuses by name.
    let [a, b] = tools(2, 0, 1., 0.003, 0.019);
    let t = union(&a, &b);
    t.body.clone().check().unwrap();
    let bump = |x: &mut Binary64| *x = Binary64::new(x.get().next_up()).unwrap();
    for plant in 0..5 {
        let mut body = t.body.clone();
        match plant {
            0 => {
                // rounded cap radius: no supporting cylinder has it
                let CurveGeometry::Circle { radius, .. } = &mut body.curves[0].geometry else {
                    unreachable!()
                };
                bump(radius);
            }
            1 => {
                // centre a machine epsilon off the post axis (transverse)
                let CurveGeometry::Circle { origin, .. } = &mut body.curves[1].geometry else {
                    unreachable!()
                };
                origin[0] = Binary64::new(f64::EPSILON).unwrap();
            }
            2 => {
                // tilted normal, still orthogonal to its x direction
                let CurveGeometry::Circle { normal, .. } = &mut body.curves[2].geometry else {
                    unreachable!()
                };
                normal[1] = Binary64::new(f64::EPSILON).unwrap();
            }
            3 => {
                // the chart on the cylinder no longer spans one turn
                let PcurveGeometry::Line { b, .. } = &mut body.pcurves[0].geometry else {
                    unreachable!()
                };
                b[0] = Binary64::new(0.5).unwrap();
            }
            4 => {
                // chart height drifts, so the circle is not one constant section
                let PcurveGeometry::Line { b, .. } = &mut body.pcurves[2].geometry else {
                    unreachable!()
                };
                bump(&mut b[1]);
            }
            _ => unreachable!(),
        }
        assert_eq!(
            body.check().unwrap_err(),
            ContractError::Invalid("edge endpoints"),
            "plant {plant}"
        );
    }
    // The quartic's supports must be the two source cylinders bit for bit.
    let mut body = t.body.clone();
    let SurfaceGeometry::Cylinder { radius, .. } = &mut body.surfaces[1].geometry else {
        unreachable!()
    };
    bump(radius);
    assert_eq!(
        body.check().unwrap_err(),
        ContractError::Invalid("intersection pcurve support")
    );
}
