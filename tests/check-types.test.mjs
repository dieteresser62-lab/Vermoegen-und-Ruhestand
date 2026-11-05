import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ts from 'typescript';
import { hasTsCheck, collectDiagnostics, reconcileNormalDiagnostics } from '../scripts/typecheck-support.mjs';

assert(hasTsCheck('// @ts-check\nconst x = 1;'), 'Markierung in erster Zeile');
assert(hasTsCheck('/** Kopf */\n// @ts-check\nconst x = 1;'), 'Markierung nach Kopfkommentar');
assert(!hasTsCheck('const x = 1;\n// @ts-check'), 'spätere Markierungen schalten keine Datei frei');
assert(!hasTsCheck('const x = "// @ts-check";'), 'Zeichenkette ist keine Markierung');
assert(!hasTsCheck('/**\n// @ts-check\n*/\nconst x = 1;'), 'Text in einem Blockkommentar ist keine Zeilenmarkierung');
const root = mkdtempSync(path.join(os.tmpdir(), 'tp1-types-'));
try {
    const normal = path.join(root, 'normal.js'), imported = path.join(root, 'imported.js'), strict = path.join(root, 'strict.js');
    writeFileSync(imported, '// @ts-check\nexport const n = 1; n.noSuchProperty();');
    writeFileSync(normal, '// @ts-check\nimport { n } from "./imported.js";\n/** @type {string} */ const x = n;');
    writeFileSync(strict, 'export function identity(value) { return value; }');
    const config = { fileNames: [normal, imported, strict], options: { allowJs: true, checkJs: false, noEmit: true,
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
        skipLibCheck: true, types: [] } };
    const diagnostics = collectDiagnostics(config, [normal]);
    assertEqual(diagnostics.length, 1, 'normal: nur Fehler der freigeschalteten Datei');
    assertEqual(diagnostics[0].file.fileName, normal, 'Fehler importierter Dateien werden ausgefiltert');
    assertEqual(collectDiagnostics(config, [strict]).length, 0, 'nicht markierte Datei bleibt ohne checkJs ungeprüft');
    const strictDiagnostics = collectDiagnostics({ ...config, options: { ...config.options, strict: true } }, [strict]);
    assert(strictDiagnostics.some(d => d.code === 7006), 'strenge Liste prüft auch ohne @ts-check');
    const mapDiagnostics = collectDiagnostics(config, [normal, imported, strict], { all: true });
    assertEqual(mapDiagnostics.length, 2, 'Fehlerkarte prüft alle Dateien');
    const defaultChecked = collectDiagnostics({ ...config, options: { ...config.options, checkJs: true } }, [normal, imported, strict]);
    assertEqual(defaultChecked.length, 2, 'checkJs prüft auch ohne einzelne Markierungen');
    writeFileSync(strict, '/** @type {number} */ const newFile = "falsch";');
    assert(collectDiagnostics({ ...config, options: { ...config.options, checkJs: true } }, [strict])
        .some(d => d.code === 2322), 'neue Datei ohne @ts-check wird automatisch geprüft');
    writeFileSync(strict, '// @ts-check\n/** @type {number|undefined} */ const optional = undefined;\n'
        + '// @ts-expect-error Muster: nur unter strictNullChecks ein Fehler\noptional * 2;\n'
        + '// @ts-expect-error Muster: absichtlich unbenutzt für die Gegenprobe\nconst valid = 1;\n'
        + '/** @type {string} */ const mismatch = 1;');
    const bothNormal = collectDiagnostics(config, [strict]);
    const bothStrict = collectDiagnostics({ ...config, options: { ...config.options, strict: true } }, [strict]);
    assertEqual(bothNormal.filter(d => d.code === 2578).length, 2, 'Normalmodus erkennt beide Direktiven als unbenutzt');
    const reconciled = reconcileNormalDiagnostics(bothNormal, bothStrict, [strict]);
    assertEqual(reconciled.filter(d => d.code === 2578).length, 1, 'wirklich unbenutzte Direktive bleibt ein Fehler');
    assert(reconciled.some(d => d.code === 2322), 'sonstige Normalfehler bleiben erhalten');
    assertEqual(reconcileNormalDiagnostics(bothNormal, bothStrict, []).length, bothNormal.length,
        'ohne strenge Prüfung darf keine Direktive ausgefiltert werden');
} finally {
    rmSync(root, { recursive: true, force: true });
}
