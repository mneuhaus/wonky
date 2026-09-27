//! Application of a WC0 `Frame::Interpreter` (docs/rust-wire-v3.md): the affine
//! map p -> origin + p.x*x + p.y*(z cross x) + p.z*z on the interpreter's own
//! binary64 values, never normalized or orthogonalized.
//!
//! Export and observation evaluate the map EXACTLY (expansion arithmetic) and
//! round each output once (`rounding::round`), so an exported coordinate is off
//! the exact image by at most half an ulp of itself: ulp(65536 mm) = 2^-36 mm,
//! about 1.5e-11 mm, so at most 7.3e-12 mm at AC01 V1. Decisions never use the
//! mapped values; they run in the source frame (E4, E9).
use crate::rounding::{finite_ball, round, NotRepresentable};
use wonky_num::ball::Iv;
use wonky_num::expansion::{mul, sum, Exp, Guard};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Affine {
    pub origin: [f64; 3],
    pub x: [f64; 3],
    pub z: [f64; 3],
}

fn cross_exact(a: [f64; 3], b: [f64; 3], g: &mut Guard) -> [Exp; 3] {
    let mut c = |i: usize, j: usize| {
        let l = mul(&[a[i]], &[b[j]], g);
        let r = mul(&[a[j]], &[b[i]], g);
        let r: Exp = r.iter().map(|v| -v).collect();
        sum(&l, &r, g)
    };
    [c(1, 2), c(2, 0), c(0, 1)]
}

fn dot_exact(a: [f64; 3], b: [f64; 3], g: &mut Guard) -> Exp {
    let mut out = Exp::new();
    for k in 0..3 {
        out = sum(&out, &mul(&[a[k]], &[b[k]], g), g);
    }
    out
}

impl Affine {
    /// The identity (a Source frame).
    pub const IDENTITY: Affine = Affine { origin: [0.0; 3], x: [1.0, 0.0, 0.0], z: [0.0, 0.0, 1.0] };

    /// y = z cross x, exactly.
    pub fn y_exact(&self, g: &mut Guard) -> [Exp; 3] {
        cross_exact(self.z, self.x, g)
    }

    /// scale * (translate * origin + p.x*x + p.y*y + p.z*z), coordinate by
    /// coordinate as exact expansions (translate = 0 maps a direction).
    pub fn apply_exact(&self, p: [f64; 3], scale: f64, translate: bool) -> Result<[Exp; 3], NotRepresentable> {
        let mut g = Guard::new();
        let y = self.y_exact(&mut g);
        let mut out: [Exp; 3] = Default::default();
        for k in 0..3 {
            let mut e: Exp = if translate { vec![self.origin[k]] } else { Exp::new() };
            e = sum(&e, &mul(&[p[0]], &[self.x[k]], &mut g), &mut g);
            e = sum(&e, &mul(&[p[1]], &y[k], &mut g), &mut g);
            e = sum(&e, &mul(&[p[2]], &[self.z[k]], &mut g), &mut g);
            out[k] = mul(&e, &[scale], &mut g);
        }
        if !g.exact() {
            return Err(NotRepresentable);
        }
        Ok(out)
    }

    /// The correctly rounded image of a point (translate) or direction.
    pub fn apply(&self, p: [f64; 3], scale: f64, translate: bool) -> Result<[f64; 3], NotRepresentable> {
        let e = self.apply_exact(p, scale, translate)?;
        Ok([round(&e[0])?, round(&e[1])?, round(&e[2])?])
    }

    /// det[x, y, z] = (x.x)(z.z) - (x.z)^2 exactly (> 0 for a valid frame).
    pub fn det_exact(&self) -> Result<Exp, NotRepresentable> {
        let mut g = Guard::new();
        let xx = dot_exact(self.x, self.x, &mut g);
        let zz = dot_exact(self.z, self.z, &mut g);
        let xz = dot_exact(self.x, self.z, &mut g);
        let a = mul(&xx, &zz, &mut g);
        let b = mul(&xz, &xz, &mut g);
        let b: Exp = b.iter().map(|v| -v).collect();
        let d = sum(&a, &b, &mut g);
        if !g.exact() {
            return Err(NotRepresentable);
        }
        Ok(d)
    }

    /// Columns x, y, z of the linear part, rounded (for f64 observation only).
    pub fn columns(&self) -> Result<[[f64; 3]; 3], NotRepresentable> {
        let mut g = Guard::new();
        let y = self.y_exact(&mut g);
        if !g.exact() {
            return Err(NotRepresentable);
        }
        Ok([self.x, [round(&y[0])?, round(&y[1])?, round(&y[2])?], self.z])
    }

    /// An upper bound on how far the linear part is from orthonormal:
    /// max |G - I| over the Gram matrix G of the columns, rounded outward.
    /// Distances and areas measured in the source frame scale by a factor in
    /// [1 - d, 1 + d] (d = this bound times 3, from the spectral norm).
    pub fn orthonormality_defect(&self) -> Result<f64, NotRepresentable> {
        let c = self.columns()?;
        let mut worst = 0.0f64;
        for i in 0..3 {
            for j in 0..3 {
                let mut e = Exp::new();
                let mut g = Guard::new();
                for k in 0..3 {
                    e = sum(&e, &mul(&[c[i][k]], &[c[j][k]], &mut g), &mut g);
                }
                if i == j {
                    e = sum(&e, &[-1.0], &mut g);
                }
                if !g.exact() {
                    return Err(NotRepresentable);
                }
                worst = worst.max(round(&e)?.abs());
            }
        }
        // y was rounded (half an ulp per component, |y| ~ 1): add 4 ulps of 1.
        Ok(worst + 4.0 * f64::EPSILON)
    }

    /// Source coordinates of a world point `q` (already divided by `scale`),
    /// solved in f64 by the adjugate. Returns the point and an absolute error
    /// bound in source units. Only for observation (probe distances), never for
    /// a decision about construction geometry.
    pub fn inverse_approx(&self, q: [f64; 3]) -> Result<([f64; 3], f64), NotRepresentable> {
        let [x, y, z] = self.columns()?;
        let (x, y, z) = (x.map(Iv::point), y.map(Iv::point), z.map(Iv::point));
        let d = [0, 1, 2].map(|k| Iv::point(q[k]) - Iv::point(self.origin[k]));
        let cross = |a: [Iv; 3], b: [Iv; 3]| [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        let dot = |a: [Iv; 3], b: [Iv; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        let det = finite_ball(dot(x, cross(y, z)))?;
        if det.lo() <= 0.5 { return Err(NotRepresentable); }
        let s = [dot(d, cross(y, z)) / det, dot(d, cross(z, x)) / det, dot(d, cross(x, y)) / det];
        let mut radius = 0.0f64;
        for v in s { radius = radius.max(finite_ball(v)?.r); }
        // Also enclose the caller's unit conversion and the rounded y column.
        // Scale before adding magnitudes, so the bound calculation cannot hide
        // an overflowing intermediate. A normal absolute floor covers gradual
        // underflow even when a relative rounding allowance becomes zero.
        let magnitude = q.iter().chain(self.origin.iter()).fold(0.0f64, |m, v| m.max(v.abs()));
        let reach = s.iter().fold(0.0f64, |m, v| m.max(v.m.abs()));
        let eps = Iv::point(32.0 * f64::EPSILON);
        let bound = finite_ball(Iv::point(magnitude) * eps + Iv::point(reach) * eps
            + Iv::point(radius) + Iv::point(f64::MIN_POSITIVE))?.hi();
        Ok((s.map(|v| v.m), bound))
    }
}
