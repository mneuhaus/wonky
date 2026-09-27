// `--out` / `--format` writes of the current good live revision, byte-equal
// to bin/wonky.mjs. Package: live-server.
//
//   writeOutputs(prefix, revision, { format }) -> { files, refused }
//
// `revision.outputs` is rendered inside the build worker from the same model
// object the CLI renders: [{ extension, contents } | { extension, error }] in
// the CLI's order (brep.json, step, then stl + html for `all`, or the print
// stl + print.json for `print`). Each file is written to a temporary name and
// renamed, like the CLI; a refused format is reported and the others are
// still written. Only registered (good, current) revisions reach this, so a
// failed or superseded build leaves the files untouched.
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const OUTPUT_FORMATS = Object.freeze(['all', 'step', 'print']);

export async function writeOutputs(prefix, revision, { format = 'all' } = {}) {
  if (!OUTPUT_FORMATS.includes(format)) throw new Error('--format expects all, step or print');
  const target = resolve(prefix);
  const outputs = revision?.outputs;
  if (!Array.isArray(outputs)) throw new Error('This revision carries no rendered outputs');
  await mkdir(dirname(target), { recursive: true });
  const files = [];
  const refused = [];
  for (const output of outputs) {
    if (output.error !== undefined) {
      refused.push({ extension: output.extension, error: output.error });
      continue;
    }
    const file = `${target}.${output.extension}`;
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, output.contents);
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
    files.push(file);
  }
  return { files, refused };
}
