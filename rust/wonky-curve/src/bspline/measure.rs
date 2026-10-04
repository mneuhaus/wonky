//! Measures of a spline range `[t0, t1]`: Green moments, arc length, extreme
//! values, closest point, flatten bound and point membership. Everything works
//! span by span in the local parameter `s` of the exact homogeneous Bezier form
//! `C = (X, Y) / W`, whose hodograph is `C' = N1 / W^2` with
//! `N1 = (X' W - X W', Y' W - Y W')`.
use super::quad::{integrate_poly, integrate_rational, integrate_sqrt, sqrt_bounds, QBound};
use super::roots::{rational_of, roots_open, value_at, Root};
use super::{alg, peval, poly, BSpline, Span};
use crate::numeric::{q, P, Q};
use crate::refusal::{Refusal, R};
use num_traits::{Signed, Zero};
use wonky_alg::{BigInt, Polynomial, RationalInterval, SturmSequence};

/// The hodograph numerators `N1 = (X' W - X W', Y' W - Y W')` of a span.
pub(crate) fn hodograph_numerators(s: &Span) -> [Polynomial; 2] {
    let w = &s.pw[2];
    let dw = w.derivative();
    std::array::from_fn(|c| s.pw[c].derivative().mul(w).sub(&s.pw[c].mul(&dw)))
}

/// `X Y' - Y X'`.
fn wedge(s: &Span) -> Polynomial {
    s.pw[0].mul(&s.pw[1].derivative()).sub(&s.pw[1].mul(&s.pw[0].derivative()))
}

fn constant(c: &Q) -> Polynomial {
    poly(vec![c.clone()])
}

/// Green integrals over a range: area and first moments about the origin.
#[derive(Clone, Debug)]
pub struct Green {
    /// `1/2 integral (x dy - y dx)`.
    pub area: QBound,
    /// `1/3 integral x (x dy - y dx)` (the x first moment of the enclosed area).
    pub mx: QBound,
    /// `1/3 integral y (x dy - y dx)`.
    pub my: QBound,
}

/// The closest point of a range to a query point.
#[derive(Clone, Debug)]
pub struct Closest {
    /// The exact global parameter when the winner is a rational parameter.
    pub t: Option<Q>,
    pub point: Option<P>,
    /// Certified enclosure of the minimal squared distance.
    pub dist2: QBound,
}

/// Area of a constant-weight span over local `[s0, s1]` in the pairwise
/// Bernstein form `sum_{i<j} cross(P_i, P_j) c_ij / (2 w^2)` with
/// `c_ij = integral (B_i B_j' - B_j B_i') ds`.
fn area_pairwise(sp: &Span, s0: &Q, s1: &Q, w0: &Q) -> Q {
    let p = sp.bez[0].len() - 1;
    let whole = s0.is_zero() && s1 == &Q::from_integer(BigInt::from(1));
    let mut forms = None;
    let mut sum = Q::zero();
    for i in 0..=p {
        for j in i + 1..=p {
            if cfg!(feature = "plant_drop_p1p2_green") && (i, j) == (1, 2) {
                continue;
            }
            let c = if whole {
                pair_integrals(p)[i][j].clone()
            } else {
                integrate_poly(&forms.get_or_insert_with(|| pair_forms(p))[i][j], s0, s1)
            };
            let cross = &sp.bez[0][i] * &sp.bez[1][j] - &sp.bez[0][j] * &sp.bez[1][i];
            sum += cross * c;
        }
    }
    sum / (q(2.) * w0 * w0)
}

/// The forms `B_i B_j' - B_j B_i'` of the degree-`p` Bernstein basis.
fn pair_forms(p: usize) -> Vec<Vec<Polynomial>> {
    let basis: Vec<Polynomial> = (0..=p)
        .map(|i| {
            let mut e = vec![Q::zero(); p + 1];
            e[i] = Q::from_integer(BigInt::from(1));
            Polynomial::from_bernstein(&e).expect("nonempty exact Bernstein form")
        })
        .collect();
    (0..=p)
        .map(|i| (0..=p).map(|j| basis[i].mul(&basis[j].derivative()).sub(&basis[j].mul(&basis[i].derivative()))).collect())
        .collect()
}

