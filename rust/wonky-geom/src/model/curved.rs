//! Own-frame quadrics and rational charts. No normalisation or observation
//! cache is used here. Patch boundaries are atlas transitions, never edges.
use super::{algebraic::RPoint, Carrier3, Curve3, VertexKey};
use crate::{frame::Frame, Point, Refused, Result, Q};
use num_traits::{One, Signed, Zero};
use wonky_curve::{
    numeric::exact_root,
    radical::{self, Radical},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cylinder3 {
    chart: Frame,
    radius: Q,
    centre: Option<RPoint>,
}
/// A circular cone about the frame's third axis through two rings
/// `(height, radius)`: rational, or in one quadratic field Q(√d) (cone-rim
/// chamfers set back along a generator of irrational length, fillets3d
/// design §2). Consumers without a Q(√d) row read `rings()`/`meridian()`,
/// which refuse quadratic data by name.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cone3 {
    pub frame: Frame,
    rings: [(Radical, Radical); 2],
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Sphere3 {
    pub frame: Frame,
    radius: Q,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Circle3 {
    chart: Frame,
    radius: Q,
    centre: Option<RPoint>,
}

/// Cylinders and circles have rational axes, but a rolling ball between
/// supports with irrational-length normals has its centre in the quadratic
/// field of its spring points. Such a carrier keeps only its rational columns
/// in `chart` (origin zero, never read) and its exact `centre`. Rational
/// consumers read `frame()`, which refuses it by name; exact consumers read
/// `origin()`, `columns()` and `local()`.
const RADICAL_CENTRE: &str = "model/radical-centre-carrier";
macro_rules! exact_centre {
    ($t:ty, $axial:expr) => {
        impl $t {
            /// A carrier about an exact centre. A rational centre is the
            /// ordinary rational frame; a radical one needs an isometric
            /// frame (orthogonal x, y of equal length, `$axial`: z ⟂ x, y).
            pub fn about(origin: RPoint, columns: [Point; 3], r2: Q) -> Result<Self> {
                if let Some(o) = super::algebraic::rational(&origin) {
                    return Self::new(Frame::new(o, columns)?, r2);
                }
                let [x, y, z] = &columns;
                if !crate::dot(x, y).is_zero()
                    || crate::dot(x, x) != crate::dot(y, y)
                    || ($axial && (!crate::dot(x, z).is_zero() || !crate::dot(y, z).is_zero()))
                {
                    return Err(Refused("model/radical-centre-carrier/elliptic-frame"));
                }
                Ok(Self {
                    chart: Frame::new(crate::zero(), columns)?,
                    radius: radius(r2)?,
                    centre: Some(origin),
                })
            }
            /// The rational frame; a radical-centre carrier refuses by name.
            pub fn frame(&self) -> Result<&Frame> {
                match self.centre {
                    None => Ok(&self.chart),
                    Some(_) => Err(Refused(RADICAL_CENTRE)),
                }
            }
            pub fn columns(&self) -> &[Point; 3] {
                self.chart.columns()
            }
            pub fn origin(&self) -> RPoint {
                self.centre
                    .clone()
                    .unwrap_or_else(|| super::algebraic::lift(self.chart.origin()))
            }
            pub fn is_radical(&self) -> bool {
                self.centre.is_some()
            }
            /// Exact carrier coordinates of a vector (no origin).
            pub fn linear(&self, v: &RPoint) -> RPoint {
                let inverse = self.chart.inverse();
                std::array::from_fn(|i| {
                    (0..3).fold(Radical::default(), |s, j| s + &v[j] * &inverse.columns()[j][i])
                })
            }
            /// Exact carrier coordinates of a point.
            pub fn local(&self, p: &RPoint) -> RPoint {
                self.linear(&super::algebraic::sub(p, &self.origin()))
            }
        }
    };
}
exact_centre!(Cylinder3, true);
exact_centre!(Circle3, false);

fn radius(r2: Q) -> Result<Q> {
    if r2 <= Q::zero() {
        return Err(Refused("boolean/contract-violation:carrier/radius"));
    }
    exact_root(&r2).ok_or(Refused(
        "boolean/ssi-row-unavailable:chart/quadratic-radius",
    ))
}
impl Cylinder3 {
    pub fn new(frame: Frame, r2: Q) -> Result<Self> {
        Ok(Self {
            chart: frame,
            radius: radius(r2)?,
            centre: None,
        })
    }
    /// Exact membership: carrier coordinates at the radius.
    fn holds(&self, p: &RPoint) -> bool {
        let l = self.local(p);
        &l[0] * &l[0] + &l[1] * &l[1] == Radical::from(self.radius2())
    }
    /// Exact containment of a generator or an axial circle, for carriers
    /// whose centre (or the curve's) is radical.
    fn contains_exact(&self, c: &Curve3) -> Result<bool> {
        use super::algebraic::lift;
        let (p, d) = match c {
            Curve3::Line { p, d } => (lift(p), lift(d)),
            Curve3::RadicalLine { p, d } => (p.clone(), d.clone()),
            // Routed to translated::on_quadric by contains_curve.
            Curve3::TranslatedCircle(_) => unreachable!(),
            Curve3::Circle(k) => {
                return quadratic_budget(radical::guard(|| {
                    self.contains_axial(k.origin(), k.columns(), Radical::from(k.radius2()))
                }))
            }
            Curve3::RadicalCircle(k) => {
                let centre = k.center()?;
                return quadratic_budget(radical::guard(|| {
                    self.contains_axial(centre, k.frame.columns(), k.radius() * k.radius())
                }));
            }
        };
        let d = self.linear(&d);
        Ok(d[0].is_zero() && d[1].is_zero() && self.holds(&p))
    }
    /// An axial circle about `centre` with chart columns `columns` and chart
    /// squared radius `r2` lies on this cylinder.
    fn contains_axial(&self, centre: RPoint, columns: &[Point; 3], r2: Radical) -> bool {
        use super::algebraic::lift;
        let centre = self.local(&centre);
        let [a, b, _] = columns.clone().map(|v| self.linear(&lift(&v)));
        let own = Radical::from(self.radius2());
        centre[0].is_zero()
            && centre[1].is_zero()
            && (&a[0] * &a[0] + &a[1] * &a[1]) * &r2 == own
            && (&b[0] * &b[0] + &b[1] * &b[1]) * &r2 == own
            && (&a[0] * &b[0] + &a[1] * &b[1]).is_zero()
            && a[2].is_zero()
            && b[2].is_zero()
    }
    pub fn radius2(&self) -> Q {
        &self.radius * &self.radius
    }
}
impl Sphere3 {
    /// The rational radius in own-frame units.
    pub fn radius(&self) -> &Q {
        &self.radius
    }
    pub fn new(frame: Frame, r2: Q) -> Result<Self> {
        Ok(Self {
            frame,
            radius: radius(r2)?,
        })
    }
    pub fn radius2(&self) -> Q {
        &self.radius * &self.radius
    }
}
impl Circle3 {
    pub fn new(frame: Frame, r2: Q) -> Result<Self> {
        Ok(Self {
            chart: frame,
            radius: radius(r2)?,
            centre: None,
        })
    }
    pub fn radius2(&self) -> Q {
        &self.radius * &self.radius
    }
    pub fn point(&self, patch: Patch, t: &Q) -> Result<Point> {
        let [c, s] = half_angle(patch, t);
        Ok(self
            .frame()?
            .point(&[&self.radius * c, &self.radius * s, Q::zero()]))
    }
    /// The exact point at a half-angle parameter, in the field of the centre.
    pub fn point_exact(&self, patch: Patch, t: &Q) -> RPoint {
        let [c, s] = half_angle(patch, t);
        let [x, y, _] = self.columns();
        let o = self.origin();
        std::array::from_fn(|k| &o[k] + Radical::from(&self.radius * (&c * &x[k] + &s * &y[k])))
    }
    pub fn contains_vertex(&self, vertex: &VertexKey) -> Result<bool> {
        if self.is_radical() {
            // In the span of x, y about the centre, at the radius.
            let l = self.local(&vertex.coordinates());
            return Ok(l[2].is_zero()
                && &l[0] * &l[0] + &l[1] * &l[1] == Radical::from(self.radius2()));
        }
        let frame = self.frame()?;
        let inverse = frame.inverse();
        let plane = Carrier3::Plane(super::Plane3 {
            o: frame.origin().clone(),
            x: frame.columns()[0].clone(),
            n: std::array::from_fn(|i| inverse.columns()[i][2].clone()),
        });
        let cylinder = Carrier3::Cylinder(Cylinder3::new(frame.clone(), self.radius2())?);
        Ok(plane.contains_vertex(vertex)? && cylinder.contains_vertex(vertex)?)
    }
    /// Canonical point-set identity. A radical-centre circle (isometric frame
    /// by construction) is its normalized normal, exact centre and Euclidean
    /// squared radius; otherwise the rational form below.
    pub fn canonical_key(&self) -> (super::canonical::CurveKey, bool) {
        if self.is_radical() {
            let [x, y, _] = self.columns();
            let n = crate::cross(x, y);
            let pivot = n.iter().position(|x| !x.is_zero()).expect("nonsingular frame");
            let flipped = n[pivot].is_negative();
            let normal = n.clone().map(|x| x / &n[pivot]);
            let r2 = Radical::from(self.radius2() * crate::dot(x, x));
            return (super::canonical::CurveKey::RadicalCircle { normal, centre: self.origin(), r2 }, flipped);
        }
        let (plane, quadratic, flipped) = self.canonical_data().expect("rational circle");
        (super::canonical::CurveKey::Circle { plane, quadratic }, flipped)
    }
    /// Canonical point-set identity. Restrict the radial implicit to the
    /// circle plane before normalising: changing the frame's third column
    /// must not change the circle. The sense uses x × y, including reflections.
    /// A radical-centre circle refuses; its identity is `canonical_key`.
    pub fn canonical_data(&self) -> Result<([Q; 4], [Q; 10], bool)> {
        self.frame()?;
        let n = crate::cross(&self.chart.columns()[0], &self.chart.columns()[1]);
        let pivot = n
            .iter()
            .position(|x| !x.is_zero())
            .expect("nonsingular frame");
        let flipped = n[pivot].is_negative();
        let n = n.clone().map(|x| x / &n[pivot]);
        let offset = crate::dot(&n, self.chart.origin());
        let implicit = Carrier3::Cylinder(Cylinder3 {
            chart: self.chart.clone(),
            radius: self.radius.clone(),
            centre: None,
        })
        .implicit().expect("rational cylinder");
        let coefficients = polynomial_coefficients(|p| {
            let mut projected = p.clone();
            projected[pivot] = &offset
                - (0..3)
                    .filter(|&i| i != pivot)
                    .map(|i| &n[i] * &p[i])
                    .sum::<Q>();
            implicit.evaluate(&projected)
        });
        let scale = coefficients
            .iter()
            .find(|c| !c.is_zero())
            .expect("nondegenerate circle")
            .clone();
        Ok((
            [n[0].clone(), n[1].clone(), n[2].clone(), offset],
            coefficients.map(|c| c / &scale),
            flipped,
        ))
    }
}
impl Cone3 {
    pub fn new(frame: Frame, rings: [(Q, Q); 2]) -> Result<Self> {
        Self::quadratic(frame, rings.map(|(z, r)| (Radical::from(z), Radical::from(r))))
    }
    /// A cone whose ring data lie in one quadratic field. Two or more
    /// radical classes are outside the admitted number class.
    pub fn quadratic(frame: Frame, rings: [(Radical, Radical); 2]) -> Result<Self> {
        one_field(rings.iter().flat_map(|(z, r)| [z, r]), "blend/number-class-exceeded:cone-ring")?;
        if rings[0].0 == rings[1].0
            || rings.iter().any(|r| r.1.is_negative())
            || rings.iter().all(|r| r.1.is_zero())
        {
            return Err(Refused("boolean/contract-violation:carrier/cone-rings"));
        }
        Ok(Self { frame, rings })
    }
    /// The rings of a rational cone; quadratic rings refuse by name.
    pub fn rings(&self) -> Result<[(Q, Q); 2]> {
        let r = |x: &Radical| x.rational().ok_or(Refused("boolean/ssi-row-unavailable:cone/quadratic-ring"));
        Ok([
            (r(&self.rings[0].0)?, r(&self.rings[0].1)?),
            (r(&self.rings[1].0)?, r(&self.rings[1].1)?),
        ])
    }
    pub fn radical_rings(&self) -> &[(Radical, Radical); 2] {
        &self.rings
    }
    pub fn is_rational(&self) -> bool {
        self.rings.iter().all(|(z, r)| z.rational().is_some() && r.rational().is_some())
    }
    /// `[b, k]` with radius `b + k z`, for a rational cone.
    pub fn meridian(&self) -> Result<[Q; 2]> {
        let [(z0, r0), (z1, r1)] = self.rings()?;
        let slope = (&r1 - &r0) / (&z1 - &z0);
        Ok([&r0 - &slope * &z0, slope])
    }
    /// Local coordinates of a model point given in a quadratic field.
    fn local(&self, p: &[Radical; 3]) -> [Radical; 3] {
        let inverse = self.frame.inverse();
        std::array::from_fn(|i| {
            (0..3).fold(Radical::from(inverse.origin()[i].clone()), |v, j| v + &p[j] * &inverse.columns()[j][i])
        })
    }
    /// Exact incidence in the cone's field: `x² + y² = (b + k z)²` (both
    /// nappes, as the rational implicit).
    pub(super) fn contains_radical(&self, p: &[Radical; 3]) -> Result<bool> {
        let [b, k] = self.radical_meridian()?;
        quadratic_budget(radical::guard(|| {
            let l = self.local(p);
            let r = &b + &(&k * &l[2]);
            &l[0] * &l[0] + &l[1] * &l[1] == &r * &r
        }))
    }
    /// A circle lies on this cone iff it is a latitude of the cone's frame
    /// (coaxial, in a plane ⟂ axis) at the meridian radius of its height.
    /// Lines (generators) have no Q(√d) row and refuse.
    pub fn contains_latitude(&self, c: &Curve3) -> Result<bool> {
        let (frame, height, radius) = match c {
            Curve3::Circle(c) => (c.frame()?, Radical::default(), Radical::from(exact_root(&c.radius2()).ok_or(Refused("boolean/contract-violation:carrier/radius"))?)),
            Curve3::RadicalCircle(c) => (&c.frame, c.height().clone(), c.radius().clone()),
            Curve3::TranslatedCircle(_) => return Err(Refused("model/translated-circle/cone-latitude-unavailable")),
            Curve3::Line { .. } | Curve3::RadicalLine { .. } => {
                return Err(Refused("boolean/ssi-row-unavailable:cone/quadratic-generator"))
            }
        };
        let map = self.frame.relation_from(frame).map;
        let [x, y, z] = map.columns();
        if !map.origin()[0].is_zero() || !map.origin()[1].is_zero() || !x[2].is_zero() || !y[2].is_zero() || !z[0].is_zero() || !z[1].is_zero() {
            return Ok(false);
        }
        // Metric of the circle frame's radial columns in the cone frame.
        if &x[0] * &x[0] + &x[1] * &x[1] != Q::one() || &y[0] * &y[0] + &y[1] * &y[1] != Q::one() || !(&x[0] * &y[0] + &x[1] * &y[1]).is_zero() {
            return Err(Refused("boolean/ssi-row-unavailable:cone/non-isometric-latitude"));
        }
        let [b, k] = self.radical_meridian()?;
        quadratic_budget(radical::guard(|| {
            let h = Radical::from(map.origin()[2].clone()) + &height * &z[2];
            let r = &b + &(&k * &h);
            r == radius
        }))
    }
    /// The quadric `x² + y² − (b + k z)²` (local coordinates) in model
    /// coordinates, coefficients in the cone's field, in the coefficient
    /// order of `Implicit::coefficients`.
    pub fn model_quadric(&self) -> Result<[Radical; 10]> {
        let [b, k] = self.radical_meridian()?;
        let inverse = self.frame.inverse();
        let evaluate = |p: &Point| -> Radical {
            let l = inverse.point(p);
            let r = &b + &(&k * &l[2]);
            Radical::from(&l[0] * &l[0] + &l[1] * &l[1]) - &r * &r
        };
        quadratic_budget(radical::guard(|| {
            let zero = crate::zero();
            let c = evaluate(&zero);
            let half = Q::new(1.into(), 2.into());
            let mut linear: [Radical; 3] = Default::default();
            let mut diagonal: [Radical; 3] = Default::default();
            for i in 0..3 {
                let mut e = crate::zero();
                e[i] = Q::one();
                let positive = evaluate(&e);
                e[i] = -Q::one();
                let negative = evaluate(&e);
                linear[i] = (&positive - &negative) * &half;
                diagonal[i] = (&positive + &negative) * &half - &c;
            }
            let off = [(0, 1), (0, 2), (1, 2)].map(|(i, j)| {
                let mut e = crate::zero();
                e[i] = Q::one();
                e[j] = Q::one();
                evaluate(&e) - &c - &linear[i] - &linear[j] - &diagonal[i] - &diagonal[j]
            });
            [
                c,
                linear[0].clone(),
                linear[1].clone(),
                linear[2].clone(),
                diagonal[0].clone(),
                off[0].clone(),
                off[1].clone(),
                diagonal[1].clone(),
                off[2].clone(),
                diagonal[2].clone(),
            ]
        }))
    }
    /// `[b, k]` in the cone's field.
    pub fn radical_meridian(&self) -> Result<[Radical; 2]> {
        let [(z0, r0), (z1, r1)] = &self.rings;
        radical::guard(|| {
            let slope = (r1 - r0) / (z1 - z0);
            [r0 - &(&slope * z0), slope]
        })
        .map_err(|_| Refused("boolean/budget-exceeded:quadratic"))
    }
}

/// Admit values of one quadratic field Q(√d) (any number of rationals).
pub(super) fn one_field<'a>(values: impl IntoIterator<Item = &'a Radical>, refusal: &'static str) -> Result<Option<Q>> {
    let mut field: Option<Q> = None;
    for x in values {
        let (_, b, r) = x.parts().ok_or(Refused(refusal))?;
        if b.is_zero() {
            continue;
        }
        match &field {
            Some(s) if exact_root(&(r.clone() / s)).is_none() => return Err(Refused(refusal)),
            Some(_) => {}
            None => field = Some(r),
        }
    }
    Ok(field)
}

/// A latitude circle of a rational revolution frame at a height and radius
/// in one quadratic field: centre `frame.point([0, 0, height])` in the plane
/// of the frame's first two columns (cone-rim springs). Rational circles
/// stay `Circle3`; consumers without a Q(√d) row refuse this curve by name.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RadicalCircle3 {
    pub frame: Frame,
    height: Radical,
    radius: Radical,
}
fn quadratic_budget<T>(r: std::result::Result<T, wonky_curve::Refusal>) -> Result<T> {
    r.map_err(|_| Refused("boolean/budget-exceeded:quadratic"))
}
impl RadicalCircle3 {
    pub fn new(frame: Frame, height: Radical, radius: Radical) -> Result<Self> {
        one_field([&height, &radius], "blend/number-class-exceeded:circle")?;
        if !radius.is_positive() {
            return Err(Refused("boolean/contract-violation:carrier/radius"));
        }
        Ok(Self { frame, height, radius })
    }
    pub fn height(&self) -> &Radical {
        &self.height
    }
    pub fn radius(&self) -> &Radical {
        &self.radius
    }
    fn image(&self, local: &[Radical; 3]) -> [Radical; 3] {
        std::array::from_fn(|i| {
            (0..3).fold(Radical::from(self.frame.origin()[i].clone()), |v, j| {
                v + &local[j] * &self.frame.columns()[j][i]
            })
        })
    }
    /// The model-frame centre.
    pub fn center(&self) -> Result<[Radical; 3]> {
        quadratic_budget(radical::guard(|| {
            self.image(&[Radical::default(), Radical::default(), self.height.clone()])
        }))
    }
    /// The point at half-angle `t` of a revolution patch.
    pub fn point(&self, patch: Patch, t: &Q) -> Result<[Radical; 3]> {
        let [c, s] = half_angle(patch, t);
        quadratic_budget(radical::guard(|| {
            self.image(&[&self.radius * &c, &self.radius * &s, self.height.clone()])
        }))
    }
    /// Point-set identity: the plane normal class (first nonzero entry 1),
    /// the centre and the squared radius in model metric; plus the sense
    /// (x × y against the normal class).
    pub fn canonical_data(&self) -> Result<([Q; 3], [Radical; 3], Radical, bool)> {
        let n = crate::cross(&self.frame.columns()[0], &self.frame.columns()[1]);
        let pivot = n.iter().position(|x| !x.is_zero()).ok_or(Refused("model/g1-frame-singular"))?;
        let flipped = n[pivot].is_negative();
        let n = n.clone().map(|x| x / &n[pivot]);
        let x = &self.frame.columns()[0];
        let r2 = quadratic_budget(radical::guard(|| &self.radius * &self.radius * crate::dot(x, x)))?;
        Ok((n, self.center()?, r2, flipped))
    }
    /// Exact incidence of a vertex: on the circle plane at the radius.
    pub fn contains_vertex(&self, vertex: &VertexKey) -> Result<bool> {
        let p: [Radical; 3] = match vertex {
            VertexKey::Rational(p) => p.clone().map(Radical::from),
            VertexKey::Quadratic(p) => p.coordinates().clone(),
            VertexKey::Real(p) => p.clone(),
        };
        let inverse = self.frame.inverse();
        radical::guard(|| {
            let l: [Radical; 3] = std::array::from_fn(|i| {
                (0..3).fold(Radical::from(inverse.origin()[i].clone()), |v, j| v + &p[j] * &inverse.columns()[j][i])
            });
            l[2] == self.height && &l[0] * &l[0] + &l[1] * &l[1] == &self.radius * &self.radius
        })
        .map_err(|_| Refused("boolean/budget-exceeded:quadratic-identity"))
    }
}

