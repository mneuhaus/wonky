//! Exact coaxial meridian arrangement. Plane/cylinder/cone intersections are
//! rational rings in the common revolution chart. Offset axes need AxisGraph
//! trimming and remain refused. No rounded event becomes construction input:
//! the emitted dyadic meridian is checked against the rational arrangement and
//! the complete operand DAG is replayed before its observation caches are used.
use crate::{
    affine::Affine,
    analytic::Solid,
    cylinder,
    placement::Placement,
    polyhedron::Refused,
    revolve_full::{self, FullRevolve},
};
use num_rational::BigRational as Q;
use num_traits::{Signed, ToPrimitive, Zero};
use std::{
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet},
};
use wonky_contract::*;
type R<T> = std::result::Result<T, Refused>;
type P = [Q; 2];
fn no(s: &str) -> Refused {
    Refused(format!("revolve/boolean/{s}"))
}
fn q(x: f64) -> Q {
    Q::from_float(x).expect("checked binary64")
}
fn b(x: f64) -> R<Binary64> {
    Binary64::new(x).map_err(|_| no("numeric-range"))
}
fn exact(x: &Q) -> R<f64> {
    let f = x
        .to_f64()
        .filter(|f| f.is_finite())
        .ok_or_else(|| no("numeric-range"))?;
    if q(f) != *x {
        return Err(no("non-binary64-meridian-event"));
    }
    Ok(f)
}
fn sub(a: &P, b: &P) -> P {
    [&a[0] - &b[0], &a[1] - &b[1]]
}
fn cross(a: &P, b: &P) -> Q {
    &a[0] * &b[1] - &a[1] * &b[0]
}
fn along(a: &P, d: &P, t: &Q) -> P {
    [&a[0] + &d[0] * t, &a[1] + &d[1] * t]
}
fn body(s: &Solid) -> R<&Body> {
    match s {
        Solid::Revolved(r) => Ok(&r.body),
        Solid::Cylinder(c) => Ok(&c.body),
        _ => Err(no("operand-carrier")),
    }
}
fn placement(b: &Body) -> R<Placement> {
    Placement::from_frames(b, FrameId(1)).map_err(|_| no("source-frame"))
}
fn kind(s: &Solid) -> R<usize> {
    match s {
        Solid::Revolved(_) => Ok(0),
        Solid::Cylinder(_) => Ok(1),
        _ => Err(no("operand-carrier")),
    }
}

