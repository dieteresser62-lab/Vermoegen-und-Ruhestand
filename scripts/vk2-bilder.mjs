// VK-2: Prüf- und Handbuchbilder des geführten Kaufs im frischen Spielbereich (Martin und Petra, 23.10.2026).
// Prüfbilder unversioniert unter auftrag/ (`node scripts/docs-bilder.mjs --vk2`), Handbuchbilder mit `--vk2-doku`.
import path from 'node:path';

const DIALOG = '#buyFlowDialog';

/** Gemeinsamer Ablauf bis Schritt 4; `shoot(name, label)` macht je Schritt ein Bild. */
async function walkBuyFlow(page, poll, shoot) {
    const fill = async (field, value) => {
        const input = page.locator(`${DIALOG} [data-close-dialog-step]:not([hidden]) [data-buy-flow-field="${field}"]`).first();
        await input.fill(value); await input.blur();
    };
    await poll(page, () => Boolean(document.querySelector('#balanceAnnualAction [data-buy-flow-start]')), null, 'Startknopf Kauf');
    await page.locator('#balanceAnnualAction [data-buy-flow-start]').first().click();
    await page.locator(DIALOG).waitFor({ state: 'visible' });
    await poll(page, () => /Kurs abrufbar/.test(document.querySelector('#buyFlowDialog [data-buy-flow-choice="suggestion"]')?.closest('label')?.textContent || ''), null, 'Kursprüfung des Vorschlags');
    await page.locator(`${DIALOG} [data-buy-flow-query]`).fill('IE00BK5BQT80');
    await page.locator(`${DIALOG} [data-buy-flow-search-button]`).click();
    await poll(page, () => document.querySelectorAll('#buyFlowDialog [data-buy-flow-hit]').length > 0, null, 'Treffer der Suche');
    await shoot('k1-ueberblick', 'Kauf · Überblick mit Wertpapierwahl und Suche');
    await page.locator(`${DIALOG} [data-buy-flow-primary]`).click();
    await page.locator(`${DIALOG} [data-buy-flow-memo]`).waitFor();
    await shoot('k2-kaufen', 'Kauf · Merkzettel Martin');
    await page.locator(`${DIALOG} [data-buy-flow-primary]`).click();
    await page.locator(`${DIALOG} [data-buy-flow-form]`).waitFor();
    await fill('price', '144,41'); await fill('fees', '9,90');
    await shoot('k3-abrechnung', 'Kauf · Abrechnung Martin');
    await page.locator(`${DIALOG} [data-buy-flow-primary]`).click();
    await poll(page, () => /Petra/.test(document.querySelector('#buyFlowDialog [data-close-dialog-step="settle"]:not([hidden]) [aria-pressed="true"]')?.textContent || ''), null, 'Petra in der Abrechnung');
    await page.locator(`${DIALOG} [data-close-dialog-activate="debit"]`).click();
    await page.locator(`${DIALOG} [data-buy-flow-debit]`).waitFor();
    await page.locator(`${DIALOG} [data-buy-flow-debit-person]`, { hasText: 'Martin' }).locator('[data-buy-flow-debit-choice="now"]').check();
    await shoot('k4-abbuchung', 'Kauf · Abbuchung Martin schon abgegangen, Petra fehlt noch');
}

export async function captureVK2({ browser, baseUrl, newProbelauf, goto, tab, poll, reviewRoot }) {
    const session = await newProbelauf(browser, baseUrl, '2026-10-23', 'demo', 'martin-petra', 'grund');
    const { page } = session;
    try {
        await page.setViewportSize({ width: 1920, height: 1080 });
        await goto(session, 'Balance.html', '2026-10-23'); await tab(page, 'overview');
        await page.locator('#balanceAnnualAction [data-todo-plan]').waitFor();
        await page.evaluate(async () => { await document.fonts.ready; });
        await page.locator('#balanceAnnualAction').screenshot({ path: path.join(reviewRoot, 'VK-2-pruefbild-main.png'), animations: 'disabled' });
        await walkBuyFlow(page, poll, async name => {
            await page.evaluate(async () => { await document.fonts.ready; });
            await page.locator(DIALOG).screenshot({ path: path.join(reviewRoot, `VK-2-pruefbild-${name}.png`), animations: 'disabled' });
            console.log(`VK-2: ${name}`);
        });
        if (session.errors.length) throw new Error(session.errors.join('\n'));
    } finally { await session.context.close(); }
}

/** VK-2: Handbuchbilder des geführten Kaufs, je Schritt eins (Martin und Petra, Spielbereich). */
export async function captureVK2Docs(browser, baseUrl, newProbelauf, goto, tab, poll, capture, date) {
    const session = await newProbelauf(browser, baseUrl, date, 'demo', 'martin-petra', 'grund');
    const { page } = session;
    try {
        await goto(session, 'Balance.html'); await tab(page, 'overview');
        // BV-1: Nach der Verkleinerung passt auch der Merkzettel ins Bildbudget.
        const files = { 'k1-ueberblick': 'kauf/01-ueberblick', 'k2-kaufen': 'kauf/02-kaufen', 'k3-abrechnung': 'kauf/03-abrechnung', 'k4-abbuchung': 'kauf/04-abbuchung' };
        await walkBuyFlow(page, poll, async (name, label) => {
            if (!files[name]) return;
            // VK-3d P12: Der Merkzettel ragt unten aus dem sichtbaren Inhalt; der Inhalt scrollt so weit, dass er ganz im Bild steht.
            if (name === 'k2-kaufen') await page.locator(`${DIALOG} [data-buy-flow-memo]`).evaluate(memo => {
                const content = memo.closest('[data-close-dialog-content]');
                if (content) content.scrollTop += Math.max(0, memo.getBoundingClientRect().bottom - content.getBoundingClientRect().bottom + 8);
            });
            await capture(session, files[name], label, date, 'kauf', DIALOG);
        });
        await page.locator(`${DIALOG} [data-close-dialog-close]`).click();
    } finally { await session.context.close(); }
}
