// JW-1a: Januar-Befunde im Jahresabschluss (Gutachten JW Fable und Neon). Nur synthetische Daten:
// Musterhaushalt aus den Annual-Fixtures, Testdatum 02.01.2027.
import { deriveAnnualCloseEvidence, isAnnualClosePrePoint } from '../app/shared/annual-close-evidence.js';
import { createManualAnnualValue } from '../app/shared/annual-marketdata.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { annualServiceFixture, readyAnnualFixture, annualTestNow, annualTestMarketData, installAnnualLocks } from './helpers/balance-storage-fixtures.mjs';
import { setAppTestDate, getAppTestDate } from '../app/shared/app-clock.js';

const { overviewAnnualFixture, annualUntil, markerlessAnnualFixture } = await import('./overview-annual-close.test.mjs?fixture');
const saved = { doc: globalThis.document, win: globalThis.window, date: getAppTestDate() }, unlock = installAnnualLocks();
const settle = (promise, ms = 1500) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve({ status: 'timeout' }), ms))]);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
    setAppTestDate('2027-01-02');

    // Fable P2-2: Der eigene Vorabpunkt eines Erstabschlusses führt nach einem Kurswrite nicht in „bereits abgeschlossen?“.
    {
        const sample = markerlessAnnualFixture(), id = sample.records.rs_current_profile;
        const point = { id: 'vor-erstabschluss', kind: 'annual-close-pre-mutation', activeProfileId: id, createdAt: annualTestNow().toISOString(), records: { ...sample.records } };
        const lots = JSON.parse(sample.records.depot_tranchen); lots[0].currentPrice = Number(lots[0].currentPrice || 100) + 1;
        const live = { ...sample.records, depot_tranchen: JSON.stringify(lots) };
        const evidence = deriveAnnualCloseEvidence({ targetYear: 2026, scope: sample.scope, activeId: id, records: live, snapshots: [point] });
        assertEqual(evidence.status, 'ready', 'P2-2: Wiederholung des Erstabschlusses bleibt nach Kurswrite offen');
    }

    // Neon P2-4: Der Vorabpunkt gilt für den ganzen Haushalt, auch für ein nachgeholtes Jahr.
    {
        const scope = { ids: ['max', 'erika'] }, point = { kind: 'annual-close-pre-mutation', activeProfileId: 'max', createdAt: '2027-01-02T12:00:00Z' };
        assertEqual(isAnnualClosePrePoint(point, { targetYear: 2026, activeId: 'erika', scope }), true, 'Neon P2-4: Punkt von Max gilt auch bei geöffnetem Profil Erika');
        assertEqual(isAnnualClosePrePoint(point, { targetYear: 2025, activeId: 'max', scope }), true, 'Neon P2-4: Nachholjahr 2025 erkennt den Punkt vom Januar 2027');
        assertEqual(isAnnualClosePrePoint({ ...point, activeProfileId: 'fremd' }, { targetYear: 2026, activeId: 'erika', scope }), false, 'Neon P2-4: Punkt außerhalb des Haushalts zählt nicht');
        assertEqual(isAnnualClosePrePoint({ ...point, createdAt: '2026-06-01T12:00:00Z' }, { targetYear: 2026, activeId: 'max', scope }), false, 'Neon P2-4: Punkt aus dem Abschlussjahr selbst zählt nicht');
    }

    // Neon P1-2: Ein beschädigter Live-Balance-Stand führt im Koordinator zur Wiederherstellung statt zu einem Syntaxfehler.
    {
        const env = await annualServiceFixture({ sample: readyAnnualFixture() });
        env.storage.setItem(CONFIG.STORAGE.LS_KEY, '{"inputs":');
        const result = await env.create().close();
        assertEqual(result.status, 'invalid', 'Neon P1-2: beschädigter Stand bricht den Abschluss ab');
        assert(/beschädigt/.test(result.error?.message || '') && /Daten & Sicherung/.test(result.error?.message || ''), 'Neon P1-2: Meldung führt zur Wiederherstellung');
        assertEqual(env.snapshots.size + env.batches.length, 0, 'Neon P1-2: kein Punkt und kein Schreibvorgang');
        env.persistence.resetPersistenceRuntimeForTests();
    }

    // Neon P3-3: Handwerte für Inflation und CAPE reisen mit dem Handkurs-Retry.
    {
        const env = await annualServiceFixture({ sample: readyAnnualFixture() });
        const inflation = createManualAnnualValue('inflation', '2,5', 2026), cape = createManualAnnualValue('cape', '31', 2026);
        const result = await env.create({ confirmAnnual: async () => ({ preparedMarketData: { inflation, cape } }),
            prepareMarketData: async () => ({ ok: false, results: { inflation, cape, errors: [{ step: 'ETF & Nachrücken', error: 'ETF_INJECTED' }] } }) }).close();
        assertEqual(result.status, 'incomplete_recovery', 'Neon P3-3: ETF-Fehler beginnt die Recovery');
        assertEqual(result.retryContext?.manualMarket?.inflation?.rate, 2.5, 'Neon P3-3: manuelle Inflation bleibt für die Wiederaufnahme erhalten');
        assertEqual(result.retryContext?.manualMarket?.cape?.capeRatio, 31, 'Neon P3-3: manueller CAPE bleibt für die Wiederaufnahme erhalten');
        env.persistence.resetPersistenceRuntimeForTests();
    }

    // Fable P2-4: Ein unpassendes Auswahljahr der Ausgaben meldet die Startseite vor dem Dialog.
    {
        const sample = readyAnnualFixture();
        sample.records.balance_expenses_v1 = JSON.stringify({ version: 1, activeYear: 2025, years: {} });
        const f = await overviewAnnualFixture({ sample });
        const closing = f.open(), result = await settle(closing);
        assertEqual(result.status, 'invalid', 'Fable P2-4: Abschluss endet sofort');
        assertEqual(f.doc.getElementById('annualConfirmBtn'), null, 'Fable P2-4: kein Dialog mit Schritten vor der Meldung');
        assert(/Auswahljahr der Ausgaben/.test(f.doc.getElementById('overviewAnnualStatus').textContent), 'Fable P2-4: Meldung nennt das Auswahljahr');
        f.close(); await settle(closing); f.persistence.resetPersistenceRuntimeForTests();
    }

    // Neon P1-2: Auch der Einstieg auf der Startseite führt bei beschädigtem Stand zur Wiederherstellung.
    {
        const f = await overviewAnnualFixture({ sample: readyAnnualFixture() });
        const create = f.doc.createElement.bind(f.doc); let opened = null;
        f.doc.createElement = tag => { const node = create(tag); if (tag === 'a') node.click = () => { opened = node.getAttribute('href'); }; return node; };
        f.storage.setItem(CONFIG.STORAGE.LS_KEY, '{"inputs":');
        const closing = f.open(), result = await settle(closing);
        assertEqual(result.status, 'cancelled', 'Neon P1-2: Startseite bricht ohne Syntaxfehler ab');
        assert(/Daten & Sicherung/.test(f.doc.getElementById('overviewAnnualStatus').textContent), 'Neon P1-2: Startseite nennt den Weg zur Wiederherstellung');
        assert(/^Daten-Sicherung\.html.*#wiederherstellung$/.test(opened || ''), 'Neon P1-2: Startseite öffnet die Wiederherstellung');
        f.close(); await settle(closing); f.persistence.resetPersistenceRuntimeForTests();
    }

    // Fable P2-3 / FR-99: Fehlt die amtliche Inflation, erklärt der Dialog Zahl, Quelle, Termin und Warten.
    {
        const readers = { prepareInflation: async () => { throw new Error('Keine kompatiblen Inflationsdaten fuer 2026 gefunden.'); },
            prepareETF: async () => structuredClone(annualTestMarketData.etf), prepareCape: async () => structuredClone(annualTestMarketData.cape) };
        const f = await overviewAnnualFixture({ sample: readyAnnualFixture(), readers });
        const closing = f.open();
        await annualUntil(() => f.doc.getElementById('annualHandInflation') && !f.doc.getElementById('annualHandInflation').parent?.hidden);
        const help = f.doc.getElementById('annualHandInflation').parent.children.map(node => node.textContent).join(' ');
        for (const part of ['HVPI', 'Jahresdurchschnitt 2026', 'Eurostat', 'Mitte Januar', 'warte', 'Schätzung'])
            assert(help.toLowerCase().includes(part.toLowerCase()), 'Fable P2-3: Hilfetext zur Inflation nennt ' + part);
        f.close(); await settle(closing); f.persistence.resetPersistenceRuntimeForTests();
    }

    // Neon P2-6: Der Tageswechsel um Mitternacht schließt den offenen Abschlussdialog nicht.
    {
        let today = annualTestNow();
        const f = await overviewAnnualFixture({ sample: readyAnnualFixture(), now: () => today });
        const closing = f.open();
        await annualUntil(() => f.doc.getElementById('annualConfirmBtn'));
        today = new Date('2027-01-03T12:00:00Z');
        await wait(500);
        assertEqual(f.doc.getElementById('balanceAnnualClose')?.open, true, 'Neon P2-6: Dialog bleibt nach Mitternacht offen');
        f.close(); await settle(closing); f.persistence.resetPersistenceRuntimeForTests();
    }
} finally { unlock(); globalThis.document = saved.doc; globalThis.window = saved.win; setAppTestDate(saved.date); }
