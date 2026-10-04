//! Regions of a sketch of closed chains and full circles, from the one
//! `wonky_curve` arrangement.
//!
//! Every closed chain (line and three-point-arc pieces meeting at exact
//! endpoints) and every full circle is one simple counter-clockwise cycle. The
//! cycles are arranged together under a work budget (not an entity count):
//! crossings, nesting and holes are the arrangement's, and each bounded cell is
//! one sketch region. A region is extruded as the exact prism-stack Boolean of
//! the cycles bounding it: the intersection of the cycles it lies inside minus
//! the union of the bounding cycles it lies outside. Everything the arrangement
//! or the stack cannot decide refuses by its frozen name; nothing is dropped,
//! merged by tolerance or approximated.
//!
//! Open pieces crossing closed boundaries use the same arrangement, with graph
//! leaves removed after exact splitting. Selected simple cells extrude directly
//! from their exact boundaries; source rule 4 replays that selection. Unrelated
//! open components and unsupported holed split cells still refuse by name.
use crate::{
    affine::Affine,
    analytic::{self, Solid},
    arc_profile::{self, regularize, Profile},
    cylinder::{self, Spec},
    polyhedron::Refused,
    prism_stack,
};
use std::collections::BTreeMap;
use wonky_contract::{Body, BodyKey};
use wonky_curve as wc;

type R<T> = Result<T, Refused>;
fn no(s: &str) -> Refused {
    Refused(format!("sketch-regions/{s}"))
}

/// Most source pieces and split pieces of one sketch arrangement.
const BUDGET: wc::Budget = wc::Budget { segments: 2048, pieces: 16384 };

/// One input cycle and the entities it is drawn from.
enum Source {
    Chain { lines: Vec<[f64; 4]>, arcs: Vec<[f64; 6]> },
    Circle([f64; 3]),
}
struct Sketch {
    sources: Vec<Source>,
    cycles: Vec<wc::Cycle>,
}

/// A bounded cell of the arrangement as a sketch region.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Region {
    /// The cell is the outer component of a hole of another region (an island
    /// such as a bore's disc); `qSketchRegion(.., true)` filters it out.
    pub inner: bool,
    /// Regions sharing a boundary piece with this one.
    pub adjacent: Vec<usize>,
    /// Whether this cell is filtered as inner is not decided: it lies inside a
    /// hole of another region, but its outer boundary is not that hole (a
    /// composite hole, such as two overlapping bores or a gap between them).
    /// "Inside a hole" and "outer boundary equals a hole" are the two readings
    /// of `filterInnerLoops`; they agree on every sketch without such a cell,
    /// and `qSketchRegion(.., true)` refuses by name on a sketch with one.
    pub contested: bool,
}

/// Simple closed chains: the connected components of the exact endpoint graph.
fn chains(lines: &[[f64; 4]], arcs: &[[f64; 6]]) -> R<Vec<Source>> {
    let pieces = regularize::sources(lines, arcs)?;
    let mut parent = (0..pieces.len()).collect::<Vec<_>>();
    let mut at = BTreeMap::<wc::ExactPoint, usize>::new();
    for (i, piece) in pieces.iter().enumerate() {
        for end in piece.ends() {
            let j = *at.entry(end.clone()).or_insert(i);
            let (a, b) = (prism_stack::find(&mut parent, i), prism_stack::find(&mut parent, j));
            parent[a] = b;
        }
    }
    // Components are ordered by their first entity, so the order does not depend
    // on the placement of the sketch.
    let mut groups = BTreeMap::<usize, (usize, Vec<[f64; 4]>, Vec<[f64; 6]>)>::new();
    for i in 0..pieces.len() {
        let group = groups.entry(prism_stack::find(&mut parent, i)).or_insert((i, vec![], vec![]));
        if i < lines.len() {
            group.1.push(lines[i]);
        } else {
            group.2.push(arcs[i - lines.len()]);
        }
    }
    let mut groups = groups.into_values().collect::<Vec<_>>();
    groups.sort_by_key(|g| g.0);
    Ok(groups.into_iter().map(|(_, lines, arcs)| Source::Chain { lines, arcs }).collect())
}
/// The refusals of a chain that is not one simple closed loop of its own.
fn open(e: &Refused) -> bool {
    ["requires-closed-chain", "open-or-branching-chain", "multiple-loops", "open-chain"]
        .iter()
        .any(|n| e.0 == format!("arc-profile/{n}"))
}

