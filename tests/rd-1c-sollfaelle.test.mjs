// RD-1c (Nachschritt zum Gutachten RD1-FABLE, Entscheidungen der Steuerung 12.11.2026): Sollfälle als dauerhafte Node-Tests.
// Nur synthetische Beispielhaushalte und erfundene Werte.
import { renderCard, clean } from './helpers/wt-1-balance-render.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { projectAnnualActionProgress } from '../app/balance/annual-action-progress.js';
import { displayedReserves } from '../app/balance/balance-reserves.js';
import { createAnnualPlanResult } from '../app/shared/annual-close-result.js';
import { createAnnualMarketChoice } from '../app/shared/annual-market-choice.js';
import { roundedHouseholdPlanComparison } from '../app/profile/household-plan-comparison.js';
import { projectOverviewFromRecords } from '../app/overview/overview-model.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';

const DATE = '2026-10-23';
const read = (shown, id) => clean(shown.doc.getElementById(id).textContent);

// 1 (P2-1): erledigt nur mit Verkauf; bei 0 immer offen.
{
    const status = (plan, sold) => projectAnnualActionProgress({ year: 2026, decidedOn: '2026-01-05',
        action: { quellen: [{ kind: 'aktien_neu', category: 'equity', sourceProfileId: 'a', brutto: plan, steuer: 0, netto: plan }] },
        sales: sold > 0 ? [{ profileId: 'a', trancheId: 'x', executedAt: '2026-03-01', netProceeds: sold, assetClass: 'equity', creditPending: false }] : [] }).lines[0];
    for (const [plan, sold, expected] of [[400, 0, 'offen'], [400, 100, 'erledigt'], [500, 0, 'offen'], [9362, 0, 'offen']]) {
        const line = status(plan, sold);
        assertEqual(line.status, expected, `Erledigt: Plan ${plan} €, verkauft ${sold} € → ${expected}`);
        if (expected === 'offen') assertEqual(line.restNet, plan, `Erledigt: Plan ${plan} € ohne Verkauf bleibt ganz offen`);
    }
    // Über den echten Renderer: Max und Erika mit einer erfundenen Resttranche 400 € ohne Verkauf.
    const records = createMusterHaushaltRecords(DATE, 'max-erika');
    const record = JSON.parse(records[ANNUAL_PLAN_RECORD_KEY]), entry = Object.values(record.entries)[0];
    const lot = entry.adopted.action.quellen.find(source => source.sourceProfileId === 'muster_a');
    entry.adopted.action.quellen.push({ ...lot, name: 'Resttranche', brutto: 400, steuer: 0, netto: 400 });
    records[ANNUAL_PLAN_RECORD_KEY] = JSON.stringify(record);
    const shown = await renderCard(records);
    assert(shown.card.includes('Resttranche500 €offen') && !shown.card.includes('Erledigt'), `Erledigt: Resttranche 400 € ohne Verkauf steht offen (${shown.card.slice(0, 400)})`);
}

// 2 (P2-2): Käufe aus der Liquidität abgerundet; die angezeigten Beträge unterschreiten die eiserne Reserve nicht.
const martinPetra = await renderCard(createMusterHaushaltRecords(DATE, 'martin-petra'));
{
    assert(martinPetra.card.includes('Aktien kaufen120.000 €') && martinPetra.card.includes('In Aktien120.000 €'),
        `Kauf: Martin und Petra genau 122.000 €, angezeigt 120.000 € (${martinPetra.card.slice(0, 220)})`);
    assertEqual(read(martinPetra, 'balanceReserveParts'), 'Tagesgeld130.000 €→10.000 €Geldmarkt0 €→0 €', 'Kauf: Tagesgeld 130.000 − 120.000 = 10.000 €');
    assert(read(martinPetra, 'balanceReserveTarget').includes('= 8.000 €') && read(martinPetra, 'balancePersonalCashTargets').endsWith('Summe 8.000 €'),
        'Kauf: 10.000 € liegen über der eisernen Reserve 8.000 €');
    assertEqual(read(martinPetra, 'balanceActionAmount'), '120.000 €', 'Kauf: Vorschauzeile abgerundet (genau 121.600 €)');
    const sophie = await renderCard(createMusterHaushaltRecords(DATE, 'sophie'));
    assert(sophie.card.includes('Aktien kaufen9.000 €') && read(sophie, 'balanceReserveParts') === 'Tagesgeld15.000 €→6.000 €Geldmarkt0 €→0 €',
        'Kauf: Sophie 9.400 → 9.000 €, Tagesgeld 15.000 − 9.000 = 6.000 € = angezeigtes Ziel');
    // 3 (P2-3): Finanzierter Flex gleich dem angezeigten Wunschbedarf, wenn er ihn genau erreicht. Das Budget wird nur abgerundet (RD-1d).
    const rows = read(sophie, 'balanceNeedRows');
    assert(rows.includes('Wunschbedarf (Flex)700 € / Monat') && rows.includes('einschließlich Rentenanteil700 € / Monat'),
        `Flex: Sophie genau 667 € und 667 € → beide 700 € (${rows})`);
    // RD-1d: Das Budget wird immer nur abgerundet; Regel 4 hebt es nie an (kein Paar Budget ↔ Bedarf).
    assertEqual(`${read(sophie, 'balanceMonthlyBudget')} · ${read(sophie, 'balanceAnnualBudget')}`, '2.900 € · 34.800 € im Jahr', 'Budget: Sophie 2.967 € → 2.900 €, Jahr 34.800 €, nur abgerundet');
}

