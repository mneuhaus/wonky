//! Exact algebraic translations of rational-frame analytic carriers.
//! The prototype and offset remain definitions; no rounded centre is authority.
use super::algebraic as a;
use super::curved::{Implicit, Patch};
use super::*;
use num_traits::{One, Signed, Zero};
use wonky_curve::{radical::Radical, ExactPoint, Trimmed};
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Translated<T> {
    pub base: T,
    pub offset: RPoint,
}
pub type TranslatedCircle3 = Translated<Circle3>;
pub type TranslatedCylinder3 = Translated<Cylinder3>;
fn unshift(p: &VertexKey, by: &RPoint) -> Result<VertexKey> {
    Ok(QuadraticPoint3::from_coordinates(a::sub(&p.coordinates(), by))?.key())
}
impl TranslatedCircle3 {
    pub fn center(&self) -> RPoint {
        let o = self.base.origin();
        std::array::from_fn(|i| &o[i] + &self.offset[i])
    }
    pub fn contains_vertex(&self, p: &VertexKey) -> Result<bool> {
        self.base.contains_vertex(&unshift(p, &self.offset)?)
    }
    pub fn point(&self, t: &Q) -> RPoint {
        let p = self.base.point_exact(Patch::First, t);
        std::array::from_fn(|i| &p[i] + &self.offset[i])
    }
    /// Exact chart circle for a plane containing the translated support.
    pub fn plane_ring(&self, p: &RadicalPlane3, forward: bool) -> Result<Trimmed> {
        let center = p.chart(&self.center())?;
        let center = center
            .rat()
            .map_err(|_| Refused("model/translated-circle/algebraic-plane-chart"))?
            .clone();
        let axis = |i: usize| -> Result<[Q; 2]> {
            let xyz = std::array::from_fn(|k| &self.center()[k] + &self.base.columns()[i][k]);
            let uv = p.chart(&xyz)?.rat().map_err(|e| Refused(e.name()))?.clone();
            Ok(std::array::from_fn(|k| &uv[k] - &center[k]))
        };
        let x = axis(0)?;
        let y = axis(1)?;
        let norm = |v: &[Q; 2]| &v[0] * &v[0] + &v[1] * &v[1];
        if &x[0] * &y[0] + &x[1] * &y[1] != Q::zero() || norm(&x) != norm(&y) {
            return Err(Refused("model/translated-circle/elliptic-plane-chart"));
        }
        let r = wonky_curve::numeric::exact_root(&self.base.radius2())
            .ok_or(Refused("model/translated-circle/irrational-radius"))?;
        let seam = ExactPoint::from_rational(std::array::from_fn(|k| &center[k] + &r * &x[k]));
        Trimmed::ring(
            center,
            self.base.radius2() * norm(&x),
            seam,
            forward == (&x[0] * &y[1] - &x[1] * &y[0] > Q::zero()),
        )
        .map_err(|e| Refused(e.name()))
    }
}
impl TranslatedCylinder3 {
    pub fn contains_vertex(&self, p: &VertexKey) -> Result<bool> {
        Carrier3::Cylinder(self.base.clone()).contains_vertex(&unshift(p, &self.offset)?)
    }
    pub fn coordinates(&self, p: &VertexKey) -> Result<RPoint> {
        Ok(
            QuadraticPoint3::from_coordinates(a::sub(&p.coordinates(), &self.offset))?
                .mapped(&self.base.frame()?.inverse())?
                .coordinates()
                .clone(),
        )
    }
}
/// Evaluate an implicit quadric at an exact point, including its own rational
/// frame. Five distinct rational circle parameters establish polynomial identity
/// (degree <=4 after clearing the positive half-angle denominator).
pub fn value(i: &Implicit, p: &RPoint) -> Result<Radical> {
    let p = QuadraticPoint3::from_coordinates(p.clone())?.mapped(&i.frame.inverse())?;
    let p = p.coordinates();
    let mut v = Radical::from(i.constant.clone());
    for k in 0..3 {
        v = v + &p[k] * &i.linear[k];
        for j in 0..3 {
            v = v + (&p[k] * &p[j]) * &i.quadratic[k][j];
        }
    }
    Ok(v)
}
pub fn on_quadric(i: &Implicit, c: &Curve3, offset: &RPoint) -> Result<bool> {
    let eval = |p: &RPoint| value(i, &a::sub(p, offset));
    match c {
        Curve3::TranslatedCircle(c) => {
            for t in [-2, -1, 0, 1, 2] {
                if !eval(&c.point(&Q::from_integer(t.into())))?.is_zero() {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        Curve3::Circle(c) => {
            for t in [-2, -1, 0, 1, 2] {
                if !eval(&c.point_exact(Patch::First, &Q::from_integer(t.into())))?.is_zero() {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        Curve3::RadicalCircle(_) => Err(Refused("model/translated-cylinder/radical-circle-unavailable")),
        Curve3::Line { p, d } => on_line(i, &a::lift(p), &a::lift(d), offset),
        Curve3::RadicalLine { p, d } => on_line(i, p, d, offset),
    }
}
fn on_line(i: &Implicit, p: &RPoint, d: &RPoint, offset: &RPoint) -> Result<bool> {
    for t in [-1, 0, 1] {
        let p = std::array::from_fn(|k| &p[k] + &d[k] * Q::from_integer(t.into()) - &offset[k]);
        if !value(i, &p)?.is_zero() {
            return Ok(false);
        }
    }
    Ok(true)
}
/// Exact quadratic coefficient interpolation in the same layout as Implicit.
pub fn polynomial(eval: impl Fn(Point) -> Radical) -> [Radical; 10] {
    let zero = crate::zero();
    let c = eval(zero.clone());
    let two = Q::from_integer(2.into());
    let mut linear: RPoint = std::array::from_fn(|_| Radical::default());
    let mut diag = linear.clone();
    for k in 0..3 {
        let mut p = zero.clone();
        p[k] = Q::one();
        let plus = eval(p.clone());
        p[k] = -Q::one();
        let minus = eval(p);
        diag[k] = (&plus + &minus - &c * &two) / &two;
        linear[k] = (&plus - &minus) / &two;
    }
    let off: [Radical; 3] = std::array::from_fn(|slot| {
        let (x, y) = [(0, 1), (0, 2), (1, 2)][slot];
        let mut p = zero.clone();
        p[x] = Q::one();
        p[y] = Q::one();
        eval(p) - &c - &diag[x] - &diag[y] - &linear[x] - &linear[y]
    });
    [
        c,
        linear[0].clone(),
        linear[1].clone(),
        linear[2].clone(),
        diag[0].clone(),
        off[0].clone(),
        off[1].clone(),
        diag[1].clone(),
        off[2].clone(),
        diag[2].clone(),
    ]
}
pub fn coefficients(i: &Implicit, offset: &RPoint) -> [Radical; 10] {
    polynomial(|p| value(i, &a::sub(&a::lift(&p), offset)).expect("admitted quadratic field"))
}
impl TranslatedCircle3 {
    pub fn canonical_data(&self) -> ([Radical; 4], [Radical; 10], bool) {
        let n = crate::cross(&self.base.columns()[0], &self.base.columns()[1]);
        let k = n.iter().position(|x| !x.is_zero()).expect("circle plane");
        let flipped = n[k].is_negative();
        let n = n.clone().map(|x| x / &n[k]);
        let offset = a::dot(&a::lift(&n), &self.center());
        let implicit = Carrier3::Cylinder(
            Cylinder3::new(self.base.frame().expect("rational prototype").clone(), self.base.radius2()).expect("circle radius"),
        )
        .implicit()
        .expect("rational prototype");
        let v = polynomial(|p| {
            let mut p = a::lift(&p);
            p[k] = &offset
                - (0..3)
                    .filter(|i| *i != k)
                    .fold(Radical::default(), |s, i| s + &p[i] * &n[i]);
            value(&implicit, &a::sub(&p, &self.offset)).expect("admitted quadratic field")
        });
        let pivot = v
            .iter()
            .find(|x| !x.is_zero())
            .expect("circle implicit")
            .clone();
        (
            [
                Radical::from(n[0].clone()),
                Radical::from(n[1].clone()),
                Radical::from(n[2].clone()),
                offset,
            ],
            v.map(|x| x / &pivot),
            flipped,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn q(n: i64) -> Q {
        Q::from_integer(n.into())
    }
    #[test]
    fn translated_quadric_identity_is_exact_not_endpoint_sampling() {
        let offset = [
            Radical::quadratic(q(0), q(1), q(2)).unwrap(),
            Radical::from(q(3)),
            Radical::default(),
        ];
        let cylinder = Translated {
            base: Cylinder3::new(Frame::identity(), q(1)).unwrap(),
            offset: offset.clone(),
        };
        let circle = Translated {
            base: Circle3::new(Frame::identity(), q(1)).unwrap(),
            offset: offset.clone(),
        };
        let surface = Carrier3::TranslatedCylinder(cylinder.clone());
        assert!(surface
            .contains_curve(&Curve3::TranslatedCircle(circle.clone()))
            .unwrap());
        let key = QuadraticPoint3::from_coordinates(circle.point(&q(2)))
            .unwrap()
            .key();
        assert!(surface.contains_vertex(&key).unwrap());
        assert!(circle.contains_vertex(&key).unwrap());
        let mut bad = circle.clone();
        bad.base = Circle3::new(Frame::identity(), q(4)).unwrap();
        assert!(!surface
            .contains_curve(&Curve3::TranslatedCircle(bad))
            .unwrap());
        let mut bad = circle;
        bad.offset[0] = &bad.offset[0] + q(1);
        assert!(!surface
            .contains_curve(&Curve3::TranslatedCircle(bad))
            .unwrap());
        assert_eq!(
            surface.implicit().unwrap_err().0,
            "model/translated-cylinder/rational-implicit"
        );
    }
    #[test]
    fn translated_rational_support_has_the_same_canonical_identity() {
        let origin = [q(2), q(3), q(4)];
        let base = Circle3::new(Frame::identity(), q(1)).unwrap();
        let translated = Curve3::TranslatedCircle(Translated {
            base,
            offset: a::lift(&origin),
        });
        let ordinary = Curve3::Circle(
            Circle3::new(
                Frame::new(origin, Frame::identity().columns().clone()).unwrap(),
                q(1),
            )
            .unwrap(),
        );
        assert_eq!(
            super::super::canonical::curve_key(&translated),
            super::super::canonical::curve_key(&ordinary)
        );
        // A translated primitive retains its prototype's admission invariant.
        assert_eq!(
            Circle3::new(Frame::identity(), q(2)).unwrap_err().0,
            "boolean/ssi-row-unavailable:chart/quadratic-radius"
        );
    }
}
