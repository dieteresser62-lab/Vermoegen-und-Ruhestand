import { hasTestament, inheritancePreview, PARTNERSHIP_KEY, readPartnership, testamentEstate } from '../app/profile/household-partnership.js';
import { lifetimeUseMultiplier } from '../app/shared/life-expectancy.js';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { renderManagerPartnership } from '../app/tranches/tranchen-manager-partnership.js';
import { readTestamentFields } from '../app/tranches/tranchen-manager-testament.js';
import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { EngineAPI } from '../engine/index.mjs';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';

const options = { partnerAge: 30, partnerGender: 'w', valuationYear: 2026 };
const multiplier = lifetimeUseMultiplier(options.partnerAge, options.partnerGender, options.valuationYear);
const rule = { minimum: 85000, minimumStand: '2026-01', home: 'residence', childrenProtected: true };
const statuses = [
    { status: 'unmarried', maritalPropertyRegime: 'community', capital: 190000, cut: 25000, shortfall: 150000 },
    { status: 'married', maritalPropertyRegime: 'community', capital: 315000, cut: 25000, shortfall: 25000 },
    { status: 'married', maritalPropertyRegime: 'separation', capital: 315000, cut: 25000, shortfall: 25000 }
];

for (const { status, maritalPropertyRegime, capital, cut, shortfall } of statuses) {
    const taxOptions = { ...options, status, maritalPropertyRegime };
    const costs = testamentEstate(100000, 0, 0, 50, { estateCosts: 20000 }, taxOptions);
    assertEqual(costs.inherited, 40000, `${status}/${maritalPropertyRegime}: 20.000 € Kosten senken das Geldvermögen vor der Aufteilung`);
    const capped = testamentEstate(100000, 0, 0, 50, { ...rule, childrenProtected: false, maximumPercent: 60, estateCosts: 20000 },
        { ...taxOptions, inflationFactor: 1.1 });
    assertClose(capped.inherited, 46800, 1e-6, 'Der Höchstanteil gilt für das Geldvermögen nach fortgeschriebenen Kosten');

    const residenceOptions = { ...taxOptions, residenceValue: capital / multiplier, selfUsedHome: 400000 };
    const cutEstate = inheritancePreview(100000, 400000, 10, { ...residenceOptions, testament: rule });
    assertClose(cutEstate.residenceCapital, capital, 1e-6, 'Der Kapitalwert des Wohnrechts bleibt bestehen');
    assertClose(cutEstate.inherited, 60000, 1e-6, 'Das Wohnrecht und der Mindestbetrag führen zur Kürzung unter den Mindestbetrag');
    assertClose(cutEstate.childrenMoneyCut, cut, 1e-6, 'Die Kürzung entspricht der Pflichtteilslücke');
    assertEqual(cutEstate.childrenShortfall, undefined, 'Der Pflichtteil ist nach der Kürzung gedeckt');
    const unprotected = inheritancePreview(100000, 400000, 10, { ...residenceOptions, testament: { ...rule, childrenProtected: false } });
    if (status === 'unmarried') assertClose(unprotected.tax - cutEstate.tax, 7500, 1e-6, 'Die Kürzung mindert die Erbschaftsteuer');

    const enough = testamentEstate(100000, 400000, 400000, 10, rule, { ...taxOptions, residenceValue: 100000 / multiplier });
    assertEqual(enough.inherited, 85000, 'Bei gedecktem Pflichtteil bleibt der Mindestbetrag erhalten');
    assertEqual(enough.childrenMoneyCut, undefined, 'Ohne Verletzung gibt es keine Kürzung');
    const enoughWithoutHome = readPartnership({ schemaVersion: 1, status, maritalPropertyRegime, inheritance: {},
        testament: { max: { childrenProtected: true } } });
    assert(hasTestament(enoughWithoutHome, 'max'), 'Die Pflichtteilprüfung ist auch ohne Mindestbetrag oder Immobilie aktiv');

    const insufficient = testamentEstate(100000, 400000, 400000, 10, { ...rule, home: 'life-estate' }, taxOptions);
    assertEqual(insufficient.inherited, 0, 'Bei einer großen Lücke endet die Kürzung bei null');
    assertEqual(insufficient.childrenMoneyCut, 85000, 'Der Geldanteil entfällt vollständig');
    assertEqual(insufficient.childrenShortfall, shortfall, 'Die verbleibende Pflichtteilslücke bleibt sichtbar');
    assertEqual(insufficient.home, 400000, 'Der Immobilienanteil bleibt erhalten');
}

