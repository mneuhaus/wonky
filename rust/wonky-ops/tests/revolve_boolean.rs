//! Boolean owner: exact frustum/cylinder intersections, not private predicates.
//! Hand-integrated washer volumes catch wrong material selection; one-ulp and
//! non-dyadic events catch snapping. Existing revolve tests never Boolean a cone.
use num_rational::BigRational as Q;
use wonky_contract::*;
use wonky_ops::{
    affine::Affine,
    analytic::{self, Solid},
    cylinder, revolve_full,
};

fn key() -> BodyKey {
    BodyKey {
        id: [42, 0, 0, 0],
        revision: 0,
    }
}
fn q(x: f64) -> Q {
    Q::from_float(x).unwrap()
}
const S: f64 = 1. / 1024.;
fn frustum(top: f64) -> Solid {
    meridian(
        Affine::IDENTITY,
        2,
        [[0., 0.], [4., 0.], [top, 4.], [0., 4.]],
    )
}
fn meridian(frame: Affine, mode: usize, points: [[f64; 2]; 4]) -> Solid {
    let lines = std::array::from_fn::<_, 4, _>(|i| {
        let (a, b) = (points[i], points[(i + 1) % 4]);
        [a[0] * S, a[1] * S, b[0] * S, b[1] * S]
    });
    let body =
        revolve_full::build(key(), [0; 4], frame, mode, &lines, std::f64::consts::TAU).unwrap();
    analytic::audit(&body.check().unwrap()).unwrap()
}
fn tool(offset: f64, radius: f64) -> Solid {
    let body = cylinder::create(
        key(),
        cylinder::Spec {
            bottom: [offset, 0., -S],
            top: [offset, 0., 5. * S],
            radius: radius * S,
        },
    )
    .unwrap();
    analytic::audit(&body.check().unwrap()).unwrap()
}
#[test]
fn coaxial_cone_booleans_have_independent_washer_volumes_and_replay() {
    let pi_lo = Q::new(
        314159265358979323846i128.into(),
        100000000000000000000i128.into(),
    );
    let pi_hi = Q::new(
        314159265358979323847i128.into(),
        100000000000000000000i128.into(),
    );
    for (op, factor) in [(0, 182.), (1, 20.), (2, 92.)] {
        let inputs = [frustum(2.), tool(0., 3.)];
        let bodies = analytic::boolean(key(), op, &inputs).unwrap();
        assert_eq!(bodies.len(), 1);
        let checked = wonky_wire::v3::decode(&wonky_wire::v3::encode(&bodies[0]).unwrap()).unwrap();
        let Solid::Revolved(result) = analytic::audit(&checked).unwrap() else {
            panic!("missing revolved boundary")
        };
        let (volume, _, faces, _) = result.measures().unwrap();
        let expected = q(factor) / q(3.) * q(S).pow(3) * q(1e9);
        assert!(
            q(volume.lo()) <= &expected * &pi_lo && q(volume.hi()) >= &expected * &pi_hi,
            "op {op}"
        );
        assert_eq!(faces.len(), bodies[0].faces.len());
        let mut corrupt = bodies[0].clone();
        if let CurveGeometry::Circle { radius, .. } = &mut corrupt.curves[0].geometry {
            *radius = Binary64::new(radius.get().next_up()).unwrap();
        }
        assert!(analytic::audit(&corrupt.check().unwrap()).is_err());
        // A subsequent cut must consume the original source DAG, not a cached
        // meridian reseeded as a fresh interpreter input.
        let chained =
            analytic::boolean(key(), 1, &[Solid::Revolved(result), tool(0., 1.)]).unwrap();
        analytic::audit(&chained[0].clone().check().unwrap()).unwrap();
        let mut corrupt = bodies[0].clone();
        corrupt.constructions.last_mut().unwrap().parameters[0] =
            Binary64::new((op + 1) as f64 % 3.).unwrap();
        assert!(analytic::audit(&corrupt.check().unwrap()).is_err());
    }
}
#[test]
fn coaxial_meridians_preserve_frame_relations_and_exact_contacts() {
    for mode in 0..3 {
        let frame = Affine {
            origin: [4., -2., 8.],
            x: [0., 1., 0.],
            z: [1., 0., 0.],
        };
        let target = meridian(frame, mode, [[0., 0.], [4., 0.], [2., 4.], [0., 4.]]);
        let tool = meridian(frame, mode, [[0., -1.], [3., -1.], [3., 5.], [0., 5.]]);
        let out = analytic::boolean(key(), 1, &[target, tool]).unwrap();
        let Solid::Revolved(result) = analytic::audit(&out[0].clone().check().unwrap()).unwrap()
        else {
            panic!("revolved")
        };
        let volume = result.measures().unwrap().0;
        let expected = 20. / 3. * std::f64::consts::PI * S.powi(3) * 1e9;
        assert!(volume.lo() <= expected && volume.hi() >= expected);
    }
    // Oppositely directed, translated source axis, same exact world cutter.
    let reversed = meridian(
        Affine {
            origin: [0., 0., 4. * S],
            z: [0., 0., -1.],
            ..Affine::IDENTITY
        },
        2,
        [[0., -1.], [3., -1.], [3., 5.], [0., 5.]],
    );
    let out = analytic::boolean(key(), 2, &[frustum(2.), reversed]).unwrap();
    let Solid::Revolved(result) = analytic::audit(&out[0].clone().check().unwrap()).unwrap() else {
        panic!("revolved")
    };
    let volume = result.measures().unwrap().0;
    let expected = 92. / 3. * std::f64::consts::PI * S.powi(3) * 1e9;
    assert!(volume.lo() <= expected && volume.hi() >= expected);
    assert_eq!(
        analytic::boolean(key(), 1, &[frustum(2.), tool(0., 5.)])
            .unwrap_err()
            .0,
        "revolve/boolean/empty-result"
    );
    let first = meridian(
        Affine::IDENTITY,
        2,
        [[1., 0.], [2., 0.], [2., 1.], [1., 1.]],
    );
    let second = meridian(
        Affine::IDENTITY,
        2,
        [[2., 1.], [3., 1.], [3., 2.], [2., 2.]],
    );
    assert_eq!(
        analytic::boolean(key(), 0, &[first, second]).unwrap_err().0,
        "revolve/boolean/non-manifold-result"
    );
    let Solid::Cylinder(c) = tool(0., 3.) else {
        unreachable!()
    };
    let scaled = cylinder::transform(
        &c,
        Affine {
            x: [1f64.next_up(), 0., 0.],
            ..Affine::IDENTITY
        },
    )
    .unwrap();
    let scaled = analytic::audit(&scaled.check().unwrap()).unwrap();
    assert_eq!(
        analytic::boolean(key(), 1, &[frustum(2.), scaled])
            .unwrap_err()
            .0,
        "frame/non-isometric-curved-image"
    );
}
#[test]
fn coaxial_cone_events_refuse_offset_axes_and_non_binary64_rings() {
    for (target, tool, reason) in [
        (
            frustum(2.),
            tool(2f64.powi(-50), 3.),
            "revolve/boolean/non-coaxial-axes",
        ),
        (
            frustum(1.),
            tool(0., 3.),
            "revolve/boolean/non-binary64-meridian-event",
        ),
    ] {
        assert_eq!(
            analytic::boolean(key(), 1, &[target, tool]).unwrap_err().0,
            reason
        );
    }
}
