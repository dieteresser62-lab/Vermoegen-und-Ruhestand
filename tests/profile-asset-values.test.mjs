"use strict";

import {
    applyProfileAssetValuesToDom,
    applyProfileRenteStatusToDom,
    calculateProfileGoldStrategy,
    loadProfileAssetValues,
    normalizeProfileAssetValues,
    ProfileAssetValuesValidationError,
    PERSON_FORM_IDS,
    readProfileAssetValuesFromDom,
    saveProfileAssetValues,
    validateProfileAssetValues
} from '../app/profile/profile-asset-values.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { PROFILE_CASH_HISTORY_KEY, assertCashHistory } from '../app/profile/profile-wealth-history.js';
import { evaluateWealthHistory } from '../app/tranches/tranchen-history-model.js';

console.log('--- Profile Asset Values Tests ---');

{
    const field = { tagName: 'INPUT', type: 'text', value: '7.5', getAttribute: () => 'decimal' };
    const doc = { activeElement: field, getElementById: id => id === 'profileGoldZiel' ? field : null };
    const option = { preserveActiveDecimalInput: true };
    applyProfileAssetValuesToDom({ goldZiel: 7.5 }, doc, option);
    assertEqual(field.value, '7.5', 'Optionaler Manager-Rückweg erhält aktive gültige Eingabe');
    field.value = '7.50000000000000001';
    applyProfileAssetValuesToDom({ goldZiel: 7.5 }, doc, option);
    assertEqual(field.value, '7.50000000000000001', 'Aktive lange Bruchstücke behalten ihren vollständigen Text');
    applyProfileAssetValuesToDom({ goldZiel: 7.5 }, doc);
    assertEqual(field.value, '7,5', 'Andere Aufrufer behalten deutsches Defaultverhalten');
    for (const raw of ['', '7,5.0', '8.5']) {
        field.value = raw;
        applyProfileAssetValuesToDom({ goldZiel: 7.5 }, doc, option);
        assertEqual(field.value, '7,5', 'Ungültiger oder abweichender Text verhindert bestätigte Projektion nicht');
    }
    field.value = '7.5'; doc.activeElement = null;
    applyProfileAssetValuesToDom({ goldZiel: 7.5 }, doc, option);
    assertEqual(field.value, '7,5', 'Verlassenes Feld wird nach Autosave deutsch angezeigt');
}

function createLocalStorageMock() {
    const store = new Map();
    return {
        snapshot: () => JSON.stringify([...store.entries()].sort()),
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => { store.set(String(key), String(value)); },
        removeItem: (key) => { store.delete(key); },
        clear: () => { store.clear(); }
    };
}

console.log('Test 1: normalize derives renteAktiv from incomes');
{
    const values = normalizeProfileAssetValues({
        renteMonatlich: '1000',
        sonstigeEinkuenfte: '250',
        goldAktiv: 'true',
        goldSteuerfrei: 'false',
        healthBucket: {
            enabled: 'true',
            initialAmount: '175000',
            triggerMinGrade: '4',
            triggerMode: 'or'
        }
    });
    assertEqual(values.renteAktiv, true, 'Rente aktiv should derive from positive monthly income');
    assertEqual(values.goldAktiv, true, 'Gold active should parse');
    assertEqual(values.goldSteuerfrei, false, 'Gold tax flag should parse');
    assertEqual(values.healthBucket.enabled, true, 'Health bucket active should parse');
    assertEqual(values.healthBucket.initialAmount, 175000, 'Health bucket amount should parse');
    assertEqual(values.healthBucket.triggerMode, 'OR', 'Health bucket trigger mode should normalize');
}
console.log('✓ normalize derives renteAktiv OK');

