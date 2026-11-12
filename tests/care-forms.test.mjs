import { readFileSync } from 'node:fs';
import { CARE_FORMS, defaultCareForm, normalizeCareForm, careFormForPerson, careSettingsFromRecord, noCareAllowanceReason } from '../app/shared/care-benefits.js';
import { CARE_VALUE_KEYS, careTodayFromRecord } from '../app/profile/profile-care.js';
import { migrateStoredCareForms, showCareFormsMigrationNotice } from '../app/profile/profile-care-migration.js';
import { migrateStoredIncome } from '../app/profile/profile-income-migration.js';
import { INCOME_KEY, INCOME_MIGRATION_KEY } from '../app/profile/profile-income.js';
import { projectPersonPension } from '../app/profile/profile-person-data.js';
import { calculateFixedIncomeForYear } from '../app/simulator/simulator-fixed-income.js';
import { makeDefaultCareMeta, updateCareMeta } from '../app/simulator/simulator-engine-helpers.js';
import { allLivingInExternalCare, sellHomesForExternalCare, homeRentForYear } from '../app/simulator/simulator-home-sale.js';
import { calculateCashProposal } from '../app/overview/overview-cash-proposal.js';
import { buildFullPersistenceBackup, importFullPersistenceBackup } from '../app/shared/persistence-backup.js';
import { importProfilesBundle } from '../app/profile/profile-bundle-io.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { restoreSnapshotById } from '../app/shared/snapshot-restore.js';
import { PersistenceFacade as P, persistenceStorage } from '../app/shared/persistence-facade.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { MemoryWebStorage } from './helpers/persistence-area-backends.mjs';
import { syncManagerCareToday } from '../app/tranches/tranchen-manager-care.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';

assertEqual(Object.keys(CARE_FORMS).length, 3, 'Drei Pflegeformen');
for (const g of [1, 2, 3, 4, 5]) {
    assertEqual(defaultCareForm(g), g <= 2 ? 'family' : g === 3 ? 'home-support' : 'residential', 'Vorgabe je Grad');
    assertEqual(normalizeCareForm('external', g), g <= 3 ? 'home-support' : 'residential', 'Altes extern folgt der Gradregel');
}
const inputs = { startFloorBedarf: 40000, startFlexBedarf: 10000, pflegefallLogikAktivieren: true,
    pflegeKostenStaffelPreset: 'custom', pflegeModellTyp: 'chronisch', pflegeMaxFloor: 200000,
    pflegeKostenDrift: 0, pflegeRegionalZuschlag: 0, careToday: { grade: 3, form: 'family', progression: 'usual' },
    partner: { aktiv: true, careToday: { grade: 2, form: 'home-support' } },
    simulationPeople: [{ profileId: 'max', name: 'Max' }, { profileId: 'erika', name: 'Erika' }],
    pflegeGradeConfigs: { 3: { zusatz: 18000, flexCut: .5, mortalityFactor: 3 },
        4: { zusatz: 32000, flexCut: 0, mortalityFactor: 4 } } };
const care = makeDefaultCareMeta(true, 'm', inputs.careToday, 70, inputs);
const household = { p1Alive: true, p2Alive: true, care: { p1: care, p2: { active: true, grade: 2 } } };
const income = () => calculateFixedIncomeForYear({ inputs, state: {}, yearIndex: 0, inflationFactor: 1, household });
assertEqual(income().pflegegeld, 599 * 12, 'Jahr 1: persönliche Angehörigenpflege trotz externer Grad-3-Staffel');
assertEqual(income().pflegegeld_personen[0].profileId, 'max', 'Pflegegeld bleibt bei der gepflegten Person');
updateCareMeta(care, inputs, 71, { inflation: 0 }, () => 1, {}, 0);
assertEqual(income().pflegegeld, 599 * 12, 'Ohne Gradwechsel bleibt die heutige Form wirksam');
updateCareMeta(care, inputs, 72, { inflation: 0 }, () => 0, {}, 1);
assertEqual(care.grade, 4, 'Fortschritt auf Grad 4');
assertEqual(careFormForPerson(inputs, care.grade), 'residential', 'Nach Gradwechsel gilt die Tabelle');
assertEqual(income(), null, 'Nach Wechsel ins Heim kein Pflegegeld');

const settings = careSettingsFromRecord({ sim_pflegeStufe3Form: 'home-support' });
const data = { profile_care_grade_today: '3', profile_care_form_today: 'family' };
assertEqual(projectPersonPension(data, 2026, settings).pflegegeld, 599, 'Balance nutzt die bekannte heutige Form');
assertEqual(projectPersonPension({ ...data, profile_care_form_today: 'home-support' }, 2026, settings).pflegegeld, undefined, 'Externe Unterstützung ohne Pflegegeld');
assertEqual(careTodayFromRecord({ profile_care_grade_today: '3' }, settings).form, 'home-support', 'Fehlende heutige Form folgt gemeinsamer Staffel');
const proposal = calculateCashProposal({ person: { id: 'max', name: 'Max', value: 10000 }, data,
    end: '2026-01-31', fallbackStart: '2026-01-01', personCount: 2, withdrawalForYear: () => ({ value: 0, source: 'Probe' }), careSettings: settings });
