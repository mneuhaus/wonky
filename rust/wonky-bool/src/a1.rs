//! Exact, untrimmed A1 SSI producers (G9, dark; consumed by G10).
//! Carrier data are rational by the G8 constructors, not by the surface tag.
//! Every branch is checked by polynomial substitution into BOTH carriers.
//! X8: predicates use carrier coefficients and at most two constructed points.
//! X9: edge paves are roots on the incident line/circle, never 3D resultants.
//! No admission, face split, sewn Boolean or conics are claimed here. G14 adds
//! the sphere rows: a plane, a sphere or a coaxial cylinder meets a sphere in
//! circles perpendicular to one column of the sphere frame, with exact r².
use num_traits::{One, Signed, Zero};
use std::cmp::Ordering;
use wonky_alg::{isolate_real_roots, AlgebraicReal, Limits, Polynomial, SturmSequence};
use wonky_curve::{
    numeric::exact_root,
    radical::{self, Radical},
};
use wonky_geom::{
    dot,
    frame::Frame,
    model::{Carrier3, Curve3},
    Refused, Result, Q,
};

type RPoint = [Radical; 3];
fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn arithmetic<T>(f: impl FnOnce() -> T) -> Result<T> {
    radical::guard(f).map_err(|_| Refused("boolean/budget-exceeded:ssi-radical"))
}
fn poly(c: Vec<Q>) -> Result<Polynomial> {
    Polynomial::new(c).map_err(|_| Refused("boolean/contract-violation:ssi/polynomial"))
}

/// Root on the lowest-degree incident curve. Algebraic roots remain definitions;
/// no rounded coordinate is substituted into a subsequent topology predicate.
#[derive(Clone, Debug)]
pub struct Pave {
    pub parameter: Parameter,
    /// Even multiplicity is a touch, never two crossings.
    pub multiplicity: usize,
    exact: AlgebraicReal,
}
#[derive(Clone, Debug)]
pub enum Parameter {
    Quadratic(Radical),
    Algebraic(AlgebraicReal),
}
impl Pave {
    pub fn cmp(&self, other: &Self, limits: Limits) -> Result<Ordering> {
        self.exact
            .cmp(&other.exact, limits)
            .map_err(|_| Refused("boolean/budget-exceeded:ssi-root-order"))
    }
    pub fn is_touch(&self) -> bool {
        self.multiplicity % 2 == 0
    }
    fn radical(&self) -> Result<Radical> {
        match &self.parameter {
            Parameter::Quadratic(x) => Ok(x.clone()),
            Parameter::Algebraic(_) => {
                Err(Refused("boolean/ssi-row-unavailable:algebraic/coordinate"))
            }
        }
    }
}
/// Complete real roots, including multiplicity. Degree <= 2 gets Q(sqrt);
/// higher-degree substitution equations use S2's AlgebraicReal fallback.
/// The independent Sturm count is checked before a caller receives any paves.
pub fn roots(equation: &Polynomial, limits: Limits) -> Result<Vec<Pave>> {
    if equation.is_zero() {
        return Err(Refused("boolean/coincidence-unproved"));
    }
    let exact = isolate_real_roots(equation, limits)
        .map_err(|_| Refused("boolean/budget-exceeded:ssi-roots"))?;
    let mut simple = vec![];
    let c = equation.coefficients();
    match equation.degree() {
        None | Some(0) => (),
        Some(1) => simple.push(Radical::from(-&c[0] / &c[1])),
        Some(2) => {
            let delta = &c[1] * &c[1] - q(4) * &c[2] * &c[0];
            if !delta.is_negative() {
                let base = -&c[1] / (q(2) * &c[2]);
                let offset = Q::one() / (q(2) * &c[2]);
                for sign in if delta.is_zero() {
                    vec![q(0)]
                } else {
                    vec![q(-1), q(1)]
                } {
                    simple.push(
                        Radical::quadratic(base.clone(), &offset * sign, delta.clone())
                            .map_err(|_| Refused("boolean/budget-exceeded:ssi-quadratic"))?,
                    );
                }
                arithmetic(|| simple.sort())?;
            }
        }
        Some(_) => (),
    }
    let count = SturmSequence::new(equation)
        .map_err(|_| Refused("boolean/contract-violation:ssi/sturm"))?
        .real_root_count();
    if exact.len() != count || (equation.degree().unwrap_or(0) <= 2 && simple.len() != count) {
        return Err(Refused("boolean/contract-violation:ssi/completeness"));
    }
    Ok(exact
        .into_iter()
        .enumerate()
        .map(|(i, r)| Pave {
            parameter: if simple.is_empty() {
                Parameter::Algebraic(r.clone())
            } else {
                Parameter::Quadratic(simple[i].clone())
            },
            multiplicity: r.multiplicity(),
            exact: r,
        })
        .collect())
}