// 4 (P3 displayedReserves): Regel 4 nur bei erreichtem Ziel; nie negativ; ohne Änderung wie heute.
{
    const before = { tagesgeld: 30000, geldmarkt: 60000, liquidity: 90000 };
    const run = (after, options = {}) => displayedReserves({ before, after: { ...after, liquidity: after.tagesgeld + after.geldmarkt } }, options).after;
    const gap = run({ tagesgeld: 32100, geldmarkt: 60000 }, { cashTarget: 32400, shownCashTarget: 32500 });
    assert(gap.tagesgeld < 32500, `Reserven: echte Lücke 300 € bleibt sichtbar (${gap.tagesgeld} unter 32.500 €)`);
    const reached = run({ tagesgeld: 32400, geldmarkt: 60000 }, { cashTarget: 32400, shownCashTarget: 32500 });
    assertEqual(reached.tagesgeld, 32500, 'Reserven: Ziel genau erreicht → angezeigtes Ziel');
    const empty = displayedReserves({ before: { tagesgeld: 400, geldmarkt: 0, liquidity: 400 }, after: { tagesgeld: 0, geldmarkt: 0, liquidity: 0 } }).after;
    assertEqual(empty.tagesgeld, 0, 'Reserven: 400 € → 0 € steht als 0 €, nicht −100 €');
    assertEqual(run({ tagesgeld: 29999, geldmarkt: 60000 }).tagesgeld, 29999, 'Reserven: Änderung 1 € bleibt genau (29.999 €, nicht 29.500 €)');
    const same = run({ tagesgeld: 30000, geldmarkt: 60000 });
    assertEqual(`${same.tagesgeld} · ${same.geldmarkt}`, '30000 · 60000', 'Reserven: ohne Änderung nach Umsetzung wie heute');
    const target = displayedReserves({ before: { tagesgeld: 30000, geldmarkt: 120400, liquidity: 150400 },
        after: { tagesgeld: 30000, geldmarkt: 133000, liquidity: 163000 } }, { liquidityTarget: 162000 }).after;
    assertEqual(target.liquidity, 165000, 'Reserven: Liquidität genau über dem Ziel 162.000 € steht nicht unter dem angezeigten Ziel 165.000 €');
}

// 5 (P3 Bedarf): Der beschlossene Bedarf im Jahresabschluss bleibt genau.
{
    const text = clean(createAnnualPlanResult({ doc: new MockDocument(), model: { summary: { monthlyBudget: 5100 }, annual: {} },
        result: { year: 2027, targetYear: 2026, planLabel: 'Plan 2027', needs: [{ id: 'floorBedarf', after: 31000 }, { id: 'flexBedarf', after: 31000 }], inflation: { rate: 2 } } }).textContent);
    assert(text.includes('62.000 € im Jahr'), `Jahresabschluss: beschlossener Bedarf 62.000 € = 31.000 + 31.000 € (${text.slice(0, 300)})`);
}

