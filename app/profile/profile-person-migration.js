import { appNow } from '../shared/app-clock.js';
import { assertProfileIdentityRecords } from './profile-storage.js';
import { loadProfileRegistry } from './profile-registry.js';
import { CONFIG } from '../balance/balance-config.js';
import { PERSON_VALUE_KEYS, BALANCE_PERSON_FIELDS, stripBalancePersonInputs, personReferenceYear, validateIsoDate, personAge } from './profile-person-data.js';
import { isProfileScopedKey } from './profile-key-policy.js';
import { isAllowedSnapshotCaptureKey } from '../shared/persistence-key-policy.js';
import { PersistenceFacade } from '../shared/persistence-facade.js';
import { SnapshotArchive } from '../shared/snapshot-archive.js';
import { requestPageChoice } from '../shared/page-choice-dialog.js';
import { showConfirmedPersonMigrationNotice } from '../shared/person-data-status.js';
import { createNavigationOperationLifecycle } from '../shared/navigation-guard.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';

const REGISTRY = 'rs_profiles_v1', CURRENT = 'rs_current_profile', ACTIVE = 'rs_active_profile';
const K = { ...PERSON_VALUE_KEYS, alter: 'profile_aktuelles_alter', renteMonatlich: 'profile_rente_monatlich', sonstigeEinkuenfte: 'profile_sonstige_einkuenfte' };
const P1 = { alter: ['p1StartAlter', 'startAlter'], geschlecht: ['p1Geschlecht', 'geschlecht'],
    renteMonatlich: ['p1Monatsrente', 'renteMonatlich'], offset: ['p1StartInJahren', 'renteStartOffsetJahre'],
    rentenanpassungArt: ['rentAdjMode', 'renteIndexierungsart'], rentenanpassungPct: ['rentAdjPct', 'renteFesterSatz', 'r2Anpassung'],
    kirchensteuerPct: ['p1KirchensteuerPct', 'kirchensteuerSatz'], sparerPauschbetrag: ['p1SparerPauschbetrag', 'startSPB'] };
const P2 = { alter: ['r2StartAlter'], geschlecht: ['r2Geschlecht'], renteMonatlich: ['r2Monatsrente', 'r2Brutto'],
    offset: ['r2StartInJahren'], kirchensteuerPct: ['r2KirchensteuerPct'], sparerPauschbetrag: ['r2SparerPauschbetrag'], renteSteuerquotePct: ['r2Steuerquote'] };
export const LEGACY_PERSON_KEYS = Object.freeze([...new Set([...Object.values(P1).flat(), ...Object.values(P2).flat(), 'partnerAktiv', 'chkPartnerAktiv'].map(id => `sim_${id}`))]);
const defaults = { geschlecht: 'm', renteMonatlich: 0, sonstigeEinkuenfte: 0, offset: 0, rentenanpassungArt: 'wage', rentenanpassungPct: 0, kirchensteuerPct: 0, sparerPauschbetrag: 0, renteSteuerquotePct: 0, geburtsdatum: '', rentenbeginn: '' };
const missing = value => value === undefined || value === null || value === '';
const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

function candidateValue(field, raw, alias = '') {
    if (missing(raw)) return undefined;
    if (field === 'geschlecht') { if (['m', 'w', 'd'].includes(raw)) return raw; }
    else if (field === 'rentenanpassungArt') { if (['wage', 'cpi', 'fix', 'fest'].includes(raw)) return raw === 'fest' ? 'fix' : raw; }
    else if (field === 'geburtsdatum' || field === 'rentenbeginn') { if (validateIsoDate(raw).status === 'valid') return raw; }
    else {
        let n = typeof raw === 'boolean' ? NaN : Number(raw);
        if (alias === 'r2Brutto') n = Math.round(n / 12);
        // Versteckter P1-Alias wird wie bisher in Prozent projiziert.
        if (alias === 'kirchensteuerSatz') n *= 100;
        if (Number.isFinite(n) && n >= (field === 'rentenanpassungPct' ? -100 : 0)
            && (!['alter', 'offset'].includes(field) || Number.isSafeInteger(n))
            && (!['kirchensteuerPct', 'renteSteuerquotePct'].includes(field) || n <= 100)) return n;
    }
    throw new Error(`Beschädigter Personenwert: ${alias || field}.`);
}

