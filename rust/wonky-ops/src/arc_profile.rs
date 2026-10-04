//! Three-point circular-arc/line profiles (including all-line chains). Source points are binary64;
//! circle centres are rational and intersection predicates use exact Q(sqrt(r)).
//! Rounded WC0 carriers are a serialization of that construction, audited by
//! reconstruction; measurements enclose the source circles, not their caches.
//!
//! A profile is a `wonky_curve::Cycle` of `Trimmed` pieces. Every geometric
//! decision (intersection, admission, order, area) is an operation of that
//! crate's table; this module only chains sources into a closed cycle.
use crate::{
    affine::Affine,
    polyhedron::{Audited, Refused},
};
use std::collections::BTreeMap;
use wonky_contract::*;
use wonky_curve as wc;
use wonky_num::Iv;
pub(crate) mod arrangement;
pub(crate) mod regularize;
pub(crate) use wc::numeric::{dot, pt, q, sub, P, Q};
pub(crate) type R<T> = std::result::Result<T, Refused>;
pub(crate) fn no(s: &str) -> Refused {
    Refused(format!("arc-profile/{s}"))
}
pub(crate) fn enclose(x: &impl wc::numeric::ExactScalar) -> R<Iv> {
    Ok(wc::numeric::enclose(x)?)
}
pub(crate) fn finite(v: Iv) -> R<Iv> {
    Ok(wc::numeric::finite(v)?)
}
pub(crate) fn b(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| no("numeric-range"))
}

/// A simple closed chain of pieces, counter-clockwise, ends chained.
#[derive(Clone, Debug)]
pub(crate) struct Profile {
    cycle: wc::Cycle,
}
fn key(p: [f64; 2]) -> [u64; 2] {
    p.map(|x| if x == 0. { 0 } else { x.to_bits() })
}
impl Profile {
    /// A profile over consecutive pieces; the caller has chained and oriented them.
    pub(crate) fn from_pieces(pieces: Vec<wc::Trimmed>) -> Self {
        Self { cycle: wc::Cycle::new(pieces) }
    }
    pub(crate) fn cycle(&self) -> &wc::Cycle {
        &self.cycle
    }
    pub(crate) fn segments(&self) -> &[wc::Trimmed] {
        self.cycle.pieces()
    }
    /// Every piece stays strictly outside the closed disc of centre `p` and
    /// squared radius `r2`; a spline piece is refused.
    pub(crate) fn clears_disc(&self, p: &P, r2: &Q) -> R<bool> {
        for s in self.segments() {
            if !s.clears_disc(p, r2)? {
                return Ok(false);
            }
        }
        Ok(true)
    }
    pub(crate) fn has_split_vertices(&self) -> bool {
        self.segments().iter().any(wc::Trimmed::is_split)
    }
    pub(crate) fn new(lines: &[[f64; 4]], arcs: &[[f64; 6]]) -> R<Self> {
        Self::with_cap(lines, arcs, None)
    }
    pub(crate) fn with_cap(lines: &[[f64; 4]], arcs: &[[f64; 6]], cap: Option<f64>) -> R<Self> {
        if lines.len() + arcs.len() < 3 {
            return Err(no("requires-closed-chain"));
        }
        if !lines
            .iter()
            .flatten()
            .chain(arcs.iter().flatten())
            .all(|x| x.is_finite())
        {
            return Err(no("nonfinite-source"));
        }
        let mut segs = regularize::sources(lines, arcs)?;
        if let Some(cap) = cap { regularize::apply(&mut segs, cap)?; }
        let mut p = Self::from_pieces(chained(&segs)?);
        p.simple()?;
        if p.area()?.hi() < 0. {
            p = Self { cycle: p.cycle.reversed() };
        }
        if p.area()?.lo() <= 0. {
            return Err(no("unresolved-profile-orientation"));
        }
        Ok(p)
    }
    pub(crate) fn simple(&self) -> R<()> {
        wc::radical::guard(|| self.simple_exact())?
    }
    fn simple_exact(&self) -> R<()> {
        // The chord polygon and each trimmed arc have independent intersection
        // certificates. Only intersections on BOTH finite trims are contacts.
        let n = self.segments().len();
        if n < 3 || self.segments().iter().enumerate().any(|(i,s)|
            s.ends()[0] == s.ends()[1] || s.ends()[1] != self.segments()[(i+1)%n].ends()[0]
        ) { return Err(no("chord-intersection")); }
        let chords = self.segments().iter().map(|s|
            wc::Trimmed::new(s.ends().clone(),wc::Carrier::Line)
        ).collect::<std::result::Result<Vec<_>,_>>()?;
        let mut twice = wc::radical::Radical::default();
        for chord in &chords {
            twice = twice + wc::radical::cross(&chord.ends()[0].coordinates(),&chord.ends()[1].coordinates());
        }
        if twice.is_zero() { return Err(no("chord-intersection")); }
        for i in 0..n {
            for j in i+1..n {
                let contacts = match chords[i].contacts(&chords[j]) {
                    Ok(contacts) => contacts,
                    Err(wc::Refusal::OverlappingLines) => return Err(no("chord-intersection")),
                    Err(e) => return Err(e.into()),
                };
                let adjacent = j == i+1 || (i == 0 && j+1 == n);
                if if adjacent {
                    contacts.len() != 1 || !chords[i].ends().contains(&contacts[0]) || !chords[j].ends().contains(&contacts[0])
                } else { !contacts.is_empty() } {
                    return Err(no("chord-intersection"));
                }
            }
        }
        let bounds = self
            .segments()
            .iter()
            .map(wc::Trimmed::bounds)
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for i in 0..self.segments().len() {
            for j in i + 1..self.segments().len() {
                if (0..2)
                    .any(|k| bounds[i][1][k] < bounds[j][0][k] || bounds[j][1][k] < bounds[i][0][k])
                {
                    continue;
                }
                self.segments()[i].admit(&self.segments()[j])?;
            }
        }
        Ok(())
    }
    pub(crate) fn area(&self) -> R<Iv> {
        Ok(self.cycle.area()?)
    }
}

