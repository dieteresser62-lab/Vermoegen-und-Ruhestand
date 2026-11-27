// NK-1 (FR-84) Sollfälle A bis D. Nur Beispielhaushalte, Testdatum 15.11.2026, Monte Carlo mit Startwert 12345.
// A: Martin und Petra, „Martin trägt“, Petra heute Grad 4 im Heim (Tagesgeld 0, Depot 70.000 €), Martin 400.000 € Tagesgeld.
// B: Einzeljahr mit einer kleinen Netto-Lücke bei Petras Heimkosten (erfundene Beträge). C: Gegenprobe ohne Geldvermögen. D: Max und Erika.
// JD-2a: Eingefrorene Belege dieser Datei gelten dem Grundbestand 1925–2025 (Stichprobe und Provider, jahresrobust).
import { fz1References } from './helpers/fz-1-expectations.mjs';
import { readDM1References } from './helpers/dm-1-expectations.mjs';
import { readJA1References } from './helpers/ja-1-expectations.mjs';
import { readHP4References } from './helpers/hp-4-expectations.mjs';
import { readKR1cReferences } from './helpers/kr-1c-expectations.mjs';
import { readVB1References } from './helpers/vb-1-expectations.mjs';
import { hashWithoutExemptHome } from './helpers/family-home-log-hash.mjs';
import './helpers/grundbestand-sicht-aktiv.mjs';
import { measurementInputs, parameters, backtest, hash } from './helpers/ek-1b-measurement.mjs';
import { sollfallARecords, MARTIN, PETRA } from './helpers/nk-1-sollfall.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { observeYearOutcomesForTests } from '../app/simulator/simulator-engine-direct.js';
import { unmarriedWithdrawalPlan, capCarrierToPayable, unmarriedPayoutAccounting } from '../app/simulator/simulator-unmarried.js';
import { protocolActionExplanation } from '../app/simulator/protocol-renderer.js';
import { protocolCashflowBreakdown } from '../app/simulator/protocol-cashflows.js';
import { EngineAPI } from '../engine/index.mjs';

const readFZ1Reference = fz1References(import.meta.url);
const DATE = '2026-11-15';
/** Endgültige Ruin-Ergebnisse eines Aufrufs mit Geldvermögen und Grundbedarf ohne Pflege. */
async function observedRuins(fn) {
    const ruins = [];
    observeYearOutcomesForTests((outcome, yearIndex) => { if (outcome?.isRuin) ruins.push({ yearIndex, reason: outcome.reason, coverage: outcome.basicCoverage }); });
    try { return { result: await fn(), ruins }; } finally { observeYearOutcomesForTests(null); }
}
const realShortage = ruin => ruin.coverage && ruin.coverage.money + 0.01 < ruin.coverage.need;

