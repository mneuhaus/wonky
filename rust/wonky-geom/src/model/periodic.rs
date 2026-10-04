//! Ring trims of rational revolution carriers. Virtual chart boundaries never
//! enter the edge arena. These are surface-class mechanisms, not family routes.
use super::{
    curved::{revolution_transition, Patch},
    Bounds, Carrier3, Circle3, Curve3, Draft, FaceId, Plane3, QuadraticPoint3, VertexKey,
};
use crate::{cross, dot, frame::Frame, Point, Refused, Result, Q};
use num_traits::{One, Signed, Zero};
use std::cmp::Ordering;
use wonky_curve::{numeric::exact_root, radical::Radical, Carrier, Cycle, ExactPoint, Trimmed};

#[derive(Clone, Debug)]
pub struct AtlasPiece {
    pub patch: Patch,
    pub piece: Trimmed,
    /// Transition after this piece, including the final return to the first.
    pub winding_delta: i32,
}
#[derive(Clone, Debug)]
pub struct AtlasTrim {
    pub pieces: Vec<AtlasPiece>,
}
impl AtlasTrim {
    /// A latitude ring at a chart height in one quadratic field (a cone-rim
    /// spring); identical to `ring` for a rational height.
    pub fn radical_ring(height: Radical, ccw: bool) -> Result<Self> {
        if let Some(h) = height.rational() {
            return Self::ring(h, ccw);
        }
        let (a, b) = if ccw { (q(-1), q(1)) } else { (q(1), q(-1)) };
        let mut pieces = vec![];
        for patch in [Patch::First, Patch::Second] {
            let ends = [[a.clone(), Q::zero()], [b.clone(), Q::zero()]];
            let winding_delta = revolution_transition(patch, &ends[1])?.winding_delta;
            let point = |u: &Q| ExactPoint::from_coordinates([Radical::from(u.clone()), height.clone()]);
            let ends = [point(&a), point(&b)];
            let [s, t] = ends.map(|e| e.map_err(|e| Refused(e.name())));
            let piece = Trimmed::new([s?, t?], Carrier::Line).map_err(|e| Refused(e.name()))?;
            pieces.push(AtlasPiece { patch, piece, winding_delta });
        }
        Ok(Self { pieces })
    }
    pub fn ring(height: Q, ccw: bool) -> Result<Self> {
        let (a, b) = if ccw { (q(-1), q(1)) } else { (q(1), q(-1)) };
        let mut pieces = vec![];
        for patch in [Patch::First, Patch::Second] {
            let ends = [[a.clone(), height.clone()], [b.clone(), height.clone()]];
            let winding_delta = revolution_transition(patch, &ends[1])?.winding_delta;
            let piece = Trimmed::new(ends.map(ExactPoint::from_rational), Carrier::Line)
                .map_err(|e| Refused(e.name()))?;
            pieces.push(AtlasPiece {
                patch,
                piece,
                winding_delta,
            });
        }
        Ok(Self { pieces })
    }
}
fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}

/// Exact signed volume times six: a rational plus rational multiples of π
/// and π². This is an analytic value, never a polygonal or floating
/// approximation. π² arises from tube bands (torus faces: Pappus' 2π·x̄·A
/// with a circular-segment area A); every other carrier leaves `pi2` zero.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct PiValue {
    pub rational: Q,
    pub pi: Q,
    pub pi2: Q,
}
impl PiValue {
    /// Rational Machin bounds for this exact value. This is an enclosure,
    /// never a cache used for topology. Cost is bounded explicitly.
    pub fn enclosure(&self, terms: usize) -> Result<(Q, Q)> {
        if terms == 0 || terms > 512 {
            return Err(Refused("boolean/budget-exceeded:pi-enclosure"));
        }
        let (lo, hi) = pi_bounds(terms);
        Ok(self.bounds(&lo, &hi))
    }
    /// Value range for π in [lo, hi] (0 < lo): each monomial is monotone.
    fn bounds(&self, lo: &Q, hi: &Q) -> (Q, Q) {
        let (a, b) = if self.pi.is_negative() { (hi, lo) } else { (lo, hi) };
        let (c, d) = if self.pi2.is_negative() { (hi, lo) } else { (lo, hi) };
        (
            &self.rational + &self.pi * a + &self.pi2 * c * c,
            &self.rational + &self.pi * b + &self.pi2 * d * d,
        )
    }
    /// Refuse a consumer that has no π² slot when this value has one.
    pub fn without_pi2(&self) -> Result<&Self> {
        if self.pi2.is_zero() {
            Ok(self)
        } else {
            Err(Refused("boolean/ssi-row-unavailable:torus×pi-linear-consumer"))
        }
    }

    pub fn sign(&self) -> Result<Ordering> {
        if self.pi.is_zero() && self.pi2.is_zero() {
            return Ok(self.rational.cmp(&Q::zero()));
        }
        if self.rational.is_zero() && self.pi2.is_zero() {
            return Ok(self.pi.cmp(&Q::zero()));
        }
        for bounds in std::iter::once((q(3), Q::new(22.into(), 7.into())))
            .chain([8, 16, 32, 64, 128, 256, 512].into_iter().map(pi_bounds))
        {
            let (lo, hi) = self.bounds(&bounds.0, &bounds.1);
            if lo.is_positive() {
                return Ok(Ordering::Greater);
            }
            if hi.is_negative() {
                return Ok(Ordering::Less);
            }
        }
        Err(Refused("boolean/budget-exceeded:pi-sign"))
    }
}
fn atan_bounds(denominator: i64, terms: usize) -> (Q, Q) {
    let x = Q::one() / q(denominator);
    let x2 = &x * &x;
    let mut power = x;
    let mut sum = Q::zero();
    for i in 0..terms {
        let term = &power / q((2 * i + 1) as i64);
        if i % 2 == 0 {
            sum += term;
        } else {
            sum -= term;
        }
        power *= &x2;
    }
    let remainder = power / q((2 * terms + 1) as i64);
    if terms % 2 == 0 {
        (sum.clone(), sum + remainder)
    } else {
        (sum.clone() - remainder, sum)
    }
}
fn pi_bounds(terms: usize) -> (Q, Q) {
    let (a, b) = atan_bounds(5, terms);
    let (c, d) = atan_bounds(239, terms);
    (q(16) * a - q(4) * d, q(16) * b - q(4) * c)
}

