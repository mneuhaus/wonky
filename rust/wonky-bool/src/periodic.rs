//! P5/P8 for A1 revolution bands, dark until G12. Latitude rings and
//! generators are arranged by wonky-curve in two rational half-angle charts.
//! Only virtual seam intervals are stitched; no distance decides identity.
//! This module does not route conics or emit a Model/STEP/mesh.
use num_traits::{One, Zero};
use std::collections::{BTreeMap, BTreeSet};
use wonky_curve::radical::{self, Radical};
use wonky_curve::{
    arrange_pieces_exact, Arrangement, Budget, Carrier, ExactPoint, Trimmed, UNBOUNDED,
};
use wonky_geom::{model::curved::Patch, Refused, Result, Q};

fn q(n: i64) -> Q {
    Q::from_integer(n.into())
}
fn fail(check: &'static str) -> Refused {
    Refused(check)
}
fn point(x: Radical, y: Radical) -> Result<ExactPoint> {
    ExactPoint::from_coordinates([x, y]).map_err(|r| Refused(r.name()))
}
fn line(a: ExactPoint, b: ExactPoint) -> Result<Trimmed> {
    Trimmed::new([a, b], Carrier::Line).map_err(|r| Refused(r.name()))
}

/// One location on the carrier, independent of virtual seams and chart choice.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Point {
    pub direction: [Radical; 2],
    pub height: Radical,
}
/// Identity of a real trim/section. Duplicate cuts retain one identity after
/// exact equality; rings 0 and 1 are the lower and upper old boundary.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Source {
    Ring(usize),
    Generator(usize),
}

/// Rational rotation of the two-patch atlas. Its boundaries are the antipodal
/// directions perpendicular to `axis`. It is not a rotation of geometry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Seam {
    pub axis: [Q; 2],
}
impl Seam {
    fn choose(forbidden: &[[Radical; 2]], budget: usize) -> Result<Self> {
        if cfg!(feature = "plant_periodic_fixed_seam") {
            return Ok(Self { axis: [q(1), q(0)] });
        }
        for i in 0..budget {
            let t = Q::new(i.into(), (i + 1).into());
            let den = Q::one() + &t * &t;
            let axis = [(Q::one() - &t * &t) / &den, q(2) * t / den];
            if forbidden
                .iter()
                .all(|d| !(&d[0] * &axis[0] + &d[1] * &axis[1]).is_zero())
            {
                return Ok(Self { axis });
            }
        }
        Err(fail("boolean/budget-exceeded:periodic-seam"))
    }
    fn chart(&self, direction: &[Radical; 2]) -> (usize, Radical) {
        let x = &direction[0] * &self.axis[0] + &direction[1] * &self.axis[1];
        let y = &direction[1] * &self.axis[0] - &direction[0] * &self.axis[1];
        let p = usize::from(x < Radical::default());
        let sign = if p == 0 { q(1) } else { q(-1) };
        let t = &y / &(&x + Radical::from(sign));
        (p, t)
    }
    fn physical(&self, uv: &ExactPoint, patch: usize) -> Point {
        let [t, h] = uv.coordinates();
        let den = Radical::from(q(1)) + &t * &t;
        let sign = if patch == 0 { q(1) } else { q(-1) };
        let x = &((Radical::from(q(1)) - &t * &t) * &sign) / &den;
        let y = &(&t * q(2) * sign) / &den;
        Point {
            direction: [
                &x * &self.axis[0] - &y * &self.axis[1],
                &x * &self.axis[1] + &y * &self.axis[0],
            ],
            height: h,
        }
    }
}

#[derive(Clone, Debug)]
pub struct ChartPiece {
    pub patch: Patch,
    pub piece: Trimmed,
}
/// A stitched real coedge. A ring has no B-rep endpoints; its chart pieces
/// still have parametrization anchors. `ends` are only genuine vertices.
#[derive(Clone, Debug)]
pub struct Coedge {
    pub source: Source,
    pub ends: Option<[Point; 2]>,
    pub pieces: Vec<ChartPiece>,
    pub winding_delta: i32,
}
#[derive(Clone, Debug)]
pub struct Cell {
    pub chart_cells: Vec<(usize, usize)>,
    /// One strict witness for every chart fragment, retained for P6's check.
    pub witnesses: Vec<Point>,
    pub loops: Vec<Vec<Coedge>>,
}
#[derive(Clone, Debug)]
pub struct Split {
    pub seam: Seam,
    pub charts: [Arrangement; 2],
    pub cells: Vec<Cell>,
    pub rings: Vec<Radical>,
    pub generators: Vec<[Radical; 2]>,
    sources: [Vec<Option<Source>>; 2],
}

