//! Owner-boundary tests: exact affine copies and exact disjoint solid distance.
//! Rational oracle calculations do not call placement's coefficient helpers.
//! Regression classes: transform order, rounded intermediate world vertices,
//! orientation loss, copy lineage loss, distance projection/clamping mistakes.
use num_rational::BigRational as Q;
use num_traits::{Signed, ToPrimitive};
use wonky_contract::*;
use wonky_num::p2;
use wonky_ops::{affine::Affine, distance, extrude::{blind_prism, Prism}, host, pattern, placement::Placement, polyhedron::{audit, Audited, Probe}, step};
use wonky_oracle::binary64;
use wonky_sketch::region::lines_region;
#[path = "support/step_orientation.rs"]
mod step_orientation;
fn q(x: f64) -> Q { binary64(x).unwrap() }
fn key(k: u32) -> BodyKey { BodyKey { id:[k,2,3,4], revision: k } }
fn prism(points: &[[f64;2]], depth: f64, frame: Affine) -> Audited {
    let segments: Vec<_> = points.iter().enumerate().map(|(i,a)| {let b=points[(i+1)%points.len()]; [a[0],a[1],b[0],b[1]]}).collect();
    let pairs: Vec<_> = segments.iter().map(|s| [p2(s[0],s[1]),p2(s[2],s[3])]).collect();
    let region = lines_region(&pairs).unwrap();
    let body=blind_prism(&Prism{key:key(1), source:[0;4], frame,segments:&segments,region:&region.loops[0],depth,reverse:false}).unwrap();
    audit(&body.check().unwrap()).unwrap()
}
const ID: [[f64;3];3] = [[1.,0.,0.],[0.,1.,0.],[0.,0.,1.]];
const MIRROR: [[f64;3];3] = [[-1.,0.,0.],[0.,1.,0.],[0.,0.,1.]];
fn image(p: [Q;3], rows: [[f64;3];3], t: [f64;3]) -> [Q;3] {
    std::array::from_fn(|k| q(t[k])+(0..3).map(|j| q(rows[k][j])*&p[j]).sum::<Q>())
}
fn source_image(p: [f64;3], f: Affine) -> [Q;3] {
    let x=f.x.map(q);let z=f.z.map(q);
    let y=[&z[1]*&x[2]-&z[2]*&x[1],&z[2]*&x[0]-&z[0]*&x[2],&z[0]*&x[1]-&z[1]*&x[0]];
    std::array::from_fn(|k| q(f.origin[k])+q(p[0])*&x[k]+q(p[1])*&y[k]+q(p[2])*&z[k])
}
fn nearest(x: &Q) -> f64 {
    let seed=x.to_f64().unwrap();
    [seed.next_down(),seed,seed.next_up()].into_iter().min_by(|a,b| (x-q(*a)).abs().cmp(&(x-q(*b)).abs()).then_with(|| (a.to_bits() & 1).cmp(&(b.to_bits() & 1)))).unwrap()
}
fn determinant(m: [[f64;3];3]) -> Q {
    q(m[0][0])*(q(m[1][1])*q(m[2][2])-q(m[1][2])*q(m[2][1]))
        - q(m[0][1])*(q(m[1][0])*q(m[2][2])-q(m[1][2])*q(m[2][0]))
        + q(m[0][2])*(q(m[1][0])*q(m[2][1])-q(m[1][1])*q(m[2][0]))
}
#[test]
fn random_copies_preserve_local_geometry_and_exact_noncommuting_world_image() {
    let mut state=93613u64;
    let mut random=||{state=state.wrapping_mul(6364136223846793005).wrapping_add(1); ((state>>33)%101) as f64};
    for i in 0..64 {
        let a=(random()+1.)/1024.;let w=(random()+1.)/512.;let h=(random()+1.)/512.;let d=(random()+1.)/1024.;
        let frame=Affine{origin:[random()*1024.25,-random()/8.,random()/32.],x:[0.9950041652780258,0.09983341664682815,0.],z:[0.,0.,1.]};
        let source=prism(&[[a,0.],[a+w,0.],[a,h]],d,frame);
        let angle=(random()+1.)/31.;let (s,c)=angle.sin_cos();
        let r=[[c,-s,0.],[s,c,0.],[0.,0.,1.]];
        let t=[random()/7.,-random()/11.,random()/13.];let t2=[-random()/17.,random()/19.,-random()/23.];
        let first=pattern::copy(&source,key(10+i),r,t).unwrap();
        let second=pattern::copy(&first,key(100+i),MIRROR,t2).unwrap();
        assert_eq!(source.body.constructions, second.body.constructions[..source.body.constructions.len()]);
        assert!(second.bound_to_construction);
        assert_eq!(second.body.key,key(100+i));
        assert_eq!(second.topology(),source.topology());
        assert!(second.frame.reversed().unwrap());
        let recovered=wonky_wire::v3::decode(&wonky_wire::v3::encode(&second.body).unwrap()).unwrap();
        // Exercise the decoded body at the numeric owner, without formatting
        // entire bodies on failure. The wire contract has its own codec owner.
        let second = audit(&recovered).unwrap();
        for (index,v) in source.body.vertices.iter().enumerate() {
            let p=v.point.map(|v|v.get());
            let exact=image(image(source_image(p,frame),r,t),MIRROR,t2).map(|v| v*q(1000.));
            let actual=second.world_vertices_mm().unwrap()[index];
            for k in 0..3 { assert_eq!(actual[k],nearest(&exact[k]),"seed {i} vertex {index} axis {k}"); }
        }
        let expected=q(w)*q(h)*q(d)/q(2.)*q(1e9)*(q(frame.x[0])*q(frame.x[0])+q(frame.x[1])*q(frame.x[1]))*determinant(r).abs();
        let actual=second.volume_mm3().unwrap();
        assert!((q(actual)-&expected).abs()<=expected.abs()*q(2.*f64::EPSILON));
    }
}
// Raw export owns the orientation contract: an OCCT round-trip can heal an
// inside-out shell. Cover positive, negative and composed positive parity,
// with non-axis-aligned carriers and a large world offset. No production seam.
#[test]
fn raw_step_faces_are_outward_after_odd_and_even_reflections() {
    for frame in [Affine::IDENTITY, Affine { origin: [65536.25, -32768.5, 16384.125], x: [0.6, 0.8, 0.], z: [0., 0., 1.] }] {
        let source = prism(&[[0.125, 0.], [0.625, 0.], [0.125, 0.375]], 0.25, frame);
        let mirrored = pattern::copy(&source, key(2), MIRROR, [0.5, -0.25, 0.125]).unwrap();
        let twice = pattern::copy(&mirrored, key(3), MIRROR, [-0.75, 0.5, -0.25]).unwrap();
        let out = step::write(&[("seed".into(), &source), ("odd".into(), &mirrored), ("even".into(), &twice)], "orientation").unwrap();
        step_orientation::assert_outward_convex_solids(&out, 3);
    }
}
#[test]
fn copy_contract_rejects_singular_metric_nonfinite_and_forged_lineage() {
    let source=prism(&[[0.,0.],[1.,0.],[1.,1.],[0.,1.]],1.,Affine::IDENTITY);
    for (rows,t) in [([[0.;3];3],[0.;3]), ([[2.,0.,0.],[0.,1.,0.],[0.,0.,1.]],[0.;3]), (ID,[f64::NAN,0.,0.])] {
        assert!(pattern::copy(&source,key(2),rows,t).is_err());
    }
    let copied=pattern::copy(&source,key(2),MIRROR,[0.;3]).unwrap();
    let mut b=copied.body.clone();
    let last=b.constructions.len()-1;b.constructions[last].parents=vec![NodeId(0)];
    assert!(b.check().is_err(),"transform input must be in the affine base frame");
    for (parents, parameters) in [
        (vec![NodeId(4), NodeId(4)], vec![]),
        (vec![NodeId(4)], vec![Binary64::new(1.).unwrap()]),
    ] {
        let mut forged = copied.body.clone();
        forged.constructions[last].parents = parents;
        forged.constructions[last].parameters = parameters;
        let error = forged.check().unwrap_err();
        assert!(format!("{error:?}").contains("affine rule arity"), "unexpected rejection: {error:?}");
    }
    let mut b=copied.body.clone();b.vertices[0].point[0]=Binary64::new(0.125).unwrap();
    assert!(b.check().and_then(|c| Ok(audit(&c).is_err())).unwrap());
    let mut b=copied.body.clone();
    b.frames[2]=Frame::AffineImage{base:FrameId(2),translation:[Binary64::new(0.).unwrap();3],rows:ID.map(|r|r.map(|v|Binary64::new(v).unwrap()))};
    assert!(Placement::from_frames(&b,FrameId(2)).is_err());
    assert!(b.check().is_err());
    // An unused cyclic frame is still invalid WC0; entity provenance must not
    // be the incidental reason the frame-cycle guard is tested.
    let mut b = source.body.clone();
    b.frames.push(Frame::AffineImage { base: FrameId(2), translation: [Binary64::new(0.).unwrap(); 3], rows: ID.map(|r| r.map(|x| Binary64::new(x).unwrap())) });
    assert!(format!("{:?}", b.check().unwrap_err()).contains("affine image cycle/forward reference"));
    let mut deep = source.body.clone();
    deep.frames.resize(255, Frame::Source { source: [0; 4] });
    let deep = audit(&deep.check().unwrap()).unwrap();
    let last = pattern::copy(&deep, key(3), ID, [0.; 3]).unwrap();
    assert_eq!(pattern::copy(&last, key(4), ID, [0.; 3]).unwrap_err().0, "pattern/frame-depth");
    // The declared metric ceiling is inclusive. A shear makes the off-diagonal
    // Gram entry exact, so next_up(shear) reaches the ceiling without a guess.
    let mut rows = ID; rows[0][1] = 1e-9_f64.next_down();
    assert!(pattern::copy(&source, key(5), rows, [0.; 3]).is_ok());
    rows[0][1] = 1e-9;
    assert_eq!(pattern::copy(&source, key(6), rows, [0.; 3]).unwrap_err().0, "pattern/metric-not-near-isometric");
}
#[test]
fn exact_gap_reflection_and_diagonal_distances_enclose_closed_forms() {
    // Random dyadic boxes: gap vector to the closest points is known without
    // using the implementation's triangulation or segment algorithm.
    for i in 1..13 {
        let w=(i+3) as f64/512.;let h=(i+7) as f64/1024.;let d=(i+5) as f64/1024.;
        let a=prism(&[[0.,0.],[w,0.],[w,h],[0.,h]],d,Affine::IDENTITY);
        let dx=i as f64/1024.;let dy=(i%5) as f64/1024.;let dz=(i%3) as f64/2048.;
        let b=pattern::copy(&a,key(2),ID,[w+dx,h+dy,d+dz]).unwrap();
        let distance=distance::between(&a,&b).unwrap();
        let square=(q(dx)*q(dx)+q(dy)*q(dy)+q(dz)*q(dz))*q(1e6);
        assert!(q(distance.lower_mm)*q(distance.lower_mm)<=square);
        assert!(q(distance.upper_mm)*q(distance.upper_mm)>=square);
        assert!(distance.upper_mm-distance.lower_mm<=distance.distance_mm*1e-14);
        let reverse=distance::between(&b,&a).unwrap();
        assert_eq!(distance.distance_mm,reverse.distance_mm);
        let shift=[65536.25,-32768.5,16384.125];
        let aa=pattern::copy(&a,key(3),ID,shift).unwrap();let bb=pattern::copy(&b,key(4),ID,shift).unwrap();
        assert_eq!(distance.distance_mm,distance::between(&aa,&bb).unwrap().distance_mm,"exact large-translation cancellation");
    }
    // Parallel nearest edges overlap only in their interiors along Z. Their
    // endpoints have different heights, and neither adjacent face contains the
    // projected vertex. This owns point-to-edge clamping/division, which the
    // all-axis gaps above do not reach (their minima are endpoint/endpoint).
    for height in [2., 3., 5.] {
        let a = prism(&[[0., 0.], [1., 0.], [1., 1.], [0., 1.]], height, Affine::IDENTITY);
        let b = prism(&[[2., 3.], [2.25, 3.], [2.25, 3.5], [2., 3.5]], 0.5, Affine::IDENTITY);
        let b = pattern::copy(&b, key(7), ID, [0., 0., 0.75]).unwrap();
        let distance = distance::between(&a, &b).unwrap();
        let square = q(5e6);
        assert!(q(distance.lower_mm) * q(distance.lower_mm) <= square && q(distance.upper_mm) * q(distance.upper_mm) >= square,
            "parallel overlapping edges: {distance:?}");
    }
    // Closest vertex projects strictly inside an oblique lateral face, not
    // onto an edge. With triangle (0,0),(3,0),(0,4), 4x+3y=12; the closest
    // corner (2,3) has distance (17-12)/5=1. Translate and scale dyadically.
    for i in 1..8 {
        let s=i as f64/64.;
        let triangle=prism(&[[0.,0.],[3.*s,0.],[0.,4.*s]],2.*s,Affine::IDENTITY);
        let block=prism(&[[2.*s,3.*s],[2.25*s,3.*s],[2.25*s,3.25*s],[2.*s,3.25*s]],s,Affine::IDENTITY);
        let block=pattern::copy(&block,key(8),ID,[0.,0.,s/2.]).unwrap();
        let d=distance::between(&triangle,&block).unwrap();
        assert!(d.lower_mm<=s*1000. && d.upper_mm>=s*1000., "interior face distance: {d:?}");
    }
    // Skew edge/edge interior minimum: A's front/top edge is along X;
    // B's near edge is along (0,1,1), with separation (0,-g,g).
    // Face or endpoint minima are strictly farther; d²=2g², independently.
    for i in 1..5 {
        let g=i as f64/16.;
        let a=prism(&[[-2.,0.],[3.,0.],[-2.,4.]],3.,Affine{origin:[0.;3],x:[1.,0.,0.],z:[0.,1.,0.]});
        for shear in [0., 0.25, 0.5, 0.75] {
            let b=prism(&[[-3.,0.],[2.,0.],[-3.,4.]],1.,Affine{origin:[0.25,-g,g],x:[shear,1.,1.],z:[1.,0.,0.]});
            let d=distance::between(&a,&b).unwrap();let square=q(2.)*q(g)*q(g)*q(1e6);
            assert!(q(d.lower_mm)*q(d.lower_mm)<=square && q(d.upper_mm)*q(d.upper_mm)>=square,"nonorthogonal skew edges: {d:?}");
        }
    }
    // Collinear sketch vertices are legal. A fan triangle can be degenerate;
    // its Voronoi test must fall back to edges, never divide by zero.
    let collinear = prism(&[[0.,0.],[0.5,0.],[1.,0.],[1.,1.],[0.,1.]], 1., Affine::IDENTITY);
    let shifted = pattern::copy(&collinear, key(2), ID, [2.,0.,0.]).unwrap();
    assert_eq!(distance::between(&collinear, &shifted).unwrap().distance_mm, 1000.);
    // Exact contact and the two adjacent binary64 translations, also after a
    // huge common translation. Rounded world vertices would weld the tiny gap.
    let cube = prism(&[[0.,0.],[1.,0.],[1.,1.],[0.,1.]], 1., Affine::IDENTITY);
    for shift in [[0.;3], [65536.25,-32768.5,16384.125]] {
        let a = pattern::copy(&cube, key(2), ID, shift).unwrap();
        for tx in [1.0_f64.next_down(), 1., 1.0_f64.next_up()] {
            let b = pattern::copy(&cube, key(3), ID, [tx,0.,0.]).unwrap();
            let b = pattern::copy(&b, key(4), ID, shift).unwrap();
            let result = distance::between(&a, &b);
            if tx <= 1. { assert_eq!(result.unwrap_err().0, "distance/solids-not-strictly-separated"); }
            else {
                let d = result.unwrap(); let gap = (q(tx)-q(1.))*q(1000.);
                assert!(q(d.lower_mm) <= gap && q(d.upper_mm) >= gap);
            }
        }
    }
    let a=prism(&[[0.002,0.],[0.010,0.],[0.002,0.006]],0.004,Affine::IDENTITY);
    let b=pattern::copy(&a,key(2),MIRROR,[0.;3]).unwrap();
    let gap=distance::between(&a,&b).unwrap();assert_eq!(gap.distance_mm,4.);
    match b.distance_mm([-6.,5.,2.]) {
        Probe::Measured{distance_mm,inside,bound_mm} => {assert!(!inside);assert!((distance_mm-1.6).abs()<=bound_mm);},
        e=>panic!("{e:?}"),
    }
    assert!(distance::between(&a,&a).unwrap_err().0.contains("not-strictly-separated"));
    let concave=prism(&[[0.,0.],[3.,0.],[3.,1.],[1.,1.],[1.,3.],[0.,3.]],1.,Affine::IDENTITY);
    assert_eq!(distance::between(&a,&concave).unwrap().distance_mm, 0., "contained in concave solid");
}
// SAT has three independently necessary classes: either body's face normals
// and cross products of edges. Closed-form support gaps below exercise axes
// that the translated/parallel examples cannot distinguish.
#[test]
fn distance_separates_on_one_sided_faces_and_only_cross_edge_axes() {
    let rotation = [[0.36, -0.8, 0.48], [0.48, 0.6, 0.64], [-0.8, 0., 0.6]];
    let a = prism(&[[-1., -1.], [1., -1.], [1., 1.], [-1., 1.]], 2., Affine { origin: [0., 0., -1.], ..Affine::IDENTITY });
    let b = prism(&[[-0.125, -0.125], [0.125, -0.125], [0.125, 0.125], [-0.125, 0.125]], 0.25, Affine { origin: [0., 0., -0.125], ..Affine::IDENTITY });
    let b = pattern::copy(&b, key(2), rotation, [1.206, 0., 0.]).unwrap();
    let gap = (q(1.206) - q(1.) - q(0.125) * (q(0.36) + q(0.8) + q(0.48))) * q(1000.);
    for (a, b) in [(&a, &b), (&b, &a)] {
        let d = distance::between(a, b).unwrap();
        assert!(q(d.lower_mm) <= gap && q(d.upper_mm) >= gap, "face-only support gap: {d:?}");
    }
    let a = prism(&[[-2., -0.05], [2., -0.05], [2., 0.05], [-2., 0.05]], 0.1, Affine { origin: [0., 0., -0.05], ..Affine::IDENTITY });
    let b = pattern::copy(&a, key(3), rotation, [0., 0.14, 0.13]).unwrap();
    // Common normal to the long edges is (0, .8, .48). The nearest
    // supports are interior to both long edges, not their endpoints.
    let ny = q(0.8); let nz = q(0.48);
    let support = q(0.05) * (&ny + &nz + &ny*q(0.6) + &ny*q(0.64) + &nz*q(0.6));
    let gap = q(0.14)*&ny + q(0.13)*&nz - support;
    let square = &gap*&gap / (&ny*&ny + &nz*&nz) * q(1e6);
    let d = distance::between(&a, &b).unwrap();
    assert!(q(d.lower_mm)*q(d.lower_mm) <= square && q(d.upper_mm)*q(d.upper_mm) >= square, "edge-only support gap: {d:?}");
}
#[test]
fn distance_refuses_squared_observations_outside_binary64_range() {
    let frame = Affine { origin: [0.;3], x: [1e100,0.,0.], z: [0.,0.,1.] };
    let a = prism(&[[0.,0.],[1e70,0.],[1e70,1e70],[0.,1e70]], 1e70, frame);
    let b = prism(&[[2e70,0.],[3e70,0.],[3e70,1e70],[2e70,1e70]], 1e70, frame);
    assert_eq!(distance::between(&a,&b).unwrap_err().0, "distance/observation-range");
    let a = prism(&[[-1e-80,0.],[0.,0.],[0.,1e-80],[-1e-80,1e-80]], 1e-80, Affine::IDENTITY);
    let b = prism(&[[0.,0.],[1e-80,0.],[1e-80,1e-80],[0.,1e-80]], 1e-80, Affine::IDENTITY);
    let shift = 1e-150_f64.next_up();
    let b = pattern::copy(&b,key(2),ID,[shift,0.,0.]).unwrap();
    let b = pattern::copy(&b,key(3),ID,[-shift.next_down(),0.,0.]).unwrap();
    assert_eq!(distance::between(&a,&b).unwrap_err().0, "distance/observation-range");
}
#[test]
fn distance_resource_limit_is_per_body_and_inclusive() {
    let small = prism(&[[0.,0.],[1.,0.],[1.,1.],[0.,1.]], 1., Affine::IDENTITY);
    for n in [64, 65] {
        let mut points: Vec<_> = (0..n-4).map(|i| [i as f64, 0.]).collect();
        points.extend([[(n-5) as f64,60.],[30.,60.],[30.,30.],[0.,30.]]);
        let large = prism(&points, 1., Affine::IDENTITY);
        assert_eq!(large.body.vertices.len(), 2*n);
        for (a,b) in [(&small,&large), (&large,&small)] {
            if n == 64 { assert_eq!(distance::between(a,b).unwrap().distance_mm, 0.); }
            else { assert_eq!(distance::between(a,b).unwrap_err().0, "distance/resource-limit"); }
        }
    }
}
#[test]
fn placement_inverse_encloses_error_without_assuming_unit_determinant() {
    // Observable map/inverse contract, independent exact rational oracle. No
    // production helper computes expected coordinates or the admissible error.
    let source = prism(&[[0.,0.],[1.,0.],[1.,1.],[0.,1.]], 1., Affine::IDENTITY);
    for scale in [0.8, 1.25, 2.] {
        for origin in [[0.;3], [65536.25, -32768.5, 16384.125]] {
            let affine = Affine { origin, x: [scale,0.,0.], z: [0.,0.,1.] };
            let mut body = source.body.clone();
            let v = |p: [f64;3]| p.map(|x| Binary64::new(x).unwrap());
            body.frames[1] = Frame::Interpreter { parent: FrameId(0), origin: v(origin), x: v(affine.x), z: v(affine.z) };
            let map = Placement::from_frames(&body, FrameId(1)).unwrap();
            for p in [[1e-6, 3e-6, 2e-6], [0.125, -0.375, 0.625]] {
                let input = map.apply(p, 1., true).unwrap();
                let (actual, bound) = map.inverse_approx(input).unwrap();
                assert!(bound.is_finite() && bound >= 0.);
                for k in 0..3 {
                    let exact = (q(input[k]) - q(origin[k])) / q(if k < 2 { scale } else { 1. });
                    assert!((q(actual[k]) - exact).abs() <= q(bound), "inverse scale {scale} axis {k}: {bound}");
                }
            }
        }
    }
    // Source identity is a supported frame in its own right, not just the
    // parent of an Interpreter. Invalid parents must not be silently ignored.
    let map = Placement::from_frames(&source.body, FrameId(0)).unwrap();
    assert_eq!(map.apply([0.25, -0.5, 2.], 1., true).unwrap(), [0.25, -0.5, 2.]);
    let mut malformed = source.body.clone();
    if let Frame::Interpreter { parent, .. } = &mut malformed.frames[1] { *parent = FrameId(1); }
    assert!(Placement::from_frames(&malformed, FrameId(1)).is_err());
    let mut singular = source.body.clone();
    if let Frame::Interpreter { z, .. } = &mut singular.frames[1] { *z = [1.,0.,0.].map(|v| Binary64::new(v).unwrap()); }
    assert!(Placement::from_frames(&singular, FrameId(1)).unwrap().reversed().is_err(),
        "a singular placement has no handedness");
    // Inverse observation requires |det| strictly above .5, even if the
    // divided coordinates happen to be finite. These are not topology tests.
    for x in [[0.5, 0.5, 0.], [0.5, 0., 0.]] {
        let mut body = source.body.clone();
        if let Frame::Interpreter { x: direction, .. } = &mut body.frames[1] { *direction = x.map(|v| Binary64::new(v).unwrap()); }
        let map = Placement::from_frames(&body, FrameId(1)).unwrap();
        assert!(map.inverse_approx([0.1,0.2,0.3]).is_err());
    }
}
fn f64s(words:&mut Vec<u32>, values: impl IntoIterator<Item=f64>) { for value in values {let b=value.to_bits();words.extend([b as u32,(b>>32) as u32]);} }
#[test]
fn host_pattern_and_distance_transport_keeps_float_bits_and_rejects_bad_requests() {
    let a=prism(&[[0.,0.],[1.,0.],[1.,1.],[0.,1.]],1.,Affine::IDENTITY);
    let body=wonky_wire::v3::encode(&a.body).unwrap();
    let mut request=vec![host::MAGIC,host::VERSION,host::OP_PATTERN,body.len() as u32];request.extend(&body);request.extend([9,8,7,6,5]);
    f64s(&mut request,ID.into_iter().flatten());f64s(&mut request,[2.0000000000000004,0.,0.]);
    let response=host::host_op(&request);assert_eq!(response[0],host::STATUS_OK);
    let b=audit(&wonky_wire::v3::decode(&response[1..]).unwrap()).unwrap();
    assert_eq!(b.body.key,BodyKey{id:[9,8,7,6],revision:5});
    assert_eq!(b.world_vertices_mm().unwrap()[0][0],2000.0000000000005);
    let mut distance=vec![host::MAGIC,host::VERSION,host::OP_DISTANCE,body.len() as u32];distance.extend(&body);distance.push((response.len()-1) as u32);distance.extend(&response[1..]);
    let reply=host::host_op(&distance);assert_eq!(reply[0],host::STATUS_OK);
    let text:String=reply[1..].iter().map(|&c|char::from_u32(c).unwrap()).collect();assert!(text.contains("1000.0000000000005"),"{text}");
    for mut bad in [request,distance] {
        bad.push(1);assert_eq!(host::host_op(&bad)[0],host::STATUS_MALFORMED);
        bad.truncate(5);assert_eq!(host::host_op(&bad)[0],host::STATUS_MALFORMED);
    }
}