#[derive(Clone, Debug)]
pub enum Branch {
    Line {
        p: RPoint,
        d: RPoint,
    },
    /// Circle in a rational own frame, with exact height and signed radius.
    /// A zero radius is emitted as Point, never a degenerate circle.
    Circle {
        frame: Frame,
        height: Radical,
        radius: Radical,
    },
    Point(RPoint),
}
#[derive(Clone, Debug)]
pub struct SectionBranch {
    pub curve: Branch,
    pub multiplicity: usize,
}
#[derive(Clone, Debug)]
pub enum Intersection {
    Coincident,
    Section {
        branches: Vec<SectionBranch>,
        equation: Polynomial,
    },
}

// Polynomial arithmetic in the proven quadratic field of each branch.
fn add(a: &[Radical], b: &[Radical]) -> Vec<Radical> {
    (0..a.len().max(b.len()))
        .map(|i| a.get(i).cloned().unwrap_or_default() + b.get(i).cloned().unwrap_or_default())
        .collect()
}
fn mul(a: &[Radical], b: &[Radical]) -> Vec<Radical> {
    let mut c = vec![Radical::default(); a.len() + b.len() - 1];
    for (i, x) in a.iter().enumerate() {
        for (j, y) in b.iter().enumerate() {
            c[i + j] = &c[i + j] + x * y;
        }
    }
    c
}
fn scale(a: &[Radical], x: &Q) -> Vec<Radical> {
    a.iter().map(|a| a * x).collect()
}
impl Branch {
    /// Numerator and denominator in a rational parameter. Circles use the
    /// projective half-angle chart; infinity is a separate seam, not a root.
    pub fn parametrization(&self) -> Result<([Vec<Radical>; 3], Vec<Radical>)> {
        arithmetic(|| match self {
            Self::Line { p, d } => (
                std::array::from_fn(|i| vec![p[i].clone(), d[i].clone()]),
                vec![Q::one().into()],
            ),
            Self::Point(p) => (p.clone().map(|x| vec![x]), vec![Q::one().into()]),
            Self::Circle {
                frame,
                height,
                radius,
            } => {
                let den = vec![Q::one().into(), Q::zero().into(), Q::one().into()];
                let numer = std::array::from_fn(|i| {
                    let base =
                        Radical::from(frame.origin()[i].clone()) + height * &frame.columns()[2][i];
                    let x = radius * &frame.columns()[0][i];
                    let y = radius * &frame.columns()[1][i];
                    vec![&base + &x, y * q(2), base - x]
                });
                (numer, den)
            }
        })
    }
    pub fn point(&self, t: &Q) -> Result<RPoint> {
        let (n, d) = self.parametrization()?;
        arithmetic(|| {
            let eval = |p: &[Radical]| p.iter().rev().fold(Radical::default(), |s, c| s * t + c);
            let den = eval(&d);
            n.map(|p| eval(&p) / &den)
        })
    }
    pub fn lies_on(&self, carrier: &Carrier3) -> Result<bool> {
        let (n, d) = self.parametrization()?;
        let c = carrier.implicit()?.coefficients();
        arithmetic(|| substitute(&c, &n, &d).iter().all(Radical::is_zero))
    }
}
fn substitute(c: &[Q; 10], n: &[Vec<Radical>; 3], d: &[Radical]) -> Vec<Radical> {
    let mut out = scale(&mul(d, d), &c[0]);
    for i in 0..3 {
        out = add(&out, &scale(&mul(&n[i], d), &c[i + 1]));
    }
    for (k, (i, j)) in [(0, 0), (0, 1), (0, 2), (1, 1), (1, 2), (2, 2)]
        .into_iter()
        .enumerate()
    {
        out = add(&out, &scale(&mul(&n[i], &n[j]), &c[k + 4]));
    }
    out
}

