import { describePlanTrialDifference } from '../app/simulator/simulator-plan-trial.js';
import { initThreeBucketControls } from '../app/simulator/simulator-main-3bucket.js';
import { readBoundHouseholdPlanField, writeBoundHouseholdPlanField } from '../app/shared/household-plan-fields.js';
const formNumber = field => readBoundHouseholdPlanField(field) ?? Number(field.value);
import { createPlanTrial, getSimulatorPlanTrial, renderSimulatorPlanTrial, updateSimulatorPlanTrial, planTrialContextFor, initSimulatorPlanTrial } from '../app/simulator/simulator-plan-trial.js';
import { PLAN_DEFAULTS, HOUSEHOLD_PLAN_KEY, planScope, buildPlanRecord, readHouseholdPlan, patchHouseholdPlan, SIMULATOR_PLAN_FIELD_MAP, readSimulatorHouseholdPlan, readBalanceHouseholdPlan } from '../app/profile/household-plan.js';
import { initInputPersistence } from '../app/simulator/simulator-main-input-persist.js';
import { initDynamicFlexControls, refreshDynamicFlexControls } from '../app/simulator/simulator-main-dynamic-flex.js';
import { getCommonInputs } from '../app/simulator/simulator-portfolio-inputs.js';
import { PersistenceFacade, persistenceStorage } from '../app/shared/persistence-facade.js';
import { createSelectionDocument, addField, simulatorSelectOptions } from './designsystem-selection-dom.mjs';

const scope = planScope('household', ['a', 'b']), outside = planScope('single', ['x']);
const values = { ...structuredClone(PLAN_DEFAULTS), dynamicFlex: true, goGoActive: true,
    cape: { value: 23, asOf: '2026-10-09', source: 'Test' } };
// UF-1: ungültige Prozente verändern weder den Versuch noch den gemeinsamen Plan.
{
    const trial = createPlanTrial({ readPlan: () => ({ status: 'valid', scope, entry: { values } }) });
    trial.start();
    const before = JSON.stringify(trial.formValues());
    for (const survivalQuantile of [.008, .49, 1, NaN]) {
        let rejected = false;
        try { trial.update({ survivalQuantile }); } catch { rejected = true; }
        assert(rejected, 'Ungültiges Überlebensquantil wird abgelehnt');
        assertEqual(JSON.stringify(trial.formValues()), before, 'Abgelehnte Eingabe erhält den vorherigen Versuch');
    }
}
let backend = { [HOUSEHOLD_PLAN_KEY]: buildPlanRecord(null, [{ scope, values }, { scope: outside, values }]).raw,
    rs_current_profile: 'a', rs_profiles_v1: JSON.stringify({ version: 1, profiles: Object.fromEntries(['a', 'b'].map(id => [id,
        { meta: { name: id, belongsToHousehold: true }, data: { sim_startFlexBedarf: '2' } }])) }), sim_startFlexBedarf: '1', sim_dynamicFlexPreset: 'off',
    sim_liquidityRunwayYears: '9', sim_survivalQuantile: '0.99', sim_goGoMultiplier: '1.5', sim_goGoActive: 'false',
    household_simulator_needs_v1: 'Altdaten bleiben unverändert' };
const original = { document: globalThis.document, window: globalThis.window };
let failure = null, duringWrite = null;

// Auswahlidentität und Planverfügbarkeit sind unabhängige Zustandsgrenzen.
for (const lossFirst of [false, true]) for (const initiallyActive of [false, true]) for (const targetStatus of ['missing', 'invalid', 'valid']) {
    let selected = scope, status = 'valid';
    let notifications = 0;
    const trial = createPlanTrial({ readPlan: () => ({ status, scope: selected,
        entry: status === 'valid' ? { values } : null }), changed: () => notifications++ });
    trial.read();
    if (initiallyActive) { trial.start(); trial.update({ flexBedarf: 33000 }); }
    if (lossFirst) {
        status = 'missing';
        const lost = trial.read();
        assert(lost.confirmed && !lost.scope && !lost.active, 'Planverlust im selben Bereich erhält Bestätigungsgrenze und verwirft Versuch');
        const stable = notifications;
        trial.read(); trial.read();
        assertEqual(notifications, stable, 'Wiederholter Planverlustread bleibt ohne neue Benachrichtigung stabil');
        let rejected = false; try { trial.values(); } catch { rejected = true; }
        assert(rejected && !trial.start(), 'Planverlust erlaubt weder Altberechnung noch Versuchsstart');
    }
    selected = outside; status = targetStatus;
    const switched = trial.read();
    assert(!switched.active && switched.differences.length === 0, `${targetStatus}: tatsächlicher Scopewechsel verwirft Versuch und Abweichungen`);
    if (targetStatus === 'valid') {
        assert(switched.confirmed && switched.scope.key === outside.key, 'Gültiger Zielbereich bindet ausschließlich den neuen Plan');
    } else {
        assert(!switched.confirmed && !switched.scope,
            `${lossFirst ? 'Nach Planverlust' : 'Direkter Wechsel'}/${targetStatus}: tatsächlicher Scopewechsel gibt Vorbestätigungszustand frei`);
        assertEqual(trial.formValues(), null, 'Neuer unbestätigter Scope besitzt keine alten Plan-/Versuchswerte');
        assert(!trial.start(), 'Neuer unbestätigter Scope erlaubt keinen Versuch');
    }
    const stable = notifications;
    trial.read(); trial.read();
    assertEqual(notifications, stable, 'Wiederholter Read im neuen unbestätigten Scope bleibt stabil');
    status = 'valid';
    assert(trial.read().confirmed && !trial.read().active, 'Spätere Bestätigung im neuen Scope bindet wieder ohne Versuch');
    assertEqual(trial.values().flexBedarf, values.flexBedarf, 'Spätere Bestätigung übernimmt keine vorherige lokale Abweichung');
}

