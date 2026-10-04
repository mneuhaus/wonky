// Use the identity package's actual FS operands and interpreter execution.
import {source,operation} from './boolean-identity-generators.mjs';
import {build} from '../../src/index.mjs';
import {rustModelKernel,placeRustBody,bindRustModel} from '../../src/native/rust-host.mjs';
import {ModelingContext} from '../../src/library.mjs';
import {Interpreter} from '../../src/interpreter.mjs';
import {parse} from '../../src/parser.mjs';
import {Id,map} from '../../src/values.mjs';
export async function boolean(c,op) {
  if(!c.rational) return build(source(c.a+c.b+operation(op)),{feature:'f'});
  const a=await build(source(c.a),{feature:'f'}), b=await build(source(c.b),{feature:'f'});
  const kernel=rustModelKernel(a),engine=new ModelingContext(kernel);
  a.bodies=a.bodies.map(body=>placeRustBody(kernel,body,{rational:c.rational}));
  for(const [name,model] of [['a',a],['b',b]]) for(const body of model.bodies) engine.addSolid(new Id(['model',name]),body);
  new Interpreter(engine.builtins()).run(parse(source(operation(op))),'f',engine.context,new Id(['model']),()=>map({}));
  const model={bodies:engine.bodies};bindRustModel(model,kernel);return model;
}
