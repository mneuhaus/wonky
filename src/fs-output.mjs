import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// print and println receive std toString(value), as string.fs specifies.
// Output is observational, including inside try/feature rollback. In particular
// it never goes to stdout, where CLI geometry/export consumers read results.
export function fsOutput(sourcePath, directory) {
  return (value, loc, newline) => {
    const text = `${sourcePath ?? '<input>'}:${loc?.line ?? '?'}: ${value}${newline ? '\n' : ''}`;
    process.stderr.write(text);
    if (directory) {
      mkdirSync(directory, { recursive: true });
      appendFileSync(join(directory, 'println.log'), text);
    }
  };
}
