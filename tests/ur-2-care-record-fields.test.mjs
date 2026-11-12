// UR-2: Pflegegeld je Grad und Heim-Bestandteile jederzeit im Reiter Pflege ändern. Derselbe Record `household_care_values_v1`,
// geändert nur der Wert, `origin`, `asOf` und `validFrom`; ungültige Eingaben schreiben nichts; der Spielbereich schreibt nur in die
// Spielkopie; der Jahresabschluss startet mit den geänderten Werten; Balance rechnet mit einem geänderten Pflegegeld.
// Synthetische Daten, Testdatum 23.10.2026.
import { pfa2Records, countingStorage } from './helpers/pfa-2-balance.mjs';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { PersistenceFacade as P, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { bindManagerCareValues, renderManagerCareValues } from '../app/tranches/tranchen-manager-care-values.js';
import { HOUSEHOLD_CARE_VALUES_KEY, parseCareValues, residentialMonthly } from '../app/shared/household-care-values.js';
import { writeCareRecordField } from '../app/shared/care-price-fields.js';
import { createAnnualCareEditor } from '../app/shared/annual-care-editor.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { readFileSync } from 'node:fs';
setAppTestDate('2026-10-23');

const plain = text => String(text).replace(/[  ]/g, ' ');

/** Kleinste Seite mit den Kennungen aus depot-tranchen-manager.html, Ereignisse wie im Browser (wie in PFA-10). */
function managerDocument() {
    const nodes = new Map(), listeners = {};
    const node = (id, extra = {}) => {
        const element = { id, dataset: {}, hidden: false, disabled: false, value: '', textContent: '', innerHTML: '', title: '', tagName: 'DIV', attributes: {},
            setAttribute(name, value) { this.attributes[name] = String(value); }, getAttribute(name) { return this.attributes[name] ?? null; },
            closest: () => null, blur() { listeners.change?.({ target: this }); }, ...extra };
        if (id) nodes.set(id, element);
        return element;
    };
    const html = readFileSync(new URL('../depot-tranchen-manager.html', import.meta.url), 'utf8');
    node('managerCarePanel', { addEventListener(type, fn) { listeners[type] = fn; }, querySelectorAll: () => [] });
    for (const match of html.matchAll(/<(input|select|dl|div|p|span|strong|td)\b[^>]*\bid="(managerCare[^"]+)"[^>]*>/g)) {
        if (nodes.has(match[2])) continue;
        const field = /data-care-field="([^"]+)"/.exec(match[0])?.[1];
        node(match[2], { tagName: match[1].toUpperCase(), ...(field ? { dataset: { careField: field } } : {}) });
    }
    const doc = { activeElement: null, getElementById: id => nodes.get(id) ?? null, querySelectorAll: () => [] };
    const change = (id, value) => { const field = nodes.get(id); field.value = value; listeners.change({ target: field }); };
    return { doc, nodes, change };
}

