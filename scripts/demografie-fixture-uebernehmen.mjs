import { readFileSync, writeFileSync } from 'node:fs';

const fixturePath = new URL('../tests/fixtures/minimum-flex-severe-affordability-measurement-v1.json', import.meta.url);
const startMarker = '__MINIMUM_FLEX_AFFORDABILITY_DEMOGRAPHY_START__';
const endMarker = '__MINIMUM_FLEX_AFFORDABILITY_DEMOGRAPHY_END__';

try {
    const [, , logPath, ...extraArgs] = process.argv;
    if (!logPath || extraArgs.length) {
        throw new Error('Aufruf: node scripts/demografie-fixture-uebernehmen.mjs <logdatei>');
    }
    const lines = readFileSync(logPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
    const start = lines.indexOf(startMarker);
    const end = lines.indexOf(endMarker);
    if (start < 0 || end <= start || start !== lines.lastIndexOf(startMarker) || end !== lines.lastIndexOf(endMarker)) {
        throw new Error('Die Logdatei muss genau einen vollständigen Demografie-Messblock enthalten.');
    }
    const demography = JSON.parse(lines.slice(start + 1, end).join('\n'));
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    if (demography?.schemaVersion !== fixture.demography.schemaVersion || !demography.targetSummary) {
        throw new Error('Der Messblock enthält keine Minimum-Flex-Demografieprojektion.');
    }
    fixture.demography = demography;
    writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + '\n', 'utf8');
    console.log('Minimum-Flex-Demografieprojektion übernommen.');
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
