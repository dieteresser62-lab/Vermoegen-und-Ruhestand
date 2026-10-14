import { createPersonOverrides, initializePersonOverrides, readDocumentPersonInputs, resetPersonOverrides, SIMULATOR_PERSON_FIELD_IDS, personDataContextFor, bindPersonDataContext } from '../app/simulator/simulator-person-overrides.js';
import { readPensionInputs, readPartnerInputs } from '../app/simulator/simulator-input-pension.js';
import { getCommonInputs } from '../app/simulator/simulator-portfolio-inputs.js';
import { initRente2ConfigWithLocalStorage } from '../app/simulator/simulator-ui-rente.js';
import { initInputPersistence } from '../app/simulator/simulator-main-input-persist.js';
import { initRentAdjModeUI } from '../app/simulator/simulator-main-rent-adjust.js';
import { initPartnerToggle } from '../app/simulator/simulator-main-partner.js';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { PROFILE_STORAGE_KEYS } from '../app/profile/profile-state.js';
import { exportProfilesBundle } from '../app/profile/profile-bundle-io.js';
import { createSelectionDocument, addField, simulatorSelectOptions } from './designsystem-selection-dom.mjs';
import { buildSimulatorInputsFromProfileData } from '../app/simulator/simulator-profile-inputs.js';
import { EngineAPI } from '../engine/index.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { prepareHistoricalDataOnce } from '../app/simulator/simulator-engine-helpers.js';
import { runBacktest } from '../app/simulator/simulator-backtest.js';
import { readFileSync } from 'node:fs';
const entries = [
    { profileId: 'a', name: 'Synthetisch A', data: { profile_person_schema_version: '1', profile_geburtsdatum: '1958-03-14', profile_rentenbeginn: '2028-10-01', profile_rente_monatlich: '1000', profile_sparer_pauschbetrag: '0', profile_kirchensteuer_pct: '9', sim_simStartVermoegen: '100000', profile_tagesgeld: '100000', profile_rentenanpassung_art: 'wage', profile_rentenanpassung_pct: '2' } },
    { profileId: 'b', name: 'Synthetisch B', data: { profile_person_schema_version: '1', profile_geburtsdatum: '1960-01-01', profile_rentenbeginn: '2027-01-01', profile_rente_monatlich: '1500', profile_sparer_pauschbetrag: '1200', profile_kirchensteuer_pct: '0', sim_simStartVermoegen: '300000', profile_tagesgeld: '300000', profile_rentenanpassung_art: 'fix', profile_rentenanpassung_pct: '10', profile_rente_steuerquote_pct: '5' } }
];
const controller = createPersonOverrides(entries, 'a', 2026), original = JSON.stringify(entries);
assert(!controller.set('a', 'profile_sparer_pauschbetrag', 900), 'Normalmodus akzeptiert keine Alternative');
controller.activate(true);
assert(!controller.read().context.deviationApplied, 'Aktiver Schalter ohne echte Alternative meldet keine Abweichung');
controller.set('a', 'profile_rente_monatlich', '1000');
controller.set('a', 'profile_rentenanpassung_pct', '99');
assert(!controller.read().context.deviationApplied, 'Gleicher Betrag und dormanter Anpassungssatz bleiben fachgleich');
controller.set('a', 'profile_geburtsdatum', '1956-01-01');
controller.set('a', 'profile_rentenbeginn', '2026-12-01');
controller.set('a', 'profile_sparer_pauschbetrag', 500);
controller.set('b', 'profile_sparer_pauschbetrag', 700);
controller.set('b', 'profile_rente_steuerquote_pct', 20);
const effective = controller.read();
assertEqual(effective.combined.startAlter, 70, 'Alternativer Geburtstag wird vor Haushaltsmerge zum Januaralter');
assertEqual(effective.combined.renteStartOffsetJahre, 0, 'Alternativer Rentenbeginn wird zum Jahresoffset');
assertEqual(effective.combined.renteStartMonate, 1, 'Alternative transportiert Dezemberanteil bis zum Jahreslauf');
assertEqual(effective.combined.startSPB, 1200, 'SPB beider wirksamer Personen wird summiert');
assertEqual(effective.combined.kirchensteuerSatz, .0225, 'Bisherige Vermögensgewichtung der Kirchensteuer erhalten');
assertEqual(effective.combined.partner.steuerquotePct, 20, 'Partner-Steuerquote erreicht die bestehende Fachgrenze');
assertEqual(effective.combined.rentAdjMode, 'wage', 'Gemeinsame Anpassung kommt weiterhin vom Hauptprofil');
assert(effective.context.deviationApplied && Object.isFrozen(effective.context.persons[0].changes), 'Ergebnisbeleg erfasst und friert tatsächliche Alternativen ein');
controller.reset();
assertEqual(effective.context.persons[0].changes[0].effectiveValue, '1956-01-01', 'Reset verändert keinen bisherigen Laufbeleg');
assertEqual(JSON.stringify(entries), original, 'Zentrale Eingabedaten unverändert');

