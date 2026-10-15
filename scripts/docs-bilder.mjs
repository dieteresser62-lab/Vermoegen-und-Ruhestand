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

const root = fileURLToPath(new URL('../', import.meta.url));
const viewport = { width: 1920, height: 1080 };
const household = 'Max und Erika Mustermann';
const seed = 12345;
const maskDate = '2026-10-20';
const monthDate = '2026-11-10';
const yearDate = '2027-01-02';
// Echtes „heute“ vor allen Testdaten: Ein Testdatum gleich heute gilt im Spielbereich als „Stand heute“ ohne Spielkurse.
const realToday = '2026-10-15';
const captions = [
    'Auf der Übersicht steht, was als Nächstes ansteht.',
    'Haushalt & Plan zeigt Vermögen und Bedarf; Weitere Planwerte ist zugeklappt.',
    'Max zeigt Auf einen Blick und die geöffnete Karte Person, Rente & Steuern.',
    'Erika geht später in Rente als Max.',
    'Der Verlauf fasst das Haushaltsvermögen zusammen.',
    'Max’ Vermögen lässt sich einzeln verfolgen.',
    'Erikas Vermögen ist einzeln sichtbar.',
    'Ausgaben zeigt Monats- und Jahreswerte.',
    'Überblick trennt Beschluss und Vorschau.',
    'Bedarf & Strategie zeigt die Bedarfswerte; Alle Parameter fasst die Planwerte zusammen und ist zugeklappt.',
    'Diagnose erklärt die Empfehlung.',
    'Ergebnis zeigt Backtest und MC.',
    'Annahmen zeigt Bedarf, Personen und Pflege; Alle Parameter fasst dieselben Planwerte wie Haushalt & Plan zusammen.',
    'Was im Lauf auffällt zeigt drei Backtest-Karten und Jahreslinks; Weitere bleibt geschlossen.',
    'Simulation, Zeitraum & Daten und Stresstest stehen in Einstellungen; Erweitert zeigt die technischen Optionen.',
    'Überblick zeigt den Musterlauf.',
    'Die Verteilung macht die Streuung sichtbar.',
    'Pflege zeigt das Modellrisiko.',
    'Pfade vergleichen zeigt P10, Median und P90 mit Gesamtanteilen und Kennzahlen der Einzelpfade.',
    'Drei Werkzeuge stehen in der Werkstatt bereit.',
    'Replay zeigt die Pfadeingaben.',
    'Parameter-Sweep zeigt die Eingaben.',
    'Auto-Optimize zeigt die Sucheingaben.',
    'Der Datenstatus steht in Daten & Sicherung.',
    'Das Band zeigt Testdatum und Kursmodus; Ein Jahr durchspielen steht links von Spielbereich beenden.',
    'Eine Kopie ohne Datumssprung zeigt beim Beenden den Vergleich Echt / Spielbereich.',
    'Die Startseite zeigt die Aufgaben im aktuellen Handbuch.',
    'Die Übersicht bietet den Oktoberabschluss an.',
    'Kurse prüfen zeigt die vorhandenen Kursstände.',
    'Ausgaben Oktober zeigt den Importstand.',
    'Drei Kacheln zeigen Ausgaben, Monatsbudget und Abweichung.',
    'Tagesgeld zeigt Lesewerte und die Bestätigung je Person.',
    'Drei Kacheln zeigen den Oktoberabschluss; Herleitung anzeigen ist zugeklappt.',
    'Die Übersicht bietet den Jahresabschluss an.',
    'Kurse prüfen zeigt die vorhandenen Kursstände.',
    'Ausgaben Dezember zeigt den Importstand.',
    'Der Vergleich zeigt Dezemberausgaben und Jahreswerte.',
    'Tagesgeld zeigt bestätigte Jahresendstände.',
    'Drei Kacheln zeigen Inflation, ETF-Schlusskurs und CAPE mit gemeinsamer Herkunft.',
    'Plan 2027 zeigt Werte und bewusste Anpassung.',
    'Das Ergebnis zeigt die Handlungsanweisung, das Monatsbudget und geschlossene Herleitungen.'
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

async function newProbelauf(browser, baseUrl, date, source = 'demo') {
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
        await dialog.getByLabel('Datenquelle').selectOption(source);
        if (date !== realToday) {
            await dialog.getByLabel('Kursmodus').selectOption({ label: 'Testdatum wählen' });
            await dialog.getByLabel('Testdatum').fill(date);
        }
        await reloadDate(page, () => dialog.getByRole('button', { name: 'Spielbereich starten', exact: true }).click(), date);
        return { context, page, errors };
    } catch (error) { await context.close(); throw error; }
}

