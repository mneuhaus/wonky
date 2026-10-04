//! Tube bands: full-turn torus and sphere faces between latitude rings (F2,
//! fillets3d design §2.3; the torus data structure of boolean3d plan G20).
//!
//! **Atlas.** A tube carrier is charted by four half-angle patches: the
//! azimuth `u` (the two revolution patches, as for cylinders) times the tube
//! angle `v`, whose First patch is the outer half of the tube (cos θ ≥ 0) and
//! whose Second patch is the inner half. A band lies in one `v` patch; its
//! ring trims are `AtlasTrim::ring(t_v, ccw)` at their exact tube half-angle
//! `t_v`. A sphere is the tube with major radius 0 and uses only the First
//! `v` patch (a pole ends a cap, like a cone apex).
//!
//! **Sheets.** On a torus point, `S = |l|² + R² − a²` equals `2Rρ` on the own
//! sheet and `−2Rρ` on the mirrored one, so `S > 0` decides the sheet exactly;
//! a spindle torus (R < a) face uses the outer (apple) sheet only, and a band
//! whose inner half would pass the axis is refused.
//!
//! **Measures.** Flux of the position field through a full-turn tube band is
//! `2π ∫ρ(ρz' − zρ') dθ − π c_z [ρ²]`; with ring angles on the quarter grid
//! (t_v ∈ {−1, 0, 1}) it is exact in Q + Qπ + Qπ². Other torus ring angles
//! make the swept angle transcendental and refuse by name; sphere bands need
//! no angle (their R = 0 term vanishes).
use super::curved::{half_angle, Patch, Torus3};
use super::periodic::{AtlasTrim, PiValue, SurdPiValue};
use super::{Bounds, Carrier3, Curve3, Draft, FaceId, VertexKey};
use crate::{cross, dot, frame::Frame, Point, Refused, Result, Q};
use num_traits::{One, Signed, Zero};
use std::cmp::Ordering;
use wonky_alg::{isolate_real_roots, Limits, Polynomial, Sign};
use wonky_curve::{numeric::exact_root, radical::Radical, Carrier};

fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}

/// A full-turn tube band in its carrier frame.
#[derive(Clone, Debug)]
pub struct TubeBand {
    pub frame: Frame,
    /// Tube centre circle radius; zero for a sphere.
    pub major: Q,
    pub minor: Q,
    /// Tube-angle patch of the whole band.
    pub patch: Patch,
    /// Tube half-angle chart coordinates of the band ends, `lo < hi`.
    pub lo: Q,
    pub hi: Q,
    pub forward: bool,
}

/// A tube band whose major and band ends may lie in one quadratic field
/// Q(√d) (cone-rim fillets: the tube centre circle sits one radius off a
/// cone generator of irrational length, the cone spring at a tube angle with
/// a Q(√d) half-angle chart value). The minor stays rational. The audit is
/// the rational one evaluated in Q(√d); `band` keeps the rational view.
#[derive(Clone, Debug)]
pub struct RadicalTubeBand {
    pub frame: Frame,
    pub major: Radical,
    pub minor: Q,
    pub patch: Patch,
    pub lo: Radical,
    pub hi: Radical,
    pub forward: bool,
}
fn rad<T>(f: impl FnOnce() -> T) -> Result<T> {
    wonky_curve::radical::guard(f).map_err(|_| Refused("boolean/budget-exceeded:quadratic"))
}

