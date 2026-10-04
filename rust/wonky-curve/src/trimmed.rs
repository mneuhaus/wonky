//! A trimmed curve piece: a carrier between two exact end points, with the
//! binary64 serialization cache of those ends. This file is the operation
//! table's single-carrier half (evaluation, side predicates, measures); the
//! pair half is `intersect`, the winding half is `winding`, the cycle half is
//! `cycle`.
//!
//! Every operation matches `Carrier` exhaustively. Half-open conventions are
//! stated where they are decided: a piece owns its first end and not its last
//! for the horizontal-ray winding; `angular(_, strict)` decides whether a ray
//! along an end belongs to the sector.
use crate::bspline::{BSpline, QBound};
use crate::carrier::{Carrier, CarrierKey, Chart, Circle, PlaneMap, SplineCarrier};
use crate::intersect;
use crate::numeric::{cross, dot, enclose, finite, positive_angle, pt, q, sub, P, Q};
use crate::point::ExactPoint;
use crate::radical::{self as rad, Radical};
use crate::refusal::{Refusal, R};
use crate::contact::Contact;
use crate::star::{Direction, Ray};
use crate::winding;
use num_traits::{One, Signed, Zero};
use std::sync::Arc;
use wonky_num::{Iv, Scalar};

#[derive(Clone, Debug)]
pub struct Trimmed {
    ends: [ExactPoint; 2],
    /// Audited binary64 serialization caches of the ends; never decide topology.
    cache: [[f64; 2]; 2],
    carrier: Carrier,
}

/// Identity of a piece in canonical orientation.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct TrimKey {
    ends: [ExactPoint; 2],
    carrier: CarrierKey,
}

/// The inward parallel piece of a convex counter-clockwise piece at distance
/// `r` (see [`Trimmed::inset`]): exact ends, the parallel carrier, and the unit
/// left-of-travel normals at both ends (pointing out of the material).
#[derive(Clone, Debug)]
pub struct Inset {
    pub ends: [ExactPoint; 2],
    pub carrier: Carrier,
    pub normals: [P; 2],
}

/// Why a piece has no exact rational inset.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InsetRefusal {
    /// A clockwise arc bends away from the material.
    Clockwise,
    /// The radius, length or arc centre is not a rational.
    IrrationalRadius,
    /// The arc radius does not exceed the offset distance.
    Curvature,
    /// A line of zero length has no normal.
    ZeroLength,
    /// The parallel curve of a spline piece is not a spline piece.
    Spline,
}

/// Where a piece reaches in a linear form of its chart (see [`Trimmed::extrema`]).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Extrema {
    /// Upper enclosure bound of the interior extremum, when the piece reaches it.
    pub hi: Option<f64>,
    /// Lower enclosure bound of the interior extremum, when the piece reaches it.
    pub lo: Option<f64>,
}

/// Magnitude and rounding of a piece's carrier data, for export budgets.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Extent {
    /// Largest absolute upper bound among carrier parameters (radius, centre).
    pub magnitude: f64,
    /// Largest enclosure half-width of the binary64 caches of those parameters.
    pub rounding: f64,
}

/// Serialization frame of a piece: the binary64 data a boundary representation
/// needs, each the midpoint of a certified quotient (see [`Trimmed::frame`]).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PieceFrame {
    /// Unit chord direction from the first to the second end.
    pub tangent: [f64; 2],
    /// Present on a curved piece.
    pub arc: Option<ArcFrame>,
}

/// The circle part of a [`PieceFrame`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ArcFrame {
    pub centre: [f64; 2],
    pub radius: f64,
    /// Unit radial direction at the first end.
    pub radial: [f64; 2],
    /// Fraction of a full turn the piece sweeps, in (0, 1].
    pub turn: f64,
    pub ccw: bool,
}

