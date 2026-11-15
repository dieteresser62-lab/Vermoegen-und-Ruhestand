// RK-3: Befunde aus dem Bedien-Durchlauf (Spielbereich, Testdatum 23.10.2026). Nur Musterhaushalte.
import { measurementInputs, backtest } from './helpers/ek-1b-measurement.mjs';
import { protocolCashflowBreakdown } from '../app/simulator/protocol-cashflows.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { projectHouseholdPlanComparison } from '../app/profile/household-plan-comparison.js';
import { projectBalanceActionOrigin } from '../app/balance/balance-action-origin.js';
import { SummaryRenderer } from '../app/balance/balance-renderer-summary.js';
import { readSaleFlowPlan, saleFlowPlanFromConfirmed } from '../app/tranches/sale-flow-dialog.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';

const DATE = '2026-10-23', MARTIN = 'muster_martin', PETRA = 'muster_petra';

// Punkt 1 (FR-81): Martin und Petra unverheiratet, Martin 0 €, Petra 5.000 € Tagesgeld, beide ohne Aktien, Backtest ab 2000.
// 2000 zahlt Petra 38.600 € von ihrem Plananteil 48.000 €; die fehlenden 9.400 € sind eine Kürzung ihres Flex-Anteils.
// Vorher: Kennzahlen „Jahre mit Kürzung 0“, Ausgaben mit vollem Flex 12.000 €, Rohdaten Kürzung 0 %.
{
    const inputs = structuredClone(await measurementInputs(0, 'martin-petra', DATE));
    const cash = { [MARTIN]: 0, [PETRA]: 5000 };
    inputs.simulationPeople = inputs.simulationPeople.map(person => ({ ...person, tagesgeld: cash[person.profileId] }));
    inputs.tagesgeld = 5000;
    for (const lot of inputs.detailledTranches) { inputs.depotwertNeu -= lot.marketValue; inputs.costBasisNeu -= lot.costBasis; }
    inputs.detailledTranches = [];
    inputs.startVermoegen = 5000;
    const result = backtest(inputs);
    const entry = result.rows[0], row = entry.row;
    const cut = (row.personalPayout?.flexCut || []).reduce((sum, item) => sum + item.amount, 0);
    assertClose(cut, 9400, 0.01, 'RK-3 P1: Petras Flex-Anteil 2000 um 9.400 € gekürzt (Ausgangslage)');
    assertClose(row.flex_haushalt_erfuellt, row.flex_wunsch_haushalt_nominal - 9400, 0.01, 'RK-3 P1: Ausgaben zeigen den gezahlten Flex (12.000 − 9.400 €)');
    assertClose(row.flex_haushalt_kuerzung_pct, 9400 / 12000 * 100, 0.01, 'RK-3 P1: Rohdaten nennen die Flex-Kürzung');
    assertClose(entry.entscheidung.kuerzungProzent, 9400 / 12000 * 100, 0.01, 'RK-3 P1: Jahreszeile nennt die Kürzung');
    assert(result.summary.metrics.flex_reduction_years_gte_10_pct >= 1, 'RK-3 P1: Kennzahl „Jahre mit Kürzung“ zählt 2000');
    assert(result.summary.maxReductionStreak >= 1, 'RK-3 P1: „Längste Kürzung“ ist nicht „Keine“');
    const flow = protocolCashflowBreakdown(entry, { source: 'backtest', inputs, startYear: 2000 });
    assertClose(flow.totals.ausgaben_gesamt, 38600, 0.01, 'RK-3 P1: Ausgaben gesamt = gezahlte 38.600 €');
    assertClose(flow.saved, row.einkuenfte_gespart, 0.01, 'RK-3 P1: Ungezahltes zählt nicht als angelegter Überschuss');
    assertClose(row.entnahme_effektiv, Math.max(0, row.personalPayout.total - 48000), 0.01, 'RK-3 P1: entnahme_effektiv ist der gezahlte Betrag aus dem Vermögen');
    console.log('✅ RK-3 P1: FR-81-Kürzung in Kennzahlen, Jahreszeile, Ausgaben und Rohdaten');
}

/** Musterhaushalt in die Persistenz laden (nur gelesen). @param {Record<string, string>} records */
async function loadRecords(records, name) {
    P.resetPersistenceForTests({ name, loadAll: async () => ({ ...records }), async saveBatch() {},
        writeSnapshot: async () => {}, readSnapshot: async () => null, listSnapshots: async () => [], deleteSnapshot: async () => true });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
}

