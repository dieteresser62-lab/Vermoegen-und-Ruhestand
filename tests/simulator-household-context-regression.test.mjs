import { runBacktest, runBacktestWithRuntimeProvenance, whenBacktestIdle, initializeBacktestUI, exportBacktestLogData } from '../app/simulator/simulator-backtest.js';
import { EngineAPI } from '../engine/index.mjs';
import { createHistoricalBacktestDownload } from '../app/simulator/historical-backtest-export.js';
import { createSelectionDocument, addField } from './designsystem-selection-dom.mjs';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { initSimulatorProfileSelection } from '../app/simulator/simulator-main-profiles.js';
import { initializeResultOverview, enableOverviewRevisions, readOverviewAssumptions, beginOverviewRun, completeOverviewRun } from '../app/simulator/simulator-result-overview.js';
import { simulatorRunAssumptions as heads } from '../app/simulator/simulator-run-assumptions.js';
import { personDataContextFor } from '../app/simulator/simulator-person-overrides.js';
import { getCommonInputs } from '../app/simulator/simulator-portfolio.js';
import { readHouseholdPersonStatus } from '../app/shared/person-data-status.js';
import { HOUSEHOLD_PLAN_KEY, PLAN_DEFAULTS, SIMULATOR_PLAN_FIELD_MAP, planScope, buildPlanRecord } from '../app/profile/household-plan.js';
import { getSimulatorPlanTrial, renderSimulatorPlanTrial, initSimulatorPlanTrial } from '../app/simulator/simulator-plan-trial.js';
import { initInputPersistence } from '../app/simulator/simulator-main-input-persist.js';
import { initDynamicFlexControls } from '../app/simulator/simulator-main-dynamic-flex.js';

