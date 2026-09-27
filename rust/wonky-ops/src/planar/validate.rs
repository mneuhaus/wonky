//! Source and result validation of the planar Boolean:
//! - `planar_valid` ports kernel/ports/occt-planar.bend V.valid line by line;
//! - `audit_valid` is the planar/line subset of kernel/ports/curved-validate.bend
//!   CV.audit (topology, vertex words, edge gaps, carrier incidence, face
//!   frames, loop area/orientation, positive volume). The face-plane.bend
//!   preparation beyond those checks is NOT ported (docs/rust-spike.md, No-Claim);
//! - `resolution` is CV.resolution.

use crate::face::PFace;
use crate::halfspace::{self, stitch};
use crate::model::*;
use crate::num::*;
use crate::provenance::near_segment;

/// CV.resolution: guard * max(1, |vertices|, |edge origins|, |face origins|)
pub fn resolution(solid: &Solid) -> f64 {
    let mut scale = halfspace::vertex_scale(&solid.vertices, 1.0);
    scale = scale.max(crate::face::edges_top(&solid.edges));
    for f in &solid.faces {
        scale = scale.max(origin_of(&f.surface).magnitude().max(1.0));
    }
    angular_guard() * scale
}

/// H.volume(polygons(faces, edges), vertices, vertex 0) / 6
pub fn volume(solid: &Solid) -> Iv {
    let polys = halfspace::polygons(&solid.faces, &solid.edges);
    halfspace::volume6(&polys, &solid.vertices, halfspace::vertex(&solid.vertices, 0)) / Iv::point(6.0)
}

fn opposite(a: Iv, b: Iv, g: Iv) -> bool {
    (lt(g, a, "crossing side") && lt(b, -g, "crossing side")) || (lt(g, b, "crossing side") && lt(a, -g, "crossing side"))
}

fn crossing(a: P3, b: P3, c: P3, d: P3, normal: I3, resolution: f64) -> bool {
    let res = Iv::point(resolution);
    let (ai, bi, ci, di) = (a.iv(), b.iv(), c.iv(), d.iv());
    let ab = bi.sub(ai).normalize();
    let cd = di.sub(ci).normalize();
    let transverse = opposite(ab.cross(ci.sub(ai)).dot(normal), ab.cross(di.sub(ai)).dot(normal), res)
        && opposite(cd.cross(ai.sub(ci)).dot(normal), cd.cross(bi.sub(ci)).dot(normal), res);
    transverse || near_segment(a, c, d, resolution) || near_segment(b, c, d, resolution) || near_segment(c, a, b, resolution) || near_segment(d, a, b, resolution)
}

/// V.ring_clear: no two non-adjacent uses of the ring cross or touch.
fn ring_clear(uses: &[Use], vertices: &[P3], edges: &[Edge], normal: I3, resolution: f64) -> bool {
    for i in 0..uses.len() {
        let (a, b) = (halfspace::use_start(uses[i], edges), halfspace::use_end(uses[i], edges));
        for j in i + 1..uses.len() {
            let (c, d) = (halfspace::use_start(uses[j], edges), halfspace::use_end(uses[j], edges));
            let adjacent = a == c || a == d || b == c || b == d;
            if !adjacent && crossing(halfspace::vertex(vertices, a), halfspace::vertex(vertices, b), halfspace::vertex(vertices, c), halfspace::vertex(vertices, d), normal, resolution) {
                return false;
            }
        }
    }
    true
}

/// H.prepared_valid(F.prepare_loops([loop], ..., budget)): one outer loop,
/// every use prepared within the budget, closed, more than two edges.
fn prepared_valid(face: &Face, solid: &Solid, domains: &[DomainChoice], budget: f64) -> bool {
    let pf = PFace::new(face, &solid.vertices, &solid.edges, domains, 0.0, None);
    let b = Iv::point(budget);
    match &pf.loops {
        Some(ls) if ls.len() == 1 && ls[0].outer && ls[0].edges.len() > 2 => le(pf.max_endpoint, b, "prepared endpoint gap") && le(pf.max_planar, b, "prepared plane gap"),
        _ => false,
    }
}

