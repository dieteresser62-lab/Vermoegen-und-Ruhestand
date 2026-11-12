// LY-1: Prüfbilder des Balance-Überblicks (links Budget und Bedarf, rechts Handlung und Reserven) über die bestehende Bildkette.
import path from 'node:path';

export async function captureLY1({ browser, baseUrl, newProbelauf, goto, tab, poll, reviewRoot }) {
    for (const [householdId, variantId, name] of [['max-erika', 'grund', 'max-erika'], ['renate', 'klein', 'renate']]) {
        const session = await newProbelauf(browser, baseUrl, '2026-10-23', 'demo', householdId, variantId);
        try {
            const { page } = session;
            await goto(session, 'Balance.html', '2026-10-23'); await tab(page, 'overview');
            await poll(page, () => document.getElementById('balanceMonthlyBudget')?.textContent.trim() !== '—', null, 'Monatsbudget im Überblick', 60000);
            await page.evaluate(async () => { await document.fonts.ready; });
            for (const width of [1920, 2560]) {
                await page.setViewportSize({ width, height: width === 1920 ? 1080 : 1440 });
                const target = page.locator('.balance-overview');
                await target.scrollIntoViewIfNeeded();
                const [left, right] = await page.evaluate(() => ['.balance-overview-main', '.balance-overview-side']
                    .map(selector => Math.round(document.querySelector(selector).getBoundingClientRect().height)));
                await target.screenshot({ path: path.join(reviewRoot, `LY-1-pruefbild-${name}-${width}.png`), animations: 'disabled' });
                console.log(`LY-1: ${name} · ${width} px · Spaltenhöhe links ${left} px, rechts ${right} px`);
            }
            if (session.errors.length) throw new Error(session.errors.join('\n'));
        } finally { await session.context.close(); }
    }
}
