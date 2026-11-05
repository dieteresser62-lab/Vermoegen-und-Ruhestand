import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { parseJavaScript } from '../scripts/javascript-syntax.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { createAnnualEngineLoader } from '../app/shared/annual-engine-loader.js';
import { createEngineHandshake } from '../app/balance/balance-update-pipeline.js';
import { REQUIRED_ENGINE_API_VERSION_PREFIX } from '../app/balance/balance-config.js';
let imports = 0;
const loader = createAnnualEngineLoader({ importEngine: async () => { imports++; return { EngineAPI }; } });
assertEqual(await loader.forOccasion(false), null, 'Ohne Jahresanlass keine API');
assertEqual(imports, 0, 'Ohne Anlass wird kein Ladeauftrag gestartet');
const [due, start, retry] = await Promise.all([loader.forOccasion(true), loader.load(), loader.load()]);
assert(due === start && start === retry && start === EngineAPI, 'Fälligkeit, Start und Retry teilen dieselbe API');
assertEqual(imports, 1, 'Genau ein dynamischer Import');
for (const api of [null, {}, { ...EngineAPI, simulateSingleYear: null },
    { ...EngineAPI, getVersion: () => ({ api: 'wrong', build: 'test' }) }]) {
    let count = 0, expected, actual;
    try { createEngineHandshake(api, REQUIRED_ENGINE_API_VERSION_PREFIX); } catch (error) { expected = error.code; }
    const invalid = createAnnualEngineLoader({ importEngine: async () => { count++; return { EngineAPI: api }; } });
    for (let attempt = 0; attempt < 2; attempt++) {
        try { await invalid.load(); } catch (error) { actual = error.code; }
        assertEqual(actual, expected, 'Balance und Jahresdienst verwenden denselben API-Handshake');
    }
    assertEqual(count, 1, 'Fehlerhafter Handshake erzeugt keinen zweiten Ladeauftrag');
}
// Den gesamten statischen Importgraph prüfen, nicht nur die unmittelbaren Importe.
function staticImports(source, file) {
    return parseJavaScript(source, file).statements
        .filter(statement => ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
        .map(statement => statement.moduleSpecifier)
        .filter(specifier => specifier && ts.isStringLiteral(specifier))
        .map(specifier => specifier.text);
}
assertEqual(JSON.stringify(staticImports(`
    /** @import * as D from '../typcheck/datenvertraege.js' */
    // import '../engine.js';
    const load = () => import('../engine/index.mjs');
    const text = "import '../engine.js'";
`)), '[]', 'Typimporte, Kommentare, Strings und dynamische Importe sind keine statischen Kanten');
assertEqual(JSON.stringify(staticImports(`
    import './side-effect.js';
    import { value as alias } from './named.js';
    export * from './all.js';
    export { value } from './reexport.js';
`)), JSON.stringify(['./side-effect.js', './named.js', './all.js', './reexport.js']), 'Alle statischen Import- und Reexportformen bleiben im Graph');
const visited = new Set();
function visit(file) {
    if (visited.has(file)) return; visited.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of staticImports(source, file)) {
        if (!specifier.startsWith('.')) continue;
        const target = path.resolve(path.dirname(file), specifier);
        assert(!target.endsWith('/engine/index.mjs') && !target.endsWith('/engine.js'), 'Startseitendienst importiert Engine ausschließlich auf Abruf');
        assert(!target.endsWith('/balance-main.js'), 'Dienst initialisiert keine versteckte Balance-Seite');
        visit(target);
    }
}
visit(path.resolve('app/shared/annual-coordinator.js'));
assert(visited.size > 1, 'Importprüfung erfasst den transitiven Dienstgraph');