/// An exact value of Q(√d)[π] of π-degree ≤ 2, plus one angle term:
/// `base + √surd·root + π·atan(angle)·(angle_pi[0] + angle_pi[1]·√surd)`.
/// Revolution bands with ring data in Q(√d) (cone-rim chamfers) measure in
/// the first two parts; tube bands ending at a tube angle off the quarter
/// grid with a rational tangent (cone-rim fillets) add the angle term.
/// `surd` is 0 exactly when no √surd coefficient is set, `angle` is 0 when
/// both angle coefficients are. Nothing is a rounded root or angle: signs
/// come from rational enclosures of π, √d and atan.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct SurdPiValue {
    pub base: PiValue,
    pub surd: Q,
    pub root: PiValue,
    pub angle: Q,
    pub angle_pi: [Q; 2],
    /// General circular sweeps (strip faces and planar arcs off the quarter
    /// grid, boolean3d G12b): `Σ c·atan(x)` with exact `x` and `c`.
    pub atans: AtanSum,
}
/// An exact value `pi·π + Σ c_k·atan(x_k)`: the angle of a circular sweep
/// off the quarter grid, whose tangent of the half angle `x` is exact (in Q
/// or a quadratic field) but whose angle is no rational multiple of π.
/// Canonical: every `x_k` lies strictly in (0, 1), the `x_k` are distinct
/// and sorted, no `c_k` is zero; the reduction `atan(-x) = -atan(x)` and
/// `atan(x) = π/2 - atan(1/x)` moves the rest into `pi`. Two routes that
/// build the same sweeps therefore compare equal exactly; a different
/// spelling of one angle compares unequal (a refusal, never a wrong
/// acceptance). Signs and values come from rational atan and π bounds.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct AtanSum {
    pub pi: Radical,
    pub terms: Vec<(Radical, Radical)>,
}
impl AtanSum {
    pub fn is_zero(&self) -> bool {
        self.pi.is_zero() && self.terms.is_empty()
    }
    /// Add `c·atan(x)`.
    pub fn add_atan(&mut self, x: &Radical, c: &Radical) -> Result<()> {
        rad_guard(|| {
            if c.is_zero() || x.is_zero() {
                return;
            }
            let (mut x, mut c) = if x.sign() == Ordering::Less { (-x, -c) } else { (x.clone(), c.clone()) };
            let one = Radical::from(Q::one());
            match x.cmp(&one) {
                Ordering::Equal => {
                    self.pi = &self.pi + &(&c * &Q::new(1.into(), 4.into()));
                    return;
                }
                Ordering::Greater => {
                    self.pi = &self.pi + &(&c * &Q::new(1.into(), 2.into()));
                    x = &one / &x;
                    c = -c;
                }
                Ordering::Less => {}
            }
            match self.terms.binary_search_by(|(y, _)| y.cmp(&x)) {
                Ok(k) => {
                    let sum = &self.terms[k].1 + &c;
                    if sum.is_zero() {
                        self.terms.remove(k);
                    } else {
                        self.terms[k].1 = sum;
                    }
                }
                Err(k) => self.terms.insert(k, (x, c)),
            }
        })
    }
    pub fn add_pi(&mut self, c: &Radical) -> Result<()> {
        self.pi = rad_guard(|| &self.pi + c)?;
        Ok(())
    }
    pub fn add(&mut self, other: &AtanSum) -> Result<()> {
        self.add_pi(&other.pi)?;
        for (x, c) in &other.terms {
            self.add_atan(x, c)?;
        }
        Ok(())
    }
    pub fn scaled(&self, s: &Radical) -> Result<AtanSum> {
        let mut out = AtanSum::default();
        if s.is_zero() {
            return Ok(out);
        }
        out.pi = rad_guard(|| &self.pi * s)?;
        out.terms = rad_guard(|| self.terms.iter().map(|(x, c)| (x.clone(), c * s)).collect())?;
        Ok(out)
    }
    /// Rational bounds: π by Machin terms, each `x` and `c` by its certified
    /// enclosure (exact when rational), atan by the reduced series, which is
    /// monotone in `x`.
    pub fn bounds(&self, terms: usize) -> Result<(Q, Q)> {
        fn enclose(x: &Radical) -> Result<(Q, Q)> {
            if let Some(v) = x.rational() {
                return Ok((v.clone(), v));
            }
            let iv = x.enclosure().map_err(|e| Refused(e.name()))?;
            let f = |v: f64| Q::from_float(v).ok_or(Refused("boolean/ssi-row-unavailable:radical/bound-range"));
            Ok((f(iv.lo())?, f(iv.hi())?))
        }
        let (plo, phi) = pi_bounds(terms);
        let mut out = imul(&enclose(&self.pi)?, &(plo, phi));
        for (x, c) in &self.terms {
            let (x0, x1) = enclose(x)?;
            let t = (atan_bounds_of(&x0, terms).0, atan_bounds_of(&x1, terms).1);
            let term = imul(&enclose(c)?, &t);
            out = (out.0 + term.0, out.1 + term.1);
        }
        Ok(out)
    }
    fn to_f64(&self) -> f64 {
        let f = |x: &Radical| x.enclosure().map(|iv| iv.m).unwrap_or(f64::NAN);
        f(&self.pi) * std::f64::consts::PI + self.terms.iter().map(|(x, c)| f(c) * f(x).atan()).sum::<f64>()
    }
}
fn add_pi(a: &mut PiValue, b: &PiValue, scale: &Q) {
    a.rational += &b.rational * scale;
    a.pi += &b.pi * scale;
    a.pi2 += &b.pi2 * scale;
}
/// Bounds of atan(y) for rational 0 ≤ y ≤ 1/2: alternating partial sums.
fn atan_series(y: &Q, terms: usize) -> (Q, Q) {
    let y2 = y * y;
    let mut power = y.clone();
    let mut sum = Q::zero();
    for i in 0..terms {
        let term = &power / q((2 * i + 1) as i64);
        if i % 2 == 0 {
            sum += term;
        } else {
            sum -= term;
        }
        power *= &y2;
    }
    let remainder = power / q((2 * terms + 1) as i64);
    if terms % 2 == 0 {
        (sum.clone(), sum + remainder)
    } else {
        (sum.clone() - remainder, sum)
    }
}
/// Rational bounds of atan(x) for any rational x: reduced to |y| ≤ 1/2 by
/// atan x = π/4 + atan((x−1)/(x+1)) (1/2 < x ≤ 2) and π/2 − atan(1/x).
fn atan_bounds_of(x: &Q, terms: usize) -> (Q, Q) {
    if x.is_negative() {
        let (lo, hi) = atan_bounds_of(&-x, terms);
        return (-hi, -lo);
    }
    let half = Q::new(1.into(), 2.into());
    if x <= &half {
        return atan_series(x, terms);
    }
    let (p0, p1) = pi_bounds(terms);
    if x <= &q(2) {
        let y = (x - Q::one()) / (x + Q::one());
        let (s0, s1) = if y.is_negative() {
            let (a, b) = atan_series(&-&y, terms);
            (-b, -a)
        } else {
            atan_series(&y, terms)
        };
        return (p0 / q(4) + s0, p1 / q(4) + s1);
    }
    let (s0, s1) = atan_series(&(Q::one() / x), terms);
    (p0 / q(2) - s1, p1 / q(2) - s0)
}
/// Interval product.
fn imul(a: &(Q, Q), b: &(Q, Q)) -> (Q, Q) {
    let p = [&a.0 * &b.0, &a.0 * &b.1, &a.1 * &b.0, &a.1 * &b.1];
    (p.iter().min().expect("four").clone(), p.iter().max().expect("four").clone())
}
impl SurdPiValue {
    pub fn rational(v: PiValue) -> Self {
        Self { base: v, ..Self::default() }
    }
    fn surd_free(&self) -> bool {
        self.root == PiValue::default() && self.angle_pi[1].is_zero()
    }
    /// The factor `f` with √r = f·√surd, fixing `surd = r` when unset.
    fn field(&mut self, r: &Q) -> Result<Q> {
        if self.surd_free() {
            self.surd = r.clone();
            return Ok(Q::one());
        }
        exact_root(&(r / &self.surd)).ok_or(Refused("blend/number-class-exceeded:multiquadratic-measure"))
    }
    fn tidy(&mut self) {
        if self.surd_free() {
            self.surd = Q::zero();
        }
        if self.angle_pi.iter().all(Q::is_zero) {
            self.angle = Q::zero();
        }
    }
    /// Add `x · m` where `m` is a π-monomial coefficient vector (`PiValue`
    /// with one slot set) and `x` a number of one quadratic field.
    pub fn add_scaled(&mut self, x: &Radical, monomial: &PiValue) -> Result<()> {
        let (a, b, r) = x.parts().ok_or(Refused("blend/number-class-exceeded:multiquadratic-measure"))?;
        add_pi(&mut self.base, monomial, &a);
        if !b.is_zero() {
            let f = self.field(&r)?;
            add_pi(&mut self.root, monomial, &(b * f));
        }
        self.tidy();
        Ok(())
    }
    /// Add `c · π · atan(x)` for a rational `x` and `c` in one quadratic field.
    pub fn add_angle(&mut self, x: &Q, c: &Radical) -> Result<()> {
        let (a, b, r) = c.parts().ok_or(Refused("blend/number-class-exceeded:multiquadratic-measure"))?;
        if a.is_zero() && b.is_zero() {
            return Ok(());
        }
        if !self.angle_pi.iter().all(Q::is_zero) && &self.angle != x {
            return Err(Refused("blend/number-class-exceeded:multi-angle-measure"));
        }
        self.angle = x.clone();
        self.angle_pi[0] += a;
        if !b.is_zero() {
            let f = self.field(&r)?;
            self.angle_pi[1] += b * f;
        }
        self.tidy();
        Ok(())
    }
    pub fn add(&mut self, other: &SurdPiValue) -> Result<()> {
        add_pi(&mut self.base, &other.base, &Q::one());
        let root = Radical::quadratic(Q::zero(), Q::one(), other.surd.clone()).map_err(|e| Refused(e.name()))?;
        if other.root != PiValue::default() {
            for (slot, value) in [(0, &other.root.rational), (1, &other.root.pi), (2, &other.root.pi2)] {
                let mut m = PiValue::default();
                match slot {
                    0 => m.rational = value.clone(),
                    1 => m.pi = value.clone(),
                    _ => m.pi2 = value.clone(),
                }
                self.add_scaled(&root, &m)?;
            }
        }
        if !other.angle_pi.iter().all(Q::is_zero) {
            let c = wonky_curve::radical::guard(|| Radical::from(other.angle_pi[0].clone()) + &root * &other.angle_pi[1])
                .map_err(|_| Refused("boolean/budget-exceeded:quadratic"))?;
            self.add_angle(&other.angle, &c)?;
        }
        self.atans.add(&other.atans)
    }
    /// This value times a rational.
    pub fn scaled(&self, s: &Q) -> Result<SurdPiValue> {
        let mut out = self.clone();
        for v in [&mut out.base, &mut out.root] {
            v.rational *= s;
            v.pi *= s;
            v.pi2 *= s;
        }
        for c in &mut out.angle_pi {
            *c *= s;
        }
        out.atans = self.atans.scaled(&Radical::from(s.clone()))?;
        out.tidy();
        Ok(out)
    }
    /// The value as `PiValue`, refusing a consumer without a Q(√d) or an
    /// angle slot.
    pub fn without_surd(&self) -> Result<PiValue> {
        if !self.angle_pi.iter().all(Q::is_zero) || !self.atans.is_zero() {
            return Err(Refused("boolean/ssi-row-unavailable:measure/transcendental-angle"));
        }
        if self.root == PiValue::default() {
            Ok(self.base.clone())
        } else {
            Err(Refused("boolean/ssi-row-unavailable:measure/quadratic-surd"))
        }
    }
    /// Rational bounds of √surd: Newton from above (≥ √s by AM-GM) and s/u
    /// from below. Exact rationals; no binary64 value decides anything.
    fn sqrt_bounds(&self, steps: usize) -> (Q, Q) {
        let s = &self.surd;
        // Each iterate is rounded up to a dyadic grid (it stays ≥ √s), so
        // denominators stay bounded by 2^(16·steps).
        let grid = num_traits::pow(q(2), 16 * steps);
        let mut u = if s > &Q::one() { s.clone() } else { Q::one() };
        for _ in 0..steps {
            u = (&u + s / &u) / q(2);
            u = (&u * &grid).ceil() / &grid;
        }
        (s / &u, u)
    }
    fn bounds_at(&self, terms: usize, steps: usize) -> Result<(Q, Q)> {
        let (plo, phi) = pi_bounds(terms);
        let (b0, b1) = self.base.bounds(&plo, &phi);
        let s = self.sqrt_bounds(steps);
        let root = imul(&self.root.bounds(&plo, &phi), &s);
        let mut lo = b0 + root.0;
        let mut hi = b1 + root.1;
        if !self.angle_pi.iter().all(Q::is_zero) {
            let c = imul(&(self.angle_pi[1].clone(), self.angle_pi[1].clone()), &s);
            let c = (&c.0 + &self.angle_pi[0], &c.1 + &self.angle_pi[0]);
            let t = imul(&(plo, phi), &atan_bounds_of(&self.angle, terms));
            let term = imul(&c, &t);
            lo += term.0;
            hi += term.1;
        }
        if !self.atans.is_zero() {
            let (a, b) = self.atans.bounds(terms)?;
            lo += a;
            hi += b;
        }
        Ok((lo, hi))
    }
    pub fn sign(&self) -> Result<Ordering> {
        if self.surd_free() && self.angle_pi.iter().all(Q::is_zero) && self.atans.is_zero() {
            return self.base.sign();
        }
        for (terms, steps) in [(8, 8), (16, 12), (32, 16), (64, 20), (128, 24), (256, 28)] {
            let (lo, hi) = self.bounds_at(terms, steps)?;
            if lo.is_positive() {
                return Ok(Ordering::Greater);
            }
            if hi.is_negative() {
                return Ok(Ordering::Less);
            }
        }
        Err(Refused("boolean/budget-exceeded:surd-pi-sign"))
    }
    /// Rational bounds of this exact value (π by Machin terms, √surd by
    /// rounded-up Newton iterates, atan by reduced series). An enclosure,
    /// never a topology cache.
    pub fn enclosure(&self, terms: usize) -> Result<(Q, Q)> {
        if terms == 0 || terms > 512 {
            return Err(Refused("boolean/budget-exceeded:pi-enclosure"));
        }
        self.bounds_at(terms, terms.min(32))
    }
    /// A binary64 observation (display and reports only).
    pub fn to_f64(&self) -> f64 {
        use num_traits::ToPrimitive;
        let f = |v: &PiValue| {
            v.rational.to_f64().unwrap_or(f64::NAN)
                + v.pi.to_f64().unwrap_or(f64::NAN) * std::f64::consts::PI
                + v.pi2.to_f64().unwrap_or(f64::NAN) * std::f64::consts::PI * std::f64::consts::PI
        };
        let s = self.surd.to_f64().unwrap_or(f64::NAN).sqrt();
        let a = |x: &Q| x.to_f64().unwrap_or(f64::NAN);
        let angle = (a(&self.angle_pi[0]) + if self.angle_pi[1].is_zero() { 0. } else { a(&self.angle_pi[1]) * s })
            * std::f64::consts::PI
            * a(&self.angle).atan();
        f(&self.base) + if self.root == PiValue::default() { 0. } else { s * f(&self.root) } + angle + self.atans.to_f64()
    }
}

pub(super) fn plane_ring(circle: &Circle3, plane: &Plane3, forward: bool) -> Result<Trimmed> {
    if circle.is_radical() {
        return radical_plane_ring(circle, plane, forward);
    }
    let frame = circle.frame()?;
    let center = plane.chart(frame.origin())?;
    let axis = |i: usize| -> Result<[Q; 2]> {
        let p: Point = std::array::from_fn(|k| &frame.origin()[k] + &frame.columns()[i][k]);
        let a = plane.chart(&p)?;
        Ok(std::array::from_fn(|k| &a[k] - &center[k]))
    };
    let (x, y) = (axis(0)?, axis(1)?);
    let norm = |a: &[Q; 2]| &a[0] * &a[0] + &a[1] * &a[1];
    let xy = &x[0] * &y[0] + &x[1] * &y[1];
    if !xy.is_zero() || norm(&x) != norm(&y) {
        return Err(Refused(
            "boolean/ssi-row-unavailable:circle/elliptic-plane-chart",
        ));
    }
    let positive = (&x[0] * &y[1] - &x[1] * &y[0]).is_positive();
    let seam = ExactPoint::from_rational(plane.chart(&circle.point(Patch::First, &Q::zero())?)?);
    Trimmed::ring(
        center,
        circle.radius2() * norm(&x),
        seam,
        forward == positive,
    )
    .map_err(|e| Refused(e.name()))
}
/// The chart ring of a radical-centre circle: the plane chart is linear, so
/// the centre maps exactly into the field of the centre and the rational
/// columns keep the isometry test rational.
fn radical_plane_ring(circle: &Circle3, plane: &Plane3, forward: bool) -> Result<Trimmed> {
    let exact = super::algebraic::RadicalPlane3::from(plane);
    let centre = exact.chart(&circle.origin())?;
    let axis = |i: usize| -> Result<[Q; 2]> {
        let a = plane.chart(&circle.columns()[i])?;
        let o = plane.chart(&crate::zero())?;
        Ok(std::array::from_fn(|k| &a[k] - &o[k]))
    };
    let (x, y) = (axis(0)?, axis(1)?);
    let norm = |a: &[Q; 2]| &a[0] * &a[0] + &a[1] * &a[1];
    if !(&x[0] * &y[0] + &x[1] * &y[1]).is_zero() || norm(&x) != norm(&y) {
        return Err(Refused("boolean/ssi-row-unavailable:circle/elliptic-plane-chart"));
    }
    let positive = (&x[0] * &y[1] - &x[1] * &y[0]).is_positive();
    let seam = exact.chart(&circle.point_exact(Patch::First, &Q::zero()))?;
    Trimmed::ring_about(centre, circle.radius2() * norm(&x), seam, forward == positive)
        .map_err(|e| Refused(e.name()))
}

