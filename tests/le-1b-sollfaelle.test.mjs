// LE-1b: Nachschritt zu LE-1/KO-2 nach dem Gutachten Fable (P2-2, P3-5, P3-9). P2-1 und P3-3 stehen in
// target-mortality.test.mjs und auto-optimizer.test.mjs, P3-4 in german-demography-care-survivor-contract.test.mjs.
import { createHash } from 'node:crypto';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { overviewScope } from '../app/overview/overview-storage.js';
import { sourceFingerprint, projectSimulationSummaries, simulationEntryKey, OVERVIEW_SIMULATION_KEY, FINGERPRINT_VERSION,
    LIFE_MODEL_STATE } from '../app/overview/overview-simulation-summary.js';
import { GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT as CONTRACT } from '../app/simulator/german-demography-care-survivor-contract.js';
import { resolveInputsPersonBirthYear, resolveBirthYear, resolveBaseMortalityProbability, resolveTargetMortalityProbability,
    resolveTargetMortalityReferenceYear } from '../app/simulator/target-mortality.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { EngineAPI } from '../engine/index.mjs';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { planScope, HOUSEHOLD_PLAN_KEY } from '../app/profile/household-plan.js';
import { createMonteCarloLifeState, updateMonteCarloLifeEventsForYear } from '../app/simulator/mc-life-events.js';
import { rng, makeRunSeed } from '../app/simulator/simulator-utils.js';

console.log('--- LE-1b Sollfälle ---');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// P2-1 in der Laufzeit: Jahreslauf des Monte Carlo (updateMonteCarloLifeEventsForYear), Frau 85, Jahrgang 1941,
// Pflegegrad 2 heute, „viel langsamer“, Vorgabefaktoren. Exakt 6,56 Jahre (target-mortality.test.mjs), Tafel 6,96, vorher 7,89.
{
    const configs = Object.fromEntries([1, 2, 3, 4, 5].map(grade => [grade, { zusatz: 0, flexCut: 1, mortalityFactor: CONTRACT.care.mortalityModel.defaultFactorsByGrade[grade] }]));
    const lifeExpectancy = careToday => {
        const inputs = { startAlter: 85, geschlecht: 'w', geburtsjahr: 1941, pflegefallLogikAktivieren: true, pflegeModellTyp: 'chronisch',
            pflegeGradeConfigs: configs, partner: { aktiv: false }, ...(careToday ? { careToday } : {}) };
        let sum = 0;
        const persons = 8000;
        for (let person = 0; person < persons; person++) {
            const random = rng(makeRunSeed(4711, careToday ? 2 : 1, person)), life = createMonteCarloLifeState(inputs, random);
            let years = 0;
            for (; years < 30 && life.p1Alive; years++) {
                updateMonteCarloLifeEventsForYear(life, inputs, { mode: 'none', percent: 0 }, years, { jahr: 2000, inflation: 2 }, 0, null, false, random, {});
                if (!life.p1Alive) break;
            }
            sum += years + 0.5;
        }
        return sum / persons;
    };
    const slow = lifeExpectancy({ grade: 2, progression: 'much_slower' }), healthy = lifeExpectancy(null);
    assert(slow < 6.96, `P2-1 Laufzeit: Frau 85, Grad 2, viel langsamer lebt kürzer als die Tafel (${slow.toFixed(2)} gegen 6,96)`);
    assert(Math.abs(slow - 6.56) < 0.15, `P2-1 Laufzeit: trifft die exakte Rechnung 6,56 (${slow.toFixed(2)})`);
    assert(Math.abs(healthy - 6.96) < 0.15, `P2-1 Laufzeit: ohne Pflegegrad wie die Tafel (${healthy.toFixed(2)})`);
    assert(slow < healthy, 'P2-1 Laufzeit: Pflegegrad heute verkürzt gegenüber derselben Person ohne Pflegegrad');
}

