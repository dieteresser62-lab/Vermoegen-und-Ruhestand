// JD-1 Punkt 7: Aufräumen ohne Wirkung. Jeder Abschnitt hält Werte und Ergebnisse fest, die am Stand 49120d40
// (vor dem Bündeln der Konstanten) gemessen wurden. Bündeln darf hier nichts verschieben.
import { readHP4References } from './helpers/hp-4-expectations.mjs';
import { createHash } from 'node:crypto';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { inheritancePersonalAllowance, inheritanceTax, inheritanceTaxRate, inheritanceTariff, PARTNERSHIP_KEY, INHERITANCE_ALLOWANCES, INHERITANCE_TARIFFS } from '../app/profile/household-partnership.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { renderManagerPartnership } from '../app/tranches/tranchen-manager-partnership.js';
import { loadProfileAssetValues } from '../app/profile/profile-asset-values.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { CARE_BENEFITS_2026, careAllowanceAnnual } from '../app/shared/care-benefits.js';
import { DEFAULT_CARE_VALUES, officialCareCosts, parseCareValues } from '../app/shared/household-care-values.js';
import { stockFromPurchaseDate, purchaseStockState } from '../app/tranches/tranche-detail-model.js';
import { syncTranchePurchaseStock, bindTrancheModalLifecycle } from '../app/tranches/tranchen-manager-modal.js';
import { WEALTH_HISTORY_START_DATE, createAnnualWealthHistoryEntry, assertWealthHistoryDate } from '../types/wealth-history-contract.js';
import { withPlannedExpensePrices } from '../app/balance/balance-inflation-source.js';
import { CARE_DRIFT_YEAR_RANGE } from '../app/shared/care-cost-drift.js';
import { validCareDriftYear } from '../app/shared/care-price-fields.js';
import { CARE_ALLOWANCE_MONTHLY } from '../app/shared/household-care-values.js';
import { GRANDFATHERED_STOCK_CUTOFF_DATE, GRANDFATHERED_STOCK_CUTOFF_YEAR } from '../app/tranches/tranche-detail-model.js';
import { APP_INTRODUCTION_YEAR } from '../types/wealth-history-contract.js';
import { readFileSync } from 'node:fs';
const ja1 = JSON.parse(readFileSync(new URL('./fixtures/ja-1-expectation-deltas.json', import.meta.url), 'utf8'));

const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const capture = callback => { try { return { value: callback() }; } catch (error) { return { error: error.message }; } };
const MEASURE = process.env.JD1_GLEICHHEIT_MESSEN === '1';
const measured = {};
function same(name, actual, expected, message) {
    if (MEASURE) { measured[name] = actual; return; }
    assertEqual(actual, expected, message);
}

console.log('--- JD-1 Gleichheit der gebündelten Konstanten ---');