/// The pieces as one closed chain, in traversal order from the first end of
/// `segs[0]`, each piece oriented along the chain. The chain is decided on the
/// exact ends (X1), never on their binary64 caches: every end must be shared by
/// exactly two pieces and one walk must use every piece.
pub(crate) fn chained(segs: &[wc::Trimmed]) -> R<Vec<wc::Trimmed>> {
    let mut graph: BTreeMap<wc::ExactPoint, Vec<usize>> = BTreeMap::new();
    for (i, s) in segs.iter().enumerate() {
        let [a, b] = s.ends();
        if a == b {
            return Err(no("zero-edge"));
        }
        for p in [a, b] {
            graph.entry(p.clone()).or_default().push(i);
        }
    }
    if graph.values().any(|n| n.len() != 2) {
        return Err(no("open-or-branching-chain"));
    }
    let mut used = vec![false; segs.len()];
    let mut ordered: Vec<wc::Trimmed> = vec![];
    let mut at = segs[0].ends()[0].clone();
    for _ in 0..segs.len() {
        let id = *graph[&at]
            .iter()
            .find(|&&i| !used[i])
            .ok_or_else(|| no("multiple-loops"))?;
        used[id] = true;
        let s = if segs[id].ends()[0] != at { segs[id].reversed() } else { segs[id].clone() };
        at = s.ends()[1].clone();
        ordered.push(s);
    }
    if at != ordered[0].ends()[0] {
        return Err(no("open-chain"));
    }
    Ok(ordered)
}

#[derive(Clone, Debug)]
pub(crate) struct ArcPrism {
    pub regularization: Option<String>,
    pub rim: Option<crate::fillet_rim::Rim>,
    pub profile: Profile,
    pub levels: [f64; 2],
}

