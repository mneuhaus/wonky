//! Exact composition of interpreter frames and affine pattern images.
//!
//! Coefficients are expansions, never materialized binary64 geometry. A copy
//! keeps its source topology and construction intact. Only observation/export
//! round once. In particular T2(T1(p)) is not (T2*T1 rounded)(p).
use crate::affine::Affine;
use crate::rounding::{round, expansion_ball, finite_ball, NotRepresentable};
use wonky_num::ball::Iv;
use wonky_contract::{Binary64, Body, Frame, FrameId, Vector3};
use wonky_num::expansion::{mul, neg, sign, sum, Exp, Guard};

type R<T> = Result<T, NotRepresentable>;
#[derive(Clone, Debug, PartialEq)]
pub struct Placement {
    direct: Option<Affine>,
    rational: Option<wonky_geom::frame::Frame>,
    origin: [Exp; 3],
    columns: [[Exp; 3]; 3],
}
fn values(v: &Vector3) -> [f64; 3] { v.map(|x| x.get()) }
fn dot(a: &[Exp; 3], b: &[Exp; 3], g: &mut Guard) -> Exp {
    let mut e = Exp::new();
    for k in 0..3 { e = sum(&e, &mul(&a[k], &b[k], g), g); }
    e
}
fn cross(a: &[Exp; 3], b: &[Exp; 3], g: &mut Guard) -> [Exp; 3] {
    [(1, 2), (2, 0), (0, 1)].map(|(i,j)| sum(&mul(&a[i], &b[j], g), &neg(&mul(&a[j], &b[i], g)), g))
}
fn checked<T>(value: T, g: &Guard) -> R<T> { if g.exact() { Ok(value) } else { Err(NotRepresentable) } }
/// One exact placement applied AFTER an existing frame: the shared map that a
/// placed body is placed again by (`Placement::then`, `Frame` construction in
/// `pattern::place`/`cylinder::copy`, and the Model path's `Solid::Model`
/// placement arms). Its coefficients are binary64 inputs and every use evaluates
/// them in exact arithmetic, so composition is associative and never rounds.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Post {
    Rational { rows: [[f64; 3]; 3], denominator: f64 },
    /// `translation + rows * q` (an `AffineImage`).
    Rows { translation: [f64; 3], rows: [[f64; 3]; 3] },
    /// `origin + q.x*x + q.y*(z cross x) + q.z*z` (an `InterpreterImage`).
    Interpreter(Affine),
    /// Exact coordinate-Z quarter turn BEFORE the source placement.
    LocalQuarter(u32),
}
impl Post {
    /// The map as exact expansions: (translation, columns) with image(q) =
    /// translation + sum_j columns[j] * q[j].
    pub(crate) fn exact(&self, g: &mut Guard) -> ([Exp; 3], [[Exp; 3]; 3]) {
        match self {
            Post::Rational { .. } => unreachable!("rational posts compose in Q"),
            Post::LocalQuarter(k) => {
                let (c,s) = [(1.,0.),(0.,1.),(-1.,0.),(0.,-1.)][(*k % 4) as usize];
                ([vec![0.],vec![0.],vec![0.]], [[vec![c],vec![s],vec![0.]], [vec![-s],vec![c],vec![0.]], [vec![0.],vec![0.],vec![1.]]])
            },
            Post::Rows { translation, rows } => (
                translation.map(|v| vec![v]),
                [0, 1, 2].map(|j| [0, 1, 2].map(|k| vec![rows[k][j]])),
            ),
            Post::Interpreter(a) => (a.origin.map(|v| vec![v]), [a.x.map(|v| vec![v]), a.y_exact(g), a.z.map(|v| vec![v])]),
        }
    }
    /// Exact rigid-metric witness for one placement, including reflections.
    /// Coefficients, not matrix metadata or a defect tolerance, are decisive.
    pub(crate) fn is_isometry(&self) -> R<bool> {
        if matches!(self, Post::Rational { .. }) {
            return Placement::from_affine(Affine::IDENTITY)?.then(self)?.is_isometry();
        }
        let mut g = Guard::new();
        let (origin, columns) = self.exact(&mut g);
        let map = checked(Placement { direct: None, rational: None, origin, columns }, &g)?;
        map.is_isometry()
    }
    /// The frame that applies this map after `base`.
    pub fn frame(&self, base: FrameId) -> Result<Frame, crate::polyhedron::Refused> {
        let b = |x: f64| Binary64::new(x).map_err(|e| crate::polyhedron::Refused(format!("placement/coefficient: {e:?}")));
        let v = |a: [f64; 3]| Ok::<_, crate::polyhedron::Refused>([b(a[0])?, b(a[1])?, b(a[2])?]);
        Ok(match self {
            Post::Rational { rows, denominator } => Frame::RationalImage { base, rows: [v(rows[0])?,v(rows[1])?,v(rows[2])?], denominator: b(*denominator)? },
            Post::LocalQuarter(k) => Frame::Rigid { parent: base, translation: v([0.;3])?, axis: v([0.,0.,1.])?, angle: b((*k % 4) as f64 * std::f64::consts::FRAC_PI_2)? },
            Post::Rows { translation, rows } => Frame::AffineImage { base, translation: v(*translation)?, rows: [v(rows[0])?, v(rows[1])?, v(rows[2])?] },
            Post::Interpreter(a) => Frame::InterpreterImage { base, origin: v(a.origin)?, x: v(a.x)?, z: v(a.z)? },
        })
    }
}
impl PartialEq<Affine> for Placement {
    fn eq(&self, other: &Affine) -> bool { self.direct.as_ref() == Some(other) }
}
impl PartialEq<Placement> for Affine {
    fn eq(&self, other: &Placement) -> bool { other == self }
}
impl Placement {
    /// Older carrier operations accept only an uncomposed interpreter frame.
    /// Never round a composed exact map into authoritative binary64 geometry.
    pub fn as_affine(&self) -> Result<Affine, crate::polyhedron::Refused> {
        self.direct.ok_or_else(|| crate::polyhedron::Refused("placement/composed-frame-unsupported".into()))
    }
    /// The exact map p -> origin + columns p as a wonky-geom `Frame` (each
    /// expansion summed in Q; nothing rounded).
    pub fn exact_frame(&self) -> Result<wonky_geom::frame::Frame, crate::polyhedron::Refused> {
        if let Some(f) = &self.rational { return Ok(f.clone()); }
        let q = |e: &Exp| -> num_rational::BigRational {
            e.iter().map(|&x| num_rational::BigRational::from_float(x).expect("finite expansion term")).sum()
        };
        wonky_geom::frame::Frame::new(self.origin.each_ref().map(q), self.columns.each_ref().map(|c| c.each_ref().map(q)))
            .map_err(|e| crate::polyhedron::Refused(e.0.into()))
    }
    pub fn enclosed_columns(&self) -> [[Iv; 3]; 3] {
        if let Some(f) = &self.rational { return f.columns().clone().map(|c| c.map(|v| qball(&v).expect("checked finite rational frame"))); }
        self.columns.clone().map(|c| c.map(|e| expansion_ball(&e)))
    }
    pub(crate) fn from_affine(frame: Affine) -> R<Self> {
        let mut g = Guard::new();
        let out = Self {
            direct: Some(frame),
            rational: None,
            origin: frame.origin.map(|v| vec![v]),
            columns: [frame.x.map(|v| vec![v]), frame.y_exact(&mut g), frame.z.map(|v| vec![v])],
        };
        checked(out, &g)
    }
    pub fn from_frames(body: &Body, mut id: FrameId) -> R<Self> {
        // Traversal is iterative and indices strictly decrease; malicious deep
        // wire input cannot overflow the call stack.
        let mut images = Vec::new();
        let frame = loop {
            match body.frames.get(id.0 as usize) {
                Some(Frame::RationalImage { base, rows, denominator }) if base.0 < id.0 => {
                    images.push(Post::Rational { rows: rows.map(|r| values(&r)), denominator: denominator.get() }); id = *base;
                }
                Some(Frame::AffineImage { base, translation, rows }) if base.0 < id.0 => {
                    images.push(Post::Rows { translation: values(translation), rows: rows.map(|r| values(&r)) }); id = *base;
                }
                Some(Frame::InterpreterImage { base, origin, x, z }) if base.0 < id.0 => {
                    images.push(Post::Interpreter(Affine { origin: values(origin), x: values(x), z: values(z) })); id = *base;
                }
                Some(Frame::Rigid { parent, translation, axis, angle }) if parent.0 < id.0 => {
                    // This capability is an image of a constructed source, not
                    // a replacement for its authoritative interpreter chart.
                    if matches!(body.frames.get(parent.0 as usize), Some(Frame::Source { .. }))
                        || !body.constructions.iter().any(|n| n.frame == id && n.operation == (wonky_contract::Operation::AffineTransform {}))
                        || values(translation) != [0.;3] || values(axis) != [0.,0.,1.] { return Err(NotRepresentable); }
                    let k = angle.get() / std::f64::consts::FRAC_PI_2;
                    if k < 0. || k > 3. || k.fract() != 0. || k * std::f64::consts::FRAC_PI_2 != angle.get() { return Err(NotRepresentable); }
                    images.push(Post::LocalQuarter(k as u32)); id = *parent;
                }
                Some(Frame::Source { .. }) => break Affine::IDENTITY,
                Some(Frame::Interpreter { parent, origin, x, z }) if matches!(body.frames.get(parent.0 as usize), Some(Frame::Source { .. })) => {
                    break Affine { origin: values(origin), x: values(x), z: values(z) };
                }
                _ => return Err(NotRepresentable),
            }
        };
        let mut g = Guard::new();
        let mut out = Self::from_affine(frame)?;
        if !images.is_empty() { out.direct = None; }
        for post in images.into_iter().rev() {
            out = out.composed(&post, &mut g)?;
        }
        checked(out, &g)
    }
    /// World images compose post * self; source quarter turns compose self * R.
    /// Both maps are exact expansions, so the product is exact and associative;
    /// nothing is rounded between placements (T2(T1(p)), never (T2*T1 rounded)(p)).
    fn composed(&self, post: &Post, g: &mut Guard) -> R<Self> {
        if self.rational.is_some() || matches!(post, Post::Rational { .. }) {
            let base = self.exact_frame().map_err(|_| NotRepresentable)?;
            let (origin, columns) = match post {
                Post::Rational { rows, denominator } => {
                    if !denominator.is_finite() || *denominator <= 0. { return Err(NotRepresentable); }
                    (std::array::from_fn(|_| Q::zero()), [0,1,2].map(|j| [0,1,2].map(|k| q(rows[k][j])/q(*denominator))))
                },
                _ => { let (o,c) = post.exact(g); (o.map(|e| e.into_iter().map(q).sum()), c.map(|c| c.map(|e| e.into_iter().map(q).sum()))) }
            };
            let map = wonky_geom::frame::Frame::new(origin, columns).map_err(|_| NotRepresentable)?;
            // Source turns act on the right, including after a rational image.
            let f = if matches!(post, Post::LocalQuarter(_)) {
                wonky_geom::frame::Frame::new(base.point(map.origin()), map.columns().each_ref().map(|c| base.vector(c)))
            } else {
                wonky_geom::frame::Frame::new(map.point(base.origin()), base.columns().each_ref().map(|c| map.vector(c)))
            }.map_err(|_| NotRepresentable)?;
            for v in f.origin().iter().chain(f.columns().iter().flatten()) { qball(v)?; }
            return Ok(Self { direct: None, rational: Some(f), origin: self.origin.clone(), columns: self.columns.clone() });
        }
        if matches!(post, Post::LocalQuarter(_)) {
            let (_, columns) = post.exact(g);
            // self * local, evaluated as expansions without rounded coefficients.
            let apply = |v: &[Exp;3], g: &mut Guard| [0,1,2].map(|k| {
                let mut e = Exp::new();
                for j in 0..3 { e = sum(&e, &mul(&self.columns[j][k], &v[j], g), g); } e
            });
            return Ok(Self { direct: None, rational: None, origin: self.origin.clone(), columns: columns.each_ref().map(|c| apply(c,g)) });
        }
        let (translation, columns) = post.exact(g);
        let apply = |v: &[Exp; 3], g: &mut Guard| [0, 1, 2].map(|k| {
            let mut e = Exp::new();
            for j in 0..3 { e = sum(&e, &mul(&columns[j][k], &v[j], g), g); }
            e
        });
        let moved = apply(&self.origin, g);
        Ok(Self {
            rational: None, direct: None,
            origin: [0, 1, 2].map(|k| sum(&moved[k], &translation[k], g)),
            columns: self.columns.each_ref().map(|c| apply(c, g)),
        })
    }
    /// Compose `post` after this placement (see `composed`). `None` when an
    /// expansion outgrows the exact guard: the caller refuses, never rounds.
    pub fn then(&self, post: &Post) -> R<Self> {
        let mut g = Guard::new();
        let out = self.composed(post, &mut g)?;
        checked(out, &g)
    }
    /// Exact p -> self(t + p): a local translation composed into the origin
    /// without rounding (a zero-angle Rigid chart inside this frame).
    pub(crate) fn pre_translated(&self, t: [f64; 3]) -> R<Self> {
        if self.rational.is_some() { return Err(NotRepresentable); }
        let mut g = Guard::new();
        let mut origin = self.origin.clone();
        for (k, o) in origin.iter_mut().enumerate() {
            for (j, &x) in t.iter().enumerate() {
                *o = sum(o, &mul(&[x], &self.columns[j][k], &mut g), &mut g);
            }
        }
        checked(Self { rational: None, direct: None, origin, columns: self.columns.clone() }, &g)
    }
    pub fn apply_exact(&self, p: [f64; 3], scale: f64, translate: bool) -> R<[Exp; 3]> {
        if let Some(f) = &self.rational {
            let v = if translate { f.point(&p.map(q)) } else { f.vector(&p.map(q)) };
            let out = v.map(|v| qfloat(&(v*q(scale))).map(|x|vec![x]));
            return Ok([out[0].clone()?,out[1].clone()?,out[2].clone()?]);
        }
        let mut g = Guard::new();
        let out = [0,1,2].map(|k| {
            let mut e = if translate { self.origin[k].clone() } else { Exp::new() };
            for j in 0..3 { e = sum(&e, &mul(&[p[j]], &self.columns[j][k], &mut g), &mut g); }
            mul(&e, &[scale], &mut g)
        });
        checked(out, &g)
    }
    /// Outward world-coordinate enclosure for observation/export only.
    /// Non-dyadic rational coordinates never masquerade as exact expansions.
    pub fn apply_enclosed(&self, p: [f64; 3], scale: f64, translate: bool) -> R<[Iv; 3]> {
        if let Some(f) = &self.rational {
            let v = if translate { f.point(&p.map(q)) } else { f.vector(&p.map(q)) };
            let b = v.map(|v| qball(&(v * q(scale))));
            return Ok([b[0]?, b[1]?, b[2]?]);
        }
        let exact = self.apply_exact(p, scale, translate)?;
        let mut out = [Iv::point(0.); 3];
        let mut g = Guard::new();
        for k in 0..3 {
            let m = round(&exact[k])?;
            let residual = sum(&exact[k], &[-m], &mut g);
            let error = residual.iter().fold(Iv::point(0.), |r, x| r + Iv::point(x.abs()));
            out[k] = finite_ball(Iv { m, r: error.hi() })?;
        }
        checked(out, &g)
    }
    /// Rounded cofactor normal for display carriers, never a predicate operand.
    pub fn cofactor_observed(&self, n: [f64; 3]) -> R<[f64; 3]> {
        if let Some(f) = &self.rational {
            let c = f.columns();
            let cross = crate::planar_geometry::cross;
            let terms = [cross(&c[1], &c[2]), cross(&c[2], &c[0]), cross(&c[0], &c[1])];
            let b: [R<Iv>; 3] = std::array::from_fn(|k| qball(&(0..3).map(|j| q(n[j]) * &terms[j][k]).sum()));
            return Ok([b[0]?.m, b[1]?.m, b[2]?.m]);
        }
        let e = self.cofactor_exact(n)?;
        Ok([round(&e[0])?, round(&e[1])?, round(&e[2])?])
    }
    pub fn apply(&self, p: [f64; 3], scale: f64, translate: bool) -> R<[f64; 3]> {
        if let Some(f) = &self.rational {
            let v = if translate { f.point(&p.map(q)) } else { f.vector(&p.map(q)) };
            let a = v.map(|v| qball(&(v*q(scale))).map(|b|b.m));
            return Ok([a[0]?,a[1]?,a[2]?]);
        }
        let e = self.apply_exact(p, scale, translate)?;
        Ok([round(&e[0])?, round(&e[1])?, round(&e[2])?])
    }
    /// Exact cof(A) n = n.x (c1 x c2) + n.y (c2 x c0) + n.z (c0 x c1), i.e.
    /// det(A) A^-T n: the mapped normal of a plane, without rounding.
    pub fn cofactor_exact(&self, n: [f64; 3]) -> R<[Exp; 3]> {
        if self.rational.is_some() { return Err(NotRepresentable); }
        let mut g = Guard::new();
        let c = &self.columns;
        let terms = [cross(&c[1], &c[2], &mut g), cross(&c[2], &c[0], &mut g), cross(&c[0], &c[1], &mut g)];
        let out = [0, 1, 2].map(|k| {
            let mut e = Exp::new();
            for j in 0..3 { e = sum(&e, &mul(&terms[j][k], &[n[j]], &mut g), &mut g); }
            e
        });
        checked(out, &g)
    }
    pub fn det_exact(&self) -> R<Exp> {
        if let Some(f) = &self.rational { let c=f.columns(); return Ok(vec![qfloat(&crate::planar_geometry::dot(&c[0], &crate::planar_geometry::cross(&c[1],&c[2])))?]); }
        let mut g = Guard::new();
        let det = dot(&self.columns[0], &cross(&self.columns[1], &self.columns[2], &mut g), &mut g);
        checked(det, &g)
    }
    /// A singular map has no orientation, even if called before WC0 validation.
    pub fn reversed(&self) -> R<bool> {
        if let Some(frame) = &self.rational {
            let c = frame.columns();
            let determinant = crate::planar_geometry::dot(&c[0], &crate::planar_geometry::cross(&c[1], &c[2]));
            if determinant.is_zero() { return Err(NotRepresentable); }
            // Orientation needs the rational sign, not a representable f64
            // determinant. A rigid post retains the source's exact Gram defect.
            return Ok(determinant.is_negative());
        }
        match sign(&self.det_exact()?) {
            -1 => Ok(true),
            1 => Ok(false),
            _ => Err(NotRepresentable),
        }
    }
    pub fn columns(&self) -> R<[[f64; 3]; 3]> {
        if self.rational.is_some() { return Err(NotRepresentable); }
        let mut out = [[0.;3];3];
        for (i, row) in out.iter_mut().enumerate() { for (k, v) in row.iter_mut().enumerate() { *v = round(&self.columns[i][k])?; } }
        Ok(out)
    }
    /// Exact isometry decision, independent of the observation defect bound.
    pub(crate) fn is_isometry(&self) -> R<bool> {
        if let Some(f) = &self.rational { return Ok(f.is_isometry()); }
        let mut g = Guard::new();
        let mut exact = true;
        for i in 0..3 { for j in 0..3 {
            let mut e = dot(&self.columns[i], &self.columns[j], &mut g);
            if i == j { e = sum(&e, &[-1.], &mut g); }
            exact &= sign(&e) == 0;
        } }
        checked(exact, &g)
    }
    /// Outward enclosure of max |Gram-I|, evaluated from the exact columns.
    pub fn orthonormality_defect(&self) -> R<f64> {
        if let Some(f) = &self.rational {
            let c=f.columns(); let mut worst=0f64;
            for i in 0..3 { for j in 0..3 { let d=crate::planar_geometry::dot(&c[i],&c[j])-q(if i==j {1.} else {0.}); worst=worst.max(qball(&d.abs())?.hi()); } }
            return Ok(worst);
        }
        let mut g = Guard::new(); let mut worst = 0.0f64;
        for i in 0..3 { for j in 0..3 {
            let mut e = dot(&self.columns[i], &self.columns[j], &mut g);
            if i == j { e = sum(&e, &[-1.], &mut g); }
            worst = worst.max(round(&e)?.abs().next_up());
        } }
        checked(worst, &g)
    }
    /// Include unit conversion in the inverse observation, never discard its
    /// rounding before a membership decision. Rational frames divide in Q;
    /// expansion frames retain their existing inverse budget and add the exact
    /// conversion residual mapped by the exact inverse linear coefficients.
    pub fn inverse_scaled_approx(&self, world: [f64; 3], scale: f64) -> R<([f64; 3], f64)> {
        if world.iter().any(|v| !v.is_finite()) || !scale.is_finite() || scale <= 0. { return Err(NotRepresentable); }
        let exact = world.map(|v| q(v) / q(scale));
        if let Some(f) = &self.rational {
            let v = f.inverse().point(&exact);
            let b = v.map(|v| qball(&v));
            let b = [b[0]?, b[1]?, b[2]?];
            return Ok((b.map(|v| v.m), b.iter().fold(0f64, |r, v| r.max(v.r))));
        }
        let rounded = world.map(|v| v / scale);
        if rounded.iter().any(|v| !v.is_finite()) { return Err(NotRepresentable); }
        let (point, bound) = self.inverse_approx(rounded)?;
        let residual = [0,1,2].map(|k| &exact[k] - q(rounded[k]));
        let inverse = self.exact_frame().map_err(|_| NotRepresentable)?.inverse();
        let error = inverse.vector(&residual).map(|v| qball(&v.abs()));
        let mut extra = 0f64;
        for e in error { extra = extra.max(e?.hi()); }
        let budget = finite_ball(Iv::point(bound) + Iv::point(extra))?.hi();
        Ok((point, budget))
    }
    /// Observation only, valid for either handedness and near-orthonormal maps.
    /// No construction/topology decision uses these rounded inverse values.
    pub fn inverse_approx(&self, q: [f64; 3]) -> R<([f64;3], f64)> {
        if let Some(f) = &self.rational {
            let v=f.inverse().point(&q.map(|x| Q::from_float(x).unwrap()));
            let balls=v.map(|v|qball(&v)); let balls=[balls[0]?,balls[1]?,balls[2]?];
            return Ok((balls.map(|b|b.m), balls.iter().fold(0f64,|v,b|v.max(b.r))));
        }
        if let Some(frame) = self.direct { return frame.inverse_approx(q); }
        let [x,y,z] = self.enclosed_columns();
        let origin = self.origin.clone().map(|e| expansion_ball(&e));
        let d = [0,1,2].map(|k| Iv::point(q[k]) - origin[k]);
        let cross = |a: [Iv;3], b: [Iv;3]| [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
        let dot = |a: [Iv;3], b: [Iv;3]| a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
        let det = finite_ball(dot(x,cross(y,z)))?;
        if !(det.lo() > 0.5 || det.hi() < -0.5) { return Err(NotRepresentable); }
        let s = [dot(d,cross(y,z))/det, dot(d,cross(z,x))/det, dot(d,cross(x,y))/det];
        let mut mid = [0.;3]; let mut radius = 0.0f64;
        for k in 0..3 { let v = finite_ball(s[k])?; mid[k]=v.m; radius=radius.max(v.r); }
        let magnitude=q.iter().fold(0.0f64,|m,v|m.max(v.abs()));
        let reach=mid.iter().fold(0.0f64,|m,v|m.max(v.abs()));
        let bound=(radius + 64.0*f64::EPSILON*(magnitude+reach)).next_up();
        if !bound.is_finite() { return Err(NotRepresentable); }
        Ok((mid,bound))
    }
}

use num_rational::BigRational as Q;
use num_traits::{Signed, ToPrimitive, Zero};
fn q(x:f64)->Q { Q::from_float(x).expect("finite coefficient") }
fn qfloat(v:&Q)->R<f64> { let x=v.to_f64().filter(|x|x.is_finite()).ok_or(NotRepresentable)?; if q(x)!=*v {return Err(NotRepresentable);} Ok(x) }
fn qball(v:&Q)->R<Iv> {
    let x=v.to_f64().filter(|x|x.is_finite()).ok_or(NotRepresentable)?;
    if q(x)==*v {return Ok(Iv::point(x));}
    let y=if q(x)<*v {x.next_up()} else {x.next_down()};
    if !y.is_finite() || (q(x)<*v && q(y)<*v) || (q(x)>*v && q(y)>*v) {return Err(NotRepresentable);}
    finite_ball(Iv{m:x,r:(x-y).abs().next_up()})
}

#[cfg(test)]
mod rigid_metric_tests {
    use super::*;
    #[test]
    fn coefficient_metric_is_exact_and_independent_of_roundoff_size() {
        let rigid = Post::Rows { translation: [1e100, -0.125, 7.],
            rows: [[0., -1., 0.], [1., 0., 0.], [0., 0., 1.]] };
        assert!(rigid.is_isometry().unwrap());
        let reflection = Post::Rows { translation: [0.;3],
            rows: [[-1.,0.,0.],[0.,1.,0.],[0.,0.,1.]] };
        assert!(reflection.is_isometry().unwrap());
        for delta in [1e-10, 1e-20, f64::EPSILON] {
            let rounded = Post::Rows { translation: [0.;3],
                rows: [[1.,-delta,0.],[delta,1.,0.],[0.,0.,1.]] };
            assert!(!rounded.is_isometry().unwrap());
        }
        let undecidable = Post::Rows { translation: [0.;3],
            rows: [[1.,-f64::MIN_POSITIVE,0.],[f64::MIN_POSITIVE,1.,0.],[0.,0.,1.]] };
        assert!(undecidable.is_isometry().is_err());
    }
}

#[cfg(test)]
mod local_quarter_tests {
    use super::*;
    use crate::pattern::require_local_chart;
    #[test]
    fn local_turns_use_exact_source_chart_and_reject_unrelated_axes() {
        let chart = Affine { origin:[1.5,-0.003,0.005], x:[0.8,0.6,0.], z:[0.,0.,1.] };
        let key = wonky_contract::BodyKey { id:[7;4], revision:0 };
        let seed = crate::orthogonal::cuboid(key,[0.;3],[0.004,0.003,0.008]).unwrap();
        let checked = seed.check().unwrap();
        let seed = crate::polyhedron::audit(&checked).unwrap();
        let body = crate::orthogonal::transform(&seed,chart).unwrap();
        require_local_chart(&body,chart,1).unwrap();
        let id = body.vertices[0].frame;
        let map = Placement::from_frames(&body,id).unwrap();
        let turned = map.then(&Post::LocalQuarter(1)).unwrap();
        assert_eq!(turned.apply_exact([1.,0.,0.],1.,true).unwrap(), map.apply_exact([0.,1.,0.],1.,true).unwrap());
        let mut wrong = chart; wrong.origin[0] += 0.125;
        assert!(require_local_chart(&body,wrong,1).unwrap_err().0.contains("source-chart-mismatch"));
        let mut wrong = chart; wrong.z = [0.,1.,0.];
        assert!(require_local_chart(&body,wrong,1).is_err());
        for k in 0..4 { assert!(Post::LocalQuarter(k).is_isometry().unwrap()); }
    }
}
