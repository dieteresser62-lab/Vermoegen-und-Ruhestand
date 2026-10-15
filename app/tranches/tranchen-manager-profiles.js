import { renderManagerWealthHistory } from './tranchen-history-closures.js';
import { getManagerView } from './tranchen-manager-renderer.js';
import { appNow } from '../shared/app-clock.js';
import { personAge, personReferenceYear, describePersonDates, projectPersonPension, personDateDisplay } from '../profile/profile-person-data.js';
import { projectProfileWealthHistory } from '../profile/profile-wealth-history.js';
import { projectHistoryRecovery } from './tranchen-history-recovery.js';
import { readManagerHistoryContext } from './tranchen-history-ui.js';
import { bindInfoPopovers } from '../shared/designsystem-info-popover.js';
// @ts-check
import { loadProfileRegistry, getHouseholdPrimaryProfileId } from '../profile/profile-registry.js';
import { loadProfileAssetValues, validateProfileAssetValues } from '../profile/profile-asset-values.js';
import { PROFILE_VALUE_KEYS, loadProfileHealthBucketFromData, loadStoredBalanceStateFromData } from '../profile/profile-state.js';
import { loadTranchesFromStorage, calculateTrancheDerivedValues } from './tranchen-manager-state.js';
import { renderManagerProfiles } from './tranchen-manager-renderer.js';
import { bindManagerAuxiliaryDialog, openManagerAuxiliaryDialog, closeManagerAuxiliaryDialog, confirmManagerModalBaseline } from './tranchen-manager-modal.js';
import { escapeHtml } from '../shared/security-utils.js';

/** Monatsanzeige ohne Indexierung oder Steuerrechnung; Beginnmonat zählt vollständig. */
function projectCurrentIncome(data, values, now) {
    const year = now.getFullYear(), month = now.getMonth() + 1;
    const pension = projectPersonPension({ ...data, profile_rente_monatlich: values.renteMonatlich,
        profile_sonstige_einkuenfte: values.sonstigeEinkuenfte }, year);
    const future = pension.beginning.status === 'valid'
        && (pension.beginning.year > year || pension.beginning.year === year && pension.beginning.month > month);
    const missing = pension.renteMonatlich > 0 && pension.beginning.status === 'missing' && pension.renteStartOffsetJahre > 0;
    const running = pension.monateImJahr > 0 && month >= 13 - pension.monateImJahr;
    const status = missing ? 'Rentenbeginn fehlt' : future ? `ab ${personDateDisplay(pension.beginning.value)}` : 'im Monat';
    const pensionStatus = missing ? 'Rentenbeginn fehlt' : pension.beginning.status === 'valid'
        ? `${future ? 'Rente ab' : 'Rente läuft seit'} ${personDateDisplay(pension.beginning.value)}`
        : pension.renteMonatlich > 0 ? 'Ohne Rentenbeginn zählt die Rente als bereits laufend. Läuft sie noch nicht, bitte Beginn eintragen.' : '';
    return { income: values.sonstigeEinkuenfte + (running ? pension.renteMonatlich : 0), status, pensionStatus,
        future: future && pension.renteMonatlich > 0 ? { month: pension.beginning.value.slice(0, 7), amount: pension.renteMonatlich } : null,
        missing };
}

function upcomingIncome(profiles) {
    const grouped = new Map();
    for (const profile of profiles) {
        const future = profile.currentIncome.future;
        if (future) grouped.set(future.month, (grouped.get(future.month) || 0) + future.amount);
    }
    let income = profiles.reduce((sum, profile) => sum + profile.income, 0);
    return [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([month, amount]) => ({ month, income: income += amount }));
}