console.log('Test 2: load falls back to stored balance inputs');
{
    const storage = createLocalStorageMock();
    storage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify({
        inputs: {
            tagesgeld: 15000,
            renteMonatlich: 1200,
            aktuellesAlter: 66,
            goldAktiv: true,
            goldZielProzent: 8,
            goldFloorProzent: 2,
            rebalancingBand: 20,
            goldSteuerfrei: true
        }
    }));

    const values = loadProfileAssetValues(storage);
    assertEqual(values.tagesgeld, 15000, 'Tagesgeld should fallback from balance inputs');
    assertEqual(values.renteMonatlich, 0, 'Personenrente besitzt keinen unabhängigen Balance-Fallback');
    assertEqual(values.alter, null, 'Alter wird nicht aus einer Balance-Personenkopie gelesen');
    assertEqual(values.goldAktiv, true, 'Gold active should fallback from balance inputs');
}
console.log('✓ load falls back to stored balance inputs OK');

console.log('Test 3: save writes normalized profile keys');
{
    const storage = createLocalStorageMock();
    const saved = saveProfileAssetValues({
        tagesgeld: 30000,
        renteMonatlich: 800,
        sonstigeEinkuenfte: 200,
        alter: 67,
        goldAktiv: true,
        goldZiel: 7.5,
        goldFloor: 1,
        goldBand: 25,
        goldSteuerfrei: true,
        healthBucket: {
            enabled: true,
            initialAmount: 150000,
            assetSource: 'money_market_first_then_cash',
            triggerMinGrade: 4,
            triggerMode: 'OR',
            coverageMode: 'care_additional_floor_only',
            returnMode: 'cash_return',
            targetMode: 'inflation_indexed_diagnostic'
        }
    }, storage);
    assertEqual(saved.renteAktiv, true, 'save should normalize renteAktiv');
    assertEqual(storage.getItem('profile_tagesgeld'), '30000', 'Tagesgeld should be stored');
    assertEqual(storage.getItem('profile_rente_aktiv'), 'true', 'Derived renteAktiv should be stored');
    assertEqual(storage.getItem('profile_gold_rebal_band'), '25', 'Gold band should be stored');
    const healthBucket = JSON.parse(storage.getItem('profile_health_bucket'));
    assertEqual(healthBucket.enabled, true, 'Health bucket should be stored');
    assertEqual(healthBucket.initialAmount, 150000, 'Health bucket amount should be stored');
}
console.log('✓ save writes normalized profile keys OK');

function createValidProfileValues() {
    return {
        tagesgeld: '30000',
        renteMonatlich: '800',
        sonstigeEinkuenfte: '200',
        alter: '67',
        goldAktiv: 'true',
        goldZiel: '7.5',
        goldFloor: '1',
        goldBand: '25',
        goldSteuerfrei: 'false',
        healthBucket: {
            enabled: 'true',
            initialAmount: '150000',
            assetSource: 'money_market_first_then_cash',
            triggerMinGrade: '4',
            triggerMode: 'OR',
            coverageMode: 'care_additional_floor_only',
            returnMode: 'cash_return',
            targetMode: 'inflation_indexed_diagnostic'
        }
    };
}

// Neu erzeugte Geschlechtsherkunft muss denselben Importvertrag wie die
// reguläre Migration erfüllen; sonst gehen selbst Vermögensbundles verloren.
{
    const { captureProfileData } = await import('../app/profile/profile-live-storage.js');
    const { validatePersistenceDomainRecords } = await import('../app/shared/persistence-backup.js');
    const storage = createLocalStorageMock();
    saveProfileAssetValues(createValidProfileValues(), storage);
    const provenance = JSON.parse(storage.getItem('profile_person_migration_v1'));
    assert(Number.isSafeInteger(provenance.referenceYear), 'Neue Personenherkunft enthält ein gültiges Referenzjahr');
    assertEqual(provenance.sources.geschlecht[0], 'angenommen', 'Speichern anderer Werte bestätigt das angenommene Geschlecht nicht');
    const data = captureProfileData(storage);
    const records = { ...data, rs_current_profile: 'a', rs_active_profile: 'a', rs_profiles_v1: JSON.stringify({ version: 1, profiles: {
        a: { meta: { id: 'a', name: 'Synthetische Importprobe' }, data }
    } }) };
    const result = validatePersistenceDomainRecords(records, { requireProfileContext: true });
    assertEqual(result.ok, true, 'Frisch gespeicherte Personenherkunft ist einschließlich Registry importierbar');
    saveProfileAssetValues(createValidProfileValues(), storage, { confirmGender: true });
    const confirmed = JSON.parse(storage.getItem('profile_person_migration_v1'));
    assertEqual(confirmed.referenceYear, provenance.referenceYear, 'Geschlechtsbestätigung erhält das Referenzjahr');
    assertEqual(confirmed.sources.geschlecht[0], 'bestätigt', 'Nur ausdrückliche Geschlechtsbestätigung ändert die Herkunft');
}