/// Exact (cos θ, sin θ) of a ring of local radius² `rho2` at local height `z`
/// on the tube (`major`, `minor`). The own sheet is required on a torus.
fn ring_angle(major: &Radical, minor: &Q, rho2: &Radical, z: &Radical) -> Result<[Radical; 2]> {
    let cos = if major.is_zero() {
        let rho = rho2
            .quadratic_sqrt()
            .ok()
            .filter(|r| r.parts().is_some())
            .ok_or(Refused("boolean/ssi-row-unavailable:sphere/irrational-latitude"))?;
        rad(|| &rho / &Radical::from(minor.clone()))?
    } else {
        let s = rad(|| rho2 + &(z * z) + &(major * major) - Radical::from(minor * minor))?;
        if !s.is_positive() {
            return Err(Refused("model/g3-torus-mirrored-sheet"));
        }
        rad(|| (&s / &(major * &q(2)) - major) * &(Q::one() / minor))?
    };
    Ok([cos, rad(|| z * &(Q::one() / minor))?])
}
/// G14: the tube atlas trim the band audit expects for a latitude ring of
/// the sphere `s` (a ring about its frame's third column), used by a coedge
/// of sense `forward`. The Boolean writer charts ring-bounded sphere faces
/// with it, so they stay tube bands for every band consumer.
pub fn sphere_ring_trim(s: &super::Sphere3, c: &Curve3, forward: bool) -> Result<AtlasTrim> {
    let (circle_frame, offset, radius2) = match c {
        Curve3::Circle(k) => (k.frame()?, Radical::default(), Radical::from(k.radius2())),
        Curve3::RadicalCircle(k) => (&k.frame, k.height().clone(), rad(|| k.radius() * k.radius())?),
        Curve3::Line { .. } | Curve3::RadicalLine { .. } => return Err(Refused("model/g4-ring-on-open-curve")),
        Curve3::TranslatedCircle(_) => return Err(Refused("model/translated-circle/sphere-ring")),
    };
    let map = s.frame.relation_from(circle_frame).map;
    let [x, y, z] = map.columns();
    if !map.origin()[0].is_zero()
        || !map.origin()[1].is_zero()
        || !x[2].is_zero()
        || !y[2].is_zero()
        || (!offset.is_zero() && (!z[0].is_zero() || !z[1].is_zero()))
    {
        return Err(Refused("model/g3-ring-not-latitude"));
    }
    let positive = (&x[0] * &y[1] - &x[1] * &y[0]).is_positive();
    let rho2 = rad(|| &radius2 * &(&x[0] * &x[0] + &x[1] * &x[1]))?;
    let height = rad(|| Radical::from(map.origin()[2].clone()) + &offset * &z[2])?;
    let angle = ring_angle(&Radical::default(), s.radius(), &rho2, &height)?;
    AtlasTrim::radical_ring(chart_of(Patch::First, &angle)?, forward == positive)
}
fn chart_of(patch: Patch, [c, s]: &[Radical; 2]) -> Result<Radical> {
    let sign = patch.sign();
    let d = rad(|| Radical::from(Q::one()) + c * &sign)?;
    if d.is_zero() {
        return Err(Refused("model/g3-torus-patch"));
    }
    rad(|| s * &sign / &d)
}