#[derive(Clone, Debug)]
pub struct RevolutionBand {
    pub frame: Frame,
    pub radius: [Q; 2],
    pub lo: Q,
    pub hi: Q,
    pub forward: bool,
}
/// A full-turn band of a cylinder or cone whose meridian `radius[0] +
/// radius[1]·z` and ring heights lie in one quadratic field (cone-rim
/// chamfers). Every check is the rational band audit, evaluated in Q(√d).
#[derive(Clone, Debug)]
pub struct RadicalBand {
    pub frame: Frame,
    pub radius: [Radical; 2],
    pub lo: Radical,
    pub hi: Radical,
    pub forward: bool,
}
impl RadicalBand {
    /// The π coefficient of the area of a band with a rational meridian and
    /// Q(√d) ring heights (a ring cut by a sphere at an irrational height),
    /// as p + q·√r in (p, q, r); the metric factor must be rational.
    pub fn area_parts(&self) -> Result<(Q, Q, Q)> {
        let quadratic = || Refused("boolean/ssi-row-unavailable:revolution/quadratic-ring");
        let meridian = RevolutionBand {
            frame: self.frame.clone(),
            radius: [self.radius[0].rational().ok_or_else(quadratic)?, self.radius[1].rational().ok_or_else(quadratic)?],
            lo: Q::zero(),
            hi: Q::zero(),
            forward: self.forward,
        };
        let factor = meridian.area_factor()?;
        let coefficient = rad_guard(|| {
            let at = |h: &Radical| &self.radius[0] + &(&self.radius[1] * h);
            (at(&self.lo) + at(&self.hi)) * (&self.hi - &self.lo)
        })?;
        let (p, b, r) = coefficient.parts().ok_or(Refused("blend/number-class-exceeded:multiquadratic-measure"))?;
        Ok((p * &factor, b * factor, r))
    }
    pub fn rational(&self) -> Option<RevolutionBand> {
        Some(RevolutionBand {
            frame: self.frame.clone(),
            radius: [self.radius[0].rational()?, self.radius[1].rational()?],
            lo: self.lo.rational()?,
            hi: self.hi.rational()?,
            forward: self.forward,
        })
    }
    /// Whether the carrier itself is quadratic (no rational chart point).
    pub fn quadratic_carrier(&self) -> bool {
        self.radius.iter().any(|x| x.rational().is_none())
    }
}
pub(super) fn band(d: &Draft, fi: FaceId) -> Result<Option<RevolutionBand>> {
    match radical_band(d, fi)? {
        None => Ok(None),
        Some(b) => b
            .rational()
            .map(Some)
            .ok_or(Refused("boolean/ssi-row-unavailable:revolution/quadratic-ring")),
    }
}
fn rad_guard<T>(f: impl FnOnce() -> T) -> Result<T> {
    wonky_curve::radical::guard(f).map_err(|_| Refused("boolean/budget-exceeded:quadratic"))
}
pub(super) fn radical_band(d: &Draft, fi: FaceId) -> Result<Option<RadicalBand>> {
    if super::revolution_partial::is_band(d,fi) || super::extrusion::strip(d,fi) || super::quadratic_extrusion::strip(d,fi) {return Ok(None);}
    // A cone stripe of a chamfered chain is a partial patch, not a band.
    if matches!(d.surfaces[d.faces[fi.index()].surface.index()].carrier, Carrier3::Cone(_)) && super::patch::shape(d, fi) {
        return Ok(None);
    }
    let f = &d.faces[fi.index()];
    let (frame, radius) = match &d.surfaces[f.surface.index()].carrier {
        Carrier3::TranslatedCylinder(_) => return Err(Refused("model/translated-cylinder/ring-band-unavailable")),
        Carrier3::Rotated(_) => return Ok(None),
        Carrier3::Plane(_) | Carrier3::RadicalPlane(_) => return Ok(None),
        Carrier3::Cylinder(c) => (
            c.frame()?.clone(),
            [
                Radical::from(exact_root(&c.radius2()).expect("rational cylinder radius")),
                Radical::default(),
            ],
        ),
        Carrier3::Cone(c) => (c.frame.clone(), c.radical_meridian()?),
        // Sphere faces are tube bands (`tube`) or stereographic patches
        // (`stereo`), never revolution bands.
        Carrier3::Sphere(_) if super::stereo::is_patch(d, fi) => return Ok(None),
        Carrier3::Sphere(_) => {
            return Err(Refused("boolean/ssi-row-unavailable:sphere/trim-audit"))
        }
        Carrier3::Torus(_) => {
            return Err(Refused("boolean/ssi-row-unavailable:torus×revolution-band"))
        }
    };
    let apex = if f.loops.len() == 1 && !radius[1].is_zero() {
        Some(rad_guard(|| -(&radius[0] / &radius[1]))?)
    } else {
        None
    };
    if f.loops.len() != 2 && apex.is_none() {
        return Err(Refused(
            "boolean/ssi-row-unavailable:revolution/non-band-trim",
        ));
    }
    let mut heights = vec![];
    for (i, l) in f.loops.iter().enumerate() {
        let lp = &d.loops[l.index()];
        if lp.coedges.len() != 1 {
            return Err(Refused(
                "boolean/ssi-row-unavailable:revolution/non-ring-trim",
            ));
        }
        let co = &d.coedges[lp.coedges[0].index()];
        let e = &d.edges[co.edge.index()];
        match e.bounds {
            Bounds::Ring => {}
            Bounds::Segment(_) => {
                return Err(Refused("boolean/ssi-row-unavailable:revolution/open-trim"))
            }
        }
        let (circle_frame, offset) = match &d.curves[e.curve.index()].geometry {
            Curve3::Circle(c) => (c.frame()?, Radical::default()),
            Curve3::RadicalCircle(c) => (&c.frame, c.height().clone()),
            Curve3::TranslatedCircle(_) => return Err(Refused("model/translated-circle/ring-band-unavailable")),
            Curve3::Line { .. } | Curve3::RadicalLine { .. } => return Err(Refused("model/g4-ring-on-open-curve")),
        };
        let map = frame.relation_from(circle_frame).map;
        if !map.origin()[0].is_zero()
            || !map.origin()[1].is_zero()
            || !map.columns()[0][2].is_zero()
            || !map.columns()[1][2].is_zero()
            // A radical height is measured along the circle frame's third
            // column, which must then be the band axis.
            || (!offset.is_zero() && (!map.columns()[2][0].is_zero() || !map.columns()[2][1].is_zero()))
        {
            return Err(Refused("model/g3-ring-not-latitude"));
        }
        let positive = (&map.columns()[0][0] * &map.columns()[1][1]
            - &map.columns()[0][1] * &map.columns()[1][0])
            .is_positive();
        let ccw = co.forward == positive;
        let height = rad_guard(|| Radical::from(map.origin()[2].clone()) + &offset * &map.columns()[2][2])?;
        let expected = AtlasTrim::radical_ring(height.clone(), ccw)?;
        let atlas = co
            .atlas
            .as_ref()
            .ok_or(Refused("model/g3-periodic-atlas-missing"))?;
        if atlas.pieces.len() != 2 {
            return Err(Refused("model/g3-atlas-piece-count"));
        }
        for (a, b) in atlas.pieces.iter().zip(&expected.pieces) {
            if a.patch != b.patch
                || a.winding_delta != b.winding_delta
                || a.piece.ends() != b.piece.ends()
            {
                return Err(Refused("model/g3-atlas-transition"));
            }
            match a.piece.carrier() {
                Carrier::Line => {}
                Carrier::Circle(_) | Carrier::BSpline(_) => {
                    return Err(Refused("model/g3-pcurve-class"))
                }
            }
        }
        if co.pcurve.ends() != atlas.pieces[0].piece.ends()
            || co.pcurve.key() != atlas.pieces[0].piece.key()
        {
            return Err(Refused("model/g3-primary-chart"));
        }
        let lower = match &apex {
            Some(apex) => height < *apex,
            None => i == 0,
        };
        if ccw != (lower == f.forward) {
            return Err(Refused("model/g5-loop-orientation"));
        }
        heights.push(height);
    }
    if let Some(apex) = apex {
        heights.push(apex);
        heights.sort();
    }
    if heights[0] >= heights[1] {
        return Err(Refused("model/g6-band-order"));
    }
    let r_at = |h: &Radical| rad_guard(|| &radius[0] + &(&radius[1] * h));
    for h in &heights {
        if r_at(h)?.is_negative() {
            return Err(Refused("boolean/chart-singularity:apex"));
        }
    }
    let mid = rad_guard(|| (&heights[0] + &heights[1]) * &Q::new(1.into(), 2.into()))?;
    if !r_at(&mid)?.is_positive() {
        return Err(Refused("model/g1-cone-branch"));
    }
    // A Q(√d) ring is the latitude of the carrier at its height: the radius
    // of the curve is the meridian radius there (a rational circle is
    // checked by G2 against the carrier implicit).
    for l in &f.loops {
        let co = &d.coedges[d.loops[l.index()].coedges[0].index()];
        if let Curve3::RadicalCircle(c) = &d.curves[d.edges[co.edge.index()].curve.index()].geometry {
            if !d.surfaces[f.surface.index()].carrier.contains_curve(&Curve3::RadicalCircle(c.clone()))? {
                return Err(Refused("model/g2-curve-off-surface"));
            }
        }
    }
    Ok(Some(RadicalBand {
        frame,
        radius,
        lo: heights[0].clone(),
        hi: heights[1].clone(),
        forward: f.forward,
    }))
}


