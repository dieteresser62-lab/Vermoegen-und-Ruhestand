// NK-2 Nachträge 16a und 17 (FR-84 Punkt 20): Bevor Hilfe zur Pflege einsetzt, verkauft die pflegebedürftige Person ihre verwertbare
// Immobilie: eine vermietete, oder die selbst genutzte, wenn niemand mehr darin wohnt. Kein Schonbetrag; Erlös (90 %) auf ihr Konto, die
// Miete entfällt. Beispielhaushalt Martin und Petra („Martin trägt“), Testdatum 15.11.2026, erfundene Beträge.
import { measurementInputs, parameters, backtest } from './helpers/ek-1b-measurement.mjs';
import { pfa2Records, countingStorage, IDS } from './helpers/pfa-2-balance.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { careSaleEligible } from '../app/simulator/simulator-home-sale.js';
import { protocolActionExplanation } from '../app/simulator/protocol-renderer.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { careAidHintText } from '../app/shared/care-aid.js';
import { IMMOBILIEN_KEY } from '../app/profile/profile-immobilien.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { EngineAPI } from '../engine/index.mjs';
setAppTestDate('2026-11-15');

const PETRA = 'muster_petra', DATE = '2026-11-15';
const YEAR = { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0, lohn: 0 };
/** Petra ohne Geld und Depot im Heim; `flat` behält ihre vermietete Wohnung aus dem Musterhaushalt. */
const petraInHome = ({ flat = true, grade = '4' } = {}) => records => {
    const registry = JSON.parse(records.rs_profiles_v1), data = registry.profiles[PETRA].data;
    Object.assign(data, { profile_tagesgeld: '0', depot_tranchen: '[]', profile_care_grade_today: grade, profile_care_form_today: 'residential' });
    if (!flat) { const raw = JSON.parse(data[IMMOBILIEN_KEY]); raw.entries = raw.entries.filter(entry => entry.nutzung !== 'vermietet'); data[IMMOBILIEN_KEY] = JSON.stringify(raw); }
    records.rs_profiles_v1 = JSON.stringify(registry);
    Object.assign(records, registry.profiles[records.rs_current_profile].data);
    return records;
};
const petraCash = row => row.personAccounts?.find(account => account.profileId === PETRA)?.tagesgeld ?? NaN;

// Befund 2157: Petras vermietete Wohnung (240.000 €) wird vor der Hilfe verkauft; Hilfe erst, wenn der Erlös aufgebraucht ist.
{
    const inputs = await measurementInputs(0, 'martin-petra', DATE, 'traegt', petraInHome());
    assertEqual(inputs.home.filter(home => home.profileId === PETRA && home.nutzung === 'vermietet').length, 1, 'Befund 2157: Petra hat eine vermietete Wohnung');
    const rows = backtest(inputs, 2000, 2025).rows.map(entry => entry.row);
    assertEqual(`${rows[0].immobilien_verkauf_pflege} · ${rows[0].immobilien_notverkauf ?? false} · ${rows[0].hilfe_zur_pflege ?? 0}`, '1 · false · 0',
        'Befund 2157: Verkauf im ersten Jahr, kein Notverkauf, keine Hilfe');
    assert(Math.abs(rows[0].immobilienverkauf_personen[0].amount - 216000) < 1 && rows[0].immobilienverkauf_personen[0].profileId === PETRA, 'Befund 2157: 90 % Erlös auf Petras Konto');
    assert(/Verkauf Immobilie für Heimkosten/.test(protocolActionExplanation(rows[0], { source: 'mc', inputs })), 'Befund 2157: Protokollzeile „Verkauf Immobilie für Heimkosten“');
    const firstAid = rows.findIndex(row => row.hilfe_zur_pflege > 0);
    assert(firstAid !== 0, 'Befund 2157: keine Hilfe im ersten Jahr');
    if (firstAid > 0) assert(petraCash(rows[firstAid]) < 1, `Befund 2157: Hilfe erst, wenn Petras Erlös aufgebraucht ist (Jahr ${firstAid + 1})`);
    const without = backtest(await measurementInputs(0, 'martin-petra', DATE, 'traegt', petraInHome({ flat: false })), 2000, 2001).rows[0].row;
    assert(without.hilfe_zur_pflege > 0 && !without.immobilienverkauf, 'Gegenprobe ohne vermietete Wohnung: Hilfe ab dem ersten Heimjahr');
}