console.log('Test 1: Erbschaftsteuer – Freibeträge, Tarif und Texte');
{
    same('allowances', [inheritancePersonalAllowance('married'), inheritancePersonalAllowance('unmarried'), inheritancePersonalAllowance(undefined)].join('/'),
        '500000/20000/20000', 'Freibeträge und Verhalten ohne Status bleiben');
    // Werte der bisherigen Kopien (household-partnership.js, protocol-renderer.js, tranchen-manager-partnership.js am Stand 49120d40).
    same('centralAllowances', JSON.stringify(INHERITANCE_ALLOWANCES), '{"classI":500000,"classIII":20000}', 'Zentrale Freibeträge gleichen den bisherigen');
    same('centralTariffs', JSON.stringify(INHERITANCE_TARIFFS, (key, value) => value === Infinity ? 'Infinity' : value),
        '{"classI":[[75000,0.07],[300000,0.11],[600000,0.15],[6000000,0.19],[13000000,0.23],[26000000,0.27],["Infinity",0.3]],"classIII":[[6000000,0.3],["Infinity",0.5]]}',
        'Zentrale Tarifstufen gleichen den bisherigen');
    const estates = [0, 19999, 20000, 75000, 95000, 300001, 520000, 600000, 1e6, 6e6, 6.02e6, 6.6e6, 13e6, 26e6, 26.5e6, 3e7];
    const results = [];
    for (const status of ['married', 'unmarried', undefined]) for (const estate of estates) {
        results.push([status, estate, inheritanceTax(estate, { status }), inheritanceTax(estate, { status, exemptHome: 100000, exemptGain: 50000 }),
            inheritanceTaxRate(estate, status), inheritanceTariff(estate, status)]);
    }
    same('tariffHash', hash(results), readHP4References('06f838a99261b7be91b1d69ebf74d42924ca4e265c0226d1e6a6ee1738f31884'), 'Steuerbeträge, Sätze und Härteausgleich bleiben');
    same('taxSamples', [inheritanceTax(1e6, { status: 'married' }), inheritanceTax(1e6, { status: 'unmarried' }), inheritanceTax(6.02e6, { status: 'unmarried' })].join('/'),
        '75000/294000/1800000', 'Stichproben bleiben');
    const raw = { recordType: 'financial_year', financiallyEvaluable: true, jahr: 1, jahresentnahme_real: 6000, inflation_factor_cum: 1.1, inflation: 0,
        entscheidung: { jahresEntnahme: 6000 }, Regime: 'bear_deep', portfolio_total_end: 100000, aktionUndGrund: 'BÄR / Grund',
        vk: { vkGes: 0 }, kaufAkt: 0, abgang_erben: 0, erbschaftsteuer: 12345,
        inheritance: { deceasedProfileId: 'a', survivorProfileId: 'b', assets: 900000, home: 0, inherited: 700000, inheritedHome: 0, percent: 100,
            tax: 12345, exemptGain: 1000,
            residenceTax: { annualValue: 12000, rate: 0.11, annualTax: 1320, allowanceRemaining: 4000, immediateComparison: 30000 } } };
    const protocol = {};
    for (const partnership of [undefined, { status: 'married' }, { status: 'unmarried' }]) for (const moneyBasis of ['nominal', 'real']) {
        protocol[`${partnership?.status ?? 'ohne'}-${moneyBasis}`] = hash(renderProtocolTable([raw], { inputs: { partnership }, moneyBasis }));
    }
    // TX-1 (17.11.): neuer Hash, weil im Protokoll nur „Ruin“ → „Vermögen aufgebraucht“/„Vermögen reicht“ geändert wurde (Wortdiff geprüft).
    // VB-1 (19.11.): neuer Hash, weil spouseTaxNote „Ohne Versorgungsfreibetrag.“ durch den Satz zum gerechneten Versorgungsfreibetrag ersetzt;
    // mit dem alten Satz zurückersetzt ergibt sich genau 4f629513… (geprüft).
    // HP-2 (20.11.): neuer Hash, weil die Jahreszelle „Simulationsjahr N“ in <span class="protocol-year-part"> fasst;
    // ohne diese Spans ergibt sich genau a3dd8a71… (geprüft), der Steuertext bleibt bytegleich.
    // HP-3 (20.11.): neuer Hash, weil das Erbschaftsteuer-ⓘ bei „Euro von heute“ „, gilt nominal, in Euro von heute 909 €“ hinter den
    // Zugewinnausgleich setzt; ohne diesen Zusatz ergibt sich genau 11474cb2… (geprüft).
    // TX-2 (20.11.): neuer Hash, weil das ⓘ der Spalte Aktien/ETF „in der Strategie Drei Töpfe“ statt „in der Drei-Bucket-Strategie“ sagt;
    // mit dem alten Wortlaut zurückersetzt ergibt sich genau 2a426243… (geprüft), der Steuertext bleibt bytegleich.
    // TX-2 H-OP1-DAVON-EINRUECKUNG: neuer Hash, weil die Summenzeile im Ausgaben-ⓘ „Aus dem Vermögen bezahlt“ statt „davon aus dem Vermögen
    // bezahlt“ heißt; mit dem alten Wortlaut zurückersetzt ergibt sich genau 4c93db79… (geprüft).
    same('protocolHash', hash(protocol), ja1.protocolHash.nachher, 'JA-1: Der Protokolltext verwendet bei fehlendem Status Steuerklasse III');
    const date = '2026-10-23';
    const previews = {};
    try {
        setAppTestDate(date);
        for (const [household, variant, status] of [['max-erika', undefined, 'married'], ['max-erika', undefined, 'unmarried'],
            ['martin-petra', 'testament', 'married'], ['martin-petra', 'testament', 'unmarried'],
            ['martin-petra', undefined, undefined], ['martin-petra', undefined, null]]) {
            const records = createMusterHaushaltRecords(date, household, variant);
            const partnership = { schemaVersion: 1, inheritance: {}, ...JSON.parse(records[PARTNERSHIP_KEY] || '{}'), status };
            if (status === null) delete records[PARTNERSHIP_KEY];
            else records[PARTNERSHIP_KEY] = JSON.stringify(partnership);
            P.resetPersistenceForTests({ async loadAll() { return records; }, async saveBatch() {} });
            await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
            const registry = JSON.parse(records.rs_profiles_v1);
            const profiles = Object.entries(registry.profiles).map(([id, profile]) => {
                const tranches = JSON.parse(profile.data.depot_tranchen), values = loadProfileAssetValues({ getItem: key => profile.data[key] ?? null });
                return { id, name: profile.meta.name, belongs: true, valid: true, values, tranches,
                    assets: Number(profile.data.profile_tagesgeld) + tranches.reduce((sum, tranche) => sum + tranche.shares * tranche.currentPrice, 0) };
            });
            const nodes = Object.fromEntries(['managerPartnership', 'managerInheritance', 'managerPartnershipMarried', 'managerPartnershipSummary', 'managerPartnershipStatus']
                .map(id => [id, { innerHTML: '', textContent: '', querySelectorAll: () => [] }]));
            renderManagerPartnership({ getElementById: id => nodes[id] || null, querySelectorAll: () => [], addEventListener() {} }, { profiles });
            if (nodes.managerPartnershipStatus.textContent) throw new Error(nodes.managerPartnershipStatus.textContent);
            if (status) previews[`${household}-${status}`] = hash(nodes.managerInheritance.innerHTML);
            else {
                const html = nodes.managerInheritance.innerHTML;
                assert(nodes.managerPartnershipSummary.textContent.includes('Partnerschaftsstatus fehlt'), 'JA-1: Erbvorschau weist auf fehlenden Status hin');
                assert(html.includes('20.000\u00a0€ Freibetrag') && !html.includes('Familienheim-Befreiung angenommen')
                    && !html.includes('Versorgungsfreibetrag'), 'JA-1: Erbvorschau verwendet nur den persönlichen Freibetrag');
            }
        }
    } finally {
        setAppTestDate(null);
    }
    // VB-1 (19.11.): neuer Hash nur durch den Vorschauhinweis bei Ehe („Vorschau ohne Zugewinnausgleich und Versorgungsfreibetrag; …“);
    // ohne diesen Satz ergibt sich genau 18541ee8… (geprüft).
    // ER-1 ergänzt die vierte Auswahl, die zugehörige Immobilienhilfe und den Container für bedingte Felder.
    // Ohne diese drei HTML-Änderungen ergeben alle vier Ansichten exakt den HP-4-Stand f43e122a… (gemessen).
    // ER-2 ergänzt die fünfte Auswahl und einen Satz in der Immobilienhilfe. Ohne diese zwei HTML-Änderungen ergibt sich exakt der ER-1-Stand 25374b23… (gemessen).
    // ER-3 ergänzt zwei Felder und passt die Hilfetexte an. Alle acht gerenderten Ergebnisbereiche bleiben bytegleich (gemessen).
    // ER-2e (FR-96) stellt Kosten und Pflichtteil vor den gesperrten Block und ergänzt den Sperrhinweis. Der ER-3-Stand bbacf505… bleibt
    // für alle gerenderten Ergebnisbereiche [data-inheritance-preview] bytegleich (gemessen); nur das Formular ändert sich.
    // HL-4 Schalterbaustein: „Pflichtteilsberechtigte Kinder“ und „erbt die Immobilien und das Geld für die Erbschaftsteuer“ als ds-segment statt Checkbox.
    // Alle acht Ergebnisbereiche bleiben bytegleich; mit dem alten Checkbox-Markup zurückersetzt ergibt sich genau 62f6064b… (gemessen).
    same('previewHash', hash(previews), 'e3e6ba71ac3a33ab507007157b03f2e57fa652107049649a654a0833f4c30c89', 'Erbvorschau enthält Kosten und Pflichtteil-Sicherung bei gleichen Vorschauwerten');
}