/// A closed chain of two arcs is a full circle when both arcs ride on one
/// exact circle (a bore drawn as two half arcs). It is the circle source of
/// that circle when its centre and radius are binary64 values exactly; the
/// chain of two arcs of different circles is a lens, not a profile of this
/// grammar. `Ok(None)` when the chain is not two arcs.
fn two_arc_circle(chain: &Source) -> R<Option<[f64; 3]>> {
    let Source::Chain { lines, arcs } = chain else { return Ok(None) };
    if !lines.is_empty() || arcs.len() != 2 {
        return Ok(None);
    }
    let pieces = regularize::sources(&[], arcs)?;
    // Walk the chain: the second arc starts where the first ends and must end
    // where the first starts, else the two arcs are not one closed loop.
    let first = &pieces[0];
    let second = if pieces[1].ends()[0] == first.ends()[1] { pieces[1].clone() } else { pieces[1].reversed() };
    if second.ends()[0] != first.ends()[1] || second.ends()[1] != first.ends()[0] || first.ends()[0] == first.ends()[1] {
        return Err(no("not-closed-chains"));
    }
    let (wc::Carrier::Circle(a), wc::Carrier::Circle(b)) = (first.carrier(), second.carrier()) else {
        return Err(no("not-closed-chains"));
    };
    // One circle and one sense about its centre: the two arcs are one full
    // turn, and the circle is exactly (c, sqrt r2). Two arcs of different
    // circles are a lens, not a profile of this grammar.
    if a.c != b.c || a.r2 != b.r2 || a.ccw != b.ccw {
        return Err(no("two-arc-chain"));
    }
    let exact = |x: &arc_profile::Q| -> R<Option<f64>> {
        let m = arc_profile::enclose(x)?.m;
        Ok((arc_profile::q(m) == *x).then_some(m))
    };
    let r = arc_profile::enclose(&a.r2)?.m.sqrt();
    let centre = a.c.rat()?;
    match (exact(&centre[0])?, exact(&centre[1])?) {
        (Some(x), Some(y)) if arc_profile::q(r) * arc_profile::q(r) == a.r2 => Ok(Some([x, y, r])),
        _ => Err(no("two-arc-circle-inexact")),
    }
}

impl Sketch {
    fn new(lines: &[[f64; 4]], arcs: &[[f64; 6]], circles: &[[f64; 3]]) -> R<Self> {
        let mut sources = chains(lines, arcs)?;
        for source in &mut sources {
            if let Some(circle) = two_arc_circle(source)? {
                *source = Source::Circle(circle);
            }
        }
        sources.extend(circles.iter().map(|c| Source::Circle(*c)));
        let mut cycles = vec![];
        for source in &sources {
            cycles.push(match source {
                Source::Chain { lines, arcs } => {
                    if lines.len() + arcs.len() < 3 {
                        return Err(no("not-closed-chains"));
                    }
                    Profile::new(lines, arcs).map_err(|e| if open(&e) { no("not-closed-chains") } else { e })?.cycle().clone()
                }
                Source::Circle([x, y, r]) => {
                    if !(*r > 0.) {
                        return Err(no("circle-radius"));
                    }
                    prism_stack::ring_profile([*x, *y], *r)?
                }
            });
        }
        Ok(Self { sources, cycles })
    }
    fn arrange(&self) -> R<wc::Arrangement> {
        let refs = self.cycles.iter().collect::<Vec<_>>();
        let mut arr = wc::arrange(&refs, BUDGET)?;
        wc::classify(&mut arr, &refs)?;
        Ok(arr)
    }
}

/// The regions of an arrangement in a placement independent order: by the set
/// of cycles containing them, then by arrangement order.
fn order(arr: &wc::Arrangement) -> Vec<usize> {
    let mut cells = (0..arr.cells.len()).collect::<Vec<_>>();
    cells.sort_by_key(|&k| {
        let ins = arr.cells[k].inside.iter().enumerate().filter(|(_, &i)| i).map(|(c, _)| c).collect::<Vec<_>>();
        (ins, k)
    });
    cells
}

