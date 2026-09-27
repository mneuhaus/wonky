//! Host operations behind the addon's `hostOp(words)` entry (HS1 seam, wire v3).
//!
//! Request: `[MAGIC, VERSION, op, ...payload]` as u32 words; a binary64 is two
//! words (low, high), the same bit transport as WC0 v3, so no decimal
//! conversion touches an input value (E9). Reply: `[status, ...payload]`, where
//! status 0 carries words or UTF-8-free text (one code point per word), and a
//! nonzero status carries a named reason as text.
//!
//! | op | request payload | reply |
//! |---:|---|---|
//! | 1 region | n, n x [u0 v0 u1 v1] | JSON: loops (segment uses), open wires |
//! | 2 prism | key[4] rev source[4] origin x z depth reverse loop n segs | WC0 v3 words |
//! | 3 measure | len words map? [12] nprobes probes[3] | JSON measurements |
//! | 4 step | name, n, n x (id, len words) | AP214 text |
//!
//! Every geometric decision happens in Rust on these exact inputs; the host
//! only routes and records. General measurements, no CAD-Acid-specific code.
use crate::affine::Affine;
use crate::extrude::{blind_prism, Prism, Refusal as ExtrudeRefusal};
use crate::polyhedron::{audit, Audited, Probe, Refused};
use crate::analytic as solid;
use wonky_contract::BodyKey;
use wonky_num::p2;
use wonky_sketch::region::{lines_region, Regions};
use wonky_sketch::Refusal as SketchRefusal;

pub const MAGIC: u32 = 0x3148_4b57; // little-endian bytes "WKH1"
pub const VERSION: u32 = 1;
pub const STATUS_OK: u32 = 0;
pub const STATUS_MALFORMED: u32 = 1;
/// A named refusal: the text is `<category>: <detail>`.
pub const STATUS_REFUSED: u32 = 7;

pub const OP_REGION: u32 = 1;
pub const OP_PRISM: u32 = 2;
pub const OP_MEASURE: u32 = 3;
pub const OP_STEP: u32 = 4;
pub const OP_STL: u32 = 5;
pub const OP_PATTERN: u32 = 8;
pub const OP_CUBOID: u32 = 10;
pub const OP_PLACEMENT: u32 = 11;
pub const OP_BOOLEAN: u32 = 12;
pub const OP_DISTANCE: u32 = 13;
pub const OP_EXTENTS: u32 = 14;
pub const OP_CYLINDER: u32 = 15;
pub const OP_QUERY: u32 = 16;
pub const OP_SHELL: u32 = 17;
pub const OP_CLOSEST_BOX_FACES: u32 = 18;
pub const OP_SPHERE: u32 = 30;
pub const OP_CLOSEST_EDGES: u32 = 32;
pub const OP_FILLET: u32 = 31;
pub const OP_CHAMFER: u32 = 33;
pub const OP_CIRCLE_REGION: u32 = 20;
pub const OP_PROFILE_REGION: u32 = 24;
pub const OP_PROFILE_EXTRUDE: u32 = 25;
pub const OP_ARC_REGION: u32 = 26;
pub const OP_ARC_EXTRUDE: u32 = 27;
pub const OP_CIRCLE_REVOLVE: u32 = 21;
pub const OP_FRAME_CIRCLE_REVOLVE: u32 = 22;
pub const OP_FRAME_POLYGON_REVOLVE: u32 = 23;

#[derive(Debug)]
enum Fail {
    Malformed(String),
    Refused(String),
}
type R<T> = Result<T, Fail>;

