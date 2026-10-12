import { bindInfoPopovers } from '../app/shared/designsystem-info-popover.js';
import { projectTrancheHistory, buildPersonHistoryHtml, buildTrancheHistorySummary, buildTrancheHistoryDetail, confirmManagerHistoryStart,
    bindTrancheHistoryUI, bindTrancheHistoryChart, readManagerHistoryContext } from '../app/tranches/tranchen-history-ui.js';
import { historyDay, WEALTH_HISTORY_START_KEY, DAILY_PRICES_KEY } from '../app/tranches/tranchen-history-store.js';
import { buildTranchenTableHtml } from '../app/tranches/tranchen-manager-renderer.js';
import { createNavigationGuard, createNavigationOperationLifecycle } from '../app/shared/navigation-guard.js';
import { evaluateWealthHistory } from '../app/tranches/tranchen-history-model.js';

const d = historyDay('2026-01-01');
const tranche = { trancheId: 'synthetic', name: '<ETF>', purchaseDate: '2025-01-01', purchasePrice: 200,
    shares: 6, currentPrice: 120, marketValue: 720, costBasis: 1200, ticker: 'TEST.DE', type: 'aktien_neu', tqf: 0 };
const sale = { actionId: 'sale', eventType: 'sale_reconciled', profileId: 'a', trancheId: 'synthetic', executedAt: '2026-01-05',
    actual: { sharesSold: 4 }, result: { beforeShares: 10, remainingShares: 6 } };
const context = { status: 'ready', startDate: '2026-01-01', today: '2026-01-07', events: [sale],
    prices: { symbols: { 'TEST.DE': { currency: 'EUR', days: [d - 1, d + 1, d + 4, d + 5], closes: [100, 110, 115, 120],
        queried: [[d, d + 5]], failures: 0, lastError: null } } } };