fn describe(arr: &wc::Arrangement, order: &[usize]) -> Vec<Region> {
    let rank = |cell: usize| order.iter().position(|&k| k == cell).unwrap();
    let mut regions = order.iter().map(|_| Region { inner: false, adjacent: vec![], contested: false }).collect::<Vec<_>>();
    for cell in order {
        for cycle in &arr.cells[*cell].cycles[1..] {
            // The twin of a hole cycle faces the island component inside it.
            for &h in cycle {
                let island = arr.face[h ^ 1];
                if island != wc::UNBOUNDED && island != *cell {
                    regions[rank(island)].inner = true;
                }
            }
        }
    }
    for e in 0..arr.pieces.len() {
        let (l, r) = (arr.face[2 * e], arr.face[2 * e + 1]);
        if l == wc::UNBOUNDED || r == wc::UNBOUNDED || l == r {
            continue;
        }
        let (a, b) = (rank(l), rank(r));
        for (x, y) in [(a, b), (b, a)] {
            if !regions[x].adjacent.contains(&y) {
                regions[x].adjacent.push(y);
            }
        }
    }
    for r in &mut regions {
        r.adjacent.sort();
    }
    // The two readings of an inner region: its outer boundary is exactly a hole
    // of another cell (`bounds_hole`), or it lies inside such a hole
    // (`enclosed`, flooded from the hole's inner side without entering the
    // holed cell). Every bounding cell is enclosed, so they differ only where a
    // hole holds more than islands of their own.
    let pieces = |cycle: &[usize]| {
        let mut p = cycle.iter().map(|&h| h / 2).collect::<Vec<_>>();
        p.sort();
        p.dedup();
        p
    };
    let holes = arr
        .cells
        .iter()
        .enumerate()
        .flat_map(|(k, c)| c.cycles[1..].iter().map(move |cycle| (k, cycle)))
        .collect::<Vec<_>>();
    let hole_pieces = holes.iter().map(|(k, cycle)| (*k, pieces(cycle))).collect::<Vec<_>>();
    let mut enclosed = vec![false; arr.cells.len()];
    for (k, cycle) in &holes {
        let mut seen = vec![false; arr.cells.len()];
        let mut stack = cycle.iter().map(|&h| arr.face[h ^ 1]).collect::<Vec<_>>();
        while let Some(y) = stack.pop() {
            if y == wc::UNBOUNDED || y == *k || seen[y] {
                continue;
            }
            seen[y] = true;
            enclosed[y] = true;
            stack.extend(arr.cells[y].cycles.iter().flatten().map(|&h| arr.face[h ^ 1]));
        }
    }
    for (cell, cycles) in arr.cells.iter().map(|c| &c.cycles).enumerate() {
        let outer = pieces(&cycles[0]);
        let bounds_hole = hole_pieces.iter().any(|(k, p)| *k != cell && *p == outer);
        regions[rank(cell)].contested = enclosed[cell] != bounds_hole;
    }
    regions
}

/// The regions of a sketch of closed chains and full circles.
pub fn regions(lines: &[[f64; 4]], arcs: &[[f64; 6]], circles: &[[f64; 3]]) -> R<Vec<Region>> {
    let (arr, _) = arranged(lines, arcs, circles)?;
    Ok(describe(&arr, &order(&arr)))
}

fn operand(key: &BodyKey, frame: Affine, source: &Source, depth: f64, reverse: bool) -> R<Solid> {
    let body = match source {
        Source::Chain { lines, arcs } => arc_profile::build(key.clone(), frame, lines, arcs, depth, reverse)?,
        Source::Circle([x, y, r]) => {
            let (lo, hi) = if reverse { (-depth, 0.) } else { (0., depth) };
            let tool = cylinder::create(key.clone(), Spec { bottom: [*x, *y, lo], top: [*x, *y, hi], radius: *r })?;
            let tool = cylinder::audit(&tool.check().map_err(|_| no("cylinder-contract"))?)?;
            cylinder::transform(&tool, frame)?
        }
    };
    analytic::audit(&body.check().map_err(|_| no("operand-contract"))?)
}

