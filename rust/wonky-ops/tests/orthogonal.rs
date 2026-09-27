//! Independent closed forms at the production operation boundary. The primary
//! owner of classification/merging/placement regressions; integration tests own
//! only interpreter transport and query-record lifecycle.
use num_traits::ToPrimitive;
use wonky_contract::{Body, BodyKey};
use wonky_ops::{
    affine::Affine,
    orthogonal,
    polyhedron::{audit, Audited, Probe},
};
use wonky_oracle::binary64;
fn key() -> BodyKey {
    BodyKey {
        id: [1, 2, 3, 4],
        revision: 0,
    }
}
fn checked(b: Body) -> Audited {
    audit(&b.check().unwrap()).unwrap()
}
fn cube(a: [f64; 3], b: [f64; 3]) -> Audited {
    checked(orthogonal::cuboid(key(), a, b).unwrap())
}
fn run(op: u8, a: &Audited, b: &Audited) -> Vec<Audited> {
    orthogonal::boolean(key(), op, &[a.clone(), b.clone()])
        .unwrap()
        .into_iter()
        .map(checked)
        .collect()
}
fn near(a: f64, b: f64) {
    assert!((a - b).abs() <= b.abs() * 3e-14, "{a} != {b}");
}
fn topology(a: &Audited, s: usize, f: usize, e: usize, v: usize, g: i64) {
    let t = a.topology();
    assert_eq!(
        (t.shells, t.faces, t.edges, t.vertices, t.genus),
        (s, f, e, v, g)
    );
}

#[test]
fn union_difference_intersection_closed_forms_and_topology() {
    let a = cube([0.; 3], [8.; 3]);
    let b = cube([4.; 3], [12.; 3]);
    let u = run(0, &a, &b);
    assert_eq!(u.len(), 1);
    near(u[0].volume_mm3().unwrap(), 960e9);
    near(u[0].face_areas_mm2().unwrap().iter().sum(), 672e6);
    topology(&u[0], 1, 12, 30, 20, 0);
    let i = run(2, &a, &b);
    near(i[0].volume_mm3().unwrap(), 64e9);
    topology(&i[0], 1, 6, 12, 8, 0);
    let d = run(1, &a, &b);
    near(d[0].volume_mm3().unwrap(), 448e9);
    topology(&d[0], 1, 9, 21, 14, 0);
    let f = cube([8., 0., 0.], [16., 8., 8.]);
    let u = run(0, &a, &f);
    topology(&u[0], 1, 6, 12, 8, 0);
    near(u[0].volume_mm3().unwrap(), 1024e9);
    assert_eq!(
        orthogonal::boolean(key(), 2, &[a.clone(), f])
            .unwrap_err()
            .0,
        "orthogonal/empty-result"
    );
    assert_eq!(
        orthogonal::boolean(key(), 1, &[a.clone(), a.clone()])
            .unwrap_err()
            .0,
        "orthogonal/empty-result"
    );
    let u = run(0, &a, &a);
    topology(&u[0], 1, 6, 12, 8, 0);
    near(u[0].volume_mm3().unwrap(), 512e9);
    for lo in [[8., 8., 0.], [8., 8., 8.]] {
        assert_eq!(
            orthogonal::boolean(key(), 0, &[a.clone(), cube(lo, lo.map(|v| v + 8.))])
                .unwrap_err()
                .0,
            "orthogonal/non-manifold-result"
        );
    }
}

#[test]
fn partial_face_contact_splits_t_junctions_into_shared_edges() {
    // The second box contacts only part of x=8. Three faces terminate on long
    // edges of their neighbours; merely joining coincident corners is not enough.
    // Independent union formulas: V=512+256, A=384+256-2*(4*4).
    let a = cube([0.; 3], [8.; 3]);
    let b = cube([8., 4., 0.], [16., 12., 4.]);
    for frame in [
        Affine::IDENTITY,
        Affine { origin: [65.53625, -32., 16.], x: [0.6, 0.8, 0.], z: [0., 0., 1.] },
    ] {
        let a = checked(orthogonal::transform(&a, frame).unwrap());
        let b = checked(orthogonal::transform(&b, frame).unwrap());
        for (left, right) in [(&a, &b), (&b, &a)] {
            let result = run(0, left, right);
            assert_eq!(result.len(), 1);
            topology(&result[0], 1, 11, 26, 17, 0);
            near(result[0].volume_mm3().unwrap(), 768e9);
            near(result[0].face_areas_mm2().unwrap().iter().sum(), 608e6);
            assert!(result[0].bound_to_construction);
        }
    }
}

