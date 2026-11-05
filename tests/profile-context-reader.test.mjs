import { readProfileContext } from '../app/profile/profile-context-reader.js';
import { renderSuiteProfile, renderSuiteHousehold } from '../app/shared/suite-frame.js';
import { PROFILE_STORAGE_KEYS as keys } from '../app/profile/profile-state.js';

let mutations = 0;
const registry = { version: 1, profiles: {
    a: { meta: { id: 'a', name: '<b>Synthetisch A</b>' }, data: {} },
    b: { meta: { id: 'b' }, data: {} }
} };
const records = new Map([[keys.registry, JSON.stringify(registry)], [keys.current, 'a'], [keys.active, 'a']]);
const storage = { getItem: key => records.get(key) ?? null,
    setItem() { mutations++; }, removeItem() { mutations++; }, clear() { mutations++; } };
const profile = { dataset: {}, textContent: '' }, household = { textContent: '' };
const doc = { getElementById: id => id === 'suiteProfileContext' ? profile : household };
renderSuiteProfile(doc, readProfileContext(storage));
assertEqual(profile.textContent, '', 'Aktives Profil wird nicht angezeigt');
assertEqual(profile.dataset.profileName, '<b>Synthetisch A</b>', 'Profilname bleibt interne Metadaten');
assertEqual(profile.hidden, true, 'Profilkontext ist verborgen');
assertEqual(profile.dataset.profileId, 'a', 'Validierte aktive Identität wird sichtbar');
renderSuiteHousehold([{ id: 'b', name: 'Haushalt B' }], doc);
assertEqual(household.textContent, 'Haushalt: Haushalt B', 'Haushalt bleibt von aktiver Einzelidentität getrennt');
renderSuiteHousehold([], doc);
assertEqual(household.textContent, 'Haushalt: Keine Auswahl', 'Leere Auswahl ersetzt keine Mitgliedschaft');
for (const [current, active, expected] of [
    ['a', 'b', 'unavailable'], ['ghost', 'ghost', 'unavailable'], ['a', 'ghost', 'unavailable'],
    ['__proto__', '__proto__', 'unavailable'], ['a', '', 'missing'], ['', 'a', 'missing'], ['', '', 'missing'], ['b', 'b', 'ready']
]) {
    records.set(keys.current, current); records.set(keys.active, active);
    const context = readProfileContext(storage);
    assertEqual(context.status, expected, `${current}/${active}: kein stiller Identitätsersatz`);
    if (expected === 'ready') assertEqual(context.name, 'b', 'Fehlender Name verwendet validierte ID');
    renderSuiteProfile(doc, context);
    if (expected !== 'ready') assertEqual(profile.dataset.profileId, undefined, 'Neutralzustand entfernt alte Identität');
}
for (const raw of [null, '', '{}', '{', JSON.stringify({ ...registry, version: 2 }), JSON.stringify({ version: 1, profiles: { a: { meta: { id: 'b' }, data: {} } } })]) {
    records.set(keys.registry, raw);
    records.set(keys.current, 'a'); records.set(keys.active, 'a');
    assertEqual(readProfileContext(storage).status, 'unavailable', 'Beschädigte oder verwaiste Kontexte bleiben neutral');
}
records.clear();
assertEqual(readProfileContext(storage).status, 'missing', 'Leeres Handbuch erzeugt kein Defaultprofil');
assertEqual(readProfileContext({ getItem() { throw new Error('privat'); } }).status, 'unavailable', 'Nicht lesbarer Speicher gibt keine Rohfehler aus');
records.set(keys.registry, JSON.stringify(registry));
assertEqual(readProfileContext({ getItem(key) { if (key !== keys.registry) throw new Error('privat'); return records.get(key); } }).status, 'unavailable', 'ID-Lesefehler bleibt neutral');
assertEqual(mutations, 0, 'Reader und Rendern verursachen zusammen null Speichermutationen');
renderSuiteProfile(doc, { status: 'loading' });
assertEqual(profile.textContent, '', 'Vor Bereitschaft bleibt der definierte Ladezustand');