function collectCandidates(data, source, map, add) {
    for (const [field, aliases] of Object.entries(map)) for (const alias of aliases) {
        const value = candidateValue(field, data[`sim_${alias}`], alias);
        const basis = alias === 'r2Brutto' ? ' · Jahresbruttorente / 12, Monatsbetrag gerundet' : '';
        if (value !== undefined) {
            const offsetAlias = map === P1 && alias === 'renteMonatlich' ? 'renteStartOffsetJahre' : map.offset?.[0];
            const offset = offsetAlias ? candidateValue('offset', data[`sim_${offsetAlias}`], offsetAlias) : undefined;
            add(field, value, `${source} · Simulator (${alias})${basis}`,
                field === 'renteMonatlich' && offset !== undefined
                    ? { offset, source: `${source} · Simulator (${offsetAlias})` } : null);
        }
    }
}

/** Ausschließlich Entwurf aus Rohrecords. Auch Außenprofile bleiben enthalten. */
export function buildPersonMigrationDraft(records, { referenceYear = appNow().getFullYear(), partnerTargets = {}, inspectOnly = false } = {}) {
    const loaded = loadProfileRegistry({ getItem: key => records[key] ?? null });
    if (['corrupt', 'unavailable'].includes(loaded.status)) throw new Error(loaded.error?.message || 'Ungültige Profilregistry.');
    let registry = loaded.value || { version: 1, profiles: {} };
    registry = JSON.parse(JSON.stringify(registry));
    if (!registry.profiles || typeof registry.profiles !== 'object' || Array.isArray(registry.profiles)) throw new Error('Ungültige Profilregistry.');
    assertProfileIdentityRecords(registry, records[CURRENT], records[ACTIVE], records[REGISTRY] ?? null);
    if (!Object.keys(registry.profiles).length) {
        const hasLegacyPerson = Object.keys(records).some(key => LEGACY_PERSON_KEYS.includes(key) || Object.values(K).includes(key))
            || BALANCE_PERSON_FIELDS.some(field => Object.hasOwn(JSON.parse(records[CONFIG.STORAGE.LS_KEY] || '{}').inputs || {}, field));
        registry.profiles.default = { meta: { id: 'default', name: 'Default', belongsToHousehold: true },
            data: hasLegacyPerson ? {} : { [K.personSchemaVersion]: '1' } };
    }
    const currentId = records[CURRENT] || (registry.profiles.default ? 'default' : Object.keys(registry.profiles)[0]);
    assertProfileIdentityRecords(registry, currentId, records[ACTIVE], records[REGISTRY] ?? null);
    const live = Object.fromEntries(Object.entries(records).filter(([key]) => isProfileScopedKey(key)));
    const originals = Object.fromEntries(Object.entries(registry.profiles).map(([id, profile]) => [id, { ...profile.data }]));
    const people = Object.entries(registry.profiles).map(([id, profile]) => {
        const data = id === currentId ? { ...profile.data, ...live } : profile.data;
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Ungültiger Profilbestand.');
        const balance = data[CONFIG.STORAGE.LS_KEY] ? JSON.parse(data[CONFIG.STORAGE.LS_KEY]) : {};
        const storedBalance = profile.data[CONFIG.STORAGE.LS_KEY] ? JSON.parse(profile.data[CONFIG.STORAGE.LS_KEY]) : {};
        const old = LEGACY_PERSON_KEYS.some(key => Object.hasOwn(data, key))
            || BALANCE_PERSON_FIELDS.some(field => Object.hasOwn(balance.inputs || {}, field) || Object.hasOwn(storedBalance.inputs || {}, field));
        return { id, name: profile.meta?.name || id, data, needed: String(data[K.personSchemaVersion]) !== '1' || old, candidates: {}, sources: {} };
    });
    const pendingAssignments = [];
    if (inspectOnly) return { records: { ...records }, registry, people, currentId, referenceYear, pendingAssignments };
    const add = person => (field, value, source, origin = null) => {
        const list = person.candidates[field] ||= [];
        let entry = list.find(item => item.value === value);
        if (!entry) { entry = { value, sources: [] }; list.push(entry); }
        if (!entry.sources.includes(source)) entry.sources.push(source);
        if (origin) (entry.pensionOrigins ||= []).push(origin);
    };
    for (const person of people) {
        const append = add(person);
        for (const [field, key] of Object.entries(K)) {
            if (['personSchemaVersion', 'personMigration'].includes(field)) continue;
            const value = candidateValue(field, person.data[key]);
            if (value !== undefined) append(field, value, 'Profil');
            // Live und Registry bleiben getrennte Kandidaten, statt stillem Überschreiben.
            const stored = candidateValue(field, originals[person.id]?.[key]);
            if (stored !== undefined) append(field, stored, 'Profil · Registry');
        }
        const balanceSources = [[person.data, 'Balance']];
        if (person.id === currentId) balanceSources.push([originals[person.id], 'Balance · Registry']);
        for (const [data, source] of balanceSources) {
            const balance = data[CONFIG.STORAGE.LS_KEY] ? JSON.parse(data[CONFIG.STORAGE.LS_KEY]).inputs || {} : {};
            for (const [field, alias] of Object.entries({ alter: 'aktuellesAlter', renteMonatlich: 'renteMonatlich', sonstigeEinkuenfte: 'sonstigeEinkuenfte', sparerPauschbetrag: 'sparerPauschbetrag', kirchensteuerPct: 'kirchensteuerSatz' })) {
                const value = candidateValue(field, balance[alias], alias === 'kirchensteuerSatz' ? alias : '');
                if (value !== undefined) append(field, value, source);
            }
        }
        collectCandidates(person.id === currentId ? live : person.data, person.name, P1, append);
        if (person.id === currentId) collectCandidates(originals[person.id] || {}, `${person.name} · Registry`, P1, append);
        // Der alte Profilmerge verwendete ohne eigenen kanonischen Wert 0 %.
        // Eine abweichende gespeicherte P2-Steuerquote benötigt deshalb auch
        // ohne weitere Quelle eine sichtbare Entscheidung gegen diese Basis.
        if (!person.candidates.renteSteuerquotePct?.length) {
            append('renteSteuerquotePct', 0, 'Bisherige wirksame Profilmerge-Basis: 0 %');
        }
        if (person.data.profile_rente_aktiv !== undefined && !missing(person.data.profile_rente_aktiv)
            && !['true', 'false', true, false].includes(person.data.profile_rente_aktiv)) throw new Error('Beschädigter Rentenstatus.');
    }
    for (const person of [...people]) {
        const hasPartner = Object.values(P2).flat().some(alias => !missing(person.data[`sim_${alias}`]));
        if (!hasPartner) continue;
        const household = people.filter(p => p.id !== person.id && registry.profiles[p.id].meta?.belongsToHousehold !== false);
        let targetId = partnerTargets[person.id];
        if (!targetId && registry.profiles[person.id].meta?.belongsToHousehold !== false && household.length === 1) targetId = household[0].id;
        if (!targetId) { pendingAssignments.push({ id: person.id, name: person.name }); continue; }
        if (targetId === '__new__') {
            targetId = `legacy-partner-${person.id}`;
            if (registry.profiles[targetId]) throw new Error('Partner-ID ist bereits belegt. Bitte vorhandene Person wählen.');
            registry.profiles[targetId] = { meta: { id: targetId, name: `Übernommene Person (${person.name})`, belongsToHousehold: false }, data: {} };
            people.push({ id: targetId, name: registry.profiles[targetId].meta.name, data: {}, needed: true, candidates: {}, sources: {} });
        }
        const target = people.find(p => p.id === targetId);
        if (!target || target.id === person.id) throw new Error('Ungültige Partnerzuordnung.');
        // Ein bereits aktuelles Zielprofil ist autoritativ; ein späterer
        // Altimport darf es nicht durch seine veraltete Partnerkopie umstellen.
        if (target.needed) {
            collectCandidates(person.id === currentId ? live : person.data, person.name, P2, add(target));
            if (person.id === currentId) collectCandidates(originals[person.id] || {}, `${person.name} · Registry`, P2, add(target));
        }
    }
    for (const person of people) {
        const zeroOrNo = !missing(person.data.profile_rente_monatlich) && Number(person.data.profile_rente_monatlich) === 0
            || ['false', false].includes(person.data.profile_rente_aktiv);
        const candidates = person.candidates.renteMonatlich || [];
        const futureIndex = zeroOrNo ? candidates.findIndex(candidate => candidate.value > 0
            && candidate.pensionOrigins?.some(origin => origin.offset > 0)) : -1;
        if (futureIndex >= 0) {
            const origin = candidates[futureIndex].pensionOrigins.find(origin => origin.offset > 0);
            const offsetIndex = person.candidates.offset.findIndex(candidate => candidate.value === origin.offset && candidate.sources.includes(origin.source));
            person.suggested = { renteMonatlich: futureIndex, offset: offsetIndex };
            person.suggestionReason = 'künftige Rente aus dem Simulator';
        }
    }
    return { records: { ...records }, registry, people, currentId, referenceYear, pendingAssignments };
}

