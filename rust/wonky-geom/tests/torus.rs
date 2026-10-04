//! F2 / G20 torus carrier: the 4-patch half-angle atlas is exact on the
//! quartic, the canonical key is the point set (frame-independent), and an
//! f64-normalised axis is not the same carrier.
use wonky_geom::frame::Frame;
use wonky_geom::model::curved::Patch;
use wonky_geom::model::{Circle3, Curve3, Torus3};
use wonky_geom::{point, Q};

fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn ratio(n: i64, d: i64) -> Q {
    Q::new(n.into(), d.into())
}
/// A tilted exact frame: origin (1, 2, 3), axis (2, 3, 6)/7, rational.
fn frame() -> Frame {
    let z = [ratio(2, 7), ratio(3, 7), ratio(6, 7)];
    let x = [ratio(3, 7), ratio(-6, 7), ratio(2, 7)];
    let y = [ratio(6, 7), ratio(2, 7), ratio(-3, 7)];
    Frame::new([q(1), q(2), q(3)], [x, y, z]).unwrap()
}

#[test]
fn four_patch_chart_points_lie_exactly_on_ring_and_spindle_tori() {
    for (major, minor) in [(q(4), q(1)), (ratio(3, 2), ratio(7, 2))] {
        let t = Torus3::new(frame(), major.clone(), minor.clone()).unwrap();
        let mut n = 0;
        for pu in [Patch::First, Patch::Second] {
            for pv in [Patch::First, Patch::Second] {
                for i in -5..=5 {
                    for j in -5..=5 {
                        let uv = [ratio(i, 5), ratio(j, 5)];
                        match t.chart_point(pu, pv, &uv) {
                            Ok(p) => {
                                assert!(t.contains_point(&p).unwrap(), "{pu:?} {pv:?} {uv:?}");
                                n += 1;
                            }
                            // Only a spindle's inner half reaches past the axis.
                            Err(e) => {
                                assert!(major < minor && pv == Patch::Second, "{e:?}");
                            }
                        }
                    }
                }
            }
        }
        assert!(n >= 2 * 2 * 121 / 2);
        // Latitude circles of the own sheet are curves of the carrier.
        let lat = Circle3::new(
            Frame::new(frame().point(&[q(0), q(0), minor.clone()]), frame().columns().clone()).unwrap(),
            &major * &major,
        )
        .unwrap();
        assert!(t.contains_curve(&Curve3::Circle(lat)).unwrap());
    }
}

#[test]
fn the_canonical_quartic_is_the_point_set() {
    // The same torus with its frame turned about the axis by the exact
    // rotation (3/5, 4/5): different columns, equal quartic coefficients.
    let f = frame();
    let [x, y, z] = f.columns().clone();
    let (c, s) = (ratio(3, 5), ratio(4, 5));
    let x2: [Q; 3] = std::array::from_fn(|i| &c * &x[i] + &s * &y[i]);
    let y2: [Q; 3] = std::array::from_fn(|i| -(&s * &x[i]) + &c * &y[i]);
    let turned = Frame::new(f.origin().clone(), [x2, y2, z]).unwrap();
    let a = Torus3::new(f, q(4), q(1)).unwrap();
    let b = Torus3::new(turned, q(4), q(1)).unwrap();
    assert_eq!(a.model_quartic(), b.model_quartic());
    let other = Torus3::new(frame(), q(4), ratio(101, 100)).unwrap();
    assert_ne!(a.model_quartic(), other.model_quartic());
}

/// Planted negative (G8's axis rule for the torus): an axis normalised in
/// binary64 gives a frame that is not an isometry, so its "torus" is not the
/// torus (4, 1): its outer equator is not the exact circle of radius 5.
#[test]
fn an_f64_normalised_axis_fails_the_identity() {
    let axis = [0.1_f64, 0.2, 0.3];
    let norm = axis.iter().map(|a| a * a).sum::<f64>().sqrt();
    let z = point(axis.map(|a| a / norm)).unwrap();
    assert_ne!(wonky_geom::dot(&z, &z), q(1));
    let x = [z[1].clone(), -z[0].clone(), q(0)];
    let y = wonky_geom::cross(&z, &x);
    let rounded = Frame::new([q(0), q(0), q(0)], [x, y, z]).unwrap();
    assert!(!rounded.is_isometry());
    let sloppy = Torus3::new(rounded, q(4), q(1)).unwrap();
    let off = (-4..=4)
        .map(|i| sloppy.chart_point(Patch::First, Patch::First, &[ratio(i, 4), q(0)]).unwrap())
        .filter(|p| wonky_geom::dot(p, p) != q(25))
        .count();
    assert!(off > 0, "vacuous: every equator point at exact radius 5");
    // The exact frame of the same construction keeps the equator exact.
    let exact = Torus3::new(frame(), q(4), q(1)).unwrap();
    for i in -4..=4 {
        let p = exact.chart_point(Patch::First, Patch::First, &[ratio(i, 4), q(0)]).unwrap();
        let d: [Q; 3] = std::array::from_fn(|k| &p[k] - &frame().origin()[k]);
        assert_eq!(wonky_geom::dot(&d, &d), q(25));
    }
}

