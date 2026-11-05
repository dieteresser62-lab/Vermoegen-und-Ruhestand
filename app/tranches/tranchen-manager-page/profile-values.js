// @ts-check
import { readProfileAssetValuesFromDom, validateProfileAssetValues, ProfileAssetValuesValidationError, saveProfileAssetValues, applyProfileAssetValuesToDom, applyProfileRenteStatusToDom, loadProfileAssetValues } from '../../profile/profile-asset-values.js';
import { clearProfileValidationStatus, showProfileValidationStatus, readStoredValue, managerInputSignature, flushManagerRecords, byId, restoreManagerRecords } from './helpers.js';
import { state, PROFILE_ASSET_STORAGE_KEYS, PROFILE_INPUT_IDS, PROFILE_SAVE_DEBOUNCE_MS } from './state.js';
import { runManagerOperation } from './history.js';
import { PROFILE_STORAGE_KEYS, loadStoredBalanceStateFromData, PROFILE_VALUE_KEYS } from '../../profile/profile-state.js';
import { PROFILE_LIVE_BASE_KEY, saveCurrentProfileFromLocalStorage, getCurrentProfileId } from '../../profile/profile-storage.js';
import { renderPersistenceState, setPersistenceStatus } from './persistence-status.js';
import { persistenceStorage } from '../../shared/persistence-facade.js';
import { refreshManagerProfiles, syncManagerProfileControls } from '../tranchen-manager-profiles.js';
import { bindManagerPersonCards } from '../tranchen-manager-person-cards.js';
import { renderPersonWealth, renderDepotHistory, cashMetric } from './rendering.js';
import { processingIsBlocked } from './controls.js';
import { validateIsoDate, personDateInputToIso, personReferenceYear, personAge } from '../../profile/profile-person-data.js';
import { loadProfileRegistry } from '../../profile/profile-registry.js';
import { bindPersonIncome } from '../tranchen-manager-income.js';
import { bindPersonImmobilien } from '../tranchen-manager-immobilien.js';
import { bindManagerPartnership } from '../tranchen-manager-partnership.js';
import { readDecimalInput } from '../tranchen-manager-decimal-input.js';
import { readProfileCareSettings } from '../../shared/care-profile-settings.js';

export async function saveProfileValues(values = readProfileAssetValuesFromDom(), navigationOperation = null) {
    let validatedValues;
    try {
        validatedValues = validateProfileAssetValues(values);
        clearProfileValidationStatus();
    } catch (error) {
        if (error instanceof ProfileAssetValuesValidationError) showProfileValidationStatus(error);
        return false;
    }
    if (state.profileCommitInFlight) {
        state.pendingProfileValues = validatedValues;
        return false;
    }
    if (state.commitInFlight || state.cashPostingInFlight || state.loadStatus === 'corrupt' || state.loadStatus === 'unavailable') return false;
    if (!navigationOperation) {
        if (state.navigationLifecycle?.isBlocked()) return runManagerOperation(operation => saveProfileValues(validatedValues, operation));
        state.profileEditingField = document.activeElement;
        try { return await runManagerOperation(operation => saveProfileValues(validatedValues, operation)); }
        finally { state.profileEditingField = null; }
    }

    state.profileCommitInFlight = true;
    state.persistenceMessage = '';
    state.persistenceError = '';
    try {
        // Alle erfolgreichen Fortsetzungen behalten Flag und Besitzer ohne Lücke.
        while (validatedValues) {
            state.pendingProfileValues = null;
            const previousValues = new Map(PROFILE_ASSET_STORAGE_KEYS.map(key => [key, readStoredValue(key)]));
            const previousRegistryRaw = readStoredValue(PROFILE_STORAGE_KEYS.registry);
            const previousLiveBase = readStoredValue(PROFILE_LIVE_BASE_KEY);
            const committingSignature = managerInputSignature(PROFILE_INPUT_IDS, { profileTagesgeld: validatedValues.tagesgeld });
            renderPersistenceState();
            try {
                navigationOperation.commit();
                saveProfileAssetValues(validatedValues, persistenceStorage, { recordCashChange: true, confirmGender: validatedValues.genderConfirmed === true });
                if (!saveCurrentProfileFromLocalStorage()) throw new Error('PROFILE_SAVE_FAILED');
                await flushManagerRecords();
                // Nach Retry zeigt das Formular noch den zurückgeschriebenen Altstand.
                // Nur unveränderte Eingaben auf den jetzt bestätigten Satz projizieren.
                if (managerInputSignature(PROFILE_INPUT_IDS) === committingSignature) {
                    applyProfileAssetValuesToDom(validatedValues, document, { preserveActiveDecimalInput: true });
                    state.profileBaseline = managerInputSignature(PROFILE_INPUT_IDS);
                } else {
                    applyProfileRenteStatusToDom(validatedValues);
                    state.profileBaseline = committingSignature;
                }
                if (validatedValues.genderConfirmed && byId('profileGeschlecht')) delete byId('profileGeschlecht').dataset.genderConfirmed;
                state.registryDisplayRaw = undefined;
                state.persistenceMessage = 'Profilwerte dauerhaft gespeichert.';
                clearTimeout(state.persistenceMessageTimer);
                const revision = ++state.persistenceMessageRevision;
                state.persistenceMessageTimer = setTimeout(() => {
                    if (revision !== state.persistenceMessageRevision || state.persistenceMessage !== 'Profilwerte dauerhaft gespeichert.') return;
                    state.persistenceMessage = '';
                    state.persistenceMessageTimer = null;
                    renderPersistenceState();
                }, 6000);
                refreshManagerProfiles(document, state.profileId);
                bindManagerPersonCards(document, () => state.profileId).sync();
            } catch {
                const restored = await restoreManagerRecords([...previousValues, [PROFILE_STORAGE_KEYS.registry, previousRegistryRaw], [PROFILE_LIVE_BASE_KEY, previousLiveBase]]);
                state.pendingProfileValues = state.pendingProfileValues || validatedValues;
                state.registryDisplayRaw = previousRegistryRaw;
                state.persistenceMessage = '';
                state.persistenceError = restored
                    ? 'Profilwerte konnten nicht dauerhaft gespeichert werden. Der bestätigte Stand wurde wiederhergestellt; Retry ist möglich.'
                    : 'Profilwerte und dauerhaftes Rückschreiben konnten nicht bestätigt werden. Der letzte bestätigte Stand bleibt sichtbar; Retry ist möglich.';
                try { applyProfileAssetValuesToDom(loadProfileAssetValues({
                    getItem: key => previousValues.has(key) ? previousValues.get(key) : readStoredValue(key)
                })); } catch { /* Fehlerstatus bleibt erhalten. */ }
                state.profileBaseline = managerInputSignature(PROFILE_INPUT_IDS);
                return false;
            }
            validatedValues = state.pendingProfileValues;
        }
        return true;
    } finally {
        state.profileCommitInFlight = false;
        renderPersonWealth();
        renderDepotHistory();
        renderPersistenceState();
    }
}

