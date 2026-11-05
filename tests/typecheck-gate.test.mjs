import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/check-types.mjs', import.meta.url))], {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024
});
if (result.stdout) process.stdout.write(result.stdout);
assertEqual(result.status, 0, `Typprüfung muss grün sein. ${result.error?.message || ''}\n${result.stderr}`);