const original = JSON.stringify({ tranche, context });
const history = projectTrancheHistory(tranche, context, 'a');
assert(Math.abs(history.course.percent - 20) < 1e-10, 'Teilverkauf verfälscht Kursentwicklung nicht');
assertEqual(history.gaps.length, 0, 'Geprüfter Feiertag ohne Schlusskurs ist keine Lücke');
const summary = buildTrancheHistorySummary(history);
assert(summary.includes('+20,0') && summary.includes('01.01.2026'), 'Entwicklung besitzt Kursnenner und tatsächliches Startdatum');
const detail = buildTrancheHistoryDetail(tranche, history);
assert(detail.includes('Verkauf 05.01.2026') && detail.includes('4 Stück') && detail.includes('history-sell'), 'Detail zeigt bestätigte Verkäufe in Text und SVG');
assert(detail.includes('history-purchase-line') && detail.includes('y1="55"'), 'Kaufpreis außerhalb der Kurse erweitert tatsächliche Achse');
assert(detail.includes('history-coverage-queried') && !detail.includes('history-coverage-gap'), 'Geprüfte Abdeckung einschließlich Feiertag bleibt ohne Schraffur');
assert(detail.includes('&lt;ETF&gt;') && !detail.includes('<ETF>'), 'Detail escaped dynamische Namen');
assertEqual(JSON.stringify({ tranche, context }), original, 'Kursprojektion und Ausgabe verändern keine Eingaben');
const repeated = buildTrancheHistoryDetail(tranche, history);
assert(detail.match(/wealth-course-\d+-title/)[0] !== repeated.match(/wealth-course-\d+-title/)[0], 'Mehrere Charts besitzen eindeutige Titelkennungen');
const missing = structuredClone(context); missing.prices.symbols['TEST.DE'].days.shift(); missing.prices.symbols['TEST.DE'].closes.shift();
const shifted = projectTrancheHistory(tranche, missing, 'a');
assert(Math.abs(shifted.course.percent - (120 / 110 - 1) * 100) < 1e-10, 'Fehlender Anfangskurs nutzt ersten tatsächlichen Schlusskurs, nicht Kaufpreis');
assertEqual(shifted.course.measurementStart, d + 1, 'Messbeginn liegt am ersten tatsächlichen Schlusskurs');
for (const html of [buildTrancheHistorySummary(shifted), buildTrancheHistoryDetail(tranche, shifted)]) {
    assert(html.includes('Messbeginn 02.01.2026') && html.includes('vorläufig'), 'Zusammenfassung und Detail zeigen neuen Messbeginn und Vorläufigkeit');
}
const personHistory = evaluateWealthHistory({ ...missing, profiles: [{ id: 'a', currentCash: 100, lots: [tranche] }], events: [sale] });
assert(buildPersonHistoryHtml(personHistory).includes('Messbeginn 02.01.2026') && buildPersonHistoryHtml(personHistory).includes('vorläufig'), 'Personenkarte zeigt tatsächlichen vorläufigen Messbeginn');
const noPrices = projectTrancheHistory(tranche, { ...context, prices: { symbols: {} } }, 'a');
assertEqual(noPrices.course.status, 'unavailable', 'Ohne Kurs bleibt Depotentwicklung unavailable');
assert(buildTrancheHistorySummary(noPrices).includes('Messbeginn nicht verfügbar') && buildTrancheHistoryDetail(tranche, noPrices).includes('Entwicklung nicht verfügbar'), 'Kursloser Verlauf zeigt keinen erfundenen Beginn');
const gap = structuredClone(context); gap.prices.symbols['TEST.DE'].queried = [[d, d + 1]];
const gapped = projectTrancheHistory(tranche, gap, 'a');
assertEqual(JSON.stringify(gapped.gaps), JSON.stringify([[d + 4, d + 5]]), 'Offene Werktage nach geprüftem Feiertag werden korrekt begrenzt');
assert(buildTrancheHistoryDetail(tranche, gapped).includes('history-coverage-gap'), 'Ungeprüfte Zeiträume erhalten sichtbare Abdeckungsleiste');
assert(projectTrancheHistory({ ...tranche, ticker: '' }, context, 'a').message.includes('Kein Kursverlauf ohne Ticker'), 'Ohne Ticker bleibt vorgeschriebener ruhiger Hinweis');
assertEqual(projectTrancheHistory({ ...tranche, purchaseDate: '2026-01-02' }, { ...context, events: [] }, 'a').course.range.startDate, '2026-01-02', 'Kauf nach Beginn bestimmt eigenes Startdatum');
const table = buildTranchenTableHtml([tranche], { context, profileId: 'a', expandedId: 'synthetic' });
assert(table.includes('aria-expanded="true"') && table.includes('aria-controls="tranche-history-synthetic"') && table.includes('colspan="12"'), 'Detailzeile besitzt zugänglichen Knopf und vollständige Spaltenbreite');
assert(table.includes('data-action="edit-tranche"') && table.includes('data-action="delete-tranche"'), 'Bestehende Zeilenaktionen bleiben separat erhalten');

