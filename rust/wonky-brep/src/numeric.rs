//! Expression-specific exact predicates. No rounded differences become inputs.
use crate::{Error, Result};
use wonky_num::{expansion as ex, Refusal, Sign, UndecidedKind, P3};

pub(crate) fn xyz(p: P3) -> [f64; 3] {
    [p.x, p.y, p.z]
}

pub(crate) fn check(values: &[f64], site: &'static str) -> Result<()> {
    wonky_num::check_range(values, site).map_err(|e| Error::Numeric(e.into_refusal()))
}

pub(crate) fn point(p: P3) -> Result<()> {
    check(&xyz(p), "brep point")
}

pub(crate) fn finish(e: &[f64], g: &ex::Guard) -> Result<Sign> {
    if !g.exact() {
        return Err(Error::Numeric(Refusal {
            site: "brep expansion",
            kind: UndecidedKind::NotExact,
        }));
    }
    Ok(match ex::sign(e) {
        -1 => Sign::Negative,
        0 => Sign::Zero,
        _ => Sign::Positive,
    })
}

pub(crate) fn compare(a: f64, b: f64) -> Result<Sign> {
    check(&[a, b], "brep compare")?;
    let mut g = ex::Guard::new();
    let d = ex::difference(a, b, &mut g);
    finish(&d, &g)
}

pub(crate) fn plane_side(normal: P3, p: P3, origin: P3) -> Result<Sign> {
    wonky_num::plane_side(normal, p, origin, "brep plane incidence")
        .map_err(|e| Error::Numeric(e.into_refusal()))
}

pub(crate) fn parallel(a: P3, b: P3) -> Result<bool> {
    wonky_num::parallel(a, b, "brep tangent planes").map_err(|e| Error::Numeric(e.into_refusal()))
}

pub(crate) fn nonzero(p: P3) -> Result<bool> {
    point(p)?;
    Ok(xyz(p).into_iter().any(|x| Sign::of_exact(x) != Sign::Zero))
}

/// Is p exactly a + t*(b-a) over the authoritative binary64 inputs?
pub(crate) fn on_line_at(p: P3, a: P3, b: P3, t: f64) -> Result<bool> {
    let mut g = ex::Guard::new();
    for ((p, a), b) in xyz(p).into_iter().zip(xyz(a)).zip(xyz(b)) {
        let d = ex::difference(b, a, &mut g);
        let td = ex::scale(&d, t, &mut g);
        let offset = ex::difference(a, p, &mut g);
        let residual = ex::sum(&offset, &td, &mut g);
        if finish(&residual, &g)? != Sign::Zero {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Closed-segment membership using audited endpoints. Bounding-box comparisons
/// and all three projected orientations avoid division and rounded differences.
pub(crate) fn on_segment(p: P3, a: P3, b: P3) -> Result<bool> {
    let (p, a, b) = (xyz(p), xyz(a), xyz(b));
    for i in 0..3 {
        let from_a = compare(p[i], a[i])?;
        let from_b = compare(p[i], b[i])?;
        if from_a == from_b && from_a != Sign::Zero {
            return Ok(false);
        }
    }
    for i in 0..3 {
        let j = (i + 1) % 3;
        let side = wonky_num::orient2d(
            wonky_num::p2(a[i], a[j]),
            wonky_num::p2(b[i], b[j]),
            wonky_num::p2(p[i], p[j]),
            "brep trimmed line incidence",
        )
        .map_err(|e| Error::Numeric(e.into_refusal()))?;
        if side != Sign::Zero {
            return Ok(false);
        }
    }
    Ok(true)
}

/// n . ((b-a) x (c-a)), including exact coordinate differences.
pub(crate) fn turn(a: P3, b: P3, c: P3, n: P3) -> Result<Sign> {
    let mut g = ex::Guard::new();
    let a = xyz(a);
    let b = xyz(b);
    let c = xyz(c);
    let u: Vec<_> = (0..3).map(|i| ex::difference(b[i], a[i], &mut g)).collect();
    let v: Vec<_> = (0..3).map(|i| ex::difference(c[i], a[i], &mut g)).collect();
    let mut total = Vec::new();
    for (i, ni) in xyz(n).into_iter().enumerate() {
        let j = (i + 1) % 3;
        let k = (i + 2) % 3;
        let plus = ex::mul(&u[j], &v[k], &mut g);
        let minus = ex::mul(&u[k], &v[j], &mut g);
        let cross = ex::sum(&plus, &ex::neg(&minus), &mut g);
        let term = ex::scale(&cross, ni, &mut g);
        total = ex::sum(&total, &term, &mut g);
    }
    finish(&total, &g)
}
