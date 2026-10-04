//! Source-replayed plane/plane rolling-ball surgery. Parallel generators are
//! serialized as one exact analytic extrusion, using the shared profile tools.
//! E9 radius and surgery live in the authenticated source metric; placement is
//! retained as an exact image with the existing explicit metric/export bounds.
use crate::{
    arc_profile::{ArcPrism, Profile},
    placement::Placement,
    polyhedron::{Audited, Refused},
};
use num_traits::Zero;
use wonky_contract::*;
use wonky_curve::{self as wc, radical::Radical};
use wonky_geom::{
    model::{Bounds, EdgeId, Model},
    Q,
};
type R<T> = std::result::Result<T, Refused>;
const RULE: u32 = 13;
fn no(s: &str) -> Refused {
    Refused(format!("fillet/{s}"))
}
pub(crate) fn candidate(b: &Body) -> bool {
    b.constructions
        .last()
        .is_some_and(|n| n.operation == Operation::Fillet {} && n.rule_version == RULE)
}
fn model(body: &Body, root: usize) -> R<Model> {
    crate::model_boolean::replay_at(body, root)
}
fn local_model(m: Model) -> R<Model> {
    let mut d = m.into_draft();
    d.placement = wonky_geom::frame::Frame::identity();
    d.check().map_err(|e| Refused(e.0.into()))
}
fn boundary(m: &Model, selected: &[EdgeId], radius: f64) -> R<wonky_blend::fillet::Boundary> {
    wonky_blend::fillet::plane_plane(
        m,
        selected,
        wonky_blend::Request {
            section: wonky_blend::Section::Fillet {
                radius: wc::numeric::q(radius),
            },
            tangent_propagation: false,
        },
        true,
    )
    .map_err(|e| Refused(e.0))
}
pub(crate) fn apply(a: &Audited, edges: &[usize], radius: f64) -> R<Body> {
    if !radius.is_finite() || radius <= 0. {
        return Err(no("invalid-radius"));
    }
    let (mut body, temporary) =
        crate::planar_boolean::source_dag(a.body.key.clone(), 0, &[a.clone()])?;
    let root = body.constructions[temporary].parents[0].0 as usize;
    body.constructions.truncate(temporary);
    if root + 1 != body.constructions.len() {
        return Err(no("source-root-lineage"));
    }
    let m = model(&body, root)?;
    let world = crate::planar_geometry::world_points(a, 1.)?;
    let mut selected = Vec::new();
    for &i in edges {
        let e = a.body.edges.get(i).ok_or_else(|| no("edge-index"))?;
        if e.vertices.len() != 2 {
            return Err(no("requires-line-edges"));
        }
        let ends = e
            .vertices
            .iter()
            .map(|v| world[v.0 as usize].clone())
            .collect::<Vec<_>>();
        let id = m
            .draft()
            .edges
            .iter()
            .enumerate()
            .find_map(|(j, e)| match e.bounds {
                Bounds::Segment([x, y]) => {
                    let points =
                        [x, y].map(|v| m.key(v).rational().map(|p| m.draft().placement.point(p)));
                    match points {
                        [Ok(x), Ok(y)]
                            if (x == ends[0] && y == ends[1]) || (y == ends[0] && x == ends[1]) =>
                        {
                            Some(EdgeId(j as u32))
                        }
                        _ => None,
                    }
                }
                Bounds::Ring => None,
            })
            .ok_or_else(|| no("selection-not-in-model"))?;
        selected.push(id);
    }
    selected.sort();
    selected.dedup();
    let m = local_model(m)?;
    let b = boundary(&m, &selected, radius)?;
    let axis = source_axis(&m, &b)?;
    let frames = chart_frames(&body, root, axis)?;
    body.frames.extend(frames);
    let fid = FrameId((body.frames.len() - 1) as u32);
    body.constructions.push(Construction {
        operation: Operation::Fillet {},
        rule_version: RULE,
        parents: vec![NodeId(root as u32)],
        frame: fid,
        parameters: std::iter::once(radius)
            .chain(selected.iter().map(|e| e.0 as f64))
            .map(crate::arc_profile::b)
            .collect::<R<_>>()?,
    });
    body.key.revision = body
        .key
        .revision
        .checked_add(1)
        .ok_or_else(|| no("revision-range"))?;
    Ok(replay(&body)?.0)
}
fn source_axis(m: &Model, b: &wonky_blend::fillet::Boundary) -> R<usize> {
    let inv = m.draft().placement.inverse();
    let stripe = b.stripes.first().ok_or_else(|| no("empty-selection"))?;
    let direction = inv.vector(&stripe.axis);
    let axis = (0..3)
        .find(|&k| !direction[k].is_zero() && (0..3).all(|i| i == k || direction[i].is_zero()))
        .ok_or_else(|| no("extrusion-chart-unavailable"))?;
    for s in &b.stripes {
        let a = inv.vector(&s.axis);
        if (0..3).any(|k| k != axis && !a[k].is_zero()) {
            return Err(no("nonparallel-generators"));
        }
    }
    Ok(axis)
}
fn prism(m: &Model, b: &wonky_blend::fillet::Boundary) -> R<ArcPrism> {
    use wonky_blend::fillet::Carrier;
    let axis = source_axis(m, b)?;
    let [u, v, w] = [(axis + 1) % 3, (axis + 2) % 3, axis];
    let inv = m.draft().placement.inverse();
    let local = |p: &[Radical; 3]| -> [Radical; 3] {
        std::array::from_fn(|i| {
            Radical::from(inv.origin()[i].clone())
                + (0..3).fold(Radical::default(), |s, j| {
                    s + Radical::from(inv.columns()[j][i].clone()) * &p[j]
                })
        })
    };
    // A ball centre between supports with irrational-length normals lies in
    // the quadratic field of its spring points; the chart keeps it exact.
    let centre = |p: &[Radical; 3]| -> R<wc::ExactPoint> {
        let c = local(p);
        Ok(wc::ExactPoint::from_coordinates([c[u].clone(), c[v].clone()])?)
    };
    let mut caps = Vec::new();
    for f in &b.faces {
        let Carrier::Plane { normal, .. } = &f.carrier else {
            continue;
        };
        // A cap is perpendicular to the generator in the physical source metric.
        if !wonky_geom::cross(normal, &b.stripes[0].axis)
            .iter()
            .all(Q::is_zero)
        {
            continue;
        }
        if f.loops.len() != 1 {
            return Err(no("extrusion-multiple-cap-loops"));
        }
        let z = local(&f.loops[0][0].start)[w]
            .rational()
            .ok_or_else(|| no("extrusion-level"))?;
        let mut pieces = Vec::new();
        for p in &f.loops[0] {
            let ends = [local(&p.start), local(&p.end)];
            if ends.iter().any(|p| p[w] != Radical::from(z.clone())) {
                return Err(no("extrusion-cap-not-flat"));
            }
            let ends = ends
                .map(|p| wc::ExactPoint::from_coordinates([p[u].clone(), p[v].clone()]))
                .into_iter()
                .collect::<std::result::Result<Vec<_>, _>>()?;
            let carrier = if let Some(arc) = &p.arc {
                let c = centre(&arc.center)?;
                let ccw =
                    wc::radical::cross(&ends[0].difference(&c), &ends[1].difference(&c)).is_positive();
                wc::Trimmed::ring_about(c, arc.radius2.clone(), ends[0].clone(), ccw)?
                    .trim(ends[0].clone(), ends[1].clone())?
            } else {
                wc::Trimmed::new([ends[0].clone(), ends[1].clone()], wc::Carrier::Line)?
            };
            pieces.push(carrier);
        }
        let mut profile = Profile::from_pieces(merged(pieces.clone())?);
        if profile.area()?.hi() < 0. {
            profile = Profile::from_pieces(profile.cycle().reversed().pieces().to_vec());
        }
        profile.simple()?;
        caps.push((z, profile, pieces));
    }
    if caps.len() != 2 {
        return Err(no("extrusion-two-caps-required"));
    }
    caps.sort_by(|a, b| a.0.cmp(&b.0));
    if caps[0]
        .1
        .segments()
        .iter()
        .map(|p| p.key())
        .collect::<Vec<_>>()
        != caps[1]
            .1
            .segments()
            .iter()
            .map(|p| p.key())
            .collect::<Vec<_>>()
    {
        // Loops may start at different edges. Compare exact directed cycles modulo rotation.
        let a = caps[0].1.segments();
        let b = caps[1].1.segments();
        if a.len() != b.len()
            || !(0..b.len()).any(|k| {
                a.iter().enumerate().all(|(i, p)| {
                    p.key() == b[(i + k) % b.len()].key() && p.ends() == b[(i + k) % b.len()].ends()
                })
            })
        {
            return Err(no("extrusion-caps-differ"));
        }
    }
    let mut walls = 0;
    for f in &b.faces {
        if let Carrier::Plane { normal, .. } = &f.carrier {
            if wonky_geom::cross(normal, &b.stripes[0].axis)
                .iter()
                .all(Q::is_zero)
            {
                continue;
            }
        }
        walls += 1;
        if f.loops.len() != 1 || f.loops[0].len() != 4 {
            return Err(no("extrusion-incomplete-wall"));
        }
        let mut counts = [0usize; 2];
        let mut generators = 0;
        for p in &f.loops[0] {
            let a = local(&p.start);
            let e = local(&p.end);
            if a[w] == e[w] {
                let z = a[w].rational().ok_or_else(|| no("extrusion-wall-level"))?;
                let k = if z == caps[0].0 {
                    0
                } else if z == caps[1].0 {
                    1
                } else {
                    return Err(no("extrusion-wall-level"));
                };
                counts[k] += 1;
                let ends = [
                    wc::ExactPoint::from_coordinates([a[u].clone(), a[v].clone()])?,
                    wc::ExactPoint::from_coordinates([e[u].clone(), e[v].clone()])?,
                ];
                // Walls are the unmerged surgery faces; each owns one raw cap piece.
                let on_cap = caps[k].2.iter().any(|s| {
                    let matches =
                        s.ends() == &ends || s.ends() == &[ends[1].clone(), ends[0].clone()];
                    matches
                        && match (s.carrier(), &p.arc) {
                            (wc::Carrier::Line, None) => true,
                            (wc::Carrier::Circle(c), Some(arc)) => centre(&arc.center)
                                .is_ok_and(|q| c.c == q && c.r2 == arc.radius2),
                            _ => false,
                        }
                });
                if !on_cap {
                    return Err(no("extrusion-wall-not-on-cap"));
                }
            } else {
                if p.arc.is_some()
                    || a[u] != e[u]
                    || a[v] != e[v]
                    || !((a[w] == Radical::from(caps[0].0.clone())
                        && e[w] == Radical::from(caps[1].0.clone()))
                        || (e[w] == Radical::from(caps[0].0.clone())
                            && a[w] == Radical::from(caps[1].0.clone())))
                {
                    return Err(no("extrusion-incomplete-generator"));
                }
                generators += 1;
            }
        }
        if counts != [1, 1] || generators != 2 {
            return Err(no("extrusion-incomplete-wall"));
        }
    }
    if walls != caps[0].2.len() {
        return Err(no("extrusion-wall-count"));
    }
    let levels = [
        crate::prism_holes::exact_float(&caps[0].0)?,
        crate::prism_holes::exact_float(&caps[1].0)?,
    ];
    Ok(ArcPrism {
        regularization: None,
        rim: None,
        profile: caps.remove(0).1,
        levels,
    })
}
/// G5 merge of a cap loop: consecutive pieces on one exact carrier (the same
/// circle and sense, or collinear lines running on) meet at a degree-2 vertex
/// and are one edge, as two equal rounds meeting tangentially are one face.
fn merged(mut pieces: Vec<wc::Trimmed>) -> R<Vec<wc::Trimmed>> {
    let same = |a: &wc::Trimmed, b: &wc::Trimmed| match (a.carrier(), b.carrier()) {
        (wc::Carrier::Circle(x), wc::Carrier::Circle(y)) => {
            x.c == y.c && x.r2 == y.r2 && x.ccw == y.ccw
        }
        (wc::Carrier::Line, wc::Carrier::Line) => {
            let d = a.ends()[1].difference(&a.ends()[0]);
            let e = b.ends()[1].difference(&b.ends()[0]);
            wc::radical::cross(&d, &e).is_zero() && wc::radical::dot(&d, &e).is_positive()
        }
        _ => false,
    };
    while pieces.len() > 3 {
        let n = pieces.len();
        let Some(i) = (0..n).find(|&i| same(&pieces[i], &pieces[(i + 1) % n])) else {
            break;
        };
        let j = (i + 1) % n;
        let ends = [pieces[i].ends()[0].clone(), pieces[j].ends()[1].clone()];
        pieces[i] = match pieces[i].carrier() {
            wc::Carrier::Circle(c) => {
                wc::Trimmed::ring_about(c.c.clone(), c.r2.clone(), ends[0].clone(), c.ccw)?
                    .trim(ends[0].clone(), ends[1].clone())?
            }
            _ => wc::Trimmed::new(ends, wc::Carrier::Line)?,
        };
        pieces.remove(j);
    }
    Ok(pieces)
}
fn replay(body: &Body) -> R<(Body, ArcPrism, Placement)> {
    let n = body
        .constructions
        .last()
        .ok_or_else(|| no("construction"))?;
    if !candidate(body)
        || n.parents.len() != 1
        || n.parameters.len() < 2
        || n.parents[0].0 as usize + 1 != body.constructions.len() - 1
    {
        return Err(no("construction"));
    }
    let root = n.parents[0].0 as usize;
    let metric = Placement::from_frames(body, body.constructions[root].frame)
        .map_err(|_| no("source-frame"))?;
    crate::source_frame::SourceMetric::new(&metric)?;
    let m = local_model(model(body, root)?)?;
    let radius = n.parameters[0].get();
    let selected = n.parameters[1..]
        .iter()
        .map(|v| {
            let x = v.get();
            let i = x as u32;
            if x == i as f64 {
                Ok(EdgeId(i))
            } else {
                Err(no("edge-index"))
            }
        })
        .collect::<R<Vec<_>>>()?;
    let b = boundary(&m, &selected, radius)?;
    let axis = source_axis(&m, &b)?;
    let count = chart_frames(body, root, axis)?.len();
    let mut source = body.clone();
    source.frames.truncate(body.frames.len() - count);
    let expected = chart_frames(&source, root, axis)?;
    if body.frames[body.frames.len() - count..] != expected
        || n.frame.0 as usize != body.frames.len() - 1
    {
        return Err(no("construction-frame-mismatch"));
    }
    let s = prism(&m, &b)?;
    let result = crate::arc_profile_brep::construct(
        body.key.clone(),
        body.frames.clone(),
        body.constructions.clone(),
        &s,
    )?;
    let placement = Placement::from_frames(body, n.frame).map_err(|_| no("source-frame"))?;
    Ok((result, s, placement))
}
pub(crate) fn audit(checked: &CheckedBody) -> R<Audited> {
    let (expected, s, frame) = replay(checked.body())?;
    if &expected != checked.body() {
        return Err(no("construction-carrier-mismatch"));
    }
    wonky_geom::model::extrusion::profile(
        frame.exact_frame()?,
        model(
            &expected,
            expected.constructions.last().unwrap().parents[0].0 as usize,
        )?
        .draft()
        .label,
        (expected.constructions.len() - 1) as u32,
        s.profile.segments(),
        s.levels.map(wc::numeric::q),
    )
    .and_then(wonky_geom::model::Draft::check)
    .map_err(|e| Refused(e.0.into()))?;
    let face_loops = expected
        .loops
        .iter()
        .map(|l| {
            l.coedges
                .iter()
                .map(|c| {
                    let co = &expected.coedges[c.0 as usize];
                    expected.edges[co.edge.0 as usize].vertices[usize::from(!co.forward)].0 as usize
                })
                .collect()
        })
        .collect();
    Ok(Audited {
        body: expected,
        frame,
        axis: 2,
        levels: s.levels,
        cap: vec![],
        face_loops,
        bound_to_construction: true,
        orthogonal: None,
        arcs: Some(s),
        rounded: None,
        corner: None,
        chamfer: None,
        arrangement: None,
    })
}