#[test]
fn cavities_holes_and_flush_channels_are_real_oriented_boundaries() {
    let a = cube([0.; 3], [16.; 3]);
    let b = cube([4.; 3], [12.; 3]);
    let cavity = run(1, &a, &b);
    topology(&cavity[0], 2, 12, 24, 16, 0);
    near(cavity[0].volume_mm3().unwrap(), 3584e9);
    near(cavity[0].face_areas_mm2().unwrap().iter().sum(), 1920e6);
    let a = cube([0.; 3], [16., 8., 8.]);
    let b = cube([4., 0., 4.], [12., 8., 8.]);
    let channel = run(1, &a, &b);
    topology(&channel[0], 1, 10, 24, 16, 0);
    near(channel[0].volume_mm3().unwrap(), 768e9);
    let a = cube([131.072, 0., 0.], [131.088, 0.016, 0.004]);
    let b = cube([131.079998, 0.004, -0.001], [131.080002, 0.012, 0.005]);
    let hole = run(1, &a, &b);
    topology(&hole[0], 1, 10, 24, 16, 1);
    let t = hole[0].topology();
    assert_eq!(t.loops, 12);
    // Outer/inner loop flags affect the represented trimmed face, independently
    // of the signed volume (which would still match if these flags were swapped).
    use num_traits::{Signed, Zero};
    for face in &hole[0].body.faces {
        let wonky_contract::SurfaceGeometry::Plane { normal, .. } = &hole[0].body.surfaces[face.surface.0 as usize].geometry else { panic!("not planar") };
        for l in &face.loops {
            let lp=&hole[0].body.loops[l.0 as usize];
            let points:Vec<_>=lp.coedges.iter().map(|c| {
                let co=&hole[0].body.coedges[c.0 as usize];
                hole[0].body.vertices[hole[0].body.edges[co.edge.0 as usize].vertices[usize::from(!co.forward)].0 as usize].point
            }).collect();
            let mut area=num_rational::BigRational::zero();
            for i in 0..points.len() {for k in 0..3 {
                let (u,v)=((k+1)%3,(k+2)%3); let(a,b)=(points[i],points[(i+1)%points.len()]);
                area+=(binary64(a[u].get()).unwrap()*binary64(b[v].get()).unwrap()-binary64(a[v].get()).unwrap()*binary64(b[u].get()).unwrap())*binary64(normal[k].get()).unwrap();
            }}
            assert!(!area.is_zero());
            assert_eq!(area.is_positive(),lp.outer,"trim loop sense must agree with outer/inner flag");
        }
    }
    let mut exact = binary64(0.016).unwrap()
        * binary64(0.004).unwrap()
        * (binary64(131.088).unwrap() - binary64(131.072).unwrap());
    exact -= (binary64(131.080002).unwrap() - binary64(131.079998).unwrap())
        * (binary64(0.012).unwrap() - binary64(0.004).unwrap())
        * binary64(0.004).unwrap();
    near(hole[0].volume_mm3().unwrap(), exact.to_f64().unwrap() * 1e9);
    match cavity[0].distance_mm([8000.; 3]) {
        Probe::Measured {
            distance_mm,
            inside,
            ..
        } => {
            near(distance_mm, 4000.);
            assert!(!inside);
        }
        p => panic!("{p:?}"),
    }
}