impl Trimmed {
    /// A piece with eagerly audited ends (cache = midpoint of each enclosure).
    pub fn new(ends: [ExactPoint; 2], carrier: Carrier) -> R<Self> {
        rad::guard(|| Self::new_exact(ends, carrier))?
    }
    fn new_exact(ends: [ExactPoint; 2], carrier: Carrier) -> R<Self> {
        let cache = [ends[0].cache()?, ends[1].cache()?];
        Ok(Self { ends, cache, carrier })
    }
    /// A piece with caches supplied by the source that constructed it. The
    /// caller guarantees each cache is the binary64 of its exact end (as for
    /// binary64 sources). Pair culling uses endpoint enclosures, not these
    /// midpoints, so distinct quadratic keys may safely share a cache.
    pub fn with_cache(ends: [ExactPoint; 2], cache: [[f64; 2]; 2], carrier: Carrier) -> Self {
        Self { ends, cache, carrier }
    }
    /// A line between binary64 source points (caches are the sources).
    pub fn line(a: [f64; 2], b: [f64; 2]) -> Self {
        Self::with_cache(
            [ExactPoint::from_f64(a), ExactPoint::from_f64(b)],
            [a, b],
            Carrier::Line,
        )
    }
    /// A piece riding on `spline` between the parameters `from` (first end) and
    /// `to` (second end), in either order. The spline must be regular (no cusp,
    /// no self-intersection, else the named refusal) and `from != to` inside
    /// its domain. The ends are exact points of the spline.
    pub fn spline(spline: Arc<BSpline>, from: Q, to: Q) -> R<Self> {
        spline.regular()?;
        let (lo, hi) = spline.domain();
        if from == to || &from < lo || &from > hi || &to < lo || &to > hi {
            return Err(Refusal::SplineInvalid);
        }
        let ends = [
            ExactPoint::from_rational(spline.eval(&from)?),
            ExactPoint::from_rational(spline.eval(&to)?),
        ];
        let neg = |v: P| v.map(|x| -x);
        let tangents = if from < to {
            [spline.tangent_at(&from, true)?, neg(spline.tangent_at(&to, false)?)]
        } else {
            [neg(spline.tangent_at(&from, false)?), spline.tangent_at(&to, true)?]
        };
        Self::new(ends, Carrier::BSpline(SplineCarrier { spline, from, to, tangents }))
    }
    pub fn ends(&self) -> &[ExactPoint; 2] {
        &self.ends
    }
    pub fn cache(&self) -> &[[f64; 2]; 2] {
        &self.cache
    }
    pub fn carrier(&self) -> &Carrier {
        &self.carrier
    }
    /// The carrier as a serialization target.
    pub fn chart(&self) -> Chart<'_> {
        match &self.carrier {
            Carrier::Line => Chart::Line,
            Carrier::Circle(c) => Chart::Circle(c),
            Carrier::BSpline(k) => Chart::BSpline(k),
        }
    }

    // ------------------------------------------------------------ construction

    /// The arc through three binary64 source points `a`, `m`, `b`: rational
    /// centre and squared radius, the sense of the turn `a -> m -> b`, and the
    /// certified sweep from `a` to `b`. The caches are the source points.
    pub fn arc_through(a: [f64; 2], m: [f64; 2], b: [f64; 2]) -> R<Self> {
        let (ap, mp, bp) = (pt(a), pt(m), pt(b));
        let u = sub(&mp, &ap);
        let v = sub(&bp, &ap);
        let d = cross(&u, &v) * q(2.);
        if d.is_zero() {
            return Err(Refusal::CollinearThreePointArc);
        }
        let (uu, vv) = (dot(&u, &u), dot(&v, &v));
        let c = [
            &ap[0] + (&uu * &v[1] - &vv * &u[1]) / &d,
            &ap[1] + (&u[0] * &vv - &v[0] * &uu) / &d,
        ];
        let u = sub(&ap, &c);
        let v = sub(&bp, &c);
        let r2 = dot(&u, &u);
        let ccw = d.is_positive();
        let theta = positive_angle(&dot(&u, &v), &(if ccw { cross(&u, &v) } else { -cross(&u, &v) }))?;
        if theta.lo() <= 0. {
            return Err(Refusal::ZeroArc);
        }
        Ok(Self::with_cache(
            [ExactPoint::from_f64(a), ExactPoint::from_f64(b)],
            [a, b],
            Carrier::Circle(Circle { c: ExactPoint::from_rational(c), r2: r2.into(), ccw, mid: ExactPoint::from_rational(mp), angle: if ccw { theta } else { -theta }, full: false }),
        ))
    }
    /// The carrier is not a straight line.
    pub fn is_curved(&self) -> bool {
        match &self.carrier {
            Carrier::Line => false,
            Carrier::Circle(_) | Carrier::BSpline(_) => true,
        }
    }
    /// An end differs from the exact point its binary64 cache names: the piece
    /// was split at a vertex that binary64 cannot store.
    pub fn is_split(&self) -> bool {
        self.ends.iter().zip(&self.cache).any(|(e, c)| *e != ExactPoint::from_f64(*c))
    }
    /// The carrier's normal at an exact point of it: the radius of a circle,
    /// the chord turned a quarter of a turn on a line. Not normalized. A
    /// spline piece is refused `SplineArrangement` (its normal at an exact point
    /// needs the point's parameter).
    pub fn normal_at(&self, p: &ExactPoint) -> R<Direction> {
        rad::guard(|| self.normal_at_exact(p))?
    }
    fn normal_at_exact(&self, p: &ExactPoint) -> R<Direction> {
        Ok(Direction(match &self.carrier {
            Carrier::Circle(c) => p.difference(&c.c),
            Carrier::Line => {
                let d = self.ends[1].difference(&self.ends[0]);
                [-&d[1], d[0].clone()]
            }
            Carrier::BSpline(_) => return Err(Refusal::SplineArrangement),
        }))
    }
    /// The circle through both ends of this arc that is exactly tangent to
    /// `normal` at the end `at`, with the same sense, and an exact witness
    /// inside the piece. `None` for a line, for a chord perpendicular to the
    /// normal, and when the witness would leave the original side of the chord.
    /// The result keeps the ends and their caches. A spline piece is refused
    /// `SplineArrangement`.
    pub fn refitted(&self, at: &ExactPoint, normal: &Direction) -> R<Option<Self>> {
        rad::guard(|| self.refitted_exact(at, normal))?
    }
    fn refitted_exact(&self, at: &ExactPoint, normal: &Direction) -> R<Option<Self>> {
        let old = match &self.carrier {
            Carrier::Line => return Ok(None),
            Carrier::Circle(c) => c,
            Carrier::BSpline(_) => return Err(Refusal::SplineArrangement),
        };
        let (p, radial) = (at.rat()?, [normal.0[0].rational().ok_or(Refusal::CrossingNeedsAlgebraicVertex)?, normal.0[1].rational().ok_or(Refusal::CrossingNeedsAlgebraicVertex)?]);
        let (e0, e1) = (self.ends[0].rat()?, self.ends[1].rat()?);
        let other = if self.ends[0] == *at { e1 } else { e0 };
        let chord = sub(other, p);
        let denominator = q(2.) * dot(&radial, &chord);
        if denominator.is_zero() {
            return Ok(None);
        }
        let t = dot(&chord, &chord) / denominator;
        let c = [&p[0] + &t * &radial[0], &p[1] + &t * &radial[1]];
        let u = sub(e0, &c);
        let v = sub(e1, &c);
        let r2 = dot(&u, &u);
        // A rational interior point: the second intersection of the replacement
        // circle with the ray from the first end through the old interior point.
        let anchor = old.mid.clone();
        let witness = if self.contains(&anchor)? && self.angular(&sub(old.mid.rat()?, old.c.rat()?), true) {
            old.mid.rat()?.clone()
        } else {
            self.interior_point()?.rat()?.clone()
        };
        let ray = sub(&witness, e0);
        let scale = -q(2.) * dot(&u, &ray) / dot(&ray, &ray);
        let mid = [&e0[0] + &scale * &ray[0], &e0[1] + &scale * &ray[1]];
        let chord = sub(e1, e0);
        if scale <= Q::zero()
            || cross(&chord, &sub(&mid, e0)).is_positive()
                != cross(&chord, &sub(&witness, e0)).is_positive()
        {
            return Ok(None);
        }
        let angle = positive_angle(&dot(&u, &v), &(if old.ccw { cross(&u, &v) } else { -cross(&u, &v) }))?;
        Ok(Some(Self {
            ends: self.ends.clone(),
            cache: self.cache,
            carrier: Carrier::Circle(Circle { c: ExactPoint::from_rational(c), r2: r2.into(), mid: ExactPoint::from_rational(mid), ccw: old.ccw, angle: if old.ccw { angle } else { -angle }, full: false }),
        }))
    }
    /// L1 distance between the centres of two arcs; `None` unless both are arcs.
    pub fn centre_l1_distance(&self, other: &Trimmed) -> Option<Q> {
        match (&self.carrier, &other.carrier) {
            (Carrier::Circle(a), Carrier::Circle(b)) => {
                let (a, b) = (a.c.rat().ok()?, b.c.rat().ok()?);
                Some((&a[0] - &b[0]).abs() + (&a[1] - &b[1]).abs())
            }
            (Carrier::Line, Carrier::Line)
            | (Carrier::Line, Carrier::Circle(_))
            | (Carrier::Circle(_), Carrier::Line)
            | (Carrier::Line, Carrier::BSpline(_))
            | (Carrier::BSpline(_), Carrier::Line)
            | (Carrier::Circle(_), Carrier::BSpline(_))
            | (Carrier::BSpline(_), Carrier::Circle(_))
            | (Carrier::BSpline(_), Carrier::BSpline(_)) => None,
        }
    }
    /// This piece is `other` traversed the other way: swapped ends on one
    /// supporting curve with the opposite sense. Swapped ends on a pair with a
    /// spline piece are refused `SplineArrangement` (whether two spline
    /// parametrizations name one curve is the S6 arrangement question).
    pub fn retraces(&self, other: &Trimmed) -> R<bool> {
        rad::guard(|| self.retraces_exact(other))?
    }
    fn retraces_exact(&self, other: &Trimmed) -> R<bool> {
        if self.ends[0] != other.ends[1] || self.ends[1] != other.ends[0] {
            return Ok(false);
        }
        match (&self.carrier, &other.carrier) {
            (Carrier::Line, Carrier::Line) => Ok(true),
            (Carrier::Circle(a), Carrier::Circle(b)) => Ok(a.c == b.c && a.r2 == b.r2 && a.ccw != b.ccw),
            (Carrier::Line, Carrier::Circle(_)) | (Carrier::Circle(_), Carrier::Line) => Ok(false),
            (Carrier::BSpline(_), Carrier::Line)
            | (Carrier::BSpline(_), Carrier::Circle(_))
            | (Carrier::BSpline(_), Carrier::BSpline(_))
            | (Carrier::Line, Carrier::BSpline(_))
            | (Carrier::Circle(_), Carrier::BSpline(_)) => Err(Refusal::SplineArrangement),
        }
    }
    /// The same carrier traversed the other way.
    pub fn reversed(&self) -> Self {
        let mut s = self.clone();
        s.ends.swap(0, 1);
        s.cache.swap(0, 1);
        match &mut s.carrier {
            Carrier::Line => {}
            Carrier::Circle(c) => {
                c.ccw = !c.ccw;
                c.angle = -c.angle;
            }
            Carrier::BSpline(k) => {
                std::mem::swap(&mut k.from, &mut k.to);
                k.tangents.swap(0, 1);
            }
        }
        s
    }
    /// A full turn about `c` (squared radius `r2`) in the given sense, starting
    /// and ending at the exact `seam` point on the circle.
    /// A vertex-free exact circle; no rational-point assumption or floating root.
    pub fn circle(c: P, r2: impl Into<Radical>, ccw: bool) -> R<Self> {
        rad::guard(|| {
            let r2=r2.into();
            if r2.parts().is_none() { return Err(Refusal::CircleRadiusClass); }
            if !r2.is_positive() { return Err(Refusal::RadiusRange); }
            let r=r2.exact_sqrt()?;
            let seam=ExactPoint::from_radical([Radical::from(c[0].clone())+r,Radical::from(c[1].clone())]);
            Self::ring_exact(ExactPoint::from_rational(c),r2,seam,ccw,None)
        })?
    }
    pub fn ring(c: P, r2: impl Into<Radical>, seam: ExactPoint, ccw: bool) -> R<Self> {
        Self::ring_about(ExactPoint::from_rational(c), r2, seam, ccw)
    }
    /// [`Self::ring`] about an exact centre, which may lie in the quadratic
    /// field of the seam (a rolling-ball section between irrational normals).
    pub fn ring_about(c: ExactPoint, r2: impl Into<Radical>, seam: ExactPoint, ccw: bool) -> R<Self> {
        rad::guard(|| Self::ring_exact(c, r2.into(), seam, ccw, None))?
    }
    /// A full exact circle whose carrier anchor is a known rational point on it
    /// instead of the seam antipode, so a quadratic seam keeps a rational witness.
    pub fn ring_with_anchor(c: P, r2: impl Into<Radical>, seam: ExactPoint, ccw: bool, anchor: P) -> R<Self> {
        rad::guard(|| Self::ring_exact(ExactPoint::from_rational(c), r2.into(), seam, ccw, Some(anchor)))?
    }
    fn ring_exact(c: ExactPoint, r2: Radical, seam: ExactPoint, ccw: bool, anchor: Option<P>) -> R<Self> {
        if r2.parts().is_none() { return Err(Refusal::CircleRadiusClass); }
        let identity_skip = cfg!(feature = "plant_circle_identity_skip");
        // Rational data stay in Q (no radical budget); a quadratic centre,
        // squared radius or seam is decided in its field.
        let mid = if let (Ok(centre), Ok(at), Some(rq)) = (c.rat(), seam.rat(), r2.rational()) {
            let u = sub(at, centre);
            if !rq.is_positive() || (!identity_skip && dot(&u, &u) != rq) {
                return Err(Refusal::RingSeamOffCircle);
            }
            ExactPoint::from_rational([&centre[0] * q(2.) - &at[0], &centre[1] * q(2.) - &at[1]])
        } else {
            let u = seam.difference(&c);
            if !r2.is_positive() || (!identity_skip && rad::dot(&u, &u) != r2) {
                return Err(Refusal::RingSeamOffCircle);
            }
            let centre = c.coordinates();
            ExactPoint::from_radical(std::array::from_fn(|k| &centre[k] - &u[k]))
        };
        let mid = match anchor {
            Some(p) => {
                let p = ExactPoint::from_rational(p);
                let radial = p.difference(&c);
                if rad::dot(&radial, &radial) != r2 { return Err(Refusal::RingSeamOffCircle); }
                p
            }
            None => mid,
        };
        let turn = Iv::point(2.) * crate::numeric::pi();
        let carrier = Carrier::Circle(Circle { c, r2, ccw, mid, angle: if ccw { turn } else { -turn }, full: true });
        let cache = seam.cache()?;
        Ok(Self { ends: [seam.clone(), seam], cache: [cache, cache], carrier })
    }
    /// The piece is a full turn (vertex-free closed curve with a seam anchor).
    pub fn is_ring(&self) -> bool {
        match &self.carrier {
            Carrier::Circle(c) => c.full,
            Carrier::Line | Carrier::BSpline(_) => false,
        }
    }
    /// The sub-piece of this carrier between two exact points on it. On a full
    /// turn `trim(p, p)` is the full turn re-anchored at `p`, and any other pair
    /// is the open arc between them in the sense of the ring.
    pub fn trim(&self, a: ExactPoint, b: ExactPoint) -> R<Self> {
        rad::guard(|| self.trim_exact(a, b))?
    }
    fn trim_exact(&self, a: ExactPoint, b: ExactPoint) -> R<Self> {
        let mut carrier = self.carrier.clone();
        match &mut carrier {
            Carrier::Line => {}
            Carrier::Circle(c) => {
                for p in [&a,&b] {
                    let radial=p.difference(&c.c);
                    if rad::dot(&radial,&radial) != c.r2 { return Err(Refusal::CirclePointOffCurve); }
                }
                // mid remains the exact carrier anchor. It is not a
                // witness of this trim, including a re-anchored ring.
                if !(c.full && a == b) {
                    let u = a.difference(&c.c);
                    let v = b.difference(&c.c);
                    let turn = rad::cross(&u, &v);
                    let angle = rad::positive_angle(&rad::dot(&u, &v), &if c.ccw { turn } else { -turn })?;
                    c.angle = if c.ccw { angle } else { -angle };
                    c.full = false;
                }
            }
            Carrier::BSpline(k) => {
                let (from, to) = (self.spline_param(k, &a)?, self.spline_param(k, &b)?);
                return Self::spline(Arc::clone(&k.spline), from, to);
            }
        }
        let cache = [a.cache()?, b.cache()?];
        Ok(Self { ends: [a, b], cache, carrier })
    }
    /// What this piece contributes to its own cut set: its ends, except that the
    /// seam of a full turn is a vertex only when nothing else cuts the circle.
    pub fn cut_seed(&self) -> Vec<ExactPoint> {
        if self.is_ring() {
            vec![]
        } else {
            self.ends.to_vec()
        }
    }
    /// The pieces this piece falls into at `cuts` (points on it; the seed of
    /// [`Self::cut_seed`] must be part of them), in order along the piece. A
    /// full turn cut at k >= 2 distinct points is k arcs, the last one wrapping
    /// through the old seam; cut at one point it is one full turn anchored
    /// there; uncut it is itself.
    pub fn split(&self, cuts: Vec<ExactPoint>) -> R<Vec<Self>> {
        rad::guard(|| self.split_exact(cuts))?
    }
    fn split_exact(&self, cuts: Vec<ExactPoint>) -> R<Vec<Self>> {
        let points = self.sorted_cuts(cuts)?;
        if self.is_ring() {
            return match points.as_slice() {
                [] => Ok(vec![self.clone()]),
                [p] => Ok(vec![self.trim(p.clone(), p.clone())?]),
                _ => (0..points.len())
                    .map(|i| self.trim(points[i].clone(), points[(i + 1) % points.len()].clone()))
                    .collect(),
            };
        }
        points.windows(2).map(|w| self.trim(w[0].clone(), w[1].clone())).collect()
    }
    /// The piece mapped through an exact plane isometry. The traversal sense
    /// follows the map: a mirroring map flips `ccw` and the angle sign (the
    /// caller reverses the cycle to restore counter-clockwise order).
    pub fn mapped(&self, map: &PlaneMap) -> R<Self> {
        rad::guard(|| self.mapped_exact(map))?
    }
    fn mapped_exact(&self, map: &PlaneMap) -> R<Self> {
        if matches!(self.carrier, Carrier::Circle(_)) && !map.preserves_circles() {
            return Err(Refusal::NonIsometricCircleMap);
        }
        let flip = map.mirrors();
        let carrier = match &self.carrier {
            Carrier::Line => Carrier::Line,
            Carrier::Circle(k) => Carrier::Circle(Circle {
                c: map.apply_point(&k.c),
                r2: k.r2.clone(),
                ccw: k.ccw != flip,
                mid: map.apply_point(&k.mid),
                angle: if flip { -k.angle } else { k.angle },
                full: k.full,
            }),
            Carrier::BSpline(k) => {
                return Self::spline(Arc::new(k.spline.affine(map)?), k.from.clone(), k.to.clone());
            }
        };
        Self::new([map.apply_point(&self.ends[0]), map.apply_point(&self.ends[1])], carrier)
    }
    /// The piece in canonical orientation (lines from the lexicographically
    /// smaller end, arcs counter-clockwise) and whether `self` already was.
    pub fn canonical(&self) -> (Self, bool) {
        let forward = match &self.carrier {
            Carrier::Line => self.ends[0] < self.ends[1],
            Carrier::Circle(c) => c.ccw,
            Carrier::BSpline(k) => k.increasing(),
        };
        (if forward { self.clone() } else { self.reversed() }, forward)
    }
    pub fn key(&self) -> TrimKey {
        // The seam of a full turn is an anchor, not an identity: two rings on
        // one circle are one piece, keyed by the centre in place of the ends.
        let ends = match &self.carrier {
            Carrier::Circle(c) if c.full => {
                let centre = c.c.clone();
                [centre.clone(), centre]
            }
            Carrier::Circle(_) | Carrier::Line | Carrier::BSpline(_) => self.ends.clone(),
        };
        TrimKey {
            ends,
            carrier: match &self.carrier {
                Carrier::Line => CarrierKey::Line,
                Carrier::Circle(c) => CarrierKey::Circle { c: c.c.clone(), r2: c.r2.clone() },
                Carrier::BSpline(k) => CarrierKey::BSpline {
                    degree: k.spline.degree(),
                    knots: k.spline.knots().to_vec(),
                    poles: k.spline.poles().to_vec(),
                    weights: k.spline.weights().map(<[Q]>::to_vec),
                },
            },
        }
    }

    // ------------------------------------------------------------ predicates

    /// Angular membership of the direction `v` from the centre in an arc
    /// piece. `strict` excludes rays along the ends. Lines have no sector.
    pub fn angular(&self, v: &P, strict: bool) -> bool {
        match &self.carrier {
            Carrier::Line | Carrier::BSpline(_) => false,
            Carrier::Circle(c) => c.angular(&self.ends, v, strict),
        }
    }
    /// The two pieces lie on one supporting curve (their trims may differ).
    ///
    /// Two spline pieces coincide here when they ride on one spline value. A
    /// spline that lies on another carrier (a different spline, or a line or a
    /// circle) is not found here: `contacts` refuses it by name
    /// (`CoincidentSplineCarriers`, or `SplineContactUndecided` for two splines).
    pub fn coincident_with(&self, other: &Trimmed) -> R<bool> {
        rad::guard(|| self.coincident_with_exact(other))?
    }
    fn coincident_with_exact(&self, other: &Trimmed) -> R<bool> {
        Ok(match (&self.carrier, &other.carrier) {
            (Carrier::BSpline(a), Carrier::BSpline(b)) => a.spline == b.spline,
            (Carrier::BSpline(_), Carrier::Line | Carrier::Circle(_))
            | (Carrier::Line | Carrier::Circle(_), Carrier::BSpline(_)) => false,
            (Carrier::Circle(c), Carrier::Circle(d)) => c.c == d.c && c.r2 == d.r2,
            (Carrier::Line, Carrier::Line) => {
                let d = self.ends[1].difference(&self.ends[0]);
                other.ends.iter().all(|p| rad::cross(&d, &p.difference(&self.ends[0])).is_zero())
            }
            (Carrier::Line, Carrier::Circle(_)) | (Carrier::Circle(_), Carrier::Line) => false,
        })
    }
    /// The point lies on the closed piece (both ends included).
    pub fn contains(&self, p: &ExactPoint) -> R<bool> {
        rad::guard(|| self.contains_exact(p))?
    }
    fn contains_exact(&self, p: &ExactPoint) -> R<bool> {
        Ok(match &self.carrier {
            Carrier::Circle(c) => {
                let v = p.difference(&c.c);
                rad::dot(&v, &v) == c.r2 && c.angular_radical(&self.ends, &v, false)
            }
            Carrier::Line => {
                let d = self.ends[1].difference(&self.ends[0]);
                let v = p.difference(&self.ends[0]);
                rad::cross(&d, &v).is_zero() && !rad::dot(&v, &d).is_negative()
                    && !rad::dot(&p.difference(&self.ends[1]), &d).is_positive()
            }
            Carrier::BSpline(k) => {
                let (lo, hi) = k.range();
                k.spline.has_point(lo, hi, p.rat()?)?
            }
        })
    }
    /// The closed disc of centre `centre` and radius `r` (`r >= 0`) does not
    /// touch the closed piece. Exact, in Q: a line is compared by the squared
    /// distance to its supporting segment, an arc by `|d - rho| > r` (the disc
    /// lies inside or outside the circle) when the centre's direction from the
    /// arc's centre is on its sector, and by the ends otherwise. A spline piece
    /// is refused `SplineArrangement`.
    pub fn misses_disc(&self, centre: &P, r: &Q) -> R<bool> {
        rad::guard(|| self.misses_disc_exact(centre, r))?
    }
    fn misses_disc_exact(&self, centre: &P, r: &Q) -> R<bool> {
        self.clears_disc(centre, &(r * r))
    }
    /// Exact winding contribution around a point not on the piece (half-open:
    /// lower end inclusive, upper end exclusive, horizontal ray to +x).
    /// A spline piece counts its exact roots (see `winding`).
    pub fn winding(&self, p: &ExactPoint) -> R<i32> {
        rad::guard(|| self.winding_exact(p))?
    }
    fn winding_exact(&self, p: &ExactPoint) -> R<i32> {
        winding::of(self, p)
    }
    /// Contact points with another piece (see `intersect::contacts`; a pair
    /// with a spline piece is decided by `contact`).
    pub fn contacts(&self, other: &Trimmed) -> R<Vec<ExactPoint>> {
        rad::guard(|| self.contacts_exact(other))?
    }
    fn contacts_exact(&self, other: &Trimmed) -> R<Vec<ExactPoint>> {
        intersect::contacts(self, other)
    }
    /// The contacts with another piece and how each was found (see
    /// [`crate::ContactKind`]): for a spline pair, the known ends divided out
    /// before counting apart from what counting and isolation found.
    pub fn contact_report(&self, other: &Trimmed) -> R<Vec<Contact>> {
        rad::guard(|| self.contact_report_exact(other))?
    }
    fn contact_report_exact(&self, other: &Trimmed) -> R<Vec<Contact>> {
        crate::contact::of(self, other)
    }
    /// Simple-chain admission against a non-adjacent or adjacent piece: they
    /// may only touch at a shared end.
    pub fn admit(&self, other: &Trimmed) -> R<()> {
        rad::guard(|| self.admit_exact(other))?
    }
    fn admit_exact(&self, other: &Trimmed) -> R<()> {
        intersect::admit(self, other)
    }

    // ------------------------------------------------------------ order

    /// Recover the exact rational supporting line of a trimmed line. Quadratic
    /// endpoints are trims, not a new carrier: normalize one direction component
    /// and prove that the slope and intercept are rational.
    pub fn rational_line(&self) -> R<(P, P)> {
        if let (Ok(a), Ok(b)) = (self.ends[0].rat(), self.ends[1].rat()) { return Ok((a.clone(), sub(b, a))); }
        let a = self.ends[0].coordinates();
        let d = self.ends[1].difference(&self.ends[0]);
        let k = usize::from(d[0].is_zero());
        if d[k].is_zero() { return Err(Refusal::EdgeLengthRange); }
        let j = 1 - k;
        let slope = &d[j] / &d[k];
        let intercept = &a[j] - &slope * &a[k];
        let mut origin = [Q::zero(), Q::zero()];
        let mut direction = [Q::zero(), Q::zero()];
        origin[j] = intercept.rational().ok_or(Refusal::CrossingNeedsAlgebraicVertex)?;
        direction[k] = q(1.);
        direction[j] = slope.rational().ok_or(Refusal::CrossingNeedsAlgebraicVertex)?;
        Ok((origin, direction))
    }
    /// Sort `points` (all on this piece) along the piece from its first end,
    /// merging equal points.
    pub fn sorted_cuts(&self, points: Vec<ExactPoint>) -> R<Vec<ExactPoint>> {
        rad::guard(|| self.sorted_cuts_exact(points))?
    }
    fn sorted_cuts_exact(&self, mut points: Vec<ExactPoint>) -> R<Vec<ExactPoint>> {
        points.sort();
        points.dedup();
        match &self.carrier {
            Carrier::Circle(c) => points.sort_by(|a, b| {
                let start = self.ends[0].difference(&c.c);
                let local = |p: &ExactPoint| {
                    let p = p.difference(&c.c);
                    let turn = rad::cross(&start, &p);
                    [rad::dot(&start, &p), if c.ccw { turn } else { -turn }]
                };
                let order = crate::Param::Angular(local(a)).cmp(&crate::Param::Angular(local(b)));
                if cfg!(feature = "plant_reversed_cut_order") { order.reverse() } else { order }
            }),
            Carrier::Line => points.sort_by(|a, b| {
                let d = self.ends[1].difference(&self.ends[0]);
                rad::dot(&a.difference(&self.ends[0]), &d).cmp(&rad::dot(&b.difference(&self.ends[0]), &d))
            }),
            Carrier::BSpline(k) => {
                // Sorted by the parameter (unique on a regular spline; a point
                // met at two parameters, or at an irrational one, is refused).
                let mut keyed = Vec::with_capacity(points.len());
                for p in points {
                    let t = self.spline_param(k, &p)?;
                    keyed.push((if k.increasing() { t } else { -t }, p));
                }
                keyed.sort_by(|a, b| a.0.cmp(&b.0));
                points = keyed.into_iter().map(|(_, p)| p).collect();
            }
        }
        Ok(points)
    }
    /// The parameter of a point of this spline piece: the stored parameter of an
    /// end, else the unique rational parameter (a point off the piece, met
    /// twice, or at an irrational parameter refuses `SplineArrangement`).
    fn spline_param(&self, k: &SplineCarrier, p: &ExactPoint) -> R<Q> {
        if *p == self.ends[0] {
            return Ok(k.from.clone());
        }
        if *p == self.ends[1] {
            return Ok(k.to.clone());
        }
        let (lo, hi) = k.range();
        match k.spline.params_of(lo, hi, p.rat()?)?.as_slice() {
            [t] => Ok(t.clone()),
            _ => Err(Refusal::SplineArrangement),
        }
    }
    /// Tangent direction leaving the first end (`forward`) or the last end
    /// pointing back into the piece (`!forward`).
    pub fn tangent(&self, forward: bool) -> Direction {
        Direction(match &self.carrier {
            Carrier::Circle(c) => {
                let v = self.ends[usize::from(!forward)].difference(&c.c);
                if c.ccw == forward {
                    [-&v[1], v[0].clone()]
                } else {
                    [v[1].clone(), -&v[0]]
                }
            }
            Carrier::Line => {
                if forward {
                    self.ends[1].difference(&self.ends[0])
                } else {
                    self.ends[0].difference(&self.ends[1])
                }
            }
            Carrier::BSpline(k) => rad::vector(&k.tangents[usize::from(!forward)]),
        })
    }
    /// The ray leaving the first end (`forward`) or the last end back into the
    /// piece, with the second-order data the star order needs (`star::Ray`): a
    /// line's second derivative is zero; a circle's, for the tangent
    /// `d = +-(v turned a quarter)` of the radius vector `v`, is `-v`; a
    /// spline's are the exact one-sided derivatives at the end's parameter in
    /// the direction of travel.
    pub fn ray(&self, forward: bool) -> R<Ray> {
        rad::guard(|| self.ray_exact(forward))?
    }
    fn ray_exact(&self, forward: bool) -> R<Ray> {
        let d = self.tangent(forward).0;
        Ok(match &self.carrier {
            Carrier::Line => Ray { d, e: [Radical::default(), Radical::default()], spline: false },
            Carrier::Circle(c) => {
                let v = self.ends[usize::from(!forward)].difference(&c.c);
                Ray { d, e: v.map(|x| -x), spline: false }
            }
            Carrier::BSpline(k) => {
                let (at, towards) = if forward { (&k.from, &k.to) } else { (&k.to, &k.from) };
                let up = towards > at;
                let (first, second) = k.spline.derivatives_at(at, up)?;
                Ray { d: rad::vector(&if up { first } else { first.map(|x| -x) }), e: rad::vector(&second), spline: true }
            }
        })
    }
    /// A point strictly inside the piece, exact. For an arc a->b the chord
    /// through a in direction t_a + (b - a) (t_a the tangent along the piece)
    /// meets the circle again strictly between a and b: the tangent-chord
    /// angle is half the swept angle, which is below pi.
    /// Exact midpoint admission for quadratic lines. A rational point need
    /// not exist on the line itself. Dark arrangement consumers can retain
    /// this construction point while proposing rational cell witnesses.
    pub fn exact_interior_point(&self) -> R<ExactPoint> {
        rad::guard(|| match &self.carrier {
            Carrier::Line => {
                let (a,b)=(self.ends[0].coordinates(),self.ends[1].coordinates());
                match ExactPoint::from_exact_coordinates(std::array::from_fn(|i|(&a[i]+&b[i])/q(2.))) {
                    // Ends in two different quadratic fields (two rulings of
                    // one strip, boolean3d G12b): their midpoint has no
                    // point class, but a rational line has certified rational
                    // interior points.
                    Err(Refusal::CrossingNeedsAlgebraicVertex) if self.rational_line().is_ok() => self.rational_interior(),
                    other => other,
                }
            }
            Carrier::Circle(c) => self.angular_interior(c),
            Carrier::BSpline(_) => self.interior_point_exact(),
        })?
    }
    fn angular_interior(&self, c: &Circle) -> R<ExactPoint> {
        let u = self.ends[0].difference(&c.c);
        if c.full {
            return Ok(ExactPoint::from_radical(std::array::from_fn(|k| &c.c.coordinates()[k] - &u[k])));
        }
        // atan/tan only propose a rational rotation; exact identity and sector
        // tests alone admit it. Decrease the angle until it is strictly inside.
        let mut proposal = (c.angle.m.abs().min(std::f64::consts::PI) / 4.).tan();
        for _ in 0..512 {
            if !proposal.is_finite() || proposal <= 0. { break; }
            let t = q(proposal);
            let t2 = &t * &t;
            let den = q(1.) + &t2;
            let cosine = (q(1.) - &t2) / &den;
            let sine = q(2.) * &t / &den * if c.ccw { q(1.) } else { q(-1.) };
            let v = [&u[0] * &cosine - &u[1] * &sine, &u[0] * &sine + &u[1] * &cosine];
            if rad::dot(&v, &v) == c.r2 && c.angular_radical(&self.ends, &v, true) {
                return Ok(ExactPoint::from_radical(std::array::from_fn(|k| &c.c.coordinates()[k] + &v[k])));
            }
            proposal /= 2.;
        }
        Err(Refusal::ArcInteriorWitness)
    }
    pub fn interior_point(&self) -> R<ExactPoint> {
        rad::guard(|| self.interior_point_exact())?
    }
    fn interior_point_exact(&self) -> R<ExactPoint> {
        if let Carrier::Circle(c) = &self.carrier {
            // A quadratic centre puts the witness in its field.
            if c.c.rat().is_err() { return self.rational_interior(); }
            if c.mid.rat().is_err() { return self.angular_interior(c); }
        }
        if self.ends.iter().any(|p| p.rat().is_err()) { return self.rational_interior(); }
        let (a, b) = (self.ends[0].rat()?, self.ends[1].rat()?);
        match &self.carrier {
            Carrier::Line => Ok(ExactPoint::from_rational([
                (&a[0] + &b[0]) / q(2.),
                (&a[1] + &b[1]) / q(2.),
            ])),
            Carrier::Circle(c) if c.full => {
                let centre = c.c.rat()?;
                Ok(ExactPoint::from_rational([&centre[0] * q(2.) - &a[0], &centre[1] * q(2.) - &a[1]]))
            }
            Carrier::Circle(c) => {
                let centre = c.c.rat()?;
                let u = sub(a, centre);
                let tangent = if c.ccw {
                    [-&u[1], u[0].clone()]
                } else {
                    [u[1].clone(), -&u[0]]
                };
                let chord = sub(b, a);
                let d = [&tangent[0] + &chord[0], &tangent[1] + &chord[1]];
                let t = -q(2.) * dot(&u, &d) / dot(&d, &d);
                let p = [&a[0] + &t * &d[0], &a[1] + &t * &d[1]];
                let v = sub(&p, centre);
                if dot(&v, &v) != c.r2 || !self.angular(&v, true) {
                    return Err(Refusal::ArcInteriorWitness);
                }
                Ok(ExactPoint::from_rational(p))
            }
            Carrier::BSpline(k) => {
                let mid = (&k.from + &k.to) / q(2.);
                Ok(ExactPoint::from_rational(k.spline.eval(&mid)?))
            }
        }
    }

    fn rational_interior(&self) -> R<ExactPoint> {
        match &self.carrier {
            Carrier::Line => {
                let (origin, direction) = self.rational_line()?;
                // Use the dominant axis to propose a witness; certify it exactly below.
                let k = usize::from(direction[1].abs() > direction[0].abs());
                let a = self.ends[0].coordinates()[k].clone();
                let b = self.ends[1].coordinates()[k].clone();
                let mid = (&a + &b) / q(2.);
                let seed = mid.enclosure()?.m;
                let at = (q(seed) - &origin[k]) / &direction[k];
                let p = ExactPoint::from_rational(std::array::from_fn(|j| &origin[j] + &at * &direction[j]));
                if p != self.ends[0] && p != self.ends[1] && self.contains(&p)? { Ok(p) }
                else { Err(Refusal::SubResolutionFeature) }
            }
            Carrier::Circle(c) => {
                // Rational parametrization of the same exact circle from its
                // rational source anchor. Float midpoints propose a parameter;
                // exact circle and strict-sector predicates certify it.
                // A quadratic centre puts the anchor and the witness in its
                // field; the rational rotation keeps them there.
                let u = c.mid.difference(&c.c);
                let a = self.ends[0].difference(&c.c);
                let theta = rad::positive_angle(&rad::dot(&u, &a), &rad::cross(&u, &a))?.m;
                let angle = theta + c.angle.m / 2.;
                let t = q((angle / 2.).tan());
                let square = &t * &t;
                let divisor = q(1.) + &square;
                let x = (&u[0] * &(q(1.) - &square) - &u[1] * &(q(2.) * &t)) / &divisor;
                let y = (&u[1] * &(q(1.) - &square) + &u[0] * &(q(2.) * &t)) / &divisor;
                let centre = c.c.coordinates();
                let p = ExactPoint::from_coordinates([&centre[0] + &x, &centre[1] + &y])?;
                if self.contains(&p)? && c.angular_radical(&self.ends, &p.difference(&c.c), true) { Ok(p) }
                else { Err(Refusal::ArcInteriorWitness) }
            }
            Carrier::BSpline(_) => Err(Refusal::CrossingNeedsAlgebraicVertex),
        }
    }

    /// Exact subdivision witness with bounded-size rational rotation proposals.
    /// An approximate angle only proposes a dyadic stereographic parameter;
    /// radius equality and strict trim membership are checked in Q. A failed
    /// proposal falls back to the unconditional exact interior witness above.
    /// Repeated refinement thus avoids squaring both endpoint denominators.
    pub fn refinement_point(&self) -> R<ExactPoint> {
        if let Carrier::Circle(c)=&self.carrier {
            // A quadratic centre takes the exact interior witness directly.
            if c.c.rat().is_err() { return self.interior_point(); }
            if !c.full { self.ends[0].rat()?; }
        }
        self.refinement_point_exact()
    }
    /// General exact subdivision, including non-rational angular anchors.
    pub fn refinement_point_exact(&self) -> R<ExactPoint> {
        if let Carrier::Circle(c)=&self.carrier {
            if !c.full {
                let proposal=(c.angle.m.abs()/4.).tan();
                let value=(proposal*65536.).round()/65536.;
                if value.is_finite() && value>0. {
                    let t=q(value);
                    let t2=&t*&t;
                    let den=q(1.)+&t2;
                    let cosine=(q(1.)-&t2)/&den;
                    let sine=q(2.)*&t/&den*if c.ccw {q(1.)} else {q(-1.)};
                    let u=self.ends[0].difference(&c.c);
                    let v=[&cosine*&u[0]-&sine*&u[1],&sine*&u[0]+&cosine*&u[1]];
                    if rad::dot(&v,&v)==c.r2 && c.angular_radical(&self.ends,&v,true) {
                        let centre=c.c.coordinates();
                        return Ok(ExactPoint::from_radical([&centre[0]+&v[0],&centre[1]+&v[1]]));
                    }
                }
            }
        }
        self.interior_point()
    }

    // ------------------------------------------------------------ measures

    /// Certified arc length.
    pub fn length(&self) -> R<Iv> {
        rad::guard(|| self.length_exact())?
    }
    fn length_exact(&self) -> R<Iv> {
        match &self.carrier {
            Carrier::Circle(c) => finite(enclose(&c.r2)?.sqrt() * c.angle.abs()),
            Carrier::Line => {
                rad::norm(&self.ends[1].difference(&self.ends[0]))
            }
            Carrier::BSpline(k) => {
                let (lo, hi) = k.range();
                k.spline.length(lo, hi)?.iv()
            }
        }
    }
    /// The exact Green term `1/2 integral (x dy - y dx)` of the piece when it is
    /// rational: a line, or a spline whose spans in the trim have constant
    /// weight (every polynomial spline). `None` for a circle (pi) and for a
    /// weighted rational span (atan/log terms).
    /// Exact symbolic Green term, including irrational coefficients of pi.
    pub fn green_symbolic(&self) -> R<crate::Green> {
        rad::guard(|| {
            let mut out = crate::Green::default();
            match &self.carrier {
                Carrier::Line => out.algebraic = rad::cross(&self.ends[0].coordinates(), &self.ends[1].coordinates()) / q(2.),
                Carrier::Circle(c) => {
                    let u = self.ends[0].difference(&c.c);
                    let v = self.ends[1].difference(&c.c);
                    let coefficient = &c.r2 / q(2.) * if c.ccw { q(1.) } else { q(-1.) };
                    out.algebraic = rad::cross(&c.c.coordinates(), &rad::sub(&v,&u)) / q(2.);
                    if c.full { out.pi = coefficient * q(2.); }
                    else {
                        let turn = rad::cross(&u,&v) * if c.ccw { q(1.) } else { q(-1.) };
                        out.sweep(rad::dot(&u,&v), turn, coefficient);
                    }
                }
                Carrier::BSpline(_) => out.algebraic = self.green_exact()?.ok_or(Refusal::SymbolicGreenUnavailable)?.into(),
            }
            Ok(out)
        })?
    }
    pub fn green_exact(&self) -> R<Option<Q>> {
        rad::guard(|| self.green_exact_exact())?
    }
    fn green_exact_exact(&self) -> R<Option<Q>> {
        match &self.carrier {
            Carrier::Line => Ok((rad::cross(&self.ends[0].coordinates(), &self.ends[1].coordinates()) / q(2.)).rational()),
            Carrier::Circle(_) => Ok(None),
            Carrier::BSpline(k) => {
                let (lo, hi) = k.range();
                let area = k.spline.area(lo, hi)?;
                if !area.is_exact() {
                    return Ok(None);
                }
                Ok(Some(if k.increasing() { area.lo } else { -area.lo }))
            }
        }
    }
    /// Signed area between the piece and its chord (the Green term that adds to
    /// the chord polygon's area). Zero for a line.
    pub fn segment_area(&self) -> R<Iv> {
        rad::guard(|| self.segment_area_exact())?
    }
    fn segment_area_exact(&self) -> R<Iv> {
        let c = match &self.carrier {
            Carrier::Line => return Ok(Iv::point(0.)),
            Carrier::Circle(c) => c,
            Carrier::BSpline(k) => {
                // Green area of the piece minus the area under its chord.
                let (lo, hi) = k.range();
                let green = k.spline.area(lo, hi)?;
                let green = if k.increasing() { green } else { green.neg() };
                let chord = cross(self.ends[0].rat()?, self.ends[1].rat()?) / q(2.);
                return green.sub(&QBound::exact(chord)).iv();
            }
        };
        let theta = c.angle.abs();
        let twice = if theta.hi() <= 0.5 {
            // theta - sin(theta), evaluated without catastrophic cancellation.
            // Alternating Taylor series, with the first omitted term bounding
            // the remainder for every theta in [0, 0.5].
            let square = theta * theta;
            let mut term = theta * square / Iv::point(6.);
            let mut sum = term;
            for n in 2..=12 {
                term = term * square / Iv::point((2 * n * (2 * n + 1)) as f64);
                sum = if n % 2 == 0 { sum - term } else { sum + term };
            }
            let remainder = finite(term * square / Iv::point(26. * 27.))?.abs().hi();
            let defect = sum + Iv { m: 0., r: remainder };
            enclose(&c.r2)? * if c.ccw { defect } else { -defect }
        } else {
            let u = self.ends[0].difference(&c.c);
            let v = self.ends[1].difference(&c.c);
            enclose(&c.r2)? * c.angle - rad::cross(&u, &v).enclosure()?
        };
        finite(twice / Iv::point(2.))
    }
    /// First and second moments of the piece's contribution to a cycle's
    /// Green integrals: the exact chord wedge term and, for arcs, the circular
    /// segment term. Returned as (exact chord part in Q, enclosed arc part).
    /// A line has no arc part: adding a zero enclosure would widen a rounded sum.
    pub(crate) fn moment_terms(&self) -> R<([Radical; 2], Option<[Iv; 2]>)> {
        let (ap, bp) = (self.ends[0].coordinates(), self.ends[1].coordinates());
        let wedge = rad::cross(&ap, &bp);
        let mut exact = [Radical::default(), Radical::default()];
        for k in 0..2 {
            exact[k] = &exact[k] + &wedge * (&ap[k] + &bp[k]) / q(6.);
        }
        let arc = match &self.carrier {
            Carrier::Line => None,
            Carrier::BSpline(k) => {
                // The Green moment of the piece replaces the chord term: exact when
                // the spline is polynomial or of constant weight, else the exact
                // chord part plus the enclosed difference (the "segment" moment).
                let (lo, hi) = k.range();
                let g = k.spline.green(lo, hi)?;
                let sign = |b: QBound| if k.increasing() { b } else { b.neg() };
                let m = [sign(g.mx), sign(g.my)];
                if m.iter().all(QBound::is_exact) {
                    return Ok(([Radical::from(m[0].lo.clone()), Radical::from(m[1].lo.clone())], None));
                }
                let mut terms = [Iv::point(0.); 2];
                for c in 0..2 {
                    terms[c] = m[c].sub(&QBound::exact(exact[c].rational().ok_or(Refusal::CrossingNeedsAlgebraicVertex)?)).iv()?;
                }
                return Ok((exact, Some(terms)));
            }
            Carrier::Circle(c) => {
                let (u, v) = (self.ends[0].difference(&c.c), self.ends[1].difference(&c.c));
                let area = self.segment_area()?;
                let sector = [&v[1] - &u[1], &u[0] - &v[0]];
                // Center-relative circular segment moment avoids subtracting
                // nearly equal sector and triangle terms on tiny trimmed arcs.
                let scale = (c.r2.clone() - rad::dot(&u, &v)) / q(6.);
                let mut terms = [Iv::point(0.); 2];
                for k in 0..2 {
                    terms[k] = c.c.enclosure()?[k] * area;
                    exact[k] = &exact[k] + &scale * &sector[k];
                }
                Some(terms)
            }
        };
        Ok((exact, arc))
    }
    /// Outward binary64 bounding box of the piece: enclosed ends plus the carrier's
    /// axis-aligned extremes that the piece actually reaches.
    pub fn bounds(&self) -> R<[[f64; 2]; 2]> {
        rad::guard(|| self.bounds_exact())?
    }
    fn bounds_exact(&self) -> R<[[f64; 2]; 2]> {
        let (a, b) = (self.ends[0].enclosure()?, self.ends[1].enclosure()?);
        let mut lo = [a[0].lo().min(b[0].lo()), a[1].lo().min(b[1].lo())];
        let mut hi = [a[0].hi().max(b[0].hi()), a[1].hi().max(b[1].hi())];
        match &self.carrier {
            Carrier::Line => {}
            Carrier::BSpline(k) => {
                let (from, to) = k.range();
                for c in 0..2 {
                    let mut unit = [Q::zero(), Q::zero()];
                    unit[c] = Q::one();
                    for v in k.spline.form_values(from, to, &unit[0], &unit[1])? {
                        let v = v.iv()?;
                        lo[c] = lo[c].min(v.lo());
                        hi[c] = hi[c].max(v.hi());
                    }
                }
            }
            Carrier::Circle(c) => {
                let r = c.radius()?;
                for k in 0..2 {
                    for sign in [-1., 1.] {
                        let mut v = [Q::zero(), Q::zero()];
                        v[k] = q(sign);
                        if self.angular(&v, false) {
                            let p = finite(c.c.enclosure()?[k] + Iv::point(sign) * r)?;
                            lo[k] = lo[k].min(p.lo());
                            hi[k] = hi[k].max(p.hi());
                        }
                    }
                }
            }
        }
        Ok([lo, hi])
    }
    /// Extremes of the linear form `constant + coeff . (x, y)` over the
    /// piece's carrier, where the piece reaches them in the direction of
    /// `coeff` (upper) or of `-coeff` (lower). The ends are not included: they
    /// are handled as points. A line reaches no interior extremum.
    pub fn extrema(&self, constant: &Q, coeff: [&Q; 2]) -> R<Extrema> {
        rad::guard(|| self.extrema_exact(constant, coeff))?
    }
    fn extrema_exact(&self, constant: &Q, coeff: [&Q; 2]) -> R<Extrema> {
        match &self.carrier {
            Carrier::Line => Ok(Extrema { hi: None, lo: None }),
            Carrier::BSpline(k) => {
                // The values of the form at the piece's interior critical
                // points and knots: points of the piece, so their hull is valid.
                let (from, to) = k.range();
                let mut out = Extrema { hi: None, lo: None };
                for v in k.spline.form_values(from, to, coeff[0], coeff[1])? {
                    let v = QBound { lo: constant + &v.lo, hi: constant + &v.hi }.iv()?;
                    out.hi = Some(out.hi.map_or(v.hi(), |h| h.max(v.hi())));
                    out.lo = Some(out.lo.map_or(v.lo(), |l| l.min(v.lo())));
                }
                Ok(out)
            }
            Carrier::Circle(c) => {
                let centre = c.c.linear_form(constant, coeff)?;
                let direction = [coeff[0].clone(), coeff[1].clone()];
                let reach = finite(enclose(&(&c.r2 * dot(&direction, &direction)))?.sqrt())?;
                let mut out = Extrema { hi: None, lo: None };
                if self.angular(&direction, false) {
                    out.hi = Some(finite(centre + reach)?.hi());
                }
                if self.angular(&direction.map(|x| -x), false) {
                    out.lo = Some(finite(centre - reach)?.lo());
                }
                Ok(out)
            }
        }
    }
    /// Magnitude and rounding of the carrier parameters (export budgets).
    /// Lines carry none: their data are the end points.
    pub fn extent(&self) -> R<Extent> {
        rad::guard(|| self.extent_exact())?
    }
    fn extent_exact(&self) -> R<Extent> {
        match &self.carrier {
            Carrier::Line => Ok(Extent { magnitude: 0., rounding: 0. }),
            Carrier::BSpline(k) => {
                let mut e = Extent { magnitude: 0., rounding: 0. };
                let weights = k.spline.weights().unwrap_or(&[]);
                for x in k.spline.poles().iter().flatten().chain(weights) {
                    let iv = enclose(x)?;
                    e.magnitude = e.magnitude.max(iv.abs().hi());
                    e.rounding = e.rounding.max(iv.r);
                }
                Ok(e)
            }
            Carrier::Circle(c) => {
                let r = c.radius()?;
                let mut e = Extent { magnitude: r.hi(), rounding: 0. };
                for k in 0..2 {
                    let centre = c.c.enclosure()?[k];
                    e.magnitude = e.magnitude.max(centre.abs().hi());
                    e.rounding = e.rounding.max(centre.r + r.r);
                }
                Ok(e)
            }
        }
    }
    /// The serialization frame: unit chord direction, and for a circle its
    /// centre, radius, start radial and turn fraction. A split end is read
    /// from its exact point, an unsplit one from its binary64 cache, exactly as
    /// the audited construction did. A chord or radius enclosure containing
    /// zero is refused (`EdgeLengthRange`, `RadiusRange`).
    pub fn frame(&self) -> R<PieceFrame> {
        rad::guard(|| self.frame_exact())?
    }
    fn frame_exact(&self) -> R<PieceFrame> {
        let split = self.is_split();
        let delta = |k: usize| {
            if split {
                self.ends[1].difference(&self.ends[0])[k].enclosure()
            } else {
                Ok(Iv::point(self.cache[1][k]) - Iv::point(self.cache[0][k]))
            }
        };
        let (dx, dy) = (delta(0)?, delta(1)?);
        let len = finite(dx.norm3(dy, Iv::point(0.)))?;
        if len.lo() <= 0. {
            return Err(Refusal::EdgeLengthRange);
        }
        let tangent = [finite(dx / len)?.mid(), finite(dy / len)?.mid()];
        let arc = match &self.carrier {
            Carrier::Line => None,
            Carrier::BSpline(_) => return Err(Refusal::SplineArrangement),
            Carrier::Circle(c) => {
                let radius = c.radius()?;
                if radius.lo() <= 0. {
                    return Err(Refusal::RadiusRange);
                }
                let centre = [c.c.enclosure()?[0], c.c.enclosure()?[1]];
                let from = |k: usize| {
                    if split {
                        self.ends[0].difference(&c.c)[k].enclosure()
                    } else {
                        Ok(Iv::point(self.cache[0][k]) - centre[k])
                    }
                };
                let radial = [finite(from(0)? / radius)?.mid(), finite(from(1)? / radius)?.mid()];
                let turn = finite(c.angle.abs() / (Iv::point(2.) * crate::numeric::pi()))?.mid();
                Some(ArcFrame {
                    centre: centre.map(|x| x.mid()),
                    radius: radius.mid(),
                    radial,
                    turn,
                    ccw: c.ccw,
                })
            }
        };
        Ok(PieceFrame { tangent, arc })
    }
    /// Certified distance from an exact point to the piece: to the carrier
    /// where the point's foot lies on the piece, otherwise to the nearer end.
    /// A spline piece minimizes over its ends and every interior root of
    /// `(C(t) - p) . C'(t)` (`BSpline::closest`), not over its ends alone.
    pub fn distance(&self, p: &ExactPoint) -> R<Iv> {
        rad::guard(|| self.distance_exact(p))?
    }
    fn distance_exact(&self, p: &ExactPoint) -> R<Iv> {
        let pexact = p.coordinates();
        let (a, b) = (self.ends[0].coordinates(), self.ends[1].coordinates());
        match &self.carrier {
            Carrier::BSpline(k) => {
                if cfg!(feature = "plant_probe_endpoints_only") { return Ok(rad::norm(&rad::sub(&pexact, &a))?.min(rad::norm(&rad::sub(&pexact, &b))?)); }
                let (lo, hi) = k.range();
                k.spline.closest(lo, hi, p.rat()?)?.dist2.sqrt_iv()
            }
            Carrier::Circle(c) => {
                let v = p.difference(&c.c);
                if c.angular_radical(&self.ends, &v, false) {
                    // Rationalize the difference of roots before enclosure.
                    // Subtracting two radius-sized balls loses the distance of
                    // a rounded mesh sample only one ulp off the exact circle.
                    let gap = (rad::dot(&v, &v) - c.r2.clone()).abs();
                    if gap.is_zero() { return Ok(Iv::point(0.)); }
                    return finite(gap.enclosure()? / (rad::norm(&v)? + c.radius()?));
                }
                Ok(rad::norm(&rad::sub(&pexact, &a))?.min(rad::norm(&rad::sub(&pexact, &b))?))
            }
            Carrier::Line => {
                let d = rad::sub(&b, &a);
                let t = (rad::dot(&rad::sub(&pexact, &a), &d) / rad::dot(&d, &d))
                    .max(Radical::default()).min(Radical::from(q(1.)));
                rad::norm(&[&pexact[0] - &a[0] - &t * &d[0], &pexact[1] - &a[1] - &t * &d[1]])
            }
        }
    }
    /// Fold this piece into the running upper enclosure `acc` of the maximum of
    /// `coeff . (x, y)` over a chain: first the exact endpoint linear forms, then the
    /// carrier's interior extremum where the piece reaches it (rays along an end
    /// included). The fold order is part of the result (`Iv::max` rounds), so a
    /// chain is folded piece by piece in traversal order. A spline piece is
    /// refused `SplineArrangement`.
    pub fn support_fold(&self, coeff: [&Q; 2], acc: Option<Iv>) -> R<Option<Iv>> {
        rad::guard(|| self.support_fold_exact(coeff, acc))?
    }
    fn support_fold_exact(&self, coeff: [&Q; 2], acc: Option<Iv>) -> R<Option<Iv>> {
        let mut out = acc;
        for end in &self.ends {
            let v = end.linear_form(&Q::zero(), coeff)?;
            out = Some(out.map_or(v, |old| old.max(v)));
        }
        match &self.carrier {
            Carrier::Line => {}
            Carrier::BSpline(_) => return Err(Refusal::SplineArrangement),
            Carrier::Circle(c) => {
                let direction = [coeff[0].clone(), coeff[1].clone()];
                if self.angular(&direction, false) {
                    let centre = c.c.linear_form(&Q::zero(), coeff)?;
                    let reach = enclose(&(&c.r2 * dot(&direction, &direction)))?.sqrt();
                    let v = finite(centre + reach)?;
                    out = out.map(|old| old.max(v));
                }
            }
        }
        Ok(out)
    }
    /// The inward offset by `r`: a concentric arc of radius `R - r` (the piece
    /// must turn counter-clockwise and `r < R`) or a shifted line, with ends
    /// moved along the unit normals. Everything is rational or it refuses; the
    /// checks run in the order clockwise, irrational radius, curvature. The
    /// parallel curve of a spline is not a spline piece: refused `Spline`.
    pub fn inset(&self, r: &Q) -> Result<Inset, InsetRefusal> {
        let a = self.ends[0].rat().map_err(|_| InsetRefusal::Spline)?;
        let b = self.ends[1].rat().map_err(|_| InsetRefusal::Spline)?;
        let (carrier, na, nb) = match &self.carrier {
            Carrier::BSpline(_) => return Err(InsetRefusal::Spline),
            Carrier::Circle(c) => {
                if !c.ccw {
                    return Err(InsetRefusal::Clockwise);
                }
                let radius = crate::numeric::exact_root(&c.r2).ok_or(InsetRefusal::IrrationalRadius)?;
                let centre = c.c.rat().map_err(|_| InsetRefusal::IrrationalRadius)?;
                if *r >= radius {
                    return Err(InsetRefusal::Curvature);
                }
                let unit = |p: &P| {
                    let d = sub(p, centre);
                    [&d[0] / &radius, &d[1] / &radius]
                };
                let nr = &radius - r;
                let inner = Circle {
                    c: c.c.clone(),
                    r2: (&nr * &nr).into(),
                    ccw: c.ccw,
                    mid: ExactPoint::from_coordinates(std::array::from_fn(|k| Radical::from(centre[k].clone()) + &c.mid.difference(&c.c)[k] * &nr / &radius)).map_err(|_| InsetRefusal::IrrationalRadius)?,
                    angle: c.angle,
                    full: c.full,
                };
                (Carrier::Circle(inner), unit(a), unit(b))
            }
            Carrier::Line => {
                let d = sub(b, a);
                let length =
                    crate::numeric::exact_root(&dot(&d, &d)).ok_or(InsetRefusal::IrrationalRadius)?;
                if length.is_zero() {
                    return Err(InsetRefusal::ZeroLength);
                }
                let n = [&d[1] / &length, -&d[0] / &length];
                (Carrier::Line, n.clone(), n)
            }
        };
        let moved = |p: &P, n: &P| ExactPoint::from_rational(std::array::from_fn(|k| &p[k] - r * &n[k]));
        Ok(Inset { ends: [moved(a, &na), moved(b, &nb)], carrier, normals: [na, nb] })
    }
    /// The piece stays strictly outside the closed disc of centre `p` and
    /// squared radius `r2`. Decided in Q: an end inside refuses; on a circle
    /// the sector test then the radical condition `d^2 + R^2 - r2 > 0` and its
    /// square `> 4 d^2 R^2` (equivalent to `|d - R| > r`); on a line the
    /// clamped foot of the perpendicular. An end inside the disc decides `false`
    /// for any carrier; otherwise a spline piece is refused `SplineArrangement`.
    pub fn clears_disc(&self, p: &P, r2: &Q) -> R<bool> {
        rad::guard(|| self.clears_disc_exact(p, r2))?
    }
    fn clears_disc_exact(&self, p: &P, r2: &Q) -> R<bool> {
        if self.ends.iter().any(|e| {
            let d = e.difference_rational(p);
            rad::dot(&d, &d) <= Radical::from(r2.clone())
        }) {
            return Ok(false);
        }
        match &self.carrier {
            Carrier::Circle(c) => {
                let d = rad::sub(&rad::vector(p), &c.c.coordinates());
                if !c.angular_radical(&self.ends, &d, false) {
                    return Ok(true);
                }
                let d2 = rad::dot(&d, &d);
                let gap = &d2 + &Radical::from(&c.r2 - r2);
                let zero = Radical::default();
                Ok(gap > zero && &gap * &gap - d2 * &(q(4.) * &c.r2) > zero)
            }
            Carrier::Line => {
                let d = self.ends[1].difference(&self.ends[0]);
                let v = rad::sub(&rad::vector(p), &self.ends[0].coordinates());
                let t = (rad::dot(&v, &d) / rad::dot(&d, &d))
                    .max(Radical::from(q(0.))).min(Radical::from(q(1.)));
                let gap = [&v[0] - &t * &d[0], &v[1] - &t * &d[1]];
                Ok(rad::dot(&gap, &gap) > Radical::from(r2.clone()))
            }
            Carrier::BSpline(_) => Err(Refusal::SplineArrangement),
        }
    }
    /// Certified enclosure of the largest coordinate magnitude the carrier's
    /// parameters can reach (|cx| + |cy| + r on a circle); lines carry none. A
    /// spline piece is refused `SplineArrangement`.
    pub fn reach(&self) -> R<Option<Iv>> {
        rad::guard(|| self.reach_exact())?
    }
    fn reach_exact(&self) -> R<Option<Iv>> {
        match &self.carrier {
            Carrier::Line => Ok(None),
            Carrier::BSpline(_) => Err(Refusal::SplineArrangement),
            Carrier::Circle(c) => Ok(Some(
                c.c.enclosure()?[0].abs() + c.c.enclosure()?[1].abs() + enclose(&c.r2)?.sqrt(),
            )),
        }
    }
    /// Spans a deviation-bounded mesh needs for this piece under a uniform
    /// chart scale: one for a line, at least two for a curved piece, chosen so
    /// that the chord error radius * (angle / n)^2 / 8 stays within half the
    /// deviation. The result is not range-checked: the caller owns its budget.
    pub fn subdivisions(&self, scale: Iv, deviation: f64) -> R<f64> {
        rad::guard(|| self.subdivisions_exact(scale, deviation))?
    }
    fn subdivisions_exact(&self, scale: Iv, deviation: f64) -> R<f64> {
        match &self.carrier {
            Carrier::Line => Ok(1.),
            Carrier::BSpline(k) => {
                // Every span piece is cut into `n` equal parts (see `sample`);
                // the certified chord error times the chart scale stays within
                // half the deviation.
                let reach = scale.hi();
                if !(deviation > 0. && deviation.is_finite() && reach > 0. && reach.is_finite()) {
                    return Err(Refusal::SplineFlattenUncertified);
                }
                let allowed = q(deviation) / (q(2.) * q(reach));
                let (lo, hi) = k.range();
                let n = k.spline.flatten_count(lo, hi, &allowed)?.max(2);
                Ok((n * k.spline.pieces(lo, hi)?.len()) as f64)
            }
            Carrier::Circle(c) => {
                let radius = finite(enclose(&c.r2)?.sqrt() * scale)?.hi();
                let step = (4. * deviation / radius).sqrt();
                Ok((c.angle.abs().hi() / step).ceil().max(2.))
            }
        }
    }
    /// The point at `s / n` of the piece's parameter: equal turns on a circle,
    /// equal chord fractions on a line. `sin_cos` supplies the certified
    /// trigonometry of a TURN (a fraction of a full circle; it belongs to the mesh
    /// strand, not to this crate). The binary64 midpoints of `sample_enclosure`.
    pub fn sample<E: From<Refusal>>(
        &self,
        s: usize,
        n: usize,
        sin_cos: impl Fn(Iv) -> Result<(Iv, Iv), E>,
    ) -> Result<[f64; 2], E> {
        Ok(self.sample_enclosure(s, n, sin_cos)?.map(|v| v.mid()))
    }
    /// Certified enclosures of the exact point that `sample` rounds; a mesh
    /// bounds its sample rounding by their radii.
    pub fn sample_enclosure<E: From<Refusal>>(
        &self,
        s: usize,
        n: usize,
        sin_cos: impl Fn(Iv) -> Result<(Iv, Iv), E>,
    ) -> Result<[Iv; 2], E> {
        rad::guard(|| self.sample_enclosure_exact(s, n, sin_cos)).map_err(E::from)?
    }
    fn sample_enclosure_exact<E: From<Refusal>>(
        &self,
        s: usize,
        n: usize,
        sin_cos: impl Fn(Iv) -> Result<(Iv, Iv), E>,
    ) -> Result<[Iv; 2], E> {
        let i = Iv::point;
        match &self.carrier {
            Carrier::Circle(c) => {
                let tau = i(2.) * crate::numeric::pi();
                let u = self.ends[0].difference(&c.c);
                let turn = finite(c.angle / tau * i(s as f64) / i(n as f64))?;
                let (sin, cos) = sin_cos(turn)?;
                let (ux, uy) = (u[0].enclosure()?, u[1].enclosure()?);
                let (cx, cy) = (c.c.enclosure()?[0], c.c.enclosure()?[1]);
                Ok([
                    finite(cx + ux * cos - uy * sin)?,
                    finite(cy + ux * sin + uy * cos)?,
                ])
            }
            Carrier::BSpline(k) => {
                // Equal parameter fractions inside every span piece, so the
                // certified flatten bound of `subdivisions` holds; `n` must be a
                // multiple of the number of span pieces.
                let (lo, hi) = k.range();
                let pieces = k.spline.pieces(lo, hi)?;
                if n == 0 || s > n || n % pieces.len() != 0 {
                    return Err(Refusal::SplineFlattenUncertified.into());
                }
                let per = n / pieces.len();
                let u = if k.increasing() { s } else { n - s };
                let j = (u / per).min(pieces.len() - 1);
                let (span, a, b) = &pieces[j];
                let frac = Q::from_integer((u - j * per).into()) / Q::from_integer(per.into());
                let p = k.spline.spans()[*span].point_at(&(a + (b - a) * frac));
                Ok([enclose(&p[0])?, enclose(&p[1])?])
            }
            Carrier::Line => {
                let d = self.ends[1].enclosed_difference(&self.ends[0])?;
                let (o, t) = (self.ends[0].enclosure()?, i(s as f64) / i(n as f64));
                Ok([finite(o[0] + d[0] * t)?, finite(o[1] + d[1] * t)?])
            }
        }
    }
}

