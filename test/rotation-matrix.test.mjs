import test from 'node:test';
import assert from 'node:assert/strict';
import {scalarBuiltins} from '../src/scalars.mjs';
import {binary, cast, map, Matrix, Quantity, Vector} from '../src/values.mjs';
import {FeatureScriptException, NamedRefusal} from '../src/errors.mjs';
const std = scalarBuiltins();
const rotate = (axis, angle) => std.rotationMatrix3d.call([new Vector(axis), new Quantity(angle, 0, 1)]);
const apply = (r, v) => binary('*', r, new Vector(v)).items;
const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-14, `${v} != ${b[i]}`));

test('axis-angle std matrix: handedness, normalization, skew axes and angle units', () => {
  assert.ok(rotate([0, 0, 1], 0) instanceof Matrix);
  assert.deepEqual(rotate([1, 2, 3], 0).rows, [[1,0,0],[0,1,0],[0,0,1]]);
  near(apply(rotate([0,0,2], Math.PI / 2), [1,0,0]), [0,1,0]);
  near(apply(rotate([2,0,0], Math.PI / 2), [0,1,0]), [0,0,1]);
  near(apply(rotate([0,-2,0], Math.PI / 2), [0,0,1]), [-1,0,0]);
  // A 120-degree turn about (1,1,1) cycles the three basis vectors.
  for (const [input, output] of [[[1,0,0],[0,1,0]], [[0,1,0],[0,0,1]], [[0,0,1],[1,0,0]]])
    near(apply(rotate([1,1,1], 2 * Math.PI / 3), input), output);
  near(apply(rotate([0,0,1], -Math.PI / 2), [1,0,0]), [0,-1,0]);
  for (const magnitude of [Number.MIN_VALUE, Number.MAX_VALUE])
    assert.deepEqual(rotate([0,0,magnitude], 0.23).rows, rotate([0,0,1], 0.23).rows);
  // vector.fs delegates angle.value, without checking the unit dimension.
  assert.deepEqual(std.rotationMatrix3d.call([new Vector([0,0,1]),new Quantity(0.23)]).rows,
    rotate([0,0,1],0.23).rows);
});

test('numeric rotation corners agree bit for bit with std scalar trig input semantics', () => {
  for (let i = 0; i < 24; i++) {
    const theta = binary('*', i * 15, std.degree), radius = i % 2 ? 8 : 10;
    const r = std.rotationMatrix3d.call([new Vector([0,0,1]), theta]);
    const [x,y] = apply(r, [radius,0,0]);
    assert.equal(x, radius * std.cos.call([theta]) + 0);
    assert.equal(y, radius * std.sin.call([theta]) + 0);
  }
});

test('invalid axes/angles fail and unimplemented vector overload refuses by name', () => {
  for (const axis of [[0,0,0], [0,1], [0,0,Infinity], [0,0,new Quantity(1)]])
    assert.throws(() => rotate(axis, 0.5), FeatureScriptException);
  for (const angle of [0.5, undefined, new Quantity(Infinity,0,1)])
    assert.throws(() => std.rotationMatrix3d.call([new Vector([0,0,1]), angle]), FeatureScriptException);
  assert.throws(() => std.rotationMatrix3d.call([new Vector([1,0,0]),new Vector([0,1,0])]),
    e => e instanceof NamedRefusal && e.reason === 'rotation/from-to-overload');
});

test('rounded rotation matrices cannot become exact placements through matrix arithmetic', () => {
  const r = rotate([0,0,1], Math.PI / 12), identity = rotate([0,0,1], 0);
  const origin = new Vector([0,0,0].map(v => new Quantity(v)));
  assert.ok(std.transform.call([identity,origin]));
  assert.throws(() => cast(map({linear:r,translation:origin}), 'Transform'),
    e => e instanceof NamedRefusal && e.reason === 'rotation/non-exact-matrix');
  for (const matrix of [r, binary('*',r,identity), binary('*',identity,r), binary('*',r,1),
    binary('*',1,r), binary('/',r,1), binary('+',r,new Matrix([[0,0,0],[0,0,0],[0,0,0]])),
    binary('-',r,new Matrix([[0,0,0],[0,0,0],[0,0,0]])), std.inverse.call([r]),
    rotate([1,1,1],Number.MIN_VALUE), rotate([0,0,1],Math.PI/2)])
    assert.throws(() => std.transform.call([matrix,origin]),
      e => e instanceof NamedRefusal && e.reason === 'rotation/non-exact-matrix');
});
