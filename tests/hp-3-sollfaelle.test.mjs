// HP-3: Kleinigkeiten aus dem Nutzertest von HP-2. Nur synthetische Beispielhaushalte und erfundene Werte.
import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords, rebuildSyntheticPriceRecords } from '../app/demo/muster-haushalt.js';
import { annualRecordStorage, computeAnnualPlanUpdate } from '../app/balance/balance-annual-storage.js';
import { evaluateAnnualDraft } from '../app/balance/balance-annual-storage-commit.js';
import { syntheticAnnualQuote, syntheticAnnualInflation, syntheticAnnualCape, SYNTHETIC_MARKET_SOURCE } from '../app/shared/probelauf-prices.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { HANDBOOK_MUSTER_DATE } from '../app/demo/muster-haushalte.js';
import { createAnnualTodoResult } from '../app/shared/annual-close-result.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';

const clean = text => String(text).replaceAll(' ', ' ').replaceAll(' ', ' ');

// Punkt 1 (FR-78 Ergänzung 6): Jan und Lena, Grundfall, am Handbuchdatum angelegt, Sprung auf den 02.01.2027, Jahresabschluss 2026
// mit den Spielwerten. Die Zeilen je Person stehen auf den Euro und ergeben 90.000 €; der Kopf rundet diese Summe einmal.
// Vorher addierte er die je Person aufgerundeten Beträge: „Anteilig“ 55.000 + 40.000 = 95.000 €, „Reichweite zuerst“ 45.000 + 47.500 = 92.500 €.
{
    const now = () => new Date('2027-01-02T12:00:00Z');
    const marketData = {
        inflation: { ...syntheticAnnualInflation(2026, '2027-01-02'), fetchStatus: 'ok_primary_ecb', metric: 'consumer_prices_all_items_annual_average_growth_pct' },
        etf: { ...syntheticAnnualQuote('VWCE.DE', 2026, '2027-01-02'), source: SYNTHETIC_MARKET_SOURCE },
        cape: { ...syntheticAnnualCape(2026, '2027-01-02'), capeFetchStatus: 'ok_primary', capeUpdatedAt: now().toISOString() } };
    for (const [mode, label, rows] of [['proportional', 'Anteilig', ['Jan · Muster Aktien-ETF52.298 €', 'Lena · Muster Aktien-ETF37.702 €']],
        ['runway_first', 'Reichweite zuerst', ['Jan · Muster Aktien-ETF40.115 €', 'Lena · Muster Aktien-ETF49.885 €']]]) {
        const records = rebuildSyntheticPriceRecords(createMusterHaushaltRecords(HANDBOOK_MUSTER_DATE, 'jan-lena'), '2027-01-02');
        const plan = JSON.parse(records.household_plan_v1);
        for (const entry of Object.values(plan.entries)) entry.values.householdWithdrawalMode = mode;
        records.household_plan_v1 = JSON.stringify(plan);
        setAppTestDate('2027-01-02');
        try {
            const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData, storage: annualRecordStorage(records), now });
            const { action } = evaluateAnnualDraft(draft, { engineApi: EngineAPI, now }).outcome;
            const people = Object.entries(JSON.parse(records.rs_profiles_v1).profiles).map(([id, profile]) => ({ id, name: profile.name }));
            const result = clean(createAnnualTodoResult(new MockDocument(), { year: 2027, action, people }).textContent);
            assert(result.includes('Aktien verkaufenca. 90.000 €netto'), `HP-3 ${label}: Kopf ca. 90.000 € (${result.slice(0, 260)})`);
            assert(rows.every(row => result.includes(row)), `HP-3 ${label}: Zeilen je Person bleiben genau (${rows.join(' + ')})`);
            assert(result.includes('der Rest in den Geldmarkt90.000 €'), `HP-3 ${label}: „Wohin das Geld geht“ geht auf den Kopf auf`);
        } finally { setAppTestDate(null); }
    }
}

// Punkt 3: Das Erbschaftsteuer-ⓘ nennt Zugewinnausgleich und Versorgungsfreibetrag nominal und sagt es, mit dem Wert in Euro von heute
// dahinter (wie der Freibetrag im ⓘ „Todesfall …“). Erfundene Werte: Faktor 500.000 / 324.092 seit Planbeginn, Steuer unverändert.
{
    const inheritance = { deceasedProfileId: 'martin', survivorProfileId: 'petra', assets: 2119241, inherited: 2119241, inheritedHome: 0, percent: 100,
        tax: 158631, exemptGain: 418566, pensionAllowance: { amount: 127960, capital: 128040 }, leaves: 0, pensionEnds: 0 };
    const table = moneyBasis => renderProtocolTable([{ jahr: 24, erbschaftsteuer: 158631, abgang_erben: 0, inheritance,
        inflation_factor_cum: 500000 / 324092, inflation: 2 }], { source: 'mc', moneyBasis,
        inputs: { partnership: { status: 'married', maritalPropertyRegime: 'community' }, simulationPeople: [{ profileId: 'martin' }, { profileId: 'petra' }] } });
    const taxInfo = html => clean(/Vereinfachte Steuerklasse I:[^<]*Steuerberater fragen\./.exec(html)?.[0] ?? '');
    const real = taxInfo(table('real'));
    assert(real.includes('Steuerfrei als Zugewinnausgleich 418.566 €, gilt nominal, in Euro von heute 271.308 €.'),
        `HP-3 heutige Euro: Zugewinnausgleich nominal mit dem Wert von heute (${real})`);
    assert(real.includes('Versorgungsfreibetrag (§ 17 ErbStG) 127.960 € (256.000 € minus Kapitalwert der Hinterbliebenenrente 128.040 €), gilt nominal, in Euro von heute 82.942 €.'),
        `HP-3 heutige Euro: Versorgungsfreibetrag nominal mit dem Wert von heute (${real})`);
    const nominal = taxInfo(table('nominal'));
    assert(nominal.includes('Steuerfrei als Zugewinnausgleich 418.566 €.') && nominal.includes('128.040 €).') && !nominal.includes('nominal'),
        `HP-3 nominale Euro: Text wie bisher (${nominal})`);
}