/// Q(√d) majors (fillets3d design §2.6 "Carrier3::Torus major must accept
/// Quadratic"; errata 2): the carrier is admitted, its atlas points lie in
/// the major's field and on the quartic exactly, the canonical quartic is
/// rational exactly when R² is, and the binary64 rounding of the same major
/// is a different torus. Consumers without a Q(√d) row refuse by name.
#[test]
fn quadratic_major_tori_are_exact_carriers() {
    use wonky_curve::radical::Radical;
    use wonky_geom::model::{Carrier3, QuadraticPoint3, VertexKey};
    let three_root_two = Radical::quadratic(q(0), q(3), q(2)).unwrap();
    let one_plus_root_two = Radical::quadratic(q(1), q(1), q(2)).unwrap();
    for major in [three_root_two.clone(), one_plus_root_two.clone()] {
        let t = Torus3::quadratic(frame(), major.clone(), q(1)).unwrap();
        assert_eq!(t.major(), &major);
        let carrier = Carrier3::Torus(t.clone());
        let mut n = 0;
        for pu in [Patch::First, Patch::Second] {
            for pv in [Patch::First, Patch::Second] {
                for i in -3..=3 {
                    for j in -3..=3 {
                        let p = t.chart_point_radical(pu, pv, &[ratio(i, 3), ratio(j, 3)]).unwrap();
                        let key = VertexKey::Quadratic(QuadraticPoint3::from_coordinates(p).unwrap());
                        assert!(carrier.contains_vertex(&key).unwrap(), "{pu:?} {pv:?} {i} {j}");
                        n += 1;
                    }
                }
            }
        }
        assert_eq!(n, 196);
        assert_eq!(
            t.chart_point(Patch::First, Patch::First, &[q(0), q(0)]).unwrap_err().0,
            "boolean/ssi-row-unavailable:torus/quadratic-major"
        );
        assert_eq!(t.rational_major().unwrap_err().0, "boolean/ssi-row-unavailable:torus/quadratic-major");
        // Planted negative: the f64 major's own exact outer equator point is
        // off the exact torus (the rounding is not the carrier).
        let f = major.enclosure().unwrap().mid();
        let rounded = Torus3::new(frame(), Q::from_float(f).unwrap(), q(1)).unwrap();
        let p = rounded.chart_point(Patch::First, Patch::First, &[q(0), q(0)]).unwrap();
        assert!(rounded.contains_point(&p).unwrap());
        assert!(!t.contains_point(&p).unwrap(), "vacuous: the rounded equator lies on the exact torus");
    }
    // R = 3√2: R² = 18 is rational, so is the whole quartic; R = 1 + √2: R² = 3 + 2√2 is not.
    let a = Torus3::quadratic(frame(), three_root_two, q(1)).unwrap();
    assert!(a.model_quartic().values().all(|c| c.rational().is_some()));
    let b = Torus3::quadratic(frame(), one_plus_root_two, q(1)).unwrap();
    assert!(b.model_quartic().values().any(|c| c.rational().is_none()));
    // Two radical classes exceed the admitted class; horn and sphere rules hold.
    let two = Radical::quadratic(q(0), q(1), q(2)).unwrap() + Radical::quadratic(q(0), q(1), q(3)).unwrap();
    assert_eq!(Torus3::quadratic(frame(), two, q(1)).unwrap_err().0, "blend/number-class-exceeded:torus-major");
    assert_eq!(Torus3::quadratic(frame(), Radical::from(q(1)), q(1)).unwrap_err().0, "boolean/chart-singularity:horn-torus");
    assert_eq!(Torus3::quadratic(frame(), Radical::default(), q(1)).unwrap_err().0, "model/torus-major-zero:sphere-required");
}
