//! OM1 open cubic interpolation. All arithmetic after D1 is rational.
//! Local Cox-de Boor jets form a banded collocation system (two end
//! conditions and one value per point). Free ends have C'' = 0; specified
//! derivatives are with respect to the supplied parameter, without scaling.
use super::BSpline;
use crate::numeric::{q, P, Q};
use crate::refusal::{Refusal, R};
use num_traits::Zero;

pub const FIT_MAX_POINTS: usize = 64;
const FIT_MAX_BITS: u64 = 16384;

fn bounded(x: &Q) -> bool {
    x.numer().bits() <= FIT_MAX_BITS && x.denom().bits() <= FIT_MAX_BITS
}

/// Value and first two derivatives of a basis function, on the given span.
fn basis(knots: &[Q], j: usize, degree: usize, t: &Q, span: usize) -> [Q; 3] {
    if degree == 0 {
        return [q(if j == span { 1. } else { 0. }), Q::zero(), Q::zero()];
    }
    let mut out = [Q::zero(), Q::zero(), Q::zero()];
    let left = &knots[j + degree] - &knots[j];
    if !left.is_zero() {
        let b = basis(knots, j, degree - 1, t, span);
        let a = (t - &knots[j]) / &left;
        out[0] += &a * &b[0];
        out[1] += &a * &b[1] + &b[0] / &left;
        out[2] += &a * &b[2] + q(2.) * &b[1] / left;
    }
    let right = &knots[j + degree + 1] - &knots[j + 1];
    if !right.is_zero() {
        let b = basis(knots, j + 1, degree - 1, t, span);
        let a = (&knots[j + degree + 1] - t) / &right;
        out[0] += &a * &b[0];
        out[1] += &a * &b[1] - &b[0] / &right;
        out[2] += &a * &b[2] - q(2.) * &b[1] / right;
    }
    out
}

