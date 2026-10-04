//! Exact planar normalization after P7's manifold/contact and nesting checks.
//! Edge-connected faces on the same oriented plane lose their shared edges.
//! Only globally degree-two, exactly collinear vertices are removed, from
//! every incident loop together. Shells, holes and exact signed volumes stay
//! unchanged. No operand family, tolerance, or world cache participates.
use crate::assemble::Assembly;
use crate::contract;
use crate::paves::PointId;
use num_traits::{Signed, Zero};
use std::collections::{BTreeMap, BTreeSet};
use wonky_geom::model::Plane3;
use wonky_geom::{cross, dot, sub, Point, Refused, Result, Q};

#[derive(Clone, Debug)]
pub(crate) struct Face {
    pub carrier: Plane3,
    pub forward: bool,
    pub loops: Vec<Vec<PointId>>,
}
pub(crate) struct Normalized {
    pub faces: Vec<Face>,
    pub shells: Vec<Vec<usize>>,
}
fn edge(a: PointId, b: PointId) -> (PointId, PointId) {
    (a.min(b), a.max(b))
}
fn root(parent: &mut [usize], mut i: usize) -> usize {
    while parent[i] != i {
        parent[i] = parent[parent[i]];
        i = parent[i];
    }
    i
}
fn same_plane(a: &Face, b: &Face) -> bool {
    cross(&a.carrier.n, &b.carrier.n).iter().all(Q::is_zero)
        && a.carrier.side(&b.carrier.o).is_zero()
        && (cfg!(feature = "plant_merge_opposite") || dot(&a.carrier.n, &b.carrier.n).is_positive() == (a.forward == b.forward))
}
fn signed_volume(faces: &[Face], shell: &[usize], points: &[Point]) -> Q {
    let mut v = Q::zero();
    for &f in shell {
        for lp in &faces[f].loops {
            for k in 1..lp.len() - 1 {
                v += dot(&points[lp[0].index()], &cross(&points[lp[k].index()], &points[lp[k + 1].index()]));
            }
        }
    }
    v
}

pub(crate) fn normalize(assembly: &Assembly, points: &[Point]) -> Result<Normalized> {
    let original: Vec<Face> = assembly.faces.iter().map(|f| Face {
        carrier: f.carrier.clone(), forward: f.forward, loops: f.loops.clone(),
    }).collect();
    let mut faces = vec![];
    let mut shells = vec![];
    for shell in &assembly.shells {
        let mut uses: BTreeMap<_, Vec<(usize, PointId, PointId)>> = BTreeMap::new();
        for &f in shell {
            for lp in &original[f].loops {
                for k in 0..lp.len() {
                    let (a, b) = (lp[k], lp[(k + 1) % lp.len()]);
                    uses.entry(edge(a, b)).or_default().push((f, a, b));
                }
            }
        }
        let mut parent: Vec<usize> = (0..original.len()).collect();
        for list in uses.values() {
            if list.len() != 2 || list[0].1 != list[1].2 || list[0].2 != list[1].1 {
                return Err(Refused(contract::ASSEMBLE_EDGE));
            }
            let (a, b) = (list[0].0, list[1].0);
            if same_plane(&original[a], &original[b]) {
                let (a, b) = (root(&mut parent, a), root(&mut parent, b));
                parent[a] = b;
            }
        }
        let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for &f in shell {
            groups.entry(root(&mut parent, f)).or_default().push(f);
        }
        let mut emitted = vec![];
        for group in groups.into_values() {
            let mut next = BTreeMap::new();
            for &f in &group {
                for lp in &original[f].loops {
                    for k in 0..lp.len() {
                        let (a, b) = (lp[k], lp[(k + 1) % lp.len()]);
                        let owners = &uses[&edge(a, b)];
                        if owners.iter().all(|u| group.contains(&u.0)) {
                            continue;
                        }
                        if next.insert(a, b).is_some() {
                            return Err(Refused(contract::MERGE_PINCH));
                        }
                    }
                }
            }
            let mut loops = vec![];
            while let Some((&start, _)) = next.first_key_value() {
                let mut lp = vec![];
                let mut p = start;
                loop {
                    lp.push(p);
                    p = next.remove(&p).ok_or(Refused(contract::ASSEMBLE_EDGE))?;
                    if p == start { break; }
                }
                if lp.len() < 3 { return Err(Refused(contract::ASSEMBLE_EDGE)); }
                loops.push(lp);
            }
            let carrier = original[group[0]].carrier.clone();
            let forward = original[group[0]].forward;
            // A connected region has one outer cycle, and zero or more holes.
            // Exact chart area identifies it; orient checks every hole's sense.
            let loops = crate::assemble::orient(&carrier, forward, loops, points)?;
            emitted.push(faces.len());
            faces.push(Face { carrier, forward, loops });
        }
        shells.push(emitted);
    }
    // Remove a straight-edge subdivision only when it is degree two in the
    // whole result, not merely collinear in one face (preserve T-junctions).
    let mut neighbors: BTreeMap<PointId, BTreeSet<PointId>> = BTreeMap::new();
    for face in &faces {
        for lp in &face.loops {
            for k in 0..lp.len() {
                let (a, b) = (lp[k], lp[(k + 1) % lp.len()]);
                neighbors.entry(a).or_default().insert(b);
                neighbors.entry(b).or_default().insert(a);
            }
        }
    }
    let removable: BTreeSet<_> = neighbors.iter().filter_map(|(&p, ns)| {
        let ns: Vec<_> = ns.iter().copied().collect();
        let [a, b] = ns.as_slice() else { return None };
        let (u, v) = (sub(&points[a.index()], &points[p.index()]), sub(&points[b.index()], &points[p.index()]));
        (cross(&u, &v).iter().all(Q::is_zero) && dot(&u, &v).is_negative()).then_some(p)
    }).collect();
    for face in &mut faces {
        for lp in &mut face.loops {
            lp.retain(|p| !removable.contains(p));
            if lp.len() < 3 { return Err(Refused(contract::ASSEMBLE_EDGE)); }
        }
    }
    for (before, after) in assembly.shells.iter().zip(&shells) {
        if signed_volume(&original, before, points) != signed_volume(&faces, after, points) {
            return Err(Refused("boolean/contract-violation:merge/volume"));
        }
    }
    Ok(Normalized { faces, shells })
}

#[cfg(test)]
mod tests {
    use super::*;
    use wonky_geom::point;
    #[test]
    fn proved_carrier_identity_requires_equal_outward_orientation() {
        let a = Face { carrier: Plane3 {
            o: point([0.,0.,0.]).unwrap(), x: point([1.,0.,0.]).unwrap(), n: point([0.,0.,1.]).unwrap(),
        }, forward: true, loops: vec![] };
        let mut b = a.clone();
        b.forward = false;
        assert!(!same_plane(&a,&b), "opposite-oriented fragments must never merge");
        b.carrier.n = b.carrier.n.map(|x| -x);
        assert!(same_plane(&a,&b), "opposite normal plus opposite sense is the same outward carrier");
        b.carrier.o[2] = Q::new(1.into(), (1u64<<60).into());
        assert!(!same_plane(&a,&b), "near-identical planes are different exact carriers");
    }
}
