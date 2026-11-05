import { renderManagerPartnership } from './tranchen-manager-partnership.js';
import { immobilienIncome } from '../profile/profile-immobilien.js';
import { fixedMonthlyIncome } from '../profile/profile-income.js';
import { renderManagerWealthHistory } from './tranchen-history-closures.js';
import { getManagerView } from './tranchen-manager-renderer.js';
import { appNow } from '../shared/app-clock.js';
import { personAge, personReferenceYear, describePersonDates, projectPersonPension, personDateDisplay } from '../profile/profile-person-data.js';
import { projectProfileWealthHistory } from '../profile/profile-wealth-history.js';
import { projectHistoryRecovery } from './tranchen-history-recovery.js';
import { readManagerHistoryContext } from './tranchen-history-ui.js';
import { bindInfoPopovers } from '../shared/designsystem-info-popover.js';
import { syncManagerCareToday } from './tranchen-manager-care.js';
import { loadProfileRegistry, getHouseholdPrimaryProfileId, householdMemberCount, HOUSEHOLD_LIMIT_REASON, HOUSEHOLD_MINIMUM_REASON } from '../profile/profile-registry.js';
import { loadProfileAssetValues, validateProfileAssetValues } from '../profile/profile-asset-values.js';
import { PROFILE_VALUE_KEYS, loadProfileHealthBucketFromData, loadStoredBalanceStateFromData } from '../profile/profile-state.js';
import { loadTranchesFromStorage, calculateTrancheDerivedValues } from './tranchen-manager-state.js';
import { renderManagerProfiles } from './tranchen-manager-renderer.js';
import { bindManagerAuxiliaryDialog, openManagerAuxiliaryDialog, closeManagerAuxiliaryDialog, confirmManagerModalBaseline } from './tranchen-manager-modal.js';
import { escapeHtml } from '../shared/security-utils.js';

