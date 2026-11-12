// FR-73 Paket 3: Hinweis bei Pflegegrad heute, Beispiel Helga und Werner (Sollfälle A, D, S; Testdatum 23.10.2026), „-0 €“ im Ausgaben-ⓘ.
import { pfa2Records, countingStorage, IDS } from './helpers/pfa-2-balance.mjs';
import { CARE_HINT_KEY, CARE_HINT_RULE, parseCareHint, careHintDone, markCareHintDone } from '../app/shared/household-care-hint.js';
import { CARE_HINT_TEXT, careHintPersons, projectCareHint, renderCareHint, bindCareHintDone } from '../app/shared/care-hint.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { protocolCashflowBreakdown, protocolAnnualTotals } from '../app/simulator/protocol-cashflows.js';
import { readBalanceHouseholdPlan, planScope } from '../app/profile/household-plan.js';
import { CARE_VALUE_KEYS } from '../app/profile/profile-care.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { musterVariante } from '../app/demo/muster-haushalte.js';
import { musterSteckbrief, musterLesson } from '../app/demo/muster-steckbrief.js';
import { buildFullPersistenceBackup, normalizeFullPersistenceBackup, validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';
import { isAllowedPersistenceImportKey, isAllowedSnapshotCaptureKey, isAllowedSnapshotRestoreLiveKey, isSnapshotTechnicalKey, isProbelaufRecordKey } from '../app/shared/persistence-key-policy.js';
import { probelaufDomainChecksum } from '../app/shared/probelauf-records.js';
import { PROFILE_BUNDLE_GLOBAL_KEYS } from '../app/profile/profile-bundle-io.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { EngineAPI } from '../engine/index.mjs';
setAppTestDate('2026-10-23');

const today = (grade, form, residentialSince) => ({ grade, form, ...(residentialSince ? { residentialSince } : {}) });
const close = (a, b, label, tolerance = 1e-6) => assert(Math.abs(a - b) < tolerance, `${label}: ${a} = ${b}`);

// Record: Regelversion, Altbestand nur lesend.
assertEqual(parseCareHint(null), null, 'Ohne Record kein Eintrag');
assertEqual(parseCareHint('{"version":1,"rule":"FR-73","doneAt":"2026-11-08"}').rule, CARE_HINT_RULE, 'Gültiger Record liest Regelversion');
for (const raw of ['{"version":2,"rule":"FR-73","doneAt":"2026-11-08"}', '{"version":1,"rule":"","doneAt":"2026-11-08"}', '{"version":1,"rule":"FR-73","doneAt":"08.11.2026"}', '[]']) {
    let failed = false;
    try { parseCareHint(raw); } catch { failed = true; }
    assert(failed, `Ungültiger Record wird abgewiesen: ${raw}`);
}
{
    const { storage, counts } = countingStorage({ [CARE_HINT_KEY]: '{"version":1,"rule":"FR-99","doneAt":"2026-11-08"}' });
    assertEqual(careHintDone(storage), false, 'Fremde Regelversion gilt als nicht erledigt');
    assertEqual(careHintDone(countingStorage({ [CARE_HINT_KEY]: 'kaputt' }).storage), false, 'Unlesbarer Altbestand gilt als nicht erledigt');
    assertEqual(counts.setItem + counts.removeItem, 0, 'Lesen schreibt nie');
    const written = {};
    markCareHintDone({ setItem: (key, value) => { written[key] = value; } }, new Date('2026-11-08T12:00:00Z'));
    assertEqual(written[CARE_HINT_KEY], JSON.stringify({ version: 1, rule: CARE_HINT_RULE, doneAt: '2026-11-08' }), '„Erledigt“ schreibt Regelversion und Kalendertag');
}

// Hinweis nur mit Pflegegrad heute; Beträge aus derselben Projektion wie die Bedarfszeilen in Balance.
function household(options) {
    const { records, scope } = pfa2Records(options);
    const { storage, counts } = countingStorage(records);
    return { records, scope, storage, counts };
}
{
    const none = household({ care: [null, null] });
    assertEqual(JSON.stringify(projectCareHint({ storage: none.storage })), JSON.stringify({ done: false, persons: [] }), 'Ohne Pflegegrad heute kein Hinweis');
    assertEqual(none.counts.setItem + none.counts.removeItem, 0, 'Projektion liest ohne Writes');
    const A = household({ care: [null, today(3, 'home-support')] });
    const hintA = projectCareHint({ storage: A.storage });
    assertEqual(JSON.stringify(hintA), JSON.stringify({ done: false, persons: [{ profileId: 'muster_werner', name: 'Werner', grade: 3, residential: false, own: false, monthly: 1500 }] }), 'A: Werner 1.500 €/Monat zu Hause (Staffel)');
    const balanceA = buildBalanceEngineInputFromStorage({ storage: A.storage, scope: A.scope, referenceYear: 2026 });
    assertEqual(JSON.stringify(careHintPersons(balanceA.careNeeds)), JSON.stringify(hintA.persons), 'Balance-Hinweis nutzt dieselbe Bedarfsprojektion');
    assertEqual(A.counts.setItem + A.counts.removeItem, 0, 'Hinweis und Balance lesen ohne Writes');
    const D = household({ care: [null, today(4, 'residential', '2023-01')] });
    assertEqual(JSON.stringify(projectCareHint({ storage: D.storage }).persons), JSON.stringify([{ profileId: 'muster_werner', name: 'Werner', grade: 4, residential: true, own: false, monthly: 2611 }]), 'D: Heim Werner 2.611 €/Monat (Heimjahr 4)');
    // „Erledigt“ blendet aus, auch nach Wiederherstellung einer Sicherung mit dem Record.
    markCareHintDone({ setItem: (key, value) => { D.records[key] = value; D.counts.setItem++; } }, new Date('2026-10-23T12:00:00Z'));
    assertEqual(D.counts.setItem, 1, '„Erledigt“ ist genau ein Write');
    assertEqual(projectCareHint({ storage: D.storage }).done, true, 'Nach „Erledigt“ kein Hinweis');
    const restored = normalizeFullPersistenceBackup(buildFullPersistenceBackup({ storage: D.storage }));
    assert(restored.ok, 'Vollsicherung mit Pflegehinweis importierbar');
    assertEqual(restored.backup.records[CARE_HINT_KEY], D.records[CARE_HINT_KEY], 'Sicherung bewahrt den Record bytegleich');
    assertEqual(projectCareHint({ storage: countingStorage(restored.backup.records).storage }).done, true, 'Nach Wiederherstellung bleibt der Hinweis ausgeblendet');
    assert(!validatePersistenceDomainRecords({ ...D.records, [CARE_HINT_KEY]: '{"version":1}' }).ok, 'Import weist einen ungültigen Pflegehinweis ab');
    assert(validatePersistenceDomainRecords(D.records).ok, 'Import nimmt den gültigen Pflegehinweis an');
    assert(isAllowedPersistenceImportKey(CARE_HINT_KEY) && isAllowedSnapshotCaptureKey(CARE_HINT_KEY) && isAllowedSnapshotRestoreLiveKey(CARE_HINT_KEY, { mode: 'full' })
        && isProbelaufRecordKey(CARE_HINT_KEY) && !isSnapshotTechnicalKey(CARE_HINT_KEY) && PROFILE_BUNDLE_GLOBAL_KEYS.includes(CARE_HINT_KEY),
    'Record gehört zu Sicherung, Wiederherstellungspunkt, Spielbereich und Haushaltsübergabe');
    assertEqual(probelaufDomainChecksum(D.records), probelaufDomainChecksum(Object.fromEntries(Object.entries(D.records).filter(([key]) => key !== CARE_HINT_KEY))), '„Erledigt“ ist im Spielbereich keine Nutzeränderung');
}

// Anzeige im bestehenden Hinweismuster mit „Erledigt“.
{
    const host = { hidden: true, html: '', children: [1], set innerHTML(value) { this.html = value; this.children = [1]; }, get innerHTML() { return this.html; }, replaceChildren() { this.html = ''; this.children = []; } };
    assertEqual(renderCareHint(host, { done: false, persons: [] }), false, 'Ohne Personen bleibt der Host leer');
    assert(host.hidden && host.children.length === 0, 'Leerer Host ist ausgeblendet');
    assert(renderCareHint(host, { done: false, persons: [{ profileId: 'muster_werner', name: 'Werner', grade: 4, residential: true, monthly: 2611 }, { name: 'Helga <3>', grade: 2, residential: false, monthly: 500 }] }), 'Hinweis sichtbar');
    const plain = () => host.html.replaceAll(' ', ' ');
    assert(!host.hidden && plain().includes(CARE_HINT_TEXT) && plain().includes('Heim Werner: 2.611 €/Monat (Grad 4 im Heim)')
        && plain().includes('Pflege Helga &lt;3&gt;: 500 €/Monat (Grad 2 zu Hause, Staffel)') && plain().includes('data-care-hint-done>Erledigt<'), 'Text, Beträge je Person und Knopf');
    // PFA-5 (Befund 4): Ohne Plan steht der Betrag aus der gespeicherten Bedarfsbasis; ohne Betrag bleibt nur noch der Fehlerfall.
    assert(renderCareHint(host, { done: false, persons: [{ profileId: 'muster_werner', name: 'Werner', grade: 3, residential: false, monthly: null }] }) && host.html.includes('Betrag noch nicht berechenbar'), 'Scheitert die Projektion, nennt der Hinweis die Person ohne Betrag');
    assertEqual(renderCareHint(host, { done: true, persons: [] }), false, 'Erledigt blendet aus');
    assertEqual(renderCareHint(null, { done: false, persons: [] }), false, 'Ohne Host keine Anzeige');
    const written = {}, listeners = new Map();
    const root = { addEventListener: (type, handler) => listeners.set(type, handler), querySelectorAll: () => [host] };
    let done = 0;
    bindCareHintDone(root, { storage: { setItem: (key, value) => { written[key] = value; } }, onDone: () => { done++; } });
    bindCareHintDone(root, { storage: { setItem() { throw new Error('doppelt gebunden'); } } });
    renderCareHint(host, { done: false, persons: [{ profileId: 'muster_werner', name: 'Werner', grade: 3, residential: false, monthly: 1500 }] });
    listeners.get('click')({ target: { closest: selector => selector === '[data-care-hint-done]' ? { disabled: false } : null } });
    assert(written[CARE_HINT_KEY] && host.hidden && done === 1, '„Erledigt“ schreibt den Record und blendet alle Hinweise aus');
    listeners.get('click')({ target: { closest: () => null } });
    assertEqual(done, 1, 'Andere Klicks bleiben ohne Wirkung');
}

// Beispiel Helga und Werner: Variante 36.000 € ohne Pflege (A), neue Übung Sollfall D, Heimübung Sollfall S.
function grundfallWith(care) {
    const records = createMusterHaushaltRecords('2026-10-23', 'helga-werner');
    const registry = JSON.parse(records.rs_profiles_v1);
    IDS.forEach((id, index) => {
        const data = registry.profiles[id].data;
        for (const key of Object.values(CARE_VALUE_KEYS)) delete data[key];
        if (care[index]) {
            data[CARE_VALUE_KEYS.grade] = String(care[index].grade); data[CARE_VALUE_KEYS.form] = care[index].form;
            if (care[index].residentialSince) data[CARE_VALUE_KEYS.residentialSince] = care[index].residentialSince;
        }
    });
    records.rs_profiles_v1 = JSON.stringify(registry);
    for (const key of Object.keys(records)) if (key.startsWith('profile_')) delete records[key];
    Object.assign(records, registry.profiles[records.rs_current_profile].data);
    return records;
}
{
    assertEqual(musterVariante('helga-werner', 'haus-pg3').floorBedarf, 36000, 'Variante „Mit Haus, Werner Pflegegrad 3“: Grundbedarf 36.000 € ohne Pflege');
    const base = createMusterHaushaltRecords('2026-10-23', 'helga-werner'), variant = createMusterHaushaltRecords('2026-10-23', 'helga-werner', 'haus-pg3');
    const brief = musterSteckbrief(variant, 'helga-werner', '2026-10-23', 'haus-pg3', base);
    assertEqual(brief.numbers.floor, 36000, 'Steckbrief: Grundbedarf wie im Grundfall');
    assertEqual(brief.numbers.careToday, 18000, 'Steckbrief: heutige Pflegekosten 18.000 € aus der Bedarfsfunktion (Sollfall A)');
    assertEqual(brief.metrics[2].value, '18.000 € / Jahr', 'Steckbrief-Kachel nennt die gerechneten Pflegekosten');
    assertEqual(musterSteckbrief(base, 'helga-werner', '2026-10-23').numbers.careToday, 0, 'Grundfall ohne Pflegegrad heute: keine Pflegekosten');
    const plan = readBalanceHouseholdPlan({ storage: { getItem: key => base[key] ?? null } }).entry.values;
    const variantPlan = readBalanceHouseholdPlan({ storage: { getItem: key => variant[key] ?? null } }).entry.values;
    assertEqual(variantPlan.floorBedarf, plan.floorBedarf, 'Variante und Grundfall tragen denselben Grundbedarf');
    const scope = planScope('household', IDS);
    const D = buildBalanceEngineInputFromStorage({ storage: { getItem: key => grundfallWith([null, today(4, 'residential', '2023-01')])[key] ?? null }, scope, referenceYear: 2026 });
    assertEqual(D.careNeeds.persons[1].heimJahr, 4, 'Übung Heim Werner: Heimjahr 4 aus „seit“ 01/2023');
    close(D.careNeeds.persons[1].residentialCosts + D.careNeeds.persons[1].residentialOwnExpenses, 31332, 'Übung Heim Werner: 25.332 + 6.000 €/Jahr');
    close(D.careNeeds.current.homeFloor, 27000, 'Übung Heim Werner: Grundbedarf zu Hause 27.000 €');
    close(D.inputData.floorBedarf, 58332, 'Sollfall D im Grundfall: 58.332 €');
    const exercise = musterLesson('helga-werner').exercises[2];
    assert(exercise.includes(`${Math.round(31332 / 12).toLocaleString('de-DE')} €/Monat`) && exercise.includes(`${Math.round(27000 / 12).toLocaleString('de-DE')} €/Monat`) && exercise.includes('Heimjahr 4'), 'Übungstext nennt die Sollwerte aus D');
    const S = buildBalanceEngineInputFromStorage({ storage: { getItem: key => grundfallWith([today(4, 'residential'), today(4, 'residential')])[key] ?? null }, scope, referenceYear: 2026 });
    close(S.inputData.floorBedarf, 92736, 'Sollfall S: beide heute Grad 4 im Heim 92.736 €');
    close(S.careNeeds.current.homeFloor, 0, 'Sollfall S: kein Grundbedarf zu Hause');
    const heim = musterLesson('helga-werner').exercises[3];
    assert(heim.includes('92.736 €') && heim.includes(`${Math.round(46368 / 12).toLocaleString('de-DE')} €/Monat`), 'Heimübung nennt die Sollwerte aus S');
}

// H-HE2-6: „-0 €“ im Ausgaben-ⓘ, Zeile aus einem echten Lauf mit allen Lebenden im Heim [A6].
{
    const { records } = pfa2Records({ care: [today(4, 'residential'), today(4, 'residential')] });
    const storage = { getItem: key => records[key] ?? null };
    const registry = JSON.parse(records.rs_profiles_v1), plan = readBalanceHouseholdPlan({ storage });
    const entries = IDS.map(profileId => ({ profileId, name: registry.profiles[profileId].meta.name,
        inputs: buildSimulatorInputsFromProfileData(registry.profiles[profileId].data, { storage, referenceYear: 2026, planValues: plan.entry.values }) }));
    const inputs = combineSimulatorProfiles(entries, IDS[0], { planValues: plan.entry.values }).combined;
    const result = simulateOneYear(initMcRunState(inputs), inputs, { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0, lohn: 0 }, 0, null, 0, null, 1, EngineAPI);
    assertEqual(result.kind, 'success', 'Echter Lauf mit beiden im Heim rechnet');
    const row = result.logData;
    close(row.floor_brutto, 92736, 'Echter Lauf: Jahresbedarf 92.736 € nur aus Heimkosten und eigenen Ausgaben');
    assertEqual(row.grundbedarf_zu_hause, 0, 'Echter Lauf: Grundbedarf zu Hause 0');
    const options = { inputs, personDisplayContext: { persons: [{ name: 'Helga' }, { name: 'Werner' }] } };
    const labels = protocolCashflowBreakdown(row, options).expenses.map(item => item.label);
    assert(!labels.includes('Grundbedarf zu Hause') && !labels.includes('Pflege zu Hause') && !labels.includes('Grundbedarf') && !labels.includes('Pflege'), `Keine Null- oder „-0 €“-Zeile: ${labels.join('|')}`);
    assert(labels.includes('Heimkosten') && labels.includes('Eigene Ausgaben im Heim'), 'Heimzeilen bleiben');
    const sum = protocolCashflowBreakdown(row, options).expenses.reduce((total, item) => total + item.amount, 0);
    close(sum, protocolAnnualTotals(row).ausgaben_gesamt, 'Ausgabenposten ergeben die Summe bis auf Rundungsreste', 0.5);
    // Synthetische Reste unter 0,50 € entfallen; ab 0,50 € bleibt die Zeile. Keine Rechenänderung am Jahresdatensatz.
    const synthetic = { jahr: 2, recordType: 'financial_year', entscheidung: { jahresEntnahme: 0 }, renteSum: 0, floor_brutto: 46368 - 1e-9, pflege_zusatz_floor: -1e-12,
        pflege_heimkosten: 40368, pflege_heim_eigene_ausgaben: 6000, flex_haushalt_erfuellt: 0.4, inflation_factor_cum: 1 };
    const before = JSON.stringify(synthetic);
    const breakdown = protocolCashflowBreakdown(synthetic, { inputs: { simulationPeople: [{ profileId: 'muster_helga', name: 'Helga' }] } });
    assertEqual(breakdown.expenses.map(item => item.label).join('|'), 'Heimkosten|Eigene Ausgaben im Heim', 'Reste unter 0,50 € bilden keine Zeile');
    assertEqual(protocolCashflowBreakdown({ ...synthetic, flex_haushalt_erfuellt: 0.5 }, { inputs: {} }).expenses.at(-1).label, 'Flex', 'Ab 0,50 € bleibt die Zeile');
    assertEqual(JSON.stringify(synthetic), before, 'Anzeige verändert die Zeile nicht');
}
