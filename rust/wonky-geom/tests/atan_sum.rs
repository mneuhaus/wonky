//! `AtanSum` (boolean3d G12b): exact sums of atan terms for circular sweeps
//! off the quarter grid.
use wonky_geom::Q;
use wonky_curve::radical::Radical;
use wonky_geom::model::{AtanSum, PiValue, SurdPiValue};

fn r(n: i64, d: i64) -> Radical {
    Radical::from(Q::new(n.into(), d.into()))
}
fn f(x: &Q) -> f64 {
    use num_traits::ToPrimitive;
    x.to_f64().unwrap()
}

/// The canonical form folds atan(x) for x outside (0, 1) into π: atan(2) =
/// π/2 − atan(1/2), atan(-1/3) = −atan(1/3), atan(1) = π/4; equal arguments
/// merge and cancel exactly.
#[test]
fn canonical_form_reduces_arguments_and_merges_terms() {
    let mut a = AtanSum::default();
    a.add_atan(&r(2, 1), &r(1, 1)).unwrap();
    a.add_atan(&r(-1, 3), &r(3, 1)).unwrap();
    a.add_atan(&r(1, 1), &r(4, 1)).unwrap();
    assert_eq!(a.pi, r(3, 2));
    assert_eq!(a.terms, vec![(r(1, 3), r(-3, 1)), (r(1, 2), r(-1, 1))]);
    let mut b = AtanSum::default();
    b.add_atan(&r(1, 2), &r(1, 1)).unwrap();
    b.add_atan(&r(1, 3), &r(3, 1)).unwrap();
    b.add_pi(&r(-3, 2)).unwrap();
    a.add(&b).unwrap();
    assert!(a.is_zero());
}

/// Rational bounds enclose the value, also for an argument in Q(√d), and
/// tighten with more terms.
#[test]
fn bounds_enclose_the_value() {
    let mut a = AtanSum::default();
    let x = Radical::quadratic(Q::from_integer(0.into()), Q::new(1.into(), 3.into()), Q::from_integer(2.into())).unwrap();
    a.add_atan(&x, &r(2, 1)).unwrap();
    a.add_atan(&r(5, 7), &r(-3, 2)).unwrap();
    a.add_pi(&r(1, 5)).unwrap();
    let value = 2.0 * (2f64.sqrt() / 3.0).atan() - 1.5 * (5f64 / 7.0).atan() + std::f64::consts::PI / 5.0;
    let (lo, hi) = a.bounds(64).unwrap();
    assert!(f(&lo) <= value + 1e-15 && value - 1e-15 <= f(&hi), "{} {value} {}", f(&lo), f(&hi));
    assert!(f(&hi) - f(&lo) < 1e-12);
}

/// A `SurdPiValue` with atan terms has a certified sign and refuses a
/// consumer without the slot by name.
#[test]
fn surd_values_carry_atan_terms() {
    let mut v = SurdPiValue::rational(PiValue { rational: Q::from_integer((-1).into()), ..PiValue::default() });
    // 4 atan(1/2) ≈ 1.8546 > 1.
    v.atans.add_atan(&r(1, 2), &r(4, 1)).unwrap();
    assert_eq!(v.sign().unwrap(), std::cmp::Ordering::Greater);
    assert_eq!(v.without_surd().unwrap_err().0, "boolean/ssi-row-unavailable:measure/transcendental-angle");
    let doubled = v.scaled(&Q::from_integer(2.into())).unwrap();
    assert_eq!(doubled.atans.terms, vec![(r(1, 2), r(8, 1))]);
    assert!((doubled.to_f64() - 2.0 * (4.0 * 0.5f64.atan() - 1.0)).abs() < 1e-14);
}