const moneyHome = testamentEstate(100000, 400000, 400000, 90, { childrenProtected: true }, { status: 'married' });
assertEqual(moneyHome.inherited, 15000, 'Auch bei „wie Geldvermögen“ wird nur der Geldanteil gekürzt');
assertEqual(moneyHome.home, 360000, 'Der Immobilienanteil bleibt bei der ursprünglichen Quote');
assertEqual(moneyHome.share, .15, 'Wert aus Geldbeständen folgt der gekürzten Quote');
assertEqual(moneyHome.homeShare, .9, 'Immobilieneigentum behält seinen Bruchteil');
const debtRule = { childrenProtected: true, estateCosts: 10000 };
const debtFree = testamentEstate(100000, 0, 0, 50, debtRule);
assertEqual(JSON.stringify(testamentEstate(100000, 0, 0, 50, debtRule, { estateDebt: 0 })),
    JSON.stringify(debtFree), 'Ohne Schulden bleibt das Ergebnis bytegleich');
assertEqual(debtFree.inherited, 45000, '45.000 € bleiben den übrigen Erben ohne Steuerschuld');
const indebted = testamentEstate(100000, 0, 0, 50, debtRule, { estateDebt: 20000 });
assertClose(indebted.childrenMoneyCut, 1250, 1e-6, 'Zum Netto-Pflichtteil fehlen 1.000 €, dafür gehen 1.250 € vom Bruttogeldanteil ab');
assertClose(indebted.inherited, 43750, 1e-6, 'Die Pflichtteilsprüfung verwendet den Erwerb nach Kosten und anteiliger Schuld');
assertClose(indebted.inherited - 20000 * indebted.share, 35000, 1e-6, 'Vom Nettonachlass bleiben 35.000 € für jede Seite');
const fullCut = testamentEstate(100000, 100000, 0, 100, { childrenProtected: true }, { estateDebt: 20000 });
assertEqual(fullCut.inherited, 0, 'Der volle Bruttogeldanteil geht an die anderen Erben, wenn der Nettoanteil zur Deckung fehlt');
assertEqual(fullCut.childrenShortfall, 10000, 'Das Erbe meldet 10.000 € verbleibende Netto-Lücke');
const unprotectedDebt = testamentEstate(100000, 0, 0, 50, { ...debtRule, childrenProtected: false }, { estateDebt: 20000 });
assertEqual(JSON.stringify(unprotectedDebt), JSON.stringify({ inherited: 45000, share: .45, estateCosts: 10000,
    home: 0, residenceCapital: 0, exemptHome: 0, tax: 4800, taxable: 16000, mode: 'money', homeShare: .5 }), 'Ohne Pflichtteilschutz bleibt der Fall bytegleich');
assertEqual(testamentEstate(100000, 0, 0, 50, debtRule, { estateDebt: 90000 }).childrenMoneyCut,
    undefined, 'Ohne positiven Nachlasswert fällt kein Pflichtteil an');
const housing = testamentEstate(100000, 400000, 400000, 50,
    { childrenProtected: true, home: 'housing-capital', housingCapitalPercent: 70, monthlyRent: 1200 });
assertEqual(housing.inherited, 0, 'Das Wohnkapital fließt mit seinem vollen Betrag in die Prüfung ein');
assertEqual(housing.childrenShortfall, 2000, 'Die verbleibende Lücke übersteigt die Geldkürzung um 2.000 €');
const rental = testamentEstate(100000, 400000, 400000, 50,
    { childrenProtected: true, home: 'rent-bequest', monthlyRent: 220000 / multiplier / 12 }, options);
assertClose(rental.inherited, 30000, 1e-6, 'Die Rente zählt mit ihrem steuerlichen Kapitalwert');