/// East/West on a revolution; North/South on a sphere. A patch is a
/// closed half chart. The shared boundary owns no topology entity.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Patch {
    First,
    Second,
}
impl Patch {
    pub(crate) fn sign(self) -> Q {
        Q::from_integer(
            match self {
                Self::First => 1,
                Self::Second => -1,
            }
            .into(),
        )
    }
}
pub fn half_angle(patch: Patch, t: &Q) -> [Q; 2] {
    let d = Q::one() + t * t;
    [
        patch.sign() * (Q::one() - t * t) / &d,
        patch.sign() * Q::from_integer(2.into()) * t / d,
    ]
}

/// Exact overlap transition for the two half-angle charts. The turn delta
/// belongs to a traversal, not to an edge in the B-rep. Positive/negative
/// crossings at the upper/lower seam cancel in a round trip.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Transition {
    pub patch: Patch,
    pub uv: [Q; 2],
    pub winding_delta: i32,
}
pub fn revolution_transition(from: Patch, uv: &[Q; 2]) -> Result<Transition> {
    if uv[0].abs() != Q::one() {
        return Err(Refused("boolean/contract-violation:atlas/not-seam"));
    }
    let winding_delta = match from {
        Patch::First => {
            if uv[0].is_negative() {
                -1
            } else {
                0
            }
        }
        Patch::Second => {
            if uv[0].is_negative() {
                0
            } else {
                1
            }
        }
    };
    Ok(Transition {
        patch: match from {
            Patch::First => Patch::Second,
            Patch::Second => Patch::First,
        },
        uv: [-Q::one() / &uv[0], uv[1].clone()],
        winding_delta,
    })
}