/// `c_ij` over the whole span `[0, 1]`, computed once per degree by the same
/// forms (a whole span is the common case: the face cycles of an arrangement).
fn pair_integrals(p: usize) -> &'static [Vec<Q>] {
    static TABLE: std::sync::OnceLock<Vec<Vec<Vec<Q>>>> = std::sync::OnceLock::new();
    let (zero, one) = (Q::zero(), Q::from_integer(BigInt::from(1)));
    &TABLE.get_or_init(|| {
        (0..=super::MAX_DEGREE)
            .map(|p| pair_forms(p).iter().map(|row| row.iter().map(|f| integrate_poly(f, &zero, &one)).collect()).collect())
            .collect()
    })[p]
}

/// Rational square root when it exists.
fn rat_sqrt(r: &Q) -> Option<Q> {
    if r.is_negative() {
        return None;
    }
    let (n, d) = (r.numer().sqrt(), r.denom().sqrt());
    (&n * &n == *r.numer() && &d * &d == *r.denom()).then(|| Q::new(n, d))
}

/// `sigma` with `sigma^2 == a` (rational coefficients) when `a` is a perfect
/// square; this is the Pythagorean-hodograph case where arc length is exact.
fn poly_sqrt(a: &Polynomial) -> Option<Polynomial> {
    let d = a.degree()?;
    if d % 2 == 1 {
        return None;
    }
    let (m, c) = (d / 2, a.coefficients());
    let lead = rat_sqrt(&c[d])?;
    let mut s = vec![Q::zero(); m + 1];
    s[m] = lead.clone();
    for k in 1..=m {
        let mut acc = c[d - k].clone();
        for i in 1..k {
            acc -= &s[m - i] * &s[m - (k - i)];
        }
        s[m - k] = acc / (q(2.) * &lead);
    }
    let sig = poly(s);
    (sig.mul(&sig).coefficients() == c).then_some(sig)
}

fn span_length(sp: &Span, s0: &Q, s1: &Q) -> R<QBound> {
    let [nx, ny] = hodograph_numerators(sp);
    let a = nx.mul(&nx).add(&ny.mul(&ny));
    let w = &sp.pw[2];
    if let Some(sig) = poly_sqrt(&a) {
        if roots_open(&sig, s0, s1)?.is_empty() {
            let v = if sp.w_constant() {
                let w0 = &w.coefficients()[0];
                QBound::exact(integrate_poly(&sig, s0, s1) / (w0 * w0))
            } else {
                integrate_rational(&sig, w, 2, s0, s1)?
            };
            let mid = (s0 + s1) / q(2.);
            return Ok(if peval(&sig, &mid).is_negative() { v.neg() } else { v });
        }
    }
    let sturm = SturmSequence::new(&a).map_err(|_| Refusal::SplineCusp)?;
    let range = RationalInterval::new(s0.clone(), s1.clone()).map_err(alg)?;
    if sturm.count_closed(&range) > 0 {
        return Err(Refusal::SplineCusp);
    }
    integrate_sqrt(&a, w, 2, s0, s1)
}

/// `(X - px W, Y - py W)` of a span.
fn shifted(sp: &Span, p: &P) -> [Polynomial; 2] {
    std::array::from_fn(|c| sp.pw[c].sub(&sp.pw[2].mul(&constant(&p[c]))))
}

