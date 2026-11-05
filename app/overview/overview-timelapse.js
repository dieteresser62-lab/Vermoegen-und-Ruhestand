/** @import * as O from "../../typcheck/overview-ui.js" */
import { appNow } from '../shared/app-clock.js';
import { PersistenceFacade as P, persistenceStorage as storage } from '../shared/persistence-facade.js';
import { liveCashData, captureCashPeople } from '../profile/profile-cash-update.js';
import { projectOverviewFromRecords } from './overview-model.js';
import { createCashProposals } from './overview-cash-proposal.js';
import { storeMonthProvision } from './overview-storage.js';
import { canRunTimeLapse } from '../shared/probelauf-timelapse.js';
import { EXAMPLE_SOURCE, generateExampleExpensesCsv, resolveExampleExpensesBasis, resolveExampleExpensesFloor } from '../demo/beispielausgaben.js';
import { importExpenses } from '../balance/balance-expenses-import.js';
import { createAnnualCoordinator, createAnnualNavigationLifecycle } from '../shared/annual-coordinator.js';
import { createAnnualMonthSession, confirmAnnualMonthSummary } from '../shared/annual-close-session.js';
import { commitAnnualPlanUpdate } from '../balance/balance-annual-storage-commit.js';
import { preparePlayAction, commitPlayAction, preparePlayCredit, pendingPlayActions } from '../balance/balance-play-execution.js';
import { ActionRenderer } from '../balance/balance-renderer-action.js';
import { createNavigationOperationLifecycle } from '../shared/navigation-guard.js';
import { CONFIG } from '../balance/balance-config.js';

/** Automatisierte Eingaben, dieselben Import-, Abschluss- und Erfassungsdienste wie von Hand. */
/** @param {{controller?: ReturnType<typeof import("../shared/probelauf-state.js").getProbelaufController>, guard?: object, win?: Window & typeof globalThis}} [options]
 * @returns Dienste für Vorbereitung, Abschluss und Ausführung im Zeitraffer.
 */