fn face_valid(face: &Face, solid: &Solid, domains: &[DomainChoice], resolution: f64) -> bool {
    let Surface::Plane { origin, normal, x } = face.surface else { return false };
    let [Loop { outer: true, uses }] = face.loops.as_slice() else { return false };
    let unit = normal.iv().normalize();
    let out = if face.same_sense { unit } else { unit.scale(Iv::point(-1.0)) };
    let ids = halfspace::ring_vertices(uses, &solid.edges);
    let area = halfspace::ring_area(&ids, &solid.vertices, out);
    let frame = vec_valid(origin) && halfspace::frame_valid(normal, x);
    let one_ring = matches!(stitch(&solid.edges, solid.vertices.len() as u32, uses), Ok(r) if r.len() == 1);
    let res = Iv::point(resolution);
    frame
        && one_ring
        && prepared_valid(face, solid, domains, resolution)
        && lt(res * res, area, "face area")
        && ring_clear(uses, &solid.vertices, &solid.edges, out, resolution)
}

/// V.valid(solid, domains, resolution)
pub fn planar_valid(solid: &Solid, domains: &[DomainChoice], resolution: f64) -> bool {
    let (nv, ne, nd) = (solid.vertices.len(), solid.edges.len(), domains.len());
    let res = Iv::point(resolution);
    let nonempty = nv > 0 && ne > 0 && !solid.faces.is_empty();
    let topology = nonempty
        && halfspace::edges_closed(&solid.edges, &solid.faces)
        && halfspace::all_used(nv, &solid.edges)
        && halfspace::unique_vertices(&solid.vertices, res)
        && halfspace::unique_edges(&solid.edges);
    let geometry = solid.vertices.iter().all(|v| vec_valid(*v))
        && halfspace::lines_valid(&solid.edges, &solid.vertices, res)
        && solid.faces.iter().all(|f| face_valid(f, solid, domains, resolution));
    (nd == 0 || nd == ne) && topology && geometry && lt(res * res * res, volume(solid), "solid volume")
}

