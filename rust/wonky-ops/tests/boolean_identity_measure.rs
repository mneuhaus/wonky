//! Planted geometry negatives: mutate the real union boundary after audit,
//! bypassing topology revalidation so the volume identity itself must detect it.
use num_traits::{Signed, Zero};
use wonky_contract::{Binary64, BodyKey};
use wonky_ops::{polyhedron::{audit, Audited}, orthogonal};
fn operand(id:u32, x:f64)->Audited {
    let body=orthogonal::cuboid(BodyKey{id:[id,0,0,0],revision:0},[x,1.,1.],[x+2.,3.,3.]).unwrap();
    audit(&wonky_wire::v3::decode(&wonky_wire::v3::encode(&body).unwrap()).unwrap()).unwrap()
}
fn measured(a:&Audited)->num_rational::BigRational {a.volume_exact_mm3().unwrap().unwrap()}
#[test]
fn exact_union_identity_catches_dropped_face_and_one_ulp_vertex() {
    let a=operand(1,1.);let b=operand(2,2.);
    let inputs=[a.clone(),b.clone()];
    let key=BodyKey{id:[3,0,0,0],revision:0};
    let build=|op|orthogonal::boolean(key.clone(),op,&inputs).unwrap().into_iter()
        .map(|body|audit(&wonky_wire::v3::decode(&wonky_wire::v3::encode(&body).unwrap()).unwrap()).unwrap()).collect::<Vec<_>>();
    let union=build(0);let intersection=build(2);let difference=build(1);
    let sum=|xs:&[Audited]|xs.iter().map(measured).sum::<num_rational::BigRational>();
    let rhs=measured(&a)+measured(&b)-sum(&intersection);
    assert_eq!(measured(&a),num_rational::BigRational::from_integer(8_000_000_000_i64.into()));
    assert_eq!(sum(&union),num_rational::BigRational::from_integer(12_000_000_000_i64.into()));
    assert_eq!(sum(&union),rhs);
    assert_eq!(sum(&difference)+sum(&intersection),measured(&a));
    let mut dropped=union.clone();
    // Pick a face with nonzero tetrahedral volume; a face through the origin
    // can have zero contribution, the documented volume-preserving blind spot.
    let mut caught=false;
    for i in 0..dropped[0].face_loops.len() {
        dropped=union.clone();dropped[0].face_loops.remove(i);
        if sum(&dropped)!=rhs {caught=true;break;}
    }
    assert!(caught,"dropped face escaped exact identity");
    let mut moved=union.clone();
    let index=moved[0].body.vertices.iter().enumerate()
        .max_by(|(_,a),(_,b)|a.point[0].get().total_cmp(&b.point[0].get())).unwrap().0;
    let coordinate=&mut moved[0].body.vertices[index].point[0];
    *coordinate=Binary64::new(coordinate.get().next_up()).unwrap();
    assert_ne!(sum(&moved),rhs,"one-ulp vertex escaped exact identity");
    assert!(rhs.is_positive());
}