export function createTimeLapseServices({ controller, guard = null, win = globalThis.window } = {}) {
    const model = () => projectOverviewFromRecords({ registry: JSON.parse(storage.getItem('rs_profiles_v1')),
        activeId: storage.getItem('rs_current_profile'), liveData: liveCashData(storage), now: appNow() });
    const requirePlay = () => { if (!canRunTimeLapse(controller) || controller.state.testDate === null) throw new Error('Zeitraffer braucht ein bestätigtes Testdatum im Spielbereich.'); };
    const actionLifecycle = createNavigationOperationLifecycle({ guard });
    const cashFor = (next, targetYear = null) => {
        const people = captureCashPeople({ ids: next.scope.ids, activeId: next.activeId });
        const proposals = createCashProposals({ controller, model: next, people, targetYear });
        for (const person of people) if (proposals[person.id]?.error || !Number.isFinite(proposals[person.id]?.value)) {
            throw new Error(`${person.name}: ${proposals[person.id]?.error || 'Tagesgeld-Vorschlag fehlt.'}`);
        }
        return { people, values: Object.fromEntries(people.map(person => [person.id, proposals[person.id].value])), playValues: proposals };
    };
    return {
        async preparePeriod() {
            requirePlay();
            let next = model();
            if (!next.available || next.recovery) throw new Error('Haushalt oder Abschlussstand ist nicht sicher lesbar.');
            if (pendingPlayActions().length) throw new Error('Zuerst die offene Spielgutschrift in Balance bestätigen.');
            const annual = next.occasion.kind === 'annual';
            const { previousYear: year, previousMonth: month } = next.occasion;
            const label = annual ? `Jahr ${year}` : new Date(year, month - 1, 1).toLocaleDateString('de-DE', { month: 'long' });
            if (next.occasion.kind === 'play') return { label, skipped: true };
            if (!['monthly', 'annual'].includes(next.occasion.kind)) throw new Error('Der anstehende Abschluss muss zuerst von Hand geklärt werden.');
            const ids = next.scope.ids;
            const basis = resolveExampleExpensesBasis({ year, ids, budget: next.expenseBudget });
            const result = await /** @type {O.ImportExpenses} */ (importExpenses)({ controller, guard, win,
                targets: ids.map(profileId => ({ profileId, year, month, source: EXAMPLE_SOURCE,
                    text: async () => generateExampleExpensesCsv({ controller, ids, profileId, year, month, basis, floorMonthly: resolveExampleExpensesFloor({ ids }) }) })), confirm: async () => true });
            if (result.status !== 'saved') throw new Error(result.results?.find(item => !item.ok)?.error?.message || 'Beispielausgaben wurden nicht vollständig gespeichert.');
            next = model();
            const targetYear = annual ? next.occasion.closingYear : null;
            return { annual, label: annual ? `Jahr ${targetYear}` : label, year: targetYear ?? year,
                month: next.occasion.month, model: next, cash: cashFor(next, targetYear) };
        },
        async closePeriod(period) {
            requirePlay();
            if (period.skipped) return;
            const next = period.model;
            if (!period.annual) {
                const ok = await storeMonthProvision({ month: period.month, scope: next.scope, expectedProfileId: next.activeId, cash: period.cash }, { guard });
                if (!ok) throw new Error('Monatsabschluss wurde nicht dauerhaft bestätigt.');
                return;
            }
            /** @type {Awaited<ReturnType<typeof commitAnnualPlanUpdate>>} */
            let committed;
            const coordinator = createAnnualCoordinator({
                navigationLifecycle: createAnnualNavigationLifecycle({ guard, flush: () => P.flush() }),
                commit: async options => { committed = await commitAnnualPlanUpdate(options); return committed; }
            });
            const result = await coordinator.close({ confirmedPreparation: { cash: period.cash } });
            if (result.status !== 'already_committed' || !result.results?.confirmed || !committed) {
                throw result.error || new Error(result.errors?.map(error => error.message).join(' ') || 'Jahresabschluss wurde nicht bestätigt.');
            }
            const session = await /** @type {O.CreateMonthSession} */ (createAnnualMonthSession)({ targetYear: period.year, annualSnapshotId: result.snapshotId,
                cash: period.cash, readModel: model, guard,
                readPending: () => JSON.parse(storage.getItem(CONFIG.STORAGE.LS_KEY)).annualPeriodMetadata?.pendingCommit,
                confirmSummary: () => /** @type {O.ConfirmMonthSummary} */ (confirmAnnualMonthSummary)({ targetYear: period.year, scope: model().scope, expectedProfileId: next.activeId }) });
            if (!await session.save()) throw new Error('Jahr gespeichert; Dezemberabschluss wurde nicht bestätigt.');
            // Exakt die soeben festgeschriebenen Profilaktionen, keine unterjährige Neuberechnung.
            const { result: calculation } = /** @type {Extract<Awaited<ReturnType<typeof commitAnnualPlanUpdate>>, {result: unknown}>} */ (committed);
            period.actions = calculation.profilverbundRuns?.map(run => ({ profileId: run.profileId, name: run.name, input: run.input,
                action: run.ui.action, spending: run.ui.spending, targetLiquidity: run.ui.zielLiquiditaet }))
                || [{ profileId: next.activeId, input: calculation.inputData, action: calculation.modelResult.ui.action,
                    spending: calculation.modelResult.ui.spending, targetLiquidity: calculation.modelResult.ui.zielLiquiditaet }];
            period.actions = new ActionRenderer({}).prepareExecutionEntries(period.actions, calculation.modelResult.ui.zielLiquiditaet);
        },
        async executeAction(period) {
            requirePlay();
            const actions = period.actions;
            if (!actions?.some(entry => entry.action.quellen?.some(source => source.kind !== 'liquiditaet' && source.brutto > 0)
                || ['aktien', 'gold', 'bonds', 'geldmarkt'].some(key => entry.action.verwendungen?.[key] > 0))) return;
            const blocked = actions.filter(entry => entry.action?.automaticExecutionBlocked);
            const executable = actions.filter(entry => !entry.action?.automaticExecutionBlocked);
            const entries = executable.length ? executable : actions;
            const profiles = JSON.parse(storage.getItem('rs_profiles_v1')).profiles;
            period.executionNotice = blocked.map(entry => `${entry.name || profiles[entry.profileId]?.meta.name || entry.profileId}: ausgelassen – ${entry.action.automaticExecutionBlocked}`).join('; ');
            await actionLifecycle.run({}, async operation => {
                const prepared = await preparePlayAction({ controller, entries });
                await commitPlayAction(prepared, { controller, navigationOperation: operation });
                if (pendingPlayActions().some(batch => batch.id === prepared.batch.id)) {
                    const credit = await preparePlayCredit(prepared.batch.id, { controller });
                    await commitPlayAction(credit, { controller, navigationOperation: operation });
                }
            });
        }
    };
}