pub fn build(
    key: BodyKey,
    frame: Affine,
    lines: &[[f64; 4]],
    arcs: &[[f64; 6]],
    depth: f64,
    reverse: bool,
) -> R<Body> {
    build_in_source(key, [0; 4], frame, lines, arcs, depth, reverse)
}
pub(crate) fn regions(lines: &[[f64; 4]], arcs: &[[f64; 6]]) -> R<arrangement::Regions> {
    arrangement::solve(lines, arcs)
}
pub(crate) fn regularized_regions(lines: &[[f64; 4]], arcs: &[[f64; 6]], cap: f64) -> R<(arrangement::Regions, String)> {
    let mut sources = regularize::sources(lines, arcs)?;
    let merges = regularize::apply(&mut sources, cap)?;
    let regions = arrangement::solve_with_cap(lines, arcs, Some(cap)).map_err(regularization_refusal)?;
    Ok((regions, regularize::report(cap, &merges)?))
}
fn regularization_refusal(e: Refused) -> Refused {
    if e.0.contains("intersection") || e.0.contains("split-vertex") || e.0.ends_with("non-simple-exterior-walk") {
        no("regularization/residual-above-cap-or-unresolved-topology")
    } else { e }
}
pub(crate) fn build_regularized_region(key: BodyKey, frame: Affine, lines: &[[f64; 4]], arcs: &[[f64; 6]], depth: f64, reverse: bool, region: usize, cap: f64) -> R<Body> {
    build_selected(key, [0; 4], frame, lines, arcs, depth, reverse, Some(region), Some(cap))
}
pub fn build_region(
    key: BodyKey,
    frame: Affine,
    lines: &[[f64; 4]],
    arcs: &[[f64; 6]],
    depth: f64,
    reverse: bool,
    region: usize,
) -> R<Body> {
    // Keep the established simple-chain construction byte-for-byte stable.
    if region == 0 && Profile::new(lines, arcs).is_ok() {
        return build(key, frame, lines, arcs, depth, reverse);
    }
    build_selected(
        key,
        [0; 4],
        frame,
        lines,
        arcs,
        depth,
        reverse,
        Some(region),
        None,
    )
}
pub(crate) fn build_in_source(
    key: BodyKey,
    source: [u32; 4],
    frame: Affine,
    lines: &[[f64; 4]],
    arcs: &[[f64; 6]],
    depth: f64,
    reverse: bool,
) -> R<Body> {
    build_selected(key, source, frame, lines, arcs, depth, reverse, None, None)
}
pub(crate) fn selected_profile(lines: &[[f64; 4]], arcs: &[[f64; 6]], region: Option<usize>, cap: Option<f64>) -> R<Profile> {
    if let Some(index) = region {
        let regions = arrangement::solve_with_cap(lines, arcs, cap).map_err(|e| if cap.is_some() { regularization_refusal(e) } else { e })?;
        if index == u32::MAX as usize {
            if regions.profiles.len() < 2 {
                return Err(no("merged-region-count"));
            }
            regions.outer.ok_or_else(|| Refused(regions.outer_refusal
                .unwrap_or_else(|| "arc-profile/exterior-boundary-unavailable".into())))
        } else {
            regions.profiles.into_iter().nth(index).ok_or_else(|| no("region-index"))
        }
    } else {
        Profile::with_cap(lines, arcs, cap)
    }
}
fn build_selected(
    key: BodyKey,
    source: [u32; 4],
    frame: Affine,
    lines: &[[f64; 4]],
    arcs: &[[f64; 6]],
    depth: f64,
    reverse: bool,
    region: Option<usize>,
    cap: Option<f64>,
) -> R<Body> {
    build_selected_sketch(key, source, frame, lines, arcs, depth, reverse, region, cap, None)
}