// Echte Writerintegration: nur der letzte bestätigte Tagesstand bleibt gespeichert.
{
    const storage = createLocalStorageMock();
    const values = { ...createValidProfileValues(), tagesgeld: 50000 };
    saveProfileAssetValues(values, storage);
    saveProfileAssetValues(values, storage, { recordCashChange: true, date: '2026-01-02' });
    assertEqual(storage.getItem(PROFILE_CASH_HISTORY_KEY), null, 'Tagesnetto-Writer: No-op erzeugt keinen Historienrecord');
    const project = cashHistory => evaluateWealthHistory({
        profiles: [{ id: 'writer', lots: [], currentCash: loadProfileAssetValues(storage).tagesgeld, cashHistory }],
        startDate: '2026-01-01', today: '2026-01-04'
    });
    const beforeProjection = storage.snapshot();
    const withoutHistory = project(null);
    assertEqual(withoutHistory.metrics.withdrawals, 0, 'Tagesnetto-Writer: fehlende Historie mit bekannter Cashbasis liefert vorläufig 0 Entnahmen');
    assertEqual(withoutHistory.metrics.change, 0, 'Tagesnetto-Writer: angenommene Cashbasis bleibt im Zeitraum konstant');
    assertEqual(withoutHistory.metrics.adjusted, 0, 'Tagesnetto-Writer: bereinigte Veränderung entspricht der konstanten Cashbasis ohne belegte Entnahmen');
    assertEqual(withoutHistory.metrics.status, 'provisional', 'Tagesnetto-Writer: fehlende Historie bleibt ausdrücklich vorläufig');
    assert(withoutHistory.points.every(point => point.assumedCash), 'Tagesnetto-Writer: jeder rückwirkende Cashpunkt kennzeichnet die Basisannahme');
    assertEqual(storage.snapshot(), beforeProjection, 'Tagesnetto-Writer: Projektion ohne Historie verändert keine Speicherbytes');
    const sequence = [5000, 500, 50, 4, 45, 450, 4500, 45000];
    for (const tagesgeld of sequence) saveProfileAssetValues({ ...values, tagesgeld }, storage,
        { recordCashChange: true, date: '2026-01-03' });
    const raw = storage.getItem(PROFILE_CASH_HISTORY_KEY);
    const history = assertCashHistory(JSON.parse(raw));
    assertEqual(history.baselineValue, 50000, 'Tagesnetto-Writer: tatsächlicher vorheriger Betrag bleibt Basis');
    assertEqual(JSON.stringify(history.entries), JSON.stringify([{ date: '2026-01-03', value: 45000 }]),
        'Tagesnetto-Writer: nur der letzte bestätigte Tagesstand bleibt bestehen');
    const result = project(history);
    assertEqual(result.metrics.withdrawals, 5000, 'Tagesnetto-Writer: gespeicherte Historie ergibt Nettorückgang 5000');
    assertEqual(result.end.allocation.cash, 45000, 'Tagesnetto-Writer: gespeicherter Tagesabschluss 45000');
    assertEqual(result.metrics.change, -5000, 'Tagesnetto-Writer: Veränderung ab tatsächlicher Messbasis');
    assertEqual(result.metrics.adjusted, result.metrics.change + 5000, 'Tagesnetto-Writer: bereinigte Veränderung wie Modellprojektion');
    assertEqual(JSON.stringify(result), JSON.stringify(project({ ...history, entries: [history.entries.at(-1)] })),
        'Tagesnetto-Writer: Tagespunkte und Kennzahlen wie reine Schlusswerte');
    assertEqual(storage.getItem(PROFILE_CASH_HISTORY_KEY), raw, 'Tagesnetto-Writer: Auswertung migriert und verdichtet keine Speicherbytes');
    saveProfileAssetValues({ ...values, tagesgeld: 45000 }, storage, { recordCashChange: true, date: '2026-01-03' });
    assertEqual(storage.getItem(PROFILE_CASH_HISTORY_KEY), raw, 'Tagesnetto-Writer: weiterer No-op hängt keinen Eintrag an');
}

