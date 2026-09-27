import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("ray.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { loadKernel, array } = await import("../src/kernel.mjs");
const { real, vector, number, coords } = await import("../src/real.mjs");
const { intersectionSurface } = await import("../src/intersections.mjs");
const { lineSurfaceIntersections, requireResolvedLineIntersection, lineIntersectionKinds } = await import("../src/ray.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");








const k = await loadKernel();
const { default: ray } = await import('../kernel/ray.bend');
const near = (a,b,tolerance=2e-10) => assert.ok(Number.isFinite(a) && Math.abs(a-b)<=tolerance*Math.max(1,Math.abs(b)), `${a} != ${b}`);
const plane = (o=[0,0,0], n=[0,0,1]) => k.analytic.plane(vector(o), vector(n));
const cylinder = (o=[0,0,0], n=[0,0,1], r=5) => k.analytic.cylinder(vector(o), vector(n), real(r));
const cone = (o=[0,0,0], n=[0,0,1], r=3, angle=Math.PI/4) => k.analytic.cone(vector(o), vector(n), real(r), real(angle));
const intersect = (o,d,s) => ray.line_surface(vector(o),vector(d),s);
const parameters = result => array(result.values).map(number);

test('Bend supporting-line/plane distinguishes crossings, coincidence, parallel and unresolved/range cases',()=>{
  const hit=intersect([1,2,3],[0,0,-2],plane());
  assert.equal(hit.kind,1);assert.deepEqual(parameters(hit),[3]);
  assert.equal(intersect([1,2,0],[1,0,0],plane()).kind,3);
  assert.equal(intersect([1,2,3],[1,0,0],plane()).kind,0);
  assert.equal(intersect([0,0,1],[1,0,1e-13],plane()).kind,4);
  assert.equal(intersect([0,0,100],[1,0,1e-5],plane()).kind,6);
  assert.equal(intersect([0,0,0],[0,0,0],plane()).kind,5);
  assert.equal(intersect([10001,0,0],[1,0,0],plane()).kind,5);
});

test('stable F32x2 quadratic roots retain the small root lost by the naive subtraction formula',()=>{
  const result=ray.quadratic(real(1),real(-1e8),real(1));
  assert.equal(result.kind,1);
  const [small,large]=parameters(result);
  near(small,1e-8,1e-20);near(large,1e8,1e-14);
  near(small*large,1,1e-13);
  assert.equal(ray.quadratic(real(1),real(0),real(1)).kind,0);
  assert.equal(ray.quadratic(real(0),real(2),real(-4)).kind,1);
  assert.deepEqual(parameters(ray.quadratic(real(0),real(2),real(-4))),[2]);
});

test('Bend cylinder intersections expose tangency and near-tangency instead of inventing crossings',()=>{
  const s=cylinder();
  const hit=intersect([-10,0,0],[1,0,0],s);
  assert.equal(hit.kind,1);assert.deepEqual(parameters(hit),[5,15]);
  const tangent=intersect([-10,5,0],[1,0,0],s);
  assert.equal(tangent.kind,2);assert.deepEqual(parameters(tangent),[10]);
  for(const offset of [-1e-12,1e-12])assert.equal(intersect([-10,5+offset,0],[1,0,0],s).kind,4);
  assert.equal(intersect([-10,6,0],[1,0,0],s).kind,0);
  assert.equal(intersect([5,0,0],[0,0,1],s).kind,3);
  assert.equal(intersect([0,0,0],[0,0,1],s).kind,0);
  assert.equal(intersect([0,0,0],[1e-7,0,1],s).kind,4);
});

test('translated/rotated cylinder hits match an independent local-coordinate oracle and lie on both line and surface',()=>{
  const n=[0.6,0,0.8],u=[0.8,0,-0.6],v=[0,1,0],center=[123,-217,391];
  const world=(x,y,z)=>center.map((c,i)=>c+x*u[i]+y*v[i]+z*n[i]);
  const direction=u.map((x,i)=>x+0.4*n[i]);
  const s=cylinder(center,n,5);
  for(const y of [-4.5,-2,0,1,4.5]) for(const z of [-7,0,12]) {
    const origin=world(-8,y,z), result=intersect(origin,direction,s);
    assert.equal(result.kind,1);
    const expected=[8-Math.sqrt(25-y*y),8+Math.sqrt(25-y*y)].map(t=>t*Math.sqrt(1.16));
    array(result.values).forEach((t,i)=>{
      near(number(t),expected[i]);
      const p=ray.point(vector(origin),vector(direction),t);
      assert.ok(k.analytic.surface_residual(s,p)<1e-9);
      coords(p).forEach((x,j)=>near(x,origin[j]+direction[j]/Math.sqrt(1.16)*expected[i]));
    });
    const reverse=parameters(intersect(origin,direction.map(x=>-x),s));
    reverse.forEach((t,i)=>near(t,-expected[1-i]));
  }
});

test('cone roots preserve the physical nappe and mark the apex as unresolved',()=>{
  const s=cone();
  const hit=intersect([-10,0,2],[1,0,0],s);
  assert.equal(hit.kind,1);parameters(hit).forEach((t,i)=>near(t,[5,15][i]));
  assert.equal(intersect([-10,0,-8],[1,0,0],s).kind,0);
  assert.equal(intersect([-10,0,-3],[1,0,0],s).kind,4);
  const axial=intersect([1,0,0],[0,0,1],s);
  assert.equal(axial.kind,1);assert.equal(parameters(axial).length,1);near(parameters(axial)[0],-2);
  for(const t of array(axial.values))assert.ok(k.analytic.surface_residual(s,ray.point(vector([1,0,0]),vector([0,0,1]),t))<1e-10);
  const cylinderCone=cone([0,0,0],[0,0,1],5,0);
  assert.deepEqual(parameters(intersect([-10,0,0],[1,0,0],cylinderCone)),[5,15]);
});

// An independent exact-word oracle. F32 words are integral multiples of
// 2^-149, so all of these zero/sign predicates fit losslessly in BigInt.
const wordBuffer=new ArrayBuffer(4),wordView=new DataView(wordBuffer);
function exactWord(value){
  wordView.setFloat32(0,value,false);
  const bits=wordView.getUint32(0,false),exponent=(bits>>>23)&255,fraction=bits&0x7fffff;
  assert.notEqual(exponent,255);
  const unsigned=exponent?BigInt(fraction|0x800000)<<BigInt(exponent-1):BigInt(fraction);
  return bits>>>31?-unsigned:unsigned;
}
const exactReal=v=>exactWord(v.hi)+exactWord(v.lo);
const exactVector=v=>[v.x,v.y,v.z].map(exactReal);
const exactDot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0n);
const exactCross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const rawPlane=(normal,origin=[0,0,0])=>intersectionSurface({type:'plane',normal,origin});
const rawCylinder=(radius=1,axis=[0,0,1],origin=[0,0,0])=>intersectionSurface({type:'cylinder',radius,axis,origin});
const noValues=(result,kind)=>{assert.equal(result.kind,kind);assert.deepEqual(parameters(result),[]);};

