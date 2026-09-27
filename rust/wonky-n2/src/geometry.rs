//! Predicate inputs, not B-rep operations. All intermediate coefficients remain
//! expansions, including discriminants and rational denominators.
use crate::{
    check,
    exact::{scalar, Context, Field},
    Refusal, Result, Sign,
};
use wonky_num::expansion::{neg, Exp};

#[derive(Clone, Debug)]
pub struct Point {
    a: [Exp; 2],
    b: [Exp; 2],
    root: Exp,
    den: Exp,
}
impl Point {
    pub fn cartesian(p: [f64; 2]) -> Result<Self> {
        Self::quadratic(p, [0.0; 2], 0.0, 1.0)
    }
    /// Coordinates `(base + offset*sqrt(radicand))/denominator`.
    /// Noncanonical negative/zero denominators are refused, not silently fixed.
    pub fn quadratic(
        base: [f64; 2],
        offset: [f64; 2],
        radicand: f64,
        denominator: f64,
    ) -> Result<Self> {
        check(&[
            base[0],
            base[1],
            offset[0],
            offset[1],
            radicand,
            denominator,
        ])?;
        if radicand < 0.0 {
            return Err(Refusal::NegativeRadicand);
        }
        if denominator <= 0.0 {
            return Err(Refusal::InvalidGeometry("positive denominator required"));
        }
        Ok(Self {
            a: base.map(scalar),
            b: offset.map(scalar),
            root: scalar(radicand),
            den: scalar(denominator),
        })
    }
    /// Compare exact coordinates; also compares parameters represented as the
    /// first coordinate of quadratic points, without rounding either operand.
    pub fn compare_coordinate(&self, other: &Self, axis: usize) -> Result<Sign> {
        if axis >= 2 {
            return Err(Refusal::InvalidGeometry("coordinate axis"));
        }
        let mut ctx = Context::new();
        let a = ctx.mul(&self.a[axis], &other.den);
        let b = ctx.mul(&other.a[axis], &self.den);
        let zero = ctx.sub(&a, &b);
        let first = ctx.mul(&self.b[axis], &other.den);
        let second = neg(&ctx.mul(&other.b[axis], &self.den));
        ctx.sign_field(
            &[zero, first, second, vec![]],
            &[self.root.clone(), other.root.clone()],
        )
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Line {
    pub origin: [f64; 2],
    pub direction: [f64; 2],
}
#[derive(Clone, Copy, Debug)]
pub struct Circle {
    pub center: [f64; 2],
    pub radius: f64,
}
#[derive(Clone, Debug)]
pub enum Intersections {
    Empty,
    Tangent(Point),
    Two([Point; 2]),
    Coincident,
}

fn line_valid(l: Line) -> Result<()> {
    check(&[l.origin[0], l.origin[1], l.direction[0], l.direction[1]])?;
    if l.direction == [0.0; 2] {
        return Err(Refusal::InvalidGeometry("zero line direction"));
    }
    Ok(())
}
fn circle_valid(c: Circle) -> Result<()> {
    check(&[c.center[0], c.center[1], c.radius])?;
    if c.radius <= 0.0 {
        return Err(Refusal::InvalidGeometry("positive circle radius required"));
    }
    Ok(())
}
fn dot(ctx: &mut Context, a: &[Exp; 2], b: &[Exp; 2]) -> Exp {
    let x = ctx.mul(&a[0], &b[0]);
    let y = ctx.mul(&a[1], &b[1]);
    ctx.add(&x, &y)
}
fn diff(ctx: &mut Context, a: [f64; 2], b: [f64; 2]) -> [Exp; 2] {
    std::array::from_fn(|i| ctx.sub(&scalar(a[i]), &scalar(b[i])))
}
fn roots(ctx: &Context, p: Point) -> Result<Intersections> {
    match ctx.sign(&p.root)? {
        Sign::Negative => Ok(Intersections::Empty),
        Sign::Zero => Ok(Intersections::Tangent(p)),
        Sign::Positive => {
            let mut minus = p.clone();
            minus.b = minus.b.map(|x| neg(&x));
            Ok(Intersections::Two([minus, p]))
        }
    }
}

/// Exact intersections, including a single tangent and empty disjoint set.
/// A non-unit line is supported; normalization would destroy the certificate.
pub fn circle_line(circle: Circle, line: Line) -> Result<Intersections> {
    circle_valid(circle)?;
    line_valid(line)?;
    let mut ctx = Context::new();
    let q = diff(&mut ctx, line.origin, circle.center);
    let d = line.direction.map(scalar);
    let a = dot(&mut ctx, &d, &d);
    let b = dot(&mut ctx, &q, &d);
    let qq = dot(&mut ctx, &q, &q);
    let r2 = ctx.sq(&scalar(circle.radius));
    let c = ctx.sub(&qq, &r2);
    let bb = ctx.sq(&b);
    let ac = ctx.mul(&a, &c);
    let disc = ctx.sub(&bb, &ac);
    let base = std::array::from_fn(|i| {
        let oa = ctx.scale(&a, line.origin[i]);
        let db = ctx.scale(&b, line.direction[i]);
        ctx.sub(&oa, &db)
    });
    roots(
        &ctx,
        Point {
            a: base,
            b: d,
            root: disc,
            den: a,
        },
    )
}

/// Exact circle intersections. Coincident circles are distinguished from a
/// disjoint concentric pair and from internal/external tangencies.
pub fn circle_circle(first: Circle, second: Circle) -> Result<Intersections> {
    circle_valid(first)?;
    circle_valid(second)?;
    let mut ctx = Context::new();
    let d = diff(&mut ctx, second.center, first.center);
    let l = dot(&mut ctx, &d, &d);
    let r1 = ctx.sq(&scalar(first.radius));
    let r2 = ctx.sq(&scalar(second.radius));
    if ctx.sign(&l)? == Sign::Zero {
        let dr = ctx.sub(&r1, &r2);
        return Ok(if ctx.sign(&dr)? == Sign::Zero {
            Intersections::Coincident
        } else {
            Intersections::Empty
        });
    }
    let dr = ctx.sub(&r1, &r2);
    let k = ctx.add(&l, &dr);
    let lr = ctx.mul(&l, &r1);
    let lr4 = ctx.scale(&lr, 4.0);
    let kk = ctx.sq(&k);
    let h = ctx.sub(&lr4, &kk);
    let den = ctx.scale(&l, 2.0);
    let base = std::array::from_fn(|i| {
        let c = ctx.scale(&den, first.center[i]);
        let kd = ctx.mul(&k, &d[i]);
        ctx.add(&c, &kd)
    });
    roots(
        &ctx,
        Point {
            a: base,
            b: [neg(&d[1]), d[0].clone()],
            root: h,
            den,
        },
    )
}

// Relative numerator, embedded in Q(sqrt(p.root),sqrt(q.root)). Denominators
// remain positive, so rays and cross-product signs need no division.
fn relative(ctx: &mut Context, p: &Point, center: [f64; 2], slot: usize) -> [Field; 2] {
    std::array::from_fn(|i| {
        let cd = ctx.scale(&p.den, center[i]);
        let mut f: Field = std::array::from_fn(|_| vec![]);
        f[0] = ctx.sub(&p.a[i], &cd);
        f[1 << slot] = p.b[i].clone();
        f
    })
}
fn fadd(ctx: &mut Context, a: &Field, b: &Field) -> Field {
    std::array::from_fn(|i| ctx.add(&a[i], &b[i]))
}
fn cross(ctx: &mut Context, a: &[Field; 2], b: &[Field; 2], r: &[Exp; 2]) -> Field {
    let ab = ctx.field_mul(&a[0], &b[1], r);
    let ba = ctx.field_mul(&a[1], &b[0], r);
    ctx.field_sub(&ab, &ba)
}
fn on_circle(
    ctx: &mut Context,
    c: Circle,
    p: &Point,
    slot: usize,
    r: &[Exp; 2],
) -> Result<[Field; 2]> {
    let v = relative(ctx, p, c.center, slot);
    let xx = ctx.field_mul(&v[0], &v[0], r);
    let yy = ctx.field_mul(&v[1], &v[1], r);
    let mut norm = fadd(ctx, &xx, &yy);
    let rd = ctx.scale(&p.den, c.radius);
    let rd2 = ctx.sq(&rd);
    norm[0] = ctx.sub(&norm[0], &rd2);
    if ctx.sign_field(&norm, r)? != Sign::Zero {
        return Err(Refusal::InvalidGeometry("point not on circle"));
    }
    Ok(v)
}
fn half(ctx: &mut Context, v: &[Field; 2], r: &[Exp; 2]) -> Result<bool> {
    let y = ctx.sign_field(&v[1], r)?;
    Ok(y == Sign::Negative || (y == Sign::Zero && ctx.sign_field(&v[0], r)? == Sign::Negative))
}

/// Ordering along a directed line. Off-carrier points are rejected, not projected.
pub fn compare_along_line(line: Line, p: &Point, q: &Point) -> Result<Sign> {
    line_valid(line)?;
    let mut ctx = Context::new();
    let r = [p.root.clone(), q.root.clone()];
    for (slot, point) in [p, q].iter().enumerate() {
        let v = relative(&mut ctx, point, line.origin, slot);
        let terms = std::array::from_fn(|i| {
            let x = ctx.scale(&v[0][i], line.direction[1]);
            let y = ctx.scale(&v[1][i], line.direction[0]);
            ctx.sub(&x, &y)
        });
        if ctx.sign_field(&terms, &r)? != Sign::Zero {
            return Err(Refusal::InvalidGeometry("point not on line"));
        }
    }
    // At least one direction coordinate is nonzero. Comparison of that
    // coordinate is exactly the comparison of the line parameters (with sign).
    let axis = if line.direction[0] != 0.0 { 0 } else { 1 };
    let s = p.compare_coordinate(q, axis)?;
    Ok(if line.direction[axis] > 0.0 {
        s
    } else {
        s.flip()
    })
}

/// CCW parameter order in [0,2*pi), with seam on the positive x ray. No
/// transcendental angle is computed. Both points must lie on the circle.
pub fn compare_along_circle(circle: Circle, p: &Point, q: &Point) -> Result<Sign> {
    circle_valid(circle)?;
    let mut ctx = Context::new();
    let r = [p.root.clone(), q.root.clone()];
    let a = on_circle(&mut ctx, circle, p, 0, &r)?;
    let b = on_circle(&mut ctx, circle, q, 1, &r)?;
    let ha = half(&mut ctx, &a, &r)?;
    let hb = half(&mut ctx, &b, &r)?;
    if ha != hb {
        return Ok(if ha { Sign::Positive } else { Sign::Negative });
    }
    let det = cross(&mut ctx, &a, &b, &r);
    Ok(ctx.sign_field(&det, &r)?.flip())
}

/// An oriented closed arc. Endpoint directions encode the opening without
/// rounded radians: CCW can be minor, semicircle or major; clockwise reverses
/// that choice. Equal endpoints mean a zero arc unless `full_turn` is true.
/// full_turn with unequal endpoints is noncanonical and refused.
#[derive(Clone, Debug)]
pub struct Arc {
    pub circle: Circle,
    pub start: Point,
    pub end: Point,
    pub clockwise: bool,
    pub full_turn: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArcLocation {
    Outside,
    Interior,
    Start,
    End,
}
pub fn point_against_arc(arc: &Arc, p: &Point) -> Result<ArcLocation> {
    let se = compare_along_circle(arc.circle, &arc.start, &arc.end)?;
    let sp = compare_along_circle(arc.circle, &arc.start, p)?;
    let pe = compare_along_circle(arc.circle, p, &arc.end)?;
    if arc.full_turn && se != Sign::Zero {
        return Err(Refusal::InvalidGeometry("full turn endpoints differ"));
    }
    if sp == Sign::Zero {
        return Ok(ArcLocation::Start);
    }
    if pe == Sign::Zero {
        return Ok(ArcLocation::End);
    }
    if arc.full_turn {
        return Ok(ArcLocation::Interior);
    }
    if se == Sign::Zero {
        return Ok(ArcLocation::Outside);
    }
    let ccw = if se == Sign::Negative {
        sp == Sign::Negative && pe == Sign::Negative
    } else {
        sp == Sign::Negative || pe == Sign::Negative
    };
    Ok(if ccw != arc.clockwise {
        ArcLocation::Interior
    } else {
        ArcLocation::Outside
    })
}

/// Oriented in-circle determinant of four dyadic points. Positive means inside
/// for CCW (a,b,c), negative means inside for CW; collinearity is not normalized.
/// This degree-four rational polynomial is not a higher-degree algebraic root.
pub fn incircle(a: [f64; 2], b: [f64; 2], c: [f64; 2], d: [f64; 2]) -> Result<Sign> {
    for p in [a, b, c, d] {
        check(&p)?;
    }
    if let Some(sign) = crate::filter::incircle(a, b, c, d) {
        return Ok(sign);
    }
    let mut ctx = Context::new();
    let a = diff(&mut ctx, a, d);
    let b = diff(&mut ctx, b, d);
    let c = diff(&mut ctx, c, d);
    let aa = dot(&mut ctx, &a, &a);
    let bb = dot(&mut ctx, &b, &b);
    let cc = dot(&mut ctx, &c, &c);
    let mut det = vec![];
    for (norm, p, q) in [(&aa, &b, &c), (&bb, &c, &a), (&cc, &a, &b)] {
        let x = ctx.mul(&p[0], &q[1]);
        let y = ctx.mul(&p[1], &q[0]);
        let xy = ctx.sub(&x, &y);
        let term = ctx.mul(norm, &xy);
        det = ctx.add(&det, &term);
    }
    ctx.sign(&det)
}
