#!/usr/bin/env node
// Echte App-Ansichten für das Handbuch; kein Bestandteil von npm test.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { chromium } from 'playwright';
import { createSuiteServer } from './serve.mjs';
import { IMAGE_FILES } from './docs-pruefen.mjs';
import { STARTUP_PRICE_SESSION_KEY } from '../app/tranches/tranchen-startup-prices.js';
import { syntheticQuote, syntheticAnnualQuote } from '../app/shared/probelauf-prices.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { calculateBudgetExamples, HANDBOOK_BUDGET_CAPTURES, renderHandbookBudgetExamples } from './jahresbudget-beispiele.mjs';
import { replaceGenerated } from './jahresbudget-parameter.mjs';
import { capturePH1B } from './ph1b-bilder.mjs';
import { captureGV2 } from './gv2-kontakt.mjs';
import { captureMH3 } from './mh3-bilder.mjs';
import { captureWT1 } from './wt1-bilder.mjs';
import { captureRD1 } from './rd1-bilder.mjs';
import { captureLY1 } from './ly1-bilder.mjs';
import { captureFJ2 } from './fj2-bilder.mjs';
import { captureBP2 } from './bp2-bilder.mjs';
import { captureMH2 } from './mh2-bilder.mjs';
import { captureSPK1 } from './spk1-bilder.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const viewport = { width: 1920, height: 1080 };
const reviewRoot = process.env.DOCS_REVIEW_DIR || path.join(root, 'auftrag');
const household = 'Max und Erika Mustermann';
const seed = 12345;
const maskDate = '2026-10-20';
const monthDate = '2026-11-10';
const yearDate = '2027-01-02';
const budgetImageFiles = HANDBOOK_BUDGET_CAPTURES.map(item => `docs/ui/${item.name}.png`);
const allImageFiles = [...IMAGE_FILES, ...budgetImageFiles];
// Echtes „heute“ vor allen Testdaten: Ein Testdatum gleich heute gilt im Spielbereich als „Stand heute“ ohne Spielkurse.
const realToday = '2026-10-15';
const captions = [
    'Auf der Übersicht steht, was als Nächstes ansteht.',
    'Haushalt & Plan zeigt zuerst den Bedarf; Partnerschaft und Todesfall ist darunter zugeklappt.',
    'Max zeigt Einkünfte mit einer einmaligen Rückzahlung von 50.000 €.',
    'Erika geht später in Rente als Max.',
    'Der Verlauf fasst das Haushaltsvermögen zusammen.',
    'Max’ Vermögen lässt sich einzeln verfolgen.',
    'Erikas Vermögen ist einzeln sichtbar.',
    'Rendite und Risiko sowie Monatsrenditen zeigen Anlagen ohne Tagesgeld.',
    'Die Jahresübersicht zeigt Anfangsstand, Käufe, Verkäufe, Markt und Endstand sowie die Rendite.',
    'Ausgaben zeigt Monats- und Jahreswerte.',
    'Überblick zeigt Beschluss, Vorschau und Reserven heute und nach Umsetzung.',
    'Bedarf & Strategie zeigt die Bedarfswerte; Alle Parameter fasst die Planwerte zusammen und ist zugeklappt.',
    'Diagnose erklärt die Empfehlung.',
    'Ergebnis zeigt Backtest und MC.',
    'Die Planübersicht zeigt den gewählten Monat über den Jahreswerten.',
    'Was im Lauf auffällt zeigt drei Backtest-Karten und Jahreslinks; Weitere bleibt geschlossen.',
    'Simulation, Zeitraum & Daten und Stresstest stehen in Einstellungen; „Maximale Dauer“ ist leer und nennt die automatische Dauer; Erweitert zeigt die technischen Optionen.',
    'Überblick zeigt den Musterlauf.',
    'Die Verteilung macht die Streuung sichtbar.',
    'Pflege zeigt das Modellrisiko.',
    'Pfade vergleichen zeigt P10, Median und P90 mit Gesamtanteilen und Kennzahlen der Einzelpfade.',
    'Drei Werkzeuge stehen in der Werkstatt bereit.',
    'Replay zeigt die Pfadeingaben.',
    'Parameter-Sweep zeigt die Eingaben.',
    'Auto-Optimize zeigt die Sucheingaben.',
    'Der Datenstatus steht in Daten & Sicherung.',
    'Wiederherstellungspunkte sind nach Anlass gruppiert und zeigen je eine Grundzeile; einzeln löschbare Personenpunkte nennen „Bleibt, bis du ihn selbst löschst“.',
    'Das Band kennzeichnet Spielkurse mit Testdatum; Ein Jahr durchspielen steht links von Spielbereich beenden.',
    'Eine Kopie ohne Datumssprung zeigt beim Beenden den Vergleich Echt / Spielbereich.',
    'Die Startseite zeigt die Aufgaben im aktuellen Handbuch.',
    'Die Übersicht bietet den Oktoberabschluss an.',
    'Der Reiter Kurse zeigt Kursstand und Tranchen-Tabelle nebeneinander.',
    'Der Reiter Ausgaben zeigt Personenkarten und die offene Kategorie-Tabelle.',
    'Drei Kacheln zeigen Ausgaben, Monatsbudget und Abweichung.',
    'Der Reiter Tagesgeld zeigt Personen nebeneinander und den Monatsbetrag darunter.',
    'Das Ergebnis zeigt links das Monatsbudget und rechts Kacheln und Herleitung ohne Reiter.',
    'Die Übersicht bietet den Jahresabschluss an.',
    'Der Reiter Kurse zeigt Kursstand und Tranchen-Tabelle nebeneinander.',
    'Der Reiter Ausgaben Dezember zeigt Personenkarten und die offene Kategorie-Tabelle.',
    'Der Reiter Budgetvergleich zeigt links Dezember und rechts das Jahr.',
    'Der Reiter Tagesgeld 31.12. zeigt die Jahresendstände nebeneinander.',
    'Der Reiter Marktdaten zeigt die Jahreswerte; das Jahreshoch erscheint nur bei einem verdeckten Bärenmarkt, dann mit Wahl im Reiter Plan.',
    'Der Reiter Pflegewerte zeigt Pflegegeld, Heim-Eigenanteil sowie Staffel, Deckel und eigene Ausgaben bereits fortgeschrieben.',
    'Der Reiter Plan 2027 zeigt Bedarf links; rechts stehen der Stand des Plans 2026 und das Monatsbudget.',
    'Das Ergebnis zeigt links „Was zu tun ist“ und das Monatsbudget, rechts Kacheln, den Stand des alten Plans und Herleitungen ohne Reiter.',
    'Sophie spart mit ihrem Gehalt an; die Rente beginnt im Januar 2038.',
    'Einkünfte geöffnet: Rente, feste und einmalige Einkunft mit einheitlichen Feldern.',
    'Einkünfte geschlossen: Die Zusammenfassung nennt Beträge und Zeiträume.',
    'Geplante Ausgaben geöffnet: Ratenkredit und Auto außerhalb von Grundbedarf und Flex.',
    'Geplante Ausgaben geschlossen: Die Zusammenfassung nennt die geplanten Zahlungen.',
    'Balance zeigt die geplanten Posten des Planjahres mit Monat und Vorzeichen.',
    'Beim Ausgabenimport wird die bezahlte geplante Ausgabe außerhalb des Monatsbudgets zugeordnet.',
    'Backtest-Protokoll: Das Einnahmen-ⓘ der ersten Jahreszeile zeigt Rente, sonstige und einmalige Einkünfte.',
    'Backtest-Protokoll: Detailliert zeigt die Einzelbeträge.',
    'Monte-Carlo-Protokoll: Das Ausgaben-ⓘ im Autojahr zeigt Grundbedarf, Flex, Geplante Ausgaben (Auto), Summe und davon aus dem Vermögen bezahlt.',
    'Monte-Carlo-Protokoll: Detailliert zeigt die Einzelbeträge.',
    'Tagesgeld lässt sich direkt in der Vermögenskarte bearbeiten.',
    'Max Mustermann im Spielbereich: Pflegegrad 2, angenommener langsamerer Verlauf und automatisch gerechnetes Pflegegeld.',
    'Nicht verheiratet: Erika erbt Immobilien und Steuergeld von Max, zusätzlich 0 % vom übrigen Geldvermögen.',
    'Max: Haus 450.000 € und vermietete Wohnung 210.000 € mit 650 € Nettomiete pro Monat.',
    'Nicht verheiratet: Erbanteile und gesperrte Rentenfelder; Grundbedarf, Wunsch- und Mindest-Flex bleiben einstellbar.',
    'Verheiratet: Erika erbt 50 % von Max, Klasse I mit steuerfreiem Familienheim.',
    'Vergleich: Wunschbudget +300 €/Monat, 1.000 gepaarte Läufe je Plan bei Einstellung 10.000, Seed 12345.',
    'Zielwertsuche: 1.000 gepaarte Läufe je Schritt, Endprobe mit 10.000 Läufen, Seed 12345; unbestätigter Fund wird gekennzeichnet.',
    'Personen & Vermögen › Pflege: Annahmen für spätere Pflege, „Pflege im Heim“ aufgeklappt mit den drei Bestandteilen als Felder, die übrigen Zeilen zugeklappt mit ihren Werten.',
    'Erfasste Vermögensstände aufgeklappt: Zeilenkopf mit Anzahl und letztem Datum, darunter die Tabelle im Kasten.',
    'Erika übernimmt die Rentenanpassung von Max; der Grund steht unter der Rente.',
    'Unter „Alle Parameter“ steht die Karte „Fondskosten“ mit „Laufende Kosten Aktien-ETF“ in % pro Jahr.',
    'Max mit Rentenanpassung „wie Löhne“; darunter steht der Hinweis zur Lohnreihe.',
    'Haushalt & Plan › Weitere Planwerte: Karte „Fondskosten“ mit „Laufende Kosten Aktien-ETF“, vorbelegt mit 0,5 % pro Jahr.'
];

// Verlustfrei: nur den vorhandenen PNG-Datenstrom mit zlib Level 9 neu packen.
function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
    const chunk = Buffer.alloc(data.length + 12);
    chunk.writeUInt32BE(data.length); chunk.write(type, 4); data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
    return chunk;
}
function compressPng(buffer) {
    const before = [], after = [], streams = [];
    let hadData = false;
    for (let offset = 8; offset < buffer.length;) {
        const size = buffer.readUInt32BE(offset), end = offset + size + 12;
        if (buffer.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
            streams.push(buffer.subarray(offset + 8, end - 4)); hadData = true;
        } else (hadData ? after : before).push(buffer.subarray(offset, end));
        offset = end;
    }
    const compressed = deflateSync(inflateSync(Buffer.concat(streams)), { level: 9 });
    const result = Buffer.concat([buffer.subarray(0, 8), ...before, pngChunk('IDAT', compressed), ...after]);
    return result.length < buffer.length ? result : buffer;
}

async function poll(page, predicate, arg, description, timeout = 30000) {
    const deadline = Date.now() + timeout;
    // Async-Prädikate ausdrücklich auswerten; waitForFunction wartet nicht auf sie.
    while (!await page.evaluate(predicate, arg)) {
        if (Date.now() > deadline) throw new Error(`${description}: nach ${timeout / 1000} Sekunden nicht bereit.`);
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}
async function ready(page, date) {
    await poll(page, async date => {
        const { whenProfileDisplayReady } = await import('./app/profile/profile-navigation.js');
        const { getProbelaufController } = await import('./app/shared/probelauf-state.js');
        const { getPageNavigationGuard } = await import('./app/shared/navigation-guard-dialog.js');
        const { localCalendarDate, appNow } = await import('./app/shared/app-clock.js');
        if (!await whenProfileDisplayReady(document)) return false;
        const controller = getProbelaufController(document), guard = getPageNavigationGuard(document, window);
        return controller?.state?.phase === 'active' && (controller.state.testDate === date || controller.state.testDate === null && localCalendarDate(appNow()) === date)
            && localCalendarDate(appNow()) === date && !controller.busy && !controller.blocked
            && !guard.isBusy() && !guard.reasons().some(reason => ['commit', 'running'].includes(reason.phase));
    }, date, `Spielbereich ${date}`);
    await page.evaluate(async () => {
        await (await import('./app/shared/persistence-facade.js')).PersistenceFacade.flush();
        await document.fonts.ready;
    });
}
async function reloadDate(page, action, date) {
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), action()]);
    await page.clock.setFixedTime(new Date(`${date}T12:00:00+01:00`));
    await ready(page, date);
}

async function newProbelauf(browser, baseUrl, date, source = 'demo', householdId = 'max-erika', variantId = 'grund') {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1,
        locale: 'de-DE', timezoneId: 'Europe/Berlin', colorScheme: 'light', serviceWorkers: 'block' });
    try {
        // Nur die Startkursabfrage vor dem Mustermann-Start überspringen; keine Fachrecords setzen.
        await context.addInitScript(key => {
            if (location.protocol === 'about:') return;
            if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify({
                status: 'empty', updated: 0, retrievedAt: 1792490400000, results: []
            }));
        }, STARTUP_PRICE_SESSION_KEY);
        await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin === baseUrl) { await route.continue(); return; }
            // Lokale, feste Marktdaten nach dem Vorbild der Browser-Smokes.
            if (url.hostname === '127.0.0.1' && url.port === '8787') {
                const symbol = String(url.searchParams.get('symbol') || url.searchParams.get('q') || 'VWCE.DE').toUpperCase();
                if (url.pathname === '/search') await route.fulfill({ json: { quotes: [{ symbol }] } });
                else if (url.pathname === '/quote') await route.fulfill({ json: syntheticQuote(symbol, date) });
                else if (url.pathname === '/chart') {
                    const quote = syntheticAnnualQuote(symbol, 2026, yearDate);
                    await route.fulfill({ json: { chart: { error: null, result: [{ meta: {
                        symbol, currency: 'EUR', exchangeTimezoneName: 'Europe/Berlin'
                    }, timestamp: [Date.parse('2026-12-30T12:00:00Z') / 1000],
                    indicators: { quote: [{ close: [quote.price] }] } }] } } });
                } else throw new Error(`Unbekannter lokaler Marktdatenweg: ${url.pathname}`);
            } else if (url.hostname === 'data-api.ecb.europa.eu') await route.fulfill({ json: {} });
            else if (url.hostname === 'api.worldbank.org') await route.fulfill({ json: [{ lastupdated: '2027-01-02' }, [{
                indicator: { id: 'FP.CPI.TOTL.ZG' }, countryiso3code: 'DEU', date: '2026', value: 2
            }]] });
            else if (url.hostname === 'r.jina.ai') await route.fulfill({ contentType: 'text/plain', body: '2027.01 100 25.5' });
            else await route.abort('blockedbyclient');
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', async dialog => { errors.push(`Unerwarteter nativer Dialog: ${dialog.message()}`); await dialog.dismiss(); });
        await page.clock.setFixedTime(new Date(`${realToday}T12:00:00+02:00`));
        if (source === 'copy') await context.addInitScript(records => {
            if (localStorage.getItem('docs_comparison_seeded')) return;
            for (const [key, value] of Object.entries(records)) localStorage.setItem(key, value);
            localStorage.setItem('docs_comparison_seeded', 'true');
        }, createMusterHaushaltRecords(date));
        await page.goto(`${baseUrl}/index.html`);
        await page.locator('#probelaufStart:enabled').waitFor();
        await page.locator('#probelaufStart').click();
        const dialog = page.locator('[data-probelauf-dialog]');
        await dialog.locator(`[data-probelauf-source="${source === 'demo' ? householdId : source}"]`).click();
        if (variantId !== 'grund') await dialog.locator(`[data-muster-variant="${variantId}"]`).click();
        if (source !== 'copy' || date !== realToday) {
            await dialog.getByLabel('Spielkurse', { exact: true }).check();
            await dialog.getByLabel('Testdatum', { exact: true }).fill(date);
        } else await dialog.getByLabel('Echte Kurse von heute', { exact: true }).check();
        await reloadDate(page, () => dialog.getByRole('button', { name: 'Spielbereich starten', exact: true }).click(), date);
        return { context, page, errors, household: householdId === 'sophie' ? 'Sophie Mustermann' : household };
    } catch (error) { await context.close(); throw error; }
}

// Normalbetrieb nur in einem frischen Kontext mit erfundenem Bestand, ohne Spielbereich.
async function newNormalSession(browser, baseUrl, date) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1,
        locale: 'de-DE', timezoneId: 'Europe/Berlin', colorScheme: 'light', serviceWorkers: 'block' });
    try {
        await context.addInitScript(records => {
            if (location.protocol !== 'http:' || localStorage.getItem('docs_normal_seeded')) return;
            for (const [key, value] of Object.entries(records)) localStorage.setItem(key, value);
            localStorage.setItem('docs_normal_seeded', 'true');
        }, createMusterHaushaltRecords(date));
        await context.route('**/*', route => new URL(route.request().url()).origin === baseUrl ? route.continue() : route.abort());
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.clock.setFixedTime(new Date(`${date}T12:00:00+02:00`));
        const ready = async () => {
            await page.evaluate(async () => {
                await (await import('/app/profile/profile-navigation.js')).whenProfileDisplayReady(document);
                await document.fonts.ready;
            });
            await page.waitForFunction(() => document.documentElement.dataset.dataReady === 'true');
        };
        await page.goto(`${baseUrl}/Daten-Sicherung.html`);
        await ready();
        return { context, page, errors, household, ready };
    } catch (error) { await context.close(); throw error; }
}

async function captureGV1(browser, baseUrl, goto) {
    const date = '2026-10-23';
    const output = name => path.join(root, `auftrag/GV-1-pruefbild-${name}.png`);
    async function compose(buffers, file) {
        const sheet = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
        try {
            await sheet.setContent(`<body style="margin:0;background:#fff">${buffers.map(buffer => `<img style="display:block;width:1920px" src="data:image/png;base64,${buffer.toString('base64')}">`).join('')}</body>`);
            await sheet.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
            await sheet.screenshot({ path: file, fullPage: true, animations: 'disabled' });
        } finally { await sheet.close(); }
    }
    for (const withHomes of [true, false]) {
        const session = await newProbelauf(browser, baseUrl, date, 'demo', 'max-erika', withHomes ? 'immobilien' : 'grund');
        try {
            const { page } = session;
            await goto(session, 'index.html', date);
            await page.evaluate(async () => document.fonts.ready);
            await page.screenshot({ path: output(withHomes ? 'uebersicht' : 'ohne'), fullPage: true, animations: 'disabled' });
            if (!withHomes) continue;
            await page.locator('#overviewAssetHelp .ds-info-button').click();
            const overviewInfo = await page.screenshot({ animations: 'disabled' });
            await goto(session, 'Simulator.html', date);
            await tab(page, 'montecarlo');
            await page.locator('#mcSettingsToggle').click();
            await page.locator('#mcAnzahl').fill('128');
            await page.locator('#mcSeed').fill(String(seed));
            await page.locator('#mcSeed').blur();
            await page.locator('#mcSettingsToggle').click();
            await page.locator('#mcButton').click();
            await poll(page, () => !document.querySelector('#mcButton')?.disabled && !document.querySelector('#exportMonteCarloRunJson')?.disabled,
                null, 'GV-1 Monte Carlo', 60000);
            await page.locator('[data-mc-view="overview"]').click();
            const mc = await page.locator('#monteCarloSummary').screenshot({ animations: 'disabled' });
            await tab(page, 'ergebnis');
            const overview = await page.screenshot({ animations: 'disabled' });
            await compose([overview, mc], output('simulator'));
            await tab(page, 'montecarlo');
            await page.locator('[data-mc-view="logs"]').click();
            await openProtocols(page);
            const table = page.locator('#scenarioLogOutput');
            await table.evaluate(node => { node.scrollLeft = node.scrollWidth; node.scrollTop = 0; node.scrollIntoView({ block: 'start' }); });
            const info = table.locator('tbody tr').first().locator('.ds-info-button[aria-label="Aufteilung des Vermögens"]').last();
            await info.click();
            await compose([overviewInfo, await page.screenshot({ animations: 'disabled' })], output('aufteilung'));
            if (session.errors.length) throw new Error(session.errors.join('\n'));
            console.log('GV-1: Max/Erika mit Haus und Mietwohnung sowie ohne Immobilie; Übersicht, Simulator und beide geöffneten Aufteilungen aufgenommen.');
        } finally { await session.context.close(); }
    }
}

async function captureVF2L(browser, baseUrl, goto) {
    for (const withHome of [true, false]) {
        const session = await newProbelauf(browser, baseUrl, '2026-10-23', 'demo', 'renate', 'klein');
        try {
            const { page } = session;
            if (withHome) {
                await goto(session, 'depot-tranchen-manager.html', '2026-10-23');
                await page.locator('#managerSectionNav [data-manager-profile="muster_renate"]').click();
                await page.locator('[data-home-action="add"]').click();
                await page.locator('#home-bezeichnung').fill('Wohnung');
                await page.locator('#home-wert').fill('180000');
                await page.locator('#home-stand').fill('10.2026');
                await page.locator('[data-home-action="save"]').click();
                await poll(page, () => document.querySelector('#tranchePersistenceStatus')?.textContent === 'Profilwerte dauerhaft gespeichert.', null, 'Wohnung speichern');
            }
            await goto(session, 'Simulator.html', '2026-10-23');
            await tab(page, 'montecarlo');
            await page.locator('#mcSettingsToggle').click();
            await page.locator('#mcAnzahl').fill('128');
            await page.locator('#mcSeed').fill(String(seed));
            await page.locator('#mcSeed').blur();
            await page.locator('#mcSettingsToggle').click();
            await page.locator('#mcButton').click();
            await poll(page, () => !document.querySelector('#mcButton')?.disabled && !document.querySelector('#exportMonteCarloRunJson')?.disabled,
                null, 'VF-2l Monte Carlo', 60000);
            await page.locator('[data-mc-view="logs"]').click();
            let saleYear;
            if (withHome) {
                const cards = page.locator('#scenarioComparison [data-scenario-id]');
                for (let index = 0; index < await cards.count(); index++) {
                    await cards.nth(index).click();
                    saleYear = await page.evaluate(() => window.globalCurrentScenarioData?.rows.find(row => row.immobilienverkauf > 0)?.jahr);
                    if (saleYear) break;
                }
                if (!saleYear) throw new Error('VF-2l: kein Pfad mit Wohnungsverkauf gefunden.');
            }
            await openProtocols(page);
            const headers = await page.locator('#scenarioLogOutput thead [data-protocol-column]').allTextContents();
            if (!headers.some(text => text.includes('Geldvermögen')) || headers.some(text => text.includes('Gesamtvermögen')) !== withHome
                || await page.locator('#scenarioLogOutput thead [data-protocol-column="home-value"]').count() !== Number(withHome)) {
                throw new Error('VF-2l: Jahresendspalten passen nicht zum Immobilienbestand.');
            }
            await page.evaluate(async () => document.fonts.ready);
            await openProtocols(page);
            const output = page.locator('#scenarioLogOutput');
            await output.evaluate((node, year) => {
                const table = node.querySelector('table');
                const sale = year ? node.querySelector(`#scenario-year-${year}`) : null;
                // Nur den sichtbaren Tabellenausschnitt wählen; Daten und DOM bleiben erhalten.
                node.scrollLeft = node.scrollWidth;
                if (sale) node.scrollTop = Math.max(0, sale.offsetTop - table.tHead.offsetHeight - 70);
                node.scrollIntoView({ block: 'start' });
            }, saleYear);
            await page.mouse.move(1910, 1070);
            const box = await output.boundingBox();
            const clip = { x: Math.floor(box.x), y: Math.max(0, Math.floor(box.y)),
                width: Math.floor(box.width), height: Math.min(650, Math.floor(box.height), 1080 - Math.max(0, Math.floor(box.y))) };
            await page.screenshot({ path: path.join(root, `auftrag/VF-2l-pruefbild-${withHome ? 'mc' : 'ohne'}.png`), clip, animations: 'disabled' });
            if (session.errors.length) throw new Error(session.errors.join('\n'));
            console.log(`VF-2l: Renate · ${withHome ? `Wohnung, Verkauf im Jahr ${saleYear}` : 'ohne Immobilie'} · Jahresendspalten geprüft`);
        } finally { await session.context.close(); }
    }
}