console.log('Test 4: strict validation rejects negative, blank and non-finite inputs');
{
    for (const [field, value] of [['tagesgeld', '-1'], ['goldZiel', 'Infinity']]) {
        let error = null;
        try {
            validateProfileAssetValues({ ...createValidProfileValues(), [field]: value });
        } catch (caught) {
            error = caught;
        }
        assert(error instanceof ProfileAssetValuesValidationError, `${field} should fail strict validation`);
        assert(error.errors.some(item => item.field === field), `${field} should retain field context`);
    }
}
console.log('✓ strict profile validation OK');

console.log('Test 5: DOM reader rejects an intermediate blank without producing NaN defaults');
{
    const values = createValidProfileValues();
    const byId = {
        ...Object.fromEntries(Object.entries(PERSON_FORM_IDS).map(([field, id]) => [id, normalizeProfileAssetValues(values)[field]])),
        profileTagesgeld: values.tagesgeld,
        profileRenteMonatlich: '',
        profileSonstigeEinkuenfte: values.sonstigeEinkuenfte,
        profileAlter: values.alter,
        profileGoldAktiv: values.goldAktiv,
        profileGoldZiel: values.goldZiel,
        profileGoldFloor: values.goldFloor,
        profileGoldBand: values.goldBand,
        profileGoldSteuerfrei: values.goldSteuerfrei,
        profileHealthBucketEnabled: values.healthBucket.enabled,
        profileHealthBucketInitialAmount: values.healthBucket.initialAmount,
        profileHealthBucketAssetSource: values.healthBucket.assetSource,
        profileHealthBucketTriggerMinGrade: values.healthBucket.triggerMinGrade,
        profileHealthBucketTriggerMode: values.healthBucket.triggerMode,
        profileHealthBucketCoverageMode: values.healthBucket.coverageMode,
        profileHealthBucketReturnMode: values.healthBucket.returnMode,
        profileHealthBucketTargetMode: values.healthBucket.targetMode
    };
    let error = null;
    try {
        readProfileAssetValuesFromDom({ getElementById: id => ({ value: byId[id] }) });
    } catch (caught) {
        error = caught;
    }
    assert(error instanceof ProfileAssetValuesValidationError, 'Intermediate blank should block the DOM read');
    assert(error.errors.some(item => item.field === 'renteMonatlich'), 'Blank field should be identified');
}
console.log('✓ intermediate DOM input validation OK');

console.log('Test 6: profile gold strategy sums euro targets and excludes care reserves');
{
    const result = calculateProfileGoldStrategy([
        {
            profileId: 'gold',
            name: 'Gold',
            assetBase: 100000,
            operativeLiquidity: 40000,
            healthBucket: { enabled: true, initialAmount: 30000 },
            goldAktiv: true,
            goldZielProzent: 8,
            goldFloorProzent: 1,
            rebalancingBand: 20,
            goldSteuerfrei: true
        },
        {
            profileId: 'plain',
            name: 'Ohne Gold',
            assetBase: 900000,
            operativeLiquidity: 0,
            goldAktiv: false,
            goldZielProzent: 0,
            goldFloorProzent: 0,
            rebalancingBand: 50,
            goldSteuerfrei: false
        }
    ]);

    assertEqual(result.goldBasisVermoegen, 970000, 'Care reserve should be excluded from the household gold base');
    assertEqual(result.goldZielBetrag, 5600, 'Profile euro targets should sum before percentage conversion');
    assertEqual(result.goldFloorBetrag, 700, 'Profile euro floors should sum before percentage conversion');
    assertClose(result.goldZielProzent, (5600 / 970000) * 100, 0.0000001,
        'Household target percentage should reconcile to the absolute target');
    assertEqual(result.rebalancingBand, 20, 'Inactive profiles should not influence the gold band');
    assertEqual(result.goldSteuerfrei, true, 'Tax flag should reflect all active target profiles');
    assertEqual(result.diagnostics[0].excludedHealthBucket, 30000,
        'Diagnostic should expose the per-profile care exclusion');
}
console.log('✓ profile gold strategy euro aggregation OK');

