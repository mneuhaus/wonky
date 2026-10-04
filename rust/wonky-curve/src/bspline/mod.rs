//! Exact B-spline math (polynomial and rational, degree 1..=7) for the
//! `Carrier::BSpline` carrier. Nothing here rounds a decision: knots, poles and
//! weights are rationals; spans are exact homogeneous Bezier pieces obtained by
//! Boehm knot insertion; every integral is either an exact power-basis
//! antiderivative or a certified rational enclosure (`quad`).
//!
//! Layout: `mod` (types, validation, Boehm spans, evaluation, affine image),
//! `quad` (certified Taylor quadrature), `measure` (Green moments, arc length,
//! extremes, closest point, flatten bound), `regular` (cusp and
//! self-intersection certificates), `elevate` (degree elevation), `fit`
//! (exact open cubic interpolation with OM1 end conditions).
//!
//! FeatureScript sketch splines reach this code through the curve-profile
//! admission and its exact source replay.
use crate::numeric::{q, P, Q};
use crate::refusal::{Refusal, R};
use num_traits::{One, Signed, Zero};
use std::sync::OnceLock;
use wonky_alg::{AlgebraError, Polynomial};

mod elevate;
pub mod fit;
mod measure;
mod quad;
pub(crate) mod regular;
pub(crate) mod roots;

pub use measure::{Closest, Green};
pub use quad::QBound;

/// Highest supported degree.
pub const MAX_DEGREE: usize = 7;

pub(crate) fn alg(_: AlgebraError) -> Refusal {
    Refusal::SplineBudget
}

/// Horner evaluation of ascending coefficients.
pub(crate) fn horner(c: &[Q], x: &Q) -> Q {
    c.iter().rev().fold(Q::zero(), |acc, a| acc * x + a)
}
pub(crate) fn peval(p: &Polynomial, x: &Q) -> Q {
    horner(p.coefficients(), x)
}
pub(crate) fn poly(c: Vec<Q>) -> Polynomial {
    Polynomial::new(c).expect("rationals built by exact arithmetic have nonzero denominators")
}

/// One knot span as an exact homogeneous Bezier piece in the local parameter
/// `s = (t - a) / (b - a)`, `s` in [0, 1]. Components are (X, Y, W) = (w x, w y, w).
#[derive(Clone, Debug)]
pub struct Span {
    pub a: Q,
    pub b: Q,
    /// Bernstein coefficients of X, Y, W (degree `p`).
    pub bez: [Vec<Q>; 3],
    /// Power-basis polynomials of X, Y, W.
    pub pw: [Polynomial; 3],
}

impl Span {
    pub fn width(&self) -> Q {
        &self.b - &self.a
    }
    /// The point at local parameter `s` (exact).
    pub fn point_at(&self, s: &Q) -> P {
        let w = peval(&self.pw[2], s);
        [peval(&self.pw[0], s) / &w, peval(&self.pw[1], s) / w]
    }
    /// Local parameter of the global parameter `t`.
    pub fn local(&self, t: &Q) -> Q {
        (t - &self.a) / self.width()
    }
    /// Global parameter of the local parameter `s`.
    pub fn global(&self, s: &Q) -> Q {
        &self.a + s * self.width()
    }
    /// True when the span's weight polynomial is a constant.
    pub fn w_constant(&self) -> bool {
        self.pw[2].degree().unwrap_or(0) == 0
    }
}

/// A clamped B-spline curve in the plane, polynomial or rational.
#[derive(Clone, Debug)]
pub struct BSpline {
    degree: usize,
    knots: Vec<Q>,
    poles: Vec<P>,
    weights: Option<Vec<Q>>,
    spans: Vec<Span>,
    /// Memoized regularity verdict (cusp and self-intersection).
    regular: OnceLock<R<()>>,
    /// Memoized certified length of the whole domain. The measures of a spline
    /// prism ask for it per face and per measure call; for a non-PH curve
    /// (a gear flank) one quadrature takes about a second.
    domain_length: OnceLock<R<QBound>>,
}

impl PartialEq for BSpline {
    fn eq(&self, o: &Self) -> bool {
        self.degree == o.degree
            && self.knots == o.knots
            && self.poles == o.poles
            && self.weights == o.weights
    }
}
impl Eq for BSpline {}