/// Split a latitude-bounded cylinder/cone face by already admitted A1 cuts.
/// Heights and directions are own-frame exact data. The caller must establish
/// curve-on-carrier identity in P4; this routine never changes the geometry.
/// `vertices` includes every pre-existing vertex so the seam avoids them too.
/// Cuts coincident with a trim or another cut are deduplicated exactly.
pub fn split_band(
    lo: Radical,
    hi: Radical,
    rings: &[Radical],
    generators: &[[Radical; 2]],
    vertices: &[[Radical; 2]],
    budget: Budget,
) -> Result<Split> {
    radical::guard(|| split_exact(lo, hi, rings, generators, vertices, budget))
        .map_err(|_| fail("boolean/budget-exceeded:periodic-arithmetic"))?
}
fn split_exact(
    lo: Radical,
    hi: Radical,
    rings: &[Radical],
    generators: &[[Radical; 2]],
    vertices: &[[Radical; 2]],
    budget: Budget,
) -> Result<Split> {
    if lo >= hi {
        return Err(fail("boolean/contract-violation:periodic/band"));
    }
    for d in generators.iter().chain(vertices) {
        if &d[0] * &d[0] + &d[1] * &d[1] != Radical::from(q(1)) {
            return Err(fail("boolean/contract-violation:periodic/unit-direction"));
        }
    }
    if rings.len() + generators.len() + vertices.len() > budget.segments {
        return Err(fail("boolean/budget-exceeded:periodic-pieces"));
    }
    let forbidden: Vec<_> = generators.iter().chain(vertices).cloned().collect();
    // At most one antipodal forbidden pair eliminates one rational proposal.
    let seam = Seam::choose(&forbidden, forbidden.len() + 1)?;
    let mut heights = vec![lo.clone(), hi.clone()];
    for h in rings {
        if h < &lo || h > &hi {
            return Err(fail("boolean/contract-violation:periodic/ring-range"));
        }
        if !heights.contains(h) {
            heights.push(h.clone());
        }
    }
    let mut directions: Vec<_> = generators.to_vec();
    directions.sort();
    directions.dedup();
    let mut charts = vec![];
    let mut sources = vec![];
    for p in 0..2 {
        let a = point(q(-1).into(), lo.clone())?;
        let b = point(q(1).into(), lo.clone())?;
        let c = point(q(1).into(), hi.clone())?;
        let d = point(q(-1).into(), hi.clone())?;
        let mut pieces = vec![
            line(a.clone(), b.clone())?,
            line(b, c.clone())?,
            line(c, d.clone())?,
            line(d, a)?,
        ];
        let mut ids = vec![Some(Source::Ring(0)), None, Some(Source::Ring(1)), None];
        for (i, h) in heights.iter().enumerate().skip(2) {
            pieces.push(line(
                point(q(-1).into(), h.clone())?,
                point(q(1).into(), h.clone())?,
            )?);
            ids.push(Some(Source::Ring(i)));
        }
        for (i, g) in directions.iter().enumerate() {
            let (patch, t) = seam.chart(g);
            if patch != p {
                continue;
            }
            pieces.push(line(point(t.clone(), lo.clone())?, point(t, hi.clone())?)?);
            ids.push(Some(Source::Generator(i)));
        }
        let chart = arrange_pieces_exact(&[&pieces], budget).map_err(|r| Refused(r.name()))?;
        // Strict witness and cycle orientation are checked by the common engine.
        for (i, cell) in chart.cells.iter().enumerate() {
            let w = chart
                .witness_exact(i, &[], &[])
                .map_err(|r| Refused(r.name()))?;
            let outer = chart.cycle_profile(&cell.cycles[0]);
            if !outer.contains(&w).map_err(|r| Refused(r.name()))?
                || !outer.orientation().map_err(|r| Refused(r.name()))?
            {
                return Err(fail("boolean/contract-violation:periodic/witness"));
            }
        }
        charts.push(chart);
        sources.push(ids);
    }
    let charts: [Arrangement; 2] = charts.try_into().unwrap();
    stitch(seam, charts, sources, heights, directions)
}