export function scheduleProfileValuesSave({ resumePaused = false, cashChange = false, immediate = false } = {}) {
    if (byId('managerProfileRecovery')?.hidden === false) return false;
    state.persistenceMessage = '';
    if (state.profileSaveTimer !== null) {
        clearTimeout(state.profileSaveTimer);
        state.profileSaveTimer = null;
    }

    let values;
    try {
        values = readProfileAssetValuesFromDom();
        // Andere Profilfelder dürfen einen offenen Tagesgeldentwurf nicht
        // nebenbei übernehmen; dessen change/Enter besitzt die Bestätigung.
        if (!cashChange) values.tagesgeld = loadProfileAssetValues().tagesgeld;
        clearProfileValidationStatus();
    } catch (error) {
        if (error instanceof ProfileAssetValuesValidationError) {
            showProfileValidationStatus(error);
            state.pendingProfileValues = null;
            renderPersistenceState();
        }
        return false;
    }

    if (state.profileCommitInFlight) {
        state.pendingProfileValues = values;
        return true;
    }
    // Ein durch Navigation abgebrochener Dialog gibt seinen Besitzer zuerst frei.
    // Der fortgesetzte Timer darf schon geplant werden; saveProfileValues prüft vor jedem Write erneut den Lifecycle.
    if ((!resumePaused && state.navigationLifecycle?.isBlocked()) || state.cashPostingInFlight || state.commitInFlight) return false;
    if (immediate) return saveProfileValues(values);
    state.profileSaveTimer = setTimeout(() => {
        state.profileSaveTimer = null;
        state.pendingProfileValues = values;
        void saveProfileValues(values);
    }, PROFILE_SAVE_DEBOUNCE_MS);
    setPersistenceStatus('Profiländerung wartet auf automatisches Speichern …', 'pending');
    return true;
}

