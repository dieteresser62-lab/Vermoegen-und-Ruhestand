import { DATA_BACKUP_SUMMARY_KEY, assertBackupSummary, buildBackupSummary, compareBackupSummaries } from '../app/data/data-backup-summary.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { overviewScope } from '../app/overview/overview-storage.js';
const time = '2026-09-01T12:00:00.000Z';
const records = createMusterHaushaltRecords('2026-09-01');
const id = records.rs_active_profile || records.rs_current_profile;
const scope = overviewScope('single', [id]);
const monthKey = JSON.stringify(['2026-08', scope.key]);
const provision = { month: '2026-08', scope, completedAt: time };
records.overview_month_provision_v1 = JSON.stringify({ version: 1, entries: { [monthKey]: provision } });
records.profile_cash_history_v1 = JSON.stringify({ version: 1, baselineValue: 100, entries: [{ date: '2026-08-01', value: 110 }] });
const basis = await buildBackupSummary(records, time);
assertEqual(assertBackupSummary(basis), basis, 'Enge globale Vergleichsbasis ist gültig');
assert(!JSON.stringify(basis).includes('purchaseDate') && !JSON.stringify(basis).includes('value'), 'Vergleich speichert Kennungen und Signaturen statt Finanzkopien');
const now = '2026-10-01T12:00:00.000Z';
const compare = async source => compareBackupSummaries(basis, await buildBackupSummary(source, now), time);
const same = await compare(records);
assertEqual(JSON.stringify(same), JSON.stringify({ months: { added: 0, changed: 0, removed: 0 }, cash: { added: 0, changed: 0, removed: 0 }, tranches: { added: 0, changed: 0, removed: 0 } }), 'Kaufdaten erfinden keine Aktivität');
const changed = structuredClone(records);
changed.overview_month_provision_v1 = JSON.stringify({ version: 1, entries: { [monthKey]: { ...provision, completedAt: now }, [JSON.stringify(['2026-09', scope.key])]: { ...provision, month: '2026-09' } } });
changed.profile_cash_history_v1 = JSON.stringify({ version: 1, baselineValue: 100, entries: [{ date: '2026-08-01', value: 120 }, { date: '2026-09-01', value: 130 }] });
const tranches = JSON.parse(changed.depot_tranchen);
tranches[0].shares += 1;
tranches.push({ ...tranches[0], trancheId: 'synthetic-new', purchaseDate: '2000-01-01' });
changed.depot_tranchen = JSON.stringify(tranches);
const additions = await compare(changed);
for (const category of ['months', 'cash', 'tranches']) {
    assertEqual(additions[category].added, 1, category + ': neuer Eintrag wird gezählt');
    assertEqual(additions[category].changed, 1, category + ': Korrektur wird gezählt');
}
const removed = structuredClone(records);
delete removed.overview_month_provision_v1; delete removed.profile_cash_history_v1; removed.depot_tranchen = '[]';
const removals = await compare(removed);
assertEqual(removals.months.removed, 1, 'Entfernte Monatsbelege werden gezählt');
assertEqual(removals.cash.removed, 1, 'Entfernte Tagesgeldeinträge werden gezählt');
assertEqual(removals.tranches.removed, Object.keys(basis.profiles[id].tranches).length, 'Entfernte Tranchen werden gezählt');
assertEqual(compareBackupSummaries(null, basis, time), null, 'Ältere Sicherung ohne Basis bleibt unbekannt');
assertEqual(compareBackupSummaries(basis, basis, now), null, 'Fremde Sicherungszeit ist keine Vergleichsbasis');
for (const bad of [{ ...basis, version: 2 }, { ...basis, extra: true }, { ...basis, profiles: { a: { months: {}, cash: {}, tranches: { t: 'invalid' } } } }]) {
    let rejected = false; try { assertBackupSummary(bad); } catch { rejected = true; }
    assert(rejected, 'Enger Validator weist fremde Version, Felder und Signaturen zurück');
}
assertEqual(DATA_BACKUP_SUMMARY_KEY, 'rs_data_backup_summary_v1', 'Vergleichsrecord ist global versioniert');

const inactiveChange = structuredClone(records);
const registry = JSON.parse(inactiveChange.rs_profiles_v1);
const other = Object.keys(registry.profiles).find(profileId => profileId !== id);
const otherTranches = JSON.parse(registry.profiles[other].data.depot_tranchen);
otherTranches[0].shares += 1;
registry.profiles[other].data.depot_tranchen = JSON.stringify(otherTranches);
inactiveChange.rs_profiles_v1 = JSON.stringify(registry);
assertEqual((await compare(inactiveChange)).tranches.changed, 1, 'Vergleich erfasst inaktives Profil ohne aktiven Livebestand zu verdoppeln');
