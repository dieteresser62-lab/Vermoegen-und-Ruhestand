import { measurementInputs, hash } from './helpers/ek-1b-measurement.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { EngineAPI } from '../engine/index.mjs';
import { inheritancePreview, inheritanceTax, testamentEstate, readPartnership, hasTestament, inheritsHomeAndTax, PARTNERSHIP_KEY } from '../app/profile/household-partnership.js';
import { lifetimeUseMultiplier } from '../app/shared/life-expectancy.js';
import { bindManagerPartnership, renderManagerPartnership } from '../app/tranches/tranchen-manager-partnership.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { managerHistoryLegend } from '../app/tranches/tranchen-history-closures.js';
import { withPropertyHistory } from '../app/shared/wealth-display.js';
import { runHistoricalBacktest } from '../app/simulator/historical-backtest-runner.js';
import { createHistoricalBacktestContractProvider } from '../app/simulator/historical-backtest-contract.js';
import { initializePortfolio } from '../app/simulator/simulator-portfolio.js';
import { computeAdjPctForYear } from '../app/simulator/simulator-main-helpers.js';
import { resolveDynamicFlexRunnerHorizon } from '../app/simulator/dynamic-flex-runner-horizon.js';
import { portfolioTotal } from '../app/simulator/simulator-results.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';