#[test]
fn deterministic_random_box_dimensions_against_rational_inclusion_exclusion() {
    let mut seed = 987654321u64;
    let mut next = || {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        ((seed >> 32) % 31 + 1) as f64 / 16.
    };
    for _ in 0..48 {
        let a0 = [0.; 3];
        let a1 = [next(), next(), next()];
        let b0 = a1.map(|x| x / 2.);
        let b1 = [a1[0] + next(), a1[1] + next(), a1[2] + next()];
        let a = cube(a0, a1);
        let b = cube(b0, b1);
        let volume = |lo: [f64; 3], hi: [f64; 3]| {
            (0..3)
                .map(|k| binary64(hi[k]).unwrap() - binary64(lo[k]).unwrap())
                .product::<num_rational::BigRational>()
        };
        let av = volume(a0, a1);
        let bv = volume(b0, b1);
        let overlap = volume(b0, a1);
        for (op, expected) in [(0, &av + &bv - &overlap), (1, &av - &overlap), (2, overlap)] {
            let result = run(op, &a, &b);
            near(
                result.iter().map(|x| x.volume_mm3().unwrap()).sum(),
                expected.to_f64().unwrap() * 1e9,
            );
            assert!(result.iter().all(|r| r.bound_to_construction));
        }
    }
}

#[test]
fn binary64_gaps_overlap_and_rigid_placement_do_not_round_into_contacts() {
    let hi = (0.1f64 + 8.2) * 0.001;
    let lo = 8.3 * 0.001;
    assert!(hi < lo);
    let a = cube([0.; 3], [hi, 0.004, 0.004]);
    let b = cube([lo, 0., 0.], [0.016, 0.004, 0.004]);
    let gap = (binary64(lo).unwrap() - binary64(hi).unwrap())
        .to_f64()
        .unwrap()
        * 1000.;
    for frame in [
        Affine::IDENTITY,
        Affine {
            origin: [131.072, -32.5, 16.25],
            x: [0., 0., 1.],
            z: [0., -1., 0.],
        },
        Affine {
            origin: [65.53625, 0., 0.],
            x: [0.6, 0.8, 0.],
            z: [0., 0., 1.],
        },
    ] {
        let a = checked(orthogonal::transform(&a, frame).unwrap());
        let b = checked(orthogonal::transform(&b, frame).unwrap());
        let result = run(0, &a, &b);
        assert_eq!(result.len(), 2);
        let (distance, bound) = result[0]
            .orthogonal
            .as_ref()
            .unwrap()
            .distance_mm(result[1].orthogonal.as_ref().unwrap(), frame)
            .unwrap();
        assert!((distance - gap).abs() <= bound);
        assert!(distance > 0.);
    }
    let lo = 0.008f64.next_down();
    let a = cube([0.; 3], [0.008, 0.004, 0.004]);
    let b = cube([lo, 0., 0.], [0.016, 0.004, 0.004]);
    let sliver = run(2, &a, &b);
    assert_eq!(
        sliver[0].orthogonal.as_ref().unwrap().extents_mm().unwrap()[0],
        (0.008 - lo) * 1000.
    );
    let translated = checked(
        orthogonal::transform(
            &b,
            Affine {
                origin: [1., 0., 0.],
                ..Affine::IDENTITY
            },
        )
        .unwrap(),
    );
    assert_eq!(
        orthogonal::boolean(key(), 0, &[a, translated])
            .unwrap_err()
            .0,
        "planar-boolean/multiple-shells-unsupported"
    );
}

#[test]
fn malformed_and_tampered_construction_never_gets_an_audit_certificate() {
    assert!(orthogonal::cuboid(key(), [0.; 3], [1., 0., 1.]).is_err());
    let a = cube([0.; 3], [1.; 3]);
    let mut b = a.body.clone();
    b.coedges[0].forward = !b.coedges[0].forward;
    assert!(audit(&b.check().unwrap()).is_err());
    let mut b = a.body.clone();
    b.vertices[0].point[0] = wonky_contract::Binary64::new(0.00001).unwrap();
    assert!(audit(&b.check().unwrap()).is_err());
    let mut b = a.body.clone();
    b.constructions[0].parameters[3] = wonky_contract::Binary64::new(2.).unwrap();
    assert!(audit(&b.check().unwrap()).is_err());
    assert!(orthogonal::transform(
        &a,
        Affine {
            x: [2., 0., 0.],
            ..Affine::IDENTITY
        }
    )
    .is_err());
}

#[test]
fn placement_keeps_origin_and_axis_order_on_the_world_boundary() {
    let a=cube([1.,2.,3.],[4.,6.,8.]);
    let frame=Affine {origin:[2.,-3.,5.],x:[0.,0.,1.],z:[0.,-1.,0.]};
    let placed=checked(orthogonal::transform(&a,frame).unwrap());
    assert_eq!(placed.bbox_mm(None).unwrap(),([-4000.,-11000.,6000.],[0.,-6000.,9000.]));
    near(placed.volume_mm3().unwrap(),60e9);
}