assertEqual(proposal.income, 599, 'Tagesgeld-Spielvorschlag verwendet persönliche Form und gemeinsame Einstellungen');
assertEqual(calculateCashProposal({ person: { id: 'erika', name: 'Erika', value: 10000 }, data: { profile_care_grade_today: '3' },
    end: '2026-01-31', fallbackStart: '2026-01-01', personCount: 2, withdrawalForYear: () => ({ value: 0, source: 'Probe' }),
    careSettings: careSettingsFromRecord({ sim_pflegeStufe3Form: 'family' }) }).income, 599, 'Auch zweite Person übernimmt gemeinsame Angehörigenstaffel');

const homes = { ...inputs, careToday: null, partner: { aktiv: true }, home: [{ id: 'haus', profileId: 'max', nutzung: 'selbst', wert: 400000, stand: '2026-01' }] };
const couple = grade => ({ p1Alive: true, p2Alive: true, care: { p1: { active: true, grade }, p2: { active: true, grade } } });
const portfolio = { personAccounts: [{ profileId: 'max', tagesgeld: 100000 }, { profileId: 'erika', tagesgeld: 100000 }],
    homeRent: { amount: 16000, inflationFactor: 1 } };
const state = { portfolio };
assert(!allLivingInExternalCare(homes, couple(3)), 'Paar Grad 3 mit Unterstützung zu Hause löst keinen Pflegeverkauf aus');
assertEqual(sellHomesForExternalCare({ portfolio, state, inputs: homes, household: couple(3), yearIndex: 0, inflationFactor: 1 }), null, 'Haus bleibt bei externer Unterstützung');
assertEqual(homeRentForYear(portfolio, homes, couple(3), 1), 16000, 'Miete bleibt bei Unterstützung zu Hause');
assert(allLivingInExternalCare(homes, couple(4)), 'Alle Lebenden Grad 4 im Heim erfüllen FR-53');
assertEqual(sellHomesForExternalCare({ portfolio, state, inputs: homes, household: couple(4), yearIndex: 0, inflationFactor: 1 }).immobilienverkauf, 360000, 'FR-53 verkauft mit unverändert 10 % Abschlag');
assertEqual(homeRentForYear(portfolio, homes, couple(4), 1), 0, 'FR-62 beendet die Miete erst bei Heimunterbringung aller Lebenden');
assert(!allLivingInExternalCare({ ...homes, careToday: { grade: 4, form: 'home-support' } }, couple(4)), 'Persönliche Unterstützung zu Hause verhindert Pflegeverkauf auch bei Grad 4');

const dom = { profileCareGradeToday: { value: '3' }, profileCareFormToday: { value: 'home-support' }, profileCareAllowanceSummary: {} };
syncManagerCareToday({ getElementById: id => dom[id] || null }, new MemoryWebStorage());
assert(dom.profileCareAllowanceSummary.textContent.includes('kein Pflegegeld') && dom.profileCareAllowanceSummary.textContent.includes('Dienst'), 'Personenkarte erklärt fehlendes Pflegegeld');
dom.profileCareFormToday.value = 'family';
syncManagerCareToday({ getElementById: id => dom[id] || null }, new MemoryWebStorage());
assert(dom.profileCareAllowanceSummary.textContent.replace(/\u00a0/g, ' ').includes('Pflegegeld 599 €/Monat kommt als Einkunft dazu'), 'Personenkarte nennt Pflegegeldbetrag');
dom.profileCareGradeToday.value = '0';
dom.profileCareFormToday.value = '';
const displayedCare = () => careTodayFromRecord({ profile_care_grade_today: dom.profileCareGradeToday.value,
    profile_care_form_today: dom.profileCareFormToday.value });
const pristineCare = JSON.stringify(displayedCare());
syncManagerCareToday({ getElementById: id => dom[id] || null }, new MemoryWebStorage());
assertEqual(JSON.stringify(displayedCare()), pristineCare, 'Person ohne Pflegegrad bleibt beim Anzeigen unverändert und erzeugt keinen Entwurf');
assert(noCareAllowanceReason({ grade: 4, careForm: 'residential' }).includes('Heim'), 'Heim hat eigene Erklärung');
const protocol = renderProtocolTable([{ jahr: 1, CareP1_Active: true, CareP1_Grade: 4,
    CareP2_Active: true, CareP2_Grade: 3, renteSum: 0 }], { source: 'mc', inputs });
assert(protocol.includes('kein Pflegegeld') && protocol.includes('Kasse zahlt an den Dienst') && protocol.includes('Kasse zahlt an das Heim'), 'Protokoll-Einnahmen erklären Unterstützung und Heim getrennt');