const map = new Map([[WEALTH_HISTORY_START_KEY, '{"version":1,"startDate":"2026-01-01"}'], [DAILY_PRICES_KEY, 'unveränderte Kursbytes']]);
const storage = { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
let flushes = 0;
const options = { storage, today: '2026-01-07', flush: async () => { flushes++; } };
for (const value of ['2026-02-29', '2026-01-08', '', '01.01.2026']) {
    let failed = false; try { await confirmManagerHistoryStart(value, options); } catch { failed = true; }
    assert(failed, 'Ungültiges oder zukünftiges Beginn-Datum wird abgewiesen');
}
assertEqual(flushes, 0, 'Ungültiger Beginn hat keinen Speicherbesitz');
await confirmManagerHistoryStart('2025-01-01', options);
assertEqual(JSON.parse(map.get(WEALTH_HISTORY_START_KEY)).startDate, '2025-01-01', 'Früherer Beginn wird dauerhaft bestätigt');
assertEqual(map.get(DAILY_PRICES_KEY), 'unveränderte Kursbytes', 'Beginncommit verändert keine Kurse');
const before = map.get(WEALTH_HISTORY_START_KEY);
let first = true, error;
try { await confirmManagerHistoryStart('2026-01-03', { ...options, flush: async () => { if (first) { first = false; throw new Error('synthetischer Flushfehler'); } } }); } catch (value) { error = value; }
assert(error?.rollbackConfirmed, 'Fehlflush bestätigt kompensierendes Rückschreiben');
assertEqual(map.get(WEALTH_HISTORY_START_KEY), before, 'Fehlflush erhält exakt den bestätigten Beginn');
try { await confirmManagerHistoryStart('2026-01-03', { ...options, valid: () => false }); } catch {}
assertEqual(map.get(WEALTH_HISTORY_START_KEY), before, 'Abgebrochener Kontext startet keinen Beginnwrite');
await confirmManagerHistoryStart('2026-01-03', options);
assertEqual(JSON.parse(map.get(WEALTH_HISTORY_START_KEY)).startDate, '2026-01-03', 'Späterer Beginn bestätigt sich ohne Kurslöschung');
assertEqual(map.get(DAILY_PRICES_KEY), 'unveränderte Kursbytes', 'Späterer Beginn löscht keine früheren Schlusskurse');

// Kontrollierter echter Lifecycle: Navigation wartet einen übernommenen Commit ab.
const guard = createNavigationGuard({ decide: async () => true });
const lifecycle = createNavigationOperationLifecycle({ guard });
let release, begun;
const committed = lifecycle.run({}, operation => confirmManagerHistoryStart('2026-01-02', { ...options, operation,
    flush: () => { begun = true; return new Promise(resolve => { release = resolve; }); } }));
await Promise.resolve();
assert(begun && guard.reasons().some(reason => reason.phase === 'commit'), 'Beginnflush besitzt echte Navigations-Commitphase');
assertEqual(await guard.prepare(), null, 'Navigation überholt übernommenen Beginncommit nicht');
release(); await committed;
assertEqual(guard.reasons().length, 0, 'Bestätigter Beginn gibt Navigationsbesitz frei');

// Native Knöpfe benötigen nur einen Klickhandler, Enter/Space erzeugen browserseitig Klicks.
const host = { listeners: {}, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, querySelectorAll() { return [replacement]; } };
let focused = 0, renders = 0;
const replacement = { dataset: { historyToggle: 'synthetic' }, focus() { focused++; } };
const doc = { activeElement: replacement, getElementById: () => host };
const ui = bindTrancheHistoryUI(doc, { render: () => { const focus = ui.beforeRender('a', [tranche]); renders++; ui.afterRender(focus); } });
assertEqual(bindTrancheHistoryUI(doc, { render() {} }), ui, 'Wiederholte Bindung erzeugt keinen Doppelhandler');
ui.beforeRender('a', [tranche]);
const button = { dataset: { historyToggle: 'synthetic' }, closest: selector => selector === '[data-history-toggle]' ? button : null };
host.listeners.click[0]({ target: button });
assertEqual(ui.expandedId, 'synthetic', 'Klick öffnet passende Tranche');
assertEqual(focused, 1, 'Lesender Rerender stellt den Aufklappfokus wieder her');
host.listeners.click[0]({ target: { closest: () => null } });
assertEqual(renders, 1, 'Bearbeiten oder Löschen schaltet keinen Verlauf um');
ui.beforeRender('b', [tranche]); assertEqual(ui.expandedId, null, 'Personenwechsel verwirft unpassende Auswahl');
ui.expandedId = 'synthetic'; ui.beforeRender('b', []); assertEqual(ui.expandedId, null, 'Entfernte Tranche verwirft Detailauswahl');
assert(!host.listeners.keydown && host.listeners.click.length === 1, 'Native Tastaturaktivierung besitzt keine konkurrierenden Handler');
assertEqual(readManagerHistoryContext({ profiles: {} }, { storage, today: '2026-01-07' }).status, 'corrupt', 'Beschädigter Kursrecord wird nicht als leere Historie angezeigt');

const partialPerson = evaluateWealthHistory({ ...context, events: [], profiles: [{ id: 'a', currentCash: 100,
    lots: [tranche, { tranche: { ...tranche, trancheId: 'unknown' }, remainingShares: 6, status: 'unknown' }] }] });
const partialHtml = buildPersonHistoryHtml(partialPerson).replace(/\s+/g, ' ');
assert(partialHtml.includes('Teilabdeckung · bekannter Betrag 820 €') && partialHtml.includes('Gesamtwert nicht vollständig bewertbar'),
    'Personenkarte zeigt bekannte gültige Tranche plus Cash trotz unbekannter Tranche derselben Klasse');
assert(partialHtml.includes('ursprünglicher Kaufbeginn nicht gesichert'), 'Personenkarte erklärt fehlende Altdatierung');
assert(!partialHtml.includes('+0') && partialPerson.metrics.change === null, 'Teilbetrag wird nicht als vollständige Veränderung ausgegeben');

{
    const { buildHistoryRecoveryHtml, bindHistoryRecoveryUI } = await import('../app/tranches/tranchen-history-ui.js');
    const html = buildHistoryRecoveryHtml([{ trancheId: 'correct', name: '<Bestand>', kind: 'correct', fromDate: null, blocked: false },
        { trancheId: 'discard', name: 'Entfernt', kind: 'discard', fromDate: '2026-01-02', blocked: false },
        { trancheId: 'sale', name: 'Mit Beleg', kind: 'correct', fromDate: null, blocked: true }]);
    assert(html.includes('Korrigierten Bestand für den Verlauf bestätigen') && html.includes('Fehleingabe aus dem Verlauf verwerfen'), 'Beide Reparaturwege eindeutig beschriftet');
    assert(html.includes('&lt;Bestand&gt;') && !html.includes('<Bestand>'), 'Reparaturdaten sicher escaped');
    assert(html.includes('Nachkauf gehört in eine neue Tranche') && html.includes('ursprünglicher Kaufbeginn nicht gesichert'), 'Aktionshinweis erklärt rückwirkende Bedeutung und undatierten Altbestand');
    assert(html.includes('data-history-recovery="sale"') && html.includes('Gesperrt: bestätigter Verkaufsbeleg.'), 'Belegbestand sichtbar gesperrt');
    const listeners = {}, host = { addEventListener(type, callback) { (listeners[type] ||= []).push(callback); } };
    const doc = { getElementById: () => host };
    let finish, requests = 0;
    const execute = () => { requests++; return new Promise(resolve => { finish = resolve; }); };
    bindHistoryRecoveryUI(doc, { execute }); bindHistoryRecoveryUI(doc, { execute });
    const button = { dataset: { historyRecovery: 'correct', historyRecoveryKind: 'correct' }, disabled: false,
        closest: selector => selector === '[data-history-recovery]' ? button : null };
    const pending = listeners.click[0]({ target: button });
    await listeners.click[0]({ target: button });
    assertEqual(requests, 1, 'Delegation sperrt Doppelklick während Nachfrage/Flush');
    finish(false); await pending;
    button.disabled = true; await listeners.click[0]({ target: button });
    assertEqual(requests, 1, 'Gesperrter Belegknopf führt keine Aktion aus');
    assertEqual(listeners.click.length, 1, 'Rerender/Rebind erzeugen nur einen Handler');
    assert(!listeners.keydown, 'Native Enter-/Space-Aktivierung braucht keinen konkurrierenden Tastaturhandler');
}

for (const change of [12, -12, 0, null]) {
    const sample = { ...personHistory, metrics: { ...personHistory.metrics, change, percent: change } };
    const html = buildPersonHistoryHtml(sample);
    assert(html.includes(change === null || change === 0 ? 'history-neutral' : change > 0 ? 'history-positive' : 'history-negative'), 'Personenänderung besitzt richtige Vorzeichenfarbe');
    assert(html.indexOf('pv-history-change') < html.indexOf('<svg'), 'Veränderung steht vor dem vollen Kleinverlauf');
}
for (const sample of [null, { ...personHistory, points: [], measurementStart: null, metrics: { change: null, percent: null } },
    { ...personHistory, points: personHistory.points.map(p => ({ ...p, total: null })), measurementStart: null, metrics: { change: null, percent: null } }]) {
    const html = buildPersonHistoryHtml(sample);
    assert(html.includes('pv-history-placeholder') && !html.includes('0 € · 0,0'), 'Fehlende Historie erzeugt ruhigen Platzhalter ohne erfundene Null');
}
assert(detail.includes('Kaufpreis 200,00 € (01.01.2025)'), 'UI übergibt tatsächliches Kaufdatum statt Zeitraumstart');
assert(summary.includes('<strong class="history-positive">'), 'Tabellenentwicklung ist halbfett und positiv');

// Echte Tabellenbindung mit verschiedenen Tabellen- und Scrollboxmaßen.
for (const withObserver of [true, false]) {
    const { renderTranchenTable } = await import('../app/tranches/tranchen-manager-renderer.js');
    const observers = [], removals = [], listeners = new Map(), frames = new Map(); let nextFrame = 0, requests = 0;
    const win = {
        ...(withObserver ? { ResizeObserver: class {
            constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
            observe(target) { this.targets.push(target); }
            disconnect() { this.disconnected = true; }
        } } : {}),
        MutationObserver: class { constructor(callback) { this.callback = callback; removals.push(this); } observe() {} disconnect() { this.disconnected = true; } },
        requestAnimationFrame(fn) { frames.set(++nextFrame, fn); return nextFrame; }, cancelAnimationFrame(id) { frames.delete(id); },
        addEventListener(type, fn) { (listeners.get(type) || listeners.set(type, new Set()).get(type)).add(fn); },
        removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
        fetch() { requests++; }
    };
    const doc = { defaultView: win, documentElement: {} };
    const container = { set innerHTML(value) {
        this.html = value;
        this.region = { clientWidth: 832, scrollWidth: 2400 };
        this.section = value.includes('class="pv-history-detail"') ? {
            style: {}, ownerDocument: doc, isConnected: true, clientHeight: 200,
            get clientWidth() { return parseFloat(this.style.width || '0'); }
        } : null;
        this.host = value.includes('class="pv-course-chart"') ? {
            ownerDocument: doc, isConnected: true, clientHeight: 290, innerHTML: '',
            get clientWidth() { return Math.max(0, parseFloat(container.section.style.width || '0') - 32); }
        } : null;
    }, querySelector(selector) { return { '.pv-course-chart': this.host, '.pv-history-detail': this.section, '.table-scroll': this.region }[selector]; } };
    const emit = () => {
        if (withObserver) observers.at(-1).callback([{ target: container.region, contentRect: { width: container.region.clientWidth, height: 600 } }]);
        else [...listeners.get('resize')].forEach(fn => fn());
    };
    const frame = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); };
    const check = width => assert(container.host.innerHTML.includes(`viewBox="0 0 ${width - 32} 290"`), 'Detail zeichnet Scrollbox-Innenbreite statt volle Tabelle: ' + width);
    const inputBytes = JSON.stringify({ context, tranche, history });
    for (let i = 0; i < 4; i++) {
        renderTranchenTable(container, [tranche], { context, profileId: 'a', expandedId: 'synthetic' });
        const host = container.host, active = observers.at(-1);
        check(832);
        assertEqual(container.section.style.width, '832px', 'Erstmontage setzt sichtbare Detailbreite vor Hostmessung');
        if (withObserver) assert(active.targets.includes(host) && active.targets.includes(container.region), 'Beobachter verfolgt Host und tatsächliche Scrollregion');
        const first = host.innerHTML;
        for (const width of [832, 0, -1, NaN, Infinity]) { container.region.clientWidth = width; emit(); }
        assertEqual(frames.size, 0, 'Identische und ungültige Regionsgrößen planen keinen Frame');
        assertEqual(host.innerHTML, first, 'Ungültige Größen zeichnen keinen Ersatzwert');
        for (const width of [1232, 1532, 2032]) { container.region.clientWidth = width; emit(); }
        assertEqual(frames.size, 1, 'Mehrere Regionsmeldungen werden im Frame gebündelt');
        frame(); check(2032);
        const final = host.innerHTML;
        container.region.clientWidth = 2132; emit(); container.region.clientWidth = 2032; emit(); frame();
        assertEqual(host.innerHTML, final, 'Rückkehr zur vorhandenen Größe verwirft vorgemerkte Zeichnung');
        // Eine unsichtbare Region wird ohne erneutes Öffnen wieder bewertbar.
        container.region.clientWidth = 0; emit(); frame();
        container.region.clientWidth = 1032; emit(); frame(); check(1032);
        container.region.scrollWidth = 4000; emit(); frame();
        check(1032);
        container.region.clientWidth = 1132; emit();
        assertEqual(frames.size, 1, 'Vor Zuklappen liegt ein ausstehender Frame vor');
        renderTranchenTable(container, [tranche], { context, profileId: 'a' });
        assert((!withObserver || active.disconnected) && removals.at(-1).disconnected && frames.size === 0
            && [...listeners.values()].every(set => set.size === 0), 'Zuklappen meldet alle Beobachter, Frames und Listener ab');
    }
    for (const options of [{ context: { status: 'missing' } }, { context: { status: 'corrupt', error: '<Fehler>' } },
        { context, lots: [{ ...tranche, ticker: '' }] }]) {
        renderTranchenTable(container, options.lots || [tranche], { ...options, profileId: 'a', expandedId: 'synthetic' });
        assertEqual(container.section.style.width, '832px', 'Auch kurslose und beschädigte Details bleiben an der sichtbaren Scrollregion gebunden');
        container.region.clientWidth = 1032; emit(); frame();
        assertEqual(container.section.style.width, '1032px', 'Fehler-/Leerhinweise folgen Regionsänderungen ohne erneutes Öffnen');
        renderTranchenTable(container, [tranche], { context, profileId: 'a' });
        assert([...listeners.values()].every(set => set.size === 0) && frames.size === 0, 'Auch Leer-/Fehlerdetails räumen ihre Größenbindung auf');
    }
    // Initial unsichtbare Hosts dürfen nicht dauerhaft auf dem 1200-px-Ersatzwert bleiben.
    container.innerHTML = buildTranchenTableHtml([tranche], { context, profileId: 'a', expandedId: 'synthetic' });
    container.region.clientWidth = 0;
    const chart = bindTrancheHistoryChart(container.host, tranche, history, { region: container.region, detail: container.section });
    assertEqual(container.host.innerHTML, '', 'Initial unsichtbarer Host zeichnet keinen festen Ersatzwert');
    container.region.clientWidth = 1632; emit(); frame(); check(1632);
    container.region.clientWidth = 1732; emit();
    container.host.isConnected = false; removals.at(-1).callback();
    assert(frames.size === 0 && removals.at(-1).disconnected && (!withObserver || observers.at(-1).disconnected), 'Entfernung räumt auch ausstehenden Regionsframe auf');
    chart.dispose();
    renderTranchenTable(container, [tranche], { context, profileId: 'a', expandedId: 'synthetic' });
    const rerenderObserver = observers.at(-1), rerenderRemoval = removals.at(-1);
    container.region.clientWidth = 1732; emit();
    renderTranchenTable(container, [tranche], { context, profileId: 'a', expandedId: 'synthetic' });
    assert(frames.size === 0 && rerenderRemoval.disconnected && (!withObserver || rerenderObserver.disconnected), 'Rerender trennt alte Regionsbindung vor Kinderersatz');
    container.region.clientWidth = 1732; emit();
    [...listeners.get('pagehide')].forEach(fn => fn());
    assert(frames.size === 0 && [...listeners.values()].every(set => set.size === 0)
        && removals.at(-1).disconnected && (!withObserver || observers.at(-1).disconnected), 'Pagehide räumt vollständige Detailbindung auf');
    assertEqual(requests, 0, 'Reine Detail- und Größenbedienung erzeugt keine Kursrequests');
    assertEqual(JSON.stringify({ context, tranche, history }), inputBytes, 'Detailöffnung und Resize erhalten sämtliche Eingangsbytes');
}