const costsAboveAssets = inheritancePreview(10000, 0, 50, { testament: { estateCosts: 20000 } });
assertEqual(costsAboveAssets.estateCosts, 10000, 'Kosten gehen höchstens bis zum vorhandenen Geldvermögen ab');
assertEqual(costsAboveAssets.leaves, 0, 'Kosten werden in der Vorschau getrennt vom Geldanteil anderer Erben ausgewiesen');

const base = await measurementInputs(0, 'helga-werner', '2026-10-23', 'haus-pg3');
const run = (status, testament, accumulationPhase) => {
    const inputs = { ...base, accumulationPhase, transitionYear: accumulationPhase ? 5 : base.transitionYear,
        partnership: readPartnership({ schemaVersion: 1, status, inheritance: { muster_helga: 50 },
            marriedInheritance: { muster_helga: 50 }, testament: { muster_helga: testament } }),
        home: base.home.map(home => ({ ...home, wert: 1600000, stand: `${base.homeReferenceYear}-01` })) };
    const result = simulateOneYear(initMcRunState(inputs), inputs, { jahr: 2000, inflation: 10, rendite: 0, gold_eur_perf: 0, zinssatz: 0 },
        0, null, 0, { p1Alive: false, p2Alive: true }, 1, EngineAPI);
    assertEqual(result.kind, 'success', 'Todesjahr vollständig berechnet');
    return { inputs, result };
};
for (const status of ['unmarried', 'married']) {
    for (const accumulationPhase of [undefined, { enabled: true, sparrate: 1000 }]) {
        const { result } = run(status, { estateCosts: 20000 }, accumulationPhase);
        const { inheritance: estate } = result.logData;
        assertClose(estate.estateCosts, 22000, 1e-6, 'Das Todesjahr schreibt die Kosten seit Planstart fort');
        assertClose(estate.inherited, (estate.assets - estate.estateCosts) / 2, 1e-6, 'Die Simulation überträgt die Hälfte des Nettogeldvermögens');
        assertClose(result.logData.abgang_erben, estate.inherited, 1e-6, 'Die andere Hälfte geht an die Erben; die Kosten werden separat abgezogen');
        assertClose(result.logData.portfolio_flow_delta, 0, .05, 'Die Kapitalsumme bilanziert die Kosten in Anspar- und Entnahmejahren');
    }
    const { inputs, result } = run(status, { ...rule, home: 'life-estate', estateCosts: 20000 });
    const estate = result.logData.inheritance;
    assertEqual(estate.inherited, 0, 'Der Simulator kürzt den Geldanteil bis null');
    assertClose(estate.childrenShortfall, (estate.assets - estate.estateCosts + estate.home) * (status === 'married' ? .25 : .5)
        - (estate.assets - estate.estateCosts), 1e-6, 'Für die Pflichtteilsprüfung zählt der volle Immobilienwert zum Nettogeld');
    assertEqual(estate.inheritedHome, estate.home, 'Der Immobilienanteil wird vollständig übertragen');
    const html = renderProtocolTable([result.logData], { source: 'mc', inputs });
    assert(html.includes('Geldanteil gekürzt für den Pflichtteil der Kinder') && html.includes('Pflichtteil der Kinder nicht voll gedeckt'),
        'Das Erbe-ⓘ zeigt die Kürzung und die verbleibende Pflichtteilslücke');
    const old = run(status, { home: 'life-estate' }).result;
    const defaults = run(status, { home: 'life-estate', estateCosts: 0, childrenProtected: false }).result;
    assertEqual(JSON.stringify(defaults), JSON.stringify(old), 'Null Kosten und ausgeschaltete Sicherung liefern denselben Todesjahresbeleg');
}

const stored = { schemaVersion: 1, status: 'unmarried', inheritance: { max: 50 },
    testament: { max: { ...rule, home: 'life-estate', estateCosts: 20000 } } };
PersistenceFacade.resetPersistenceForTests({ async loadAll() { return { [PARTNERSHIP_KEY]: JSON.stringify(stored) }; } });
await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
const nodes = Object.fromEntries(['managerPartnership', 'managerInheritance', 'managerPartnershipMarried', 'managerPartnershipSummary']
    .map(id => [id, { innerHTML: '', contains: () => false, querySelectorAll: () => [] }]));