// Nachtrag 17: selbst genutzte Wohnung. Geschützt, solange der Partner darin wohnt; wohnt niemand mehr darin, Verkauf vor der Hilfe.
{
    const inputs = await measurementInputs(0, 'martin-petra', DATE, 'traegt', petraInHome({ flat: false, grade: '3' }));
    inputs.home = [{ id: 'wohnung', profileId: PETRA, wert: 300000, nutzung: 'selbst', stand: '2026-10' }];
    const couple = simulateOneYear(initMcRunState(inputs), inputs, YEAR, 0, null, 0, null, 1, EngineAPI).logData;
    assert(couple.hilfe_zur_pflege > 0 && !couple.immobilienverkauf, 'Paar: Martin wohnt darin, kein Verkauf, Hilfe zur Pflege');
    const residential = { active: true, grade: 3, heimJahr: 2 };
    assertEqual([careSaleEligible(inputs.home[0], inputs, { p1Alive: true, p2Alive: true, care: { p2: residential } }),
        careSaleEligible(inputs.home[0], inputs, { p1Alive: false, p2Alive: true, care: { p2: residential } })].join(), 'false,true', 'Selbst genutzt: verwertbar erst ohne Bewohner');
    // Martin stirbt (Startwert 12345, Lauf 1): Bis dahin Hilfe ohne Verkauf, ab dann Verkauf und keine Hilfe mehr.
    const rows = (await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: { ...parameters, anzahl: 1000, maxDauer: 30 },
        widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start: 1, count: 1 }, logIndices: [1] })).runMeta[0].logDataRows;
    const death = rows.findIndex(row => row.Person1Alive === 0);
    assert(death > 0 && rows.slice(0, death).every(row => !row.immobilienverkauf) && rows[0].hilfe_zur_pflege > 0, `Partner lebt: Hilfe ohne Verkauf (Tod im Jahr ${death + 1})`);
    assertEqual(`${rows[death].immobilien_verkauf_pflege} · ${rows.slice(death + 1).filter(row => row.hilfe_zur_pflege > 0).length}`, '1 · 0',
        'Partner verstorben: Verkauf ab dann, danach keine Hilfe aus dieser Lage');
    // Einzelperson im Heim mit eigener Wohnung: Verkauf vor der Hilfe.
    const renate = records => {
        const registry = JSON.parse(records.rs_profiles_v1);
        for (const profile of Object.values(registry.profiles)) Object.assign(profile.data, { profile_tagesgeld: '0', depot_tranchen: '[]',
            profile_care_grade_today: '3', profile_care_form_today: 'residential' });
        records.rs_profiles_v1 = JSON.stringify(registry);
        Object.assign(records, registry.profiles[records.rs_current_profile].data);
        return records;
    };
    const single = await measurementInputs(0, 'renate', DATE, 'grund', renate);
    single.home = [{ id: 'wohnung', profileId: single.simulationPeople[0].profileId, wert: 300000, nutzung: 'selbst', stand: '2026-10' }];
    const alone = simulateOneYear(initMcRunState(single), single, YEAR, 0, null, 0, null, 1, EngineAPI).logData;
    assertEqual(`${alone.immobilien_verkauf_pflege} · ${alone.hilfe_zur_pflege ?? 0}`, '1 · 0', 'Einzelperson im Heim: Verkauf der eigenen Wohnung vor der Hilfe');
}

// Jahresabschluss: Der Hinweis nennt, dass die Immobilie zuerst verkauft wird.
{
    const { records, scope } = pfa2Records({ care: [null, { grade: 4, form: 'residential', residentialSince: '2023-01' }], unmarried: true, cash: [80000, 0],
        clearTranches: true, testDate: DATE });
    const registry = JSON.parse(records.rs_profiles_v1);
    registry.profiles[IDS[1]].data[IMMOBILIEN_KEY] = JSON.stringify({ schemaVersion: 1, entries: [{ id: 'wohnung', bezeichnung: 'Wohnung', nutzung: 'vermietet',
        wert: 200000, mieteNetto: 500, anpassung: 'keine', stand: '2026-10' }] });
    records.rs_profiles_v1 = JSON.stringify(registry);
    const calculation = buildBalanceEngineInputFromStorage({ storage: countingStorage(records).storage, scope, referenceYear: 2026 });
    const text = careAidHintText(calculation.inputData.careAid, value => `${Math.round(value)} €`);
    assert(/Vorher muss Werner die eigene Immobilie verkaufen/.test(text), `Jahresabschluss: Hinweis auf den Verkauf (${text})`);
    assert(!/voraussichtlich/.test(text), `NK-2b (Fable P3-7): kein Hilfebetrag „voraussichtlich“, den der Simulator wegen des Verkaufs nicht zahlt (${text})`);
}
