// WT-1: Prüfbilder der Karte „Was zu tun ist“ über die bestehende Bildkette, keine neuen Browserfälle und keine Handbuchbilder.
import path from 'node:path';

export async function captureWT1({ browser, baseUrl, newProbelauf, goto, tab, changeDate, poll, reviewRoot }) {
    const shoot = async (page, selector, name) => {
        await page.evaluate(async () => { await document.fonts.ready; });
        for (const width of [1920, 2560]) {
            await page.setViewportSize({ width, height: width === 1920 ? 1080 : 1440 });
            const target = page.locator(selector);
            await target.scrollIntoViewIfNeeded();
            await target.screenshot({ path: path.join(reviewRoot, `WT-1-pruefbild-${name}-${width}.png`), animations: 'disabled' });
        }
        await page.setViewportSize({ width: 1920, height: 1080 });
        console.log(`WT-1: ${name} · 1920×1080 und 2560×1440`);
    };
    // Ansicht 1 und 2: Grundfall (Plan offen) und Variante „Plan teilweise umgesetzt“ am 23.10.2026.
    for (const [variant, name] of [['grund', 'offen'], ['teilweise', 'teilweise']]) {
        const session = await newProbelauf(browser, baseUrl, '2026-10-23', 'demo', 'max-erika', variant);
        try {
            await goto(session, 'Balance.html', '2026-10-23'); await tab(session.page, 'overview');
            await session.page.locator('#balanceAnnualAction [data-todo-plan]').waitFor();
            await shoot(session.page, '.balance-overview', name);
            if (variant === 'teilweise') {
                await session.page.locator('#openActionDetails').click();
                await session.page.locator('#actionDetailsDialog[open] [data-todo-plan-details]').waitFor();
                await shoot(session.page, '#actionDetailsDialog', 'details');
                await session.page.keyboard.press('Escape');
            }
            if (session.errors.length) throw new Error(session.errors.join('\n'));
        } finally { await session.context.close(); }
    }
    // Ansicht 4 und 5: Variante „Markt erst heiß, dann Rückgang“ im Dezember und im Jahresabschluss 2026.
    const session = await newProbelauf(browser, baseUrl, '2026-12-15', 'demo', 'max-erika', 'kurssturz');
    try {
        const { page } = session;
        await goto(session, 'Balance.html', '2026-12-15'); await tab(page, 'overview');
        await poll(page, () => !document.getElementById('balanceMarketPreview')?.hidden, null, 'Block zum verdeckten Bärenmarkt', 60000);
        await shoot(page, '#balanceActionArea', 'baer');
        await changeDate(page, '2027-01-02');
        await goto(session, 'index.html', '2027-01-02');
        await page.locator('[data-overview-annual]').click();
        const dialog = page.locator('#balanceAnnualClose');
        await dialog.waitFor({ state: 'visible' });
        await dialog.locator('[data-close-dialog-activate="preview"]').click();
        await poll(page, () => Boolean(document.querySelector('[data-hidden-bear="annual"]')), null, 'Wahl im Schritt Plan', 90000);
        await shoot(page, '#balanceAnnualClose', 'jahresabschluss-plan');
        if (session.errors.length) throw new Error(session.errors.join('\n'));
    } finally { await session.context.close(); }
}