/// The tube band of a torus or sphere face; `Ok(None)` for every other
/// carrier. Torus and sphere faces that are not such a band refuse by name.
pub(super) fn band(d: &Draft, fi: FaceId) -> Result<Option<TubeBand>> {
    match radical_band(d, fi)? {
        None => Ok(None),
        Some(b) => b.rational().map(Some).ok_or(Refused("boolean/ssi-row-unavailable:tube/quadratic-band")),
    }
}
pub(super) fn radical_band(d: &Draft, fi: FaceId) -> Result<Option<RadicalTubeBand>> {
    if super::patch::shape(d, fi) || super::stereo::is_patch(d, fi) {
        return Ok(None);
    }
    let f = &d.faces[fi.index()];
    let (frame, major, minor) = match &d.surfaces[f.surface.index()].carrier {
        // A rotated plane, cylinder or cone is no tube; a rotated tube surface
        // has no tube chart here and refuses by name.
        Carrier3::Rotated(r) => match r.base.as_ref() {
            Carrier3::Plane(_) | Carrier3::RadicalPlane(_) | Carrier3::Cylinder(_) | Carrier3::TranslatedCylinder(_) | Carrier3::Cone(_) => return Ok(None),
            Carrier3::Torus(_) | Carrier3::Sphere(_) | Carrier3::Rotated(_) => {
                return Err(Refused("model/rotated/tube-consumer"))
            }
        },
        Carrier3::Torus(t) => (t.frame.clone(), t.major().clone(), t.minor().clone()),
        Carrier3::Sphere(s) => (
            s.frame.clone(),
            Radical::default(),
            exact_root(&s.radius2()).expect("rational sphere radius"),
        ),
        Carrier3::Plane(_)
        | Carrier3::RadicalPlane(_)
        | Carrier3::Cylinder(_)
        | Carrier3::TranslatedCylinder(_)
        | Carrier3::Cone(_) => return Ok(None),
    };
    let cols = frame.columns();
    if !dot(&cols[0], &cross(&cols[1], &cols[2])).is_positive() {
        return Err(Refused("model/g1-tube-frame-reflected"));
    }
    if f.loops.is_empty() || f.loops.len() > 2 || (f.loops.len() == 1 && !major.is_zero()) {
        return Err(Refused("boolean/ssi-row-unavailable:revolution/non-band-trim"));
    }
    let mut rings = vec![];
    for l in &f.loops {
        let lp = &d.loops[l.index()];
        if lp.coedges.len() != 1 {
            return Err(Refused("boolean/ssi-row-unavailable:revolution/non-ring-trim"));
        }
        let co = &d.coedges[lp.coedges[0].index()];
        let e = &d.edges[co.edge.index()];
        if !matches!(e.bounds, Bounds::Ring) {
            return Err(Refused("boolean/ssi-row-unavailable:revolution/open-trim"));
        }
        let (circle_frame, offset, radius2) = match &d.curves[e.curve.index()].geometry {
            Curve3::Circle(c) => (c.frame()?, Radical::default(), Radical::from(c.radius2())),
            Curve3::RadicalCircle(c) => (&c.frame, c.height().clone(), rad(|| c.radius() * c.radius())?),
            Curve3::Line { .. } | Curve3::RadicalLine { .. } => {
                return Err(Refused("model/g4-ring-on-open-curve"))
            }
            Curve3::TranslatedCircle(_) => return Err(Refused("model/translated-circle/tube-ring")),
        };
        let map = frame.relation_from(circle_frame).map;
        let [x, y, z] = map.columns();
        if !map.origin()[0].is_zero()
            || !map.origin()[1].is_zero()
            || !x[2].is_zero()
            || !y[2].is_zero()
            || (!offset.is_zero() && (!z[0].is_zero() || !z[1].is_zero()))
        {
            return Err(Refused("model/g3-ring-not-latitude"));
        }
        let positive = (&x[0] * &y[1] - &x[1] * &y[0]).is_positive();
        let ccw = co.forward == positive;
        let rho2 = rad(|| &radius2 * &(&x[0] * &x[0] + &x[1] * &x[1]))?;
        let height = rad(|| Radical::from(map.origin()[2].clone()) + &offset * &z[2])?;
        let angle = ring_angle(&major, &minor, &rho2, &height)?;
        rings.push((angle, ccw, co));
    }
    let patch = if major.is_zero() {
        Patch::First
    } else if rings.iter().any(|r| r.0[0].is_positive()) {
        Patch::First
    } else if rings.iter().any(|r| r.0[0].is_negative()) {
        Patch::Second
    } else {
        return Err(Refused("boolean/ssi-row-unavailable:torus/half-tube-band"));
    };
    let mut ends = vec![];
    for (angle, ccw, co) in &rings {
        if (patch == Patch::First && angle[0].is_negative())
            || (patch == Patch::Second && angle[0].is_positive())
        {
            return Err(Refused("boolean/ssi-row-unavailable:torus/band-beyond-half-tube"));
        }
        let t = chart_of(patch, angle)?;
        let expected = AtlasTrim::radical_ring(t.clone(), *ccw)?;
        let atlas = co.atlas.as_ref().ok_or(Refused("model/g3-periodic-atlas-missing"))?;
        if atlas.pieces.len() != 2 {
            return Err(Refused("model/g3-atlas-piece-count"));
        }
        for (a, b) in atlas.pieces.iter().zip(&expected.pieces) {
            if a.patch != b.patch || a.winding_delta != b.winding_delta || a.piece.ends() != b.piece.ends()
            {
                return Err(Refused("model/g3-atlas-transition"));
            }
            if !matches!(a.piece.carrier(), Carrier::Line) {
                return Err(Refused("model/g3-pcurve-class"));
            }
        }
        if co.pcurve.ends() != atlas.pieces[0].piece.ends()
            || co.pcurve.key() != atlas.pieces[0].piece.key()
        {
            return Err(Refused("model/g3-primary-chart"));
        }
        ends.push((t, *ccw));
    }
    let (lo, hi) = if ends.len() == 2 {
        let lower = usize::from(ends[1].0 < ends[0].0);
        for (i, (_, ccw)) in ends.iter().enumerate() {
            if *ccw != ((i == lower) == f.forward) {
                return Err(Refused("model/g5-loop-orientation"));
            }
        }
        (ends[lower].0.clone(), ends[1 - lower].0.clone())
    } else {
        // A sphere cap: the ring is the lower end iff it runs as a lower
        // ring would; the pole closes the other end.
        let (t, ccw) = &ends[0];
        if *ccw == f.forward {
            (t.clone(), Radical::from(Q::one()))
        } else {
            (Radical::from(-Q::one()), t.clone())
        }
    };
    if lo >= hi {
        return Err(Refused("model/g6-band-order"));
    }
    // The inner half-tube reaches ρ = R − a at t_v = 0: a spindle band
    // through it would cross the axis onto the mirrored sheet.
    if patch == Patch::Second && lo.is_negative() && hi.is_positive() && major <= Radical::from(minor.clone()) {
        return Err(Refused("model/g6-torus-band-crosses-axis"));
    }
    Ok(Some(RadicalTubeBand {
        frame,
        major,
        minor,
        patch,
        lo,
        hi,
        forward: f.forward,
    }))
}