// P2-2: Der Fingerprint der Übersicht enthält den Modellstand von Sterbetafel und Pflege.
// Alte Werte gemessen auf 8d54354d (vor LE-1b), Musterdatum 23.10.2026.
{
    const MEASURED_BEFORE = {
        'max-erika': { montecarlo: '3fa8e67623dc4fe14d36cd417856f6c6d6a2b41564bf8c024b8c3709c851016a',
            workshop: '364de253df833ffef92bad59c0e1255eefe108651ca026ce8d1154fea21c8e97',
            backtest: 'ed7d4183706c87752b5a07aef36f79c248e8d84e40a08ed1fcf6c16635160f9f' },
        'jan-lena': { backtest: '45a3d3e60c490624c95946d827b77cb38225c6a08e783ae9b2d8c0c3d59edd24' }
    };
    assertEqual(LIFE_MODEL_STATE.demographyCareSurvivor, CONTRACT.revision, 'P2-2: Modellstand ist die Revision des Demografievertrags');
    const context = id => {
        const records = createMusterHaushaltRecords('2026-10-23', id), registry = JSON.parse(records.rs_profiles_v1);
        const ids = Object.keys(registry.profiles);
        return { records, registry, scope: overviewScope(ids.length === 1 ? 'single' : 'household', ids) };
    };
    const me = context('max-erika');
    const fp = (ctx, kind) => sourceFingerprint({ registry: ctx.registry, activeId: ctx.records.rs_current_profile, liveData: ctx.records, scope: ctx.scope, kind });
    assert(fp(me, 'montecarlo') !== MEASURED_BEFORE['max-erika'].montecarlo, 'P2-2: Monte-Carlo-Fingerprint mit altem Modellstand ist ungleich dem neuen');
    assert(fp(me, 'workshop') !== MEASURED_BEFORE['max-erika'].workshop, 'P2-2: Werkstatt-Fingerprint mit altem Modellstand ist ungleich dem neuen');
    assertEqual(fp(me, 'backtest'), MEASURED_BEFORE['max-erika'].backtest, 'P2-2: Backtest ohne Dynamic Flex kennt keinen Tod und bleibt gültig');
    assert(fp(context('jan-lena'), 'backtest') !== MEASURED_BEFORE['jan-lena'].backtest, 'P2-2: Backtest mit Dynamic Flex (Horizont aus der Zieltafel) gilt als veraltet');

    // Gespeichertes Ergebnis von vorher: Monte Carlo gilt als veraltet, der Backtest ohne Dynamic Flex nicht. Gelesen wird nur.
    const entry = (kind, sourceFingerprintValue) => ({ scope: me.scope, kind, completedAt: '2026-10-20T10:00:00Z', statement: kind === 'backtest' ? 'completed' : 'Lauf abgeschlossen',
        priceBasis: 'real', fingerprintVersion: FINGERPRINT_VERSION, sourceFingerprint: sourceFingerprintValue, runFingerprint: 'a'.repeat(64), deviationApplied: false,
        metrics: kind === 'backtest' ? { startYear: 2000, endYear: 2025, failureYear: null, endWealthReal: 1 } : { runs: 10, covered: 9, successPct: 90, median: 1, p5: 0 } });
    const stored = JSON.stringify({ version: 1, entries: {
        [simulationEntryKey(me.scope, 'montecarlo')]: entry('montecarlo', MEASURED_BEFORE['max-erika'].montecarlo),
        [simulationEntryKey(me.scope, 'backtest')]: entry('backtest', MEASURED_BEFORE['max-erika'].backtest) } });
    const registry = structuredClone(me.registry);
    for (const profile of Object.values(registry.profiles)) profile.data[OVERVIEW_SIMULATION_KEY] = stored;
    const liveData = { ...me.records, [OVERVIEW_SIMULATION_KEY]: stored };
    const before = JSON.stringify(liveData);
    const summaries = projectSimulationSummaries({ registry, activeId: me.records.rs_current_profile, liveData, scope: me.scope });
    assert(summaries.montecarlo.entry && summaries.montecarlo.stale === true, 'P2-2: Monte-Carlo-Ergebnis von vor LE-1 gilt einmal als veraltet');
    assert(summaries.backtest.entry && summaries.backtest.stale === false, 'P2-2: Backtest ohne Dynamic Flex bleibt aktuell');
    assertEqual(JSON.stringify(liveData), before, 'P2-2: Die Prüfung schreibt nichts');
}