fn root(parent: &mut [usize], mut i: usize) -> usize {
    while parent[i] != i {
        parent[i] = parent[parent[i]];
        i = parent[i];
    }
    i
}
#[derive(Clone)]
struct Arc {
    source: Source,
    from: Point,
    to: Point,
    chart: ChartPiece,
    halfedge: (usize, usize),
}
fn stitch(
    seam: Seam,
    charts: [Arrangement; 2],
    sources: Vec<Vec<Option<Source>>>,
    rings: Vec<Radical>,
    generators: Vec<[Radical; 2]>,
) -> Result<Split> {
    let offset = charts[0].cells.len();
    let mut parent: Vec<_> = (0..offset + charts[1].cells.len()).collect();
    let mut seams: BTreeMap<(Point, Point), Vec<usize>> = BTreeMap::new();
    let mut seam_edges: BTreeMap<(Point, Point), Vec<(usize, usize)>> = BTreeMap::new();
    let mut next = BTreeMap::new();
    for (p, chart) in charts.iter().enumerate() {
        for cell in &chart.cells {
            for cycle in &cell.cycles {
                for (i, &h) in cycle.iter().enumerate() {
                    next.insert((p, h), (p, cycle[(i + 1) % cycle.len()]));
                }
            }
        }
    }
    for (p, chart) in charts.iter().enumerate() {
        for (i, piece) in chart.pieces.iter().enumerate() {
            if sources[p][piece.owners[0].1].is_some() {
                continue;
            }
            let mut ends = piece.seg.ends().clone().map(|uv| seam.physical(&uv, p));
            ends.sort();
            let f = chart.face[2 * i..2 * i + 2]
                .iter()
                .copied()
                .find(|f| *f != UNBOUNDED)
                .ok_or(fail("boolean/contract-violation:periodic/seam-cell"))?;
            let key = (ends[0].clone(), ends[1].clone());
            let h = if chart.face[2 * i] != UNBOUNDED {
                2 * i
            } else {
                2 * i + 1
            };
            seam_edges.entry(key.clone()).or_default().push((p, h));
            seams
                .entry(key)
                .or_default()
                .push(f + if p == 0 { 0 } else { offset });
        }
    }
    for twins in seams.values() {
        if twins.len() != 2 {
            return Err(fail("boolean/contract-violation:periodic/seam-twin"));
        }
        let a = root(&mut parent, twins[0]);
        let b = root(&mut parent, twins[1]);
        parent[b] = a;
    }
    let mut twins = BTreeMap::new();
    for pair in seam_edges.values() {
        if pair.len() != 2 {
            return Err(fail("boolean/contract-violation:periodic/seam-twin"));
        }
        twins.insert(pair[0], pair[1]);
        twins.insert(pair[1], pair[0]);
    }
    // Planted defect: weld thin ring-separated cells. It is deliberately a
    // wrong identity rule, kept behind a test-only feature.
    if cfg!(feature = "plant_periodic_weld") {
        let tolerance = Radical::from(Q::new(1.into(), 1_000_000_000.into()));
        if rings
            .iter()
            .enumerate()
            .any(|(i, a)| rings.iter().skip(i + 1).any(|b| (a - b).abs() < tolerance))
        {
            for i in 1..parent.len() {
                let r = root(&mut parent, i);
                parent[r] = root(&mut parent, 0);
            }
        }
    }
    let mut members: BTreeMap<usize, Vec<(usize, usize)>> = BTreeMap::new();
    for (p, chart) in charts.iter().enumerate() {
        for c in 0..chart.cells.len() {
            let r = root(&mut parent, c + if p == 0 { 0 } else { offset });
            members.entry(r).or_default().push((p, c));
        }
    }
    let mut cells = vec![];
    for chart_cells in members.into_values() {
        let mut witnesses = vec![];
        let mut arcs = vec![];
        for &(p, c) in &chart_cells {
            let chart = &charts[p];
            let w = chart
                .witness_exact(c, &[], &[])
                .map_err(|r| Refused(r.name()))?;
            witnesses.push(seam.physical(&w, p));
            for cycle in &chart.cells[c].cycles {
                for &h in cycle {
                    let piece = &chart.pieces[h / 2];
                    if let Some(source) = sources[p][piece.owners[0].1] {
                        let trim = chart.oriented(h);
                        arcs.push(Arc {
                            source,
                            from: seam.physical(&trim.ends()[0], p),
                            to: seam.physical(&trim.ends()[1], p),
                            chart: ChartPiece {
                                patch: if p == 0 { Patch::First } else { Patch::Second },
                                piece: trim,
                            },
                            halfedge: (p, h),
                        });
                    }
                }
            }
        }
        let loops = walk(arcs, &next, &twins)?;
        cells.push(Cell {
            chart_cells,
            witnesses,
            loops,
        });
    }
    Ok(Split {
        seam,
        charts,
        cells,
        rings,
        generators,
        sources: sources.try_into().unwrap(),
    })
}
fn walk(
    arcs: Vec<Arc>,
    next: &BTreeMap<(usize, usize), (usize, usize)>,
    twins: &BTreeMap<(usize, usize), (usize, usize)>,
) -> Result<Vec<Vec<Coedge>>> {
    let arc_ids: BTreeMap<_, _> = arcs
        .iter()
        .enumerate()
        .map(|(i, a)| (a.halfedge, i))
        .collect();
    let mut unused: BTreeSet<usize> = (0..arcs.len()).collect();
    let mut loops = vec![];
    while let Some(&first) = unused.first() {
        let mut indices = vec![];
        let mut current = first;
        loop {
            if !unused.remove(&current) {
                return Err(fail("boolean/contract-violation:periodic/cycle"));
            }
            indices.push(current);
            let mut successor = *next
                .get(&arcs[current].halfedge)
                .ok_or(fail("boolean/contract-violation:periodic/successor"))?;
            let mut crossed = BTreeSet::new();
            while let Some(twin) = twins.get(&successor) {
                if !crossed.insert(successor) {
                    return Err(fail("boolean/contract-violation:periodic/seam-cycle"));
                }
                successor = *next
                    .get(twin)
                    .ok_or(fail("boolean/contract-violation:periodic/successor"))?;
            }
            current = *arc_ids
                .get(&successor)
                .ok_or(fail("boolean/contract-violation:periodic/vertex-link"))?;
            if current == first {
                break;
            }
        }
        // Start at a true curve change, so degree-two seam points disappear.
        if let Some(i) = (0..indices.len()).find(|&i| {
            arcs[indices[i]].source != arcs[indices[(i + indices.len() - 1) % indices.len()]].source
        }) {
            indices.rotate_left(i);
        }
        let mut coedges: Vec<Coedge> = vec![];
        let mut starts = vec![];
        let mut ends = vec![];
        for i in indices {
            let a = &arcs[i];
            if coedges.last().is_some_and(|c| c.source == a.source) {
                coedges.last_mut().unwrap().pieces.push(a.chart.clone());
                *ends.last_mut().unwrap() = a.to.clone();
            } else {
                coedges.push(Coedge {
                    source: a.source,
                    ends: None,
                    pieces: vec![a.chart.clone()],
                    winding_delta: 0,
                });
                starts.push(a.from.clone());
                ends.push(a.to.clone());
            }
        }
        let ring = coedges.len() == 1 && matches!(coedges[0].source, Source::Ring(_));
        for ((co, a), b) in coedges.iter_mut().zip(starts).zip(ends) {
            co.ends = if ring && a == b { None } else { Some([a, b]) };
            for pair in co.pieces.windows(2) {
                if pair[0].patch != pair[1].patch {
                    let t = pair[0].piece.ends()[1].coordinates()[0].clone();
                    co.winding_delta += match pair[0].patch {
                        Patch::First => {
                            if t < Radical::default() {
                                -1
                            } else {
                                0
                            }
                        }
                        Patch::Second => {
                            if t > Radical::default() {
                                1
                            } else {
                                0
                            }
                        }
                    };
                }
            }
            if co.ends.is_none() {
                let first = co.pieces.first().unwrap();
                let last = co.pieces.last().unwrap();
                if first.patch != last.patch {
                    let t = last.piece.ends()[1].coordinates()[0].clone();
                    co.winding_delta += match last.patch {
                        Patch::First => {
                            if t < Radical::default() {
                                -1
                            } else {
                                0
                            }
                        }
                        Patch::Second => {
                            if t > Radical::default() {
                                1
                            } else {
                                0
                            }
                        }
                    };
                }
            }
        }
        loops.push(coedges);
    }
    Ok(loops)
}

fn mapped(frame: &wonky_geom::frame::Frame, p: &[Radical; 3]) -> [Radical; 3] {
    std::array::from_fn(|i| {
        (0..3).fold(Radical::from(frame.origin()[i].clone()), |v, k| {
            v + &p[k] * &frame.columns()[k][i]
        })
    })
}
fn vector(frame: &wonky_geom::frame::Frame, p: &[Radical; 3]) -> [Radical; 3] {
    std::array::from_fn(|i| {
        (0..3).fold(Radical::default(), |v, k| {
            v + &p[k] * &frame.columns()[k][i]
        })
    })
}

