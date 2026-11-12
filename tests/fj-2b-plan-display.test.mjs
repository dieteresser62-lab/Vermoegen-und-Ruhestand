import { EngineAPI } from '../engine/index.mjs';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { UIRenderer } from '../app/balance/balance-renderer.js';
import { UIReader } from '../app/balance/balance-reader.js';
import { UIUtils } from '../app/balance/balance-utils.js';
import { HOUSEHOLD_PLAN_KEY, buildPlanRecord } from '../app/profile/household-plan.js';
import { DAILY_PRICES_KEY } from '../app/tranches/tranchen-history-store.js';
import { setAppTestDate, getAppTestDate } from '../app/shared/app-clock.js';
import { createBalancePageFixture } from './helpers/balance-page-fixture.mjs';
import { fjFixture, stateKey } from './helpers/fj-1-fixtures.mjs';
import { installAnnualLocks } from './helpers/balance-storage-fixtures.mjs';

const json = JSON.stringify, oldDate = getAppTestDate();
const env = createBalancePageFixture({ storage: { getItem: () => null }, url: 'http://localhost/Balance.html' });
const restoreLocks = installAnnualLocks();
const render = UIRenderer.render, renderDiagnosis = UIRenderer.renderDiagnosis;
const get = id => env.doc.getElementById(id);
const planIds = ['balanceNeedRows', 'balanceNeedTotal', 'balanceFloorCoverage', 'balanceMarketFacts',
    'balanceMarket-ath-value', 'balanceMarket-cape-value', 'balancePlannedPosts', 'balancePlannedExpensesNote',
    'balanceReserveTarget', 'balanceReserveParts', 'balanceReserveRunway', 'healthBucketSummary'];