test('generic quadratic certifies its represented coefficients and refuses a rounded-zero discriminant',()=>{
  const e=2**-40,a=real(1),b=real(2*(1+e)),c=real(1+2*e);
  const rounded=k.real.sub(k.real.mul(b,b),k.real.mul(real(4),k.real.mul(a,c)));
  assert.equal(number(rounded),0,'regression must exercise a computed zero');
  const exact=exactReal(b)**2n-4n*exactReal(a)*exactReal(c);
  assert.ok(exact>0n,'the represented polynomial has two distinct roots');
  noValues(ray.quadratic(a,b,c),4);
  const tangent=ray.quadratic(real(1),real(-4),real(4));
  assert.equal(tangent.kind,2);assert.deepEqual(parameters(tangent),[2]);
  assert.equal(ray.quadratic(real(0),real(0),real(0)).kind,3);
  noValues(ray.quadratic(real(0),real(0),real(2)),0);
  noValues(ray.quadratic(real(1e-14),real(1),real(1)),4);
});

test('original plane predicates prevent invented misses, origin hits, and coincidence from cancellation',()=>{
  const e=2**-40,n=vector([1,1+e,0]),d=vector([1+2*e,-(1+e),0]);
  const surface={$:'Plane',origin:vector([0,0,0]),normal:n,x:vector([0,0,1])};
  assert.equal(number(k.precise.dot(n,d)),0);
  assert.notEqual(exactDot(exactVector(n),exactVector(d)),0n);
  // A rounded zero denominator formerly claimed a miss or a coincident line.
  noValues(ray.line_surface(vector([1,0,0]),d,surface),4);
  noValues(ray.line_surface(vector([0,0,1]),d,surface),4);
  // A rounded zero offset formerly claimed coincidence or a root at zero.
  noValues(ray.line_surface(d,vector([0,0,1]),surface),4);
  noValues(ray.line_surface(d,n,surface),4);
  const transverse=intersect([1,2,3],[0,0,4],rawPlane([0,0,3]));
  assert.equal(transverse.kind,1);assert.deepEqual(parameters(transverse),[-3]);
  const throughOrigin=intersect([2,3,0],[0,0,4],rawPlane([0,0,3]));
  assert.equal(throughOrigin.kind,1);assert.deepEqual(parameters(throughOrigin),[0]);
});

