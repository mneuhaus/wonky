//! Regularity of a spline: no cusp (the hodograph never vanishes and never
//! reverses at a knot) and no self-intersection.
//!
//! Self-intersection is decided by exact geometric certificates on Bezier
//! pieces. Each span is bisected into "cone pieces" whose hodograph control
//! vectors (Bernstein coefficients of the numerator `N1`, `C' = N1 / W^2`) lie
//! in an open half-plane, so the piece is a graph along some direction `u` and
//! cannot meet itself. Two pieces are then related by
//!   - adjacent: a common half-plane for both hodographs proves they meet only
//!     at the shared end,
//!   - non-adjacent: disjoint boxes of their rational control points prove
//!     disjointness; an exactly equal end point, or a Poincare-Miranda sign
//!     certificate on the parameter rectangle, proves a crossing; otherwise the
//!     larger piece is split and the pair retried until a depth or node cap
//!     ends the search as `SplineRegularityUndecided`.
use super::measure::hodograph_numerators;
use super::{alg, poly, BSpline, Span};
use crate::numeric::{cross, dot, sub, P, Q};
use crate::refusal::{Refusal, R};
use num_traits::{One, Signed, Zero};
use wonky_alg::{Polynomial, RationalInterval, SturmSequence};

const MAX_DEPTH: usize = 80;
const MAX_NODES: usize = 200_000;
/// Budgets of the contact search between two different splines (S6).
const PAIR_DEPTH: usize = 48;
const PAIR_NODES: usize = 20_000;

/// The split fraction 12345 / 32768: ugly on purpose, so that a crossing at a
/// simple rational parameter never lands exactly on a cut.
fn phi() -> Q {
    Q::new(12345.into(), 32768.into())
}

#[derive(Clone)]
struct Piece {
    a: Q,
    b: Q,
    /// Bernstein coefficients of X, Y, W (degree p).
    h: [Vec<Q>; 3],
    /// Bernstein coefficients of the hodograph numerators (degree 2p).
    n: [Vec<Q>; 2],
}

fn split(c: &[Q], f: &Q) -> (Vec<Q>, Vec<Q>) {
    let g = Q::one() - f;
    let mut cur = c.to_vec();
    let (mut left, mut right) = (vec![cur[0].clone()], vec![cur[cur.len() - 1].clone()]);
    for _ in 1..c.len() {
        cur = cur.windows(2).map(|w| &w[0] * &g + &w[1] * f).collect();
        left.push(cur[0].clone());
        right.push(cur[cur.len() - 1].clone());
    }
    right.reverse();
    (left, right)
}