/// atan(t)/π on the quarter grid, `None` elsewhere.
fn quarter(t: &Q) -> Option<Q> {
    if t.is_zero() {
        Some(Q::zero())
    } else if t.abs() == Q::one() {
        Some(if t.is_positive() { Q::new(1.into(), 4.into()) } else { Q::new((-1).into(), 4.into()) })
    } else {
        None
    }
}

impl TubeBand {
    fn trig(&self, t: &Q) -> [Q; 2] {
        half_angle(self.patch, t)
    }
    /// Local point at chart (azimuth patch `pu`, `[t_u, t_v]`).
    pub fn local_point(&self, pu: Patch, uv: &[Q; 2]) -> Point {
        let [cu, su] = half_angle(pu, &uv[0]);
        let [cv, sv] = self.trig(&uv[1]);
        let rho = &self.major + &self.minor * cv;
        [&rho * cu, &rho * su, &self.minor * sv]
    }
    pub fn point(&self, pu: Patch, uv: &[Q; 2]) -> Point {
        self.frame.point(&self.local_point(pu, uv))
    }
    /// Swept tube angle over π, when exact.
    fn swept(&self) -> Result<Q> {
        match (quarter(&self.lo), quarter(&self.hi)) {
            (Some(a), Some(b)) => Ok(q(2) * (b - a)),
            _ => Err(Refused("boolean/ssi-row-unavailable:torus/transcendental-band-angle")),
        }
    }
    /// Area (independent of the face sense).
    pub fn area(&self) -> Result<PiValue> {
        let [x, y, z] = self.frame.columns();
        let scale = dot(x, x);
        if dot(y, y) != scale || dot(z, z) != scale || !dot(x, y).is_zero() || !dot(x, z).is_zero() || !dot(y, z).is_zero()
        {
            return Err(Refused("boolean/ssi-row-unavailable:tube/non-similar-area"));
        }
        let [_, sl] = self.trig(&self.lo);
        let [_, sh] = self.trig(&self.hi);
        let (r, a) = (&self.major, &self.minor);
        // 2πa(RΔθ + a[sin θ]) with Δθ = π·swept.
        let pi = q(2) * a * a * (sh - sl) * &scale;
        let pi2 = if r.is_zero() { Q::zero() } else { q(2) * a * r * self.swept()? * &scale };
        Ok(PiValue { rational: Q::zero(), pi, pi2 })
    }
}

