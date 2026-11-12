// RD-1 (FR-78 mit Ergänzung, FR-77 Punkt 2 geändert, Nutzer 12.11.2026): von Hand hergeleitete Sollfälle als dauerhafte Node-Tests.
// Anzeige ohne Scheingenauigkeit und Erledigt-Grenze nach Rundungsstaffel. Nur synthetische Daten: Beispielhaushalte, erfundene Werte.
import { roundForDisplay, displayUp, displayDown, displayMonthlyUp, displayMonthlyDown, displayAnnualFromMonthly, displayRoundingStep } from '../app/shared/display-rounding.js';
import { projectAnnualActionProgress, annualActionDoneThreshold } from '../app/balance/annual-action-progress.js';
import { renderCard, editRegistry, clean } from './helpers/wt-1-balance-render.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { HOUSEHOLD_PLAN_KEY } from '../app/profile/household-plan.js';
import { dynamicFlexPresetPatch } from '../app/shared/dynamic-flex-presets.js';
import { stockTrancheId } from '../app/balance/annual-todo.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';
import { createAnnualPlanResult } from '../app/shared/annual-close-result.js';
import { createAnnualMarketChoice } from '../app/shared/annual-market-choice.js';
import { roundedHouseholdPlanComparison } from '../app/profile/household-plan-comparison.js';

const DATE = '2026-10-23';
const beleg = records => Object.values(JSON.parse(records[ANNUAL_PLAN_RECORD_KEY]).entries)[0];

// Rundungsfunktion: Tabelle aus der Ergänzung FR-78.
{
    const cases = [
        ['Monatsbudget 7.388 € ab', displayMonthlyDown(7388), 7250],
        ['Jahresbudget dazu = 7.250 × 12, nicht 85.000 €', displayAnnualFromMonthly(7388, 'down'), 87000],
        ['Monatsbudget 1.873 € ab', displayMonthlyDown(1873), 1850],
        ['Jahr dazu 22.200 €', displayAnnualFromMonthly(1873, 'down'), 22200],
        ['Monatlicher Bedarf 3.412 € auf', displayMonthlyUp(3412), 3500],
        ['Jahr dazu 42.000 €', displayAnnualFromMonthly(3412, 'up'), 42000],
        ['Liquiditätsziel 312.640 € auf', displayUp(312640), 320000],
        ['Liquiditätsziel 1.040.300 € auf', displayUp(1040300), 1050000],
        ['Verkaufsbedarf 37.640 € auf', displayUp(37640), 40000],
        ['Liquidität nach Umsetzung 61.880 € ab', displayDown(61880), 60000],
        ['Vermögens-Projektion 1.734.210 € ab', displayDown(1734210), 1725000],
        ['Steuer-Schätzung 3.217 € auf', displayUp(3217), 3500],
        ['Steuer-Schätzung 18.420 € auf', displayUp(18420), 19000],
        ['Wert auf der Stufe 10.000 € auf', displayUp(10000), 10000],
        ['Monatswert auf der Grenze 5.000 € ab', displayMonthlyDown(5000), 5000]
    ];
    for (const [label, actual, expected] of cases) assertEqual(actual, expected, `Rundung: ${label} → ${expected}`);
    assertEqual(displayRoundingStep(5000, 'monthly'), 250, 'Rundung: 5.000 € im Monat fällt in die Stufe 250 € (Grenze exklusiv)');
    assertEqual(displayRoundingStep(9999.99), 500, 'Rundung: unter 10.000 € Stufe 500 €');
    assertEqual(roundForDisplay(-37640, { direction: 'up' }), -40000, 'Rundung: der Betrag ohne Vorzeichen wird gerundet');
    assertEqual(displayUp(165000.004), 165000, 'Rundung: Cent-Rauschen auf der Stufe bleibt auf der Stufe');
    assertEqual(displayUp(null), null, 'Rundung: fehlender Wert bleibt fehlend');
    assertEqual(displayMonthlyDown(5600), 5500, 'Dynamic Flex „Ausgewogen“: 5.600 € im Monat → 5.500 €');
    assertEqual(displayAnnualFromMonthly(67200 / 12, 'down'), 66000, 'Dynamic Flex „Ausgewogen“: 67.200 € im Jahr → 66.000 €');
}