// Echte Vor-VF-2c-Records, als historisches v1-Profilbundle mit alten Einkunftsschlüsseln.
const legacy = JSON.parse(readFileSync(new URL('./fixtures/vf-2c-legacy-profiles.json', import.meta.url), 'utf8'));
const legacyBytes = JSON.stringify(legacy), ids = Object.keys(legacy.registry.profiles);
const store = new MemoryWebStorage();
assert(importProfilesBundle(legacy, { storage: store }).ok, 'Historischen Profil-Export laden');
assert(!migrateStoredCareForms(store).changed, 'Personenimport übernimmt Pflegeformen sofort und idempotent');
const migrated = JSON.parse(store.getItem('rs_profiles_v1'));
assertEqual(migrated.profiles[ids[0]].data[CARE_VALUE_KEYS.form], 'family', 'Alte Angehörigenpflege bleibt Angehörigenpflege');
assertEqual(migrated.profiles[ids[1]].data[CARE_VALUE_KEYS.form], 'home-support', 'Altes Grad-3-extern wird Unterstützung zu Hause');
assertEqual(migrated.profiles[ids[1]].data.sim_pflegeStufe4Form, 'residential', 'Altes Grad-4-extern wird Heim');
assertEqual(migrated.profiles[ids[1]].data.profile_care_additional_monthly, '100', 'Altschlüssel bleiben erhalten');
const bytes = JSON.stringify([...store.records]);
assert(!migrateStoredCareForms(store).changed, 'Zweiter Start verändert keine Pflegeform');
assertEqual(JSON.stringify([...store.records]), bytes, 'Zweiter Start bytegleich');
const shown = [], doc = { body: { prepend: node => shown.push(node) }, createElement: () => ({}), querySelector: () => null };
showCareFormsMigrationNotice(doc, store); showCareFormsMigrationNotice(doc, store);
assertEqual(shown.length, 1, 'Migrationshinweis genau einmal');

const oldStore = new MemoryWebStorage();
assert(importProfilesBundle(legacy, { storage: oldStore }).ok, 'Unmigrierter Altbestand für Sicherungsprobe');
// Historische Sicherung ausdrücklich vor der Pflegeform-Umstellung aufbauen.
oldStore.setItem('rs_profiles_v1', JSON.stringify(legacy.registry));
for (const key of ['profile_care_form_today', ...[1, 2, 3, 4, 5].map(g => `sim_pflegeStufe${g}Form`)]) {
    const raw = legacy.registry.profiles[ids[0]].data[key];
    raw === undefined ? oldStore.removeItem(key) : oldStore.setItem(key, raw);
}
const backup = buildFullPersistenceBackup({ storage: oldStore });
try {
    for (const schemaVersion of [1, 2]) {
        const f = await playFixture('tauri'); await f.boot();
        const oldBackup = { ...backup, schemaVersion };
        if (schemaVersion === 1) delete oldBackup.records;
        assert((await importFullPersistenceBackup(oldBackup)).ok, `Alte Sicherung Schema ${schemaVersion} wiederherstellen`);
        assert(!migrateStoredCareForms().changed, 'Vollsicherungsimport übernimmt alte Pflegeformen vor dem ersten Zugriff');
        migrateStoredIncome(); await P.flush();
        assertEqual(P.getItemSync(CARE_VALUE_KEYS.form), 'family', 'Restore erhält persönliche Angehörigenpflege');
        assert(P.getItemSync(INCOME_KEY) && P.getItemSync(INCOME_MIGRATION_KEY), 'Restore übernimmt auch die historischen Einkunftsschlüssel');
        await f.boot();
        assert(!migrateStoredCareForms().changed, 'Nach Restore und Neustart keine zweite Migration');
    }
    const f = await playFixture('tauri', Object.fromEntries(oldStore.records)); await f.boot();
    const point = await SnapshotArchive.createSnapshot({ kind: 'manual', label: 'Alter Pflegebestand', records: P.exportAllSync().records,
        activeProfileId: ids[0], restoreScope: { profileRegistryMode: 'replace-all-rollback', profileLiveDataMode: 'replace-all-rollback' } });
    migrateStoredCareForms(); await P.flush();
    const restored = await restoreSnapshotById(point.id, { reload() {}, decide: async () => true });
    assertEqual(restored.status, 'restored', 'Historischen Wiederherstellungspunkt zurückholen');
    await f.boot();
    assert(migrateStoredCareForms().changed, 'Auch nach Wiederherstellungspunkt wird der alte Bestand erneut übernommen');
    assertEqual(P.getItemSync(CARE_VALUE_KEYS.form), 'family', 'Wiederherstellungspunkt erhält heutige Form');
} finally { P.resetPersistenceRuntimeForTests(); }
assertEqual(JSON.stringify(legacy), legacyBytes, 'Historische Exportquelle bleibt bytegleich');