/// E x F by substitution on the existing edge, as X9 requires. An identically
/// zero numerator proves an edge/rim on the carrier. The projective circle
/// seam is reported independently, with its exact contact multiplicity.
#[derive(Clone, Debug)]
pub enum EdgeContact {
    OnCarrier,
    Paves {
        finite: Vec<Pave>,
        seam_multiplicity: Option<usize>,
    },
}
pub fn edge_carrier(edge: &Curve3, carrier: &Carrier3, limits: Limits) -> Result<EdgeContact> {
    let branch = match edge {
        Curve3::Line { p, d } => Branch::Line {
            p: p.clone().map(Radical::from),
            d: d.clone().map(Radical::from),
        },
        Curve3::TranslatedCircle(_) => return Err(Refused("boolean/ssi-row-unavailable:translated-circle/A1")),
        Curve3::RadicalLine { .. } => return Err(Refused("boolean/ssi-row-unavailable:radical-line/A1")),
        Curve3::RadicalCircle(_) => return Err(Refused("boolean/ssi-row-unavailable:radical-circle/A1")),
        Curve3::Circle(c) => Branch::Circle {
            frame: c.frame()?.clone(),
            height: Q::zero().into(),
            radius: exact_root(&c.radius2())
                .ok_or(Refused("boolean/ssi-row-unavailable:edge/quadratic-radius"))?
                .into(),
        },
    };
    let (n, d) = branch.parametrization()?;
    let implicit = carrier.implicit()?.coefficients();
    let coefficients = arithmetic(|| substitute(&implicit, &n, &d))?
        .into_iter()
        .map(|x| {
            x.rational().ok_or(Refused(
                "boolean/ssi-row-unavailable:edge/coefficient-field",
            ))
        })
        .collect::<Result<Vec<_>>>()?;
    let equation = poly(coefficients)?;
    if equation.is_zero() {
        return Ok(EdgeContact::OnCarrier);
    }
    let seam_multiplicity = match edge {
        Curve3::Line { .. } | Curve3::RadicalLine { .. } => None,
        Curve3::TranslatedCircle(_) => return Err(Refused("boolean/ssi-row-unavailable:translated-circle/A1")),
        Curve3::Circle(_) | Curve3::RadicalCircle(_) => {
            let missing = 4 - equation.degree().unwrap_or(0);
            (missing > 0).then_some(missing)
        }
    };
    let finite = roots(&equation, limits)?;
    if finite.iter().any(|p| p.multiplicity > 2) || seam_multiplicity.is_some_and(|m| m > 2) {
        return Err(Refused("boolean/higher-order-contact"));
    }
    Ok(EdgeContact::Paves {
        finite,
        seam_multiplicity,
    })
}