struct Reader<'a> {
    words: &'a [u32],
    at: usize,
}
impl Reader<'_> {
    fn u32(&mut self) -> R<u32> {
        let w = *self.words.get(self.at).ok_or_else(|| Fail::Malformed("request ends early".into()))?;
        self.at += 1;
        Ok(w)
    }
    fn f64(&mut self) -> R<f64> {
        let lo = self.u32()? as u64;
        let x = f64::from_bits(lo | ((self.u32()? as u64) << 32));
        if !x.is_finite() {
            return Err(Fail::Malformed("non-finite binary64".into()));
        }
        Ok(x)
    }
    fn f3(&mut self) -> R<[f64; 3]> {
        Ok([self.f64()?, self.f64()?, self.f64()?])
    }
    fn count(&mut self, per: usize) -> R<usize> {
        let n = self.u32()? as usize;
        if n.saturating_mul(per) > self.words.len() - self.at {
            return Err(Fail::Malformed("count exceeds the request".into()));
        }
        Ok(n)
    }
    fn words(&mut self) -> R<&[u32]> {
        let n = self.count(1)?;
        let s = &self.words[self.at..self.at + n];
        self.at += n;
        Ok(s)
    }
    fn text(&mut self) -> R<String> {
        self.words()?.iter().map(|&c| char::from_u32(c).ok_or_else(|| Fail::Malformed("text".into()))).collect()
    }
    fn segments(&mut self) -> R<Vec<[f64; 4]>> {
        let n = self.count(8)?;
        (0..n).map(|_| Ok([self.f64()?, self.f64()?, self.f64()?, self.f64()?])).collect()
    }
    fn arcs(&mut self) -> R<Vec<[f64; 6]>> {
        let n=self.count(12)?;
        (0..n).map(|_|Ok([self.f64()?,self.f64()?,self.f64()?,self.f64()?,self.f64()?,self.f64()?])).collect()
    }
    fn finish(&self) -> R<()> {
        if self.at != self.words.len() {
            return Err(Fail::Malformed("trailing request words".into()));
        }
        Ok(())
    }
}

fn sketch_refusal(r: SketchRefusal) -> Fail {
    let name = match r {
        SketchRefusal::Branching => "sketch/branching",
        SketchRefusal::UnsupportedIntersection => "sketch/intersection",
        SketchRefusal::Nested => "sketch/nested-loops",
        SketchRefusal::Degenerate => "sketch/degenerate",
        SketchRefusal::NumericDecision => "sketch/numeric-range",
        _ => "sketch/invalid",
    };
    Fail::Refused(format!("{name}: {r:?}"))
}

fn regions(segments: &[[f64; 4]]) -> R<Regions> {
    let s: Vec<_> = segments.iter().map(|s| [p2(s[0], s[1]), p2(s[2], s[3])]).collect();
    lines_region(&s).map_err(sketch_refusal)
}

fn num(x: f64) -> String {
    // Shortest round-trip digits; never NaN/Inf (guarded by the callers).
    let x = if x == 0.0 { 0.0 } else { x };
    format!("{x:?}")
}
fn nums(v: &[f64]) -> String {
    format!("[{}]", v.iter().map(|&x| num(x)).collect::<Vec<_>>().join(","))
}
fn refused(e: Refused) -> Fail {
    Fail::Refused(e.0)
}

enum HostBody { Solid(solid::Solid), Torus(crate::revolve::Torus), Sector(crate::revolve_sector::Sector) }
fn decode_any(words: &[u32]) -> R<HostBody> {
    let checked = wonky_wire::v3::decode(words).map_err(|e| Fail::Malformed(format!("WC0 v3 body: {e:?}")))?;
    if checked.body().surfaces.iter().any(|s| matches!(s.geometry, wonky_contract::SurfaceGeometry::Torus { .. })) {
        crate::revolve::audit(&checked).map(HostBody::Torus).map_err(refused)
    } else if checked.body().constructions.iter().any(|n| matches!(n.operation, wonky_contract::Operation::Revolve {})) {
        crate::revolve_sector::audit(&checked).map(HostBody::Sector).map_err(refused)
    } else { solid::audit(&checked).map(HostBody::Solid).map_err(refused) }
}
fn decode_body(words: &[u32]) -> R<Audited> {
    let checked = wonky_wire::v3::decode(words).map_err(|e| Fail::Malformed(format!("WC0 v3 body: {e:?}")))?;
    audit(&checked).map_err(refused)
}

fn decode_solid(words: &[u32]) -> R<solid::Solid> {
    let checked = wonky_wire::v3::decode(words).map_err(|e| Fail::Malformed(format!("WC0 v3 body: {e:?}")))?;
    solid::audit(&checked).map_err(refused)
}