// Sollfall A
{
    const inputs = await measurementInputs(0, 'martin-petra', DATE, 'traegt', sollfallARecords);
    assertEqual(`${inputs.householdWithdrawalMode} · ${inputs.partner?.careToday?.grade} ${inputs.partner?.careToday?.form} · ${inputs.simulationPeople.map(p => p.tagesgeld).join('/')}`,
        `one_carries:${MARTIN} · 4 residential · 400000/0`, 'A: Martin trägt, Petra Grad 4 im Heim, Tagesgeld 400.000/0 €');
    assert(inputs.pflegefallLogikAktivieren === true && inputs.home?.length === 2, 'A: Pflege an, Haus und Wohnung bleiben aktiv');
    const { result: chunk, ruins } = await observedRuins(() => runMonteCarloChunk({ inputs, engine: EngineAPI,
        monteCarloParams: { ...parameters, anzahl: 100, maxDauer: 20 }, widowOptions: inputs.widowOptions, useCapeSampling: false,
        runRange: { start: 0, count: 100 }, logIndices: Array.from({ length: 100 }, (_, i) => i) }));
    assertEqual(ruins.filter(ruin => /Persönlicher Ausgabenanteil/.test(ruin.reason)).length, 0, 'A: kein Lauf endet mit „Persönlicher Ausgabenanteil ungedeckt“');
    assertEqual(ruins.filter(ruin => !realShortage(ruin)).length, 0, 'A: kein Ruin, solange das Geldvermögen den Grundbedarf ohne Pflege deckt');
    const rows = chunk.runMeta.flatMap(run => run.logDataRows.map(row => ({ run: run.index, row })));
    assertEqual(rows.filter(({ row }) => row.immobilien_notverkauf).length, 0, 'A: kein Notverkauf, solange Martin Geldvermögen hat');
    const petraItem = row => row.personalPayout?.items?.find(item => item.profileId === PETRA);
    const martinItem = row => row.personalPayout?.items?.find(item => item.profileId === MARTIN);
    const caring = rows.filter(({ row }) => row.Person2Alive === 1 && row.CareP2_Active && petraItem(row));
    assert(caring.length > 100, `A: Jahre mit Petra im Heim beobachtet (${caring.length})`);
    // NK-1b: Was Petra nicht zahlen kann, fällt vor der Auszahlung als Hilfe zur Pflege heraus; Plan plus Hilfe ergeben ihre Heimkosten.
    const petraAid = row => (row.hilfe_zur_pflege_personen || []).filter(item => item.profileId === PETRA).reduce((sum, item) => sum + item.amount, 0);
    assertEqual(caring.filter(({ row }) => petraItem(row).planned + petraAid(row) + 0.01 < row.CareP2_Cost).length, 0,
        'A: Petras Heimkosten bleiben ganz bei Petra (Plan plus Hilfe), nichts geht auf Martin über');
    const aided = rows.filter(({ row }) => row.hilfe_zur_pflege > 0);
    assert(aided.length > 0 && chunk.careAid?.runIndices.length > 0, `A: Hilfe zur Pflege in ${chunk.careAid?.runIndices.length} von 100 Läufen`);
    for (const { row } of aided) {
        const petra = petraItem(row), martin = martinItem(row);
        // Todesjahr (FR-84 Punkt 10): Die eigene Pflege schließt vor der Nachlassverteilung ab. Stirbt Petra, gibt es danach ihr Konto
        // nicht mehr; stirbt Martin, zahlt der Nachlass Petras Pflege nicht, erst danach ihr geerbtes Vermögen.
        const account = row.personAccounts.find(person => person.profileId === PETRA);
        // Petras Anteil ist ihre ungedeckte Pflege samt der Steuer aus ihren Pflegeverkäufen (ohne Zugriff auf Martin).
        const own = petraAid(row);
        assert((!account || row.inheritance || account.tagesgeld < 1) && own + 0.01 >= Math.max(0, row.CareP2_Cost - petra.amount)
            && row.hilfe_zur_pflege + 0.01 >= own,
            `A: Hilfe zur Pflege erst, wenn Petras Geld aufgebraucht ist (Jahr ${row.jahr})`);
        assert(Math.abs(martin.amount - martin.planned) < 0.01 && !row.partner_grundbedarf, `A: Martin zahlt nur seinen Teil (Jahr ${row.jahr})`);
    }
    const sample = aided[0];
    const text = protocolActionExplanation(sample.row, { source: 'mc', inputs });
    assert(text.includes('Hilfe zur Pflege:') && text.includes('Petra'), 'A: Protokoll nennt „Hilfe zur Pflege: … €“ mit Petra');
    assert(protocolCashflowBreakdown(sample.row, { source: 'mc', inputs }).expenses.some(item => /Hilfe zur Pflege.*\(zahlt der Staat\)/.test(item.label)),
        'A: Ausgaben-ⓘ nennt den Anteil des Staats');
    const first = Math.min(...aided.map(({ row }) => row.jahr));
    assert(first >= 5, `A: Petras Depot (70.000 €) trägt die ersten Heimjahre selbst (erste Hilfe im Jahr ${first})`);
}

