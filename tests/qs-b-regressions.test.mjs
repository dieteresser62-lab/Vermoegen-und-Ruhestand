import nodeAssert from 'node:assert/strict';
const A = globalThis.__wrapExternalAssert(nodeAssert);
import { inputs as fixture } from './extended/parity-replay-fixture.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { makeDefaultCareMeta, priceCareMeta, updateCareMeta } from '../app/simulator/simulator-engine-helpers.js';
import { applyHealthBucketCoverage, applyHealthBucketInterest } from '../app/simulator/simulator-health-bucket.js';
import { calculateHouseholdPensionForYear, survivorIncomeOffset } from '../app/simulator/simulator-household-pension.js';
import { createRunAssumptions, effectiveRunAssumptions } from '../app/simulator/simulator-run-assumptions.js';
import { buildPlanOverview, projectPlanMonthlyFlow } from '../app/simulator/simulator-plan-overview.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { createMonteCarloRunMetrics, recordMonteCarloRunOutcome } from '../app/simulator/mc-run-metrics.js';
import { createMonteCarloBuffers } from '../app/simulator/monte-carlo-runner-utils.js';
import { personalAssetValues } from '../app/simulator/simulator-unmarried.js';
import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { getCommonInputs } from '../app/simulator/simulator-portfolio-inputs.js';
import { readDocumentPersonInputs } from '../app/simulator/simulator-person-overrides.js';
import { renderManagerPartnership } from '../app/tranches/tranchen-manager-partnership.js';
import { PARTNERSHIP_KEY } from '../app/profile/household-partnership.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { lifetimeUseMultiplier } from '../app/shared/life-expectancy.js';
import { setAppTestDate } from '../app/shared/app-clock.js';