/// Bound of `|C''|` over a span, per unit local `s^2`: the Bernstein
/// magnitudes of `N2 = N1' W - 2 N1 W'` over the smallest Bernstein weight cubed.
fn curvature_bound(sp: &Span) -> R<Q> {
    let n1 = hodograph_numerators(sp);
    let w = &sp.pw[2];
    let dw = w.derivative();
    let two = constant(&q(2.));
    let n2: Vec<Polynomial> =
        n1.iter().map(|n| n.derivative().mul(w).sub(&n.mul(&dw).mul(&two))).collect();
    let deg = n2.iter().filter_map(Polynomial::degree).max().unwrap_or(0);
    let mut g = Q::zero();
    for n in &n2 {
        let m = n.to_bernstein(deg).map_err(alg)?.iter().map(|c| c.abs()).max().unwrap_or_else(Q::zero);
        g += &m * &m;
    }
    let wmin = sp.bez[2].iter().min().cloned().ok_or(Refusal::SplineFlattenUncertified)?;
    if !wmin.is_positive() {
        return Err(Refusal::SplineFlattenUncertified);
    }
    if g.is_zero() {
        return Ok(Q::zero());
    }
    Ok(sqrt_bounds(&g).1 / (&wmin * &wmin * &wmin))
}

impl BSpline {
    /// The spans overlapping `[t0, t1]` as `(span index, local s0, local s1)`.
    pub(crate) fn pieces(&self, t0: &Q, t1: &Q) -> R<Vec<(usize, Q, Q)>> {
        let (lo, hi) = self.domain();
        if t0 > t1 || t0 < lo || t1 > hi {
            return Err(Refusal::SplinePointOffCurve);
        }
        Ok(self
            .spans
            .iter()
            .enumerate()
            .filter_map(|(i, s)| {
                let (a, b) = (std::cmp::max(t0, &s.a), std::cmp::min(t1, &s.b));
                (a < b).then(|| (i, s.local(a), s.local(b)))
            })
            .collect())
    }

    /// Green area and first moments over `[t0, t1]`. Exact when every span in
    /// the range has a constant weight polynomial (including all polynomial
    /// splines); otherwise a certified enclosure.
    pub fn green(&self, t0: &Q, t1: &Q) -> R<Green> {
        let mut g = Green { area: QBound::zero(), mx: QBound::zero(), my: QBound::zero() };
        for (i, s0, s1) in self.pieces(t0, t1)? {
            let sp = &self.spans[i];
            let n = wedge(sp);
            let (area, m) = if sp.w_constant() {
                let w0 = sp.pw[2].coefficients()[0].clone();
                let w3 = &w0 * &w0 * &w0;
                let m = [0, 1].map(|c| {
                    QBound::exact(integrate_poly(&sp.pw[c].mul(&n), &s0, &s1) / (q(3.) * &w3))
                });
                (QBound::exact(area_pairwise(sp, &s0, &s1, &w0)), m)
            } else {
                let w = &sp.pw[2];
                let area = integrate_rational(&n, w, 2, &s0, &s1)?.scale(&(Q::from_integer(1.into()) / q(2.)));
                let third = Q::from_integer(1.into()) / q(3.);
                let mx = integrate_rational(&sp.pw[0].mul(&n), w, 3, &s0, &s1)?.scale(&third);
                let my = integrate_rational(&sp.pw[1].mul(&n), w, 3, &s0, &s1)?.scale(&third);
                (area, [mx, my])
            };
            g.area = g.area.add(&area);
            g.mx = g.mx.add(&m[0]);
            g.my = g.my.add(&m[1]);
        }
        Ok(g)
    }

    /// The Green area alone over `[t0, t1]` (as `green(t0, t1).area`, without
    /// the moments).
    pub fn area(&self, t0: &Q, t1: &Q) -> R<QBound> {
        let mut area = QBound::zero();
        for (i, s0, s1) in self.pieces(t0, t1)? {
            let sp = &self.spans[i];
            area = area.add(&if sp.w_constant() {
                QBound::exact(area_pairwise(sp, &s0, &s1, &sp.pw[2].coefficients()[0]))
            } else {
                integrate_rational(&wedge(sp), &sp.pw[2], 2, &s0, &s1)?.scale(&(Q::from_integer(1.into()) / q(2.)))
            });
        }
        Ok(area)
    }