const doc = { getElementById: id => nodes[id] || null, querySelectorAll: () => [], addEventListener() {} };
renderManagerPartnership(doc, { profiles: ['max', 'erika'].map((id, index) => ({ id, name: id, valid: true, belongs: true, assets: 100000,
    values: { alter: 70, immobilien: index ? [] : [{ nutzung: 'selbst', wert: 400000 }] } })) });
const previewHtml = nodes.managerInheritance.innerHTML;
assert(previewHtml.includes('Geldanteil um 80.000\u00a0€ gekürzt. Pflichtteil der Kinder nicht voll gedeckt, es fehlen 160.000\u00a0€.</p>')
    && !previewHtml.includes('damit die Kinder'), '1823: Beide Pflichtteiltexte enden mit Punkt und nennen den Fehlbetrag');
assert(previewHtml.includes('data-testament="estateCosts" inputmode="decimal" value="20.000"')
    && previewHtml.includes('data-testament="childrenProtected" checked'), 'Das Formular zeigt die gespeicherten Angaben');
assert(previewHtml.includes('data-testament="estateCosts" inputmode="decimal" value="0"')
    && previewHtml.includes('data-testament="childrenProtected">'), 'Für die andere Person bleiben die Vorgaben sichtbar');

// ER-2e (Befund 1823): Helga und Werner, verheiratet, Helga vererbt 100 % wie Geldvermögen, Pflichtteil-Schalter an.
for (const [estateCosts, text] of [[20000, 'Geldanteil um 126.250\u00a0€ gekürzt, damit die Kinder ihren Pflichtteil bekommen.</p>'],
    [250000, 'Geldanteil um 50.000\u00a0€ gekürzt. Pflichtteil der Kinder nicht voll gedeckt, es fehlen 18.750\u00a0€.</p>']]) {
    const married = { schemaVersion: 1, status: 'married', inheritance: {}, marriedInheritance: { helga: 100 },
        testament: { helga: { estateCosts, childrenProtected: true } } };
    PersistenceFacade.resetPersistenceForTests({ async loadAll() { return { [PARTNERSHIP_KEY]: JSON.stringify(married) }; } });
    await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    renderManagerPartnership(doc, { profiles: [['helga', 300000], ['werner', 0]].map(([id, assets], index) => ({ id, name: id, valid: true, belongs: true, assets,
        values: { alter: 75, immobilien: index ? [] : [{ nutzung: 'selbst', wert: 225000 }] } })) });
    const html = nodes.managerInheritance.innerHTML;
    assert(html.includes(text), `1823: Kosten ${estateCosts} € nennen Kürzung und Fehlbetrag mit Punkt`);
    assertEqual(html.includes('damit die Kinder'), estateCosts === 20000, '1823: Kein Satz verspricht den vollen Pflichtteil, wenn etwas fehlt');
}

const fields = { minimum: { value: '' }, maximumPercent: { value: '' }, home: { value: 'money' },
    estateCosts: { id: 'inheritance-estate-costs-0', value: '20.000,50' }, childrenProtected: { checked: true } };
const section = { querySelector: selector => fields[/data-testament="(\w+)"/.exec(selector)[1]] || null };
assertEqual(JSON.stringify(readTestamentFields(section)), JSON.stringify({ estateCosts: 20000.5, childrenProtected: true }),
    'Der Entwurf liest gruppierte Eurobeträge und die Schalterstellung');
fields.estateCosts.value = '0'; fields.childrenProtected.checked = false;
assertEqual(JSON.stringify(readTestamentFields(section)), '{}', 'Die Vorgaben brauchen keine neuen Recordfelder');

const costsOnly = { estateCosts: 20000 };
const childrenOnly = { childrenProtected: true };
for (const testament of [costsOnly, childrenOnly]) {
    const stored = { schemaVersion: 1, inheritance: {}, testament: { max: testament } };
    assertEqual(JSON.stringify(readPartnership(stored).testament?.max), JSON.stringify(testament),
        'Eine einzelne neue Angabe bleibt im Partnerschaftsrecord erhalten');
}