test('original cylinder polynomials prevent rounded coefficients from inventing hits or coincidence',()=>{
  const e=2**-40;
  for(const [origin,radius,sign] of [
    [[1,2**-20,0],1+e/2,-1],
    [[1+e,e,0],1+e,1],
  ]){
    const o=vector(origin),r=real(radius),surface=rawCylinder(radius);
    const rounded=k.real.sub(k.precise.dot(o,o),k.real.mul(r,r));
    assert.equal(number(rounded),0,'regression must exercise a computed zero coefficient');
    const exact=exactDot(exactVector(o),exactVector(o))-exactReal(r)**2n;
    assert.equal(exact<0n?-1:exact>0n?1:0,sign);
    noValues(ray.line_surface(o,vector([0,0,1]),surface),4);
    noValues(ray.line_surface(o,vector([1,0,0]),surface),4);
  }
  const origin=[1+e,e,0],direction=[-e,1+e,0],surface=rawCylinder(1+e);
  const oi=exactVector(vector(origin)),di=exactVector(vector(direction)),ri=exactReal(surface.radius);
  const a=exactDot(di,di),b=2n*exactDot(oi,di),c=exactDot(oi,oi)-ri*ri;
  assert.ok(b*b-4n*a*c<0n,'the exact represented line misses the cylinder');
  // The rounded polynomial x^2 = 0 has a double root, but it does not certify
  // the original cylinder. The surface entrypoint must withhold that hit.
  assert.equal(ray.quadratic(real(1),real(0),real(0)).kind,2);
  noValues(intersect(origin,direction,surface),4);
  const n=vector([1,1+e,0]),d=vector([1+2*e,-(1+e),0]);
  assert.equal(number(k.precise.dot(n,k.precise.normalize(d))),0);
  assert.notEqual(exactDot(exactVector(n),exactVector(d)),0n);
  noValues(ray.line_surface(n,d,rawCylinder()),4);
});

test('underflow cannot turn an almost axial cylinder line into a miss or a coincident generator',()=>{
  const axis=vector([0,0,1]),d=vector([1e-40,0,1]);
  assert.ok(exactCross(exactVector(axis),exactVector(d)).some(v=>v!==0n));
  assert.equal(number(k.real.mul(d.x,d.x)),0,'squared radial direction underflows in the regression');
  noValues(ray.line_surface(vector([0,0,0]),d,rawCylinder()),4);
  noValues(intersect([1,0,0],[0,1e-40,1],rawCylinder()),4);
});