async function changeDate(page, date) {
    await page.locator('#probelaufBand [data-probelauf-action="date"]').click();
    const dialog = page.locator('[data-probelauf-dialog]');
    await dialog.getByLabel('Testdatum').fill(date);
    await reloadDate(page, () => dialog.getByRole('button', { name: 'Datum übernehmen', exact: true }).click(), date);
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

Die Bilder zeigen Max und Erika Mustermann mit synthetischen Daten. Öffne [Monat abschließen](monatsabschluss.html) oder [Jahr abschließen](jahresabschluss.html), um den Ablauf Schritt für Schritt anzusehen. Beide Bildfolgen laufen offline.

## Bilder erneuern

Führe im Repository \`npm run docs:bilder\` aus. Du brauchst die installierten npm-Abhängigkeiten und Playwright Chromium. Fehlt der Browser, installiere ihn einmal mit \`npx playwright install chromium\`.

Das Werkzeug startet denselben lokalen Server wie \`npm run serve\`, ohne Kursproxy. Es nutzt einen freien Port und vier frische Browserkontexte für Ansichten, Monat, Jahr und Vergleich. Vorhandene Browserprofile werden nicht geöffnet. Kurse und Marktdaten stammen aus festen lokalen Stubs oder dem Spielbereich; externe Abrufe werden blockiert.

Im Startdialog wählt das Werkzeug „Max und Erika“ und den Kursmodus „Testdatum wählen“, trägt das Datum ein und bestätigt mit „Spielbereich starten“. Die Ansichten verwenden den 20.10.2026. Für Oktober springt der Spielbereich vom 20.10. auf den 10.11.2026. Für den Jahresabschluss springt ein eigener Spielbereich vom 15.12.2026 auf den 02.01.2027. Der Simulator rechnet einmal 10.000 Monte-Carlo-Läufe mit Seed 12345; die Werkstatt zeigt Eingaben. Die Backtestaufnahme zeigt „Was im Lauf auffällt“ mit drei Karten und geschlossenem „Weitere“. Die Aufnahme aus Szenario-Logs zeigt „Pfade vergleichen“ mit P10, Median und P90.

Mit \`npm run docs:bilder -- --spielbereich\` erneuerst du Band und Vergleich und behältst die übrigen Aufnahmen. Das Band zeigt den Zeitraffer links von Spielbereich beenden. Bei Max und Erika prüft das Werkzeug danach die kurze Beenden-Bestätigung ohne Vergleich und Übernehmen. Für das Vergleichsbild legt es Max und Erika als erfundenen echten Bestand in einem frischen Browserkontext an, startet eine Kopie ohne Datumssprung und ändert Gold, Flex und Tagesgeld. Es öffnet keine Balance und wartet auf die frisch gerechnete Vorschau mit höherem Monatsbudget und Goldkauf.

Haushalt & Plan, Balance und Simulator zeigen ihre zunächst geschlossenen Planbereiche. Bei Max wird Person, Rente & Steuern vor der Aufnahme geöffnet. Für die Monte-Carlo-Einstellungen öffnet Einstellungen anzeigen den Bereich Alle Parameter unter Annahmen; die Aufnahme zeigt gezielt die Monte-Carlo-Karte. Danach schließt das Werkzeug den Bereich und wechselt zum Rechnen zurück zu Monte Carlo.

Der Browser läuft mit 1920×1080 Pixeln, Skalierung 1, Deutsch und Europe/Berlin. Die technische Uhr ist festgesetzt; Zeitgeber für Speicher und UI laufen weiter. Ausschnitte und verlustfreie PNG-Kompression begrenzen die Bildgröße. Bilddateien, Unterschriften, Datum, Seite, Zustand, Git-Commit, Ausschnitt, Maße und Dateigröße stehen im [Manifest](manifest.json). Gleiche PNG-Bytes auf verschiedenen Plattformen sind nicht zugesichert.

Nach dem Lauf siehst du dir einige PNGs und beide Abläufe an. Prüfe den Zustand, lesbare Werte und fehlende Lade- oder Fehleranzeigen. Führe danach \`npm run docs:pruefen\` aus. Das Werkzeug meldet bei einem Abbruch Bild, Aktion und Grund; wiederhole den gesamten Lauf nach der Korrektur. Server und Browser werden auch bei Fehlern geschlossen.

## Ansichten

${images.filter(item => item.group === 'masken').map(item => `- [${path.basename(item.path)}](${item.path.replace('docs/ui/', '')}): ${item.caption}`).join('\n')}

## Monat abschließen

${images.filter(item => item.group === 'monatsabschluss').map(item => `- [${path.basename(item.path)}](${item.path.replace('docs/ui/', '')}): ${item.caption}`).join('\n')}

## Jahr abschließen

${images.filter(item => item.group === 'jahresabschluss').map(item => `- [${path.basename(item.path)}](${item.path.replace('docs/ui/', '')}): ${item.caption}`).join('\n')}
`;
}