impl Piece {
    fn of_span(sp: &Span) -> R<Self> {
        let m = 2 * (sp.bez[0].len() - 1);
        let n = hodograph_numerators(sp);
        Ok(Self {
            a: sp.a.clone(),
            b: sp.b.clone(),
            h: sp.bez.clone(),
            n: [n[0].to_bernstein(m).map_err(alg)?, n[1].to_bernstein(m).map_err(alg)?],
        })
    }
    /// The span restricted to local `[s0, s1]` (re-parameterized over [0, 1]).
    fn restricted(sp: &Span, s0: &Q, s1: &Q) -> R<Self> {
        if s0.is_zero() && s1.is_one() {
            return Self::of_span(sp);
        }
        let p = sp.bez[0].len() - 1;
        let map = poly(vec![s0.clone(), s1 - s0]);
        let pw: [Polynomial; 3] = std::array::from_fn(|c| sp.pw[c].compose(&map));
        let (w, dw) = (&pw[2], pw[2].derivative());
        let n: [Polynomial; 2] = std::array::from_fn(|c| pw[c].derivative().mul(w).sub(&pw[c].mul(&dw)));
        let h = [0, 1, 2].map(|c| pw[c].to_bernstein(p));
        let [h0, h1, h2] = h;
        Ok(Self {
            a: sp.global(s0),
            b: sp.global(s1),
            h: [h0.map_err(alg)?, h1.map_err(alg)?, h2.map_err(alg)?],
            n: [n[0].to_bernstein(2 * p).map_err(alg)?, n[1].to_bernstein(2 * p).map_err(alg)?],
        })
    }
    fn points(&self) -> Vec<P> {
        (0..self.h[0].len()).map(|i| [&self.h[0][i] / &self.h[2][i], &self.h[1][i] / &self.h[2][i]]).collect()
    }
    fn split(&self) -> (Self, Self) {
        let f = phi();
        let mid = &self.a + &f * (&self.b - &self.a);
        let hs: Vec<_> = self.h.iter().map(|c| split(c, &f)).collect();
        let ns: Vec<_> = self.n.iter().map(|c| split(c, &f)).collect();
        let l = Self {
            a: self.a.clone(),
            b: mid.clone(),
            h: std::array::from_fn(|i| hs[i].0.clone()),
            n: std::array::from_fn(|i| ns[i].0.clone()),
        };
        let r = Self {
            a: mid,
            b: self.b.clone(),
            h: std::array::from_fn(|i| hs[i].1.clone()),
            n: std::array::from_fn(|i| ns[i].1.clone()),
        };
        (l, r)
    }
    fn end(&self, last: bool) -> P {
        let i = if last { self.h[0].len() - 1 } else { 0 };
        [&self.h[0][i] / &self.h[2][i], &self.h[1][i] / &self.h[2][i]]
    }
    fn hodograph(&self) -> Vec<P> {
        (0..self.n[0].len()).map(|i| [self.n[0][i].clone(), self.n[1][i].clone()]).collect()
    }
    /// Box of the rational control points (contains the piece).
    fn aabb(&self) -> [[Q; 2]; 2] {
        let pts: Vec<P> = (0..self.h[0].len())
            .map(|i| [&self.h[0][i] / &self.h[2][i], &self.h[1][i] / &self.h[2][i]])
            .collect();
        let ext = |c: usize| {
            let lo = pts.iter().map(|p| p[c].clone()).min().expect("nonempty");
            let hi = pts.iter().map(|p| p[c].clone()).max().expect("nonempty");
            [lo, hi]
        };
        [ext(0), ext(1)]
    }
}

/// A direction `u` with `u . v > 0` for every vector, when they lie in an open
/// half-plane. The candidate is checked against every vector before it is
/// returned: collinear vectors pass both extreme-ray searches even when some of
/// them are antiparallel.
fn half_plane(vs: &[P]) -> Option<P> {
    if vs.iter().any(|v| v.iter().all(Zero::is_zero)) {
        return None;
    }
    let a = vs.iter().find(|a| vs.iter().all(|x| !cross(a, x).is_negative()))?;
    let b = vs.iter().find(|b| vs.iter().all(|x| !cross(x, b).is_negative()))?;
    let c = cross(a, b);
    let u = if c.is_positive() {
        // rot90(a) . b > 0 and rot-90(b) . a > 0, both orthogonal to their own vector.
        [-&a[1] + &b[1], a[0].clone() - &b[0]]
    } else if c.is_zero() && dot(a, b).is_positive() {
        a.clone()
    } else {
        return None;
    };
    vs.iter().all(|x| dot(&u, x).is_positive()).then_some(u)
}

fn adjacent(p: &Piece, q: &Piece, lo: &Q, hi: &Q, closed: bool) -> bool {
    p.b == q.a
        || q.b == p.a
        || (closed && ((p.a == *lo && q.b == *hi) || (q.a == *lo && p.b == *hi)))
}

/// True when every coefficient is `<= 0` (`neg`) or `>= 0`.
fn one_sided(c: &[Q], neg: bool) -> bool {
    c.iter().all(|x| if neg { !x.is_positive() } else { !x.is_negative() })
}

