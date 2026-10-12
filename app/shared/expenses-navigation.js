import { initializeProfilePage, whenProfileDisplayReady } from '../profile/profile-navigation.js';
import { exportProfilesBundleToWindowName } from '../profile/profile-storage.js';
import { PersistenceFacade } from './persistence-facade.js';
import { getPageNavigationGuard } from './navigation-guard-dialog.js';
import { getProbelaufController } from './probelauf-state.js';

/** Dieselbe strenge Parametergrammatik wie die bisherigen Überblicksziele. */
export function parseExpensesTarget(location) {
    const target = (location?.hash || '').slice(1);
    const params = new URLSearchParams(location?.search || '');
    if (target && !['ausgaben', 'ausgaben-import'].includes(target)) return null;
    if (!target && !params.has('year')) return null;
    if ([...params.keys()].some(key => !['year', 'month'].includes(key))
        || params.getAll('year').length > 1 || params.getAll('month').length > 1) return null;
    const year = params.get('year'), month = params.get('month');
    if (year !== null && (!/^[1-9]\d{3}$/.test(year) || Number(year) < 1900)) return null;
    if (month !== null && (year === null || !/^(?:[1-9]|1[0-2])$/.test(month))) return null;
    return { target: target || 'ausgaben', year: year === null ? null : Number(year), month: month === null ? null : Number(month) };
}

export function expensesHref({ target = 'ausgaben', year = null, month = null } = {}) {
    const query = new URLSearchParams();
    if (year !== null) query.set('year', String(year));
    if (month !== null) query.set('month', String(month));
    return 'Ausgaben.html' + (query.size ? '?' + query : '') + '#' + target;
}

/** Nur tatsächliche Ausgabenziele übertragen; Plan-/Abschlussziele behalten ihren Ort. */
export function expensesDestination(href) {
    if (!/^Balance\.html(?:[?#]|$)/.test(href || '')) return href;
    const url = new URL(href, 'https://suite.invalid/');
    const request = parseExpensesTarget(url);
    return request ? expensesHref(request) : href;
}

export async function navigateExpenses(request, { doc = globalThis.document, win = doc?.defaultView || globalThis.window,
    replace = false, guard = getPageNavigationGuard(doc, win),
    ready = async () => await initializeProfilePage({ doc, win }) && await whenProfileDisplayReady(doc),
    beforeLeave = async () => true, flush = () => PersistenceFacade.flush(), exporter = exportProfilesBundleToWindowName } = {}) {
    let attempt, navigated = false, exported = false;
    const previousName = win.name;
    try {
        // Bootstrap vor der Navigation: eine notwendige Migration besitzt ihren eigenen Guard.
        if (!await ready() || win.__profileRecoveryBlocker || win.__personMigrationDeferred || PersistenceFacade.hasSyncWriteBlocks()) return false;
        if (!await beforeLeave()) return false;
        attempt = await guard.prepare();
        if (!attempt) return false;
        if (!getProbelaufController(doc)?.state) {
            exported = true;
            if (await exporter() === false) throw new Error('PROFILE_HANDOFF_EXPORT_FAILED');
        }
        if (await flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
        if (!guard.validate(attempt)) return false;
        navigated = guard.commitNavigation(attempt, () => {
            const href = expensesHref(request);
            if (replace) win.location.replace(href);
            else win.location.href = href;
        });
        return navigated;
    } catch {
        const status = doc.getElementById('suiteNavigationStatus');
        if (status) { status.hidden = false; status.textContent = 'Ausgaben konnten nicht geöffnet werden. Bitte den Speicherabschluss prüfen und erneut versuchen.'; }
        return false;
    } finally {
        if (!navigated) {
            if (exported) win.name = previousName;
            if (attempt) guard.end(attempt);
        }
    }
}

/** Lesende Ankunft: Jahr übernehmen, Monat/Importaktion fokussieren, kein Dateidialog. */
export function applyExpensesTarget(controller, location, doc = globalThis.document) {
    const request = parseExpensesTarget(location);
    if (!request) { controller.cancelTarget?.(); return false; }
    if (controller.applyTarget) return controller.applyTarget(request);
    if (request.year !== null) controller.selectYear(request.year);
    const selector = request.month !== null
        ? `button[data-action="${request.target === 'ausgaben-import' ? 'import' : 'details'}"][data-month="${request.month}"]`
        : null;
    const enabled = node => node && !node.disabled ? node : null;
    const target = enabled(selector && doc.getElementById('expensesTable')?.querySelector(selector))
        || enabled(request.month !== null && doc.getElementById('expensesTable')?.querySelector(`button[data-action="import"][data-month="${request.month}"]`))
        || doc.getElementById('expensesYearSegments');
    if (target) { target.scrollIntoView?.({ block: 'center' }); target.focus?.(); }
    return true;
}
