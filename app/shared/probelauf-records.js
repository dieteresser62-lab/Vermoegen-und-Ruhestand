import { CONFIG } from '../balance/balance-config.js';
import { isProfileScopedKey } from '../profile/profile-key-policy.js';
import { isAllowedPersistenceImportKey, isSnapshotTechnicalKey, isLegacySnapshotKey } from './persistence-key-policy.js';
import { BALANCE_PLAN_INPUT_KEYS, SIMULATOR_LEGACY_PLAN_FIELDS } from '../profile/household-plan.js';
import { HOUSEHOLD_PLAN_FIELDS, formatHouseholdPlanValue } from './household-plan-fields.js';
import { fingerprint } from '../overview/overview-simulation-summary.js';
import { formatDisplayNumber } from './designsystem-number-format.js';

export const parseRecord = raw => {
    if (typeof raw !== 'string') return raw ?? null;
    try { return JSON.parse(raw); } catch { return raw; }
};
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const omitted = new Set(['version', 'schemaVersion', 'createdAt', 'updatedAt', 'importedAt', 'asOf', 'currentPrice', 'lastPrice', 'priceSource', 'quoteSource']);
const priceInput = /^(?:endeVJ(?:_\d)?|ath|jahreSeitAth|inflation|capeRatio|marketCapeRatio|zinssatz|lohnWachstum)$/;
const ignoredKey = key => !isAllowedPersistenceImportKey(key) || isSnapshotTechnicalKey(key) || isLegacySnapshotKey(key)
    || /^(?:overview_(?!month_provision)|rs_(?:current|active)_profile|etfProxy|showCare|.*LogDetail|logDetail|sim\.)/.test(key)
    || /^(?:rs_daily_prices_v1|rs_data_backup_summary_v1|sim_(?:show|log|worstLog|backtestLog))/.test(key)
    || /(?:migration|schema_version|warning_ack)/i.test(key);
// Fachrecords der Übernahme; dieselben technischen Schlüssel bleiben im Vergleich außen vor.
export const isProbelaufTransferRecordKey = key => !ignoredKey(key);

/** Technische Records bleiben echt. Die Livewerte werden dem richtigen Profil zugeordnet. */
export function buildProbelaufTransferRecords(realRecords, playRecords) {
    const merge = (real = {}, play = {}) => {
        const result = { ...real };
        for (const key of Object.keys(result)) if (isProbelaufTransferRecordKey(key) && !Object.hasOwn(play, key)) delete result[key];
        for (const [key, value] of Object.entries(play)) if (isProbelaufTransferRecordKey(key)) result[key] = value;
        return result;
    };
    const target = merge(realRecords, playRecords);
    const real = probelaufRecordContext(realRecords), play = probelaufRecordContext(playRecords);
    if (playRecords.rs_profiles_v1) {
        const registry = play.registry;
        for (const [id, profile] of Object.entries(registry.profiles)) profile.data = merge(real.registry.profiles[id]?.data, profile.data);
        const raw = JSON.stringify(registry);
        target.rs_profiles_v1 = fingerprint(parseRecord(realRecords.rs_profiles_v1)) === fingerprint(registry) ? realRecords.rs_profiles_v1 : raw;
        const activeId = registry.profiles[real.activeId] ? real.activeId : Object.keys(registry.profiles)[0];
        for (const key of Object.keys(target)) if (isProfileScopedKey(key) && isProbelaufTransferRecordKey(key)) delete target[key];
        for (const [key, value] of Object.entries(registry.profiles[activeId]?.data || {})) {
            if (isProfileScopedKey(key) && isProbelaufTransferRecordKey(key)) target[key] = value;
        }
        if (activeId !== real.activeId) {
            if (activeId) target.rs_current_profile = target.rs_active_profile = activeId;
            else { delete target.rs_current_profile; delete target.rs_active_profile; }
        }
    }
    // Archiv und Steuerdaten werden niemals aus dem Spielbereich mitgenommen.
    delete target.rs_probelauf_state_v1;
    delete target.rs_snapshot_archive_v1;
    return target;
}
function clean(value) {
    if (Array.isArray(value)) return value.map(clean);
    if (!object(value)) return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key) && !/^(?:ui_|layout_|debug_|telemetry_|showAdvanced$|logDetailLevel$)/.test(key)).map(([key, item]) => [key, clean(item)]));
}

