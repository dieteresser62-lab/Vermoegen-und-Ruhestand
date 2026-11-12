// UR-2b (Codex-Befunde zu UR-2): Betragsfelder lesen deutsche Gruppierung (Tausenderpunkt, Dezimalkomma); Kurs-, Prozent- und
// Stückzahlfelder bleiben wie bisher. Pflegegeld höchstens 10.000 €/Monat, Heim-Bestandteile höchstens 100.000 €/Monat.
// Synthetische Daten, Testdatum 23.10.2026.
import { readFileSync } from 'node:fs';
import { canonicalDecimalInput, readDecimalInput, bindDecimalInputDisplay } from '../app/tranches/tranchen-manager-decimal-input.js';
import { pfa2Records, countingStorage } from './helpers/pfa-2-balance.mjs';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { PersistenceFacade as P, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { bindManagerCareValues, renderManagerCareValues } from '../app/tranches/tranchen-manager-care-values.js';
import { HOUSEHOLD_CARE_VALUES_KEY } from '../app/shared/household-care-values.js';
import { writeCareRecordField } from '../app/shared/care-price-fields.js';
setAppTestDate('2026-10-23');

const field = id => ({ id, tagName: 'INPUT', type: 'text', value: '', getAttribute: name => name === 'inputmode' ? 'decimal' : null });
const money = field('managerCareHeimCare'), cash = field('profileTagesgeld'), price = field('purchasePrice'), percent = field('profileGoldZiel');

// 1. Betragsfeld: deutsche Gruppierung, Komma als Dezimalzeichen, ein Punkt mit ein bis zwei Ziffern bleibt Dezimalpunkt.
for (const [text, expected] of [['2.088', 2088], ['2.088,50', 2088.5], ['1.234.567', 1234567], ['120.000', 120000], ['347', 347], ['2,5', 2.5],
    ['2.5', 2.5], ['2.50', 2.5]]) {
    for (const target of [money, cash]) assertEqual(readDecimalInput(text, target), expected, `${target.id}: „${text}“ → ${expected}`);
}
for (const text of ['1,234.56', '2.08.8', '1.23.456', '12.34,5']) {
    for (const target of [money, cash]) assert(Number.isNaN(readDecimalInput(text, target)), `${target.id}: uneindeutig „${text}“ ist ungültig`);
}

// 2. Kurs-, Prozent- und Feld ohne Kennung: unverändert wie bisher (ein Punkt ist Dezimalpunkt, gemischt ungültig).
for (const target of [price, percent, null]) {
    const name = target?.id || 'ohne Feld';
    assertEqual(readDecimalInput('2.088', target), 2.088, `${name}: „2.088“ bleibt 2,088`);
    assertEqual(readDecimalInput('2,5', target), 2.5, `${name}: „2,5“ → 2,5`);
    assert(Number.isNaN(readDecimalInput('2.088,50', target)), `${name}: „2.088,50“ bleibt ungültig`);
    assert(Number.isNaN(readDecimalInput('1.234.567', target)), `${name}: „1.234.567“ bleibt ungültig`);
}
assertEqual(canonicalDecimalInput(''), '', 'Leer bleibt leer');

/** Kleinste Seite mit den Kennungen aus depot-tranchen-manager.html; Fokus, Eingabe und Verlassen wie im Browser. */
function managerDocument() {
    const nodes = new Map(), listeners = {}, docListeners = {};
    const node = (id, extra = {}) => {
        const element = { id, dataset: {}, hidden: false, disabled: false, readOnly: false, value: '', textContent: '', innerHTML: '', title: '', tagName: 'DIV', type: '',
            attributes: {}, setAttribute(name, value) { this.attributes[name] = String(value); }, getAttribute(name) { return this.attributes[name] ?? null; },
            closest: () => null, ...extra };
        if (id) nodes.set(id, element);
        return element;
    };
    const html = readFileSync(new URL('../depot-tranchen-manager.html', import.meta.url), 'utf8');
    node('managerCarePanel', { addEventListener(type, fn) { listeners[type] = fn; }, querySelectorAll: () => [] });
    for (const match of html.matchAll(/<(input|select|dl|div|p|span|strong|td)\b[^>]*\bid="(managerCare[^"]+)"[^>]*>/g)) {
        if (nodes.has(match[2])) continue;
        const careField = /data-care-field="([^"]+)"/.exec(match[0])?.[1];
        const input = match[1] === 'input';
        node(match[2], { tagName: match[1].toUpperCase(), ...(input ? { type: 'text', attributes: { inputmode: 'decimal' } } : {}), ...(careField ? { dataset: { careField } } : {}) });
    }
    const doc = { activeElement: null, getElementById: id => nodes.get(id) ?? null, querySelectorAll: () => [],
        addEventListener(type, fn) { docListeners[type] = fn; } };
    bindDecimalInputDisplay(/** @type {any} */ (doc));
    const type = (id, text) => {
        const target = nodes.get(id);
        docListeners.focusin({ target }); doc.activeElement = target;
        target.value = text; doc.activeElement = null;
        listeners.change({ target }); docListeners.focusout({ target });
    };
    return { doc, nodes, type };
}

