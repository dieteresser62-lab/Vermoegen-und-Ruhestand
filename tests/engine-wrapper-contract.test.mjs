import { readFileSync } from 'node:fs';

// Unabhängiger Solltext: Änderungen am Ladepfad benötigen einen Vertragsreview.
const expectedWrapper = `// AUTO-GENERATED FALLBACK (kein Bundle, Modul-Import)
import { EngineAPI } from './engine/index.mjs';
if (typeof window !== 'undefined') {
  window.EngineAPI = EngineAPI;
  // Legacy compat: Ruhestandsmodell_v30 is deprecated, use EngineAPI
  window.Ruhestandsmodell_v30 = EngineAPI;
}
export { EngineAPI };
export { EngineAPI as Ruhestandsmodell_v30 }; // Legacy alias
`;

const actualWrapper = readFileSync(new URL('../engine.js', import.meta.url), 'utf8');
// TP-3 ergänzt ausschließlich diese Typprüfmarkierung vor dem generierten Text.
const normalizeWrapper = text => text.replace(/\r\n/g, '\n').replace(/^\/\/ @ts-check\n/, '');

assert(
    normalizeWrapper(actualWrapper) === expectedWrapper,
    'engine.js muss dem vollständigen reinen Modul-Wrapper entsprechen (CRLF normalisiert, führendes @ts-check erlaubt). '
    + 'Eingebettete Engine-Logik und zusätzlicher Code verletzen den Wrappervertrag; '
    + 'ein bewusster Wechsel zu einem Bundle benötigt eine eigene geprüfte Vertragsänderung.'
);
assert(normalizeWrapper('// @ts-check\r\n' + expectedWrapper.replace(/\n/g, '\r\n')) === expectedWrapper,
    'Typprüfmarkierung und CRLF ändern den Wrappervertrag nicht');
assert(normalizeWrapper('// @ts-check\n' + expectedWrapper + 'window.extra = true;\n') !== expectedWrapper,
    'zusätzlicher ausführbarer Code bleibt trotz Typprüfmarkierung verboten');
assert(normalizeWrapper(expectedWrapper.replace("'./engine/index.mjs'", "'./engine/core.mjs'")) !== expectedWrapper,
    'ein geänderter Moduleinstieg bleibt verboten');