const makeDoc = () => {
    const doc = createSelectionDocument(); doc.addEventListener = () => {};
    for (const id of [...Object.keys(SIMULATOR_PLAN_FIELD_MAP), 'dynamicFlexPreset', 'dynamicFlexShowAdvanced', 'p1StartAlter', 'displayPortfolioBreakdown', 'simPlanTrialStart']) {
        const select = ['dynamicFlexPreset', 'horizonMethod', 'longevityMode', 'entnahmeStrategie'].includes(id);
        const field = addField(doc, id, '', select ? simulatorSelectOptions(id) : null);
        if (['dynamicFlex', 'goGoActive', 'dynamicFlexShowAdvanced'].includes(id)) field.type = 'checkbox';
        field.setCustomValidity = value => field.validationMessage = value;
    }
    doc.getElementById('p1StartAlter').value = '65'; return doc;
};

try {
    PersistenceFacade.resetPersistenceForTests({ name: 'Versuchsprobe', async init() {}, async loadAll() { return { ...backend }; },
        async saveBatch({ upserts, deletes }) {
            if (failure === 'write') { failure = null; throw new Error('synthetischer Writefehler'); }
            if (failure === 'rollback') throw new Error('synthetischer Rücknahmefehler');
            deletes.forEach(key => delete backend[key]); upserts.forEach(([key, value]) => backend[key] = value);
            if (duringWrite) { const action = duringWrite; duringWrite = null; action(); }
        } });
    await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const doc = makeDoc(); globalThis.document = doc; globalThis.window = {};
    initInputPersistence(); initDynamicFlexControls(); renderSimulatorPlanTrial(doc, { project: true });
    const trial = getSimulatorPlanTrial(doc), bytes = JSON.stringify(PersistenceFacade.exportAllSync().records);
    const backendBytes = JSON.stringify(backend);
    const unchangedBackend = async message => {
        await PersistenceFacade.flush();
        assertEqual(JSON.stringify(backend), backendBytes, message);
        assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), bytes, `${message} (Cache)`);
    };
    assert(doc.getElementById('startFlexBedarf').disabled, 'Planfelder sind zunächst lesend');
    const head = doc.getElementById('simPlanTrialStart'), headParent = head.parentNode;
    head.remove(); refreshDynamicFlexControls();
    assert(doc.getElementById('dynamicFlexPreset').disabled && trial.read().confirmed,
        'Explizit registrierter Versuch schützt Planfelder auch ohne Simulator-Kopf-ID');
    headParent.appendChild(head);
    const details = doc.getElementById('dynamicFlexShowAdvanced'); details.checked = true; details.dispatchEvent({ type: 'change' });
    doc.getElementById('startFlexBedarf').value = '33000'; doc.getElementById('startFlexBedarf').dispatchEvent({ type: 'input' });
    assertEqual(formNumber(doc.getElementById('startFlexBedarf')), getCommonInputs().startFlexBedarf, 'Lesemodus restauriert sichtbaren Flex synchron zur Laufeingabe');
    assertEqual(getCommonInputs().startFlexBedarf, 24000, 'Ein synthetisches Ereignis im Lesemodus ändert keine Laufeingabe');
    for (const type of ['input', 'change']) {
        for (const [id, changed, expected] of [['startFlexBedarf', 33000, 24000], ['liquidityRunwayYears', 7, values.liquidityRunwayYears],
            ['survivalQuantile', .93, .85], ['goGoMultiplier', 1.3, 1.1]]) {
            const field = doc.getElementById(id); field.value = String(changed); field.dispatchEvent({ type });
            assertEqual(formNumber(field), expected, `${id}/${type}: Formular zeigt bestätigten Wert nach allen Listenern`);
            assertEqual(getCommonInputs()[id], formNumber(field), `${id}/${type}: Formular und Laufeingabe stimmen überein`);
        }
    }
    const goGo = doc.getElementById('goGoActive'); goGo.checked = false; goGo.dispatchEvent({ type: 'change' });
    const readPreset = doc.getElementById('dynamicFlexPreset'); readPreset.value = 'off'; readPreset.dispatchEvent({ type: 'change' });
    assert(goGo.checked && doc.getElementById('dynamicFlex').checked, 'Lesemodus stellt bestätigte Checkboxkombination wieder her');
    assertEqual(readPreset.value, 'ausgewogen', 'Preseterkennung passt zum restaurierten Plan');
    for (const id of ['dynamicFlexPreset', 'goGoActive', 'goGoMultiplier', 'survivalQuantile']) {
        const field = doc.getElementById(id);
        assert(field.disabled && field.dataset.fieldState === 'adopted', `${id}: Planlesesperre bleibt nach allen Listenern erhalten`);
        assert(field.getAttribute('aria-describedby').split(' ').some(reason => doc.getElementById(reason)?.textContent === 'aus Haushalt & Plan'), `${id}: zugängliche Herkunft bleibt Plan`);
    }
    assert(doc.getElementById('goGoMultiplier').dataset.planTrialInactive === 'true'
        && doc.getElementById('survivalQuantile').dataset.planTrialInactive === 'true', 'Restaurierte Voreinstellung hält Dynamikdetails ausgeblendet');
    details.checked = true; details.dispatchEvent({ type: 'change' });
    assert(doc.getElementById('goGoMultiplier').dataset.planTrialInactive === 'false'
        && doc.getElementById('survivalQuantile').dataset.planTrialInactive === 'false', 'Explizite Detailfreigabe erhält die fachliche Anwendbarkeit und Planlesesperre');
    await unchangedBackend('Lesemodusereignisse erhalten alle Backendrohbytes nach Flush');
    trial.start(); renderSimulatorPlanTrial(doc, { project: true });
    // Tatsächlich gebundenes Versuchsfeld mit nativer Auswahlmechanik.
    const boundFlex = doc.getElementById('startFlexBedarf');
    let flexText = boundFlex.value;
    Object.defineProperty(boundFlex, 'value', { get: () => flexText, set(value) {
        flexText = String(value); boundFlex.selectionStart = boundFlex.selectionEnd = flexText.length;
    } });
    boundFlex.setSelectionRange = (start, end) => { boundFlex.selectionStart = start; boundFlex.selectionEnd = end; };
    const draftBytes = JSON.stringify(trial.formValues()), differences = JSON.stringify(trial.read().differences);
    boundFlex.setSelectionRange(0, boundFlex.value.length); doc.activeElement = boundFlex;
    boundFlex.dispatchEvent({ type: 'focus' });
    assertEqual(boundFlex.value, '24000', 'Gebundenes Versuchsfeld zeigt reine Zahl');
    assertEqual(boundFlex.selectionStart, 0, 'Versuchsvollauswahl startet bei 0');
    assertEqual(boundFlex.selectionEnd, 5, 'Versuchsvollauswahl umfasst neue Zahl');
    boundFlex.dispatchEvent({ type: 'blur' }); doc.activeElement = null;
    assertEqual(JSON.stringify(trial.formValues()), draftBytes, 'Reine Darstellung verändert keine Versuchswerte');
    assertEqual(JSON.stringify(trial.read().differences), differences, 'Reine Auswahl erzeugt keine Abweichung');
    await unchangedBackend('Fokus, Vollauswahl und Blur schreiben weder Plan noch Versuchswerte');
    boundFlex.setSelectionRange(0, boundFlex.value.length); doc.activeElement = boundFlex;
    boundFlex.dispatchEvent({ type: 'focus' });
    const selectionStart = boundFlex.selectionStart, selectionEnd = boundFlex.selectionEnd;
    boundFlex.value = boundFlex.value.slice(0, selectionStart) + '33000' + boundFlex.value.slice(selectionEnd);
    boundFlex.setSelectionRange(selectionStart + 5, selectionStart + 5); boundFlex.dispatchEvent({ type: 'input' });
    assertEqual(boundFlex.value, '33000', 'Tippen ersetzt echte Auswahl im Versuchsfeld');
    assertEqual(getCommonInputs().startFlexBedarf, 33000, 'Ersatz erreicht bestehende Simulator-Laufeingabe');
    await unchangedBackend('Ersetzen durch Tippen bleibt flüchtiger Versuch');
    boundFlex.dispatchEvent({ type: 'blur' }); doc.activeElement = null;
    trial.reset(); renderSimulatorPlanTrial(doc, { project: true });
    trial.start(); renderSimulatorPlanTrial(doc, { project: true });
    // Tatsächliche Feld- und Strategiewechselgrenzen: keine Skalenfehler/Defaults.
    for (const [id, value] of [['survivalQuantile', .9], ['goGoMultiplier', 1.25]]) {
        writeBoundHouseholdPlanField(doc.getElementById(id), value); doc.getElementById(id).dispatchEvent({ type: 'change' });
    }
    assertEqual(doc.getElementById('survivalQuantile').value, '90', 'Gebundenes Feld projiziert kanonischen Anteil als Prozentanzeige');
    assertEqual(getCommonInputs().survivalQuantile, .9, 'Anteil erreicht die Engine genau einmal skaliert');
    assertEqual(getCommonInputs().goGoMultiplier, 1.25, 'Faktor bleibt ein Faktor');
    const strategy = doc.getElementById('entnahmeStrategie');
    initThreeBucketControls(); strategy.value = '3_bucket_jilge'; strategy.dispatchEvent({ type: 'change' });
    const factor = doc.getElementById('bondTargetFactor'); factor.value = '';
    strategy.dispatchEvent({ type: 'change' });
    assertEqual(factor.value, '', '3-Töpfe-Wechsel ersetzt ungültigen Planfaktor nicht durch Default');
    let factorRejected = false; try { getCommonInputs(); } catch { factorRejected = true; }
    assert(factorRejected, 'Leerer Planfaktor sperrt tatsächliche Laufeingabe');
    factor.value = '7 Jahre'; factor.dispatchEvent({ type: 'change' });
    assertEqual(getCommonInputs().decumulation.bondTargetFactor, 7, 'Korrigierter formatierter Faktor erreicht tatsächliche Laufeingabe');
    const quantile = doc.getElementById('survivalQuantile');
    quantile.dispatchEvent({ type: 'focus' });
    const beforeFocus = getCommonInputs().survivalQuantile;
    renderSimulatorPlanTrial(doc, { project: true });
    assertEqual(quantile.value, '90', 'Wiederprojektion erhält aktive Prozent-Eingabe');
    quantile.dispatchEvent({ type: 'blur' });
    assertEqual(getCommonInputs().survivalQuantile, beforeFocus, 'Fokus/Blur erhält tatsächlichen Engineanteil');
    await unchangedBackend('Feldübernahme, Strategiewechsel und reine Darstellung erhalten Backendrohbytes');
    const minimum = doc.getElementById('minimumFlexAnnual'); minimum.value = '99999'; minimum.dispatchEvent({ type: 'input' });
    const reason = minimum.validationMessage;
    let runError;
    try { getCommonInputs(); } catch (error) { runError = error.message; }
    assert(reason.includes('Mindest-Flex') && runError === reason, 'Ungültiger aktiver Versuch blockiert Laufeingabe mit erhaltenem Validierungsgrund');
    assertEqual(Number(minimum.value), 99999, 'Ungültiger Mindest-Flex bleibt sichtbar und wird nicht gekappt');
    trial.reset(); renderSimulatorPlanTrial(doc, { project: true });
    trial.start(); renderSimulatorPlanTrial(doc, { project: true });
    assert(!doc.getElementById('startFlexBedarf').disabled, 'Versuch öffnet die Planfelder');
    for (const [id, value] of [['startFlexBedarf', '33000'], ['entnahmeStrategie', '3_bucket_jilge'], ['bondTargetFactor', '7'], ['marketCapeRatio', '31']]) {
        doc.getElementById(id).value = value; doc.getElementById(id).dispatchEvent({ type: 'change' });
    }
    const preset = doc.getElementById('dynamicFlexPreset'); preset.value = 'konservativ'; preset.dispatchEvent({ type: 'change' });
    doc.getElementById('dynamicFlexShowAdvanced').checked = true; doc.getElementById('dynamicFlexShowAdvanced').dispatchEvent({ type: 'change' });
    await PersistenceFacade.flush();
    assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), bytes, 'Feldereignisse, Strategie, Preset und Darstellung verändern keinerlei Speicherbytes');
    assertEqual(JSON.stringify(backend), backendBytes, 'Auch Strategie, Preset und Darstellung erhalten Backendrohbytes nach Flush');
    const inputs = getCommonInputs();
    assertEqual(inputs.startFlexBedarf, 33000, 'Lauf liest den flüchtigen Flex');
    renderSimulatorPlanTrial(doc);
    assertEqual(inputs.decumulation.bondTargetFactor, 7, 'Verschachtelte Versuchswerte erreichen die Laufeingabe');
    assertEqual(inputs.horizonYears, 35, 'Preset wirkt nur im Versuch');
    assert(planTrialContextFor(inputs).deviationApplied, 'Laufeingabe besitzt separaten Abweichungsnachweis');
    assert(!Object.hasOwn(inputs, 'planDataContext'), 'Nachweis wird kein Engineparameter');
    assertEqual((await trial.adopt(async () => false)).status, 'cancelled', 'Abgebrochene Bestätigung behält Versuch');
    assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), bytes, 'Bestätigungsabbruch schreibt nichts');
    assert(trial.read().active, 'Versuch bleibt nach Abbruch erhalten');
    // Aktuelle, unsichtbare Felder werden nicht durch die Ausgangskopie überschrieben.
    await patchHouseholdPlan({ scope, patch: { minCashBufferMonths: 8 } });
    let confirmed;
    const result = await trial.adopt(async differences => { confirmed = differences; return true; });
    assertEqual(result.status, 'saved', 'Bewusste Übernahme wird dauerhaft bestätigt');
    const saved = readHouseholdPlan({ scope }).entry.values;
    assertEqual(saved.flexBedarf, 33000, 'Übernahme schreibt den Flex');
    assertEqual(saved.minCashBufferMonths, 8, 'Übernahme erhält einen zwischenzeitlich geänderten unsichtbaren Wert');
    assertEqual(saved.decumulation.bondTargetFactor, 7, 'Übernahme patcht verschachtelte Blätter');
    assertEqual(saved.cape.source, null, 'Versuchs-CAPE übernimmt keine bestätigte Herkunft');
    assert(!confirmed.some(item => item.path === 'minCashBufferMonths'), 'Dialog enthält ausschließlich echte übernommene Differenzen');
    assert(!trial.read().active, 'Erst erfolgreicher Write beendet den Versuch');
    assertEqual(JSON.parse(backend[HOUSEHOLD_PLAN_KEY]).entries[outside.key].values.flexBedarf, 24000, 'Außenplan bleibt unangetastet');
    assertEqual(JSON.parse(backend[HOUSEHOLD_PLAN_KEY]).entries[scope.key].values.flexBedarf, 33000, 'Erfolg beruht auf dauerhaftem Backend');
    trial.start(); trial.update({ minimumFlexAnnual: 30000 });
    let rejected = false; try { trial.update({ flexBedarf: 20000 }); } catch (error) { rejected = error.message.includes('Mindest-Flex'); }
    assert(rejected, 'Ungültiger Mindest-Flex wird abgewiesen statt gekappt');
    try { trial.values(); rejected = false; } catch {}
    assert(rejected, 'Ungültiger Entwurf sperrt einen Lauf');
    trial.reset(); renderSimulatorPlanTrial(doc, { project: true });
    assertEqual(formNumber(doc.getElementById('startFlexBedarf')), 33000, 'Rückweg zeigt ohne Reload den aktuellen Plan');
    trial.start(); trial.update({ flexBedarf: 34000 });
    const beforeError = persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY);
    failure = 'write';
    rejected = false; try { await trial.adopt(async () => true); } catch { rejected = true; }
    assert(rejected && trial.read().active, 'Writefehler erhält Versuch und gibt kein gespeichert aus');
    assertEqual(persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY), beforeError, 'Writefehler erhält Planbytes');
    rejected = false; try { await trial.adopt(async () => { await patchHouseholdPlan({ scope, patch: { minCashBufferMonths: 9 } }); return true; }); } catch { rejected = true; }
    assert(rejected && trial.read().active, 'Planwechsel während Dialog bricht Übernahme ab');
    rejected = false; try { await trial.adopt(async () => { trial.update({ flexBedarf: 35000 }); return true; }); } catch { rejected = true; }
    assert(rejected && trial.read().active, 'Neue Formularrevision während Dialog bricht Übernahme ab');

    assertEqual(readHouseholdPlan({ scope }).entry.values.flexBedarf, 33000, 'Planwechsel schreibt nicht den alten Versuch');
    let current = scope, profile = 'a';
    const guarded = createPlanTrial({ readPlan: () => ({ ...readHouseholdPlan({ scope: current }), scope: current }), profile: () => profile });
    guarded.start(); guarded.update({ flexBedarf: 36000 });
    rejected = false; try { await guarded.adopt(async () => { profile = 'b'; return true; }); } catch { rejected = true; }
    assert(rejected, 'Profilwechsel während Bestätigung wird erkannt');
    profile = 'a';
    duringWrite = () => { profile = 'b'; };
    const beforeWrite = persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY);
    rejected = false; try { await guarded.adopt(async () => true); } catch { rejected = true; }
    assert(rejected, 'Kontextwechsel während Write verhindert Erfolg');
    assertEqual(persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY), beforeWrite, 'Kontextwechsel während Write nimmt Planänderung zurück');
    assertEqual(backend[HOUSEHOLD_PLAN_KEY], beforeWrite, 'Kontextwechsel nimmt auch dauerhaften Write zurück');
    profile = 'a'; guarded.sync(); current = outside; guarded.sync();
    assert(!guarded.read().active, 'Echter Scopewechsel verwirft alten Versuch');
    assertEqual(guarded.values().flexBedarf, 24000, 'Neuer Scope liest ausschließlich eigenen Plan');
    const nextDoc = makeDoc(); addField(nextDoc, 'rebalancingBand', '25'); globalThis.document = nextDoc; initInputPersistence(); initDynamicFlexControls(); renderSimulatorPlanTrial(nextDoc, { project: true });
    assert(!getSimulatorPlanTrial(nextDoc).read().active, 'Neues Dokument startet ohne Versuch');
    assertEqual(formNumber(nextDoc.getElementById('startFlexBedarf')), 33000, 'Reload zeigt bestätigten Plan');
    // Echte Button-/Guardbindung: kein separater Testschreiber für die Übernahme.
    for (const id of ['simPlanTrialStart', 'simPlanTrialStrategy', 'simPlanTrialBack', 'simPlanTrialAdopt', 'simPlanTrialStatus', 'simPlanTrialMessage', 'simPlanTrialBand', 'simPlanTrialDifferences'])
        if (!nextDoc.getElementById(id)) addField(nextDoc, id);
    for (const field of nextDoc.body.querySelectorAll('*')) field.focus = () => { nextDoc.activeElement = field; };
    const strategyHead = nextDoc.getElementById('simPlanTrialStrategy');
    strategyHead.dataset.planTrialToggle = '';
    const originalQuery = nextDoc.querySelectorAll.bind(nextDoc);
    nextDoc.querySelectorAll = selector => selector === '[data-plan-trial-toggle]' ? [strategyHead] : originalQuery(selector);
    let confirmation = null, choiceRows;
    initSimulatorPlanTrial({ doc: nextDoc, requestChoice: async ({ rows }) => { choiceRows = rows; return confirmation; } });
    // Profilprojektionen ohne Versuch bleiben auch bei projizierenden Refreshs wirksam.
    addField(nextDoc, 'goldAllokationAktiv', 'true');
    const projectedGold = nextDoc.getElementById('rebalancingBand');
    const profileBackendBytes = JSON.stringify(backend);
    const profileCacheBytes = JSON.stringify(PersistenceFacade.exportAllSync().records);
    assertEqual(Number(projectedGold.value), 25, 'Gold-Profilbaseline ist beim ersten Binden 25');
    for (const withChange of [false, true]) {
        projectedGold.value = '40';
        if (withChange) projectedGold.dispatchEvent({ type: 'change' });
        renderSimulatorPlanTrial(nextDoc, { project: true });
        assertEqual(updateSimulatorPlanTrial(nextDoc, ['dynamicFlexShowAdvanced']), false,
            'Nichtplanfeld startet keinen Versuch');
        assertEqual(Number(projectedGold.value), 40,
            `Inaktive Profilprojektion ${withChange ? 'mit' : 'ohne'} change erhält Goldband 40`);
        assertEqual(getCommonInputs().rebalancingBand, 40, 'Laufeingabe liest das aktuelle Profilgoldband');
        const profileTrial = getSimulatorPlanTrial(nextDoc);
        assert(profileTrial.read().confirmed && !profileTrial.read().active, 'Profilprojektion bleibt im bestätigten Lesemodus');
        profileTrial.start(); renderSimulatorPlanTrial(nextDoc, { project: true });
        projectedGold.value = '35'; projectedGold.dispatchEvent({ type: 'input' });
        assertEqual(getCommonInputs().rebalancingBand, 35, 'Lokale Goldänderung erreicht die Laufeingabe');
        profileTrial.reset(); renderSimulatorPlanTrial(nextDoc, { project: true });
        assertEqual(Number(projectedGold.value), 40, 'Rückkehr stellt die aktuelle Profilbaseline 40 wieder her');
        assertEqual(getCommonInputs().rebalancingBand, 40, 'Laufeingabe liest nach Rückkehr die aktuelle Profilbaseline');
        await PersistenceFacade.flush();
        assertEqual(JSON.stringify(backend), profileBackendBytes, 'Profilprojektion und Goldversuch erhalten Plan-, sim_- und Profilbackendbytes');
        assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), profileCacheBytes,
            'Profilprojektion und Goldversuch erhalten sämtliche Cachebytes');
    }
    const start = nextDoc.getElementById('simPlanTrialStart'); start.dispatchEvent({ type: 'click' });
    assert(getSimulatorPlanTrial(nextDoc).read().active && !nextDoc.getElementById('startFlexBedarf').disabled,
        'Kopfknopf startet den gemeinsamen Versuch und gibt Bedarf frei');
    assertEqual(strategyHead.textContent, 'Zurück zum Plan', 'Zweiter Kopfknopf spiegelt denselben Versuch');
    assert(!nextDoc.getElementById('dynamicFlexPreset').disabled && !nextDoc.getElementById('liquidityRunwayYears').disabled,
        'Derselbe Versuch gibt die Strategie frei');
    strategyHead.dispatchEvent({ type: 'click' });
    assert(!getSimulatorPlanTrial(nextDoc).read().active && nextDoc.getElementById('startFlexBedarf').disabled,
        'Strategiekopf setzt auch Bedarf gemeinsam zurück');
    strategyHead.dispatchEvent({ type: 'click' });
    assert(getSimulatorPlanTrial(nextDoc).read().active && start.textContent === 'Zurück zum Plan',
        'Strategiekopf startet denselben Versuch und synchronisiert Bedarfkopf');
    const localGold = nextDoc.getElementById('rebalancingBand'); localGold.value = '35';
    localGold.dispatchEvent({ type: 'input' });
    assert(getSimulatorPlanTrial(nextDoc).read().differences.some(item => item.path === 'rebalancingBand' && item.local),
        'Simulator führt Goldabweichung ausdrücklich als lokalen Versuchswert');
    localGold.value = '20'; renderSimulatorPlanTrial(nextDoc, { project: true });
    assertEqual(Number(localGold.value), 35, 'Erneute Profilprojektion desselben Bereichs erhält den lokalen Goldversuch');
    const nextFlex = nextDoc.getElementById('startFlexBedarf'); nextFlex.value = '37000'; nextFlex.dispatchEvent({ type: 'input' });
    const nextFloor = nextDoc.getElementById('startFloorBedarf');
    nextFloor.value = '18000'; nextFloor.dispatchEvent({ type: 'input' });
    const adopt = nextDoc.getElementById('simPlanTrialAdopt');
    const clickAdopt = () => adopt.listeners.click[0]({ currentTarget: adopt });
    await clickAdopt();
    assert(getSimulatorPlanTrial(nextDoc).read().active, 'Reale Buttonbestätigung: Abbruch erhält Versuch');
    assert(choiceRows.some(row => row.id === 'flexBedarf' && row.label.includes('37.000 €')), 'Auswahldialog zeigt führendes Label und Vorher-/Nachherwert');
    confirmation = { flexBedarf: 'adopt', floorBedarf: 'keep' }; await clickAdopt();
    assertEqual(Number(localGold.value), 40, 'Planübernahme setzt nicht übernehmbares Goldband auf die aktuelle Profilbaseline zurück');
    assert(!choiceRows.some(row => row.id === 'rebalancingBand'), 'Goldband erscheint nicht als auswählbares Planfeld');
    assertEqual(nextDoc.getElementById('simPlanTrialStatus').textContent, 'Im gemeinsamen Plan gespeichert.', 'Realer Button meldet Erfolg erst nach transaktionalem Backendwrite');
    assertEqual(JSON.parse(backend[HOUSEHOLD_PLAN_KEY]).entries[scope.key].values.flexBedarf, 37000, 'Reale Buttonübernahme erreicht das Backend');
    assertEqual(JSON.parse(backend[HOUSEHOLD_PLAN_KEY]).entries[scope.key].values.floorBedarf, values.floorBedarf, 'Reale Feldauswahl belässt nicht ausgewählten Grundbedarf im Plan');
    start.dispatchEvent({ type: 'click' });
    assertEqual(nextDoc.getElementById('simPlanTrialStatus').textContent, '', 'Neuer Versuch zeigt keinen alten Speichererfolg');
    nextFlex.value = '39000'; nextFlex.dispatchEvent({ type: 'input' });
    nextDoc.getElementById('simPlanTrialBack').dispatchEvent({ type: 'click' });
    assertEqual(formNumber(nextFlex), 37000, 'Realer Rückweg stellt aktuellen Plan ohne Reload wieder her');
    assert(nextDoc.activeElement === start, 'Realer Rückweg stellt Buttonfokus her');
    const savedPlan = persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY);
    getSimulatorPlanTrial(nextDoc).start();
    persistenceStorage.removeItem(HOUSEHOLD_PLAN_KEY);
    await PersistenceFacade.flush();
    const lostBackendBytes = JSON.stringify(backend);
    const lostBytes = JSON.stringify(PersistenceFacade.exportAllSync().records);
    nextFlex.value = '40000'; nextFlex.dispatchEvent({ type: 'input' });
    const lostPreset = nextDoc.getElementById('dynamicFlexPreset'); lostPreset.value = 'off'; lostPreset.dispatchEvent({ type: 'change' });
    assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), lostBytes, 'Verlorener bestätigter Plan erlaubt keinen Legacy-Fallbackwrite');
    assert(lostPreset.disabled && lostPreset.dataset.fieldState === 'adopted', 'Verlorener bestätigter Plan hält die Dynamic-Flex-Planlesesperre aufrecht');
    let lostRunError;
    try { getCommonInputs(); } catch (error) { lostRunError = error.message; }
    assert(lostRunError?.includes('nicht mehr verfügbar'), 'Verlorener bestätigter Plan sperrt die Rechnung statt Altquellen zu lesen');
    await PersistenceFacade.flush();
    assertEqual(JSON.stringify(backend), lostBackendBytes, 'Verlorener Plan erlaubt nach Flush keinen Altwrite ins Backend');
    persistenceStorage.setItem(HOUSEHOLD_PLAN_KEY, savedPlan); await PersistenceFacade.flush();
    const capeTrial = createPlanTrial({ readPlan: () => ({ status: 'valid', scope, entry: { values } }) });
    capeTrial.start(); capeTrial.update({ cape: { value: 31 } }); capeTrial.update({ cape: { value: 23 } });
    assertEqual(capeTrial.read().differences.length, 0, 'CAPE-Rückänderung erhält ursprüngliche Herkunft und ist keine Abweichung');
    // Gescheiterte Rücknahme bleibt unter der existierenden Plan-Schreibblockade.
    current = scope; profile = 'a'; guarded.start(); guarded.update({ flexBedarf: 36000 });
    duringWrite = () => { profile = 'b'; failure = 'rollback'; };
    rejected = false; try { await guarded.adopt(async () => true); } catch { rejected = true; }
    assert(rejected && guarded.read().active, 'Rücknahmefehler meldet keinen Erfolg und erhält Versuch');
    assert(PersistenceFacade.hasSyncWriteBlocks(), 'Rücknahmefehler sperrt weitere Planwrites');
} finally { failure = null; globalThis.document = original.document; globalThis.window = original.window; PersistenceFacade.resetPersistenceForTests(); }

