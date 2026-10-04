//! Distance from a point outside the holed target to the holed body.
//!
//! The body boundary is covered by closed pieces, each a product of an exact
//! planar region and an axial interval: the target's lateral walls, its caps
//! minus the open hole discs and pocket mouth that open on them, hole walls,
//! blind hole floors, pocket walls and the pocket floor (for rectilinear cell
//! targets: every target face, minus the open hole discs on it). Each piece
//! lies on the body and their union is its boundary; a point outside the
//! target is outside the body, so the minimum over the pieces is the distance.
//! Region membership is decided on exact rationals; each piece distance is an
//! interval enclosure of its closed form. Nothing is sampled or projected in
//! floating point.
use crate::{
    arc_profile::{dot, enclose, finite, q, sub, P},
    cylinder::Spec,
    prism_holes::{base_caps, no, Base, PrismHoles, R},
};
use num_rational::BigRational as Q;
use num_traits::{Signed, Zero};
use wonky_contract::SurfaceGeometry;
use wonky_curve as wc;
use wonky_num::{Iv, Scalar};

fn i(x: f64) -> Iv {
    Iv::point(x)
}
fn norm(radial: Iv, axial: Iv) -> R<Iv> {
    finite(radial.norm3(axial, i(0.)))
}
/// Distance from the level `z` to the closed interval `[a, b]`.
fn axial_gap(z: &Q, a: &Q, b: &Q) -> R<Iv> {
    enclose(&(a - z).max(z - b).max(Q::zero()))
}
/// `|sqrt(d2) - r|`, rationalized so a point next to the circle does not
/// cancel two nearly equal enclosures.
fn ring_gap(d2: &Q, r: f64) -> R<Iv> {
    let r2 = q(r) * q(r);
    let excess = (d2 - &r2).abs();
    finite(enclose(&excess)? / (i(r) + enclose(d2)?.sqrt()))
}
fn center(h: &Spec, axis: usize) -> P {
    [q(h.bottom[(axis + 1) % 3]), q(h.bottom[(axis + 2) % 3])]
}
fn squared(u: &P, c: &P) -> Q {
    let d = sub(u, c);
    dot(&d, &d)
}
fn line_distance(a: &P, b: &P, u: &P) -> R<Iv> {
    let d = sub(b, a);
    let v = sub(u, a);
    let t = (dot(&v, &d) / dot(&d, &d)).max(Q::zero()).min(q(1.));
    let gap = [&v[0] - &t * &d[0], &v[1] - &t * &d[1]];
    finite(enclose(&dot(&gap, &gap))?.sqrt())
}
fn min(pieces: impl IntoIterator<Item = Iv>) -> Option<Iv> {
    pieces.into_iter().reduce(|a, b| a.min(b))
}

