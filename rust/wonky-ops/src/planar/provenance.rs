//! Port of kernel/ports/planar-boolean-provenance.bend: face ownership of the
//! boundary polygons, original carriers, edge domains and edge origins.

use crate::arrangement::{centroid, plane_equal};
use crate::face::{FaceClass, PFace};
use crate::halfspace::{self, Polygon};
use crate::model::*;
use crate::num::*;

pub struct Context<'a> {
    pub first: &'a Solid,
    pub second: &'a Solid,
    pub first_faces: &'a [PFace],
    pub second_faces: &'a [PFace],
    pub tolerance: Tolerance,
    pub resolution: f64,
    pub subtraction: bool,
}

impl<'a> Context<'a> {
    fn solid(&self, operand: u32) -> &'a Solid {
        if operand == 0 {
            self.first
        } else {
            self.second
        }
    }
    fn pfaces(&self, operand: u32) -> &'a [PFace] {
        if operand == 0 {
            self.first_faces
        } else {
            self.second_faces
        }
    }
    pub fn source_face(&self, r: FaceRef) -> Option<&'a Face> {
        self.solid(r.operand).faces.get(r.index as usize)
    }
}

/// V.outward(surface, sense) as an interval vector
fn outward(surface: &Surface, sense: bool) -> I3 {
    let n = normal_of(surface).iv().normalize();
    if sense {
        n
    } else {
        n.scale(Iv::point(-1.0))
    }
}

/// O.trim_clear: no trim segment of the source face enters the polygon's relative interior.
fn trim_clear(face: &Face, solid: &Solid, ids: &[u32], vertices: &[P3], resolution: f64, normal: I3) -> bool {
    let [Loop { outer: true, uses }] = face.loops.as_slice() else { return false };
    let res = Iv::point(resolution);
    let zero = Iv::point(0.0);
    for u in uses {
        let a = halfspace::vertex(&solid.vertices, halfspace::use_start(*u, &solid.edges)).iv();
        let b = halfspace::vertex(&solid.vertices, halfspace::use_end(*u, &solid.edges)).iv();
        let (mut valid, mut first, mut last) = (true, zero, Iv::point(1.0));
        let n = ids.len();
        for i in 0..n {
            let p = halfspace::vertex(vertices, ids[i]).iv();
            let q = halfspace::vertex(vertices, ids[(i + 1) % n]).iv();
            let inward = normal.cross(q.sub(p)).normalize();
            let da = a.sub(p).dot(inward) - res;
            let db = b.sub(p).dot(inward) - res;
            match (lt(zero, da, "trim segment side"), lt(zero, db, "trim segment side")) {
                (false, false) => {
                    valid = false;
                    break;
                }
                (true, true) => {}
                (true, false) => last = last.min(da / (da - db)),
                (false, true) => first = first.max(da / (da - db)),
            }
        }
        if valid && lt(first, last, "trim segment range") {
            return false;
        }
    }
    true
}

/// O.owners -> the face origin of one boundary polygon, None if unowned or invalid.
fn owner(polygon: &Polygon, vertices: &[P3], ctx: &Context) -> Option<FaceOrigin> {
    let mut refs = Vec::new();
    for operand in 0..2u32 {
        let solid = ctx.solid(operand);
        for (index, face) in solid.faces.iter().enumerate() {
            let reversed = ctx.subtraction && operand == 1;
            let source_sense = if reversed { !face.same_sense } else { face.same_sense };
            if !plane_equal(&face.surface, &polygon.surface) {
                continue;
            }
            let aligned = lt(Iv::point(0.0), outward(&face.surface, source_sense).dot(outward(&polygon.surface, polygon.sense)), "owner aligned");
            if !aligned {
                continue;
            }
            let pface = &ctx.pfaces(operand)[index];
            let point = centroid(std::slice::from_ref(polygon), vertices);
            let normal = outward(&polygon.surface, polygon.sense);
            match pface.classify(point, &ctx.tolerance, 0.0) {
                FaceClass::Inside => {
                    let clear = trim_clear(face, solid, &polygon.vertices, vertices, ctx.resolution, normal);
                    let covered = polygon.vertices.iter().all(|i| matches!(pface.classify(halfspace::vertex(vertices, *i), &ctx.tolerance, 0.0), FaceClass::Inside | FaceClass::Boundary));
                    if !(clear && covered) {
                        return None;
                    }
                    refs.push(FaceRef { operand, index: index as u32 });
                }
                FaceClass::Outside => {
                    if !trim_clear(face, solid, &polygon.vertices, vertices, ctx.resolution, normal) {
                        return None;
                    }
                }
                _ => return None,
            }
        }
    }
    let owner = *refs.first()?;
    Some(FaceOrigin { owner, contributors: refs })
}