    /// The Green area through the polynomial wedge (constant-weight spans only);
    /// the independent route the pairwise Bernstein form is tested against.
    #[cfg(test)]
    pub(crate) fn area_wedge(&self, t0: &Q, t1: &Q) -> R<Q> {
        let mut a = Q::zero();
        for (i, s0, s1) in self.pieces(t0, t1)? {
            let sp = &self.spans[i];
            if !sp.w_constant() {
                return Err(Refusal::SplineBudget);
            }
            let w0 = &sp.pw[2].coefficients()[0];
            a += integrate_poly(&wedge(sp), &s0, &s1) / (q(2.) * w0 * w0);
        }
        Ok(a)
    }

    /// Arc length over `[t0, t1]`. Exact for a Pythagorean hodograph (the
    /// squared speed numerator is a perfect square), otherwise a certified
    /// enclosure. Refuses `SplineCusp` when the speed vanishes in the range.
    /// The whole domain is computed once per spline value.
    pub fn length(&self, t0: &Q, t1: &Q) -> R<QBound> {
        if (t0, t1) == self.domain() {
            return self.domain_length.get_or_init(|| self.length_of(t0, t1)).clone();
        }
        self.length_of(t0, t1)
    }
    fn length_of(&self, t0: &Q, t1: &Q) -> R<QBound> {
        let mut total = QBound::zero();
        for (i, s0, s1) in self.pieces(t0, t1)? {
            total = total.add(&span_length(&self.spans[i], &s0, &s1)?);
        }
        Ok(total)
    }

    /// Values of the linear form `a x + b y` at its interior critical points
    /// and at knots strictly inside `(t0, t1)` (the range ends are the caller's).
    pub fn form_values(&self, t0: &Q, t1: &Q, a: &Q, b: &Q) -> R<Vec<QBound>> {
        let mut out = vec![];
        for (i, s0, s1) in self.pieces(t0, t1)? {
            let sp = &self.spans[i];
            let f = sp.pw[0].mul(&constant(a)).add(&sp.pw[1].mul(&constant(b)));
            if sp.global(&s0) > *t0 {
                let pt = sp.point_at(&s0);
                out.push(QBound::exact(a * &pt[0] + b * &pt[1]));
            }
            let n1 = hodograph_numerators(sp);
            let g = n1[0].mul(&constant(a)).add(&n1[1].mul(&constant(b)));
            // A derivative of one strict sign on the closed piece has no
            // interior critical point (Bernstein certificate, before Sturm).
            if !g.is_zero() && crate::contact::one_signed(&g, &s0, &s1)? {
                continue;
            }
            for r in roots_open(&g, &s0, &s1)? {
                out.push(value_at(&r, &f, &sp.pw[2])?);
            }
        }
        Ok(out)
    }

    /// Closest point of `[t0, t1]` to `p`.
    pub fn closest(&self, t0: &Q, t1: &Q, p: &P) -> R<Closest> {
        let mut cands: Vec<(Option<Q>, QBound)> = vec![];
        for (i, s0, s1) in self.pieces(t0, t1)? {
            let sp = &self.spans[i];
            for s in [&s0, &s1] {
                let pt = sp.point_at(s);
                let d = [&pt[0] - &p[0], &pt[1] - &p[1]];
                cands.push((Some(sp.global(s)), QBound::exact(&d[0] * &d[0] + &d[1] * &d[1])));
            }
            let [sx, sy] = shifted(sp, p);
            let n1 = hodograph_numerators(sp);
            let dd = sx.mul(&n1[0]).add(&sy.mul(&n1[1]));
            let num = sx.mul(&sx).add(&sy.mul(&sy));
            let den = sp.pw[2].mul(&sp.pw[2]);
            for r in roots_open(&dd, &s0, &s1)? {
                let t = rational_of(&r).map(|s| sp.global(&s));
                let root: Root = r;
                cands.push((t, value_at(&root, &num, &den)?));
            }
        }
        let min_hi = cands.iter().map(|c| c.1.hi.clone()).min().ok_or(Refusal::SplinePointOffCurve)?;
        let min_lo = cands.iter().map(|c| c.1.lo.clone()).min().ok_or(Refusal::SplinePointOffCurve)?;
        let mut winners: Vec<&(Option<Q>, QBound)> = vec![];
        for c in cands.iter().filter(|c| c.1.lo <= min_hi) {
            if !winners.iter().any(|w| w.0.is_some() && w.0 == c.0) {
                winners.push(c);
            }
        }
        let (t, point) = match winners.as_slice() {
            [(Some(t), _)] => (Some(t.clone()), Some(self.eval(t)?)),
            _ => (None, None),
        };
        Ok(Closest { t, point, dist2: QBound { lo: min_lo, hi: min_hi } })
    }