// Slice 7: Herkunftsdarstellung darf Werte, Sperren und Speichervertrag nicht ändern.
const { createPresentationTestDocument, validateManagerRente } = await import('./designsystem-source-contract.mjs');
{
    const doc = createPresentationTestDocument();
    const field = doc.createElement('select'); field.id = 'profileRenteAktiv';
    field.setAttribute('aria-describedby', 'existing-help'); doc.body.appendChild(field);
    for (const id of ['profileRenteMonatlich', 'profileSonstigeEinkuenfte', 'profileAlter', 'profileTagesgeld']) {
        const input = doc.createElement('input'); input.id = id; doc.body.appendChild(input);
    }
    const storage = createLocalStorageMock();
    let reasonId;
    for (const [renteMonatlich, sonstigeEinkuenfte] of [['0', '0'], ['0', '200'], ['1000', '0'], ['1000', '200'], ['0', '0']]) {
        const values = { ...createValidProfileValues(), renteMonatlich, sonstigeEinkuenfte };
        const normalized = normalizeProfileAssetValues(values);
        saveProfileAssetValues(values, storage);
        const storedBefore = JSON.stringify(loadProfileAssetValues(storage));
        const rawBefore = storage.snapshot();
        const valuesBefore = JSON.stringify(values);
        applyProfileAssetValuesToDom(values, doc);
        assertEqual(field.value, normalized.renteAktiv ? 'true' : 'false', 'Rentenwert verwendet dieselbe normalisierte Ableitung');
        assertEqual(doc.getElementById('profileRenteMonatlich').value, normalized.renteMonatlich, 'Monatsrente bleibt normalisiert identisch');
        assertEqual(doc.getElementById('profileSonstigeEinkuenfte').value, normalized.sonstigeEinkuenfte, 'Sonstige Einkünfte bleiben normalisiert identisch');
        assert(field.disabled, 'Rentenstatus behält die bestehende Sperre');
        assertEqual(JSON.stringify(validateManagerRente(field)), '[]', 'adopted besitzt sichtbaren verknüpften Grund');
        const currentId = field.getAttribute('aria-describedby').split(' ').at(-1);
        reasonId ||= currentId;
        assertEqual(currentId, reasonId, 'Profilaktualisierung erhält dieselbe Begründungs-ID');
        assert(field.getAttribute('aria-describedby').startsWith('existing-help '), 'Bestehende Hilfebeschreibung bleibt erhalten');
        const reasonText = doc.getElementById(currentId).textContent;
        assert(reasonText.includes('Status abgeleitet; sonstige Einkünfte wirken unabhängig.'), 'Statusgrund erklärt weiterhin Ableitung und unabhängige sonstige Einkünfte');
        assert(!reasonText.includes('Rentenbeginn') && !reasonText.includes('Rente läuft'), 'Statusgrund wiederholt keinen Kalenderhinweis außerhalb des Rentenbeginnfelds');
        applyProfileRenteStatusToDom(values, doc);
        assertEqual(doc.body.children.filter(node => node.className === 'ds-field-reason').length, 1, 'Wiederholte Profilaktualisierung dupliziert keinen Grund');
        assertEqual(JSON.stringify(loadProfileAssetValues(storage)), storedBefore, 'Profil-Speicherobjekt bleibt nach Darstellung identisch');
        assertEqual(storage.snapshot(), rawBefore, 'Alle Profil-Speicherkeys bleiben bytegleich');
        assertEqual(JSON.stringify(values), valuesBefore, 'Eingabeobjekt bleibt identisch');
    }
    const confirmed = loadProfileAssetValues(storage), confirmedRaw = storage.snapshot();
    applyProfileRenteStatusToDom({ ...confirmed, sonstigeEinkuenfte: 200 }, doc);
    assertEqual(field.value, 'true', 'Einkommensversuch aktualisiert denselben abgeleiteten Rentenstatus');
    applyProfileAssetValuesToDom(confirmed, doc); // Bestehender Consumer für bestätigten Rollback.
    assertEqual(field.value, 'false', 'Rollback auf bestätigte Einkommen stellt dieselbe Ableitung wieder her');
    assertEqual(JSON.stringify(validateManagerRente(field)), '[]', 'Rollback erhält Sperre und genau eine verknüpfte Erklärung');
    assertEqual(field.getAttribute('aria-describedby').split(' ').at(-1), reasonId, 'Rollback verwendet denselben Grundknoten');
    assertEqual(storage.snapshot(), confirmedRaw, 'Darstellung des Rollbacks schreibt keine Profilwerte');
    // Reload verwendet ein neues Dokument und dieselben gespeicherten Eingänge.
    const reloadDoc = createPresentationTestDocument(), reloadField = reloadDoc.createElement('select');
    reloadField.id = 'profileRenteAktiv'; reloadDoc.body.appendChild(reloadField);
    applyProfileAssetValuesToDom(loadProfileAssetValues(storage), reloadDoc);
    assertEqual(JSON.stringify(validateManagerRente(reloadField)), '[]', 'Reload erzeugt genau einen verknüpften Rentengrund');
    const obsolete = doc.createElement('small'); obsolete.id = 'profileRenteHelp'; obsolete.textContent = 'Alter doppelter Hinweis'; doc.body.appendChild(obsolete);
    assert(validateManagerRente(field).includes('Veraltete doppelte Rentenerklärung'), 'Wiedereingeführter statischer Doppelhinweis scheitert');
    obsolete.remove();
    const duplicate = doc.createElement('span'); duplicate.id = 'duplicate-reason'; duplicate.className = 'ds-field-reason'; duplicate.textContent = 'Zweiter Grund'; doc.body.appendChild(duplicate);
    const previousDescription = field.getAttribute('aria-describedby');
    field.setAttribute('aria-describedby', `${previousDescription} duplicate-reason`);
    assert(validateManagerRente(field).includes('Rentenstatus benötigt genau eine verknüpfte Begründung'), 'Zwei verknüpfte Gründe scheitern');
    field.setAttribute('aria-describedby', previousDescription); duplicate.remove();
    field.setAttribute('aria-describedby', 'existing-help');
    assert(validateManagerRente(field).includes('Rentenstatus ohne sichtbare verknüpfte Begründung'), 'Fehlende Beschreibung scheitert als Zustandsgegenprobe');
    applyProfileRenteStatusToDom({ renteMonatlich: 0, sonstigeEinkuenfte: 200 }, doc);
    const reason = doc.getElementById(reasonId); reason.hidden = true;
    assert(validateManagerRente(field).length > 0, 'Verborgener Grund scheitert als Zustandsgegenprobe');
    reason.hidden = false; field.disabled = false;
    assert(validateManagerRente(field).includes('Rentenstatus ist nicht gesperrt'), 'Entfallene Sperre scheitert als Zustandsgegenprobe');
}