/// Split one periodic face against every live carrier of another checked
/// operand. SSI is decided in this Model's construction frame, including exact
/// affine placement. Carrier sections may over-partition outside the other
/// face's trim; classification and merge remove those redundant cuts. No
/// unproved cut is omitted and no family dispatch is involved.
pub fn split_against(
    model: &wonky_geom::model::Model,
    face: wonky_geom::model::FaceId,
    other: &wonky_geom::model::Model,
    budget: Budget,
    limits: wonky_alg::Limits,
) -> Result<Split> {
    use wonky_geom::{frame::Frame, model::Carrier3};
    model
        .revolution_band(face)?
        .ok_or(fail("boolean/ssi-row-unavailable:plane/periodic-split"))?;
    let own = &model.draft().surfaces[model.draft().faces[face.index()].surface.index()].carrier;
    let map = model
        .draft()
        .placement
        .relation_from(&other.draft().placement)
        .map;
    let image_frame = |frame: &Frame| {
        Frame::new(
            map.point(frame.origin()),
            frame.columns().clone().map(|v| map.vector(&v)),
        )
    };
    let mut live = BTreeSet::new();
    for solid in &other.draft().solids {
        for shell in &solid.shells {
            for &f in &other.draft().shells[shell.index()].faces {
                live.insert(other.draft().faces[f.index()].surface);
            }
        }
    }
    if live.len() > budget.segments {
        return Err(fail("boolean/budget-exceeded:periodic-carriers"));
    }
    let mut sections = vec![];
    for surface in live {
        let carrier = match &other.draft().surfaces[surface.index()].carrier {
            Carrier3::Rotated(_) => return Err(Refused("boolean/ssi-row-unavailable:rotated/periodic")),
            Carrier3::Plane(p) => Carrier3::Plane(wonky_geom::model::Plane3 {
                o: map.point(&p.o),
                x: map.vector(&p.x),
                n: crate::operand::normal_image(&map.inverse(), &p.n),
            }),
            Carrier3::Cylinder(c) => {
                Carrier3::Cylinder(wonky_geom::model::Cylinder3::new(image_frame(c.frame()?)?, c.radius2())?)
            }
            Carrier3::Cone(c) => {
                let mut c = c.clone();
                c.frame = image_frame(&c.frame)?;
                Carrier3::Cone(c)
            }
            Carrier3::TranslatedCylinder(_) => return Err(fail("boolean/ssi-row-unavailable:translated-cylinder/periodic")),
            Carrier3::RadicalPlane(_) => return Err(fail("model/radical-plane/rational-implicit")),
            Carrier3::Sphere(_) => return Err(fail("boolean/ssi-row-unavailable:sphere/A1")),
            Carrier3::Torus(_) => return Err(fail("boolean/ssi-row-unavailable:torus×A1")),
        };
        match crate::a1::intersect(own, &carrier, limits)? {
            crate::a1::Intersection::Coincident => (),
            crate::a1::Intersection::Section { branches, .. } => sections.extend(branches),
        }
    }
    split_face(model, face, &sections, budget)
}

/// Consume checked G9 branches in a Model's own construction frame. The
/// adapter is by carrier class, not by family. Conics cannot reach it.
pub fn split_face(
    model: &wonky_geom::model::Model,
    face: wonky_geom::model::FaceId,
    sections: &[crate::a1::SectionBranch],
    budget: Budget,
) -> Result<Split> {
    radical::guard(|| {
        use crate::a1::Branch;
        let band = model
            .revolution_band(face)?
            .ok_or(fail("boolean/ssi-row-unavailable:plane/periodic-split"))?;
        let carrier =
            &model.draft().surfaces[model.draft().faces[face.index()].surface.index()].carrier;
        if (&band.radius[0] + &band.radius[1] * &band.lo).is_zero()
            || (&band.radius[0] + &band.radius[1] * &band.hi).is_zero()
        {
            // A collapsed latitude is a singular point, never a ring edge.
            // Until the quotient admits contracted sides, refuse explicitly.
            return Err(fail("boolean/chart-singularity:apex"));
        }
        let inverse = band.frame.inverse();
        let mut rings = vec![];
        let mut generators = vec![];
        for section in sections {
            if !section.curve.lies_on(carrier)? {
                return Err(fail("boolean/contract-violation:periodic/section-identity"));
            }
            match &section.curve {
                Branch::Circle { frame, height, .. } => {
                    let center = mapped(
                        &inverse,
                        &mapped(
                            frame,
                            &[Radical::default(), Radical::default(), height.clone()],
                        ),
                    );
                    let axes = band.frame.relation_from(frame).map;
                    if !center[0].is_zero()
                        || !center[1].is_zero()
                        || !axes.columns()[0][2].is_zero()
                        || !axes.columns()[1][2].is_zero()
                    {
                        return Err(fail(
                            "boolean/ssi-row-unavailable:circle/non-latitude-chart",
                        ));
                    }
                    if center[2] >= Radical::from(band.lo.clone())
                        && center[2] <= Radical::from(band.hi.clone())
                    {
                        rings.push(center[2].clone());
                    }
                }
                Branch::Line { p, d } => {
                    let p = mapped(&inverse, p);
                    let d = vector(&inverse, d);
                    if d[2].is_zero() {
                        return Err(fail("boolean/ssi-row-unavailable:line/non-generator-chart"));
                    }
                    let h = (&band.lo + &band.hi) / q(2);
                    let r = &band.radius[0] + &band.radius[1] * &h;
                    if r.is_zero() {
                        return Err(fail("boolean/chart-singularity:apex"));
                    }
                    let t = &(Radical::from(h) - &p[2]) / &d[2];
                    generators.push(std::array::from_fn(|i| (&p[i] + &t * &d[i]) / r.clone()));
                }
                Branch::Point(_) => {
                    return Err(fail("boolean/ssi-row-unavailable:point/periodic-imprint"))
                }
            }
        }
        // Include the face's existing real vertices in seam exclusion.
        let mut vertices = vec![];
        for lp in &model.draft().faces[face.index()].loops {
            for co in &model.draft().loops[lp.index()].coedges {
                let edge = &model.draft().edges[model.draft().coedges[co.index()].edge.index()];
                match edge.bounds {
                    wonky_geom::model::Bounds::Ring => {}
                    wonky_geom::model::Bounds::Segment(ids) => {
                        for id in ids {
                            let p = match model.key(id) {
                                wonky_geom::model::VertexKey::Rational(p) => {
                                    p.clone().map(Radical::from)
                                }
                                wonky_geom::model::VertexKey::Quadratic(p) => {
                                    p.coordinates().clone()
                                }
                                wonky_geom::model::VertexKey::Real(p)=>p.clone(),
                            };
                            let p = mapped(&inverse, &p);
                            let r = Radical::from(band.radius[0].clone()) + &p[2] * &band.radius[1];
                            if r.is_zero() {
                                return Err(fail("boolean/chart-singularity:apex"));
                            }
                            vertices.push([&p[0] / &r, &p[1] / &r]);
                        }
                    }
                }
            }
        }
        split_band(
            band.lo.into(),
            band.hi.into(),
            &rings,
            &generators,
            &vertices,
            budget,
        )
    })
    .map_err(|_| fail("boolean/budget-exceeded:periodic-arithmetic"))?
}