#[test]
fn wc0_line_pcurves_are_exact_parameterizations_on_each_support_plane() {
    let a=cube([-2.,1.,-3.],[4.,7.,5.]);
    for pc in &a.body.pcurves {
        let wonky_contract::PcurveGeometry::Line {a:uv0,b:uv1}=pc.geometry else {panic!("not a line")};
        let wonky_contract::SurfaceGeometry::Plane {origin,normal,x}=a.body.surfaces[pc.surface.0 as usize].geometry else {panic!("not a plane")};
        let wonky_contract::CurveGeometry::Line {a:p,b:q}=a.body.curves[pc.curve.0 as usize].geometry else {panic!("not a line")};
        for (uv,point) in [(uv0,p),(uv1,q)] { for k in 0..3 {
            let (u,v)=((k+1)%3,(k+2)%3);
            let y=normal[u].get()*x[v].get()-normal[v].get()*x[u].get();
            assert_eq!(origin[k].get()+uv[0].get()*x[k].get()+uv[1].get()*y,point[k].get(),"pcurve must lift to its own 3D edge endpoint");
        }}
    }
}

#[test]
fn distances_are_symmetric_tight_and_cover_the_exact_frame_metric() {
    let a=cube([0.;3],[1.;3]);let b=cube([2.,3.,4.],[4.,5.,6.]);
    let (ac,bc)=(a.orthogonal.as_ref().unwrap(),b.orthogonal.as_ref().unwrap());
    for (a,b) in [(ac,bc),(bc,ac)] {
        let (d,e)=a.distance_mm(b,Affine::IDENTITY).unwrap();near(d,14f64.sqrt()*1000.);assert!(e>=0.&&e<d*1e-10);
        assert!(a.distance_mm(b,Affine {x:[2.,0.,0.],..Affine::IDENTITY}).is_err());
    }
    let frame=Affine {x:[1.+2e-13,0.,0.],..Affine::IDENTITY};
    let a=cube([0.;3],[1.;3]);let b=cube([2.,0.,0.],[3.,1.,1.]);
    let (d,e)=a.orthogonal.as_ref().unwrap().distance_mm(b.orthogonal.as_ref().unwrap(),frame).unwrap();
    let world=1000.*frame.x[0];assert!((d-world).abs()<=e);assert!(e<d*1e-10);
}

#[test]
fn invalid_operation_graphs_cannot_be_replayed_as_valid_box_boundaries() {
    use wonky_contract::{Binary64,Construction,FrameId,NodeId,Operation,Provenance};
    let a=cube([0.;3],[1.;3]);let base=run(0,&a,&a).remove(0).body;
    let zero=Binary64::new(0.).unwrap();
    let invalids:Vec<(usize,Box<dyn Fn(&mut Construction)>)>=vec![
        (1,Box::new(move|n|n.parameters.push(zero))),
        (2,Box::new(|n|n.operation=Operation::Point {})),
        (2,Box::new(|n|n.parents.push(NodeId(0)))),
        (2,Box::new(move|n|n.parameters.push(zero))),
        (4,Box::new(|n|n.parents.truncate(1))),
        (4,Box::new(|n|n.operation=Operation::Point {})),
        (4,Box::new(move|n|n.parameters.push(zero))),
    ];
    for (node,mutate) in invalids {let mut b=base.clone();mutate(&mut b.constructions[node]);assert!(orthogonal::audit(&b,Affine::IDENTITY).is_err(),"invalid construction at {node}");}
    assert!(orthogonal::boolean(key(),3,&[a.clone(),a.clone()]).is_err());
    assert!(orthogonal::boolean(key(),0,&[a.clone()]).is_err());
    let disjoint=run(0,&a,&cube([3.;3],[4.;3]));
    for index in [-1.,0.5] {let mut b=disjoint[0].body.clone();b.constructions.last_mut().unwrap().parameters[0]=Binary64::new(index).unwrap();assert!(orthogonal::audit(&b,Affine::IDENTITY).is_err());}
    let mut b=a.body.clone();let mut root=1u32;
    for _ in 0..12 {b.constructions.push(Construction {operation:Operation::Boolean {},rule_version:1,parents:vec![NodeId(root),NodeId(root)],parameters:vec![zero],frame:FrameId(1)});root=b.constructions.len() as u32-1;}
    for v in &mut b.vertices {v.provenance=Provenance::Construction {node:NodeId(root)};}
    for v in &mut b.curves {v.provenance=Provenance::Construction {node:NodeId(root)};}
    for v in &mut b.surfaces {v.provenance=Provenance::Construction {node:NodeId(root)};}
    assert_eq!(orthogonal::audit(&b,Affine::IDENTITY).unwrap_err().0,"orthogonal/construction-budget");
}

