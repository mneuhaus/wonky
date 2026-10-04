//! Closed-ring axial cuts in exact rectilinear cell boundaries, including
//! pockets. No curved side intersection is guessed: every ring must clear all
//! exposed side trims. Column intervals come from exact cell endpoints.
use crate::{
    arc_profile::{enclose, pt, q},
    cylinder::{self, Spec},
    polyhedron::Audited,
    prism_holes::{no, R},
};
use num_traits::{Signed, Zero};
use wonky_contract::SurfaceGeometry;
use wonky_curve as wc;
use wonky_num::{Iv, Scalar};

fn vertices(a: &Audited, face: usize) -> Vec<[f64; 3]> {
    a.body.faces[face]
        .loops
        .iter()
        .flat_map(|l| {
            a.face_loops[l.0 as usize]
                .iter()
                .map(|&v| a.body.vertices[v].point.map(|x| x.get()))
        })
        .collect()
}

pub(crate) fn classify(a: &Audited, tools: &[Spec]) -> R<Vec<Spec>> {
    let cells = a.orthogonal.as_ref().ok_or_else(|| no("cell-source"))?;
    let mut holes = Vec::<Spec>::new();
    for tool in tools {
        if tool.axis()? != 2 {
            return Err(no("non-axial-cut"));
        }
        let mut column = cells
            .boxes
            .iter()
            .filter(|b| (0..2).all(|k| b[0][k] <= tool.bottom[k] && tool.bottom[k] <= b[1][k]))
            .map(|b| [b[0][2], b[1][2]])
            .collect::<Vec<_>>();
        column.sort_by(|a, b| a[0].total_cmp(&b[0]));
        let mut spans = Vec::<[f64; 2]>::new();
        for span in column {
            if let Some(last) = spans.last_mut() {
                if span[0] <= last[1] {
                    last[1] = last[1].max(span[1]);
                    continue;
                }
            }
            spans.push(span);
        }
        // Clearance is checked even when the center misses the target: a
        // cylinder centered outside can still intersect a side wall.
        let p = [q(tool.bottom[0]), q(tool.bottom[1])];
        let r2 = q(tool.radius) * q(tool.radius);
        for (i, face) in a.body.faces.iter().enumerate() {
            let SurfaceGeometry::Plane { normal, .. } =
                &a.body.surfaces[face.surface.0 as usize].geometry
            else {
                return Err(no("cell-carrier"));
            };
            if normal[2].get() != 0. {
                continue;
            }
            let vs = vertices(a, i);
            let lo = [0, 1, 2].map(|k| vs.iter().map(|p| p[k]).fold(f64::INFINITY, f64::min));
            let hi = [0, 1, 2].map(|k| vs.iter().map(|p| p[k]).fold(f64::NEG_INFINITY, f64::max));
            if hi[2] <= tool.bottom[2] || lo[2] >= tool.top[2] {
                continue;
            }
            if !wc::Trimmed::line([lo[0], lo[1]], [hi[0], hi[1]]).clears_disc(&p, &r2)? {
                return Err(no("side-contact-or-crossing"));
            }
        }
        for span in spans {
            let lo = span[0].max(tool.bottom[2]);
            let hi = span[1].min(tool.top[2]);
            if lo >= hi {
                continue;
            }
            if lo > span[0] && hi < span[1] {
                return Err(no("enclosed-cavity"));
            }
            let mut s = *tool;
            s.bottom[2] = lo;
            s.top[2] = hi;
            for h in &holes {
                if hi < h.bottom[2] || h.top[2] < lo {
                    continue;
                }
                if cylinder::radial_relation(s, *h)? <= 0 {
                    return Err(no("holes-contact-or-overlap"));
                }
            }
            holes.push(s);
        }
    }
    Ok(holes)
}

/// Ray parity uses exact source vertices. Test every hole loop separately and
/// prove strict disc/edge separation before attaching a full circular bound.
pub(crate) fn cap_contains(a: &Audited, face: usize, s: &Spec) -> R<bool> {
    let p = [q(s.bottom[0]), q(s.bottom[1])];
    let r2 = q(s.radius) * q(s.radius);
    let mut clear = true;
    for lid in &a.body.faces[face].loops {
        let lp = &a.body.loops[lid.0 as usize];
        let points = a.face_loops[lid.0 as usize]
            .iter()
            .map(|&v| {
                let v = &a.body.vertices[v];
                [v.point[0].get(), v.point[1].get()]
            })
            .collect::<Vec<_>>();
        let mut inside = false;
        for i in 0..points.len() {
            let (x, y) = (pt(points[i]), pt(points[(i + 1) % points.len()]));
            if (&x[1] > &p[1]) != (&y[1] > &p[1]) {
                let hit = &x[0] + (&p[1] - &x[1]) * (&y[0] - &x[0]) / (&y[1] - &x[1]);
                if p[0] < hit {
                    inside = !inside;
                }
            }
            clear &= wc::Trimmed::line(points[i], points[(i + 1) % points.len()]).clears_disc(&p, &r2)?;
        }
        if inside != lp.outer {
            return Ok(false);
        }
    }
    if !clear {
        return Err(no("side-contact-or-crossing"));
    }
    Ok(true)
}

/// Volume and first moments from disjoint exact cells; surface measures from
/// boundary loops, not from the sum of cell surfaces (which has internal faces).
pub(crate) fn measures(a: &Audited, scale: Iv) -> R<(Iv, [Iv; 3], Vec<Iv>, Vec<Iv>)> {
    let cells = a.orthogonal.as_ref().ok_or_else(|| no("cell-source"))?;
    let i = Iv::point;
    let mut volume = i(0.);
    let mut moment = [i(0.); 3];
    for [lo, hi] in &cells.boxes {
        let d = [0, 1, 2].map(|k| i(hi[k]) - i(lo[k]));
        let v = d[0] * d[1] * d[2];
        volume = volume + v;
        for k in 0..3 {
            moment[k] = moment[k] + v * (i(lo[k]) + i(hi[k])) / i(2.);
        }
    }
    let mut areas = vec![];
    let mut perimeters = vec![];
    for f in &a.body.faces {
        let SurfaceGeometry::Plane { normal, .. } = &a.body.surfaces[f.surface.0 as usize].geometry
        else {
            return Err(no("cell-carrier"));
        };
        let k = normal
            .iter()
            .position(|v| v.get() != 0.)
            .ok_or_else(|| no("cell-carrier"))?;
        let (u, v) = ((k + 1) % 3, (k + 2) % 3);
        let mut twice = q(0.);
        let mut length = i(0.);
        for lid in &f.loops {
            let ids = &a.face_loops[lid.0 as usize];
            for j in 0..ids.len() {
                let x = a.body.vertices[ids[j]].point.map(|v| q(v.get()));
                let y = a.body.vertices[ids[(j + 1) % ids.len()]]
                    .point
                    .map(|v| q(v.get()));
                twice += &x[u] * &y[v] - &y[u] * &x[v];
                let d = [0, 1, 2].map(|k| &y[k] - &x[k]);
                let square: wc::Q = d.iter().map(|v| v * v).sum();
                length = length + enclose(&square)?.sqrt();
            }
        }
        if twice.is_zero() {
            return Err(no("cell-face-area"));
        }
        areas.push(enclose(&(twice.abs() / q(2.)))? * scale * i(1e6));
        perimeters.push(length * scale * i(1000.));
    }
    Ok((volume, moment, areas, perimeters))
}
