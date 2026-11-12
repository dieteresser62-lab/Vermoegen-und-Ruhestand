/** FR-73 Punkt 10: Hinweis bei Pflegegrad heute in Balance, Personenkarte und Haushalt & Plan. Die App rechnet
 * Pflegekosten selbst; Grundbedarf und Flex gehören ohne Pflege in den Plan. Beträge je Person stammen aus
 * derselben Bedarfsfunktion und Bedarfsbasis wie in Balance und Simulator, mit oder ohne bestätigten Plan
 * (Gutachten PFA-4, Befund 4); „Erledigt“ schreibt den Haushaltsrecord. */
import { persistenceStorage } from './persistence-facade.js';
import { appNow } from './app-clock.js';
import { formatDisplayNumber } from './designsystem-number-format.js';
import { readHouseholdPersonStatus, balanceCareSettings } from './person-data-status.js';
import { careHintDone, markCareHintDone } from './household-care-hint.js';
import { readBalanceHouseholdPlan } from '../profile/household-plan.js';
import { careTodayFromRecord } from '../profile/profile-care.js';
import { projectBalanceCareNeeds, careHintPersons } from '../balance/balance-care.js';
import { readStoredBalanceCareBase } from '../balance/balance-input-storage.js';
export { careHintPersons };

export const CARE_HINT_TEXT = 'Die App rechnet Pflegekosten jetzt selbst. Trage Grundbedarf und Flex ohne Pflege ein – für den ganzen Haushalt, so als lebten alle zu Hause.';
/** Hosts der Personen-&-Vermögen-Seite, die denselben Hinweis zeigen. */
export const CARE_HINT_HOST_IDS = Object.freeze(['profileCareHint', 'managerPlanCareHint']);

/** Hinweiszustand des Haushalts: erledigt, oder die Personen mit Pflegegrad heute samt Betrag.
 *
 * @param {{storage?: import("../../typcheck/datenvertraege.js").RecordReader, status?: object, now?: Date}} [options]
 * @returns {{done: boolean, persons: ReturnType<typeof careHintPersons>}} Ohne Pflegegrad heute eine leere Liste.
 */
export function projectCareHint({ storage = persistenceStorage, status = readHouseholdPersonStatus({ storage }), now = appNow() } = {}) {
    if (careHintDone(storage)) return { done: true, persons: [] };
    if (!status?.ready || status.status === 'demo' || !status.entries?.length) return { done: false, persons: [] };
    const settings = balanceCareSettings(status);
    const graded = status.entries.map(entry => ({ profileId: entry.profileId, name: entry.name || entry.profileId, care: careTodayFromRecord(entry.data, settings) }))
        .filter(entry => entry.care.grade > 0);
    if (!graded.length) return { done: false, persons: [] };
    let needs = null;
    try { needs = projectHouseholdCareNeeds({ storage, status, now }); }
    catch { needs = null; } // Scheitert die Projektion, nennt der Hinweis die Personen ohne Betrag.
    return { done: false, persons: needs ? careHintPersons(needs) : graded.map(entry => ({ profileId: entry.profileId, name: entry.name, grade: entry.care.grade,
        residential: entry.care.form === 'residential', own: entry.care.form !== 'residential' && settings.preset !== 'amtlich' && Number.isFinite(entry.care.homeCostsMonthly), monthly: null })) };
}

/** Heutige Pflegekosten des Haushalts wie in der Balance: Bedarfsbasis aus dem bestätigten Plan, sonst die gespeicherte
 * Bedarfsbasis; der Betrag hängt nicht am Planstatus. Liest nur; auch Personen & Vermögen › Pflege zeigt diese Projektion.
 *
 * @param {{storage: import("../../typcheck/datenvertraege.js").RecordReader, status: object, now?: Date, profileId?: string|null}} options
 * @returns {ReturnType<typeof projectBalanceCareNeeds>} Projektion oder null ohne Pflegegrad heute.
 */
export function projectHouseholdCareNeeds({ storage, status, now = appNow(), profileId = null }) {
    // UR-1d: Mit profileId gilt der Plan aus dem Bereich dieser Person (Außenperson: ihr Einzelplan); ohne bestätigten Plan keine Projektion.
    const plan = readBalanceHouseholdPlan({ storage, ...(profileId ? { profileId } : {}) });
    if (profileId && plan.status !== 'valid') return null;
    const values = plan.status === 'valid' ? plan.entry.values : readStoredBalanceCareBase(storage);
    return projectBalanceCareNeeds({ status, storage, values, referenceYear: status.referenceYear, now });
}

