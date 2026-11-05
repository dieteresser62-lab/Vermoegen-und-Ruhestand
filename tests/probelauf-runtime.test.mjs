import { resolveProbelaufRuntime, CANDIDATE_IDENTIFIER } from '../app/shared/probelauf-runtime.js';
const capabilities = (actual, label) => {
    for (const key of ['canStart', 'canContinue', 'canRecover']) assertEqual(actual[key], true, `${label}: ${key}`);
};
for (const protocol of ['http:', 'https:', 'file:']) {
    for (const query of ['', '?probelauf=1', '?probelauf=true', '?probelauf=01', '?probelauf=0']) {
        for (const state of [null, { active: true, phase: 'active', runtime: 'browser' }, { active: true, phase: 'starting', runtime: 'tauri' }]) {
            const actual = await resolveProbelaufRuntime({ win: { location: { href: `${protocol}//localhost/index.html${query}` } }, state });
            assertEqual(actual.kind, 'browser', 'Browser erkannt'); capabilities(actual, protocol + query);
        }
    }
}
// Auch die alte App und ihre früheren Kandidaten bleiben erkannte Tauri-Laufzeiten.
for (const identifier of [CANDIDATE_IDENTIFIER, 'de.vermoegen-ruhestand.entwicklung', 'de.vermoegen-ruhestand.suite', 'com.dieter.ruhestandsapp', 'com.dieter.ruhestandsapp.kandidat', 'fremd', undefined]) {
    const actual = await resolveProbelaufRuntime({ win: { location: { href: 'tauri://localhost/index.html' }, __TAURI__: { app: { getIdentifier: async () => identifier } } } });
    assertEqual(actual.kind, 'tauri', 'Tauri erkannt'); capabilities(actual, String(identifier));
}
for (const markers of [{ __TAURI__: {} }, { __TAURI_INTERNALS__: {} }, { __TAURI_METADATA__: {} }, { __TAURI__: { app: { getIdentifier: async () => { throw new Error('IPC'); } } } }]) {
    const actual = await resolveProbelaufRuntime({ win: { location: { href: 'https://localhost/index.html' }, ...markers } });
    assertEqual(actual.kind, 'tauri', 'Taurimerkmale haben auch ohne Identifier Vorrang'); capabilities(actual, 'Tauri ohne Kennung');
}
for (const win of [{}, { location: { href: 'kaputt' } }, { location: { href: 'unknown://localhost' } }]) {
    const actual = await resolveProbelaufRuntime({ win });
    assertEqual(actual.kind, 'unknown', 'Unbekannte Laufzeit');
    for (const key of ['canStart', 'canContinue', 'canRecover']) assertEqual(actual[key], false, `Unbekannt: ${key} gesperrt`);
}
