//! Owner-boundary tests: finite set containment, refusal semantics, width and
//! whole-cell quadrature. Independent 256-bit coverage lives in validate-va1.py.
use wonky_num::Iv;
use wonky_validated::{self as v, Enclosure, Error, Expr};

fn contains(e: Enclosure, x: f64) {
    assert!(e.lower() <= x && x <= e.upper(), "{x} not in {e:?}");
}

#[test]
fn elementary_functions_cover_whole_balls_and_preserve_exact_special_values() {
    let zero = Iv::point(0.0);
    contains(v::sin(zero, 0.0).unwrap(), 0.0);
    contains(v::cos(zero, 0.0).unwrap(), 1.0);
    contains(v::exp(zero, 0.0).unwrap(), 1.0);
    contains(v::log(Iv::point(1.0), 0.0).unwrap(), 0.0);
    contains(v::acos(Iv::point(1.0), 0.0).unwrap(), 0.0);
    // An endpoint-only enclosure would miss the interior maximum of sin.
    contains(
        v::sin(
            Iv {
                m: std::f64::consts::FRAC_PI_2,
                r: 0.125,
            },
            0.3,
        )
        .unwrap(),
        1.0,
    );
    let c = v::cos(Iv { m: 0.0, r: 4.0 }, 2.000000000000001).unwrap();
    contains(c, -1.0);
    contains(c, 1.0);
    let s = v::sin(Iv { m: 1e10, r: 1e-6 }, 1e-5).unwrap();
    for x in [1e10_f64 - 1e-6, 1e10, 1e10 + 1e-6] {
        contains(s, x.sin());
    }
    let a = v::atan2(Iv { m: 2.0, r: 0.5 }, Iv { m: 3.0, r: 1.0 }, 1.0).unwrap();
    for y in [1.5_f64, 2.0, 2.5] {
        for x in [2.0, 3.0, 4.0] {
            contains(a, y.atan2(x));
        }
    }
    for y in [0.0, -0.0] {
        contains(
            v::atan2(Iv::point(y), Iv::point(-1.0), 1e-13).unwrap(),
            std::f64::consts::PI,
        );
    }
}

#[test]
fn malformed_balls_domains_and_widths_never_become_certificates() {
    let functions = [v::sin, v::cos, v::exp, v::log, v::acos];
    for ball in [
        Iv {
            m: f64::NAN,
            r: 1.0,
        },
        Iv {
            m: 1.0,
            r: f64::NAN,
        },
        Iv {
            m: f64::INFINITY,
            r: 0.0,
        },
        Iv {
            m: 0.0,
            r: f64::INFINITY,
        },
        Iv { m: 1.0, r: -1.0 },
        Iv::point(f64::from_bits(1)),
        Iv {
            m: 1.0,
            r: f64::from_bits(1),
        },
        Iv::point(1e151),
        Iv::point(1e-151),
    ] {
        for f in functions {
            assert_eq!(f(ball, 10.0), Err(Error::InvalidInput));
        }
        assert_eq!(
            v::atan2(ball, Iv::point(1.0), 10.0),
            Err(Error::InvalidInput)
        );
        assert_eq!(
            v::atan2(Iv::point(1.0), ball, 10.0),
            Err(Error::InvalidInput)
        );
    }
    for budget in [f64::NAN, f64::INFINITY, -1.0] {
        assert_eq!(v::sin(Iv::point(1.0), budget), Err(Error::InvalidWidth));
    }
    assert!(matches!(
        v::sin(Iv::point(1.0), 0.0),
        Err(Error::WidthExceeded { .. })
    ));
    assert_eq!(
        v::sin(Iv::point(1e150), 3.0),
        Err(Error::ArgumentReductionRange)
    );
    assert!(matches!(
        v::log(Iv { m: 1.0, r: 2.0 }, 100.0),
        Err(Error::Domain(_))
    ));
    assert!(matches!(
        v::acos(Iv { m: 1.0, r: 0.01 }, 100.0),
        Err(Error::Domain(_))
    ));
    assert!(matches!(
        v::exp(Iv::point(701.0), 1e308),
        Err(Error::Domain(_))
    ));
    assert!(matches!(
        v::atan2(Iv::point(0.0), Iv::point(0.0), 10.0),
        Err(Error::Domain(_))
    ));
    assert!(matches!(
        v::atan2(Iv { m: 0.0, r: 1e-6 }, Iv::point(-1.0), 10.0),
        Err(Error::Domain(_))
    ));
}