fn meridian(s: &Solid, reference: &FullRevolve) -> R<Vec<P>> {
    let target = crate::construction_geom::frame(&placement(&reference.body)?)?;
    let (frame, origin, axis, points) = match s {
        Solid::Revolved(r) => (
            placement(&r.body)?,
            [0.; 3],
            revolve_full::local(r.mode, 0., 0., 1.),
            r.points.iter().map(|p| p.map(q)).collect::<Vec<_>>(),
        ),
        Solid::Cylinder(c) => {
            let k = c.spec.axis()?;
            let mut origin = c.spec.bottom;
            origin[k] = 0.;
            let axis = std::array::from_fn(|j| if j == k { 1. } else { 0. });
            let (lo, hi, r) = (q(c.spec.bottom[k]), q(c.spec.top[k]), q(c.spec.radius));
            (
                c.frame.clone(),
                origin,
                axis,
                vec![
                    [Q::zero(), lo.clone()],
                    [r.clone(), lo],
                    [r, hi.clone()],
                    [Q::zero(), hi],
                ],
            )
        }
        _ => return Err(no("operand-carrier")),
    };
    let relation = target.relation_from(&crate::construction_geom::frame(&frame)?);
    relation
        .require_isometry()
        .map_err(|e| Refused(e.0.into()))?;
    let origin = relation.map.point(&origin.map(q));
    let axis = relation.map.vector(&axis.map(q));
    let k = reference.mode; // local() maps axial coordinate to mode's world axis.
    if (0..3).any(|j| j != k && (!origin[j].is_zero() || !axis[j].is_zero()))
        || axis[k].abs() != q(1.)
    {
        return Err(no("non-coaxial-axes"));
    }
    let mut points = points
        .into_iter()
        .map(|p| [p[0].clone(), &origin[k] + &axis[k] * &p[1]])
        .collect::<Vec<_>>();
    if axis[k] < Q::zero() {
        points.reverse();
    }
    Ok(points)
}
// Signs of a + epsilon*b, for a positive infinitesimal epsilon. This makes
// boundary-side membership independent of any geometric resolution/tolerance.
fn sign(a: Q, b: Q) -> Ordering {
    if a.is_zero() {
        b.cmp(&Q::zero())
    } else {
        a.cmp(&Q::zero())
    }
}
fn inside(poly: &[P], p: &P, n: &P) -> bool {
    let mut inside = false;
    for i in 0..poly.len() {
        let (a, b) = (&poly[i], &poly[(i + 1) % poly.len()]);
        let ay = sign(&a[1] - &p[1], -n[1].clone()) == Ordering::Greater;
        let by = sign(&b[1] - &p[1], -n[1].clone()) == Ordering::Greater;
        if ay != by {
            let d = sub(b, a);
            let side = sign(cross(&d, &sub(p, a)), cross(&d, n));
            if side == d[1].cmp(&Q::zero()) {
                inside = !inside;
            }
        }
    }
    inside
}
fn material(op: u8, polys: &[Vec<P>], p: &P, n: &P) -> bool {
    let membership = polys
        .iter()
        .map(|poly| inside(poly, p, n))
        .collect::<Vec<_>>();
    match op {
        0 => membership.iter().any(|x| *x),
        1 => membership[0] && !membership[1..].iter().any(|x| *x),
        _ => membership.iter().all(|x| *x),
    }
}
fn arrange(op: u8, polys: &[Vec<P>]) -> R<Vec<[f64; 2]>> {
    let segments = polys
        .iter()
        .flat_map(|p| (0..p.len()).map(|i| (p[i].clone(), p[(i + 1) % p.len()].clone())))
        .collect::<Vec<_>>();
    if segments.len() > 256 {
        return Err(no("arrangement-budget"));
    }
    let mut pieces = BTreeSet::new();
    for (a, b) in &segments {
        let d = sub(b, a);
        let k = usize::from(d[0].is_zero());
        let mut cuts = BTreeSet::from([Q::zero(), q(1.)]);
        for (c, e) in &segments {
            let v = sub(e, c);
            let delta = sub(c, a);
            let det = cross(&d, &v);
            if !det.is_zero() {
                let t = cross(&delta, &v) / &det;
                let u = cross(&delta, &d) / &det;
                if t >= Q::zero() && t <= q(1.) && u >= Q::zero() && u <= q(1.) {
                    cuts.insert(t);
                }
            } else if cross(&delta, &d).is_zero() {
                for p in [c, e] {
                    let t = (&p[k] - &a[k]) / &d[k];
                    if t > Q::zero() && t < q(1.) {
                        cuts.insert(t);
                    }
                }
            }
        }
        let cuts = cuts.into_iter().collect::<Vec<_>>();
        for pair in cuts.windows(2) {
            let (a, b) = (along(a, &d, &pair[0]), along(a, &d, &pair[1]));
            pieces.insert(if a < b { (a, b) } else { (b, a) });
        }
    }
    let mut next = BTreeMap::new();
    let mut incoming = BTreeSet::new();
    if pieces.len() > 4096 {
        return Err(no("arrangement-budget"));
    }
    for (a, b) in pieces {
        let d = sub(&b, &a);
        let n = [-d[1].clone(), d[0].clone()];
        let mid = [(&a[0] + &b[0]) / q(2.), (&a[1] + &b[1]) / q(2.)];
        let left = material(op, polys, &mid, &n);
        let right = material(op, polys, &mid, &n.map(|v| -v));
        if left == right {
            continue;
        }
        let (a, b) = if left { (a, b) } else { (b, a) };
        if !incoming.insert(b.clone()) || next.insert(a, b).is_some() {
            return Err(Refused::geometric_verdict(no("non-manifold-result").0));
        }
    }
    if next.is_empty() {
        return Err(Refused::geometric_verdict(no("empty-result").0));
    }
    let start = next.keys().next().unwrap().clone();
    let mut at = start.clone();
    let mut points = vec![];
    loop {
        let to = next.remove(&at).ok_or_else(|| Refused::geometric_verdict(no("non-manifold-result").0))?;
        points.push(at);
        at = to;
        if at == start {
            break;
        }
    }
    if !next.is_empty() {
        return Err(no("multiple-meridian-loops"));
    }
    // Remove split-only collinear events; each retained edge changes carrier.
    loop {
        if points.len() < 3 {
            return Err(Refused::geometric_verdict(no("non-manifold-result").0));
        }
        let n = points.len();
        let remove = (0..n).find(|&i| {
            cross(
                &sub(&points[i], &points[(i + n - 1) % n]),
                &sub(&points[(i + 1) % n], &points[i]),
            )
            .is_zero()
        });
        match remove {
            Some(i) => {
                points.remove(i);
            }
            None => break,
        }
    }
    if (0..points.len())
        .map(|i| cross(&points[i], &points[(i + 1) % points.len()]))
        .sum::<Q>()
        <= Q::zero()
    {
        return Err(Refused::geometric_verdict(no("non-manifold-result").0));
    }
    points
        .iter()
        .map(|p| Ok([exact(&p[0])?, exact(&p[1])?]))
        .collect()
}
fn move_frame(f: &mut Frame, offset: u32, add: bool) -> R<()> {
    let parent = match f {
        Frame::Source { .. } => return Ok(()),
        Frame::Interpreter { parent, .. }
        | Frame::Rigid { parent, .. }
        | Frame::AffineImage { base: parent, .. }
        | Frame::InterpreterImage { base: parent, .. }
        | Frame::RationalImage { base: parent, .. } => parent,
    };
    parent.0 = if add {
        parent.0 + offset
    } else {
        parent
            .0
            .checked_sub(offset)
            .ok_or_else(|| no("source-layout"))?
    };
    Ok(())
}
fn graft(result: &mut Body, op: u8, operands: &[Solid]) -> R<()> {
    let mut parameters = vec![b(op as f64)?];
    let mut parents = vec![];
    for s in operands {
        let body = body(s)?;
        let fo = result.frames.len() as u32;
        let noff = result.constructions.len() as u32;
        parameters.extend([
            b(kind(s)? as f64)?,
            b(body.frames.len() as f64)?,
            b(body.constructions.len() as f64)?,
        ]);
        for mut f in body.frames.clone() {
            move_frame(&mut f, fo, true)?;
            result.frames.push(f);
        }
        for mut n in body.constructions.clone() {
            n.frame.0 += fo;
            for p in &mut n.parents {
                p.0 += noff;
            }
            result.constructions.push(n);
        }
        parents.push(NodeId(result.constructions.len() as u32 - 1));
    }
    result.constructions.push(Construction {
        operation: (Operation::Boolean {}),
        rule_version: 4,
        parents,
        parameters,
        frame: FrameId(1),
    });
    Ok(())
}
pub(crate) fn candidate(body: &Body) -> bool {
    body.constructions
        .last()
        .is_some_and(|n| n.operation == (Operation::Boolean {}) && n.rule_version == 4)
}
pub(crate) fn boolean(key: BodyKey, op: u8, operands: &[Solid]) -> R<Vec<Body>> {
    if op > 2 || operands.len() < 2 || operands.len() > 32 {
        return Err(no("arguments"));
    }
    let reference = operands
        .iter()
        .find_map(|s| {
            if let Solid::Revolved(r) = s {
                Some(r)
            } else {
                None
            }
        })
        .ok_or_else(|| no("revolution-required"))?;
    let polys = operands
        .iter()
        .map(|s| meridian(s, reference))
        .collect::<R<Vec<_>>>()?;
    let points = arrange(op, &polys)?;
    let segments = (0..points.len())
        .map(|i| {
            let (a, b) = (points[i], points[(i + 1) % points.len()]);
            [a[0], a[1], b[0], b[1]]
        })
        .collect::<Vec<_>>();
    let mut result = revolve_full::build(
        key,
        [0; 4],
        reference.frame,
        reference.mode,
        &segments,
        std::f64::consts::TAU,
    )?;
    graft(&mut result, op, operands)?;
    result.clone().check().map_err(|_| no("contract"))?;
    Ok(vec![result])
}
fn index(x: f64) -> R<usize> {
    if x < 0. || x > 100_000. || x.fract() != 0. {
        Err(no("source-index"))
    } else {
        Ok(x as usize)
    }
}
fn source_frame(frames: &[Frame]) -> R<Affine> {
    match frames.get(1) {
        Some(Frame::Interpreter {
            parent: FrameId(0),
            origin,
            x,
            z,
        }) => Ok(Affine {
            origin: origin.map(|v| v.get()),
            x: x.map(|v| v.get()),
            z: z.map(|v| v.get()),
        }),
        _ => Err(no("source-frame")),
    }
}
fn rebuild(
    key: BodyKey,
    kind: usize,
    frames: Vec<Frame>,
    nodes: Vec<Construction>,
    depth: usize,
) -> R<Solid> {
    if depth > 32 || nodes.is_empty() {
        return Err(no("replay-budget"));
    }
    let frame = source_frame(&frames)?;
    let body = if kind == 0 {
        if nodes
            .last()
            .is_some_and(|n| n.operation == (Operation::Boolean {}) && n.rule_version == 4)
        {
            replay(key, &frames, &nodes, depth + 1)?
        } else {
            let p = nodes[0]
                .parameters
                .iter()
                .map(|v| v.get())
                .collect::<Vec<_>>();
            if nodes.len() != 2 || p.len() < 16 || p.len() % 2 != 0 {
                return Err(no("source-grammar"));
            }
            let points = p[10..].chunks_exact(2).collect::<Vec<_>>();
            let segments = (0..points.len())
                .map(|i| {
                    let (a, b) = (points[i], points[(i + 1) % points.len()]);
                    [a[0], a[1], b[0], b[1]]
                })
                .collect::<Vec<_>>();
            let Some(Frame::Source { source }) = frames.first() else {
                return Err(no("source-frame"));
            };
            revolve_full::build(
                key,
                *source,
                frame,
                index(p[0])?,
                &segments,
                std::f64::consts::TAU,
            )?
        }
    } else if kind == 1 {
        let spec = cylinder::replay(&nodes, nodes.len() - 1, &mut 1024)?;
        cylinder::assemble(key, spec, frame, nodes.clone())?
    } else {
        return Err(no("source-kind"));
    };
    if body.frames != frames || body.constructions != nodes {
        return Err(no("source-grammar"));
    }
    let checked = body.clone().check().map_err(|_| no("source-contract"))?;
    if kind == 0 {
        // Replay above already bound a composite to all original operands.
        let mut head = body.clone();
        head.frames.truncate(2);
        head.constructions.truncate(2);
        let mut r = revolve_full::audit(&head.check().map_err(|_| no("source-contract"))?)?;
        r.body = body;
        Ok(Solid::Revolved(r))
    } else {
        Ok(Solid::Cylinder(cylinder::audit(&checked)?))
    }
}
fn replay(key: BodyKey, frames: &[Frame], nodes: &[Construction], depth: usize) -> R<Body> {
    if depth > 32 {
        return Err(no("replay-budget"));
    }
    let root = nodes.last().ok_or_else(|| no("source-layout"))?;
    if root.operation != (Operation::Boolean {})
        || root.rule_version != 4
        || root.frame != FrameId(1)
        || root.parents.len() < 2
        || root.parents.len() > 32
        || root.parameters.len() != 1 + 3 * root.parents.len()
    {
        return Err(no("source-layout"));
    }
    let op = index(root.parameters[0].get())?;
    if op > 2 {
        return Err(no("arguments"));
    }
    let (mut nf, mut nn) = (2, 2);
    let mut operands = vec![];
    for (i, desc) in root.parameters[1..].chunks_exact(3).enumerate() {
        let (kind, fc, nc) = (
            index(desc[0].get())?,
            index(desc[1].get())?,
            index(desc[2].get())?,
        );
        if fc < 2
            || nc < 2
            || nf + fc > frames.len()
            || nn + nc >= nodes.len()
            || root.parents[i].0 as usize != nn + nc - 1
        {
            return Err(no("source-layout"));
        }
        let mut fs = frames[nf..nf + fc].to_vec();
        for f in &mut fs {
            move_frame(f, nf as u32, false)?;
        }
        let mut ns = nodes[nn..nn + nc].to_vec();
        for n in &mut ns {
            n.frame.0 = n
                .frame
                .0
                .checked_sub(nf as u32)
                .ok_or_else(|| no("source-layout"))?;
            for p in &mut n.parents {
                p.0 =
                    p.0.checked_sub(nn as u32)
                        .ok_or_else(|| no("source-layout"))?;
            }
        }
        operands.push(rebuild(key.clone(), kind, fs, ns, depth)?);
        nf += fc;
        nn += nc;
    }
    if nf != frames.len() || nn + 1 != nodes.len() {
        return Err(no("source-layout"));
    }
    Ok(boolean(key, op as u8, &operands)?.remove(0))
}
pub(crate) fn audit(checked: &CheckedBody) -> R<FullRevolve> {
    let body = checked.body();
    let expected = replay(body.key.clone(), &body.frames, &body.constructions, 0)?;
    if expected != *body {
        return Err(no("construction-carrier-mismatch"));
    }
    let mut head = expected;
    head.frames.truncate(2);
    head.constructions.truncate(2);
    let mut result = revolve_full::audit(&head.check().map_err(|_| no("source-contract"))?)?;
    result.body = body.clone();
    Ok(result)
}