const euro = value => formatDisplayNumber(value, { unit: 'currency', fractionDigits: 0 });

/** Bestehendes Hinweismuster (ds-note) mit Text, Beträgen je Person und Knopf „Erledigt“.
 *
 * @param {HTMLElement|null} host Host mit Klasse ds-note und data-care-hint.
 * @param {{done: boolean, persons: ReturnType<typeof careHintPersons>}|null} hint Zustand aus {@link projectCareHint}.
 * @param {{except?: string|null}} [options] Profil-ID der Person, deren Betrag schon daneben steht (Pflegeband der Personenkarte).
 * @returns {boolean} Ob der Hinweis sichtbar ist.
 */
export function renderCareHint(host, hint, { except = null } = {}) {
    if (!host) return false;
    const show = Boolean(hint) && !hint.done && hint.persons.length > 0;
    host.hidden = !show;
    if (!show) { host.replaceChildren(); return false; }
    const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const where = person => person.residential ? ' im Heim' : person.own ? ' zu Hause, eigener Wert' : ' zu Hause, Staffel';
    const line = person => `${person.residential ? 'Heim' : 'Pflege'} ${escape(person.name)}: ${person.monthly === null ? 'Betrag noch nicht berechenbar'
        : `${escape(euro(person.monthly))}/Monat`} (Grad ${person.grade}${where(person)})`;
    // UR-1b: Auf der Personenkarte nennt das Pflegeband darunter den Betrag der angezeigten Person; der Hinweis wiederholt ihn nicht.
    // UR-1d: Ausschluss über die Profil-ID; namensgleiche andere Profile bleiben stehen.
    const amounts = hint.persons.filter(person => except === null || person.profileId !== except).map(line).join(' · ');
    host.innerHTML = `<p>${CARE_HINT_TEXT}</p>${amounts ? `<p class="ds-help">Angesetzt: ${amounts}</p>` : ''}<div class="ds-actions"><button type="button" class="ds-button ds-button-secondary" data-care-hint-done>Erledigt</button></div>`;
    return true;
}

/** Personenkarte und Haushalt & Plan zeigen denselben Hinweis aus einer Projektion des gespeicherten Stands; nach
 * jeder gespeicherten, bedarfsrelevanten Änderung neu aufrufen (Gutachten PFA-3, Befund 2).
 *
 * @param {Document|{getElementById: (id: string) => HTMLElement|null}} doc Seite mit den Hinweis-Hosts.
 * @param {{storage?: import("../../typcheck/datenvertraege.js").RecordReader}} [options]
 * @returns {void}
 */
export function refreshCareHints(doc, { storage = persistenceStorage } = {}) {
    const hosts = CARE_HINT_HOST_IDS.map(id => doc?.getElementById?.(id)).filter(Boolean);
    if (!hosts.length) return;
    let hint = null;
    try { hint = projectCareHint({ storage }); } catch { hint = null; }
    let shown = null;
    try { shown = storage.getItem?.('rs_current_profile') || null; } catch { shown = null; }
    for (const host of hosts) renderCareHint(/** @type {HTMLElement} */ (host), hint, host.id === 'profileCareHint' ? { except: shown } : {});
}

const bound = new WeakSet();
/** Genau ein Klick-Anschluss je Host: „Erledigt“ schreibt den Record und blendet den Hinweis aus; weitere Hinweise
 * derselben Seite blendet der Aufrufer über `onDone` aus. Kein Dokumenthandler, damit bestehende Seitenbinder unberührt bleiben.
 *
 * @param {HTMLElement|null} root Hinweis-Host oder ein Container mit Hinweisen.
 * @param {{storage?: import("../../typcheck/datenvertraege.js").RecordWriter, onDone?: () => void}} [options]
 * @returns {void}
 */
export function bindCareHintDone(root, { storage = persistenceStorage, onDone } = {}) {
    if (!root?.addEventListener || bound.has(root)) return;
    bound.add(root);
    root.addEventListener('click', event => {
        const button = /** @type {HTMLButtonElement|null} */ (/** @type {HTMLElement|null} */ (event.target)?.closest?.('[data-care-hint-done]'));
        if (!button || button.disabled) return;
        markCareHintDone(storage);
        const hints = [...(root.hasAttribute?.('data-care-hint') ? [root] : []), ...(root.querySelectorAll?.('[data-care-hint]') || [])];
        for (const hint of hints) renderCareHint(/** @type {HTMLElement} */ (hint), { done: true, persons: [] });
        onDone?.();
    });
}