pub(crate) fn rebuild(
    key: BodyKey,
    frames: Vec<Frame>,
    constructions: Vec<Construction>,
) -> R<Body> {
    replay(&Body {
        key,
        frames,
        constructions,
        vertices: vec![],
        curves: vec![],
        surfaces: vec![],
        pcurves: vec![],
        edges: vec![],
        coedges: vec![],
        loops: vec![],
        faces: vec![],
        shells: vec![],
        solids: vec![],
        facts: vec![],
        budgets: vec![],
    })
    .map(|x| x.0)
}
/// Nonintersecting axial cuts commute with generator surgery. The shared
/// exact bore arrangement rechecks containment and separation after rounding;
/// a cut touched by the blend refuses rather than retaining a stale bore.
pub(crate) fn cut_generators(s: &crate::analytic::Solid, edges: &[usize], radius: f64) -> R<Body> {
    use crate::{analytic::Solid, prism_holes::Base};
    let (base, tools) = match s {
        Solid::PrismHoles(p) if p.pocket.is_none() && p.meridians.is_empty() => {
            let Base::Planar(a) = &p.base else {
                return Err(no("planar-generator-source-required"));
            };
            let tools = p
                .tools
                .iter()
                .map(|t| match t {
                    Base::Cylinder(c) => Ok(c.clone()),
                    _ => Err(no("axial-cylinder-tools-required")),
                })
                .collect::<R<Vec<_>>>()?;
            (a.clone(), tools)
        }
        Solid::Perforated(p) => {
            let root = p.body.constructions.last().ok_or_else(|| no("source"))?;
            let tools = if root.rule_version == 2 {
                let (mut sources, _) =
                    crate::prism_holes::ungraft(&p.body, &root.parameters, &root.parents)?;
                sources.remove(0);
                sources
                    .into_iter()
                    .map(|s| match s {
                        Base::Cylinder(c) => Ok(c),
                        _ => Err(no("axial-cylinder-tools-required")),
                    })
                    .collect::<R<Vec<_>>>()?
            } else {
                root.parents[1..]
                    .iter()
                    .map(|n| {
                        let spec = crate::cylinder::replay(
                            &p.body.constructions,
                            n.0 as usize,
                            &mut 2048,
                        )?;
                        let body = crate::cylinder::create(p.body.key.clone(), spec)?;
                        let c = crate::cylinder::audit(
                            &body.check().map_err(|_| no("tool-contract"))?,
                        )?;
                        let body = crate::cylinder::transform(&c, p.base.frame.as_affine()?)?;
                        crate::cylinder::audit(&body.check().map_err(|_| no("tool-contract"))?)
                    })
                    .collect::<R<Vec<_>>>()?
            };
            (p.base.clone(), tools)
        }
        _ => return Err(no("axial-cut-source-required")),
    };
    // These generators are inherited unchanged from the base. Verify source
    // edge identities, instead of routing by coordinates or zone identifiers.
    let input = match s {
        Solid::PrismHoles(p) => &p.body,
        Solid::Perforated(p) => &p.body,
        _ => unreachable!(),
    };
    for &i in edges {
        let e = input.edges.get(i).ok_or_else(|| no("edge-index"))?;
        let parent = base
            .body
            .edges
            .get(i)
            .ok_or_else(|| no("cut-edge-selected"))?;
        if e.vertices != parent.vertices || e.vertices.len() != 2 {
            return Err(no("cut-edge-selected"));
        }
        for &v in &e.vertices {
            if input.vertices[v.0 as usize].point != base.body.vertices[v.0 as usize].point {
                return Err(no("cut-edge-selected"));
            }
        }
    }
    let body = apply(&base, edges, radius)?;
    let audited = crate::analytic::audit(&body.check().map_err(|_| no("output-contract"))?)?;
    let mut key = input.key.clone();
    key.revision = key
        .revision
        .checked_add(1)
        .ok_or_else(|| no("revision-range"))?;
    let result = crate::prism_holes::subtract(key, &audited, &tools)?;
    let admitted =
        crate::analytic::audit(&result.clone().check().map_err(|_| no("output-contract"))?)?;
    let old_count = match s {
        Solid::PrismHoles(p) => p.holes.len(),
        Solid::Perforated(p) => p.holes.len(),
        _ => unreachable!(),
    };
    match &admitted {
        Solid::PrismHoles(p)
            if p.holes.len() == old_count && p.pocket.is_none() && p.meridians.is_empty() =>
        {
            admitted.model()?;
        }
        _ => return Err(no("cut-intersects-blend-domain")),
    }
    Ok(result)
}