// Gezählt werden sichtbare Hinweistextknoten, keine Titel-/ARIA-/SVG-Beschreibungen.
const hints = html => [...html.matchAll(/<span class="history-measurement" title="([^"]+)">([^<]+)<\/span>/g)];
for (const html of [buildTrancheHistorySummary(shifted), buildTrancheHistoryDetail(tranche, shifted), buildPersonHistoryHtml(personHistory)]) {
    const nodes = hints(html);
    assertEqual(nodes.length, 1, 'Je Darstellungskontext genau ein sichtbarer gemeinsamer Messhinweis');
    assertEqual(nodes[0][2], 'Messbeginn 02.01.2026 · vorläufig', 'Gemeinsamer Hinweis vereint Feiertagsbasis und Qualität');
    assert(nodes[0][1].includes('ersten bewertbaren Tagesabschluss'), 'Erklärung beschreibt verkürzte Messbasis');
    const isPerson = html.includes('pv-history-info');
    const visible = html.replace(/<span[^>]*class="ds-info-pop"[\s\S]*?<\/span><\/span>/g, '').replace(/<(svg)[\s\S]*?<\/svg>/g, '').replace(/<[^>]*>/g, '');
    assertEqual((visible.match(/Messbeginn/g) || []).length, isPerson ? 0 : 1, 'Messbeginn liegt für Personen vollständig im Infozugang');
    assertEqual((visible.match(/vorläufig/g) || []).length, 1, 'Warnung bleibt einmal außerhalb des Informationszugangs sichtbar');
}
for (const sample of [history, noPrices, projectTrancheHistory({ ...tranche, ticker: '' }, context, 'a'), { status: 'corrupt', message: '<Fehler>' }, shifted, history]) {
    const html = buildTrancheHistorySummary(sample) + buildTrancheHistoryDetail(tranche, sample);
    if (sample !== shifted) assert(!html.includes('Verkürzte Messbasis') && !html.includes('vorläufig'), 'Zustandswechsel entfernt vorläufigen Hinweis samt Titel');
    assert(!html.includes('<Fehler>'), 'Beschädigter Verlauf escaped sachlichen Fehler');
}
assert(hints(partialHtml)[0][2].includes('nicht vollständig bewertbar'), 'Teilabdeckung behält Qualitätsstatus im gemeinsamen Hinweis');
assert(hints(buildTrancheHistorySummary(gapped))[0][1].includes('ungeprüfte Tage')
    && !hints(buildTrancheHistorySummary(gapped))[0][1].includes('Verkürzte Messbasis'), 'Ungeprüfte Tage erzeugen keinen erfundenen verkürzten Messbeginn im Titel');