/** Dieselbe Liveüberlagerung wie auf der Übersicht, ohne Migration oder Writes. */
export function probelaufRecordContext(records) {
    const parsed = parseRecord(records.rs_profiles_v1);
    const registry = object(parsed?.profiles) ? structuredClone(parsed) : { version: 1, profiles: {} };
    const activeId = records.rs_current_profile || records.rs_active_profile;
    const active = registry.profiles[activeId];
    if (active) {
        const keys = new Set([...Object.keys(active.data || {}), ...Object.keys(records)].filter(isProfileScopedKey));
        active.data = { ...active.data };
        for (const key of keys) {
            delete active.data[key];
            if (Object.hasOwn(records, key)) active.data[key] = records[key];
        }
    }
    return { registry, activeId, liveData: records };
}

function domainData(data, hasPlan) {
    const goldAliases = { goldAktiv: 'profile_gold_aktiv', goldZielProzent: 'profile_gold_ziel_pct', goldFloorProzent: 'profile_gold_floor_pct', goldSteuerfrei: 'profile_gold_steuerfrei', rebalancingBand: 'profile_gold_rebal_band' };
    return Object.fromEntries(Object.entries(data).filter(([key]) => !ignoredKey(key)
        && !(hasPlan && key.startsWith('sim_') && SIMULATOR_LEGACY_PLAN_FIELDS.includes(key.slice(4)))).map(([key, raw]) => {
        let value = parseRecord(raw);
        if (key === CONFIG.STORAGE.LS_KEY && object(value)) {
            // Ergebnisse und Kurskopien sind keine Benutzereingaben. Die
            // bestätigten Jahreszustände und Historien bleiben Fachbestand.
            value = { ...value };
            for (const field of ['profilverbundHouseholdInputs', 'lastResult', 'annualMarketDataMeta', 'capeMeta', 'personInputEvidence']) delete value[field];
            value.inputs = Object.fromEntries(Object.entries(value.inputs || {}).filter(([field]) => !priceInput.test(field)
                && !(hasPlan && BALANCE_PLAN_INPUT_KEYS.includes(field))
                && !(data.depot_tranchen && /^(?:depotwertAlt|depotwertNeu|geldmarktEtf|goldBestand)$/.test(field))
                && !(data.profile_tagesgeld !== undefined && field === 'tagesgeld')
                && !(goldAliases[field] && data[goldAliases[field]] !== undefined)
                && field !== 'profilName'));
        }
        if (key === 'household_plan_v1' && object(value?.entries)) value = { ...value, entries: Object.fromEntries(Object.entries(value.entries).map(([id, entry]) => {
            const values = { ...entry.values }; delete values.cape;
            return [id, { scope: entry.scope, values }];
        })) };
        if (key === 'depot_tranchen' && Array.isArray(value)) value = [...value].sort((a, b) => String(a.trancheId || a.id).localeCompare(String(b.trancheId || b.id)));
        return [key, clean(value)];
    }));
}

/** Kanonischer Fachbestand: Auswahl, Anzeige, Sitzungen und Kurse zählen nicht. */
export function projectProbelaufDomain(records) {
    const { registry } = probelaufRecordContext(records);
    const hasProfiles = Object.keys(registry.profiles).length > 0;
    const globals = Object.fromEntries(Object.entries(records).filter(([key]) => (!hasProfiles || key !== 'rs_profiles_v1') && (!hasProfiles || !isProfileScopedKey(key))));
    const profiles = Object.fromEntries(Object.entries(registry.profiles).map(([id, profile]) => [id, {
        meta: clean(profile.meta), data: domainData(profile.data || {}, Boolean(records.household_plan_v1))
    }]));
    const registryFields = clean(Object.fromEntries(Object.entries(registry).filter(([key]) => key !== 'profiles')));
    return { profiles, registryFields, records: domainData(globals, Boolean(records.household_plan_v1)) };
}
export const probelaufDomainChecksum = records => fingerprint(projectProbelaufDomain(records));

