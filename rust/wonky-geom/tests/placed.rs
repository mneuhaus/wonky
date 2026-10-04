use wonky_geom::{
    frame::Frame,
    model::{revolution, Model},
    Q,
};
fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn frame(origin: [Q; 3], scale: [Q; 3]) -> Frame {
    Frame::new(
        origin,
        [
            [scale[0].clone(), q(0), q(0)],
            [q(0), scale[1].clone(), q(0)],
            [q(0), q(0), scale[2].clone()],
        ],
    )
    .unwrap()
}
fn cylinder(placement: Frame, own: Frame) -> Model {
    revolution::revolution(
        placement,
        own,
        &[[q(0), q(0)], [q(4), q(0)], [q(4), q(8)], [q(0), q(8)]],
        0,
    )
    .unwrap()
    .check()
    .unwrap()
}
#[test]
fn exact_common_frame_comparison_preserves_affine_circle_images() {
    let affine = frame([q(7), q(-11), q(13)], [q(2), q(2), q(3)]);
    let placed = cylinder(affine.clone(), Frame::identity());
    // Independent primitive construction: the image is radius 8, height 24.
    let own = frame([q(7), q(-11), q(13)], std::array::from_fn(|_| q(1)));
    let built = revolution::revolution(
        Frame::identity(),
        own,
        &[[q(0), q(0)], [q(8), q(0)], [q(8), q(24)], [q(0), q(24)]],
        0,
    )
    .unwrap()
    .check()
    .unwrap();
    assert_eq!(
        placed.canonical_in(&Frame::identity()).unwrap(),
        built.canonical()
    );
    assert_ne!(placed.canonical(), built.canonical());
    let mapped = placed.reframed(&Frame::identity()).unwrap();
    assert_eq!(mapped.canonical(), built.canonical());
}
#[test]
fn a_reflected_cylinder_has_the_same_exact_world_boundary() {
    let reflected = cylinder(
        frame(std::array::from_fn(|_| q(0)), [q(-1), q(1), q(1)]),
        Frame::identity(),
    );
    let base = cylinder(Frame::identity(), Frame::identity());
    assert_eq!(
        reflected.canonical_in(&Frame::identity()).unwrap(),
        base.canonical()
    );
}
#[test]
fn sub_ulp_placements_cannot_disappear_from_curved_comparison() {
    let big = Q::from_integer((1u64 << 30).into());
    let gap = Q::new(1.into(), (1u64 << 40).into());
    let a = cylinder(
        frame([big.clone(), q(0), q(0)], std::array::from_fn(|_| q(1))),
        Frame::identity(),
    );
    let b = cylinder(
        frame([big + gap, q(0), q(0)], std::array::from_fn(|_| q(1))),
        Frame::identity(),
    );
    assert_eq!(a.canonical(), b.canonical());
    assert_ne!(
        a.canonical_in(&Frame::identity()).unwrap(),
        b.canonical_in(&Frame::identity()).unwrap()
    );
}
#[test]
fn elliptic_reframing_refuses_without_losing_canonical_geometry() {
    let elliptic = cylinder(
        frame(std::array::from_fn(|_| q(0)), [q(2), q(3), q(1)]),
        Frame::identity(),
    );
    assert!(elliptic.canonical_in(&Frame::identity()).is_ok());
    assert_eq!(
        elliptic.reframed(&Frame::identity()).unwrap_err().0,
        "boolean/ssi-row-unavailable:circle/elliptic-plane-chart"
    );
}