/// P6 for the stitched cells. A primary exact ray seeds each component;
/// its class propagates across virtual seams. Every chart fragment gets a
/// second direct membership opinion with the opposite ray order. No local
/// class is guessed from an f64 normal or a bounding box.
pub fn classify(
    model: &wonky_geom::model::Model,
    face: wonky_geom::model::FaceId,
    split: &Split,
    other: &wonky_geom::model::Model,
) -> Result<Vec<crate::Class>> {
    radical::guard(|| {
        use wonky_geom::model::{Carrier3, Membership};
        let band = model
            .revolution_band(face)?
            .ok_or(fail("boolean/ssi-row-unavailable:plane/periodic-classify"))?;
        check_domain(split, &band)?;
        let own =
            &model.draft().surfaces[model.draft().faces[face.index()].surface.index()].carrier;
        let map = other
            .draft()
            .placement
            .relation_from(&model.draft().placement)
            .map;
        let class_at = |w: &Point, reverse: bool| -> Result<crate::Class> {
            let r = Radical::from(band.radius[0].clone()) + &w.height * &band.radius[1];
            let local = mapped(
                &band.frame,
                &[&w.direction[0] * &r, &w.direction[1] * &r, w.height.clone()],
            );
            let local: wonky_geom::Point = local
                .iter()
                .map(|x| {
                    x.rational().ok_or(fail(
                        "boolean/ssi-row-unavailable:quadratic/classification-witness",
                    ))
                })
                .collect::<Result<Vec<_>>>()?
                .try_into()
                .unwrap();
            let p = map.point(&local);
            Ok(match other.membership(&p, reverse)? {
                Membership::Inside => crate::Class::In,
                Membership::Outside => crate::Class::Out,
                Membership::Boundary(fi) => {
                    let opposite = &other.draft().surfaces
                        [other.draft().faces[fi.index()].surface.index()]
                    .carrier;
                    // Exhaustive carrier admission: spheres belong to G14.
                    match opposite {
                        Carrier3::TranslatedCylinder(_) => return Err(fail("boolean/ssi-row-unavailable:translated-cylinder/periodic")),
                        Carrier3::Rotated(_) => return Err(Refused("boolean/ssi-row-unavailable:rotated/periodic")),
                        Carrier3::RadicalPlane(_) => return Err(fail("model/radical-plane/rational-implicit")),
                        Carrier3::Plane(_) | Carrier3::Cylinder(_) | Carrier3::Cone(_) => {}
                        Carrier3::Sphere(_) => {
                            return Err(fail(
                                "boolean/ssi-row-unavailable:sphere/periodic-classify",
                            ))
                        }
                        Carrier3::Torus(_) => {
                            return Err(fail("boolean/ssi-row-unavailable:torus×periodic-classify"))
                        }
                    }
                    let gradient = |c: &Carrier3, p: &wonky_geom::Point| -> Result<wonky_geom::Point> {
                        let implicit = c.implicit()?;
                        Ok(std::array::from_fn(|i| {
                            let mut a = p.clone();
                            let mut b = p.clone();
                            a[i] += q(1);
                            b[i] -= q(1);
                            (implicit.evaluate(&a) - implicit.evaluate(&b)) / q(2)
                        }))
                    };
                    let n = gradient(own, &local)?;
                    let n = crate::operand::normal_image(&map.inverse(), &n);
                    let m = gradient(opposite, &p)?;
                    let alignment = wonky_geom::dot(&n, &m);
                    if alignment.is_zero() {
                        return Err(fail("boolean/contract-violation:classify/on-normal"));
                    }
                    let same = (alignment > q(0))
                        == (model.draft().faces[face.index()].forward
                            == other.draft().faces[fi.index()].forward);
                    if same {
                        crate::Class::OnSame
                    } else {
                        crate::Class::OnOpposite
                    }
                }
            })
        };
        let mut classes = vec![];
        for cell in &split.cells {
            let first = cell
                .witnesses
                .first()
                .ok_or(fail("boolean/contract-violation:classify/missing-witness"))?;
            let mut class = class_at(first, false)?;
            if cfg!(feature = "plant_periodic_classify_flip") {
                class = match class {
                    crate::Class::In => crate::Class::Out,
                    crate::Class::Out => crate::Class::In,
                    crate::Class::OnSame => crate::Class::OnOpposite,
                    crate::Class::OnOpposite => crate::Class::OnSame,
                };
            }
            for w in &cell.witnesses {
                if class_at(w, true)? != class {
                    return Err(fail("boolean/contract-violation:classify/second-opinion"));
                }
            }
            classes.push(class);
        }
        Ok(classes)
    })
    .map_err(|_| fail("boolean/budget-exceeded:classification-arithmetic"))?
}