/** Monatsanzeige ohne Indexierung oder Steuerrechnung; Beginnmonat zählt vollständig. */
function projectCurrentIncome(data, values, now, name) {
    const year = now.getFullYear(), month = now.getMonth() + 1;
    const pension = projectPersonPension({ ...data, profile_rente_monatlich: values.renteMonatlich,
        }, year);
    const future = pension.beginning.status === 'valid'
        && (pension.beginning.year > year || pension.beginning.year === year && pension.beginning.month > month);
    const missing = pension.renteMonatlich > 0 && pension.beginning.status === 'missing' && pension.renteStartOffsetJahre > 0;
    const running = pension.monateImJahr > 0 && month >= 13 - pension.monateImJahr;
    const status = missing ? 'Rentenbeginn fehlt' : future ? `ab ${personDateDisplay(pension.beginning.value)}` : 'im Monat';
    const pensionStatus = missing ? 'Rentenbeginn fehlt' : pension.beginning.status === 'valid'
        ? `${future ? 'Rente ab' : 'Rente läuft seit'} ${personDateDisplay(pension.beginning.value)}`
        : pension.renteMonatlich > 0 ? 'Ohne Rentenbeginn zählt die Rente als bereits laufend. Läuft sie noch nicht, bitte Beginn eintragen.' : '';
    const currentMonth = `${year}-${String(month).padStart(2, '0')}`;
    const changes = [];
    for (const entry of values.einkuenfte || []) if (entry.art === 'sonstige') {
        if (entry.ab && entry.ab > currentMonth) changes.push({ month: entry.ab, amount: entry.betragMonat, reason: `${entry.bezeichnung || 'Einkunft'} beginnt` });
        if (entry.bis && entry.bis >= currentMonth) {
            const date = new Date(`${entry.bis}-01T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + 1);
            changes.push({ month: date.toISOString().slice(0, 7), amount: -entry.betragMonat, reason: `${entry.bezeichnung || 'Einkunft'} endet` });
        }
    }
    return { income: fixedMonthlyIncome([...(values.einkuenfte || []), ...immobilienIncome(values.immobilien || [])], currentMonth) + (running ? pension.renteMonatlich : 0), changes, status, pensionStatus,
        future: future && pension.renteMonatlich > 0 ? { month: pension.beginning.value.slice(0, 7), amount: pension.renteMonatlich, reason: `${data.profile_rente_bezeichnung || 'Rente'} ${name || ''}`.trim() + ' beginnt' } : null,
        missing };
}

function upcomingIncome(profiles) {
    const grouped = new Map();
    for (const profile of profiles) {
        for (const future of [...(profile.currentIncome.changes || []), profile.currentIncome.future].filter(Boolean))
            {
            const stage = grouped.get(future.month) || { amount: 0, reasons: [] };
            stage.amount += future.amount; stage.reasons.push(future.reason || profile.name || 'Einkunft');
            grouped.set(future.month, stage);
        }
    }
    let income = profiles.reduce((sum, profile) => sum + profile.income, 0);
    return [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([month, stage]) => ({ month, income: income += stage.amount, reason: stage.reasons.join(' · ') }));
}

/**
 * @typedef {object} ManagerProfileProjection
 * @property {string} id
 * @property {string} name
 * @property {boolean} active
 * @property {boolean} belongs
 * @property {boolean} valid
 * @property {ReturnType<typeof validateProfileAssetValues>} [values]
 * @property {ReturnType<typeof projectCurrentIncome>} [currentIncome]
 * @property {ReturnType<typeof upcomingIncome>} [incomeSteps]
 * @property {ReturnType<typeof describePersonDates>} [personDates]
 * @property {number} [income]
 * @property {number} [assets]
 * @property {number} [cost]
 * @property {number} [gain]
 * @property {number} [count]
 * @property {number} [careTarget]
 * @property {Record<string, number>} [allocation]
 * @property {ReturnType<typeof calculateTrancheDerivedValues>[]} [tranches]
 * @property {object} [taxState]
 * @property {ReturnType<typeof projectHistoryRecovery>} [historyRecovery]
 * @property {string} [householdRole]
 * @property {ReturnType<typeof projectProfileWealthHistory>} [history]
 */

/** Ausschließlich lesende Projektion; keine Registrywrapper mit Defaultanlage. */
export function projectManagerProfiles(registry, activeId, historyContext = null) {
    const now = appNow();
    const activeBalance = loadStoredBalanceStateFromData(registry.profiles[activeId]?.data || {}).value;
    const referenceYear = personReferenceYear(activeBalance?.annualPeriodMetadata, now);
    /** @type {ManagerProfileProjection[]} */
    const profiles = Object.entries(registry.profiles).map(([id, profile]) => {
        const storage = { getItem: key => profile.data[key] ?? null };
        try {
            const health = loadProfileHealthBucketFromData(profile.data);
            if (['corrupt', 'unavailable'].includes(health.status)) throw new Error('PROFILE_HEALTH_INVALID');
            const balance = loadStoredBalanceStateFromData(profile.data);
            if (['corrupt', 'unavailable'].includes(balance.status)) throw new Error('PROFILE_BALANCE_INVALID');
            const inputs = balance.value?.inputs || {};
            const inputFields = { tagesgeld: 'tagesgeld', renteMonatlich: 'renteMonatlich',
                alter: 'aktuellesAlter', goldZiel: 'goldZielProzent', goldFloor: 'goldFloorProzent', goldRebalBand: 'rebalancingBand' };
            // Der normale Leser besitzt Fallbacks. Explizit gespeicherte Zahlen
            // prüfen wir davor, damit beschädigte Daten keine Vollsumme ergeben.
            for (const [field, key] of Object.entries(PROFILE_VALUE_KEYS)) {
                const raw = profile.data[key] ?? inputs[inputFields[field]];
                if (['tagesgeld', 'renteMonatlich', 'alter', 'goldZiel', 'goldFloor', 'goldRebalBand'].includes(field)
                    && raw != null && (String(raw).trim() === '' || !Number.isFinite(Number(raw)))) {
                    throw new Error('PROFILE_VALUE_INVALID');
                }
            }
            for (const field of ['goldAktiv', 'goldSteuerfrei']) {
                const raw = profile.data[PROFILE_VALUE_KEYS[field]] ?? inputs[field];
                if (raw != null && !['true', 'false'].includes(String(raw).toLowerCase())) throw new Error('PROFILE_BOOLEAN_INVALID');
            }
            const values = validateProfileAssetValues(loadProfileAssetValues(storage));
            values.alter = personAge(profile.data, referenceYear).age;
            const currentIncome = projectCurrentIncome(profile.data, values, now, profile.meta.name);
            const lots = loadTranchesFromStorage(storage);
            if (!lots.tranches) throw new Error('PROFILE_TRANCHES_INVALID');
            const derived = lots.tranches.map(calculateTrancheDerivedValues);
            const market = derived.reduce((sum, lot) => sum + lot.marketValue, 0);
            const cost = derived.reduce((sum, lot) => sum + lot.costBasis, 0);
            const assets = market + values.tagesgeld;
            const allocation = { aktien_alt: 0, aktien_neu: 0, anleihe: 0, geldmarkt: 0, gold: 0, cash: values.tagesgeld };
            for (const lot of derived) allocation[lot.type] += lot.marketValue;
            if (![assets, cost, market].every(Number.isFinite)) throw new Error('PROFILE_TOTAL_INVALID');
            return { id, name: profile.meta.name || id, active: id === activeId,
                belongs: profile.meta.belongsToHousehold !== false, valid: true, values, currentIncome, income: currentIncome.income,
                incomeSteps: upcomingIncome([{ currentIncome, income: currentIncome.income }]), personDates: describePersonDates(profile.data, referenceYear, now),
                assets, cost, gain: market - cost, count: derived.length, allocation, tranches: derived,
                taxState: balance.value?.lastState?.taxState,
                careTarget: values.healthBucket.enabled ? values.healthBucket.initialAmount : 0 };
        } catch {
            return { id, name: profile.meta.name || id, active: id === activeId,
                belongs: profile.meta.belongsToHousehold !== false, valid: false };
        }
    });
    const members = profiles.filter(profile => profile.belongs);
    for (const profile of profiles) profile.historyRecovery = profile.active && profile.valid ? projectHistoryRecovery(registry, profile.id) : [];
    // Dieselbe Reihenfolge wie listProfiles/loadProfilverbundProfiles: das erste
    // Haushaltsmitglied liefert den bestehenden Hauptprofil-/Pflegebezug.
    const primaryId = getHouseholdPrimaryProfileId(members);
    for (const profile of profiles) profile.householdRole = !profile.belongs ? 'Außerhalb Haushalt'
        : profile.id === primaryId ? 'Hauptprofil im Haushalt' : 'Partnerprofil';
    const complete = members.length > 0 && members.length <= 2 && members.every(profile => profile.valid);
    /** @type {{assets: number, cost: number, gain: number, income: number, careTarget: number, allocation: Record<string, number>, incomeSteps?: ReturnType<typeof upcomingIncome>, incomeWarnings?: string[]}} */
    let household = complete ? members.reduce((sum, profile) => ({
        assets: sum.assets + profile.assets, cost: sum.cost + profile.cost, gain: sum.gain + profile.gain,
        income: sum.income + profile.income,
        careTarget: sum.careTarget + profile.careTarget,
        allocation: Object.fromEntries(Object.entries(sum.allocation).map(([key, value]) => [key, value + profile.allocation[key]]))
    }), { assets: 0, cost: 0, gain: 0, income: 0, careTarget: 0,
        allocation: { aktien_alt: 0, aktien_neu: 0, anleihe: 0, geldmarkt: 0, gold: 0, cash: 0 } }) : null;
    if (household && Object.values(household).some(value => typeof value === 'number' && !Number.isFinite(value))) household = null;
    if (household) {
        household.incomeSteps = upcomingIncome(members);
        household.incomeWarnings = members.filter(profile => profile.currentIncome.missing).map(profile => `${profile.name}: Rentenbeginn fehlt`);
        if (household.incomeSteps.some(step => !Number.isFinite(step.income))) household = null;
    }
    let householdHistory = null;
    if (historyContext?.status === 'ready') {
        householdHistory = projectProfileWealthHistory(registry, profiles, historyContext);
        for (const person of profiles) person.history = projectProfileWealthHistory(registry, profiles, { ...historyContext, profileId: person.id });
    }
    return { profiles, complete: household !== null, household, householdHistory, historyContext };
}

export function refreshManagerProfiles(doc, activeId) {
    if (!doc.getElementById('managerSectionNav')) return;
    const loaded = loadProfileRegistry();
    if (!loaded.value) return;
    const projection = projectManagerProfiles(loaded.value, activeId, readManagerHistoryContext(loaded.value));
    renderManagerProfiles(doc, projection);
    const primary = projection.profiles.find(profile => profile.belongs);
    for (const id of ['managerHouseholdSettings', 'managerHouseholdCareSettings']) {
        const hint = doc.getElementById(id);
        if (hint) hint.textContent = primary ? `Für den Haushalt gelten Rentenanpassung und Pflegeeinstellungen von ${primary.name}.` : '';
    }
    renderManagerPartnership(doc, projection);
    renderManagerWealthHistory(doc, projection, loaded.value, activeId, getManagerView(doc));
    bindInfoPopovers(doc);
}

const bindings = new WeakMap();
/** Reiter und Öffnen teilen denselben Handler und genau eine laufende Promise. */
export function bindManagerProfileSwitch(doc, switchPerson) {
    if (bindings.has(doc)) return false;
    const state = { pending: null };
    const handler = event => {
        const button = event.target?.closest?.('[data-manager-profile]') || event.target?.closest?.('[data-manager-view]');
        if (!button || button.disabled) return false;
        event.preventDefault?.();
        if (state.pending) return state.pending;
        state.pending = Promise.resolve().then(() => switchPerson(button.dataset.managerProfile || button.dataset.managerHistoryProfile || null, button))
            .finally(() => { state.pending = null; });
        return state.pending;
    };
    for (const id of ['managerHousehold', 'managerSectionNav', 'managerHistorySwitch', 'managerWealthPersonHint']) doc.getElementById(id)?.addEventListener('click', handler);
    const nav = doc.getElementById('managerSectionNav');
    nav?.addEventListener('keydown', event => {
        const tab = event.target?.closest?.('[role="tab"]');
        if (!tab || tab.disabled) return;
        if (event.key === 'Enter' || event.key === ' ') return handler(event);
        const tabs = Array.from(nav.querySelectorAll('[role="tab"]')).filter(button => !button.disabled);
        const index = tabs.indexOf(tab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
            : event.key === 'ArrowRight' ? (index + 1) % tabs.length
            : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length : -1;
        if (next < 0) return;
        event.preventDefault();
        tabs.forEach((button, i) => button.setAttribute('tabindex', i === next ? '0' : '-1'));
        tabs[next]?.focus();
    });
    bindings.set(doc, state);
    return true;
}

const peopleBindings = new WeakMap();
export function renderManagerPeople(doc, activeId) {
    const loaded = loadProfileRegistry();
    const host = doc.getElementById('managerPeopleList');
    if (!host || !loaded.value) return;
    const count = householdMemberCount(loaded.value);
    const full = count >= 2;
    const introduction = doc.getElementById('managerPeopleCreateHint');
    if (introduction) introduction.hidden = full;
    const create = doc.getElementById('managerPersonCreateBtn');
    if (create) create.hidden = full;
    const form = doc.getElementById('managerPeopleForm');
    if (form && doc.getElementById('managerPersonRenameBtn')?.hidden !== false) form.hidden = full;
    host.innerHTML = Object.entries(loaded.value.profiles).map(([id, profile]) => {
        const reason = profile.meta.belongsToHousehold === false ? (full ? HOUSEHOLD_LIMIT_REASON : '')
            : count <= 1 ? HOUSEHOLD_MINIMUM_REASON : '';
        const deleteReason = profile.meta.belongsToHousehold !== false && count <= 1 ? HOUSEHOLD_MINIMUM_REASON : '';
        return `
        <article class="pv-person-row"><div><strong>${escapeHtml(profile.meta.name || id)}</strong>${id === activeId ? ' · gerade angezeigt' : ''}</div>
        <div class="reconciliation-actions"><div class="pv-membership"><label ${reason ? `title="${reason}"` : ''}><input ${reason ? `disabled data-person-disabled-reason="${reason}"` : ''} class="ds-checkbox" type="checkbox" data-person-membership="${escapeHtml(id)}" ${profile.meta.belongsToHousehold !== false ? 'checked' : ''}> im Haushalt</label>${reason ? `<small class="ds-help">${reason}</small>` : ''}</div>
        <button type="button" class="ds-button ds-button-secondary" data-person-action="rename" data-person-id="${escapeHtml(id)}">Umbenennen</button>
        <button type="button" ${deleteReason ? `disabled title="${deleteReason}" data-person-disabled-reason="${deleteReason}"` : ''} class="ds-button ds-button-danger" data-person-action="delete" data-person-id="${escapeHtml(id)}">Löschen …</button></div></article>`; }).join('');
}
/** Fachliche Sperren bleiben beim Freigeben einer laufenden Operation erhalten. */
export function syncManagerPeopleControls(doc, blocked) {
    doc.getElementById('managerPeopleList')?.querySelectorAll?.('button, input')?.forEach?.(element => {
        element.disabled = blocked || Boolean(element.dataset.personDisabledReason);
    });
}
/** Delegation bleibt auch nach bestätigtem Profilwechsel genau einmal gebunden. */
export function bindManagerPeopleDialog(doc, { execute, activeId, blocked }) {
    if (peopleBindings.has(doc) || !doc.getElementById('managerPeopleModal')) return;
    const byId = id => doc.getElementById(id);
    let renaming = null, pending = false, lastOpener = null;
    const reset = () => {
        renaming = null; byId('managerPersonName').value = '';
        byId('managerPersonNameLabel').textContent = 'Neue Person';
        byId('managerPeopleForm').hidden = householdMemberCount(loadProfileRegistry().value) >= 2;
        byId('managerPersonCreateBtn').hidden = byId('managerPeopleForm').hidden;
        byId('managerPersonRenameBtn').hidden = true;
        byId('managerPersonRenameCancelBtn').hidden = true;
        confirmManagerModalBaseline('people', doc);
    };
    bindManagerAuxiliaryDialog('people', doc, reset);
    byId('managePeopleBtn')?.addEventListener('click', event => {
        if (blocked()) return;
        lastOpener = event.currentTarget || byId('managePeopleBtn');
        renderManagerPeople(doc, activeId());
        openManagerAuxiliaryDialog('people', doc, lastOpener, byId('managerPeopleForm').hidden ? 'dismissPeopleModalBtn' : 'managerPersonName');
    });
    byId('dismissPeopleModalBtn').addEventListener('click', () => closeManagerAuxiliaryDialog('people', doc));
    const run = async request => {
        if (pending || blocked()) return false;
        pending = true;
        try {
            const ok = await execute(request);
            if (ok) { reset(); renderManagerPeople(doc, activeId()); }
            else renderManagerPeople(doc, activeId());
            return ok;
        } finally { pending = false; }
    };
    byId('managerPeopleForm').addEventListener('submit', event => { event.preventDefault(); return run({ kind: renaming ? 'rename' : 'create', profileId: renaming, name: byId('managerPersonName').value }); });
    byId('managerPersonRenameBtn').addEventListener('click', () => run({ kind: 'rename', profileId: renaming, name: byId('managerPersonName').value }));
    byId('managerPersonRenameCancelBtn').addEventListener('click', () => { if (!pending && !blocked()) reset(); });
    byId('managerPeopleList').addEventListener('click', event => {
        const button = event.target?.closest?.('[data-person-action]');
        if (!button || button.disabled || pending || blocked()) return;
        const profileId = button.dataset.personId;
        if (button.dataset.personAction === 'delete') return run({ kind: 'delete', profileId });
        renaming = profileId;
        byId('managerPeopleForm').hidden = false;
        byId('managerPersonName').value = loadProfileRegistry().value?.profiles[profileId]?.meta.name || '';
        byId('managerPersonNameLabel').textContent = 'Neuer Name';
        byId('managerPersonCreateBtn').hidden = true;
        byId('managerPersonRenameBtn').hidden = false;
        byId('managerPersonRenameCancelBtn').hidden = false;
        byId('managerPersonName').focus();
    });
    byId('managerPeopleList').addEventListener('change', event => {
        const input = event.target?.closest?.('[data-person-membership]');
        if (!input || input.disabled || pending || blocked()) return;
        return run({ kind: 'membership', profileId: input.dataset.personMembership, belongs: input.checked });
    });
    peopleBindings.set(doc, { reset });
}

const toggleFields = ['profileGoldAktiv', 'profileGoldSteuerfrei', 'profileHealthBucketEnabled'];
const toggleBindings = new WeakSet();

/** Nur Darstellung: Wertträger, Sperren und Chip ohne Ereignis oder Write spiegeln. */
export function syncManagerProfileControls(doc) {
    syncManagerCareToday(doc);
    for (const id of toggleFields) {
        const field = doc.getElementById(id), toggle = doc.getElementById(`${id}Toggle`);
        if (!field || !toggle) continue;
        toggle.checked = field.value === 'true';
        toggle.disabled = field.disabled;
        if (field.getAttribute?.('aria-invalid') === 'true') toggle.setAttribute?.('aria-invalid', 'true');
        else toggle.removeAttribute?.('aria-invalid');
    }
    const care = doc.getElementById('managerCareActive');
    if (care) care.hidden = doc.getElementById('profileHealthBucketEnabled')?.value !== 'true';
    syncPersonSegments(doc);
    const fixedGroup = doc.querySelector?.('[data-person-field="profileRentenanpassungPct"]');
    const mode = doc.getElementById('profileRentenanpassungArt')?.value;
    const rate = Number(String(doc.getElementById('profileRentenanpassungPct')?.value || '0').replace(',', '.'));
    if (fixedGroup) fixedGroup.hidden = mode !== 'fix' || rate === 0 && doc.getElementById('profilePensionSegments')?.dataset.explicitFixed !== 'true';
    const rente = doc.getElementById('profileRenteAktiv');
    if (rente) rente.disabled = true;
}

/** Genau ein vorhandenes change-Ereignis; reine Synchronisierung speichert nie. */
export function bindManagerProfileControls(doc) {
    if (toggleBindings.has(doc)) return;
    toggleBindings.add(doc);
    bindPersonSegments(doc);
    doc.getElementById('profileGenderConfirm')?.addEventListener('click', () => {
        const field = doc.getElementById('profileGeschlecht');
        if (field && !field.disabled) field.dispatchEvent(new (doc.defaultView?.Event || Event)('change', { bubbles: true }));
    });
    for (const id of toggleFields) {
        const field = doc.getElementById(id), toggle = doc.getElementById(`${id}Toggle`);
        if (!field || !toggle) continue;
        // Native Schalter senden input vor change. Der Guard synchronisiert
        // dabei schon die Anzeige; dafür muss der Wertträger die Auswahl kennen.
        toggle.addEventListener('input', () => {
            if (!field.disabled) field.value = toggle.checked ? 'true' : 'false';
        });
        toggle.addEventListener('change', () => {
            if (field.disabled) { syncManagerProfileControls(doc); return; }
            field.value = toggle.checked ? 'true' : 'false';
            const EventType = doc.defaultView?.Event || globalThis.Event;
            field.dispatchEvent(new EventType('change', { bubbles: true }));
            syncManagerProfileControls(doc);
        });
        field.addEventListener('change', () => syncManagerProfileControls(doc));
    }
    syncManagerProfileControls(doc);
}

const personSegmentBindings = new WeakSet();
function syncPersonSegments(doc) {
    for (const [hostId, fieldId, options] of /** @type {[string, string, string[][]][]} */ ([
        ['profilePensionSegments', 'profileRentenanpassungArt', [['wage', 'wie Löhne'], ['fix', 'fester Satz'], ['none', 'keine'], ['cpi', 'Inflation']]],
        ['profileChurchSegments', 'profileKirchensteuerPct', [['0', 'keine'], ['8', '8 %'], ['9', '9 %']]]
    ])) {
        const host = doc.getElementById(hostId), field = doc.getElementById(fieldId);
        if (!host || !field) continue;
        const pct = doc.getElementById('profileRentenanpassungPct');
        const selected = fieldId === 'profileRentenanpassungArt' && field.value === 'fix'
            && Number(String(pct?.value || '0').replace(',', '.')) === 0 && host.dataset.explicitFixed !== 'true' ? 'none' : field.value;
        const choices = [...options];
        if (fieldId === 'profileKirchensteuerPct' && !options.some(([value]) => Number(value) === Number(String(field.value).replace(',', '.')))) choices.push([field.value, `${field.value} % · bisher`]);
        host.replaceChildren();
        choices.forEach(([value, label]) => {
            if (value === 'cpi' && field.value !== 'cpi') return;
            const button = doc.createElement('button'); button.type = 'button'; button.className = 'ds-button ds-button-secondary';
            button.dataset.personSegmentField = fieldId; button.dataset.value = String(value); button.textContent = label;
            button.disabled = field.disabled; button.setAttribute('aria-pressed', String(String(selected) === String(value)));
            host.appendChild(button);
        });
    }
}
function bindPersonSegments(doc) {
    if (personSegmentBindings.has(doc)) return;
    personSegmentBindings.add(doc);
    for (const hostId of ['profilePensionSegments', 'profileChurchSegments']) doc.getElementById(hostId)?.addEventListener('click', event => {
        const button = event.target.closest?.('[data-person-segment-field]');
        const field = doc.getElementById(button?.dataset.personSegmentField);
        if (!button || button.disabled || !field || field.disabled) return;
        const pct = doc.getElementById('profileRentenanpassungPct');
        const fixed = button.dataset.value === 'fix';
        if (field.id === 'profileRentenanpassungArt') doc.getElementById('profilePensionSegments').dataset.explicitFixed = String(fixed);
        if (button.dataset.value === 'none') { field.value = 'fix'; if (pct) pct.value = '0'; }
        else field.value = button.dataset.value;
        field.dispatchEvent(new (doc.defaultView?.Event || Event)(field.tagName.toLowerCase() === 'select' ? 'change' : 'input', { bubbles: true }));
        syncManagerProfileControls(doc);
        if (fixed) pct?.focus();
        else doc.getElementById(hostId)?.querySelector?.('[aria-pressed="true"]')?.focus();
    });
}
