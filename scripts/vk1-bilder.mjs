// VK-1: Prüfbilder des geführten Verkaufs im frischen Spielbereich (Max und Erika, 23.10.2026), unversioniert unter auftrag/.
// Ändert keine Dokubilder. Aufruf: node scripts/docs-bilder.mjs --vk1
import path from 'node:path';

export async function captureVK1({ browser, baseUrl, newProbelauf, goto, tab, poll, reviewRoot }) {
    const session = await newProbelauf(browser, baseUrl, '2026-10-23', 'demo', 'max-erika', 'grund');
    const { page } = session;
    const shoot = async (selector, name) => {
        await page.evaluate(async () => { await document.fonts.ready; });
        const target = page.locator(selector).first();
        await target.scrollIntoViewIfNeeded();
        await target.screenshot({ path: path.join(reviewRoot, `VK-1-pruefbild-${name}.png`), animations: 'disabled' });
        console.log(`VK-1: ${name}`);
    };
    const step = async id => { await page.locator(`#saleFlowDialog [data-close-dialog-activate="${id}"]`).click(); };
    const fill = async (field, value) => {
        const input = page.locator(`#saleFlowDialog [data-close-dialog-step]:not([hidden]) [data-sale-flow-field="${field}"]`).first();
        await input.fill(value); await input.blur();
    };
    try {
        await page.setViewportSize({ width: 1920, height: 1080 });
        await goto(session, 'Balance.html', '2026-10-23'); await tab(page, 'overview');
        await page.locator('#balanceAnnualAction [data-todo-plan]').waitFor();
        await poll(page, () => Boolean(document.querySelector('#balanceAnnualAction [data-sale-flow-start]')), null, 'Startknopf');
        await shoot('#balanceAnnualAction', 'main');
        await page.locator('#balanceAnnualAction [data-sale-flow-start]').first().click();
        await page.locator('#saleFlowDialog').waitFor({ state: 'visible' });
        await shoot('#saleFlowDialog', 'v1-ueberblick');
        await step('sell');
        await shoot('#saleFlowDialog', 'v2-verkaufen');
        if (process.argv.includes('--vk1-alle')) {
            // Erika zuerst eintragen: bewusst weniger (V3b), dann Max mit Plan erreicht (V3).
            await step('settle');
            await page.locator('#saleFlowDialog [data-close-dialog-step="settle"] .sale-flow-segment button', { hasText: 'Erika' }).click();
            await fill('shares', '400'); await fill('price', '144,38'); await fill('fees', '9,90'); await fill('taxes', '478,03');
            await page.locator('#saleFlowDialog [data-sale-flow-rest="keep"]').check();
            await shoot('#saleFlowDialog', 'v3b-weniger');
            await page.locator('#saleFlowDialog [data-sale-flow-rest="sell"]').check();
            await fill('shares', '560'); await fill('taxes', '828,10');
            await shoot('#saleFlowDialog', 'v3-abrechnung');
            await page.locator('#saleFlowDialog [data-sale-flow-primary]').click();
            await poll(page, () => /Max/.test(document.querySelector('#saleFlowDialog [data-close-dialog-step="settle"]:not([hidden]) [data-sale-flow-form]')?.closest('[data-close-dialog-step]')?.textContent || ''), null, 'Max in der Abrechnung');
            await fill('shares', '65'); await fill('price', '144,52'); await fill('fees', '4,90'); await fill('taxes', '0');
            await page.locator('#saleFlowDialog [data-sale-flow-primary]').click();
            await page.locator('#saleFlowDialog [data-sale-flow-credit]').waitFor();
            for (const name of ['Max', 'Erika']) {
                await page.locator('#saleFlowDialog [data-sale-flow-credit-person]', { hasText: name }).locator('[data-sale-flow-credit-choice="now"]').check();
            }
            await shoot('#saleFlowDialog', 'v4-gutschrift');
            await page.locator('#saleFlowDialog [data-sale-flow-primary]').click();
            await page.locator('#saleFlowDialog [data-sale-flow-distribute]').waitFor();
            await shoot('#saleFlowDialog', 'v5-verteilen');
        }
        if (session.errors.length) throw new Error(session.errors.join('\n'));
    } finally { await session.context.close(); }
}