async function run(records, action) {
    const store = new Map(Object.entries(records));
    let saves = 0;
    P.resetPersistenceForTests({ name: 'UR-2b', async loadAll() { return Object.fromEntries(store); },
        async saveBatch({ upserts, deletes }) { saves++; for (const key of deletes) store.delete(key); for (const [key, value] of upserts) store.set(key, value); } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    try { const page = managerDocument(); bindManagerCareValues(page.doc); renderManagerCareValues(page.doc); await action(page); await P.flush(); }
    finally { await resetPersistenceForTests(); }
    return { records: Object.fromEntries(store), saves };
}
const base = pfa2Records({}).records;
const stored = records => JSON.parse(records[HOUSEHOLD_CARE_VALUES_KEY]);

// 3. Echter Weg im Reiter Pflege: Fokussieren → „2.088“ bzw. „120.000“ eingeben → Speichern.
{
    const heim = await run(base, async page => { page.type('managerCareHeimBoard', '1.234'); await P.flush(); });
    assertEqual(stored(heim.records).residential.components.board, 1234, 'Heim „1.234“ wird 1.234 €/Monat, nicht 1,234 €');
    const heim2088 = await run(base, async page => { page.type('managerCareHeimCare', '2.100'); await P.flush(); page.type('managerCareHeimCare', '2.088'); await P.flush(); });
    assertEqual(stored(heim2088.records).residential.components.care, 2088, 'Heim „2.088“ → 2088 im Datensatz');
    const floor = await run(base, async page => { page.type('managerCareMaxFloor', '110.000'); await P.flush(); });
    assertEqual(stored(floor.records).prices.maximumFloor, 110000, 'Bestehendes Betragsfeld: Deckel „110.000“ → 110000');
    const decimal = await run(base, async page => { page.type('managerCareAllowance2', '347,50'); await P.flush(); });
    assertEqual(stored(decimal.records).allowance.values[2], 347.5, 'Pflegegeld „347,50“ → 347,5');
}

// 4. Obergrenze: Pflegegeld höchstens 10.000 €/Monat, Heim-Bestandteil höchstens 100.000 €/Monat; darüber nichts speichern.
{
    const atLimit = await run(base, async page => { page.type('managerCareAllowance3', '10.000'); await P.flush(); page.type('managerCareHeimInvest', '100.000'); await P.flush(); });
    assertEqual(`${stored(atLimit.records).allowance.values[3]} ${stored(atLimit.records).residential.components.invest}`, '10000 100000', 'Grenzwerte werden gespeichert');
    for (const [id, text] of [['managerCareAllowance3', '10.000,01'], ['managerCareAllowance3', '1e308'], ['managerCareHeimInvest', '100.000,01'], ['managerCareHeimCare', '1e308']]) {
        let reason = '';
        const result = await run(base, async page => { page.type(id, text); await P.flush(); reason = page.nodes.get('managerCareStatus').textContent; });
        assertEqual(result.saves, 0, `${id} „${text}“: nichts gespeichert`);
        assertEqual(result.records[HOUSEHOLD_CARE_VALUES_KEY] ?? null, base[HOUSEHOLD_CARE_VALUES_KEY] ?? null, `${id} „${text}“: Datensatz unverändert`);
        assert(reason.includes('höchstens'), `${id} „${text}“: Grund nennt die Obergrenze (${reason})`);
    }
    const { storage, counts } = countingStorage(base);
    for (const [id, value] of [['careAllowance2', '10000.01'], ['careResidentialBoard', '100000.01'], ['careAllowance5', '1e308']]) {
        let failed = false;
        try { writeCareRecordField(id, value, { storage }); } catch { failed = true; }
        assert(failed, `Schreibweg weist ${id} = ${value} ab`);
    }
    assertEqual(counts.setItem + counts.removeItem, 0, 'Abgewiesene Werte schreiben nichts');
}
setAppTestDate(null);