// Punkt 2 (FR-82): Variante „Max und Erika · Nachkäufe desselben ETF“, Erikas Kauf vom 14.02.2025 ohne Kaufdatum. Der Beleg nennt die
// Tranche vom 16.03.2020; Verkaufsdialog und Abrechnung verkaufen in Bankreihenfolge zuerst die Tranche ohne Datum. Vorher nannte
// „Details & Drucken“ weiter „Kauf 16.03.2020“. Soll: Alle Ansichten folgen derselben Regel.
{
    setAppTestDate(DATE);
    const records = createMusterHaushaltRecords(DATE, 'max-erika', 'nachkauf');
    const registry = JSON.parse(records.rs_profiles_v1);
    const lots = JSON.parse(registry.profiles.muster_b.data.depot_tranchen);
    delete lots.find(lot => lot.purchaseDate === '2025-02-14').purchaseDate;
    registry.profiles.muster_b.data.depot_tranchen = JSON.stringify(lots);
    records.rs_profiles_v1 = JSON.stringify(registry);
    if (records.rs_current_profile === 'muster_b') records.depot_tranchen = registry.profiles.muster_b.data.depot_tranchen;
    await loadRecords(records, 'rk-3-p2');
    const record = Object.values(JSON.parse(records.annual_plan_record_v1).entries).find(item => item.year === 2026);
    const people = Object.entries(registry.profiles).map(([id, person]) => ({ id, name: person.meta.name }));
    const storage = { getItem: key => records[key] ?? null };
    const origin = projectBalanceActionOrigin({ comparison: projectHouseholdPlanComparison({ year: 2026, scope: record.scope, storage }), year: 2026, scope: record.scope });
    const ids = people.map(person => person.id);
    const flow = readSaleFlowPlan({ plan: saleFlowPlanFromConfirmed(origin.confirmed, ids, registry), registry });
    const erika = flow.lines.find(line => line.profileId === 'muster_b');
    assert(erika.bank.differs && !erika.bank.parts[0].tranche.purchaseDate, 'RK-3 P2: Verkaufsdialog verkauft zuerst die Tranche ohne Kaufdatum (Ausgangslage)');
    const { doc } = createDialogFixture(), host = doc.createElement('div');
    host.replaceChildren = (...children) => { host.children.length = 0; host.append(...children); };
    const renderer = new SummaryRenderer({ outputs: { balanceAnnualAction: host } });
    renderer.saleFlowIds = ids;
    renderer.renderAnnualAction(origin, people);
    const text = renderer.planDetails.text.replaceAll('\u00a0', ' ');
    const row = text.split('\n').find(line => line.startsWith('Erika |')) || '';
    assert(!row.includes('Kauf 16.03.2020'), `RK-3 P2: Details & Drucken nennt nicht mehr die Tranche des Belegs (${row})`);
    assert(row.includes('Kauf ohne Datum'), `RK-3 P2: Details & Drucken nennt die Tranche ohne Kaufdatum wie Dialog und Abrechnung (${row})`);
    assert(text.includes('Kaufdatum fehlt – Reihenfolge der Bank geschätzt'), 'RK-3 P2: Hinweis zur geschätzten Bankreihenfolge');
    const max = text.split('\n').find(line => line.startsWith('Max |')) || '';
    assert(max.includes('Kauf 18.05.2020'), `RK-3 P2: Ohne Abweichung bleibt die Tranche des Belegs (${max})`);
    console.log('✅ RK-3 P2: Details & Drucken folgt der Bankreihenfolge');
}

// Punkt 3 (TR-2 / RK-2 P3-6): Martin trägt. Martin 10.000 € Tagesgeld (Ziel 15.000 €, Geldmarkt 40.000 €), Basis 4.000 €/Monat, Ziel 6 Monate.
// Vorher hing „Tagesgeld auffüllen“ für Martin am Haushaltstagesgeld mit Petra: Petra 9.500 € → Martin nur 4.500 € (endet bei 14.500 €),
// Petra 110.000 € → keine Umschichtung. Soll: nur Martins eigenes Ziel und Vermögen zählen.
{
    const { projectCashRefill } = await import('../app/balance/annual-todo.js');
    const { createCashRefill } = await import('../app/shared/annual-todo-view.js');
    const { MockDocument } = await import('./helpers/balance-page-fixture.mjs');
    const martin = { profileId: MARTIN, name: 'Martin', tagesgeld: 10000, geldmarkt: 40000, target: 15000 };
    for (const petraCash of [5000, 9500, 30000, 110000]) {
        const petra = { profileId: PETRA, name: 'Petra', tagesgeld: petraCash, geldmarkt: 0, target: 8400, carrierHold: true };
        const refill = projectCashRefill({ people: [martin, petra], monthlyBase: 4000, cashMonths: 6, planOpen: false });
        const row = refill?.rows.find(item => item.profileId === MARTIN);
        assertClose(row?.amount ?? 0, 5000, 0.01, `RK-3 P3: Martin füllt bis zu seinem Ziel auf (Petra ${petraCash} €)`);
        assert(!refill.rows.some(item => item.profileId === PETRA), `RK-3 P3: Petra ohne Umschichtung (Petra ${petraCash} €)`);
        const text = createCashRefill(new MockDocument(), refill).textContent;
        assert(text.includes('Tagesgeld von Martin (10.000') && text.includes('Ziel von 15.000'), `RK-3 P3: Satz nennt Martins Ziel (${text.slice(0, 120)})`);
    }
    assertEqual(projectCashRefill({ people: [{ ...martin, tagesgeld: 16000 }, { profileId: PETRA, name: 'Petra', tagesgeld: 0, geldmarkt: 0, target: 8400, carrierHold: true }],
        monthlyBase: 4000, cashMonths: 6, planOpen: false }), null, 'RK-3 P3: Martin über seinem Ziel: keine Umschichtung, auch wenn Petra wenig hat');
    // Vorgabemodus unverändert: Haushaltsrechnung wie bisher (Petra 9.500 € → zusammen 4.500 € Raum bis 24.000 €).
    const free = projectCashRefill({ people: [martin, { profileId: PETRA, name: 'Petra', tagesgeld: 9500, geldmarkt: 0, target: 8400 }], monthlyBase: 4000, cashMonths: 6, planOpen: false });
    assertClose(free.rows.find(item => item.profileId === MARTIN).amount, 4500, 0.01, 'RK-3 P3: Vorgabemodus begrenzt weiter auf das Haushaltsziel');
    console.log('✅ RK-3 P3: Umschichtung der tragenden Person nur nach eigenem Ziel');
}