impl PrismHoles {
    /// Holes are pairwise disjoint and strictly inside their face, so a point
    /// is in at most one open disc, whose circle is the nearest face point.
    fn disc_gap(&self, u: &P, axis: usize, opens: impl Fn(usize) -> bool) -> R<Option<Iv>> {
        for (index, h) in self.holes.iter().enumerate() {
            let d2 = squared(u, &center(h, axis));
            if opens(index) && d2 < q(h.radius) * q(h.radius) {
                return Ok(Some(ring_gap(&d2, h.radius)?));
            }
        }
        Ok(None)
    }
    fn opens_on(&self, index: usize, face: usize) -> bool {
        self.caps[index].contains(&Some(face))
    }
    /// Source-frame distance from a point outside the closed target.
    pub(crate) fn outside_distance(&self, p: &[Q; 3]) -> R<Iv> {
        let (axis, levels) = self.base.axis_levels()?;
        let u = [p[(axis + 1) % 3].clone(), p[(axis + 2) % 3].clone()];
        let z = &p[axis];
        let mut pieces = vec![];
        for (index, h) in self.holes.iter().enumerate() {
            let [lo, hi] = &self.hole_levels[index];
            let d2 = squared(&u, &center(h, axis));
            pieces.push(norm(ring_gap(&d2, h.radius)?, axial_gap(z, lo, hi)?)?);
            // A hole end on no target or pocket face is a floor disc of its own.
            for side in 0..2 {
                if self.caps[index][side].is_none() {
                    let radial = if d2 <= q(h.radius) * q(h.radius) {
                        i(0.)
                    } else {
                        ring_gap(&d2, h.radius)?
                    };
                    let level = &self.hole_levels[index][side];
                    pieces.push(norm(radial, enclose(&(z - level).abs())?)?);
                }
            }
        }
        match &self.base {
            Base::Planar(a) if a.orthogonal.as_ref().is_some_and(|c| c.boxes.len() > 1) => {
                self.cell_faces(a, p, &mut pieces)?
            }
            _ => self.profile_faces(axis, levels, &u, z, &mut pieces)?,
        }
        min(pieces).ok_or_else(|| no("probe-empty"))
    }
    fn profile_faces(
        &self,
        axis: usize,
        levels: [f64; 2],
        u: &P,
        z: &Q,
        pieces: &mut Vec<Iv>,
    ) -> R<()> {
        let point = wc::ExactPoint::from_rational(u.clone());
        let (inside, boundary) = if let Some(profile) = self.base.profile() {
            let near = profile
                .profile
                .segments()
                .iter()
                .map(|s| Ok(s.distance(&point)?))
                .collect::<R<Vec<_>>>()?;
            (profile.contains(&point)?, min(near).ok_or_else(|| no("target-carrier"))?)
        } else if let Base::Cylinder(c) = &self.base {
            let d2 = squared(u, &center(&c.spec, axis));
            let r = c.spec.radius;
            (d2 <= q(r) * q(r), ring_gap(&d2, r)?)
        } else {
            return Err(no("target-carrier"));
        };
        let bounds = levels.map(q);
        pieces.push(norm(boundary, axial_gap(z, &bounds[0], &bounds[1])?)?);
        let caps = base_caps(&self.base)?;
        let pocket = self.pocket.as_ref();
        let mouth = pocket
            .map(|k| -> R<Iv> {
                let near = k
                    .prism
                    .profile
                    .segments()
                    .iter()
                    .map(|s| Ok(s.distance(&point)?))
                    .collect::<R<Vec<_>>>()?;
                min(near).ok_or_else(|| no("pocket-profile"))
            })
            .transpose()?;
        for side in 0..2 {
            let planar = if !inside {
                boundary
            } else if let Some(g) = self.disc_gap(u, axis, |h| self.opens_on(h, caps[side]))? {
                g
            } else if match pocket {
                Some(k) if k.entry == side => k.prism.contains(&point)?,
                Some(_) | None => false,
            } {
                mouth.ok_or_else(|| no("pocket-profile"))?
            } else {
                i(0.)
            };
            pieces.push(norm(planar, enclose(&(z - &bounds[side]).abs())?)?);
        }
        if let (Some(k), Some(mouth)) = (pocket, mouth) {
            pieces.push(norm(mouth, axial_gap(z, &k.levels[0], &k.levels[1])?)?);
            // The floor is the first face appended to the target (hole_caps).
            let floor = self.base.body().faces.len();
            let planar = if !k.prism.contains(&point)? {
                mouth
            } else if let Some(g) = self.disc_gap(u, axis, |h| self.opens_on(h, floor))? {
                g
            } else {
                i(0.)
            };
            pieces.push(norm(planar, enclose(&(z - &k.levels[1 - k.entry]).abs())?)?);
        }
        Ok(())
    }
    /// Every face of an exact rectilinear cell union is a polygon with holes
    /// in an axis plane; its loops carry exact source vertices.
    fn cell_faces(&self, a: &crate::polyhedron::Audited, p: &[Q; 3], pieces: &mut Vec<Iv>) -> R<()> {
        for (f, face) in a.body.faces.iter().enumerate() {
            let SurfaceGeometry::Plane { normal, .. } = &a.body.surfaces[face.surface.0 as usize].geometry
            else {
                return Err(no("cell-carrier"));
            };
            let k = normal
                .iter()
                .position(|v| v.get() != 0.)
                .ok_or_else(|| no("cell-carrier"))?;
            let (s, t) = ((k + 1) % 3, (k + 2) % 3);
            let w = [p[s].clone(), p[t].clone()];
            let mut level = None;
            let mut near = vec![];
            let (mut odd, mut on_edge) = (false, false);
            for l in &face.loops {
                let ids = &a.face_loops[l.0 as usize];
                let points = ids
                    .iter()
                    .map(|&v| a.body.vertices[v].point.map(|x| q(x.get())))
                    .collect::<Vec<_>>();
                let first = points.first().ok_or_else(|| no("cell-face"))?;
                level.get_or_insert_with(|| first[k].clone());
                for j in 0..points.len() {
                    let (x, y) = (&points[j], &points[(j + 1) % points.len()]);
                    let (x, y) = ([x[s].clone(), x[t].clone()], [y[s].clone(), y[t].clone()]);
                    let d = line_distance(&x, &y, &w)?;
                    let e = sub(&y, &x);
                    let v = sub(&w, &x);
                    on_edge |= (&e[0] * &v[1] - &e[1] * &v[0]).is_zero()
                        && dot(&v, &e) >= Q::zero()
                        && dot(&sub(&w, &y), &e) <= Q::zero();
                    if (x[1] > w[1]) != (y[1] > w[1])
                        && w[0] < &x[0] + (&w[1] - &x[1]) * (&y[0] - &x[0]) / (&y[1] - &x[1])
                    {
                        odd = !odd;
                    }
                    near.push(d);
                }
            }
            let level = level.ok_or_else(|| no("cell-face"))?;
            let planar = if on_edge {
                i(0.)
            } else if !odd {
                min(near).ok_or_else(|| no("cell-face"))?
            } else if let Some(g) = self.disc_gap(&[p[0].clone(), p[1].clone()], 2, |h| {
                k == 2 && self.opens_on(h, f)
            })? {
                g
            } else {
                i(0.)
            };
            pieces.push(norm(planar, enclose(&(&p[k] - &level).abs())?)?);
        }
        Ok(())
    }
}