// Erledigt-Grenze (FR-77 Punkt 2 geändert): verkauft ≥ Plan − ½ Stufe nach QUANTIZATION_TIERS.
{
    const status = (plan, sold) => projectAnnualActionProgress({ year: 2026, decidedOn: '2026-01-05',
        action: { quellen: [{ kind: 'aktien_neu', category: 'equity', sourceProfileId: 'a', brutto: plan, steuer: 0, netto: plan }] },
        sales: sold > 0 ? [{ profileId: 'a', trancheId: 'x', executedAt: '2026-03-01', netProceeds: sold, assetClass: 'equity', creditPending: false }] : [] }).lines[0].status;
    assertEqual(annualActionDoneThreshold(9362), 8862, 'Erledigt: Plan 9.362 € → Grenze 8.862 €');
    assertEqual(status(9362, 8862), 'erledigt', 'Erledigt: Plan 9.362 €, verkauft 8.862 € → erledigt');
    assertEqual(status(9362, 8861), 'teilweise', 'Erledigt: Plan 9.362 €, verkauft 8.861 € → teilweise');
    assertEqual(status(35000, 32500), 'erledigt', 'Erledigt: Plan 35.000 € → ab 32.500 €');
    assertEqual(status(35000, 32499), 'teilweise', 'Erledigt: Plan 35.000 €, 32.499 € → teilweise');
    assertEqual(status(79950, 74950), 'erledigt', 'Erledigt: Plan 79.950 € → ab 74.950 €');
    assertEqual(status(79950, 74949), 'teilweise', 'Erledigt: Plan 79.950 €, 74.949 € → teilweise');
    assertEqual(status(250000, 237500), 'erledigt', 'Erledigt: Plan 250.000 € → ab 237.500 €');
    assertEqual(status(250000, 237499), 'teilweise', 'Erledigt: Plan 250.000 €, 237.499 € → teilweise');
    assertEqual(status(9362, 9500), 'erledigt', 'Erledigt: Plan 9.362 €, verkauft 9.500 € → erledigt');
    assertEqual(status(9362, 0), 'offen', 'Erledigt: verkauft 0 → offen');
}

/** Plan ganz umgesetzt wie nach „Verkauf eintragen“ (wie WT-1b), danach Tagesgeld je Person. */
function planDone(records, cash) {
    const lines = (beleg(records).adopted.action.quellen || []).filter(source => source.sourceProfileId && source.trancheId && source.netto > 0
        && !['liquiditaet', 'cash'].includes(source.kind));
    return editRegistry(records, registry => {
        const actions = lines.map((source, index) => {
            const profileId = source.sourceProfileId, trancheId = stockTrancheId(source.trancheId, profileId), data = registry.profiles[profileId].data;
            const tranches = JSON.parse(data.depot_tranchen), lot = tranches.find(item => item.trancheId === trancheId);
            const sold = source.netto / lot.currentPrice, before = lot.shares;
            lot.shares -= sold; if ('marketValue' in lot) lot.marketValue = lot.shares * lot.currentPrice;
            data.depot_tranchen = JSON.stringify(tranches);
            return { schemaVersion: 1, eventType: 'sale_reconciled', actionId: `rd1-${index}`, profileId, trancheId, executedAt: '2026-03-12',
                actual: { sharesSold: sold, grossProceeds: source.netto, fees: 0, taxes: 0, netProceeds: source.netto }, cashStatus: 'confirmed_already_reflected',
                cashBalanceAfterPostingEur: cash[profileId] ?? 0, cashConfirmedAt: '2026-03-12T10:00:00.000Z',
                result: { beforeShares: before, remainingShares: lot.shares, trancheRemoved: false }, reconciledAt: '2026-03-12T10:00:00.000Z' };
        });
        for (const [profileId, value] of Object.entries(cash)) registry.profiles[profileId].data.profile_tagesgeld = String(value);
        registry.trancheReconciliation = { schemaVersion: 1, actions };
    });
}
const read = (shown, id) => clean(shown.doc.getElementById(id).textContent);