{
    const { createSelectionDocument, addField } = await import('./designsystem-selection-dom.mjs');
    const { bindManagerProfileControls, syncManagerProfileControls } = await import('../app/tranches/tranchen-manager-profiles.js');
    const doc = createSelectionDocument();
    const groups = {};
    doc.querySelector = selector => selector.includes('profileRentenanpassungPct') ? groups.fixed : null;
    for (const [id, tag] of [['profilePensionSegments', 'div'], ['profileChurchSegments', 'div']]) {
        const host = doc.body.appendChild(doc.createElement(tag)); host.id = id;
    }
    groups.fixed = doc.body.appendChild(doc.createElement('div'));
    for (const [field, id] of Object.entries(PERSON_FORM_IDS)) addField(doc, id, '', field === 'rentenanpassungArt' ? [['wage', 'wie Löhne'], ['cpi', 'Inflation'], ['fix', 'fester Satz']] : null);
    for (const id of ['profileTagesgeld', 'profileRenteMonatlich', 'profileSonstigeEinkuenfte', 'profileGoldAktiv', 'profileGoldZiel', 'profileGoldFloor', 'profileGoldBand', 'profileGoldSteuerfrei',
        'profileHealthBucketEnabled', 'profileHealthBucketInitialAmount', 'profileHealthBucketAssetSource', 'profileHealthBucketTriggerMinGrade', 'profileHealthBucketTriggerMode',
        'profileHealthBucketCoverageMode', 'profileHealthBucketReturnMode', 'profileHealthBucketTargetMode']) addField(doc, id);
    const v = { ...createValidProfileValues(), geburtsdatum: '1958-03-14', rentenbeginn: '2028-11-30', rentenanpassungArt: 'cpi', rentenanpassungPct: 3.125,
        kirchensteuerPct: 7.5, sparerPauschbetrag: 1000, renteSteuerquotePct: 25, geschlecht: 'm' };
    applyProfileAssetValuesToDom(v, doc);
    assertEqual(doc.getElementById('profileGeburtsdatum').value, '14.03.1958', 'Produktiver Formularwriter zeigt Geburt deutsch');
    assertEqual(doc.getElementById('profileRentenbeginn').value, '30.11.2028', 'Produktiver Formularwriter zeigt Rentenbeginn deutsch');
    const read = readProfileAssetValuesFromDom(doc);
    assertEqual(read.geburtsdatum, '1958-03-14', 'Produktiver Formularleser erhält ISO');
    assertEqual(read.rentenbeginn, '2028-11-30', 'Produktiver Formularleser erhält Rentenbeginn ISO');
    bindManagerProfileControls(doc); syncManagerProfileControls(doc);
    const pension = doc.getElementById('profilePensionSegments'), church = doc.getElementById('profileChurchSegments');
    assert(pension.children.some(button => button.textContent === 'Inflation' && button.getAttribute('aria-pressed') === 'true'), 'Vorhandenes cpi bleibt als erhaltene Wahl bedienbar');
    assert(church.children.some(button => button.dataset.value === '7.5'), 'Fremder Kirchensteuersatz bleibt auswählbar');
    assert(groups.fixed.hidden, 'Dormanter fester Satz ist bei Inflation verborgen');
    assertEqual(doc.getElementById('profileRentenanpassungPct').value, 3.125, 'Rendering löscht keinen dormanten Satz');
    const click = (host, value) => {
        const button = host.children.find(button => button.dataset.value === value);
        button.closest = () => button;
        host.dispatchEvent({ type: 'click', target: button });
    };
    click(pension, 'none');
    assertEqual(doc.getElementById('profileRentenanpassungArt').value, 'fix', 'Keine schreibt bestehenden Enum fix nur nach bewusster Auswahl');
    assertEqual(doc.getElementById('profileRentenanpassungPct').value, '0', 'Keine setzt Satz 0 ausschließlich nach bewusster Auswahl');
    doc.getElementById('profileRentenanpassungPct').focus = () => { doc.activeElement = doc.getElementById('profileRentenanpassungPct'); };
    click(pension, 'fix');
    assert(!groups.fixed.hidden, 'Bewusste Wahl fester Satz öffnet Eingabe auch für bisherigen Nullsatz');
    click(church, '8');
    assertEqual(doc.getElementById('profileKirchensteuerPct').value, '8', 'Neue Kirchensteuerwahl ersetzt Altwert ausdrücklich');
    assert(!groups.fixed.hidden, 'Kirchensteuerwahl verändert den ausdrücklich gewählten Rentenmodus nicht');
}