// Gemeinsamer Vermögensrenderer: Personen-/Haushaltsprojektionen folgen derselben Achsenregel.
const { renderWealthHistorySvg, wealthHistoryScale } = await import('../app/tranches/tranchen-history-svg.js');
for (const zero of [false, true]) {
    const profiles = ['a', 'b'].map((id, i) => ({ id, currentCash: 100000 + i * 12000,
        cashHistory: { version: 1, baselineValue: zero ? 0 : 100000 + i * 12000, entries: [{ date: '2026-01-02', value: 100000 + i * 12000 }] }, lots: [] }));
    for (const scope of [profiles.slice(0, 1), profiles]) {
        const source = evaluateWealthHistory({ startDate: '2026-01-01', today: '2026-01-07', profiles: scope });
        const bytes = JSON.stringify(source), svg = renderWealthHistorySvg(source), crop = wealthHistoryScale(source.points).floor > 0;
        assertEqual(crop, !zero, 'Person und Haushalt teilen dieselbe Nullstart-/Ausschnittentscheidung');
        assertEqual((svg.match(/class="history-total-area"/g) || []).length, zero ? 0 : 1, 'Eine Gesamtfläche je bekanntem Personen-/Haushaltslauf im Ausschnitt');
        assertEqual((svg.match(/class="history-area /g) || []).length, zero ? source.types.length : 0, 'Anlagenstapel ausschließlich bei Nullstart');
        const small = buildPersonHistoryHtml(source);
        assert(small.includes('history-sparkline') && !small.includes('history-day-field') && !small.includes('tabindex="0"'), 'Managerkleinverlauf bleibt eine ungebundene Sparkline');
        assertEqual(JSON.stringify(source), bytes, 'Gemeinsame Darstellung erhält Personen-/Haushaltsbytes');
    }
}

// Metadaten wandern ausschließlich in eindeutige vorhandene Infofenster.
for (const [id, title] of [['managerHouseholdHistoryInfo', 'Vermögensverlauf Haushalt'], ['managerPersonHistoryInfo-1', 'Vermögensverlauf Person A']]) {
    const bytes = JSON.stringify(personHistory), markup = buildPersonHistoryHtml(personHistory, title, null, id);
    assert(markup.includes(`aria-controls="${id}"`) && markup.includes(`id="${id}" class="ds-info-pop"`), 'Infozugang und Erklärung sind eindeutig verbunden: ' + id);
    assert(markup.includes('Messbeginn 02.01.2026 · vorläufig') && markup.includes('Messstatus: vorläufig.'), 'Tatsächliche Messbasis und Qualitätsstatus vollständig in der Erklärung');
    assert(markup.includes('Zeitraum 01.01.2026 bis 06.01.2026 · nach Entnahmen'), 'Originalzeitraum bleibt vollständig erhalten');
    assert(markup.includes('<small>Verlauf vorläufig</small>'), 'Qualitätswarnung bleibt auch bei geschlossenem Infofenster sichtbar');
    assertEqual(JSON.stringify(personHistory), bytes, 'Verlagern der Metadaten verändert keine Finanz-/Datumsprojektion');
}

{
    const hosts = ['managerHouseholdHistoryInfo', 'managerPersonHistoryInfo-1'].map(id => {
        const button = { attrs: {}, handlers: [], setAttribute(key, value) { this.attrs[key] = value; }, addEventListener(type, fn) { if (type === 'click') this.handlers.push(fn); } };
        return { id, button, dataset: {}, querySelector: () => button, contains: target => target === button, addEventListener() {} };
    });
    const doc = { querySelectorAll: () => hosts, addEventListener() {} };
    bindInfoPopovers(doc); bindInfoPopovers(doc);
    for (const host of hosts) {
        assertEqual(host.button.handlers.length, 1, 'Vorhandener Binder erzeugt einen Handler je Verlaufsinfo');
        host.button.handlers[0]();
        assertEqual(host.dataset.visible, 'true', 'Verlaufsinfo öffnet per Klick');
        host.button.handlers[0]();
        assertEqual(host.dataset.visible, 'false', 'Verlaufsinfo schließt per zweitem Klick');
    }
}