// 6 (P3 Wahl und Übersicht): gleich aussehende Optionen genau; „geändert“ nur bei geändertem Text.
{
    const option = (monthlyBudget, netAmount) => ({ monthlyBudget, mainAction: { text: 'Aktien verkaufen', netAmount } });
    const choice = clean(createAnnualMarketChoice(new MockDocument(), { yearEndDate: '2025-12-31', high: { high: { value: 165.79, asOf: '2026-08-12' } },
        comparison: { rule: option(5433, 37640), high: option(5333, 39900), difference: { monthlyBudget: -100 } } }, null, () => {}).textContent);
    assert(choice.includes('Monatsbudget 5.433 € · Aktien verkaufen 37.640 €') && choice.includes('Monatsbudget 5.333 € · Aktien verkaufen 39.900 €'),
        `Wahl: gerundet gleich (5.250 € · 40.000 €), deshalb genau (${choice})`);
    const distinct = clean(createAnnualMarketChoice(new MockDocument(), { yearEndDate: '2025-12-31', high: { high: { value: 165.79, asOf: '2026-08-12' } },
        comparison: { rule: option(7388, 37640), high: option(6990, 37640), difference: { monthlyBudget: -398 } } }, null, () => {}).textContent);
    assert(distinct.includes('Monatsbudget 7.250 €') && distinct.includes('Monatsbudget 6.750 €'), 'Wahl: unterscheidbare Optionen bleiben gerundet');
    const view = { recordStatus: 'valid', confirmedAction: { action: { type: 'TRANSACTION', quellen: [{ kind: 'aktien_neu', brutto: 38000, steuer: 360, netto: 37640 }], verwendungen: { liquiditaet: 37640 } } },
        rows: [{ label: 'Handlungsanweisung', plan: 'Aktien verkaufen · 37.640 € netto', preview: 'Aktien verkaufen · 38.100 € netto', delta: 'geändert' }] };
    const shown = roundedHouseholdPlanComparison(view, { previewSummary: { action: { verb: 'Aktien verkaufen', amount: 38100, amountUnit: '€ netto' } } }).rows[0];
    assertEqual(clean(`${shown.plan} | ${shown.preview} | ${shown.delta}`), 'Aktien verkaufen · 40.000 € netto | Aktien verkaufen · 40.000 € netto | unverändert',
        'Übersicht: gleicher angezeigter Text → nicht „geändert“');
}

// 8: Übersicht mit einem Modell aus einem echten Lauf (Renate, Jan und Lena, 28.10.2026), wie der Renderer.
{
    const model = id => {
        const records = createMusterHaushaltRecords('2026-10-28', id);
        return projectOverviewFromRecords({ registry: JSON.parse(records.rs_profiles_v1), activeId: records.rs_current_profile, liveData: records, now: new Date('2026-10-28T12:00:00Z') });
    };
    const shown = item => roundedHouseholdPlanComparison(item.planComparison, { planBudget: item.planComparison.recordStatus === 'valid' ? item.summary?.monthlyBudget : null,
        previewSummary: item.previewSummary }).rows;
    const renate = model('renate');
    assertEqual(clean(shown(renate).find(row => row.label === 'Monatsbudget').plan), '2.800 €', 'Übersicht echt: Renate Plan 2.850 € → 2.800 €');
    assertEqual(clean(renate.planComparison.rows.find(row => row.label === 'Monatsbudget').plan), '2.850 €', 'Übersicht echt: das Modell bleibt genau');
    const janLena = model('jan-lena');
    assert(clean(shown(janLena).find(row => row.label === 'Handlungsanweisung').plan).includes('102.500 € netto'),
        'Übersicht echt: Jan und Lena Plan = Summe der angezeigten Zeilen 60.000 + 42.500 = 102.500 €');
}