export function preferredMigrationCandidate(person, field) {
    return person.suggested?.[field] ?? Math.max(0, (person.candidates[field] || []).findIndex(candidate => candidate.sources.some(source => !source.includes('Simulator'))));
}

export function applyPersonMigrationChoices(draft, choices = {}) {
    if (draft.pendingAssignments.length) throw new Error('Partnerzuordnung fehlt.');
    const registry = JSON.parse(JSON.stringify(draft.registry));
    for (const person of draft.people) {
        if (!person.needed) continue;
        const values = { ...defaults }, sources = {};
        for (const [field, candidates] of Object.entries(person.candidates)) {
            let preferred = preferredMigrationCandidate(person, field);
            if (field === 'offset' && choices[person.id]?.renteMonatlich !== undefined) {
                const pension = person.candidates.renteMonatlich[Number(choices[person.id].renteMonatlich)];
                const origin = pension?.pensionOrigins?.find(origin => origin.offset > 0);
                preferred = origin ? candidates.findIndex(candidate => candidate.value === origin.offset && candidate.sources.includes(origin.source))
                    : Math.max(0, candidates.findIndex(candidate => candidate.sources.some(source => !source.includes('Simulator'))));
            }
            const index = Number(choices[person.id]?.[field] ?? preferred);
            if (!Number.isSafeInteger(index) || !candidates[index]) throw new Error('Ungültige Quellenauswahl.');
            values[field] = candidates[index].value; sources[field] = candidates[index].sources;
        }
        if (!person.candidates.geschlecht?.length) sources.geschlecht = ['angenommen'];
        const data = { ...person.data };
        LEGACY_PERSON_KEYS.forEach(key => delete data[key]);
        if (data[CONFIG.STORAGE.LS_KEY]) {
            const state = stripBalancePersonInputs(JSON.parse(data[CONFIG.STORAGE.LS_KEY]));
            if (state.lastState && state.lastInflationAppliedAtYear === undefined) state.lastInflationAppliedAtYear = draft.referenceYear - 1;
            if (state.ageAdjustedForInflation && state.needsAdjustedForInflationYear === undefined) state.needsAdjustedForInflationYear = draft.referenceYear;
            data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
        }
        for (const [field, key] of Object.entries(K)) {
            if (['personSchemaVersion', 'personMigration'].includes(field)) continue;
            if (values[field] !== undefined) data[key] = String(values[field]);
        }
        data.profile_rente_aktiv = values.renteMonatlich + values.sonstigeEinkuenfte > 0 ? 'true' : 'false';
        data[K.personSchemaVersion] = '1';
        data[K.personMigration] = JSON.stringify({ referenceYear: draft.referenceYear, sources,
            renteStartOffsetJahre: values.offset, suggestedRentenbeginn: values.offset > 0 ? `${draft.referenceYear + values.offset}-01-01` : null,
            needsBirthDate: !values.geburtsdatum, suggestedBirthYear: values.alter === undefined ? null : draft.referenceYear - values.alter - 1 });
        registry.profiles[person.id].data = data;
    }
    const next = { ...draft.records, [REGISTRY]: JSON.stringify(registry), [CURRENT]: draft.currentId, [ACTIVE]: draft.currentId };
    const active = registry.profiles[draft.currentId].data;
    // Nur Personenkeys und aktive Profilwerte ersetzen; globale Fachbestände erhalten.
    for (const key of Object.keys(next)) if (isProfileScopedKey(key) && isAllowedSnapshotCaptureKey(key) && !Object.hasOwn(active, key)) delete next[key];
    for (const [key, value] of Object.entries(active)) if (isProfileScopedKey(key) && isAllowedSnapshotCaptureKey(key) && value !== null && value !== undefined) next[key] = String(value);
    return next;
}

