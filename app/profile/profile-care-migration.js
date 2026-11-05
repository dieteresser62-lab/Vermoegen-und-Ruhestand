import { careSettingsFromRecord, normalizeCareForm } from '../shared/care-benefits.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { getHouseholdPrimaryProfileId } from './profile-registry.js';

/**
 * @param source Rohrecords der Personenquelle.
 * @param forms Gemeinsam gelesene Pflegeformen.
 * @returns Recordkopie mit den normalisierten Pflegeformen.
 */
export function migrateCareFormsRecord(source, forms = careSettingsFromRecord(source)) {
    const next = { ...source };
    for (const g of [1, 2, 3, 4, 5]) {
        const key = `sim_pflegeStufe${g}Form`;
        if (source[key]) next[key] = normalizeCareForm(source[key], g);
    }
    const grade = Number(source.profile_care_grade_today) || 0;
    if (grade) next.profile_care_form_today = normalizeCareForm(source.profile_care_form_today || forms.forms[grade], grade);
    else if (source.profile_care_form_today) next.profile_care_form_today = '';
    return next;
}

/** Aktuelle Livewerte und inaktive Profile übernehmen, ohne Rückfrage oder Kostenänderung.
 * @param {import('../../typcheck/runtime-contracts.js').StorageWriter} [storage]
 * @returns Ob Records geschrieben wurden.
 */
export function migrateStoredCareForms(storage = persistenceStorage) {
    const raw = storage.getItem('rs_profiles_v1');
    let registry;
    try { registry = raw ? JSON.parse(raw) : null; } catch { return { changed: false }; }
    const current = storage.getItem('rs_current_profile') || storage.getItem('rs_active_profile');
    const keys = ['profile_care_grade_today', 'profile_care_form_today', 'sim_pflegeKostenStaffelPreset',
        ...[1, 2, 3, 4, 5].map(g => `sim_pflegeStufe${g}Form`)];
    const live = Object.fromEntries(keys.map(key => [key, storage.getItem(key)]).filter(([, value]) => value !== null));
    const profiles = Object.entries(registry?.profiles || {});
    const sources = profiles.map(([id, profile]) => [id, id === current ? { ...profile.data, ...live } : { ...profile.data }]);
    const members = profiles.filter(([, p]) => p.meta?.belongsToHousehold !== false).map(([id, p]) => ({ id, meta: p.meta }));
    const primary = sources.find(([id]) => id === getHouseholdPrimaryProfileId(members));
    const settings = careSettingsFromRecord(primary?.[1] || live);
    const writes = [];
    let changed = false;
    for (const [id, source] of sources) {
        const inHousehold = registry.profiles[id].meta?.belongsToHousehold !== false;
        const next = migrateCareFormsRecord(source, inHousehold ? settings : careSettingsFromRecord(source));
        for (const key of keys) if (next[key] !== undefined) {
            if (registry.profiles[id].data[key] !== next[key]) { registry.profiles[id].data[key] = next[key]; changed = true; }
            if (id === current && storage.getItem(key) !== next[key]) writes.push([key, next[key]]);
        }
    }
    if (!registry?.profiles?.[current]) {
        const next = migrateCareFormsRecord(live, settings);
        for (const key of keys) if (next[key] !== undefined && next[key] !== live[key]) writes.push([key, next[key]]);
    }
    if (changed) writes.push(['rs_profiles_v1', JSON.stringify(registry)]);
    if (writes.length && storage.getItem('household_care_forms_notice_v1') !== 'shown') writes.push(['household_care_forms_notice_v1', 'pending']);
    const previous = writes.map(([key]) => [key, storage.getItem(key)]);
    try { for (const [key, value] of writes) storage.setItem(key, value); }
    catch (error) {
        for (const [key, value] of previous) value === null ? storage.removeItem(key) : storage.setItem(key, value);
        throw error;
    }
    return { changed: writes.length > 0 };
}

/**
 * @param doc Zieldokument der Seite.
 * @param storage Speicherzugang des vorhandenen Besitzers.
 * @returns Ob ein ausstehender Hinweis angezeigt wurde.
 */
export function showCareFormsMigrationNotice(doc, storage = persistenceStorage) {
    if (storage.getItem('household_care_forms_notice_v1') !== 'pending' || !doc?.createElement || !doc.body) return;
    const hint = doc.createElement('p');
    hint.id = 'careFormsMigrationNotice'; hint.className = 'ds-note';
    hint.textContent = 'Pflegeformen übernommen. Die heutige Form steht je Person in Personen & Vermögen; die Formen für künftige Grade im Simulator unter Annahmen → Pflege.';
    (doc.querySelector?.('main') || doc.body).prepend(hint);
    storage.setItem('household_care_forms_notice_v1', 'shown');
    return true;
}