impl BSpline {
    /// Validate and build. Refuses `SplineInvalid` for degree outside 1..=7, a
    /// knot vector that is not clamped and non-decreasing (or has an interior
    /// knot of multiplicity above the degree), a wrong pole or weight count, or
    /// a weight that is not positive.
    pub fn new(
        degree: usize,
        knots: Vec<Q>,
        poles: Vec<P>,
        weights: Option<Vec<Q>>,
    ) -> R<Self> {
        let bad = Refusal::SplineInvalid;
        if !(1..=MAX_DEGREE).contains(&degree) {
            return Err(bad);
        }
        let n = poles.len();
        if n < degree + 1 || knots.len() != n + degree + 1 {
            return Err(bad);
        }
        if knots.windows(2).any(|w| w[0] > w[1]) {
            return Err(bad);
        }
        let (first, last) = (&knots[0], &knots[knots.len() - 1]);
        if first >= last
            || knots[..=degree].iter().any(|k| k != first)
            || knots[knots.len() - degree - 1..].iter().any(|k| k != last)
        {
            return Err(bad);
        }
        // Interior multiplicity <= degree (the clamped end knots have degree + 1).
        let interior = &knots[degree + 1..knots.len() - degree - 1];
        let mut run = 0;
        for i in 0..interior.len() {
            run = if i > 0 && interior[i] == interior[i - 1] { run + 1 } else { 1 };
            if run > degree || &interior[i] == first || &interior[i] == last {
                return Err(bad);
            }
        }
        if let Some(w) = &weights {
            if w.len() != n || w.iter().any(|x| !x.is_positive()) {
                return Err(bad);
            }
        }
        let mut s = Self { degree, knots, poles, weights, spans: vec![], regular: OnceLock::new(), domain_length: OnceLock::new() };
        s.spans = s.extract_spans();
        Ok(s)
    }
    /// A single Bezier curve of the given poles (degree = poles - 1).
    pub fn bezier(poles: Vec<P>, weights: Option<Vec<Q>>) -> R<Self> {
        let p = poles.len().saturating_sub(1);
        let mut knots = vec![Q::zero(); p + 1];
        knots.extend(vec![Q::one(); p + 1]);
        Self::new(p, knots, poles, weights)
    }
    /// A polynomial Bezier from binary64 sources (exact rationals of the floats).
    pub fn bezier_f64(poles: &[[f64; 2]]) -> R<Self> {
        Self::bezier(poles.iter().map(|p| [q(p[0]), q(p[1])]).collect(), None)
    }

    pub fn degree(&self) -> usize {
        self.degree
    }
    pub fn knots(&self) -> &[Q] {
        &self.knots
    }
    pub fn poles(&self) -> &[P] {
        &self.poles
    }
    pub fn weights(&self) -> Option<&[Q]> {
        self.weights.as_deref()
    }
    pub fn is_rational(&self) -> bool {
        self.weights.is_some()
    }
    pub fn spans(&self) -> &[Span] {
        &self.spans
    }
    pub fn domain(&self) -> (&Q, &Q) {
        (&self.knots[0], &self.knots[self.knots.len() - 1])
    }
    pub fn weight(&self, i: usize) -> Q {
        self.weights.as_ref().map_or_else(Q::one, |w| w[i].clone())
    }
    /// Homogeneous poles (w x, w y, w).
    pub(crate) fn hom(&self) -> Vec<[Q; 3]> {
        (0..self.poles.len())
            .map(|i| {
                let w = self.weight(i);
                [&self.poles[i][0] * &w, &self.poles[i][1] * &w, w]
            })
            .collect()
    }
    /// Distinct knots with multiplicities, ascending.
    pub fn distinct_knots(&self) -> Vec<(Q, usize)> {
        let mut out: Vec<(Q, usize)> = vec![];
        for k in &self.knots {
            match out.last_mut() {
                Some((v, m)) if v == k => *m += 1,
                _ => out.push((k.clone(), 1)),
            }
        }
        out
    }