// Sollfall B: Einzeljahr mit erfundenen Beträgen. Petra soll 31.400,00 € Heimkosten zahlen, ihr Verkauf bringt netto 31.397,65 €;
// Martin trägt den Haushalt (48.000 €).
{
    const plan = { items: [{ profileId: MARTIN, shared: 48000, care: 0, withdrawalAmount: 48000 },
        { profileId: PETRA, shared: 0, care: 31400, withdrawalAmount: 31400 }] };
    const paid = { items: [{ planned: 48000, amount: 48000 }, { planned: 31400, amount: 31397.65 }] };
    const rows = unmarriedPayoutAccounting(plan, paid, { payout: 79400, incomeConsumed: 0, netFloorYear: 79400, floor: 79400 });
    const petra = rows.find(row => row.profileId === PETRA);
    assertEqual(`${petra.careAid.toFixed(2)} · ${petra.floorGap.toFixed(2)} · ${petra.flexCut.toFixed(2)}`, '2.35 · 0.00 · 0.00',
        'B: 2,35 € Hilfe zur Pflege, keine Lücke im Grundbedarf (kein Ruin, kein Notverkauf), keine Flex-Kürzung');
    assertEqual(rows.find(row => row.profileId === MARTIN).careAid + rows.find(row => row.profileId === MARTIN).floorGap, 0, 'B: Martin zahlt nichts davon');
    // Die tragende Person zahlt höchstens, was sie auszahlen kann; ihre eigene Pflege geht dabei nicht auf die andere Person über.
    const portfolio = { personAccounts: [{ profileId: MARTIN, tagesgeld: 10000 }, { profileId: PETRA, tagesgeld: 50000 }],
        depotTranchesAktien: [], depotTranchesGold: [], depotTranchesGeldmarkt: [], healthBucketTranches: [] };
    const shares = [{ profileId: MARTIN, carries: true, share: 1, care: 8000 }, { profileId: PETRA, carries: false, share: 0, care: 0 }];
    const capped = capCarrierToPayable(unmarriedWithdrawalPlan(shares, 14000, portfolio, true, []), shares, portfolio);
    // NK-1b (Fable P2-5): erst Grundbedarf, dann eigene Pflege. Martin zahlt 6.000 € gemeinsamen Anteil und 4.000 € Pflege; die übrigen
    // 4.000 € Pflege trägt der Staat. Petras Geld ersetzt keine Hilfe zur Pflege.
    assertEqual(`${capped.items.map(item => `${item.shared}/${item.care}`).join(' · ')} · ${capped.careCut?.amount}`, '6000/4000 · 0/0 · 4000',
        'B: Martins Pflege wird zuerst gekürzt (4.000 € Hilfe), kein Rückgriff auf Petra');
    const own = unmarriedWithdrawalPlan([{ profileId: MARTIN, share: 1, care: 0, carries: true }, { profileId: PETRA, share: 0, care: 30000, carries: false }],
        90000, { ...portfolio, personAccounts: [{ profileId: MARTIN, tagesgeld: 400000 }, { profileId: PETRA, tagesgeld: 20000 }] }, true, []);
    assertEqual(`${own.items.map(item => item.withdrawalAmount).join('/')} · ${own.careAid}`, '60000/30000 · 10000',
        'B: Plan ohne Übergang der Pflege; was Petras Geld nicht trägt (10.000 €), schätzt der Plan als Hilfe zur Pflege');
}

// Sollfall C: Gegenprobe. Beide ohne Geldvermögen, Martin trägt. Erst Notverkauf, dann Ruin wegen des Grundbedarfs.
{
    const poor = records => {
        const registry = JSON.parse(records.rs_profiles_v1);
        for (const id of [MARTIN, PETRA]) {
            Object.assign(registry.profiles[id].data, { profile_tagesgeld: '0', depot_tranchen: '[]' });
            if (records.rs_active_profile === id) Object.assign(records, { profile_tagesgeld: '0', depot_tranchen: '[]' });
        }
        records.rs_profiles_v1 = JSON.stringify(registry);
        return records;
    };
    const inputs = await measurementInputs(0, 'martin-petra', DATE, 'traegt', poor);
    const { result, ruins } = await observedRuins(() => backtest(inputs, 2000, 2025));
    const sales = result.rows.filter(entry => entry.row?.immobilien_notverkauf).map(entry => entry.jahr);
    assertEqual(result.outcome.kind, 'ruin', 'C: Der Lauf endet als Ruin');
    assertEqual(ruins.length, 1, 'C: genau ein Ruin');
    assert(/< Floor/.test(ruins[0].reason) && realShortage(ruins[0]) && ruins[0].coverage.careNeed === 0,
        `C: Grund ist der ungedeckte Grundbedarf (${ruins[0].reason})`);
    assert(sales.length === 2 && sales.every(year => year < result.rows.at(-1).jahr), `C: Haus und Wohnung wurden vorher notverkauft (${sales.join(', ')})`);
}