/// Poincare-Miranda certificate that `P(s) = Q(t)` has a solution on the
/// parameter rectangle: the component along `perp(u_Q)` changes sign across the
/// `s` faces for every `t`, and the component along `perp(u_P)` changes sign
/// across the `t` faces for every `s`. The two components pin `P - Q` to zero
/// only when `perp(u_P)` and `perp(u_Q)` are independent. With parallel mean
/// tangents they are one functional whose zero set is a whole line (two disjoint
/// collinear pieces pass both sign tests), so no certificate is issued.
fn miranda(p: &Piece, q: &Piece) -> bool {
    // The sum of the hodograph control vectors lies in the cone and follows the
    // mean tangent, which keeps the perpendicular components nearly constant.
    let mean = |x: &Piece| {
        x.hodograph().into_iter().fold([Q::zero(), Q::zero()], |a, v| [a[0].clone() + &v[0], a[1].clone() + &v[1]])
    };
    let (up, uq) = (mean(p), mean(q));
    if cross(&up, &uq).is_zero() {
        return false;
    }
    let e1 = [-&uq[1], uq[0].clone()];
    let e2 = [-&up[1], up[0].clone()];
    let along_q = |a: &P| -> Vec<Q> {
        let k = dot(&e1, a);
        (0..q.h[0].len()).map(|j| &k * &q.h[2][j] - &e1[0] * &q.h[0][j] - &e1[1] * &q.h[1][j]).collect()
    };
    let along_p = |b: &P| -> Vec<Q> {
        let k = dot(&e2, b);
        (0..p.h[0].len()).map(|i| &e2[0] * &p.h[0][i] + &e2[1] * &p.h[1][i] - &k * &p.h[2][i]).collect()
    };
    let (f0, f1) = (along_q(&p.end(false)), along_q(&p.end(true)));
    let first = (one_sided(&f0, true) && one_sided(&f1, false)) || (one_sided(&f0, false) && one_sided(&f1, true));
    let (g0, g1) = (along_p(&q.end(false)), along_p(&q.end(true)));
    let second = (one_sided(&g0, true) && one_sided(&g1, false)) || (one_sided(&g0, false) && one_sided(&g1, true));
    first && second
}

/// A line through `v` has every other control point of `p` strictly on one
/// side and every other control point of `q` strictly on the other: the two
/// pieces, which both end at `v`, meet only at `v`. (A rational Bezier piece
/// minus its end `v` is a positive combination of its other control points
/// relative to `v`.) Candidate directions come from the control vectors, their
/// sums and differences and their perpendiculars; each is verified exactly.
fn separated_through(p: &[P], q: &[P], v: &P) -> bool {
    let rel = |s: &[P]| s.iter().filter(|x| *x != v).map(|x| sub(x, v)).collect::<Vec<_>>();
    let (a, b) = (rel(p), rel(q));
    if a.len() + 1 != p.len() || b.len() + 1 != q.len() {
        return false;
    }
    let perp = |x: &P| [-&x[1], x[0].clone()];
    let mut candidates: Vec<P> = vec![];
    for x in a.iter().chain(&b) {
        candidates.push(x.clone());
        candidates.push(perp(x));
    }
    for x in &a {
        for y in &b {
            for w in [[&x[0] + &y[0], &x[1] + &y[1]], [&x[0] - &y[0], &x[1] - &y[1]]] {
                candidates.push(perp(&w));
                candidates.push(w);
            }
        }
    }
    candidates.iter().filter(|w| !w.iter().all(Zero::is_zero)).any(|w| {
        let side = |s: &[P], positive: bool| s.iter().all(|x| cross(w, x).is_positive() == positive && !cross(w, x).is_zero());
        (side(&a, true) && side(&b, false)) || (side(&a, false) && side(&b, true))
    })
}