    /// Bezier extraction by Boehm knot insertion of every interior knot up to
    /// multiplicity `degree` (homogeneous coordinates).
    fn extract_spans(&self) -> Vec<Span> {
        let p = self.degree;
        let mut u = self.knots.clone();
        let mut h = self.hom();
        for (knot, mult) in self.distinct_knots() {
            if knot == u[0] || knot == u[u.len() - 1] {
                continue;
            }
            for _ in mult..p {
                boehm_insert(p, &mut u, &mut h, &knot);
            }
        }
        let distinct = self.distinct_knots();
        (0..distinct.len() - 1)
            .map(|j| {
                let seg = &h[j * p..=j * p + p];
                let bez: [Vec<Q>; 3] = std::array::from_fn(|c| seg.iter().map(|v| v[c].clone()).collect());
                let pw = std::array::from_fn(|c| {
                    Polynomial::from_bernstein(&bez[c]).expect("nonempty exact Bernstein form")
                });
                Span { a: distinct[j].0.clone(), b: distinct[j + 1].0.clone(), bez, pw }
            })
            .collect()
    }

    /// Index of the span owning `t` (the last span for the upper end).
    pub fn span_of(&self, t: &Q) -> usize {
        let i = self.spans.partition_point(|s| &s.b <= t);
        i.min(self.spans.len() - 1)
    }
    /// Certified regularity: refuses `SplineCusp` or `SplineSelfIntersecting`
    /// (both named `curve2/self-intersecting-spline`), or
    /// `SplineRegularityUndecided`. Computed once per spline value.
    pub fn regular(&self) -> R<()> {
        *self.regular.get_or_init(|| self.check_regular())
    }
    /// Carry a computed regularity verdict over to the image under an invertible
    /// map (cusps and crossings, and their absence, are invariant under it). A
    /// singular map can fold a regular curve back onto a segment, so its image
    /// computes its own verdict.
    fn inherit(self, from: &Self, invertible: bool) -> Self {
        if let (true, Some(v)) = (invertible, from.regular.get()) {
            let _ = self.regular.set(*v);
        }
        self
    }
    /// The exact point at parameter `t` of the domain.
    pub fn eval(&self, t: &Q) -> R<P> {
        let (lo, hi) = self.domain();
        if t < lo || t > hi {
            return Err(Refusal::SplinePointOffCurve);
        }
        let s = &self.spans[self.span_of(t)];
        Ok(s.point_at(&s.local(t)))
    }
    /// The unnormalized tangent (hodograph direction) at `t`, one-sided: from
    /// the right of `t` when `forward`, from the left otherwise (the direction
    /// still points in the direction of increasing `t`).
    pub fn tangent_at(&self, t: &Q, forward: bool) -> R<P> {
        let (lo, hi) = self.domain();
        if t < lo || t > hi {
            return Err(Refusal::SplinePointOffCurve);
        }
        let i = if forward {
            self.span_of(t)
        } else {
            self.spans.partition_point(|s| &s.b < t).min(self.spans.len() - 1)
        };
        let s = &self.spans[i];
        let d = measure::hodograph_numerators(s);
        let l = s.local(t);
        let w = peval(&s.pw[2], &l);
        let w2 = &w * &w;
        Ok([peval(&d[0], &l) / &w2, peval(&d[1], &l) / w2])
    }

    /// The first and second derivatives `(C', C'')` at `t` with respect to the
    /// local parameter of the span on the right of `t` (`right`) or on its
    /// left, exact: `C' = (N'W - N W') / W^2` and
    /// `C'' = (N''W^2 - 2 N'W'W - N W''W + 2 N W'^2) / W^3` with `N = (X, Y)`.
    pub fn derivatives_at(&self, t: &Q, right: bool) -> R<(P, P)> {
        let (lo, hi) = self.domain();
        if t < lo || t > hi {
            return Err(Refusal::SplinePointOffCurve);
        }
        let i = if right {
            self.span_of(t)
        } else {
            self.spans.partition_point(|s| &s.b < t).min(self.spans.len() - 1)
        };
        let s = &self.spans[i];
        let l = s.local(t);
        let jet = |p: &Polynomial| {
            let d = p.derivative();
            [peval(p, &l), peval(&d, &l), peval(&d.derivative(), &l)]
        };
        let w = jet(&s.pw[2]);
        let (first, second): (Vec<Q>, Vec<Q>) = (0..2)
            .map(|c| {
                let n = jet(&s.pw[c]);
                let d1 = (&n[1] * &w[0] - &n[0] * &w[1]) / (&w[0] * &w[0]);
                let d2 = (&n[2] * &w[0] * &w[0] - q(2.) * &n[1] * &w[1] * &w[0] - &n[0] * &w[2] * &w[0]
                    + q(2.) * &n[0] * &w[1] * &w[1])
                    / (&w[0] * &w[0] * &w[0]);
                (d1, d2)
            })
            .unzip();
        Ok(([first[0].clone(), first[1].clone()], [second[0].clone(), second[1].clone()]))
    }