export async function applyManagerBirthDate() {
    const doc = document, origin = state.profileId;
    const input = byId('managerBirthDate'), errorHost = byId('managerBirthError');
    if (!input || processingIsBlocked() || byId('managerBirthSupplement')?.hidden !== false) return false;
    const report = text => { if (errorHost) errorHost.textContent = text; };
    const birth = validateIsoDate(personDateInputToIso(input.value) ?? input.value);
    const registry = loadProfileRegistry().value;
    const data = registry?.profiles[origin]?.data || {};
    const balance = loadStoredBalanceStateFromData(data);
    const year = personReferenceYear(balance.value?.annualPeriodMetadata);
    if (birth.status !== 'valid' || personAge({ ...data, profile_geburtsdatum: birth.value }, year).status !== 'valid') {
        report('Bitte ein vollständiges gültiges Geburtsdatum (TT.MM.JJJJ) vor dem Januarstichtag eingeben.');
        input.setAttribute('aria-invalid', 'true'); input.focus(); return false;
    }
    input.removeAttribute('aria-invalid');
    try { readProfileAssetValuesFromDom(); }
    catch (error) { showProfileValidationStatus(error); input.focus(); return false; }
    if (state.profileSaveTimer !== null || state.pendingProfileValues || managerInputSignature(PROFILE_INPUT_IDS) !== state.profileBaseline) {
        report('Bitte zuerst die übrigen Profiländerungen dauerhaft speichern oder erneut versuchen.'); input.focus(); return false;
    }
    const draft = birth.value;
    input.focus();
    report('Geburtsdatum wird gespeichert …');
    const ok = await runManagerOperation(async operation => {
        if (document !== doc || state.profileId !== origin || getCurrentProfileId() !== origin) return false;
        state.profileCommitInFlight = true;
        input.readOnly = true;
        const previousDate = readStoredValue(PROFILE_VALUE_KEYS.geburtsdatum);
        const previousRegistry = readStoredValue(PROFILE_STORAGE_KEYS.registry);
        const previousLiveBase = readStoredValue(PROFILE_LIVE_BASE_KEY);
        try {
            renderPersistenceState();
            operation.commit();
            // Die Ergänzung schreibt ausschließlich das Datum und den Profilcapture.
            persistenceStorage.setItem(PROFILE_VALUE_KEYS.geburtsdatum, draft);
            if (!saveCurrentProfileFromLocalStorage()) throw new Error('PROFILE_SAVE_FAILED');
            await flushManagerRecords();
            if (document !== doc || state.profileId !== origin) return false;
            byId('profileGeburtsdatum').value = draft;
            state.profileBaseline = managerInputSignature(PROFILE_INPUT_IDS);
            state.persistenceError = ''; state.persistenceMessage = 'Geburtsdatum dauerhaft gespeichert.';
            refreshManagerProfiles(doc, origin);
            return true;
        } catch {
            const restored = await restoreManagerRecords([[PROFILE_VALUE_KEYS.geburtsdatum, previousDate], [PROFILE_STORAGE_KEYS.registry, previousRegistry], [PROFILE_LIVE_BASE_KEY, previousLiveBase]]);
            state.persistenceError = restored ? 'Geburtsdatum konnte nicht dauerhaft gespeichert werden; Retry ist möglich.' : 'Geburtsdatum und Rückschreiben konnten nicht bestätigt werden.';
            return false;
        } finally {
            input.readOnly = false;
            state.profileCommitInFlight = false;
            renderPersistenceState();
        }
    });
    if (document !== doc || state.profileId !== origin) return false;
    if (!ok) {
        report('Geburtsdatum konnte nicht dauerhaft gespeichert werden. Der Entwurf bleibt erhalten; erneut Übernehmen versuchen.');
        input.focus();
    } else {
        const cards = bindManagerPersonCards(doc, () => state.profileId);
        cards.sync(); cards.openPerson();
        byId('profileGeburtsdatum')?.focus();
    }
    return ok;
}

export function bindProfileValueInputs() {
    bindPersonIncome(document);
    state.immobilien = bindPersonImmobilien(document, { blocked: processingIsBlocked, notify: () => state.navigationRegistration?.notify() });
    state.partnership = bindManagerPartnership(document, { blocked: processingIsBlocked, notify: () => state.navigationRegistration?.notify(), runOperation: async execute => {
        try { return await state.navigationLifecycle.run({}, execute); } finally { renderPersistenceState(); }
    } });
    byId('managerBirthApply')?.addEventListener('click', applyManagerBirthDate);
    PROFILE_INPUT_IDS.forEach(id => {
        const el = /** @type {HTMLInputElement | HTMLSelectElement} */ (byId(id));
        if (!el) return;
        const isCash = id === 'profileTagesgeld';
        const blurMoney = isCash || id === 'profileRenteMonatlich';
        const eventName = blurMoney || el.type === 'checkbox' || el.tagName.toLowerCase() === 'select' ? 'change' : 'input';
        el.addEventListener(eventName, () => {
            if (isCash && readDecimalInput(el.value, el) === loadProfileAssetValues().tagesgeld) { cashMetric().finish(true); return; }
            if (id === 'profileGeschlecht') el.dataset.genderConfirmed = 'true';
            if (id === 'profileCareGradeToday') {
                const form = byId('profileCareFormToday');
                if (form) form.value = Number(el.value) ? readProfileCareSettings(persistenceStorage).forms[Number(el.value)] : '';
            }
            const scheduled = scheduleProfileValuesSave({ cashChange: isCash, immediate: isCash });
            syncManagerProfileControls(document);
            state.navigationRegistration?.notify();
            if (isCash) Promise.resolve(scheduled).then(saved => cashMetric().finish(saved === true));
            renderPersonWealth();
            return scheduled;
        });
        if (blurMoney) {
            el.addEventListener('input', () => state.navigationRegistration?.notify());
            el.addEventListener('keydown', event => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                el.dispatchEvent(new Event('change', { bubbles: true }));
            });
        }
    });
}

export function flushManagerCashInput() {
    const field = byId('profileTagesgeld');
    if (readDecimalInput(field?.value, field) === loadProfileAssetValues().tagesgeld) return true;
    if (state.profileCommitInFlight || state.pendingProfileValues) return false;
    return scheduleProfileValuesSave({ cashChange: true, immediate: true });
}