/// The prism of region `region`: the intersection of the cycles it lies inside
/// minus the cycles bounding it from outside. Cycles that do not touch the
/// region's boundary cannot change which component of that set it is.
pub fn extrude(
    key: BodyKey,
    frame: Affine,
    lines: &[[f64; 4]],
    arcs: &[[f64; 6]],
    circles: &[[f64; 3]],
    depth: f64,
    reverse: bool,
    region: usize,
) -> R<Body> {
    if !depth.is_finite() || depth <= 0. {
        return Err(no("depth"));
    }
    let sketch = match Sketch::new(lines, arcs, circles) {
        Ok(sketch) => sketch,
        Err(e) if e.0 == "sketch-regions/not-closed-chains" => {
            return arc_profile::build_sketch_region(key, frame, lines, arcs, circles, depth, reverse, region);
        }
        Err(e) => return Err(e),
    };
    let arr = sketch.arrange()?;
    let order = order(&arr);
    let cell = *order.get(region).ok_or_else(|| no("region-index"))?;
    let cell = &arr.cells[cell];
    let mut touching = cell
        .cycles
        .iter()
        .flatten()
        .flat_map(|&h| arr.pieces[h / 2].owners.iter().map(|o| o.0))
        .collect::<Vec<_>>();
    touching.sort();
    touching.dedup();
    let mut ins = touching.iter().copied().filter(|&c| cell.inside[c]).collect::<Vec<_>>();
    let outs = touching.iter().copied().filter(|&c| !cell.inside[c]).collect::<Vec<_>>();
    if ins.is_empty() {
        // A bounded gap between cycles it is outside of, which itself lies inside
        // some cycle that does not touch it (a cycle it lies within).
        ins = (0..sketch.cycles.len()).filter(|&c| cell.inside[c]).collect();
    }
    if ins.is_empty() {
        return Err(no("uncovered-cell"));
    }
    let solid = |c: usize| operand(&key, frame, &sketch.sources[c], depth, reverse);
    let mut target = solid(ins[0])?;
    if ins.len() > 1 {
        let all = ins.iter().map(|&c| solid(c)).collect::<R<Vec<_>>>()?;
        let body = single(combine(&key, 2, &all)?)?;
        if outs.is_empty() {
            return Ok(body);
        }
        target = analytic::audit(&body.check().map_err(|_| no("region-contract"))?)?;
    }
    if outs.is_empty() {
        return operand_body(&target);
    }
    let mut all = vec![target];
    for &c in &outs {
        all.push(solid(c)?);
    }
    single(combine(&key, 1, &all)?)
}
/// The kernel's Boolean, which puts the operands into the family that owns
/// them (a prism with round bores, a lens, ...); what no family owns is the
/// prism-stack arrangement, whose refusal stands when it cannot decide either.
fn combine(key: &BodyKey, op: u8, solids: &[Solid]) -> R<Vec<Body>> {
    analytic::boolean(key.clone(), op, solids).or_else(|_| prism_stack::boolean(key.clone(), op, solids))
}
fn single(mut bodies: Vec<Body>) -> R<Body> {
    if bodies.len() != 1 {
        return Err(no("multiple-result-bodies"));
    }
    Ok(bodies.remove(0))
}
/// The body a supported operand solid was audited from. Chains audit as planar
/// (straight or arc) prisms and circles as cylinders; any other family is not
/// an operand of this grammar and refuses by name instead of panicking.
fn operand_body(solid: &Solid) -> R<Body> {
    match solid {
        Solid::Planar(a) | Solid::Model(a, _) => Ok(a.body.clone()),
        Solid::Cylinder(c) => Ok(c.body.clone()),
        Solid::PrismStack(p) => Ok(p.body.clone()),
        Solid::Columns(_)
        | Solid::PrismHoles(_)
        | Solid::Revolved(_)
        | Solid::Placed(_)
        | Solid::Conical(_)
        | Solid::Coaxial(_)
        | Solid::Bicylinder(_)
        | Solid::CylinderTee(_)
        | Solid::Spherical(_)
        | Solid::Axial(_)
        | Solid::Lens(_)
        | Solid::Perforated(_)
        | Solid::PerforatedChamfer(_) => Err(no("operand-family")),
    }
}

