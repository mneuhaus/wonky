//! Exact evaluation of seam points stored in a translated local chart. This
//! chart uses the existing WC0 zero-angle Rigid frame, not a rounded new input.
use crate::{cylinder::no, placement::Placement, polyhedron::Refused, rounding::round};
use wonky_contract::{Body, Frame, FrameId, Vector3};
use wonky_num::expansion::{self as ex, Guard};

pub fn point_mm(
    body: &Body,
    frame: &Placement,
    point: Vector3,
    id: FrameId,
) -> Result<[f64; 3], Refused> {
    let p = point.each_ref().map(|x| x.get());
    // The last construction identifies the body map, including exact local
    // Rigid images. The separate zero-angle seam chart remains local to it.
    let map = body.constructions.last().ok_or_else(|| no("chart-frame"))?.frame;
    if id == map {
        return frame.apply(p, 1000., true).map_err(|_| no("export-range"));
    }
    let Some(Frame::Rigid {
        parent,
        translation,
        angle,
        ..
    }) = body.frames.get(id.0 as usize)
    else {
        return Err(no("chart-frame"));
    };
    if *parent != map || angle.get() != 0.
    {
        return Err(no("chart-frame"));
    }
    let a = frame
        .apply_exact(p, 1000., false)
        .map_err(|_| no("export-range"))?;
    let t = frame
        .apply_exact(translation.each_ref().map(|x| x.get()), 1000., true)
        .map_err(|_| no("export-range"))?;
    let mut g = Guard::new();
    let e = [0, 1, 2].map(|k| ex::sum(&a[k], &t[k], &mut g));
    if !g.exact() {
        return Err(no("export-range"));
    }
    Ok([
        round(&e[0]).map_err(|_| no("export-range"))?,
        round(&e[1]).map_err(|_| no("export-range"))?,
        round(&e[2]).map_err(|_| no("export-range"))?,
    ])
}

pub fn vertices_mm(body: &Body, frame: &Placement) -> Result<Vec<[f64; 3]>, Refused> {
    body.vertices
        .iter()
        .map(|v| point_mm(body, frame, v.point, v.frame))
        .collect()
}