/// Rule 4 preserves a region of the shared sketch arrangement and its circles.
/// Interpreter parameters extend the established depth/reverse/line/arc source
/// with `[circle_count, (cx, cy, radius)...]`; Sketch parameters are `[region]`.
/// Contacts and trimmed carriers are regenerated exactly on every replay.
pub(crate) fn build_sketch_region(key: BodyKey, frame: Affine, lines: &[[f64; 4]], arcs: &[[f64; 6]], circles: &[[f64; 3]], depth: f64, reverse: bool, region: usize) -> R<Body> {
    build_selected_sketch(key, [0;4], frame, lines, arcs, depth, reverse, Some(region), None, Some(circles))
}
fn source_profile(lines: &[[f64;4]], arcs: &[[f64;6]], region: Option<usize>, cap: Option<f64>, circles: Option<&[[f64;3]]>) -> R<Profile> {
    match circles {
        Some(circles) => crate::sketch_regions::split_profile(lines, arcs, circles, region.ok_or_else(|| no("region-source"))?),
        None => selected_profile(lines, arcs, region, cap),
    }
}
fn build_selected_sketch(key: BodyKey, source: [u32;4], frame: Affine, lines: &[[f64;4]], arcs: &[[f64;6]], depth: f64, reverse: bool, region: Option<usize>, cap: Option<f64>, circles: Option<&[[f64;3]]>) -> R<Body> {
    if !depth.is_finite() || depth <= 0. {
        return Err(no("depth"));
    }
    frame.det_exact().map_err(|_| no("frame"))?;
    let profile = source_profile(lines, arcs, region, cap, circles)
        .map_err(|e| if cap.is_some() { regularization_refusal(e) } else { e })?;
    let levels = if reverse { [-depth, 0.] } else { [0., depth] };
    if profile.segments().iter().flat_map(|s| s.ends()).any(|p| p.rat().is_err()) {
        let placement = crate::placement::Placement::from_affine(frame).map_err(|_| no("frame"))?;
        let floor = crate::prism_stack::export_resolution_floor(
            &placement,
            profile.segments().iter().flat_map(|s| s.ends()),
            profile.segments().iter(),
            &levels.map(q),
        )?;
        profile.cycle().certify_resolution(floor)?;
        if depth <= floor { return Err(wc::Refusal::SubResolutionFeature.into()); }
    }
    if region.is_some() {
        let mut caches = BTreeMap::<[u64; 2], wc::ExactPoint>::new();
        for s in profile.segments() {
            for (cache, exact) in s.cache().iter().zip(s.ends()) {
                if let Some(old) = caches.insert(self::key(*cache), exact.clone()) {
                    if old != *exact {
                        return Err(no("split-vertex-cache-collision"));
                    }
                }
            }
        }
        if profile.area()?.lo() <= 0. {
            return Err(no("region-area-observation"));
        }
    }
    let mut params = vec![
        depth,
        if reverse { 1. } else { 0. },
        lines.len() as f64,
        arcs.len() as f64,
    ];
    params.extend(lines.iter().flatten());
    params.extend(arcs.iter().flatten());
    if let Some(circles) = circles {
        params.push(circles.len() as f64);
        params.extend(circles.iter().flatten());
    }
    let nodes = vec![
        Construction {
            operation: Operation::Interpreter {},
            rule_version: 1,
            parents: vec![],
            parameters: params.into_iter().map(b).collect::<R<_>>()?,
            frame: FrameId(0),
        },
        Construction {
            operation: Operation::Sketch {},
            rule_version: if circles.is_some() { 4 } else if cap.is_some() { 2 } else { 1 },
            parents: vec![NodeId(0)],
            parameters: if let Some(cap) = cap {
                vec![b(region.ok_or_else(|| no("regularization/region-required"))? as f64)?, b(cap)?]
            } else { region.map(|i| b(i as f64)).transpose()?.into_iter().collect() },
            frame: FrameId(1),
        },
        Construction {
            operation: Operation::Extrude {},
            rule_version: 1,
            parents: vec![NodeId(1)],
            parameters: vec![],
            frame: FrameId(1),
        },
    ];
    let v = |p: [f64; 3]| {
        p.into_iter()
            .map(b)
            .collect::<R<Vec<_>>>()
            .map(|p| [p[0], p[1], p[2]])
    };
    let frames = vec![
        Frame::Source { source },
        Frame::Interpreter {
            parent: FrameId(0),
            origin: v(frame.origin)?,
            x: v(frame.x)?,
            z: v(frame.z)?,
        },
    ];
    crate::arc_profile_brep::construct(
        key,
        frames,
        nodes,
        &ArcPrism {
            regularization: regularization_report(lines, arcs, cap)?,
            profile,
            levels,
            rim: None,
        },
    )
}
pub(crate) fn candidate(body: &Body) -> bool {
    (body.constructions.len() == 3
        || (body.constructions.len() == 4
            && matches!(body.constructions[3].operation, Operation::Fillet {} | Operation::Intersection {})))
        && body.constructions[1].operation == Operation::Sketch {}
        && body.constructions[2].operation == Operation::Extrude {}
}
/// The replayable source of an arc-profile extrusion: binary64 interpreter
/// inputs plus the region/regularization selection of its sketch node.
pub(crate) struct Source {
    pub source: [u32; 4],
    pub frame: Affine,
    pub lines: Vec<[f64; 4]>,
    pub arcs: Vec<[f64; 6]>,
    pub depth: f64,
    pub reverse: bool,
    pub region: Option<usize>,
    pub cap: Option<f64>,
    pub circles: Option<Vec<[f64;3]>>,
}
impl Source {
    /// Parses exactly the grammar that `build_selected` emits (no rim node).
    pub(crate) fn parse(frames: &[Frame], nodes: &[Construction]) -> R<Self> {
        let frame = match frames.get(1) {
            Some(&Frame::Interpreter {
                parent: FrameId(0),
                origin,
                x,
                z,
            }) => Affine {
                origin: origin.map(|x| x.get()),
                x: x.map(|x| x.get()),
                z: z.map(|x| x.get()),
            },
            _ => return Err(no("frame")),
        };
        let p = nodes[0]
            .parameters
            .iter()
            .map(|x| x.get())
            .collect::<Vec<_>>();
        if p.len() < 4
            || ![0., 1.].contains(&p[1])
            || p[2] < 0.
            || p[3] < 0.
            || p[2].fract() != 0.
            || p[3].fract() != 0.
            || p[2] > p.len() as f64
            || p[3] > p.len() as f64
        {
            return Err(no("source"));
        }
        let (nl, na) = (p[2] as usize, p[3] as usize);
        let end = 4 + nl * 4 + na * 6;
        let arranged = nodes[1].rule_version == 4;
        if (!arranged && p.len() != end) || (arranged && p.len() <= end) {
            return Err(no("source"));
        }
        let lines = p[4..4 + nl * 4]
            .chunks_exact(4)
            .map(|x| [x[0], x[1], x[2], x[3]])
            .collect::<Vec<_>>();
        let arcs = p[4 + nl * 4..end]
            .chunks_exact(6)
            .map(|x| [x[0], x[1], x[2], x[3], x[4], x[5]])
            .collect::<Vec<_>>();
        let circles = if arranged {
            let n = p[end];
            if n < 0. || n.fract() != 0. || n > p.len() as f64 || p.len() != end + 1 + 3 * n as usize { return Err(no("source")); }
            Some(p[end+1..].chunks_exact(3).map(|c| [c[0],c[1],c[2]]).collect())
        } else { None };
        let Some(&Frame::Source { source }) = frames.first() else {
            return Err(no("source-frame"));
        };
        let node = &nodes[1];
        let (region, cap) = match (node.rule_version, node.parameters.as_slice()) {
            (1, []) => (None, None),
            (1 | 4, [index])
                if index.get() >= 0. && index.get() <= u32::MAX as f64 && index.get().fract() == 0. =>
            {
                (Some(index.get() as usize), None)
            }
            (2, [index, cap]) if index.get() >= 0. && index.get() <= u32::MAX as f64
                && index.get().fract() == 0. && cap.get() >= 0. => (Some(index.get() as usize), Some(cap.get())),
            _ => return Err(no("region-source")),
        };
        Ok(Self { source, frame, lines, arcs, depth: p[0], reverse: p[1] == 1., region, cap, circles })
    }
    pub(crate) fn build(&self, key: BodyKey) -> R<Body> {
        build_selected_sketch(key, self.source, self.frame, &self.lines, &self.arcs, self.depth, self.reverse, self.region, self.cap, self.circles.as_deref())
    }
    pub(crate) fn profile(&self) -> R<Profile> {
        source_profile(&self.lines, &self.arcs, self.region, self.cap, self.circles.as_deref())
    }
    pub(crate) fn levels(&self) -> [f64; 2] {
        if self.reverse { [-self.depth, 0.] } else { [0., self.depth] }
    }
}
pub(crate) fn audit(checked: &CheckedBody) -> R<Audited> {
    let body = checked.body();
    // A rule 3 sketch (tagged entities, splines) has its own source grammar.
    if crate::curve_profile::candidate(body) {
        return crate::curve_profile::audit(checked);
    }
    if body.frames.len() != 2 || !candidate(body) {
        return Err(no("construction-shape"));
    }
    let Source { source, frame, lines, arcs, depth, reverse, region, cap, circles } =
        Source::parse(&body.frames, &body.constructions)?;
    let p = [depth, if reverse { 1. } else { 0. }];
    let mut rebuilt = build_selected_sketch(
        body.key.clone(),
        source,
        frame,
        &lines,
        &arcs,
        p[0],
        p[1] == 1.,
        region,
        cap,
        circles.as_deref(),
    )?;
    let mut spec = ArcPrism {
        regularization: regularization_report(&lines, &arcs, cap)?,
        profile: source_profile(&lines, &arcs, region, cap, circles.as_deref())?,
        levels: if p[1] == 1. { [-p[0], 0.] } else { [0., p[0]] },
        rim: None,
    };
    if body.constructions.len() == 4 {
        let params = &body.constructions[3].parameters;
        if params.len() != 1 && !(params.len() == 2 && params[1].get() == 1.) {
            return Err(no("rim-source"));
        }
        let bottom = params.len() == 2;
        let radius = params[0].get();
        let chamfer = body.constructions[3].operation == Operation::Intersection {};
        rebuilt = crate::fillet_rim::construct_band(rebuilt, &spec, radius, chamfer, bottom)?;
        spec.rim = Some(crate::fillet_rim::Rim::band(&spec, radius, chamfer, bottom)?);
    }
    if &rebuilt != body {
        return Err(no("construction-mismatch"));
    }
    let frame =
        crate::placement::Placement::from_frames(body, FrameId(1)).map_err(|_| no("frame"))?;
    if frame.reversed().map_err(|_| no("frame"))?
        || frame.orthonormality_defect().map_err(|_| no("frame"))? > 1e-9
    {
        return Err(no("non-near-rigid-frame"));
    }
    let profile = source_profile(&lines, &arcs, region, cap, circles.as_deref())?;
    let levels = if p[1] == 1. { [-p[0], 0.] } else { [0., p[0]] };
    let face_loops = body
        .loops
        .iter()
        .map(|lp| {
            lp.coedges
                .iter()
                .map(|id| {
                    let co = &body.coedges[id.0 as usize];
                    body.edges[co.edge.0 as usize].vertices[usize::from(!co.forward)].0 as usize
                })
                .collect()
        })
        .collect();
    // A straight profile uses the existing rational planar authority. Side
    // normals and charts in WC0 are reproducible caches, not plane predicates.
    // The vertices remain the exact binary64 source endpoints at exact levels.
    // Rule-4 cells keep the ArcPrism authority even for straight sides: their
    // intersection endpoints may be non-binary rational serialization caches.
    let (arrangement, cap) = if arcs.is_empty() && circles.is_none() {
        let points = body
            .vertices
            .iter()
            .map(|v| v.point.map(|x| q(x.get())))
            .collect();
        let exact = crate::planar_geometry::Arrangement::new(points, &frame)?;
        let cap = profile
            .segments()
            .iter()
            .map(|s| wonky_num::p2(s.cache()[0][0], s.cache()[0][1]))
            .collect();
        (Some(exact), cap)
    } else {
        (None, vec![])
    };
    Ok(Audited {
        body: body.clone(),
        frame,
        axis: 2,
        levels,
        cap,
        face_loops,
        bound_to_construction: true,
        arrangement,
        orthogonal: None,
        rounded: None,
        corner: None,
        arcs: (!arcs.is_empty() || circles.is_some()).then_some(spec),
        chamfer: None,
    })
}