// Beispielhaushalte über den echten Renderer, Testdatum 23.10.2026.
{
    // Max und Erika: Liquiditätsziel 162.000 € → 165.000 €; Budget 2027 (Projektion) 5.100 € → 5.000 €, Jahr 60.000 €.
    const maxErika = await renderCard(createMusterHaushaltRecords(DATE, 'max-erika'));
    assert(maxErika.reserveTarget.includes('Ziel: 60 Monate Entnahme = 165.000 €'), `Max und Erika: Reserveziel 162.000 € → 165.000 € (${maxErika.reserveTarget})`);
    assertEqual(read(maxErika, 'balancePersonalCashTargets'), 'Tagesgeldziel: Max 5.000 € · Erika 27.500 € · Summe 32.500 €', 'Max und Erika: Tagesgeldziele aufgerundet');
    assert(maxErika.values.includes('Liquidität heute90.000 €') && maxErika.values.includes('nach Umsetzung179.500 €'),
        `Max und Erika: heute genau (Kontostand), nach Umsetzung aus angezeigten Beträgen 90.000 + 89.500 = 179.500 € (RD-1b) (${maxErika.values})`);
    assertEqual(read(maxErika, 'balanceMonthlyBudget'), '5.000 €', 'Max und Erika ohne Dynamic Flex: Monatsbudget 5.100 € → 5.000 €');
    assertEqual(read(maxErika, 'balanceAnnualBudget'), '60.000 € im Jahr', 'Max und Erika ohne Dynamic Flex: Jahr 60.000 €');
    assertEqual(read(maxErika, 'balanceMonthlyIncome'), '3.100 €', 'Max und Erika: Einkünfte bleiben genau');
    assert(maxErika.card.includes('Aktien verkaufen89.500 €netto, Steuer 1.000 € schon abgezogen') && maxErika.card.includes('Max') && maxErika.card.includes('9.500 €offen')
        && maxErika.card.includes('80.000 €offen'), `Max und Erika: Plan = Summe der angezeigten Zeilen 9.500 + 80.000 = 89.500 € (RD-1b), Zeilen auf, Steuer 827 € → 1.000 € (${maxErika.card.slice(0, 260)})`);

    // Renate: Liquiditätsziel 96.000 € → 100.000 €; Planzeile 44.448 € → 45.000 €, im Details-Dialog 44.448 € mit Cent.
    const renate = await renderCard(createMusterHaushaltRecords(DATE, 'renate'));
    assert(renate.reserveTarget.includes('= 100.000 €, davon 12 Monate im Tagesgeld'), `Renate: Reserveziel 96.000 € → 100.000 € (${renate.reserveTarget})`);
    assert(renate.card.includes('Anleihen verkaufen45.000 €netto') && renate.card.includes('iShares Core € Govt Bond ETF45.000 €offen'), `Renate: Planzeile 44.448 € → 45.000 € (${renate.card.slice(0, 260)})`);
    const details = read(renate, 'balancePlanDetails');
    assert(details.includes('552,44 €44.447,56 €offen') && details.includes('der Rest in den Geldmarkt44.447,56 €'),
        `Renate: „Details & Drucken“ zeigt den Planbetrag 44.448 € genau mit Cent, 44.447,56 € (${details.slice(0, 260)})`);

    // Tagesgeld auffüllen: Betrag und Ziel aufgerundet; Tagesgeld (Kontostand) genau. Schwelle und Auslösung rechnen ungerundet.
    const refill = async erika => renderCard(planDone(createMusterHaushaltRecords(DATE, 'max-erika'), { muster_a: 5000, muster_b: erika }));
    const at15000 = await refill(10000);
    assert(at15000.refill.includes('Dein Tagesgeld reicht noch für 5 Monate Entnahme (15.000 €). Ziel sind 12 Monate (32.500 €).')
        && at15000.refill.includes('18.000 €vom Geldmarkt aufs Tagesgeld umschichten'), `Tagesgeld auffüllen: Max und Erika 17.400 € → 18.000 € (${at15000.refill})`);
    assertEqual((await refill(11200)).refill, '', 'Tagesgeld auffüllen: genau 6 Monate (16.200 €) → weiter kein Hinweis');
    const at13500 = await refill(8500);
    assert(at13500.refill.includes('19.000 €vom Geldmarkt'), `Tagesgeld auffüllen: Max und Erika 18.900 € → 19.000 € (${at13500.refill})`);
    const renateRefill = await renderCard(planDone(createMusterHaushaltRecords(DATE, 'renate'), { muster_renate: 9000 }));
    assert(renateRefill.refill.includes('11.000 €vom Geldmarkt') && renateRefill.refill.includes('(9.000 €). Ziel sind 12 Monate (20.000 €).'),
        `Tagesgeld auffüllen: Renate 10.200 € → 11.000 €, Ziel 19.200 € → 20.000 € (${renateRefill.refill})`);

    // Max und Erika mit Dynamic Flex „Ausgewogen“: Budget 2027 (Projektion) 6.400 € → 6.250 €, Jahr 75.000 €.
    const data = createMusterHaushaltRecords(DATE, 'max-erika'), plan = JSON.parse(data[HOUSEHOLD_PLAN_KEY]);
    for (const entry of Object.values(plan.entries)) Object.assign(entry.values, dynamicFlexPresetPatch('ausgewogen'));
    data[HOUSEHOLD_PLAN_KEY] = JSON.stringify(plan);
    const dynamic = await renderCard(data);
    assertEqual(dynamic.next.rule.monthlyBudget, 6400, 'Dynamic Flex: gerechnet bleibt das Budget 2027 bei 6.400 €');
    assertEqual(read(dynamic, 'balanceMonthlyBudget'), '6.250 €', 'Dynamic Flex: Anzeige 6.250 € im Monat');
    assertEqual(read(dynamic, 'balanceAnnualBudget'), '75.000 € im Jahr', 'Dynamic Flex: Jahr = 6.250 € × 12 = 75.000 €');

    // Krummes Budget aus genauen Einkünften: Sophie (Ansparjahr, Gehalt 3.400 €) 2.967 € → 2.900 €, Jahr 35.604 € → 34.800 €.
    const sophie = await renderCard(createMusterHaushaltRecords(DATE, 'sophie'));
    assertEqual(read(sophie, 'balanceMonthlyBudget'), '2.900 €', 'Sophie: krummes Monatsbudget 2.967 € → 2.900 €');
    assertEqual(read(sophie, 'balanceAnnualBudget'), '34.800 € im Jahr', 'Sophie: Jahr 35.604 € → 34.800 €');
    assertEqual(read(sophie, 'balanceMonthlyIncome'), '3.400 €', 'Sophie: Einkünfte genau');
}