// P3-5: Ersatz-Geburtsjahr aus dem Bezugsjahr der Aufrufstelle oder der App-Uhr, nicht fest 2026.
{
    setAppTestDate('2027-03-01');
    try {
        assertEqual(resolveTargetMortalityReferenceYear(), 2027, 'P3-5: Bezugsjahr folgt dem Testdatum');
        assertEqual(resolveInputsPersonBirthYear({ startAlter: 60 }, 0), 1967, 'P3-5: Ohne Geburtsjahr gilt Jahr der App-Uhr − Startalter');
        assertEqual(resolveInputsPersonBirthYear({ partner: { aktiv: true, startAlter: 58 } }, 1), 1969, 'P3-5: Partner ebenso');
        assertEqual(resolveInputsPersonBirthYear({ startAlter: 60 }, 0, 2030), 1970, 'P3-5: Bezugsjahr der Aufrufstelle hat Vorrang');
        assertEqual(resolveBirthYear(1958, 67), 1958, 'P3-5: Gespeichertes Geburtsjahr bleibt');
        assertEqual(resolveBaseMortalityProbability({ startAlter: 70, geschlecht: 'w' }, 0, 'w', 80), resolveTargetMortalityProbability('w', 80, 1957),
            'P3-5: Todesziehung ohne Geburtsjahr nutzt den Jahrgang aus der App-Uhr');
    } finally { setAppTestDate(null); }
    setAppTestDate('2026-10-23');
    try { assertEqual(resolveInputsPersonBirthYear({ startAlter: 60 }, 0), 1966, 'P3-5: Im Jahr 2026 wie bisher'); } finally { setAppTestDate(null); }
}

// P3-9: Gegenprobe k = 0 für einen Haushalt. Jan und Lena (Dynamic Flex) rechnen mit Planwert 0 % in Balance
// Eingabe und Ergebnis bytegleich zu LE-1 allein (gemessen auf 59062858, vor dem Merge mit KO-2).
// Die vereinte Änderung ist damit genau die Folge der Fondskosten; ohne Kosten bleibt nur die von FR-75.
{
    const LE1_ONLY = { input: '059b4a0bbe260b810e399990760594695805f127f612479dc12d10f4fa458c6d',
        result: 'b126a494c18c6adc43d006e4b67170045f870245b2c2c9afc93159ae2638be28' };
    const balance = k => {
        const records = createMusterHaushaltRecords('2026-10-28', 'jan-lena');
        if (k !== undefined) {
            const plan = JSON.parse(records[HOUSEHOLD_PLAN_KEY]);
            for (const entry of Object.values(plan.entries)) entry.values.equityCostPct = k;
            records[HOUSEHOLD_PLAN_KEY] = JSON.stringify(plan);
        }
        const registry = JSON.parse(records.rs_profiles_v1);
        const scope = planScope('household', Object.keys(registry.profiles));
        const calc = buildBalanceEngineInputFromStorage({ storage: { getItem: key => records[key] ?? null }, scope, referenceYear: 2026 });
        const result = EngineAPI.simulateSingleYear(calc.engineInput, calc.engineLastState);
        return { dynamicFlex: calc.engineInput.dynamicFlex, input: hash(calc.engineInput), result: hash(result) };
    };
    setAppTestDate('2026-10-28');
    try {
        const zero = balance(0), standard = balance(undefined);
        assertEqual(zero.dynamicFlex, true, 'P3-9: Jan und Lena rechnen mit Dynamic Flex');
        assertEqual(zero.input, LE1_ONLY.input, 'P3-9: k = 0 ergibt die Balance-Eingabe von LE-1 allein');
        assertEqual(zero.result, LE1_ONLY.result, 'P3-9: k = 0 ergibt das Balance-Ergebnis von LE-1 allein');
        assert(standard.result !== LE1_ONLY.result, 'P3-9: Mit der Vorgabe 0,5 % wirkt KO-2 zusätzlich');
    } finally { setAppTestDate(null); }
}
console.log('✅ LE-1b Sollfälle');