pub fn measure_json(a: &Audited, map: Option<[[f64; 4]; 3]>, probes: &[[f64; 3]]) -> Result<String, Refused> {
    let volume = a.volume_mm3()?;
    let faces = a.face_areas_mm2()?;
    // Sum face observations exactly before rounding; a long face list must not
    // invalidate the fixed relative area certificate by accumulation error.
    let mut g = wonky_num::expansion::Guard::new();
    let mut total = Vec::new();
    for &face in &faces { total = wonky_num::expansion::sum(&total, &[face], &mut g); }
    if !g.exact() { return Err(Refused("observe/area-range".into())); }
    let area = crate::rounding::round(&total).map_err(|_| Refused("observe/area-range".into()))?;
    let (centroid, centroid_bound) = a.centroid_with_bound_mm()?;
    let perimeters = a.face_perimeters_mm()?;
    let (lo, hi) = a.bbox_mm(None)?;
    let mapped = match map {
        Some(m) => {
            let (l, h) = a.bbox_mm(Some(m))?;
            format!("{{\"min\":{},\"max\":{}}}", nums(&l), nums(&h))
        }
        None => "null".into(),
    };
    let t = a.topology();
    let defect = a.frame.orthonormality_defect().map_err(|_| Refused("observe/frame".into()))?;
    let tolerance = a.export_tolerance_mm()?;
    let probes: Vec<String> = probes
        .iter()
        .map(|&q| match a.distance_mm(q) {
            Probe::Measured { distance_mm, inside, bound_mm } => format!("{{\"distanceMm\":{},\"inside\":{inside},\"boundMm\":{}}}", num(distance_mm), num(bound_mm)),
            Probe::Refused(r) => format!("{{\"refused\":\"{r}\"}}"),
        })
        .collect();
    let world = a.world_vertices_mm()?;
    let body = &a.body;
    let reflected = a.frame.reversed().map_err(|_| Refused("observe/frame-orientation".into()))?;
    let faces_json: Vec<String> = body.faces.iter().map(|f| {
        let loops: Vec<String> = f.loops.iter().map(|l| {
            let lp=&body.loops[l.0 as usize];
            let mut coedges = lp.coedges.clone();
            if reflected { coedges.reverse(); }
            format!("[{}]",coedges.iter().map(|c| {let co=&body.coedges[c.0 as usize];format!("[{},{}]",co.edge.0,co.forward != reflected)}).collect::<Vec<_>>().join(","))
        }).collect();
        format!("[{}]",loops.join(","))
    }).collect();
    Ok(format!(
        concat!(
            "{{\"basis\":\"native-f64-construction\",\"certificate\":\"{}\",\"axis\":{},\"boundToConstruction\":{},",
            "\"volumeMm3\":{},\"volumeRelBound\":{},\"areaMm2\":{},\"areaRelBound\":{},\"faceAreasMm2\":{},\"facePerimetersMm\":{},",
            "\"centroidMm\":{},\"centroidBoundMm\":{},\"bboxMm\":{{\"min\":{},\"max\":{}}},\"mappedBboxMm\":{},",
            "\"topology\":{{\"bodies\":{},\"shells\":{},\"faces\":{},\"edges\":{},\"vertices\":{},\"loops\":{},\"ringEdges\":{},\"closedToroidalFaces\":{},\"genus\":{},\"singularPoints\":{},\"pinchPoints\":{}}},",
            "\"validity\":{{\"brep\":true,\"closed\":true,\"positive\":{}}},\"toleranceMm\":{},",
            "\"frame\":{{\"orthonormalityDefect\":{}}},\"probes\":[{}],",
            "\"projection\":{{\"vertices\":[{}],\"edges\":[{}],\"faces\":[{}]}}}}"
        ),
        if a.arcs.is_some() { "ThreePointArcPrism" } else if a.chamfer.is_some() { "PlanarChamfer" } else if a.corner.is_some() { "RollingBallCorner" } else if a.rounded.is_some() { "RollingBallPrism" } else if a.orthogonal.is_some() { "OrthogonalCells" } else if crate::planar_boolean::candidate(&a.body) { "ExactPlaneArrangement" } else { "AxisPrism" },
        if crate::planar_boolean::candidate(&a.body) { "null".into() } else { a.axis.to_string() },
        a.bound_to_construction,
        num(volume),
        num(if let Some(s)=&a.arcs { let v=s.volume(a)?; v.r/v.lo() } else if let Some(s)=&a.chamfer { let v=s.volume()?; v.r/v.lo() } else if let Some(s)=&a.corner { let v=s.volume(a)?; v.r/v.lo() } else if let Some(s)=&a.rounded { let v=s.volume(a)?; v.r/v.lo() } else { 2.0 * f64::EPSILON }),
        num(area),
        num(if let Some(s)=&a.arcs { let v=s.areas(a)?.into_iter().fold(wonky_num::Iv::point(0.),|x,y|x+y); v.r/v.lo() } else if let Some(s)=&a.chamfer { let v=s.areas()?.into_iter().fold(wonky_num::ball::Iv::point(0.),|x,y|x+y); v.r/v.lo() } else if let Some(s)=&a.corner { let v=s.areas(a)?.into_iter().fold(wonky_num::ball::Iv::point(0.),|x,y|x+y); v.r/v.lo() } else if let Some(s)=&a.rounded { let v=s.areas(a)?.into_iter().fold(wonky_num::ball::Iv::point(0.),|x,y|x+y); v.r/v.lo() } else { 64.0 * f64::EPSILON + 3.0 * defect }),
        nums(&faces),
        nums(&perimeters),
        nums(&centroid),
        nums(&centroid_bound),
        nums(&lo),
        nums(&hi),
        mapped,
        t.bodies,
        t.shells,
        t.faces,
        t.edges,
        t.vertices,
        t.loops,
        t.ring_edges,
        t.closed_toroidal_faces,
        t.genus,
        t.singular_points,
        t.pinch_points,
        volume > 0.0,
        num(tolerance),
        num(defect),
        probes.join(","),
        world.iter().map(|v| nums(v)).collect::<Vec<_>>().join(","),
        body.edges.iter().map(|e| format!("[{},{}]", e.vertices[0].0, e.vertices[1].0)).collect::<Vec<_>>().join(","),
        faces_json.join(","),
    ))
}