console.log('Test 2: Pflegegeld');
{
    same('centralAllowance', JSON.stringify(CARE_ALLOWANCE_MONTHLY), '{"2":347,"3":599,"4":800,"5":990}', 'Zentrales Pflegegeld gleicht den bisherigen Beträgen');
    same('benefits', JSON.stringify(CARE_BENEFITS_2026), '{"1":{"allowance":0,"services":0,"relief":131,"respiteAnnual":0,"residential":0},"2":{"allowance":347,"services":796,"relief":131,"respiteAnnual":3539,"residential":805},"3":{"allowance":599,"services":1497,"relief":131,"respiteAnnual":3539,"residential":1319},"4":{"allowance":800,"services":1859,"relief":131,"respiteAnnual":3539,"residential":1855},"5":{"allowance":990,"services":2299,"relief":131,"respiteAnnual":3539,"residential":2096}}', 'Leistungstabelle bleibt');
    same('defaults', JSON.stringify(DEFAULT_CARE_VALUES), '{"version":1,"allowance":{"values":{"2":347,"3":599,"4":800,"5":990},"asOf":"2026-01","source":"https://www.bundesgesundheitsministerium.de/fileadmin/Dateien/3_Downloads/P/Pflegeversicherung_Leistungsbeitraege/Uebersicht_Leistungsbetraege_2026_VA.pdf","origin":"mitgeliefert","validFrom":"2025-01"},"residential":{"monthly":3364,"components":{"care":2088,"board":1068,"invest":521},"asOf":"2026-07","source":"https://www.vdek.com/presse/pressemitteilungen/2026/stationaere-pflege-eigenanteile-juli-2026.html","origin":"mitgeliefert","validFrom":"2026-07"},"confirmedForYear":null}', 'Mitgelieferte Pflegewerte bleiben');
    const amounts = [];
    for (const grade of [1, 2, 3, 4, 5]) for (const careForm of ['family', 'home-support', 'residential', undefined]) for (const preset of ['amtlich', 'custom', undefined]) {
        amounts.push(careAllowanceAnnual({ grade, preset, careForm, inflationFactor: 1.1, lifeFactor: 0.5 }));
    }
    same('allowanceHash', hash(amounts), '969d535eca188eea814040c3fad63b8bccf640334c230db1564bfc21c4ac80d0', 'Pflegegeld je Grad und Form bleibt');
    same('officialCosts', JSON.stringify([officialCareCosts(), parseCareValues(null)]), '[{"1":200,"2":2300,"3":7100,"4":15000,"5":18900},{"version":1,"allowance":{"values":{"2":347,"3":599,"4":800,"5":990},"asOf":"2026-01","source":"https://www.bundesgesundheitsministerium.de/fileadmin/Dateien/3_Downloads/P/Pflegeversicherung_Leistungsbeitraege/Uebersicht_Leistungsbetraege_2026_VA.pdf","origin":"mitgeliefert","validFrom":"2025-01"},"residential":{"monthly":3364,"components":{"care":2088,"board":1068,"invest":521},"asOf":"2026-07","source":"https://www.vdek.com/presse/pressemitteilungen/2026/stationaere-pflege-eigenanteile-juli-2026.html","origin":"mitgeliefert","validFrom":"2026-07"},"confirmedForYear":null}]', 'Amtliche Kosten und Leseweg bleiben');
}