/// A rational polynomial `constant + linear.p + pᵀ quadratic p`. Kept
/// in the carrier frame; the frame inverse is exact, including R3 maps.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Implicit {
    pub frame: Frame,
    pub constant: Q,
    pub linear: Point,
    pub quadratic: [[Q; 3]; 3],
}
impl Implicit {
    /// Ten homogeneous polynomial coefficients in the model frame, in the
    /// order 1,x,y,z,x²,xy,xz,y²,yz,z². Equality up to nonzero scale is exact.
    pub fn coefficients(&self) -> [Q; 10] {
        polynomial_coefficients(|p| self.evaluate(p))
    }
}

fn polynomial_coefficients(evaluate: impl Fn(&Point) -> Q) -> [Q; 10] {
    let zero = crate::zero();
    let c = evaluate(&zero);
    let mut linear = crate::zero();
    let mut diagonal = crate::zero();
    for i in 0..3 {
        let mut e = crate::zero();
        e[i] = Q::one();
        let positive = evaluate(&e);
        e[i] = -Q::one();
        let negative = evaluate(&e);
        linear[i] = (&positive - &negative) / Q::from_integer(2.into());
        diagonal[i] = (positive + negative) / Q::from_integer(2.into()) - &c;
    }
    let off = [(0, 1), (0, 2), (1, 2)].map(|(i, j)| {
        let mut e = crate::zero();
        e[i] = Q::one();
        e[j] = Q::one();
        evaluate(&e) - &c - &linear[i] - &linear[j] - &diagonal[i] - &diagonal[j]
    });
    [
        c,
        linear[0].clone(),
        linear[1].clone(),
        linear[2].clone(),
        diagonal[0].clone(),
        off[0].clone(),
        off[1].clone(),
        diagonal[1].clone(),
        off[2].clone(),
        diagonal[2].clone(),
    ]
}
impl Implicit {
    pub fn evaluate(&self, point: &Point) -> Q {
        let p = self.frame.inverse().point(point);
        &self.constant
            + (0..3).map(|i| &self.linear[i] * &p[i]).sum::<Q>()
            + (0..3)
                .flat_map(|i| (0..3).map(move |j| (i, j)))
                .map(|(i, j)| &self.quadratic[i][j] * &p[i] * &p[j])
                .sum::<Q>()
    }
    /// Substitute a whole rational curve, rather than sampling points. The
    /// denominator is cleared and every coefficient must vanish exactly.
    pub fn contains_curve(&self, curve: &Curve3) -> Result<bool> {
        if matches!(curve,Curve3::TranslatedCircle(_)) { return super::translated::on_quadric(self,curve,&std::array::from_fn(|_|Radical::default())); }
        let inverse = self.frame.inverse();
        let (numerator, denominator): ([Vec<Q>; 3], Vec<Q>) = match curve {
            Curve3::Line { p, d } => {
                let p = inverse.point(p);
                let d = inverse.vector(d);
                (
                    std::array::from_fn(|i| vec![p[i].clone(), d[i].clone()]),
                    vec![Q::one()],
                )
            }
            Curve3::RadicalLine { p, d } => {
                let map=|p:&super::RPoint,point:bool| std::array::from_fn::<_,3,_>(|i| (0..3).fold(Radical::from(if point {inverse.origin()[i].clone()} else {Q::zero()}),|v,j|v+&p[j]*&inverse.columns()[j][i]));
                let p=map(p,true); let d=map(d,false);
                let mut c=[Radical::from(self.constant.clone()),Radical::default(),Radical::default()];
                for i in 0..3 {
                    c[0]=&c[0]+&p[i]*&self.linear[i]; c[1]=&c[1]+&d[i]*&self.linear[i];
                    for j in 0..3 {
                        c[0]=&c[0]+(&p[i]*&p[j])*&self.quadratic[i][j];
                        c[1]=&c[1]+(&p[i]*&d[j]+&d[i]*&p[j])*&self.quadratic[i][j];
                        c[2]=&c[2]+(&d[i]*&d[j])*&self.quadratic[i][j];
                    }
                }
                return Ok(c.iter().all(Radical::is_zero));
            },
            Curve3::TranslatedCircle(_) => unreachable!(),
            Curve3::RadicalCircle(c) => {
                // The rational half-angle parametrization with a radical
                // centre and radius: the same substitution in Q(√d).
                let center = c.center()?;
                let local = |p: &[Radical; 3], point: bool| -> [Radical; 3] {
                    std::array::from_fn(|i| {
                        (0..3).fold(
                            Radical::from(if point { inverse.origin()[i].clone() } else { Q::zero() }),
                            |v, j| v + &p[j] * &inverse.columns()[j][i],
                        )
                    })
                };
                let o = local(&center, true);
                let x = local(&c.frame.columns()[0].clone().map(Radical::from), false);
                let y = local(&c.frame.columns()[1].clone().map(Radical::from), false);
                let r = c.radius();
                let two = Radical::from(Q::from_integer(2.into()));
                let numerator: [Vec<Radical>; 3] = std::array::from_fn(|i| {
                    vec![&o[i] + &(r * &x[i]), &two * &(r * &y[i]), &o[i] - &(r * &x[i])]
                });
                let denominator = [Radical::from(Q::one()), Radical::default(), Radical::from(Q::one())];
                let mut out = vec![Radical::default(); 5];
                let mut add = |a: &[Radical], b: &[Radical], scale: &Q| {
                    for (i, u) in a.iter().enumerate() {
                        for (j, v) in b.iter().enumerate() {
                            out[i + j] = &out[i + j] + &((u * v) * scale);
                        }
                    }
                };
                add(&denominator, &denominator, &self.constant);
                for i in 0..3 {
                    add(&numerator[i], &denominator, &self.linear[i]);
                    for j in 0..3 {
                        add(&numerator[i], &numerator[j], &self.quadratic[i][j]);
                    }
                }
                return Ok(out.iter().all(Radical::is_zero));
            }
            Curve3::Circle(c) => {
                let Ok(frame) = c.frame() else { return Ok(false) };
                let map = self.frame.relation_from(frame).map;
                let o = map.origin();
                let [x, y, _z] = map.columns();
                (
                    std::array::from_fn(|i| {
                        vec![
                            &o[i] + &c.radius * &x[i],
                            Q::from_integer(2.into()) * &c.radius * &y[i],
                            &o[i] - &c.radius * &x[i],
                        ]
                    }),
                    vec![Q::one(), Q::zero(), Q::one()],
                )
            }
        };
        let mut coefficients = vec![Q::zero(); 5];
        accumulate(
            &mut coefficients,
            &denominator,
            &denominator,
            &self.constant,
        );
        for i in 0..3 {
            accumulate(
                &mut coefficients,
                &numerator[i],
                &denominator,
                &self.linear[i],
            );
            for j in 0..3 {
                accumulate(
                    &mut coefficients,
                    &numerator[i],
                    &numerator[j],
                    &self.quadratic[i][j],
                );
            }
        }
        Ok(coefficients.iter().all(Q::is_zero))
    }
}
fn accumulate(out: &mut [Q], a: &[Q], b: &[Q], scale: &Q) {
    for (i, x) in a.iter().enumerate() {
        for (j, y) in b.iter().enumerate() {
            out[i + j] += scale * x * y;
        }
    }
}

