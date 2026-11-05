import fs from 'node:fs';
import { createPresentationTestDocument, readSources } from './designsystem-source-contract.mjs';
import { projectBalanceReserves } from '../app/balance/balance-reserves.js';
import { SummaryRenderer } from '../app/balance/balance-renderer-summary.js';
import { ActionRenderer } from '../app/balance/balance-renderer-action.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { evaluateStoredAnnualHousehold } from '../app/balance/balance-main-profilverbund.js';
import { EngineAPI } from '../engine/index.mjs';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { preparePlayAction } from '../app/balance/balance-play-execution.js';
import { createTimeLapse } from '../app/shared/probelauf-timelapse.js';
import { createTimeLapseServices } from '../app/overview/overview-timelapse.js';
import { areaSessionStorage } from '../app/shared/persistence-area-storage.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { overviewAnnualFixture, annualUntil } from './overview-annual-close.test.mjs?fixture';
import { prepareCloseFixture } from './close-dialog.test.mjs?fixture';
import { readyAnnualFixture, installAnnualLocks } from './helpers/balance-storage-fixtures.mjs';
import { setAppTestDate, getAppTestDate } from '../app/shared/app-clock.js';

const html = fs.readFileSync(new URL('../Balance.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../css/balance.css', import.meta.url), 'utf8');
for (const removed of ['jahresabschlussBtn', 'balanceNextAnnual', 'balanceNextStatus', 'balanceNextSteps', 'ov-next', 'ov-after', 'Wenn du die Schritte umsetzt', 'Jahresabschluss &amp; Vorschau'])
    assert(!html.includes(removed), 'Balance entfernt den alten Überblicksanker: ' + removed);
assert(html.indexOf('ov-mkt') < html.indexOf('ov-need') && html.indexOf('ov-need') < html.indexOf('ov-res'), 'Untere Reihe folgt Marktphase, Bedarf, Reserven');
assert(css.includes('.balance-overview > .ov-hero, .balance-overview > .ov-act { grid-column: span 6; }')
    && css.includes('.balance-overview > .ds-plan-card { grid-column: span 4; }'), 'Beide PC-Breiten teilen 6+6 und 4+4+4');
assert(css.includes('.balance-overview > .ov-hero, .balance-overview > .ov-act { align-self: start; }'), 'Nur die oberen Karten bleiben oben bündig ohne Streckung');
assert(!/align-self/.test(css.match(/\.balance-overview > \.ds-plan-card \{([^}]+)\}/)[1]), 'Untere Reihe behält die gleiche Kartenhöhe');
assert(css.includes('.balance-reserve-goal-label { position: absolute; top: 0; transform: translateX(-50%); }') && css.includes('padding-top: 1.5em;'), 'Ziel steht unter der Marke mit eigener kollisionsfreier Zeile');
assert(!/order:/.test(css.slice(css.indexOf('@container balance-page (min-width: 2300px)'), css.indexOf('@container balance-page (max-width: 1180px)'))), 'Breitansicht behält dasselbe Raster');