/// sign(P + √s·Q) from sign P, sign Q and sign(P² − s·Q²).
fn surd_sign(p: Ordering, q: Ordering, p2_minus_sq2: impl FnOnce() -> Result<Ordering>) -> Result<Ordering> {
    if p != Ordering::Less && q != Ordering::Less {
        return Ok(p.max(q));
    }
    if p != Ordering::Greater && q != Ordering::Greater {
        return Ok(p.min(q));
    }
    Ok(match p2_minus_sq2()? {
        Ordering::Greater => p,
        Ordering::Less => q,
        Ordering::Equal => Ordering::Equal,
    })
}

impl RadicalTubeBand {
    pub fn rational(&self) -> Option<TubeBand> {
        Some(TubeBand {
            frame: self.frame.clone(),
            major: self.major.rational()?,
            minor: self.minor.clone(),
            patch: self.patch,
            lo: self.lo.rational()?,
            hi: self.hi.rational()?,
            forward: self.forward,
        })
    }
    /// Area of a sphere band whose ends lie in one quadratic field
    /// (independent of the face sense): 2πa·Δz = 2πa²(sin θ_hi − sin θ_lo),
    /// returned as the π coefficient p + q·√r as (p, q, r). A torus band
    /// with Q(√d) data also needs its swept angle and refuses by name.
    pub fn sphere_area(&self) -> Result<(Q, Q, Q)> {
        if !self.major.is_zero() {
            return Err(Refused("boolean/ssi-row-unavailable:tube/quadratic-band"));
        }
        let [x, y, z] = self.frame.columns();
        let scale = dot(x, x);
        if dot(y, y) != scale || dot(z, z) != scale || !dot(x, y).is_zero() || !dot(x, z).is_zero() || !dot(y, z).is_zero()
        {
            return Err(Refused("boolean/ssi-row-unavailable:tube/non-similar-area"));
        }
        let [_, sl] = self.trig(&self.lo)?;
        let [_, sh] = self.trig(&self.hi)?;
        let (p, b, r) = rad(|| &sh - &sl)?
            .parts()
            .ok_or(Refused("blend/number-class-exceeded:multiquadratic-measure"))?;
        let f = q(2) * &self.minor * &self.minor * scale;
        Ok((p * &f, b * f, r))
    }
    /// Whether the carrier itself is quadratic (no rational chart point).
    pub fn quadratic_carrier(&self) -> bool {
        self.major.rational().is_none()
    }
    fn trig(&self, t: &Radical) -> Result<[Radical; 2]> {
        let sign = self.patch.sign();
        rad(|| {
            let t2 = t * t;
            let d = Radical::from(Q::one()) + &t2;
            [(Radical::from(Q::one()) - &t2) * &sign / &d, t * &(q(2) * &sign) / &d]
        })
    }
    fn heights(&self) -> Result<[Radical; 2]> {
        let [_, sl] = self.trig(&self.lo)?;
        let [_, sh] = self.trig(&self.hi)?;
        let (a, b) = rad(|| (&sl * &self.minor, &sh * &self.minor))?;
        Ok(if a <= b { [a, b] } else { [b, a] })
    }
    fn classify(&self, s: Ordering, side: Ordering, v: [Ordering; 2]) -> Location {
        if !self.major.is_zero() && s != Ordering::Greater {
            return Location::Outside;
        }
        let wrong = match self.patch {
            Patch::First => side == Ordering::Less,
            Patch::Second => side == Ordering::Greater,
        };
        if wrong {
            return Location::Outside;
        }
        match v {
            [Ordering::Less, _] | [_, Ordering::Greater] => Location::Outside,
            [Ordering::Equal, _] | [_, Ordering::Equal] => Location::Boundary,
            _ => Location::Inside,
        }
    }
    pub(super) fn locate(&self, p: &VertexKey) -> Result<Location> {
        let inverse = self.frame.inverse();
        let l: [Radical; 3] = match p {
            VertexKey::Rational(p) => inverse.point(p).map(Radical::from),
            VertexKey::Quadratic(p) => p.mapped(&inverse)?.coordinates().clone(),
            VertexKey::Real(p) => super::algebraic::mapped(p, &inverse),
        };
        let [v0, v1] = self.heights()?;
        wonky_curve::radical::guard(|| {
            let r2 = &self.major * &self.major;
            let s = &l[0] * &l[0] + &l[1] * &l[1] + &l[2] * &l[2] + &r2 - Radical::from(&self.minor * &self.minor);
            let zero = Radical::from(Q::zero());
            let side = if self.major.is_zero() {
                Ordering::Greater
            } else {
                (&s - &(&r2 * &q(2))).cmp(&zero)
            };
            self.classify(s.cmp(&zero), side, [l[2].cmp(&v0), l[2].cmp(&v1)])
        })
        .map_err(|_| Refused("boolean/budget-exceeded:tube-locate"))
    }
    /// Rational carrier points inside the band (none for a Q(√d) major:
    /// such a face is proved outward through an adjacent face).
    pub(super) fn witnesses(&self) -> Result<Vec<Point>> {
        let Some(major) = self.major.rational() else { return Ok(vec![]) };
        let mut out = vec![];
        for t in [Q::zero(), Q::new(1.into(), 2.into()), Q::new((-1).into(), 2.into()), Q::new(1.into(), 3.into()), Q::new((-1).into(), 3.into())] {
            for v in super::periodic::rational_heights(&self.lo, &self.hi)? {
                let [cu, su] = half_angle(Patch::First, &t);
                let [cv, sv] = half_angle(self.patch, &v);
                let rho = &major + &self.minor * cv;
                out.push(self.frame.point(&[&rho * cu, &rho * su, &self.minor * sv]));
            }
        }
        Ok(out)
    }
    /// Ray hits `w + s·direction`, `s ≥ 0`, inside this band. With
    /// `R = a0 + a1√d` the torus quartic is `F0 + √d·F1` (rational
    /// polynomials in s); the conjugate product `F0² − d·F1²` (the quartic
    /// itself when R² is rational) is isolated exactly, and the own factor,
    /// the sheet `S > 0`, the half-tube side and the height window are signs
    /// of rational polynomials at each root. A multiple root or a root on a
    /// band condition is ambiguous: `None`.
    pub(super) fn torus_hits(&self, w: &Point, direction: &Point, w_on_carrier_counts: bool) -> Result<Option<usize>> {
        let inverse = self.frame.inverse();
        let l0 = inverse.point(w);
        let m = inverse.vector(direction);
        let err = |_| Refused("boolean/budget-exceeded:torus-ray");
        let poly = |c: Vec<Q>| Polynomial::new(c).map_err(err);
        let mul = |a: &[Q], b: &[Q]| {
            let mut out = vec![Q::zero(); a.len() + b.len() - 1];
            for (i, x) in a.iter().enumerate() {
                for (j, y) in b.iter().enumerate() {
                    out[i + j] += x * y;
                }
            }
            out
        };
        let add = |a: &[Q], b: &[Q], scale: &Q| {
            let mut out = vec![Q::zero(); a.len().max(b.len())];
            for (i, x) in a.iter().enumerate() {
                out[i] += x;
            }
            for (i, x) in b.iter().enumerate() {
                out[i] += x * scale;
            }
            out
        };
        let (a0, a1, d) = self.major.parts().ok_or(Refused("blend/number-class-exceeded:torus-major"))?;
        // R² = A + B√d.
        let (big_a, big_b) = (&a0 * &a0 + &a1 * &a1 * &d, q(2) * &a0 * &a1);
        let lin = |i: usize| vec![l0[i].clone(), m[i].clone()];
        let rho2 = add(&mul(&lin(0), &lin(0)), &mul(&lin(1), &lin(1)), &Q::one());
        let s0 = add(&add(&rho2, &mul(&lin(2), &lin(2)), &Q::one()), &[&big_a - &self.minor * &self.minor], &Q::one());
        let s1 = vec![big_b.clone()];
        // F0 = S0² + d·S1² − 4A·ρ², F1 = 2·S0·S1 − 4B·ρ².
        let f0 = add(&add(&mul(&s0, &s0), &mul(&s1, &s1), &d), &rho2, &(-q(4) * &big_a));
        let f1 = add(&mul(&s0, &s1).iter().map(|c| c * q(2)).collect::<Vec<_>>(), &rho2, &(-q(4) * &big_b));
        let quadratic = f1.iter().any(|c| !c.is_zero());
        let f = if quadratic { add(&mul(&f0, &f0), &mul(&f1, &f1), &-d.clone()) } else { f0.clone() };
        if f.iter().all(Q::is_zero) {
            return Ok(None);
        }
        let limits = Limits::default();
        let roots = isolate_real_roots(&poly(f)?, limits).map_err(err)?;
        let ord = |s: Sign| match s {
            Sign::Negative => Ordering::Less,
            Sign::Zero => Ordering::Equal,
            Sign::Positive => Ordering::Greater,
        };
        // sign(P + √d·Q) at a root for rational polynomials P, Q.
        struct Pair {
            p: Polynomial,
            q: Polynomial,
            norm: Polynomial,
        }
        let pair = |p: Vec<Q>, qq: Vec<Q>| -> Result<Pair> {
            let norm = add(&mul(&p, &p), &mul(&qq, &qq), &-d.clone());
            Ok(Pair { p: poly(p)?, q: poly(qq)?, norm: poly(norm)? })
        };
        let (f0p, f1p) = (poly(f0)?, poly(f1)?);
        let sheet = pair(s0.clone(), s1.clone())?;
        let side = pair(add(&s0, &[-(q(2) * &big_a)], &Q::one()), vec![&big_b - q(2) * &big_b])?;
        let mut window = vec![];
        for v in self.heights()? {
            let (c0, c1, r) = v.parts().ok_or(Refused("blend/number-class-exceeded:torus-major"))?;
            let x = add(&lin(2), &[c0], &-Q::one());
            let square = poly(add(&mul(&x, &x), &[&c1 * &c1 * &r], &-Q::one()))?;
            window.push((poly(x)?, square, c1, r));
        }
        let identity = poly(vec![Q::zero(), Q::one()])?;
        let mut hits = 0;
        for root in roots {
            let at = |x: &Polynomial| root.sign_at(x, limits).map(ord).map_err(err);
            let position = at(&identity)?;
            if position == Ordering::Less {
                continue;
            }
            // Own factor F0 + √d·F1 = 0: F0 and F1 of opposite signs.
            if quadratic {
                let (s0, s1) = (at(&f0p)?, at(&f1p)?);
                if s0 == s1 && s0 != Ordering::Equal {
                    continue;
                }
            }
            let sign_of = |pr: &Pair| surd_sign(at(&pr.p)?, at(&pr.q)?, || at(&pr.norm));
            let mut v = [Ordering::Equal; 2];
            for (i, (x, square, c, r)) in window.iter().enumerate() {
                // sign(z − (c0 + c√r)) = sign(X − c√r).
                let xs = at(x)?;
                let cs = c.cmp(&Q::zero());
                v[i] = if cs == Ordering::Equal || r.is_zero() {
                    xs
                } else if xs == Ordering::Equal {
                    cs.reverse()
                } else if xs != cs {
                    xs
                } else {
                    match at(square)? {
                        Ordering::Greater => xs,
                        Ordering::Equal => Ordering::Equal,
                        Ordering::Less => cs.reverse(),
                    }
                };
            }
            let location = self.classify(sign_of(&sheet)?, sign_of(&side)?, v);
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
    /// `2·atan(t)` exactly: `[k, x]` with value `k·π + atan(x)` (x = 0 on the
    /// quarter grid). Off the grid the tangent `2t/(1 − t²)` must be rational
    /// and |t| < 1; otherwise the swept angle has no exact row.
    fn double_atan(t: &Radical) -> Result<(Q, Q)> {
        if let Some(t) = t.rational() {
            if let Some(k) = quarter(&t) {
                return Ok((q(2) * k, Q::zero()));
            }
        }
        let x = rad(|| t * &q(2) / &(Radical::from(Q::one()) - t * t))?;
        let x = x
            .rational()
            .filter(|_| t.abs() < Radical::from(Q::one()))
            .ok_or(Refused("boolean/ssi-row-unavailable:torus/transcendental-band-angle"))?;
        Ok((Q::zero(), x))
    }
    /// The band's contribution to six times the signed volume, in Q(√d)[π]
    /// with at most one angle term π·atan(x).
    pub fn volume6(&self) -> Result<SurdPiValue> {
        let [cl, sl] = self.trig(&self.lo)?;
        let [ch, sh] = self.trig(&self.hi)?;
        let (r, a) = (&self.major, Radical::from(self.minor.clone()));
        let det = dot(
            &self.frame.columns()[0],
            &cross(&self.frame.columns()[1], &self.frame.columns()[2]),
        );
        let cz = self.frame.inverse().vector(self.frame.origin())[2].clone();
        let sign = if self.forward { q(2) } else { q(-2) } * det;
        let pi = rad(|| {
            let rho = |c: &Radical| r + &(&a * c);
            let ds = &sh - &sl;
            let dsc = &sh * &ch - &sl * &cl;
            let drho2 = rho(&ch) * rho(&ch) - rho(&cl) * rho(&cl);
            (&a * &(r * r) * &ds * &q(2) + &a * &a * &a * &ds * &q(2) + &a * &a * r * &dsc - drho2 * &cz) * &sign
        })?;
        let mut v = SurdPiValue::default();
        v.add_scaled(&pi, &PiValue { pi: Q::one(), ..PiValue::default() })?;
        if !r.is_zero() {
            // 2π · (3/2) a²R Δθ with Δθ = 2 atan(hi) − 2 atan(lo).
            let ([kh, xh], [kl, xl]) = (Self::double_atan(&self.hi).map(|(k, x)| [k, x])?, Self::double_atan(&self.lo).map(|(k, x)| [k, x])?);
            let c = rad(|| &a * &a * r * &(q(3) * &sign))?;
            v.add_scaled(&rad(|| &c * &(&kh - &kl))?, &PiValue { pi2: Q::one(), ..PiValue::default() })?;
            if !xh.is_zero() {
                v.add_angle(&xh, &c)?;
            }
            if !xl.is_zero() {
                v.add_angle(&xl, &-&c)?;
            }
        }
        Ok(v)
    }
}


pub(super) enum Location {
    Outside,
    Inside,
    Boundary,
}

/// Outward-normal direction of the carrier at a carrier point, before the
/// face sense is applied: a quadric's exact gradient, or the torus quartic's
/// gradient (a positive multiple of the own tube's gradient on its sheet).
pub(super) fn gradient(carrier: &Carrier3, w: &Point) -> Result<Point> {
    if let Carrier3::Torus(t) = carrier {
        return Torus3::gradient(t, w);
    }
    let implicit = carrier.implicit()?;
    Ok(std::array::from_fn(|i| {
        let mut p = w.clone();
        p[i] += Q::one();
        let mut m = w.clone();
        m[i] -= Q::one();
        (implicit.evaluate(&p) - implicit.evaluate(&m)) / q(2)
    }))
}