/// CV.valid(CV.audit(solid, domains, tolerance, source_budget)), planar/line subset.
pub fn audit_valid(solid: &Solid, domains: &[DomainChoice], tol: &Tolerance, source_budget: f64) -> bool {
    let res = resolution(solid);
    let allowance = Iv::point(source_budget) + Iv::point(res);
    let (nv, ne, nd) = (solid.vertices.len(), solid.edges.len(), domains.len());
    let nonempty = nv > 0 && ne > 0 && !solid.faces.is_empty();
    let topology = (nd == 0 || nd == ne) && nonempty && halfspace::edges_closed(&solid.edges, &solid.faces) && halfspace::all_used(nv, &solid.edges) && halfspace::connected(&solid.faces);
    if !topology || !solid.vertices.iter().all(|v| vec_valid(*v)) {
        return false;
    }
    let linear = Iv::point(tol.linear);
    // edges_required: E.prepare_edge gap (endpoint error) of every edge, LIMIT when not prepared
    let domain_of = |i: usize, e: &Edge| -> Option<(P3, P3, f64, f64)> {
        let Curve::Line { origin, direction } = e.curve else { return None };
        let (s, t) = (solid.vertices.get(e.start as usize)?, solid.vertices.get(e.end as usize)?);
        if !(vec_valid(origin) && vec_valid(direction) && direction_valid(direction) && vec_valid(*s) && vec_valid(*t)) || e.start == e.end {
            return None;
        }
        let (first, last) = match domains.get(i).copied().unwrap_or(DomainChoice::Auto) {
            DomainChoice::Given(Domain::Interval { first, last }) => (first, last),
            DomainChoice::Given(Domain::Untrimmed) => return None,
            DomainChoice::Auto => {
                let lp = |p: P3| p.sub(origin).dot(direction) / direction.dot(direction);
                let (a, b) = (lp(*s), lp(*t));
                (a.min(b), a.max(b))
            }
        };
        if !(scalar_valid(first) && scalar_valid(last) && first < last) {
            return None;
        }
        Some((origin, direction, first, last))
    };
    for (i, e) in solid.edges.iter().enumerate() {
        let Some((origin, direction, first, last)) = domain_of(i, e) else { return false };
        let (o, d) = (origin.iv(), direction.iv());
        let (sp, tp) = (halfspace::vertex(&solid.vertices, e.start), halfspace::vertex(&solid.vertices, e.end));
        let (s, t) = (sp.iv(), tp.iv());
        // E.edge_resolution with plane_origin = vertex 0
        let scale = origin.magnitude().max(halfspace::vertex(&solid.vertices, 0).magnitude()).max(1.0);
        let dscale = direction.scale(first).magnitude().max(direction.scale(last).magnitude());
        let top = scale.max(dscale).max(sp.magnitude()).max(tp.magnitude());
        let eres = Iv::point(round_guard()) * (Iv::point(10.0) * Iv::point(top));
        if !le(eres, linear, "audit edge resolution") {
            return false;
        }
        let (pa, pb) = if e.same_sense { (first, last) } else { (last, first) };
        let gap = s.sub(o.add(d.scale(Iv::point(pa)))).length().max(t.sub(o.add(d.scale(Iv::point(pb)))).length());
        if !le(gap, Iv::point(source_budget) + eres, "audit edge gap") || !le(gap, allowance, "audit edge required") {
            return false;
        }
    }
    // faces_required: carrier incidence of every used edge; faces: frame, resolution, area, orientation
    for f in &solid.faces {
        let Surface::Plane { origin, normal, x } = f.surface else { return false };
        if !(vec_valid(origin) && halfspace::frame_valid(normal, x)) {
            return false;
        }
        let fscale = crate::face::edges_top(&solid.edges).max(origin.magnitude().max(halfspace::vertex(&solid.vertices, 0).magnitude()).max(1.0));
        if !lt(Iv::point(angular_guard()) * Iv::point(fscale), linear, "audit face resolution") {
            return false;
        }
        let n = normal.iv().normalize();
        let mut total = Iv::point(0.0);
        for l in &f.loops {
            let mut ring = V3 { x: Iv::point(0.0), y: Iv::point(0.0), z: Iv::point(0.0) };
            for u in &l.uses {
                let e = halfspace::edge_at(&solid.edges, u.edge);
                let Some((lo, dir, first, last)) = domain_of(u.edge as usize, &e) else { return false };
                let (lo_i, dir_i) = (lo.iv(), dir.iv());
                let cb = n.dot(dir_i);
                let cc = n.dot(lo_i.sub(origin.iv()));
                let incidence = (cb * Iv::point(first) + cc).abs().max((cb * Iv::point(last) + cc).abs());
                if !le(incidence, allowance, "audit carrier incidence") {
                    return false;
                }
                // curve_vector over the use's direction of the domain
                let (a, b) = if u.forward == e.same_sense { (first, last) } else { (last, first) };
                let pa = lo_i.add(dir_i.scale(Iv::point(a))).sub(origin.iv());
                let pb = lo_i.add(dir_i.scale(Iv::point(b))).sub(origin.iv());
                ring = ring.add(pa.cross(pb));
            }
            let sign = if f.same_sense { 1.0 } else { -1.0 };
            let area = Iv::point(sign * 0.5) * ring.dot(n);
            let minimum = Iv::point(res) * Iv::point(res);
            let oriented = if l.outer { lt(minimum, area, "audit loop orientation") } else { lt(area, -minimum, "audit loop orientation") };
            if !oriented {
                return false;
            }
            total = total + area;
        }
        if !lt(Iv::point(res) * Iv::point(res), total, "audit face area") {
            return false;
        }
    }
    let v = volume(solid);
    let r = Iv::point(res);
    le(v.abs(), Iv::point(LIMIT), "audit volume range") && lt(r * r * r, v, "audit volume")
}