fn frame(c: &Carrier3) -> Result<&Frame> {
    match c {
        Carrier3::TranslatedCylinder(_) => Err(Refused("boolean/ssi-row-unavailable:translated-cylinder/A1")),
        Carrier3::Cylinder(c) => c.frame(),
        Carrier3::Cone(c) => Ok(&c.frame),
        Carrier3::Plane(_) => Err(Refused("boolean/ssi-row-unavailable:plane/revolution")),
        Carrier3::Rotated(_) => Err(Refused("boolean/ssi-row-unavailable:rotated/A1")),
        Carrier3::RadicalPlane(_) => Err(Refused("model/radical-plane/rational-implicit")),
        Carrier3::Sphere(_) => Err(Refused("boolean/ssi-row-unavailable:sphere/A1")),
        Carrier3::Torus(_) => Err(Refused("boolean/ssi-row-unavailable:torus×revolution")),
    }
}
fn meridian(c: &Carrier3) -> Result<[Q; 2]> {
    match c {
        Carrier3::TranslatedCylinder(_) => Err(Refused("boolean/ssi-row-unavailable:translated-cylinder/A1")),
        Carrier3::Cylinder(c) => Ok([
            exact_root(&c.radius2()).ok_or(Refused(
                "boolean/ssi-row-unavailable:carrier/quadratic-radius",
            ))?,
            Q::zero(),
        ]),
        Carrier3::Cone(c) => c.meridian(),
        Carrier3::Plane(_) => Err(Refused("boolean/ssi-row-unavailable:plane/revolution")),
        Carrier3::Rotated(_) => Err(Refused("boolean/ssi-row-unavailable:rotated/A1")),
        Carrier3::RadicalPlane(_) => Err(Refused("model/radical-plane/rational-implicit")),
        Carrier3::Sphere(_) => Err(Refused("boolean/ssi-row-unavailable:sphere/A1")),
        Carrier3::Torus(_) => Err(Refused("boolean/ssi-row-unavailable:torus×revolution")),
    }
}
fn normalized(c: &Carrier3) -> Result<Vec<Q>> {
    let cs = c.implicit()?.coefficients();
    let unit = cs.iter().find(|x| !x.is_zero()).expect("valid carrier");
    Ok(cs.iter().map(|x| x / unit).collect())
}
fn certify(
    a: &Carrier3,
    b: &Carrier3,
    equation: Polynomial,
    mut branches: Vec<SectionBranch>,
) -> Result<Intersection> {
    if cfg!(feature = "plant_ssi_double_crossing") {
        if let Some(branch) = branches.iter().find(|b| b.multiplicity == 2).cloned() {
            branches.push(branch);
        }
    }
    let count = SturmSequence::new(&equation)
        .map_err(|_| Refused("boolean/contract-violation:ssi/sturm"))?
        .real_root_count();
    if branches.len() != count {
        return Err(Refused("boolean/contract-violation:ssi/completeness"));
    }
    for branch in &branches {
        if !branch.curve.lies_on(a)? || !branch.curve.lies_on(b)? {
            return Err(Refused("boolean/contract-violation:ssi/identity"));
        }
    }
    Ok(Intersection::Section { branches, equation })
}
fn circle(frame: &Frame, height: Radical, radius: Radical) -> Result<Branch> {
    if radius.is_zero() {
        let p = arithmetic(|| {
            std::array::from_fn(|i| {
                Radical::from(frame.origin()[i].clone()) + &height * &frame.columns()[2][i]
            })
        })?;
        Ok(Branch::Point(p))
    } else {
        Ok(Branch::Circle {
            frame: frame.clone(),
            height,
            radius,
        })
    }
}