async function main() {
    const started = performance.now(), images = [];
    const comparisonOnly = process.argv.includes('--spielbereich');
    if (comparisonOnly) images.push(...JSON.parse(await fs.readFile(path.join(root, 'docs/ui/manifest.json'), 'utf8')).images.filter(item => !['docs/ui/spielbereich-vergleich.png', 'docs/ui/probelauf-band.png'].includes(item.path)));
    const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
    const commit = git.stdout?.trim();
    if (git.status !== 0 || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Git-Commit für die Bildherkunft nicht lesbar.');
    const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
    const treeStatus = status.status === 0 && !status.stdout.trim() ? 'clean' : 'dirty';
    const server = createSuiteServer({ root });
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
        async function capture(session, name, state, date, group = 'masken', target = '#suiteMain', scroll = false) {
            const file = `docs/ui/${name}.png`;
            current = `${file} · ${state}`; console.log(current);
            const { page, errors } = session; activePage = page;
            if (target === '.probelauf-end-dialog') await page.evaluate(() => document.fonts.ready.then(() => true));
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
            const caption = captions[IMAGE_FILES.indexOf(file)];
            if (!caption) throw new Error(`Bild ${file} fehlt in der Bilderliste.`);
            images.push({ path: file, caption, household, date, viewport, scale: 1, crop,
                width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), bytes: buffer.length,
                sha256: createHash('sha256').update(buffer).digest('hex'), group, seed,
                source: { page: new URL(page.url()).pathname.slice(1), state, commit, treeStatus, scroll: scrollPosition } });
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
        if (!comparisonOnly) {
        const masks = await newProbelauf(browser, baseUrl, maskDate);
        try {
            const { page } = masks; activePage = page;
            await capture(masks, 'uebersicht', 'Übersicht', maskDate);
            await goto(masks, 'depot-tranchen-manager.html');
            await page.locator('#managerPlanTab').click();
            await page.locator('#managerPlanMore').evaluate(details => { details.open = false; });
            await capture(masks, 'personen-haushalt-plan', 'Haushalt & Plan', maskDate);
            for (const [name, id] of [['max', 'muster_a'], ['erika', 'muster_b']]) {
                await page.locator(`#managerSectionNav [data-manager-profile="${id}"]`).click();
                if (name === 'max') await page.locator('#managerPersonToggle').click();
                await capture(masks, `personen-${name}`, `Person ${name} · Auf einen Blick · Person, Rente & Steuern ${name === 'max' ? 'geöffnet' : 'geschlossen'}`, maskDate);
            }
            await page.locator('#managerHistoryTab').click();
            for (const [name, selector] of [['haushalt', '[data-manager-history-scope="household"]'], ['max', '[data-manager-profile="muster_a"]'], ['erika', '[data-manager-profile="muster_b"]']]) {
                await page.locator(`#managerHistorySwitch ${selector}`).click();
                await page.locator('#managerWealthChart svg').waitFor({ state: 'visible' });
                await capture(masks, `verlauf-${name}`, `Vermögensverlauf ${name}`, maskDate);
            }
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
            await capture(masks, 'monte-carlo-einstellungen', 'Monte-Carlo · Einstellungen und Erweitert geöffnet · 10.000 Läufe · Seed 12345', maskDate,
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
            for (const [name, value] of [['ueberblick', 'overview'], ['risiko-verteilung', 'risk'], ['pflege', 'care'], ['szenario-logs', 'logs']]) {
                await page.locator(`[data-mc-view="${value}"]`).click();
                if (value === 'logs') {
                    await page.locator('#scenarioComparison [data-comparison-preset="default"]').click();
                    await page.locator('#scenarioComparisonHeading').waitFor({ state: 'visible' });
                }
                await capture(masks, `monte-carlo-${name}`, `Monte-Carlo ${name} · 10.000 Läufe · Seed 12345${value === 'logs' ? ' · Pfade vergleichen · P10, Median, P90' : ''}`, maskDate,
                    'masken', value === 'logs' ? '#scenarioComparison' : '#tab-montecarlo', value === 'logs' ? '#scenarioComparison' : '.mc-view-nav');
            }
            for (const [name, value] of [['ergebnis', 'ergebnis'], ['annahmen', 'annahmen'], ['backtest', 'backtesting']]) {
                await tab(page, value);
                if (value === 'annahmen') await page.locator('#simPlanParameters').evaluate(details => { details.open = false; });
                if (value === 'backtesting') {
                    await page.locator('#backtestAnalysis').waitFor({ state: 'visible' });
                    await page.locator('#backtestAnalysis .backtest-analysis-more').evaluate(details => { details.open = false; });
                }
                await capture(masks, `simulator-${name}`, `Simulator ${name} nach Backtest und Monte-Carlo${value === 'annahmen' ? ' · Alle Parameter, Personen- und Pflegedetails geschlossen' : value === 'backtesting' ? ' · Was im Lauf auffällt · Weitere geschlossen' : ''}`, maskDate,
                    'masken', value === 'backtesting' ? '#backtestAnalysis' : value === 'annahmen' ? '#tab-annahmen' : '#suiteMain',
                    value === 'backtesting' ? '#backtestAnalysis' : value === 'annahmen' ? '.sim-need-card' : false);
            }
            await tab(page, 'werkstatt');
            await capture(masks, 'werkstatt', 'Werkstatt · Werkzeugauswahl', maskDate);
            for (const [name, tool, panel] of [['replay', 'replay', '#workshopReplayPanel'], ['sweep', 'sweep', '#tab-sweep'], ['auto-optimize', 'optimize', '#tab-auto-optimize']]) {
                await page.locator(`#workshopToolCards [data-workshop-tool="${tool}"]`).click();
                await capture(masks, `werkstatt-${name}`, `Werkstatt ${name} · Eingaben`, maskDate, 'masken', panel, true);
            }
            await goto(masks, 'Daten-Sicherung.html');
            await capture(masks, 'daten-sicherung', 'Daten & Sicherung', maskDate);
            await goto(masks, 'index.html');
            await capture(masks, 'probelauf-band', 'Spielbereich · Testdatum, Kursmodus und Beenden', maskDate, 'masken', '#probelaufBand');
            await goto(masks, 'Handbuch.html');
            await capture(masks, 'handbuch-start', 'Handbuchstart mit Aufgaben, Kapitelnavigation und Suche', maskDate);
        } finally { await masks.context.close(); }
        for (const annual of [false, true]) {
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
                const steps = ['prices', 'expenses', 'budget', 'cash', ...(annual ? ['market', 'preview'] : [])];
                const names = ['kurse', 'ausgaben', 'budget', 'tagesgeld', 'marktdaten', 'plan'];
                for (let i = 0; i < steps.length; i++) {
                    current = `${group} · ${steps[i]} öffnen`;
                    await dialog.locator(`[data-close-dialog-activate="${steps[i]}"]`).click();
                    if (steps[i] === 'expenses') await importExample(page, dialog);
                    if (steps[i] === 'cash') {
                        if (await dialog.locator('[data-tagesgeld-person]').count() !== 2) throw new Error('Tagesgeld muss Max und Erika zeigen.');
                        for (const confirm of await dialog.locator('[data-tagesgeld-confirm]').all()) if (await confirm.isVisible()) await confirm.click();
                    }
                    // Der Haken bestätigt den Besuch; vorhandene DOM-Texte melden die fertigen Daten.
                    if (steps[i] === 'market' || steps[i] === 'preview') await poll(page, ({ selector, id }) => {
                        const step = document.querySelector(`${selector} [data-close-dialog-step="${id}"]`);
                        if (step?.dataset.state !== 'done'
                            || step.querySelector('[data-close-dialog-activate]')?.getAttribute('aria-expanded') !== 'true') return false;
                        return id === 'market'
                            ? step.querySelector('[data-annual-market-status]')?.textContent === 'Vollständig vorbereitet · noch nicht gespeichert'
                            : step.querySelector('[data-annual-plan-status]')?.textContent === 'Dein Plan ist gültig.';
                    }, { selector, id: steps[i] }, steps[i] === 'market' ? 'Vollständige Marktdaten' : 'Gerechnete Planvorschau');
                    if (steps[i] === 'preview') {
                        await dialog.locator('[data-annual-plan-toggle]').click();
                        await dialog.locator('[data-annual-plan-editor]').evaluate(element => element.scrollIntoView({ block: 'start' }));
                    }
                    const expectedStatus = steps[i] === 'budget'
                        ? `Noch offen: ${annual ? 'Tagesgeld am 31.12.2026' : 'Tagesgeld prüfen'}`
                        : steps[i] === 'market' ? 'Noch offen: Plan 2027 prüfen' : null;
                    if (expectedStatus && await dialog.locator('[data-close-dialog-status]').textContent() !== expectedStatus)
                        throw new Error(`Fuß-Status vor der Aufnahme muss „${expectedStatus}“ lauten.`);
                    await capture(session, `${group}/${String(i + 2).padStart(2, '0')}-${names[i]}`, `${group} · ${steps[i]}`, date, group, selector);
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
                await capture(session, `${group}/${annual ? '08' : '06'}-ergebnis`, `${group} · bestätigtes Ergebnis`, date, group, selector);
            } finally { await session.context.close(); }
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
        images.sort((a, b) => IMAGE_FILES.indexOf(a.path) - IMAGE_FILES.indexOf(b.path));
        if (images.length !== IMAGE_FILES.length) throw new Error(`Erwartet: ${IMAGE_FILES.length} Bilder; erzeugt: ${images.length}.`);
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
        console.log(`${images.length} Bilder · ${totalBytes} Bytes · ${(totalBytes / 1000000).toFixed(2)} MB · ${durationSeconds} Sekunden`);
        if (totalBytes > 4000000) console.log('Größenziel von etwa 4 MB überschritten; Ausschnitte im Ergebnisbericht bewerten.');
    } catch (error) {
        let detail = '';
        if (activePage && !activePage.isClosed()) detail = await activePage.locator('[role="status"]:visible, [data-close-dialog-message]:visible').allTextContents().then(items => items.filter(Boolean).join(' · ')).catch(() => '');
        throw new Error(`Bilderzeugung abgebrochen bei „${current}“: ${error.message}${detail ? '\nSeitenstatus: ' + detail : ''}`, { cause: error });
    } finally {
        await browser?.close(); server.closeAllConnections?.();
        if (server.listening) await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