console.log('Test 3: Altbestandsgrenze 2009');
{
    same('cutoff', `${GRANDFATHERED_STOCK_CUTOFF_DATE}/${GRANDFATHERED_STOCK_CUTOFF_YEAR}`, '2009-01-01/2009', 'Zentrale Altbestandsgrenze gleicht der bisherigen');
    const dates = ['2008-12-31', '2009-01-01', '2009-01-02', '', 'kein Datum', '1999-05-05', '2020-01-01'];
    same('stock', dates.map(date => stockFromPurchaseDate(date, 'aktien_neu')).join('/'), 'aktien_alt/aktien_neu/aktien_neu/aktien_neu/aktien_neu/aktien_alt/aktien_neu', 'Bestand aus Kaufdatum bleibt');
    const states = dates.map(purchaseDate => purchaseStockState({ category: 'equity', type: 'aktien_alt', purchaseDate }, '2001-01-01'));
    same('stockStateHash', hash(states), 'a6e514eae1b8d6fb23ec2f80fef8fa53d286e2f508f22189e68925d66cdeb525', 'Bestandsprüfung bleibt');
    const texts = [];
    for (const [type, purchaseDate] of [['aktien_alt', '2008-12-31'], ['aktien_neu', '2009-01-01'], ['aktien_neu', '']]) {
        const nodes = {};
        const element = id => (nodes[id] ||= { id, value: '', hidden: false, textContent: '', listeners: {}, classList: { contains: () => false, add() {}, remove() {}, toggle() {} },
            querySelectorAll: () => [], setAttribute() {}, getAttribute: () => null, addEventListener(name, fn) { this.listeners[name] = fn; } });
        const doc = { getElementById: element, querySelectorAll: () => [], addEventListener() {}, activeElement: null };
        element('category').value = 'equity'; element('type').value = type; element('purchaseDate').value = purchaseDate;
        syncTranchePurchaseStock(doc);
        texts.push(element('trancheStockReason').textContent, element('trancheStockReadOnly').textContent);
        bindTrancheModalLifecycle(doc);
        element('type').value = 'falsch';
        element('trancheStockAdoptBtn').listeners.click?.();
        texts.push(element('type').value);
    }
    same('stockTexts', texts.join('|'), 'Ergibt sich aus dem Kaufdatum: gekauft vor 2009.|Altbestand|aktien_alt|Ergibt sich aus dem Kaufdatum: gekauft nach 2008.|Neubestand|aktien_neu|Ohne Kaufdatum wählst du den Bestand selbst.|Neubestand|falsch', 'Hinweistexte und Übernahme bleiben');
}

