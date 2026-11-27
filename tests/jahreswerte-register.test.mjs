// JD-2b Soll 3: Register der amtlichen Jahreswerte (data/jahreswerte.json) und `npm run jahreswerte:pruefen`.
// Jeder Ort im Code muss den eingetragenen Stand noch enthalten; die Fälligkeit folgt aus Gültigkeitsbeginn und Rhythmus.
// Feste Testdaten: 17.11.2026 (Stand dieses Pakets), 01.12.2026 und 02.01.2027 (Termine der Liveprobe).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { faelligkeiten, faelligkeitenText, registerFehler, registerLesen } from '../scripts/lib/jahreswerte.mjs';

console.log('--- Register der amtlichen Jahreswerte ---');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = value => JSON.stringify(value);
const register = registerLesen(root);

console.log('Test 1: Register vollständig, jeder Ort belegt den Stand im Code');
assertEqual(json(registerFehler(register, root)), '[]', 'Register ohne Fehler');
assertEqual(json(register.gruppen.map(gruppe => gruppe.id)), json(['pflegegeld-kassenleistungen', 'heim-eigenanteile-pflegepreise', 'rentenwert',
    'bmf-vervielfaeltiger-wohnrecht', 'periodensterbetafel', 'pflegestatistik', 'kohortentafel']), 'Wertgruppen aus dem Ideengespräch');
for (const gruppe of register.gruppen) {
    for (const feld of ['stand', 'gueltigAb', 'quelle', 'rhythmus', 'orte']) assert(gruppe[feld] !== undefined, `${gruppe.id}: ${feld}`);
}
const geaendert = JSON.parse(JSON.stringify(register));
geaendert.gruppen[2].orte[0].suchtext = "export const CURRENT_PENSION_VALUE_DATE = '2027-07-01';";
geaendert.gruppen[0].rhythmusMonate = 0;
assertEqual(json(registerFehler(geaendert, root)), json([
    'pflegegeld-kassenleistungen: rhythmusMonate muss eine positive ganze Zahl oder null sein',
    "rentenwert: Suchtext „export const CURRENT_PENSION_VALUE_DATE = '2027-07-01';“ steht nicht in app/simulator/simulator-household-pension.js"
]), 'abweichender Stand im Code und ungültiger Rhythmus werden gemeldet');

console.log('Test 2: Fälligkeit nach Rhythmus und Datum');
const status = heute => Object.fromEntries(faelligkeiten(register, heute).map(item => [item.id, [item.status, item.faellig]]));
assertEqual(json(status('2026-11-17')), json({
    'pflegegeld-kassenleistungen': ['demnaechst', '2027-01-01'],
    'heim-eigenanteile-pflegepreise': ['demnaechst', '2027-01-01'],
    rentenwert: ['aktuell', '2027-07-01'],
    'bmf-vervielfaeltiger-wohnrecht': ['aktuell', '2028-01-01'],
    periodensterbetafel: ['aktuell', '2027-08-01'],
    pflegestatistik: ['demnaechst', '2026-12-01'],
    kohortentafel: ['ohne Rhythmus', null]
}), 'Stand am 17.11.2026');
const amZweiten = status('2027-01-02');
for (const id of ['pflegegeld-kassenleistungen', 'heim-eigenanteile-pflegepreise', 'pflegestatistik']) {
    assertEqual(amZweiten[id][0], 'ueberfaellig', `${id}: am 02.01.2027 überfällig`);
}
assertEqual(amZweiten.rentenwert[0], 'aktuell', 'Rentenwert erst ab Juli');
assertEqual(amZweiten['bmf-vervielfaeltiger-wohnrecht'][0], 'aktuell', 'JA-1: Die 2027er Tabelle liegt zum Jahreswechsel vor');
const text = faelligkeitenText(faelligkeiten(register, '2027-01-02'), '2027-01-02');
assertEqual(text[0], 'Amtliche Jahreswerte am 2027-01-02: 3 überfällig, 0 demnächst, 3 aktuell, 1 ohne Rhythmus', 'Kopfzeile zählt je Status');
assert(text[1].startsWith('  ÜBERFÄLLIG: '), 'Überfälliges zuerst');
assert(text.some(zeile => zeile.includes('Im Code: app/shared/care-benefits.js')), 'Ort im Code bei Fälligem');

console.log('Test 3: Befehl und Liveprobe');
const lauf = datum => spawnSync(process.execPath, ['scripts/jahreswerte-pruefen.mjs', '--datum', datum], { cwd: root, encoding: 'utf8' });
const vorher = lauf('2026-11-17');
assertEqual(vorher.status, 0, 'Exit 0 ohne Überfälliges');
assert(vorher.stdout.startsWith('Amtliche Jahreswerte am 2026-11-17: 0 überfällig, 3 demnächst'), 'Ausgabe am 17.11.2026');
assertEqual(lauf('2027-01-02').status, 1, 'Exit 1 mit Überfälligem');
assertEqual(spawnSync(process.execPath, ['scripts/jahreswerte-pruefen.mjs', '--datum', '2.1.2027'], { cwd: root, encoding: 'utf8' }).status, 2, 'falsches Datum bricht ab');
const paket = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assertEqual(paket.scripts['jahreswerte:pruefen'], 'node scripts/jahreswerte-pruefen.mjs', 'npm-Befehl jahreswerte:pruefen');
const probe = fs.readFileSync(path.join(root, 'scripts/liveprobe-jahreswechsel.mjs'), 'utf8');
assert(/jahreswerteAusgeben\(\);\n\s+await jahresdatenQuellenAusgeben\(year\);\n\s+console\.log\(`Ergebnis:/.test(probe), 'Liveprobe gibt Register und Quellentabelle vor dem Ergebnis aus');
const { jahreswerteAusgeben } = await import('../scripts/liveprobe-jahreswechsel.mjs');
const ausgabe = [];
const log = console.log;
console.log = zeile => ausgabe.push(zeile);
try { jahreswerteAusgeben('2026-12-01', root); } finally { console.log = log; }
assertEqual(ausgabe[0], 'Amtliche Jahreswerte am 2026-12-01: 1 überfällig, 2 demnächst, 3 aktuell, 1 ohne Rhythmus', 'Liveprobe am 01.12.2026');
const ohneRegister = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'jahreswerte-'));
console.log = zeile => ausgabe.push(zeile);
try { jahreswerteAusgeben('2026-12-01', ohneRegister); } finally { console.log = log; fs.rmSync(ohneRegister, { recursive: true, force: true }); }
assert(ausgabe.includes('Amtliche Jahreswerte: Register fehlerhaft') && ausgabe.some(zeile => zeile.startsWith('  Register nicht lesbar:')), 'unlesbares Register bricht die Liveprobe nicht ab');
const appCode = ['app', 'Simulator.html', 'Balance.html', 'index.html'].flatMap(eintrag => {
    const voll = path.join(root, eintrag);
    if (fs.statSync(voll).isFile()) return [fs.readFileSync(voll, 'utf8')];
    const dateien = [];
    const besuchen = ordner => fs.readdirSync(ordner, { withFileTypes: true }).forEach(item => {
        const datei = path.join(ordner, item.name);
        if (item.isDirectory()) besuchen(datei); else if (/\.(js|html)$/.test(item.name)) dateien.push(fs.readFileSync(datei, 'utf8'));
    });
    besuchen(voll);
    return dateien;
});
assert(!appCode.some(quelltext => quelltext.includes('jahreswerte.json')), 'Die App liest das Register nicht');