pub(crate) fn model_result(a: &Audited) -> R<Model> {
    let (_, s, frame) = replay(&a.body)?;
    wonky_geom::model::extrusion::profile(
        frame.exact_frame()?,
        model(
            &a.body,
            a.body.constructions.last().unwrap().parents[0].0 as usize,
        )?
        .draft()
        .label,
        (a.body.constructions.len() - 1) as u32,
        s.profile.segments(),
        s.levels.map(wc::numeric::q),
    )
    .and_then(wonky_geom::model::Draft::check)
    .map_err(|e| Refused(e.0.into()))
}

fn chart_frames(body: &Body, root: usize, axis: usize) -> R<Vec<Frame>> {
    let mut chain = Vec::new();
    let mut id = body.constructions[root].frame;
    loop {
        let f = body
            .frames
            .get(id.0 as usize)
            .ok_or_else(|| no("source-frame"))?;
        chain.push(f.clone());
        match f {
            Frame::Interpreter { parent, .. }
                if matches!(
                    body.frames.get(parent.0 as usize),
                    Some(Frame::Source { .. })
                ) =>
            {
                break
            }
            Frame::InterpreterImage { base, .. }
            | Frame::AffineImage { base, .. }
            | Frame::RationalImage { base, .. }
                if base.0 < id.0 =>
            {
                id = *base
            }
            _ => return Err(no("source-frame-grammar")),
        }
    }
    chain.reverse();
    let Frame::Interpreter { parent, .. } = chain[0] else {
        return Err(no("source-frame"));
    };
    let unit = |k| std::array::from_fn(|i| Binary64::new(if i == k { 1. } else { 0. }).unwrap());
    let mut frames = vec![Frame::Interpreter {
        parent,
        origin: unit(3),
        x: unit((axis + 1) % 3),
        z: unit(axis),
    }];
    for f in chain {
        let base = FrameId((body.frames.len() + frames.len() - 1) as u32);
        frames.push(match f {
            Frame::Interpreter { origin, x, z, .. }
            | Frame::InterpreterImage { origin, x, z, .. } => {
                Frame::InterpreterImage { base, origin, x, z }
            }
            Frame::AffineImage {
                translation, rows, ..
            } => Frame::AffineImage {
                base,
                translation,
                rows,
            },
            Frame::RationalImage {
                rows, denominator, ..
            } => Frame::RationalImage {
                base,
                rows,
                denominator,
            },
            _ => return Err(no("source-frame-grammar")),
        });
    }
    Ok(frames)
}
