//! Uniform export enclosure is an independent numerical contract: omitting
//! the fourth-derivative remainder fails on x^4, endpoint-only fitting is not
//! sufficient. asin exercises the inverse-trig chart derivative algebra.
use wonky_validated::{cubic, Expr};
#[test]
fn cubic_encloses_between_samples_not_just_at_the_endpoints() {
    let x = Expr::Variable;
    let f = x.clone().square().square();
    let c = cubic(&f, -0.5, 0.5).unwrap();
    assert!(c.error >= 0.0625 && c.error < 0.063);
    for i in 0..=100 {
        let t = i as f64 / 100.;
        let x = t - 0.5;
        let u = 1. - t;
        let v = c.controls[0] * u * u * u
            + 3. * c.controls[1] * u * u * t
            + 3. * c.controls[2] * u * t * t
            + c.controls[3] * t * t * t;
        assert!((v - x.powi(4)).abs() <= c.error);
    }
    let f = (Expr::Constant(0.5) * Expr::Variable.sin()).asin();
    let c = cubic(&f, 0.1, 0.2).unwrap();
    assert!(c.error < 1e-5);
    for i in 0..=100 {
        let t = i as f64 / 100.;
        let x = 0.1 + 0.1 * t;
        let u = 1. - t;
        let v = c.controls[0] * u * u * u
            + 3. * c.controls[1] * u * u * t
            + 3. * c.controls[2] * u * t * t
            + c.controls[3] * t * t * t;
        assert!((v - (0.5 * x.sin()).asin()).abs() <= c.error + 1e-15);
    }
    assert!(cubic(&Expr::Variable.asin(), 0.9, 1.1).is_err());
}

#[test]
fn overflowing_control_arithmetic_is_a_named_refusal_not_a_nan_spline() {
    // Finite endpoint values and derivatives, but h*f' overflows while
    // constructing the interior Bernstein controls. max(NaN) must not hide it.
    let f = Expr::Constant(1e150) * Expr::Constant(1e150) * Expr::Constant(1e8) * Expr::Variable;
    assert!(cubic(&f, -1., 1.).is_err());
}