// Sollfall D: Max und Erika. Ohne Pflege, die das gemeinsame Vermögen aufzehrt, bytegleich mit dem Stand vor FR-84.
{
    const before = {
        grund: { off: 'c4ca602970dc0ef3363ff1b0972505ba55ac0d1229cfb87680ffd9a92f359738', on: '620a39b083cd2fb259acab48fcde72fdaa522183b228ce53951136216baf8348',
            bt: '1b90342600615d18da4043240eb1987c05a269487d32475c4275b0cf487bcebe', bt1965: 'ab7c902404d1fddf37c615d44555a33960cc4bb9b33f012704b8f88c9ddfcbff' },
        immobilien: { off: '3fbbb995010dc1db216a92061c2876cf9c8fc1eb58ee91f2b3219203e63c3e85', on: '463a1526c0b43e20aa4055c35d3498907d496962d96f0a87538b54929ff07c6b',
            bt: '5cc8c6321b623f82dd7639dcb983c56a9ed5967f29a66220e394c48227b80e1a', bt1965: 'c23f07c6cab583341fe12462a48b9946fd7331889e90c39000de54357f7c426a' }
    };
    for (const variant of ['grund', 'immobilien']) {
        const inputs = await measurementInputs(0, 'max-erika', DATE, variant);
        const off = { ...inputs, pflegefallLogikAktivieren: false };
        const run = values => runMonteCarloChunk({ inputs: values, engine: EngineAPI, monteCarloParams: { ...parameters, anzahl: 200 },
            widowOptions: values.widowOptions, useCapeSampling: false, runRange: { start: 0, count: 200 } });
        assertEqual(hashWithoutExemptHome(await run(off)), readFZ1Reference(readDM1References(readJA1References(readHP4References(readKR1cReferences(readVB1References(before[variant].off)))))), `D ${variant}: ohne Pflegelogik Monte Carlo im früheren Protokollformat mit belegtem Ehestatus`);
        assertEqual(hashWithoutExemptHome(await run(inputs)), readFZ1Reference(readDM1References(readJA1References(readHP4References(readKR1cReferences(readVB1References(before[variant].on)))))), `D ${variant}: mit Pflegelogik ohne aufgezehrtes Vermögen im früheren Protokollformat mit belegtem Ehestatus (200 Läufe)`);
        assertEqual(hash(backtest(inputs)), readDM1References(readKR1cReferences(readVB1References(before[variant].bt))), `D ${variant}: Backtest 2000–2025 mit belegtem Ehestatus`);
        assertEqual(hash(backtest(inputs, 1965, 1999)), readFZ1Reference(readDM1References(readKR1cReferences(readVB1References(before[variant].bt1965)))), `D ${variant}: Backtest 1965–1999 mit belegtem Ehestatus`);
    }
    // Verheiratet: Erika heute Grad 4 im Heim, wenig Geld. Die gemeinsame Kasse zahlt die Pflege, bis sie leer ist; erst dann der Staat.
    const lowMoney = records => {
        const registry = JSON.parse(records.rs_profiles_v1);
        const patch = { muster_a: { profile_tagesgeld: '20000', depot_tranchen: '[]' },
            muster_b: { profile_tagesgeld: '20000', depot_tranchen: '[]', profile_care_grade_today: '4', profile_care_form_today: 'residential' } };
        for (const [id, values] of Object.entries(patch)) {
            Object.assign(registry.profiles[id].data, values);
            if (records.rs_active_profile === id) Object.assign(records, values);
        }
        records.rs_profiles_v1 = JSON.stringify(registry);
        return records;
    };
    const inputs = await measurementInputs(0, 'max-erika', DATE, 'grund', lowMoney);
    const { result: chunk, ruins } = await observedRuins(() => runMonteCarloChunk({ inputs, engine: EngineAPI,
        monteCarloParams: { ...parameters, anzahl: 50, maxDauer: 15 }, widowOptions: inputs.widowOptions, useCapeSampling: false,
        runRange: { start: 0, count: 50 }, logIndices: Array.from({ length: 50 }, (_, i) => i) }));
    assertEqual(ruins.filter(ruin => !realShortage(ruin)).length, 0, 'D verheiratet: kein Ruin, solange das gemeinsame Geld den Grundbedarf ohne Pflege deckt');
    const aided = chunk.runMeta.flatMap(run => run.logDataRows).filter(row => row.hilfe_zur_pflege > 0);
    assert(aided.length > 0, `D verheiratet: Hilfe zur Pflege, wenn die gemeinsame Kasse leer ist (${aided.length} Jahre)`);
    assertEqual(aided.filter(row => row.personAccounts.some(person => person.tagesgeld > 1) || row.wertAktien > 1).length, 0,
        'D verheiratet: Der Staat zahlt erst, wenn das gemeinsame Geldvermögen aufgebraucht ist');
    assert(aided.every(row => !row.hilfe_zur_pflege_personen), 'D verheiratet: gemeinsame Kasse, keine Aufteilung je Person');
}
