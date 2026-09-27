// No host geometry: transmit the interpreter's binary64 metre values verbatim.
export function rustSphereBuiltins(engine, h, api) {
  const { Request, OP, call, bodyKey, point3, metres, RustBody, measure } = api;
  const makeSphere = builtin => ([context, id, definition], loc) => {
    const d = h.fieldMap(definition, ['center', 'radius'], [], loc);
    const r = new Request(OP.SPHERE);
    for (const w of bodyKey(id.toString())) r.u32(w);
    for (const x of point3(d.center, 'center', loc)) r.f64(x);
    r.f64(metres(d.radius, 'radius', loc));
    engine.claim(context, id, loc);
    const body = new RustBody(id.toString(), call(engine.kernel, r.done(), builtin, loc), null);
    const m = measure(engine.kernel, body);
    body.validation = { closed: m.validity.closed, brep: m.validity.brep,
      volumeMm3: m.volumeMm3, areaMm2: m.areaMm2, toleranceMm: m.toleranceMm,
      boundsMm: m.bboxMm, certificate: m.certificate, boundToConstruction: m.boundToConstruction };
    engine.addSolid(id, body);
  };
  return { fSphere: makeSphere('fSphere'), opSphere: makeSphere('opSphere') };
}