/// The oracle sees only independently supplied primitive operands. Planted
/// boundaries bypass audit deliberately so the volume check must reject them.
#[test]
fn operand_volume_oracle_rejects_flipped_face_dropped_fragment_and_wrong_operation() {
    use wonky_oracle::{point3,volume::{enclose,Membership,Operation}};
    let root=[point3([1.,1.,1.]).unwrap(),point3([4.,3.,3.]).unwrap()];
    let boxes=[[[1.,1.,1.],[3.,3.,3.]],[[2.,1.,1.],[4.,3.,3.]]].map(|b|b.map(|p|point3(p).unwrap()));
    let cuts=std::array::from_fn(|k|boxes.iter().flat_map(|b|[b[0][k].clone(),b[1][k].clone()]).collect());
    let oracle=|op:Operation|enclose(root.clone(),&cuts,128,|c|Ok::<_,()>(op.classify(&boxes.iter().map(|b| {
        if (0..3).any(|k|c[1][k]<=b[0][k]||c[0][k]>=b[1][k]) {Membership::Outside}
        else if (0..3).all(|k|c[0][k]>=b[0][k]&&c[1][k]<=b[1][k]) {Membership::Inside}
        else {Membership::Boundary}
    }).collect::<Vec<_>>()))).unwrap();
    let a=operand(1,1.);let b=operand(2,2.);
    let make=|op|orthogonal::boolean(BodyKey{id:[3,0,0,0],revision:0},op,&[a.clone(),b.clone()]).unwrap().into_iter()
        .map(|body|audit(&wonky_wire::v3::decode(&wonky_wire::v3::encode(&body).unwrap()).unwrap()).unwrap()).collect::<Vec<_>>();
    let scale=num_rational::BigRational::from_integer(1_000_000_000_i64.into());
    let measure=|xs:&[Audited]|xs.iter().map(measured).sum::<num_rational::BigRational>()/&scale;
    let union=make(0);let u=oracle(Operation::Union);let i=oracle(Operation::Intersection);
    assert!(u.width().is_zero()&&i.width().is_zero());assert!(u.contains(&measure(&union)));
    assert!(!i.contains(&measure(&union)),"union reported as intersection escaped");
    let mut flipped=union.clone();
    // Reverse a real nonzero face contribution, rather than changing a measure.
    let index=flipped[0].face_loops.iter().position(|face| {
        let mut candidate=union.clone();let j=candidate[0].face_loops.iter().position(|f|f==face).unwrap();candidate[0].face_loops[j].reverse();
        measure(&candidate)!=measure(&union)
    }).unwrap();
    flipped[0].face_loops[index].reverse();
    assert!(!u.contains(&measure(&flipped)),"flipped face escaped");
    let disjoint=orthogonal::boolean(BodyKey{id:[4,0,0,0],revision:0},0,&[a,operand(5,5.)]).unwrap();
    let audited=disjoint.iter().map(|body|audit(&wonky_wire::v3::decode(&wonky_wire::v3::encode(body).unwrap()).unwrap()).unwrap()).collect::<Vec<_>>();
    assert_eq!(audited.len(),2);
    let boxes=[[[1.,1.,1.],[3.,3.,3.]],[[5.,1.,1.],[7.,3.,3.]]].map(|b|b.map(|p|point3(p).unwrap()));
    let cuts=std::array::from_fn(|k|boxes.iter().flat_map(|b|[b[0][k].clone(),b[1][k].clone()]).collect());
    let d=enclose([point3([1.,1.,1.]).unwrap(),point3([7.,3.,3.]).unwrap()],&cuts,128,|c|Ok::<_,()>(Operation::Union.classify(&boxes.iter().map(|b| {
        if (0..3).any(|k|c[1][k]<=b[0][k]||c[0][k]>=b[1][k]) {Membership::Outside}
        else if (0..3).all(|k|c[0][k]>=b[0][k]&&c[1][k]<=b[1][k]) {Membership::Inside} else {Membership::Boundary}
    }).collect::<Vec<_>>()))).unwrap();
    assert!(d.contains(&measure(&audited)));assert!(!d.contains(&measure(&audited[1..])),"dropped fragment escaped");
}

#[test]
fn revolved_operand_box_membership_uses_certified_radial_ranges_in_all_axes() {
    use wonky_ops::{affine::Affine, analytic, interference_proof, revolve_full};
    use wonky_oracle::point3;
    let segments=[[0.,0.,2.,0.],[2.,0.,1.,3.],[1.,3.,0.,3.],[0.,3.,0.,0.]];
    for axis in 0..3 {
        let body=revolve_full::build(BodyKey{id:[90,axis as u32,0,0],revision:0},[91,0,0,0],Affine::IDENTITY,axis,&segments,std::f64::consts::TAU).unwrap();
        let checked=wonky_wire::v3::decode(&wonky_wire::v3::encode(&body).unwrap()).unwrap();
        let operand=interference_proof::operand_shape(&analytic::audit(&checked).unwrap()).unwrap();
        assert!(operand.has_membership());
        let mut inside=[[0.2;3],[0.3;3]];inside[0][axis]=1.;inside[1][axis]=1.2;
        assert_eq!(operand.classify_box(&inside.map(|p|point3(p).unwrap())).unwrap(),(true,false));
        let mut outside=inside;outside[0][(axis+1)%3]=3.;outside[1][(axis+1)%3]=4.;
        assert_eq!(operand.classify_box(&outside.map(|p|point3(p).unwrap())).unwrap(),(false,true));
        let mut boundary=[[-2.;3],[2.;3]];boundary[0][axis]=1.;
        assert_eq!(operand.classify_box(&boundary.map(|p|point3(p).unwrap())).unwrap(),(false,false));
    }
}