async function captureET1(browser, baseUrl, goto) {
    const date = '2026-10-23', session = await newProbelauf(browser, baseUrl, date, 'demo', 'martin-petra', 'testament');
    try {
        const { page } = session;
        await goto(session, 'depot-tranchen-manager.html', date);
        await page.locator('#managerSectionNav [data-manager-view="plan"]').click();
        await page.locator('#managerPartnershipToggle').click();
        await page.locator('#inheritance-min-0').waitFor({ state: 'visible' });
        if (await page.locator('#inheritance-home-0').inputValue() !== 'residence') throw new Error('ET-1: Variante Testament fehlt.');
        const saved = () => poll(page, () => document.querySelector('#managerPartnershipStatus').textContent === 'Gespeichert', null, 'ET-1 Testament speichern').catch(async error => { console.log(await page.locator('#managerPartnership').innerText()); throw error; });
        await page.locator('#inheritance-min-0').fill('250000'); await page.locator('#inheritance-min-0').press('Enter'); await saved();
        await page.locator('#inheritance-max-0').fill('101');
        if (await page.locator('#inheritance-max-0').getAttribute('aria-invalid') !== 'true') throw new Error('ET-1: ungültiger Höchstanteil nicht erkannt.');
        await page.locator('#inheritance-max-0').fill('50'); await page.locator('#inheritance-max-0').press('Enter'); await saved();
        await page.locator('#inheritance-home-0').selectOption('life-estate'); await saved();
        await goto(session, 'depot-tranchen-manager.html', date);
        await page.locator('#managerSectionNav [data-manager-view="plan"]').click();
        await page.locator('#managerPartnershipToggle').click();
        if (await page.locator('#inheritance-min-0').inputValue() !== '250.000'
            || await page.locator('#inheritance-home-0').inputValue() !== 'life-estate') throw new Error('ET-1: Testamentangaben nach Reload verloren.');
        await page.locator('#inheritance-min-0').fill('200000'); await page.locator('#inheritance-min-0').press('Enter'); await saved();
        await page.locator('#inheritance-home-0').selectOption('residence'); await saved();
        await page.locator('#managerPartnership').screenshot({ path: path.join(reviewRoot, 'ET-1-pruefbild-karte.png'), animations: 'disabled' });
        await goto(session, 'Simulator.html', date);
        await tab(page, 'montecarlo');
        await page.locator('#mcSettingsToggle').click();
        await page.locator('#mcAnzahl').fill('128');
        await page.locator('#mcSeed').fill(String(seed)); await page.locator('#mcSeed').blur();
        await page.locator('#mcSettingsToggle').click(); await page.locator('#mcButton').click();
        await poll(page, () => !document.querySelector('#mcButton')?.disabled && !document.querySelector('#exportMonteCarloRunJson')?.disabled,
            null, 'ET-1 Monte Carlo', 60000);
        await page.locator('[data-mc-view="logs"]').click();
        const cards = page.locator('#scenarioComparison [data-scenario-id]');
        let deathYear;
        for (let index = 0; index < await cards.count(); index++) {
            await cards.nth(index).click();
            deathYear = await page.evaluate(() => window.globalCurrentScenarioData?.rows.find(row => row.inheritance?.deceasedProfileId === 'muster_martin')?.jahr);
            if (deathYear) break;
        }
        if (!deathYear) throw new Error('ET-1: kein Protokoll mit Martins Tod gefunden.');
        await openProtocols(page);
        const output = page.locator('#scenarioLogOutput');
        for (const id of ['total', 'home-value', 'total-with-homes']) await output.locator(`thead [data-protocol-column="${id}"]`).waitFor();
        await output.evaluate((node, year) => {
            node.scrollLeft = node.scrollWidth;
            const row = node.querySelector(`#scenario-year-${year}`);
            node.scrollTop = Math.max(0, row.offsetTop - node.querySelector('thead').offsetHeight - 70);
            node.scrollIntoView({ block: 'start' });
        }, deathYear);
        await page.mouse.move(1910, 1070);
        await output.screenshot({ path: path.join(reviewRoot, 'ET-1-pruefbild-protokoll.png'), animations: 'disabled' });
        if (session.errors.length) throw new Error(session.errors.join('\n'));
        console.log(`ET-1: Testament · Karte und Todesjahr ${deathYear} mit Geldvermögen/Immobilien/Gesamtvermögen geprüft`);
    } finally { await session.context.close(); }
}

async function captureET2(browser, baseUrl, goto) {
    const date = '2026-10-23', session = await newProbelauf(browser, baseUrl, date, 'demo', 'martin-petra', 'testament');
    try {
        const { page } = session;
        await goto(session, 'depot-tranchen-manager.html', date);
        await page.locator('#managerSectionNav [data-manager-view="plan"]').click();
        await page.locator('#managerPartnershipToggle').click();
        await page.locator('#inheritance-min-0').waitFor({ state: 'visible' });
        if (await page.locator('#inheritance-home-0').inputValue() !== 'residence') throw new Error('ET-2: Variante Testament fehlt.');
        const saved = () => poll(page, () => document.querySelector('#managerPartnershipStatus').textContent === 'Gespeichert', null, 'ET-2 Testament speichern').catch(async error => { console.log(await page.locator('#managerPartnership').innerText()); throw error; });
        await page.locator('#inheritance-residence-tax-0').selectOption('annual'); await saved();
        if (!await page.locator('#managerInheritance').innerText().then(text => text.includes('solange das Wohnrecht besteht') && text.includes('bei Wahl ‚sofort‘:'))) throw new Error('ET-2: Vergleichsvorschau fehlt.');
        await page.locator('#managerPartnership').screenshot({ path: path.join(reviewRoot, 'ET-2-pruefbild-karte.png'), animations: 'disabled' });
        await goto(session, 'Simulator.html', date);
        await tab(page, 'montecarlo');
        await page.locator('#mcSettingsToggle').click();
        await page.locator('#mcAnzahl').fill('128');
        await page.locator('#mcSeed').fill(String(seed)); await page.locator('#mcSeed').blur();
        await page.locator('#mcSettingsToggle').click(); await page.locator('#mcButton').click();
        await poll(page, () => !document.querySelector('#mcButton')?.disabled && !document.querySelector('#exportMonteCarloRunJson')?.disabled,
            null, 'ET-2 Monte Carlo', 60000);
        await page.locator('[data-mc-view="logs"]').click();
        const cards = page.locator('#scenarioComparison [data-scenario-id]');
        let deathYear;
        for (let index = 0; index < await cards.count(); index++) {
            await cards.nth(index).click();
            deathYear = await page.evaluate(() => { const rows = window.globalCurrentScenarioData?.rows || []; const death = rows.find(row => row.inheritance?.deceasedProfileId === 'muster_martin'); return death && rows.some(row => row.jahr === death.jahr + 1 && row.wohnrechtsteuer > 0) ? death.jahr : null; });
            if (deathYear) break;
        }
        if (!deathYear) throw new Error('ET-2: kein Protokoll mit Martins Tod gefunden.');
        await openProtocols(page);
        const output = page.locator('#scenarioLogOutput');
        for (const id of ['inheritance-tax', 'residence-tax']) await output.locator(`thead [data-protocol-column="${id}"]`).waitFor();
        await output.evaluate((node, year) => {
            const cell = node.querySelector('thead [data-protocol-column="residence-tax"]');
            node.scrollLeft = Math.max(0, cell.offsetLeft - 700);
            const row = node.querySelector(`#scenario-year-${year}`);
            node.scrollTop = Math.max(0, row.offsetTop - node.querySelector('thead').offsetHeight - 70);
            node.scrollIntoView({ block: 'start' });
        }, deathYear);
        await page.mouse.move(1910, 1070);
        await output.screenshot({ path: path.join(reviewRoot, 'ET-2-pruefbild-protokoll.png'), animations: 'disabled' });
        if (session.errors.length) throw new Error(session.errors.join('\n'));
        console.log(`ET-2: Testament · Karte und Todesjahr ${deathYear} und Folgejahr mit Steuer Wohnrecht (§ 23) geprüft`);
    } finally { await session.context.close(); }
}

async function changeDate(page, date) {
    await page.locator('#probelaufBand [data-probelauf-action="date"]').click();
    const dialog = page.locator('[data-probelauf-dialog]');
    await dialog.getByLabel('Testdatum').fill(date);
    await reloadDate(page, () => dialog.getByRole('button', { name: 'Datum übernehmen', exact: true }).click(), date);
}
// SE-2: Backtest- und Szenario-Protokoll stehen zugeklappt; Protokollbilder zeigen sie aufgeklappt.
async function openProtocols(page) {
    await page.evaluate(() => document.querySelectorAll('#backtestProtocolDisclosure, #scenarioProtocolDisclosure').forEach(node => { node.open = true; }));
}
async function tab(page, value) {
    await page.locator(`.tab-btn[data-tab="${value}"]`).click();
    await page.locator(`#tab-${value}`).waitFor({ state: 'visible' });
}
async function importExample(page, dialog) {
    await dialog.locator('[data-overview-example="all"]').click();
    await page.locator('#expensesImportPreview').waitFor({ state: 'visible' });
    await page.locator('[data-expenses-preview-accept]').click();
    await page.locator('#expensesImportPreview').waitFor({ state: 'hidden' });
}