fn regularization_report(lines: &[[f64; 4]], arcs: &[[f64; 6]], cap: Option<f64>) -> R<Option<String>> {
    cap.map(|cap| {
        let mut sources = regularize::sources(lines, arcs)?;
        let merges = regularize::apply(&mut sources, cap)?;
        regularize::report(cap, &merges)
    }).transpose()
}

#[cfg(test)]
mod exact_chord_tests {
    use super::*;
    fn profile(points: [[f64;2];4],cache: [[f64;2];4]) -> Profile {
        let exact = points.map(|p| wc::ExactPoint::from_quadratic(pt(p),[q(1.),q(0.)],q(2.)).unwrap());
        Profile::from_pieces((0..4).map(|i| wc::Trimmed::with_cache(
            [exact[i].clone(),exact[(i+1)%4].clone()],
            [cache[i],cache[(i+1)%4]],wc::Carrier::Line,
        )).collect())
    }
    #[test]
    fn chord_admission_uses_exact_vertices_even_when_caches_collapse_or_hide_crossings() {
        let square = [[0.,0.],[1.,0.],[1.,1.],[0.,1.]];
        let valid = profile(square,[[0.,0.];4]);
        assert!(valid.simple().is_ok());
        assert!(valid.area().unwrap().lo() > 0.);
        let crossed = profile([[0.,0.],[3.,0.],[0.,3.],[2.,3.]],square);
        assert_eq!(crossed.simple().unwrap_err().0,"arc-profile/chord-intersection");
    }
}