// Jahresabschluss: Monatsbudget des Folgejahrs ab, Bedarf über den Monat × 12 auf, Wahl mit Budget ab und Verkauf auf.
{
    const doc = new MockDocument();
    const result = createAnnualPlanResult({ doc, model: { summary: { monthlyBudget: 7388.42 }, annual: {} },
        result: { year: 2027, targetYear: 2026, planLabel: 'Plan 2027', needs: [{ id: 'floorBedarf', after: 31000 }, { id: 'flexBedarf', after: 31000 }], inflation: { rate: 2 } } });
    const text = clean(result.textContent);
    assert(text.includes('Monatsbudget 20277.250 €') && !text.includes('7.388'), `Jahresabschluss: Monatsbudget 7.388,42 € → 7.250 € (${text.slice(0, 200)})`);
    assert(text.includes('62.000 € im Jahr'), `Jahresabschluss: beschlossener Bedarf genau 31.000 + 31.000 = 62.000 € (RD-1c) (${text.slice(0, 400)})`);
    const main = { text: 'Aktien verkaufen', netAmount: 37640 };
    const choice = clean(createAnnualMarketChoice(new MockDocument(), { yearEndDate: '2025-12-31', high: { high: { value: 165.79, asOf: '2026-08-12' } },
        comparison: { rule: { monthlyBudget: 7388, mainAction: main }, high: { monthlyBudget: 6990, mainAction: main }, difference: { monthlyBudget: -398 } } }, null, () => {}).textContent);
    assert(choice.includes('Monatsbudget 7.250 € · Aktien verkaufen 40.000 €') && choice.includes('Monatsbudget 6.750 €') && choice.includes('Hoch von 166 €'),
        `Wahl: Budget ab, Verkauf auf, Kurs des Hochs unverändert (${choice})`);
}

// Übersicht: Anzeigefassung des Plan-Vergleichs; das Modell bleibt genau.
{
    const view = { recordStatus: 'valid', confirmedAction: { action: { type: 'TRANSACTION', quellen: [{ kind: 'aktien_neu', brutto: 38000, steuer: 360, netto: 37640 }],
        verwendungen: { liquiditaet: 37640 } } }, rows: [{ label: 'Monatsbudget', plan: '7.388\u00a0€', preview: '7.512\u00a0€', delta: '+124\u00a0€' },
        { label: 'Handlungsanweisung', plan: 'Aktien verkaufen · 37.640 € netto', preview: '—', delta: '—' }] };
    const before = JSON.stringify(view);
    const shown = roundedHouseholdPlanComparison(view, { planBudget: 7388, previewSummary: { monthlyBudget: 7512 } });
    assertEqual(roundedHouseholdPlanComparison(view, { planBudget: 700 }).rows[0].plan, '7.388\u00a0€', 'Übersicht: eine fremde Quelle (anderer Betrag) rundet die Zeile nicht');
    const row = label => shown.rows.find(entry => entry.label === label);
    assertEqual(clean(`${row('Monatsbudget').plan} | ${row('Monatsbudget').preview} | ${row('Monatsbudget').delta}`), '7.250 € | 7.500 € | +250 €', 'Übersicht: Monatsbudget ab, Δ aus den gezeigten Beträgen');
    assertEqual(clean(row('Handlungsanweisung').plan), 'Aktien verkaufen · 40.000 € netto', 'Übersicht: Verkaufsbetrag der Handlungsanweisung auf');
    assertEqual(JSON.stringify(view), before, 'Übersicht: das Modell bleibt unverändert');
}
