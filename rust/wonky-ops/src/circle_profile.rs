//! Circle profiles reuse the audited cylinder and rectangular through-hole
//! carriers. Admission uses the exact line region and expansion clearance signs;
//! unsupported outlines/contact refuse, never drop a loop or approximate it.
use crate::{
    affine::Affine,
    analytic::{self, Solid},
    cylinder::{self, Spec},
    orthogonal, perforated,
    polyhedron::{self, Refused},
};
use wonky_contract::{Body, BodyKey};
use wonky_num::{
    expansion::{self as ex, Guard},
    p2,
};
use wonky_sketch::region;

type R<T> = Result<T, Refused>;
fn no(s: &str) -> Refused {
    Refused(format!("circle-profile/{s}"))
}

pub fn rectangle(segments: &[[f64; 4]], circle: [f64; 3]) -> R<[[f64; 2]; 2]> {
    wonky_sketch::circle_region::circle_region([circle[0], circle[1]], circle[2])
        .map_err(|_| no("invalid-circle"))?;
    let lines: Vec<_> = segments
        .iter()
        .map(|s| [p2(s[0], s[1]), p2(s[2], s[3])])
        .collect();
    let regions = region::lines_region(&lines).map_err(|_| no("line-arrangement"))?;
    if regions.open_wires != 0 || regions.loops.len() != 1 || regions.loops[0].points.len() != 4 {
        return Err(no("one-rectangle-required"));
    }
    let points = &regions.loops[0].points;
    let lo = [
        points.iter().map(|p| p.x).fold(f64::INFINITY, f64::min),
        points.iter().map(|p| p.y).fold(f64::INFINITY, f64::min),
    ];
    let hi = [
        points.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max),
        points.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max),
    ];
    for (i, a) in points.iter().enumerate() {
        let b = points[(i + 1) % 4];
        if !(a.x == lo[0] || a.x == hi[0])
            || !(a.y == lo[1] || a.y == hi[1])
            || (a.x != b.x && a.y != b.y)
        {
            return Err(no("non-rectangular-outline"));
        }
    }
    for k in 0..2 {
        for terms in [
            [circle[k], -circle[2], -lo[k]],
            [hi[k], -circle[k], -circle[2]],
        ] {
            let mut g = Guard::new();
            let margin = terms
                .into_iter()
                .fold(vec![], |e, x| ex::sum(&e, &[x], &mut g));
            if !g.exact() {
                return Err(no("clearance-range"));
            }
            if ex::sign(&margin) <= 0 {
                return Err(no("circle-contact-or-crossing"));
            }
        }
    }
    Ok([lo, hi])
}

pub fn extrude(
    key: BodyKey,
    frame: Affine,
    circle: [f64; 3],
    segments: &[[f64; 4]],
    depth: f64,
    reverse: bool,
    disk: bool,
) -> R<Body> {
    if !depth.is_finite() || depth <= 0. {
        return Err(no("depth"));
    }
    let bounds = if segments.is_empty() {
        None
    } else {
        Some(rectangle(segments, circle)?)
    };
    let (lo, hi) = if reverse { (-depth, 0.) } else { (0., depth) };
    let tool = cylinder::create(
        key.clone(),
        Spec {
            bottom: [circle[0], circle[1], lo],
            top: [circle[0], circle[1], hi],
            radius: circle[2],
        },
    )?;
    let cylinder = cylinder::audit(&tool.check().map_err(|_| no("cylinder-contract"))?)?;
    if disk || bounds.is_none() {
        return cylinder::transform(&cylinder, frame);
    }
    let [a, b] = bounds.unwrap();
    let base = orthogonal::cuboid(key.clone(), [a[0], a[1], lo], [b[0], b[1], hi])?;
    let base = polyhedron::audit(&base.check().map_err(|_| no("outer-contract"))?)?;
    let body = perforated::subtract(key, &base, &[cylinder])?;
    let Solid::Perforated(checked) =
        analytic::audit(&body.check().map_err(|_| no("hole-contract"))?)?
    else {
        return Err(no("missing-hole"));
    };
    checked.transform(frame)
}
