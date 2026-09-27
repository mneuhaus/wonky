// Adversarial count probes for the generated wire decoders (gen-wire.mjs).
//
// From a wire manifest (wire.json) this builds, per op, sample requests in
// which every List has one element, every String one character, every Maybe a
// value and every tagged ADT the constructor `variant % constructors`, and it
// records where each List or String count word sits and how wide its elements
// are at least (minWords). test/native-bridge-slice.test.mjs cuts a sample at a
// count word and appends a count the rest of the request cannot carry; the
// decoder must refuse it without doing work in proportion to the count.
//
// Only wire structure is used: the sample values are zero words and never
// reach a kernel def (every probe request is malformed by construction).

const listOf = label => /^List<(.*)>$/.exec(label)?.[1];
const maybeOf = label => /^Maybe<(.*)>$/.exec(label)?.[1];

export function sampleRequest(manifest, op, variant = 0) {
  const adts = new Map(manifest.adts.map(adt => [adt.type, adt]));
  const words = [], counts = [];
  const width = label => {
    if (listOf(label) !== undefined || maybeOf(label) !== undefined || ['U32', 'F32', 'Bool', 'String'].includes(label)) return 1;
    return (adts.get(label) ?? fail(label)).minWords;
  };
  const fail = label => { throw new Error(`wire-probe: no wire type '${label}' in the manifest`); };
  const emit = (label, path) => {
    if (label === 'U32' || label === 'F32' || label === 'Bool') return words.push(0);
    if (label === 'String') { counts.push({ at: words.length, type: 'String', w: 1, path }); return words.push(1, 0x41); }
    const elem = listOf(label);
    if (elem !== undefined) {
      counts.push({ at: words.length, type: label, w: width(elem), path });
      words.push(1);
      return emit(elem, `${path}[0]`);
    }
    const value = maybeOf(label);
    if (value !== undefined) { words.push(1); return emit(value, `${path}?`); }
    const adt = adts.get(label) ?? fail(label);
    const tag = variant % adt.constructors.length, ctor = adt.constructors[tag];
    if (adt.tagged) words.push(tag);
    for (const field of ctor.fields) emit(field.type, `${path}.${field.name}`);
  };
  op.params.forEach(param => emit(param.type, param.name));
  return { words, counts };
}

// One probe per distinct (op, prefix): the request words before a count word.
export function countProbes(manifest) {
  const probes = [], seen = new Set();
  const variants = Math.max(1, ...manifest.adts.map(adt => adt.constructors.length));
  manifest.ops.forEach((op, id) => {
    for (let variant = 0; variant < variants; variant++) {
      const { words, counts } = sampleRequest(manifest, op, variant);
      for (const count of counts) {
        const prefix = words.slice(0, count.at), key = `${id}:${prefix.join(',')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        probes.push({ op: id, name: `${op.def.split(':')[0]}:${op.name}`, variant, ...count, prefix });
      }
    }
  });
  return probes;
}