/** VK-1: Handbuchbilder des geführten Verkaufs, je Schritt eins und „bewusst weniger“ (Max und Erika, Spielbereich). */
export async function captureVK1Docs(session, goto, tab, poll, capture, date) {
    const { page } = session;
    const dialog = '#saleFlowDialog';
    const fill = async (field, value) => {
        const input = page.locator(`${dialog} [data-close-dialog-step]:not([hidden]) [data-sale-flow-field="${field}"]`).first();
        await input.fill(value); await input.blur();
    };
    await goto(session, 'Balance.html'); await tab(page, 'overview');
    await poll(page, () => Boolean(document.querySelector('#balanceAnnualAction [data-sale-flow-start]')), null, 'Startknopf Verkauf');
    await page.locator('#balanceAnnualAction [data-sale-flow-start]').first().click();
    await page.locator(dialog).waitFor({ state: 'visible' });
    await capture(session, 'verkauf/01-ueberblick', 'Verkauf · Überblick', date, 'verkauf', dialog);
    await page.locator(`${dialog} [data-close-dialog-activate="sell"]`).click();
    await capture(session, 'verkauf/02-verkaufen', 'Verkauf · Merkzettel Max', date, 'verkauf', dialog);
    await page.locator(`${dialog} [data-close-dialog-activate="settle"]`).click();
    await page.locator(`${dialog} [data-close-dialog-step="settle"] .sale-flow-segment button`, { hasText: 'Erika' }).click();
    await fill('shares', '400'); await fill('price', '144,38'); await fill('fees', '9,90'); await fill('taxes', '478,03');
    await page.locator(`${dialog} [data-sale-flow-rest="keep"]`).check();
    await capture(session, 'verkauf/03b-weniger', 'Verkauf · Erika bewusst weniger', date, 'verkauf', dialog);
    await page.locator(`${dialog} [data-sale-flow-rest="sell"]`).check();
    await fill('shares', '560'); await fill('taxes', '828,10');
    await capture(session, 'verkauf/03-abrechnung', 'Verkauf · Abrechnung Erika', date, 'verkauf', dialog);
    await page.locator(`${dialog} [data-sale-flow-primary]`).click();
    await poll(page, () => /Max/.test(document.querySelector('#saleFlowDialog [data-close-dialog-step="settle"]:not([hidden]) [aria-pressed="true"]')?.textContent || ''), null, 'Max in der Abrechnung');
    await fill('shares', '65'); await fill('price', '144,52'); await fill('fees', '4,90'); await fill('taxes', '0');
    await page.locator(`${dialog} [data-sale-flow-primary]`).click();
    await page.locator(`${dialog} [data-sale-flow-credit]`).waitFor();
    await page.locator(`${dialog} [data-sale-flow-credit-person]`, { hasText: 'Max' }).locator('[data-sale-flow-credit-choice="now"]').check();
    await capture(session, 'verkauf/04-gutschrift', 'Verkauf · Gutschrift Max schon da, Erika kommt noch', date, 'verkauf', dialog);
    await page.locator(`${dialog} [data-sale-flow-credit-person]`, { hasText: 'Erika' }).locator('[data-sale-flow-credit-choice="now"]').check();
    await page.locator(`${dialog} [data-sale-flow-primary]`).click();
    await page.locator(`${dialog} [data-sale-flow-distribute]`).waitFor();
    await capture(session, 'verkauf/05-verteilen', 'Verkauf · Geld verteilen', date, 'verkauf', dialog);
    await page.locator(`${dialog} [data-close-dialog-close]`).click();
}