    /// Certified upper bound of the Euclidean chord deviation when every span
    /// piece of `[t0, t1]` is cut into `n` equal parts in its own parameter
    /// (knots are always cut points, so no smoothness is assumed).
    pub fn flatten_bound(&self, t0: &Q, t1: &Q, n: usize) -> R<Q> {
        let mut worst = Q::zero();
        for (i, s0, s1) in self.pieces(t0, t1)? {
            let h = (&s1 - &s0) / Q::from_integer(BigInt::from(n.max(1) as i64));
            let e = &h * &h * curvature_bound(&self.spans[i])? / q(8.);
            worst = worst.max(e);
        }
        Ok(worst)
    }

    /// The smallest power of two `n` whose `flatten_bound` is at most `dev`.
    pub fn flatten_count(&self, t0: &Q, t1: &Q, dev: &Q) -> R<usize> {
        let mut n = 1usize;
        while self.flatten_bound(t0, t1, n)? > *dev {
            n *= 2;
            if n > 1 << 20 {
                return Err(Refusal::SplineBudget);
            }
        }
        Ok(n)
    }

    /// Exact rational parameters in `[t0, t1]` at which the curve passes through
    /// `p`, ascending and deduplicated. An irrational parameter is refused
    /// `SplineArrangement` (the arrangement layer is S6).
    pub fn params_of(&self, t0: &Q, t1: &Q, p: &P) -> R<Vec<Q>> {
        let mut out: Vec<Q> = vec![];
        for (i, s0, s1) in self.pieces(t0, t1)? {
            let sp = &self.spans[i];
            let [gx, gy] = shifted(sp, p);
            let g = gx.gcd(&gy);
            if g.is_zero() {
                return Err(Refusal::SplineArrangement);
            }
            if g.degree() == Some(0) {
                continue;
            }
            let mut found: Vec<Q> = [&s0, &s1]
                .into_iter()
                .filter(|s| peval(&g, s).is_zero())
                .cloned()
                .collect();
            for r in roots_open(&g, &s0, &s1)? {
                found.push(rational_of(&r).ok_or(Refusal::SplineArrangement)?);
            }
            out.extend(found.iter().map(|s| sp.global(s)));
        }
        out.sort();
        out.dedup();
        Ok(out)
    }

    /// True when the curve passes through `p` somewhere in `[t0, t1]`.
    pub fn has_point(&self, t0: &Q, t1: &Q, p: &P) -> R<bool> {
        for (i, s0, s1) in self.pieces(t0, t1)? {
            let [gx, gy] = shifted(&self.spans[i], p);
            let g = gx.gcd(&gy);
            if g.is_zero() {
                return Ok(true);
            }
            if g.degree() == Some(0) {
                continue;
            }
            let sturm = SturmSequence::new(&g).map_err(alg)?;
            let range = RationalInterval::new(s0, s1).map_err(alg)?;
            if sturm.count_closed(&range) > 0 {
                return Ok(true);
            }
        }
        Ok(false)
    }
}
