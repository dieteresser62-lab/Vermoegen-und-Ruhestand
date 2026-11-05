import { installRealClock } from './helpers/fixed-real-clock.mjs';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { MUSTER_HAUSHALTE } from '../app/demo/muster-haushalte.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
// Am echten 23.10. darf der feste Spieltag nicht zu „heute“ normalisiert werden.
const restoreRealClock = installRealClock('2026-11-03');
try {
const settings = {
    sim_pflegefallLogikAktivieren: 'false', sim_pflegeModellTyp: 'static', sim_pflegeStufe3Zusatz: '99999',
    sim_pflegeStufe3Form: 'family', sim_pflegeKostenStaffelPreset: 'custom',
    sim_mcAnzahl: '10000', sim_mcSeed: '777', sim_mcMethode: 'bootstrap', sim_useCapeSampling: 'true',
    sim_entnahmeStrategie: '3_bucket_jilge', sim_bondTargetFactor: '99', sim_survivorFloorPercent: '33',
    sim_startYearMode: 'RECENT', 'sim.stressReplay.active.v1': 'old-replay'
};
for (const backend of ['tauri', 'indexeddb', 'localstorage']) {
    const f = await playFixture(backend, { ...settings, profile_tagesgeld: '000123' });
    let c = await f.boot(), realBefore = f.realBytes();
    // Zuerst eine veränderte Kopie; auch ihre Einstellungen dürfen später nicht durchwirken.
    await c.start(() => ({ source: 'copy', testDate: '2026-10-23' })); c = await f.boot();
    for (const [key, value] of Object.entries(settings)) P.setItemSync(key, value + '-alter-spielbereich');
    await P.flush(); await c.end(() => true); c = await f.boot();
    for (const { id } of MUSTER_HAUSHALTE) {
        await c.start(() => ({ source: 'demo', householdId: id, testDate: '2026-10-23' })); c = await f.boot();
        const actual = await P.readPersistedRecords(key => key !== 'rs_probelauf_state_v1');
        const expected = createMusterHaushaltRecords('2026-10-23', id);
        const sorted = obj => JSON.stringify(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
        assertEqual(sorted(actual), sorted(expected), `${backend}/${id}: vollständige Beispielvorgaben ohne durchwirkende Simulatorwerte`);
        for (const [key, value] of Object.entries(settings)) P.setItemSync(key, value);
        await P.flush(); await c.end(() => true); c = await f.boot();
        assertEqual(f.realBytes(), realBefore, `${backend}/${id}: echte Daten bleiben bytegleich`);
    }
    P.resetPersistenceForTests(); setAppTestDate(null);
}

// Neustart im bestehenden Spielbereich: Variante, Testdatum und vollständige Vorgaben bleiben erhalten.
const { musterVarianten } = await import('../app/demo/muster-haushalte.js');
const { SnapshotArchive: archive } = await import('../app/shared/snapshot-archive.js');
const { validateProbelaufState } = await import('../app/shared/probelauf-state.js');
for (const backend of ['tauri', 'indexeddb', 'localstorage']) {
    const real = createMusterHaushaltRecords('2026-10-23');
    const f = await playFixture(backend, real);
    let c = await f.boot();
    await archive.createSnapshot({ id: 'real-before-example', label: 'Echter Sicherungspunkt', records: real });
    const before = f.realBytes();
    for (const h of MUSTER_HAUSHALTE) for (const v of musterVarianten(h.id)) {
        await c.start(() => ({ source: 'demo', householdId: h.id, variantId: v.id, testDate: '2026-10-23' }));
        c = await f.boot();
        const old = { ...c.state }; delete old.variantId;
        const oldBytes = JSON.stringify(old);
        assertEqual(JSON.stringify(validateProbelaufState(oldBytes)), oldBytes, 'Altzustand ohne Variante behält Rohbytes und gilt als Grundfall');
        P.setItemSync('sim_mcSeed', '777'); P.setItemSync('profile_tagesgeld', '123'); await P.flush();
        await archive.createSnapshot({ id: 'play-only', label: 'Nur Spiel', records: await P.readPersistedRecords(key => key !== 'rs_probelauf_state_v1' && key !== 'rs_snapshot_archive_v1') });
        const changed = JSON.stringify(await P.readPersistedRecords());
        assertEqual((await c.restart(() => false)).status, 'cancelled', 'Abbruch ohne Neustart');
        assertEqual(JSON.stringify(await P.readPersistedRecords()), changed, 'Abbruch erhält alle Spielbytes');
        await c.restart(() => true); c = await f.boot();
        assertEqual(c.state.variantId, v.id, 'Neustart merkt Variante');
        assertEqual(c.state.testDate, '2026-10-23', 'Neustart erhält Testdatum');
        const actual = await P.readPersistedRecords(key => !['rs_probelauf_state_v1', 'rs_snapshot_archive_v1'].includes(key));
        const expected = createMusterHaushaltRecords('2026-10-23', h.id, v.id);
        const sorted = value => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
        assert(sorted(actual) === sorted(expected), `${backend}/${h.id}/${v.id}: frischer vollständiger Datensatz ohne alte Annahmen`);
        assertEqual((await archive.listSnapshots()).length, 0, 'Spiel-Sicherungspunkte verworfen');
        assertEqual(f.realBytes(), before, 'Neustart erhält echte Daten und Sicherungspunkte bytegleich');
        const alternative = musterVarianten(h.id).find(variant => variant.id !== v.id);
        if (alternative) {
            const beforeSwitch = JSON.stringify(await P.readPersistedRecords());
            await c.restart(() => false, { variantId: alternative.id });
            assertEqual(JSON.stringify(await P.readPersistedRecords()), beforeSwitch, 'Variantenabbruch erhält Spielbytes');
            await c.restart(() => true, { variantId: alternative.id }); c = await f.boot();
            assertEqual(c.state.variantId, alternative.id, 'Variantenwechsel startet die gewählte Variante');
            assertEqual(c.state.testDate, '2026-10-23', 'Variantenwechsel erhält das Testdatum');
            assertEqual(f.realBytes(), before, 'Variantenwechsel erhält echte Daten und Sicherungspunkte');
        }

        await c.end(() => true); c = await f.boot();
    }
    await c.start(() => ({ source: 'copy', testDate: null })); c = await f.boot();
    let failed = false; try { await c.restart(() => true); } catch { failed = true; }
    assert(failed, 'Kopie meiner Daten hat keinen Beispielneustart');
    await c.end(() => true);
    P.resetPersistenceForTests(); setAppTestDate(null);
}
let invalid = false;
try { validateProbelaufState({ version: 2, active: true, phase: 'active', source: 'demo', runtime: 'browser', testDate: null, householdId: 'renate', variantId: 'ehe' }); } catch { invalid = true; }
assert(invalid, 'Unpassende Variantenkennung wird abgewiesen');
} finally { P.resetPersistenceForTests(); setAppTestDate(null); restoreRealClock(); }