const groups = ['Personen', 'Bedarf & Strategie', 'Depot/Tranchen', 'Tagesgeld', 'Ausgaben', 'Abschlüsse'];
const number = (value, unit = 'number') => formatDisplayNumber(value, { unit, fractionDigits: 2, minimumFractionDigits: unit === 'currency' ? 2 : 0 });
const display = value => value === undefined || value === null || value === '' ? '–' : typeof value === 'boolean' ? value ? 'an' : 'aus'
    : typeof value === 'number' ? number(value) : typeof value === 'string' ? value : Array.isArray(value) ? `${value.length} Einträge` : Object.values(value).map(display).join(', ');
const labels = {
    profile_geburtsdatum: 'Geburtsdatum', profile_geschlecht: 'Geschlecht', profile_rentenbeginn: 'Rentenbeginn',
    profile_rente_monatlich: 'Rente pro Monat', profile_sonstige_einkuenfte: 'Sonstige Einkünfte', profile_aktuelles_alter: 'Alter',
    profile_rente_aktiv: 'Rente', profile_rentenanpassung_art: 'Rentenanpassung', profile_rentenanpassung_pct: 'Rentenanpassung in %',
    profile_kirchensteuer_pct: 'Kirchensteuer in %', profile_sparer_pauschbetrag: 'Sparer-Pauschbetrag', profile_rente_steuerquote_pct: 'Steuerpflichtige Rente in %',
    profile_gold_aktiv: 'Gold', profile_gold_ziel_pct: 'Gold-Zielanteil', profile_gold_floor_pct: 'Gold-Mindestanteil',
    profile_gold_steuerfrei: 'Gold steuerfrei', profile_gold_rebal_band: 'Gold-Umschichtungsband',
    shares: 'Stück', purchasePrice: 'Kaufpreis', purchaseDate: 'Kaufdatum', type: 'Anlageart', name: 'Name',
    tagesgeld: 'Tagesgeld', geldmarktEtf: 'Geldmarkt-ETF', depotwertAlt: 'Altaktien', depotwertNeu: 'Neuaktien', goldBestand: 'Goldbestand',
    profile_tagesgeld: 'Tagesgeld', goldAktiv: 'Gold', goldZielProzent: 'Gold-Zielanteil',
    startFlexBedarf: 'Wunschbedarf (Flex) im Jahr', startFloorBedarf: 'Grundbedarf (Floor) im Jahr'
};
const trancheLabels = { name: 'Name', type: 'Anlageart', category: 'Anlageklasse', shares: 'Stück', purchasePrice: 'Kaufpreis', purchaseDate: 'Kaufdatum', ticker: 'Börsenkürzel', isin: 'ISIN', notes: 'Notiz', taxExempt: 'Steuerfrei', tqf: 'Teilfreistellung' };
const trancheValue = (value, field) => value == null ? '–' : field === 'purchasePrice' ? number(value, 'currency')
    : field === 'type' ? ({ aktien_alt: 'Altaktien', aktien_neu: 'Neuaktien', geldmarkt: 'Geldmarkt', anleihe: 'Anleihen', gold: 'Gold' })[value] || display(value) : display(value);
const same = (a, b) => fingerprint(a) === fingerprint(b);
const allKeys = (a, b) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].sort();

function describeCloses(months, years) {
    const names = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    const sorted = [...months].sort(), ranges = [];
    for (let i = 0; i < sorted.length; i++) {
        const first = sorted[i], year = first.slice(0, 4), start = Number(first.slice(5));
        let end = start;
        while (sorted[i + 1]?.slice(0, 4) === year && Number(sorted[i + 1].slice(5)) === end + 1) { end++; i++; }
        ranges.push(`${names[start - 1]}${end > start ? ` bis ${names[end - 1]}` : ''} ${year}`);
    }
    return [...ranges, ...[...years].sort().map(year => `Jahr ${year}`)];
}

