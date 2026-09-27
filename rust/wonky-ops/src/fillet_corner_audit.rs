//! Independent exact incidence and orientation checks, not constructor replay.
use crate::{fillet_prism::no, polyhedron::Refused};
use num_rational::BigRational as Q;
use num_traits::{Signed, Zero};
use wonky_contract::*;
type R<T> = std::result::Result<T, Refused>;
fn q(x: f64) -> Q {
    Q::from_float(x).unwrap()
}
fn p(x: Vector3) -> [Q; 3] {
    x.map(|x| q(x.get()))
}
fn cross(a: &[Q; 3], b: &[Q; 3]) -> [Q; 3] {
    std::array::from_fn(|k| &a[(k + 1) % 3] * &b[(k + 2) % 3] - &a[(k + 2) % 3] * &b[(k + 1) % 3])
}
fn dot(a: &[Q; 3], b: &[Q; 3]) -> Q {
    (0..3).map(|k| &a[k] * &b[k]).sum()
}
fn sub(a: &[Q; 3], b: &[Q; 3]) -> [Q; 3] {
    std::array::from_fn(|k| &a[k] - &b[k])
}
fn cardinal(turn: Q) -> R<(Q, Q)> {
    for (t, c, s) in [
        (-0.25, 0., -1.),
        (0., 1., 0.),
        (0.25, 0., 1.),
        (0.5, -1., 0.),
        (0.75, 0., -1.),
    ] {
        if turn == q(t) {
            return Ok((q(c), q(s)));
        }
    }
    Err(no("corner-chart-angle"))
}
fn surface_point(g: &SurfaceGeometry, uv: [Q; 2]) -> R<[Q; 3]> {
    let (o, z, x, r, angular) = match g {
        SurfaceGeometry::Plane { origin, normal, x } => (*origin, *normal, *x, None, false),
        SurfaceGeometry::Cylinder {
            origin,
            axis,
            x,
            radius,
        } => (*origin, *axis, *x, Some(*radius), false),
        SurfaceGeometry::Sphere {
            origin,
            axis,
            x,
            radius,
        } => (*origin, *axis, *x, Some(*radius), true),
        _ => return Err(no("corner-surface")),
    };
    let (o, z, x) = (p(o), p(z), p(x));
    let y = cross(&z, &x);
    if dot(&z, &z) != q(1.) || dot(&x, &x) != q(1.) || !dot(&z, &x).is_zero() {
        return Err(no("corner-surface-axes"));
    }
    if let Some(r) = r {
        let (c, s) = cardinal(uv[0].clone())?;
        let (v, h) = if angular {
            let (c, s) = cardinal(uv[1].clone())?;
            (c, s * q(r.get()))
        } else {
            (q(1.), uv[1].clone())
        };
        Ok(std::array::from_fn(|k| {
            &o[k] + q(r.get()) * &v * (&c * &x[k] + &s * &y[k]) + &h * &z[k]
        }))
    } else {
        Ok(std::array::from_fn(|k| {
            &o[k] + &uv[0] * &x[k] + &uv[1] * &y[k]
        }))
    }
}
pub(crate) fn audit(body: &Body) -> R<()> {
    for e in &body.edges {
        let endpoints = [e.vertices[0], e.vertices[1]].map(|v| p(body.vertices[v.0 as usize].point));
        match &body.curves[e.curve.0 as usize].geometry {
            CurveGeometry::Line { a, b } => {
                if [p(*a), p(*b)] != endpoints {
                    return Err(no("corner-line-binding"));
                }
            }
            CurveGeometry::Circle {
                origin,
                normal,
                x,
                radius,
                ..
            } => {
                let (o, z, x) = (p(*origin), p(*normal), p(*x));
                let y = cross(&z, &x);
                if dot(&z, &z) != q(1.) || dot(&x, &x) != q(1.) || !dot(&z, &x).is_zero() {
                    return Err(no("corner-arc-axes"));
                }
                let expected =
                    [x, y].map(|v| std::array::from_fn(|k| &o[k] + q(radius.get()) * &v[k]));
                if expected != endpoints {
                    return Err(no("corner-arc-sense"));
                }
            }
            _ => return Err(no("corner-curve")),
        }
    }
    for face in &body.faces {
        let surface = &body.surfaces[face.surface.0 as usize].geometry;
        let (origin, normal, axis) = match surface {
            SurfaceGeometry::Plane { origin, normal, .. } => (p(*origin), Some(p(*normal)), None),
            SurfaceGeometry::Cylinder { origin, axis, .. } => (p(*origin), None, Some(p(*axis))),
            SurfaceGeometry::Sphere { origin, .. } => (p(*origin), None, None),
            _ => return Err(no("corner-surface")),
        };
        let mut area = [Q::zero(), Q::zero(), Q::zero()];
        let mut radial = area.clone();
        for lp in &face.loops {
            for id in &body.loops[lp.0 as usize].coedges {
                let co = &body.coedges[id.0 as usize];
                let e = &body.edges[co.edge.0 as usize];
                let endpoints = [e.vertices[0], e.vertices[1]].map(|v| p(body.vertices[v.0 as usize].point));
                let [start, end] = if co.forward {
                    endpoints.clone()
                } else {
                    [endpoints[1].clone(), endpoints[0].clone()]
                };
                let c = cross(&sub(&start, &origin), &sub(&end, &origin));
                for k in 0..3 {
                    area[k] += &c[k];
                    radial[k] += &start[k] - &origin[k];
                }
                let pc = &body.pcurves[co.pcurve.0 as usize];
                let uv = match &pc.geometry {
                    PcurveGeometry::Line { a, b } => [a.map(|x| q(x.get())), b.map(|x| q(x.get()))],
                    PcurveGeometry::CircularArc {
                        center,
                        x,
                        radius,
                        clockwise,
                    } => {
                        let c = center.map(|x| q(x.get()));
                        let x = x.map(|x| q(x.get()));
                        let y = [
                            -&x[1] * q(if *clockwise { -1. } else { 1. }),
                            &x[0] * q(if *clockwise { -1. } else { 1. }),
                        ];
                        [x, y].map(|x| std::array::from_fn(|k| &c[k] + q(radius.get()) * &x[k]))
                    }
                    _ => return Err(no("corner-chart")),
                };
                for k in 0..2 {
                    if surface_point(surface, uv[k].clone())? != endpoints[k] {
                        return Err(no("corner-chart-incidence"));
                    }
                }
                if !matches!(surface, SurfaceGeometry::Plane { .. }) {
                    let du = (&uv[1][0] - &uv[0][0]).abs();
                    let dv = (&uv[1][1] - &uv[0][1]).abs();
                    let circle = matches!(
                        body.curves[e.curve.0 as usize].geometry,
                        CurveGeometry::Circle { .. }
                    );
                    if matches!(surface, SurfaceGeometry::Sphere { .. }) {
                        if !((du == q(0.25) && dv.is_zero()) || (du.is_zero() && dv == q(0.25))) {
                            return Err(no("corner-sphere-trim"));
                        }
                    } else if (circle && !(du == q(0.25) && dv.is_zero()))
                        || (!circle && !du.is_zero())
                    {
                        return Err(no("corner-cylinder-trim"));
                    }
                }
            }
        }
        if let Some(axis) = axis {
            let t = dot(&radial, &axis);
            for k in 0..3 {
                radial[k] -= &t * &axis[k];
            }
        }
        let outward = normal.unwrap_or(radial);
        if dot(&area, &outward) <= Q::zero() || !face.forward {
            return Err(no("corner-face-orientation"));
        }
    }
    Ok(())
}
