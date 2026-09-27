// node --import ./scripts/corpus/fs-interpreter-semantics/prototype/register.mjs bin/wonky.mjs ...
// Runs the production CLI with the prototype fix applied in memory.
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