/** Reiner Vergleich beider Fachbestände. Eine Zeile ist eine fachliche Änderung. */
export function summarizeProbelaufChanges(realRecords, playRecords, { beforeDomain } = {}) {
    const real = beforeDomain || projectProbelaufDomain(realRecords), play = projectProbelaufDomain(playRecords);
    const rows = [];
    const closedMonths = new Set(), closedYears = new Set();
    const closedYear = period => { const match = /^calendar-year:(\d{4})$/.exec(period); if (match) closedYears.add(match[1]); };
    const add = (group, label, before, after, formatter = display, detail = null) => {
        if (!same(before, after)) rows.push({ group, label, before: formatter(before), after: formatter(after), detail });
    };
    const fields = (a, b, group, prefix, specs = {}) => {
        for (const key of allKeys(a, b)) {
            const spec = specs[key], label = spec?.label || labels[key] || 'Weitere Angaben';
            add(group, `${prefix}${label}`, a?.[key], b?.[key], spec?.format || display);
        }
    };
    function dataRows(a = {}, b = {}, name = '') {
        const prefix = name ? `${name} · ` : '';
        const selected = keys => Object.fromEntries(keys.map(key => [key, [a, b].map(data => data[key])]));
        for (const [key, [before, after]] of Object.entries(selected(allKeys(a, b)))) {
            if (key.startsWith('profile_') && !/history|confirmed|health/.test(key)) {
                const group = key === 'profile_tagesgeld' ? 'Tagesgeld' : key.startsWith('profile_gold') ? 'Bedarf & Strategie' : 'Personen';
                const format = value => /(?:tagesgeld|monatlich|einkuenfte|pauschbetrag)/.test(key) && typeof value === 'number' ? number(value, 'currency')
                    : /(?:pct|band)$/.test(key) && typeof value === 'number' ? number(value, 'percent') : display(value);
                add(group, prefix + (labels[key] || 'Weitere Personenangaben'), before, after, format);
            } else if (key === 'depot_tranchen') {
                const lots = value => Object.fromEntries((Array.isArray(value) ? value : []).map((lot, i) => [lot.trancheId || lot.id || String(i), lot]));
                const old = lots(before), next = lots(after);
                for (const id of allKeys(old, next)) {
                    const lot = next[id] || old[id];
                    const changedFields = allKeys(old[id], next[id]).filter(field => !same(old[id]?.[field], next[id]?.[field]));
                    const first = changedFields[0];
                    const format = value => !value ? 'nicht vorhanden' : old[id] && next[id]
                        ? `${trancheLabels[first] || 'Angabe'}: ${trancheValue(value[first], first)}`
                        : `${number(value.shares)} Stück · Kaufpreis ${number(value.purchasePrice, 'currency')}`;
                    const detail = changedFields.map(field => `${trancheLabels[field] || 'Weitere Tranchendaten'}: ${trancheValue(old[id]?.[field], field)} → ${trancheValue(next[id]?.[field], field)}`).join('; ');
                    add('Depot/Tranchen', `${prefix}${lot.name || 'Tranche'}${!old[id] ? ' neu' : !next[id] ? ' gelöscht' : ' geändert'}`, old[id], next[id], format, detail);
                }
            } else if (key === CONFIG.STORAGE.LS_KEY) {
                const specs = Object.fromEntries(HOUSEHOLD_PLAN_FIELDS.map(spec => [spec.path, { label: spec.label, format: value => value == null ? '–' : formatHouseholdPlanValue(value, spec.path) }]));
                fields(before?.inputs, after?.inputs, 'Bedarf & Strategie', prefix, specs);
                add('Abschlüsse', prefix + 'Jahresabschluss', before?.annualPeriodMetadata?.lastCommittedPeriod, after?.annualPeriodMetadata?.lastCommittedPeriod,
                    value => value ? `Jahr ${String(value).replace('calendar-year:', '')}` : 'nicht abgeschlossen');
                if (before?.annualPeriodMetadata?.lastCommittedPeriod !== after?.annualPeriodMetadata?.lastCommittedPeriod) closedYear(after?.annualPeriodMetadata?.lastCommittedPeriod);
            } else if (key === 'overview_month_provision_v1') {
                for (const id of allKeys(before?.entries, after?.entries)) {
                    const old = before?.entries?.[id], next = after?.entries?.[id];
                    add('Abschlüsse', prefix + 'Monatsabschluss', old?.month, next?.month);
                    if (old?.month !== next?.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(next?.month)
                        && Number.isFinite(Date.parse(next.completedAt))) closedMonths.add(next.month);
                }
            } else if (key === 'household_plan_v1') {
                for (const id of allKeys(before?.entries, after?.entries)) {
                    const old = before?.entries?.[id]?.values, next = after?.entries?.[id]?.values;
                    for (const spec of HOUSEHOLD_PLAN_FIELDS.filter(item => !item.path.startsWith('cape.'))) {
                        const get = value => spec.path.split('.').reduce((v, k) => v?.[k], value);
                        add('Bedarf & Strategie', spec.label + (spec.unit === '€' ? ' im Jahr' : ''), get(old), get(next), value => value == null ? '–' : formatHouseholdPlanValue(value, spec.path));
                    }
                }
            } else if (key === 'balance_expenses_v1') {
                for (const year of allKeys(before?.years, after?.years)) for (const month of allKeys(before?.years?.[year]?.months, after?.years?.[year]?.months)) {
                    const old = before?.years?.[year]?.months?.[month]?.profiles, next = after?.years?.[year]?.months?.[month]?.profiles;
                    for (const id of allKeys(old, next)) {
                        const person = play.profiles[id]?.meta?.name || real.profiles[id]?.meta?.name || 'Person';
                        fields(old?.[id]?.categories, next?.[id]?.categories, 'Ausgaben', `${person} · ${month}/${year} · `,
                            Object.fromEntries(allKeys(old?.[id]?.categories, next?.[id]?.categories).map(category => [category, { label: category, format: value => value == null ? '–' : number(value, 'currency') }])));
                    }
                }
            } else if (key === 'household_simulator_needs_v1') {
                fields(before?.values, after?.values, 'Bedarf & Strategie', 'Simulator · ');
            } else if (key === 'profile_health_bucket') {
                fields(before, after, 'Bedarf & Strategie', prefix + 'Pflegeschutz · ', Object.fromEntries(Object.entries({ enabled: 'Aktiv', initialAmount: 'Anfangsbetrag', triggerMinGrade: 'Ab Pflegegrad', triggerMode: 'Auslöser', coverageMode: 'Abdeckung', targetMode: 'Ziel', returnMode: 'Rückfluss', assetSource: 'Geldquelle' }).map(([field, label]) => [field, { label }])));
            } else if (key === 'annual_plan_record_v1') {
                for (const id of allKeys(before?.entries, after?.entries)) {
                    if (before?.entries?.[id]?.periodId !== after?.entries?.[id]?.periodId) closedYear(after?.entries?.[id]?.periodId);
                    add('Abschlüsse', 'Beschlossenes Monatsbudget', before?.entries?.[id]?.adopted?.monthlyBudget, after?.entries?.[id]?.adopted?.monthlyBudget,
                        value => value == null ? '–' : number(value, 'currency'));
                }
            } else if (!/history|confirmed/.test(key)) {
                const field = key.startsWith('sim_') ? key.slice(4) : key;
                const spec = HOUSEHOLD_PLAN_FIELDS.find(item => item.path === field);
                const label = labels[field] || spec?.label || 'Weitere Planeinstellungen';
                const format = spec ? value => value == null ? '–' : formatHouseholdPlanValue(value, field) : display;
                add('Bedarf & Strategie', prefix + label, before, after, format);
            }
        }
    }
    for (const id of allKeys(real.profiles, play.profiles)) {
        const before = real.profiles[id], after = play.profiles[id], name = after?.meta?.name || before?.meta?.name || 'Person';
        add('Personen', name, before?.meta?.name, after?.meta?.name);
        add('Personen', `${name} · Im Haushalt`, before?.meta?.belongsToHousehold, after?.meta?.belongsToHousehold);
        dataRows(before?.data, after?.data, name);
    }
    dataRows(real.records, play.records);
    add('Depot/Tranchen', 'Käufe, Verkäufe und Bestätigungen', real.registryFields?.trancheReconciliation, play.registryFields?.trancheReconciliation,
        value => value?.actions ? `${value.actions.length} Buchungen` : 'keine Buchungen');
    const grouped = groups.map(label => ({ label, rows: rows.filter(row => row.group === label) })).filter(group => group.rows.length);
    return { count: rows.length, groups: grouped, areas: grouped.map(group => group.label),
        planChangeCount: rows.filter(row => row.group !== 'Abschlüsse').length,
        closes: describeCloses(closedMonths, closedYears) };
}