/// Green integral in (angle,height), with exact π terms when a cell spans
/// full turns, otherwise a certified angular enclosure. An enclosure is a
/// measure only; topology never reads it.
#[derive(Clone, Debug)]
pub struct Measure {
    pub exact: Option<wonky_geom::model::PiValue>,
    pub enclosure: wonky_num::Iv,
}
fn green(
    split: &Split,
    primitive: impl Fn(&Radical) -> Radical,
    factor: Q,
) -> Result<Vec<Measure>> {
    use wonky_num::Iv;
    let enclosure = |v: &wonky_geom::model::PiValue| -> Result<Iv> {
        let v = v.without_pi2().map_err(|e| Refused(e.0))?;
        let r = wonky_curve::numeric::enclose(&v.rational).map_err(|r| Refused(r.name()))?;
        let p = wonky_curve::numeric::enclose(&v.pi).map_err(|r| Refused(r.name()))?;
        wonky_curve::numeric::finite(r + p * wonky_curve::pi()).map_err(|r| Refused(r.name()))
    };
    let mut out = vec![];
    for cell in &split.cells {
        let mut exact = Some(wonky_geom::model::PiValue::default());
        let mut bounded = Iv::point(0.);
        for co in cell.loops.iter().flatten() {
            let h = match co.source {
                Source::Ring(i) => &split.rings[i],
                Source::Generator(_) => continue,
            };
            let weight = primitive(h) * &factor;
            if co.ends.is_none() {
                match weight.rational() {
                    Some(w) => {
                        let term = wonky_geom::model::PiValue {
                            rational: q(0),
                            pi: -q(2) * w * q(co.winding_delta as i64),
                            pi2: q(0),
                        };
                        bounded = bounded + enclosure(&term)?;
                        if let Some(e) = &mut exact {
                            e.pi += term.pi;
                        }
                    }
                    None => {
                        exact = None;
                        bounded = bounded
                            - weight.enclosure().map_err(|r| Refused(r.name()))?
                                * wonky_curve::pi()
                                * Iv::point(2. * co.winding_delta as f64);
                    }
                }
            } else {
                exact = None;
                for cp in &co.pieces {
                    let p = usize::from(cp.patch == Patch::Second);
                    let a = split.seam.physical(&cp.piece.ends()[0], p);
                    let b = split.seam.physical(&cp.piece.ends()[1], p);
                    let forward =
                        cp.piece.ends()[0].coordinates()[0] < cp.piece.ends()[1].coordinates()[0];
                    let (a, b) = if forward {
                        (&a.direction, &b.direction)
                    } else {
                        (&b.direction, &a.direction)
                    };
                    let angle = radical::positive_angle(&radical::dot(a, b), &radical::cross(a, b))
                        .map_err(|r| Refused(r.name()))?;
                    let signed = if forward { angle } else { -angle };
                    bounded = bounded - weight.enclosure().map_err(|r| Refused(r.name()))? * signed;
                }
            }
        }
        if let Some(v) = &exact {
            bounded = enclosure(v)?;
        }
        bounded = wonky_curve::numeric::finite(bounded).map_err(|r| Refused(r.name()))?;
        out.push(Measure {
            exact,
            enclosure: bounded,
        });
    }
    Ok(out)
}
/// Angular chart area ∫dθ dh, via -∮h dθ. This is not metric surface area.
pub fn angular_area(split: &Split) -> Result<Vec<Measure>> {
    radical::guard(|| green(split, Clone::clone, q(1)))
        .map_err(|_| fail("boolean/budget-exceeded:periodic-green"))?
}
/// Six-times-volume contribution of this face to the divergence integral.
/// Planar faces contribute separately through their existing Green mechanism.
/// Affine determinant and translation are exact, including non-isometric
/// construction frames. Partial angular bands receive certified enclosures.
pub fn volume6(
    model: &wonky_geom::model::Model,
    face: wonky_geom::model::FaceId,
    split: &Split,
) -> Result<Vec<Measure>> {
    radical::guard(|| {
        let band = model
            .revolution_band(face)?
            .ok_or(fail("boolean/ssi-row-unavailable:plane/periodic-green"))?;
        check_domain(split, &band)?;
        let det = wonky_geom::dot(
            &band.frame.columns()[0],
            &wonky_geom::cross(&band.frame.columns()[1], &band.frame.columns()[2]),
        );
        use num_traits::Signed;
        let det = det.abs();
        let oz = band.frame.inverse().vector(band.frame.origin())[2].clone();
        let [r, k] = band.radius;
        let factor = q(2) * &det * (&r - &k * oz) * if band.forward { q(1) } else { q(-1) };
        let mut measures = green(split, |h| h * &r + &(h * h) * (&k / q(2)), factor)?;
        // x . (x_theta cross x_h) also contains the transverse origin:
        // R(h) * (ox cos(theta) + oy sin(theta)). Full rings cancel it;
        // partial bands retain exact endpoint sine/cosine differences.
        let origin = band.frame.inverse().vector(band.frame.origin());
        let orientation = if band.forward { q(1) } else { q(-1) };
        for (cell, measure) in split.cells.iter().zip(&mut measures) {
            let mut correction = Radical::default();
            for co in cell.loops.iter().flatten() {
                let h = match co.source {
                    Source::Ring(i) => &split.rings[i],
                    Source::Generator(_) => continue,
                };
                if let Some([a, b]) = &co.ends {
                    let primitive = h * &r + &(h * h) * (&k / q(2));
                    correction = correction
                        - primitive
                            * ((&b.direction[1] - &a.direction[1]) * &origin[0]
                                + (&a.direction[0] - &b.direction[0]) * &origin[1]);
                }
            }
            correction = correction * (q(2) * &det * &orientation);
            if cfg!(feature = "plant_periodic_omit_translation") {
                correction = Radical::default();
            }
            measure.enclosure = wonky_curve::numeric::finite(
                measure.enclosure + correction.enclosure().map_err(|r| Refused(r.name()))?,
            )
            .map_err(|r| Refused(r.name()))?;
            if let Some(value) = &mut measure.exact {
                match correction.rational() {
                    Some(rational) => value.rational += rational,
                    None => measure.exact = None,
                }
            }
        }
        Ok(measures)
    })
    .map_err(|_| fail("boolean/budget-exceeded:periodic-green"))?
}

/// Sum the general chart Green contributions of every face of a checked
/// Model. This is a dark library observation, not an export or routing path.
/// Plane charts retain exact line areas/full-circle π coefficients; a
/// currently unavailable curved trim raises its capability error.
pub fn measure_model(
    model: &wonky_geom::model::Model,
    budget: Budget,
) -> Result<Vec<wonky_geom::model::PiValue>> {
    use wonky_geom::model::{Carrier3, PiValue};
    let d = model.draft();
    let mut values = vec![];
    for solid in &d.solids {
        let mut value = PiValue::default();
        for shell in &solid.shells {
            for &fi in &d.shells[shell.index()].faces {
                let f = &d.faces[fi.index()];
                match &d.surfaces[f.surface.index()].carrier {
                    Carrier3::TranslatedCylinder(_) => return Err(fail("boolean/ssi-row-unavailable:translated-cylinder/periodic")),
                    Carrier3::Rotated(_) => return Err(Refused("boolean/ssi-row-unavailable:rotated/periodic")),
                    Carrier3::Cylinder(_) | Carrier3::Cone(_) => {
                        let split = split_face(model, fi, &[], budget)?;
                        for measure in volume6(model, fi, &split)? {
                            let term = measure.exact.ok_or(fail(
                                "boolean/ssi-row-unavailable:periodic/non-pi-measure",
                            ))?;
                            value.rational += term.rational;
                            value.pi += term.pi;
                        }
                    }
                    Carrier3::Plane(plane) => {
                        let factor = q(2)
                            * wonky_geom::dot(&plane.o, &wonky_geom::cross(&plane.x, &plane.y()));
                        for lp in &f.loops {
                            let pieces: Vec<_> = d.loops[lp.index()]
                                .coedges
                                .iter()
                                .map(|co| d.coedges[co.index()].pcurve.clone())
                                .collect();
                            let cycle = wonky_curve::Cycle::new(pieces.clone());
                            if let Some(area) = cycle.area_exact().map_err(|r| Refused(r.name()))? {
                                value.rational += &factor * area;
                            } else if pieces.len() == 1 && pieces[0].is_ring() {
                                match pieces[0].carrier() {
                                    Carrier::Circle(c) => {
                                        value.pi +=
                                            &factor * c.r2.rational().ok_or(Refused("boolean/ssi-row-unavailable:circle/green-measure"))? * if c.ccw { q(1) } else { q(-1) }
                                    }
                                    Carrier::Line | Carrier::BSpline(_) => {
                                        return Err(fail(
                                            "boolean/ssi-row-unavailable:curve/green-measure",
                                        ))
                                    }
                                }
                            } else {
                                return Err(fail(
                                    "boolean/ssi-row-unavailable:circle/partial-volume",
                                ));
                            }
                        }
                    }
                    Carrier3::RadicalPlane(_) => {
                        return Err(fail("model/radical-plane/rational-consumer"))
                    }
                    Carrier3::Sphere(_) => value.pi += sphere_zone(d, fi)?.1,
                    Carrier3::Torus(_) => {
                        return Err(fail("boolean/ssi-row-unavailable:torus×periodic-green"))
                    }
                }
            }
        }
        if value.sign()? != std::cmp::Ordering::Greater {
            return Err(fail("boolean/contract-violation:measure/volume"));
        }
        values.push(value);
    }
    Ok(values)
}