const previous = { window: globalThis.window, document: globalThis.document };
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
try {
    const data = { profile_person_schema_version: '1', profile_geburtsdatum: '1958-03-14', profile_rente_monatlich: '1000', profile_tagesgeld: '100000', depot_tranchen: '[]' };
    const profiles = Object.fromEntries(['a', 'b', 'c'].map(id => [id, { meta: { id, name: 'Muster ' + id, belongsToHousehold: id === 'a' }, data: { ...data } }]));
    let backend = { rs_profiles_v1: JSON.stringify({ version: 1, profiles }), rs_current_profile: 'a', rs_active_profile: 'a' };
    PersistenceFacade.resetPersistenceForTests({ name: 'Haushaltsregression', async init() {}, async loadAll() { return { ...backend }; },
        async saveBatch({ upserts, deletes }) { deletes.forEach(k => delete backend[k]); upserts.forEach(([k,v]) => backend[k] = v); } });
    await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const doc = createSelectionDocument(); const listeners = new Map();
    doc.addEventListener = (type, fn) => { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); };
    doc.removeEventListener = (type, fn) => listeners.set(type, (listeners.get(type) || []).filter(f => f !== fn));
    doc.dispatchEvent = event => { for (const fn of listeners.get(event.type) || []) fn(event); };
    doc.querySelector = selector => doc.body.querySelector(selector);
    for (const id of ['displayPortfolioBreakdown', 'simProfileList', 'simProfileStatus', 'suiteHouseholdContext', 'p1StartAlter', 'r2StartAlter', 'p1Geschlecht', 'r2Geschlecht',
        'chkPartnerAktiv', 'simStartVermoegen', 'depotwertAlt', 'einstandAlt', 'btButton', 'mcButton', 'startFloorBedarf', 'startFlexBedarf', 'minimumFlexAnnual', 'tagesgeld', 'geldmarktEtf', 'simStartJahr', 'simEndJahr']) addField(doc, id);
    doc.getElementById('simStartJahr').value = '2000'; doc.getElementById('simEndJahr').value = '2025';
    // Ohne aktive Ergebniskarte: echter Hauptreiter "Annahmen".
    const tab = doc.body.appendChild(doc.createElement('section')); tab.id = 'tab-ergebnis';
    const overview = doc.body.appendChild(doc.createElement('section')); overview.id = 'overviewBacktest';
    overview.querySelector = () => null;
    globalThis.document = doc; globalThis.window = { addEventListener() {}, removeEventListener() {} };
    let planGate = null, planEntered = false;
    const refreshSelection = initSimulatorProfileSelection({ initializePlanPage: async () => {
        planEntered = true; if (planGate) await planGate; return { status: 'deferred' };
    } });
    assertEqual(window.__profileRecoveryBlocker, null, 'Auswahlstart ohne Recovery: ' + doc.getElementById('simProfileStatus').textContent);
    const initial = readOverviewAssumptions('backtest');
    const result = { outcome: { kind: 'completed' }, request: initial.settings, rows: [], metrics: { values: {} } };
    const first = beginOverviewRun('backtest', initial); completeOverviewRun('backtest', first, result);
    await tick();
    const runs = [];
    let realReplacement = null;
    initializeResultOverview({ activateTab() {}, rerunBacktest: async () => {
        await whenBacktestIdle();
        if (realReplacement) return realReplacement();
        const values = readOverviewAssumptions('backtest');
        runs.push(values);
        const token = beginOverviewRun('backtest', values);
        completeOverviewRun('backtest', token, result);
    } }, doc);
    enableOverviewRevisions();
    const list = doc.getElementById('simProfileList');
    list.querySelectorAll = selector => {
        const all = list.children.flatMap(row => row.children);
        if (selector.startsWith('input')) return all.filter(n => n.type === 'checkbox' && (!selector.includes(':checked') || n.checked));
        return all.filter(n => n.dataset.profileRoleId);
    };
    const checkbox = id => list.querySelectorAll('input').find(n => n.value === id);
    const change = (id, checked) => { const control = checkbox(id); control.checked = checked; return list.listeners.change[0]({ type: 'change', target: control }); };
    change('b', true);
    assert(heads.read('backtest').stale, 'Echter Checkboxhandler markiert alten Haushalt sofort veraltet');
    await tick();
    assertEqual(runs.length, 1, 'Genau ein automatischer Neulauf auch außerhalb des Ergebnisreiters');
    assertEqual(runs[0].personDataContext.persons.map(p => p.profileId).join(','), 'a,b', 'Neulauf bindet nur neue Profilidentitäten');
    assertEqual(personDataContextFor(getCommonInputs()).persons.map(p => p.profileId).join(','), 'a,b', 'Echte Recheneingaben tragen neuen Personenbeleg');
    change('b', true); await tick();
    assertEqual(runs.length, 1, 'Unwirksame Wiederholung erzeugt keinen zweiten Lauf');
    change('b', false); await tick();
    assertEqual(runs.length, 2, 'Entfernen erzeugt genau eine neue Revision');
    const old = heads.begin('backtest', readOverviewAssumptions('backtest'));
    const revision = heads.read('backtest').revision;
    change('c', true);
    assert(heads.read('backtest').revision > revision, 'Gleiche Personenwerte mit anderer Identität erzeugen Revision');
    completeOverviewRun('backtest', old, result);
    assert(heads.read('backtest').phase !== 'completed', 'Altabschluss kann neuen Haushalt nicht abgeschlossen markieren');
    await tick();
    assertEqual(runs.length, 3, 'Kontextwechsel während Altabschluss startet genau einen Ersatz');
    const numericalInputs = inputs => ({ ...inputs, minimumFlexProfiles: inputs.minimumFlexProfiles.map(p => p.minimumFlexAnnual) });
    assertEqual(JSON.stringify(numericalInputs(runs[2].inputs)), JSON.stringify(numericalInputs(runs[0].inputs)), 'Identitätswechsel a,b -> a,c bei exakt gleichen Zahlen');
    assertEqual(runs[2].personDataContext.persons.map(p => p.profileId).join(','), 'a,c', 'Ausgeschiedene Person fehlt im neuen Ergebnis');
    assert(!heads.read('backtest').stale, 'Neues Ergebnis ist an aktuellen Haushalt gebunden');
    for (const stage of ['provenance', 'paint']) {
        let release, entered = false, runnerCalls = 0;
        const gate = new Promise(resolve => { release = resolve; });
        const oldRun = runBacktestWithRuntimeProvenance({ automatic: true,
            engineApi: { simulateSingleYear() {} },
            loadRuntimeBuildProvenance: async () => { if (stage === 'provenance') { entered = true; await gate; } return null; },
            beforeRun: async () => { if (stage === 'paint') { entered = true; await gate; } },
            runSinglePath: () => { runnerCalls++; throw new Error('Altpfad darf nicht rechnen'); } });
        await tick(); assert(entered, stage + ': echter vorbereitender Backtest hält an Sperre');
        const count = runs.length;
        change('c', stage === 'paint');
        await tick();
        assertEqual(runs.length, count, stage + ': neuer Lauf wartet auf tatsächlich offenen Altstart');
        release();
        assertEqual(await oldRun, null, stage + ': überholter Start beendet sich vor dem synchronen Runner');
        await tick();
        assertEqual(runnerCalls, 0, stage + ': Altstart veröffentlicht keine falschen neuen Personenresultate');
        assertEqual(runs.length, count + 1, stage + ': nach Altende genau ein Ersatz');
        assertEqual(heads.read('backtest').last.values.personDataContext.persons.map(p => p.profileId).join(','),
            stage === 'paint' ? 'a,c' : 'a', stage + ': nur aktuelle Auswahl abgeschlossen');
    }
    // Mehrere Änderungen vor Altende dürfen keinen Neulaufauftrag übrig lassen.
    {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const oldRun = runBacktestWithRuntimeProvenance({ automatic: true, loadRuntimeBuildProvenance: () => gate });
        await tick();
        const count = runs.length;
        change('c', false); await tick();
        change('b', true); await tick();
        release(); await oldRun; await tick();
        assertEqual(runs.length, count + 1, 'Mehrere Auswahlwechsel am offenen Altstart rechnen nur die neueste wirksame Auswahl');
        assertEqual(runs.at(-1).personDataContext.persons.map(p => p.profileId).join(','), 'a,b', 'Zusammengeführter Ersatz gehört zur aktuellen Auswahl');
        const field = doc.getElementById('startFlexBedarf'); field.value = '50';
        doc.dispatchEvent({ type: 'change', target: field }); await tick();
        assertEqual(runs.length, count + 1, 'Erledigter Haushaltsauftrag löst bei gewöhnlicher Änderung im inaktiven Ergebnisreiter keinen Zusatzlauf aus');
    }
    // Gezählt: echter Adapter + echter Auswahlhandler, mit offenem Ersatz und Altbelegen.
    {
        for (const id of [...Object.keys(SIMULATOR_PLAN_FIELD_MAP), 'dynamicFlexPreset', 'dynamicFlexShowAdvanced', 'simPlanTrialStart'])
            if (!doc.getElementById(id)) addField(doc, id);
        for (const id of ['dynamicFlex', 'goGoActive', 'dynamicFlexShowAdvanced']) doc.getElementById(id).type = 'checkbox';
        const confirmedScope = planScope('household', ['a', 'b']);
        PersistenceFacade.setItemSync(HOUSEHOLD_PLAN_KEY, buildPlanRecord(null, [{ scope: confirmedScope,
            values: { ...structuredClone(PLAN_DEFAULTS), dynamicFlex: true, goGoActive: false } }]).raw);
        initInputPersistence(); initDynamicFlexControls(); renderSimulatorPlanTrial(doc, { project: true });
        assert(getSimulatorPlanTrial(doc).read().confirmed && doc.getElementById('startFloorBedarf').disabled,
            'Echter Ergebnis-Ausgangslauf startet mit bestätigtem Plan und produktiver Formularsperre');
        for (const id of ['simulationSummary', 'simulationLog', 'simulationResults', 'portfolioCompositionChart',
            'backtestProtocolSummary', 'backtestResultPeriod', 'backtestStatus', 'backtestPeriodStatus', 'backtestDiagnosisCode',
            'backtestCohortSummary', 'backtestNotices', 'backtestNoticeList', 'exportBacktestJson', 'exportBacktestCsv',
            'toggle-backtest-detail', 'runBacktestCohorts', 'backtestCohortHorizon', 'overviewRunHeads', 'overviewCrises']) addField(doc, id);
        doc.createElementNS = (_ns, tag) => doc.createElement(tag);
        window.EngineAPI = EngineAPI;
        addField(doc, 'mcDauer', '30');
        doc.getElementById('simEndJahr').value = '2002';
        doc.getElementById('backtestCohortHorizon').value = '2';
        const provenance = { schemaVersion: 'RuntimeBuildProvenanceV1', sourceCommit: 'a'.repeat(40), sourceTreeStatus: 'clean', provider: 'synthetic_fixture' };
        let summaryGuard;
        const options = { engineApi: EngineAPI, focus: false,
            runtimeBuildProvenance: provenance, loadRuntimeBuildProvenance: async () => provenance,
            beginSimulationSummary: () => ({}), completeSimulationSummary: (_context, _result, _options, dependencies) => {
                summaryGuard = dependencies.isCurrent; return Promise.resolve(true);
            } };
        const oldResult = runBacktest({ ...options, cohortsEnabled: true });
        assertEqual(oldResult?.outcome.kind, 'completed', 'Echter Zweipersonenlauf ist fertig');
        assertEqual(window.globalBacktestData.personDataContext.persons.map(p => p.profileId).join(','), 'a,b', 'Echter Altbestand gehört zu zwei Profilen');
        assert(doc.getElementById('simulationSummary').innerHTML.includes('Vollständig') && doc.getElementById('simulationLog').innerHTML.includes('<table')
            && doc.getElementById('portfolioCompositionChart').children.length > 0 && !doc.getElementById('backtestCohortSummary').hidden,
        'Echter Altbestand besitzt Summary, Tabelle, Chart und Cohortbeleg');
        const oldSummaryGuard = summaryGuard;
        let release, replacementCalls = 0;
        const gate = new Promise(resolve => { release = resolve; });
        realReplacement = () => { replacementCalls++; return runBacktestWithRuntimeProvenance({ ...options, automatic: true, beforeRun: () => gate }); };
        const assertDiscarded = label => {
            assertEqual(window.globalBacktestData, null, label + ': kanonisches Altresultat ist verworfen');
            for (const id of ['simulationSummary', 'backtestProtocolSummary', 'backtestResultPeriod', 'backtestCohortSummary'])
                assertEqual(doc.getElementById(id).innerHTML, '', label + ': ' + id + ' ist leer');
            assert(!doc.getElementById('simulationLog').innerHTML.includes('<table'), label + ': keine alte Jahrestabelle');
            assertEqual(doc.getElementById('portfolioCompositionChart').children.length, 0, label + ': kein alter Chart');
            assert(doc.getElementById('exportBacktestJson').disabled && doc.getElementById('exportBacktestCsv').disabled, label + ': beide Exporte gesperrt');
            assert(doc.getElementById('backtestPeriodStatus').textContent !== 'Vollständig', label + ': kein alter Erfolgsstatus');
            assert(overview.innerHTML.includes('Veraltetes Ergebnis') && !overview.innerHTML.includes('Ja. Dein Plan'), label + ': Übersicht meldet keinen aktuellen Erfolg');
            assert(doc.getElementById('overviewRunHeads').innerHTML.includes('Veralteter Lauf')
                && doc.getElementById('overviewCrises').innerHTML.includes('Veraltete Krisenbelege'), label + ': Personen- und Krisenbelege sind veraltet');
            const chart = overview.children.find(node => node.id === 'overviewPortfolioChart');
            assert(chart?.getAttribute('aria-label').includes('Veralteter Lauf'), label + ': Übersichtschart ist veraltet');
        };
        let releasePlan;
        planGate = new Promise(resolve => { releasePlan = resolve; }); planEntered = false;
        const obsoleteToken = beginOverviewRun('backtest', readOverviewAssumptions('backtest'));
        const pendingSelection = change('b', false);
        assert(planEntered, 'Echter Checkboxwechsel hält im injizierten Planinitialisierer');
        assertDiscarded('Während offener Planinitialisierung');
        completeOverviewRun('backtest', obsoleteToken, oldResult);
        assert(heads.read('backtest').phase !== 'completed', 'Verspäteter Altabschluss bleibt bereits während Planwartepunkt unwirksam');
        await tick();
        assertEqual(replacementCalls, 0, 'Offene Planinitialisierung startet keinen Ersatz mit Teilinputs');
        assertDiscarded('Nach Microtasks am Planwartepunkt');
        releasePlan(); await pendingSelection; planGate = null;
        assertDiscarded('Unmittelbarer Haushaltswechsel');
        assert(!getSimulatorPlanTrial(doc).read().confirmed && !getSimulatorPlanTrial(doc).read().active,
            'Produktiver Haushaltswechsel ohne Zielplan verwirft alte Bestätigungsgrenze');
        for (const id of ['startFloorBedarf', 'startFlexBedarf', 'minimumFlexAnnual', 'dynamicFlexPreset'])
            assert(!doc.getElementById(id).disabled && doc.getElementById(id).dataset.planTrialReadonly === 'false',
                'Produktiver Refresh gibt den Altformularweg wieder frei: ' + id);
        assert(doc.getElementById('simPlanTrialStart').disabled && !getSimulatorPlanTrial(doc).start(), 'Zielbereich ohne Plan erlaubt keinen Versuch');
        assert(doc.getElementById('goGoMultiplier').disabled, 'Produktiver Refresh erhält fachliche Go-Go-Inaktivität');
        assertEqual(getCommonInputs().startFloorBedarf, Number(doc.getElementById('startFloorBedarf').value),
            'Neuer Haushaltsbereich ohne Plan ist mit dem echten Reader lesbar');
        assert(!oldSummaryGuard(), 'Verspätete Summary des alten Haushalts darf nicht gespeichert werden');
        await tick(); assertDiscarded('Offene Paintvorbereitung');
        let downloads = 0;
        const originalCreateUrl = URL.createObjectURL;
        URL.createObjectURL = () => { downloads++; throw new Error('Unerwarteter Download'); };
        try { exportBacktestLogData('json'); exportBacktestLogData('csv'); } finally { URL.createObjectURL = originalCreateUrl; }
        assertEqual(downloads, 0, 'Direkte JSON-/CSV-Aufrufe erzeugen keinen Download');
        initializeBacktestUI(); initializeBacktestUI();
        const detail = doc.getElementById('toggle-backtest-detail'); detail.checked = true; detail.dispatchEvent({ type: 'change' });
        assertDiscarded('Wiederinitialisierung und Detailwechsel');
        release(); await whenBacktestIdle(); await tick();
        assertEqual(replacementCalls, 1, 'Genau ein echter Ersatzlauf');
        const fresh = window.globalBacktestData;
        assertEqual(fresh.personDataContext.persons.map(p => p.profileId).join(','), 'a', 'Ersatzquelle trägt ausschließlich die aktuelle Profil-ID');
        assertEqual(doc.getElementById('backtestProtocolSummary').dataset.personProfileIds, 'a', 'Protokollbeleg trägt nur aktuelle Profil-ID');
        assert(doc.getElementById('overviewRunHeads').innerHTML.includes('data-person-profile-ids="a"')
            && !doc.getElementById('overviewRunHeads').innerHTML.includes('data-person-profile-ids="a,b"'), 'Übersichtslaufkopf ersetzt die Profil-IDs gemeinsam');
        const raw = JSON.parse(createHistoricalBacktestDownload(fresh.result, 'json', { personDataContext: fresh.personDataContext }).content);
        assertEqual(raw.personDataContext.persons.map(p => p.profileId).join(','), 'a', 'Kanonischer JSON-Export bindet ausschließlich aktuelle Personen');
        assert(fresh.result.rows === fresh.rows && doc.getElementById('simulationSummary').innerHTML.includes('Vollständig')
            && doc.getElementById('simulationLog').innerHTML.includes('<table') && doc.getElementById('portfolioCompositionChart').children.length > 0,
        'Neue Summary, Tabelle und Chart gehören zum veröffentlichten Ersatzresultat');
        assert(!doc.getElementById('exportBacktestJson').disabled && !doc.getElementById('exportBacktestCsv').disabled, 'Ersatz aktiviert beide Exporte');
        await change('b', false); await tick();
        assert(window.globalBacktestData === fresh && replacementCalls === 1, 'Unwirksame Wiederholung erhält echten Resultatbestand');
        const originalBirth = PersistenceFacade.getItemSync('profile_geburtsdatum');
        for (const blocker of ['person', 'recovery', 'isBlocked', 'technical', 'technical_result', 'paint_error']) {
            realReplacement = async () => {
                if (blocker === 'person') {
                    PersistenceFacade.setItemSync('profile_geburtsdatum', 'ungültiges synthetisches Datum');
                    assert(!readHouseholdPersonStatus().ready, 'Echte Personenunbereitschaft vor frühem Rückkehrpfad');
                    return; // Früher Rückkehrpfad wie in simulator-main.
                }
                if (blocker === 'recovery') window.__profileRecoveryBlocker = { reason: 'synthetisch' };
                return runBacktestWithRuntimeProvenance({ ...options, automatic: true, isBlocked: () => blocker === 'isBlocked',
                    ...(blocker === 'technical_result' ? { simulateYear: () => ({ kind: 'technical_error', error: { code: 'SYNTHETIC_ERROR', message: 'synthetisch' } }) } : {}),
                    ...(blocker === 'paint_error' ? { beforeRun: async () => { throw new Error('synthetischer Paintfehler'); } } : {}),
                    ...(blocker === 'technical' ? { runSinglePath: () => { throw new Error('synthetischer Runnerfehler'); } } : {}) });
            };
            await change('b', !checkbox('b').checked); await tick(); await whenBacktestIdle(); await tick();
            assertDiscarded(blocker);
            window.__profileRecoveryBlocker = null;
            if (originalBirth === null) PersistenceFacade.removeItemSync('profile_geburtsdatum');
            else PersistenceFacade.setItemSync('profile_geburtsdatum', originalBirth);
        }
        // Rückkehr zu denselben Werten darf einen verworfenen Altbestand nicht frisch machen.
        realReplacement = () => runBacktestWithRuntimeProvenance({ ...options, automatic: true });
        await change('b', true); await change('b', false);
        assertDiscarded('Auswahl hin und zurück');
        await tick(); await whenBacktestIdle(); await tick();
        assertEqual(window.globalBacktestData?.personDataContext.persons.map(p => p.profileId).join(','), 'a', 'Hin-/Rückwechsel rechnet neuesten Haushalt neu');
        for (const stage of ['provenance', 'paint']) {
            let finish, entered = false, obsoleteCalls = 0, replacements = 0;
            const preparation = new Promise(resolve => { finish = resolve; });
            realReplacement = () => { replacements++; return runBacktestWithRuntimeProvenance({ ...options, automatic: true }); };
            const oldStart = runBacktestWithRuntimeProvenance({ ...options, automatic: true,
                loadRuntimeBuildProvenance: async () => { if (stage === 'provenance') { entered = true; await preparation; } return provenance; },
                beforeRun: async () => { if (stage === 'paint') { entered = true; await preparation; } },
                runSinglePath: () => { obsoleteCalls++; throw new Error('Überholter Runner'); } });
            await tick(); assert(entered, stage + ': echter Altbestand bei offener Vorbereitung');
            await change('b', true); await tick();
            await change('b', false); await tick();
            assertDiscarded(stage + ': mehrere wirksame Änderungen');
            assertEqual(replacements, 0, stage + ': Ersatz wartet auf Altvorbereitung');
            finish(); assertEqual(await oldStart, null, stage + ': Altstart verworfen');
            await tick(); await whenBacktestIdle(); await tick();
            assertEqual(obsoleteCalls, 0, stage + ': überholter Runner rechnet nicht');
            assertEqual(replacements, 1, stage + ': genau ein Ersatz für neueste Auswahl');
            assertEqual(window.globalBacktestData?.personDataContext.persons.map(p => p.profileId).join(','), 'a', stage + ': Ersatz besitzt nur aktuelle IDs');
        }
        // Echte ungültige Personendaten liegen schon beim Mitgliedswechsel vor.
        const registryBefore = JSON.parse(PersistenceFacade.getItemSync('rs_profiles_v1'));
        const invalidRegistry = structuredClone(registryBefore);
        invalidRegistry.profiles.b.data.profile_geburtsdatum = 'ungültiges synthetisches Datum';
        PersistenceFacade.setItemSync('rs_profiles_v1', JSON.stringify(invalidRegistry));
        let invalidRuns = 0;
        realReplacement = () => { invalidRuns++; return runBacktestWithRuntimeProvenance({ ...options, automatic: true }); };
        await change('b', true);
        assert(!readHouseholdPersonStatus().ready, 'Neu gewähltes Mitglied hat echte ungültige Personendaten');
        assertDiscarded('Ungültige Personendaten beim Mitgliedswechsel');
        await tick();
        assertEqual(invalidRuns, 0, 'Unvollständige Inputübernahme startet keinen Ersatzlauf');
        const validRegistry = JSON.parse(PersistenceFacade.getItemSync('rs_profiles_v1'));
        validRegistry.profiles.b.data.profile_geburtsdatum = registryBefore.profiles.b.data.profile_geburtsdatum;
        PersistenceFacade.setItemSync('rs_profiles_v1', JSON.stringify(validRegistry));
        refreshSelection(); await tick(); await whenBacktestIdle(); await tick();
        assertEqual(invalidRuns, 1, 'Nach gültiger vollständiger Übernahme funktioniert der Ersatzlauf');
        const validResult = window.globalBacktestData;
        assertEqual(validResult.personDataContext.persons.map(p => p.profileId).join(','), 'a,b', 'Ersatzlauf nach Datenkorrektur gehört zum aktuellen Haushalt');
        PersistenceFacade.setItemSync(HOUSEHOLD_PLAN_KEY, buildPlanRecord(null, [{ scope:planScope('household',['a','b']),
            values:structuredClone(PLAN_DEFAULTS) }]).raw);
        renderSimulatorPlanTrial(doc, {project:true});
        initSimulatorPlanTrial({doc});
        const trial = getSimulatorPlanTrial(doc);
        assert(trial.start(), 'Gültiger Plan erlaubt echten Versuch vor Auswahlrückfrage');
        trial.update({flexBedarf:35000});
        for(const id of ['navigationGuardDialog','navigationGuardStay','navigationGuardLeave','navigationGuardTitle','navigationGuardDescription']) addField(doc,id);
        const decision = doc.getElementById('navigationGuardDialog'); let decisions=0;
        decision.showModal = () => { decisions++; decision.open=true; queueMicrotask(()=>doc.getElementById('navigationGuardStay').dispatchEvent({type:'click'})); };
        decision.close = () => {decision.open=false;};
        await change('b',false); await tick();
        assertEqual(decisions,1,'Echte Versuchsrückfrage wird mit Bleiben abgelehnt');
        assert(checkbox('b').checked && window.globalBacktestData===validResult,'Abgelehnte Versuchsrückfrage erhält Mitgliedschaft und Resultatquelle');
        trial.reset();
        PersistenceFacade.removeItemSync(HOUSEHOLD_PLAN_KEY);
        await change('c', true); await tick();
        assert(window.globalBacktestData === validResult, 'Abgewiesene dritte Person erhält den bisherigen Ergebnisbestand');
    }
} finally { Object.assign(globalThis, previous); PersistenceFacade.resetPersistenceRuntimeForTests(); }