#[test]
fn acceptance_width_rejects_a_wide_overlapping_enclosure() {
    let wide = v::sin(Iv { m: 0.0, r: 2.0 }, 3.0).unwrap();
    contains(wide, 0.0); // overlap with a reference alone is NOT acceptance
    assert!(
        matches!(wide.require_width(1e-8), Err(Error::WidthExceeded { .. })),
        "overwide overlap accepted"
    );
}

#[test]
fn certified_gl2_contains_closed_sphere_and_torus_integrals() {
    let p = Expr::Bound(v::pi(1e-13).unwrap());
    let x = Expr::Variable;
    let sphere = p.clone() * (Expr::Constant(9.0) - x.clone().square());
    let s = v::integrate(&sphere, -3.0, 3.0, 1e-10, 4096).unwrap();
    contains(s.enclosure, 36.0 * std::f64::consts::PI);
    assert!(s.enclosure.width() <= 1e-10);
    assert_eq!(s.panels, 1); // GL2 integrates the quadratic exactly (up to rounding)
    assert_eq!(s.evaluations, 3);
    // Divergence integral: theta=2*pi*x, r=1, R=5. Not a volume routine.
    let c = (Expr::Constant(2.0) * p.clone() * x).cos();
    let torus =
        Expr::Constant(2.0) * p.clone() * p * (Expr::Constant(5.0) + c.clone()).square() * c;
    let t = v::integrate(&torus, 0.0, 1.0, 1e-7, 4096).unwrap();
    contains(t.enclosure, 10.0 * std::f64::consts::PI.powi(2));
    assert!(t.enclosure.width() <= 1e-7);
    assert!(t.panels > 1);
    assert_eq!(t.evaluations, 3 * (2 * t.panels - 1));
}

#[test]
fn oscillatory_alias_is_not_certified_by_gauss_order_agreement() {
    // At Q1's node x=0 and Q2's nodes x=+/-1/sqrt(3), cos(w*x)
    // is ~1 for w=2*pi*sqrt(3). Their difference is ~0, yet the exact
    // integral 2*sin(w)/w is NEGATIVE (3*pi < w < 4*pi).
    let w = 10.882796185405308;
    let f = (Expr::Constant(w) * Expr::Variable).cos();
    let result = v::integrate(&f, -1.0, 1.0, 1e-9, 4096).unwrap();
    assert!(
        result.enclosure.upper() < 0.0,
        "Gauss alias certified as {result:?}"
    );
    contains(result.enclosure, 2.0 * w.sin() / w);
    assert!(result.enclosure.width() <= 1e-9);
    assert!(result.panels > 1);
}

#[test]
fn quadrature_algebra_and_budget_refusals_are_observable() {
    for power in 0..=6 {
        let mut f = Expr::Constant(1.0);
        for _ in 0..power {
            f = f * Expr::Variable;
        }
        let q = v::integrate(&f, 0.0, 1.0, 1e-8, 4096).unwrap();
        contains(q.enclosure, 1.0 / (power + 1) as f64);
    }
    let x = Expr::Variable;
    let f = (Expr::Constant(2.0) + x.clone()).log()
        + (Expr::Constant(4.0) + x.clone()).sqrt()
        + (x.clone() / Expr::Constant(4.0)).exp()
        + Expr::Constant(1.0) / (Expr::Constant(2.0) + x);
    let exact = 3.0 * 3.0_f64.ln() - 2.0 * 2.0_f64.ln() - 1.0
        + (2.0 / 3.0) * (5.0_f64.powf(1.5) - 8.0)
        + 4.0 * (0.25_f64.exp() - 1.0)
        + (1.5_f64).ln();
    contains(
        v::integrate(&f, 0.0, 1.0, 1e-8, 4096).unwrap().enclosure,
        exact,
    );
    assert!(matches!(
        v::integrate(&Expr::Variable.sin(), 0.0, 1.0, 0.0, 1),
        Err(Error::QuadratureBudget { panels: 1 })
    ));
    assert!(matches!(
        v::integrate(&Expr::Variable, 1.0, 0.0, 1.0, 1),
        Err(Error::InvalidInput)
    ));
    assert!(matches!(
        v::integrate(&Expr::Constant(f64::NAN), 0.0, 1.0, 1.0, 1),
        Err(Error::InvalidInput)
    ));
    assert!(v::integrate(&Expr::Variable.sqrt(), 0.0, 1.0, 1e-6, 4096).is_err());
}
