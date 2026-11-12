// RD-1b (Ergänzung 2 FR-78, Nutzer 12.11.2026): Die Anzeige geht in sich auf. Summen, Stände nach Umsetzung und Differenzen
// entstehen aus den angezeigten Beträgen; genau bleibende Teile stehen ohne Summe. Nur synthetische Beispielhaushalte.
import fs from 'node:fs';
import { EngineAPI } from '../engine/index.mjs';
import { renderCard, clean } from './helpers/wt-1-balance-render.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { annualRecordStorage, computeAnnualPlanUpdate } from '../app/balance/balance-annual-storage.js';
import { prepareAnnualCommitRecords } from '../app/balance/balance-annual-storage-commit.js';
import { annualTestMarketData } from './helpers/balance-storage-fixtures.mjs';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { projectAnnualTodoPlan } from '../app/balance/annual-todo.js';
import { createTodoResult } from '../app/shared/annual-todo-view.js';
import { createAnnualPlanResult } from '../app/shared/annual-close-result.js';
import { displayedReserves } from '../app/balance/balance-reserves.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';

const DATE = '2026-10-23';
const read = (shown, id) => clean(shown.doc.getElementById(id).textContent);
const euros = text => [...text.matchAll(/(\d{1,3}(?:\.\d{3})*) €/g)].map(match => Number(match[1].replaceAll('.', '')));

const maxErika = await renderCard(createMusterHaushaltRecords(DATE, 'max-erika'));
// Spätere Neuberechnungen anderer Haushalte dürfen die gelesenen Texte nicht berühren: Budgettexte sofort festhalten.
const budgetTexts = Object.fromEntries(['balanceMonthlyBudget', 'balanceMonthlyIncome', 'monatlicheEntnahme', 'balanceBudgetPlan'].map(id => [id, read(maxErika, id)]));
const reasonsHidden = maxErika.doc.getElementById('balanceBudgetReasons').hidden;

// Karte „Was zu tun ist“: Plan = Summe der angezeigten Zeilen; „Wohin das Geld geht“ derselbe Betrag.
{
    const card = maxErika.card;
    assert(card.includes('Aktien verkaufen89.500 €netto') && card.includes('9.500 €offen') && card.includes('80.000 €offen'),
        `Was zu tun ist: 9.500 + 80.000 = 89.500 € (${card.slice(0, 260)})`);
    assert(card.includes('der Rest in den Geldmarkt89.500 €'), 'Was zu tun ist: „Wohin das Geld geht“ 89.500 €');
}

// Karte „Deine Reserven“: nach Umsetzung aus angezeigten Beträgen, Tagesgeld genau am angezeigten Ziel.
{
    assertEqual(read(maxErika, 'balanceReserveValues'), 'Liquidität heute90.000 €→nach Umsetzung179.500 €', 'Reserven: 90.000 → 179.500 €');
    assertEqual(read(maxErika, 'balanceReserveParts'), 'Tagesgeld30.000 €→32.500 €Geldmarkt60.000 €→147.000 €', 'Reserven: Tagesgeld 30.000 → 32.500 €, Geldmarkt 60.000 → 147.000 €');
    assert(read(maxErika, 'balancePersonalCashTargets').endsWith('Summe 32.500 €'), 'Reserven: Tagesgeld nach Umsetzung = angezeigtes Tagesgeldziel 32.500 €');
    const view = { before: { tagesgeld: 30000, geldmarkt: 60000, liquidity: 90000 }, after: { tagesgeld: 32400, geldmarkt: 146912.5, liquidity: 179312.5 } };
    const shown = displayedReserves(view, { cashTarget: 32400, shownCashTarget: 32500, inflow: 89500 });
    assertEqual(`${shown.after.tagesgeld} · ${shown.after.geldmarkt} · ${shown.after.liquidity}`, '32500 · 147000 · 179500', 'Reserven: Teile ergeben die angezeigte Liquidität');
    assertEqual(JSON.stringify(view.after), JSON.stringify({ tagesgeld: 32400, geldmarkt: 146912.5, liquidity: 179312.5 }), 'Reserven: die genaue Projektion bleibt unverändert');
    const noTarget = displayedReserves({ before: view.before, after: { tagesgeld: 31000, geldmarkt: 60000, liquidity: 91000 } }, { cashTarget: 32400 });
    assertEqual(noTarget.after.tagesgeld, 31000, 'Reserven: ohne erreichtes Ziel heute + aufgerundete Änderung (1.000 €)');
    // Alle Beispielhaushalte: Tagesgeld und Geldmarkt nach Umsetzung ergeben die angezeigte Liquidität nach Umsetzung.
    for (const id of ['max-erika', 'renate', 'jan-lena', 'helga-werner', 'sophie', 'martin-petra']) {
        const shownCard = id === 'max-erika' ? maxErika : await renderCard(createMusterHaushaltRecords(DATE, id));
        const values = euros(read(shownCard, 'balanceReserveValues')), parts = euros(read(shownCard, 'balanceReserveParts'));
        // Mit Pflegevorsorge im Tagesgeld (Helga und Werner) ist die Liquidität kleiner als die Summe der Töpfe; die Prüfung gilt sonst.
        if (values.length < 2 || values[0] !== parts[0] + parts[2]) continue;
        assertEqual(parts[1] + parts[3], values[1], `Reserven ${id}: ${parts[1]} + ${parts[3]} = ${values[1]} nach Umsetzung`);
        const cash = read(shownCard, 'balancePersonalCashTargets');
        if (cash) {
            const targets = euros(cash);
            assertEqual(targets.slice(0, -1).reduce((sum, value) => sum + value, 0), targets.at(-1), `Reserven ${id}: Summe der angezeigten Tagesgeldziele`);
        }
    }
}