test('nonzero cone angles distinguish exact base-circle reductions from uncertified tangent and generator equations',()=>{
  const angle=real(0.37),radius=real(3),surface={$:'Cone',origin:vector([0,0,0]),axis:vector([0,0,1]),x:vector([1,0,0]),radius,angle};
  const baseTangent=intersect([-10,3,0],[1,0,0],surface);
  assert.equal(baseTangent.kind,2);assert.deepEqual(parameters(baseTangent),[10]);
  const baseCrossing=intersect([3,0,0],[1,0,0],surface);
  assert.equal(baseCrossing.kind,1);parameters(baseCrossing).forEach((t,i)=>near(t,[-6,0][i]));
  const slope=k.real.div(k.real.sin(angle),k.real.cos(angle));
  const atHeight=k.real.add(radius,k.real.mul(slope,real(2)));
  const approximateTangent={$:'V3',x:real(-10),y:atHeight,z:real(2)};
  // Its represented polynomial can be tangent to the computed tan(angle).
  // That is not an exact certificate for the original analytic cone.
  noValues(ray.line_surface(approximateTangent,vector([1,0,0]),surface),4);
  const approximateGenerator={$:'V3',x:slope,y:real(0),z:real(1)};
  noValues(ray.line_surface(vector([3,0,0]),approximateGenerator,surface),4);
});

const vAdd=(a,b)=>a.map((v,i)=>v+b[i]);
const vScale=(a,s)=>a.map(v=>v*s);
const vDot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const vNorm=a=>Math.hypot(...a);
const vUnit=a=>vScale(a,1/vNorm(a));
const vSub=(a,b)=>a.map((v,i)=>v-b[i]);
function independentResidual(surface,point){
  const offset=vSub(point,surface.origin),axis=vUnit(surface.axis),z=vDot(offset,axis);
  return Math.abs(vNorm(vSub(offset,vScale(axis,z)))-(surface.radius+Math.tan(surface.angle)*z));
}
function referenceQuadratic(a,b,c){
  const d=b*b-4*a*c;
  if(d<0)return [];
  const q=-0.5*(b+(b<0?-Math.sqrt(d):Math.sqrt(d)));
  return [q/a,c/q].sort((x,y)=>x-y);
}

test('rotated translated cone roots agree with independent analytic roots and signed line parameters',()=>{
  const n=[0.6,0,0.8],u=[0.8,0,-0.6],v=[0,1,0],center=[-87,129,317];
  const world=(x,y,z)=>vAdd(center,vAdd(vScale(u,x),vAdd(vScale(v,y),vScale(n,z))));
  for(const angle of [-0.21,0.3,0.6]) for(const q of [-0.2,0,0.25]) for(const y of [-1,0,1]) for(const z of [-1,0,4]){
    const slope=Math.tan(angle),atOrigin=3+slope*z,direction=vAdd(u,vScale(n,q)),origin=world(-10,y,z);
    const reference=referenceQuadratic(1-(slope*q)**2,-20-2*atOrigin*slope*q,100+y*y-atOrigin**2)
      .filter(s=>3+slope*(z+q*s)>1e-6).map(s=>s*Math.sqrt(1+q*q));
    const source={type:'cone',origin:center,axis:n,radius:3,angle};
    const surface=intersectionSurface(source),result=intersect(origin,direction,surface);
    assert.equal(result.kind,reference.length?1:0);
    const values=array(result.values);assert.equal(values.length,reference.length);
    values.forEach((t,i)=>{
      near(number(t),reference[i],4e-11);
      const point=coords(ray.point(vector(origin),vector(direction),t));
      assert.ok(independentResidual(source,point)<2e-9);
      point.forEach((value,j)=>near(value,origin[j]+vUnit(direction)[j]*reference[i],3e-11));
    });
    const reversed=parameters(intersect(origin,vScale(direction,-7),surface));
    reversed.forEach((t,i)=>near(t,-reference[reference.length-1-i],4e-11));
  }
});