// RD-1e (Nachprüfung P2-N1, P3-3): Kaufanteile in „Wohin das Geld geht“ in jedem Status abgerundet, kleiner Kauf nicht als 0 €.
{
    const withGold = (variant, uses) => {
        const records = createMusterHaushaltRecords(DATE, 'max-erika', variant);
        const record = JSON.parse(records[ANNUAL_PLAN_RECORD_KEY]), action = Object.values(record.entries)[0].adopted.action;
        action.verwendungen = uses(action.verwendungen.liquiditaet);
        records[ANNUAL_PLAN_RECORD_KEY] = JSON.stringify(record);
        return { records, action };
    };
    const open = await renderCard(withGold(undefined, liquidity => ({ gold: 10300, liquiditaet: liquidity - 10300 })).records);
    assert(open.card.includes('Aktien verkaufen89.500 €') && open.card.includes('In Gold10.000 €') && open.card.includes('der Rest in den Geldmarkt79.500 €'),
        `Kaufanteil offen: Gold 10.300 → 10.000 €, Rest 89.500 − 10.000 = 79.500 € (${open.card.slice(0, 420)})`);
    const partial = await renderCard(withGold('teilweise', liquidity => ({ gold: 10300, liquiditaet: liquidity - 10300 })).records);
    assert(partial.card.includes('In Gold10.000 €'), `Kaufanteil teilweise: Gold 10.300 → 10.000 € (${partial.card.slice(0, 420)})`);
    const { action } = withGold(undefined, liquidity => ({ gold: 10300, liquiditaet: liquidity - 10300 }));
    const people = [{ id: 'muster_a', name: 'Max' }, { id: 'muster_b', name: 'Erika' }];
    const { projectAnnualTodoPlan } = await import('../app/balance/annual-todo.js');
    const { createTodoResult } = await import('../app/shared/annual-todo-view.js');
    const result = clean(createTodoResult(new MockDocument(), projectAnnualTodoPlan({ confirmed: { year: 2027, action }, people })).textContent);
    assert(result.includes('In Gold10.000 €'), `Kaufanteil im Jahresabschluss: Gold 10.300 → 10.000 € (${result.slice(0, 300)})`);
    // Kleiner Kaufanteil (Sophie: Aktien 9.100 € und Gold 300 €): Gold steht in ganzen Euro, nicht als 0 €.
    const records = createMusterHaushaltRecords(DATE, 'sophie');
    const record = JSON.parse(records[ANNUAL_PLAN_RECORD_KEY]), sophieAction = Object.values(record.entries)[0].adopted.action;
    sophieAction.verwendungen = { ...sophieAction.verwendungen, aktien: 9100, gold: 300 };
    records[ANNUAL_PLAN_RECORD_KEY] = JSON.stringify(record);
    const sophie = await renderCard(records);
    assert(sophie.card.includes('In Aktien9.000 €') && sophie.card.includes('In Gold300 €') && !sophie.card.includes('In Gold0 €'),
        `Kleiner Kaufanteil: Gold 300 € statt 0 € (${sophie.card.slice(0, 300)})`);
}

// RD-1f (P2-E1): Mit Kaufanteil ist der Rest angezeigter Verkauf minus die übrigen Teile; die Anteile ergeben den Verkauf.
{
    const { projectAnnualTodoPlan } = await import('../app/balance/annual-todo.js');
    const { createTodoResult } = await import('../app/shared/annual-todo-view.js');
    const people = [{ id: 'muster_a', name: 'Max' }, { id: 'muster_b', name: 'Erika' }];
    for (const [gold, rest] of [[14900, '75.500'], [10300, '79.500'], [300, '89.200']]) {
        const records = createMusterHaushaltRecords(DATE, 'max-erika');
        const record = JSON.parse(records[ANNUAL_PLAN_RECORD_KEY]), action = Object.values(record.entries)[0].adopted.action;
        action.verwendungen = { gold, liquiditaet: action.verwendungen.liquiditaet - gold };
        records[ANNUAL_PLAN_RECORD_KEY] = JSON.stringify(record);
        const goldShown = gold === 300 ? '300' : (Math.floor(gold / 1000) * 1000).toLocaleString('de-DE');
        const card = (await renderCard(records)).card;
        assert(card.includes('Aktien verkaufen89.500 €') && card.includes(`In Gold${goldShown} €`) && card.includes(`der Rest in den Geldmarkt${rest} €`),
            `Anteile Karte: Gold ${gold} → ${goldShown} € + ${rest} € = 89.500 € (${card.slice(0, 420)})`);
        const result = clean(createTodoResult(new MockDocument(), projectAnnualTodoPlan({ confirmed: { year: 2027, action }, people })).textContent);
        assert(result.includes(`In Gold${goldShown} €`) && result.includes(`der Rest in den Geldmarkt${rest} €`), `Anteile Jahresabschluss: Gold ${gold} → ${goldShown} € + ${rest} €`);
    }
}
