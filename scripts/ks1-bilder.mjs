// KS-1: Prüfbilder „fester Seitenkopf“ und „Handbuchsuche“ über die bestehende Bildkette (`node scripts/docs-bilder.mjs --ks1`),
// unversioniert unter auftrag/, keine Handbuchbilder.
import path from 'node:path';

const viewport = { width: 1920, height: 1080 };

// Eigene leere Daten: frischer Kontext ohne Bestand, ohne Netz außerhalb der lokalen Seite.
async function emptySession(browser, baseUrl, pageName) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'de-DE', timezoneId: 'Europe/Berlin', colorScheme: 'light', serviceWorkers: 'block' });
    await context.route('**/*', route => new URL(route.request().url()).origin === baseUrl ? route.continue() : route.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-10-23T12:00:00+02:00'));
    await page.goto(`${baseUrl}/${pageName}`, { waitUntil: 'load' });
    await page.evaluate(async () => {
        await (await import('/app/profile/profile-navigation.js')).whenProfileDisplayReady(document);
        await document.fonts.ready;
    });
    return { context, page, errors };
}

async function scrolled(page, y) {
    await page.evaluate(top => scrollTo(0, top), y);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const state = await page.evaluate(() => ({ scroll: scrollY, header: document.querySelector('.suite-header').getBoundingClientRect().top }));
    if (state.scroll < 300 || state.header !== 0) throw new Error(`Kopf klebt nicht nach dem Scrollen: ${JSON.stringify(state)}`);
}

export async function captureKS1({ browser, baseUrl, newProbelauf, goto, reviewRoot }) {
    const simulator = await emptySession(browser, baseUrl, 'Simulator.html');
    try {
        // Ohne Daten ist „Ergebnis“ kurz; der erste Reiter mit genug Inhalt zum Scrollen zeigt den festen Kopf.
        for (const tab of ['ergebnis', 'annahmen', 'backtesting', 'montecarlo']) {
            const button = simulator.page.locator(`.tab-btn[data-tab="${tab}"]:enabled`);
            if (await button.count()) { await button.click(); await simulator.page.locator(`#tab-${tab}`).waitFor({ state: 'visible' }); }
            if (await simulator.page.evaluate(() => document.documentElement.scrollHeight - innerHeight >= 600)) break;
        }
        await scrolled(simulator.page, 900);
        await simulator.page.screenshot({ path: path.join(reviewRoot, 'KS-1-kopf-gescrollt.png'), animations: 'disabled' });
        if (simulator.errors.length) throw new Error(simulator.errors.join('\n'));
        console.log('KS-1: Simulator · eigene leere Daten · gescrollt · 1920×1080');
    } finally { await simulator.context.close(); }

    const session = await newProbelauf(browser, baseUrl, '2026-10-23', 'demo', 'max-erika', 'grund');
    try {
        await session.page.setViewportSize(viewport);
        await goto(session, 'Balance.html', '2026-10-23');
        await session.page.locator('#probelaufBand:not([hidden])').waitFor();
        await scrolled(session.page, 900);
        const band = await session.page.locator('#probelaufBand').evaluate(node => node.getBoundingClientRect().top);
        const header = await session.page.locator('.suite-header').evaluate(node => node.getBoundingClientRect().bottom);
        if (band < header || band > header + 12) throw new Error(`Streifen steht nicht unter dem Kopf: ${band} / ${header}`);
        await session.page.screenshot({ path: path.join(reviewRoot, 'KS-1-spielbereich-gescrollt.png'), animations: 'disabled' });
        if (session.errors.length) throw new Error(session.errors.join('\n'));
        console.log('KS-1: Balance · Spielbereich Max und Erika · Grundfall · 23.10.2026 · gescrollt · 1920×1080');
    } finally { await session.context.close(); }

    const handbook = await emptySession(browser, baseUrl, 'Handbuch.html');
    try {
        await handbook.page.locator('#handbookSearch').fill('im Seitenkopf auf');
        await handbook.page.locator('#handbookHits .hb-hit').first().waitFor();
        const first = await handbook.page.locator('#handbookHits .hb-hit').first().evaluate(node => ({ href: node.getAttribute('href'), mark: node.querySelector('mark')?.textContent }));
        if (first.mark !== 'im Seitenkopf auf') throw new Error(`Erster Treffer markiert nicht die Wortgruppe: ${JSON.stringify(first)}`);
        await handbook.page.screenshot({ path: path.join(reviewRoot, 'KS-1-handbuchsuche.png'), animations: 'disabled' });
        if (handbook.errors.length) throw new Error(handbook.errors.join('\n'));
        console.log(`KS-1: Handbuch · Suche „im Seitenkopf auf“ · erster Treffer ${first.href} · 1920×1080`);
    } finally { await handbook.context.close(); }
}