/// A planar disk or annulus perpendicular to a revolution axis whose ring
/// trims are latitudes with Q(√d) radii (the plane spring of a cone-rim
/// fillet). It has no rational planar pcurve, so it is charted like a band
/// in polar coordinates `(t_u, ρ)`: each ring trim is
/// `AtlasTrim::radical_ring(ρ, ccw)`. Faces with rational rings only keep the
/// planar chart; this row applies only when some ring is a `RadicalCircle`.
#[derive(Clone, Debug)]
pub struct FlatBand {
    /// Isometric axis frame (origin on the axis, third column the axis).
    pub frame: Frame,
    /// Local height of the plane.
    pub height: Radical,
    /// Inner radius (`None` for a disk) and outer radius.
    pub inner: Option<Radical>,
    pub outer: Radical,
    /// Outward normal along `+axis`.
    pub up: bool,
}
pub(super) fn flat_band(d: &Draft, fi: FaceId) -> Result<Option<FlatBand>> {
    let f = &d.faces[fi.index()];
    let plane = match &d.surfaces[f.surface.index()].carrier {
        Carrier3::Plane(p) => p,
        _ => return Ok(None),
    };
    let ring_of = |l: &super::LoopId| -> Option<&super::Coedge> {
        let lp = &d.loops[l.index()];
        (lp.coedges.len() == 1).then(|| &d.coedges[lp.coedges[0].index()])
            .filter(|co| matches!(d.edges[co.edge.index()].bounds, Bounds::Ring))
    };
    let radical = f.loops.iter().filter_map(|l| ring_of(l)).find_map(|co| match &d.curves[d.edges[co.edge.index()].curve.index()].geometry {
        Curve3::RadicalCircle(c) => Some(c.frame.clone()),
        _ => None,
    });
    let Some(frame) = radical else { return Ok(None) };
    if f.loops.iter().any(|l| ring_of(l).is_none()) || f.loops.len() > 2 {
        return Err(Refused("boolean/ssi-row-unavailable:plane/quadratic-ring-with-segments"));
    }
    let cols = frame.columns();
    if !frame.is_isometry() || !dot(&cols[0], &cross(&cols[1], &cols[2])).is_positive() {
        return Err(Refused("boolean/ssi-row-unavailable:plane/quadratic-ring-frame"));
    }
    if !cross(&plane.n, &cols[2]).iter().all(Q::is_zero) {
        return Err(Refused("model/g3-ring-not-latitude"));
    }
    let up = dot(&plane.n, &cols[2]).is_positive() == f.forward;
    let mut rings = vec![];
    let mut height: Option<Radical> = None;
    for l in &f.loops {
        let co = ring_of(l).expect("checked ring loop");
        let (circle_frame, offset, radius) = match &d.curves[d.edges[co.edge.index()].curve.index()].geometry {
            Curve3::Circle(c) => (c.frame()?, Radical::default(), Radical::from(exact_root(&c.radius2()).ok_or(Refused("boolean/contract-violation:carrier/radius"))?)),
            Curve3::RadicalCircle(c) => (&c.frame, c.height().clone(), c.radius().clone()),
            Curve3::TranslatedCircle(_) => return Err(Refused("model/translated-circle/ring-band-unavailable")),
            Curve3::Line { .. } | Curve3::RadicalLine { .. } => return Err(Refused("model/g4-ring-on-open-curve")),
        };
        let map = frame.relation_from(circle_frame).map;
        let [x, y, z] = map.columns();
        if !map.origin()[0].is_zero() || !map.origin()[1].is_zero() || !x[2].is_zero() || !y[2].is_zero()
            || (!offset.is_zero() && (!z[0].is_zero() || !z[1].is_zero()))
        {
            return Err(Refused("model/g3-ring-not-latitude"));
        }
        if &x[0] * &x[0] + &x[1] * &x[1] != Q::one() {
            return Err(Refused("boolean/ssi-row-unavailable:plane/quadratic-ring-frame"));
        }
        let h = rad_guard(|| Radical::from(map.origin()[2].clone()) + &offset * &z[2])?;
        match &height {
            Some(h0) if *h0 != h => return Err(Refused("model/g2-curve-off-carrier")),
            _ => height = Some(h),
        }
        let positive = (&x[0] * &y[1] - &x[1] * &y[0]).is_positive();
        let ccw = co.forward == positive;
        // The polar chart of the ring.
        let expected = AtlasTrim::radical_ring(radius.clone(), ccw)?;
        let atlas = co.atlas.as_ref().ok_or(Refused("model/g3-periodic-atlas-missing"))?;
        if atlas.pieces.len() != 2 {
            return Err(Refused("model/g3-atlas-piece-count"));
        }
        for (a, b) in atlas.pieces.iter().zip(&expected.pieces) {
            if a.patch != b.patch || a.winding_delta != b.winding_delta || a.piece.ends() != b.piece.ends() {
                return Err(Refused("model/g3-atlas-transition"));
            }
        }
        if co.pcurve.ends() != atlas.pieces[0].piece.ends() || co.pcurve.key() != atlas.pieces[0].piece.key() {
            return Err(Refused("model/g3-primary-chart"));
        }
        rings.push((radius, ccw));
    }
    rings.sort_by(|a, b| a.0.cmp(&b.0));
    if rings.len() == 2 && rings[0].0 == rings[1].0 {
        return Err(Refused("model/g6-band-order"));
    }
    // The outer ring runs counter-clockwise about the outward normal, an
    // inner ring clockwise.
    let n = rings.len();
    for (i, (_, ccw)) in rings.iter().enumerate() {
        if *ccw != ((i == n - 1) == up) {
            return Err(Refused("model/g5-loop-orientation"));
        }
    }
    Ok(Some(FlatBand {
        frame,
        height: height.expect("one ring"),
        inner: (n == 2).then(|| rings[0].0.clone()),
        outer: rings[n - 1].0.clone(),
        up,
    }))
}
impl FlatBand {
    /// Six times the flux of the position field: 2·(c·n̂)·π(ρo² − ρi²).
    fn volume6(&self) -> Result<Radical> {
        let axis = &self.frame.columns()[2];
        let offset = dot(self.frame.origin(), axis);
        rad_guard(|| {
            let c = Radical::from(offset.clone()) + &self.height;
            let inner = self.inner.as_ref().map(|r| r * r).unwrap_or_default();
            let area = &self.outer * &self.outer - &inner;
            c * &area * &q(if self.up { 2 } else { -2 })
        })
    }
    fn locate(&self, p: &VertexKey) -> Result<Location> {
        let inverse = self.frame.inverse();
        let l: [Radical; 3] = match p {
            VertexKey::Rational(p) => inverse.point(p).map(Radical::from),
            VertexKey::Quadratic(p) => p.mapped(&inverse)?.coordinates().clone(),
            VertexKey::Real(p) => super::algebraic::mapped(p, &inverse),
        };
        rad_guard(|| {
            let rho2 = &l[0] * &l[0] + &l[1] * &l[1];
            let outer = rho2.cmp(&(&self.outer * &self.outer));
            let inner = match &self.inner {
                Some(r) => rho2.cmp(&(r * r)),
                None => Ordering::Greater,
            };
            if outer == Ordering::Greater || inner == Ordering::Less {
                Location::Outside
            } else if outer == Ordering::Equal || inner == Ordering::Equal {
                Location::Boundary
            } else {
                Location::Inside
            }
        })
    }
    /// Rational points of the face (none when the plane height is
    /// irrational: such a face is proved outward through a neighbour).
    fn witnesses(&self) -> Result<Vec<Point>> {
        let Some(h) = self.height.rational() else { return Ok(vec![]) };
        let lo = self.inner.clone().unwrap_or_default();
        let mut out = vec![];
        for r in rational_heights(&lo, &self.outer)? {
            for t in [Q::zero(), Q::one() / q(2), -Q::one() / q(3)] {
                let [c, s] = super::curved::half_angle(Patch::First, &t);
                out.push(self.frame.point(&[&r * c, &r * s, h.clone()]));
            }
        }
        Ok(out)
    }
}

/// Whether a face is a full-turn band (linear meridian or tube) whose ring
/// trims the band audits own, instead of a planar chart.
pub(super) fn is_band(d: &Draft, fi: FaceId) -> Result<bool> {
    if matches!(d.surfaces[d.faces[fi.index()].surface.index()].carrier, Carrier3::Torus(_) | Carrier3::Cone(_))
        && super::patch::patch(d, fi)?.is_some()
    {
        return Ok(true);
    }
    if super::tube::radical_band(d, fi)?.is_some() || flat_band(d, fi)?.is_some() {
        return Ok(true);
    }
    Ok(radical_band(d, fi)?.is_some())
}

