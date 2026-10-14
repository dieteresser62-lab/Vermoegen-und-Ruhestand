import { evaluateWealthHistory } from '../app/tranches/tranchen-history-model.js';
import { prepareCashRecords, prepareHouseholdCash, readCashPerson } from '../app/profile/profile-cash-update.js';
import { PROFILE_CASH_CONFIRMED_DATE_KEY } from '../app/profile/profile-state.js';
import { projectCashFreshness } from '../app/overview/overview-model.js';

const data = { profile_tagesgeld: '100.125', fremd: ' unverändert ', profile_gold_ziel_prozent: '7.500' };
const original = JSON.stringify(data);
const first = prepareCashRecords(data, '120,375', '2026-10-08');
assertEqual(first.profile_tagesgeld, '120.375', 'Dezimalwert wird absolut übernommen');
assertEqual(JSON.stringify(data), original, 'Vorbereitung ist schreibfrei');
assertEqual(Object.keys(first).sort().join(','), 'profile_cash_history_v1,profile_tagesgeld', 'Nur die beiden Cashrecords werden übernommen');
const next = { ...data, ...first };
const second = prepareCashRecords(next, '130.5', '2026-10-08');
assertEqual(JSON.stringify(JSON.parse(second.profile_cash_history_v1).entries), '[{"date":"2026-10-08","value":130.5}]', 'Zwei Änderungen am selben Tag ergeben den letzten Stand');
assertEqual(Object.keys(prepareCashRecords(next, '120,375', '2026-10-08')).length, 0, 'Unverändert erzeugt keinen Beleg');
const legacy = { profile_tagesgeld: '12345', profile_cash_history_v1: JSON.stringify({ version: 1, baselineValue: 8000,
    entries: [1, 12, 123, 1234, 12345].map(value => ({ date: '2026-10-08', value })) }) };
assertEqual(JSON.parse(prepareCashRecords(legacy, '12345', '2026-10-08').profile_cash_history_v1).entries.length, 1,
    'Auch unveränderte Abschluss- und Verkaufsstände fassen den geschriebenen Altbestandstag zusammen');

// LR-2: Abschlussbestätigung und Wertverlauf haben getrennte Datenquellen.
{
    const old = { profile_tagesgeld: '12000', profile_cash_history_v1: JSON.stringify({ version: 1, baselineValue: 10000,
        entries: [{ date: '2026-10-01', value: 12000 }] }) };
    const registry = { profiles: { erika: { meta: { name: 'Erika' }, data: old } } };
    const records = { ...old, rs_current_profile: 'erika' }, storage = { getItem: key => records[key] ?? null };
    const person = readCashPerson('erika', 'Erika', old);
    const before = JSON.stringify({ records, registry });
    assertEqual(person.confirmedDate, null, 'Altdaten ohne Bestätigungsfeld bleiben lesbar');
    assertEqual(projectCashFreshness([person], '2026-11-14').length, 1, 'Altdaten behalten die bisherige Prüfaufforderung');
    const prepared = prepareHouseholdCash({ storage, registry, activeId: 'erika', ids: ['erika'],
        cash: { people: [person], values: { erika: 12000 } }, date: '2026-11-14', recordConfirmation: true });
    const updated = readCashPerson('erika', 'Erika', prepared.registry.profiles.erika.data);
    assertEqual(prepared.records[PROFILE_CASH_CONFIRMED_DATE_KEY], '2026-11-14', 'Bestätigung wird für das aktive Profil geschrieben');
    assertEqual(updated.lastDate, '2026-10-01', 'Letzte Wertänderung behält ihr Datum');
    assertEqual(updated.historyRaw, person.historyRaw, 'Bestätigung ergänzt keinen Verlaufspunkt');
    assertEqual(updated.cashRaw, person.cashRaw, 'Bestätigung verändert keinen Betrag');
    assertEqual(projectCashFreshness([updated], '2026-11-14').length, 0, 'Bestätigung erledigt die Aufforderung');
    assertEqual(projectCashFreshness([updated], '2026-12-19').length, 0, 'Auch nach 35 Tagen ist die Bestätigung aktuell');
    assertEqual(projectCashFreshness([updated], '2026-12-20')[0].confirmedDate, '2026-11-14', 'Ab Tag 36 zählt die nächste Fälligkeit mit Bestätigungsdatum');
    assertEqual(JSON.stringify({ records, registry }), before, 'Vorbereitung verändert die Altdaten nicht');
}
for (const value of ['', '-1', 'Infinity', '1.234,5']) {
    let failed = false;
    try { prepareCashRecords(data, value, '2026-10-08'); } catch { failed = true; }
    assert(failed, 'Ungültiger Stand blockiert: ' + value);
}
assertEqual(prepareCashRecords(data, '0', '2026-10-08').profile_tagesgeld, '0', 'Null ist gültig');
for (const raw of ['{', JSON.stringify({ version: 1, baselineValue: 100, entries: [{ date: '2026-10-07', value: 99 }] })]) {
    const damaged = { ...data, profile_cash_history_v1: raw };
    assert(Boolean(readCashPerson('a', 'A', damaged).error), 'Beschädigung bleibt sichtbar');
    let failed = false;
    try { prepareCashRecords(damaged, '100.125', '2026-10-08'); } catch { failed = true; }
    assert(failed, 'Auch unverändert repariert keine beschädigte Historie');
}

{
    const initial = { profile_tagesgeld: '50000' };
    const interim = prepareCashRecords(initial, '5000', '2026-10-08');
    const final = prepareCashRecords({ ...initial, ...interim }, '45000', '2026-10-08');
    const history = JSON.parse(final.profile_cash_history_v1);
    const project = cashHistory => evaluateWealthHistory({ profiles: [{ id: 'a', lots: [], currentCash: 45000, cashHistory }], startDate: '2026-10-07', today: '2026-10-09' });
    assertEqual(history.entries.length, 1, 'Gemeinsamer Adapter speichert nur den letzten Tagesstand');
    assertEqual(project(history).metrics.withdrawals, 5000, 'Unveränderte P8-Auswertung zählt ausschließlich den letzten Tagesnettorückgang');
    assertEqual(JSON.stringify(project(history)), JSON.stringify(project({ ...history, entries: [history.entries.at(-1)] })), 'P8-Punkte entsprechen der reinen Tagesabschlussfolge');
}