const previous = { document: globalThis.document, window: globalThis.window, sessionStorage: globalThis.sessionStorage, confirm: globalThis.confirm };
try {
    const legacyAccumulation = { sim_accumulationPhaseEnabled: '1', sim_accumulationDurationYears: '25', sim_accumulationSparrate: '2000', sim_sparrateIndexing: 'wage' };
    const records = { ...entries[0].data, ...legacyAccumulation, sim_p1Monatsrente: '1111', sim_p1PersonIncome: '750', sim_r2PersonIncome: '750', [PROFILE_STORAGE_KEYS.current]: 'a', [PROFILE_STORAGE_KEYS.active]: 'a', [PROFILE_STORAGE_KEYS.registry]: JSON.stringify({ version: 1, profiles: Object.fromEntries(entries.map(e => [e.profileId, { meta: { id: e.profileId, name: e.name, belongsToHousehold: true }, data: e.data }])) }) };
    const writes = [], sessions = [];
    const backend = { name: 'person-override-fixture', async open() {}, async loadAll() { return { ...records }; }, async saveBatch({ deletes, upserts }) { writes.push(...upserts); deletes.forEach(k => delete records[k]); upserts.forEach(([k,v]) => records[k] = v); } };
    PersistenceFacade.resetPersistenceForTests(backend); await PersistenceFacade.init({ installLifecycleHooks: false });
    const doc = createSelectionDocument(), listeners = {};
    doc.addEventListener = (t, f) => (listeners[t] ||= []).push(f);
    doc.removeEventListener = (t, f) => { listeners[t] = (listeners[t] || []).filter(fn => fn !== f); };
    const selects = ['p1Geschlecht','r2Geschlecht','p1KirchensteuerPct','r2KirchensteuerPct','rentAdjMode'];
    for (const id of [...SIMULATOR_PERSON_FIELD_IDS, 'personDeviationToggle', 'personDeviationStatus','p1PersonSource','r2PersonSource','personHouseholdSPB','mcDauer','displayPortfolioBreakdown']) {
        const n = addField(doc, id, '', selects.includes(id) ? simulatorSelectOptions(id) : null);
        n.setCustomValidity = v => n.validationMessage = v;
    }
    const details = doc.body.appendChild(doc.createElement('details')); details.id = 'simPersonDetails'; details.open = false;
    const cache = doc.body.appendChild(doc.createElement('div')); cache.id = 'personEditorCache'; cache.hidden = true;
    for (const [role, prefix] of [['p1', 'p1'], ['r2', 'r2'], ['sharedPension', 'rentAdj']]) {
        const card = doc.body.appendChild(doc.createElement('section'));
        const list = card.appendChild(doc.createElement('dl')); list.id = role === 'sharedPension' ? 'sharedPensionValues' : role + 'PersonValues';
        const editors = cache.appendChild(doc.createElement('div')); editors.id = role === 'sharedPension' ? 'sharedPensionEditors' : role + 'PersonEditors';
        let essentialEditors;
        if (role !== 'sharedPension') {
            const detailCard = details.appendChild(doc.createElement('section'));
            const detailList = detailCard.appendChild(doc.createElement('dl')); detailList.id = role + 'PersonDetailValues';
            essentialEditors = cache.appendChild(doc.createElement('div')); essentialEditors.id = role + 'EssentialEditors';
        }
        for (const id of SIMULATOR_PERSON_FIELD_IDS.filter(id => id.startsWith(prefix))) {
            const field = doc.getElementById(id);
            (essentialEditors && ['Rentenbeginn', 'Monatsrente'].some(suffix => id === role + suffix) ? essentialEditors : editors).appendChild(field.parentNode);
        }
    }
    const cape = addField(doc, 'marketCapeRatio', '20');
    globalThis.document = doc; globalThis.window = { EngineAPI, name: '' };
    globalThis.sessionStorage = { setItem(...args) { sessions.push(args); }, getItem() { return null; } };
    initRente2ConfigWithLocalStorage(); initRentAdjModeUI(); initPartnerToggle();
    initializePersonOverrides(entries, 'a', 2026, doc);
    initInputPersistence();
    const personList = doc.getElementById('p1PersonValues');
    const detailList = doc.getElementById('p1PersonDetailValues');
    const listText = () => [...personList.children, ...detailList.children].map(node => node.textContent).join(' · ');
    assertEqual(personList.children.filter(node => node.tagName === 'DT').map(node => node.textContent).join(','), 'Rentenbeginn,Monatliche Rente', 'Normalansicht zeigt genau Rentenbeginn und Rente bei null sonstigen Einkünften');
    assert(listText().includes('Alter am 01.01.2026 · 67 Jahre'), 'Startalterbeleg zeigt Januaralter mit Referenzjahr');
    assert(doc.getElementById('r2PersonDetailValues').children.map(node => node.textContent).join(' · ').includes('Alter am 01.01.2026 · 66 Jahre'), 'Partnerbeleg zeigt Januaralter mit Referenzjahr');
    const simulatorHtml = readFileSync(new URL('../Simulator.html', import.meta.url), 'utf8');
    assert(!/p1PersonIncome|r2PersonIncome|Sonstige Einkünfte/.test(simulatorHtml), 'Simulator-Markup enthält keine Anzeige für sonstige Einkünfte');
    for (const id of ['p1StartAlter', 'r2StartAlter']) assert(simulatorHtml.includes(`<label for="${id}">Alter am 01.01.</label>`), 'Alternativer Startalterwert ist ausdrücklich am 01.01. bezeichnet: ' + id);
    assert(listText().includes('14.03.1958') && listText().includes('1.000 €') && listText().includes('9 %'), 'Personenliste enthält deutsch formatierte Werte');
    assert(listText().includes('Rentenbeginn in') && listText().includes('2 Jahren'), 'Nur positiver Rentenoffset erzeugt Zukunftshinweis');
    assert(personList.parentNode.querySelectorAll('*').every(node => !['INPUT','SELECT','BUTTON'].includes(node.tagName)), 'Normalmodus enthält keine Personencontrols in der Karte');
    assert(doc.getElementById('sharedPensionValues').children.some(node => node.textContent === 'Lohnentwicklung'), 'Rentenanpassung der Werteliste folgt nur Hauptprofil');
    const editorNode = doc.getElementById('p1Geburtsdatum');

    const fire = (id, value, type = 'change') => {
        const target = doc.getElementById(id);
        if (id === 'personDeviationToggle') target.checked = value; else target.value = String(value);
        for (const fn of [...(listeners[type] || [])]) fn({ target, type });
        target.dispatchEvent({ type });
    };
    const incomeEntries = entries.map(entry => ({ ...entry, data: { ...entry.data, profile_sonstige_einkuenfte: '750' } }));
    const baselineInputs = JSON.stringify(readDocumentPersonInputs(doc).combined);
    initializePersonOverrides(incomeEntries, 'a', 2026, doc);
    for (const active of [false, true]) {
        fire('personDeviationToggle', active);
        for (const role of ['p1', 'r2']) {
            const card = doc.getElementById(role + 'PersonValues').parentNode;
            const detailCard = doc.getElementById(role + 'PersonDetailValues').parentNode;
            const text = [...card.querySelectorAll('*'), ...detailCard.querySelectorAll('*')].map(node => node.textContent).join(' · ');
            assert(!text.includes('Sonstige Einkünfte'), `750 Euro sonstige Einkünfte erscheinen nicht in der Personenkarte: ${role}, Abweichung ${active}`);
            assertEqual(doc.getElementById(role + 'EssentialEditors').parentNode, active ? card : cache, 'Personenkarte wechselt weiterhin zwischen übernommenen Rentenwerten und Eingaben');
        }
        assertEqual(JSON.stringify(readDocumentPersonInputs(doc).combined), baselineInputs, 'Gespeicherte Einkommensabweichungen und Profileinkünfte ändern keine Simulator-Eingaben');
    }
    fire('p1Monatsrente', 1800, 'input');
    assertEqual(readPensionInputs(doc).renteMonatlich, 1800, 'Rentenabweichung bleibt bei vorhandenen sonstigen Einkünften wirksam');
    assert(!doc.body.querySelectorAll('*').some(node => node.textContent.includes('Sonstige Einkünfte')), 'Auch eine geänderte Rentenabweichung zeigt keine sonstigen Einkünfte');
    initializePersonOverrides(entries, 'a', 2026, doc);
    details.open = false;
    for (const id of SIMULATOR_PERSON_FIELD_IDS) assert(doc.getElementById(id).disabled, `Normalmodus sperrt auch Alias/Partner/Modus ${id}`);
    fire('p1Monatsrente', 9999); fire('r2Steuerquote', 99, 'input');
    assertEqual(readPensionInputs(doc).renteMonatlich, 1000, 'Ausgelöste Ereignisse auf gesperrten Feldern beeinflussen keine Rechnung');
    const baseline = await backend.loadAll(), bundleBefore = JSON.stringify(exportProfilesBundle().registry);
    fire('personDeviationToggle', true);
    assert(details.open && doc.getElementById('p1EssentialEditors').parentNode === personList.parentNode, 'Abweichung öffnet Details automatisch und versetzt Rentenfelder in die offene Karte');
    assert(doc.getElementById('p1Geburtsdatum') === editorNode && doc.getElementById('p1PersonEditors').parentNode === detailList.parentNode, 'Abweichung versetzt dieselben Editor-Knoten in die Karte');
    assert(!doc.getElementById('p1Geburtsdatum').disabled && doc.getElementById('p1StartAlter').disabled, 'Alternative ist Geburtstag statt Alterswrite');
    fire('p1Geburtsdatum', '1956-01-01', 'input'); fire('r2Monatsrente', 2000, 'input'); fire('p1SparerPauschbetrag', 900);
    assertEqual(readPensionInputs(doc).renteStartMonate, 3, 'Produktiver Reader erhält Oktoberanteil ohne alte Keyauswahl');
    assertEqual(readPartnerInputs(doc).partner.renteStartMonate, 12, 'Produktiver Partnerreader erhält Januarstart');
    assertEqual(readPensionInputs(doc).startAlter, 70, 'Produktiver Eingabeleser verwendet echtes alternatives Datum');
    assertEqual(readPartnerInputs(doc).partner.monatsrente, 2000, 'Produktiver Partnerleser nutzt den Entwurf');
    assert(doc.getElementById('rentAdjPct').disabled, 'Lohnkopplung hält dormanten Satz gesperrt');
    fire('rentAdjMode', 'fix'); fire('rentAdjPct', 3);
    assertEqual(readPensionInputs(doc).rentAdjPct, 3, 'Wirksamer fixer Satz wird übernommen');
    const inputs = getCommonInputs(), runContext = personDataContextFor(inputs);
    assert(runContext?.deviationApplied, 'Produktive gemeinsame Eingabegrenze bindet den Beleg');
    fire('personDeviationToggle', false); resetPersonOverrides(doc);
    assert(doc.getElementById('p1Geburtsdatum') === editorNode && doc.getElementById('p1PersonEditors').parentNode === cache && !personList.hidden, 'Ausschalten entfernt Controls aus der Karte und verwirft den Entwurf');
    initializePersonOverrides(entries, 'b', 2026, doc);
    assertEqual(readPensionInputs(doc).startAlter, 66, 'Profilwechsel verwirft den Entwurf und vertauscht tatsächliche Rollen');
    assertEqual(runContext.persons[0].profileId, 'a', 'Vorhandener Lauf behält Identität nach Profilwechsel');
    initializePersonOverrides(entries, 'a', 2026, doc);
    cape.value = '25'; cape.dispatchEvent({ type: 'change' });
    await PersistenceFacade.flush();
    const after = await backend.loadAll();
    for (const [key,value] of Object.entries(baseline)) assertEqual(after[key], value, `Neu gelesenes Backend unverändert: ${key}`);
    assertEqual(after.sim_marketCapeRatio, '25', 'Persistenz erlaubter Modellannahmen bleibt funktionsfähig');
    assert(!writes.some(([k]) => k.startsWith('profile_') || /sim_(p1|r2|rentAdj|startAlter|startSPB)/.test(k)), 'Schreibrekorder enthält keine Personenwrites');
    assertEqual(sessions.length, 0, 'Keine Sessionwrites für Personenalternativen');
    assertEqual(JSON.stringify(exportProfilesBundle().registry), bundleBefore, 'Profilbundle enthält keine Alternative');
    const reloadDoc = createSelectionDocument();
    initializePersonOverrides(entries, 'a', 2026, reloadDoc);
    assert(!readDocumentPersonInputs(reloadDoc).context.deviationApplied, 'Neues Dokument beginnt ohne Alternative');
    records[CONFIG.STORAGE.LS_KEY] = JSON.stringify({ annualPeriodMetadata: { lastCommittedPeriod: 'calendar-year:2027' } });
    // Ein Backendwechsel wird wie ein Reload sichtbar, keine versteckte UI-Autorität.
    PersistenceFacade.resetPersistenceForTests(backend); await PersistenceFacade.init({ installLifecycleHooks: false });
    assertEqual(readDocumentPersonInputs(doc).combined.startAlter, 69, 'Jahrwechsel aktualisiert tatsächliche Projektion');
    assertEqual(Number(doc.getElementById('p1StartAlter').value), 69, 'Jahrwechsel synchronisiert den DOM-Wertträger');

    // Echte Optimizer-Lauf-/Veröffentlichungs-/Übernahmebesitzer mit kleinen injizierten Evaluationen.
    const { handleRunAutoOptimize } = await import('../app/simulator/auto_optimize_ui.js');
    const { runAutoOptimize } = await import('../app/simulator/auto_optimize.js');
    const { applyChampionToForm } = await import('../app/simulator/auto-optimize-apply.js');
    for (const id of ['ao_run_btn','ao_cancel_btn','ao_progress','ao_result','ao_apply_btn','liquidityRunwayYears']) addField(doc, id, id === 'liquidityRunwayYears' ? '3' : '');
    fire('personDeviationToggle', true); fire('p1Monatsrente', 2400);
    let entered, release, evaluations = 0;
    const reached = new Promise(resolve => entered = resolve), gate = new Promise(resolve => release = resolve);
    const aoConfig = { objective: { metric: 'EndWealth_P50', direction: 'max' }, params: { liquidityRunwayYears: { min: 1, max: 3, step: .5 } },
        modelAssumptions: { monteCarloParameters: { anzahl: 2, maxDauer: 2, blockSize: 1, seed: 42, methode: 'block', rngMode: 'per-run-seed' }, useCapeSampling: false },
        runsPerCandidate: 2, seedsTrain: 1, seedsTest: 1, constraints: {}, maxDauer: 2,
        evaluateCandidateFn: async () => { if (++evaluations === 1) { entered(); await gate; } return { metricContract: { schemaVersion: 'AutoOptimizeMetricResultV1' }, medianEndWealth: 500000, successProbFloor: 1, depletionRate: 0, worst5Drawdown: 0, timeShareWRgt45: 0, medianWithdrawalRate: .03 }; } };
    const optimizer = handleRunAutoOptimize({ readConfig: () => aoConfig, run: runAutoOptimize });
    await reached; fire('p1Monatsrente', 9900); release(); await optimizer;
    assertEqual(window.aoChampionResult.personDataContext.persons[0].changes.find(x => x.field === 'profile_rente_monatlich').effectiveValue, 2400, 'Produktiver Optimizer veröffentlicht eigenen Startbeleg');
    assert(doc.getElementById('ao_result').innerHTML.includes('2400') && !doc.getElementById('ao_result').innerHTML.includes('9900'), 'Optimizerhinweis zeigt gerechnete statt spätere Alternativen');
    applyChampionToForm({ championCfg: window.aoChampionResult.championCfg, doc });
    await PersistenceFacade.flush();
    const afterApply = await backend.loadAll();
    assertEqual(afterApply.profile_rente_monatlich, '1000', 'Optimizerübernahme schreibt keine zentrale Rente');
    assertEqual(afterApply.sim_p1Monatsrente, '1111', 'Optimizerübernahme speichert keine alternative Rente und verändert keine Altquelle');
    resetPersonOverrides(doc);
    for (const subset of [entries.slice(0, 1), entries]) {
        const baselineEntries = JSON.stringify(subset);
        initializePersonOverrides(subset, 'a', 2026, doc);
        assert(!personList.hidden, 'Einzel-/Partnerfall startet als Liste');
        const current = subset.map(entry => ({ ...entry, data: { ...entry.data, profile_rentenbeginn: '2025-01-01' } }));
        initializePersonOverrides(current, 'a', 2026, doc);
        assert(!listText().includes('Rentenbeginn in'), 'Beginn heute oder früher erzeugt keinen Zukunftshinweis');
        assertEqual(JSON.stringify(subset), baselineEntries, 'Listenprojektion verändert keine Profile');
    }
    const profileBefore = buildSimulatorInputsFromProfileData(entries[0].data, { referenceYear: 2026 });
    const imported = { ...entries[0].data, ...legacyAccumulation };
    const importedBytes = JSON.stringify(imported);
    const profileAfter = buildSimulatorInputsFromProfileData(imported, { referenceYear: 2026 });
    assertEqual(JSON.stringify(profileAfter), JSON.stringify(profileBefore), 'Importierte Legacy-Ansparwerte ändern keinen Profilrequest');
    assertEqual(JSON.stringify(imported), importedBytes, 'Importadapter bewahrt alte Ansparwerte bytegleich');
    prepareHistoricalDataOnce();
    const numeric = { ...effective.combined, startVermoegen: 600000, depotwertAlt: 300000, einstandAlt: 250000, zielLiquiditaet: 50000, startFloorBedarf: 24000, startFlexBedarf: 12000, minimumFlexAnnual: 0,
        rebalancingBand: 25, maxSkimPctOfEq: 10, maxBearRefillPctOfEq: 5, liquidityRunwayYears: 3, goldAktiv: false, dynamicFlex: false,
        healthBucket: { enabled: true, initialAmount: 10000, assetSource: 'money_market_first_then_cash', triggerMinGrade: 2, triggerMode: 'OR', coverageMode: 'care_additional_floor_only', returnMode: 'cash_return', targetMode: 'nominal_fixed' } };
    const options = { engine: EngineAPI, useCapeSampling: false, widowOptions: { mode: 'none', percent: 0 }, monteCarloParams: { anzahl: 2, maxDauer: 3, blockSize: 1, seed: 42, methode: 'block', rngMode: 'per-run-seed' } };
    bindPersonDataContext(numeric, effective.context);
    const before = await runMonteCarloChunk({ ...options, inputs: numeric });
    const clone = JSON.parse(JSON.stringify(numeric));
    // Metadaten leben außerhalb des numerischen Requests; keinerlei zusätzliche RNG-Ziehung.
    const afterMC = await runMonteCarloChunk({ ...options, inputs: clone });
    assertEqual(JSON.stringify(before), JSON.stringify(afterMC), 'Gleiche wirksame Parameter: kleine MC-/Steuer-/Reserve-/RNG-Resultate bitgleich');
    assertEqual(JSON.stringify(runBacktest(2000, 2002, true, numeric)), JSON.stringify(runBacktest(2000, 2002, true, clone)), 'Gleiche wirksame Parameter: kleine Backtestresultate bitgleich');
    const phaseFields = inputs => ({ accumulationPhase: inputs.accumulationPhase, transitionYear: inputs.transitionYear, transitionAge: inputs.transitionAge });
    const profileNumericBefore = { ...numeric, ...phaseFields(profileBefore) }, profileNumericAfter = { ...numeric, ...phaseFields(profileAfter) };
    const legacyMC = await runMonteCarloChunk({ ...options, inputs: profileNumericAfter });
    assertEqual(legacyMC.technicalInventory.financiallyEvaluable, 2, 'Legacy-Gleichheitsfixture rechnet zwei echte MC-Pfade');
    assertEqual(legacyMC.technicalInventory.technicalError, 0, 'Legacy-Gleichheitsfixture enthält keine technischen Fehler');
    assertEqual(JSON.stringify(await runMonteCarloChunk({ ...options, inputs: profileNumericBefore })), JSON.stringify(await runMonteCarloChunk({ ...options, inputs: profileNumericAfter })), 'Legacy-Ansparwerte: kleine MC-Rohresultate bytegleich zum ausgeschalteten Profilbetrieb');
    assertEqual(JSON.stringify(runBacktest(2000, 2002, true, profileNumericBefore)), JSON.stringify(runBacktest(2000, 2002, true, profileNumericAfter)), 'Legacy-Ansparwerte: kleine Backtest-Rohresultate bytegleich zum ausgeschalteten Profilbetrieb');

} finally { Object.assign(globalThis, previous); PersistenceFacade.resetPersistenceRuntimeForTests(); }