/// G14: the metric area and six times the signed volume flux of one
/// ring-bounded sphere face, both as rational multiples of π. They come from
/// the face's own ring loops, not from the tube-band chart that
/// `Model::volume6_pi` integrates, so the shadow compares two derivations.
/// The face is the sphere (centre c, radius R) minus the caps beyond its
/// rings; a cap {a·(p − c) > h} with |a| = 1 has area 2πR(R − h) and normal
/// integral π(R² − h²)·a, and 6V = 2∫p·n dA = 2(c·∫n dA + R·A). A loop runs
/// counter-clockwise about the outward normal with the face on its left, so
/// the face lies on the +(x × y) side of a ring's frame exactly when the
/// coedge and face senses agree. Sphere patches (open trims), rings off Q
/// and frames that are not similarities refuse by name.
fn sphere_zone(d: &wonky_geom::model::Draft, fi: wonky_geom::model::FaceId) -> Result<(Q, Q)> {
    use num_traits::Signed;
    use wonky_geom::model::{Bounds, Carrier3, Curve3};
    use wonky_geom::{cross, dot};
    let f = &d.faces[fi.index()];
    let Carrier3::Sphere(sphere) = &d.surfaces[f.surface.index()].carrier else {
        return Err(fail("boolean/contract-violation:measure/sphere-carrier"));
    };
    let [x, y, z] = sphere.frame.columns();
    let k2 = dot(x, x);
    if dot(y, y) != k2 || dot(z, z) != k2 || !dot(x, y).is_zero() || !dot(x, z).is_zero() || !dot(y, z).is_zero() {
        return Err(fail("boolean/ssi-row-unavailable:sphere/non-similar-green"));
    }
    let k = wonky_curve::numeric::exact_root(&k2).ok_or(fail("boolean/ssi-row-unavailable:sphere/irrational-scale-green"))?;
    let r = sphere.radius() * &k;
    let r2 = &r * &r;
    let c = sphere.frame.origin();
    // Excluded caps (unit direction a, height h of the cutting plane over c).
    let mut caps: Vec<(wonky_geom::Point, Q)> = vec![];
    for l in &f.loops {
        let lp = &d.loops[l.index()];
        let [co] = lp.coedges[..] else {
            return Err(fail("boolean/ssi-row-unavailable:sphere/patch-green"));
        };
        let co = &d.coedges[co.index()];
        let e = &d.edges[co.edge.index()];
        if !matches!(e.bounds, Bounds::Ring) {
            return Err(fail("boolean/ssi-row-unavailable:sphere/patch-green"));
        }
        let (origin, columns) = match &d.curves[e.curve.index()].geometry {
            Curve3::Circle(k) => (k.origin(), k.columns().clone()),
            Curve3::RadicalCircle(k) => (k.center()?, k.frame.columns().clone()),
            Curve3::TranslatedCircle(_) => return Err(fail("boolean/ssi-row-unavailable:translated-circle/sphere-green")),
            Curve3::Line { .. } | Curve3::RadicalLine { .. } => return Err(fail("model/g4-ring-on-open-curve")),
        };
        let o: wonky_geom::Point = [origin[0].rational(), origin[1].rational(), origin[2].rational()]
            .into_iter()
            .collect::<Option<Vec<_>>>()
            .and_then(|v| v.try_into().ok())
            .ok_or(fail("boolean/ssi-row-unavailable:sphere/radical-ring-green"))?;
        let [cx, cy, _] = &columns;
        let m = dot(cx, cx);
        if dot(cy, cy) != m || !dot(cx, cy).is_zero() {
            return Err(fail("boolean/contract-violation:measure/sphere-ring-frame"));
        }
        // |x × y| = m for orthogonal x, y of equal length m^(1/2).
        let w = cross(cx, cy);
        let sign = if co.forward == f.forward { -Q::one() } else { Q::one() };
        let a: wonky_geom::Point = std::array::from_fn(|i| &w[i] * &sign / &m);
        let h = dot(&a, &std::array::from_fn(|i| &o[i] - &c[i]));
        if &h * &h >= r2 {
            return Err(fail("boolean/contract-violation:measure/sphere-ring-height"));
        }
        caps.push((a, h));
    }
    // The caps are disjoint: coaxial rings only, each pair facing apart.
    for (i, (a, h)) in caps.iter().enumerate() {
        for (b, g) in &caps[i + 1..] {
            if cross(a, b).iter().any(|v| !v.is_zero()) {
                return Err(fail("boolean/ssi-row-unavailable:sphere/oblique-rings-green"));
            }
            if dot(a, b).is_positive() || !(h + g).is_positive() {
                return Err(fail("boolean/contract-violation:measure/sphere-caps"));
            }
        }
    }
    let area = caps.iter().fold(q(4) * &r2, |v, (_, h)| v - q(2) * (&r2 - &r * h));
    let flux = caps.iter().fold(Q::zero(), |v, (a, h)| v - (&r2 - h * h) * dot(c, a));
    let orientation = if f.forward { q(2) } else { q(-2) };
    Ok((area.clone(), orientation * (flux + &r * area)))
}

