//! Port of kernel/solid-classification.bend S.classify for planar solids, in
//! the prepared form of kernel/ports/planar-boolean-classification.bend
//! (K.prepare once per operand, K.classify per cell centroid): the same
//! predicate with the point-independent work hoisted.

use crate::exact;
use crate::face::{FaceClass, PFace};
use crate::halfspace;
use crate::model::*;
use crate::num::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SolidClass {
    Inside,
    Outside,
    Boundary,
    Unresolved,
}

/// Point-independent half of ray.bend plane_intersection for one face and one line direction.
#[derive(Clone, Copy, Debug)]
enum LinePlane {
    /// kind 5 (invalid input) for every point
    Invalid,
    /// b == 0 exactly (the line is parallel to the plane)
    Parallel { origin: P3, normal: P3, nl: Iv },
    /// b != 0 but |b| <= guard: kind 4 for every point
    Small,
    Crossing { origin: P3, normal: P3, nl: Iv, b: Iv },
}

pub struct PSolid {
    pub faces: Vec<PFace>,
    pub closed: bool,
    pub edges_top: f64,
    /// per fixed direction: (normalize(direction), per face)
    lines: Vec<(P3, bool, Vec<LinePlane>)>,
}

/// S.after_boundary's five fixed line directions.
const DIRECTIONS: [[f64; 3]; 5] = [[1.0, 0.3125, 0.6875], [0.4375, 1.0, 0.8125], [0.625, 0.1875, 1.0], [1.0, -0.5625, 0.25], [-0.375, 1.0, 0.5625]];

/// Y.bounded
fn bounded(v: P3) -> bool {
    vec_valid(v) && v.magnitude() <= limits().bounded
}

impl PSolid {
    pub fn new(solid: &Solid, domains: &[DomainChoice], tol: &Tolerance) -> PSolid {
        let top = crate::face::edges_top(&solid.edges);
        let faces = solid.faces.iter().map(|f| PFace::new(f, &solid.vertices, &solid.edges, domains, top, Some(tol))).collect();
        let nonempty = !solid.vertices.is_empty() && !solid.edges.is_empty() && !solid.faces.is_empty();
        let guard = Iv::point(angular_guard());
        let lines = DIRECTIONS
            .iter()
            .map(|d| {
                let direction = v3(d[0], d[1], d[2]);
                let direction_ok = bounded(direction) && direction_valid(direction);
                let planes = solid
                    .faces
                    .iter()
                    .map(|f| {
                        let Surface::Plane { origin, normal, .. } = f.surface else { return LinePlane::Invalid };
                        if !(direction_ok && bounded(origin) && bounded(normal) && direction_valid(normal)) {
                            return LinePlane::Invalid;
                        }
                        let (n, di) = (normal.iv(), direction.iv());
                        let nl = n.length();
                        if exact::perpendicular(normal, direction, "line/plane b certificate") {
                            return LinePlane::Parallel { origin, normal, nl };
                        }
                        let b = n.dot(di) / (nl * di.length());
                        if le(b.abs(), guard, "line/plane small b") {
                            return LinePlane::Small;
                        }
                        LinePlane::Crossing { origin, normal, nl, b }
                    })
                    .collect();
                (direction.normalize(), direction_ok, planes)
            })
            .collect();
        PSolid { faces, closed: nonempty && halfspace::edges_closed(&solid.edges, &solid.faces), edges_top: top, lines }
    }

    /// S.classify(solid, domains, point, tolerance, source_budget)
    pub fn classify(&self, point: P3, tol: &Tolerance, source_budget: f64) -> SolidClass {
        if !vec_valid(point) || !self.closed {
            return SolidClass::Unresolved;
        }
        // boundary pass: every face; any non-Outside decides (Unresolved outranks Boundary in Bend,
        // both are a failed membership for every caller of this port)
        let mut boundary = false;
        for f in &self.faces {
            match f.classify(point, tol, source_budget) {
                FaceClass::Outside => {}
                FaceClass::Inside | FaceClass::Boundary => boundary = true,
                FaceClass::Unresolved => return SolidClass::Unresolved,
            }
        }
        if boundary {
            return SolidClass::Boundary;
        }
        let scale = self.edges_top.max(point.magnitude().max(1.0));
        let margin = Iv::point(tol.linear) + Iv::point(source_budget) + Iv::point(angular_guard()) * Iv::point(scale);
        let mut count = 0u32;
        let mut inside = false;
        let mut conflict = false;
        for (unit, _, planes) in &self.lines {
            if let Some(vote) = self.line_vote(point, *unit, planes, tol, source_budget, margin) {
                if count != 0 && vote != inside {
                    conflict = true;
                }
                inside = vote;
                count += 1;
            }
        }
        if conflict || count < 2 {
            SolidClass::Unresolved
        } else if inside {
            SolidClass::Inside
        } else {
            SolidClass::Outside
        }
    }

    /// line_faces + line_vote: None = invalid line.
    fn line_vote(&self, point: P3, unit: P3, planes: &[LinePlane], tol: &Tolerance, source_budget: f64, margin: Iv) -> Option<bool> {
        let mut forward = 0u32;
        let mut backward = 0u32;
        if !bounded(point) {
            return None;
        }
        let guard = Iv::point(angular_guard());
        for (index, plane) in planes.iter().enumerate() {
            let t = match *plane {
                LinePlane::Invalid | LinePlane::Small => return None,
                LinePlane::Parallel { origin, normal, nl } => {
                    if exact::coincident(normal, point, origin, "line/plane c certificate") {
                        return None; // kind 3: the line lies in the plane
                    }
                    let c = normal.iv().dot(point.iv().sub(origin.iv())) / nl;
                    if le(c.abs(), guard, "line/plane small c") {
                        return None; // kind 4
                    }
                    continue; // kind 0: miss
                }
                LinePlane::Crossing { origin, normal, nl, b } => {
                    let c = normal.iv().dot(point.iv().sub(origin.iv())) / nl;
                    -c / b
                }
            };
            if !le(t.abs(), Iv::point(limits().root_range), "line/plane root range") {
                return None; // kind 6
            }
            let hit = point.add(unit.scale(t.mid()));
            match self.faces[index].classify(hit, tol, source_budget) {
                FaceClass::Outside => {}
                FaceClass::Inside => {
                    if !lt(margin, t.abs(), "line hit margin") {
                        return None;
                    }
                    if lt(Iv::point(0.0), t, "line hit sign") {
                        forward += 1;
                    } else {
                        backward += 1;
                    }
                }
                _ => return None,
            }
        }
        if forward & 1 != backward & 1 {
            return None;
        }
        Some(forward & 1 == 1)
    }
}
