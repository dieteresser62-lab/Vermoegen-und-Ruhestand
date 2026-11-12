// WT-1/WT-1b: Balance-Überblick über den echten Renderer mit synthetischen Beispieldaten (keine echten Daten).
import { EngineAPI } from '../../engine/index.mjs';
import { MockDocument } from './balance-page-fixture.mjs';
import { buildBalanceEngineInputFromStorage } from '../../app/balance/balance-input-storage.js';
import { PersistenceFacade as P } from '../../app/shared/persistence-facade.js';
import { setAppTestDate } from '../../app/shared/app-clock.js';
import { annualRecordStorage } from '../../app/balance/balance-annual-storage.js';
import { evaluateBalanceFileInputs } from '../../app/balance/balance-file-service.js';
import { evaluateStoredAnnualHousehold } from '../../app/balance/balance-main-profilverbund.js';
import { createBalanceDisplayEngineApi, buildBalanceRendererPayload } from '../../app/balance/balance-update-pipeline.js';
import { projectNextYearBudget } from '../../app/balance/balance-next-year-budget.js';
import { UIRenderer, initUIRenderer } from '../../app/balance/balance-renderer.js';
import { summarizeBalanceAction } from '../../app/balance/balance-action-summary.js';

export const clean = text => String(text).replaceAll('\u00a0', ' ').replaceAll('\u202f', ' ');

async function freshArea(records) {
    P.resetPersistenceForTests({ name: 'wt-1-synthetic', loadAll: async () => ({ ...records }),
        async saveBatch(batch) { batch.deletes.forEach(key => delete records[key]); batch.upserts.forEach(([key, value]) => { records[key] = value; }); },
        writeSnapshot: async () => {}, readSnapshot: async () => null, listSnapshots: async () => [], deleteSnapshot: async () => true });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
}

/** Registry ändern und den aktiven Personenspiegel nachziehen. @param {Record<string, string>} records @param {(registry: any)=>void} change */
export function editRegistry(records, change) {
    const registry = JSON.parse(records.rs_profiles_v1);
    change(registry);
    const active = registry.profiles[records.rs_current_profile].data;
    records.profile_tagesgeld = active.profile_tagesgeld; records.depot_tranchen = active.depot_tranchen;
    records.rs_profiles_v1 = JSON.stringify(registry);
    return records;
}

/** Kauf wie nach „Buchungen eintragen“: Tagesgeld weniger, neue Aktientranche mit Kaufdatum im Planjahr. */
export function withPurchases(records, purchases, cash = {}) {
    return editRegistry(records, registry => {
        for (const [profileId, value] of Object.entries(cash)) registry.profiles[profileId].data.profile_tagesgeld = String(value);
        for (const [index, { profileId, amount }] of purchases.entries()) {
            const data = registry.profiles[profileId].data, tranches = JSON.parse(data.depot_tranchen);
            const lot = tranches.find(item => item.category === 'equity');
            tranches.push({ ...lot, trancheId: `${profileId}_wt1_kauf_${index}`, shares: amount / lot.currentPrice, purchasePrice: lot.currentPrice, purchaseDate: '2026-10-20',
                ...('marketValue' in lot ? { marketValue: amount } : {}) });
            data.profile_tagesgeld = String(Number(data.profile_tagesgeld) - amount);
            data.depot_tranchen = JSON.stringify(tranches);
        }
    });
}

/** Balance-Überblick rendern. Gibt die Texte der Karte, Reserven und Vorschau zurück, dazu das Testdokument. */
export async function renderCard(records, date = '2026-10-23') {
    await freshArea({ ...records });
    setAppTestDate(date);
    const storage = annualRecordStorage(records), api = createBalanceDisplayEngineApi(EngineAPI);
    const calculation = buildBalanceEngineInputFromStorage({ storage }), plan = calculation.householdPlan;
    const evaluation = evaluateBalanceFileInputs({ inputData: calculation.inputData, persistentState: calculation.history.persistentState,
        profiles: calculation.history.profiles, profileId: records.rs_current_profile, engineApi: api, publish: false,
        planInputs: plan.entry.values, marketPreviewContext: { calculation, storage },
        profilverbundHandlers: { runProfilverbundProfileSimulations: (input, profiles, state) => evaluateStoredAnnualHousehold(input, profiles, state,
            { engineApi: api, publish: false, withdrawalMode: plan.entry.values.householdWithdrawalMode }) } });
    const entriesOf = runs => runs?.map(run => ({ profileId: run.profileId, name: run.name, action: run.ui.action, input: run.input,
        spending: run.ui.spending, targetLiquidity: run.ui.zielLiquiditaet })) || null;
    const current = { ...buildBalanceRendererPayload(evaluation.modelResult, evaluation.previewInputData || calculation.inputData),
        profileActionResults: entriesOf(evaluation.profilverbundRuns) };
    const next = projectNextYearBudget({ storage, engineApi: api, now: () => new Date(`${date}T12:00:00`) });
    const projected = next.displayEvaluation;
    const doc = new MockDocument(), saved = { document: globalThis.document, window: globalThis.window };
    globalThis.document = doc; globalThis.window = { document: doc };
    try {
        const outputs = new Proxy({}, { get: (_, key) => typeof key === 'string' ? doc.getElementById(key) : undefined, has: () => true });
        initUIRenderer({ outputs, inputs: {}, containers: {} }, { loadState: () => ({}) });
        UIRenderer.render({ ...buildBalanceRendererPayload(projected?.modelResult || evaluation.modelResult,
            projected ? { ...projected.inputData, referenceYear: next.targetYear } : calculation.inputData), nextYearBudget: next,
            currentYear: current, profileActionResults: entriesOf(projected?.profilverbundRuns) });
        const read = id => clean(doc.getElementById(id).textContent);
        const recalculated = summarizeBalanceAction(current.action, current.action, current.profileActionResults);
        return { values: read('balanceReserveValues'), card: read('balanceAnnualAction'), credit: read('balanceReserveCreditNote'),
            refill: doc.getElementById('balanceCashRefill').hidden ? '' : read('balanceCashRefill'), reserveTarget: read('balanceReserveTarget'),
            preview: read('balanceActionPreviewTitle'), market: doc.getElementById('balanceMarketPreview').hidden ? '' : read('balanceMarketPreviewBody'),
            verb: recalculated.verb, amount: recalculated.amount, doc, next };
    } finally { Object.assign(globalThis, saved); P.resetPersistenceForTests(); setAppTestDate(null); }
}