/// Metric surface area of the emitted B-rep. Revolution faces use the
/// actual chart boundary's Green integral; planar faces use exact loop Green
/// area. The closed-frustum integral in Model::area_pi is a second route.
pub fn surface_area_model(
    model: &wonky_geom::model::Model,
    budget: Budget,
) -> Result<Vec<wonky_geom::model::PiValue>> {
    radical::guard(|| {
        use wonky_geom::model::PiValue;
        let d = model.draft();
        d.solids
            .iter()
            .map(|solid| {
                let mut area = PiValue::default();
                for shell in &solid.shells {
                    for &face in &d.shells[shell.index()].faces {
                        if matches!(d.surfaces[d.faces[face.index()].surface.index()].carrier, wonky_geom::model::Carrier3::Sphere(_)) {
                            area.pi += sphere_zone(d, face)?.0;
                        } else if let Some(band) = model.revolution_band(face)? {
                            let split = split_face(model, face, &[], budget)?;
                            let factor = band.area_factor()?;
                            for measure in green(
                                &split,
                                |h| h * &band.radius[0] + h * h * (&band.radius[1] / q(2)),
                                factor,
                            )? {
                                let value = measure.exact.ok_or(fail(
                                    "boolean/ssi-row-unavailable:periodic/non-pi-area",
                                ))?;
                                area.rational += value.rational;
                                area.pi += value.pi;
                            }
                        } else {
                            let value = model.planar_area_pi(face)?;
                            area.rational += value.rational;
                            area.pi += value.pi;
                        }
                    }
                }
                Ok(area)
            })
            .collect()
    })
    .map_err(|_| fail("boolean/budget-exceeded:periodic-green"))?
}

/// Exact same-carrier P8 merge after selection. All selected fragments have
/// this face's carrier and orientation. Shared real subedges are removed by
/// their arrangement identity, never by proximity. Gaps stay unselected gaps.
pub fn merge(split: &Split, keep: &[bool]) -> Result<Vec<Cell>> {
    radical::guard(|| merge_exact(split, keep))
        .map_err(|_| fail("boolean/budget-exceeded:periodic-merge"))?
}
fn merge_exact(split: &Split, keep: &[bool]) -> Result<Vec<Cell>> {
    if keep.len() != split.cells.len() {
        return Err(fail("boolean/contract-violation:merge/selection-size"));
    }
    let offset = split.charts[0].cells.len();
    let n = offset + split.charts[1].cells.len();
    let id = |p: usize, c: usize| c + if p == 0 { 0 } else { offset };
    let mut selected = vec![false; n];
    let mut parent: Vec<_> = (0..n).collect();
    let mut witness = BTreeMap::new();
    for (cell, &selected_cell) in split.cells.iter().zip(keep) {
        for (&(p, c), w) in cell.chart_cells.iter().zip(&cell.witnesses) {
            selected[id(p, c)] = selected_cell;
            witness.insert((p, c), w.clone());
        }
    }
    let mut next = BTreeMap::new();
    let mut twins = BTreeMap::new();
    let mut seams: BTreeMap<(Point, Point), Vec<(usize, usize)>> = BTreeMap::new();
    for (p, chart) in split.charts.iter().enumerate() {
        for cell in &chart.cells {
            for cycle in &cell.cycles {
                for (i, &h) in cycle.iter().enumerate() {
                    next.insert((p, h), (p, cycle[(i + 1) % cycle.len()]));
                }
            }
        }
        for (i, piece) in chart.pieces.iter().enumerate() {
            let a = chart.face[2 * i];
            let b = chart.face[2 * i + 1];
            if split.sources[p][piece.owners[0].1].is_none() {
                let mut ends = piece
                    .seg
                    .ends()
                    .clone()
                    .map(|uv| split.seam.physical(&uv, p));
                ends.sort();
                let h = if a != UNBOUNDED { 2 * i } else { 2 * i + 1 };
                seams
                    .entry((ends[0].clone(), ends[1].clone()))
                    .or_default()
                    .push((p, h));
            } else if a != UNBOUNDED && b != UNBOUNDED && selected[id(p, a)] && selected[id(p, b)] {
                twins.insert((p, 2 * i), (p, 2 * i + 1));
                twins.insert((p, 2 * i + 1), (p, 2 * i));
                let a = root(&mut parent, id(p, a));
                let b = root(&mut parent, id(p, b));
                parent[b] = a;
            }
        }
    }
    for pair in seams.into_values() {
        if pair.len() != 2 {
            return Err(fail("boolean/contract-violation:merge/seam-twin"));
        }
        let [(p, h), (q, k)] = [pair[0], pair[1]];
        let a = id(p, split.charts[p].face[h]);
        let b = id(q, split.charts[q].face[k]);
        if selected[a] != selected[b] {
            return Err(fail("boolean/contract-violation:merge/seam-class"));
        }
        if selected[a] {
            twins.insert((p, h), (q, k));
            twins.insert((q, k), (p, h));
            let a = root(&mut parent, a);
            let b = root(&mut parent, b);
            parent[b] = a;
        }
    }
    let mut members: BTreeMap<usize, Vec<(usize, usize)>> = BTreeMap::new();
    for (p, chart) in split.charts.iter().enumerate() {
        for c in 0..chart.cells.len() {
            if selected[id(p, c)] {
                let r = root(&mut parent, id(p, c));
                members.entry(r).or_default().push((p, c));
            }
        }
    }
    let mut out = vec![];
    for chart_cells in members.into_values() {
        let mut arcs = vec![];
        let mut witnesses = vec![];
        for &(p, c) in &chart_cells {
            witnesses.push(witness[&(p, c)].clone());
            let chart = &split.charts[p];
            for cycle in &chart.cells[c].cycles {
                for &h in cycle {
                    if twins.contains_key(&(p, h)) {
                        continue;
                    }
                    let piece = &chart.pieces[h / 2];
                    let source = split.sources[p][piece.owners[0].1]
                        .ok_or(fail("boolean/contract-violation:merge/seam-retained"))?;
                    let trim = chart.oriented(h);
                    arcs.push(Arc {
                        source,
                        from: split.seam.physical(&trim.ends()[0], p),
                        to: split.seam.physical(&trim.ends()[1], p),
                        chart: ChartPiece {
                            patch: if p == 0 { Patch::First } else { Patch::Second },
                            piece: trim,
                        },
                        halfedge: (p, h),
                    });
                }
            }
        }
        out.push(Cell {
            chart_cells,
            witnesses,
            loops: walk(arcs, &next, &twins)?,
        });
    }
    Ok(out)
}

fn check_domain(split: &Split, band: &wonky_geom::model::RevolutionBand) -> Result<()> {
    if split.rings.len() < 2
        || split.rings[0] != Radical::from(band.lo.clone())
        || split.rings[1] != Radical::from(band.hi.clone())
    {
        return Err(fail("boolean/contract-violation:periodic/split-domain"));
    }
    Ok(())
}