/// Whole-carrier SSI. Completeness is branch count = distinct Sturm count
/// on a rational transversal (height for rings; one radial coordinate for
/// parallel generators). Coincidence is an exact implicit identity.
pub fn intersect(a: &Carrier3, b: &Carrier3, limits: Limits) -> Result<Intersection> {
    if normalized(a)? == normalized(b)? {
        return Ok(Intersection::Coincident);
    }
    match (a, b) {
        (Carrier3::TranslatedCylinder(_), _) | (_, Carrier3::TranslatedCylinder(_)) => Err(Refused("boolean/ssi-row-unavailable:translated-cylinder/A1")),
        (Carrier3::Sphere(s), _) => sphere_rows(a, s, b, limits),
        (_, Carrier3::Sphere(s)) => sphere_rows(b, s, a, limits),
        (Carrier3::Plane(p), Carrier3::Cylinder(_) | Carrier3::Cone(_)) => {
            plane_revolution(a, b, p, limits)
        }
        (Carrier3::Cylinder(_) | Carrier3::Cone(_), Carrier3::Plane(p)) => {
            plane_revolution(b, a, p, limits)
        }
        (Carrier3::Cylinder(_) | Carrier3::Cone(_), Carrier3::Cylinder(_) | Carrier3::Cone(_)) => {
            revolutions(a, b, limits)
        }
        (Carrier3::Plane(_), Carrier3::Plane(_)) => {
            Err(Refused("boolean/ssi-row-unavailable:plane×plane/A1-use-A0"))
        }
        (Carrier3::Rotated(_), _) | (_, Carrier3::Rotated(_)) => return Err(Refused("boolean/ssi-row-unavailable:rotated/A1")),
        (Carrier3::RadicalPlane(_), _) | (_, Carrier3::RadicalPlane(_)) => {
            Err(Refused("model/radical-plane/rational-implicit"))
        }
        (Carrier3::Torus(_), _) | (_, Carrier3::Torus(_)) => {
            Err(Refused("boolean/ssi-row-unavailable:torus×A1"))
        }
    }
}
fn plane_revolution(
    a: &Carrier3,
    b: &Carrier3,
    p: &wonky_geom::model::Plane3,
    limits: Limits,
) -> Result<Intersection> {
    let f = frame(b)?;
    let n = f.columns().each_ref().map(|v| dot(&p.n, v));
    let d = dot(&p.n, &wonky_geom::sub(&p.o, f.origin()));
    let [base, slope] = meridian(b)?;
    if n[0].is_zero() && n[1].is_zero() {
        let h = &d / &n[2];
        let equation = poly(vec![-d, n[2].clone()])?;
        let curve = circle(f, h.clone().into(), (&base + &slope * h).into())?;
        return certify(
            a,
            b,
            equation,
            vec![SectionBranch {
                curve,
                multiplicity: 1,
            }],
        );
    }
    if !n[2].is_zero() {
        return Err(Refused(match b {
            Carrier3::TranslatedCylinder(_) => "boolean/ssi-row-unavailable:translated-cylinder/A1",
            Carrier3::Cylinder(_) => "boolean/ssi-row-unavailable:plane×cylinder/oblique",
            Carrier3::Cone(_) => "boolean/ssi-row-unavailable:plane×cone/oblique",
            Carrier3::Plane(_) => "boolean/ssi-row-unavailable:plane×plane/A1-use-A0",
            Carrier3::Sphere(_) => "boolean/ssi-row-unavailable:sphere/A1",
            Carrier3::Rotated(_) => "boolean/ssi-row-unavailable:rotated/A1",
            Carrier3::Torus(_) => "boolean/ssi-row-unavailable:torus×plane",
            Carrier3::RadicalPlane(_) => "model/radical-plane/rational-implicit",
        }));
    }
    // A genuine cone with a parallel off-axis plane has hyperbolas, not A1.
    if !slope.is_zero() && !d.is_zero() {
        return Err(Refused(
            "boolean/ssi-row-unavailable:plane×cone/parallel-offset",
        ));
    }
    let (origin, radial) = if slope.is_zero() {
        (Q::zero(), base)
    } else {
        (-&base / &slope, slope.clone())
    };
    let rhs = if slope.is_zero() { d } else { Q::zero() };
    let n2 = &n[0] * &n[0] + &n[1] * &n[1];
    // x,y = n*rhs/n² + (-ny,nx)*u. Two roots are two distinct
    // generators; delta=0 is exactly one double generator (AC22/23).
    let equation = poly(vec![
        &rhs * &rhs / &n2 - &radial * &radial,
        Q::zero(),
        n2.clone(),
    ])?;
    let mut branches = vec![];
    for root in roots(&equation, limits)? {
        let u = root.radical()?;
        let xy = arithmetic(|| {
            [
                Radical::from(&n[0] * &rhs / &n2) - &u * &n[1],
                Radical::from(&n[1] * &rhs / &n2) + &u * &n[0],
            ]
        })?;
        let (p, d) = if slope.is_zero() {
            (
                [xy[0].clone(), xy[1].clone(), origin.clone().into()],
                [Q::zero().into(), Q::zero().into(), Q::one().into()],
            )
        } else {
            (
                [Q::zero().into(), Q::zero().into(), origin.clone().into()],
                [xy[0].clone(), xy[1].clone(), Q::one().into()],
            )
        };
        let map = |v: RPoint, is_point: bool| {
            arithmetic(|| {
                std::array::from_fn(|i| {
                    (0..3).fold(
                        Radical::from(if is_point {
                            f.origin()[i].clone()
                        } else {
                            Q::zero()
                        }),
                        |s, j| s + &v[j] * &f.columns()[j][i],
                    )
                })
            })
        };
        branches.push(SectionBranch {
            curve: Branch::Line {
                p: map(p, true)?,
                d: map(d, false)?,
            },
            multiplicity: root.multiplicity,
        });
    }
    certify(a, b, equation, branches)
}
fn revolutions(a: &Carrier3, b: &Carrier3, limits: Limits) -> Result<Intersection> {
    let f = frame(a)?;
    let implicit = b.implicit()?;
    // Exact pullback into A's own frame (affine placements need not be rigid).
    let local = wonky_geom::model::curved::Implicit {
        frame: implicit.frame.relation_from(f).map.inverse(),
        constant: implicit.constant.clone(),
        linear: implicit.linear.clone(),
        quadratic: implicit.quadratic.clone(),
    };
    let mut c = local.coefficients();
    if c[4].is_zero() || c[4] != c[7] || !c[5].is_zero() || !c[6].is_zero() || !c[8].is_zero() {
        return Err(Refused(
            "boolean/ssi-row-unavailable:revolution×revolution/non-parallel-or-metric",
        ));
    }
    let scale = c[4].clone();
    for v in &mut c {
        *v /= &scale;
    }
    let [base, slope] = meridian(a)?;
    if c[1].is_zero() && c[2].is_zero() {
        // Meridian reduction adopted from P11: subtract rho_A(z)^2 from
        // the pulled-back quadratic radial profile, solve only for height.
        let equation = poly(vec![
            &c[0] + &base * &base,
            &c[3] + q(2) * &base * &slope,
            &c[9] + &slope * &slope,
        ])?;
        if equation.is_zero() {
            return Ok(Intersection::Coincident);
        }
        let mut branches = vec![];
        for root in roots(&equation, limits)? {
            let h = root.radical()?;
            let r = arithmetic(|| Radical::from(base.clone()) + &h * &slope)?;
            branches.push(SectionBranch {
                curve: circle(f, h, r)?,
                multiplicity: root.multiplicity,
            });
        }
        return certify(a, b, equation, branches);
    }
    if !slope.is_zero() || !c[3].is_zero() || !c[9].is_zero() {
        return Err(Refused(
            "boolean/ssi-row-unavailable:revolution×revolution/parallel-offset",
        ));
    }
    // Two parallel cylinders. Their radical axis is linear; its circle
    // discriminant is the squared tangency test, with no sqrt observation.
    let n = [c[1].clone(), c[2].clone()];
    let rhs = -&c[0] - &base * &base;
    let n2 = &n[0] * &n[0] + &n[1] * &n[1];
    let equation = poly(vec![
        &rhs * &rhs / &n2 - &base * &base,
        Q::zero(),
        n2.clone(),
    ])?;
    let mut branches = vec![];
    for root in roots(&equation, limits)? {
        let u = root.radical()?;
        let p = arithmetic(|| {
            [
                Radical::from(&n[0] * &rhs / &n2) - &u * &n[1],
                Radical::from(&n[1] * &rhs / &n2) + &u * &n[0],
                Q::zero().into(),
            ]
        })?;
        let map = |v: RPoint, point: bool| {
            arithmetic(|| {
                std::array::from_fn(|i| {
                    (0..3).fold(
                        Radical::from(if point {
                            f.origin()[i].clone()
                        } else {
                            Q::zero()
                        }),
                        |s, j| s + &v[j] * &f.columns()[j][i],
                    )
                })
            })
        };
        branches.push(SectionBranch {
            curve: Branch::Line {
                p: map(p, true)?,
                d: map([Q::zero().into(), Q::zero().into(), Q::one().into()], false)?,
            },
            multiplicity: root.multiplicity,
        });
    }
    certify(a, b, equation, branches)
}

