//! Ruled, exactly planar loft between two simple polygonal regions in one
//! interpreter frame. Decisions use rationals of the original binary64 inputs;
//! the common plane carriers and vertices are never fitted or snapped.
use crate::{affine::Affine, planar_boolean, polyhedron::Refused};
use num_rational::BigRational as Q;
use num_traits::{Signed, Zero};
use wonky_contract::*;
use wonky_num::{p2, P2};
use wonky_sketch::region;

type R<T> = std::result::Result<T, Refused>;
type P = [Q; 3];
fn no(reason: &str) -> Refused { Refused(format!("loft/{reason}")) }
fn q(x: f64) -> Q { Q::from_float(x).expect("finite contract coordinate") }
fn sub(a: &P, b: &P) -> P { std::array::from_fn(|i| &a[i] - &b[i]) }
fn cross(a: &P, b: &P) -> P {
    [(1,2),(2,0),(0,1)].map(|(i,j)| &a[i]*&b[j] - &a[j]*&b[i])
}
fn dot(a: &P, b: &P) -> Q { (0..3).map(|i| &a[i]*&b[i]).sum() }
fn signed_area(points: &[[f64; 2]]) -> R<()> {
    let vertices: Vec<P2> = points.iter().map(|p| p2(p[0],p[1])).collect();
    region::simple_polygon(&vertices).map_err(|_| no("invalid-profile"))?;
    let a = region::signed_area2(&vertices).map_err(|_| no("numeric-range"))?;
    if wonky_num::expansion::sign(&a) <= 0 { return Err(no("profile-orientation")); }
    Ok(())
}
fn polygons(bottom: &[[f64; 2]], top: &[[f64; 2]], height: f64) -> R<Vec<Vec<P>>> {
    if bottom.len() != top.len() || !(3..=64).contains(&bottom.len()) { return Err(no("vertex-correspondence")); }
    if !height.is_finite() || height <= 0. { return Err(no("profile-separation")); }
    signed_area(bottom)?; signed_area(top)?;
    let n=bottom.len();
    let b: Vec<P> = bottom.iter().map(|v| [q(v[0]),q(v[1]),q(0.)]).collect();
    let t: Vec<P> = top.iter().map(|v| [q(v[0]),q(v[1]),q(height)]).collect();
    let all: Vec<&P> = b.iter().chain(t.iter()).collect();
    let mut faces = vec![b.iter().rev().cloned().collect(), t.clone()];
    for i in 0..n {
        let side=vec![b[i].clone(), b[(i+1)%n].clone(), t[(i+1)%n].clone(), t[i].clone()];
        let normal=cross(&sub(&side[1],&side[0]),&sub(&side[2],&side[0]));
        if normal.iter().all(Q::is_zero) { return Err(no("degenerate-ruled-face")); }
        if !dot(&normal,&sub(&side[3],&side[0])).is_zero() { return Err(no("non-planar-ruled-face")); }
        // This certificate deliberately admits only convex, embedded lofts.
        // Concave or crossed correspondences need a separate exact embedding proof.
        if all.iter().any(|p| dot(&normal,&sub(p,&side[0])).is_positive()) { return Err(no("non-convex-or-crossed")); }
        faces.push(side);
    }
    Ok(faces)
}
fn scalar(x: f64) -> R<Binary64> { Binary64::new(x).map_err(|_| no("numeric-range")) }
fn vector(x: [f64; 3]) -> R<Vector3> { Ok([scalar(x[0])?,scalar(x[1])?,scalar(x[2])?]) }
fn construct(key: BodyKey, source: [u32;4], frame: Affine, bottom: &[[f64;2]], top: &[[f64;2]], height: f64) -> R<Body> {
    // Each convex ruled face has one outer loop and no holes.
    let faces: Vec<_> = polygons(bottom,top,height)?.into_iter().map(|polygon| vec![polygon]).collect();
    let mut params=vec![scalar(bottom.len() as f64)?,scalar(height)?];
    for p in bottom.iter().chain(top.iter()) { params.extend([scalar(p[0])?,scalar(p[1])?]); }
    let body=Body { key, frames: vec![Frame::Source {source}, Frame::Interpreter {parent:FrameId(0), origin:vector(frame.origin)?,x:vector(frame.x)?,z:vector(frame.z)?}],
        constructions: vec![Construction {operation:Operation::Interpreter {},rule_version:1,parents:vec![],parameters:params,frame:FrameId(0)},
            Construction {operation:Operation::Loft {},rule_version:1,parents:vec![NodeId(0)],parameters:vec![],frame:FrameId(1)}],
        vertices:vec![],curves:vec![],surfaces:vec![],pcurves:vec![],edges:vec![],coedges:vec![],loops:vec![],faces:vec![],shells:vec![],solids:vec![],facts:vec![],budgets:vec![] };
    planar_boolean::build(body,1,&faces).map(|(body, _)| body).map_err(|e| no(&format!("planar-construction: {}",e.0)))
}
pub fn build(key: BodyKey, source: [u32;4], frame: Affine, bottom: &[[f64;2]], top: &[[f64;2]], height: f64) -> R<Body> {
    construct(key,source,frame,bottom,top,height)
}
pub fn candidate(body: &Body) -> bool {
    body.vertices.first().is_some_and(|v| matches!(v.provenance,Provenance::Construction {node} if body.constructions.get(node.0 as usize).is_some_and(|n| n.operation==Operation::Loft {})))
}
/// Replay from authenticated construction inputs, then compare the entire WC0
/// boundary (including carrier and curve support) before generic measurements.
pub fn audit(body: &Body) -> R<()> {
    let root=body.vertices.first().and_then(|v| match v.provenance {Provenance::Construction {node} => Some(node.0 as usize), _=>None}).ok_or_else(||no("lineage"))?;
    let node=body.constructions.get(root).ok_or_else(||no("lineage"))?;
    if node.operation != (Operation::Loft {}) || node.parents.len()!=1 || !node.parameters.is_empty() || node.frame!=FrameId(1) || root!=1 {return Err(no("lineage"));}
    let input=body.constructions.get(node.parents[0].0 as usize).ok_or_else(||no("lineage"))?;
    if input.operation != (Operation::Interpreter {}) || input.frame!=FrameId(0) || input.parameters.len()<2 {return Err(no("lineage"));}
    let params:Vec<f64>=input.parameters.iter().map(|x|x.get()).collect();
    let n=params[0] as usize;
    if n<3 || n>64 || params[0]!=n as f64 || params.len()!=2+4*n {return Err(no("construction-parameters"));}
    let points:Vec<[f64;2]>=params[2..].chunks_exact(2).map(|v|[v[0],v[1]]).collect();
    let frame=match body.frames.as_slice() { [Frame::Source {source},Frame::Interpreter {parent:FrameId(0),origin,x,z}] => (*source,Affine {origin:origin.map(|v|v.get()),x:x.map(|v|v.get()),z:z.map(|v|v.get())}),_=>return Err(no("frame")) };
    let rebuilt=construct(body.key.clone(),frame.0,frame.1,&points[..n],&points[n..],params[1])?;
    if rebuilt!=*body {return Err(no("boundary-not-construction"));}
    Ok(())
}
