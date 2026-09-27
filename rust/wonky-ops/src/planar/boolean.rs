//! Port of kernel/ports/planar-boolean.bend: planar UNION / SUBTRACTION by a
//! shared plane arrangement (same stages, stage numbers and refusal reasons).

use crate::arrangement::{self, ArrangeError, Selection};
use crate::halfspace::{self, Built};
use crate::model::*;
use crate::num::*;
use crate::provenance::{self, Context};
use crate::solid::PSolid;
use crate::topo;
use crate::validate;
use crate::wire::Request;

const BUDGET_MAX: f64 = 0.1_f32 as f64;

fn valid_budget(b: f64) -> bool {
    scalar_valid(b) && 0.0 <= b && b <= BUDGET_MAX
}

fn tolerance_valid(t: &Tolerance) -> bool {
    scalar_valid(t.linear) && scalar_valid(t.angular) && 0.0 < t.linear && 0.0 < t.angular && t.angular <= BUDGET_MAX
}

/// V.line_edges, V.plane_faces, V.single_faces
fn family(s: &Solid) -> bool {
    s.edges.iter().all(|e| matches!(e.curve, Curve::Line { .. }))
        && s.faces.iter().all(|f| matches!(f.surface, Surface::Plane { .. }))
        && s.faces.iter().all(|f| matches!(f.loops.as_slice(), [Loop { outer: true, .. }]))
}

fn source_size(s: &Solid) -> bool {
    s.vertices.len() < 257 && s.edges.len() < 513 && s.faces.len() < 257
}

fn source_valid(s: &Solid, d: &[DomainChoice], tol: &Tolerance, resolution: f64) -> bool {
    validate::planar_valid(s, d, resolution) && topo::contact_valid(s) && validate::audit_valid(s, d, tol, 0.0)
}