/// O.faces: one origin per boundary polygon, None if any is unowned.
pub fn faces(polygons: &[Polygon], vertices: &[P3], ctx: &Context) -> Option<Vec<FaceOrigin>> {
    polygons.iter().map(|p| owner(p, vertices, ctx)).collect()
}

/// O.original_carriers: each face gets its owner's source surface and sense.
pub fn original_carriers(faces: &[Face], origins: &[FaceOrigin], ctx: &Context) -> Vec<Face> {
    faces
        .iter()
        .zip(origins)
        .map(|(f, o)| {
            let reversed = ctx.subtraction && o.owner.operand == 1;
            let (surface, sense) = match ctx.source_face(o.owner) {
                Some(src) => (src.surface, src.same_sense),
                None => (plane(v3(0.0, 0.0, 0.0), v3(0.0, 0.0, 1.0)), true),
            };
            Face { surface, same_sense: if reversed { !sense } else { sense }, loops: f.loops.clone() }
        })
        .collect()
}

/// O.domains: GivenDomain Interval(0, |b - a|) per edge.
pub fn domains(edges: &[Edge], vertices: &[P3]) -> Vec<DomainChoice> {
    edges
        .iter()
        .map(|e| {
            let length = halfspace::vertex(vertices, e.end).sub(halfspace::vertex(vertices, e.start)).length();
            DomainChoice::Given(Domain::Interval { first: 0.0, last: length })
        })
        .collect()
}

/// V.near_segment
pub fn near_segment(point: P3, a: P3, b: P3, resolution: f64) -> bool {
    let res = Iv::point(resolution);
    let (point, a, b) = (point.iv(), a.iv(), b.iv());
    let delta = b.sub(a);
    let length = delta.length();
    let unit = delta.normalize();
    let parameter = point.sub(a).dot(unit);
    le(point.sub(a).cross(unit).length(), res, "near_segment distance") && le(-res, parameter, "near_segment start") && le(parameter, length + res, "near_segment end")
}

/// O.edges: an origin for every edge of a component, None if one has none.
pub fn edges(edges: &[Edge], vertices: &[P3], faces: &[Face], origins: &[FaceOrigin], ctx: &Context) -> Option<Vec<EdgeOrigin>> {
    let mut out = Vec::with_capacity(edges.len());
    for (i, e) in edges.iter().enumerate() {
        let first = halfspace::vertex(vertices, e.start);
        let last = halfspace::vertex(vertices, e.end);
        let mut found = None;
        'operands: for operand in 0..2u32 {
            let s = ctx.solid(operand);
            for (index, se) in s.edges.iter().enumerate() {
                let p = halfspace::vertex(&s.vertices, se.start);
                let q = halfspace::vertex(&s.vertices, se.end);
                if near_segment(first, p, q, ctx.resolution) && near_segment(last, p, q, ctx.resolution) {
                    found = Some(EdgeOrigin::OriginalEdge { operand, index: index as u32 });
                    break 'operands;
                }
            }
        }
        if found.is_none() {
            let refs: Vec<FaceRef> = faces
                .iter()
                .zip(origins)
                .filter(|(f, _)| f.loops.iter().any(|l| l.uses.iter().any(|u| u.edge == i as u32)))
                .map(|(_, o)| o.owner)
                .collect();
            if let [a, b] = refs.as_slice() {
                let same = a == b;
                let (sa, sb) = (ctx.source_face(*a).map(|f| f.surface), ctx.source_face(*b).map(|f| f.surface));
                let subdivision = same || matches!((sa, sb), (Some(x), Some(y)) if plane_equal(&x, &y));
                found = Some(if subdivision {
                    EdgeOrigin::FaceSubdivision { faces: if same { vec![*a] } else { vec![*a, *b] } }
                } else {
                    EdgeOrigin::FaceIntersection { first: *a, second: *b }
                });
            }
        }
        out.push(found?);
    }
    Some(out)
}