// Budgetkarte: Hauptzahl gerundet, Teile ohne Gleichheitszeichen und Summe, Differenz 0 ohne „Warum anders“.
{
    assertEqual(budgetTexts.balanceMonthlyBudget, '5.000 €', 'Budget: 5.000 €');
    assertEqual(`${budgetTexts.balanceMonthlyIncome} · ${budgetTexts.monatlicheEntnahme}`, '3.100 € · 2.000 €', 'Budget: Einkünfte 3.100 € · aus dem Vermögen 2.000 €');
    assertEqual(budgetTexts.balanceBudgetPlan, 'Plan 2026 · festgeschrieben am 01.01.20265.000 €Differenz 0 €', 'Budget: Plan 2026 5.000 €, Differenz 0 €');
    assertEqual(reasonsHidden, true, 'Budget: bei Differenz 0 keine Zeile „Warum anders“');
    const html = fs.readFileSync(new URL('../Balance.html', import.meta.url), 'utf8');
    const equation = html.slice(html.indexOf('<div class="monthly-flow-equation">'), html.indexOf('</div>', html.indexOf('<div class="monthly-flow-equation">')));
    const visible = equation.split('\n').filter(line => line.includes('<span') && !/ hidden[ >]/.test(line.split('>')[0] + '>'));
    assert(visible.length >= 2 && visible.every(line => !line.includes('>=<') && !line.includes('Monatsbudget')), 'Budget: die Zeile zeigt keine Summe mit Gleichheitszeichen');
    assert(equation.includes('aria-hidden="true">·</span>'), 'Budget: Teile mit „·“ getrennt');
    // Sophie: krummes Budget aus genauen Einkünften, Teile ohne Summe; Bedarf gesamt = Summe der angezeigten Zeilen.
    const sophie = await renderCard(createMusterHaushaltRecords(DATE, 'sophie'));
    assertEqual(read(sophie, 'balanceMonthlyBudget'), '2.900 €', 'Sophie: Budget 2.967 € → 2.900 €');
    assertEqual(read(sophie, 'balanceMonthlyIncome'), '3.400 €', 'Sophie: Einkünfte genau, ohne Summe daneben');
    const rows = [...read(sophie, 'balanceNeedRows').matchAll(/(\d{1,3}(?:\.\d{3})*) € \/ Monat/g)].map(match => Number(match[1].replaceAll('.', '')));
    assertEqual(euros(read(sophie, 'balanceNeedTotal'))[0], rows[0] + rows[1], `Sophie: Bedarf gesamt = Summe der angezeigten Zeilen (${rows.join(' + ')})`);
    assert(sophie.card.includes('Aktien kaufen9.000 €') && sophie.card.includes('In Aktien9.000 €'), 'Sophie: Kauf und Verwendung gleich (Kauf abgerundet, RD-1c)');
}

// Jahresabschluss 2027 (Abschluss 2026 mit synthetischen Jahresdaten): Plan = Summe der angezeigten Zeilen, Bedarf = Summe der Teile.
{
    const records = createMusterHaushaltRecords('2026-12-15', 'max-erika');
    const key = 'ruhestandsmodellValues_v29_guardrails', state = JSON.parse(records[key]);
    state.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2026', snapshotId: 'rd1b-before', phase: 'writes_started' };
    records[key] = JSON.stringify(state);
    setAppTestDate('2026-12-15');
    const now = () => new Date('2027-01-02T12:00:00Z');
    const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData: annualTestMarketData, storage: annualRecordStorage(records), now });
    const booked = { ...records, ...prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, now }).records };
    setAppTestDate(null);
    const entry = Object.values(JSON.parse(booked[ANNUAL_PLAN_RECORD_KEY]).entries).find(item => item.year === 2027);
    const people = [{ id: 'muster_a', name: 'Max' }, { id: 'muster_b', name: 'Erika' }];
    const plan = projectAnnualTodoPlan({ confirmed: { year: 2027, action: entry.adopted.action }, people });
    const text = clean(createTodoResult(new MockDocument(), plan).textContent);
    const amounts = euros(text);
    assert(plan.rows.length >= 1 && amounts[0] === amounts.slice(1, 1 + plan.rows.length).reduce((sum, value) => sum + value, 0),
        `Jahresabschluss: Plan = Summe der angezeigten Zeilen (${text.slice(0, 200)})`);
    const values = Object.values(JSON.parse(booked.household_plan_v1).entries)[0].values;
    const result = clean(createAnnualPlanResult({ doc: new MockDocument(), model: { summary: { monthlyBudget: entry.adopted.monthlyBudget }, annual: {} },
        result: { year: 2027, targetYear: 2026, planLabel: 'Plan 2027', needs: [{ id: 'floorBedarf', after: values.floorBedarf }, { id: 'flexBedarf', after: values.flexBedarf }],
            inflation: { rate: 2 } } }).textContent);
    assert(result.includes('62.000 € im Jahr'), `Jahresabschluss: beschlossener Bedarf genau 31.000 € + 31.000 € = 62.000 € (RD-1c) (${result.slice(0, 300)})`);
}