fn loop_pieces(d: &Draft, fi: FaceId) -> Vec<Vec<Trimmed>> {
    d.faces[fi.index()]
        .loops
        .iter()
        .map(|l| {
            d.loops[l.index()]
                .coedges
                .iter()
                .map(|c| d.coedges[c.index()].pcurve.clone())
                .collect()
        })
        .collect()
}
/// Six times each solid's exact signed volume, refusing a Q(√d) part for
/// consumers without that slot (`surd_volumes6` keeps it).
pub(super) fn volumes6(d: &Draft) -> Result<Vec<PiValue>> {
    surd_volumes6(d)?.iter().map(SurdPiValue::without_surd).collect()
}
pub(super) fn surd_volumes6(d: &Draft) -> Result<Vec<SurdPiValue>> {
    if let Some(v)=super::revolution_partial::volumes6(d)? {return Ok(v.into_iter().map(SurdPiValue::rational).collect());}
    if let Some(v)=super::extrusion::volumes6(d)? {return Ok(v.into_iter().map(SurdPiValue::rational).collect());}
    let mut out = vec![];
    for solid in &d.solids {
        let mut v = PiValue::default();
        let mut surd = SurdPiValue::default();
        for s in &solid.shells {
            for &fi in &d.shells[s.index()].faces {
                if super::extrusion::strip(d, fi) && super::patch::patch(d, fi)?.is_none() {
                    // 6V = 2 ∮ x·n dA.
                    let (_, flux, _) = super::extrusion::strip_measures(d, fi)?;
                    super::extrusion::absorb(&mut surd, &super::extrusion::scale(&flux, &q(2))?)?;
                    continue;
                }
                if let Some(p) = super::patch::patch(d, fi)? {
                    let term = p.volume6()?;
                    v.rational += term.rational;
                    v.pi += term.pi;
                    v.pi2 += term.pi2;
                    continue;
                }
                if let Some(t) = super::tube::radical_band(d, fi)? {
                    surd.add(&t.volume6()?)?;
                    continue;
                }
                if let Some(b) = flat_band(d, fi)? {
                    surd.add_scaled(&b.volume6()?, &PiValue { pi: Q::one(), ..PiValue::default() })?;
                    continue;
                }
                match radical_band(d, fi)? {
                    Some(b) => {
                        let determinant = dot(
                            &b.frame.columns()[0],
                            &cross(&b.frame.columns()[1], &b.frame.columns()[2]),
                        )
                        .abs();
                        let oz = b.frame.inverse().vector(b.frame.origin())[2].clone();
                        let [r, k] = &b.radius;
                        // Flux of the position field through the band, in
                        // the band's field (the rational case is unchanged).
                        let coefficient = rad_guard(|| {
                            let integral = r * &(&b.hi - &b.lo)
                                + k * &(&b.hi * &b.hi - &b.lo * &b.lo) * &(Q::one() / q(2));
                            (r - &(k * &oz)) * &integral * &(q(4) * &determinant)
                        })?;
                        let coefficient = if b.forward { coefficient } else { -coefficient };
                        match coefficient.rational() {
                            Some(c) => v.pi += c,
                            None => surd.add_scaled(&coefficient, &PiValue { pi: Q::one(), ..PiValue::default() })?,
                        }
                    }
                    None => {
                        let plane = d.surfaces[d.faces[fi.index()].surface.index()]
                            .carrier
                            .plane()?;
                        let factor = q(2) * dot(&plane.o, &cross(&plane.x, &plane.y()));
                        for lp in loop_pieces(d, fi) {
                            let cycle = Cycle::new(lp.clone());
                            match cycle.area_exact().map_err(|e| Refused(e.name()))? {
                                Some(area) => v.rational += &factor * area,
                                None if lp.len() != 1 => {
                                    // Partial arcs: the exact Green area,
                                    // with atan terms off the quarter grid.
                                    surd.add(&super::extrusion::green_surd(&lp)?.scaled(&factor)?)?;
                                }
                                None => {
                                    if lp.len() != 1 {
                                        return Err(Refused(
                                            "boolean/ssi-row-unavailable:circle/partial-volume",
                                        ));
                                    }
                                    match lp[0].carrier() {
                                        Carrier::Circle(c) => {
                                            if !c.full {
                                                return Err(Refused("boolean/ssi-row-unavailable:circle/partial-volume"));
                                            }
                                            v.pi += &factor
                                                * c.r2.rational().ok_or(Refused("boolean/ssi-row-unavailable:circle/partial-volume"))? * if c.ccw { q(1) } else { q(-1) };
                                        }
                                        Carrier::Line | Carrier::BSpline(_) => {
                                            return Err(Refused(
                                                "boolean/ssi-row-unavailable:curve/volume",
                                            ))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        surd.add(&SurdPiValue::rational(v))?;
        out.push(surd);
    }
    Ok(out)
}

/// An exact first moment: a quadratic radical plus a rational multiple of π,
/// plus the atan terms of sweeps off the quarter grid (boolean3d G12b).
#[derive(Clone, Debug, Default)]
pub struct MomentValue {
    pub rational: Radical,
    pub pi: Q,
    pub atans: AtanSum,
}
impl MomentValue {
    fn absorb(&mut self, (algebraic, angular): &super::extrusion::Angular) -> Result<()> {
        self.rational = rad_guard(|| &self.rational + algebraic)?;
        match angular.pi.rational() {
            Some(pi) => self.pi += pi,
            None => self.atans.add_pi(&angular.pi)?,
        }
        for (x, c) in &angular.terms {
            self.atans.add_atan(x, c)?;
        }
        Ok(())
    }
    fn add_scaled(&mut self, other: &MomentValue, s: &Q) -> Result<()> {
        self.rational = rad_guard(|| &self.rational + &(&other.rational * s))?;
        self.pi += &other.pi * s;
        self.atans.add(&other.atans.scaled(&Radical::from(s.clone()))?)
    }
    /// The value in the `SurdPiValue` slots (as `absorb` fills them).
    fn surd(&self) -> Result<SurdPiValue> {
        let mut out = SurdPiValue::default();
        out.add_scaled(&self.rational, &PiValue { rational: Q::one(), ..PiValue::default() })?;
        out.base.pi += &self.pi;
        out.add_scaled(&self.atans.pi, &PiValue { pi: Q::one(), ..PiValue::default() })?;
        for (x, c) in &self.atans.terms {
            out.atans.add_atan(x, c)?;
        }
        Ok(out)
    }
}

/// The band arm of `moments` for a full-turn band whose radii and ring
/// heights lie in one quadratic field (a ring cut by a sphere at an
/// irrational height): `(∮ x·n dA, [∮ x_i (x·n) dA])` as multiples of π,
/// oriented by the face sense. Consumers enclose them (`stereo::moments`).
pub(super) fn radical_band_moments(b: &RadicalBand) -> Result<(Radical, [Radical; 3])> {
    let [c0, c1, c2] = b.frame.columns();
    let o = b.frame.origin();
    let k = cross(c0, c1);
    let delta = dot(c2, &k);
    let (alpha, beta) = (dot(o, &cross(c2, c0)), dot(o, &cross(c2, c1)));
    let sign = Radical::from(if b.forward == delta.is_negative() { q(1) } else { q(-1) });
    let r = |x: &Q| Radical::from(x.clone());
    rad_guard(|| {
        let [m0, m1] = &b.radius;
        let g = m1 * &r(&dot(o, &k)) - m0 * &r(&delta);
        let (l2, h2) = (&b.lo * &b.lo, &b.hi * &b.hi);
        let (l3, h3) = (&l2 * &b.lo, &h2 * &b.hi);
        let p1 = &b.hi - &b.lo;
        let p2 = (&h2 - &l2) * &r(&(Q::one() / q(2)));
        let p3 = (&h3 - &l3) * &r(&(Q::one() / q(3)));
        let rho1 = m0 * &p1 + &(m1 * &p2);
        let h_rho1 = m0 * &p2 + &(m1 * &p3);
        let rho2 = m0 * m0 * &p1 + &(m0 * m1 * &p2 * &r(&q(2))) + &(m1 * m1 * &p3);
        let two_g = &g * &r(&q(2));
        let volume = &sign * &two_g * &rho1;
        let flux = std::array::from_fn(|i| {
            &sign * &(&two_g * &(r(&o[i]) * &rho1 + &(r(&c2[i]) * &h_rho1)) + &(&rho2 * &r(&(&c0[i] * &beta - &c1[i] * &alpha))))
        });
        (volume, flux)
    })
}

/// Exact first moments `∫ x_i dV` (model frame) and six times the volume of
/// each solid, by the divergence theorem with the field `x_i x / 4` (its
/// divergence is `x_i`): a planar face contributes `o·(x × y)` times its chart
/// moments of area, a band a closed-form polynomial in height times π. The
/// volume, from the field `x / 3` on the same face terms, must equal
/// `volumes6` exactly, else `boolean/moment-volume-mismatch`; this checks the
/// orientation of every face term.
pub(super) fn moments(d: &Draft) -> Result<Vec<([MomentValue; 3], SurdPiValue)>> {
    let expected = surd_volumes6(d)?;
    let mut out = vec![];
    for (solid, expected) in d.solids.iter().zip(expected) {
        // flux[i] = ∮ x_i (x·n) dA and volume = ∮ x·n dA.
        let mut flux: [MomentValue; 3] = Default::default();
        let mut volume = MomentValue::default();
        for s in &solid.shells {
            for &fi in &d.shells[s.index()].faces {
                // Every strip (also a cylinder chart rectangle, whose volume
                // `volumes6` takes from the patch row: an independent route
                // for the check below) by its chart Green rows.
                if super::extrusion::strip(d, fi) {
                    let (m, f, _) = super::extrusion::strip_measures(d, fi)?;
                    volume.absorb(&f)?;
                    for i in 0..3 {
                        flux[i].absorb(&m[i])?;
                    }
                    continue;
                }
                // A cylinder or cone chart rectangle by its own closed form.
                if let Some(p) = super::patch::patch(d, fi)? {
                    let (m, v) = p.moment_flux()?;
                    let add = |mv: &mut MomentValue, v: &PiValue| -> Result<()> {
                        mv.rational = rad_guard(|| &mv.rational + &Radical::from(v.rational.clone()))?;
                        mv.pi += &v.pi;
                        Ok(())
                    };
                    add(&mut volume, &v)?;
                    for i in 0..3 {
                        add(&mut flux[i], &m[i])?;
                    }
                    continue;
                }
                if super::tube::band(d, fi)?.is_some() {
                    return Err(Refused("boolean/ssi-row-unavailable:moment/patch-or-tube"));
                }
                match band(d, fi)? {
                    Some(b) => {
                        let [c0, c1, c2] = b.frame.columns();
                        let o = b.frame.origin();
                        let k = cross(c0, c1);
                        let delta = dot(c2, &k);
                        let (alpha, beta) = (dot(o, &cross(c2, c0)), dot(o, &cross(c2, c1)));
                        let [m0, m1] = &b.radius;
                        // On P(h, t) = o + h c2 + rho(h)(cos t c0 + sin t c1),
                        // P·(P_h × P_t) = rho (g - alpha sin t + beta cos t) with
                        // the constant g = m1 o·k - delta m0.
                        let g = m1 * dot(o, &k) - &delta * m0;
                        // Integrals over [lo, hi] of h^(n-1), then of rho, h rho, rho^2.
                        let power = |n: i32| (b.hi.pow(n) - b.lo.pow(n)) / q(n.into());
                        let rho1 = m0 * power(1) + m1 * power(2);
                        let h_rho1 = m0 * power(2) + m1 * power(3);
                        let rho2 = m0 * m0 * power(1) + q(2) * m0 * m1 * power(2) + m1 * m1 * power(3);
                        // That normal points along -delta; `volumes6` orients
                        // the band by the face sense.
                        let sign = if b.forward == delta.is_negative() { q(1) } else { q(-1) };
                        volume.pi += &sign * q(2) * &g * &rho1;
                        for i in 0..3 {
                            let term = q(2) * &g * (&o[i] * &rho1 + &c2[i] * &h_rho1) + &rho2 * (&c0[i] * &beta - &c1[i] * &alpha);
                            flux[i].pi += &sign * term;
                        }
                    }
                    None => {
                        let plane = d.surfaces[d.faces[fi.index()].surface.index()].carrier.plane()?;
                        let (x, y) = (&plane.x, plane.y());
                        let offset = dot(&plane.o, &cross(x, &y));
                        // Chart moments of area: area, ∫u, ∫v.
                        let mut chart: [MomentValue; 3] = Default::default();
                        for lp in loop_pieces(d, fi) {
                            for piece in &lp {
                                match piece.carrier() {
                                    Carrier::Line => {
                                        let (a, c) = (piece.ends()[0].coordinates(), piece.ends()[1].coordinates());
                                        let wedge = &a[0] * &c[1] - &a[1] * &c[0];
                                        chart[0].rational = &chart[0].rational + &wedge / q(2);
                                        for k in 0..2 {
                                            chart[k + 1].rational = &chart[k + 1].rational + &wedge * (&a[k] + &c[k]) / q(6);
                                        }
                                    }
                                    Carrier::Circle(c) if !c.full => {
                                        // A partial arc: chord plus circular
                                        // segment, any sweep.
                                        let m = super::extrusion::chart_moments_piece(piece)?;
                                        for k in 0..3 {
                                            chart[k].absorb(&m[k])?;
                                        }
                                    }
                                    Carrier::Circle(c) if c.full && lp.len() == 1 => {
                                        let r2 = c.r2.rational().ok_or(Refused("boolean/ssi-row-unavailable:circle/partial-volume"))?;
                                        let r2 = if c.ccw { r2 } else { -r2 };
                                        // The disc's moments r² π · c need a rational centre; a
                                        // Q(√d) centre refuses by its own name.
                                        let centre = c.c.rat().map_err(|e| Refused(e.name()))?;
                                        chart[0].pi += &r2;
                                        for k in 0..2 {
                                            chart[k + 1].pi += &r2 * &centre[k];
                                        }
                                    }
                                    Carrier::Circle(_) => return Err(Refused("boolean/ssi-row-unavailable:circle/partial-volume")),
                                    Carrier::BSpline(_) => return Err(Refused("boolean/ssi-row-unavailable:curve/volume")),
                                }
                            }
                        }
                        let [area, mu, mv] = &chart;
                        volume.add_scaled(area, &offset)?;
                        for i in 0..3 {
                            let (oi, xi, yi) = (&plane.o[i], &x[i], &y[i]);
                            for (part, scale) in [(area, oi), (mu, xi), (mv, yi)] {
                                flux[i].add_scaled(part, &(scale * &offset))?;
                            }
                        }
                    }
                }
            }
        }
        // 6 V = 2 ∮ x·n.
        let six = volume.surd()?.scaled(&q(2))?;
        if six != expected {
            return Err(Refused("boolean/moment-volume-mismatch"));
        }
        let mut moments: [MomentValue; 3] = Default::default();
        for (m, f) in moments.iter_mut().zip(&flux) {
            m.add_scaled(f, &(Q::one() / q(4)))?;
        }
        out.push((moments, six));
    }
    Ok(out)
}

enum Location {
    Outside,
    Inside,
    Boundary,
}
fn vertex_coordinates(p: &VertexKey) -> [Radical; 3] {
    match p {
        VertexKey::Rational(p) => p.clone().map(Radical::from),
        VertexKey::Quadratic(p) => p.coordinates().clone(),
        VertexKey::Real(p)=>p.clone(),
    }
}
/// Whether an exact point lies in the closed face (interior or boundary).
pub(super) fn closed_face_contains(d: &Draft, fi: FaceId, p: &super::RPoint) -> Result<bool> {
    Ok(!matches!(locate(d, fi, &VertexKey::Real(p.clone()))?, Location::Outside))
}
fn locate(d: &Draft, fi: FaceId, p: &VertexKey) -> Result<Location> {
    let carrier = &d.surfaces[d.faces[fi.index()].surface.index()].carrier;
    if !carrier.contains_vertex(p)? {
        return Ok(Location::Outside);
    }
    // G14: a closed sphere holds every point of its carrier. Membership in
    // a trimmed stereographic patch is not admitted yet.
    if super::stereo::is_patch(d, fi) {
        if d.faces[fi.index()].loops.is_empty() {
            return Ok(Location::Inside);
        }
        return Err(Refused("boolean/ssi-row-unavailable:sphere/patch-locate"));
    }
    if let Some(patch) = super::patch::patch(d, fi)? {
        return Ok(match patch.locate(p)? {
            super::patch::Location::Outside => Location::Outside,
            super::patch::Location::Inside => Location::Inside,
            super::patch::Location::Boundary => Location::Boundary,
        });
    }
    if super::extrusion::strip(d, fi) {
        // Exact winding of the chart point in the strip's chart loop.
        return match super::extrusion::strip_chart_of(carrier, &vertex_coordinates(p))? {
            Some(uv) => locate_chart(d, fi, uv),
            None => Ok(Location::Outside),
        };
    }
    if let Some(t) = super::tube::radical_band(d, fi)? {
        return Ok(match t.locate(p)? {
            super::tube::Location::Outside => Location::Outside,
            super::tube::Location::Inside => Location::Inside,
            super::tube::Location::Boundary => Location::Boundary,
        });
    }
    match radical_band(d, fi)? {
        Some(b) => {
            let z = match p {
                VertexKey::Rational(p) => Radical::from(b.frame.inverse().point(p)[2].clone()),
                VertexKey::Quadratic(p) => p.mapped(&b.frame.inverse())?.coordinates()[2].clone(),
                VertexKey::Real(p)=>super::algebraic::mapped(p,&b.frame.inverse())[2].clone(),
            };
            let (lo, hi) = rad_guard(|| (z.cmp(&b.lo), z.cmp(&b.hi)))?;
            if lo == Ordering::Less || hi == Ordering::Greater {
                Ok(Location::Outside)
            } else if lo == Ordering::Equal || hi == Ordering::Equal {
                Ok(Location::Boundary)
            } else {
                Ok(Location::Inside)
            }
        }
        None => {
            if let Some(b) = flat_band(d, fi)? {
                return b.locate(p);
            }
            let plane = carrier.plane()?;
            let axes = [&plane.x, &plane.y()];
            let p = vertex_coordinates(p);
            let uv = std::array::from_fn(|i| {
                let v = (0..3).fold(Radical::from(Q::zero()), |a, k| {
                    a + (&p[k] - &Radical::from(plane.o[k].clone())) * &axes[i][k]
                });
                v / dot(axes[i], axes[i])
            });
            locate_chart(d, fi, uv)
        }
    }
}
/// Location of a chart point by exact winding in the face's chart loops.
fn locate_chart(d: &Draft, fi: FaceId, uv: [Radical; 2]) -> Result<Location> {
    let p = ExactPoint::from_coordinates(uv).map_err(|e| Refused(e.name()))?;
    let mut winding = 0;
    for lp in loop_pieces(d, fi) {
        for piece in &lp {
            if piece.contains(&p).map_err(|e| Refused(e.name()))? {
                return Ok(Location::Boundary);
            }
        }
        winding += Cycle::new(lp).winding(&p).map_err(|e| Refused(e.name()))?;
    }
    Ok(if winding == 0 { Location::Outside } else { Location::Inside })
}
/// Rational proposal levels at `x + offset` for a witness grid: the value
/// itself when rational, else rationals bracketing its certified enclosure.
/// Proposals only; every witness is admitted by an exact `locate`.
fn proposal_levels(x: &Radical, offset: &Q) -> Result<Vec<Q>> {
    if let Some(v) = x.rational() {
        return Ok(vec![v + offset]);
    }
    let iv = x.enclosure().map_err(|e| Refused(e.name()))?;
    let f = |v: f64| Q::from_float(v).ok_or(Refused("boolean/ssi-row-unavailable:radical/bound-range"));
    Ok(vec![f(iv.lo())? + offset, f(iv.hi())? + offset])
}
/// Rational interior points of a strip: a grid between the chart levels of
/// its loop (irrational levels bracketed by rationals), each admitted by an
/// exact `locate`; the chart point lifts to a rational carrier point.
fn strip_witnesses(d: &Draft, fi: FaceId) -> Result<Vec<Point>> {
    let Carrier3::Cylinder(cy) = &d.surfaces[d.faces[fi.index()].surface.index()].carrier else {
        return Err(Refused("model/extrusion-strip-carrier"));
    };
    let mut levels: [Vec<Q>; 2] = [vec![], vec![]];
    for lp in loop_pieces(d, fi) {
        for piece in lp {
            for end in piece.ends() {
                let c = end.coordinates();
                for i in 0..2 {
                    levels[i].extend(proposal_levels(&c[i], &Q::zero())?);
                }
            }
        }
    }
    for l in &mut levels {
        l.sort();
        l.dedup();
    }
    if levels[0].len() * levels[1].len() > 4096 {
        return Err(Refused("boolean/budget-exceeded:face-witness"));
    }
    let mut out = vec![];
    for x in levels[0].windows(2) {
        for y in levels[1].windows(2) {
            for denominator in [2, 3, 5] {
                let uv = [&x[0] + (&x[1] - &x[0]) / q(denominator), &y[0] + (&y[1] - &y[0]) / q(denominator)];
                let p = super::algebraic::rational(&super::extrusion::strip_point(cy, &uv.map(Radical::from)))
                    .ok_or(Refused("boolean/contract-violation:strip/irrational-witness"))?;
                if matches!(locate(d, fi, &VertexKey::Rational(p.clone()))?, Location::Inside) {
                    out.push(p);
                }
            }
        }
    }
    if out.is_empty() {
        return Err(Refused("boolean/budget-exceeded:face-witness"));
    }
    Ok(out)
}

/// Rational heights strictly inside `(lo, hi)`: the thirds and the middle
/// for rational ends; for Q(√d) ends, binary64 guesses at those fractions,
/// each admitted only by an exact comparison with both ends.
pub(super) fn rational_heights(lo: &Radical, hi: &Radical) -> Result<Vec<Q>> {
    let fractions = [Q::one() / q(2), Q::one() / q(3), q(2) / q(3)];
    if let (Some(lo), Some(hi)) = (lo.rational(), hi.rational()) {
        return Ok(fractions.iter().map(|f| &lo + (&hi - &lo) * f).collect());
    }
    let (a, b) = rad_guard(|| (lo.enclosure(), hi.enclosure()))?;
    let (a, b) = (a.map_err(|e| Refused(e.name()))?.m, b.map_err(|e| Refused(e.name()))?.m);
    let mut out = vec![];
    for f in [0.5, 1. / 3., 2. / 3., 0.25, 0.75] {
        let Some(h) = Q::from_float(a + (b - a) * f) else { continue };
        let x = Radical::from(h.clone());
        if rad_guard(|| &x > lo && &x < hi)? {
            out.push(h);
        }
    }
    if out.is_empty() {
        return Err(Refused("boolean/budget-exceeded:face-witness"));
    }
    Ok(out)
}
fn witnesses(d: &Draft, fi: FaceId) -> Result<Vec<Point>> {
    let carrier = &d.surfaces[d.faces[fi.index()].surface.index()].carrier;
    if let Some(p) = super::patch::patch(d, fi)? {
        return Ok(p.witnesses());
    }
    if super::extrusion::strip(d, fi) {
        return strip_witnesses(d, fi);
    }
    if let Some(t) = super::tube::radical_band(d, fi)? {
        return t.witnesses();
    }
    match radical_band(d, fi)? {
        // A carrier with a Q(√d) meridian has no rational chart point; its
        // outward sense is proved through an adjacent face (audit_outward).
        Some(b) if b.quadratic_carrier() => Ok(vec![]),
        Some(b) => {
            let heights = rational_heights(&b.lo, &b.hi)?;
            let mut out = vec![];
            for t in [
                Q::zero(),
                Q::one() / q(2),
                -Q::one() / q(2),
                Q::one() / q(3),
                -Q::one() / q(3),
            ] {
                for h in &heights {
                    out.push(carrier.chart_point(Patch::First, &[t.clone(), h.clone()])?);
                }
            }
            Ok(out)
        }
        None => {
            if let Some(b) = flat_band(d, fi)? {
                return b.witnesses();
            }
            let plane = carrier.plane()?;
            let mut levels: [Vec<Q>; 2] = [vec![], vec![]];
            for lp in loop_pieces(d, fi) {
                for piece in lp {
                    for end in piece.ends() {
                        let p = end.coordinates();
                        for i in 0..2 {
                            levels[i].extend(proposal_levels(&p[i], &Q::zero())?);
                        }
                    }
                    match piece.carrier() {
                        Carrier::Circle(c) => {
                            // Extremes of the circle: rational where the
                            // radius and centre are, else bracketed.
                            let r = match wonky_curve::numeric::exact_root(&c.r2) {
                                Some(r) => r,
                                None => {
                                    let iv = c.r2.enclosure().map_err(|e| Refused(e.name()))?;
                                    Q::from_float(iv.hi().sqrt()).ok_or(Refused("boolean/ssi-row-unavailable:radical/bound-range"))?
                                }
                            };
                            let centre = c.c.coordinates();
                            for i in 0..2 {
                                for offset in [-r.clone(), Q::zero(), r.clone()] {
                                    levels[i].extend(proposal_levels(&centre[i], &offset)?);
                                }
                            }
                        }
                        Carrier::Line => {}
                        Carrier::BSpline(_) => {
                            return Err(Refused("boolean/ssi-row-unavailable:spline/witness"))
                        }
                    }
                }
            }
            for l in &mut levels {
                l.sort();
                l.dedup();
            }
            if levels[0].len() * levels[1].len() > 4096 {
                return Err(Refused("boolean/budget-exceeded:face-witness"));
            }
            let mut out = vec![];
            for x in levels[0].windows(2) {
                for y in levels[1].windows(2) {
                    for denominator in [2, 3, 5] {
                        let uv = [
                            &x[0] + (&x[1] - &x[0]) / q(denominator),
                            &y[0] + (&y[1] - &y[0]) / q(denominator),
                        ];
                        let p = plane.point(&uv);
                        if matches!(
                            locate(d, fi, &VertexKey::Rational(p.clone()))?,
                            Location::Inside
                        ) {
                            out.push(p);
                        }
                    }
                }
            }
            if out.is_empty() {
                return Err(Refused("boolean/budget-exceeded:face-witness"));
            }
            Ok(out)
        }
    }
}

/// Ray hits `w + t·direction`, `t ≥ 0`, inside a band of a cone with a Q(√s)
/// meridian `L(z) = b + k z`. With `L = P + √s·Q` and `R = x² + y²` along the
/// ray (rational polynomials), the cone and its conjugate are the factors of
/// the rational quartic `(R − P² − sQ²)² − 4s·P²Q²`; its real roots are
/// isolated exactly and each condition (own factor, nappe `L > 0`, height
/// window in Q(√·)) is the sign of rational polynomials at the root. A
/// multiple root or a root on a band end is ambiguous: `None`.
fn quadratic_cone_hits(b: &RadicalBand, w: &Point, direction: &Point, w_on_carrier_counts: bool) -> Result<Option<usize>> {
    use wonky_alg::{isolate_real_roots, Limits, Polynomial, Sign};
    let err = |_| Refused("boolean/budget-exceeded:cone-ray");
    let inverse = b.frame.inverse();
    let l0 = inverse.point(w);
    let m = inverse.vector(direction);
    let parts = |x: &Radical| x.parts().ok_or(Refused("blend/number-class-exceeded:cone-ring"));
    let (b0, b1, rb) = parts(&b.radius[0])?;
    let (k0, mut k1, rk) = parts(&b.radius[1])?;
    if !b1.is_zero() && !k1.is_zero() && rb != rk {
        // One field, two radicand representatives: √rk = √rb · √(rk/rb).
        let ratio = exact_root(&(&rk / &rb)).ok_or(Refused("blend/number-class-exceeded:cone-ring"))?;
        k1 *= ratio;
    }
    let s = if !b1.is_zero() { rb } else { rk };
    let mul = |a: &[Q], c: &[Q]| {
        let mut out = vec![Q::zero(); a.len() + c.len() - 1];
        for (i, x) in a.iter().enumerate() {
            for (j, y) in c.iter().enumerate() {
                out[i + j] += x * y;
            }
        }
        out
    };
    let add = |a: &[Q], c: &[Q], scale: &Q| {
        let mut out = vec![Q::zero(); a.len().max(c.len())];
        for (i, x) in a.iter().enumerate() {
            out[i] += x;
        }
        for (i, x) in c.iter().enumerate() {
            out[i] += x * scale;
        }
        out
    };
    let lin = |i: usize| vec![l0[i].clone(), m[i].clone()];
    let z = lin(2);
    let p = add(&[b0.clone()], &z.iter().map(|c| c * &k0).collect::<Vec<_>>(), &Q::one());
    let qq = add(&[b1.clone()], &z.iter().map(|c| c * &k1).collect::<Vec<_>>(), &Q::one());
    let r = add(&mul(&lin(0), &lin(0)), &mul(&lin(1), &lin(1)), &Q::one());
    let g = add(&add(&r, &mul(&p, &p), &-Q::one()), &mul(&qq, &qq), &-s.clone());
    let h = mul(&p, &qq);
    let f = add(&mul(&g, &g), &mul(&h, &h), &(-q(4) * &s));
    if f.iter().all(Q::is_zero) {
        return Ok(None);
    }
    let poly = |c: Vec<Q>| Polynomial::new(c).map_err(err);
    let limits = Limits::default();
    let roots = isolate_real_roots(&poly(f)?, limits).map_err(err)?;
    let ord = |s: Sign| match s {
        Sign::Negative => Ordering::Less,
        Sign::Zero => Ordering::Equal,
        Sign::Positive => Ordering::Greater,
    };
    let identity = poly(vec![Q::zero(), Q::one()])?;
    let (gp, hp, pp, qp) = (poly(g)?, poly(h)?, poly(p.clone())?, poly(qq.clone())?);
    let p2_minus_sq2 = poly(add(&mul(&p, &p), &mul(&qq, &qq), &-s.clone()))?;
    // sign(X(t) − c·√r) at a root, for a rational polynomial X.
    let mut ends = vec![];
    for e in [&b.lo, &b.hi] {
        let (a, c, r) = e.parts().ok_or(Refused("blend/number-class-exceeded:cone-ring"))?;
        let x = add(&z, &[a], &-Q::one());
        let square = poly(add(&mul(&x, &x), &[&c * &c * &r], &-Q::one()))?;
        ends.push((poly(x)?, square, c, r));
    }
    let mut hits = 0;
    for root in roots {
        let at = |x: &Polynomial| root.sign_at(x, limits).map(ord).map_err(err);
        let position = at(&identity)?;
        if position == Ordering::Less {
            continue;
        }
        let combined = |x: Ordering, c: &Q, r: &Q, x2_minus: Result<Ordering>| -> Result<Ordering> {
            let cs = c.cmp(&Q::zero());
            if cs == Ordering::Equal || r.is_zero() {
                return Ok(x);
            }
            if x == Ordering::Equal {
                return Ok(cs.reverse());
            }
            if x != cs {
                return Ok(x);
            }
            Ok(match x2_minus? {
                Ordering::Greater => x,
                Ordering::Equal => Ordering::Equal,
                Ordering::Less => cs.reverse(),
            })
        };
        // Own factor: G = √s·H (both zero: on both factors).
        let own = at(&gp)? == at(&hp)?;
        // Nappe: L = P + √s·Q > 0.
        let (ps, qs) = (at(&pp)?, at(&qp)?);
        let nappe = if ps != Ordering::Less && qs != Ordering::Less {
            ps.max(qs)
        } else if ps != Ordering::Greater && qs != Ordering::Greater {
            ps.min(qs)
        } else {
            match at(&p2_minus_sq2)? {
                Ordering::Greater => ps,
                Ordering::Less => qs,
                Ordering::Equal => Ordering::Equal,
            }
        };
        let mut window = [Ordering::Equal; 2];
        for (i, (x, square, c, r)) in ends.iter().enumerate() {
            window[i] = combined(at(x)?, c, r, at(square))?;
        }
        let location = if !own || nappe != Ordering::Greater || window[0] == Ordering::Less || window[1] == Ordering::Greater {
            Location::Outside
        } else if window[0] == Ordering::Equal || window[1] == Ordering::Equal {
            Location::Boundary
        } else {
            Location::Inside
        };
        if position == Ordering::Equal {
            if w_on_carrier_counts || matches!(location, Location::Outside) {
                continue;
            }
            return Ok(None);
        }
        match location {
            Location::Outside => {}
            Location::Boundary => return Ok(None),
            Location::Inside => {
                if root.multiplicity() > 1 {
                    return Ok(None);
                }
                hits += 1;
            }
        }
    }
    Ok(Some(hits))
}

/// Polynomial ray roots, including the second hit on the starting curved
/// face. A tangent or boundary hit chooses another exact rational witness.
fn ray_hits(
    d: &Draft,
    fi: FaceId,
    start: FaceId,
    w: &Point,
    direction: &Point,
) -> Result<Option<usize>> {
    if let Some(p) = super::patch::patch(d, fi)? {
        return p.hits(w, direction, fi == start);
    }
    if let Carrier3::Torus(_) = &d.surfaces[d.faces[fi.index()].surface.index()].carrier {
        let t = super::tube::radical_band(d, fi)?.ok_or(Refused("model/g3-torus-band"))?;
        return t.torus_hits(w, direction, fi == start);
    }
    if let Carrier3::Cone(c) = &d.surfaces[d.faces[fi.index()].surface.index()].carrier {
        if !c.is_rational() {
            let b = radical_band(d, fi)?.ok_or(Refused("boolean/ssi-row-unavailable:cone/quadratic-non-band"))?;
            return quadratic_cone_hits(&b, w, direction, fi == start);
        }
    }
    let implicit = d.surfaces[d.faces[fi.index()].surface.index()]
        .carrier
        .implicit()?;
    let c = implicit.evaluate(w);
    let p: Point = std::array::from_fn(|i| &w[i] + &direction[i]);
    let m: Point = std::array::from_fn(|i| &w[i] - &direction[i]);
    let (p, m) = (implicit.evaluate(&p), implicit.evaluate(&m));
    let b = (&p - &m) / q(2);
    let a = (p + m) / q(2) - &c;
    let mut roots: Vec<(Radical, bool)> = vec![];
    if a.is_zero() {
        if b.is_zero() {
            return Ok(if c.is_zero() { None } else { Some(0) });
        }
        roots.push((Radical::from(-c / b), false));
    } else {
        let discriminant = &b * &b - q(4) * &a * &c;
        if discriminant.is_negative() {
            return Ok(Some(0));
        }
        if discriminant.is_zero() {
            roots.push((Radical::from(-&b / (q(2) * &a)), true));
        } else {
            for sign in [-1, 1] {
                let root = Radical::quadratic(
                    -&b / (q(2) * &a),
                    q(sign) / (q(2) * &a),
                    discriminant.clone(),
                )
                .map_err(|e| Refused(e.name()))?;
                roots.push((root, false));
            }
        }
    }
    let mut hits = 0;
    for (t, tangent) in roots {
        match t.cmp(&Radical::from(Q::zero())) {
            Ordering::Less => continue,
            Ordering::Equal => {
                // The ray origin may lie on the infinite carrier while
                // lying outside this face's exact trim. Such a root is not
                // a boundary hit, and must not poison every ray direction.
                if fi == start
                    || matches!(locate(d, fi, &VertexKey::Rational(w.clone()))?, Location::Outside)
                {
                    continue;
                } else {
                    return Ok(None);
                }
            }
            Ordering::Greater => {}
        }
        let (base, offset, radicand) = t
            .parts()
            .ok_or(Refused("boolean/vertex-identity-undecided"))?;
        let p = QuadraticPoint3::new(
            std::array::from_fn(|i| &w[i] + &direction[i] * &base),
            direction.clone().map(|d| d * &offset),
            radicand,
        )?
        .key();
        match locate(d, fi, &p)? {
            Location::Outside => {}
            Location::Boundary => return Ok(None),
            Location::Inside => {
                if tangent {
                    return Ok(None);
                }
                hits += 1;
            }
        }
    }
    Ok(Some(hits))
}
pub(super) fn audit_outward(d: &Draft) -> Result<()> {
    for v in surd_volumes6(d)? {
        if v.sign()? != Ordering::Greater {
            return Err(Refused("model/g8-volume"));
        }
    }
    for solid in &d.solids {
        let faces: Vec<_> = solid
            .shells
            .iter()
            .flat_map(|s| d.shells[s.index()].faces.iter().copied())
            .collect();
        // Faces on a carrier with a Q(√d) meridian have no rational witness.
        // Their sense follows from an adjacent proved face: the shell is
        // coherently oriented (G7: opposite uses of every edge; the band
        // audit binds the sense of each band loop to the face sense), so
        // across a shared edge the outward sides agree.
        let mut deferred = vec![];
        let mut proven = std::collections::BTreeSet::new();
        for &fi in &faces {
            let carrier = &d.surfaces[d.faces[fi.index()].surface.index()].carrier;
            let mut proved = false;
            let points = witnesses(d, fi)?;
            let quadratic = match carrier {
                Carrier3::Rotated(_) => return Err(Refused("model/rotated/periodic-consumer")),
                Carrier3::TranslatedCylinder(_) => return Err(Refused("model/translated-cylinder/periodic-consumer")),
                Carrier3::Cone(_) => radical_band(d, fi)?.is_some_and(|b| b.quadratic_carrier()),
                Carrier3::Torus(_) | Carrier3::Sphere(_) => super::tube::radical_band(d, fi)?.is_some_and(|b| b.quadratic_carrier()),
                Carrier3::Plane(_) => flat_band(d, fi)?.is_some(),
                Carrier3::RadicalPlane(_) | Carrier3::Cylinder(_) => false,
            };
            if points.is_empty() && quadratic {
                deferred.push(fi);
                continue;
            }
            for w in points {
                let mut direction = super::tube::gradient(carrier, &w)?;
                if !d.faces[fi.index()].forward {
                    direction = direction.map(|x| -x);
                }
                if direction.iter().all(Q::is_zero) {
                    return Err(Refused("boolean/chart-singularity:apex"));
                }
                let mut total = 0;
                let mut decided = true;
                for &other in &faces {
                    match ray_hits(d, other, fi, &w, &direction)? {
                        Some(hits) => total += hits,
                        None => {
                            decided = false;
                            break;
                        }
                    }
                }
                if decided {
                    if total % 2 != 0 {
                        return Err(Refused("model/g8-inward-face"));
                    }
                    proved = true;
                    break;
                }
            }
            if !proved {
                return Err(Refused("boolean/budget-exceeded:outward-witness"));
            }
            proven.insert(fi);
        }
        let edges = |fi: FaceId| -> std::collections::BTreeSet<super::EdgeId> {
            d.faces[fi.index()].loops.iter()
                .flat_map(|l| d.loops[l.index()].coedges.iter().map(|c| d.coedges[c.index()].edge))
                .collect()
        };
        while !deferred.is_empty() {
            let before = deferred.len();
            deferred.retain(|&fi| {
                let own = edges(fi);
                let adjacent = proven.iter().any(|&g: &FaceId| own.intersection(&edges(g)).next().is_some());
                if adjacent {
                    proven.insert(fi);
                }
                !adjacent
            });
            if deferred.len() == before {
                return Err(Refused("boolean/budget-exceeded:outward-witness"));
            }
        }
    }
    Ok(())
}


/// Exact solid membership of a rational construction point. Ring trims are
/// located by their own-frame heights; planar trims use exact winding. No
/// tessellation or normalized binary64 axis participates.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Membership { Inside, Outside, Boundary(FaceId) }

pub(super) fn membership(d: &Draft, w: &Point, reverse: bool) -> Result<Membership> {
    if let Some(m)=super::extrusion::membership(d,w)? {return Ok(m);}
    let mut boundary = None;
    let directions = [[2,3,5],[3,-5,7],[-5,7,11],[7,11,-13],
        [11,-13,17],[-13,17,19],[17,19,-23],[19,-23,29],
        [-23,29,31],[29,31,-37],[31,-37,41],[-37,41,43]];
    for solid in &d.solids {
        let faces: Vec<_> = solid.shells.iter().flat_map(|s|d.shells[s.index()].faces.iter().copied()).collect();
        let mut on = None;
        for &fi in &faces {
            if !matches!(locate(d,fi,&VertexKey::Rational(w.clone()))?, Location::Outside) {
                if on.is_some() {return Err(Refused("boolean/contract-violation:classify/witness-on-edge"));}
                on=Some(fi);
            }
        }
        if on.is_some() {boundary=on; continue;}
        let mut decided=false;
        for i in 0..directions.len() {
            let direction=directions[if reverse {directions.len()-1-i}else{i}].map(q);
            let mut hits=0;let mut ambiguous=false;
            for &fi in &faces {
                match ray_hits(d,fi,FaceId(u32::MAX),w,&direction)? {
                    Some(n)=>hits+=n,
                    None=>{ambiguous=true;break;}
                }
            }
            if ambiguous {continue;}
            if hits%2==1 {return Ok(Membership::Inside);}
            decided=true;break;
        }
        if !decided {return Err(Refused("boolean/budget-exceeded:classification-ray"));}
    }
    Ok(boundary.map(Membership::Boundary).unwrap_or(Membership::Outside))
}

impl RevolutionBand {
    /// Surface Jacobian divided by radius for a rational orthogonal radial
    /// chart. A nonrational metric remains a named measure capability gap.
    pub fn area_factor(&self) -> Result<Q> {
        exact_root(&self.area_factor_squared()?).ok_or(
            Refused("boolean/ssi-row-unavailable:revolution/non-rational-area"),
        )
    }
    /// The square of `area_factor`: rational for every orthogonal chart, also
    /// when the factor itself (a cone's slant) is irrational.
    pub fn area_factor_squared(&self) -> Result<Q> {
        let [x, y, z] = self.frame.columns();
        let radial = dot(x, x);
        if dot(y, y) != radial
            || !dot(x, y).is_zero()
            || !dot(x, z).is_zero()
            || !dot(y, z).is_zero()
        {
            return Err(Refused(
                "boolean/ssi-row-unavailable:revolution/non-orthogonal-area",
            ));
        }
        Ok(&radial * (&radial * &self.radius[1] * &self.radius[1] + dot(z, z)))
    }
}
/// An area term `value * sqrt(radicand)`: a cone band whose slant factor or
/// a plane whose chart Jacobian is irrational. Exact; only
/// `Model::area_enclosure` reads it.
pub struct RootTerm {
    pub value: PiValue,
    pub radicand: Q,
}
/// Rational bounds `lo <= sqrt(r) <= hi` with `hi - lo <= 2^-bits / denom(r)`.
pub(super) fn sqrt_bounds(r: &Q, bits: usize) -> Result<(Q, Q)> {
    if r.is_negative() {
        return Err(Refused("model/negative-radicand"));
    }
    let n = (r.numer() * r.denom()) << (2 * bits);
    let root = n.sqrt();
    let unit = r.denom().clone() << bits;
    Ok((Q::new(root.clone(), unit.clone()), Q::new(root + 1, unit)))
}
pub(super) fn planar_area(d: &Draft, fi: FaceId) -> Result<PiValue> {
    if let Some(b) = flat_band(d, fi)? {
        let area = rad_guard(|| &b.outer * &b.outer - &b.inner.as_ref().map(|r| r * r).unwrap_or_default())?;
        let area = area.rational().ok_or(Refused("boolean/ssi-row-unavailable:plane/quadratic-area"))?;
        // As the planar chart area of a coherent face: positive.
        return Ok(PiValue { pi: area, ..PiValue::default() });
    }
    let RootTerm { value, radicand } = planar_area_term(d, fi)?;
    let factor = exact_root(&radicand).ok_or(Refused(
        "boolean/ssi-row-unavailable:plane/non-rational-area",
    ))?;
    Ok(PiValue { rational: &factor * value.rational, pi: factor * value.pi, pi2: Q::zero() })
}
/// The signed chart area of a planar face and its chart's squared Jacobian.
fn planar_area_term(d: &Draft, fi: FaceId) -> Result<RootTerm> {
    let f = &d.faces[fi.index()];
    let p = d.surfaces[f.surface.index()].carrier.plane()?;
    let jac = cross(&p.x, &p.y());
    let sign = if f.forward { q(1) } else { q(-1) };
    let mut area = PiValue::default();
    for pieces in loop_pieces(d, fi) {
        let value=super::extrusion::green(&pieces)?;
        area.rational+=&sign*value.rational;
        area.pi+=&sign*value.pi;
    }
    Ok(RootTerm { value: area, radicand: dot(&jac, &jac) })
}
/// The exact area of one face (planar faces signed by their sense, as the
/// solid sums use them).
pub(super) fn face_area(d: &Draft, fi: FaceId) -> Result<PiValue> {
    let mut area = PiValue::default();
    if let Some(p) = super::patch::patch(d, fi)? {
        let term = p.area()?;
        area.pi += term.pi;
        area.pi2 += term.pi2;
    } else if super::extrusion::strip(d,fi) {
        let term=super::extrusion::strip_area(d,fi)?;area.rational+=term.rational;area.pi+=term.pi;
    } else if let Some(t) = super::tube::band(d, fi)? {
        let term = t.area()?;
        area.pi += term.pi;
        area.pi2 += term.pi2;
    } else if let Some(b) = band(d, fi)? {
        let lo = &b.radius[0] + &b.radius[1] * &b.lo;
        let hi = &b.radius[0] + &b.radius[1] * &b.hi;
        area.pi += (lo + hi) * (&b.hi - &b.lo) * b.area_factor()?;
    } else {
        let term = planar_area(d, fi)?;
        area.rational += term.rational;
        area.pi += term.pi;
    }
    Ok(area)
}
/// The signed chart area of a planar face in the general slots, and its
/// chart's squared Jacobian.
fn planar_area_surd(d: &Draft, fi: FaceId) -> Result<(SurdPiValue, Q)> {
    let f = &d.faces[fi.index()];
    let p = d.surfaces[f.surface.index()].carrier.plane()?;
    let jac = cross(&p.x, &p.y());
    let sign = if f.forward { q(1) } else { q(-1) };
    let mut area = SurdPiValue::default();
    for pieces in loop_pieces(d, fi) {
        area.add(&super::extrusion::green_surd(&pieces)?.scaled(&sign)?)?;
    }
    Ok((area, dot(&jac, &jac)))
}
/// The exact area of one face in the general slots: `face_area`, plus strips
/// and planar faces whose sweeps leave the quarter grid.
pub(super) fn face_area_surd(d: &Draft, fi: FaceId) -> Result<SurdPiValue> {
    if super::extrusion::strip(d, fi) && super::patch::patch(d, fi)?.is_none() {
        let (_, _, area) = super::extrusion::strip_measures(d, fi)?;
        let mut out = SurdPiValue::default();
        super::extrusion::absorb(&mut out, &area)?;
        return Ok(out);
    }
    let plane = matches!(d.surfaces[d.faces[fi.index()].surface.index()].carrier, Carrier3::Plane(_));
    if plane && flat_band(d, fi)?.is_none() {
        let (area, radicand) = planar_area_surd(d, fi)?;
        let factor = exact_root(&radicand).ok_or(Refused("boolean/ssi-row-unavailable:plane/non-rational-area"))?;
        return area.scaled(&factor);
    }
    if let Some((value, radicand)) = cone_surd_area(d, fi)? {
        let mut out = SurdPiValue::default();
        out.add_scaled(&Radical::quadratic(Q::zero(), Q::one(), radicand).map_err(|e| Refused(e.name()))?, &value)?;
        return Ok(out);
    }
    Ok(SurdPiValue::rational(face_area(d, fi)?))
}
/// A cone patch face whose area carries an irrational slant: `value * sqrt(radicand)`.
fn cone_surd_area(d: &Draft, fi: FaceId) -> Result<Option<(PiValue, Q)>> {
    match super::patch::patch(d, fi)? {
        Some(p) => p.surd_area(),
        None => Ok(None),
    }
}
pub(super) fn areas(d: &Draft) -> Result<Vec<PiValue>> {
    if let Some((p,t))=super::revolution_partial::product(d)? {
        let a=super::revolution_partial::measures_product(&p,&t)?;
        return Ok(vec![PiValue {rational:a.area_rational,pi:a.area_pi.rational().ok_or(Refused("revolve/non-rational-area-use-enclosure"))?,pi2:q(0)}]);
    }
    area_terms(d)?.into_iter().map(|(area, roots, general)| if !roots.is_empty() {
        Err(Refused("boolean/ssi-row-unavailable:revolution/non-rational-area"))
    } else if general != SurdPiValue::default() {
        Err(Refused("boolean/ssi-row-unavailable:measure/transcendental-angle"))
    } else {
        Ok(area)
    }).collect()
}
/// Closed-form metric area of each solid: rational plus pi terms, the faces
/// whose metric factor is the square root of a rational, and the strips and
/// planar faces whose sweeps leave the quarter grid (general slots).
pub(super) fn area_terms(d: &Draft) -> Result<Vec<(PiValue, Vec<RootTerm>, SurdPiValue)>> {
    d.solids
        .iter()
        .map(|solid| {
            let mut area = PiValue::default();
            let mut roots = Vec::new();
            let mut general = SurdPiValue::default();
            for shell in &solid.shells {
                for &fi in &d.shells[shell.index()].faces {
                    // A sphere band with Q(√d) ends (a ring at an irrational
                    // height): its zone height is p + q·√r.
                    if let Some(t) = super::tube::radical_band(d, fi)?.filter(|t| t.rational().is_none()) {
                        let (p, b, radicand) = t.sphere_area()?;
                        area.pi += p;
                        if !b.is_zero() {
                            roots.push(RootTerm { value: PiValue { pi: b, ..Default::default() }, radicand });
                        }
                        continue;
                    }
                    let revolution = matches!(d.surfaces[d.faces[fi.index()].surface.index()].carrier, Carrier3::Cylinder(_) | Carrier3::Cone(_));
                    if let Some(b) = if revolution { radical_band(d, fi)?.filter(|b| b.rational().is_none()) } else { None } {
                        let (p, b, radicand) = b.area_parts()?;
                        area.pi += p;
                        if !b.is_zero() {
                            roots.push(RootTerm { value: PiValue { pi: b, ..Default::default() }, radicand });
                        }
                        continue;
                    }
                    if super::extrusion::strip(d, fi) && super::patch::patch(d, fi)?.is_none() {
                        general.add(&face_area_surd(d, fi)?)?;
                        continue;
                    }
                    let rooted = super::patch::patch(d, fi)?.is_none()
                        && !super::extrusion::strip(d, fi)
                        && super::tube::band(d, fi)?.is_none()
                        && flat_band(d, fi)?.is_none();
                    if let Some((value, radicand)) = cone_surd_area(d, fi)? {
                        roots.push(RootTerm { value, radicand });
                    } else if !rooted {
                        let term = face_area(d, fi)?;
                        area.rational += term.rational;
                        area.pi += term.pi;
                        area.pi2 += term.pi2;
                    } else if let Some(b) = band(d, fi)? {
                        let lo = &b.radius[0] + &b.radius[1] * &b.lo;
                        let hi = &b.radius[0] + &b.radius[1] * &b.hi;
                        let coefficient = (lo + hi) * (&b.hi - &b.lo);
                        let radicand = b.area_factor_squared()?;
                        match exact_root(&radicand) {
                            Some(factor) => area.pi += coefficient * factor,
                            None => roots.push(RootTerm { value: PiValue { pi: coefficient, ..Default::default() }, radicand }),
                        }
                    } else {
                        let (value, radicand) = planar_area_surd(d, fi)?;
                        match (value.without_surd(), exact_root(&radicand)) {
                            (Ok(value), Some(factor)) => {
                                area.rational += &factor * value.rational;
                                area.pi += factor * value.pi;
                            }
                            (Ok(value), None) => roots.push(RootTerm { value, radicand }),
                            (Err(_), Some(factor)) => general.add(&value.scaled(&factor)?)?,
                            (Err(_), None) => return Err(Refused("boolean/ssi-row-unavailable:plane/non-rational-area")),
                        }
                    }
                }
            }
            Ok((area, roots, general))
        })
        .collect()
}