// Gemeinsame Beschreibungen für Optionen, Boolean, Anteil, Faktor und nullable Schwelle.
for (const [path, before, after, expected] of [
    ['survivalQuantile', .85, .9, 'Überlebensquantil: 85 % → 90 %'],
    ['goGoMultiplier', 1.1, 1.25, 'Go-Go-Faktor: 1,10 → 1,25'],
    ['dynamicFlex', false, true, 'Dynamische Entnahme: Aus → An'],
    ['longevityMode', 'none', 'buffer_years', 'Langlebigkeit: Ohne Zusatz → Zusätzliche Jahre'],
    ['decumulation.bondRefillThreshold', null, 3, 'Anleihen-Auffüllschwelle: automatisch → 3']
]) assertEqual(describePlanTrialDifference({ path, before, after }), expected, path + ': echte Abweichung feldgenau beschrieben');
{
    const trial = createPlanTrial({ readPlan: () => ({ status: 'valid', scope, entry: { values } }) });
    trial.start(); trial.update({ flexBedarf: 33000, goGoActive: false, longevityMode: 'buffer_years' });
    assertEqual(trial.read().differences.map(item => item.path).join(','), 'flexBedarf,goGoActive,longevityMode', 'Mehrere echte Änderungen vollständig, ohne Phantomabweichung');
    trial.update({ flexBedarf: values.flexBedarf, goGoActive: values.goGoActive, longevityMode: values.longevityMode });
    assertEqual(trial.read().differences.length, 0, 'Vollständige Rückänderung entfernt jede Abweichung');
}
