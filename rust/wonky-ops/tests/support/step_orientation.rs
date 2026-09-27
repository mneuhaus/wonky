//! Raw STEP owner oracle. Do not import into OCCT: importers can heal a wholly
//! inverted shell, hiding the exporter regression this check must detect.
//! This parser follows entity references, not numbering or writer formatting.
use std::collections::{BTreeMap, BTreeSet};

type Point = [f64; 3];
fn sub(a: Point, b: Point) -> Point { std::array::from_fn(|k| a[k] - b[k]) }
fn cross(a: Point, b: Point) -> Point {
    [(1, 2), (2, 0), (0, 1)].map(|(i, j)| a[i] * b[j] - a[j] * b[i])
}
fn dot(a: Point, b: Point) -> f64 { (0..3).map(|k| a[k] * b[k]).sum() }
fn mean(points: &[Point]) -> Point {
    let base = points[0];
    std::array::from_fn(|k| base[k] + points.iter().map(|p| p[k] - base[k]).sum::<f64>() / points.len() as f64)
}
fn fields(s: &str) -> Vec<&str> {
    let (mut depth, mut quoted, mut start) = (0, false, 0);
    let mut out = Vec::new();
    for (i, c) in s.char_indices() {
        match c {
            '\'' => quoted = !quoted,
            '(' if !quoted => depth += 1,
            ')' if !quoted => depth -= 1,
            ',' if !quoted && depth == 0 => { out.push(s[start..i].trim()); start = i + 1; }
            _ => {}
        }
    }
    out.push(s[start..].trim());
    out
}
fn list(s: &str) -> Vec<&str> { fields(s.strip_prefix('(').unwrap().strip_suffix(')').unwrap()) }
fn sense(s: &str) -> bool { match s { ".T." => true, ".F." => false, _ => panic!("invalid STEP logical {s}") } }
struct Step<'a>(BTreeMap<&'a str, (&'a str, Vec<&'a str>)>);
impl<'a> Step<'a> {
    fn parse(text: &'a str) -> Self {
        let data = text.split("DATA;").nth(1).unwrap().split("ENDSEC;").next().unwrap();
        let mut entities = BTreeMap::new();
        for entry in data.split(';').map(str::trim).filter(|e| !e.is_empty()) {
            let (id, expression) = entry.split_once('=').unwrap();
            // The units/context use complex entities but are not geometric references.
            if expression.starts_with('(') { continue; }
            let (kind, args) = expression.split_once('(').unwrap();
            assert!(entities.insert(id.trim(), (kind.trim(), fields(args.strip_suffix(')').unwrap()))).is_none());
        }
        Self(entities)
    }
    fn get(&self, id: &str, kind: &str) -> &Vec<&'a str> {
        let (actual, fields) = self.0.get(id).unwrap_or_else(|| panic!("missing STEP reference {id}"));
        assert_eq!(*actual, kind, "STEP reference {id}");
        fields
    }
    fn vector(&self, id: &str, kind: &str) -> Point {
        let components = list(self.get(id, kind)[1]);
        assert_eq!(components.len(), 3);
        std::array::from_fn(|k| components[k].parse().unwrap())
    }
    fn vertex(&self, id: &str) -> Point { self.vector(self.get(id, "VERTEX_POINT")[1], "CARTESIAN_POINT") }
}

/// For convex planar fixtures, an outward face normal points away from the
/// arithmetic mean of the solid's vertices. Independently check both the edge
/// loop's winding and PLANE.axis * ADVANCED_FACE.same_sense. Neither a volume
/// absolute value nor an importer repair can make an inverted shell pass.
pub fn assert_outward_convex_solids(text: &str, expected_solids: usize) {
    let step = Step::parse(text);
    let solids: Vec<_> = step.0.iter().filter(|(_, (kind, _))| *kind == "MANIFOLD_SOLID_BREP").collect();
    assert_eq!(solids.len(), expected_solids);
    for (solid, (_, args)) in solids {
        let faces = list(step.get(args[1], "CLOSED_SHELL")[1]);
        assert!(faces.len() >= 4);
        let mut all_vertices = BTreeSet::new();
        let mut loops = Vec::new();
        let mut uses: BTreeMap<&str, Vec<bool>> = BTreeMap::new();
        for id in faces {
            let face = step.get(id, "ADVANCED_FACE");
            let bounds = list(face[1]);
            assert_eq!(bounds.len(), 1, "oracle fixture must be a convex polyhedron");
            let bound = step.get(bounds[0], "FACE_OUTER_BOUND");
            let edges = list(step.get(bound[1], "EDGE_LOOP")[1]);
            let mut ends = Vec::new();
            for id in edges {
                let coedge = step.get(id, "ORIENTED_EDGE");
                let edge = step.get(coedge[3], "EDGE_CURVE");
                let forward = sense(coedge[4]) == sense(bound[2]);
                uses.entry(coedge[3]).or_default().push(forward);
                let (a, b) = if sense(coedge[4]) { (edge[1], edge[2]) } else { (edge[2], edge[1]) };
                all_vertices.extend([a, b]);
                ends.push((a, b));
            }
            for k in 0..ends.len() { assert_eq!(ends[k].1, ends[(k + 1) % ends.len()].0, "raw STEP loop gap in {solid}/{id}"); }
            let mut points: Vec<_> = ends.iter().map(|(a, _)| step.vertex(a)).collect();
            if !sense(bound[2]) { points.reverse(); }
            let axis = step.get(step.get(face[2], "PLANE")[1], "AXIS2_PLACEMENT_3D")[2];
            let normal = step.vector(axis, "DIRECTION").map(|v| if sense(face[3]) { v } else { -v });
            loops.push((id, points, normal));
        }
        for (edge, uses) in uses {
            assert_eq!(uses.len(), 2, "raw STEP non-manifold edge {edge}");
            assert_ne!(uses[0], uses[1], "raw STEP inconsistent shell edge {edge}");
        }
        let centroid = mean(&all_vertices.iter().map(|id| step.vertex(id)).collect::<Vec<_>>());
        for (id, points, normal) in loops {
            let mut area = [0.; 3];
            for k in 1..points.len()-1 {
                let triangle = cross(sub(points[k], points[0]), sub(points[k + 1], points[0]));
                for j in 0..3 { area[j] += triangle[j]; }
            }
            let outward = sub(mean(&points), centroid);
            assert!(dot(area, outward) > 0., "raw STEP inward loop {solid}/{id}");
            assert!(dot(normal, outward) > 0., "raw STEP inward surface sense {solid}/{id}");
            assert!(dot(area, normal) > 0., "raw STEP loop/surface disagreement {solid}/{id}");
        }
    }
}