const selected = id => !process.env.QSB_CASE || process.env.QSB_CASE === String(id);
const close = (actual, expected) => A.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≠ ${expected}`);
const year = { jahr: 2026, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0, lohn: 0 };
const both = { p1Alive: true, p2Alive: true };
function cashInputs(couple = false, cash = 100000) {
    const input = { ...structuredClone(fixture), startVermoegen: cash, depotwertAlt: 0, depotwertNeu: 0,
        einstandAlt: 0, einstandNeu: 0, tagesgeld: cash, geldmarktEtf: 0, detailledTranches: [],
        startFloorBedarf: 0, startFlexBedarf: 0, minimumFlexAnnual: 0, renteMonatlich: 0,
        renteStartOffsetJahre: 0, renteStartMonate: 12, rentAdjMode: 'fix', rentAdjPct: 0,
        pflegefallLogikAktivieren: false, dynamicFlex: false, goldAktiv: false,
        healthBucket: { enabled: false }, healthBucketEnabled: false,
        partner: couple ? { ...fixture.partner, aktiv: true, monatsrente: 0, brutto: 0,
            startInJahren: 0, renteStartMonate: 12 } : { aktiv: false } };
    input.simulationPeople = input.simulationPeople.slice(0, couple ? 2 : 1)
        .map((person, index) => ({ ...person, tagesgeld: cash * (couple ? index ? .25 : .75 : 1) }));
    return input;
}
const annual = (input, household = null, state = initMcRunState(input), index = 0, data = year) =>
    simulateOneYear(state, input, data, index, null, 0, household, 1, EngineAPI);
const chunk = input => runMonteCarloChunk({ inputs: input, engine: EngineAPI, useCapeSampling: false,
    widowOptions: { mode: 'none', percent: 0 }, logIndices: [0],
    monteCarloParams: { anzahl: 1, maxDauer: 1, blockSize: 1, seed: 12345,
        methode: 'block', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' } });

if (selected(1)) {
    for (const trancheAmount of [0, 1000]) {
        const portfolio = { healthBucketConfig: { enabled: true, initialAmount: 10000, triggerMinGrade: 4,
            coverageMode: 'floor_when_care_active', returnMode: 'cash_return' }, healthBucketGeldmarkt: 10000,
            healthBucketTranches: trancheAmount ? [{ marketValue: trancheAmount, costBasis: trancheAmount }] : [],
            healthBucketCashAmount: 10000 - trancheAmount,
            healthBucketCashOwners: [{ profileId: 'a', amount: (10000 - trancheAmount) * .75 },
                { profileId: 'b', amount: (10000 - trancheAmount) * .25 }] };
        const result = applyHealthBucketCoverage({ portfolio, forcedShortfall: 2000,
            householdContext: { care: { p1: { active: true, grade: 4 } } } });
        close(result.used, 2000); close(portfolio.healthBucketCashAmount, 8000);
        applyHealthBucketInterest({ portfolio, rC: .1 });
        close(portfolio.healthBucketGeldmarkt, 8800);
        close(portfolio.healthBucketCashAmount, 8800);
        close(portfolio.healthBucketCashOwners.reduce((sum, row) => sum + row.amount, 0), 8800);
    }
}
if (selected(2)) {
    for (const grade of [3, 4]) {
        const input = cashInputs();
        Object.assign(input, { startFloorBedarf: 12000, startFlexBedarf: 12000, renteMonatlich: 1000,
            careToday: { grade, form: 'home-support', progression: 'usual' } });
        const care = makeDefaultCareMeta(false, 'm', input.careToday, input.startAlter, input);
        A.equal(care.flexFactor, 1);
        priceCareMeta(care, input, initMcRunState(input), 0);
        A.equal(care.flexFactor, 1);
        const result = annual(input);
        A.equal(result.kind, 'success'); close(result.logData.entscheidung.jahresEntnahme, 12000);
        const mc = await chunk(input);
        A.equal(mc.technicalInventory.technicalError, 0);
        close(mc.runMeta[0].logDataRows[0].pflege_flex_faktor, 1);
    }
    const input = cashInputs(); input.careToday = { grade: 3, progression: 'usual' };
    input.pflegeGradeConfigs[3].flexCut = .5; input.pflegeGradeConfigs[4].flexCut = .25;
    const care = makeDefaultCareMeta(true, 'm', input.careToday, input.startAlter, input);
    updateCareMeta(care, input, input.startAlter, year, () => 1, initMcRunState(input), 0);
    updateCareMeta(care, input, input.startAlter + 1, year, () => 0, initMcRunState(input), 1);
    A.equal(care.grade, 4); close(care.flexFactor, .5);
    input.pflegeGradeConfigs[3].flexCut = 0;
    priceCareMeta(care, input, initMcRunState(input), 1); A.equal(care.flexFactor, 1);
}
if (selected(3)) {
    for (const survivor of [1, 2]) for (const months of [1, 3, 6, 12]) for (const deathThisYear of [false, true]) {
        const inputs = { startAlter: 65, renteStartOffsetJahre: 0, renteStartMonate: survivor === 1 ? months : 12,
            renteMonatlich: survivor === 1 ? 2000 : 22000 / 12,
            partner: { aktiv: true, startInJahren: 0, renteStartMonate: survivor === 2 ? months : 12,
                brutto: survivor === 2 ? 24000 : 22000 } };
        const result = calculateHouseholdPensionForYear({ inputs, yearIndex: 0, deathThisYear,
            p1Alive: survivor === 1, p2Alive: survivor === 2,
            currentAnnualPension: survivor === 1 ? 24000 : 22000,
            currentAnnualPension2: survivor === 2 ? 24000 : 22000,
            widowPensionP1: 13200, widowPensionP2: 13200,
            widowBenefits: { p1FromP2: survivor === 1, p2FromP1: survivor === 2, p1FromP2Percent: .6, p2FromP1Percent: .6 } });
        const offset = survivorIncomeOffset(2000) * Math.min(months, deathThisYear ? 3 : 12);
        close(result[`rente${survivor}BruttoEigen`], months * 2000);
        close(result[`widowIncomeOffsetP${survivor}`], offset);
        close(result[`widowBenefitP${survivor}ThisYear`], 13200 * (deathThisYear ? .25 : 1) - offset);
    }
}
if (selected(4)) {
    const input = cashInputs(true);
    input.partnership = { status: 'unmarried' }; input.startFloorBedarf = 10000; input.renteMonatlich = 1000;
    const backtest = annual(input), montecarlo = annual(input, both);
    for (const result of [backtest, montecarlo]) {
        A.equal(result.kind, 'success');
        const assets = personalAssetValues(result.newState.portfolio);
        close(assets[0].value, 79500); close(assets[1].value, 22500);
        close(result.logData.portfolio_flow_delta, 0);
    }
    A.deepEqual(backtest.newState.portfolio.personAccounts, montecarlo.newState.portfolio.personAccounts);
}
if (selected(5)) {
    for (const partnerCare of [false, true]) {
        const input = cashInputs(partnerCare), care = { grade: 2, form: 'family' };
        if (partnerCare) input.partner.careToday = care; else input.careToday = care;
        for (const kind of ['backtest', 'montecarlo']) {
            const heads = createRunAssumptions(), before = effectiveRunAssumptions(kind, input);
            heads.observe(kind, before); const token = heads.begin(kind, before); heads.complete(kind, token, 'fertig');
            heads.observe(kind, effectiveRunAssumptions(kind, { ...input, pflegeKostenStaffelPreset: 'amtlich' }));
            A.equal(heads.read(kind).stale, true); A.equal(heads.read(kind).needsRun, true);
        }
        const inactive = cashInputs();
        inactive.partner = { aktiv: false, careToday: care };
        A.deepEqual(effectiveRunAssumptions('backtest', inactive),
            effectiveRunAssumptions('backtest', { ...inactive, pflegeKostenStaffelPreset: 'amtlich' }));
    }
}
if (selected(6)) {
    const input = cashInputs(false, 10000);
    Object.assign(input, { startFloorBedarf: 20000, careToday: { grade: 4, form: 'residential' },
        healthBucket: { enabled: true, initialAmount: 10000, assetSource: 'cash', triggerMinGrade: 4,
            coverageMode: 'floor_when_care_active' } });
    const result = annual(input);
    A.equal(result.kind, 'ruin'); A.equal(result.newState.portfolio.healthBucketGeldmarkt, 0);
    A.equal(result.logData.health_bucket_used, 10000); A.equal(result.logData.health_bucket_end, 0);
    const mc = await chunk(input);
    A.equal(mc.technicalInventory.technicalError, 0); A.equal(mc.totals.failCount, 1);
    for (const field of ['healthBucketEnabledCount', 'healthBucketUsedCount', 'healthBucketDepletedCount']) A.equal(mc.totals[field], 1);
    A.equal(mc.totals.totalHealthBucketUsed, 10000);
    A.equal(mc.runMeta[0].logDataRows[0].health_bucket_used, 10000);
}
if (selected(7)) {
    const input = cashInputs();
    Object.assign(input, { renteMonatlich: 1000, startFloorBedarf: 12000,
        careToday: { grade: 2, form: 'family' }, simulationPeople: [{ profileId: 'a' }] });
    const entries = [{ profileId: 'a', name: 'Max', data: { profile_rente_monatlich: '1000' } }];
    const view = buildPlanOverview({ inputs: input, entries, referenceYear: 2026, inflationPct: 2, wagePct: 0 });
    A.deepEqual(view.groups.map(group => group.label), ['Max · Rente', 'Max · Pflegegeld']);
    close(view.rows[0].incomes.reduce((a, b) => a + b, 0), 16164); close(view.rows[0].result, 4164);
    close(view.rows[1].incomes[1], 4164 * 1.02);
    close(projectPlanMonthlyFlow(view.rows[0]).euros.saving, 347);
    for (const preset of ['custom', 'amtlich']) for (const form of ['family', 'home-support', 'residential']) {
        input.pflegeKostenStaffelPreset = preset; input.careToday.form = form;
        const careValues = structuredClone((await import('../app/shared/household-care-values.js')).DEFAULT_CARE_VALUES);
        careValues.allowance.values[2] = 400; input.careValues = careValues;
        const plan = buildPlanOverview({ inputs: input, entries, referenceYear: 2026, inflationPct: 0, wagePct: 0 });
        close(plan.rows[0].result, preset === 'custom' && form === 'family' ? 4800 : 0);
    }
    const pair = cashInputs(true);
    pair.partner.careToday = { grade: 2, form: 'family' };
    const pairEntries = [...pair.simulationPeople].reverse().map(person => ({ profileId: person.profileId,
        name: person.profileId, data: { sim_pflegeKostenStaffelPreset: 'amtlich' } }));
    const plan = buildPlanOverview({ inputs: pair, entries: pairEntries, referenceYear: 2026, inflationPct: 0, wagePct: 0 });
    A.equal(plan.groups[0].personId, pair.simulationPeople[1].profileId);
    close(plan.rows[0].result, 4164);
}
if (selected(8)) {
    const input = cashInputs(false, 10000);
    input.healthBucket = { enabled: true, initialAmount: 10000, assetSource: 'cash', returnMode: 'cash_return' };
    for (const accumulation of [false, true]) {
        const current = accumulation ? { ...input, accumulationPhase: { enabled: true, sparrate: 0 }, transitionYear: 1 } : input;
        const result = annual(current, null, initMcRunState(current), 0, { ...year, zinssatz: -.5 });
        A.equal(result.kind, 'success'); close(result.logData.health_bucket_end, 9950);
        close(result.logData.health_bucket_interest, -50);
    }
    const inheritanceRuin = cashInputs(true, 10000), deceased = inheritanceRuin.simulationPeople[0].profileId;
    Object.assign(inheritanceRuin, { healthBucket: input.healthBucket,
        accumulationPhase: { enabled: true, sparrate: 0 }, transitionYear: 1,
        partnership: { status: 'unmarried', inheritance: { [deceased]: 100 }, testament: { [deceased]: { home: 'residence' } } },
        homeReferenceYear: 2026,
        home: [{ id: 'haus', profileId: deceased, wert: 1000000, nutzung: 'selbst', stand: '2026-01' }] });
    const ruined = annual(inheritanceRuin, { p1Alive: false, p2Alive: true }, initMcRunState(inheritanceRuin), 0, { ...year, zinssatz: -.5 });
    A.equal(ruined.kind, 'ruin'); close(ruined.logData.health_bucket_interest, -50);
    const metrics = createMonteCarloRunMetrics(1);
    for (const interest of [-50, 0, 50]) recordMonteCarloRunOutcome(metrics, { i: 0, runIdx: 0,
        buffers: createMonteCarloBuffers(1), simState: initMcRunState(input), lebensdauer: 1,
        jahreOhneFlex: 0, healthBucketEnabledThisRun: true, healthBucketInterestThisRun: interest });
    A.deepEqual(metrics.healthBucketInterestAmounts, [-50, 0, 50]);
}
if (selected('W')) {
    setAppTestDate('2026-10-23');
    const partnership = { schemaVersion: 1, status: 'unmarried', inheritance: { a: 0 }, testament: { a: { home: 'residence' } } };
    P.resetPersistenceForTests({ async loadAll() { return { [PARTNERSHIP_KEY]: JSON.stringify(partnership) }; }, async saveBatch() {} });
    await P.init({ skipMigration: true, installLifecycleHooks: false, installTauriCloseHook: false });
    for (const [birth, expectedAge] of [['1965-03-15', 61], ['1965-12-15', 60], ['', 60]]) {
        const nodes = Object.fromEntries(['managerPartnership', 'managerInheritance', 'managerPartnershipMarried', 'managerPartnershipSummary', 'managerPartnershipStatus']
            .map(id => [id, { innerHTML: '', querySelectorAll: () => [] }]));
        const doc = { getElementById: id => nodes[id], querySelectorAll: () => [] };
        renderManagerPartnership(doc, { profiles: ['a', 'b'].map((id, index) => ({ id, name: id, valid: true,
            belongs: true, assets: 600000, values: { alter: 60, geburtsdatum: birth, geschlecht: 'w', tagesgeld: 600000,
                immobilien: index ? [] : [{ nutzung: 'selbst', wert: 600000, ortsueblicheMiete: 1000 }] } })) });
        const money = (12000 * lifetimeUseMultiplier(expectedAge, 'w')).toLocaleString('de-DE', { maximumFractionDigits: 0 }) + '\u00a0€';
        A.ok(nodes.managerInheritance.innerHTML.includes(`Kapitalwert Wohnrecht ${money}`), `Vorschau ${birth}: ${money}`);
    }
    await measurementInputs(0, 'martin-petra', '2026-10-23', 'testament');
    const raw = JSON.parse(P.getItemSync(PARTNERSHIP_KEY)); raw.testament.muster_martin.home = 'residence';
    P.setItemSync(PARTNERSHIP_KEY, JSON.stringify(raw));
    const transported = getCommonInputs();
    A.equal(transported.residenceReferenceYear, 2026);
    for (const person of transported.simulationPeople) A.equal(person.geburtsdatum,
        readDocumentPersonInputs().entries.find(entry => entry.profileId === person.profileId).data.profile_geburtsdatum);
    for (const index of [0, 2]) for (const survivor of [0, 1]) for (const [birth, age] of [['1965-03-15', 61], ['1965-07-01', 61], ['1965-07-02', 60], ['', 60]]) {
        const input = cashInputs(true, 2000000), dead = 1 - survivor;
        const deadId = input.simulationPeople[dead].profileId;
        input.simulationPeople[survivor].geburtsdatum = birth;
        input.startAlter = 60; input.partner.startAlter = 60;
        input.geschlecht = 'w'; input.partner.geschlecht = 'w'; input.residenceReferenceYear = 2026;
        input.partnership = { status: 'unmarried', inheritance: { [deadId]: 0 }, testament: { [deadId]: { home: 'residence' } } };
        input.home = [{ id: 'haus', profileId: deadId, nutzung: 'selbst', wert: 600000, ortsueblicheMiete: 1000, stand: '2026-01' }];
        const state = initMcRunState(input);
        const household = { p1Alive: survivor === 0, p2Alive: survivor === 1 };
        const result = annual(input, household, state, index, { ...year, jahr: 1994 });
        A.equal(result.kind, 'success');
        close(result.logData.inheritance.residenceCapital, 12000 * lifetimeUseMultiplier(age + index, 'w'));
        delete input.partnership.testament;
        const withoutRight = annual(input, household, initMcRunState(input), index);
        input.simulationPeople[survivor].geburtsdatum = '1970-12-15';
        A.deepEqual(annual(input, household, initMcRunState(input), index), withoutRight);
    }
    P.resetPersistenceForTests(); setAppTestDate(null);
}
console.log(`QS-B ${process.env.QSB_CASE || '1–8 und W'}: Gegenproben bestanden.`);