const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function flowHtml(name, title, intro, images) {
    return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Muster-Haushalt</title>
<style>body{margin:0;background:#f4f2ed;color:#253329;font:18px/1.5 system-ui,sans-serif}main{max-width:1360px;margin:auto;padding:32px}a{color:#285e46}figure{margin:32px 0;padding:16px;background:white;border:1px solid #d5dbd4;border-radius:12px}img{display:block;width:100%;height:auto}figcaption{padding-top:12px}nav{display:flex;gap:24px;flex-wrap:wrap}</style></head>
<body><main><nav><a href="README.md">Bildverzeichnis</a><a href="${name === 'monatsabschluss' ? 'jahresabschluss' : 'monatsabschluss'}.html">${name === 'monatsabschluss' ? 'Jahr' : 'Monat'} abschließen</a><a href="../../Handbuch.html">Handbuch</a></nav>
<h1>${title}</h1><p>${intro}</p><p>Alle Werte stammen aus dem Muster-Haushalt mit Max und Erika Mustermann. Die Bilder zeigen synthetische Daten.</p>
${images.map((item, index) => `<figure id="schritt-${index + 1}"><img src="${item.path.replace('docs/ui/', '')}" width="${item.width}" height="${item.height}" alt="${escapeHtml(item.caption)}"><figcaption>${index + 1}. ${escapeHtml(item.caption)}</figcaption></figure>`).join('\n')}
</main></body></html>
`;
}
function readme(images) {
    return `# App-Bilder

Die Bilder zeigen Max und Erika Mustermann sowie Sophie Mustermann mit synthetischen Daten. Öffne [Monat abschließen](monatsabschluss.html) oder [Jahr abschließen](jahresabschluss.html), um den Ablauf Schritt für Schritt anzusehen. Beide Bildfolgen laufen offline.

## Bilder erneuern

Mit \`npm run docs:bilder -- --ph1b\` erneuerst du daten-sicherung und daten-sicherung-punkte im Normalbetrieb außerhalb des Spielbereichs. Ein frischer Browserkontext enthält nur den synthetischen Musterhaushalt. Die fünf über App-Funktionen angelegten Punkte aus drei Anlässen sind zurückholbar. Die drei PH-1b-Prüfbilder zeigen die gruppierte Liste, die Drei-Personen-Vorschau und das gesperrte letzte Haushalts-Häkchen. Der Lauf misst auch den Textplatz der Kirchensteuer-Auswahl bei 1366, 1920 und 2560 Pixeln in Plan und beiden Versuchsarten. Alle Aufnahmen verwenden isolierte synthetische Sitzungen.

Mit \`npm run docs:bilder -- --km1\` erzeugst du die neun KM-1-Prüfbilder mit Testdatum 23.10.2026 unter auftrag/. Sie zeigen Budget, Bedarf, Personen, Partnerschaft und den Protokollkopf. Das Budget wird auch bei 2560×1440 aufgenommen; die übrigen Bilder verwenden 1920×1080. Die Personenaufnahme prüft getönte Gruppen und weiße Eingabefelder. Das Protokoll verwendet 2.000 Pfade und Seed 12345. Ein zusätzliches Medianbild liegt unter /tmp/.

Mit \`npm run docs:bilder -- --bd1\` erneuerst du die Balance- und Simulator-Planübersicht mit dem schmalen Monatsbalken. Fünf Prüfbilder zeigen Max und Erika mit aktiver Dynamik bei 1920×1080 und 2560×1440, geöffnete Einkünfte, Sophies Ansparjahr und die Simulator-Monatszeile. Die Dynamikwahl gilt nur in der isolierten Musterkopie.

Mit \`npm run docs:bilder -- --gf1\` erneuerst du die Balance-Übersicht und die Simulator-Planübersicht. Dazu entstehen sechs unversionierte GF-1-Prüfbilder: Entnahme mit synthetischem Pflegegeld bei 1920 und 1280 Pixeln, Sophie mit begrenztem Budget und angelegtem Überschuss, Simulator-Entnahme, Sophies Autojahr und ein synthetisches Ansparjahr. Die Musterrechnung bleibt unverändert.

Führe im Repository \`npm run docs:bilder\` aus. Du brauchst die installierten npm-Abhängigkeiten und Playwright Chromium. Fehlt der Browser, installiere ihn einmal mit \`npx playwright install chromium\`.

Das Werkzeug startet denselben lokalen Server wie \`npm run serve\`, ohne Kursproxy. Es nutzt einen freien Port und isolierte Browserkontexte für Ansichten, Monat, Jahr, Vergleich und Jahresbudget. Vorhandene Browserprofile werden nicht geöffnet. Kurse und Marktdaten stammen aus festen lokalen Stubs oder dem Spielbereich; externe Abrufe werden blockiert.

Im Startdialog wählt das Werkzeug „Max und Erika“ und den Kursmodus „Testdatum wählen“, trägt das Datum ein und bestätigt mit „Spielbereich starten“. Die Ansichten verwenden den 20.10.2026. Für Oktober springt der Spielbereich vom 20.10. auf den 10.11.2026. Für den Jahresabschluss springt ein eigener Spielbereich vom 15.12.2026 auf den 02.01.2027. Der Simulator rechnet einmal 10.000 Monte-Carlo-Läufe mit Seed 12345; die Werkstatt zeigt Eingaben. Die Backtestaufnahme zeigt „Was im Lauf auffällt“ mit drei Karten und geschlossenem „Weitere“. Die Aufnahme aus Szenario-Logs zeigt „Pfade vergleichen“ mit P10, Median und P90. Die Aufnahme Vergleich verwendet eine eigene Mustersitzung mit Wunschbudget +300 €/Monat, 1.000 gepaarten Läufen je Plan bei Einstellung 10.000 und Seed 12345. Das Werkzeug rechnet außerdem eine einmalige Ausgabe, eine verschobene Rente und die Zielwertsuche mit beiden Grenzen (98 % Grundbedarfsdeckung, höchstens 10 % Läufe mit Jahren unter Mindest-Flex). Es schreibt die drei VG-1-Prüfbilder und ZW-1b-pruefbild.png unter auftrag/. Das Zielwertbild nutzt 1.000 Läufe je Schritt und eine Endprobe mit 10.000 Läufen, Seed 12345. Hält keine Endprobenstufe, zeigt es den schnellen Fund als unbestätigt.

Mit \`npm run docs:bilder -- --spielbereich\` erneuerst du Band und Vergleich und behältst die übrigen Aufnahmen. Das Band zeigt den Zeitraffer links von Spielbereich beenden. Bei Max und Erika prüft das Werkzeug danach die kurze Beenden-Bestätigung ohne Vergleich und Übernehmen. Für das Vergleichsbild legt es Max und Erika als erfundenen echten Bestand in einem frischen Browserkontext an, startet eine Kopie ohne Datumssprung und ändert Gold, Flex und Tagesgeld. Es öffnet keine Balance und wartet auf die frisch gerechnete Vorschau mit höherem Monatsbudget und Goldkauf.

Mit \`npm run docs:bilder -- --verlauf\` erneuerst du die drei bisherigen Verlaufsaufnahmen, zwei Bilder der Depotkennzahlen und verlauf-vermoegensstaende mit aufgeklappten erfassten Ständen. Rendite und Risiko sowie Monatsrenditen stehen in verlauf-kennzahlen; verlauf-jahresuebersicht zeigt die vollständigen Jahreskarten. Die drei neuen Karten sind zusammen höher als der Bildschirm und werden deshalb in zwei Ausschnitten aufgenommen.

Mit \`npm run docs:bilder -- --protokolle\` erneuerst du nur die vier Backtest- und Monte-Carlo-Protokollbilder. Auch der volle Bilderlauf verwendet dafür denselben Musterlauf in einer eigenen Sitzung. Er ergänzt bei Max eine Betriebsrente von 3.000 €/Monat und 50.000 € Rückzahlung sowie 2.500 € für ein Auto im Planjahr und rechnet 128 Monte-Carlo-Pfade mit Seed 12345. Die Backtest-Übersicht zeigt das geöffnete Einnahmen-ⓘ der ersten Jahreszeile. Die Monte-Carlo-Bilder verwenden einen weiteren Spielbereich mit Nicht verheiratet, geerbten Immobilien samt Steuergeld und geöffnetem Erbe-ⓘ mit positiver Steuer im Todesjahr. Dazu kommt jeweils die Detailansicht.

Mit \`npm run docs:bilder -- --pv2\` erneuerst du die Personenbilder von Max und Erika, die Vermögenskarte mit bearbeitetem Tagesgeld und die Simulator-Annahmen. Die Aufnahmen verwenden nur einen frischen Muster-Spielbereich.

Mit \`npm run docs:bilder -- --up1b\` erneuerst du die beiden Monte-Carlo-Protokollbilder. Ein eigener Muster-Spielbereich rechnet Nicht verheiratet mit Immobilien und Steuergeld, zusätzlich 0 % vom übrigen Geldvermögen, und 128 Pfaden (Seed 12345). Im Todesjahr ist das Erbe-ⓘ geöffnet; Detailliert zeigt An Erben und Erbschaftsteuer. Das Prüfbild liegt unversioniert unter auftrag/UP-1b-pruefbild-protokoll.png.

Mit \`npm run docs:bilder -- --pt1\` erneuerst du Haushalt & Plan mit geschlossener Partnerschaftskarte, die geöffnete Partnerschaftskarte und beide PT-1-Prüfbilder.

Mit \`npm run docs:bilder -- --up1a\` erneuerst du Partnerschaft und Todesfall, Max’ Vermögenskarte mit zwei Immobilien und die Hinterbliebenenrente im Simulator. Ein frischer Muster-Spielbereich verwendet Haus 450.000 €, Wohnung 210.000 €, Nettomiete 650 €/Monat mit Inflation und Erika als Erbin aller Immobilien samt Steuergeld bei Nicht verheiratet, zusätzlich 0 % vom übrigen Geldvermögen. Das Prüfbild mit gesetztem Häkchen steht unter auftrag/EP-2-pruefbild-partnerschaft.png.

Mit \`npm run docs:bilder -- --sophie\` erneuerst du nur personen-sophie. Ein eigener Spielbereich wählt Sophie und zeigt ihre Einkünfte mit Gehalt bis Dezember 2037 und Rente ab Januar 2038.

Mit \`npm run docs:bilder -- --zg5a\` erzeugst du die vier Prüfbilder für Einkünfte bei 1920 und 1280 px sowie Übersicht und Haushalt & Plan mit 660.000 € Immobilien unter auftrag/. Eine eigene Sitzung ergänzt nur für die Bilder eine Betriebsrente mit Anpassung wie Löhne und zwei Immobilien. Sie prüft die Knopfgruppen auf Überlauf. Der Musterhaushalt bleibt unverändert. Neue Simulatoraufnahmen starten mit Real; im Backtest ist das die Kaufkraft des Startjahres.

Mit \`npm run docs:bilder -- --euro\` erneuerst du die sechs Simulator-Ergebnisbilder mit der Voreinstellung Real. Der Musterlauf verwendet 10.000 Pfade und Seed 12345. Backtestbilder zeigen die Kaufkraft des Startjahres.

Mit \`npm run docs:bilder -- --szenarien\` erneuerst du nur das Bild des Pfadvergleichs. Der Musterlauf verwendet ebenfalls 10.000 Pfade und Seed 12345. Zusätzliche Aufnahmen der Szenarioliste bei beiden PC-Zielgrößen liegen im Prüfverzeichnis.

Haushalt & Plan, Balance und Simulator zeigen ihre zunächst geschlossenen Planbereiche. Bei Max wird unter Einkünfte eine einmalige Rückzahlung über 50.000 € für Januar ${Number(maskDate.slice(0, 4)) + 2} als Personendatum gespeichert. Die vorhandene Aufnahme personen-max zeigt den Bereich Einkünfte mit diesem Eintrag und den Summen. Für die Monte-Carlo-Einstellungen öffnet Einstellungen → zeigen die Klappe im Monte-Carlo-Reiter; die Aufnahme zeigt gezielt die Monte-Carlo-Karte. Danach schließt das Werkzeug den Bereich und wechselt zum Rechnen zurück zu Monte Carlo. Die Aufnahme simulator-annahmen zeigt die Monatszeile über der Jahrestabelle in Einkünfte, Ausgaben und Bedarf. Der Eintrag bleibt nur im frischen Aufnahme-Spielbereich und wird mit dessen Browserkontext verworfen.

Der Browser läuft mit 1920×1080 Pixeln, Skalierung 1, Deutsch und Europe/Berlin. Die technische Uhr ist festgesetzt; Zeitgeber für Speicher und UI laufen weiter. Ausschnitte und verlustfreie PNG-Kompression begrenzen die Bildgröße. Bilddateien, Unterschriften, Datum, Seite, Zustand, Git-Commit, Ausschnitt, Maße und Dateigröße stehen im [Manifest](manifest.json). Gleiche PNG-Bytes auf verschiedenen Plattformen sind nicht zugesichert.

Nach dem Lauf siehst du dir einige PNGs und beide Abläufe an. Prüfe den Zustand, lesbare Werte und fehlende Lade- oder Fehleranzeigen. Führe danach \`npm run docs:pruefen\` aus. Das Werkzeug meldet bei einem Abbruch Bild, Aktion und Grund; wiederhole den gesamten Lauf nach der Korrektur. Server und Browser werden auch bei Fehlern geschlossen.

## Ansichten

Die [Ablaufdiagramme](ablaufdiagramme.md) halten die Mermaid-Quellen der drei statischen Handbuch-SVGs fest. Sie benötigen im Browser und in der EXE keine Bibliothek und kein Netz.

${images.filter(item => item.group === 'masken').map(item => `- [${path.basename(item.path)}](${item.path.replace('docs/ui/', '')}): ${item.caption}`).join('\n')}

## Jahresbudget

Die zwei Budgetbilder verwenden dieselben Engine-Ergebnisse wie die erzeugten Handbuchbeispiele. Die produktive Balance-Karte zeigt im normalen Jahr 2000 voll finanzierten Flex ohne Warum-Knopf. Für 2002 öffnet das Werkzeug die echte Warum-Treppe. Heutige Planvergleiche und Ausgaben werden im historischen Ausschnitt ausgeblendet; die Fachwerte bleiben unverändert. Der Lauf bindet beide Bilder anschließend im Handbuch ein.

${images.filter(item => item.group === 'jahresbudget').map(item => `- [${path.basename(item.path)}](${item.path.replace('docs/ui/', '')}): ${item.caption}`).join('\n')}

## Monat abschließen

${images.filter(item => item.group === 'monatsabschluss').map(item => `- [${path.basename(item.path)}](${item.path.replace('docs/ui/', '')}): ${item.caption}`).join('\n')}

## Jahr abschließen

${images.filter(item => item.group === 'jahresabschluss').map(item => `- [${path.basename(item.path)}](${item.path.replace('docs/ui/', '')}): ${item.caption}`).join('\n')}
`;
}

// Eigene Aufnahmesitzung: synthetische Ergänzungen bleiben im Browserkontext.
async function captureSavingsYear(session, goto) {
    await goto(session, 'Balance.html'); await tab(session.page, 'overview');
    await session.page.getByText('Ansparjahr: Einkünfte decken das Budget', { exact: true }).waitFor();
    await session.page.locator('#balanceFlowSaving').waitFor({ state: 'visible' });
    await session.page.locator('#balanceFlowWithdrawal').waitFor({ state: 'hidden' });
    await session.page.locator('.ov-hero').screenshot({ path: path.join(reviewRoot, 'AJ-1-pruefbild-balance-ansparjahr.png'), animations: 'disabled' });
}

// GF-1: Synthetische Beträge bleiben ausschließlich im Bildwerkzeug.
/** GU-1b [U5]: Fondskosten im Simulator und in Haushalt & Plan (KO-2) und Rentenanpassung „wie Löhne“ mit Hinweis. Ändert Max zuletzt auf „wie Löhne“,
 * deshalb am Ende einer Sitzung aufrufen. */
async function captureGU1B(session, goto, capture) {
    const { page } = session;
    await goto(session, 'Simulator.html'); await tab(page, 'annahmen');
    await page.locator('#simPlanParameters').evaluate(details => { details.open = true; });
    await page.locator('#equityCostPct').waitFor({ state: 'visible' });
    await capture(session, 'simulator-fondskosten', 'Simulator · Alle Parameter · Fondskosten 0,5 % aus Haushalt & Plan', maskDate, 'masken', '.sim-parameter-card:has(#equityCostPct)', true);
    await goto(session, 'depot-tranchen-manager.html');
    // KO-2: Der Planwert selbst steht in Haushalt & Plan unter „Weitere Planwerte“.
    await page.locator('#managerPlanTab').click();
    await page.locator('#managerPlanMore').evaluate(details => { details.open = true; });
    await page.locator('#managerPlan_equityCostPct').waitFor({ state: 'visible' });
    await capture(session, 'personen-fondskosten', 'Haushalt & Plan · Weitere Planwerte · Fondskosten 0,5 %', maskDate, 'masken', '.household-plan-group:has(#managerPlan_equityCostPct)', true);
    await page.locator('#managerPlanMore').evaluate(details => { details.open = false; });
    await page.locator('#managerSectionNav [data-manager-profile="muster_a"]').click();
    if (await page.locator('#managerIncomeToggle').getAttribute('aria-expanded') !== 'true') await page.locator('#managerIncomeToggle').click();
    await page.locator('#profilePensionSegments [data-value="wage"]').click();
    await page.locator('#profilePensionWageHint').waitFor({ state: 'visible' });
    await poll(page, () => document.querySelector('#tranchePersistenceStatus')?.textContent === 'Profilwerte dauerhaft gespeichert.', null, 'Rentenanpassung wie Löhne speichern');
    await capture(session, 'personen-rente-wie-loehne', 'Max · Einkünfte · Rentenanpassung „wie Löhne“ mit Hinweis', maskDate, 'masken', '#managerIncome', true);
}

async function captureGF1(browser, baseUrl, goto, capture) {
    const shot = async (page, name, selector) => {
        await page.evaluate(() => document.fonts.ready);
        const fits = await page.locator(selector).evaluate(host => {
            const bounds = host.getBoundingClientRect();
            return [...host.querySelectorAll('.monthly-flow-term, .monthly-flow-amount, .monthly-flow-detail-row')].filter(node => node.checkVisibility()).every(node => {
                const r = node.getBoundingClientRect(); return r.left >= bounds.left && r.right <= bounds.right + 1 && node.scrollWidth <= node.clientWidth + 1;
            });
        });
        if (!fits) throw new Error(`GF-1: Überlauf in ${name}`);
        await page.locator(selector).screenshot({ path: path.join(reviewRoot, `GF-1-pruefbild-${name}.png`), animations: 'disabled' });
    };
    const max = await newProbelauf(browser, baseUrl, maskDate);
    try {
        const { page } = max;
        await goto(max, 'Balance.html'); await tab(page, 'overview');
        await capture(max, 'balance-ueberblick', 'Balance · Geldfluss pro Monat', maskDate);
        // Der Musterhaushalt hat keinen Pflegegrad: 347 Euro nur für dieses Prüfbild ergänzen.
        await page.evaluate(async () => {
            const { buildBalanceEngineInputFromStorage } = await import('./app/balance/balance-input-storage.js');
            const { persistenceStorage } = await import('./app/shared/persistence-facade.js');
            const { SummaryRenderer } = await import('./app/balance/balance-renderer-summary.js');
            const { balanceIncomeDetails } = await import('./app/balance/balance-monthly-flow.js');
            const { readBalancePersonStatus } = await import('./app/shared/person-data-status.js');
            const { roundedIncomeDetails, renderIncomeDetails } = await import('./app/shared/monthly-flow.js');
            const { UIUtils } = await import('./app/balance/balance-utils.js');
            const calc = buildBalanceEngineInputFromStorage({ storage: persistenceStorage, referenceYear: 2026 });
            const input = { ...calc.inputData, renteAktiv: true, renteMonatlich: calc.inputData.renteMonatlich + 347 };
            const result = window.EngineAPI.simulateSingleYear(input, calc.engineLastState, { includeFlexTrace: true });
            const ids = ['balanceMonthlyBudget', 'balanceAnnualBudget', 'balanceMonthlyIncome', 'balanceBudgetCut', 'balanceBudgetWhy', 'balanceBudgetTrace', 'monatlicheEntnahme'];
            const renderer = new SummaryRenderer({ outputs: Object.fromEntries(ids.map(id => [id, document.getElementById(id)])) });
            renderer.renderOverview({ ...result.ui, input });
            renderIncomeDetails(document.getElementById('balanceIncomeDetails'), roundedIncomeDetails([
                ...balanceIncomeDetails(readBalancePersonStatus()), { label: 'Pflegegeld Max', amount: 347 }
            ], Math.round(input.renteMonatlich)), UIUtils.formatBalanceCurrency);
        });
        await shot(page, 'balance-entnahme', '.ov-hero');
        await page.setViewportSize({ width: 1280, height: 1080 });
        await shot(page, 'balance-1280', '.ov-hero');
        await page.setViewportSize(viewport);
        await goto(max, 'Simulator.html'); await tab(page, 'annahmen');
        await page.locator('#simPlanOverview').scrollIntoViewIfNeeded();
        await shot(page, 'simulator-monat', '#simPlanOverview');
        await capture(max, 'simulator-annahmen', 'Simulator · Monatszeile und Jahrestabelle', maskDate, 'masken', '#simPlanOverview', true);
        // Synthetischer Überschuss samt Einmalkunft und Ausgabe, ohne Änderung der Musterrechnung.
        await page.evaluate(async () => {
            const { renderPlanMonthly } = await import('./app/simulator/simulator-plan-overview.js');
            renderPlanMonthly(document, { groups: [{ label: 'Rente Max' }, { label: 'Rente Erika' }] },
                { year: 2028, incomes: [28994.76, 20170.32], oneTime: 50000, needs: 62424, expenses: 1234.56, result: 35506.52 },
                { plannedInflows: [{ year: 2028, label: 'Rückzahlung' }], plannedExpenses: [{ monat: '2028-05', betrag: 1234.56, bezeichnung: 'Reparatur', id: 'bild' }] });
        });
        await shot(page, 'simulator-ueberschuss-synthetisch', '#simPlanMonthly');
    } finally { await max.context.close(); }
    const sophie = await newProbelauf(browser, baseUrl, maskDate, 'demo', 'sophie');
    try {
        await captureSavingsYear(sophie, goto);
        await shot(sophie.page, 'balance-ueberschuss', '.ov-hero');
        await goto(sophie, 'Simulator.html'); await tab(sophie.page, 'annahmen');
        await sophie.page.locator('[data-plan-year="2029"]').click();
        await shot(sophie.page, 'simulator-ansparjahr', '#simPlanOverview');
    } finally { await sophie.context.close(); }
}

async function captureBD1(browser, baseUrl, goto, capture) {
    const picture = async (page, name, selector = '#results') => {
        await page.evaluate(() => document.fonts.ready);
        const fits = await page.locator(selector).evaluate(host => {
            const bounds = host.getBoundingClientRect();
            return [...host.querySelectorAll('.monthly-flow-term, .monthly-flow-detail-row')]
                .filter(node => node.checkVisibility()).every(node => {
                    const r = node.getBoundingClientRect();
                    return r.left >= bounds.left && r.right <= bounds.right + 1 && node.scrollWidth <= node.clientWidth + 1;
                });
        });
        if (!fits) throw new Error(`BD-1: Überlauf in ${name}`);
        await page.screenshot({ path: path.join(reviewRoot, `BD-1-pruefbild-${name}.png`), animations: 'disabled' });
        console.log(`BD-1: ${name} aufgenommen.`);
    };
    const max = await newProbelauf(browser, baseUrl, maskDate);
    try {
        const { page } = max;
        // Ausschließlich die private Musterkopie erhält Dynamic Flex.
        await page.evaluate(async () => {
            const { readBalanceHouseholdPlan, patchHouseholdPlan } = await import('./app/profile/household-plan.js');
            await patchHouseholdPlan({ scope: readBalanceHouseholdPlan().scope, patch: { dynamicFlex: true } });
        });
        await goto(max, 'Balance.html'); await tab(page, 'overview');
        await page.locator('#balanceBudgetCut[data-financed="above-plan"]').waitFor();
        const details = page.locator('#balanceIncomeDetails');
        if (await details.evaluate(node => node.open) || await details.locator('.monthly-flow-detail-row').first().isVisible())
            throw new Error('BD-1: Einkünfte müssen zunächst geschlossen sein.');
        await page.evaluate(() => window.scrollTo(0, 0));
        await picture(page, 'balance-1920');
        await capture(max, 'balance-ueberblick', 'Balance · Balken und Planvergleich mit Dynamik', maskDate);
        await page.setViewportSize({ width: 2560, height: 1440 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await picture(page, 'balance-2560');
        await page.setViewportSize(viewport);
        await details.locator('summary').click();
        await details.locator('.monthly-flow-detail-row').first().waitFor({ state: 'visible' });
        await page.evaluate(() => window.scrollTo(0, 0));
        await picture(page, 'balance-offen');
        await goto(max, 'Simulator.html'); await tab(page, 'annahmen');
        await page.locator('#simPlanMonthly').getByText('mit Dynamik bis', { exact: false }).waitFor();
        await page.locator('#simPlanOverview').evaluate(node => node.scrollIntoView({ block: 'start' }));
        await picture(page, 'simulator', '#simPlanOverview');
        await capture(max, 'simulator-annahmen', 'Simulator · Monatsbalken, Plan und Dynamikgrenze', maskDate, 'masken', '#simPlanOverview', true);
        const simDetails = page.locator('#simPlanMonthly details');
        if (await simDetails.locator('.monthly-flow-detail-row').first().isVisible()) throw new Error('BD-1: Simulator-Einkünfte sind nicht geschlossen.');
        await simDetails.locator('summary').click();
        await simDetails.locator('.monthly-flow-detail-row').first().waitFor({ state: 'visible' });
        if (max.errors.length) throw new Error(max.errors.join('\n'));
    } finally { await max.context.close(); }
    const sophie = await newProbelauf(browser, baseUrl, maskDate, 'demo', 'sophie');
    try {
        await goto(sophie, 'Balance.html'); await tab(sophie.page, 'overview');
        await sophie.page.locator('#balanceFlowSaving').waitFor({ state: 'visible' });
        await sophie.page.evaluate(() => window.scrollTo(0, 0));
        await picture(sophie.page, 'ansparjahr');
        if (sophie.errors.length) throw new Error(sophie.errors.join('\n'));
    } finally { await sophie.context.close(); }
}

// KM-1: Alle Ansichten stammen aus isolierten Muster-Spielbereichen.
async function captureKM1(browser, baseUrl, goto) {
    const date = '2026-10-23';
    const picture = async (page, name, selector) => {
        await page.evaluate(() => document.fonts.ready);
        await page.locator(selector).evaluate(node => node.scrollIntoView({ block: 'start' }));
        const overflow = await page.locator(selector).evaluate(host => [...host.querySelectorAll('.monthly-flow-term, .monthly-flow-detail-row, .pv-inheritance-metrics strong, .sim-person-values dd')]
            .filter(node => node.checkVisibility()).some(node => node.scrollWidth > node.clientWidth + 1));
        if (overflow) throw new Error(`KM-1: Textüberlauf in ${name}`);
        await page.screenshot({ path: path.join(reviewRoot, `KM-1-pruefbild-${name}.png`), animations: 'disabled' });
        console.log(`KM-1: ${name} aufgenommen.`);
    };
    const max = await newProbelauf(browser, baseUrl, date);
    try {
        const { page } = max;
        const dynamic = async enabled => page.evaluate(async dynamicFlex => {
            const { readBalanceHouseholdPlan, patchHouseholdPlan } = await import('./app/profile/household-plan.js');
            await patchHouseholdPlan({ scope: readBalanceHouseholdPlan().scope, patch: { dynamicFlex } });
        }, enabled);
        await dynamic(false);
        await goto(max, 'Balance.html', date); await tab(page, 'overview');
        await picture(page, 'budget', '#results');
        await page.setViewportSize({ width: 2560, height: 1440 });
        await picture(page, 'budget-2560', '#results');
        await page.setViewportSize(viewport);
        await dynamic(true);
        await goto(max, 'Balance.html', date); await tab(page, 'overview');
        await page.locator('#balanceBudgetCut[data-financed="above-plan"]').waitFor();
        await picture(page, 'budget-dynamik', '#results');
        await picture(page, 'bedarf', '.ov-need');
        const incomes = page.locator('#balanceIncomeDetails');
        console.log('KM-1: Einkünfte prüfen.');
        await incomes.locator('summary').click();
        await incomes.locator('[data-pension-status]').first().waitFor({ state: 'visible' });
        if (await page.locator('#balanceBudgetChips [data-pension-status]').count()) throw new Error('KM-1: Rentenhinweis außerhalb Feste Einkünfte');
        await dynamic(false);
        console.log('KM-1: Personenkarte öffnen.');
        await goto(max, 'Simulator.html', date); await tab(page, 'annahmen');
        await page.locator('#simPersonDetails > summary').click();
        await page.locator('[data-parameters="personen"] > summary').click();
        const tinted = await page.locator('#simStep4Content .sim-person-grid > section, #sharedPensionValues').evaluateAll(nodes => nodes.every(node => {
            const group = node.closest('.household-plan-group');
            return group && getComputedStyle(group).backgroundColor === 'rgb(244, 245, 241)';
        }));
        if (!tinted) throw new Error('KM-1: Personenabschnitt ohne Gruppenhintergrund');
        await page.locator('label:has(#personDeviationToggle)').click();
        if (await page.locator('#p1Monatsrente').evaluate(node => getComputedStyle(node).backgroundColor) !== 'rgb(255, 255, 255)') throw new Error('KM-1: Personenfeld ist nicht weiß');
        await page.locator('label:has(#personDeviationToggle)').click();
        await picture(page, 'rente-personen', '[data-assumption-step="4"]');
        await page.locator('#simPlanMonthly').evaluate(node => node.scrollIntoView({ block: 'start' }));
        await page.screenshot({ path: '/tmp/KM-1-simulator-monat.png', animations: 'disabled' });
        await goto(max, 'depot-tranchen-manager.html', date);
        await page.locator('#managerSectionNav [data-manager-view="plan"]').click();
        await page.locator('#managerPartnershipToggle').click();
        await picture(page, 'partnerschaft-ehe', '#managerPartnership');
        const saved = () => poll(page, () => document.querySelector('#managerPartnershipStatus').textContent === 'Gespeichert', null, 'Erbwahl speichern');
        await page.locator('[data-partnership="unmarried"]').click(); await saved();
        await page.locator('#managerSectionNav [data-manager-profile="muster_a"]').click();
        await page.locator('[data-home-action="add"]').click();
        await page.locator('#home-bezeichnung').fill('Haus');
        await page.locator('#home-wert').fill('800000');
        await page.locator('#home-stand').fill('10.2026');
        await page.locator('[data-home-action="save"]').click();
        await poll(page, () => document.querySelector('#tranchePersistenceStatus')?.textContent === 'Profilwerte dauerhaft gespeichert.', null, 'Haus speichern');
        await page.locator('#managerSectionNav [data-manager-view="plan"]').click();
        for (const [id, value] of [['inheritance-0', '0'], ['inheritance-1', '50']]) {
            await page.locator(`#${id}`).fill(value); await page.locator(`#${id}`).press('Enter'); await saved();
        }
        await page.locator('[data-inheritance-home="muster_a"]').check(); await saved();
        await picture(page, 'partnerschaft-haus', '#managerPartnership');
        await page.getByRole('button', { name: 'Erbvorschau beim Tod von Max', exact: true }).click();
        await page.screenshot({ path: '/tmp/KM-1-erbe-info.png', animations: 'disabled' });
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Vorschau: Erbanteile und vereinfachte Erbschaftsteuer', exact: true }).click();
        await page.screenshot({ path: '/tmp/KM-1-vorschau-info.png', animations: 'disabled' });
        const infoFits = await page.locator('.pv-partnership-notes .ds-info-pop').evaluate(node => {
            const box = node.getBoundingClientRect();
            return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
        });
        if (!infoFits) throw new Error('KM-1: Vorschau-Info liegt außerhalb des Bildschirms');
        await page.keyboard.press('Escape');
        await goto(max, 'Simulator.html', date); await tab(page, 'montecarlo');
        await page.locator('#mcSettingsToggle').click();
        await page.locator('#mcAnzahl').fill('2000'); await page.locator('#mcSeed').fill(String(seed)); await page.locator('#mcSeed').blur();
        await page.locator('#mcSettingsToggle').click();
        await page.locator('#mcButton').click();
        await poll(page, () => !document.querySelector('#mcButton')?.disabled && !document.querySelector('#exportMonteCarloRunJson')?.disabled,
            null, 'Monte-Carlo für Szenario-Protokoll', 600000);
        await page.locator('[data-mc-view="logs"]').click();
        await page.locator('#scenarioGroups [data-scenario-group="care"]').click();
        await page.locator('#scenarioList .scenario-list-item').filter({ hasText: 'Worst MIT Pflege' }).click();
        await picture(page, 'protokoll', '.protocol-head:has(#scenarioProtocolSummary)');
        await page.locator('#scenarioGroups [data-scenario-group="wealth"]').click();
        await page.locator('#scenarioList .scenario-list-item').filter({ hasText: 'Median' }).click();
        await page.locator('.protocol-head:has(#scenarioProtocolSummary)').evaluate(node => node.scrollIntoView({ block: 'start' }));
        await page.screenshot({ path: '/tmp/KM-1-protokoll-median.png', animations: 'disabled' });
        if (max.errors.length) throw new Error(max.errors.join('\n'));
    } finally { await max.context.close(); }
    const sophie = await newProbelauf(browser, baseUrl, date, 'demo', 'sophie');
    try {
        await goto(sophie, 'Balance.html', date); await tab(sophie.page, 'overview');
        await sophie.page.locator('#balanceFlowSaving').waitFor({ state: 'visible' });
        await picture(sophie.page, 'budget-sophie', '#results');
        if (sophie.errors.length) throw new Error(sophie.errors.join('\n'));
    } finally { await sophie.context.close(); }
}

async function captureZG5A(browser, baseUrl, goto) {
    const session = await newProbelauf(browser, baseUrl, maskDate);
    try {
        const { page } = session;
        await goto(session, 'depot-tranchen-manager.html');
        await page.locator('#managerSectionNav [data-manager-profile="muster_a"]').click();
        await page.locator('#managerIncomeToggle').click();
        await page.locator('#profileFixedIncomeAdd').click();
        await page.locator('#income-0-bezeichnung').fill('Betriebsrente');
        await page.locator('#income-0-betragMonat').fill('180');
        await page.locator('#income-0-betragMonat').blur();
        const adjustment = page.locator('#profileFixedIncomeRows .pv-person-segments');
        await adjustment.getByRole('button', { name: 'wie Löhne', exact: true }).click();
        await poll(page, () => document.querySelector('#tranchePersistenceStatus')?.textContent === 'Profilwerte dauerhaft gespeichert.', null, 'ZG5-A Einkünfte speichern');
        for (const width of [1920, 1280]) {
            await page.setViewportSize({ width, height: 1080 });
            await page.locator('#managerIncome').scrollIntoViewIfNeeded();
            // Bei Mindestbreite bleibt die breite Tabelle lokal scrollbar.
            await page.locator('#managerIncomeBody').evaluate(body => { body.scrollLeft = body.scrollWidth; });
            const fits = await page.locator('#managerIncome').evaluate(card => {
                const bounds = card.getBoundingClientRect();
                return [...card.querySelectorAll('.pv-person-segments')].every(group => {
                    const rect = group.getBoundingClientRect();
                    return rect.left >= bounds.left && rect.right <= bounds.right
                        && group.scrollWidth <= group.clientWidth + 1;
                }) && document.documentElement.scrollWidth <= innerWidth;
            });
            if (!fits) throw new Error(`ZG5-A: Knopfgruppe ragt bei ${width} px über die Einkünftekarte.`);
            await page.locator('#managerIncome').screenshot({ path: path.join(reviewRoot, `ZG5-A-pruefbild-einkuenfte-${width}.png`), animations: 'disabled' });
        }
        // Getrennte Vermögensbilder in derselben reinen Aufnahmesitzung.
        await page.setViewportSize(viewport);
        for (const home of [{ bezeichnung: 'Haus', wert: '450000' }, { bezeichnung: 'Wohnung', wert: '210000' }]) {
            await page.locator('[data-home-action="add"]').click();
            await page.locator('#home-bezeichnung').fill(home.bezeichnung);
            await page.locator('#home-wert').fill(home.wert);
            await page.locator('#home-stand').fill('10.2026');
            await page.locator('[data-home-action="save"]').click();
            await poll(page, () => document.querySelector('#tranchePersistenceStatus')?.textContent === 'Profilwerte dauerhaft gespeichert.', null, 'ZG5-A Immobilie speichern');
        }
        await page.locator('#managerSectionNav [data-manager-view="plan"]').click();
        await page.locator('[data-household-immobilien]').getByText('dazu Immobilien 660.000 € · nicht verplant', { exact: true }).waitFor();
        await page.locator('#managerHousehold').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(reviewRoot, 'ZG5-A-pruefbild-haushalt-plan.png'), animations: 'disabled' });
        await goto(session, 'index.html');
        await page.locator('#overviewImmobilien').getByText('dazu Immobilien 660.000 € · nicht verplant', { exact: true }).waitFor();
        await page.screenshot({ path: path.join(reviewRoot, 'ZG5-A-pruefbild-uebersicht.png'), animations: 'disabled' });
        console.log('ZG5-A: vier Prüfbilder erstellt; Knopfgruppen bei 1920/1280 px innerhalb der Karte.');
    } finally { await session.context.close(); }
}

async function captureUK1(browser, baseUrl, goto) {
    const extra = '/tmp/uk1';
    await fs.mkdir(extra, { recursive: true });
    const measurements = [];
    for (const householdId of ['max-erika', 'sophie']) {
        const session = await newProbelauf(browser, baseUrl, maskDate, 'demo', householdId);
        const { page } = session;
        const shot = async (name, selector, required = false) => {
            await page.evaluate(() => document.fonts.ready);
            await page.locator(selector).evaluate(node => node.scrollIntoView({ block: 'start' }));
            const geometry = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
                scrollWidth: document.documentElement.scrollWidth,
                focused: document.activeElement?.id,
                focusVisible: document.activeElement?.matches(':focus-visible'),
                outline: document.activeElement ? getComputedStyle(document.activeElement).outlineStyle : null }));
            if (geometry.scrollWidth > geometry.width) throw new Error(`${name}: horizontaler Seitenüberlauf`);
            measurements.push({ householdId, name, ...geometry });
            const file = required ? path.join(reviewRoot, `UK-1-pruefbild-${name}.png`) : path.join(extra, `${householdId}-${name}.png`);
            await page.screenshot({ path: file, animations: 'disabled' });
            console.log(`UK-1: ${householdId} · ${name} · ${file}`);
        };
        try {
            const max = householdId === 'max-erika';
            await goto(session, 'depot-tranchen-manager.html');
            await page.locator('#managerSectionNav [data-manager-view="plan"]').click();
            await page.locator('#managerExpensesToggle').click();
            await page.locator('#managerOneTimeExpenseAdd').click();
            await page.locator('#managerOneTimeExpenseRows input[id$="-bezeichnung"]').last().fill('Auto');
            await page.locator('#managerOneTimeExpenseRows input[id$="-betrag"]').last().fill('12000');
            await page.locator('#managerOneTimeExpenseRows input[id$="-monat"]').last().fill('12.2026');
            await page.locator('#managerOneTimeExpenseRows input[id$="-monat"]').last().blur();
            await poll(page, () => document.querySelector('#managerExpenseStatus')?.textContent === 'Gespeichert', null, 'UK-1 Musterausgabe speichern');
            await page.locator('#managerExpensesToggle').click();
            await shot('haushalt-plan', '#managerPlanPanel', max);
            await page.locator('#managerPlanMore > summary').click();
            await page.locator('#managerPlan_liquidityCashMonths').waitFor({ state: 'visible' });
            await shot('weitere-planwerte', '#managerPlanMore');
            await page.locator('#managerPlanMore > summary').click();
            await shot('planvergleich', '#managerPlanComparison');
            if (await page.locator('#managerPartnershipToggle').isVisible()) {
                await page.locator('#managerPartnershipToggle').click();
                await shot('partnerschaft', '#managerPartnership');
            } else await shot('partnerschaft-einzelperson', '#managerPlanPanel');
            await page.locator('#managerExpensesToggle').click();
            await shot('geplante-ausgaben', '#managerPlannedExpenses');
            const ids = max ? ['muster_a', 'muster_b'] : ['muster_sophie'];
            for (const id of ids) {
                await page.locator(`#managerSectionNav [data-manager-profile="${id}"]`).click();
                await ready(page, maskDate);
                await shot(`personen-${id === 'muster_a' ? 'max' : id === 'muster_b' ? 'erika' : 'sophie'}`, '#managerPersonPanel', id === 'muster_a');
                await page.locator('#managerPersonToggle').click();
                await page.locator('#profileCareGradeToday').selectOption('2');
                await page.locator('#profileCareProgression').selectOption('slower');
                await shot(`${id}-person-pflegegrad`, '#managerPersonToggle');
                await page.locator('#profileCareGradeToday').selectOption('0');
                await page.locator('#managerIncomeToggle').click();
                await shot(`${id}-einkuenfte`, '#managerIncome');
                await ready(page, maskDate);
                await page.locator('[data-home-action="add"]').click();
                await page.locator('#home-bezeichnung').fill('Musterwohnung');
                await page.locator('#home-wert').fill('210000');
                await page.locator('#home-stand').fill('10.2026');
                await page.locator('[data-home-choice="nutzung"][data-value="vermietet"]').click();
                await page.locator('#home-mieteNetto').fill('650');
                await page.locator('[data-home-action="save"]').click();
                await poll(page, () => document.querySelector('#tranchePersistenceStatus')?.textContent === 'Profilwerte dauerhaft gespeichert.', null, 'UK-1 Immobilie speichern');
                // Immobilien stehen aufklappbar in der Tabelle der Anlageformen.
                await page.locator('#tranchenTable [data-asset-group^="home"]').evaluateAll(groups => groups.forEach(group => { group.open = true; }));
                await page.locator('[data-asset-group="homeRented"] [data-home-open]').first().click();
                await shot(`${id}-immobilien`, '#tranchenTable [data-asset-group="homeRented"]');
                await page.locator('[data-home-action="cancel"]').click();
                await goto(session, 'Daten-Sicherung.html');
                await page.locator('#dataStorageDetails > summary').click();
                await shot(`${id}-technik`, '#dataStorageDetails');
                await goto(session, 'depot-tranchen-manager.html');
            }
            await goto(session, 'Balance.html');
            for (const [value, name] of [['overview', 'ueberblick'], ['strategy', 'bedarf-strategie'], ['diagnosis', 'diagnose']]) {
                await tab(page, value);
                await shot(`balance-${name}`, `#tab-${value}`, max && value !== 'strategy');
                if (value === 'overview') {
                    const incomeDetails = page.locator('.monthly-flow-incomes').first();
                    if (await incomeDetails.isVisible()) {
                        await incomeDetails.locator('summary').click();
                        await shot('balance-einkuenfte', '.ov-hero');
                    }
                    await page.evaluate(async () => {
                        const { createPlannedPostsView } = await import('./app/balance/balance-planned-posts-renderer.js');
                        const { projectPlannedPosts } = await import('./app/balance/balance-planned-posts.js');
                        const host = document.getElementById('balancePlannedPosts');
                        // Wie im bestehenden Handbuchbild: regulärer Renderer mit synthetischen Posten.
                        const posts = projectPlannedPosts({ year: 2026, scope: { key: 'uk1-bild' }, items: [
                            { id: 'auto', monat: '2026-12', betrag: 12000, bezeichnung: 'Auto' },
                            { id: 'kredit', ab: '2026-10', bis: '2027-12', betragMonat: 450, anpassung: 'keine', bezeichnung: 'Ratenkredit' }
                        ] });
                        host.replaceChildren(createPlannedPostsView(document, posts)); host.hidden = false;
                    });
                    await shot('balance-geplante-posten', '#balancePlannedPosts');
                }
                if (value === 'strategy') {
                    await page.locator('#balanceAllParameters > summary').click();
                    await shot('balance-parameter', '#balanceAllParameters');
                }
                if (value === 'diagnosis') {
                    const detail = page.locator('#tab-diagnosis .ds-technical-details').first();
                    if (await detail.isVisible()) {
                        await detail.locator('summary').click();
                        await shot('balance-technische-details', '#tab-diagnosis');
                    }
                }
            }
            if (max) {
                await goto(session, 'Simulator.html'); await tab(page, 'annahmen');
                await shot('pflege-zu', '[data-fieldset="pflege"]', true);
                await page.locator('#simCareDetails > summary').click();
                await shot('pflege-offen', '[data-fieldset="pflege"]', true);
                await page.locator('[data-parameters="personen"] > summary').click();
                await shot('modellannahmen', '[data-parameters="personen"]');
                await tab(page, 'montecarlo');
                await page.locator('#mcSettingsToggle').click();
                await page.locator('#mcAdvancedDisclosure > summary').click();
                await shot('mc-einstellungen', '#mcSetupDisclosure', true);
                // Native keyboard and pointer behavior, without changing persisted inputs.
                await page.locator('#mcSettingsToggle').press('Enter');
                if (await page.locator('#mcSetupDisclosure').evaluate(node => node.open)) throw new Error('Enter schließt MC nicht');
                await page.locator('#mcSettingsToggle').press('Space');
                if (!await page.locator('#mcSetupDisclosure').evaluate(node => node.open)) throw new Error('Leertaste öffnet MC nicht');
            }
            if (max) {
                await goto(session, 'depot-tranchen-manager.html');
                await page.locator('#managerSectionNav [data-manager-profile="muster_a"]').click();
                await page.locator('#depotAddTrancheBtn').click();
                await page.locator('[data-tranche-category="bonds"]').click();
                await page.locator('#name').fill('Musteranleihe');
                await page.locator('#purchaseDate').fill('2026-01-01');
                await page.locator('#shares').fill('10');
                await page.locator('#purchasePrice').fill('100');
                await page.locator('#currentPrice').fill('100');
                await page.locator('#saveTrancheBtn').click();
                await page.locator('#trancheModal').waitFor({ state: 'hidden' });
                const bondGroup = page.locator('.pv-asset-group[data-asset-group="anleihe"]');
                if (!await bondGroup.evaluate(node => node.open)) await bondGroup.locator('summary').first().click();
                await shot('anleihen-warnung', '#managerPersonPanel [data-asset-strategy-warning="bonds"]');
                const warning = await page.locator('#managerPersonPanel [data-asset-strategy-warning="bonds"]').evaluate(node => ({
                    padding: parseFloat(getComputedStyle(node).paddingLeft), gap: parseFloat(getComputedStyle(node).gap) }));
                if (!(warning.padding > 0 && warning.gap > 0)) throw new Error('Warnung ohne Innen- oder Knopfabstand');
            }
            if (session.errors.length) throw new Error(session.errors.join('\n'));
        } catch (error) {
            await page.screenshot({ path: path.join(extra, 'fehler.png') });
            console.log(await page.evaluate(() => ({ profile: document.getElementById('managerPersonProfileName')?.textContent, disabled: document.getElementById('profileImmobilien')?.disabled, status: document.getElementById('tranchePersistenceStatus')?.textContent, form: document.getElementById('home-save-status')?.textContent })));
            throw error;
        } finally { await session.context.close(); }
    }
    await fs.writeFile(path.join(extra, 'messungen.json'), JSON.stringify(measurements, null, 2) + '\n');
}