#[test]
fn multiple_void_shells_and_probe_mapping_budgets_remain_honest() {
    let a=cube([0.;3],[10.;3]);let b=cube([1.;3],[2.;3]);let c=cube([4.;3],[6.;3]);
    let cut=run(1,&run(1,&a,&b)[0],&c);let d=cube([7.;3],[8.;3]);let cut=run(1,&cut[0],&d);topology(&cut[0],4,24,48,32,0);near(cut[0].volume_mm3().unwrap(),990e9);
    let a=cube([1.;3],[2.;3]);
    match a.distance_mm([1500.;3]) {Probe::Measured {distance_mm,inside,bound_mm}=>{assert!(inside);assert_eq!(distance_mm,0.);assert!(bound_mm>0.&&bound_mm<1e-8);},p=>panic!("{p:?}")}
    for q in [[1000.,1500.,1500.],[2000.,1500.,1500.],[1000.+1e-12,1500.,1500.],[2000.-1e-12,1500.,1500.]] {assert!(matches!(a.distance_mm(q),Probe::Refused(_)));}
    for q in [[1000.+6e-11,1500.,1500.],[2000.-6e-11,1500.,1500.]] {assert!(matches!(a.distance_mm(q),Probe::Measured {inside:true,..}),"{q:?}");}
    for q in [[999.999999999999,1500.,1500.],[2000.000000000001,1500.,1500.]] {assert!(matches!(a.distance_mm(q),Probe::Refused(_)));}
    match a.distance_mm([3000.,1500.,1500.]) {Probe::Measured {distance_mm,inside,bound_mm}=>{assert!(!inside);assert_eq!(distance_mm,1000.);assert!(bound_mm>0.&&bound_mm<1e-8);},p=>panic!("{p:?}")}
    for (source,frame,point) in [
        (cube([0.;3],[0.008,0.004,0.004]),Affine {origin:[65.53625,0.,0.],..Affine::IDENTITY},[65545.25,2.,2.]),
        (cube([1.;3],[2.;3]),Affine {x:[1.+2e-13,0.,0.],..Affine::IDENTITY},[3000.,1500.,1500.]),
    ] {
        let hi=source.orthogonal.as_ref().unwrap().source_bbox()[1][0];
        let exact=binary64(point[0]).unwrap()-(binary64(frame.origin[0]).unwrap()+binary64(frame.x[0]).unwrap()*binary64(hi).unwrap())*binary64(1000.).unwrap();
        let placed=checked(orthogonal::transform(&source,frame).unwrap());
        match placed.distance_mm(point) {Probe::Measured {distance_mm,inside,bound_mm}=>{
            assert!(!inside);assert!(bound_mm>=0.&&bound_mm<1e-7);
            use num_traits::Signed;
            assert!((binary64(distance_mm).unwrap()-exact).abs()<=binary64(bound_mm).unwrap(),"probe bound must enclose the rational world-frame distance");
        },p=>panic!("{p:?}")}
    }
}