#[cfg(test)]
pub(crate) mod fixtures {
    use super::*;
    use crate::numeric::pt;

    /// Unit-radius-squared-`r2` circle about `c`, from exact ends `a` to `b`,
    /// counter-clockwise when `ccw`. The sweep angle is certified.
    pub fn arc(c: [f64; 2], r2: f64, a: [f64; 2], b: [f64; 2], ccw: bool) -> Trimmed {
        let (ap, bp) = (pt(a), pt(b));
        let cp = pt(c);
        let (u, v) = (sub(&ap, &cp), sub(&bp, &cp));
        let sine = if ccw { cross(&u, &v) } else { -cross(&u, &v) };
        let theta = positive_angle(&dot(&u, &v), &sine).unwrap();
        // Use an actual rational circle point, not the chord midpoint: trimmed
        // quadratic arcs retain this anchor for rational parametrization.
        let tangent = if ccw { [-&u[1], u[0].clone()] } else { [u[1].clone(), -&u[0]] };
        let chord = sub(&bp, &ap);
        let d = [&tangent[0] + &chord[0], &tangent[1] + &chord[1]];
        let t = -q(2.) * dot(&u, &d) / dot(&d, &d);
        let mid = [&ap[0] + &t * &d[0], &ap[1] + &t * &d[1]];
        let mid = if dot(&u, &u) == q(r2) && dot(&v, &v) == q(r2) { mid }
            else { [(&ap[0] + &bp[0]) / q(2.), (&ap[1] + &bp[1]) / q(2.)] };
        Trimmed::new(
            [ExactPoint::from_f64(a), ExactPoint::from_f64(b)],
            Carrier::Circle(Circle {
                c: ExactPoint::from_rational(cp),
                r2: q(r2).into(),
                ccw,
                mid: ExactPoint::from_rational(mid),
                angle: if ccw { theta } else { -theta },
                full: false,
            }),
        )
        .unwrap()
    }
    pub fn line(a: [f64; 2], b: [f64; 2]) -> Trimmed {
        Trimmed::line(a, b)
    }
    pub fn p(x: f64, y: f64) -> ExactPoint {
        ExactPoint::from_f64([x, y])
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::*;
    use super::*;
    use std::cmp::Ordering;

    #[test]
    fn circle_distance_certifies_a_one_ulp_radial_gap() {
        let a = fixtures::arc([0., 0.], 1., [1., 0.], [0., 1.], true);
        let p = ExactPoint::from_f64([0., 1_f64.next_up()]);
        let distance = a.distance(&p).unwrap();
        let exact = 1_f64.next_up() - 1.;
        assert!(distance.lo() > 0.);
        assert!(distance.lo() <= exact && distance.hi() >= exact);
        assert!(distance.hi() - distance.lo() < exact / 100.);
    }

    /// A rational line whose ends lie in two different quadratic fields (two
    /// strip rulings, boolean3d G12b): no midpoint class, but a certified
    /// rational interior point.
    #[test]
    fn exact_interior_point_between_two_quadratic_fields_is_rational() {
        let root = |r: i64| crate::radical::Radical::quadratic(q(0.), q(1.), q(r as f64)).unwrap();
        let a = ExactPoint::from_exact_coordinates([root(2), crate::radical::Radical::from(q(3.))]).unwrap();
        let b = ExactPoint::from_exact_coordinates([root(3) + crate::radical::Radical::from(q(1.)), crate::radical::Radical::from(q(3.))]).unwrap();
        let piece = Trimmed::new([a.clone(), b.clone()], Carrier::Line).unwrap();
        let m = piece.exact_interior_point().unwrap();
        assert!(matches!(m, ExactPoint::Rational(_)));
        assert!(piece.contains(&m).unwrap() && m != a && m != b);
        // The midpoint itself has no point class: the case this covers.
        assert_eq!(
            ExactPoint::from_exact_coordinates([(root(2) + root(3) + crate::radical::Radical::from(q(1.))) / q(2.), crate::radical::Radical::from(q(3.))]),
            Err(Refusal::CrossingNeedsAlgebraicVertex)
        );
    }

    #[test]
    fn reverse_is_an_involution_on_ends_sense_and_angle() {
        let a = arc([0., 0.], 1., [1., 0.], [0., 1.], true);
        let r = a.reversed();
        assert_eq!(r.ends()[0], p(0., 1.));
        let (Carrier::Circle(c), Carrier::Circle(d)) = (a.carrier(), r.carrier()) else { panic!() };
        assert!(c.ccw && !d.ccw);
        assert_eq!((c.angle.m, d.angle.m), (c.angle.m, -c.angle.m));
        let rr = r.reversed();
        assert_eq!(rr.ends(), a.ends());
        assert_eq!(rr.cache(), a.cache());
    }
    #[test]
    fn trim_recomputes_the_sweep_and_audits_the_caches() {
        let a = arc([0., 0.], 1., [1., 0.], [-1., 0.], true);
        let quarter = a.trim(p(1., 0.), p(0., 1.)).unwrap();
        let Carrier::Circle(c) = quarter.carrier() else { panic!() };
        assert!((c.angle.m - std::f64::consts::FRAC_PI_2).abs() < 1e-15);
        assert_eq!(quarter.cache(), &[[1., 0.], [0., 1.]]);
        let cw = a.reversed().trim(p(-1., 0.), p(0., 1.)).unwrap();
        let Carrier::Circle(c) = cw.carrier() else { panic!() };
        assert!((c.angle.m + std::f64::consts::FRAC_PI_2).abs() < 1e-15);
        let l = line([0., 0.], [4., 0.]).trim(p(1., 0.), p(3., 0.)).unwrap();
        assert_eq!(l.ends()[0], p(1., 0.));
    }
    #[test]
    fn canonical_orients_lines_by_end_order_and_arcs_counter_clockwise() {
        let l = line([3., 0.], [1., 0.]);
        let (c, forward) = l.canonical();
        assert!(!forward);
        assert_eq!(c.ends()[0], p(1., 0.));
        let a = arc([0., 0.], 1., [0., 1.], [1., 0.], false);
        let (c, forward) = a.canonical();
        assert!(!forward);
        let Carrier::Circle(k) = c.carrier() else { panic!() };
        assert!(k.ccw);
        assert_eq!(c.key(), a.reversed().key());
        assert_ne!(c.key(), line([1., 0.], [0., 1.]).key());
    }
    #[test]
    fn angular_membership_is_closed_or_open_at_the_ends() {
        let a = arc([0., 0.], 1., [1., 0.], [0., 1.], true);
        let v = |x: f64, y: f64| [q(x), q(y)];
        assert!(a.angular(&v(1., 1.), false));
        assert!(!a.angular(&v(-1., 1.), false));
        assert!(!a.angular(&v(1., -1.), false));
        // Along the ends: in when closed, out when strict.
        assert!(a.angular(&v(1., 0.), false) && !a.angular(&v(1., 0.), true));
        assert!(a.angular(&v(0., 2.), false) && !a.angular(&v(0., 2.), true));
        // The opposite ray is not on the sector.
        assert!(!a.angular(&v(-1., 0.), false));
        assert!(!a.angular(&v(0., 0.), false));
        // A clockwise piece covers the same sector by swapping its ends.
        assert!(arc([0., 0.], 1., [0., 1.], [1., 0.], false).angular(&v(1., 1.), false));
        // Reflex sector (three quarters).
        let big = arc([0., 0.], 1., [1., 0.], [0., -1.], true);
        assert!(big.angular(&v(-1., 0.), false) && !big.angular(&v(1., -1.), false));
        assert!(!line([0., 0.], [1., 0.]).angular(&v(1., 0.), false));
    }
    #[test]
    fn contains_is_closed_on_lines_and_arcs() {
        let l = line([0., 0.], [4., 2.]);
        assert!(l.contains(&p(0., 0.)).unwrap() && l.contains(&p(4., 2.)).unwrap() && l.contains(&p(2., 1.)).unwrap());
        assert!(!l.contains(&p(6., 3.)).unwrap() && !l.contains(&p(-2., -1.)).unwrap() && !l.contains(&p(2., 2.)).unwrap());
        let a = arc([0., 0.], 25., [5., 0.], [0., 5.], true);
        assert!(a.contains(&p(5., 0.)).unwrap() && a.contains(&p(0., 5.)).unwrap() && a.contains(&p(3., 4.)).unwrap());
        assert!(!a.contains(&p(-3., 4.)).unwrap() && !a.contains(&p(3., 3.)).unwrap());
    }
    #[test]
    fn a_disc_misses_a_line_by_its_exact_distance_to_the_segment() {
        let l = line([0., 0.], [4., 0.]);
        let at = |x: f64, y: f64| [q(x), q(y)];
        // Perpendicular foot inside the segment: distance is |y|.
        assert!(l.misses_disc(&at(2., 3.), &q(2.)).unwrap());
        assert!(!l.misses_disc(&at(2., 3.), &q(3.)).unwrap(), "tangent disc touches");
        assert!(!l.misses_disc(&at(2., 3.), &q(4.)).unwrap());
        // Foot beyond an end: distance is to the nearer end.
        assert!(l.misses_disc(&at(7., 4.), &q(4.)).unwrap());
        assert!(!l.misses_disc(&at(7., 4.), &q(5.)).unwrap(), "reaches the end exactly");
        assert!(!l.misses_disc(&at(2., 0.), &q(0.)).unwrap(), "centre on the piece");
        assert!(l.misses_disc(&at(-1., 0.), &q(0.)).unwrap());
    }
    #[test]
    fn a_disc_misses_an_arc_inside_or_outside_and_by_its_ends_off_the_sector() {
        // Quarter of the radius-5 circle in the first quadrant.
        let a = arc([0., 0.], 25., [5., 0.], [0., 5.], true);
        let at = |x: f64, y: f64| [q(x), q(y)];
        // Centre on the sector: the gap to the circle is |d - 5|, outside or inside.
        assert!(a.misses_disc(&at(6., 6.), &q(3.)).unwrap());
        assert!(!a.misses_disc(&at(6., 6.), &q(4.)).unwrap());
        assert!(a.misses_disc(&at(1., 1.), &q(3.)).unwrap());
        assert!(!a.misses_disc(&at(3., 3.), &q(2.)).unwrap());
        // The circle's own centre is off every sector: only the ends count.
        assert!(a.misses_disc(&at(0., 0.), &q(4.)).unwrap());
        assert!(!a.misses_disc(&at(0., 0.), &q(5.)).unwrap(), "the disc reaches both ends");
        // Centre off the sector (third quadrant): only the ends count.
        assert!(a.misses_disc(&at(-5., -5.), &q(6.)).unwrap());
        assert!(!a.misses_disc(&at(-5., -5.), &q(12.)).unwrap());
        // Off the sector next to one end: that end alone decides, although the
        // disc reaches the full circle (gap sqrt(45) - 5 < 3) off the arc.
        assert!(a.misses_disc(&at(6., -3.), &q(3.)).unwrap());
        assert!(!a.misses_disc(&at(6., -3.), &q(4.)).unwrap(), "reaches the start end only");
        assert!(!a.misses_disc(&at(-3., 6.), &q(4.)).unwrap(), "reaches the finish end only");
        assert!(!a.misses_disc(&at(5., 0.), &q(0.)).unwrap(), "centre on an end");
    }
    #[test]
    fn coincidence_compares_supporting_curves_not_trims() {
        let a = arc([0., 0.], 1., [1., 0.], [0., 1.], true);
        let b = arc([0., 0.], 1., [-1., 0.], [0., -1.], true);
        assert!(a.coincident_with(&b).unwrap());
        assert!(!a.coincident_with(&arc([0., 0.], 4., [2., 0.], [0., 2.], true)).unwrap());
        assert!(line([0., 0.], [1., 1.]).coincident_with(&line([2., 2.], [5., 5.])).unwrap());
        assert!(!line([0., 0.], [1., 1.]).coincident_with(&line([0., 1.], [1., 2.])).unwrap());
        assert!(!line([0., 0.], [1., 1.]).coincident_with(&a).unwrap());
        assert!(!a.coincident_with(&line([0., 0.], [1., 1.])).unwrap());
    }
    #[test]
    fn sorted_cuts_follow_the_piece_from_its_first_end() {
        let l = line([4., 0.], [0., 0.]);
        let cuts = l.sorted_cuts(vec![p(0., 0.), p(3., 0.), p(1., 0.), p(3., 0.), p(4., 0.)]).unwrap();
        assert_eq!(cuts, vec![p(4., 0.), p(3., 0.), p(1., 0.), p(0., 0.)]);
        let a = arc([0., 0.], 1., [1., 0.], [-1., 0.], true);
        let cuts = a.sorted_cuts(vec![p(-1., 0.), p(0., 1.), p(1., 0.)]).unwrap();
        assert_eq!(cuts, vec![p(1., 0.), p(0., 1.), p(-1., 0.)]);
        // Clockwise from (1,0) the order is reversed around the circle.
        let cw = arc([0., 0.], 1., [1., 0.], [-1., 0.], false);
        let cuts = cw.sorted_cuts(vec![p(-1., 0.), p(0., -1.), p(1., 0.)]).unwrap();
        assert_eq!(cuts, vec![p(1., 0.), p(0., -1.), p(-1., 0.)]);
    }
    #[test]
    fn tangent_points_along_the_piece_or_back_into_it() {
        let a = arc([0., 0.], 1., [1., 0.], [0., 1.], true);
        assert_eq!(a.tangent(true).0, [q(0.), q(1.)]);
        assert_eq!(a.tangent(false).0, [q(1.), q(0.)]);
        let cw = a.reversed();
        assert_eq!(cw.tangent(true).0, [q(1.), q(0.)]);
        let l = line([0., 0.], [2., 3.]);
        assert_eq!(l.tangent(true).0, [q(2.), q(3.)]);
        assert_eq!(l.tangent(false).0, [q(-2.), q(-3.)]);
    }
    fn ring(seam: [f64; 2], ccw: bool) -> Trimmed {
        Trimmed::ring([q(0.), q(0.)], q(25.), ExactPoint::from_f64(seam), ccw).unwrap()
    }
    #[test]
    fn ring_seam_off_the_circle_is_refused() {
        let off = Trimmed::ring([q(0.), q(0.)], q(25.), p(1., 1.), true);
        assert_eq!(off.err().map(|r| r.name()), Some("prism-stack/ring-seam-off-circle"));
    }
    #[test]
    fn quadratic_ring_seam_uses_a_rational_anchor_without_a_radius_root() {
        let c=crate::numeric::pt([0.,0.]);
        let seam=ExactPoint::from_coordinates([Radical::quadratic(q(0.),q(1.),q(2.)).unwrap(),Radical::default()]).unwrap();
        let plain=Trimmed::ring(c.clone(),q(2.),seam.clone(),true).unwrap();
        let Carrier::Circle(antipodal)=plain.carrier() else{panic!("expected analytic circle")};
        assert!(antipodal.mid.rat().is_err());
        let anchor=crate::numeric::pt([1.,1.]);
        let ring=Trimmed::ring_with_anchor(c.clone(),q(2.),seam.clone(),true,anchor.clone()).unwrap();
        assert!(ring.is_ring());assert!(ring.contains(&seam).unwrap());
        let Carrier::Circle(circle)=ring.carrier() else{panic!("expected analytic circle")};
        assert_eq!(circle.mid,ExactPoint::from_rational(anchor.clone()));
        let end=ExactPoint::from_rational(anchor);
        let arc=ring.trim(seam.clone(),end.clone()).unwrap();
        assert!(arc.contains(&seam).unwrap());assert!(arc.contains(&end).unwrap());
        assert_eq!(Trimmed::ring_with_anchor(c,q(2.),seam,true,crate::numeric::pt([1.,0.])).unwrap_err(),Refusal::RingSeamOffCircle);
    }

    #[test]
    fn ring_is_a_full_turn_anchored_at_its_seam() {
        let r = ring([5., 0.], true);
        assert!(r.is_ring());
        assert!(r.cut_seed().is_empty());
        assert_eq!(r.interior_point().unwrap(), p(-5., 0.));
        assert!(r.contains(&p(0., 5.)).unwrap() && r.contains(&p(5., 0.)).unwrap() && !r.contains(&p(3., 3.)).unwrap());
        // The full-turn angle is 2 pi, counter-clockwise or clockwise.
        let Carrier::Circle(c) = r.carrier() else { panic!() };
        assert!((c.angle.m - std::f64::consts::TAU).abs() < 1e-12);
        let Carrier::Circle(rc) = r.reversed().carrier().clone() else { panic!() };
        assert!((rc.angle.m + std::f64::consts::TAU).abs() < 1e-12 && rc.full);
    }
    #[test]
    fn ring_key_ignores_the_seam_and_leaves_the_sense_to_canonical() {
        assert_eq!(ring([5., 0.], true).key(), ring([0., 5.], true).key());
        // Like every piece, a ring is keyed after `canonical` (counter-clockwise).
        assert_eq!(ring([5., 0.], true).key(), ring([5., 0.], false).canonical().0.key());
        assert_ne!(ring([5., 0.], true).key(), Trimmed::ring([q(0.), q(0.)], q(9.), p(3., 0.), true).unwrap().key());
    }
    #[test]
    fn ring_split_uncut_one_cut_and_many_cuts() {
        let r = ring([5., 0.], true);
        let uncut = r.split(vec![]).unwrap();
        assert_eq!(uncut.len(), 1);
        assert!(uncut[0].is_ring() && uncut[0].ends()[0] == p(5., 0.));
        // One crossing: one full turn seamed at the crossing.
        let one = r.split(vec![p(0., 5.)]).unwrap();
        assert_eq!(one.len(), 1);
        assert!(one[0].is_ring() && one[0].ends()[0] == p(0., 5.) && one[0].ends()[1] == p(0., 5.));
        assert_eq!(one[0].key(), r.key());
        // Two crossings: two arcs, together a full turn, in ring order.
        let two = r.split(vec![p(0., 5.), p(0., -5.)]).unwrap();
        assert_eq!(two.len(), 2);
        assert!(two.iter().all(|a| !a.is_ring()));
        assert_eq!((two[0].ends()[0].clone(), two[0].ends()[1].clone()), (p(0., 5.), p(0., -5.)));
        assert_eq!((two[1].ends()[0].clone(), two[1].ends()[1].clone()), (p(0., -5.), p(0., 5.)));
        for a in &two {
            let Carrier::Circle(c) = a.carrier() else { panic!() };
            assert!(!c.full && (c.angle.m - std::f64::consts::PI).abs() < 1e-12);
        }
        // Three cuts, one of them the seam: three arcs wrapping through the seam.
        let three = r.split(vec![p(5., 0.), p(0., 5.), p(0., -5.)]).unwrap();
        assert_eq!(three.len(), 3);
        assert_eq!(three[2].ends()[1], p(5., 0.));
    }
    #[test]
    fn ring_winding_counts_a_full_turn_once() {
        let r = ring([5., 0.], true);
        // Inside, outside, and a point at the seam height on both sides.
        assert_eq!(r.winding(&p(0., 0.)).unwrap() - r.winding(&p(9., 0.)).unwrap(), 1);
        let cw = ring([5., 0.], false);
        assert_eq!(cw.winding(&p(0., 0.)).unwrap() - cw.winding(&p(9., 0.)).unwrap(), -1);
        let re = ring([0., -5.], true);
        assert_eq!(re.winding(&p(0., 0.)).unwrap(), r.winding(&p(0., 0.)).unwrap());
    }
    #[test]
    fn interior_point_lies_strictly_inside_lines_and_arcs() {
        let l = line([0., 0.], [3., 1.]);
        assert_eq!(l.interior_point().unwrap().rat().unwrap()[0], Q::new(3.into(), 2.into()));
        for (ccw, a, b) in [(true, [5., 0.], [0., 5.]), (false, [0., 5.], [5., 0.]), (true, [3., 4.], [4., -3.])] {
            let s = arc([0., 0.], 25., a, b, ccw);
            let w = s.interior_point().unwrap();
            assert!(s.contains(&w).unwrap());
            assert!(w != s.ends()[0] && w != s.ends()[1]);
            let v = sub(w.rat().unwrap(), &[q(0.), q(0.)]);
            assert!(s.angular(&v, true));
        }
    }
    #[test]
    fn refinement_proposals_are_exact_members_and_bad_angle_caches_fall_back() {
        for ccw in [true,false] {
            let mut s=if ccw {arc([0.,0.],25.,[5.,0.],[0.,5.],true)} else {arc([0.,0.],25.,[0.,5.],[5.,0.],false)};
            for _ in 0..8 {
                let mid=s.refinement_point().unwrap();
                assert!(s.contains(&mid).unwrap());
                assert!(!s.ends().contains(&mid));
                assert_eq!(dot(mid.rat().unwrap(),mid.rat().unwrap()),q(25.));
                s=s.trim(s.ends()[0].clone(),mid).unwrap();
            }
            if let Carrier::Circle(c)=&mut s.carrier {c.angle=Iv::point(f64::NAN);}
            let mid=s.refinement_point().unwrap();
            assert!(s.contains(&mid).unwrap() && !s.ends().contains(&mid));
        }
    }
    #[test]
    fn refinement_propagates_non_rational_endpoint_refusal() {
        let source = arc([0.,0.],25.,[5.,0.],[0.,5.],true);
        let split = ExactPoint::from_quadratic(
            [q(0.),q(0.)], [q(1.),q(1.)], q(12.5)).unwrap();
        assert!(source.contains(&split).unwrap());
        let trimmed = source.trim(split,source.ends()[1].clone()).unwrap();
        assert_eq!(trimmed.refinement_point().unwrap_err(), Refusal::CrossingNeedsAlgebraicVertex);
    }
    #[test]
    fn length_and_segment_area_of_a_quarter_circle() {
        let a = arc([0., 0.], 4., [2., 0.], [0., 2.], true);
        let len = a.length().unwrap();
        assert!((len.m - std::f64::consts::PI).abs() <= len.r + 1e-15);
        let seg = a.segment_area().unwrap();
        // r^2 (theta - sin theta) / 2 = 2 (pi/2 - 1)
        let want = 2. * (std::f64::consts::FRAC_PI_2 - 1.);
        assert!((seg.m - want).abs() <= seg.r + 1e-14);
        assert_eq!(line([0., 0.], [3., 4.]).length().unwrap().m, 5.);
        assert_eq!(line([0., 0.], [3., 4.]).segment_area().unwrap().m, 0.);
        // The clockwise traversal has the opposite signed segment area.
        let back = a.reversed().segment_area().unwrap();
        assert!((back.m + seg.m).abs() <= back.r + seg.r);
    }
    #[test]
    fn segment_area_taylor_and_direct_branches_agree_at_the_switch() {
        // theta just below and above 0.5 rad on the same circle.
        let r2 = 1.;
        let (s, c) = (0.49f64.sin(), 0.49f64.cos());
        let below = arc([0., 0.], r2, [1., 0.], [c, s], true).segment_area().unwrap();
        let want = (0.49 - 0.49f64.sin()) / 2.;
        assert!((below.m - want).abs() < 1e-9, "{below:?} vs {want}");
        let (s, c) = (0.51f64.sin(), 0.51f64.cos());
        let above = arc([0., 0.], r2, [1., 0.], [c, s], true).segment_area().unwrap();
        let want = (0.51 - 0.51f64.sin()) / 2.;
        assert!((above.m - want).abs() < 1e-9, "{above:?} vs {want}");
    }
    #[test]
    fn bounds_include_only_the_extremes_the_piece_reaches() {
        let a = arc([0., 0.], 25., [3., 4.], [-4., 3.], true); // over the top
        let b = a.bounds().unwrap();
        assert!(b[1][1] >= 5. && b[0][0] <= -4. && b[1][0] >= 3.);
        assert!(b[0][1] <= 3. && b[0][1] > 2.9);
        let flat = line([1., 2.], [-1., 5.]).bounds().unwrap();
        assert_eq!(flat, [[-1., 2.], [1., 5.]]);
    }
    #[test]
    fn extrema_report_reach_in_the_form_direction_and_its_opposite() {
        let a = arc([0., 0.], 25., [3., 4.], [-4., 3.], true);
        let x = a.extrema(&q(10.), [&q(0.), &q(1.)]).unwrap(); // form 10 + y
        assert!(x.hi.unwrap() >= 15.);
        assert!(x.lo.is_none());
        let y = a.extrema(&q(0.), [&q(1.), &q(0.)]).unwrap(); // form x
        assert!(y.hi.is_none() && y.lo.is_none());
        let z = a.extrema(&q(0.), [&q(-1.), &q(0.)]).unwrap();
        assert!(z.hi.is_none());
        assert_eq!(line([0., 0.], [1., 1.]).extrema(&q(0.), [&q(1.), &q(0.)]).unwrap(), Extrema { hi: None, lo: None });
    }
    #[test]
    fn extent_reports_radius_centre_magnitude_and_rounding() {
        let a = arc([7., -9.], 4., [9., -9.], [7., -7.], true);
        let e = a.extent().unwrap();
        assert!(e.magnitude >= 9. && e.magnitude < 9.001);
        assert_eq!(e.rounding, 0.);
        assert_eq!(line([0., 0.], [1., 1.]).extent().unwrap(), Extent { magnitude: 0., rounding: 0. });
        let third = Q::new(1.into(), 3.into());
        let off = Trimmed::new(
            [p(1., 0.), p(0., 1.)],
            Carrier::Circle(Circle { c: ExactPoint::from_rational([third.clone(), q(0.)]), r2: q(1.).into(), ccw: true, mid: ExactPoint::from_f64([0., 0.]), angle: Iv::point(1.), full: false }),
        )
        .unwrap();
        assert!(off.extent().unwrap().rounding > 0.);
    }
    #[test]
    fn subdivisions_are_one_for_lines_and_bounded_below_by_two_for_arcs() {
        let one = Iv::point(1.);
        assert_eq!(line([0., 0.], [4., 2.]).subdivisions(one, 0.01).unwrap(), 1.);
        // Quarter unit arc: step = sqrt(4 * 0.01) = 0.2, so ceil(1.5708 / 0.2) = 8.
        let quarter = arc([0., 0.], 1., [1., 0.], [0., 1.], true);
        assert_eq!(quarter.subdivisions(one, 0.01).unwrap(), 8.);
        // A chart scale of 100 is a radius of 100: the step shrinks tenfold, 1.5708 / 0.02 -> 79.
        assert_eq!(quarter.subdivisions(Iv::point(100.), 0.01).unwrap(), 79.);
        // A coarse budget still cuts a curved piece in two, in either sense.
        assert_eq!(quarter.subdivisions(one, 10.).unwrap(), 2.);
        assert_eq!(quarter.reversed().subdivisions(one, 0.01).unwrap(), 8.);
    }
    #[test]
    fn source_arc_keeps_the_nonzero_cross_hidden_by_its_centre_cache() {
        let arc = Trimmed::arc_through([0., 1.], [1.0000000000000002, 2.], [2., 1.]).unwrap();
        let Carrier::Circle(c) = arc.carrier() else { panic!("circle required") };
        let centre = c.c.rat().unwrap();
        assert_eq!(centre[0], q(1.));
        assert_eq!(centre[1], q(1.) + Q::new(1.into(), num_bigint::BigInt::from(1) << 105));
        let a = sub(arc.ends()[0].rat().unwrap(), centre);
        let b = sub(arc.ends()[1].rat().unwrap(), centre);
        assert!(!cross(&a, &b).is_zero());
        let cached = centre.clone().map(|x| enclose(&x).unwrap().mid());
        assert_eq!(cached, [1., 1.]);
        assert!(cross(&sub(arc.ends()[0].rat().unwrap(), &cached.map(q)),
                      &sub(arc.ends()[1].rat().unwrap(), &cached.map(q))).is_zero());
    }
    #[test]
    fn sample_walks_equal_turns_on_circles_and_equal_fractions_on_lines() {
        // sin_cos takes turns (a fraction of tau), like the mesh strand's certified one.
        let trig = |t: Iv| -> Result<(Iv, Iv), Refusal> {
            let a = t.m * std::f64::consts::TAU;
            Ok((Iv::point(a.sin()), Iv::point(a.cos())))
        };
        let a = arc([0., 0.], 1., [1., 0.], [-1., 0.], true);
        let h = a.sample(1, 2, trig).unwrap();
        assert!(h[0].abs() < 1e-15 && (h[1] - 1.).abs() < 1e-15);
        let clockwise = a.reversed().sample(1, 2, trig).unwrap();
        assert!(clockwise[0].abs() < 1e-15 && (clockwise[1] - 1.).abs() < 1e-15);
        let quarter = arc([0., 0.], 1., [1., 0.], [0., 1.], true);
        let forward = quarter.sample(1, 4, trig).unwrap();
        let backward = quarter.reversed().sample(3, 4, trig).unwrap();
        for k in 0..2 { assert!((forward[k] - backward[k]).abs() < 1e-15); }
        // Reversing traversal must sample the same semicircle, not its complement.
        for piece in [a.clone(), a.reversed()] {
            let h = piece.sample(1, 2, trig).unwrap();
            assert!(h[0].abs() < 1e-15 && (h[1] - 1.).abs() < 1e-15);
        }
        let clockwise = Trimmed::arc_through([5., 0.], [3., -4.], [0., -5.]).unwrap();
        let h = clockwise.sample(1, 2, trig).unwrap();
        let coordinate = 5. / 2_f64.sqrt();
        assert!((h[0] - coordinate).abs() < 1e-14 && (h[1] + coordinate).abs() < 1e-14);

        let l = line([0., 0.], [4., 2.]).sample(1, 4, trig).unwrap();
        assert_eq!(l, [1., 0.5]);
    }
    #[test]
    fn mapped_applies_the_isometry_and_keeps_orientation_when_not_mirroring() {
        let m = PlaneMap::isometry([q(10.), q(0.)], [q(0.), q(1.)], [q(-1.), q(0.)]).unwrap(); // rotate 90 deg, shift
        assert!(!m.mirrors());
        // A mapped circle keeps its r2, so a scaling or shearing map is never a PlaneMap.
        assert!(PlaneMap::isometry([q(0.), q(0.)], [q(2.), q(0.)], [q(0.), q(2.)]).is_none());
        assert!(PlaneMap::isometry([q(0.), q(0.)], [q(1.), q(0.)], [q(0.5), q(1.)]).is_none());
        // Exact rational rotation (3/5, 4/5) is admitted.
        let r = Q::new(3.into(), 5.into());
        let s = Q::new(4.into(), 5.into());
        assert!(PlaneMap::isometry([q(0.), q(0.)], [r.clone(), s.clone()], [-s, r]).is_some());
        let a = arc([0., 0.], 1., [1., 0.], [0., 1.], true).mapped(&m).unwrap();
        assert_eq!(a.ends(), &[p(10., 1.), p(9., 0.)]);
        let Carrier::Circle(c) = a.carrier() else { panic!() };
        assert!(c.ccw && c.c.rat().unwrap() == &[q(10.), q(0.)]);
        // The mapped piece still contains its own witness point.
        assert!(a.contains(&a.interior_point().unwrap()).unwrap());
    }
    #[test]
    fn mapped_under_a_mirror_flips_the_sense_of_the_piece() {
        let m = PlaneMap::isometry([q(0.), q(0.)], [q(-1.), q(0.)], [q(0.), q(1.)]).unwrap();
        assert!(m.mirrors());
        let a = arc([0., 0.], 1., [1., 0.], [0., 1.], true).mapped(&m).unwrap();
        let Carrier::Circle(c) = a.carrier() else { panic!() };
        assert!(!c.ccw && c.angle.m < 0.);
        assert_eq!(a.ends(), &[p(-1., 0.), p(0., 1.)]);
        // Reversing restores the counter-clockwise sense for the mirrored cycle.
        let Carrier::Circle(c) = a.reversed().carrier().clone() else { panic!() };
        assert!(c.ccw && c.angle.m > 0.);
    }
    fn near(x: Iv, want: f64) {
        assert!(x.lo() <= want + 1e-12 && x.hi() >= want - 1e-12, "{x:?} vs {want}");
    }
    fn circle_of(t: &Trimmed) -> Circle {
        let Carrier::Circle(c) = t.carrier().clone() else { panic!("not a circle") };
        c
    }
    #[test]
    fn arc_through_finds_the_exact_circle_and_sense_or_refuses_collinear() {
        let a = Trimmed::arc_through([2., 0.], [0., 2.], [-2., 0.]).unwrap();
        let c = circle_of(&a);
        assert!(c.ccw && c.c.rat().unwrap() == &[q(0.), q(0.)] && c.r2 == q(4.) && c.mid == ExactPoint::from_f64([0., 2.]));
        assert_eq!(a.cache(), &[[2., 0.], [-2., 0.]]);
        assert!(!a.is_split());
        let cw = circle_of(&Trimmed::arc_through([2., 0.], [0., -2.], [-2., 0.]).unwrap());
        assert!(!cw.ccw && cw.angle.m < 0.);
        assert_eq!(
            Trimmed::arc_through([0., 0.], [1., 1.], [2., 2.]).unwrap_err(),
            Refusal::CollinearThreePointArc
        );
    }
    #[test]
    fn curved_and_split_report_the_carrier_and_the_cache_gap() {
        assert!(!line([0., 0.], [1., 0.]).is_curved());
        assert!(arc([0., 0.], 1., [1., 0.], [0., 1.], true).is_curved());
        assert!(!line([0., 0.], [1., 0.]).is_split());
        let third = Q::new(1.into(), 3.into());
        let split = Trimmed::with_cache(
            [ExactPoint::from_rational([third, q(0.)]), p(1., 0.)],
            [[1. / 3., 0.], [1., 0.]],
            Carrier::Line,
        );
        assert!(split.is_split());
        assert!(split.reversed().is_split(), "reversal keeps the cache gap");
    }
    #[test]
    fn normal_at_is_the_radius_or_the_turned_chord() {
        let a = arc([1., 1.], 1., [2., 1.], [1., 2.], true);
        assert_eq!(a.normal_at(&p(2., 1.)).unwrap().ccw_cmp(&Direction(rad::vector(&pt([1., 0.])))), Ordering::Equal);
        assert_eq!(a.normal_at(&p(1., 2.)).unwrap().ccw_cmp(&Direction(rad::vector(&pt([0., 1.])))), Ordering::Equal);
        let l = line([0., 0.], [2., 0.]);
        assert_eq!(l.normal_at(&p(1., 0.)).unwrap().ccw_cmp(&Direction(rad::vector(&pt([0., 1.])))), Ordering::Equal);
        assert!(l.reversed().normal_at(&p(1., 0.)).unwrap().parallel(&Direction(rad::vector(&pt([0., 1.])))));
        assert_eq!(l.reversed().normal_at(&p(1., 0.)).unwrap().ccw_cmp(&Direction(rad::vector(&pt([0., 1.])))), Ordering::Greater);
    }
    #[test]
    fn refitted_is_the_circle_tangent_to_the_given_normal_through_both_ends() {
        let a = Trimmed::arc_through([5., 0.], [3., 4.], [0., 5.]).unwrap();
        let at = p(5., 0.);
        let n = Direction(rad::vector(&pt([2., -1.])));
        let r = a.refitted(&at, &n).unwrap().expect("refits");
        let c = circle_of(&r);
        let third = |num: i64, den: i64| Q::new(num.into(), den.into());
        assert_eq!(c.c.rat().unwrap(), &[third(5, 3), third(5, 3)]);
        assert_eq!(c.r2, third(125, 9));
        assert_eq!(c.mid, ExactPoint::from_rational([third(7, 3), third(16, 3)]));
        assert!(c.ccw && r.ends() == a.ends() && r.cache() == a.cache());
        assert!(r.normal_at(&at).unwrap().parallel(&n));
        // A chord perpendicular to the normal, and a line, have no refit.
        assert!(a.refitted(&at, &Direction(rad::vector(&pt([1., 1.])))).unwrap().is_none());
        assert!(line([0., 0.], [1., 0.]).refitted(&p(0., 0.), &n).unwrap().is_none());
    }
    #[test]
    fn centre_distance_and_retrace_compare_carriers_of_the_same_kind() {
        let a = arc([0., 0.], 4., [2., 0.], [0., 2.], true);
        let b = arc([3., -4.], 4., [5., -4.], [3., -2.], true);
        assert_eq!(a.centre_l1_distance(&b), Some(q(7.)));
        assert_eq!(a.centre_l1_distance(&line([0., 0.], [1., 0.])), None);
        assert_eq!(line([0., 0.], [1., 0.]).centre_l1_distance(&a), None);
        assert_eq!(line([0., 0.], [1., 0.]).centre_l1_distance(&line([0., 0.], [1., 1.])), None);
        assert!(a.retraces(&a.reversed()).unwrap() && a.reversed().retraces(&a).unwrap());
        assert!(!a.retraces(&a).unwrap(), "same traversal is not a retrace");
        let l = line([0., 0.], [1., 1.]);
        assert!(l.retraces(&l.reversed()).unwrap() && !l.retraces(&l).unwrap());
        assert!(!l.retraces(&arc([0., 0.], 1., [0., 0.], [1., 1.], true)).unwrap());
        // Same ends swapped on a different circle, and swapped ends of the same sense.
        let other = arc([2., 2.], 4., [0., 2.], [2., 0.], false);
        assert!(!a.retraces(&other).unwrap());
        let long = arc([0., 0.], 4., [0., 2.], [2., 0.], true);
        assert!(!a.retraces(&long).unwrap());
    }
    #[test]
    fn frame_reads_the_cache_when_unsplit_and_the_exact_end_when_split() {
        let f = line([0., 0.], [3., 0.]).frame().unwrap();
        assert_eq!((f.tangent, f.arc), ([1., 0.], None));
        let f = arc([0., 0.], 1., [1., 0.], [0., 1.], true).frame().unwrap();
        assert!((f.tangent[0] + std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-15);
        assert!((f.tangent[1] - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-15);
        let a = f.arc.unwrap();
        assert!(a.ccw && a.centre == [0., 0.] && a.radius == 1. && a.radial == [1., 0.]);
        assert!((a.turn - 0.25).abs() < 1e-15);
        // A piece whose cache disagrees with its exact ends: only a split piece follows the exact end.
        let lie = Trimmed::with_cache([p(0., 0.), p(3., 0.)], [[0., 0.], [3., 4.]], Carrier::Line);
        assert!(lie.is_split());
        assert_eq!(lie.frame().unwrap().tangent, [1., 0.]);
        let honest = Trimmed::with_cache([p(0., 0.), p(3., 4.)], [[0., 0.], [3., 4.]], Carrier::Line);
        assert_eq!(honest.frame().unwrap().tangent, [0.6, 0.8]);
        assert_eq!(line([1., 1.], [1., 1.]).frame().unwrap_err(), Refusal::EdgeLengthRange);
    }
    #[test]
    fn distance_is_to_the_carrier_inside_the_sector_and_to_an_end_outside() {
        let l = line([0., 0.], [4., 0.]);
        near(l.distance(&p(2., 3.)).unwrap(), 3.);
        near(l.distance(&p(7., 4.)).unwrap(), 5.);
        near(l.distance(&p(-3., 4.)).unwrap(), 5.);
        let a = arc([0., 0.], 4., [2., 0.], [0., 2.], true);
        near(a.distance(&p(3., 0.)).unwrap(), 1.);
        near(a.distance(&p(1., 1.)).unwrap(), 2. - 2f64.sqrt());
        near(a.distance(&p(-3., 0.)).unwrap(), 13f64.sqrt());
    }
    #[test]
    fn reach_is_the_carrier_magnitude_and_lines_have_none() {
        assert!(line([0., 0.], [4., 0.]).reach().unwrap().is_none());
        let a = arc([3., -4.], 25., [8., -4.], [3., 1.], true);
        near(a.reach().unwrap().unwrap(), 12.);
    }
    #[test]
    fn support_fold_preserves_quadratic_coordinate_cancellation() {
        let eps = Q::new(1.into(), q(2.).numer().pow(220));
        let end = ExactPoint::from_quadratic(
            [eps.clone(), q(0.)], [q(1.), q(1.)], q(2.)).unwrap();
        let cache = end.cache().unwrap();
        assert_eq!(cache[0], cache[1], "the cache loses the exact x-y gap");
        let piece = Trimmed::new([p(0., 0.), end], Carrier::Line).unwrap();
        for piece in [piece.clone(), piece.reversed()] {
            let support = piece.support_fold([&q(1.), &q(-1.)], None).unwrap().unwrap();
            assert!(q(support.lo()) <= eps && eps <= q(support.hi()), "{support:?}");
            assert!(support.lo() > 0., "the exact positive support must survive cancellation");
        }
    }
    #[test]
    fn support_fold_takes_ends_then_the_interior_extremum_in_order() {
        let one = q(1.);
        let l = line([0., 0.], [2., 0.]);
        near(l.support_fold([&one, &q(0.)], None).unwrap().unwrap(), 2.);
        near(l.support_fold([&one, &q(0.)], Some(Iv::point(5.))).unwrap().unwrap(), 5.);
        let a = arc([0., 0.], 4., [2., 0.], [0., 2.], true);
        let up = a.support_fold([&one, &one], None).unwrap().unwrap();
        near(up, 8f64.sqrt());
        assert!(up.hi() < 2.9);
        // The direction (-1,-1) points away from the sector: only the ends count.
        let minus = q(-1.);
        near(a.support_fold([&minus, &minus], None).unwrap().unwrap(), -2.);
    }
    #[test]
    fn inset_moves_a_line_and_a_ccw_arc_inward_with_exact_normals() {
        let i = line([0., 0.], [4., 0.]).inset(&q(1.)).unwrap();
        assert_eq!(i.ends, [p(0., 1.), p(4., 1.)]);
        assert!(matches!(i.carrier, Carrier::Line));
        assert_eq!(i.normals, [pt([0., -1.]), pt([0., -1.])]);
        let half = Q::new(1.into(), 2.into());
        let i = arc([0., 0.], 4., [2., 0.], [0., 2.], true).inset(&half).unwrap();
        assert_eq!(i.ends, [ExactPoint::from_rational([q(1.5), q(0.)]), ExactPoint::from_rational([q(0.), q(1.5)])]);
        assert_eq!(i.normals, [pt([1., 0.]), pt([0., 1.])]);
        let c = match i.carrier { Carrier::Circle(c) => c, Carrier::Line | Carrier::BSpline(_) => panic!() };
        let (centre, mid) = (c.c.rat().unwrap(), c.mid.rat().unwrap());
        assert!(c.ccw && centre == &[q(0.), q(0.)] && c.r2 == q(2.25));
        assert_eq!(c.mid, ExactPoint::from_rational([Q::new(9.into(), 10.into()), Q::new(6.into(), 5.into())]));
        assert_eq!(dot(&sub(mid, centre), &sub(mid, centre)), c.r2);
    }
    #[test]
    fn inset_refuses_by_kind_in_the_documented_order() {
        let ccw = arc([0., 0.], 4., [2., 0.], [0., 2.], true);
        let cw = arc([0., 0.], 4., [2., 0.], [0., 2.], false);
        let irrational = arc([0., 0.], 2., [1., 1.], [-1., 1.], true);
        assert_eq!(cw.inset(&q(1.)).unwrap_err(), InsetRefusal::Clockwise);
        assert_eq!(cw.inset(&q(5.)).unwrap_err(), InsetRefusal::Clockwise, "sense before curvature");
        assert_eq!(irrational.inset(&q(1.)).unwrap_err(), InsetRefusal::IrrationalRadius);
        assert_eq!(irrational.inset(&q(5.)).unwrap_err(), InsetRefusal::IrrationalRadius, "root before curvature");
        assert_eq!(ccw.inset(&q(2.)).unwrap_err(), InsetRefusal::Curvature);
        assert_eq!(ccw.inset(&q(3.)).unwrap_err(), InsetRefusal::Curvature);
        assert_eq!(line([0., 0.], [1., 1.]).inset(&q(1.)).unwrap_err(), InsetRefusal::IrrationalRadius);
        assert_eq!(line([1., 1.], [1., 1.]).inset(&q(1.)).unwrap_err(), InsetRefusal::ZeroLength);
    }
    #[test]
    fn clears_disc_is_strict_and_decided_exactly() {
        let l = line([0., 0.], [4., 0.]);
        let clear = |t: &Trimmed, c: [f64; 2], r2: f64| t.clears_disc(&pt(c), &q(r2)).unwrap();
        assert!(clear(&l, [2., 3.], 8.));
        assert!(!clear(&l, [2., 3.], 9.), "touching is not clearing");
        assert!(!clear(&l, [0., 1.], 1.), "an end on the disc");
        assert!(clear(&l, [7., 0.], 4.), "the foot clamps to the nearer end");
        assert!(!clear(&l, [5., 0.], 1.));
        // The nearest point of the arc to (5,5) is at distance 5 sqrt 2 - 2 = 5.0711.
        let a = arc([0., 0.], 4., [2., 0.], [0., 2.], true);
        assert!(clear(&a, [5., 5.], 4.));
        assert!(clear(&a, [5., 5.], 25.));
        assert!(!clear(&a, [5., 5.], 26.));
        assert!(!clear(&a, [5., 5.], 36.), "an end inside");
        assert!(clear(&a, [-5., -5.], 4.), "outside the sector only the ends matter");
    }
}