/// The pieces `[a0, a1]` of `a` and `[b0, b1]` of `b` (two DIFFERENT regular
/// splines) meet only at the points of `shared`, which are ends of both pieces.
/// Decided by exact certificates on sub-pieces: disjoint control boxes or
/// separated control hulls (`contact::hulls_separated`); a separating line
/// through a shared end for sub-pieces that both end there; otherwise the
/// larger sub-piece is split. A Poincare-Miranda certificate on two sub-pieces
/// without a shared end proves a crossing, which needs an algebraic vertex
/// (`CrossingNeedsAlgebraicVertex`); running out of depth or nodes refuses
/// `SplineContactUndecided` (a tangential contact at a shared end, a touch, a
/// crossing without a certificate).
pub(crate) fn pair_contacts(a: &BSpline, (a0, a1): (&Q, &Q), b: &BSpline, (b0, b1): (&Q, &Q), shared: &[P]) -> R<()> {
    let restrict = |s: &BSpline, t0: &Q, t1: &Q| -> R<Vec<Piece>> {
        s.pieces(t0, t1)?.iter().map(|(i, s0, s1)| Piece::restricted(&s.spans()[*i], s0, s1)).collect()
    };
    let (pa, pb) = (restrict(a, a0, a1)?, restrict(b, b0, b1)?);
    let mut stack = vec![];
    for p in &pa {
        for q in &pb {
            stack.push((p.clone(), q.clone(), 0usize));
        }
    }
    let size = |x: &Piece| {
        let bx = x.aabb();
        (&bx[0][1] - &bx[0][0]) + (&bx[1][1] - &bx[1][0])
    };
    let mut nodes = 0usize;
    while let Some((p, q, depth)) = stack.pop() {
        nodes += 1;
        if nodes > PAIR_NODES {
            return Err(Refusal::SplineContactUndecided);
        }
        let (bp, bq) = (p.aabb(), q.aabb());
        if (0..2).any(|c| bp[c][1] < bq[c][0] || bq[c][1] < bp[c][0]) {
            continue;
        }
        let (pp, qp) = (p.points(), q.points());
        let ends = |x: &Piece| [x.end(false), x.end(true)];
        let common = ends(&p).into_iter().find(|e| shared.contains(e) && ends(&q).contains(e));
        match common {
            Some(v) => {
                if separated_through(&pp, &qp, &v) {
                    continue;
                }
            }
            None => {
                if crate::contact::hulls_separated(&pp, &qp) {
                    continue;
                }
                if miranda(&p, &q) || miranda(&q, &p) {
                    return Err(Refusal::CrossingNeedsAlgebraicVertex);
                }
            }
        }
        if depth >= PAIR_DEPTH {
            return Err(Refusal::SplineContactUndecided);
        }
        if size(&p) >= size(&q) {
            let (l, r) = p.split();
            stack.push((l, q.clone(), depth + 1));
            stack.push((r, q, depth + 1));
        } else {
            let (l, r) = q.split();
            stack.push((p.clone(), l, depth + 1));
            stack.push((p, r, depth + 1));
        }
    }
    Ok(())
}

enum Verdict {
    Disjoint,
    Crossing,
    Split,
}

impl BSpline {
    /// Certified regularity of the whole curve, memoized (see `regular`).
    pub(crate) fn check_regular(&self) -> R<()> {
        self.check_cusps()?;
        self.check_simple()
    }

    fn check_cusps(&self) -> R<()> {
        for sp in self.spans() {
            let [nx, ny] = hodograph_numerators(sp);
            let g = nx.gcd(&ny);
            if g.is_zero() {
                return Err(Refusal::SplineCusp);
            }
            if g.degree().unwrap_or(0) > 0 {
                let sturm = SturmSequence::new(&g).map_err(|_| Refusal::SplineCusp)?;
                let unit = RationalInterval::new(Q::zero(), Q::one()).map_err(alg)?;
                if sturm.count_closed(&unit) > 0 {
                    return Err(Refusal::SplineCusp);
                }
            }
        }
        for (t, _) in self.distinct_knots() {
            let (lo, hi) = self.domain();
            if &t == lo || &t == hi {
                continue;
            }
            let (l, r) = (self.tangent_at(&t, false)?, self.tangent_at(&t, true)?);
            if cross(&l, &r).is_zero() && dot(&l, &r).is_negative() {
                return Err(Refusal::SplineCusp);
            }
        }
        Ok(())
    }

