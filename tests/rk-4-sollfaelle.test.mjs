// RK-4: zwei Reste aus der zweiten Bedienrunde (Spielbereich, Testdatum 23.10.2026). Nur Musterhaushalte.
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { EngineAPI } from '../engine/index.mjs';
import { evaluateBalanceCurrentYear } from '../app/balance/balance-reserve-today.js';
import { reserveActionSource } from '../app/balance/balance-reserve-source.js';
import { projectBalanceReserves, displayedReserveView } from '../app/balance/balance-reserves.js';
import { projectHouseholdPlanComparison } from '../app/profile/household-plan-comparison.js';
import { projectBalanceActionOrigin } from '../app/balance/balance-action-origin.js';
import { projectAnnualTodoPlan } from '../app/balance/annual-todo.js';

const DATE = '2026-10-23', MARTIN = 'muster_martin', PETRA = 'muster_petra';
setAppTestDate(DATE);

/** Musterhaushalt mit geänderten Tagesgeldern laden. @param {string} variant @param {Record<string, number>} cash */
async function load(variant, cash) {
    const data = createMusterHaushaltRecords(DATE, 'martin-petra', variant);
    const registry = JSON.parse(data.rs_profiles_v1);
    for (const [id, value] of Object.entries(cash)) registry.profiles[id].data.profile_tagesgeld = String(value);
    data.rs_profiles_v1 = JSON.stringify(registry);
    if (cash[data.rs_current_profile] !== undefined) data.profile_tagesgeld = String(cash[data.rs_current_profile]);
    P.resetPersistenceForTests({ name: 'rk-4', loadAll: async () => ({ ...data }), async saveBatch() {},
        writeSnapshot: async () => {}, readSnapshot: async () => null, listSnapshots: async () => [], deleteSnapshot: async () => true });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    return data;
}

/** „Deine Reserven“ wie die Balance mit dem Beleg 2026 (offener Rest auf heutige Bestände). @param {string} variant @param {Record<string, number>} cash */
async function reserves(variant, cash) {
    const data = await load(variant, cash);
    const year = evaluateBalanceCurrentYear({ storage, engineApi: EngineAPI, profileId: storage.getItem('rs_current_profile') });
    const record = Object.values(JSON.parse(data.annual_plan_record_v1).entries).find(item => item.year === 2026);
    const comparison = projectHouseholdPlanComparison({ year: 2026, scope: record.scope, storage: { getItem: key => data[key] ?? null } });
    const confirmed = projectBalanceActionOrigin({ comparison, year: 2026, scope: record.scope }).confirmed;
    const source = reserveActionSource(year, confirmed);
    const view = projectBalanceReserves(year, source.prepared, { action: source.source.action, targetEntries: source.source.targetEntries, settled: source.source.settled });
    return { view, shown: displayedReserveView(view, projectAnnualTodoPlan({ confirmed, people: confirmed.people || [] })).shown };
}

// Punkt 1 (Ergänzung 1 FR-80): Martin trägt, Martin 10.000 € Tagesgeld (Ziel 14.400 €, angezeigt 15.000 €). Vorher hing Martins
// angezeigtes Tagesgeld nach Umsetzung an Petras Stand: Petra 110.000 € oder 30.000 € → Martin 14.500 €, Petra 1.000 € → 14.250 €,
// nur Petra 8.500 € → 15.000 €. Seit HP-5b zeigt die Karte den gerundeten Verkaufszufluss für Martin unabhängig von Petras Stand.
{
    const results = [];
    for (const petra of [110000, 30000, 1000, 8500]) {
        const { view, shown } = await reserves('traegt', { [MARTIN]: 10000, [PETRA]: petra });
        assertClose(view.after.tagesgeld - petra, 14400, 0.5, `RK-4 P1: Martin erreicht sein Ziel genau gerechnet (Petra ${petra} €)`);
        results.push({ petra, martin: shown.after.tagesgeld - petra, geldmarkt: shown.after.geldmarkt });
    }
    for (const row of results) assertEqual(row.martin, 14500, `RK-4 P1: Martins Tagesgeld nach Umsetzung 14.500 € (Petra ${row.petra} €, war ${row.martin} €)`);
    assert(results.every(row => row.geldmarkt === results[0].geldmarkt), `RK-4 P1: Geldmarkt unabhängig von Petra (${results.map(row => row.geldmarkt).join(' / ')})`);
    // Gegenprobe Vorgabemodus: gleiche Bestände, Haushaltsrechnung wie bisher (keine Kennzeichen, keine Verschiebung).
    const base = await reserves('grund', { [MARTIN]: 10000, [PETRA]: 30000 });
    assert(!base.view.held && base.view.targets.every(row => !row.held), 'RK-4 P1: Vorgabemodus ohne Kennzeichen der anderen Person');
    console.log('✅ RK-4 P1: Martins Tagesgeld nach Umsetzung hängt nicht an Petra');
}

