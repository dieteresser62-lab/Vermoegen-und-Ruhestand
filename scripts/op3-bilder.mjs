// OP-3: Prüfbilder für das einheitliche Reiterbild im Jahres- und Monatsabschluss und die Kursanzeige als Knopf
// (`node scripts/docs-bilder.mjs --op3`), unversioniert unter auftrag/. Nur synthetische Musterdaten.
import path from 'node:path';
import { syntheticQuote } from '../app/shared/probelauf-prices.js';

export async function captureOP3({ browser, baseUrl, newProbelauf, newNormalSession, changeDate, reviewRoot }) {
    // Jahresabschluss: Max und Erika „Haus und vermietete Wohnung“, 02.01.2027, acht Reiter, einige angesehen.
    {
        const session = await newProbelauf(browser, baseUrl, '2026-12-15', 'demo', 'max-erika', 'immobilien');
        try {
            const { page } = session;
            await changeDate(page, '2027-01-02');
            await page.locator('[data-overview-annual]').click();
            const dialog = page.locator('#balanceAnnualClose');
            await dialog.waitFor({ state: 'visible' });
            await page.waitForFunction(() => document.querySelectorAll('#balanceAnnualClose [data-close-dialog-activate]').length === 8);
            for (const id of ['expenses', 'budget', 'cash']) await dialog.locator(`[data-close-dialog-activate="${id}"]`).click();
            await page.evaluate(async () => { await document.fonts.ready; });
            await page.screenshot({ path: path.join(reviewRoot, 'OP-3-reiter.png'), animations: 'disabled' });
            console.log('OP-3: Jahresabschluss mit acht Reitern');
            if (session.errors.length) throw new Error(session.errors.join('\n'));
        } finally { await session.context.close(); }
    }
    // Monatsabschluss: Max und Erika, 10.11.2026, ein Reiter angesehen.
    {
        const session = await newProbelauf(browser, baseUrl, '2026-10-20');
        try {
            const { page } = session;
            await changeDate(page, '2026-11-10');
            await page.locator('[data-overview-month-confirm]').click();
            const dialog = page.locator('#overviewMonthConfirmation');
            await dialog.waitFor({ state: 'visible' });
            await page.waitForFunction(() => document.querySelectorAll('#overviewMonthConfirmation [data-close-dialog-activate]').length === 4);
            await page.evaluate(async () => { await document.fonts.ready; });
            await page.screenshot({ path: path.join(reviewRoot, 'OP-3-reiter-monat.png'), animations: 'disabled' });
            console.log('OP-3: Monatsabschluss mit vier Reitern');
            if (session.errors.length) throw new Error(session.errors.join('\n'));
        } finally { await session.context.close(); }
    }
    // Personen & Vermögen im Normalbetrieb (Musterdaten, kein Spielbereich): Kursanzeige als Knopf, kein Kursknopf mehr rechts.
    {
        const session = await newNormalSession(browser, baseUrl, '2026-10-20');
        try {
            const { page } = session;
            await page.goto(`${baseUrl}/depot-tranchen-manager.html`);
            await page.waitForFunction(() => window.__rsProfileSubpageLifecycleInitialized === true);
            await page.locator('#managerQuoteRefresh:enabled').waitFor();
            await page.evaluate(async () => { await document.fonts.ready; });
            await page.screenshot({ path: path.join(reviewRoot, 'OP-3-kopf.png'), clip: { x: 0, y: 0, width: 1920, height: 320 }, animations: 'disabled' });
            console.log('OP-3: Kopfzeile Personen & Vermögen');
            if (session.errors.length) throw new Error(session.errors.join('\n'));
        } finally { await session.context.close(); }
    }
    // Nachtrag 1: Übersicht nach dem Klick auf die Kurspille (Normalbetrieb, synthetische Kursantworten): kein Sprung, Kursfenster zu.
    {
        const date = '2026-10-20';
        const session = await newNormalSession(browser, baseUrl, date);
        try {
            const { page } = session;
            await page.route('http://127.0.0.1:8787/**', async route => {
                const url = new URL(route.request().url());
                const symbol = String(url.searchParams.get('symbol') || url.searchParams.get('q') || 'VWCE.DE').toUpperCase();
                if (url.pathname === '/search') await route.fulfill({ json: { quotes: [{ symbol }] } });
                else if (url.pathname === '/quote') await route.fulfill({ json: syntheticQuote(symbol, date) });
                else await route.abort('blockedbyclient');
            });
            const idle = () => page.waitForFunction(async () => {
                const { getPageNavigationGuard } = await import('./app/shared/navigation-guard-dialog.js');
                const guard = getPageNavigationGuard(document, window);
                return !guard.isBusy() && guard.reasons().length === 0
                    && !document.getElementById('overviewPricesValue').textContent.includes('werden aktualisiert');
            });
            await page.goto(`${baseUrl}/index.html`);
            await page.locator('#overviewPrices:enabled').waitFor();
            await idle();
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.locator('#overviewPrices').click();
            await idle();
            const state = await page.evaluate(() => ({ scroll: window.scrollY, open: document.getElementById('kursdetails').open }));
            if (state.scroll !== 0 || state.open) throw new Error(`OP-3: Kurspille springt oder öffnet das Kursfenster (${JSON.stringify(state)})`);
            await page.evaluate(async () => { await document.fonts.ready; });
            await page.screenshot({ path: path.join(reviewRoot, 'OP-3-uebersicht-kurse.png'), animations: 'disabled' });
            console.log('OP-3: Übersicht nach Kursklick · ' + await page.locator('#overviewPricesValue').textContent());
            if (session.errors.length) throw new Error(session.errors.join('\n'));
        } finally { await session.context.close(); }
    }
}