#[test]
fn host_protocol_delivers_box_boolean_placement_measurement_and_step() {
    use wonky_ops::host::*;
    fn request(op:u32, payload:Vec<u32>)->Vec<u32> {let mut w=vec![MAGIC,VERSION,op];w.extend(payload);host_op(&w)}
    fn floats(a:impl IntoIterator<Item=f64>)->Vec<u32> {a.into_iter().flat_map(|x|[x.to_bits() as u32,(x.to_bits()>>32) as u32]).collect()}
    fn block(a:&[u32])->Vec<u32> {std::iter::once(a.len() as u32).chain(a.iter().copied()).collect()}
    fn text(a:&[u32])->String {assert_eq!(a[0],STATUS_OK);a[1..].iter().map(|&w|char::from_u32(w).unwrap()).collect()}
    fn native(a:&[u32])->Audited {assert_eq!(a[0],STATUS_OK,"{a:?}");audit(&wonky_wire::v3::decode(&a[1..]).unwrap()).unwrap()}
    let mut payload=vec![1,2,3,4];payload.extend(floats([0.,0.,0.,0.002,0.003,0.004]));let a=request(OP_CUBOID,payload);near(native(&a).volume_mm3().unwrap(),24.);
    let mut payload=vec![2,3,4,5];payload.extend(floats([0.003,0.,0.,0.004,0.003,0.004]));let b=request(OP_CUBOID,payload);
    let mut payload=block(&a[1..]);payload.extend(block(&b[1..]));let d=text(&request(OP_DISTANCE,payload));assert!(d.contains("\"distanceMm\":1.0"),"{d}");
    assert_eq!(text(&request(OP_EXTENTS,block(&a[1..]))),"[2.0,3.0,4.0]");
    let mut payload=block(&a[1..]);payload.extend(floats([2.,3.,4.,0.,0.,1.,0.,-1.,0.]));let placed=request(OP_PLACEMENT,payload);assert_eq!(native(&placed).bbox_mm(None).unwrap(),([1997.,2996.,4000.],[2000.,3000.,4002.]));
    let mut payload=vec![9,8,7,6,0,2];payload.extend(block(&a[1..]));payload.extend(block(&b[1..]));let result=request(OP_BOOLEAN,payload);assert_eq!(&result[..2],&[STATUS_OK,2]);
    let first=&result[3..3+result[2] as usize];let first=audit(&wonky_wire::v3::decode(first).unwrap()).unwrap();near(first.volume_mm3().unwrap(),24.);
    let mut payload=block(&placed[1..]);payload.extend([0,0]);let observed=text(&request(OP_MEASURE,payload));assert!(observed.contains("\"certificate\":\"OrthogonalCells\""));assert!(observed.contains("\"volumeMm3\":24.0"),"{observed}");
    let mut payload=vec![1,'x' as u32,1,1,'b' as u32];payload.extend(block(&a[1..]));let step=text(&request(OP_STEP,payload));assert_eq!(step.matches("ADVANCED_FACE").count(),6);assert_eq!(step.matches("MANIFOLD_SOLID_BREP").count(),1);
    let mut invalid=block(&a[1..]);invalid.push(7);assert_eq!(request(OP_EXTENTS,invalid)[0],STATUS_MALFORMED);
    for op in [2,4] {let mut p=vec![9,8,7,6,op,2];p.extend(block(&a[1..]));p.extend(block(&b[1..]));assert_eq!(request(OP_BOOLEAN,p)[0],if op==2 {STATUS_REFUSED}else{STATUS_MALFORMED});}
}

#[test]
fn nonmonotone_components_and_arrangement_budget_have_distinct_outcomes() {
    let a=cube([0.,2.,0.],[2.,3.,1.]);let b=cube([1.,0.,0.],[2.,3.,1.]);
    let result=run(0,&a,&b);assert_eq!(result.len(),1);topology(&result[0],1,8,18,12,0);
    near(result[0].volume_mm3().unwrap(),4e9);
    let mut boxes:Vec<_>=(0..8).map(|i|cube([2.*i as f64;3],[2.*i as f64+1.;3])).collect();
    boxes.push(cube([15.;3],[16.;3])); // Exactly 4096 cells: geometry decides.
    assert_eq!(orthogonal::boolean(key(),0,&boxes).unwrap_err().0,"orthogonal/non-manifold-result");
    boxes.pop();boxes.push(cube([16.;3],[17.;3])); // 4913 cells: named budget refusal.
    assert_eq!(orthogonal::boolean(key(),0,&boxes).unwrap_err().0,"orthogonal/arrangement-budget");
}