const diagnosisIds = ['diag-chips', 'diag-decision-tree', 'diag-guardrails', 'diag-transaction', 'diag-key-params'];
const texts = ids => json(ids.map(id => [id, get(id)?.textContent]));
const fields = () => json(env.doc.querySelectorAll('input, select').map(field => [field.id, field.value, field.checked]));
let payloads = [], diagnosis;
UIRenderer.render = function(payload) { payloads.push(payload); return render.call(this, payload); };
UIRenderer.renderDiagnosis = function(value) { diagnosis = value; return renderDiagnosis.call(this, value); };
try {
    setAppTestDate('2026-12-30'); env.win.EngineAPI = EngineAPI;
    const main = await import('../app/balance/balance-main.js');
    for (const [household, mode] of [['max-erika', 'standard'], ['max-erika', '3_bucket_jilge'], ['max-erika', 'fallback'], ['renate', 'standard']]) {
        const fixture = fjFixture(household), plan = buildBalanceEngineInputFromStorage({ storage: fixture, referenceYear: 2026 }).householdPlan;
        const values = { ...plan.entry.values, floorBedarf: 31000,
            decumulation: { ...plan.entry.values.decumulation, mode: mode === '3_bucket_jilge' ? mode : 'standard' } };
        fixture.setItem(HOUSEHOLD_PLAN_KEY, buildPlanRecord(plan.raw, [{ scope: plan.scope, values }]).raw);
        if (mode === 'fallback') delete fixture.records[DAILY_PRICES_KEY];
        const backend = { ...fixture.records };
        P.resetPersistenceForTests({ name: 'fj-2b-memory', async loadAll() { return { ...backend }; },
            async saveBatch({ deletes, upserts }) { deletes.forEach(key => delete backend[key]); Object.assign(backend, Object.fromEntries(upserts)); } });
        await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        const initial = await main.init();
        assert(initial.ok, mode + ': echter Balance-Start erfolgreich: ' + (initial.error?.message || ''));
        await initial.overviewPersistence; await P.flush();
        const before = await P.readPersistedRecords(), beforeFields = fields();
        setAppTestDate('2026-12-30');
        payloads = [];
        const result = main.update({ mode: 'preview' });
        assert(result.ok, mode + ': echtes Update erfolgreich: ' + (result.error?.message || ''));
        await result.overviewPersistence; await P.flush();
        assertEqual(payloads.length, 1, mode + ': genau ein Render');
        const payload = payloads[0], current = payload.currentYear || payload;
        assertEqual(UIUtils.parseCurrency(get('floorBedarf').value), 31000, mode + ': Feld zeigt laufenden Plan');
        assertEqual(UIReader.readAllInputs().floorBedarf, 31000, mode + ': Reader liest Planwert');
        assertEqual(current.input.floorBedarf, 31000, mode + ': laufende Anzeige erhält Planwert');
        assertEqual(current.input.endeVJ, result.modelResult.input.endeVJ, mode + ': Marktanzeige bleibt bei der bisherigen Vorschau im laufenden Jahr');
        assertEqual(fields(), beforeFields, mode + ': Vorschau verändert kein Eingabefeld');
        const floorRow = get('balanceNeedRows').children[0].children.find(node => node.children[0]?.textContent.startsWith('Grundbedarf'));
        assert(floorRow?.textContent.includes(UIUtils.formatBalanceCurrency(31000 / 12).slice(0, -1)), mode + ': Bedarfskarte zeigt 31000 pro Jahr als Monatswert');
        const planText = texts(planIds), diagnosisText = texts(diagnosisIds);
        const annualWithdrawal = result.modelResult.diagnosis.keyParams.jahresentnahme;
        assert(Number.isFinite(annualWithdrawal), mode + ': laufende Diagnose enthält Jahresentnahme');
        assertEqual(diagnosis.keyParams.jahresentnahme, annualWithdrawal, mode + ': Diagnose stammt aus laufender Rechnung');
        assert(get('diag-key-params').textContent.includes(UIUtils.formatBalanceCurrency(annualWithdrawal)), mode + ': Diagnose-DOM zeigt laufende Jahresentnahme');
        assert(diagnosisText.includes('Flex') && diagnosisText.includes('Geplante Aktion'), mode + ': echte Diagnosebereiche befüllt');
        if (mode !== 'fallback') {
            assert(payload.nextYearBudget.displayEvaluation, mode + ': Folgejahresprojektion aktiv: ' + payload.nextYearBudget?.reason);
            assertEqual(payload.input.referenceYear, 2027, mode + ': Überblick verwendet Zieljahr');
            assertEqual(payload.input.floorBedarf, 32000, mode + ': Projektionsinput schreibt 31000 mit 2 % und Abschlussrundung fort');
            assertEqual(payload.nextYearBudget.current.needBeforeIndexation, 31000 + values.flexBedarf, mode + ': Projektion basiert auf übernommenem Plan');
            assertEqual(get('balanceActionPreviewTitle').textContent, 'Vorschau auf den Plan 2027', mode + ': Vorschauzeile verwendet Folgejahr');
            assertEqual(get('balanceMonthlyBudget').textContent, UIUtils.formatBalanceCurrency(payload.nextYearBudget.rule.monthlyBudget), mode + ': Budgetkarte zeigt Folgejahresbudget');
            const projectedAction = json(UIRenderer.getActionSummary());
            render.call(UIRenderer, { ...payload, currentYear: undefined });
            assertEqual(json(UIRenderer.getActionSummary()), projectedAction, mode + ': Empfehlung bleibt vollständig bei der Projektion');
            assert(texts(planIds) !== planText, mode + ': Gegenprobe mit Folgejahreswerten ändert Bedarfskarten');
            render.call(UIRenderer, { ...current, marketPreview: payload.marketPreview }); renderDiagnosis.call(UIRenderer, diagnosis);
            assertEqual(texts(planIds), planText, mode + ': Bedarf, Strategie, Markt und Reserven entsprechen laufender Rechnung');
            assertEqual(texts(diagnosisIds), diagnosisText, mode + ': gesamte Diagnose einschließlich Aktion entspricht laufender Rechnung');
            if (mode === 'standard' && household === 'max-erika') assert(json(UIRenderer.getActionSummary()) !== projectedAction, 'Gegenprobe: laufende und projizierte Aktionszusammenfassung unterscheiden sich');
        } else {
            assertEqual(payload.currentYear, undefined, 'Ohne Projektion kein abweichender Anzeigedatensatz');
            assertEqual(payload.input.floorBedarf, 31000, 'Ohne Projektion bisherige Vorschau mit Planwert');
        }
        const after = await P.readPersistedRecords();
        for (const key of [HOUSEHOLD_PLAN_KEY, stateKey, 'annual_plan_record_v1'])
            assertEqual(after[key], before[key], mode + ': Vorschau erhält Rohbytes ' + key);
        for (const [id, profile] of Object.entries(JSON.parse(after.rs_profiles_v1).profiles))
            assert(profile.data[stateKey] === JSON.parse(before.rs_profiles_v1).profiles[id].data[stateKey], mode + ': Vorschau erhält persönlichen Balance-Record ' + id);
        payloads = [];
        const saved = main.update({ mode: 'persist_inputs' });
        assert(saved.ok, mode + ': echte Eingabespeicherung erfolgreich: ' + (saved.error?.message || ''));
        await saved.overviewPersistence; await P.flush();
        const persisted = await P.readPersistedRecords();
        assertEqual(JSON.parse(persisted[HOUSEHOLD_PLAN_KEY]).entries[plan.scope.key].values.floorBedarf, 31000, mode + ': Backend speichert Planwert');
        assertEqual(UIUtils.parseCurrency(get('floorBedarf').value), 31000, mode + ': Speichern erhält Planfeld');
        assertEqual(persisted.annual_plan_record_v1, before.annual_plan_record_v1, mode + ': kein Jahresbeleg beim Speichern');
        const balance = JSON.parse(persisted[stateKey]);
        assert(!Object.hasOwn(balance.inputs, 'floorBedarf'), mode + ': kein Projektionsbedarf im personenbesessenen Record');
        assert(!Object.hasOwn(balance.balanceInputFields || {}, 'floorBedarf'), mode + ': Planfeld wird ausschließlich beim Planbesitzer gespeichert');
        assertEqual(saved.inputData.floorBedarf, 31000, mode + ': Speicherpipeline verwendet laufenden Plan');
        UIReader.planFormSource = null;
        P.resetPersistenceRuntimeForTests();
    }
} finally {
    UIRenderer.render = render; UIRenderer.renderDiagnosis = renderDiagnosis;
    P.resetPersistenceRuntimeForTests(); restoreLocks(); setAppTestDate(oldDate); env.restore();
}
