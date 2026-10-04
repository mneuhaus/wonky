//! Supporting carriers of trimmed curve pieces.
//!
//! `Carrier` is the one closed set of carrier kinds. Every operation of the
//! crate matches it exhaustively (no `_` arm), so adding `BSpline` (S5) was a
//! compile-forced edit of this crate's operation bodies and never of a consumer:
//! consumers only hold `Trimmed` pieces and call the operation table.
use crate::bspline::BSpline;
use crate::numeric::{cross, dot, enclose, finite, P, Q};
use crate::point::ExactPoint;
use crate::refusal::R;
use num_traits::{Signed, Zero};
use std::sync::Arc;
use wonky_num::{Iv, Scalar};

/// A circle with exact centre (rational, or in one admitted quadratic field) and
/// squared radius in Q or Q(sqrt d), and the trimmed angular extent of the
/// piece that rides on it. There need not be a rational point (r2 = 55 is one
/// example); the squared radius is authoritative.
#[derive(Clone, Debug)]
pub struct Circle {
    pub c: ExactPoint,
    pub r2: crate::radical::Radical,
    /// The piece runs counter-clockwise about `c` from its first to its second end.
    pub ccw: bool,
    /// Exact carrier anchor (the original three-point witness or ring
    /// antipode; rational whenever the centre and a ring seam are). Trimming
    /// preserves it; use the trim endpoints for sector/overlap decisions.
    pub mid: ExactPoint,
    /// Signed certified sweep of the piece: positive when `ccw`.
    pub angle: Iv,
    /// The piece is one full turn: both ends are the same point (the seam) and
    /// `angle` is +-2 pi. A ring is a vertex-free closed curve whose seam is only
    /// a parametrization anchor until something cuts the circle; `mid` is then
    /// the antipode of the original source seam, which need not be rational,
    /// or a rational carrier point supplied by `Trimmed::ring_with_anchor`.
    pub full: bool,
}

impl Circle {
    /// Certified radius enclosure.
    pub fn radius(&self) -> R<Iv> {
        finite(enclose(&self.r2)?.sqrt())
    }
    /// Binary64 serialization cache of the centre.
    pub fn centre_cache(&self) -> R<[f64; 2]> {
        self.c.cache()
    }
    /// Unit radial direction at `p` (binary64 midpoints of certified quotients).
    pub fn radial(&self, p: &ExactPoint) -> R<[f64; 2]> {
        crate::radical::guard(|| self.radial_exact(p))?
    }
    fn radial_exact(&self, p: &ExactPoint) -> R<[f64; 2]> {
        let r = self.radius()?;
        let d = p.enclosed_difference(&self.c)?;
        Ok([finite(d[0] / r)?.mid(), finite(d[1] / r)?.mid()])
    }
    /// Counter-clockwise angle about the centre from `from` to `to`, in [0, 2 pi).
    pub fn sweep(&self, from: &ExactPoint, to: &ExactPoint) -> R<Iv> {
        crate::radical::guard(|| self.sweep_exact(from, to))?
    }
    fn sweep_exact(&self, from: &ExactPoint, to: &ExactPoint) -> R<Iv> {
        if from == to {
            return Ok(Iv::point(0.));
        }
        let (u, v) = (from.difference(&self.c), to.difference(&self.c));
        crate::radical::positive_angle(&crate::radical::dot(&u, &v), &crate::radical::cross(&u, &v))
    }
    /// Angular membership of the direction `v` (from the centre) in the piece
    /// with exact ends `ends`. `strict` excludes rays along the ends.
    pub(crate) fn angular(&self, ends: &[ExactPoint; 2], v: &P, strict: bool) -> bool {
        self.angular_radical(ends, &crate::radical::vector(v), strict)
    }
    pub fn angular_radical(&self, ends: &[ExactPoint; 2], v: &crate::radical::V, strict: bool) -> bool {
        use crate::radical::{cross, dot};
        if v.iter().all(|x| x.is_zero()) { return false; }
        let mut a = ends[0].difference(&self.c);
        let mut b = ends[1].difference(&self.c);
        if self.full { return !(strict && cross(&a, v).is_zero() && dot(&a, v).is_positive()); }
        if !self.ccw { std::mem::swap(&mut a, &mut b); }
        let av = cross(&a, v);
        let vb = cross(v, &b);
        let ab = cross(&a, &b);
        if strict && ((av.is_zero() && dot(&a, v).is_positive()) || (vb.is_zero() && dot(v, &b).is_positive())) { return false; }
        if !ab.is_negative() { !av.is_negative() && !vb.is_negative() }
        else { !av.is_negative() || !vb.is_negative() }
    }
}