#[test]
fn selecting_a_disjoint_boolean_output_does_not_resurrect_its_sibling() {
    let a = cube([0.; 3], [1.; 3]);
    let b = cube([3., 0., 0.], [4., 1., 1.]);
    let joined = run(0, &a, &b);
    assert_eq!(joined.len(), 2);
    let tool = cube([0.25, -1., -1.], [0.75, 2., 2.]);
    let cut = run(1, &joined[0], &tool);
    assert_eq!(cut.len(), 2);
    near(cut.iter().map(|a| a.volume_mm3().unwrap()).sum(), 0.5e9);
    assert!(cut
        .iter()
        .all(|a| a.orthogonal.as_ref().unwrap().source_bbox()[1][0] <= 1.));
}

#[test]
fn measurement_range_never_certifies_zero_area_or_centroid() {
    // Binary powers make the independent cube formulas exact. Previously the
    // area norm squared underflowed at -270 and overflowed at +260; at -300
    // the fourth-degree centroid moment underflowed although the answer exists.
    for exponent in [-300, -270, 0, 260] {
        let side = 2f64.powi(exponent);
        let a = cube([0.; 3], [side; 3]);
        near(a.volume_mm3().unwrap(), side * side * side * 1e9);
        near(a.face_areas_mm2().unwrap().iter().sum(), 6e6 * side * side);
        let (centroid, bounds) = a.centroid_with_bound_mm().unwrap();
        for k in 0..3 {
            near(centroid[k], side * 500.);
            assert!((centroid[k] - side * 500.).abs() <= bounds[k]);
            assert!(bounds[k].is_finite());
        }
        for perimeter in a.face_perimeters_mm().unwrap() { near(perimeter, side * 4000.); }
        let (lo, hi) = a.bbox_mm(None).unwrap();
        for k in 0..3 {
            assert_eq!(lo[k], 0.);
            near(hi[k], side * 1000.);
        }
    }
}

#[test]
fn measurement_range_refuses_unrepresentable_mapped_bounds_and_distances() {
    let a = cube([0.; 3], [1.; 3]);
    for scale in [f64::MAX, f64::from_bits(1)] {
        let map = [[scale, 0., 0., 0.], [0., scale, 0., 0.], [0., 0., scale, 0.]];
        assert!(a.bbox_mm(Some(map)).is_err(), "uncertified map scale {scale}");
    }
    // The geometry is finite, but its millimetre distance overflows. Unlike
    // body construction this observation must refuse rather than emit Inf/NaN.
    assert!(matches!(a.distance_mm([f64::MAX; 3]), Probe::Refused(_)));
    // A genuine inside zero remains valid, not a blanket ban on zero results.
    assert!(matches!(a.distance_mm([500.; 3]), Probe::Measured { distance_mm: 0., inside: true, .. }));
}

#[test]
fn measurement_range_volume_and_body_distance_are_named_refusals() {
    // Volume needs degree three and exact-distance evaluation degree two.
    // Their existing exact expansion guard refuses outside its proven range.
    for exponent in [-400, 400] {
        let side = 2f64.powi(exponent);
        let a = cube([0.; 3], [side; 3]);
        assert!(a.volume_mm3().is_err());
    }
    let a = cube([0.; 3], [1.; 3]);
    let cells = a.orthogonal.as_ref().unwrap();
    for exponent in [-490] {
        let gap = 2f64.powi(exponent);
        let b = cube([2. * gap; 3], [3. * gap; 3]);
        let c = cube([0.; 3], [gap; 3]);
        assert_eq!(b.orthogonal.as_ref().unwrap().distance_mm(c.orthogonal.as_ref().unwrap(), Affine::IDENTITY)
            .unwrap_err().0, "orthogonal/distance-range");
    }
    let (zero, bound) = cells.distance_mm(cells, Affine::IDENTITY).unwrap();
    assert_eq!(zero, 0.);
    assert_eq!(bound, 0.);
    // At the admitted high coordinate range, extents remain finite in mm.
    let large = cube([0.; 3], [1e150; 3]);
    for extent in large.orthogonal.as_ref().unwrap().extents_mm().unwrap() { near(extent, 1e153); }
    assert!(large.bbox_mm(None).unwrap().1.iter().all(|x| x.is_finite()));
}