/** Echter Persistenzweg mit Speicherzähler; die Aktion bedient den Reiter. */
async function run(records, action) {
    const store = new Map(Object.entries(records));
    let saves = 0;
    P.resetPersistenceForTests({ name: 'UR-2', async loadAll() { return Object.fromEntries(store); },
        async saveBatch({ upserts, deletes }) { saves++; for (const key of deletes) store.delete(key); for (const [key, value] of upserts) store.set(key, value); } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    let page;
    try { page = managerDocument(); bindManagerCareValues(page.doc); renderManagerCareValues(page.doc); await action(page); await P.flush(); }
    finally { await resetPersistenceForTests(); }
    return { records: Object.fromEntries(store), saves, page };
}

const base = pfa2Records({ care: [{ grade: 2, form: 'family' }, null] }).records;
const before = parseCareValues(base[HOUSEHOLD_CARE_VALUES_KEY] ?? null);

// 1. Pflegegeld Grad 3: Nur Wert, Herkunft, Stand und gültig ab ändern sich; alles andere bleibt bytegleich.
{
    const result = await run(base, async page => {
        assertEqual(page.nodes.get('managerCareAllowance3').value, '599', 'Feld zeigt das gespeicherte Pflegegeld Grad 3');
        assertEqual(page.nodes.get('managerCareHeimCare').value, '2.088', 'Heim-Bestandteil mit Tausenderpunkt wie die übrigen Betragsfelder');
        page.change('managerCareAllowance3', '620'); await P.flush();
    });
    const after = JSON.parse(result.records[HOUSEHOLD_CARE_VALUES_KEY]);
    const expected = structuredClone(before);
    expected.allowance.values[3] = 620;
    Object.assign(expected.allowance, { origin: 'von Hand', asOf: '2026-10', validFrom: '2026-10' });
    assertEqual(JSON.stringify(after), JSON.stringify(expected), 'Nur allowance.values[3], origin, asOf und validFrom geändert; Quelle und Bestätigung bleiben');
    assertEqual(plain(result.page.nodes.get('managerCareStatus').textContent), 'Gespeichert', 'Gleiche Statusmeldung wie die übrigen Pflegefelder');
    assert(plain(result.page.nodes.get('managerCareRowAllowanceSummary').textContent).includes('347 / 620 / 800 / 990 €/Monat')
        && plain(result.page.nodes.get('managerCareRowAllowanceSummary').textContent).endsWith('von Hand, gültig ab 10.2026'), 'Zeilenkopf nennt neuen Wert und Herkunft');
}

// 2. Heim-Bestandteil: components und monthly neu, Heimjahre stimmen; Pflegegeld bleibt.
{
    const result = await run(base, async page => { page.change('managerCareHeimCare', '2300'); await P.flush(); });
    const after = JSON.parse(result.records[HOUSEHOLD_CARE_VALUES_KEY]);
    const components = { care: 2300, board: 1068, invest: 521 };
    assertEqual(JSON.stringify(after.residential.components), JSON.stringify(components), 'Bestandteile mit neuem Pflegeanteil');
    assertEqual(after.residential.monthly, residentialMonthly(components), 'Eigenanteil im ersten Heimjahr neu gerechnet');
    assertEqual(after.residential.monthly, Math.floor(0.85 * 2300 + 1068 + 521 + 0.5), '1. Heimjahr: 85 % Pflegeanteil + Unterkunft + Investition');
    assertEqual(`${after.residential.origin} ${after.residential.asOf} ${after.residential.validFrom} ${after.residential.source === before.residential.source}`,
        'von Hand 2026-10 2026-10 true', 'Heim: Herkunft von Hand, Stand und gültig ab Oktober, Quelle bleibt');
    assertEqual(JSON.stringify(after.allowance), JSON.stringify(before.allowance), 'Pflegegeld bleibt unverändert');
    assert(plain(result.page.nodes.get('managerCareHeimYears').innerHTML).includes(`${residentialMonthly(components, 4).toLocaleString('de-DE')} €`), 'Kachel ab 4. Heimjahr neu');
    assert(plain(result.page.nodes.get('managerCareHeimSource').textContent).startsWith('von Hand, gültig ab 10.2026'), 'Herkunft am Heim');
}

// 3. Ungültige Eingaben (leer, negativ, kein Betrag) schreiben nichts und nennen den Grund.
for (const value of ['', '-5', 'abc']) {
    const result = await run(base, async page => {
        page.change('managerCareAllowance2', value); await P.flush();
        assert(plain(page.nodes.get('managerCareStatus').textContent).includes('ab 0'), `Ungültig „${value}“: Grund wird genannt`);
        assertEqual(page.nodes.get('managerCareAllowance2').value, '347', `Ungültig „${value}“: Feld zeigt wieder den gespeicherten Wert`);
    });
    assertEqual(result.saves, 0, `Ungültig „${value}“: keine Schreibcharge`);
    assertEqual(result.records[HOUSEHOLD_CARE_VALUES_KEY] ?? null, base[HOUSEHOLD_CARE_VALUES_KEY] ?? null, `Ungültig „${value}“: Record unverändert`);
}
assert((() => { try { writeCareRecordField('careAllowance2', '-1', { storage: countingStorage(base).storage }); return false; } catch { return true; } })(), 'Schreibweg weist negative Beträge ab');

// 4. Unveränderter Betrag schreibt nichts; Lesen und Anzeigen schreiben nie.
{
    const { storage, counts } = countingStorage(base);
    assertEqual(writeCareRecordField('careAllowance2', '347', { storage }), false, 'Gleicher Betrag: kein Schreiben');
    const page = managerDocument();
    renderManagerCareValues(page.doc, { storage });
    assertEqual(counts.setItem + counts.removeItem, 0, 'Anzeigen schreibt nie');
}

// 5. Spielbereich: Die Eingabe landet nur in der Spielkopie.
{
    const f = await playFixture('tauri', base); await f.boot();
    const real = f.realBytes();
    await P.activatePlayArea({ source: 'copy', records: await P.readRealRecords() });
    P.resetPersistenceRuntimeForTests(); await P.init(f.options);
    const page = managerDocument(); bindManagerCareValues(page.doc); renderManagerCareValues(page.doc);
    page.change('managerCareAllowance2', '400'); await P.flush();
    assertEqual(JSON.parse(P.getItemSync(HOUSEHOLD_CARE_VALUES_KEY)).allowance.values[2], 400, 'Spielkopie trägt das neue Pflegegeld');
    assertEqual(f.realBytes(), real, 'Echte Daten bleiben unverändert');
    P.resetPersistenceRuntimeForTests();
}

// 6. Jahresabschluss startet mit den im Reiter geänderten Werten; Balance rechnet mit Pflegegeld Grad 2 400 statt 347 €/Monat.
{
    const changed = await run(base, async page => { page.change('managerCareAllowance2', '400'); await P.flush(); page.change('managerCareHeimBoard', '1100'); await P.flush(); });
    const records = new Map(Object.entries(changed.records));
    const storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, String(value)), removeItem: key => records.delete(key) };
    const { doc } = createDialogFixture();
    const editor = createAnnualCareEditor({ doc, targetYear: 2026, storage, listen: (node, type, fn) => node.addEventListener(type, fn) });
    const start = editor.read().values;
    assertEqual(`${start.allowance.values[2]} ${start.residential.components.board} ${start.allowance.origin}`, '400 1100 von Hand', 'Jahresabschluss: Ausgangswerte aus dem Reiter');
    const balance = before => buildBalanceEngineInputFromStorage({ storage: countingStorage(before).storage, scope: pfa2Records({}).scope, referenceYear: 2026 });
    const old = balance(base), now = balance(changed.records);
    assertEqual(now.engineInput.renteMonatlich - old.engineInput.renteMonatlich, 400 - 347, 'Balance: Pflegegeld Grad 2 zählt mit 400 statt 347 €/Monat');
}
setAppTestDate(null);
