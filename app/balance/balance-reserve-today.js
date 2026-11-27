import { buildBalanceEngineInputFromStorage } from './balance-input-storage.js';
import { evaluateBalanceInputs } from './balance-evaluation.js';
import { createProfilverbundHandlers, evaluateStoredAnnualHousehold } from './balance-main-profilverbund.js';
import { createBalanceDisplayEngineApi, buildBalanceRendererPayload, validateBalanceInputs } from './balance-update-pipeline.js';
import { postprocessBalanceAction } from './balance-action-postprocessor.js';
import { projectBalanceReserves, displayedReserveView, confirmedActionSource } from './balance-reserves.js';
import { reserveActionSource, prepareReserveSource } from './balance-reserve-source.js';
import { projectAnnualTodoPlan } from './annual-todo.js';
import { annualActionPlanLines } from './annual-action-progress.js';
import { balancePurchaseTotal } from './balance-action-summary.js';
import { buyFlowPlanFromConfirmed } from '../tranches/buy-flow-dialog.js';

/** GN-2c: Laufendes Jahr wie in der Balance (heutige Bestände, Tageskurse, Haushaltsrechnung), ohne Schreiben und ohne Seite.
 * Dieselben Leser und dieselbe Rechnung wie `balance-main.js`; nur gelesen, nichts veröffentlicht.
 * @param {{storage: import("../../typcheck/datenvertraege.js").RecordStorage, engineApi: any, profileId: string|null}} options
 * @returns {any} `currentYear` wie für `UIRenderer.render`, ohne Alter `null`. */
export function evaluateBalanceCurrentYear({ storage, engineApi, profileId }) {
    const calculation = buildBalanceEngineInputFromStorage({ storage });
    // GN-2e: dieselben Vorbedingungen wie `balance-main.js`. Ohne Alter (frischer Haushalt) rechnet die Balance nicht; die Übersicht
    // ruft die Engine dann auch nicht auf und zeigt „—“. Ungültige Eingaben werfen hier, bevor die Engine sie meldet.
    validateBalanceInputs(calculation.inputData);
    if (!calculation.inputData.aktuellesAlter) return null;
    const plan = calculation.householdPlan, api = createBalanceDisplayEngineApi(engineApi);
    const withdrawalMode = plan.status === 'valid' ? plan.entry.values.householdWithdrawalMode : storage.getItem('household_withdrawal_mode') || 'tax_optimized';
    const evaluation = evaluateBalanceInputs({ inputData: calculation.inputData, persistentState: calculation.history.persistentState,
        profiles: calculation.history.profiles, profileId, engineApi: api, publish: false,
        planInputs: plan.status === 'valid' ? plan.entry.values : calculation.inputData, marketPreviewContext: { calculation, storage },
        profilverbundHandlers: { runProfilverbundProfileSimulations: (input, profiles, state) => evaluateStoredAnnualHousehold(input, profiles, state,
            { engineApi: api, withdrawalMode }) } });
    const { modelResult, profilverbundRuns } = evaluation;
    const input = evaluation.previewInputData || calculation.inputData;
    postprocessBalanceAction({ modelResult, profilverbundRuns, mergeProfilverbundActions: createProfilverbundHandlers({}).mergeProfilverbundActions });
    return { ...buildBalanceRendererPayload(modelResult, input),
        profileActionResults: profilverbundRuns?.map(run => ({ profileId: run.profileId, name: run.name, action: run.ui.action, input: run.input,
            spending: run.ui.spending, targetLiquidity: run.ui.zielLiquiditaet }))
            || [{ profileId, action: modelResult.ui.action, input, spending: modelResult.ui.spending, targetLiquidity: modelResult.ui.zielLiquiditaet }] };
}

/** GN-2c (Ergänzung 3 FR-78): Deckung heute und nach Umsetzung genau wie „Deine Reserven“, für beide Spalten der Übersicht.
 * - Vorschau: heutige Handlung ohne Beleg, wie die Balance ohne Beleg.
 * - Plan: Handlung des Belegs (offener Rest) auf heutige Bestände, mit dem Plan des Belegs; nie die heutige Handlung. Ein Beleg
 *   ohne Verkaufszeilen hat keinen Umsetzungsstand: Er gilt nur, solange der heute gerechnete gesamte Kauf um weniger als 1 € von seinem
 *   Kauf abweicht (GN-2d, Fable P2-1); sonst, etwa nach einem teilweise gebuchten Kauf, bleibt die Spalte ohne Wert.
 * Ziel und persönliche Tagesgeldziele kommen aus `currentYear` wie in der Balance.
 * @param {any} currentYear aus `evaluateBalanceCurrentYear`
 * @param {{confirmed?: any, people?: {id: string, name?: string}[]}} [receipt] Beleg samt Umsetzungsstand
 * @returns {{plan: {today: number|null, after: number|null}|null, preview: {today: number|null, after: number|null}}} */
export function balanceReserveCoverages(currentYear, { confirmed = null, people = [] } = {}) {
    const reserves = (/** @type {ReturnType<typeof prepareReserveSource>} */ result) => projectBalanceReserves(currentYear, result.prepared,
        { action: result.source.action, targetEntries: result.source.targetEntries, settled: result.source.settled });
    const today = reserveActionSource(currentYear, null);
    const preview = displayedReserveView(reserves(today), null).coverage;
    let plan = null;
    if (confirmed?.action) {
        try {
            const unchanged = annualActionPlanLines(confirmed.action).length > 0
                // GN-2d Nachtrag 1: der gesamte Kauf (Gold + Aktien + Anleihen), nicht nur die Hauptzeile.
                || Math.abs(balancePurchaseTotal(today.source.action, today.prepared) - balancePurchaseTotal(confirmed.action)) < 1;
            const members = confirmed.people || people, todo = projectAnnualTodoPlan({ confirmed, people: members });
            // VK-3d P4: Ein reiner Kaufplan fließt wie in der Balance mit der Summe der angezeigten Zeilen je Person ab.
            const buyPlan = todo && !todo.rows.length && todo.purchases.length ? buyFlowPlanFromConfirmed(confirmed, members.map(person => person.id),
                { profiles: Object.fromEntries(members.map(person => [person.id, { meta: { name: person.name } }])) }, confirmed.withdrawalMode || '') : null;
            if (todo && buyPlan) /** @type {any} */ (todo).buyFlow = { lines: buyPlan.lines };
            plan = unchanged ? displayedReserveView(reserves(prepareReserveSource(currentYear, confirmedActionSource(currentYear, confirmed))), todo).coverage : null;
        } catch { plan = null; }
    }
    return { plan, preview };
}