// Punkt 2 (FR-82): Variante „Max und Erika · Nachkäufe desselben ETF“, Erikas Kauf vom 03.10.2022 ohne Kaufdatum. Der Beleg nennt die Tranche
// vom 16.03.2020 mit 0,00 € Steuer; die Bank verkauft zuerst die Tranche ohne Datum, Dialog und Merkzettel nennen „Steuer ca. 190 €“.
// Vorher: „Details & Drucken“ nur 0,00 €, und das Tranchenfeld im Dialog trug die Kennung der Belegtranche. Soll: Details nennen
// „Steuer laut Beschluss …, mit der Bankreihenfolge ca. 190 €“; das Feld trägt die Tranche, die die Bank zuerst verkauft.
{
    const { readSaleFlowPlan, saleFlowPlanFromConfirmed } = await import('../app/tranches/sale-flow-dialog.js');
    const model = await import('../app/tranches/sale-flow-model.js');
    const { sellStep } = await import('../app/tranches/sale-flow-steps.js');
    const { SummaryRenderer } = await import('../app/balance/balance-renderer-summary.js');
    const { createDialogFixture } = await import('./close-dialog.test.mjs?fixture');
    const { MockDocument } = await import('./helpers/balance-page-fixture.mjs');
    const records = createMusterHaushaltRecords(DATE, 'max-erika', 'nachkauf');
    const registry = JSON.parse(records.rs_profiles_v1);
    const lots = JSON.parse(registry.profiles.muster_b.data.depot_tranchen);
    delete lots.find(lot => lot.purchaseDate === '2022-10-03').purchaseDate;
    registry.profiles.muster_b.data.depot_tranchen = JSON.stringify(lots);
    records.rs_profiles_v1 = JSON.stringify(registry);
    if (records.rs_current_profile === 'muster_b') records.depot_tranchen = registry.profiles.muster_b.data.depot_tranchen;
    P.resetPersistenceForTests({ name: 'rk-4-p2', loadAll: async () => ({ ...records }), async saveBatch() {},
        writeSnapshot: async () => {}, readSnapshot: async () => null, listSnapshots: async () => [], deleteSnapshot: async () => true });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const record = Object.values(JSON.parse(records.annual_plan_record_v1).entries).find(item => item.year === 2026);
    const people = Object.entries(registry.profiles).map(([id, person]) => ({ id, name: person.meta.name }));
    const origin = projectBalanceActionOrigin({ comparison: projectHouseholdPlanComparison({ year: 2026, scope: record.scope,
        storage: { getItem: key => records[key] ?? null } }), year: 2026, scope: record.scope });
    const ids = people.map(person => person.id);
    const flow = readSaleFlowPlan({ plan: saleFlowPlanFromConfirmed(origin.confirmed, ids, registry), registry });
    const erika = flow.lines.find(line => line.profileId === 'muster_b');
    const first = erika.bank.parts[0].tranche;
    assert(erika.bank.differs && !first.purchaseDate && erika.tranche.trancheId !== first.trancheId, 'RK-4 P2: Die Bank verkauft zuerst die Tranche ohne Kaufdatum (Ausgangslage)');
    assertClose(erika.bank.tax, 189.72, 0.01, 'RK-4 P2: Dialog schätzt mit der Bankreihenfolge ca. 190 € Steuer (Ausgangslage)');
    // Details & Drucken
    const { doc } = createDialogFixture(), host = doc.createElement('div');
    host.replaceChildren = (...children) => { host.children.length = 0; host.append(...children); };
    const renderer = new SummaryRenderer({ outputs: { balanceAnnualAction: host } });
    renderer.saleFlowIds = ids;
    renderer.renderAnnualAction(origin, people);
    const text = renderer.planDetails.text.replaceAll(' ', ' ');
    const row = text.split('\n').find(line => line.startsWith('Erika |')) || '';
    assert(row.includes('Kauf ohne Datum') && row.includes('| 0,00 € |'), `RK-4 P2: Belegzeile bleibt wie beschlossen (${row})`);
    assert(text.includes('Erika: Steuer laut Beschluss 0,00 €, mit der Bankreihenfolge ca. 190 €.'), `RK-4 P2: Details & Drucken nennen die Steuer mit der Bankreihenfolge (${text})`);
    assert(!text.includes('Max: Steuer laut Beschluss'), 'RK-4 P2: Ohne Abweichung kein Zusatz für Max');
    // Tranchenfeld im Dialog: Vorschlag ist die Tranche, die die Bank zuerst verkauft; die Steuerschätzung bleibt die der Bankreihenfolge.
    assert(typeof model.saleStartTrancheId === 'function', 'RK-4 P2: Startwert des Tranchenfelds kommt aus dem Modell');
    const draft = { trancheId: model.saleStartTrancheId(erika), initialTrancheId: model.saleStartTrancheId(erika) };
    assertEqual(draft.trancheId, first.trancheId, 'RK-4 P2: Tranchenfeld trägt die Kennung der Tranche ohne Kaufdatum');
    const max = flow.lines.find(line => line.profileId === 'muster_a');
    assertEqual(model.saleStartTrancheId(max), max.tranche.trancheId, 'RK-4 P2: Ohne Abweichung bleibt die Tranche des Belegs');
    const view = sellStep(new MockDocument(), erika, { draft, number: 2, count: 2, quoteDate: DATE, onChange: () => {}, onPrint: () => {}, tranches: erika.tranches });
    const find = (/** @type {any} */ node) => node.id === `saleFlowTranche-${erika.key}` ? node : node.children.map(find).find(Boolean);
    assertEqual(find(view)?.children.find((/** @type {any} */ option) => option.selected)?.value, first.trancheId, 'RK-4 P2: Auswahl zeigt die Tranche ohne Kaufdatum');
    const estimate = view.textContent.replaceAll(' ', ' ');
    assert(estimate.includes('(Bankreihenfolge)') && !estimate.includes('ohne Sparerpauschbetrag') && estimate.includes('189,72 €'),
        `RK-4 P2: Steuerschätzung im Dialog unverändert (${estimate.slice(0, 400)})`);
    console.log('✅ RK-4 P2: Details & Drucken und Tranchenfeld folgen der Bankreihenfolge');
}
