// VK-3: Prüfbild „Tranche im Detail“ im frischen Spielbereich (Max, Neubestand nach dem Verkauf aus VK-1, 23.10.2026), unversioniert
// unter auftrag/ (`node scripts/docs-bilder.mjs --vk3`). BV-1: dasselbe Bild als Handbuchbild `docs/ui/tranche-detail.png` im vollen Lauf.
import path from 'node:path';

/** Öffnet „Tranche im Detail“ für Max, Neubestand. @param {any} page */
export async function openMaxTrancheDetail(page) {
    await page.locator('#managerSectionNav [data-manager-profile="muster_a"]').click();
    await page.locator('#tranchenTable .tranche-row').first().waitFor({ state: 'attached' });
    await page.locator('#tranchenTable [data-asset-group]').evaluateAll(groups => groups.forEach(group => { group.open = true; }));
    await page.locator('#tranchenTable [data-action="edit-tranche"][data-tranche-id="muster_a_lot_2"]').click();
    await page.locator('#trancheModal.active [data-tranche-history="sale"]').waitFor();
    await page.evaluate(() => /** @type {HTMLElement|null} */ (document.activeElement)?.blur?.());
}

export async function captureVK3({ browser, baseUrl, newProbelauf, goto, reviewRoot }) {
    const session = await newProbelauf(browser, baseUrl, '2026-10-23', 'demo', 'max-erika', 'grund');
    const { page } = session;
    try {
        await page.setViewportSize({ width: 1920, height: 1080 });
        await goto(session, 'depot-tranchen-manager.html', '2026-10-23');
        // Verkauf aus VK-1 (Max 65 Stück zu 144,52 €, Gutschrift bestätigt) über den gemeinsamen Schreiber.
        await page.evaluate(async () => {
            const { prepareSaleFlowWrite, commitSaleFlowWrite } = await import('./app/tranches/household-sale-writer.js');
            await commitSaleFlowWrite(await prepareSaleFlowWrite({ sales: [{ profileId: 'muster_a', actionId: 'vk3-pruefbild', executedAt: '2026-10-23',
                parts: [{ trancheId: 'muster_a_lot_2', shares: 65, gross: 9393.8, fees: 4.9, taxes: 0 }], cashValue: 27388.9 }] }));
        });
        await page.reload({ waitUntil: 'load' });
        await openMaxTrancheDetail(page);
        await page.evaluate(async () => { await document.fonts.ready; });
        await page.locator('#trancheModal .modal-content').screenshot({ path: path.join(reviewRoot, 'VK-3-pruefbild-tranche.png'), animations: 'disabled' });
        console.log('VK-3: tranche');
        if (session.errors.length) throw new Error(session.errors.join('\n'));
    } finally { await session.context.close(); }
}

/** Verkauf aus VK-1 (Max 65 Stück zu 144,52 €, Gutschrift bestätigt) über den gemeinsamen Schreiber, danach „Tranche im Detail“.
 * @param {any} page @param {string} date */
async function prepareMaxSale(page, date) {
    await page.evaluate(async executedAt => {
        const { prepareSaleFlowWrite, commitSaleFlowWrite } = await import('./app/tranches/household-sale-writer.js');
        await commitSaleFlowWrite(await prepareSaleFlowWrite({ sales: [{ profileId: 'muster_a', actionId: 'vk3-handbuch', executedAt,
            parts: [{ trancheId: 'muster_a_lot_2', shares: 65, gross: 9393.8, fees: 4.9, taxes: 0 }], cashValue: 27388.9 }] }));
    }, date);
    await page.reload({ waitUntil: 'load' });
    await openMaxTrancheDetail(page);
}

/** BV-1: Handbuchbild „Tranche im Detail“ (Max und Erika Mustermann, Spielbereich). */
export async function captureVK3Docs({ browser, baseUrl, newProbelauf, goto, capture, date }) {
    const session = await newProbelauf(browser, baseUrl, date, 'demo', 'max-erika', 'grund');
    try {
        await goto(session, 'depot-tranchen-manager.html', date);
        await prepareMaxSale(session.page, date);
        await capture(session, 'tranche-detail', 'Tranche im Detail · Max · Kennzahlen, Verlauf und Notiz', date, 'masken', '#trancheModal .modal-content');
        await session.page.locator('#trancheDetailKpis [data-tranche-shares-edit]').click();
        await capture(session, 'tranche-detail-korrektur', 'Stückzahl an der Kachel ändern · Abweichung oder Aktiensplit mit Vorschau', date, 'masken', '#trancheModal .modal-content');
    } finally { await session.context.close(); }
}