#[test]
fn rational_host_placement_certifies_post_map_not_interpreter_source_frame() {
    let frame = Affine { origin: [0.;3], x: [12./13., 5./13., 0.], z: [0.,0.,1.] };
    let a = prism(&[[0.,0.],[2.,0.],[2.,2.],[0.,2.]],2.,frame);
    assert_ne!(q(frame.x[0])*q(frame.x[0])+q(frame.x[1])*q(frame.x[1]),q(1.));
    let words = wonky_wire::v3::encode(&a.body).unwrap();
    let rows = [[4.,-3.,0.],[3.,4.,0.],[0.,0.,5.]];
    let request = |rows: [[f64;3];3], denominator: f64| {
        let mut r=vec![host::MAGIC,host::VERSION,host::OP_RATIONAL_PLACEMENT,words.len() as u32];
        r.extend(&words);f64s(&mut r,rows.into_iter().flatten());f64s(&mut r,[denominator]);r
    };
    let response=host::host_op(&request(rows,5.));
    assert_eq!(response[0],host::STATUS_OK,"{response:?}");
    let moved=audit(&wonky_wire::v3::decode(&response[1..]).unwrap()).unwrap();
    for (i,vertex) in a.body.vertices.iter().enumerate() {
        let source=source_image(vertex.point.map(|x|x.get()),frame);
        let expected: [Q;3]=std::array::from_fn(|k|(0..3).map(|j|q(rows[k][j])*&source[j]/q(5.)).sum::<Q>()*q(1000.));
        assert_eq!(moved.world_vertices_mm().unwrap()[i],expected.each_ref().map(nearest));
    }
    assert_eq!(moved.volume_mm3().unwrap(),a.volume_mm3().unwrap());
    let mut scaled=rows;scaled[0][0]=4.1;
    for (r,d) in [(scaled,5.),(rows,0.),(rows,-5.),(rows,4.)] {
        let response=host::host_op(&request(r,d));
        assert_eq!(response[0],host::STATUS_REFUSED);
        let reason:String=response[1..].iter().map(|&c|char::from_u32(c).unwrap()).collect();
        assert_eq!(reason,"placement/rational-not-isometric");
    }
}