impl Carrier3 {
    pub fn contains_vertex(&self, p: &VertexKey) -> Result<bool> {
        if let Self::TranslatedCylinder(c)=self { return c.contains_vertex(p); }
        if matches!(self, Self::RadicalPlane(_) | Self::Rotated(_)) { return Ok(self.exact_plane()?.side(&p.coordinates()).is_zero()); }
        if let Self::Cone(c) = self {
            if !c.is_rational() {
                return c.contains_radical(&p.coordinates());
            }
        }
        if let Self::Cylinder(c) = self {
            if c.is_radical() { return Ok(c.holds(&p.coordinates())); }
        }
        if let Self::Torus(t) = self {
            return match p {
                VertexKey::Rational(p) => t.contains_point(p),
                VertexKey::Quadratic(p) => t.contains_radical(p.coordinates()),
                VertexKey::Real(p) => t.contains_radical(p),
            };
        }
        match p {
            VertexKey::Rational(p) => self.contains_point(p),
            VertexKey::Real(p) => {
                let implicit=self.implicit()?;
                let p=super::algebraic::mapped(p,&implicit.frame.inverse());
                radical::guard(|| {
                    let mut v=Radical::from(implicit.constant);
                    for i in 0..3 {v=v+&p[i]*&implicit.linear[i];for j in 0..3 {v=v+(&p[i]*&p[j])*&implicit.quadratic[i][j];}}
                    v.is_zero()
                }).map_err(|e|Refused(e.name()))
            },
            VertexKey::Quadratic(p) => {
                let implicit = self.implicit()?;
                let p = p.mapped(&implicit.frame.inverse())?;
                radical::guard(|| {
                    let p = p.coordinates();
                    let mut value = Radical::from(implicit.constant);
                    for i in 0..3 {
                        value = value + &p[i] * &implicit.linear[i];
                        for j in 0..3 {
                            value = value + (&p[i] * &p[j]) * &implicit.quadratic[i][j];
                        }
                    }
                    value.is_zero()
                })
                .map_err(|_| Refused("boolean/budget-exceeded:quadratic-identity"))
            }
        }
    }
    pub fn transition(&self, from: Patch, uv: &[Q; 2]) -> Result<Transition> {
        match self {
            Self::Rotated(_) => return Err(Refused("model/rotated/rational-consumer")),
            Self::Plane(_) | Self::RadicalPlane(_) => Err(Refused("boolean/contract-violation:atlas/plane-transition")),
            Self::Cylinder(_) | Self::TranslatedCylinder(_) | Self::Cone(_) => revolution_transition(from, uv),
            Self::Torus(_) => Err(Refused("boolean/ssi-row-unavailable:torus×atlas-transition")),
            Self::Sphere(_) => {
                if &uv[0] * &uv[0] + &uv[1] * &uv[1] != Q::one() {
                    return Err(Refused("boolean/contract-violation:atlas/not-seam"));
                }
                Ok(Transition {
                    patch: match from {
                        Patch::First => Patch::Second,
                        Patch::Second => Patch::First,
                    },
                    uv: [uv[0].clone(), -uv[1].clone()],
                    winding_delta: 0,
                })
            }
        }
    }
    /// Refuses a carrier whose implicit is identically zero (a plane with a
    /// zero normal): every point would satisfy it, so incidence and section
    /// predicates would accept any input instead of deciding.
    pub fn implicit(&self) -> Result<Implicit> {
        let mut q = std::array::from_fn(|_| std::array::from_fn(|_| Q::zero()));
        let mut linear = crate::zero();
        let (frame, constant) = match self {
            Self::TranslatedCylinder(_) => return Err(Refused("model/translated-cylinder/rational-implicit")),
            Self::Rotated(_) => return Err(Refused("model/rotated/rational-consumer")),
            Self::RadicalPlane(_) => return Err(Refused("model/radical-plane/rational-implicit")),
            Self::Torus(_) => return Err(Refused("boolean/ssi-row-unavailable:torus×quadric-implicit")),
            Self::Plane(p) => {
                linear = p.n.clone();
                (Frame::identity(), -crate::dot(&p.n, &p.o))
            }
            Self::Cylinder(c) => {
                q[0][0] = Q::one();
                q[1][1] = Q::one();
                (c.frame()?.clone(), -c.radius2())
            }
            Self::Cone(c) => {
                let [b, k] = c.meridian()?;
                q[0][0] = Q::one();
                q[1][1] = Q::one();
                q[2][2] = -&k * &k;
                linear[2] = -Q::from_integer(2.into()) * &b * &k;
                (c.frame.clone(), -&b * &b)
            }
            Self::Sphere(s) => {
                for (i, row) in q.iter_mut().enumerate() {
                    row[i] = Q::one();
                }
                (s.frame.clone(), -s.radius2())
            }
        };
        if constant.is_zero()
            && linear.iter().all(Q::is_zero)
            && q.iter().flatten().all(Q::is_zero)
        {
            return Err(Refused("model/degenerate-carrier"));
        }
        Ok(Implicit {
            frame,
            constant,
            linear,
            quadratic: q,
        })
    }
    pub fn contains_point(&self, p: &Point) -> Result<bool> {
        match self {
            Self::TranslatedCylinder(c) => c.contains_vertex(&VertexKey::Rational(p.clone())),
            Self::Rotated(r) => r.contains_point(p),
            Self::Torus(t) => t.contains_point(p),
            Self::RadicalPlane(_) => Ok(self.exact_plane()?.side(&super::algebraic::lift(p)).is_zero()),
            Self::Cone(c) if !c.is_rational() => c.contains_radical(&super::algebraic::lift(p)),
            Self::Plane(_) | Self::Cylinder(_) | Self::Cone(_) | Self::Sphere(_) => Ok(self.implicit()?.evaluate(p).is_zero()),
        }
    }
    pub fn contains_curve(&self, c: &Curve3) -> Result<bool> {
        use super::algebraic::{lift,dot};
        if let Self::TranslatedCylinder(s)=self {return super::translated::on_quadric(&Self::Cylinder(s.base.clone()).implicit()?,c,&std::array::from_fn(|i|s.offset[i].clone()));}
        if matches!(c,Curve3::TranslatedCircle(_)) && !matches!(self,Self::Plane(_)|Self::RadicalPlane(_)) {return super::translated::on_quadric(&self.implicit()?,c,&std::array::from_fn(|_|Radical::default()));}
        match self {
            Self::Rotated(_) | Self::Plane(_) | Self::RadicalPlane(_) => {
                let pl=self.exact_plane()?;
                Ok(match c {
                    Curve3::Line {p,d} => pl.side(&lift(p)).is_zero() && dot(&pl.n,&lift(d)).is_zero(),
                    Curve3::RadicalLine {p,d} => pl.side(p).is_zero() && dot(&pl.n,d).is_zero(),
                    Curve3::TranslatedCircle(circle) => pl.side(&circle.center()).is_zero() && dot(&pl.n,&lift(&circle.base.columns()[0])).is_zero() && dot(&pl.n,&lift(&circle.base.columns()[1])).is_zero(),
                    Curve3::Circle(circle) => pl.side(&circle.origin()).is_zero() && dot(&pl.n,&lift(&circle.columns()[0])).is_zero() && dot(&pl.n,&lift(&circle.columns()[1])).is_zero(),
                    Curve3::RadicalCircle(circle) => pl.side(&circle.center()?).is_zero() && dot(&pl.n,&lift(&circle.frame.columns()[0])).is_zero() && dot(&pl.n,&lift(&circle.frame.columns()[1])).is_zero(),
                })
            }
            Self::Cone(cone) if !cone.is_rational() => cone.contains_latitude(c),
            Self::Cylinder(cy) if cy.is_radical() || matches!(c, Curve3::Circle(k) if k.is_radical()) => {
                cy.contains_exact(c)
            }
            Self::Cone(_) | Self::Sphere(_) if matches!(c, Curve3::Circle(k) if k.is_radical()) => {
                Err(Refused(RADICAL_CENTRE))
            }
            Self::Cylinder(_) | Self::Cone(_) | Self::Sphere(_) => self.implicit()?.contains_curve(c),
            Self::Torus(t) => t.contains_curve(c),
            Self::TranslatedCylinder(_) => unreachable!(),
        }
    }
    pub fn chart_point(&self, patch: Patch, uv: &[Q; 2]) -> Result<Point> {
        match self {
            Self::TranslatedCylinder(_) => Err(Refused("model/translated-cylinder/rational-chart")),
            Self::Rotated(_) => return Err(Refused("model/rotated/rational-consumer")),
            Self::RadicalPlane(_) => Err(Refused("model/radical-plane/rational-chart")),
            Self::Plane(p) => match patch {
                Patch::First => Ok(p.point(uv)),
                Patch::Second => Err(Refused("boolean/contract-violation:atlas/plane-patch")),
            },
            Self::Cylinder(c) => revolution_point(c.frame()?, &c.radius, patch, uv),
            Self::Torus(_) => Err(Refused("boolean/ssi-row-unavailable:torus×two-patch-chart")),
            Self::Cone(c) => {
                let [b, k] = c.meridian()?;
                let r = b + k * &uv[1];
                if r.is_zero() {
                    return Err(Refused("boolean/chart-singularity:apex"));
                }
                if r.is_negative() {
                    return Err(Refused("boolean/contract-violation:atlas/cone-branch"));
                }
                revolution_point(&c.frame, &r, patch, uv)
            }
            Self::Sphere(s) => {
                let d = Q::one() + &uv[0] * &uv[0] + &uv[1] * &uv[1];
                if d > Q::from_integer(2.into()) {
                    return Err(Refused("boolean/contract-violation:atlas/outside-patch"));
                }
                let two = Q::from_integer(2.into());
                Ok(s.frame.point(&[
                    &two * &s.radius * &uv[0] / &d,
                    patch.sign() * &two * &s.radius * &uv[1] / &d,
                    patch.sign() * &s.radius * (Q::from_integer(2.into()) - &d) / d,
                ]))
            }
        }
    }
    pub fn chart_coordinates(&self, patch: Patch, p: &Point) -> Result<[Q; 2]> {
        if !self.contains_point(p)? {
            return Err(Refused("boolean/contract-violation:atlas/off-carrier"));
        }
        match self {
            Self::TranslatedCylinder(_) => return Err(Refused("model/translated-cylinder/rational-chart")),
            Self::Rotated(_) => return Err(Refused("model/rotated/rational-consumer")),
            Self::RadicalPlane(_) => return Err(Refused("model/radical-plane/rational-chart")),
            Self::Plane(pl) => match patch {
                Patch::First => pl.chart(p),
                Patch::Second => Err(Refused("boolean/contract-violation:atlas/plane-patch")),
            },
            Self::Cylinder(c) => revolution_coordinates(c.frame()?, &c.radius, patch, p),
            Self::Torus(_) => Err(Refused("boolean/ssi-row-unavailable:torus×two-patch-chart")),
            Self::Cone(c) => {
                let z = c.frame.inverse().point(p)[2].clone();
                let [b, k] = c.meridian()?;
                let r = b + k * z;
                if r.is_zero() {
                    return Err(Refused("boolean/chart-singularity:apex"));
                }
                if r.is_negative() {
                    return Err(Refused("boolean/contract-violation:atlas/cone-branch"));
                }
                revolution_coordinates(&c.frame, &r, patch, p)
            }
            Self::Sphere(s) => {
                let p = s.frame.inverse().point(p);
                let d = &s.radius + patch.sign() * &p[2];
                if d.is_zero() {
                    return Err(Refused("boolean/chart-singularity:pole"));
                }
                let uv = [&p[0] / &d, patch.sign() * &p[1] / d];
                if &uv[0] * &uv[0] + &uv[1] * &uv[1] > Q::one() {
                    return Err(Refused("boolean/contract-violation:atlas/outside-patch"));
                }
                Ok(uv)
            }
        }
    }
}
fn revolution_point(frame: &Frame, r: &Q, patch: Patch, uv: &[Q; 2]) -> Result<Point> {
    if uv[0].abs() > Q::one() {
        return Err(Refused("boolean/contract-violation:atlas/outside-patch"));
    }
    let [c, s] = half_angle(patch, &uv[0]);
    Ok(frame.point(&[r * c, r * s, uv[1].clone()]))
}
fn revolution_coordinates(frame: &Frame, r: &Q, patch: Patch, p: &Point) -> Result<[Q; 2]> {
    let p = frame.inverse().point(p);
    let sign = patch.sign();
    let d = r + &sign * &p[0];
    if d.is_zero() {
        return Err(Refused("boolean/contract-violation:atlas/outside-patch"));
    }
    let t = sign * &p[1] / d;
    if t.abs() > Q::one() {
        return Err(Refused("boolean/contract-violation:atlas/outside-patch"));
    }
    Ok([t, p[2].clone()])
}

