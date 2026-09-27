//! First polygon-revolve slice: one orthogonal positive-radius region through
//! an exact quarter turn. End caps are copied/permuted source coordinates, not
//! sin/cos samples, and remain exactly planar under Frame::Interpreter.
//!
//! This is a construction, NOT yet a closed WC0 body: edge/coedge/pcurve sewing,
//! independent body audit, host transport and STEP export remain to be added.
use crate::{affine::Affine, polyhedron::Refused};
use wonky_contract::{Binary64, SurfaceGeometry, Vector3};
use wonky_num::{expansion as ex, Iv};
use wonky_sketch::region::lines_region;

type R<T> = Result<T, Refused>;
fn no(reason: &str) -> Refused { Refused(format!("revolve/polygon/{reason}")) }
fn scalar(v: f64) -> R<Binary64> { Binary64::new(v).map_err(|_| no("numeric-range")) }
fn vector(p: [f64; 3]) -> R<Vector3> { Ok([scalar(p[0])?, scalar(p[1])?, scalar(p[2])?]) }

pub struct Cap {
    /// Outward-oriented source polygon, all in the same construction frame.
    pub points: Vec<[f64; 3]>,
    pub plane: SurfaceGeometry,
}
pub struct Side {
    pub surface: SurfaceGeometry,
    pub forward: bool,
}
pub struct QuarterPolygon {
    pub frame: Affine,
    pub caps: [Cap; 2],
    pub sides: Vec<Side>,
    moment6: ex::Exp,
}
impl QuarterPolygon {
    /// Integral of r over the source polygon, times the validated quarter-turn
    /// angle and the exact affine determinant. Metres cubed, outward rounded.
    pub fn volume_m3(&self) -> R<Iv> {
        let enclose = |e: &[f64]| e.iter().fold(Iv::point(0.), |a, &b| a + Iv::point(b));
        let det = self.frame.det_exact().map_err(|_| no("numeric-range"))?;
        let pi = wonky_validated::pi(1e-14).map_err(|_| no("validated-pi"))?.ball();
        let volume = pi * enclose(&self.moment6) / Iv::point(12.) * enclose(&det);
        if volume.is_nan() || !volume.hi().is_finite() || volume.lo() <= 0. { return Err(no("measurement-range")); }
        Ok(volume)
    }
}

pub fn quarter_polygon(frame: Affine, segments: &[[f64; 4]], angle: f64) -> R<QuarterPolygon> {
    if angle != std::f64::consts::FRAC_PI_2 { return Err(no("partial-angle-not-quarter-turn")); }
    let values: Vec<_> = frame.origin.into_iter().chain(frame.x).chain(frame.z).collect();
    wonky_num::check_range(&values, "quarter polygon frame").map_err(|e| { e.into_refusal(); no("numeric-range") })?;
    let det = frame.det_exact().map_err(|_| no("numeric-range"))?;
    if ex::sign(&det) <= 0 { return Err(no("degenerate-frame")); }
    let segments: Vec<_> = segments.iter().map(|p| [wonky_num::p2(p[0], p[1]), wonky_num::p2(p[2], p[3])]).collect();
    let regions = lines_region(&segments).map_err(|_| no("invalid-profile"))?;
    if regions.loops.len() != 1 || regions.open_wires != 0 { return Err(no("one-closed-region-required")); }
    let p = &regions.loops[0].points;
    if p.iter().any(|q| q.x <= 0.) { return Err(no("profile-contacts-axis")); }
    let mut sides = Vec::with_capacity(p.len());
    let mut moment6 = vec![];
    let mut g = ex::Guard::new();
    for (i, a) in p.iter().enumerate() {
        let b = p[(i + 1) % p.len()];
        let (surface, forward) = if a.x == b.x {
            (SurfaceGeometry::Cylinder { origin: vector([0.; 3])?, axis: vector([0., 0., 1.])?, x: vector([1., 0., 0.])?, radius: scalar(a.x)? }, b.y > a.y)
        } else if a.y == b.y {
            let normal = if b.x > a.x { [0., 0., -1.] } else { [0., 0., 1.] };
            (SurfaceGeometry::Plane { origin: vector([0., 0., a.y])?, normal: vector(normal)?, x: vector([1., 0., 0.])? }, true)
        } else { return Err(no("sloped-lateral-carrier")); };
        sides.push(Side { surface, forward });
        let wedge = ex::sum(&ex::product(a.x, b.y, &mut g), &ex::neg(&ex::product(b.x, a.y, &mut g)), &mut g);
        let radial_sum = ex::sum(&[a.x], &[b.x], &mut g);
        moment6 = ex::sum(&moment6, &ex::mul(&radial_sum, &wedge, &mut g), &mut g);
    }
    if !g.exact() || ex::sign(&moment6) <= 0 { return Err(no("numeric-range")); }
    let caps = [
        Cap { points: p.iter().map(|p| [p.x, 0., p.y]).collect(), plane: SurfaceGeometry::Plane { origin: vector([0.; 3])?, normal: vector([0., -1., 0.])?, x: vector([1., 0., 0.])? } },
        Cap { points: p.iter().rev().map(|p| [0., p.x, p.y]).collect(), plane: SurfaceGeometry::Plane { origin: vector([0.; 3])?, normal: vector([-1., 0., 0.])?, x: vector([0., 1., 0.])? } },
    ];
    Ok(QuarterPolygon { frame, caps, sides, moment6 })
}
