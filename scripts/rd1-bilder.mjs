// RD-1 (FR-78): zwei Prüfbilder mit Max und Erika im frischen Spielbereich, unversioniert unter auftrag/.
// Balance-Überblick am 23.10.2026 und Ergebnis des Jahresabschlusses 2026 am 02.01.2027. Ändert keine Dokubilder.
import path from 'node:path';

export async function captureRD1({ browser, baseUrl, newProbelauf, goto, tab, changeDate, poll, importExample, reviewRoot }) {
    const shoot = async (page, selector, name) => {
        await page.evaluate(async () => { await document.fonts.ready; });
        await page.setViewportSize({ width: 1920, height: 1080 });
        const target = page.locator(selector);
        await target.scrollIntoViewIfNeeded();
        await target.screenshot({ path: path.join(reviewRoot, `RD-1-pruefbild-${name}.png`), animations: 'disabled' });
        console.log(`RD-1: ${name} · 1920×1080`);
    };
    {
        const session = await newProbelauf(browser, baseUrl, '2026-10-23', 'demo', 'max-erika', 'grund');
        try {
            await goto(session, 'Balance.html', '2026-10-23'); await tab(session.page, 'overview');
            await session.page.locator('#balanceAnnualAction [data-todo-plan]').waitFor();
            await poll(session.page, () => /€/.test(document.getElementById('balanceReserveTarget')?.textContent || ''), null, 'Reservekarte');
            await shoot(session.page, '.balance-overview', 'balance-ueberblick');
            if (session.errors.length) throw new Error(session.errors.join('\n'));
        } finally { await session.context.close(); }
    }
    const session = await newProbelauf(browser, baseUrl, '2026-12-15', 'demo', 'max-erika', 'grund');
    try {
        const { page } = session;
        await changeDate(page, '2027-01-02');
        await goto(session, 'index.html', '2027-01-02');
        await page.locator('[data-overview-annual]').click();
        const dialog = page.locator('#balanceAnnualClose');
        await dialog.waitFor({ state: 'visible' });
        for (const step of ['prices', 'expenses', 'budget', 'cash', 'care', 'market', 'preview']) {
            await dialog.locator(`[data-close-dialog-activate="${step}"]`).click();
            if (step === 'expenses') await importExample(page, dialog);
            if (step === 'care') await dialog.locator('[data-annual-care-confirm]').click();
            if (step === 'market' || step === 'preview') await poll(page, id => {
                const node = document.querySelector(`#balanceAnnualClose [data-close-dialog-step="${id}"]`);
                return node?.dataset.state === 'done' && (id === 'market'
                    ? node.querySelector('[data-annual-market-status]')?.textContent === 'Vollständig vorbereitet · noch nicht gespeichert'
                    : node.querySelector('[data-annual-plan-status]')?.textContent === 'Dein Plan ist gültig.');
            }, step, step === 'market' ? 'Vollständige Marktdaten' : 'Gerechnete Planvorschau', 90000);
        }
        await dialog.locator('#annualConfirmBtn').click();
        await poll(page, () => {
            const node = document.querySelector('#balanceAnnualClose');
            return node?.dataset.annualYearResult === 'confirmed' && node.dataset.annualMonthResult === 'confirmed';
        }, null, 'Jahresabschluss bestätigt', 90000);
        await page.locator('#balanceAnnualClose [data-annual-combined-result]').waitFor();
        await shoot(page, '#balanceAnnualClose', 'jahresabschluss-ergebnis');
        if (session.errors.length) throw new Error(session.errors.join('\n'));
    } finally { await session.context.close(); }
}