/// Three coordinates in one quadratic field. Equality/order reuse the exact
/// square-class arithmetic already used by the chart arrangement (S13).
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct QuadraticPoint3([Radical; 3]);
impl QuadraticPoint3 {
    /// Admit one shared quadratic field, preserving the existing exact key
    /// across vertex definition classes. Wider fields need a separate key row.
    pub fn from_coordinates(coordinates: [Radical; 3]) -> Result<Self> {
        let mut field: Option<Q> = None;
        for x in &coordinates {
            let (_, b, r) = x.parts().ok_or(Refused("chamfer/multiquadratic-vertex-unavailable"))?;
            if !b.is_zero() {
                if let Some(s) = &field {
                    if wonky_curve::numeric::exact_root(&(r.clone() / s)).is_none() {
                        return Err(Refused("chamfer/multiquadratic-vertex-unavailable"));
                    }
                } else { field = Some(r); }
            }
        }
        Ok(Self(coordinates))
    }

    pub fn new(base: Point, offset: Point, radicand: Q) -> Result<Self> {
        if radicand.is_negative() {
            return Err(Refused(
                "boolean/contract-violation:vertex/negative-radicand",
            ));
        }
        let coordinates = (0..3)
            .map(|i| Radical::quadratic(base[i].clone(), offset[i].clone(), radicand.clone()))
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|_| Refused("boolean/budget-exceeded:quadratic"))?;
        Ok(Self(std::array::from_fn(|i| coordinates[i].clone())))
    }
    pub fn coordinates(&self) -> &[Radical; 3] {
        &self.0
    }
    pub fn key(&self) -> VertexKey {
        match self.rational() {
            Some(p) => VertexKey::Rational(p),
            None => VertexKey::Quadratic(self.clone()),
        }
    }
    pub fn rational(&self) -> Option<Point> {
        Some([
            self.0[0].rational()?,
            self.0[1].rational()?,
            self.0[2].rational()?,
        ])
    }
    pub fn mapped(&self, f: &Frame) -> Result<Self> {
        radical::guard(|| {
            Self(std::array::from_fn(|i| {
                (0..3).fold(Radical::from(f.origin()[i].clone()), |v, j| {
                    v + &self.0[j] * &f.columns()[j][i]
                })
            }))
        })
        .map_err(|_| Refused("boolean/budget-exceeded:quadratic"))
    }
}