/** Ausschließlich lesende Projektion; keine Registrywrapper mit Defaultanlage. */
export function projectManagerProfiles(registry, activeId, historyContext = null) {
    const now = appNow();
    const activeBalance = loadStoredBalanceStateFromData(registry.profiles[activeId]?.data || {}).value;
    const referenceYear = personReferenceYear(activeBalance?.annualPeriodMetadata, now);
    const profiles = Object.entries(registry.profiles).map(([id, profile]) => {
        const storage = { getItem: key => profile.data[key] ?? null };
        try {
            const health = loadProfileHealthBucketFromData(profile.data);
            if (['corrupt', 'unavailable'].includes(health.status)) throw new Error('PROFILE_HEALTH_INVALID');
            const balance = loadStoredBalanceStateFromData(profile.data);
            if (['corrupt', 'unavailable'].includes(balance.status)) throw new Error('PROFILE_BALANCE_INVALID');
            const inputs = balance.value?.inputs || {};
            const inputFields = { tagesgeld: 'tagesgeld', renteMonatlich: 'renteMonatlich', sonstigeEinkuenfte: 'sonstigeEinkuenfte',
                alter: 'aktuellesAlter', goldZiel: 'goldZielProzent', goldFloor: 'goldFloorProzent', goldRebalBand: 'rebalancingBand' };
            // Der normale Leser besitzt Fallbacks. Explizit gespeicherte Zahlen
            // prüfen wir davor, damit beschädigte Daten keine Vollsumme ergeben.
            for (const [field, key] of Object.entries(PROFILE_VALUE_KEYS)) {
                const raw = profile.data[key] ?? inputs[inputFields[field]];
                if (['tagesgeld', 'renteMonatlich', 'sonstigeEinkuenfte', 'alter', 'goldZiel', 'goldFloor', 'goldRebalBand'].includes(field)
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
            const currentIncome = projectCurrentIncome(profile.data, values, now);
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
                assets, cost, gain: market - cost, count: derived.length, allocation,
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
    const complete = members.length > 0 && members.every(profile => profile.valid);
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
    host.innerHTML = Object.entries(loaded.value.profiles).map(([id, profile]) => `
        <article class="pv-person-row"><div><strong>${escapeHtml(profile.meta.name || id)}</strong>${id === activeId ? ' · aktiv' : ''}</div>
        <div class="reconciliation-actions"><label><input class="ds-checkbox" type="checkbox" data-person-membership="${escapeHtml(id)}" ${profile.meta.belongsToHousehold !== false ? 'checked' : ''}> im Haushalt</label>
        <button type="button" class="ds-button ds-button-secondary" data-person-action="rename" data-person-id="${escapeHtml(id)}">Umbenennen</button>
        <button type="button" class="ds-button ds-button-danger" data-person-action="delete" data-person-id="${escapeHtml(id)}">Löschen …</button></div></article>`).join('');
}
/** Delegation bleibt auch nach bestätigtem Profilwechsel genau einmal gebunden. */
export function bindManagerPeopleDialog(doc, { execute, activeId, blocked }) {
    if (peopleBindings.has(doc) || !doc.getElementById('managerPeopleModal')) return;
    const byId = id => doc.getElementById(id);
    let renaming = null, pending = false, lastOpener = null;
    const reset = () => {
        renaming = null; byId('managerPersonName').value = '';
        byId('managerPersonNameLabel').textContent = 'Neue Person';
        byId('managerPersonCreateBtn').hidden = false;
        byId('managerPersonRenameBtn').hidden = true;
        byId('managerPersonRenameCancelBtn').hidden = true;
        confirmManagerModalBaseline('people', doc);
    };
    bindManagerAuxiliaryDialog('people', doc, () => {
        reset();
        if (lastOpener?.isConnected === false) {
            const replacement = Array.from(byId('managerHousehold')?.querySelectorAll?.('[data-manager-people]') || [])
                .find(button => button.dataset.managerPeople === lastOpener.dataset.managerPeople);
            (replacement || byId('managePeopleBtn'))?.focus?.();
        }
    });
    const openPeople = opener => {
        if (blocked()) return;
        lastOpener = opener;
        renderManagerPeople(doc, activeId());
        openManagerAuxiliaryDialog('people', doc, opener, 'managerPersonName');
    };
    for (const id of ['managePeopleBtn', 'profileManagePeopleBtn']) {
        byId(id)?.addEventListener('click', event => openPeople(event.currentTarget || byId(id)));
    }
    byId('managerHousehold')?.addEventListener('click', event => {
        const opener = event.target?.closest?.('[data-manager-people]');
        if (opener && !opener.disabled) return openPeople(opener);
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
    for (const [hostId, fieldId, options] of [
        ['profilePensionSegments', 'profileRentenanpassungArt', [['wage', 'wie Löhne'], ['fix', 'fester Satz'], ['none', 'keine'], ['cpi', 'Inflation']]],
        ['profileChurchSegments', 'profileKirchensteuerPct', [['0', 'keine'], ['8', '8 %'], ['9', '9 %']]]
    ]) {
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