const old = { doc: globalThis.document, win: globalThis.window, date: getAppTestDate() }, restoreLocks = installAnnualLocks();
const text = node => [node.textContent, ...(node.children || []).map(text)].join(' ');
try {
    const doc = createPresentationTestDocument(); globalThis.document = doc; globalThis.window = {};
    const keys = ['balanceMonthlyBudget', 'balanceNeedTotal', 'balanceFloorCoverage', 'balanceNeedRows', 'balanceReserveValues', 'balanceReserveParts', 'balanceReserveTarget', 'balanceReserveCoverage', 'balanceReserveRunway', 'balanceReserveRows', 'balanceReserveBar', 'balanceReserveAfterBar', 'balanceReserveGoalMark', 'liquiditaetBalken', 'balancePersonalCashTargets'];
    const outputs = Object.fromEntries(keys.map(key => [key, doc.createElement('div')]));
    const goldRow = doc.createElement('div'); goldRow.id = 'minGoldRow'; doc.body.appendChild(goldRow);
    const renderer = new SummaryRenderer({ outputs });
    const input = { floorBedarf: 30000, flexBedarf: 30000, renteAktiv: true, renteMonatlich: 2300, tagesgeld: 30000, geldmarktEtf: 60000, liquidityRunwayYears: 5, liquidityCashMonths: 12, goldWert: 0, goldAktiv: false };
    const ui = { input, spending: { monatlicheEntnahme: 2700 }, zielLiquiditaet: 162000 };
    renderer.renderPlanCards(ui); renderer.renderReserves(ui);
    assert(text(outputs.balanceNeedTotal).includes('5.000'), 'Bedarf gesamt steht als Kennzahl über den Zeilen');
    assertEqual(outputs.balanceFloorCoverage.textContent, 'Grundbedarf zu 92 % durch Renten gedeckt.', 'Grundbedarf-Satz nennt Rentendeckung');
    assert(goldRow.hidden && outputs.balanceReserveRows.children.length === 0, 'Gold aus ohne Bestand entfernt beide Goldzeilen');
    assert(!text(outputs.balanceReserveValues).includes('→') && outputs.balanceReserveAfterBar.hidden, 'Ohne Vorschlag nur heute und eine Deckungsmarke');
    assert(text(outputs.balanceReserveTarget).includes('60 Monate Entnahme = 162.000') && text(outputs.balanceReserveTarget).includes('12 Monate im Tagesgeld'), 'Reserveziel zeigt Planmonate und Betrag');
    renderer.renderPlanCards({ ...ui, input: { ...input, renteMonatlich: 3000 } });
    assertEqual(outputs.balanceFloorCoverage.textContent, 'Grundbedarf durch Renten gedeckt.', 'Vollständige Rentendeckung bleibt ein Satz');
    for (const gold of [{ goldAktiv: true, goldWert: 0 }, { goldAktiv: false, goldWert: 1000 }]) {
        renderer.renderReserves({ ...ui, input: { ...input, ...gold } });
        assert(!goldRow.hidden && outputs.balanceReserveRows.children.length === 1, 'Aktiver Plan oder vorhandenes Gold zeigt die Goldzeilen');
    }
    renderer.renderReserves(ui, [
        { name: 'Max', input, action: { quellen: [], verwendungen: {} }, tagesgeldTarget: 2400 },
        { name: 'Erika', input, action: { quellen: [], verwendungen: {} }, tagesgeldTarget: 30000 }
    ]);
    assert(text(outputs.balancePersonalCashTargets).includes('Max 2.400') && text(outputs.balancePersonalCashTargets).includes('Erika 30.000')
        && text(outputs.balancePersonalCashTargets).includes('Summe 32.400'), 'Persönliche Tagesgeldziele mit Summe bleiben ohne Vorschlag sichtbar');
    assert(outputs.balanceReserveAfterBar.hidden, 'Tagesgeldziele allein erzeugen keinen Nachherwert');
    const entries = [{ name: 'Max', input: { ...input, personalTagesgeldTarget: 32400 }, action: { quellen: [{ kind: 'aktien_neu', brutto: 90000, steuer: 869, netto: 89131 }], verwendungen: { liquiditaet: 89131 }, liquidityInflowToMoneyMarket: 86731 } }];
    const bytes = JSON.stringify({ ui, entries });
    renderer.renderReserves(ui, entries);
    assert(text(outputs.balanceReserveValues).includes('179.131') && text(outputs.balanceReserveValues).includes('→'), 'Reservehauptzahl zeigt heute und nach Umsetzung');
    assert(text(outputs.balanceReserveParts).includes('32.400') && text(outputs.balanceReserveParts).includes('146.731'), 'Reservezeilen übernehmen Tagesgeld und Geldmarkt der Aktion');
    assertClose(parseFloat(outputs.balanceReserveCoverage.children[1].style.left), 100 / 120 * 100, .001, 'Zielbeschriftung steht bei 83,33 Prozent der Balkenbreite');
    assertEqual(outputs.balanceReserveCoverage.children[1].style.left, outputs.balanceReserveGoalMark.style.left, 'Zielmarke und Beschriftung teilen denselben Breitenanteil');
    renderer.renderReserves({ ...ui, input: { ...input, tagesgeld: 500000 } }, entries);
    assertEqual(outputs.balanceReserveCoverage.children[1].style.left, outputs.balanceReserveGoalMark.style.left, 'Auch bei mehr als 120 Prozent Deckung bleibt Ziel unter seiner Marke');
    renderer.renderReserves(ui, entries);
    assert(!outputs.balanceReserveAfterBar.hidden && outputs.balanceReserveBar.getAttribute('aria-label').includes('111'), 'Zwei Deckungsmarken zeigen auch Überdeckung');
    assert(text(outputs.balanceReserveRunway).includes('33 → 66 Monate'), 'Reichweite nutzt dieselbe finanzierte Monatsentnahme');
    assertEqual(JSON.stringify({ ui, entries }), bytes, 'Reserveanzeige ändert keine Finanzwerte');
    renderer.renderReserves(ui);
    assert(outputs.balanceReserveAfterBar.hidden && !text(outputs.balanceReserveParts).includes('→'), 'Folgerendern ohne Vorschlag entfernt alte Nachherwerte');

    // Gegen die echte Spieleintragung: Verkäufe, interne Transfers und Kaufdeckung.
    for (const household of ['max-erika', 'martin-petra', 'jan-lena', 'helga-werner']) {
        setAppTestDate('2026-10-20');
        const f = await playFixture('tauri', createMusterHaushaltRecords('2026-10-20', household));
        let controller = await f.boot(); await controller.start(() => ({ source: 'copy', testDate: '2026-10-20' })); controller = await f.boot();
        const c = buildBalanceEngineInputFromStorage({ storage, referenceYear: 2026 });
        const runs = evaluateStoredAnnualHousehold(c.inputData, c.profiles, c.engineLastState, { engineApi: EngineAPI, withdrawalMode: c.householdPlan.entry.values.householdWithdrawalMode });
        const ui = { ...runs.householdResult.ui, input: c.inputData };
        const entries = new ActionRenderer({}).prepareExecutionEntries(runs.map(run => ({ profileId: run.profileId, name: run.name, input: run.input, action: run.ui.action, spending: run.ui.spending, targetLiquidity: run.ui.zielLiquiditaet })), ui.zielLiquiditaet);
        const projected = projectBalanceReserves(ui, entries);
        if (projected.after) {
            const prepared = await preparePlayAction({ controller, entries });
            assertClose(projected.after.tagesgeld, prepared.batch.people.reduce((sum, person) => sum + person.finalCash, 0), .02, household + ': Tagesgeld entspricht der echten Spieleintragung');
            const registry = JSON.parse(prepared.records.rs_profiles_v1);
            const moneyMarket = Object.values(registry.profiles).flatMap(profile => JSON.parse(profile.data.depot_tranchen)).filter(lot => lot.type === 'geldmarkt').reduce((sum, lot) => sum + lot.shares * lot.currentPrice, 0);
            assertClose(projected.after.geldmarkt, moneyMarket, .02, household + ': Geldmarkt entspricht der echten Spieleintragung');
        } else assert(entries.length === 0, household + ': kein Vorschlag bleibt ohne Nachherwert');
        P.resetPersistenceRuntimeForTests();
    }

    // Die vorhandene Übersicht bleibt nach Abbruch in beiden Bereichen der Startort.
    for (const area of ['echt', 'spiel']) for (const cancel of ['Escape', 'Verwerfen']) {
        setAppTestDate('2027-01-02');
        const sample = readyAnnualFixture(), f = await overviewAnnualFixture({ sample, archived: true });
        if (area === 'spiel') {
            const play = await playFixture('tauri', sample.records); let controller = await play.boot();
            await controller.start(() => ({ source: 'copy', testDate: '2026-12-02' })); controller = await play.boot();
            const runner = createTimeLapse({ controller, session: areaSessionStorage(play.session),
                services: createTimeLapseServices({ controller, win: play.win }), yieldStep: async () => {} });
            runner.start({ start: '2026-12-02', end: '2027-01-02' }); await runner.run();
            assertEqual(runner.state.status, 'running', 'Ein Jahr durchspielen erreicht den Januar vor dem Jahreswrite');
            controller = await play.boot();
            const stopped = createTimeLapse({ controller, session: areaSessionStorage(play.session) }); stopped.restore(); stopped.stop();
            assertEqual(controller.state.testDate, '2027-01-02', 'Angehaltener Zeitraffer bietet den Januarabschluss von Hand an');
            globalThis.document = f.doc; globalThis.window = f.win;
        }
        for (const id of ['navigationGuardDialog', 'navigationGuardStay', 'navigationGuardLeave', 'navigationGuardTitle', 'navigationGuardDescription']) {
            const node = f.doc.createElement(id === 'navigationGuardDialog' ? 'dialog' : 'button'); node.id = id; f.doc.body.append(node);
        }
        f.refresh(); await annualUntil(() => f.model.occasion.annualState === 'open');
        const before = JSON.stringify(await f.persistence.readPersistedRecords());
        const closing = f.open(); await prepareCloseFixture(f.doc);
        await annualUntil(() => f.doc.getElementById('annualConfirmBtn') && !f.doc.getElementById('annualConfirmBtn').disabled);
        const root = f.doc.getElementById('balanceAnnualClose');
        if (cancel === 'Verwerfen') {
            await root.querySelector('[data-annual-plan-toggle]').fire('click');
            const field = f.doc.getElementById('annualPlan_floorBedarf'); field.value = '21000'; await field.fire('input'); await root.fire('input', { target: field });
            await prepareCloseFixture(f.doc); await annualUntil(() => !f.doc.getElementById('annualConfirmBtn').disabled);
            await root.fire('keydown', { key: 'Escape' }); await annualUntil(() => f.doc.getElementById('navigationGuardDialog').open);
            await f.doc.getElementById('navigationGuardLeave').fire('click');
        } else await root.fire('keydown', { key: 'Escape' });
        assertEqual((await closing).status, 'cancelled', area + ': ' + cancel + ' beendet nur den Entwurf'); f.refresh();
        assert(f.model.occasion.annualState === 'open' && f.doc.getElementById('overviewFocus').innerHTML.includes('data-overview-annual'), area + ': Übersicht bietet nach Abbruch den fälligen Abschluss weiter an');
        assertEqual(JSON.stringify(await f.persistence.readPersistedRecords()), before, area + ': Abbruch erhält Finanzbytes');
        const again = f.open(); await prepareCloseFixture(f.doc); await annualUntil(() => f.doc.getElementById('balanceAnnualClose')?.open);
        await f.doc.getElementById('balanceAnnualClose').fire('keydown', { key: 'Escape' });
        assertEqual((await again).status, 'cancelled', area + ': erneuter Start über Übersicht möglich'); f.close();
    }
} finally { restoreLocks(); globalThis.document = old.doc; globalThis.window = old.win; setAppTestDate(old.date); P.resetPersistenceRuntimeForTests(); }