async function captureTB1(browser, baseUrl, goto) {
    for (const householdId of ['max-erika', 'renate']) {
        const session = await newProbelauf(browser, baseUrl, maskDate, 'demo', householdId);
        try {
            const { page } = session;
            await goto(session, 'Simulator.html');
            await tab(page, 'annahmen');
            const card = page.locator('[data-assumption-step="4"]');
            const model = page.locator('[data-parameters="personen"]');
            const picture = async name => {
                await page.evaluate(() => document.fonts.ready);
                await card.evaluate(node => node.scrollIntoView({ block: 'start' }));
                await page.screenshot({ path: path.join(reviewRoot, `TB-1-pruefbild-${name}.png`), animations: 'disabled' });
                console.log(`TB-1: ${name} · ${householdId} · 1920×1080`);
            };
            if (householdId === 'renate') {
                await page.locator('#simPersonDetails > summary').click();
                await model.locator('summary').click();
                await picture('einzelperson');
            } else {
                await picture('rente-personen-zu');
                await page.locator('#simPersonDetails > summary').click();
                await model.locator('summary').click();
                await picture('rente-personen-offen');
                await page.locator('#survivorFlexPercent').fill('10');
                await tab(page, 'montecarlo');
                await page.locator('#mcButton').click();
                await page.locator('#survivorMinimumFlexPercent[data-field-state="error"]').waitFor({ state: 'visible' });
                await page.screenshot({ path: path.join(reviewRoot, 'TB-1-pruefbild-fehlerhinweis.png'), animations: 'disabled' });
                console.log('TB-1: fehlerhinweis · Max/Erika · 1920×1080');
            }
            if (session.errors.length) throw new Error(session.errors.join('\n'));
        } finally { await session.context.close(); }
    }
}

async function captureTB2(browser, baseUrl, goto) {
    const session = await newProbelauf(browser, baseUrl, maskDate);
    try {
        const { page } = session;
        await goto(session, 'depot-tranchen-manager.html');
        await page.locator('#managerSectionNav [data-manager-view="plan"]').click();
        await page.locator('#managerPartnershipToggle').click();
        const card = page.locator('#managerPartnership');
        const saved = () => poll(page, () => document.querySelector('#managerPartnershipStatus').textContent === 'Gespeichert', null, 'Erbwahl speichern');
        const picture = async file => {
            await page.evaluate(() => document.fonts.ready);
            await card.evaluate(node => node.scrollIntoView({ block: 'start' }));
            await page.screenshot({ path: file, animations: 'disabled' });
        };
        if (!await card.getByText('Ohne Zugewinnausgleich und Versorgungsfreibetrag gerechnet.', { exact: false }).count()) throw new Error('Ehepartner-Hinweis fehlt.');
        await picture('/tmp/TB-2-erbvorschau-verheiratet.png');
        await page.locator('[data-partnership="unmarried"]').click(); await saved();
        await page.locator('#inheritance-0').fill('50');
        if (await page.locator('#managerPartnershipRetry').isVisible()) throw new Error('Wiederholen-Knopf beim Tippen sichtbar.');
        const preview = await page.locator('[data-inheritance-preview="muster_a"]').textContent();
        if (!preview.replaceAll('\u00a0', ' ').includes('30 % auf 187.000 € steuerpflichtig (207.000 € − 20.000 € Freibetrag)') || preview.includes('Härteausgleich')) throw new Error('Steuertext für 50 % ohne Haus stimmt nicht.');
        await picture('/tmp/TB-2-erbvorschau-50.png');
        await page.locator('#inheritance-0').press('Enter'); await saved();
        await page.locator('#managerSectionNav [data-manager-profile="muster_a"]').click();
        await page.locator('[data-home-action="add"]').click();
        await page.locator('#home-bezeichnung').fill('Haus');
        await page.locator('#home-wert').fill('800000');
        await page.locator('#home-stand').fill('10.2026');
        await page.locator('[data-home-action="save"]').click();
        await poll(page, () => document.querySelector('#tranchePersistenceStatus')?.textContent === 'Profilwerte dauerhaft gespeichert.', null, 'Haus speichern');
        await page.locator('#managerSectionNav [data-manager-view="plan"]').click();
        for (const [id, value] of [['inheritance-0', '0'], ['inheritance-1', '50']]) {
            await page.locator(`#${id}`).fill(value); await page.locator(`#${id}`).press('Enter'); await saved();
        }
        await page.locator('[data-inheritance-home="muster_a"]').check(); await saved();
        await picture(path.join(reviewRoot, 'TB-2-pruefbild-erbvorschau.png'));
        // Protokoll im echten Host mit synthetischen Zeilen, ohne weiteren Simulationslauf.
        await goto(session, 'Simulator.html');
        await tab(page, 'montecarlo');
        await page.locator('#mcViewTabLogs').click();
        await page.evaluate(async () => {
            const { renderProtocolTable } = await import('./app/simulator/protocol-renderer.js');
            const { PROTOCOL_COLUMNS } = await import('./app/simulator/protocol-columns.js');
            const { bindInfoPopovers } = await import('./app/shared/designsystem-info-popover.js');
            document.querySelector('#scenarioLogContainer').style.display = 'block';
            document.querySelector('#scenarioProtocolBasis').textContent = 'Geldbeträge · heutige Euro';
            document.querySelector('#toggle-log-detail').checked = true;
            document.querySelector('#scenarioLogOutput').innerHTML = renderProtocolTable([
                { jahr: 2, inflation_factor_cum: 1.1, inflation: 0, immobilienverkauf: 792000, immobilienverkauf_jahr: 2027,
                    kaufAkt: 110000, netTradeEq: -110000, aktionUndGrund: 'Rebal.(A+) 110000.00 €' },
                { jahr: 3, inflation_factor_cum: 1.1, inflation: 0, abgang_erben: 0, erbschaftsteuer: 110000,
                    vk: { vkGes: 110000 }, netTradeEq: 110000, aktionUndGrund: 'Verkauf 110000.00 € / 10 % bei 12 Monaten' }
            ], { source: 'mc', moneyBasis: 'real', startYear: 2026, logDetailLevel: 'detailed',
                columns: PROTOCOL_COLUMNS.filter(column => ['year', 'action', 'neta', 'home-sale', 'inheritance-tax'].includes(column.id)) });
            bindInfoPopovers(document);
        });
        await openProtocols(page);
        await page.locator('#scenarioLogOutput').evaluate(node => { node.hidden = false; node.scrollIntoView({ block: 'start' }); });
        const taxInfo = page.getByRole('button', { name: 'Erbschaftsteuer: vereinfachte Rechnung', exact: true }).last();
        await taxInfo.click();
        await page.screenshot({ path: '/tmp/TB-2-protokoll.png', animations: 'disabled' });
        if (session.errors.length) throw new Error(session.errors.join('\n'));
        console.log('TB-2: Erbvorschau (Ehe, 50 % ohne Haus, Haus + Steuer) und Protokoll · Max/Erika · 1920×1080');
    } finally { await session.context.close(); }
}