/// The arrangement of a sketch and its regions' order: region `i` is cell
/// `order[i]` (`regions` and `extrude` number the regions the same way).
pub(crate) fn arranged(lines: &[[f64; 4]], arcs: &[[f64; 6]], circles: &[[f64; 3]]) -> R<(wc::Arrangement, Vec<usize>)> {
    let arr = match Sketch::new(lines, arcs, circles) {
        Ok(sketch) => sketch.arrange()?,
        Err(e) if e.0 == "sketch-regions/not-closed-chains" => split_arrangement(lines, arcs, circles)?,
        Err(e) => return Err(e),
    };
    let order = order(&arr);
    Ok((arr, order))
}

/// Open source pieces may split closed boundaries. Retain every exact bounded
/// cell; reject disconnected open components rather than hiding their source.
fn split_arrangement(lines: &[[f64; 4]], arcs: &[[f64; 6]], circles: &[[f64; 3]]) -> R<wc::Arrangement> {
    if lines.len() + arcs.len() + circles.len() > BUDGET.segments { return Err(wc::Refusal::ArrangementBudget.into()); }
    if !circles.iter().flatten().all(|x| x.is_finite()) { return Err(no("nonfinite-source")); }
    let pieces = regularize::sources(lines, arcs)?;
    if pieces.iter().any(|p| p.ends()[0] == p.ends()[1]) { return Err(no("zero-edge")); }
    let mut sets = pieces.into_iter().map(|s| vec![s]).collect::<Vec<_>>();
    for &[x,y,r] in circles {
        if !r.is_finite() || r <= 0. { return Err(no("circle-radius")); }
        sets.push(prism_stack::ring_profile([x,y], r)?.pieces().to_vec());
    }
    let refs = sets.iter().map(Vec::as_slice).collect::<Vec<_>>();
    let arr = wc::arrange_sketch(&refs, BUDGET)?;
    if arr.cells.is_empty() { return Err(no("not-closed-chains")); }
    // A regular cut shares edges between bounded cells. Vertex-only contacts
    // instead give the exterior boundary more than two incident edges: a
    // pinch, not a newly admitted branching sketch. Interior multi-way cuts
    // contribute no exterior edges and remain supported.
    let mut exterior_degree = vec![0; arr.points.len()];
    for (e, piece) in arr.pieces.iter().enumerate() {
        if (arr.face[2*e] == wc::UNBOUNDED) != (arr.face[2*e+1] == wc::UNBOUNDED) {
            for &v in &piece.v { exterior_degree[v] += 1; }
        }
    }
    if exterior_degree.iter().any(|&degree| degree > 2) { return Err(no("vertex-touching-cells")); }
    // Every source component must meet a retained boundary. A dangling tail
    // attached to one is legitimate; an unrelated open wire is not admitted.
    let mut parent = (0..sets.len()).collect::<Vec<_>>();
    for i in 0..sets.len() {
        for j in i+1..sets.len() {
            let a = &sets[i][0];
            let b = &sets[j][0];
            if if a.coincident_with(b)? {
                a.ends().iter().map(|p| b.contains(p)).collect::<Result<Vec<_>,_>>()?.into_iter().any(|x| x) || b.ends().iter().map(|p| a.contains(p)).collect::<Result<Vec<_>,_>>()?.into_iter().any(|x| x)
            } else { !a.contacts(b)?.is_empty() } {
                let (x,y) = (prism_stack::find(&mut parent,i), prism_stack::find(&mut parent,j));
                parent[x] = y;
            }
        }
    }
    let mut kept = vec![false; sets.len()];
    for p in &arr.pieces {
        for o in &p.owners { kept[prism_stack::find(&mut parent,o.0)] = true; }
    }
    for i in 0..sets.len() {
        if !kept[prism_stack::find(&mut parent,i)] { return Err(no("not-closed-chains")); }
    }
    Ok(arr)
}

/// Replayed from original sketch inputs, never from rounded intersection caches.
pub(crate) fn split_profile(lines: &[[f64; 4]], arcs: &[[f64; 6]], circles: &[[f64; 3]], region: usize) -> R<Profile> {
    let arr = split_arrangement(lines, arcs, circles)?;
    let order = order(&arr);
    let cell = &arr.cells[*order.get(region).ok_or_else(|| no("region-index"))?];
    if cell.cycles.len() != 1 { return Err(no("split-cell-holes")); }
    let cycle = arr.cycle_profile(&cell.cycles[0]);
    Ok(Profile::from_pieces(cycle.pieces().to_vec()))
}