thread_local! {
    static PHASES: std::cell::RefCell<Vec<(&'static str, f64)>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// Wall time per stage of the last operation on this thread (microseconds).
pub fn last_phases() -> Vec<(&'static str, f64)> {
    PHASES.with(|p| p.borrow().clone())
}

struct Clock(std::time::Instant);
impl Clock {
    fn lap(&mut self, name: &'static str) {
        let now = std::time::Instant::now();
        let us = (now - self.0).as_secs_f64() * 1e6;
        PHASES.with(|p| p.borrow_mut().push((name, us)));
        self.0 = now;
    }
}

fn rejected(reason: Reason, stage: u32, detail: u32, stats: Stats) -> BoolResult {
    BoolResult::Unresolved { reason, stage, detail, stats }
}

/// Which cell selection: `Same` is the ported Bend algorithm (K.classify per cell),
/// `Propagate` the spike's better algorithm (arrangement::select_propagate).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Variant {
    Same,
    Propagate,
}

pub fn union(req: &Request) -> BoolResult {
    run(req, false, Variant::Same)
}
pub fn subtract(req: &Request) -> BoolResult {
    run(req, true, Variant::Same)
}

pub fn run(req: &Request, subtraction: bool, variant: Variant) -> BoolResult {
    reset_undecided();
    let result = operate(req, subtraction, variant);
    match undecided() {
        None => result,
        Some(site) => {
            let stats = match &result {
                BoolResult::Bodies { stats, .. } | BoolResult::Unresolved { stats, .. } | BoolResult::Undecidable { stats, .. } => *stats,
            };
            BoolResult::Undecidable { site, stats }
        }
    }
}

fn operate(req: &Request, subtraction: bool, variant: Variant) -> BoolResult {
    PHASES.with(|p| p.borrow_mut().clear());
    let mut clock = Clock(std::time::Instant::now());
    let empty = Stats::default();
    let tol = req.tolerance;
    if !(valid_budget(req.ab) && valid_budget(req.bb) && tolerance_valid(&tol) && angular_guard() <= tol.angular) {
        return rejected(Reason::InvalidInput, 0, 0, empty);
    }
    if !(req.ab == 0.0 && req.bb == 0.0) {
        return rejected(Reason::SourceTolerance, 0, 0, empty);
    }
    let (first, second) = (&req.first, &req.second);
    if !(family(first) && family(second) && source_size(first) && source_size(second)) {
        return rejected(Reason::UnsupportedArrangement, 1, 0, empty);
    }
    let resolution = validate::resolution(first).max(validate::resolution(second));
    if !(resolution < tol.linear) {
        return rejected(Reason::ResolutionLimit, 1, 0, empty);
    }
    if !(source_valid(first, &req.ad, &tol, resolution) && source_valid(second, &req.bd, &tol, resolution)) {
        return rejected(Reason::InvalidTopology, 1, 0, empty);
    }
    clock.lap("sources");
    // construct
    let vertices: Vec<P3> = first.vertices.iter().chain(second.vertices.iter()).copied().collect();
    let planes = arrangement::unique_planes(first.faces.iter().chain(second.faces.iter()).map(|f| f.surface));
    if planes.len() >= 33 {
        return rejected(Reason::ResolutionLimit, 1, 32, empty);
    }
    let arranged = arrangement::initial(&vertices, resolution).and_then(|s| arrangement::arrange(&planes, s, resolution));
    let arr = match arranged {
        Err(ArrangeError::Failed { reason, stage }) => return rejected(reason, 2, stage, empty),
        Ok(a) => a,
    };
    clock.lap("arrange");
    let mut stats = Stats { planes: arr.planes, cells: arr.cells.len() as u32, selected_cells: 0, shared_vertices: arr.vertices.len() as u32, boundary_faces: 0, internal_interfaces: 0 };
    let pa = PSolid::new(first, &req.ad, &tol);
    let pb = PSolid::new(second, &req.bd, &tol);
    clock.lap("prepare");
    let selection = match variant {
        Variant::Same => arrangement::select(&arr.cells, &arr.vertices, &pa, &pb, &tol, resolution, subtraction),
        Variant::Propagate => arrangement::select_propagate(&arr.cells, &arr.vertices, &pa, &pb, [first, second], &tol, resolution, subtraction),
    };
    let (polygons, count) = match selection {
        Selection::Failed { reason, stage, index } => return rejected(reason, stage, index, stats),
        Selection::Selected { polygons, count } => (polygons, count),
    };
    clock.lap("select");
    stats.selected_cells = count;
    let Some((polygons, internal)) = arrangement::boundary(polygons) else { return rejected(Reason::ConstructionFailure, 5, 0, stats) };
    stats.boundary_faces = polygons.len() as u32;
    stats.internal_interfaces = internal;
    let ctx = Context { first, second, first_faces: &pa.faces, second_faces: &pb.faces, tolerance: tol, resolution, subtraction };
    clock.lap("boundary");
    let Some(origins) = provenance::faces(&polygons, &arr.vertices, &ctx) else { return rejected(Reason::UnsupportedArrangement, 6, 0, stats) };
    clock.lap("ownership");
    let mut built = Built::default();
    halfspace::build_polygons(&polygons, &arr.vertices, &mut built);
    if !halfspace::edges_closed(&built.edges, &built.faces) {
        return rejected(Reason::ConstructionFailure, 7, 0, stats);
    }
    let mut bodies = Vec::new();
    for component in topo::components(&built.faces, &arr.vertices, &built.edges) {
        let face_origins: Vec<FaceOrigin> = component
            .sources
            .iter()
            .map(|i| origins.get(*i as usize).cloned().unwrap_or(FaceOrigin { owner: FaceRef { operand: u32::MAX, index: u32::MAX }, contributors: Vec::new() }))
            .collect();
        let topo::Component { solid, .. } = component;
        let solid = Solid { faces: provenance::original_carriers(&solid.faces, &face_origins, &ctx), ..solid };
        if subtraction && lt(validate::volume(&solid), Iv::point(0.0), "cavity volume") {
            return rejected(Reason::UnsupportedArrangement, 10, 0, stats);
        }
        let domains = provenance::domains(&solid.edges, &solid.vertices);
        let valid = validate::audit_valid(&solid, &domains, &tol, 0.0) && validate::planar_valid(&solid, &domains, resolution) && topo::contact_valid(&solid);
        if !valid {
            return rejected(Reason::ConstructionFailure, 8, 0, stats);
        }
        let Some(edge_origins) = provenance::edges(&solid.edges, &solid.vertices, &solid.faces, &face_origins, &ctx) else {
            return rejected(Reason::ConstructionFailure, 9, 0, stats);
        };
        bodies.push(Body { solid, domains, face_origins, edge_origins });
    }
    clock.lap("build+validate");
    BoolResult::Bodies { bodies, stats }
}