/// A torus in its own frame: centre at the frame origin, axis the third
/// column, tube centre circle of radius `major` in the first two columns,
/// tube radius `minor`. The minor is rational; the major is exact in Q or in
/// one quadratic field Q(√d) (fillets3d design §2.6: plane–sphere spines and
/// cone rims put torus majors there, errata 2). Nothing is a rounded square
/// root. `major < minor` is a spindle torus: a face uses only the outer
/// (apple) sheet, decided exactly by the sign of `S` (tube bands).
/// `major = 0` is a sphere and is refused here: such a blend must emit
/// `Carrier3::Sphere`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Torus3 {
    pub frame: Frame,
    major: Radical,
    minor: Q,
}

/// A polynomial in model coordinates keyed by exponent triple.
pub type Quartic = std::collections::BTreeMap<[u8; 3], Radical>;

fn budget<T, E>(r: std::result::Result<T, E>) -> Result<T> {
    r.map_err(|_| Refused("boolean/budget-exceeded:torus-identity"))
}

impl Torus3 {
    pub fn new(frame: Frame, major: Q, minor: Q) -> Result<Self> {
        Self::quadratic(frame, Radical::from(major), minor)
    }
    /// A torus whose major lies in one quadratic field. A major with two or
    /// more radical classes is outside the admitted number class and refuses
    /// by name.
    pub fn quadratic(frame: Frame, major: Radical, minor: Q) -> Result<Self> {
        if major.parts().is_none() {
            return Err(Refused("blend/number-class-exceeded:torus-major"));
        }
        if !minor.is_positive() || major.is_negative() {
            return Err(Refused("boolean/contract-violation:carrier/torus-radii"));
        }
        if major.is_zero() {
            return Err(Refused("model/torus-major-zero:sphere-required"));
        }
        if major == minor {
            return Err(Refused("boolean/chart-singularity:horn-torus"));
        }
        Ok(Self { frame, major, minor })
    }
    pub fn major(&self) -> &Radical {
        &self.major
    }
    /// The major of a consumer that has no Q(√d) row (tube bands, their
    /// measures, the rational chart, the rational gradient).
    pub fn rational_major(&self) -> Result<Q> {
        self.major
            .rational()
            .ok_or(Refused("boolean/ssi-row-unavailable:torus/quadratic-major"))
    }
    pub fn minor(&self) -> &Q {
        &self.minor
    }
    /// Local coordinates of a model point given in the major's field.
    fn local(&self, p: &[Radical; 3]) -> [Radical; 3] {
        let inverse = self.frame.inverse();
        std::array::from_fn(|i| {
            (0..3).fold(Radical::from(inverse.origin()[i].clone()), |v, j| {
                v + &p[j] * &inverse.columns()[j][i]
            })
        })
    }
    /// The quartic `S² − 4R²(x²+y²)`, `S = x²+y²+z²+R²−a²`, at local
    /// coordinates. It is the product of the own and the mirrored tube circle
    /// of each meridian half-plane.
    fn quartic_at(&self, l: &[Radical; 3]) -> Radical {
        let r2 = &self.major * &self.major;
        let rho2 = &l[0] * &l[0] + &l[1] * &l[1];
        let s = &rho2 + &l[2] * &l[2] + &r2 - Radical::from(&self.minor * &self.minor);
        &s * &s - rho2 * (r2 * Q::from_integer(4.into()))
    }
    pub fn contains_point(&self, p: &Point) -> Result<bool> {
        self.contains_radical(&super::algebraic::lift(p))
    }
    pub(super) fn contains_radical(&self, p: &[Radical; 3]) -> Result<bool> {
        budget(radical::guard(|| self.quartic_at(&self.local(p)).is_zero()))
    }
    /// Substitute the whole rational curve into the quartic; every
    /// coefficient of the cleared degree-8 numerator must vanish. A torus
    /// contains no straight line.
    pub fn contains_curve(&self, curve: &Curve3) -> Result<bool> {
        let c = match curve {
            Curve3::Line { .. } | Curve3::RadicalLine { .. } => return Ok(false),
            Curve3::TranslatedCircle(_) => return Err(Refused("model/translated-circle/torus-consumer")),
            Curve3::RadicalCircle(c) => {
                // A latitude of the torus frame lies on the torus iff its
                // (ρ², z) satisfies the quartic: S² = 4R²ρ², exactly in Q(√d).
                let map = self.frame.relation_from(&c.frame).map;
                let [x, y, z] = map.columns();
                if !map.origin()[0].is_zero() || !map.origin()[1].is_zero() || !x[2].is_zero() || !y[2].is_zero()
                    || !z[0].is_zero() || !z[1].is_zero()
                {
                    return Ok(false);
                }
                return budget(radical::guard(|| {
                    let h = Radical::from(map.origin()[2].clone()) + c.height() * &z[2];
                    let rho2 = c.radius() * c.radius() * &(&x[0] * &x[0] + &x[1] * &x[1]);
                    let r2 = &self.major * &self.major;
                    let s = &rho2 + &(&h * &h) + &r2 - Radical::from(&self.minor * &self.minor);
                    &s * &s == rho2 * &r2 * &Q::from_integer(4.into())
                }));
            }
            Curve3::Circle(c) => c,
        };
        let map = self.frame.relation_from(c.frame()?).map;
        let o = map.origin();
        let [x, y, _z] = map.columns();
        let two = Q::from_integer(2.into());
        // Numerator coordinates as polynomials in t over the denominator 1+t².
        let n: [Vec<Radical>; 3] = std::array::from_fn(|i| {
            [&o[i] + &c.radius * &x[i], &two * &c.radius * &y[i], &o[i] - &c.radius * &x[i]]
                .map(Radical::from)
                .to_vec()
        });
        let d = vec![Radical::from(Q::one()), Radical::default(), Radical::from(Q::one())];
        let mul = |a: &[Radical], b: &[Radical]| {
            let mut out = vec![Radical::default(); a.len() + b.len() - 1];
            for (i, u) in a.iter().enumerate() {
                for (j, v) in b.iter().enumerate() {
                    out[i + j] = &out[i + j] + &(u * v);
                }
            }
            out
        };
        let add = |a: Vec<Radical>, b: Vec<Radical>| {
            let mut out = vec![Radical::default(); a.len().max(b.len())];
            for (i, v) in a.into_iter().enumerate() {
                out[i] = &out[i] + &v;
            }
            for (i, v) in b.into_iter().enumerate() {
                out[i] = &out[i] + &v;
            }
            out
        };
        let scale = |a: Vec<Radical>, s: &Radical| a.into_iter().map(|v| &v * s).collect::<Vec<_>>();
        budget(radical::guard(|| {
            let r2 = &self.major * &self.major;
            let rho2 = add(mul(&n[0], &n[0]), mul(&n[1], &n[1]));
            let d2 = mul(&d, &d);
            let s = add(
                add(rho2.clone(), mul(&n[2], &n[2])),
                scale(d2.clone(), &(&r2 - Radical::from(&self.minor * &self.minor))),
            );
            let quartic = add(
                mul(&s, &s),
                scale(mul(&d2, &rho2), &(r2 * -Q::from_integer(4.into()))),
            );
            quartic.iter().all(Radical::is_zero)
        }))
    }
    /// Model point of the 4-patch half-angle atlas in the major's field: `u`
    /// is the azimuth chart (patch `pu`), `v` the tube-angle chart (patch
    /// `pv`, First: the outer half of the tube, Second: the inner half).
    pub fn chart_point_radical(&self, pu: Patch, pv: Patch, uv: &[Q; 2]) -> Result<[Radical; 3]> {
        if uv[0].abs() > Q::one() || uv[1].abs() > Q::one() {
            return Err(Refused("boolean/contract-violation:atlas/outside-patch"));
        }
        let [cu, su] = half_angle(pu, &uv[0]);
        let [cv, sv] = half_angle(pv, &uv[1]);
        let rho = &self.major + &(&self.minor * cv);
        if rho.is_negative() {
            return Err(Refused("boolean/contract-violation:atlas/torus-mirrored-sheet"));
        }
        let l = [&rho * &cu, &rho * &su, Radical::from(&self.minor * sv)];
        budget(radical::guard(|| {
            std::array::from_fn(|i| {
                (0..3).fold(Radical::from(self.frame.origin()[i].clone()), |v, j| {
                    v + &l[j] * &self.frame.columns()[j][i]
                })
            })
        }))
    }
    /// The rational atlas point; rational in, rational out on a rational
    /// major.
    pub fn chart_point(&self, pu: Patch, pv: Patch, uv: &[Q; 2]) -> Result<Point> {
        self.rational_major()?;
        let p = self.chart_point_radical(pu, pv, uv)?;
        Ok(std::array::from_fn(|i| p[i].rational().expect("rational major, rational chart")))
    }
    /// Polynomial coefficients of the quartic in model coordinates, keyed by
    /// exponent triple: the exact point-set identity for canonical keys. The
    /// coefficients lie in the major's field (rational when R² is).
    pub fn model_quartic(&self) -> Quartic {
        let inverse = self.frame.inverse();
        let affine = |i: usize| -> Quartic {
            let mut p = Quartic::new();
            p.insert([0, 0, 0], Radical::from(inverse.origin()[i].clone()));
            for j in 0..3 {
                let mut e = [0u8; 3];
                e[j] = 1;
                p.insert(e, Radical::from(inverse.columns()[j][i].clone()));
            }
            p
        };
        let mul = |a: &Quartic, b: &Quartic| {
            let mut out = Quartic::new();
            for (ea, ca) in a {
                for (eb, cb) in b {
                    let e = [ea[0] + eb[0], ea[1] + eb[1], ea[2] + eb[2]];
                    let v = out.entry(e).or_default();
                    *v = &*v + &(ca * cb);
                }
            }
            out
        };
        let add = |a: &Quartic, b: &Quartic| {
            let mut out = a.clone();
            for (e, c) in b {
                let v = out.entry(*e).or_default();
                *v = &*v + c;
            }
            out
        };
        let r2 = &self.major * &self.major;
        let constant = |c: Radical| Quartic::from([([0, 0, 0], c)]);
        let l = [affine(0), affine(1), affine(2)];
        let rho2 = add(&mul(&l[0], &l[0]), &mul(&l[1], &l[1]));
        let s = add(
            &add(&rho2, &mul(&l[2], &l[2])),
            &constant(&r2 - Radical::from(&self.minor * &self.minor)),
        );
        let q = add(&mul(&s, &s), &mul(&rho2, &constant(r2 * -Q::from_integer(4.into()))));
        q.into_iter().filter(|(_, c)| !c.is_zero()).collect()
    }
    /// Gradient of the quartic at a model point. On the own sheet it is a
    /// positive multiple (4Rρ) of the gradient of the own tube circle, so it
    /// points away from the tube centre there, as a quadric gradient does.
    pub fn gradient(&self, p: &Point) -> Result<Point> {
        let major = self.rational_major()?;
        let inverse = self.frame.inverse();
        let l = inverse.point(p);
        let r2 = &major * &major;
        let s = &l[0] * &l[0] + &l[1] * &l[1] + &l[2] * &l[2] + &r2 - &self.minor * &self.minor;
        let four = Q::from_integer(4.into());
        let g = [
            &four * &l[0] * (&s - Q::from_integer(2.into()) * &r2),
            &four * &l[1] * (&s - Q::from_integer(2.into()) * &r2),
            &four * &l[2] * &s,
        ];
        // ∇_model = (M⁻¹)ᵀ ∇_local.
        Ok(std::array::from_fn(|j| (0..3).map(|i| &inverse.columns()[j][i] * &g[i]).sum()))
    }
}
