import { readFileSync } from 'node:fs';
import { CANDIDATE_IDENTIFIER } from '../app/shared/probelauf-runtime.js';

const readJson = relativePath => JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
const base = readJson('../src-tauri/tauri.conf.json');
const release = readJson('../src-tauri/tauri.release.conf.json');
const packageJson = readJson('../package.json');
const schema = readJson('../node_modules/@tauri-apps/cli/config.schema.json');

assertEqual(release.identifier, 'de.vermoegen-ruhestand.suite', 'Release verwendet den Datenbereich der ausgelieferten App.');
assertEqual(release.productName, 'Vermögen & Ruhestand', 'Release setzt den sichtbaren Produktnamen einschließlich Sonderzeichen.');
assertEqual(release.mainBinaryName, 'VermoegenUndRuhestand', 'Tauri erhält den Release-Dateinamen ohne die automatisch ergänzte EXE-Endung.');
assert(schema.properties.mainBinaryName?.type.includes('string'), 'Die installierte Tauri-Version unterstützt mainBinaryName.');
assert(new RegExp(schema.properties.productName.pattern).test(release.productName), 'Umlaut, Leerzeichen und & erfüllen das Tauri-Schema für den Produktnamen.');
assert(Object.keys(release).every(key => ['$schema', 'identifier', 'productName', 'mainBinaryName'].includes(key)), 'Die Zusatzkonfiguration überschreibt nur die Release-Metadaten.');

// Die Zusatzkonfiguration enthält nur Wurzelwerte; Tauri übernimmt den Rest aus der Basis.
const effective = { ...base, ...release };
assertEqual(effective.app.windows[0].title, 'Vermögen & Ruhestand', 'Release übernimmt den bereits richtigen Fenstertitel.');
assertEqual(effective.build.frontendDist, '../dist', 'Release bindet das zuvor synchronisierte Frontend ein.');

assertEqual(base.identifier, 'de.vermoegen-ruhestand.entwicklung', 'Entwickler verwenden den eigenen neuen Datenbereich.');
assert(base.identifier !== release.identifier, 'Entwickler- und Release-Build haben getrennte Datenbereiche.');
assertEqual(CANDIDATE_IDENTIFIER, `${base.identifier}.kandidat`, 'Die Kandidatenkennung folgt der Basis und bleibt vom Release getrennt.');
assertEqual(base.productName, 'Vermögen & Ruhestand Entwicklung', 'Der Produktname kennzeichnet den Entwickler-Build.');
assertEqual(base.mainBinaryName, undefined, 'Der Entwickler-Build verwendet weiter den Cargo-Binärnamen.');
const cargo = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
assert(/^\[package\]\s*\nname = "vermoegen_und_ruhestand"/m.test(cargo), 'Das Cargo-Paket bestimmt den neuen Namen der Entwickler-EXE.');
assertEqual(packageJson.scripts['build:desktop'], 'npm run sync-dist && npm run tauri:build', 'Der Entwickler-Build bleibt unverändert.');
assertEqual(packageJson.scripts['build:release'],
    'npm run sync-dist && npm run tauri -- build --no-bundle --config src-tauri/tauri.release.conf.json',
    'Release synchronisiert zuerst dist und baut dann die EXE mit der Zusatzkonfiguration ohne Installer.');