console.log('Test 4: Einführungsjahr 2026');
{
    same('startDate', WEALTH_HISTORY_START_DATE, '2026-01-01', 'Beginn des Vermögensverlaufs bleibt');
    same('introductionYear', APP_INTRODUCTION_YEAR, 2026, 'Zentrales Einführungsjahr gleicht den bisherigen Kopien');
    const annual = [2025, 2026, 2027].map(year => capture(() => createAnnualWealthHistoryEntry({ depotwertAlt: 1, tagesgeld: 2 }, year)));
    const dates = ['2025-12-31', '2026-01-01'].map(date => capture(() => assertWealthHistoryDate(date)));
    same('contractHash', hash([annual, dates]), '1d95dbff9fd15ab075e33163881c86d7f224c62fb4893382a7513f90be424eb5', 'Jahresabschlussstände und Datumsprüfung bleiben');
    // VS-3a: Der Leertext des alten Balance-Verlaufs ist mit seinem Renderer entfallen.
    const storage = { getItem: key => key === 'ruhestandsmodellValues_v29_guardrails' ? JSON.stringify({ inputs: { inflation: 3 } }) : null };
    const priced = [2025, 2026, 2027].map(referenceYear => capture(() => withPlannedExpensePrices([{ id: 'a' }, { id: 'b', priceYear: 2026 }, { id: 'c', priceYear: 2024 }],
        { storage, referenceYear })));
    same('pricesHash', hash(priced), 'b8cfde9c853425e368050da5ec1d0cd8551a18c2b46c400f8536a8b2dccd728b', 'Altposten ohne Preisjahr behalten das Einführungsjahr');
}

console.log('Test 5: Grenze des Pflegekostenanstiegs');
{
    setAppTestDate('2027-01-02');
    try {
        assert(!validCareDriftYear('2026') && validCareDriftYear('2027'), 'JA-1: Neue Bis-Jahre beginnen im Testjahr');
    } finally { setAppTestDate('2026-10-23'); }
    same('range', JSON.stringify(CARE_DRIFT_YEAR_RANGE), '{"min":2026,"max":2100}', 'Eingabegrenze bleibt');
    same('valid', ['2025', '2026', '2035', '2100', '2101', '', '-1', '2030,5'].map(validCareDriftYear).join('/'), 'false/true/true/true/false/false/false/false', 'Gültige Jahre bleiben');
    // FR-95: Der Simulator setzt die Grenzen passend zum Appjahr und zum geladenen Wert.
    const html = readFileSync(new URL('../Simulator.html', import.meta.url), 'utf8');
    const field = html.match(/<input[^>]*id="pflegeKostenDriftBis"[^>]*>/)?.[0] || '';
    if (!MEASURE) assert(field && !/\b(?:min|max)=/.test(field), 'Simulator.html trägt keine eigene Kopie der Grenze');
    const previous = globalThis.document;
    const driftField = { value: '2035', min: '', max: '', addEventListener() {} };
    try {
        globalThis.document = { getElementById: id => id === 'pflegeKostenDriftBis' ? driftField : null, querySelectorAll: () => [], querySelector: () => null };
        const { initializePflegeUIControls } = await import('../app/simulator/simulator-ui-pflege.js');
        capture(() => initializePflegeUIControls());
    } finally {
        if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
    }
    same('fieldBounds', `${driftField.min}/${driftField.max}`, '2026/2100', 'Ohne Altjahr beginnt die Feldgrenze im laufenden Jahr');
    setAppTestDate(null);
}

if (MEASURE) console.log(JSON.stringify(measured, null, 2));
console.log('✅ JD-1 Gleichheitstests abgeschlossen');
