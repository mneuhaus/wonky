//! Exact planar polygon admission and symbolic solid membership. These are
//! rational predicates, not a mesh approximation: triangles partition the
//! original plane region, and infinitesimal ray signs never use a tolerance.
use crate::{planar_geometry::{cross, dot, sub, P}, polyhedron::Refused};
use num_rational::BigRational as Q;
use num_traits::{Signed, Zero};
fn no(s: &str) -> Refused { Refused(format!("planar-boolean/{s}")) }
pub(crate) fn normal(p: &[P]) -> P {
    let mut n = std::array::from_fn(|_| Q::zero());
    for i in 1..p.len()-1 { let c = cross(&sub(&p[i], &p[0]), &sub(&p[i+1], &p[0])); for j in 0..3 { n[j] += &c[j]; } }
    n
}
/// Exact admission of a simple planar cycle. Replay does not trust the source
/// cache's admission: crossed edges and overlapping adjacent edges refuse.
pub(crate) fn simple(p: &[P]) -> Result<(), Refused> {
    if p.len() < 3 { return Err(no("degenerate-face")); }
    let n = normal(p);
    if n.iter().all(Q::is_zero) { return Err(no("degenerate-face")); }
    let side = |a: &P, b: &P, x: &P| dot(&cross(&sub(b,a), &sub(x,a)), &n);
    let on = |a: &P, b: &P, x: &P| side(a,b,x).is_zero() && dot(&sub(x,a), &sub(x,b)) <= Q::zero();
    for i in 0..p.len() {
        let (a,b,c) = (&p[i], &p[(i+1)%p.len()], &p[(i+2)%p.len()]);
        if a == b || (side(a,b,c).is_zero() && dot(&sub(b,a), &sub(c,b)).is_negative()) { return Err(no("nonsimple-face")); }
        for j in i+1..p.len() {
            if j == i+1 || (i == 0 && j == p.len()-1) { continue; }
            let (c,d) = (&p[j], &p[(j+1)%p.len()]);
            let (ac,ad,ca,cb) = (side(a,b,c),side(a,b,d),side(c,d,a),side(c,d,b));
            if on(a,b,c) || on(a,b,d) || on(c,d,a) || on(c,d,b) || ((ac*ad).is_negative() && (ca*cb).is_negative()) {
                return Err(no("nonsimple-face"));
            }
        }
    }
    Ok(())
}
/// Ear partition of an admitted simple planar cycle. Every orientation, ear
/// exclusion, and diagonal decision is exact.
pub(crate) fn triangles(p: &[P]) -> Result<Vec<Vec<P>>, Refused> {
    let n = normal(p);
    let turn = |a: &P, b: &P, c: &P| dot(&cross(&sub(b,a), &sub(c,b)), &n);
    let mut cycle = p.to_vec();
    let mut out = Vec::new();
    while cycle.len() > 3 {
        // Collinear intermediate vertices are not ears; removing them does not
        // change the region. Boundary stitching later restores shared vertices.
        if let Some(i) = (0..cycle.len()).find(|&i| {
            let (a,b,c) = (&cycle[(i+cycle.len()-1)%cycle.len()], &cycle[i], &cycle[(i+1)%cycle.len()]);
            turn(a,b,c).is_zero() && dot(&sub(b,a), &sub(b,c)) <= Q::zero()
        }) { cycle.remove(i); continue; }
        let ear = (0..cycle.len()).find(|&i| {
            let (ai,ci) = ((i+cycle.len()-1)%cycle.len(),(i+1)%cycle.len());
            let (a,b,c) = (&cycle[ai], &cycle[i], &cycle[ci]);
            turn(a,b,c).is_positive() && !cycle.iter().enumerate().any(|(j,x)| {
                j != ai && j != i && j != ci && [(a,b),(b,c),(c,a)].iter().all(|(u,v)| dot(&cross(&sub(v,u), &sub(x,u)), &n) >= Q::zero())
            })
        }).ok_or_else(|| no("polygon-partition-unproved"))?;
        out.push(vec![cycle[(ear+cycle.len()-1)%cycle.len()].clone(), cycle[ear].clone(), cycle[(ear+1)%cycle.len()].clone()]);
        cycle.remove(ear);
    }
    if !normal(&cycle).iter().all(Q::is_zero) { out.push(cycle); }
    if out.is_empty() { return Err(no("degenerate-face")); }
    Ok(out)
}
fn lex(a: &Q, b: &Q) -> i8 { if a.is_positive() {1} else if a.is_negative() {-1} else if b.is_positive() {1} else if b.is_negative() {-1} else {0} }
/// Membership of p + epsilon * displacement (epsilon positive infinitesimal).
/// Faces are exact convex partitions of the oriented closed boundary. A ray
/// meeting a partition edge is retried, never double-counted or snapped.
pub(crate) fn inside(faces: &[Vec<P>], p: &P, displacement: &P) -> Result<bool, Refused> {
    for k in 1..=32i64 {
        let ray = [Q::from_integer(1.into()), Q::new(k.into(), 37.into()), Q::new((k*k+1).into(), 101.into())];
        let mut odd = false;
        let mut degenerate = false;
        for f in faces {
            let n = normal(f);
            let nd = dot(&n, &ray);
            let (np, ep) = (dot(&n, &sub(&f[0],p)), -dot(&n,displacement));
            if nd.is_zero() { if np.is_zero() && ep.is_zero() { degenerate = true; break; } continue; }
            let (t,e) = (np/&nd,ep/&nd);
            if lex(&t,&e) <= 0 { continue; }
            let hit: P = std::array::from_fn(|j| &p[j]+&ray[j]*&t);
            let delta: P = std::array::from_fn(|j| &displacement[j]+&ray[j]*&e);
            let mut boundary = false;
            let mut outside = false;
            for i in 0..f.len() {
                let edge = sub(&f[(i+1)%f.len()],&f[i]);
                let s = lex(&dot(&cross(&edge,&sub(&hit,&f[i])),&n), &dot(&cross(&edge,&delta),&n));
                outside |= s < 0; boundary |= s == 0;
            }
            if outside { continue; }
            if boundary { degenerate = true; break; }
            odd = !odd;
        }
        if !degenerate { return Ok(odd); }
    }
    Err(no("membership-ray-degenerate"))
}
#[cfg(test)]
mod tests {
    use super::*;
    fn polygon(points: &[[i64; 2]]) -> Vec<P> {
        points.iter().map(|p| [Q::from_integer(p[0].into()), Q::from_integer(p[1].into()), Q::zero()]).collect()
    }
    #[test]
    fn exact_cycle_admission_rejects_crossings_and_backtracking() {
        // Nonzero signed area: a zero-normal guard alone cannot catch this crossing.
        let crossing = polygon(&[[0,0],[3,2],[0,3],[2,0]]);
        assert_eq!(simple(&crossing).unwrap_err().0, "planar-boolean/nonsimple-face");
        let overlap = polygon(&[[0,0],[3,0],[1,0],[1,2],[0,2]]);
        assert_eq!(simple(&overlap).unwrap_err().0, "planar-boolean/nonsimple-face");
        assert_eq!(simple(&polygon(&[[0,0],[1,0]])).unwrap_err().0, "planar-boolean/degenerate-face");
    }
    #[test]
    fn concave_partition_preserves_exact_signed_area_with_collinear_vertices() {
        let p = polygon(&[[0,0],[1,0],[3,0],[3,1],[1,1],[1,3],[0,3]]);
        simple(&p).unwrap();
        let partition = triangles(&p).unwrap();
        let area: Q = partition.iter().map(|p| normal(p)[2].clone()).sum();
        assert_eq!(area, Q::from_integer(10.into())); // twice the L-region area 5
        assert_eq!(normal(&p)[2], area);
    }
}