const selected = name => !process.env.AR1_CASE || process.env.AR1_CASE === name;
const annual = { home: 'residence', residenceTax: 'annual' };
if (selected('tariff')) {
    for (const [assets, expected] of [[575100, 5300], [800100, 33050]]) {
        assertClose(testamentEstate(assets, 0, 0, 100, annual, { status: 'married' }).tax, expected, 1e-8,
            `AR-1 ohne Haus: jährliche Wahl bei ${assets} mit Härteausgleich`);
    }
    for (const [status, allowance, limits] of [['married', 500000, [75000, 300000, 600000, 6000000, 13000000, 26000000]],
        ['unmarried', 20000, [75000, 300000, 600000, 6000000, 13000000, 26000000]]]) {
        for (const limit of limits) for (const offset of [-100, 0, 100]) {
            const assets = allowance + limit + offset;
            const immediate = testamentEstate(assets, 0, 0, 100, { home: 'residence' }, { status });
            const yearly = testamentEstate(assets, 0, 0, 100, annual, { status });
            assertEqual(yearly.tax, immediate.tax, `AR-1 beide Wahlen exakt gleich: ${status}/${limit}/${offset}`);
            assert(!yearly.residenceTax, 'AR-1 ohne Wohnrechtswert kein Jahressteuerzustand');
        }
    }
    // Gesamterwerb in der Härtezone: 75.100 € steuerpflichtig, davon 24.000 € Wohnrecht.
    for (const [status, allowance, taxable] of [['married', 500000, 75100], ['unmarried', 20000, 6000100]]) {
        const capital = 24000, assets = allowance + taxable - capital;
        const result = testamentEstate(assets, 600000, 600000, 100, annual,
            { status, partnerAge: 70, residenceValue: capital / lifetimeUseMultiplier(70) });
        const expectedRate = inheritanceTax(allowance + taxable, { status }) / taxable;
        assertClose(result.residenceTax.rate, expectedRate, 1e-12, 'AR-1 festgehaltener Satz enthält Härteausgleich des Gesamterwerbs');
        assertClose(result.tax, (taxable - capital) * expectedRate, 1e-7, 'AR-1 Geldanteil verwendet denselben gemilderten Satz');
        assertClose(result.residenceTax.annualTax, result.residenceTax.annualValue * expectedRate, 1e-7, 'AR-1 Jahressteuer verwendet denselben gemilderten Satz');
    }
}
if (selected('bmf')) {
    // Amtliche Anlage 2026: Alter, Männer, Frauen; unabhängige Stichproben beider Seiten.
    for (const [age, male, female] of [[0, 18.402, 18.465], [30, 17.340, 17.629], [46, 15.640, 16.258],
        [60, 12.798, 13.832], [65, 11.444, 12.583], [70, 9.938, 11.107], [80, 6.509, 7.490], [90, 3.234, 3.770], [100, 1.680, 1.897]]) {
        assertEqual(lifetimeUseMultiplier(age, 'm'), male, `AR-1 amtlicher Männerfaktor mit ${age}`);
        assertEqual(lifetimeUseMultiplier(age, 'w'), female, `AR-1 amtlicher Frauenfaktor mit ${age}`);
        assertEqual(lifetimeUseMultiplier(age), female, 'AR-1 ohne Geschlecht vorsichtig Frauenwert');
    }
    assertEqual(lifetimeUseMultiplier(70.9, 'm'), 9.938, 'AR-1 vollendetes Alter');
    assertEqual(lifetimeUseMultiplier(110, 'w'), 1.897, 'AR-1 amtliche letzte Zeile gilt ab 100');
    for (const [gender, capital] of [['m', 238512], ['w', 266568]]) {
        const estate = testamentEstate(200000, 600000, 600000, 100, { home: 'residence' }, { partnerAge: 70, partnerGender: gender });
        assertClose(estate.residenceCapital, capital, 1e-8, 'AR-1 24.000 € Jahreswert, 70 Jahre');
    }
    const records = createMusterHaushaltRecords('2026-10-23', 'martin-petra', 'testament');
    const registry = JSON.parse(records.rs_profiles_v1);
    delete registry.profiles.muster_petra.data.profile_geschlecht;
    const profiles = Object.entries(registry.profiles).map(([profileId, person]) => ({ profileId, name: person.meta.name,
        inputs: buildSimulatorInputsFromProfileData(person.data, { referenceYear: 2026, planValues: null }) }));
    const personInputs = profiles.find(person => person.profileId === 'muster_petra').inputs;
    assertEqual(personInputs.geschlecht, 'm', 'AR-1 fehlendes Geschlecht verändert die bisherige Simulations-Sterbetafel nicht');
    assertEqual(combineSimulatorProfiles(profiles, 'muster_martin').combined.simulationPeople[1].residenceGenderUnknown,
        true, 'AR-1 fehlendes Geschlecht bleibt bis zur Wohnrechtsbewertung erkennbar');
}
if (selected('care')) {
    const base = await measurementInputs(0, 'martin-petra', '2026-10-23', 'testament');
    const year = { jahr: 2000, inflation: 2, rendite: 0, gold_eur_perf: 0, zinssatz: 0 };
    for (const survivorIndex of [0, 1]) for (const grade of [1, 3, 5]) for (const residenceTax of ['immediate', 'annual']) for (const saving of [false, true]) {
        const inputs = structuredClone(base), deadIndex = 1 - survivorIndex;
        const deadId = inputs.simulationPeople[deadIndex].profileId;
        inputs.home = [{ id: 'test-house', profileId: deadId, nutzung: 'selbst', wert: 600000, stand: '2026-10' }];
        inputs.partnership.testament = { [deadId]: { minimum: 200000, minimumStand: '2026-10', home: 'residence', residenceTax } };
        inputs.partnership.inheritance[deadId] = 0;
        (survivorIndex ? inputs.partner : inputs).careToday = { grade, form: 'residential', progression: 'usual' };
        if (saving) { inputs.accumulationPhase = { enabled: true, sparrate: 1000 }; inputs.transitionYear = 5; }
        const household = { p1Alive: survivorIndex === 0, p2Alive: survivorIndex === 1,
            care: { [survivorIndex === 0 ? 'p1' : 'p2']: { active: true, grade } } };
        const state = initMcRunState(inputs);
        const result = simulateOneYear(state, inputs, year, 0, null, 0, household, 1, EngineAPI);
        assertEqual(result.kind, 'success', 'AR-1 Nachlass bei heutiger Heimpflege wird gerechnet');
        assertEqual(result.logData.inheritance.residenceCapital, 0, 'AR-1 Heimpflege verhindert Kapitalwert vor der Besteuerung');
        assertClose(result.logData.inheritance.tax, inheritanceTax(result.logData.inheritance.inherited), 1e-7, 'AR-1 nur Geldanteil wird besteuert');
        assertEqual(result.logData.inheritance.inheritedHome, 0, 'AR-1 Haus geht weiter an andere Erben');
        assert(!result.newState.portfolio.residenceTax, 'AR-1 kein Jahressteuerzustand bei fehlendem Recht');
        assert(Object.values(result.newState.portfolio.homeInheritance).every(home => !home.residenceActive), 'AR-1 kein aktives Recht im Nachlass');
        assert(!state.portfolio.homeInheritance, 'AR-1 Vorgängerzustand bleibt unverändert');
        const next = simulateOneYear(result.newState, inputs, year, 1, null, 0, household, 1, EngineAPI);
        assertEqual(next.logData.wohnrechtsteuer, undefined, 'AR-1 auch im Folgejahr keine Steuer auf das beendete Recht');
    }
    for (const survivorIndex of [0, 1]) for (const gender of ['m', 'w', undefined, 'assumed']) {
        const inputs = structuredClone(base), deadId = inputs.simulationPeople[1 - survivorIndex].profileId;
        inputs.home = [{ id: 'factor-house', profileId: deadId, nutzung: 'selbst', wert: 600000, stand: '2026-10' }];
        inputs.partnership.testament = { [deadId]: { home: 'residence' } };
        const person = survivorIndex === 0 ? inputs : inputs.partner;
        inputs.simulationPeople[survivorIndex].geburtsdatum = '1960-12-15';
        person.startAlter = 65; person.geschlecht = gender === 'assumed' ? 'm' : gender;
        if (gender === 'assumed') inputs.simulationPeople[survivorIndex].residenceGenderUnknown = true;
        const result = simulateOneYear(initMcRunState(inputs), inputs, year, 5, null, 0,
            { p1Alive: survivorIndex === 0, p2Alive: survivorIndex === 1 }, 1, EngineAPI);
        assertClose(result.logData.inheritance.residenceCapital, 24480 * lifetimeUseMultiplier(70, gender), 1e-7,
            'AR-1 Simulator übergibt Geschlecht und Alter im Todesjahr für beide Personen');
    }
    // Der historische Runner zieht selbst keinen Tod. Sein Jahreseinstieg erhält hier ein festes synthetisches Ereignis.
    const historical = structuredClone(base);
    historical.partner.careToday = { grade: 3, form: 'residential', progression: 'usual' };
    historical.partnership.testament.muster_martin.residenceTax = 'annual';
    const historicalResult = runHistoricalBacktest({ inputs: historical, period: { startYear: 2000, endYear: 2002 },
        historicalDataProvider: createHistoricalBacktestContractProvider(), initializePortfolio,
        simulateYear: (state, inputs, data, index) => simulateOneYear(state, inputs, data, index, null, 0,
            { p1Alive: false, p2Alive: true, care: { p2: { active: true, grade: 3 } } }, 1, EngineAPI),
        computeAdjustmentPct: computeAdjPctForYear, resolveHorizon: resolveDynamicFlexRunnerHorizon, totalPortfolio: portfolioTotal });
    assertEqual(historicalResult.outcome.kind, 'completed', 'AR-1 historischer Runner verarbeitet das Todesereignis');
    assertEqual(historicalResult.rows[0].row.inheritance.residenceCapital, 0, 'AR-1 Nachlass auch im historischen Runner ohne Wohnrecht bei Heimpflege');
    assert(historicalResult.rows.every(({ row }) => !row.wohnrechtsteuer), 'AR-1 historischer Runner erhebt keine Jahressteuer');
}
if (selected('checkbox')) {
    const inputs = await measurementInputs(0, 'martin-petra', '2026-10-23', 'testament');
    inputs.partnership.homeAndTaxInheritance = { muster_martin: true };
    inputs.partnership.activeInheritanceRule = { muster_martin: 'home-and-tax' };
    const legacy = structuredClone(inputs); delete legacy.partnership.testament;
    const year = { jahr: 2000, inflation: 2, rendite: 0, gold_eur_perf: 0, zinssatz: 0 };
    const simulate = (current, state, index, household) => simulateOneYear(state, current, year, index, null, 0, household, 1, EngineAPI);
    const alive = { p1Alive: false, p2Alive: true };
    const death = simulate(inputs, initMcRunState(inputs), 0, alive), oldDeath = simulate(legacy, initMcRunState(legacy), 0, alive);
    assertEqual(hash(death), hash(oldDeath), 'AR-1 Häkchen: echte Nachlassrechnung mit gespeicherten Feldern bytegleich');
    const residential = { ...alive, care: { p2: { active: true, grade: 5 } } };
    const next = simulate(inputs, death.newState, 1, residential), oldNext = simulate(legacy, oldDeath.newState, 1, residential);
    assertEqual(hash(next), hash(oldNext), 'AR-1 Häkchen: Heimverkauf trotz gespeicherter inaktiver Wohnrechtsregel bytegleich');
}
if (selected('editor')) {
    const rule = { minimum: 200000, minimumStand: '2026-10', maximumPercent: 50, home: 'residence', residenceTax: 'annual' };
    const initial = { schemaVersion: 1, status: 'unmarried', inheritance: { a: 33 }, testament: { a: rule } };
    const records = { [PARTNERSHIP_KEY]: JSON.stringify(initial) };
    P.resetPersistenceForTests({ async loadAll() { return records; }, async saveBatch({ upserts, deletes }) {
        for (const key of deletes) delete records[key]; for (const [key, value] of upserts) records[key] = value;
    } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const nodes = Object.fromEntries(['managerPartnership', 'managerPartnershipStatus', 'managerPartnershipRetry', 'managerInheritance', 'managerPartnershipMarried',
        'managerPartnershipToggle', 'managerPartnershipBody', 'managerPartnershipSummary', 'managerPartnershipAction'].map(id => [id,
        { textContent: '', innerHTML: '', listeners: {}, setAttribute() {}, addEventListener(type, fn) { this.listeners[type] = fn; }, querySelectorAll() { return []; } }]));
    const doc = { getElementById: id => nodes[id] || null, querySelectorAll() { return []; }, addEventListener() {} };
    const projection = { profiles: ['a', 'b'].map((id, index) => ({ id, name: id, valid: true, belongs: true, assets: 600000,
        values: { alter: 70, geschlecht: index ? 'm' : 'w', careToday: { grade: 0 }, immobilien: index ? [] : [{ nutzung: 'selbst', wert: 600000 }] } })) };
    renderManagerPartnership(doc, projection);
    const editor = bindManagerPartnership(doc, { runOperation: execute => execute({ check() {}, commit() {} }) });
    for (const checked of [true, false]) {
        const checkbox = { checked, dataset: { inheritanceHome: 'a' } };
        nodes.managerPartnership.listeners.change({ target: { closest: selector => selector === '[data-inheritance-home]' ? checkbox : null } });
        assert(await editor.flush(), 'AR-1 echter Häkchen-Handler speichert erfolgreich');
        const saved = readPartnership(records[PARTNERSHIP_KEY]);
        assertEqual(JSON.stringify(saved.testament?.a), JSON.stringify(rule), 'AR-1 Häkchen erhält alle gespeicherten Testamentangaben');
        assertEqual(hasTestament(saved, 'a'), !checked, 'AR-1 Häkchen wechselt nur die aktive Regel');
        assertEqual(inheritsHomeAndTax(saved, 'a'), checked, 'AR-1 Immobilien und Steuergeld haben bei Häkchen Vorrang');
        if (checked) assert(nodes.managerInheritance.innerHTML.includes('data-testament-person="a" disabled'), 'AR-1 gespeicherte Felder gesperrt');
        if (checked) {
            const opts = { homeAndTax: true, cash: 600000 };
            assertEqual(JSON.stringify(inheritancePreview(600000, 600000, 33, opts)),
                JSON.stringify(inheritancePreview(600000, 600000, 33, { ...opts, homeAndTax: inheritsHomeAndTax(saved, 'a'),
                    ...(hasTestament(saved, 'a') ? { testament: saved.testament.a } : {}) })), 'AR-1 aktive Häkchenrechnung bytegleich');
        }
    }
    assert(nodes.managerInheritance.innerHTML.includes('Kapitalwert Wohnrecht 238.512'), 'AR-1 Vorschau verwendet den Männerfaktor aus den Personendaten');
    for (const status of ['married', 'unmarried']) {
        nodes.managerPartnership.listeners.click({ target: { closest: selector => selector === '[data-partnership]' ? { dataset: { partnership: status } } : null } });
        assert(await editor.flush(), 'AR-1 Partnerschaftswechsel speichert');
        assertEqual(JSON.stringify(readPartnership(records[PARTNERSHIP_KEY]).testament.a), JSON.stringify(rule), 'AR-1 Partnerschaftswechsel erhält Testament');
    }
    const { readTestamentFields } = await import('../app/tranches/tranchen-manager-testament.js');
    const fields = { minimum: { value: '200.000' }, minimumStand: { value: '10/2026' }, maximumPercent: { value: '50' }, home: { value: 'life-estate' } };
    const section = { querySelector: selector => fields[/data-testament="(\w+)"/.exec(selector)[1]] || null };
    const life = readTestamentFields(section, rule);
    assertEqual(life.residenceTax, 'annual', 'AR-1 Immobilienregelwechsel erhält die inaktive Steuerwahl');
    fields.home.value = 'money';
    const money = readTestamentFields(section, rule);
    assertEqual(readPartnership({ ...initial, testament: { a: { residenceTax: money.residenceTax } } }).testament.a.residenceTax,
        'annual', 'AR-1 inaktive Steuerwahl bleibt auch ohne weitere Testamentfelder gespeichert');
    projection.profiles[1].values.genderAssumed = true;
    renderManagerPartnership(doc, projection);
    assert(nodes.managerInheritance.innerHTML.includes('Kapitalwert Wohnrecht 266.568'), 'AR-1 Vorschau verwendet bei angenommenem Geschlecht vorsichtig Frauenwerte');
    projection.profiles[1].values.careToday = { grade: 1, form: 'residential' };
    renderManagerPartnership(doc, projection);
    assert(!nodes.managerInheritance.innerHTML.includes('Kapitalwert Wohnrecht 0') && nodes.managerInheritance.innerHTML.includes('erhält bei heutiger Heimpflege kein Wohnrecht'), 'QS-C: Heimpflege erklärt das fehlende Wohnrecht ohne Null-Kapitalwert');
    assert(nodes.managerInheritance.innerHTML.includes('Heimpflege'), 'AR-1 Erbvorschau erläutert das fehlende Recht im Info');
}
if (selected('history')) {
    const history = withPropertyHistory({ points: [{ day: 1, total: 100, allocation: { cash: 100 } }, { day: 2, total: 200, allocation: { cash: 200 } }], types: [], events: [], gaps: [] },
        [{ values: { immobilien: [{ wert: 600000, nutzung: 'selbst' }] } }]);
    assertEqual(history.points[0].totalWithHomes, 600100, 'AR-1 bestätigt heutigen Immobilienwert in allen historischen Punkten');
    assert(managerHistoryLegend(history).includes('Geldvermögen mit heutigem Immobilienwert'), 'AR-1 Legende nennt die zeitliche Vereinfachung');
}
