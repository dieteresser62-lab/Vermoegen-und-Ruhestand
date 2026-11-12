/** UR-1: Was im Haushalt für beide Personen gilt, zeigt die Personenkarte dort, wo es wirkt. Nur Anzeige: Die gespeicherten
 * Werte der Person bleiben unverändert, nichts wird geschrieben.
 * - Rentenanpassung: Im Haushalt gilt die des Hauptprofils für beide Renten (`householdPensionAdjustment`). Die zweite
 *   Person sieht sie als übernommenen, gesperrten Wert mit Grund; ihre eigenen Felder bleiben verborgen und unverändert.
 * - Pflegereserve: Im Haushalt werden die Zielbeträge aktiver Reserven addiert; die übrigen Einstellungen kommen von der
 *   ersten Person mit aktiver Reserve (`aggregateProfileHealthBuckets`). */
import { getHouseholdPrimaryProfileId } from '../profile/profile-registry.js';
import { householdPensionAdjustment } from '../shared/income-adjustment.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';

/** Genitiv für „Annas Personenkarte“, „Klaus’ Personenkarte“.
 *
 * @param {string} name Anzeigename.
 * @returns {string} Name im Genitiv.
 */
export function genitive(name) {
    return /[sßxz]$/i.test(name) ? `${name}’` : `${name}s`;
}

/** Wirksame Rentenanpassung als Anzeigewert und Einheit.
 *
 * @param {{rentAdjMode?: string, rentAdjPct?: number}} adjustment Ergebnis von {@link householdPensionAdjustment}.
 * @returns {{value: string, unit: string}} Text im Feld und Einheit dahinter.
 */
export function pensionAdjustmentDisplay(adjustment) {
    if (adjustment.rentAdjMode === 'cpi') return { value: 'wie Inflation', unit: '' };
    if (adjustment.rentAdjMode === 'fix') {
        const rate = Number(adjustment.rentAdjPct) || 0;
        return rate === 0 ? { value: 'keine', unit: '' } : { value: formatDisplayNumber(rate, { fractionDigits: 1 }), unit: '% fest' };
    }
    return { value: 'wie Löhne', unit: '' };
}

/** Übernahme der Rentenanpassung für die angezeigte Person, oder null, wenn sie ihre eigene gilt.
 *
 * @param {{profiles: Array<{id: string, name: string, belongs: boolean, valid: boolean, values?: Record<string, any>}>}} projection
 *   Projektion aus `projectManagerProfiles`.
 * @param {string} activeId Angezeigte Person.
 * @returns {{from: string, value: string, unit: string, reason: string}|null} Anzeige der übernommenen Anpassung.
 */
export function pensionAdoption(projection, activeId) {
    const members = projection.profiles.filter(profile => profile.belongs);
    const active = members.find(profile => profile.id === activeId);
    const primaryId = getHouseholdPrimaryProfileId(members);
    const primary = members.find(profile => profile.id === primaryId);
    if (!active || !primary || primary.id === active.id || !primary.valid) return null;
    const own = active.valid ? { rentAdjMode: active.values.rentenanpassungArt, rentAdjPct: active.values.rentenanpassungPct } : {};
    const effective = householdPensionAdjustment({ rentAdjMode: primary.values.rentenanpassungArt, rentAdjPct: primary.values.rentenanpassungPct }, own);
    return { from: primary.name, ...pensionAdjustmentDisplay(effective),
        reason: `Übernommen: Im Haushalt gilt die Rentenanpassung von ${primary.name} für beide Renten. Ändern auf ${genitive(primary.name)} Personenkarte.` };
}

/** FR-74: Hinweis unter der eigenen Wahl „wie Löhne“; bei übernommener Anpassung bleibt er verborgen.
 *
 * @param {Document} doc Seite Personen & Vermögen.
 * @returns {void}
 */
export function syncPensionWageHint(doc) {
    const hint = doc.getElementById('profilePensionWageHint');
    if (!hint) return;
    const mode = /** @type {HTMLSelectElement|null} */ (doc.getElementById('profileRentenanpassungArt'))?.value;
    hint.hidden = mode !== 'wage' || doc.getElementById('profilePensionAdjustment')?.hidden === true;
}

/** Satz bei der Pflegereserve, nur für eine Person in einem Haushalt mit zwei Personen.
 *
 * @param {{profiles: Array<{id: string, name: string, belongs: boolean, valid: boolean, values?: Record<string, any>}>}} projection
 * @param {string} activeId Angezeigte Person.
 * @returns {string} Satz oder leer.
 */
export function careReserveHouseholdText(projection, activeId) {
    const members = projection.profiles.filter(profile => profile.belongs);
    if (members.length !== 2 || !members.some(profile => profile.id === activeId)) return '';
    const first = members.find(profile => profile.valid && profile.values?.healthBucket?.enabled);
    return `Im Haushalt werden die Zielbeträge aktiver Pflegereserven addiert. Quelle, Trigger und die übrigen Einstellungen kommen von der ersten Person mit aktiver Reserve${first ? `, zurzeit ${first.name}` : ''}.`;
}

/** Schreibt die Anzeige in die Personenkarte; liest nur die Projektion.
 *
 * @param {Document} doc Seite Personen & Vermögen.
 * @param {Parameters<typeof pensionAdoption>[0]} projection Projektion aus `projectManagerProfiles`.
 * @param {string} activeId Angezeigte Person.
 * @returns {void}
 */
export function renderManagerHouseholdAdoption(doc, projection, activeId) {
    const adoption = pensionAdoption(projection, activeId);
    const byId = id => doc.getElementById(id);
    const own = byId('profilePensionAdjustment'), shown = byId('profilePensionAdopted');
    if (own) own.hidden = Boolean(adoption);
    if (shown) shown.hidden = !adoption;
    const value = /** @type {HTMLInputElement|null} */ (byId('profilePensionAdoptedValue'));
    if (value) value.value = adoption?.value || '';
    const unit = byId('profilePensionAdoptedUnit');
    if (unit) { unit.textContent = adoption?.unit || ''; unit.hidden = !adoption?.unit; }
    const reason = byId('profilePensionAdoptedReason');
    if (reason) { reason.textContent = adoption?.reason || ''; reason.hidden = !adoption; }
    syncPensionWageHint(doc);
    const note = byId('managerIncomeAdoptedNote');
    if (note) note.textContent = adoption ? ` · Rentenanpassung im Haushalt wie bei ${adoption.from}` : '';
    const care = byId('managerHouseholdCareSettings');
    if (care) care.textContent = careReserveHouseholdText(projection, activeId);
}