test('stable raw quadratic roots agree with an independent root oracle across signs and scales',()=>{
  let seed=518206;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
  for(let i=0;i<100;i++){
    const first=(random()-0.5)*200,second=first+1+random()*100,a=(i%2?-1:1)*10**(random()*6-2);
    const b=-a*(first+second),c=a*first*second,result=ray.quadratic(real(a),real(b),real(c));
    assert.equal(result.kind,1);
    parameters(result).forEach((root,j)=>near(root,[first,second][j],2e-10));
    near(parameters(result)[0]*parameters(result)[1],c/a,5e-11);
  }
});

test('finite bounds and malformed Real words fail explicitly in both raw and geometric entrypoints',()=>{
  const zero=real(0),one=real(1);
  for(const invalid of [{$:'Real',hi:NaN,lo:0},{$:'Real',hi:Infinity,lo:0},{$:'Real',hi:0,lo:1}]){
    noValues(ray.quadratic(invalid,one,one),5);
    noValues(ray.quadratic(one,invalid,one),5);
    noValues(ray.quadratic(one,one,invalid),5);
    const origin=vector([0,0,0]);origin.x=invalid;
    noValues(ray.line_surface(origin,vector([1,0,0]),rawCylinder()),5);
    const surface=rawCylinder();surface.radius=invalid;
    noValues(ray.line_surface(vector([0,0,0]),vector([1,0,0]),surface),5);
  }
  noValues(ray.quadratic(real(1e15),one,one),5);
  noValues(ray.linear(real(2e-12),real(1e14)),6);
  noValues(intersect([0,0,0],[0,0,1e-13],rawPlane([0,0,1])),5);
  noValues(intersect([0,0,0],[1,0,0],rawCylinder(0)),5);
  noValues(intersect([0,0,0],[1,0,0],rawCylinder(-1)),5);
  noValues(intersect([0,0,0],[1,0,0],rawCylinder(10001)),5);
  noValues(intersect([0,0,0],[1,0,0],rawCylinder(1,[0,0,0])),5);
  noValues(intersect([0,0,0],[1,0,0],cone([0,0,0],[0,0,1],3,1.41)),5);
  const generic=ray.quadratic(one,real(-1e8),one);
  assert.equal(generic.kind,1);assert.ok(parameters(generic)[1]>100000);
  noValues(intersect([0,0,100],[1,0,1e-5],rawPlane([0,0,1])),6);
  const boundary=intersect([0,0,10000],[0,0,-1],rawPlane([0,0,1]));
  assert.equal(boundary.kind,1);assert.deepEqual(parameters(boundary),[10000]);
  assert.equal(ray.linear(one,zero).kind,1);
});

test('ray adapter retains Bend values and reports unresolved capability errors',async()=>{
  const result=await lineSurfaceIntersections([-10,0,0],[2,0,0],{type:'cylinder',origin:[0,0,0],axis:[0,0,1],radius:5});
  assert.equal(result.kind,lineIntersectionKinds.transverse);
  assert.deepEqual(parameters(result),[5,15]);
  assert.equal(requireResolvedLineIntersection(result),result);
  const unresolved=await lineSurfaceIntersections(vector([0,0,0]),vector([1e-40,0,1]),rawCylinder());
  assert.equal(unresolved.kind,lineIntersectionKinds.unresolved);
  assert.throws(()=>requireResolvedLineIntersection(unresolved),UnsupportedFeatureError);
  assert.throws(()=>requireResolvedLineIntersection({$: 'Roots',kind:6,values:{$:'Nil'}}),UnsupportedFeatureError);
});

}