    fn cone_pieces(&self) -> R<Vec<Piece>> {
        let mut out = vec![];
        for sp in self.spans() {
            let mut work = vec![(Piece::of_span(sp)?, 0usize)];
            while let Some((p, depth)) = work.pop() {
                if half_plane(&p.hodograph()).is_some() {
                    out.push(p);
                } else if depth >= MAX_DEPTH {
                    return Err(Refusal::SplineRegularityUndecided);
                } else {
                    let (l, r) = p.split();
                    work.push((r, depth + 1));
                    work.push((l, depth + 1));
                }
            }
        }
        out.sort_by(|x, y| x.a.cmp(&y.a));
        Ok(out)
    }

    fn judge(p: &Piece, q: &Piece, lo: &Q, hi: &Q, closed: bool) -> Verdict {
        if adjacent(p, q, lo, hi, closed) {
            let both: Vec<P> = p.hodograph().into_iter().chain(q.hodograph()).collect();
            return if half_plane(&both).is_some() { Verdict::Disjoint } else { Verdict::Split };
        }
        let (bp, bq) = (p.aabb(), q.aabb());
        if (0..2).any(|c| bp[c][1] < bq[c][0] || bq[c][1] < bp[c][0]) {
            return Verdict::Disjoint;
        }
        let ends = |x: &Piece| [x.end(false), x.end(true)];
        if ends(p).iter().any(|e| ends(q).contains(e)) || miranda(p, q) || miranda(q, p) {
            return Verdict::Crossing;
        }
        Verdict::Split
    }

    fn check_simple(&self) -> R<()> {
        let (lo, hi) = (self.domain().0.clone(), self.domain().1.clone());
        let closed = self.eval(&lo)? == self.eval(&hi)?;
        let pieces = self.cone_pieces()?;
        let mut stack: Vec<(Piece, Piece, usize)> = vec![];
        for i in 0..pieces.len() {
            for j in i + 1..pieces.len() {
                stack.push((pieces[i].clone(), pieces[j].clone(), 0));
            }
        }
        let (mut nodes, mut undecided) = (0usize, false);
        while let Some((p, q, depth)) = stack.pop() {
            nodes += 1;
            if nodes > MAX_NODES {
                undecided = true;
                break;
            }
            match Self::judge(&p, &q, &lo, &hi, closed) {
                Verdict::Disjoint => {}
                Verdict::Crossing => return Err(Refusal::SplineSelfIntersecting),
                Verdict::Split if depth >= MAX_DEPTH => undecided = true,
                Verdict::Split => {
                    if (&p.b - &p.a) >= (&q.b - &q.a) {
                        let (l, r) = p.split();
                        stack.push((l, q.clone(), depth + 1));
                        stack.push((r, q, depth + 1));
                    } else {
                        let (l, r) = q.split();
                        stack.push((p.clone(), l, depth + 1));
                        stack.push((p, r, depth + 1));
                    }
                }
            }
        }
        if undecided {
            Err(Refusal::SplineRegularityUndecided)
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use num_bigint::BigInt;

    fn v(x: i64, y: i64) -> P {
        [Q::from_integer(BigInt::from(x)), Q::from_integer(BigInt::from(y))]
    }

    #[test]
    fn half_plane_is_open_and_strict() {
        // Every returned direction has a strictly positive dot with every vector.
        for vs in [vec![v(1, 0), v(0, 1)], vec![v(3, 1), v(1, 3), v(2, 2)], vec![v(2, 0), v(5, 0)]] {
            let u = half_plane(&vs).expect("an open half-plane exists");
            assert!(vs.iter().all(|x| dot(&u, x).is_positive()), "{vs:?}");
        }
        // Antiparallel members (all collinear) span no open half-plane.
        assert!(half_plane(&[v(1, 0), v(-1, 0)]).is_none());
        assert!(half_plane(&[v(2, 0), v(1, 0), v(-3, 0)]).is_none());
        // A closed half-plane (0, 90 and 180 degrees) and a zero vector are not open.
        assert!(half_plane(&[v(1, 0), v(0, 1), v(-1, 0)]).is_none());
        assert!(half_plane(&[v(1, 0), v(0, 0)]).is_none());
    }
}