async function main() {
    const started = performance.now(), images = [];
    const scenariosOnly = process.argv.includes('--szenarien');
    const euroOnly = process.argv.includes('--euro') || scenariosOnly;
    const euroFiles = (scenariosOnly ? ['monte-carlo-szenario-logs'] : ['simulator-ergebnis', 'simulator-backtest', 'monte-carlo-ueberblick', 'monte-carlo-risiko-verteilung', 'monte-carlo-pflege', 'monte-carlo-szenario-logs']).map(name => `docs/ui/${name}.png`);
    if (euroOnly) images.push(...JSON.parse(await fs.readFile(path.join(root, 'docs/ui/manifest.json'), 'utf8')).images.filter(item => !euroFiles.includes(item.path)));
    const annualOnly = process.argv.includes('--jahresabschluss');
    if (annualOnly) images.push(...JSON.parse(await fs.readFile(path.join(root, 'docs/ui/manifest.json'), 'utf8')).images.filter(item => item.group !== 'jahresabschluss'));
    const inheritanceOnly = process.argv.includes('--up1b');
    const inheritanceFiles = ['protokoll-monte-carlo', 'protokoll-monte-carlo-details'].map(name => `docs/ui/${name}.png`);
    if (inheritanceOnly) images.push(...JSON.parse(await fs.readFile(path.join(root, 'docs/ui/manifest.json'), 'utf8')).images.filter(item => !inheritanceFiles.includes(item.path)));
    const pt1Only = process.argv.includes('--pt1');
    const partnershipOnly = process.argv.includes('--up1a') || pt1Only;
    const partnershipFiles = (pt1Only ? ['personen-haushalt-plan', 'partnerschaft-todesfall', 'partnerschaft-verheiratet'] : ['partnerschaft-todesfall', 'personen-immobilien', 'simulator-hinterbliebene', 'partnerschaft-verheiratet']).map(name => `docs/ui/${name}.png`);
    const careOnly = process.argv.includes('--pflegegrad') || partnershipOnly || inheritanceOnly;
    if (careOnly && !inheritanceOnly) images.push(...JSON.parse(await fs.readFile(path.join(root, 'docs/ui/manifest.json'), 'utf8')).images.filter(item => partnershipOnly ? !partnershipFiles.includes(item.path) : !['docs/ui/personen-pflegegrad.png', 'docs/ui/personen-pflege.png'].includes(item.path)));
    const hp1Protocols = process.argv.includes('--hp1-protokolle');
    const protocolOnly = process.argv.includes('--protokolle') || hp1Protocols;
    const protocolFiles = IMAGE_FILES.filter(file => file.includes('/protokoll-'));
    const comparisonOnly = process.argv.includes('--spielbereich');
    const historyOnly = process.argv.includes('--verlauf');
    const sophieOnly = process.argv.includes('--sophie');
    const uiOnly = process.argv.includes('--ui1');
    const wealthOnly = process.argv.includes('--pv2');
    const wealthFiles = ['personen-max', 'personen-erika', 'personen-erika-einkuenfte', 'tagesgeld-bearbeiten', 'simulator-annahmen'].map(name => `docs/ui/${name}.png`);
    if (wealthOnly) images.push(...JSON.parse(await fs.readFile(path.join(root, 'docs/ui/manifest.json'), 'utf8')).images.filter(item => !wealthFiles.includes(item.path)));
    const uiFiles = [...IMAGE_FILES.filter(file => /\/(einkuenfte-|geplante-ausgaben-|balance-geplante-posten|ausgaben-geplante-zuordnung)/.test(file)), 'docs/ui/personen-max.png', 'docs/ui/personen-erika.png'];
    if (protocolOnly) images.push(...JSON.parse(await fs.readFile(path.join(root, 'docs/ui/manifest.json'), 'utf8')).images.filter(item => !protocolFiles.includes(item.path)));
    if (uiOnly) images.push(...JSON.parse(await fs.readFile(path.join(root, 'docs/ui/manifest.json'), 'utf8')).images.filter(item => !uiFiles.includes(item.path)));
    if (sophieOnly) images.push(...JSON.parse(await fs.readFile(path.join(root, 'docs/ui/manifest.json'), 'utf8')).images.filter(item => item.path !== 'docs/ui/personen-sophie.png'));
    if (historyOnly) images.push(...JSON.parse(await fs.readFile(path.join(root, 'docs/ui/manifest.json'), 'utf8')).images.filter(item => !/\/verlauf-(haushalt|max|erika|kennzahlen|jahresuebersicht|vermoegensstaende)\.png$/.test(item.path)));
    if (comparisonOnly) images.push(...JSON.parse(await fs.readFile(path.join(root, 'docs/ui/manifest.json'), 'utf8')).images.filter(item => !['docs/ui/spielbereich-vergleich.png', 'docs/ui/probelauf-band.png'].includes(item.path)));
    const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
    const commit = git.stdout?.trim();
    if (git.status !== 0 || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Git-Commit für die Bildherkunft nicht lesbar.');
    const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
    const treeStatus = status.status === 0 && !status.stdout.trim() ? 'clean' : 'dirty';
    const server = createSuiteServer({ root: process.env.GV2_SOURCE_ROOT || root });
    let browser, current = 'Server starten', activePage;
    await fs.mkdir(path.join(root, 'docs/ui'), { recursive: true });
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
        });
        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        current = 'Playwright Chromium starten';
        browser = await chromium.launch({ headless: true });
        await fs.mkdir(reviewRoot, { recursive: true });
        const fullRun = process.argv.length === 2;
        if (process.argv.includes('--spk1-vorher') || process.argv.includes('--spk1')) {
            await captureSPK1({ browser, baseUrl, newProbelauf, goto, tab, poll, reviewRoot,
                before: process.argv.includes('--spk1-vorher') });
            return;
        }
        if (process.argv.includes('--fj2')) {
            await captureFJ2({ browser, baseUrl, newProbelauf, goto, tab, changeDate, poll, reviewRoot });
            return;
        }
        if (process.argv.includes('--bp2')) {
            await captureBP2({ browser, baseUrl, newProbelauf, goto, tab, changeDate, poll, reviewRoot });
            return;
        }
        if (process.argv.includes('--wt1')) {
            await captureWT1({ browser, baseUrl, newProbelauf, goto, tab, changeDate, poll, reviewRoot });
            return;
        }
        if (process.argv.includes('--rd1')) {
            await captureRD1({ browser, baseUrl, newProbelauf, goto, tab, changeDate, poll, importExample, reviewRoot });
            return;
        }
        if (process.argv.includes('--ly1')) {
            await captureLY1({ browser, baseUrl, newProbelauf, goto, tab, poll, reviewRoot });
            return;
        }
        if (process.argv.includes('--mh3')) {
            await captureMH3({ browser, baseUrl, newProbelauf, changeDate, poll, reviewRoot });
            return;
        }
        if (process.argv.includes('--mh2') || process.argv.includes('--mh2b')) {
            await captureMH2({ browser, baseUrl, newProbelauf, goto, tab, poll, reviewRoot, followup: process.argv.includes('--mh2b') });
            return;
        }
        if (process.argv.some(arg => arg.startsWith('--gv2-'))) {
            await captureGV2({ browser, baseUrl, newProbelauf, goto, tab, poll, root,
                phase: process.argv.some(arg => arg.endsWith('-vorher')) ? 'vorher' : 'nachher',
                partnershipOnly: process.argv.some(arg => arg.startsWith('--gv2-partnerschaft-')) });
            return;
        }
        if (fullRun) await captureGV1(browser, baseUrl, goto);
        if (fullRun) await captureET2(browser, baseUrl, goto);
        if (fullRun || process.argv.includes('--et1')) await captureET1(browser, baseUrl, goto);
        if (process.argv.includes('--et1')) return;
        if (fullRun || process.argv.includes('--vf2l')) await captureVF2L(browser, baseUrl, goto);
        if (process.argv.includes('--vf2l')) return;
        if (process.argv.includes('--as1')) {
            const session = await newProbelauf(browser, baseUrl, maskDate, 'demo', 'sophie');
            try {
                await goto(session, 'Balance.html'); await tab(session.page, 'overview');
                await session.page.getByText('Ansparjahr: Einkünfte decken das Budget', { exact: true }).waitFor();
                await session.page.locator('#balanceActionTitle').filter({ hasText: 'Aktien kaufen' }).waitFor();
                await session.page.evaluate(() => document.fonts.ready);
                await session.page.locator('.balance-overview').screenshot({ path: path.join(reviewRoot, 'AS-1-pruefbild-balance.png'), animations: 'disabled' });
                if (session.errors.length) throw new Error(session.errors.join('\n'));
                console.log('AS-1: Balance Sophie · Ansparjahr · Aktienkauf · 1920×1080');
            } finally { await session.context.close(); }
            return;
        }
        if (process.argv.includes('--km1')) return await captureKM1(browser, baseUrl, goto);
        if (process.argv.includes('--uk1')) return await captureUK1(browser, baseUrl, goto);
        if (process.argv.includes('--tb2')) return await captureTB2(browser, baseUrl, goto);
        if (process.argv.includes('--tb1')) return await captureTB1(browser, baseUrl, goto);
        if (process.argv.includes('--zg5a')) return await captureZG5A(browser, baseUrl, goto);
        // UR-1b: Erfasste Vermögensstände des Haushalts aufgeklappt, mit Zeilenkopf und Kasten; danach wieder zugeklappt.
        async function captureWealthRecords(session, page) {
            await page.locator('#managerHistorySwitch [data-manager-history-scope="household"]').click();
            await page.locator('#managerWealthRecordsToggle').click();
            await page.locator('#managerWealthTable table').waitFor({ state: 'visible' });
            const rows = await page.locator('#managerWealthTable tbody tr').count();
            await capture(session, 'verlauf-vermoegensstaende', `Erfasste Vermögensstände aufgeklappt · ${rows} ${rows === 1 ? 'Eintrag' : 'Einträge'}`, maskDate, 'masken', '#managerWealthRecords', true);
            await page.locator('#managerWealthRecordsToggle').click();
        }
        async function capture(session, name, state, date, group = 'masken', target = '#suiteMain', scroll = false) {
            if (hp1Protocols) {
                const reviewName = { 'protokoll-backtest': 'protokoll-backtest', 'protokoll-monte-carlo': 'protokoll-erbe' }[name];
                if (reviewName) {
                    await session.page.locator(target).evaluate(node => node.scrollIntoView({ block: 'start' }));
                    await session.page.evaluate(() => document.fonts.ready);
                    await session.page.screenshot({ path: path.join(reviewRoot, `HP-1-pruefbild-${reviewName}.png`), animations: 'disabled' });
                    console.log(`HP-1: ${reviewName}`);
                }
                return;
            }
            const file = `docs/ui/${name}.png`;
            current = `${file} · ${state}`; console.log(current);
            const { page, errors } = session; activePage = page;
            if (target === '.probelauf-end-dialog') await page.evaluate(() => document.fonts.ready.then(() => true));
            else if (session.ready) await session.ready();
            else await ready(page, date);
            await poll(page, target => [...document.querySelector(target).querySelectorAll('[role="status"], .close-dialog-step-pill')]
                .filter(element => element.checkVisibility()).every(element =>
                    !/wird geladen|wird vorbereitet|werden .*vorbereitet|Speichert noch|wird gespeichert|Speichervorgang läuft/i.test(element.textContent)),
            target, `${file} ohne Ladeanzeigen`);
            if (scroll) await page.locator(typeof scroll === 'string' ? scroll : target)
                .evaluate(element => element.scrollIntoView({ block: 'start' }));
            else await page.evaluate(() => window.scrollTo(0, 0));
            await page.mouse.move(1910, 1070);
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            if (errors.length) throw new Error(errors.join('; '));
            const visibleErrors = await page.locator('.ds-note-error:visible, .action-error-entry:visible, #mc-error-container:visible').allTextContents();
            if (visibleErrors.some(text => text.trim())) throw new Error(`Sichtbare Fehlermeldung: ${visibleErrors.join('; ')}`);
            const box = await page.locator(target).boundingBox();
            if (!box) throw new Error(`Aufnahmebereich ${target} ist nicht sichtbar.`);
            if (name === 'verlauf-kennzahlen') {
                const monthly = await page.locator('#managerHistoryMonthly').boundingBox();
                box.height = monthly.y + monthly.height - box.y;
            }
            if (name === 'personen-pflege') {
                // UR-1: Karte „Annahmen für spätere Pflege“ mit einer aufgeklappten Zeile; sie muss ganz ins Bild passen.
                // Halbe Pixel aus scrollIntoView sind keine Überschreitung.
                if (box.y < -1 || box.y + box.height + 8 > 1080) throw new Error(`Pflegewerte passen nicht ins Bild (${Math.ceil(box.y + box.height)} px).`);
            }
            const x = Math.max(0, Math.floor(box.x) - 8), y = Math.max(0, Math.floor(box.y) - 8);
            const crop = { x, y, width: Math.min(1920 - x, Math.ceil(box.width) + 16),
                height: Math.min(1080 - y, Math.ceil(box.height) + 16) };
            const scrollPosition = await page.evaluate(() => ({ x: scrollX, y: scrollY,
                closeDialogContent: document.querySelector('[data-close-dialog-host][open] [data-close-dialog-content]')?.scrollTop ?? 0 }));
            // Playwright verwendet bei Seitenscreenshots ohne fullPage Viewportkoordinaten.
            const buffer = compressPng(await page.screenshot({ type: 'png', animations: 'disabled',
                clip: crop }));
            await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
            await fs.writeFile(path.join(root, file), buffer);
            const caption = captions[IMAGE_FILES.indexOf(file)]
                || HANDBOOK_BUDGET_CAPTURES.find(item => `docs/ui/${item.name}.png` === file)?.caption;
            if (!caption) throw new Error(`Bild ${file} fehlt in der Bilderliste.`);
            images.push({ path: file, caption, household: session.household, date, viewport, scale: 1, crop,
                width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), bytes: buffer.length,
                sha256: createHash('sha256').update(buffer).digest('hex'), group, seed,
                source: { page: new URL(page.url()).pathname.slice(1), state, commit, treeStatus, scroll: scrollPosition } });
        }
        if (fullRun || process.argv.includes('--ph1b')) {
            await capturePH1B({ browser, baseUrl, newProbelauf, newNormalSession, goto, tab, capture, root, reviewRoot, date: maskDate });
            if (!fullRun) {
                const previous = JSON.parse(await fs.readFile(path.join(root, 'docs/ui/manifest.json'), 'utf8'));
                previous.images = previous.images.filter(item => !images.some(next => next.path === item.path)).concat(images);
                previous.imageCount = previous.images.length;
                previous.totalBytes = previous.images.reduce((sum, item) => sum + item.bytes, 0);
                await fs.writeFile(path.join(root, 'docs/ui/manifest.json'), JSON.stringify(previous, null, 2) + '\n');
                await fs.writeFile(path.join(root, 'docs/ui/README.md'), readme(previous.images));
                let handbook = await fs.readFile(path.join(root, 'Handbuch.html'), 'utf8');
                for (const item of images) handbook = handbook.replace(new RegExp(`(src="${item.path}" width=")\\d+(" height=")\\d+`), `$1${item.width}$2${item.height}`);
                await fs.writeFile(path.join(root, 'Handbuch.html'), handbook);
                return;
            }
        }
        if (process.argv.includes('--gf1') || process.argv.includes('--bd1') || process.argv.includes('--gu1b')) {
            if (process.argv.includes('--gu1b')) {
                const session = await newProbelauf(browser, baseUrl, maskDate);
                try { await captureGU1B(session, goto, capture); } finally { await session.context.close(); }
            } else await (process.argv.includes('--bd1') ? captureBD1 : captureGF1)(browser, baseUrl, goto, capture);
            const previous = JSON.parse(await fs.readFile(path.join(root, 'docs/ui/manifest.json'), 'utf8'));
            previous.images = previous.images.map(item => images.find(next => next.path === item.path) || item)
                .concat(images.filter(next => !previous.images.some(item => item.path === next.path)));
            previous.imageCount = previous.images.length;
            previous.totalBytes = previous.images.reduce((sum, item) => sum + item.bytes, 0);
            await fs.writeFile(path.join(root, 'docs/ui/manifest.json'), JSON.stringify(previous, null, 2) + '\n');
            let handbook = await fs.readFile(path.join(root, 'Handbuch.html'), 'utf8');
            for (const item of images) handbook = handbook.replace(new RegExp(`(src="${item.path}" width=")\\d+(" height=")\\d+`), `$1${item.width}$2${item.height}`);
            await fs.writeFile(path.join(root, 'Handbuch.html'), handbook);
            return;
        }
        async function goto(session, pageName, date = maskDate) {
            current = `${pageName} öffnen`; activePage = session.page;
            const { page } = session;
            const confirm = await page.evaluate(async () =>
                (await import('./app/shared/navigation-guard-dialog.js')).getPageNavigationGuard(document, window).reasons().length > 0);
            const navigation = page.waitForURL(`${baseUrl}/${pageName}`, { waitUntil: 'load' });
            await page.locator(`.suite-navigation a[href="${pageName}"]`).click();
            if (confirm) await page.locator('#navigationGuardLeave').click();
            await navigation; await ready(page, date);
        }
        async function captureProtocols(session) {
            const { page } = session;
            for (const source of ['backtest', 'monte-carlo']) {
                await tab(page, source === 'backtest' ? 'backtesting' : 'montecarlo');
                if (source === 'monte-carlo') {
                    await page.locator('[data-mc-view="logs"]').click();
                    await page.locator('#scenarioComparison [data-comparison-preset="default"]').click();
                    await page.locator('#scenarioComparison [data-scenario-id]').first().click();
                }
                await openProtocols(page);
                const host = source === 'backtest' ? '#simulationLog' : '#scenarioLogOutput';
                const toggle = page.locator(source === 'backtest' ? '#toggle-backtest-detail' : '#toggle-log-detail');
                for (const detailed of [false, true]) {
                    if (await toggle.isChecked() !== detailed) await toggle.locator('..').click();
                    await page.locator(`${host} table`).waitFor();
                    await page.locator(host).evaluate(node => { node.scrollTop = 0; node.scrollLeft = 0; });
                    const incomeInfo = source === 'backtest';
                    if (!detailed) {
                        const row = incomeInfo ? page.locator(`${host} tbody tr`).first()
                            : page.locator(`${host} tbody tr`).filter({ hasText: 'Geplante Ausgaben (Auto)' }).first();
                        await row.getByRole('button', { name: `${incomeInfo ? 'Einnahmen' : 'Ausgaben'}: Aufschlüsselung des Jahres`, exact: true }).click();
                        const info = row.locator('.ds-info[data-visible="true"] .ds-info-pop');
                        for (const label of incomeInfo ? ['Rente Max', 'Sonstige Einkünfte Max', 'Einmalige Einkünfte (Rückzahlung)', 'Summe']
                            : ['Grundbedarf', 'Flex', 'Geplante Ausgaben (Auto)', 'Summe', 'davon aus dem Vermögen bezahlt']) {
                            await info.getByText(label, { exact: true }).waitFor({ state: 'visible' });
                        }
                    }
                    await capture(session, `protokoll-${source}${detailed ? '-details' : ''}`,
                        `${source} · ${detailed ? 'Detailliert' : incomeInfo ? 'Standard mit Einnahmen-Info der ersten Jahreszeile' : 'Standard mit Ausgaben-Info im Autojahr'} · gerechneter Musterlauf`, maskDate, 'masken', host, true);
                    await page.keyboard.press('Escape');
                }
                if (await toggle.isChecked()) await toggle.locator('..').click();
            }
        }
        async function captureProtocolMusterlauf() {
            const session = await newProbelauf(browser, baseUrl, maskDate);
            try {
                const { page } = session;
                await goto(session, 'depot-tranchen-manager.html');
                await page.locator('#managerSectionNav [data-manager-profile="muster_a"]').click();
                await page.locator('#managerIncomeToggle').click();
                await page.locator('#profileFixedIncomeAdd').click();
                await page.locator('#income-0-bezeichnung').fill('Betriebsrente');
                await page.locator('#income-0-betragMonat').fill('3000');
                await page.locator('#income-0-ab').fill('01.2026');
                await page.locator('#income-0-ab').blur();
                await page.locator('#profileOneTimeIncomeAdd').click();
                await page.locator('#income-1-bezeichnung').fill('Rückzahlung');
                await page.locator('#income-1-betrag').fill('50000');
                await page.locator('#income-1-monat').fill('01/2026');
                await page.locator('#income-1-monat').blur();
                await poll(page, () => document.querySelector('#tranchePersistenceStatus')?.textContent === 'Profilwerte dauerhaft gespeichert.', null, 'Mustereinkünfte speichern');
                await page.locator('#managerPlanTab').click();
                await page.locator('#managerExpensesToggle').click();
                await page.locator('#managerOneTimeExpenseAdd').click();
                await page.locator('#expense-0-bezeichnung').fill('Auto');
                await page.locator('#expense-0-betrag').fill('2500');
                await page.locator('#expense-0-monat').fill('04.2026');
                await page.locator('#expense-0-monat').blur();
                await poll(page, () => document.querySelector('#managerExpenseStatus')?.textContent === 'Gespeichert', null, 'Musterausgabe speichern');
                await goto(session, 'Simulator.html');
                await poll(page, () => window.__simulatorOpeningBacktestDone === true || Boolean(window.__simulatorOpeningBacktestError), null, 'Automatischer Backtest', 60000);
                const error = await page.evaluate(() => window.__simulatorOpeningBacktestError);
                if (error) throw new Error(error);
                await tab(page, 'montecarlo');
                await page.locator('#mcSettingsToggle').click();
                await page.locator('#mcAnzahl').fill('128');
                await page.locator('#mcSeed').fill(String(seed));
                await page.locator('#mcSeed').blur();
                await page.locator('#mcSettingsToggle').click();
                await tab(page, 'montecarlo');
                await page.locator('#mcButton').click();
                await poll(page, () => !document.querySelector('#mcButton')?.disabled && !document.querySelector('#exportMonteCarloRunJson')?.disabled,
                    null, 'Monte-Carlo-Protokolle', 60000);
                await captureProtocols(session);
            } finally { await session.context.close(); }
        }
        if (process.argv.includes('--hp1')) {
            const shot = async (page, name, selector) => {
                await page.locator(selector).evaluate(node => node.scrollIntoView({ block: 'start' }));
                await page.evaluate(() => document.fonts.ready);
                await page.screenshot({ path: path.join(reviewRoot, `HP-1-pruefbild-${name}.png`), animations: 'disabled' });
                console.log(`HP-1: ${name}`);
            };
            for (const householdId of ['max-erika', 'martin-petra']) {
                const session = await newProbelauf(browser, baseUrl, maskDate, 'demo', householdId);
                try {
                    const { page } = session;
                    await goto(session, 'depot-tranchen-manager.html');
                    await page.locator('#managerPlanTab').click();
                    const details = page.locator(householdId === 'max-erika' ? '.pv-household-card details' : '.pv-person-card details').last();
                    await details.locator('summary').click();
                    await shot(page, householdId === 'max-erika' ? 'details-haushalt' : 'details-person', householdId === 'max-erika' ? '.pv-household-card' : '.pv-person-card:last-child');
                    if (householdId !== 'max-erika') continue;
                    await details.locator('summary').click();
                    await page.locator('#managerPlanMore > summary').click();
                    await shot(page, 'entnahme', '.household-plan-group:has(#managerPlan_decumulation_mode)');
                    await page.locator('#managerPartnershipToggle').click();
                    await shot(page, 'partnerschaft', '#managerPartnership');
                    await page.locator('#managerSectionNav [data-manager-profile="muster_a"]').click();
                    await page.locator('#managerPersonToggle').click();
                    await page.locator('#profileCareGradeToday').selectOption('2');
                    await poll(page, () => document.querySelector('#tranchePersistenceStatus')?.textContent === 'Profilwerte dauerhaft gespeichert.', null, 'HP-1 Pflege speichern');
                    await shot(page, 'pflege', '.pv-person-disclosure');
                    if (session.errors.length) throw new Error(session.errors.join('; '));
                } finally { await session.context.close(); }
            }
            return;
        }
        if (euroOnly) {
            const session = await newProbelauf(browser, baseUrl, maskDate);
            try {
                const { page } = session;
                await goto(session, 'depot-tranchen-manager.html');
                await page.locator('#managerSectionNav [data-manager-profile="muster_a"]').click();
                await page.locator('#managerIncomeToggle').click();
                await page.locator('#profileOneTimeIncomeAdd').click();
                await page.locator('#income-0-monat').fill('01.2028');
                await page.locator('#income-0-betrag').fill('50000');
                await page.locator('#income-0-bezeichnung').fill('Rückzahlung');
                await page.locator('#income-0-bezeichnung').blur();
                await poll(page, () => document.querySelector('#tranchePersistenceStatus')?.textContent === 'Profilwerte dauerhaft gespeichert.', null, 'Bild-Einkunft speichern');
                await goto(session, 'Simulator.html');
                await poll(page, () => window.__simulatorOpeningBacktestDone === true, null, 'Automatischer Backtest', 60000);
                if (await page.locator('#backtestWealthMode [data-wealth-mode="real"]').getAttribute('aria-pressed') !== 'true') throw new Error('Backtest startet nicht mit Real.');
                await tab(page, 'montecarlo');
                await page.locator('#mcSettingsToggle').click();
                await page.locator('#mcAnzahl').fill('10000');
                await page.locator('#mcSeed').fill(String(seed));
                await page.locator('#mcSeed').blur();
                await page.locator('#mcSettingsToggle').click();
                await page.locator('#mcButton').click();
                await poll(page, () => !document.querySelector('#mcButton')?.disabled && !document.querySelector('#exportMonteCarloRunJson')?.disabled,
                    null, 'Monte-Carlo · 10.000 Läufe · Real', 600000);
                if (await page.locator('#mcWealthMode [data-wealth-mode="real"]').getAttribute('aria-pressed') !== 'true') throw new Error('Monte Carlo startet nicht mit Real.');
                for (const [name, value] of [['ueberblick', 'overview'], ['risiko-verteilung', 'risk'], ['pflege', 'care'], ['szenario-logs', 'logs']]) {
                    if (scenariosOnly && value !== 'logs') continue;
                    await page.locator(`[data-mc-view="${value}"]`).click();
                    if (value === 'logs') await page.locator('#scenarioComparison [data-comparison-preset="default"]').click();
                    await capture(session, `monte-carlo-${name}`, `Monte Carlo · ${name} · Real · 10.000 Läufe · Seed 12345`, maskDate,
                        'masken', value === 'logs' ? '#scenarioComparison' : '#tab-montecarlo', value === 'logs' ? '#scenarioComparison' : '.mc-view-nav');
                    // SE-2: ganze Ansicht als Prüfbild gegen den Entwurf.
                    if (['risk', 'logs'].includes(value)) await page.screenshot({ path: path.join(reviewRoot, `SE-2-pruefbild-${name}.png`), fullPage: true, animations: 'disabled' });
                }
                if (scenariosOnly) {
                    await page.locator('#scenarioList [data-scenario-id="char_typicalMarket"]').click();
                    for (const size of [viewport, { width: 2560, height: 1440 }]) {
                        await page.setViewportSize(size);
                        await page.locator('#scenarioPathsHeading').evaluate(element => element.scrollIntoView({ block: 'start' }));
                        await page.screenshot({ path: path.join(reviewRoot, `szenarien-${size.width}.png`), animations: 'disabled' });
                    }
                    await page.setViewportSize(viewport);
                }
                if (!scenariosOnly) {
                await tab(page, 'ergebnis');
                await capture(session, 'simulator-ergebnis', 'Ergebnis · Real nach Backtest und Monte Carlo', maskDate);
                await tab(page, 'backtesting');
                await page.locator('#backtestAnalysis .backtest-analysis-more').evaluate(details => { details.open = false; });
                await capture(session, 'simulator-backtest', 'Backtest · Kaufkraft des Startjahres · Was im Lauf auffällt', maskDate, 'masken', '#backtestAnalysis', true);
                await page.screenshot({ path: path.join(reviewRoot, 'SE-2-pruefbild-backtest.png'), fullPage: true, animations: 'disabled' });
                }
            } finally { await session.context.close(); }
        } else {
        if (!careOnly) {
        if (!wealthOnly) {
        if (protocolOnly) await captureProtocolMusterlauf();
        if (!annualOnly && !protocolOnly && (uiOnly || !comparisonOnly && !historyOnly && !sophieOnly)) {
            const session = await newProbelauf(browser, baseUrl, maskDate);
            try {
                const { page } = session;
                await goto(session, 'depot-tranchen-manager.html');
                await page.locator('#managerSectionNav [data-manager-profile="muster_a"]').click();
                // Ausschließlich synthetische Bilddaten, regulär über den sichtbaren Editor.
                await page.locator('#managerIncomeToggle').click();
                await page.locator('#profileFixedIncomeAdd').click();
                await page.locator('#income-0-bezeichnung').fill('Betriebsrente');
                await page.locator('#income-0-betragMonat').fill('180');
                await page.locator('#income-0-ab').fill('7.2028');
                await page.locator('#income-0-ab').blur();
                await page.locator('#income-0-bis').focus();
                await page.locator('#income-0-bis').blur();
                await page.locator('#profileOneTimeIncomeAdd').click();
                await page.locator('#income-1-bezeichnung').fill('Rückzahlung');
                await page.locator('#income-1-betrag').fill('50000');
                await page.locator('#income-1-monat').fill('01/2028');
                await page.locator('#income-1-monat').blur();
                await poll(page, () => document.querySelector('#tranchePersistenceStatus')?.textContent === 'Profilwerte dauerhaft gespeichert.', null, 'Einkünfte speichern');
                await capture(session, 'einkuenfte-offen', 'Einkünfte · geöffnet', maskDate, 'masken', '#managerIncome', true);
                if (uiOnly) await capture(session, 'personen-max', 'Max · Rente, feste und einmalige Einkunft', maskDate, 'masken', '#managerIncome', true);
                if (uiOnly) {
                    for (const width of [2560, 1280, 1920]) {
                        await page.setViewportSize({ width, height: width === 2560 ? 1440 : 1080 });
                        const layout = await page.locator('#managerIncomeBody').evaluate(body => ({
                            heights: [...new Set([...body.querySelectorAll('input:not([type="hidden"]), select:not([hidden])')].filter(el => el.getClientRects().length).map(el => Math.round(el.closest('.ds-unit-frame')?.getBoundingClientRect().height || el.getBoundingClientRect().height)))],
                            segmentsInOneRow: [...body.querySelectorAll('.pv-person-segments')].every(group => new Set([...group.children].map(button => Math.round(button.getBoundingClientRect().y))).size === 1),
                            pageOverflow: document.documentElement.scrollWidth > innerWidth
                        }));
                        if (layout.heights.some(height => height !== 40) || !layout.segmentsInOneRow || layout.pageOverflow) throw new Error(`Einkünfte ${width}: ${JSON.stringify(layout)}`);
                        console.log(`Einkünfte ${width}: Felder 40 px, Segmente einzeilig, kein Seitenüberlauf.`);
                    }
                    await page.locator('#profilePensionSegments [data-value="fix"]').click();
                    await page.locator('#profileRentenanpassungPct').fill('2');
                    await page.locator('#profileRentenanpassungPct').blur();
                    const aligned = await page.locator('.pv-pension-adjustment').evaluate(group => {
                        const visible = [...group.querySelectorAll('button, input')].filter(el => el.getClientRects().length);
                        return new Set(visible.map(el => Math.round((el.closest('.ds-unit-frame') || el).getBoundingClientRect().y))).size === 1;
                    });
                    if (!aligned) throw new Error('Rentenanpassung: %-Feld steht nicht in derselben Zeile.');
                    await page.locator('#profilePensionSegments [data-value="wage"]').click();
                }

                await page.locator('#managerIncomeToggle').click();
                await capture(session, 'einkuenfte-geschlossen', 'Einkünfte · geschlossen', maskDate, 'masken', '#managerIncome', true);
                if (uiOnly) {
                    await page.locator('#managerSectionNav [data-manager-profile="muster_b"]').click();
                    await page.locator('#managerSectionNav [data-manager-profile="muster_b"][aria-selected="true"]').waitFor();
                    await capture(session, 'personen-erika', 'Erika · Einkünfte und Nachbarkarten geschlossen', maskDate);
                }
                await page.locator('#managerPlanTab').click();
                await page.locator('#managerExpensesToggle').click();
                await page.locator('#managerFixedExpenseAdd').click();
                await page.locator('#expense-0-bezeichnung').fill('Ratenkredit');
                await page.locator('#expense-0-betragMonat').fill('450');
                await page.locator('#expense-0-ab').fill('10.2026');
                await page.locator('#expense-0-bis').fill('');
                await page.locator('#expense-0-bis').blur();
                await page.locator('#managerOneTimeExpenseAdd').click();
                await page.locator('#expense-1-bezeichnung').fill('Auto');
                await page.locator('#expense-1-betrag').fill('25000');
                await page.locator('#expense-1-monat').fill('4.2029');
                await page.locator('#expense-1-monat').blur();
                await poll(page, () => document.querySelector('#managerExpenseStatus')?.textContent === 'Gespeichert', null, 'Geplante Ausgaben speichern');
                await capture(session, 'geplante-ausgaben-offen', 'Geplante Ausgaben · geöffnet', maskDate, 'masken', '#managerPlannedExpenses', true);
                if (uiOnly) {
                    for (const width of [2560, 1280, 1920]) {
                        await page.setViewportSize({ width, height: width === 2560 ? 1440 : 1080 });
                        const layout = await page.locator('#managerExpensesBody').evaluate(body => ({
                            heights: [...new Set([...body.querySelectorAll('input')].map(el => Math.round(el.closest('.ds-unit-frame')?.getBoundingClientRect().height || el.getBoundingClientRect().height)))],
                            segmentsInOneRow: [...body.querySelectorAll('.pv-person-segments')].every(group => new Set([...group.children].map(button => Math.round(button.getBoundingClientRect().y))).size === 1),
                            pageOverflow: document.documentElement.scrollWidth > innerWidth
                        }));
                        if (layout.heights.some(height => height !== 40) || !layout.segmentsInOneRow || layout.pageOverflow) throw new Error(`Geplante Ausgaben ${width}: ${JSON.stringify(layout)}`);
                        console.log(`Geplante Ausgaben ${width}: Felder 40 px, Segmente einzeilig, kein Seitenüberlauf.`);
                    }
                }

                await page.locator('#managerExpensesToggle').click();
                await capture(session, 'geplante-ausgaben-geschlossen', 'Geplante Ausgaben · geschlossen', maskDate, 'masken', '#managerPlannedExpenses', true);
                // Für den Überblick und Import dieselbe Musterzahlung ins Planjahr legen.
                await page.locator('#managerExpensesToggle').click();
                await page.locator('#expense-1-monat').fill('10.2026');
                await page.locator('#expense-1-monat').blur();
                await poll(page, () => document.querySelector('#managerExpenseStatus')?.textContent === 'Gespeichert', null, 'Musterzahlung im Planjahr');
                await goto(session, 'Balance.html');
                await tab(page, 'overview');
                await page.evaluate(async () => {
                    const { createPlannedPostsView } = await import('./app/balance/balance-planned-posts-renderer.js');
                    const { projectPlannedPosts } = await import('./app/balance/balance-planned-posts.js');
                    const host = document.getElementById('balancePlannedPosts');
                    // Der reguläre Renderer mit einem synthetischen Planjahr für die Bildabnahme.
                    const posts = projectPlannedPosts({ year: 2026, scope: { key: 'bild' }, items: [
                        { id: 'auto', monat: '2026-10', betrag: 25000, bezeichnung: 'Auto' },
                        { id: 'kredit', ab: '2026-10', bis: '2027-12', betragMonat: 450, anpassung: 'keine', bezeichnung: 'Ratenkredit' }
                    ] });
                    posts.items.push({ kind: 'income', month: '2026-11', label: 'Rückzahlung', amount: 50000, person: 'Max Mustermann' });
                    host.replaceChildren(createPlannedPostsView(document, posts)); host.hidden = false;
                });
                await page.locator('[data-planned-posts]').first().waitFor({ state: 'visible' });
                await capture(session, 'balance-geplante-posten', 'Balance · geplante Posten 2026', maskDate, 'masken', '[data-planned-posts]', true);
                await page.evaluate(async () => {
                    const { requestExpensesPreview } = await import('./app/balance/balance-expenses-import.js');
                    const { parseCategoryCsv, EXPENSE_CSV_CATEGORY_NEEDS } = await import('./app/balance/balance-expenses-csv.js');
                    const categories = parseCategoryCsv('Kategorie;Betrag;Bedarf\nLeben & Haushalt;-2500;Floor\nAuto;-25000;Flex');
                    // Die produktive Importvorschau, ohne den Musterimport zu bestätigen.
                    void requestExpensesPreview([{ profileId: 'muster_a', name: 'Max Mustermann', year: 2026, month: 10,
                        source: 'probelauf-example', total: 27500, categories, categoryNeeds: categories[EXPENSE_CSV_CATEGORY_NEEDS],
                        plannedExpenseChoices: [{ id: 'bild-auto', month: '2026-10', label: 'Auto', amount: 25000, selected: true }] }]);
                });
                await page.locator('#expensesImportPreview').waitFor({ state: 'visible' });
                await capture(session, 'ausgaben-geplante-zuordnung', 'Ausgabenimport · geplante Zahlung zuordnen', maskDate, 'masken', '#expensesImportPreview');
                await page.locator('[data-expenses-preview-cancel]').click();
            } finally { await session.context.close(); }
        }
        if (!protocolOnly && historyOnly) {
            const session = await newProbelauf(browser, baseUrl, maskDate);
            try {
                await goto(session, 'depot-tranchen-manager.html');
                await session.page.locator('#managerHistoryTab').click();
                for (const [name, selector] of [['haushalt', '[data-manager-history-scope="household"]'], ['max', '[data-manager-profile="muster_a"]'], ['erika', '[data-manager-profile="muster_b"]']]) {
                    await session.page.locator(`#managerHistorySwitch ${selector}`).click();
                    await session.page.locator('#managerWealthChart svg').waitFor({ state: 'visible' });
                    await capture(session, `verlauf-${name}`, `Vermögensverlauf ${name}`, maskDate);
                }
                await session.page.locator('#managerHistorySwitch [data-manager-history-scope="household"]').click();
                await capture(session, 'verlauf-kennzahlen', 'Depotkennzahlen Haushalt · alle Anlageformen zugeklappt', maskDate, 'masken', '#managerHistoryReturns', true);
                await capture(session, 'verlauf-jahresuebersicht', 'Jahresübersicht der Anlagen · Haushalt', maskDate, 'masken', '#managerHistoryYears', true);
                await captureWealthRecords(session, session.page);
            } finally { await session.context.close(); }
        }
        if (!protocolOnly && !comparisonOnly && !historyOnly && !sophieOnly && !uiOnly) {
        if (!annualOnly) {
        const masks = await newProbelauf(browser, baseUrl, maskDate);
        try {
            const { page } = masks; activePage = page;
            await capture(masks, 'uebersicht', 'Übersicht', maskDate);
            await goto(masks, 'depot-tranchen-manager.html');
            await page.locator('#managerPlanTab').click();
            await page.locator('#managerPlanMore').evaluate(details => { details.open = false; });
            if (await page.locator('#managerPartnershipToggle').getAttribute('aria-expanded') === 'true') await page.locator('#managerPartnershipToggle').click();
            await capture(masks, 'personen-haushalt-plan', 'Bedarf vor Partnerschaft und Todesfall · Partnerschaft eingeklappt', maskDate, 'masken', '#managerPlanPanel', '#managerHouseholdPlan');
            // FR-66: Die Steuerung erhält zusätzlich ein Bild mit dem neuen Reservefeld.
            await page.locator('#managerPlanMore').evaluate(details => { details.open = true; });
            const cashMonths = page.locator('#managerPlan_liquidityCashMonths');
            await cashMonths.waitFor({ state: 'visible' });
            await cashMonths.evaluate(field => field.closest('.household-plan-group').scrollIntoView({ block: 'center' }));
            await page.evaluate(() => document.fonts.ready);
            await page.screenshot({ path: path.join(reviewRoot, 'LQ-1-pruefbild-weitere-planwerte.png'), animations: 'disabled' });
            await page.locator('#managerPlanMore').evaluate(details => { details.open = false; });
            for (const [name, id] of [['max', 'muster_a'], ['erika', 'muster_b']]) {
                await page.locator(`#managerSectionNav [data-manager-profile="${id}"]`).click();
                if (name === 'max') {
                    await page.locator('#managerIncomeToggle').click();
                    await page.locator('#profileOneTimeIncomeAdd').click();
                    await page.locator('#income-0-monat').fill(`01.${Number(maskDate.slice(0, 4)) + 2}`);
                    await page.locator('#income-0-betrag').fill('50000');
                    await page.locator('#income-0-bezeichnung').fill('Rückzahlung');
                    await poll(page, () => document.querySelector('#tranchePersistenceStatus')?.textContent === 'Profilwerte dauerhaft gespeichert.', null, 'Einmalige Einkunft speichern');
                }
                await capture(masks, `personen-${name}`, `Person ${name} · ${name === 'max' ? 'Einkünfte mit 50.000 € Rückzahlung im Januar ' + (Number(maskDate.slice(0, 4)) + 2) : 'Personendetails geschlossen'}`, maskDate, 'masken', name === 'max' ? '#managerIncome' : '#suiteMain', name === 'max' ? '#managerIncome' : false);
            }
            await page.locator('#managerHistoryTab').click();
            for (const [name, selector] of [['haushalt', '[data-manager-history-scope="household"]'], ['max', '[data-manager-profile="muster_a"]'], ['erika', '[data-manager-profile="muster_b"]']]) {
                await page.locator(`#managerHistorySwitch ${selector}`).click();
                await page.locator('#managerWealthChart svg').waitFor({ state: 'visible' });
                await capture(masks, `verlauf-${name}`, `Vermögensverlauf ${name}`, maskDate);
            }
            await page.locator('#managerHistorySwitch [data-manager-history-scope="household"]').click();
            await capture(masks, 'verlauf-kennzahlen', 'Depotkennzahlen Haushalt · alle Anlageformen zugeklappt', maskDate, 'masken', '#managerHistoryReturns', true);
            await capture(masks, 'verlauf-jahresuebersicht', 'Jahresübersicht der Anlagen · Haushalt', maskDate, 'masken', '#managerHistoryYears', true);
            await captureWealthRecords(masks, page);
            await goto(masks, 'Ausgaben.html');
            await page.locator('#expensesTable table').waitFor();
            await capture(masks, 'ausgaben', 'Ausgaben 2026', maskDate);
            await goto(masks, 'Balance.html');
            for (const [name, value] of [['ueberblick', 'overview'], ['bedarf-strategie', 'strategy'], ['diagnose', 'diagnosis']]) {
                await tab(page, value);
                if (value === 'strategy') await page.locator('#balanceAllParameters').evaluate(details => { details.open = false; });
                await capture(masks, `balance-${name}`, `Balance ${name}${value === 'strategy' ? ' · Alle Parameter geschlossen' : ''}`, maskDate,
                    'masken', value === 'strategy' ? '#tab-strategy' : '#suiteMain', value === 'strategy');
            }
            await goto(masks, 'Simulator.html');
            await poll(page, () => window.__simulatorOpeningBacktestDone === true || Boolean(window.__simulatorOpeningBacktestError),
            null, 'Automatischer Backtest', 60000);
            const openingError = await page.evaluate(() => window.__simulatorOpeningBacktestError);
            if (openingError) throw new Error(openingError);
            await tab(page, 'montecarlo');
            await page.locator('#mcSettingsToggle').click();
            await page.locator('#mcAnzahl').fill('10000'); await page.locator('#mcSeed').fill(String(seed));
            await page.locator('#mcSeed').blur();
            await page.locator('#mcAdvancedDisclosure > summary').click();
            await capture(masks, 'monte-carlo-einstellungen', 'Monte-Carlo · Einstellungen und Erweitert geöffnet · 10.000 Läufe · Seed 12345 · Dauer automatisch', maskDate,
                'masken', '#mcSetupDisclosure', true);
            await page.locator('#mcSettingsToggle').click();
            await tab(page, 'montecarlo');
            current = 'Monte-Carlo · 10.000 Läufe mit Seed 12345 rechnen'; console.log(current);
            await page.locator('#mcButton').click();
            await poll(page, () => !document.querySelector('#mcButton')?.disabled
                && !document.querySelector('#exportMonteCarloRunJson')?.disabled
                && document.querySelector('#monteCarloResults')?.getClientRects().length
                && document.querySelector('#mc-progress-bar-container')?.style.display === 'none',
            null, 'Monte-Carlo-Ergebnisse', 600000);
            await captureProtocolMusterlauf();
            for (const [name, value] of [['ueberblick', 'overview'], ['risiko-verteilung', 'risk'], ['pflege', 'care'], ['szenario-logs', 'logs']]) {
                await page.locator(`[data-mc-view="${value}"]`).click();
                if (value === 'logs') {
                    await page.locator('#scenarioComparison [data-comparison-preset="default"]').click();
                    await page.locator('#scenarioComparisonHeading').waitFor({ state: 'visible' });
                }
                await capture(masks, `monte-carlo-${name}`, `Monte-Carlo ${name} · 10.000 Läufe · Seed 12345${value === 'logs' ? ' · Pfade vergleichen · P10, Median, P90' : ''}`, maskDate,
                    'masken', value === 'logs' ? '#scenarioComparison' : '#tab-montecarlo', value === 'logs' ? '#scenarioComparison' : '.mc-view-nav');
            }
            // Eigene unveränderte Mustersitzung für alle vier Entscheidungsarten.
            const decisionSession = await newProbelauf(browser, baseUrl, maskDate);
            try {
                await goto(decisionSession, 'Simulator.html');
                const decisionPage = decisionSession.page;
                await tab(decisionPage, 'montecarlo');
                await decisionPage.locator('#mcSettingsToggle').click();
                await decisionPage.locator('#mcAnzahl').fill('10000');
                await decisionPage.locator('#mcSeed').fill(String(seed));
                await decisionPage.locator('#mcSeed').blur();
                await decisionPage.locator('#mcSettingsToggle').click();
                await decisionPage.locator('[data-mc-view="decision"]').click();
                const planBefore = await decisionPage.evaluate(async () => {
                    const { HOUSEHOLD_PLAN_KEY } = await import('./app/profile/household-plan.js');
                    return (await import('./app/shared/persistence-facade.js')).persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY);
                });
                for (const [name, kind] of [['budget', 'budget'], ['ausgabe', 'expense'], ['einkunft', 'income'], ['zielwert', 'target']]) {
                    await decisionPage.locator(`[data-decision-kind="${kind}"]`).click();
                    if (kind === 'budget') await decisionPage.locator('#decisionBudget').fill('300');
                    if (kind === 'expense') {
                        await decisionPage.locator('#decisionExpense').fill('25000');
                        await decisionPage.locator('#decisionExpenseMonth').fill('2030-06');
                    }
                    if (kind === 'income') {
                        await decisionPage.locator('#decisionIncome').selectOption('pension:1');
                        await decisionPage.locator('#decisionMonths').fill('12');
                    }
                    if (kind === 'target') {
                        await decisionPage.locator('#decisionTargetCoverage').fill('98');
                        await decisionPage.locator('#decisionTargetAffected').fill('10');
                    }
                    current = `Vergleich ${name} rechnen`; console.log(current);
                    await decisionPage.locator('#decisionRun').click();
                    await poll(decisionPage, () => !document.querySelector('#decisionRun').disabled
                        && (document.querySelector('#decisionResult').hidden === false
                            || /Vergleich nicht möglich/.test(document.querySelector('#decisionStatus').textContent)),
                    null, `Vergleich ${name}`, kind === 'target' ? 600000 : 180000);
                    if (await decisionPage.locator('#decisionResult').isHidden())
                        throw new Error(await decisionPage.locator('#decisionStatus').textContent());
                    await decisionPage.locator('#decisionComparison').evaluate(element => element.scrollIntoView({ block: 'start' }));
                    await fs.writeFile(path.join(reviewRoot, kind === 'target' ? 'ZW-1b-pruefbild.png' : `VG-1-pruefbild-${name}.png`),
                        compressPng(await (kind === 'target' ? decisionPage.locator('#decisionComparison') : decisionPage).screenshot({ animations: 'disabled' })));
                    if (kind === 'budget') await fs.writeFile(path.join(reviewRoot, 'VS-1-pruefbild.png'),
                        compressPng(await decisionPage.locator('#decisionComparison').screenshot({ animations: 'disabled' })));
                    if (kind === 'budget') await capture(decisionSession, 'monte-carlo-vergleich',
                        'Vergleich · Wunschbudget +300 €/Monat · 1.000 Läufe je Plan (Einstellung 10.000 ÷ 10) · Seed 12345', maskDate,
                        'masken', '#decisionComparison', true);
                    if (kind === 'target') {
                        if (!await decisionPage.locator('[data-decision-trial]').isVisible()) throw new Error('Zielwertsuche ohne gefundenen Betrag.');
                        await capture(decisionSession, 'monte-carlo-zielwert',
                            'Zielwertsuche · Ziele 98/10 · Suche mit 1.000 Läufen je Schritt · Endprobe mit 10.000 Läufen · Seed 12345', maskDate,
                            'masken', '#decisionComparison', true);
                    }
                }
                const planAfter = await decisionPage.evaluate(async () => {
                    const { HOUSEHOLD_PLAN_KEY } = await import('./app/profile/household-plan.js');
                    return (await import('./app/shared/persistence-facade.js')).persistenceStorage.getItem(HOUSEHOLD_PLAN_KEY);
                });
                if (planBefore !== planAfter) throw new Error('Der Vergleich hat den zentralen Plan verändert.');
                await decisionPage.locator('[data-decision-trial]').click();
                if (!await decisionPage.locator('#simPlanTrialBand').isVisible()) throw new Error('Planversuch-Link öffnet den Planversuch nicht.');
                if (decisionSession.errors.length) throw new Error(decisionSession.errors.join('; '));
            } finally { await decisionSession.context.close(); }
            for (const [name, value] of [['ergebnis', 'ergebnis'], ['annahmen', 'annahmen'], ['backtest', 'backtesting']]) {
                await tab(page, value);
                if (value === 'annahmen') {
                    await page.locator('#simPlanParameters').evaluate(details => { details.open = false; });
                }
                if (value === 'backtesting') {
                    await page.locator('#backtestAnalysis').waitFor({ state: 'visible' });
                    await page.locator('#backtestAnalysis .backtest-analysis-more').evaluate(details => { details.open = false; });
                }
                await capture(masks, `simulator-${name}`, `Simulator ${name} nach Backtest und Monte-Carlo${value === 'annahmen' ? ' · Einmalige Einkünfte mit 50.000 € Rückzahlung · Details geschlossen' : value === 'backtesting' ? ' · Was im Lauf auffällt · Weitere geschlossen' : ''}`, maskDate,
                    'masken', value === 'backtesting' ? '#backtestAnalysis' : value === 'annahmen' ? '#tab-annahmen' : '#suiteMain',
                    value === 'backtesting' ? '#backtestAnalysis' : value === 'annahmen' ? '#plannedInflowsCard' : false);
            }
            await tab(page, 'werkstatt');
            await capture(masks, 'werkstatt', 'Werkstatt · Werkzeugauswahl', maskDate);
            for (const [name, tool, panel] of [['replay', 'replay', '#workshopReplayPanel'], ['sweep', 'sweep', '#tab-sweep'], ['auto-optimize', 'optimize', '#tab-auto-optimize']]) {
                await page.locator(`#workshopToolCards [data-workshop-tool="${tool}"]`).click();
                await capture(masks, `werkstatt-${name}`, `Werkstatt ${name} · Eingaben`, maskDate, 'masken', panel, true);
            }
            await goto(masks, 'index.html');
            await capture(masks, 'probelauf-band', 'Spielbereich · Testdatum, Kursmodus und Beenden', maskDate, 'masken', '#probelaufBand');
            await goto(masks, 'Handbuch.html');
            await capture(masks, 'handbuch-start', 'Handbuchstart mit Aufgaben, Kapitelnavigation und Suche', maskDate);
        } finally { await masks.context.close(); }
        }
        for (const annual of (annualOnly ? [true] : [false, true])) {
            const group = annual ? 'jahresabschluss' : 'monatsabschluss';
            const date = annual ? yearDate : monthDate;
            current = `${group} · Spielbereich starten und Datum wechseln`;
            const session = await newProbelauf(browser, baseUrl, annual ? '2026-12-15' : maskDate);
            try {
                const { page } = session; activePage = page;
                await changeDate(page, date);
                await capture(session, `${group}/01-faellig`, `${group} fällig`, date, group);
                await page.locator(annual ? '[data-overview-annual]' : '[data-overview-month-confirm]').click();
                const selector = annual ? '#balanceAnnualClose' : '#overviewMonthConfirmation';
                const dialog = page.locator(selector);
                await dialog.waitFor({ state: 'visible' });
                const steps = ['prices', 'expenses', 'budget', 'cash', ...(annual ? ['care', 'market', 'preview'] : [])];
                const names = ['kurse', 'ausgaben', 'budget', 'tagesgeld', 'pflegewerte', 'marktdaten', 'plan'];
                for (let i = 0; i < steps.length; i++) {
                    current = `${group} · ${steps[i]} öffnen`;
                    await dialog.locator(`[data-close-dialog-activate="${steps[i]}"]`).click();
                    if (steps[i] === 'expenses') await importExample(page, dialog);
                    if (steps[i] === 'cash') {
                        if (await dialog.locator('[data-tagesgeld-person]').count() !== 2) throw new Error('Tagesgeld muss Max und Erika zeigen.');
                    }
                    // Der Haken bestätigt den Besuch; vorhandene DOM-Texte melden die fertigen Daten.
                    if (steps[i] === 'market' || steps[i] === 'preview') await poll(page, ({ selector, id }) => {
                        const step = document.querySelector(`${selector} [data-close-dialog-step="${id}"]`);
                        if (step?.dataset.state !== 'done'
                            || document.querySelector(`${selector} [data-close-dialog-activate="${id}"]`)?.getAttribute('aria-current') !== 'step') return false;
                        return id === 'market'
                            ? step.querySelector('[data-annual-market-status]')?.textContent === 'Vollständig vorbereitet · noch nicht gespeichert'
                            : step.querySelector('[data-annual-plan-status]')?.textContent === 'Dein Plan ist gültig.';
                    }, { selector, id: steps[i] }, steps[i] === 'market' ? 'Vollständige Marktdaten' : 'Gerechnete Planvorschau');
                    if (steps[i] === 'care') {
                        await dialog.locator('[data-annual-care-editor]').evaluate(element => element.scrollIntoView({ block: 'start' }));
                        await page.screenshot({ path: path.join(reviewRoot, 'PG-2-pruefbild-pflegewerte.png') });
                        if (annualOnly) {
                            await dialog.locator('[data-annual-care-edit]').click();
                            await page.screenshot({ path: '/tmp/PG-2-pflegewerte-eingaben.png' });
                            await dialog.locator('[data-annual-care-edit]').click();
                        }
                        await dialog.locator('[data-annual-care-confirm]').click();
                    }
                    if (steps[i] === 'preview') {
                        await dialog.locator('[data-annual-plan-editor]').evaluate(element => element.scrollIntoView({ block: 'start' }));
                    }
                    const expectedStatus = steps[i] === 'budget'
                        ? `Noch offen: ${annual ? 'Tagesgeld am 31.12.2026' : 'Tagesgeld prüfen'}`
                        : steps[i] === 'market' ? 'Noch offen: Bedarf und Plan 2027 prüfen' : null;
                    if (expectedStatus && await dialog.locator('[data-close-dialog-status]').textContent() !== expectedStatus)
                        throw new Error(`Fuß-Status vor der Aufnahme muss „${expectedStatus}“ lauten.`);
                    await capture(session, `${group}/${String(annual && steps[i] === 'care' ? 7 : annual && steps[i] === 'market' ? 6 : i + 2).padStart(2, '0')}-${names[i]}`, `${group} · ${steps[i]}`, date, group, selector);
                    if (steps[i] === 'preview') {
                        await dialog.locator('#annualPlan_flexBedarf').fill('32000');
                        await dialog.locator('#annualPlan_flexBedarf').blur();
                        await poll(page, () => document.querySelector('[data-annual-plan-status]')?.textContent === 'Dein Plan ist gültig.', null, 'Geänderter Wunschbedarf');
                        await page.screenshot({ path: path.join(reviewRoot, 'PG-2-pruefbild-bedarf.png') });
                        if (annualOnly) {
                            for (const width of [1280, 2560]) {
                                await page.setViewportSize({ width, height: width === 2560 ? 1440 : 1080 });
                                const overflow = await dialog.locator('[data-annual-needs-review]').evaluate(el => el.scrollWidth > el.clientWidth);
                                if (overflow) throw new Error(`Bedarfsprüfung läuft bei ${width} px über.`);
                                await page.screenshot({ path: `/tmp/PG-2-bedarf-${width}.png` });
                            }
                            await page.setViewportSize(viewport);
                        }
                        const planSuggestion = dialog.locator('[data-annual-need-suggestion="flexBedarf:plan"]');
                        const roundedPlan = Number((await planSuggestion.textContent()).split(' · ').at(-1).replace(/[.\s€]/g, ''));
                        await planSuggestion.click();
                        await poll(page, async expected => {
                            const { readHouseholdPlanField } = await import('./app/shared/household-plan-fields.js');
                            return readHouseholdPlanField(document.querySelector('#annualPlan_flexBedarf'), 'flexBedarf') === expected;
                        },
                            roundedPlan, 'Aufgerundeter Planwert beim Wunschbedarf');
                        if (!Number.isFinite(roundedPlan) || roundedPlan % 1000 !== 0)
                            throw new Error('Der Planvorschlag muss auf volle Tausend aufgerundet sein.');
                    }
                }
                current = `${group} · Abschluss bestätigen`;
                await dialog.locator(annual ? '#annualConfirmBtn' : '[data-overview-month-accept]').click();
                await poll(page, annual ? () => {
                    const dialog = document.querySelector('#balanceAnnualClose');
                    return dialog?.dataset.annualYearResult === 'confirmed' && dialog.dataset.annualMonthResult === 'confirmed';
                } : () => document.querySelector('#overviewMonthConfirmation')?.dataset.monthResult === 'confirmed',
                null, `${group} bestätigt`);
                // Dauerhafte Belege lesen, ohne das Ergebnis durch einen zweiten Klick zu verändern.
                await poll(page, async ({ annual, month }) => {
                    const { PersistenceFacade: P } = await import('./app/shared/persistence-facade.js');
                    const records = await P.readPersistedRecords();
                    const provisions = JSON.parse(records.overview_month_provision_v1 || '{}');
                    const monthConfirmed = Object.values(provisions.entries || {}).some(item => item.month === month);
                    const metadata = JSON.parse(records.ruhestandsmodellValues_v29_guardrails || '{}').annualPeriodMetadata;
                    return monthConfirmed && (!annual || (metadata?.lastCommittedPeriod === 'calendar-year:2026' && records.annual_plan_record_v1));
                }, { annual, month: annual ? '2026-12' : '2026-10' }, 'Gespeicherte Abschlussbelege');
                await capture(session, `${group}/${annual ? '09' : '06'}-ergebnis`, `${group} · bestätigtes Ergebnis`, date, group, selector);
            } finally { await session.context.close(); }
        }
        // Dieselben unveränderten Engine-Fälle wie in den erzeugten Handbuchzahlen.
        // Der produktive Renderer bleibt auch bei voll finanziertem Flex unverändert.
        if (!annualOnly) {
        const budgetYears = calculateBudgetExamples().backtests[0].years;
        const budgetSession = await newProbelauf(browser, baseUrl, maskDate);
        try {
            await goto(budgetSession, 'Balance.html');
            await tab(budgetSession.page, 'overview');
            for (const item of HANDBOOK_BUDGET_CAPTURES) {
                const example = budgetYears.find(year => year.year === item.year);
                await budgetSession.page.evaluate(async ({ input, result }) => {
                    const { SummaryRenderer } = await import('./app/balance/balance-renderer-summary.js');
                    const ids = ['balanceMonthlyBudget', 'balanceAnnualBudget', 'balanceMonthlyIncome',
                        'balanceBudgetCut', 'balanceBudgetWhy', 'balanceBudgetTrace', 'monatlicheEntnahme',
                        'balanceIncomeDetails', 'balanceFlowBudget', 'balanceFlowNeed', 'balanceIncomeSurplusNote', 'balancePlannedExpensesNote',
                        'balanceFlowWithdrawal', 'balanceFlowWithdrawalSign', 'balanceFlowSaving', 'balanceFlowSavingSign', 'balanceMonthlySaving'];
                    const outputs = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
                    const renderer = new SummaryRenderer({ outputs });
                    renderer.renderPlanCards({ ...result.ui, input });
                    renderer.renderEntnahme(result.ui.spending);
                    // Heutiger Planvergleich, Ausgaben und Personendaten gehören nicht zum historischen Beispiel.
                    for (const selector of ['#balanceBudgetPreview', '#balanceBudgetPlan', '#balanceWithdrawalPlan', '.balance-expenses-summary', '#balanceBudgetChips', '#entnahme-breakdown']) {
                        // display:grid/flex der App überschreibt das native hidden.
                        document.querySelector(selector)?.style.setProperty('display', 'none');
                    }
                }, example);
                const why = budgetSession.page.locator('#balanceBudgetWhy');
                if (item.year === 2002) {
                    await why.click();
                    await budgetSession.page.locator('#balanceBudgetTrace').waitFor({ state: 'visible' });
                } else if (await why.isVisible()) throw new Error('Das normale Beispiel darf keine Kürzung erfinden.');
                await capture(budgetSession, item.name,
                    `Budgetbeschluss nach Jahresrendite ${item.year} · Musterwerte 17.10.2026 · Dynamic Flex aus`,
                    maskDate, 'jahresbudget', '.ov-hero', true);
            }
        } finally { await budgetSession.context.close(); }
        }
        }
        if (comparisonOnly) {
            const band = await newProbelauf(browser, baseUrl, maskDate);
            try {
                await capture(band, 'probelauf-band', 'Spielbereich · Zeitraffer links von Beenden', maskDate, 'masken', '#probelaufBand');
                await band.page.locator('[data-probelauf-action="end"]').click();
                const dialog = band.page.locator('.probelauf-end-dialog[open][data-comparison-status="ready"]');
                await dialog.waitFor();
                if (await dialog.locator('table, details').count() || await dialog.getByRole('button', { name: 'Übernehmen …', exact: true }).count()) throw new Error('Max und Erika zeigt einen Vergleich oder Übernehmen.');
                await dialog.getByRole('heading', { name: 'Spielbereich beenden?', exact: true }).waitFor();
                await dialog.getByRole('button', { name: 'Weiter spielen', exact: true }).click();
            } finally { await band.context.close(); }
        }
        if (!annualOnly && !protocolOnly && !historyOnly && !sophieOnly && !uiOnly) {
        current = 'Spielbereich vergleichen';
        const comparison = await newProbelauf(browser, baseUrl, realToday, 'copy');
        try {
            activePage = comparison.page;
            await comparison.page.evaluate(async () => {
                const { PersistenceFacade: p } = await import('./app/shared/persistence-facade.js');
                p.setItemSync('profile_gold_aktiv', 'true'); p.setItemSync('profile_gold_ziel_pct', '10');
                p.setItemSync('profile_tagesgeld', '20000');
                const plan = JSON.parse(p.getItemSync('household_plan_v1'));
                Object.values(plan.entries)[0].values.flexBedarf = 32000;
                p.setItemSync('household_plan_v1', JSON.stringify(plan)); await p.flush();
            });
            await comparison.page.locator('#probelaufBand [data-probelauf-action="end"]').click();
            const dialog = comparison.page.locator('.probelauf-end-dialog[open][data-comparison-status="ready"]');
            await dialog.waitFor();
            const budget = dialog.locator('tbody tr').nth(0);
            if (!(await budget.textContent()).includes('mehr')) throw new Error('Vergleich zeigt kein höheres Monatsbudget.');
            if (!(await dialog.locator('tbody tr').nth(1).textContent()).includes('Gold kaufen')) throw new Error('Vergleich zeigt keine Gold-Handlungsanweisung.');
            if ((await dialog.textContent()).includes('nicht berechenbar')) throw new Error('Vergleich ist nicht berechenbar.');
            await capture(comparison, 'spielbereich-vergleich', 'Spielbereich beenden · frische Vorschau heute mit höherem Monatsbudget und Goldkauf', realToday, 'masken', '.probelauf-end-dialog');
        } finally { await comparison.context.close(); }
        }
        if (!annualOnly && !protocolOnly && !comparisonOnly && !historyOnly && !uiOnly) {
            const sophie = await newProbelauf(browser, baseUrl, maskDate, 'demo', 'sophie');
            try {
                await goto(sophie, 'depot-tranchen-manager.html');
                await sophie.page.locator('#managerSectionNav [data-manager-profile="muster_sophie"]').click();
                await sophie.page.locator('#managerIncomeToggle').click();
                await capture(sophie, 'personen-sophie', 'Sophie · Gehalt bis Dezember 2037, Rente ab Januar 2038', maskDate,
                    'masken', '#managerIncome', true);
                await captureSavingsYear(sophie, goto);
            } finally { await sophie.context.close(); }
        }
        }
        if (!annualOnly && (wealthOnly || !protocolOnly && !comparisonOnly && !historyOnly && !sophieOnly && !uiOnly)) {
            const session = await newProbelauf(browser, baseUrl, maskDate);
            try {
                const { page } = session; activePage = page;
                await goto(session, 'depot-tranchen-manager.html');
                await page.locator('#managerSectionNav [data-manager-profile="muster_a"]').click();
                await page.locator('#managerIncomeToggle').click();
                await page.locator('#profileOneTimeIncomeAdd').click();
                await page.locator('#income-0-monat').fill('01.2028');
                await page.locator('#income-0-betrag').fill('50000');
                await page.locator('#income-0-bezeichnung').fill('Rückzahlung');
                await page.locator('#income-0-bezeichnung').blur();
                await poll(page, () => document.querySelector('#tranchePersistenceStatus')?.textContent === 'Profilwerte dauerhaft gespeichert.', null, 'Einmalige Einkunft speichern');
                await capture(session, 'personen-max', 'Max · Einkünfte mit 50.000 € Rückzahlung', maskDate, 'masken', '#managerIncome', true);
                await page.locator('#managerSectionNav [data-manager-profile="muster_b"]').click();
                await capture(session, 'personen-erika', 'Erika · Personendetails geschlossen und Vermögenskarte mit Tagesgeld', maskDate, 'masken', '#managerPersonPanel', '#personendaten');
                // UR-1b: Erikas Einkünfte zeigen die vom Hauptprofil übernommene Rentenanpassung mit Grund.
                await page.locator('#managerIncomeToggle').click();
                await page.locator('#profilePensionAdoptedReason').waitFor({ state: 'visible' });
                await capture(session, 'personen-erika-einkuenfte', 'Erika · Einkünfte mit übernommener Rentenanpassung', maskDate, 'masken', '#managerIncome', true);
                await page.locator('#managerIncomeToggle').click();
                for (const width of [1920, 2560, 1280]) {
                    await page.setViewportSize({ width, height: width === 2560 ? 1440 : 1080 });
                    await page.locator('#managerDepotTitle').scrollIntoViewIfNeeded();
                    await page.screenshot({ path: `/tmp/pv2-vermoegen-${width}.png` });
                }
                await page.setViewportSize(viewport);
                await page.locator('#managerCashEdit').click();
                await page.locator('#profileTagesgeld').press('ArrowRight');
                await capture(session, 'tagesgeld-bearbeiten', 'Erika · Tagesgeld im Bearbeitungszustand', maskDate, 'masken', '.pv-depot', true);
                await page.locator('#profileTagesgeld').press('Escape');
                await goto(session, 'Simulator.html');
                await tab(page, 'annahmen');
                await page.locator('#simPlanParameters').evaluate(details => { details.open = false; });
                await capture(session, 'simulator-annahmen', 'Monatszeile und Jahrestabelle', maskDate, 'masken', '#simPlanOverview', true);
                if (!wealthOnly) await captureGU1B(session, goto, capture);
            } finally { await session.context.close(); }
        }
        }
        if (!annualOnly && !inheritanceOnly && !partnershipOnly && (careOnly || !protocolOnly && !comparisonOnly && !historyOnly && !sophieOnly && !uiOnly && !wealthOnly)) {
            const session = await newProbelauf(browser, baseUrl, maskDate);
            try {
                const { page } = session; activePage = page;
                await goto(session, 'depot-tranchen-manager.html');
                await page.locator('#managerSectionNav [data-manager-profile="muster_a"]').click();
                await page.locator('#managerPersonToggle').click();
                await page.locator('#profileCareGradeToday').selectOption('2');
                try {
                    await poll(page, () => document.querySelector('#tranchePersistenceStatus')?.textContent === 'Profilwerte dauerhaft gespeichert.', null, 'Heutigen Pflegegrad speichern');
                } catch (error) {
                    await page.screenshot({ path: '/tmp/pg-1-bilder-fehler.png' });
                    const state = await page.evaluate(() => Object.fromEntries(['profileCareGradeToday', 'profileCareProgression', 'profileValidationStatus', 'tranchePersistenceStatus'].map(id => {
                        const field = document.getElementById(id); return [id, { value: field?.value, text: field?.textContent, hidden: field?.hidden }];
                    })));
                    throw new Error(`${error.message}; ${JSON.stringify(state)}; ${session.errors.join('; ')}`);
                }
                await page.locator('#profileCareProgression').selectOption('slower');
                await poll(page, () => document.querySelector('#tranchePersistenceStatus')?.textContent === 'Profilwerte dauerhaft gespeichert.', null, 'Heutige Pflegefelder speichern');
                await capture(session, 'personen-pflegegrad', 'Person & Steuern · heutiger Pflegegrad 2', maskDate, 'masken', '.pv-person-disclosure', true);
                await page.locator('#profileCareFormToday').selectOption('family');
                await poll(page, () => document.querySelector('#profileCareAllowanceSummary')?.textContent.includes('347'), null, 'Pflegeform heute und Pflegegeld');
                await page.screenshot({ path: path.join(reviewRoot, 'VF-2c-pruefbild-person.png'), animations: 'disabled' });
                await page.screenshot({ path: path.join(reviewRoot, 'PG-1b-pruefbild-person.png'), animations: 'disabled' });
                await page.locator('#profileCareBenefitsButton').click();
                await page.screenshot({ path: '/tmp/pg-1b-pruefbild-info.png', animations: 'disabled' });
                await page.locator('#profileCareBenefitsButton').press('Escape');
                await page.setViewportSize({ width: 1280, height: 1080 });
                await page.screenshot({ path: path.join(reviewRoot, 'PG-1b-pruefbild-person-1280.png'), animations: 'disabled' });
                const widths = await page.locator('.pv-person-disclosure .pv-person-group').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
                // UR-1: Person und Steuern als zwei gleich breite Spalten, Pflege als Band darunter.
                if (widths.length !== 2 || Math.max(...widths) - Math.min(...widths) > 1) throw new Error('Personenkarte braucht zwei gleich breite Spalten.');
                await page.setViewportSize({ width: 2560, height: 1440 });
                await page.screenshot({ path: '/tmp/pg-1-person-2560.png', animations: 'disabled' });
                await page.setViewportSize(viewport);
                await goto(session, 'Balance.html');
                await poll(page, () => [...document.querySelectorAll('#balanceIncomeDetails .monthly-flow-detail-row')].some(row =>
                    row.firstElementChild?.textContent.startsWith('Pflegegeld ')
                    && row.lastElementChild?.textContent.includes('€')), null, 'Pflegegeld im Balance-Geldfluss');
                await page.locator('#results .monthly-flow').scrollIntoViewIfNeeded();
                await page.screenshot({ path: path.join(reviewRoot, 'PG-1b-pruefbild-balance.png'), animations: 'disabled' });
                await page.setViewportSize({ width: 2560, height: 1440 });
                await goto(session, 'Simulator.html');
                await tab(page, 'annahmen');
                await poll(page, () => document.querySelector('#simCareTodaySummary')?.textContent.includes('Grad 2'), null, 'Heutiger Pflegegrad im Simulator');
                await page.locator('#simCareTodaySummary').scrollIntoViewIfNeeded();
                await page.screenshot({ path: '/tmp/pg-1-simulator-2560.png', animations: 'disabled' });
                await page.setViewportSize(viewport);
                // PFA-10: Die Pflegewerte stehen in Personen & Vermögen › Pflege; der Simulator zeigt sie nur noch an.
                await page.locator('#simCareValuesSummary').scrollIntoViewIfNeeded();
                if (!await page.locator('#simCareValuesSummary a[href="depot-tranchen-manager.html#pflege"]').isVisible()) throw new Error('Simulator braucht den Link zu Personen & Vermögen › Pflege.');
                await goto(session, 'depot-tranchen-manager.html');
                await page.locator('#managerCareTab').click();
                await page.locator('#managerCarePanel').waitFor({ state: 'visible' });
                await poll(page, () => document.querySelector('#managerCareToday')?.textContent.includes('Grad 2'), null, 'Pflege heute im Bereich Pflege');
                await page.screenshot({ path: path.join(reviewRoot, 'UR-1-pruefbild-pflege-zu.png'), animations: 'disabled' });
                // UR-2: Das Handbuchbild zeigt die Felder; dafür ist „Pflege im Heim“ mit den drei Bestandteilen aufgeklappt.
                await page.locator('#managerCareRowHeimToggle').click();
                await page.locator('#managerCareHeimCare').waitFor({ state: 'visible' });
                await capture(session, 'personen-pflege', 'Personen & Vermögen › Pflege · Annahmen mit aufgeklapptem „Pflege im Heim“', maskDate, 'masken', '#managerCarePanel .pv-care-card:has(#managerCareRowHomeBody)', true);
                await page.locator('#managerCareRowHeimToggle').click();
                await page.locator('#managerCareRowHomeToggle').click();
                await page.locator('#managerCareCost3').waitFor({ state: 'visible' });
                await page.screenshot({ path: path.join(reviewRoot, 'VF-2c-pruefbild-staffel.png'), animations: 'disabled' });
                await page.screenshot({ path: path.join(reviewRoot, 'PG-1b-pruefbild-staffel.png'), animations: 'disabled' });
                const saved = () => poll(page, () => document.querySelector('#managerCareStatus')?.textContent === 'Gespeichert', null, 'Pflegewerte speichern');
                await page.locator('#managerCarePreset [data-care-preset="amtlich"]').click(); await saved();
                if (await page.locator('#managerCareForm2').isVisible()) throw new Error('Amtlicher Durchschnitt darf keine Pflegeform zeigen.');
                await page.locator('#managerCarePreset [data-care-preset="custom"]').click(); await saved();
                for (const [index, amount] of [6000, 12000, 18000, 32000, 60000].entries()) {
                    // FR-72: Zeilen „im Heim“ ruhen mit „Heimkosten“ und lassen sich nicht füllen.
                    const field = page.locator(`#managerCareCost${index + 1}`);
                    if (await field.isEnabled()) { await field.fill(String(amount)); await field.press('Enter'); await saved(); }
                }
                await goto(session, 'Simulator.html');
                await tab(page, 'montecarlo');
                await page.locator('#mcSettingsToggle').click();
                await page.locator('#mcAnzahl').fill('128');
                await page.locator('#mcSeed').fill(String(seed));
                await page.locator('#mcSeed').blur();
                await page.locator('#mcSettingsToggle').click();
                await page.locator('#mcButton').click();
                await poll(page, () => !document.querySelector('#mcButton')?.disabled && !document.querySelector('#exportMonteCarloRunJson')?.disabled,
                    null, 'Pflegegeld im Monte-Carlo-Protokoll', 60000);
                await page.locator('[data-mc-view="logs"]').click();
                await page.locator('#scenarioComparison [data-comparison-preset="default"]').click();
                await page.locator('#scenarioComparison [data-scenario-id]').first().click();
                await openProtocols(page);
                const row = page.locator('#scenarioLogOutput tbody tr').first();
                await row.getByRole('button', { name: 'Einnahmen: Aufschlüsselung des Jahres', exact: true }).click();
                await row.locator('.ds-info[data-visible="true"] .ds-info-pop').getByText('Pflegegeld Max', { exact: true }).waitFor({ state: 'visible' });
                await page.screenshot({ path: path.join(reviewRoot, 'PG-1b-pruefbild-protokoll.png'), animations: 'disabled' });
            } finally { await session.context.close(); }
        }
        if (!annualOnly && (partnershipOnly || !careOnly && !protocolOnly && !comparisonOnly && !historyOnly && !sophieOnly && !uiOnly && !wealthOnly)) {
            const session = await newProbelauf(browser, baseUrl, maskDate);
            try {
                const { page } = session; activePage = page;
                await goto(session, 'depot-tranchen-manager.html');
                await page.locator('#managerSectionNav [data-manager-profile="muster_a"]').click();
                for (const home of [{ bezeichnung: 'Haus', wert: '450000', nutzung: 'selbst' },
                    { bezeichnung: 'Wohnung Leipzig', wert: '210000', nutzung: 'vermietet', mieteNetto: '650' }]) {
                    await page.locator('[data-home-action="add"]').click();
                    await page.locator('#home-bezeichnung').fill(home.bezeichnung);
                    await page.locator('#home-wert').fill(home.wert);
                    await page.locator('#home-stand').fill('10.2026');
                    if (home.nutzung === 'vermietet') {
                        await page.locator('[data-home-choice="nutzung"][data-value="vermietet"]').click();
                        await page.locator('#home-mieteNetto').fill(home.mieteNetto);
                        await page.locator('[data-home-choice="anpassung"][data-value="inflation"]').click();
                    }
                    await page.locator('[data-home-action="save"]').click();
                    await poll(page, () => document.querySelector('#tranchePersistenceStatus')?.textContent === 'Profilwerte dauerhaft gespeichert.', null, 'Immobilie speichern');
                }
                await page.locator('#managerSectionNav [data-manager-view="plan"]').click();
                await page.locator('#managerPartnershipToggle').click();
                await page.locator('[data-partnership="unmarried"]').click();
                await poll(page, () => document.querySelector('#managerPartnershipStatus').textContent === 'Gespeichert', null, 'Partnerschaft speichern');
                await page.locator('#inheritance-0').fill('0');
                await page.locator('#inheritance-0').press('Enter');
                await poll(page, () => document.querySelector('#managerPartnershipStatus').textContent === 'Gespeichert', null, 'Erbanteil speichern');
                await page.locator('[data-inheritance-home="muster_a"]').check();
                await poll(page, () => document.querySelector('#managerPartnershipStatus').textContent === 'Gespeichert', null, 'Immobilien und Steuergeld speichern');
                await capture(session, 'partnerschaft-todesfall', 'Nicht verheiratet · Erika erbt Immobilien und Steuergeld · zusätzlich 0 %', maskDate, 'masken', '#managerPartnership', true);
                await page.screenshot({ path: path.join(reviewRoot, 'EP-2-pruefbild-partnerschaft.png'), animations: 'disabled' });
                await page.locator('[data-partnership="married"]').click();
                await poll(page, () => document.querySelector('#managerPartnershipStatus').textContent === 'Gespeichert', null, 'Ehe speichern');
                await page.locator('#managerPartnership').scrollIntoViewIfNeeded();
                await page.screenshot({ path: path.join(reviewRoot, 'EP-1-pruefbild-verheiratet-100.png'), animations: 'disabled' });
                await page.locator('#inheritance-0').fill('50');
                await page.locator('#inheritance-0').press('Enter');
                await poll(page, () => document.querySelector('#managerPartnershipStatus').textContent === 'Gespeichert', null, 'Ehequote speichern');
                await capture(session, 'partnerschaft-verheiratet', 'Verheiratet · Erika erbt 50 % von Max · Klasse I mit Familienheim', maskDate, 'masken', '#managerPartnership', true);
                await page.screenshot({ path: path.join(reviewRoot, 'EP-1-pruefbild-verheiratet-50.png'), animations: 'disabled' });
                await page.locator('[data-partnership="unmarried"]').click();
                await poll(page, () => document.querySelector('#managerPartnershipStatus').textContent === 'Gespeichert', null, 'Partnerschaft zurückstellen');
                if (pt1Only) {
                    await page.screenshot({ path: path.join(reviewRoot, 'PT-1-pruefbild-partnerschaft-offen.png'), animations: 'disabled' });
                    await page.locator('#managerPartnershipToggle').click();
                    await capture(session, 'personen-haushalt-plan', 'Bedarf vor Partnerschaft und Todesfall · Partnerschaft eingeklappt', maskDate, 'masken', '#managerPlanPanel', '#managerHouseholdPlan');
                    await page.screenshot({ path: path.join(reviewRoot, 'PT-1-pruefbild-haushalt-plan.png'), animations: 'disabled' });
                } else {
                    await page.screenshot({ path: path.join(reviewRoot, 'UP-1a-pruefbild-haushalt.png'), animations: 'disabled' });
                    for (const width of [1280, 2560]) {
                        await page.setViewportSize({ width, height: width === 2560 ? 1440 : 1080 });
                        await page.locator('#managerPartnership').scrollIntoViewIfNeeded();
                        await page.screenshot({ path: `/tmp/up1a-haushalt-${width}.png`, animations: 'disabled' });
                    }
                    await page.setViewportSize(viewport);
                    await page.locator('#managerSectionNav [data-manager-profile="muster_a"]').click();
                    await page.locator('#tranchenTable [data-asset-group^="home"]').evaluateAll(groups => groups.forEach(group => { group.open = true; }));
                    await page.locator('[data-asset-group="homeRented"] [data-home-open]').first().click();
                    await capture(session, 'personen-immobilien', 'Max · zwei Immobilien · vermietete Wohnung geöffnet', maskDate, 'masken', '.pv-depot', true);
                    await page.screenshot({ path: path.join(reviewRoot, 'UP-1a-pruefbild-person.png'), animations: 'disabled' });
                    for (const width of [1280, 2560]) {
                        await page.setViewportSize({ width, height: width === 2560 ? 1440 : 1080 });
                        await page.locator('.pv-depot').evaluate(node => node.scrollIntoView({ block: 'start' }));
                        await page.screenshot({ path: `/tmp/up1a-person-${width}.png`, animations: 'disabled' });
                    }
                    await page.setViewportSize(viewport);
                    await page.locator('[data-home-action="cancel"]').click();
                    await page.locator('#managerIncomeToggle').click();
                    await page.locator('#managerIncome').scrollIntoViewIfNeeded();
                    await page.screenshot({ path: '/tmp/up1a-einkuenfte.png', animations: 'disabled' });
                    await goto(session, 'Simulator.html');
                    await tab(page, 'annahmen');
                    await page.locator('#widowPensionSection').evaluate(node => { for (let parent = node.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true; });
                    await capture(session, 'simulator-hinterbliebene', 'Erbanteile · gesperrte Rentenfelder · Hinterbliebenenbedarf 75/50/50 %', maskDate, 'masken', '#widowPensionSection', true);
                    await page.screenshot({ path: path.join(reviewRoot, 'HN-1-pruefbild.png'), animations: 'disabled' });
                }
            } finally { await session.context.close(); }
        }
        if (!annualOnly && (inheritanceOnly || protocolOnly || !careOnly && !comparisonOnly && !historyOnly && !sophieOnly && !uiOnly && !wealthOnly)) {
            const session = await newProbelauf(browser, baseUrl, maskDate);
            try {
                const { page } = session; activePage = page;
                await goto(session, 'depot-tranchen-manager.html');
                await page.locator('#managerSectionNav [data-manager-profile="muster_a"]').click();
                for (const home of [{ bezeichnung: 'Haus', wert: '450000', nutzung: 'selbst' },
                    { bezeichnung: 'Wohnung Leipzig', wert: '210000', nutzung: 'vermietet', mieteNetto: '650' }]) {
                    await page.locator('[data-home-action="add"]').click();
                    await page.locator('#home-bezeichnung').fill(home.bezeichnung);
                    await page.locator('#home-wert').fill(home.wert);
                    await page.locator('#home-stand').fill('10.2026');
                    if (home.nutzung === 'vermietet') {
                        await page.locator('[data-home-choice="nutzung"][data-value="vermietet"]').click();
                        await page.locator('#home-mieteNetto').fill(home.mieteNetto);
                        await page.locator('[data-home-choice="anpassung"][data-value="inflation"]').click();
                    }
                    await page.locator('[data-home-action="save"]').click();
                    await poll(page, () => document.querySelector('#tranchePersistenceStatus')?.textContent === 'Profilwerte dauerhaft gespeichert.', null, 'Immobilie speichern');
                }
                await page.locator('#managerSectionNav [data-manager-view="plan"]').click();
                await page.locator('#managerPartnershipToggle').click();
                await page.locator('[data-partnership="unmarried"]').click();
                await poll(page, () => document.querySelector('#managerPartnershipStatus').textContent === 'Gespeichert', null, 'Partnerschaft speichern');
                await page.locator('#inheritance-0').fill('0');
                await page.locator('#inheritance-0').press('Enter');
                await poll(page, () => document.querySelector('#managerPartnershipStatus').textContent === 'Gespeichert', null, 'Erbanteil speichern');
                await page.locator('[data-inheritance-home="muster_a"]').check();
                await poll(page, () => document.querySelector('#managerPartnershipStatus').textContent === 'Gespeichert', null, 'Immobilien und Steuergeld speichern');
                await goto(session, 'Simulator.html');
                await tab(page, 'montecarlo');
                await page.locator('#mcSettingsToggle').click();
                await page.locator('#mcAnzahl').fill('128');
                await page.locator('#mcSeed').fill(String(seed));
                await page.locator('#mcSeed').blur();
                await page.locator('#mcSettingsToggle').click();
                await page.locator('#mcButton').click();
                await poll(page, () => !document.querySelector('#mcButton')?.disabled && !document.querySelector('#exportMonteCarloRunJson')?.disabled,
                    null, 'Monte-Carlo-Todesjahr', 60000);
                await page.locator('[data-mc-view="logs"]').click();
                await page.locator('#scenarioComparison [data-comparison-preset="default"]').click();
                const cards = page.locator('#scenarioComparison [data-scenario-id]');
                let found = false;
                for (let i = 0; i < await cards.count(); i++) {
                    await cards.nth(i).click();
                    if (await page.locator('#scenarioLogOutput tbody tr').filter({ hasText: 'aus geerbtem Steuergeld' }).count()) { found = true; break; }
                }
                if (!found) throw new Error('Kein gerechnetes Todesjahr im Musterlauf.');
                await openProtocols(page);
                const toggle = page.locator('#toggle-log-detail');
                if (await toggle.isChecked()) await toggle.locator('..').click();
                const info = page.locator('#scenarioLogOutput tbody tr').filter({ hasText: 'aus geerbtem Steuergeld' }).first().getByRole('button', { name: 'Erbe: Aufschlüsselung des Todesjahres', exact: true });
                await info.scrollIntoViewIfNeeded();
                await info.click();
                await page.locator('.ds-info[data-visible="true"] .ds-info-pop').getByText('Erbschaftsteuer', { exact: true }).waitFor({ state: 'visible' });
                await capture(session, 'protokoll-monte-carlo', 'Nicht verheiratet · Immobilien und Steuergeld · Erbschaftsteuer > 0 mit Herkunft', maskDate, 'masken', '#scenarioLogOutput', true);
                await page.screenshot({ path: path.join(reviewRoot, 'UP-1b-pruefbild-protokoll.png'), animations: 'disabled' });
                await page.keyboard.press('Escape');
                await toggle.locator('..').click();
                await page.getByRole('button', { name: 'Erbe: Aufschlüsselung des Todesjahres', exact: true }).first().scrollIntoViewIfNeeded();
                await page.locator('#scenarioLogOutput [data-protocol-column="inheritance-tax"]').evaluate(node => node.scrollIntoView({ block: 'nearest', inline: 'end' }));
                await capture(session, 'protokoll-monte-carlo-details', 'Nicht verheiratet · Todesjahr · Detailliert mit An Erben und Erbschaftsteuer', maskDate, 'masken', '#scenarioLogOutput', true);
                for (const image of images.filter(item => inheritanceFiles.includes(item.path))) image.caption = image.path.includes('-details')
                    ? 'Monte-Carlo-Protokoll: Detailliert ergänzt die Jahresphasen; An Erben und Erbschaftsteuer stehen auch in Normal.'
                    : 'Monte-Carlo-Protokoll: Das Erbe-ⓘ zeigt positive Erbschaftsteuer und ihre Herkunft aus geerbtem Steuergeld.';
            } finally { await session.context.close(); }
        }
        }
        if (hp1Protocols) return;
        images.sort((a, b) => allImageFiles.indexOf(a.path) - allImageFiles.indexOf(b.path));
        for (let index = images.length - 1; index >= 0; index--) {
            if (images.findLastIndex(item => item.path === images[index].path) !== index) images.splice(index, 1);
        }
        const expectedImages = comparisonOnly ? allImageFiles.filter(file => !budgetImageFiles.includes(file)
            || images.some(image => image.path === file)) : allImageFiles;
        if (images.length !== expectedImages.length) throw new Error(`Erwartet: ${expectedImages.length} Bilder; erzeugt: ${images.length}.`);
        const totalBytes = images.reduce((sum, image) => sum + image.bytes, 0);
        const durationSeconds = Number(((performance.now() - started) / 1000).toFixed(2));
        await fs.writeFile(path.join(root, 'docs/ui/README.md'), readme(images));
        await fs.writeFile(path.join(root, 'docs/ui/monatsabschluss.html'), flowHtml('monatsabschluss', 'Monat abschließen',
            'Du startest den Spielbereich am 20.10.2026 und wechselst auf den 10.11.2026. Der Oktoberabschluss stellt den Monatsbetrag für November bereit.', images.filter(item => item.group === 'monatsabschluss')));
        await fs.writeFile(path.join(root, 'docs/ui/jahresabschluss.html'), flowHtml('jahresabschluss', 'Jahr abschließen',
            'Du startest einen eigenen Spielbereich am 15.12.2026 und wechselst auf den 02.01.2027. Ein Hauptklick bestätigt 2026, schließt Dezember ab und schreibt den Plan für 2027.', images.filter(item => item.group === 'jahresabschluss')));
        // Erst der vollständige Lauf ersetzt das Manifest; Teilaufnahmen bleiben erkennbar.
        await fs.writeFile(path.join(root, 'docs/ui/manifest.json'), JSON.stringify({
            schemaVersion: 1, imageCount: images.length, totalBytes, durationSeconds, images
        }, null, 2) + '\n');
        const handbookFile = path.join(root, 'Handbuch.html');
        let handbook = replaceGenerated(await fs.readFile(handbookFile, 'utf8'),
            'docs:monatsbetrag', renderHandbookBudgetExamples(images));
        // Alle eingebundenen Ausschnitte folgen ihren tatsächlichen Bildmaßen.
        for (const item of images) {
            handbook = handbook.replace(new RegExp(`(src="${item.path}" width=")\\d+(" height=")\\d+`), `$1${item.width}$2${item.height}`);
        }
        await fs.writeFile(handbookFile, handbook);
        console.log(`${images.length} Bilder · ${totalBytes} Bytes · ${(totalBytes / 1000000).toFixed(2)} MB · ${durationSeconds} Sekunden`);
        if (totalBytes > 4000000) console.log('Größenziel von etwa 4 MB überschritten; Ausschnitte im Ergebnisbericht bewerten.');
    } catch (error) {
        let detail = '';
        if (partnershipOnly && activePage && !activePage.isClosed()) { await activePage.screenshot({ path: '/tmp/up1a-bilder-fehler.png' }); console.log(await activePage.locator('#managerPartnershipStatus').textContent().catch(() => ''), await activePage.locator('#profileValidationStatus').textContent().catch(() => '')); }
        if (activePage && !activePage.isClosed()) detail = await activePage.locator('[role="status"]:visible, [data-close-dialog-message]:visible').allTextContents().then(items => items.filter(Boolean).join(' · ')).catch(() => '');
        throw new Error(`Bilderzeugung abgebrochen bei „${current}“: ${error.message}${detail ? '\nSeitenstatus: ' + detail : ''}`, { cause: error });
    } finally {
        await browser?.close(); server.closeAllConnections?.();
        if (server.listening) await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