const fieldLabels = {
    alter: year => `Alter am 01.01.${year}`, geschlecht: 'Geschlecht', renteMonatlich: 'Monatliche Rente netto',
    sonstigeEinkuenfte: 'Sonstige Einkünfte', kirchensteuerPct: 'Kirchensteuer', sparerPauschbetrag: 'Sparer-Pauschbetrag',
    offset: 'Rentenbeginn', geburtsdatum: 'Geburtsdatum', rentenbeginn: 'Rentenbeginn',
    rentenanpassungArt: 'Rentenanpassung', rentenanpassungPct: 'Satz der Rentenanpassung', renteSteuerquotePct: 'Steuerquote der Rente'
};
const description = 'Personendaten werden künftig nur noch in Personen & Vermögen gepflegt. Wo bisher zwei Werte gespeichert waren, wähle bitte einmal den richtigen.';
export function presentMigrationCandidate(field, candidate, referenceYear) {
    const n = value => Number(value).toLocaleString('de-DE', { maximumFractionDigits: 20 });
    const value = candidate.value;
    const formatted = field === 'alter' ? `${n(value)} Jahre`
        : field === 'geschlecht' ? { m: 'Männlich', w: 'Weiblich', d: 'Divers' }[value]
        : field === 'rentenanpassungArt' ? { wage: 'Lohnentwicklung', cpi: 'Inflation', fix: 'Fester Satz' }[value]
        : ['renteMonatlich', 'sonstigeEinkuenfte', 'sparerPauschbetrag'].includes(field) ? `${n(value)} €`
        : ['kirchensteuerPct', 'rentenanpassungPct', 'renteSteuerquotePct'].includes(field) ? `${n(value)} %`
        : field === 'offset' ? value === 0 ? 'Rente läuft bereits' : `Ab ${referenceYear + value} · in ${n(value)} Jahren`
        : ['geburtsdatum', 'rentenbeginn'].includes(field) ? value.split('-').reverse().join('.') : String(value);
    const sources = [...new Set(candidate.sources.map(source => source.includes('Simulator') ? 'aus dem Simulator' : 'aus Personen & Vermögen'))];
    return `${formatted} · ${sources.join(' / ')}`;
}
const coordinators = new WeakMap();
export function migratePersonData({ storage = PersistenceFacade, archive = SnapshotArchive, decide = requestPageChoice,
    doc = globalThis.document, win = globalThis.window, now = appNow(), guard = doc ? getPageNavigationGuard(doc, win) : null } = {}) {
    if (coordinators.has(storage)) return coordinators.get(storage);
    const lifecycle = createNavigationOperationLifecycle({ guard, message: 'Personendaten werden sicher übernommen – bitte warten.' });
    const capture = () => Object.fromEntries(storage.keysSync().filter(isAllowedSnapshotCaptureKey).map(key => [key, storage.getItemSync(key)]));
    const task = lifecycle.run({}, async operation => {
        if (storage.hasSyncWriteBlocks?.()) throw new Error('Personenumstellung ist bis zum Reload/Recovery schreibend blockiert.');
        if (await storage.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
        operation.check();
        const original = capture();
        const state = original[CONFIG.STORAGE.LS_KEY] ? JSON.parse(original[CONFIG.STORAGE.LS_KEY]) : {};
        const referenceYear = personReferenceYear(state.annualPeriodMetadata, now);
        let draft = buildPersonMigrationDraft(original, { referenceYear, inspectOnly: true });
        if (!draft.people.some(person => person.needed)) return { ok: true, status: 'current' };
        const snapshot = await archive.createSnapshot({ kind: 'person-data-migration-recovery', label: 'Vor Umstellung der Personendaten',
            records: original, activeProfileId: draft.currentId, activeProfileName: draft.registry.profiles[draft.currentId].meta?.name,
            restoreScope: { profileRegistryMode: 'replace-all-rollback', profileLiveDataMode: 'replace-all-rollback' } }, { storage, navigationOperation: operation });
        const recovered = await archive.readSnapshot(snapshot.id, { storage });
        if (!same(original, recovered.records)) throw new Error('Recovery-Snapshot ist nicht bytegleich.');
        draft = buildPersonMigrationDraft(original, { referenceYear });
        const unchanged = () => { operation.check(); if (!same(original, capture())) throw new Error('Der Rohbestand oder die Profilidentität hat sich geändert.'); };
        unchanged();
        const choices = {};
        let explicitlyAccepted = false;
        const conflictRows = person => Object.entries(person.candidates).filter(([, candidates]) => candidates.length > 1).map(([field, candidates]) => {
            const preferred = preferredMigrationCandidate(person, field);
            return { id: `${person.id}:${field}`, kind: 'radio', selected: String(preferred),
                label: (draft.people.filter(p => p.needed).length > 1 ? `${person.name} · ` : '')
                    + (typeof fieldLabels[field] === 'function' ? fieldLabels[field](referenceYear) : fieldLabels[field]),
                options: candidates.map((candidate, index) => ({ value: String(index), suggested: index === preferred,
                    label: presentMigrationCandidate(field, candidate, referenceYear) + (field === 'renteMonatlich' && index === preferred && person.suggestionReason ? ` · ${person.suggestionReason}` : '') })) };
        });
        const collectChoices = result => {
            for (const person of draft.people) {
                choices[person.id] = Object.fromEntries(Object.keys(person.candidates).map(field => [field, result[`${person.id}:${field}`] ?? String(preferredMigrationCandidate(person, field))]));
            }
        };
        let committed = false, next;
        const commitChoices = async () => {
            next = applyPersonMigrationChoices(draft, choices);
            unchanged();
            const release = storage.blockSyncWrites?.(Object.keys(original), 'Personenübernahme läuft – bitte warten.', { prefixes: ['profile_', 'sim_'] });
            try {
                await storage.replaceRecordsTransactional(next, { allowKey: isAllowedSnapshotCaptureKey, expectedRecords: original, navigationOperation: operation });
                committed = true;
            } catch (error) {
                if (error.code === 'rollback_failed') storage.blockSyncWrites?.([...Object.keys(original), ...Object.keys(next)],
                    'Personenübernahme und Rollback unbestätigt. Bitte neu laden und den Recovery-Snapshot wiederherstellen.', { prefixes: ['profile_', 'sim_'] });
                throw error;
            } finally { release?.(); }
        };
        const mappingRows = draft.pendingAssignments.map(person => ({ id: `mapping:${person.id}`, label: `Gespeicherter Partner von ${person.name}`, required: true, refreshRows: true,
            options: [{ value: '', label: 'Person ausdrücklich zuordnen' }, ...draft.people.filter(p => p.id !== person.id).map(p => ({ value: p.id, label: p.name })),
                { value: '__new__', label: 'Als neue Außenperson übernehmen' }] }));
        const pendingAssignments = [...draft.pendingAssignments];
        const withTargets = values => buildPersonMigrationDraft(original, { referenceYear,
            partnerTargets: Object.fromEntries(pendingAssignments.map(person => [person.id, values[`mapping:${person.id}`]])) });
        const rows = [...mappingRows, ...draft.people.filter(p => p.needed).flatMap(conflictRows)];
        if (rows.length) {
            const chooseAndCommit = async result => {
                unchanged();
                if (mappingRows.length) draft = withTargets(result);
                collectChoices(result);
                await commitChoices();
            };
            const needed = draft.people.filter(p => p.needed);
            const result = await decide({ title: mappingRows.length ? 'Personendaten und gespeicherte Partner übernehmen'
                : needed.length === 1 ? `Zwei Angaben für ${needed[0].name} – welche stimmt?` : 'Personendaten übernehmen – welche Angaben stimmen?',
                description, rows, updateRows: mappingRows.length ? values => [...mappingRows, ...withTargets(values).people.filter(p => p.needed).flatMap(conflictRows)] : undefined,
                confirmLabel: 'Übernehmen', cancelLabel: 'Später', onConfirm: chooseAndCommit, doc, signal: operation.controller.signal });
            if (!result) return { ok: false, status: 'cancelled' };
            explicitlyAccepted = true;
            // Injizierte Entscheider ohne Bestätigungsphase behalten ihren Vertrag.
            if (!committed) await chooseAndCommit(result);
        } else await commitChoices();
        if (explicitlyAccepted) {
            const registry = JSON.parse(next[REGISTRY]);
            const names = draft.people.filter(person => person.needed
                && personAge(registry.profiles[person.id].data, referenceYear).status === 'missing').map(person => person.name);
            showConfirmedPersonMigrationNotice(names, doc);
        }
        return { ok: true, status: 'migrated', snapshotId: snapshot.id };
    });
    coordinators.set(storage, task);
    task.finally(() => { if (coordinators.get(storage) === task) coordinators.delete(storage); }).catch(() => {});
    return task;
}