fn run(words: &[u32]) -> R<Vec<u32>> {
    let mut r = Reader { words, at: 0 };
    if r.u32()? != MAGIC || r.u32()? != VERSION {
        return Err(Fail::Malformed("host op magic/version".into()));
    }
    let text = |s: String| -> Vec<u32> { std::iter::once(STATUS_OK).chain(s.chars().map(|c| c as u32)).collect() };
    match r.u32()? {
        OP_SHELL => {
            let a = decode_body(r.words()?)?;
            let face = r.u32()? as usize;
            let thickness = r.f64()?;
            r.finish()?;
            let body = crate::planar_shell::shell(&a, face, thickness).map_err(refused)?;
            let words = wonky_wire::v3::encode(&body).map_err(|_| Fail::Refused("shell/wire".into()))?;
            decode_body(&words)?;
            Ok(std::iter::once(STATUS_OK).chain(words).collect())
        }
        OP_CLOSEST_BOX_FACES => {
            let a = decode_body(r.words()?)?;
            let point = r.f3()?;
            let tolerance = r.f64()?;
            let n = r.count(1)?;
            let faces = (0..n).map(|_| r.u32().map(|x| x as usize)).collect::<R<Vec<_>>>()?;
            r.finish()?;
            let selected = crate::planar_shell::closest_faces(&a, &faces, point, tolerance).map_err(refused)?;
            Ok(std::iter::once(STATUS_OK).chain(selected.into_iter().map(|x| x as u32)).collect())
        }
        OP_CLOSEST_EDGES => {
            let point = r.f3()?;
            let tie = r.f64()?;
            let n = r.count(2)?;
            let mut bodies = Vec::with_capacity(n);
            let mut indices = Vec::with_capacity(n);
            for _ in 0..n {
                bodies.push(decode_body(r.words()?)?);
                indices.push(r.u32()? as usize);
            }
            r.finish()?;
            let candidates: Vec<_> = bodies.iter().zip(indices).collect();
            let selected = crate::edge_query::closest(&candidates, point, tie).map_err(refused)?;
            Ok(std::iter::once(STATUS_OK).chain(selected.into_iter().map(|i| i as u32)).collect())
        }
        op @ (OP_FILLET | OP_CHAMFER) => {
            let body = decode_body(r.words()?)?;
            let radius = r.f64()?;
            let n = r.count(1)?;
            let edges = (0..n).map(|_| r.u32().map(|i| i as usize)).collect::<R<Vec<_>>>()?;
            r.finish()?;
            let blended = if op == OP_CHAMFER { crate::chamfer::equal_offsets(&body, &edges, radius) }
                else { crate::fillet::constant_radius(&body, &edges, radius) }.map_err(refused)?;
            let words = wonky_wire::v3::encode(&blended).map_err(|_| Fail::Refused("fillet/wire".into()))?;
            decode_body(&words)?;
            Ok(std::iter::once(STATUS_OK).chain(words).collect())
        }
        OP_PATTERN => {
            let body = r.words()?.to_vec();
            let key = BodyKey {
                id: [r.u32()?, r.u32()?, r.u32()?, r.u32()?],
                revision: r.u32()?,
            };
            let rows = [r.f3()?, r.f3()?, r.f3()?];
            let translation = r.f3()?;
            r.finish()?;
            let copy = match decode_solid(&body)? {
                solid::Solid::Planar(a) => crate::pattern::copy(&a,key,rows,translation).map_err(refused)?.body,
                solid::Solid::Cylinder(c) => crate::cylinder::copy(&c,key,rows,translation).map_err(refused)?,
                _ => return Err(Fail::Refused("pattern/carrier-family".into())),
            };
            let words = wonky_wire::v3::encode(&copy)
                .map_err(|e| Fail::Refused(format!("pattern/contract: {e:?}")))?;
            Ok(std::iter::once(STATUS_OK).chain(words).collect())
        }
        OP_SPHERE => {
            let key = BodyKey { id:[r.u32()?,r.u32()?,r.u32()?,r.u32()?],revision:0 };
            let (center, radius) = (r.f3()?, r.f64()?); r.finish()?;
            let body = crate::sphere::sphere(key, center, radius).map_err(refused)?;
            let words = wonky_wire::v3::encode(&body).map_err(|_|Fail::Refused("sphere/wire".into()))?;
            decode_solid(&words)?;
            Ok(std::iter::once(STATUS_OK).chain(words).collect())
        }
        OP_QUERY => {
            let a = decode_solid(r.words()?)?;
            let mode = r.u32()?;
            let count = r.count(2)?;
            let selected = (0..count).map(|_| Ok(crate::query::Entity { kind: r.u32()?, index: r.u32()? })).collect::<R<Vec<_>>>()?;
            let result = match mode {
                0 => crate::query::owned(&a, r.u32()?),
                1 => crate::query::geometry(&a, &selected, &r.text()?),
                2 => crate::query::adjacent(&a, &selected, r.u32()?),
                3 => crate::query::coincides(&a, &selected, r.f3()?, r.f3()?),
                4 => crate::query::parallel_edges(&a, &selected, r.f3()?),
                5 => {
                    let frame = Affine { origin: r.f3()?, x: r.f3()?, z: r.f3()? };
                    crate::query::coincides_in_frame(&a, &selected, frame, r.f3()?, r.f3()?)
                }
                _ => return Err(Fail::Malformed("query operation".into())),
            }.map_err(refused)?;
            r.finish()?;
            let mut reply = vec![STATUS_OK, result.len() as u32];
            for e in result { reply.extend([e.kind, e.index]); }
            Ok(reply)
        }
        OP_CYLINDER => {
            let key = BodyKey { id:[r.u32()?,r.u32()?,r.u32()?,r.u32()?],revision:0 };
            let spec=crate::cylinder::Spec {bottom:r.f3()?,top:r.f3()?,radius:r.f64()?};r.finish()?;
            let body=crate::cylinder::create(key,spec).map_err(refused)?;
            let words=wonky_wire::v3::encode(&body).map_err(|_|Fail::Refused("cylinder/wire".into()))?;
            decode_solid(&words)?;
            Ok(std::iter::once(STATUS_OK).chain(words).collect())
        }
        OP_CUBOID => {
            let key = BodyKey { id:[r.u32()?,r.u32()?,r.u32()?,r.u32()?],revision:0 };
            let (a,b) = (r.f3()?,r.f3()?); r.finish()?;
            let body=crate::orthogonal::cuboid(key,a,b).map_err(refused)?;
            let words=wonky_wire::v3::encode(&body).map_err(|_|Fail::Refused("cuboid/wire".into()))?;
            decode_body(&words)?;
            Ok(std::iter::once(STATUS_OK).chain(words).collect())
        }
        OP_PLACEMENT => {
            let a=decode_solid(r.words()?)?;
            let frame=Affine {origin:r.f3()?,x:r.f3()?,z:r.f3()?};r.finish()?;
            let body=a.transform(frame).map_err(refused)?;
            let words=wonky_wire::v3::encode(&body).map_err(|_|Fail::Refused("placement/wire".into()))?;
            decode_solid(&words)?;
            Ok(std::iter::once(STATUS_OK).chain(words).collect())
        }
        OP_BOOLEAN => {
            let key = BodyKey { id:[r.u32()?,r.u32()?,r.u32()?,r.u32()?],revision:0 };
            let op=r.u32()?; if op>2 { return Err(Fail::Malformed("boolean operation".into())); }
            let n=r.count(1)?;let bodies=(0..n).map(|_|decode_solid(r.words()?)).collect::<R<Vec<_>>>()?;r.finish()?;
            let bodies=solid::boolean(key,op as u8,&bodies).map_err(refused)?;
            let mut reply=vec![STATUS_OK,bodies.len() as u32];
            for (i,mut body) in bodies.into_iter().enumerate() {
                body.key.revision=i as u32;
                let words=wonky_wire::v3::encode(&body).map_err(|_|Fail::Refused("boolean/wire".into()))?;
                decode_solid(&words)?;reply.push(words.len() as u32);reply.extend(words);
            }
            Ok(reply)
        }
        OP_DISTANCE => {
            let (a,b)=(decode_solid(r.words()?)?,decode_solid(r.words()?)?);r.finish()?;
            let (distance,bound)=solid::distance(&a,&b).map_err(refused)?;
            Ok(text(format!("{{\"distanceMm\":{},\"boundMm\":{}}}",num(distance),num(bound))))
        }
        OP_EXTENTS => {
            let a=decode_solid(r.words()?)?;r.finish()?;
            Ok(text(nums(&a.extents().map_err(refused)?)))
        }
        OP_ARC_REGION => {
            let lines=r.segments()?;let arcs=r.arcs()?;r.finish()?;
            crate::arc_profile::Profile::new(&lines,&arcs).map_err(refused)?;
            Ok(text("{\"loops\":[{}],\"openWires\":0}".into()))
        }
        OP_ARC_EXTRUDE => {
            let key=BodyKey{id:[r.u32()?,r.u32()?,r.u32()?,r.u32()?],revision:r.u32()?};
            let frame=Affine{origin:r.f3()?,x:r.f3()?,z:r.f3()?};let depth=r.f64()?;let reverse=r.u32()?;
            if reverse>1{return Err(Fail::Malformed("arc reverse flag".into()));}
            let lines=r.segments()?;let arcs=r.arcs()?;r.finish()?;
            let body=crate::arc_profile::build(key,frame,&lines,&arcs,depth,reverse==1).map_err(refused)?;
            let words=wonky_wire::v3::encode(&body).map_err(|_|Fail::Refused("arc-profile/wire".into()))?;
            decode_solid(&words)?;
            Ok(std::iter::once(STATUS_OK).chain(words).collect())
        }
        OP_PROFILE_REGION => {
            let circle=r.f3()?; let segments=r.segments()?; r.finish()?;
            crate::circle_profile::rectangle(&segments,circle).map_err(refused)?;
            Ok(text("{\"loops\":[{\"hole\":0},{\"circle\":0}],\"openWires\":0}".into()))
        }
        OP_PROFILE_EXTRUDE => {
            let key=BodyKey {id:[r.u32()?,r.u32()?,r.u32()?,r.u32()?],revision:r.u32()?};
            let frame=Affine {origin:r.f3()?,x:r.f3()?,z:r.f3()?};
            let circle=r.f3()?; let depth=r.f64()?;
            let reverse=r.u32()?; let disk=r.u32()?;
            if reverse>1 || disk>1 { return Err(Fail::Malformed("profile flags".into())); }
            let segments=r.segments()?;r.finish()?;
            let body=crate::circle_profile::extrude(key,frame,circle,&segments,depth,reverse==1,disk==1).map_err(refused)?;
            let words=wonky_wire::v3::encode(&body).map_err(|_|Fail::Refused("circle-profile/wire".into()))?;
            decode_solid(&words)?;
            Ok(std::iter::once(STATUS_OK).chain(words).collect())
        }
        OP_CIRCLE_REGION => {
            let center = [r.f64()?, r.f64()?]; let radius = r.f64()?; r.finish()?;
            wonky_sketch::circle_region::circle_region(center, radius).map_err(sketch_refusal)?;
            Ok(text("{\"loops\":[{\"circle\":0}],\"openWires\":0}".into()))
        }
        OP_FRAME_POLYGON_REVOLVE => {
            let key = BodyKey { id: [r.u32()?,r.u32()?,r.u32()?,r.u32()?], revision: r.u32()? };
            let source = [r.u32()?,r.u32()?,r.u32()?,r.u32()?];
            let frame = Affine { origin:r.f3()?,x:r.f3()?,z:r.f3()? };
            let angle = r.f64()?; let segments = r.segments()?; r.finish()?;
            let body = crate::revolve_sector::build(key,source,frame,&segments,angle).map_err(refused)?;
            let words = wonky_wire::v3::encode(&body).map_err(|e|Fail::Refused(format!("revolve/contract: {e:?}")))?;
            decode_any(&words)?;
            Ok(std::iter::once(STATUS_OK).chain(words).collect())
        }
        OP_FRAME_CIRCLE_REVOLVE => {
            let key = BodyKey { id: [r.u32()?,r.u32()?,r.u32()?,r.u32()?], revision: r.u32()? };
            let source = [r.u32()?,r.u32()?,r.u32()?,r.u32()?];
            let frame = Affine { origin:r.f3()?,x:r.f3()?,z:r.f3()? };
            let disk = wonky_sketch::circle_region::Disk { center:[r.f64()?,r.f64()?],radius:r.f64()? };
            let angle = r.f64()?; r.finish()?;
            let body = crate::revolve::circle_revolve_in_frame(key,source,frame,disk,angle).map_err(refused)?;
            let words = wonky_wire::v3::encode(&body).map_err(|e|Fail::Refused(format!("revolve/contract: {e:?}")))?;
            decode_any(&words)?;
            Ok(std::iter::once(STATUS_OK).chain(words).collect())
        }
        OP_CIRCLE_REVOLVE => {
            let key = BodyKey { id: [r.u32()?,r.u32()?,r.u32()?,r.u32()?], revision: r.u32()? };
            let source = [r.u32()?,r.u32()?,r.u32()?,r.u32()?];
            let sketch = Affine { origin:r.f3()?,x:r.f3()?,z:r.f3()? };
            let axis_origin=r.f3()?; let axis=r.f3()?;
            let disk=wonky_sketch::circle_region::Disk { center:[r.f64()?,r.f64()?],radius:r.f64()? };
            let angle=r.f64()?; r.finish()?;
            let body=crate::revolve::circle_revolve(&crate::revolve::CircleRevolve {key,source,sketch,axis_origin,axis,disk,angle}).map_err(refused)?;
            let words=wonky_wire::v3::encode(&body).map_err(|e|Fail::Refused(format!("revolve/contract: {e:?}")))?;
            decode_any(&words)?;
            Ok(std::iter::once(STATUS_OK).chain(words).collect())
        }
        OP_REGION => {
            let segments = r.segments()?;
            r.finish()?;
            let g = regions(&segments)?;
            let loops: Vec<String> = g
                .loops
                .iter()
                .map(|l| format!("{{\"uses\":[{}]}}", l.uses.iter().map(|(s, f)| format!("[{s},{f}]")).collect::<Vec<_>>().join(",")))
                .collect();
            Ok(text(format!("{{\"loops\":[{}],\"openWires\":{}}}", loops.join(","), g.open_wires)))
        }
        OP_PRISM => {
            let key = BodyKey { id: [r.u32()?, r.u32()?, r.u32()?, r.u32()?], revision: r.u32()? };
            let source = [r.u32()?, r.u32()?, r.u32()?, r.u32()?];
            let frame = Affine { origin: r.f3()?, x: r.f3()?, z: r.f3()? };
            let depth = r.f64()?;
            let reverse = match r.u32()? {
                0 => false,
                1 => true,
                _ => return Err(Fail::Malformed("reverse flag".into())),
            };
            let index = r.u32()? as usize;
            let segments = r.segments()?;
            r.finish()?;
            // The region is recomputed here from the segments; the host cannot
            // hand in a loop of its own.
            let g = regions(&segments)?;
            let region = g.loops.get(index).ok_or_else(|| Fail::Malformed("region index".into()))?;
            let body = blind_prism(&Prism { key, source, frame, segments: &segments, region, depth, reverse }).map_err(|e| match e {
                ExtrudeRefusal::LateralNormalNotExact { edge } => Fail::Refused(format!("extrude/lateral-normal-not-exact: profile edge {edge}")),
                ExtrudeRefusal::Depth => Fail::Refused("extrude/depth: not a positive finite length".into()),
                ExtrudeRefusal::Contract(m) => Fail::Refused(format!("extrude/contract: {m}")),
            })?;
            let words = wonky_wire::v3::encode(&body).map_err(|e| Fail::Refused(format!("extrude/contract: {e:?}")))?;
            // The produced body must pass its own audit before it leaves Rust.
            decode_body(&words)?;
            Ok(std::iter::once(STATUS_OK).chain(words).collect())
        }
        OP_MEASURE => {
            let body = r.words()?.to_vec();
            let map = match r.u32()? {
                0 => None,
                1 => {
                    let mut m = [[0.0; 4]; 3];
                    for row in &mut m {
                        for v in row.iter_mut() {
                            *v = r.f64()?;
                        }
                    }
                    Some(m)
                }
                _ => return Err(Fail::Malformed("map flag".into())),
            };
            let n = r.count(6)?;
            let probes: Vec<[f64; 3]> = (0..n).map(|_| r.f3()).collect::<R<_>>()?;
            r.finish()?;
            let json = match decode_any(&body)? {
                HostBody::Solid(a) => a.measure(map, &probes),
                HostBody::Torus(a) => a.measure_json(map, &probes),
                HostBody::Sector(a) => a.measure_json(map, &probes),
            }.map_err(refused)?;
            Ok(text(json))
        }
        OP_STL => {
            let deviation = r.f64()?;
            let n = r.count(1)?;
            let mut meshes = Vec::with_capacity(n);
            for _ in 0..n {
                let words = r.words()?;
                // Preserve the modelling-family audits. WC0's structural check
                // alone is not a proof of an embedded, oriented solid.
                decode_any(words)?;
                let checked = wonky_wire::v3::decode(words)
                    .map_err(|e| Fail::Malformed(format!("WC0 v3 body: {e:?}")))?;
                meshes.push(crate::mesh::tessellate(&checked, deviation).map_err(refused)?);
            }
            r.finish()?;
            let bytes = crate::mesh::binary_stl(&meshes, deviation).map_err(refused)?;
            let mut reply = Vec::with_capacity(2 + bytes.len().div_ceil(4));
            reply.extend([STATUS_OK, bytes.len() as u32]);
            for chunk in bytes.chunks(4) {
                let mut word = [0;4]; word[..chunk.len()].copy_from_slice(chunk);
                reply.push(u32::from_le_bytes(word));
            }
            Ok(reply)
        }
        OP_STEP => {
            let name = r.text()?;
            let n = r.count(2)?;
            let mut bodies = Vec::with_capacity(n);
            for _ in 0..n {
                let id = r.text()?;
                let words = r.words()?.to_vec();
                bodies.push((id, decode_any(&words)?));
            }
            r.finish()?;
            let torus = !bodies.is_empty() && bodies.iter().all(|(_,b)|matches!(b,HostBody::Torus(_)));
            let solids = bodies.iter().all(|(_,b)|matches!(b,HostBody::Solid(_)));
            let output = if torus {
                let named: Vec<_> = bodies.iter().filter_map(|(id,b)|if let HostBody::Torus(a)=b {Some((id.clone(),a))}else{None}).collect();
                crate::revolve_step::write(&named,&name)
            } else if !bodies.is_empty() && bodies.iter().all(|(_,b)|matches!(b,HostBody::Sector(_))) {
                let named: Vec<_> = bodies.iter().filter_map(|(id,b)|if let HostBody::Sector(a)=b {Some((id.clone(),a))}else{None}).collect();
                crate::revolve_sector_step::write(&named,&name)
            } else if solids {
                let named: Vec<_> = bodies.iter().filter_map(|(id,b)|if let HostBody::Solid(a)=b {Some((id.clone(),a.clone()))}else{None}).collect();
                solid::step(&named,&name)
            } else { Err(Refused("export/mixed-analytic-families".into())) };
            Ok(text(output.map_err(refused)?))
        }
        op => Err(Fail::Malformed(format!("unknown host op {op}"))),
    }
}

/// The addon entry: never panics through (the caller also catches unwinds).
pub fn host_op(words: &[u32]) -> Vec<u32> {
    let reply = |status: u32, s: String| std::iter::once(status).chain(s.chars().map(|c| c as u32)).collect();
    match run(words) {
        Ok(w) => w,
        Err(Fail::Malformed(m)) => reply(STATUS_MALFORMED, m),
        Err(Fail::Refused(m)) => reply(STATUS_REFUSED, m),
    }
}
