import { readFileSync } from 'node:fs';
import { collectCodeSizes, checkFileSizes } from '../scripts/check-file-size.mjs';

const baseline = JSON.parse(readFileSync(new URL('../typcheck/grosse-dateien.json', import.meta.url), 'utf8'));
const sizes = collectCodeSizes();
const errors = checkFileSizes(sizes, baseline);
assertEqual(errors.length, 0, errors.join('\n') || 'Dateigrößen entsprechen der Ratsche');
