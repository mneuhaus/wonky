//! Exact composition of interpreter frames and affine pattern images.
//!
//! Coefficients are expansions, never materialized binary64 geometry. A copy
//! keeps its source topology and construction intact. Only observation/export
//! round once. In particular T2(T1(p)) is not (T2*T1 rounded)(p).
use crate::affine::Affine;
use crate::rounding::{round, expansion_ball, finite_ball, NotRepresentable};
use wonky_num::ball::Iv;
use wonky_contract::{Body, Frame, FrameId, Vector3};
use wonky_num::expansion::{mul, neg, sign, sum, Exp, Guard};

type R<T> = Result<T, NotRepresentable>;
#[derive(Clone, Debug, PartialEq)]
pub struct Placement {
    direct: Option<Affine>,
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
    pub fn enclosed_columns(&self) -> [[Iv; 3]; 3] {
        self.columns.clone().map(|c| c.map(|e| expansion_ball(&e)))
    }
    pub fn from_frames(body: &Body, mut id: FrameId) -> R<Self> {
        // Traversal is iterative and indices strictly decrease; malicious deep
        // wire input cannot overflow the call stack.
        let mut images = Vec::new();
        let frame = loop {
            match body.frames.get(id.0 as usize) {
                Some(Frame::AffineImage { base, translation, rows }) if base.0 < id.0 => {
                    images.push((values(translation), rows.map(|r| values(&r)))); id = *base;
                }
                Some(Frame::Source { .. }) => break Affine::IDENTITY,
                Some(Frame::Interpreter { parent, origin, x, z }) if matches!(body.frames.get(parent.0 as usize), Some(Frame::Source { .. })) => {
                    break Affine { origin: values(origin), x: values(x), z: values(z) };
                }
                _ => return Err(NotRepresentable),
            }
        };
        let mut g = Guard::new();
        let mut out = Self { direct: if images.is_empty() { Some(frame) } else { None }, origin: frame.origin.map(|v| vec![v]), columns: [frame.x.map(|v| vec![v]), frame.y_exact(&mut g), frame.z.map(|v| vec![v])] };
        for (translation, rows) in images.into_iter().rev() {
            let apply = |v: &[Exp; 3], g: &mut Guard| rows.map(|r| dot(&r.map(|x| vec![x]), v, g));
            let origin = apply(&out.origin, &mut g);
            out.origin = [0,1,2].map(|k| sum(&origin[k], &[translation[k]], &mut g));
            out.columns = out.columns.map(|c| apply(&c, &mut g));
        }
        checked(out, &g)
    }
    pub fn apply_exact(&self, p: [f64; 3], scale: f64, translate: bool) -> R<[Exp; 3]> {
        let mut g = Guard::new();
        let out = [0,1,2].map(|k| {
            let mut e = if translate { self.origin[k].clone() } else { Exp::new() };
            for j in 0..3 { e = sum(&e, &mul(&[p[j]], &self.columns[j][k], &mut g), &mut g); }
            mul(&e, &[scale], &mut g)
        });
        checked(out, &g)
    }
    pub fn apply(&self, p: [f64; 3], scale: f64, translate: bool) -> R<[f64; 3]> {
        let e = self.apply_exact(p, scale, translate)?;
        Ok([round(&e[0])?, round(&e[1])?, round(&e[2])?])
    }
    pub fn det_exact(&self) -> R<Exp> {
        let mut g = Guard::new();
        let det = dot(&self.columns[0], &cross(&self.columns[1], &self.columns[2], &mut g), &mut g);
        checked(det, &g)
    }
    /// A singular map has no orientation, even if called before WC0 validation.
    pub fn reversed(&self) -> R<bool> {
        match sign(&self.det_exact()?) {
            -1 => Ok(true),
            1 => Ok(false),
            _ => Err(NotRepresentable),
        }
    }
    pub fn columns(&self) -> R<[[f64; 3]; 3]> {
        let mut out = [[0.;3];3];
        for (i, row) in out.iter_mut().enumerate() { for (k, v) in row.iter_mut().enumerate() { *v = round(&self.columns[i][k])?; } }
        Ok(out)
    }
    /// Exact isometry decision, independent of the observation defect bound.
    pub(crate) fn is_isometry(&self) -> R<bool> {
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
        let mut g = Guard::new(); let mut worst = 0.0f64;
        for i in 0..3 { for j in 0..3 {
            let mut e = dot(&self.columns[i], &self.columns[j], &mut g);
            if i == j { e = sum(&e, &[-1.], &mut g); }
            worst = worst.max(round(&e)?.abs().next_up());
        } }
        checked(worst, &g)
    }
    /// Observation only, valid for either handedness and near-orthonormal maps.
    /// No construction/topology decision uses these rounded inverse values.
    pub fn inverse_approx(&self, q: [f64; 3]) -> R<([f64;3], f64)> {
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