    /// The affine image `p -> o + x ax + y ay`; weights are unchanged (an
    /// affine map commutes with the rational combination).
    pub fn affine(&self, map: &crate::carrier::PlaneMap) -> R<Self> {
        let (o, ax, ay) = map.frame();
        self.affine_by(o, ax, ay)
    }
    /// The image under any affine map `p -> o + x ax + y ay` (`ax`, `ay` need not
    /// be orthonormal; the image of a singular map is judged by its own
    /// regularity check, not here).
    pub fn affine_by(&self, o: &P, ax: &P, ay: &P) -> R<Self> {
        let poles = self
            .poles
            .iter()
            .map(|p| [&o[0] + &ax[0] * &p[0] + &ay[0] * &p[1], &o[1] + &ax[1] * &p[0] + &ay[1] * &p[1]])
            .collect();
        let invertible = !(&ax[0] * &ay[1] - &ay[0] * &ax[1]).is_zero();
        Ok(Self::new(self.degree, self.knots.clone(), poles, self.weights.clone())?.inherit(self, invertible))
    }
    /// The curve traversed backwards over the mirrored parameter range.
    pub fn reversed(&self) -> R<Self> {
        let (lo, hi) = self.domain();
        let sum = lo + hi;
        let knots = self.knots.iter().rev().map(|k| &sum - k).collect();
        let poles = self.poles.iter().rev().cloned().collect();
        let weights = self.weights.as_ref().map(|w| w.iter().rev().cloned().collect());
        Ok(Self::new(self.degree, knots, poles, weights)?.inherit(self, true))
    }
}

/// Boehm knot insertion of `t` into the homogeneous curve (in place).
fn boehm_insert(p: usize, u: &mut Vec<Q>, h: &mut Vec<[Q; 3]>, t: &Q) {
    // k: u[k] <= t < u[k+1]
    let k = u.partition_point(|x| x <= t) - 1;
    let s = u.iter().filter(|x| *x == t).count();
    let mut out: Vec<[Q; 3]> = Vec::with_capacity(h.len() + 1);
    for i in 0..=h.len() {
        if i + p <= k {
            out.push(h[i].clone());
        } else if i + s <= k {
            let alpha = (t - &u[i]) / (&u[i + p] - &u[i]);
            let beta = Q::one() - &alpha;
            out.push(std::array::from_fn(|c| &alpha * &h[i][c] + &beta * &h[i - 1][c]));
        } else {
            out.push(h[i - 1].clone());
        }
    }
    u.insert(k + 1, t.clone());
    *h = out;
}

/// Basis functions N_{i,p}(t) by Cox-de Boor (exact, rational).
pub(crate) fn basis(knots: &[Q], p: usize, t: &Q, right_closed: bool) -> Vec<Q> {
    let n = knots.len() - p - 1;
    let last = &knots[knots.len() - 1];
    // degree 0
    let mut b: Vec<Q> = (0..knots.len() - 1)
        .map(|i| {
            let inside = &knots[i] <= t && t < &knots[i + 1];
            let end = right_closed
                && t == last
                && knots[i] < knots[i + 1]
                && &knots[i + 1] == last;
            if inside || end { Q::one() } else { Q::zero() }
        })
        .collect();
    for d in 1..=p {
        let mut nb = vec![Q::zero(); knots.len() - 1 - d];
        for i in 0..nb.len() {
            let mut v = Q::zero();
            let d1 = &knots[i + d] - &knots[i];
            if !d1.is_zero() {
                v += (t - &knots[i]) / d1 * &b[i];
            }
            let d2 = &knots[i + d + 1] - &knots[i + 1];
            if !d2.is_zero() {
                v += (&knots[i + d + 1] - t) / d2 * &b[i + 1];
            }
            nb[i] = v;
        }
        b = nb;
    }
    b.truncate(n);
    b
}

#[cfg(test)]
mod piece_tests;
#[cfg(test)]
mod tests;