/// A trimmed B-spline: the spline and the parameters of the two ends of the
/// piece. `from` is the parameter of the FIRST end and `to` that of the second,
/// so `from > to` is the same piece traversed backwards (reversal is a swap).
#[derive(Clone, Debug)]
pub struct SplineCarrier {
    pub spline: Arc<BSpline>,
    pub from: Q,
    pub to: Q,
    /// Tangent leaving the first end and tangent at the second end pointing back
    /// into the piece (unnormalized, exact), fixed at construction.
    pub tangents: [P; 2],
}

impl SplineCarrier {
    /// The parameter range `(lo, hi)` with `lo < hi`.
    pub fn range(&self) -> (&Q, &Q) {
        if self.from < self.to {
            (&self.from, &self.to)
        } else {
            (&self.to, &self.from)
        }
    }
    /// The piece runs in the direction of increasing spline parameter.
    pub fn increasing(&self) -> bool {
        self.from < self.to
    }
}

/// The supporting curve of a piece.
#[derive(Clone, Debug)]
pub enum Carrier {
    /// The straight line through the two exact ends.
    Line,
    Circle(Circle),
    BSpline(SplineCarrier),
}

/// Identity of a carrier independent of its trim (used to merge equal pieces).
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum CarrierKey {
    Line,
    Circle { c: ExactPoint, r2: crate::radical::Radical },
    /// The whole spline (degree, knots, poles, weights), independent of the trim.
    BSpline { degree: usize, knots: Vec<Q>, poles: Vec<P>, weights: Option<Vec<Q>> },
}

/// The carrier as a serialization target (WC0 curve and surface charts). This
/// is the only place a consumer names carrier kinds, and it matches without a
/// wildcard so a new carrier is a compile error in the serializer.
#[derive(Clone, Copy, Debug)]
pub enum Chart<'a> {
    Line,
    Circle(&'a Circle),
    BSpline(&'a SplineCarrier),
}

/// An exact nonsingular rational plane map `p -> o + x ax + y ay` between
/// common charts. A negative determinant mirrors: cycles reverse traversal
/// to preserve orientation. Lines and polynomial splines admit affine maps;
/// circular pieces require an isometry because their `r2` is unchanged.
#[derive(Clone, Debug)]
pub struct PlaneMap {
    o: [Q; 2],
    ax: [Q; 2],
    ay: [Q; 2],
}

impl PlaneMap {
    /// The map, or `None` unless `ax` and `ay` are exactly orthonormal.
    pub fn isometry(o: [Q; 2], ax: [Q; 2], ay: [Q; 2]) -> Option<Self> {
        let one = Q::from_integer(1.into());
        (dot(&ax, &ax) == one && dot(&ay, &ay) == one && dot(&ax, &ay).is_zero())
            .then_some(Self { o, ax, ay })
    }
    /// General nonsingular rational affine map. Polynomial splines and lines
    /// are closed under it; circular pieces require `preserves_circles`.
    pub fn affine(o: [Q; 2], ax: [Q; 2], ay: [Q; 2]) -> Option<Self> {
        (!cross(&ax, &ay).is_zero()).then_some(Self { o, ax, ay })
    }
    pub fn preserves_circles(&self) -> bool {
        let one = Q::from_integer(1.into());
        dot(&self.ax, &self.ax) == one && dot(&self.ay, &self.ay) == one && dot(&self.ax, &self.ay).is_zero()
    }
    pub fn apply(&self, p: &P) -> P {
        [
            &self.o[0] + &self.ax[0] * &p[0] + &self.ay[0] * &p[1],
            &self.o[1] + &self.ax[1] * &p[0] + &self.ay[1] * &p[1],
        ]
    }
    pub fn apply_point(&self, p: &ExactPoint) -> ExactPoint {
        { let v = p.coordinates(); ExactPoint::from_radical([crate::radical::Radical::from(self.o[0].clone()) + &v[0] * &self.ax[0] + &v[1] * &self.ay[0], crate::radical::Radical::from(self.o[1].clone()) + &v[0] * &self.ax[1] + &v[1] * &self.ay[1]]) }
    }
    /// The origin and the two axis columns of the map.
    pub(crate) fn frame(&self) -> (&[Q; 2], &[Q; 2], &[Q; 2]) {
        (&self.o, &self.ax, &self.ay)
    }
    pub fn mirrors(&self) -> bool {
        (&self.ax[0] * &self.ay[1] - &self.ay[0] * &self.ax[1]).is_negative()
    }
}