/// Cylinder oracle before importer healing: carrier sense, cap ring winding,
/// every edge paired oppositely, seam connectivity and both chart branches.
pub fn assert_outward_cylinders(text: &str, expected_solids: usize) {
    let step=Step::parse(text);
    let solids:Vec<_>=step.0.values().filter(|(kind,_)|*kind=="MANIFOLD_SOLID_BREP").collect();
    assert_eq!(solids.len(),expected_solids);
    for (_,solid) in solids {
        let faces=list(step.get(solid[1],"CLOSED_SHELL")[1]);assert_eq!(faces.len(),3);
        let mut caps=Vec::new();let mut uses:BTreeMap<&str,Vec<bool>>=BTreeMap::new();
        for id in faces {
            let face=step.get(id,"ADVANCED_FACE");let surface=&step.0[face[2]];
            let placement=step.get(surface.1[1],"AXIS2_PLACEMENT_3D");
            let origin=step.vector(placement[1],"CARTESIAN_POINT");let normal=step.vector(placement[2],"DIRECTION");
            let bounds=list(face[1]);assert_eq!(bounds.len(),1);
            let bound=step.get(bounds[0],"FACE_OUTER_BOUND");assert!(sense(bound[2]));
            let coedges=list(step.get(bound[1],"EDGE_LOOP")[1]);
            let mut ends=Vec::new();let mut ring_normal=None;
            for co in &coedges {
                let co=step.get(co,"ORIENTED_EDGE");let edge=step.get(co[3],"EDGE_CURVE");
                let forward=sense(co[4]);uses.entry(co[3]).or_default().push(forward);
                ends.push(if forward {(edge[1],edge[2])}else{(edge[2],edge[1])});
                let carrier=&step.0[edge[3]];assert!(carrier.0=="SURFACE_CURVE"||carrier.0=="SEAM_CURVE");
                if carrier.0=="SURFACE_CURVE" {
                    let circle=step.get(carrier.1[1],"CIRCLE");
                    let axis=step.get(circle[1],"AXIS2_PLACEMENT_3D")[2];
                    ring_normal=Some(step.vector(axis,"DIRECTION").map(|n|if forward{n}else{-n}));
                } else {
                    let pc=list(carrier.1[2]);assert_eq!(pc.len(),2);
                    let coords:Vec<_>=pc.iter().map(|p|{
                        let rep=step.get(step.get(p,"PCURVE")[2],"DEFINITIONAL_REPRESENTATION");
                        let line=step.get(list(rep[1])[0],"LINE");
                        list(step.get(line[1],"CARTESIAN_POINT")[1])[0].parse::<f64>().unwrap()
                    }).collect();
                    assert!((coords[1]-coords[0]-std::f64::consts::TAU).abs()<1e-14,"seam chart branches");
                }
            }
            for k in 0..ends.len(){assert_eq!(ends[k].1,ends[(k+1)%ends.len()].0,"cylinder loop gap");}
            if surface.0=="PLANE" {
                assert_eq!(coedges.len(),1);
                caps.push((origin,normal.map(|v|if sense(face[3]){v}else{-v}),ring_normal.unwrap()));
            } else {assert_eq!(surface.0,"CYLINDRICAL_SURFACE");assert!(sense(face[3]),"cylinder radial normal inverted");assert_eq!(coedges.len(),4);}
        }
        assert_eq!(caps.len(),2);let center=mean(&caps.iter().map(|c|c.0).collect::<Vec<_>>());
        for (origin,normal,winding) in caps {let out=sub(origin,center);assert!(dot(normal,out)>0.,"cap normal inward");assert!(dot(winding,out)>0.,"cap winding inward");}
        for (_,u) in uses {assert_eq!(u.len(),2);assert_ne!(u[0],u[1],"cylinder shell orientation mismatch");}
    }
}