/// Open cubic, one simple interior knot per data parameter. End conditions
/// are independent: `None` means natural, `Some` is the native derivative.
/// No default parameter computation lives in Rust: D1 is the frontend's job.
pub fn interpolate(points: &[P], parameters: &[Q], start: Option<P>, end: Option<P>) -> R<BSpline> {
    let n = points.len();
    if n > FIT_MAX_POINTS {
        return Err(Refusal::FitBudget);
    }
    if n >= 2 && points[0] == points[n - 1] {
        return Err(Refusal::ClosedFitSpline);
    }
    if n < 2
        || parameters.len() != n
        || parameters.windows(2).any(|p| p[0] >= p[1])
        || points.windows(2).any(|p| p[0] == p[1])
    {
        return Err(Refusal::DegenerateSpan);
    }
    if points
        .iter()
        .flatten()
        .chain(parameters)
        .chain(start.iter().flatten())
        .chain(end.iter().flatten())
        .any(|x| !bounded(x))
    {
        return Err(Refusal::FitBudget);
    }
    let mut knots = vec![parameters[0].clone(); 4];
    knots.extend_from_slice(&parameters[1..n - 1]);
    knots.extend(vec![parameters[n - 1].clone(); 4]);
    let count = n + 2;
    let mut a = vec![vec![Q::zero(); count]; count];
    let mut rhs = vec![[Q::zero(), Q::zero()]; count];
    for i in 0..n {
        let row = if i == 0 {
            0
        } else if i == n - 1 {
            count - 1
        } else {
            i + 1
        };
        let span = 3 + i.min(n - 2);
        for j in 0..count {
            a[row][j] = basis(&knots, j, 3, &parameters[i], span)[0].clone();
        }
        rhs[row] = points[i].clone();
    }
    for (row, i, span, d) in [(1, 0, 3, &start), (count - 2, n - 1, n + 1, &end)] {
        let order = if d.is_some() { 1 } else { 2 };
        for j in 0..count {
            a[row][j] = basis(&knots, j, 3, &parameters[i], span)[order].clone();
        }
        rhs[row] = d.clone().unwrap_or([Q::zero(), Q::zero()]);
    }
    #[cfg(feature = "plant_fit_f64_solve")]
    let rounded_solution = {
        let mut matrix = a
            .iter()
            .map(|r| {
                r.iter()
                    .map(|v| crate::numeric::enclose(v).unwrap().m)
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        let mut values = rhs
            .iter()
            .map(|r| (*r).clone().map(|v| crate::numeric::enclose(&v).unwrap().m))
            .collect::<Vec<_>>();
        for k in 0..count {
            for i in k + 1..count {
                let factor = matrix[i][k] / matrix[k][k];
                for j in k..count {
                    matrix[i][j] -= factor * matrix[k][j];
                }
                for d in 0..2 {
                    values[i][d] -= factor * values[k][d];
                }
            }
        }
        let mut solution = vec![[0.0; 2]; count];
        for i in (0..count).rev() {
            for d in 0..2 {
                let mut v = values[i][d];
                for j in i + 1..count {
                    v -= matrix[i][j] * solution[j][d];
                }
                solution[i][d] = v / matrix[i][i];
            }
        }
        solution.into_iter().map(|p| p.map(q)).collect::<Vec<_>>()
    };
    // Half-bandwidth two (at most three after elimination); no f64 pivots,
    // signs or rank decisions. Exact zero pivots refuse rather than improvise.
    for k in 0..count {
        if a[k][k].is_zero() {
            return Err(Refusal::FitSingular);
        }
        for i in k + 1..(k + 3).min(count) {
            if a[i][k].is_zero() {
                continue;
            }
            let factor = &a[i][k] / &a[k][k];
            a[i][k] = Q::zero();
            for j in k + 1..(k + 4).min(count) {
                let v = &factor * &a[k][j];
                a[i][j] -= v;
            }
            for d in 0..2 {
                let v = &factor * &rhs[k][d];
                rhs[i][d] -= v;
            }
            if a[i].iter().chain(rhs[i].iter()).any(|x| !bounded(x)) {
                return Err(Refusal::FitBudget);
            }
        }
    }
    let mut poles = vec![[Q::zero(), Q::zero()]; count];
    for i in (0..count).rev() {
        for d in 0..2 {
            let mut v = rhs[i][d].clone();
            for j in i + 1..(i + 4).min(count) {
                v -= &a[i][j] * &poles[j][d];
            }
            poles[i][d] = v / &a[i][i];
            if !bounded(&poles[i][d]) {
                return Err(Refusal::FitBudget);
            }
        }
    }
    #[cfg(feature = "plant_fit_f64_solve")]
    {
        poles = rounded_solution;
    }
    let spline = BSpline::new(3, knots, poles, None)?;
    verify(&spline, points, parameters, start.as_ref(), end.as_ref())?;
    Ok(spline)
}

/// Independent exact evaluation of all interpolation and end-condition
/// residuals. This is replay evidence; a rounded solve cannot pass it.
pub fn verify(
    spline: &BSpline,
    points: &[P],
    parameters: &[Q],
    start: Option<&P>,
    end: Option<&P>,
) -> R<()> {
    if points.len() < 2 || points.len() != parameters.len() || spline.degree() != 3 {
        return Err(Refusal::FitResidual);
    }
    for (p, t) in points.iter().zip(parameters) {
        if spline.eval(t)? != *p {
            return Err(Refusal::FitResidual);
        }
    }
    for (i, right, expected) in [(0, true, start), (parameters.len() - 1, false, end)] {
        let t = &parameters[i];
        let span = if right {
            &spline.spans()[0]
        } else {
            spline.spans().last().unwrap()
        };
        let (d1, d2) = spline.derivatives_at(t, right)?;
        let width = span.width();
        let actual = if expected.is_some() {
            d1.map(|v| v / &width)
        } else {
            d2.map(|v| v / (&width * &width))
        };
        if actual != expected.cloned().unwrap_or([Q::zero(), Q::zero()]) {
            return Err(Refusal::FitResidual);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::numeric::pt;
    #[test]
    fn closed_input_requires_the_measured_periodic_scheme() {
        assert_eq!(
            interpolate(
                &[[0., 0.], [1., 1.], [0., 0.]].map(pt),
                &[0., 0.5, 1.].map(q),
                None,
                None
            )
            .unwrap_err(),
            Refusal::ClosedFitSpline
        );
    }
    #[test]
    fn natural_om1_and_exact_residual() {
        let pts = [[0., 0.], [10., 0.], [10., 90.]].map(pt);
        let ts = [0., 0.25, 1.].map(q);
        let s = interpolate(&pts, &ts, None, None).unwrap();
        assert_eq!(s.degree(), 3);
        assert_eq!(s.poles().len(), 5);
        assert_eq!(
            s.derivatives_at(&q(0.), true)
                .unwrap()
                .0
                .map(|v| v / q(0.25)),
            pt([45., -15.])
        );
        assert_eq!(
            s.derivatives_at(&q(1.), false)
                .unwrap()
                .0
                .map(|v| v / q(0.75)),
            pt([-15., 165.])
        );
        verify(&s, &pts, &ts, None, None).unwrap();
    }
    #[test]
    fn explicit_parameters_derivatives_and_one_sided_natural() {
        let pts = [[0., 0.], [10., 0.], [10., 90.]].map(pt);
        for ts in [[0., 0.25, 1.], [0., 0.9, 1.], [2., 3., 6.]] {
            for (start, end) in [
                (None, None),
                (Some(pt([10., 10.])), None),
                (None, Some(pt([0., 50.]))),
                (Some(pt([10., 10.])), Some(pt([0., 50.]))),
            ] {
                let t = ts.map(q);
                let s = interpolate(&pts, &t, start.clone(), end.clone()).unwrap();
                verify(&s, &pts, &t, start.as_ref(), end.as_ref()).unwrap();
            }
        }
    }
    #[test]
    fn rational_fit_poles_are_not_rounded() {
        let pts = [
            [30., 0.],
            [34., 5.],
            [33., 11.],
            [28., 16.],
            [29., 22.],
            [30., 28.],
        ]
        .map(pt);
        let ts = [0., 0.203213414, 0.401280702, 0.614923733, 0.809451223, 1.].map(q);
        let s = interpolate(&pts, &ts, None, None).unwrap();
        let mut rounded = s.poles().to_vec();
        for p in &mut rounded {
            for x in p {
                *x = q(crate::numeric::enclose(x).unwrap().m);
            }
        }
        assert_ne!(rounded, s.poles());
        let bad = BSpline::new(3, s.knots().to_vec(), rounded, None).unwrap();
        assert_eq!(
            verify(&bad, &pts, &ts, None, None),
            Err(Refusal::FitResidual)
        );
    }
    #[test]
    fn degenerate_span_and_fit_budget() {
        let pts = [[0., 0.], [1., 1.], [1., 1.], [2., 0.]].map(pt);
        assert_eq!(
            interpolate(&pts, &[0., 0.3, 0.7, 1.].map(q), None, None).unwrap_err(),
            Refusal::DegenerateSpan
        );
        assert_eq!(
            interpolate(&pts, &[0., 0.3, 0.3, 1.].map(q), None, None).unwrap_err(),
            Refusal::DegenerateSpan
        );
        assert_eq!(
            interpolate(&vec![pt([0., 0.]); 65], &vec![q(1.); 65], None, None).unwrap_err(),
            Refusal::FitBudget
        );
        let line =
            interpolate(&[[0., 0.], [10., 5.]].map(pt), &[0., 1.].map(q), None, None).unwrap();
        assert_eq!(line.eval(&q(0.5)).unwrap(), pt([5., 2.5]));
    }
}