/// G14 sphere rows. The partner's implicit is pulled back into the sphere's
/// own frame and the sphere's `|x|² − a²` is subtracted with the partner's
/// radial coefficient. A plane, another sphere (radical plane: lens, coaxial
/// pairs, point contact) or a coaxial cylinder leaves a polynomial in one
/// frame coordinate `h`: its roots are circle heights with exact
/// `r² = a² − h²`, never an observed square root. Every other pair is a
/// named row of a later stage. Each branch passes the substitution identity
/// on both carriers.
fn sphere_rows(sa: &Carrier3, s: &wonky_geom::model::Sphere3, b: &Carrier3, limits: Limits) -> Result<Intersection> {
    let f = &s.frame;
    let a2 = s.radius2();
    let implicit = b.implicit()?;
    let local = wonky_geom::model::curved::Implicit {
        frame: implicit.frame.relation_from(f).map.inverse(),
        constant: implicit.constant.clone(),
        linear: implicit.linear.clone(),
        quadratic: implicit.quadratic.clone(),
    };
    // Order 1,x,y,z,x²,xy,xz,y²,yz,z².
    let c = local.coefficients();
    if !c[5].is_zero() || !c[6].is_zero() || !c[8].is_zero() {
        return Err(Refused(row(b, "non-parallel")));
    }
    let diag = [c[4].clone(), c[7].clone(), c[9].clone()];
    let lin = [c[1].clone(), c[2].clone(), c[3].clone()];
    let single = |v: &[Q; 3]| {
        let nonzero = (0..3).filter(|&i| !v[i].is_zero()).collect::<Vec<_>>();
        nonzero
    };
    // The frame column every branch is perpendicular to.
    let (lambda, axis) = if diag.iter().all(Zero::is_zero) {
        match single(&lin)[..] {
            [k] => (Q::zero(), k),
            _ => return Err(Refused("boolean/ssi-row-unavailable:plane×sphere/oblique")),
        }
    } else if diag[0] == diag[1] && diag[1] == diag[2] {
        // Two spheres: the radical plane carries the circle.
        match single(&lin)[..] {
            // Concentric with another radius: no common point.
            [] => return Ok(Intersection::Section { branches: vec![], equation: poly(vec![q(1)])? }),
            [k] => (diag[0].clone(), k),
            _ => return Err(Refused("boolean/ssi-row-unavailable:sphere×sphere/oblique")),
        }
    } else {
        // A revolution about one frame column through the sphere centre.
        let k = (0..3)
            .find(|&k| diag[(k + 1) % 3] == diag[(k + 2) % 3] && diag[k] != diag[(k + 1) % 3])
            .ok_or(Refused(row(b, "non-parallel")))?;
        if !lin[(k + 1) % 3].is_zero() || !lin[(k + 2) % 3].is_zero() {
            return Err(Refused(row(b, "offset")));
        }
        if matches!(b, Carrier3::Cone(_)) {
            return Err(Refused("boolean/ssi-row-unavailable:sphere×cone/coaxial"));
        }
        (diag[(k + 1) % 3].clone(), k)
    };
    // Residual in h = x_axis: (c0 + λa²) + lin_k h + (diag_k − λ) h².
    let equation = poly(vec![&c[0] + &lambda * &a2, lin[axis].clone(), &diag[axis] - &lambda])?;
    if equation.is_zero() {
        return Ok(Intersection::Coincident);
    }
    let cols = f.columns();
    let frame = Frame::new(
        f.origin().clone(),
        [cols[(axis + 1) % 3].clone(), cols[(axis + 2) % 3].clone(), cols[axis].clone()],
    )?;
    let mut branches = vec![];
    for root in roots(&equation, limits)? {
        let h = root.radical()?;
        let r2 = arithmetic(|| Radical::from(a2.clone()) - &h * &h)?;
        if r2.is_negative() {
            continue;
        }
        let radius = if r2.is_zero() { Radical::default() } else { sphere_radius(&r2)? };
        // A tangent plane or sphere touches in one point (an acnode of the
        // pencil), never a crossing.
        let multiplicity = if radius.is_zero() { 2 } else { root.multiplicity };
        branches.push(SectionBranch { curve: circle(&frame, h, radius)?, multiplicity });
    }
    for branch in &branches {
        if !branch.curve.lies_on(sa)? || !branch.curve.lies_on(b)? {
            return Err(Refused("boolean/contract-violation:ssi/identity"));
        }
    }
    Ok(Intersection::Section { branches, equation })
}
fn row(b: &Carrier3, config: &str) -> &'static str {
    match (b, config) {
        (Carrier3::Cylinder(_), "offset") => "boolean/ssi-row-unavailable:sphere×cylinder/offset",
        (Carrier3::Cylinder(_), _) => "boolean/ssi-row-unavailable:sphere×cylinder/non-parallel",
        (Carrier3::Cone(_), "offset") => "boolean/ssi-row-unavailable:sphere×cone/offset",
        (Carrier3::Cone(_), _) => "boolean/ssi-row-unavailable:sphere×cone/non-parallel",
        (Carrier3::Sphere(_), _) => "boolean/ssi-row-unavailable:sphere×sphere/metric",
        _ => "boolean/ssi-row-unavailable:sphere/A1",
    }
}
/// The exact radius of a section circle: rational, or `√r²` in one quadratic
/// field. The planted negative observes it through binary64 instead.
fn sphere_radius(r2: &Radical) -> Result<Radical> {
    if cfg!(feature = "plant_sphere_f64_radius") {
        let x = r2.enclosure().map_err(|_| Refused("boolean/budget-exceeded:ssi-quadratic"))?.m.sqrt();
        return Ok(Radical::from(Q::from_float(x).ok_or(Refused("boolean/contract-violation:ssi/radius"))?));
    }
    if let Some(r) = r2.rational() {
        if let Some(root) = exact_root(&r) {
            return Ok(root.into());
        }
        return Radical::quadratic(Q::zero(), Q::one(), r).map_err(|_| Refused("boolean/budget-exceeded:ssi-quadratic"));
    }
    r2.exact_sqrt().map_err(|_| Refused("boolean/ssi-row-unavailable:sphere/nested-radius"))
}
