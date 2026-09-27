// Scored CAD-Acid and warm benchmark observations use the same Rust measurements.
import {zoneFrame} from './common.mjs';
import {observationProbes, observationPoints} from './evidence.mjs';

// The exact class (strict rust) observes its own construction (decision D1):
// general kernel measurements (volume, area, bbox in a frame given as data,
// topology, probe distance with an exact inside test), composed here into the
// zone observation. The OCCT STEP observer stays the independent round trip.
// A probe kind the kernel cannot measure refuses by name; it is never guessed.
export class ObservationCapabilityError extends Error { constructor(message){super(message);this.name='ObservationCapabilityError';} }
export function nativeObservation(model,rust,catalog,zone,variant) {
  const kernel=rust.rustModelKernel(model), [r,t]=zoneFrame(catalog,zone,variant);
  // local = R^T (world - t), as data for the kernel's bbox-in-a-frame measurement.
  const inverse=[0,1,2].map(i=>[...[0,1,2].map(j=>r[j][i]),-[0,1,2].reduce((s,j)=>s+r[j][i]*t[j],0)]);
  const mapped=p=>[0,1,2].map(i=>r[i][0]*p[0]+r[i][1]*p[1]+r[i][2]*p[2]+t[i]);
  const definitions=observationProbes(zone);
  const probes=observationPoints(zone).map(p=>({...p,point:mapped(p.point)}));
  for(const m of definitions)if(!['probeDistance','bodyDistance','bboxExtent'].includes(m.definition.kind))
    throw new ObservationCapabilityError('unsupported native measurement kind: '+m.definition.kind);
  const bodies=model.bodies.map(body=>({body,m:rust.measureRustBody(kernel,body,{map:inverse,probes:probes.map(p=>p.point)})}));
  const sum=f=>bodies.reduce((s,b)=>s+f(b.m),0);
  const union=(key)=>bodies.length?{min:[0,1,2].map(k=>Math.min(...bodies.map(b=>b.m[key].min[k]))),max:[0,1,2].map(k=>Math.max(...bodies.map(b=>b.m[key].max[k])))}:null;
  const measurements={}, measurementErrors={}, measurementEvidence={};
  const seen = name => {const i=probes.findIndex(p=>p.name===name);return bodies.map(b=>b.m.probes[i]);};
  const containing = name => {
    const candidates=seen(name);
    const refused=candidates.find(s=>s.refused);
    if(refused)throw new ObservationCapabilityError(refused.refused);
    const selected=bodies.filter((_,i)=>candidates[i].inside);
    // Decided membership with zero/multiple matches is an observed mismatch,
    // not an unavailable kernel capability. Preserve topology for the scorer.
    return selected.length===1?selected[0].body:null;
  };
  for(const m of definitions) {
    const d=m.definition;
    if(d.kind==='probeDistance') {
      const candidates=seen(m.name),refused=candidates.find(s=>s.refused);
      if(refused)throw new ObservationCapabilityError(refused.refused);
      measurements[m.name]=candidates.some(s=>s.inside)?0:Math.min(...candidates.map(s=>s.distanceMm));
    } else if(d.kind==='bodyDistance') {
      const a=containing(m.name+'-a'),b=containing(m.name+'-b');
      if(a===null||b===null) {
        // Leave the value absent: score.mjs already rejects missing measurements.
        // Never replace it by zero, nor hide the successful (wrong) construction.
        measurementErrors[m.name]='bodyDistance selector must identify one solid';
      } else {
        const measured=rust.distanceRustBodies(kernel,a,b);
        measurements[m.name]=measured.distanceMm;
        measurementEvidence[m.name]={kind:d.kind,bodyA:a.id,bodyB:b.id,...measured};
      }
    } else if(d.kind==='bboxExtent') {
      const axis=['local x','local y','local z'].indexOf(d.axis);
      if(axis<0||bodies.length!==1)throw new ObservationCapabilityError('bboxExtent requires one body and a construction axis');
      const extents=rust.sourceExtentsRustBody(kernel,bodies[0].body);
      measurements[m.name]=extents[axis];
      measurementEvidence[m.name]={kind:d.kind,body:bodies[0].body.id,axis,extentsMm:extents};
    }
  }
  const topology={};
  for(const b of bodies)for(const [k,v] of Object.entries(b.m.topology))topology[k]=(topology[k]??0)+v;
  const localBbox=union('mappedBboxMm');
  return {
    sourceHash:model.backend.sourceHash, measurementEvidence,
    bodies:bodies.map(({body,m})=>({id:body.id,wc0Sha256:rust.rustBodySha256(body),certificate:m.certificate,boundToConstruction:m.boundToConstruction,
      volumeRelBound:m.volumeRelBound,areaRelBound:m.areaRelBound,toleranceMm:m.toleranceMm,
      probes:probes.map((p,i)=>({name:p.name,...m.probes[i]}))})),
    metrics:{basis:'native-f64-construction',observer:'Rust wonky-ops::polyhedron (exact source-frame audit; exact volume; correctly rounded world coordinates)',
      volume:sum(m=>m.volumeMm3),area:sum(m=>m.areaMm2),
      bodies:bodies.map(({m})=>({volume:m.volumeMm3,area:m.areaMm2,centroid:m.centroidMm,bbox:m.bboxMm,topology:m.topology})),
      bbox:union('bboxMm'),localBbox,topology,measurements,measurementErrors,
      // measure.py's rule, from the kernel's own bbox in the zone frame.
      cellAttribution:zone.id==='AC46'||bodies.every(({m})=>['min','max'].every(s=>m.mappedBboxMm[s].every(x=>x>=-90&&x<=90))),
      validity:{brep:bodies.every(b=>b.m.validity.brep),closed:bodies.every(b=>b.m.validity.closed),positive:bodies.every(b=>b.m.validity.positive&&b.m.volumeMm3>0)}},
  };
}

// A timed sample is not admissible merely because its topology/volume/bbox
// digest matches: every scored measurement and native body must be usable.
export function assertValidTimedNativeObservation(observed, zone) {
  const {bodies, metrics, measurementEvidence} = observed;
  if (!bodies.length || Object.keys(metrics.measurementErrors).length
      || ['brep', 'closed', 'positive'].some(key => metrics.validity[key] !== true)
      || observationProbes(zone).some(({name}) => !Object.hasOwn(metrics.measurements, name)
        || !Number.isFinite(metrics.measurements[name]) || metrics.measurements[name] < 0
        || measurementEvidence[name]?.refused)
      || bodies.some(body => body.boundToConstruction !== true
        || body.probes.some(probe => probe.refused || typeof probe.inside !== 'boolean'
          || !Number.isFinite(probe.distanceMm) || probe.distanceMm < 0))) {
    throw new Error('TIMED_NATIVE_OBSERVATION_INVALID');
  }
}
