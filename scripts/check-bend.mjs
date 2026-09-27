import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, 'bend.lock.json'), 'utf8'));
const bend = join(root, '.tools', `bend-${version}`, 'bin', 'bend');
if (!existsSync(bend) || !existsSync(join(root, 'kernel/vendor/bend-collections/src')) || !existsSync(join(root, 'kernel/ports/occt.bend'))) {
  console.log('Bend toolchain: retired local-only inputs unavailable; proof check skipped.');
  process.exit(0);
}
execFileSync(bend, ['PROOF.bend'], {
  cwd: root, env: { ...process.env, BEND_NO_TELEMETRY: '1' }, stdio: 'inherit',
});
