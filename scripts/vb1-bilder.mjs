// VB-1: Prüfbild des Versorgungsfreibetrags (§ 17 ErbStG) im Todesjahr-ⓘ des Szenario-Protokolls, synthetischer Spielbereich.
// Martin und Petra „Verheiratet“: Der Grundfall „Haus + Steuer“ ist unverheiratet und zeigt deshalb keinen Versorgungsfreibetrag.
import path from 'node:path';

export async function captureVB1({ browser, baseUrl, newProbelauf, goto, tab, poll, reviewRoot, openProtocols }) {
    const date = '2026-10-23', session = await newProbelauf(browser, baseUrl, date, 'demo', 'martin-petra', 'ehe');
    try {
        const { page } = session;
        await goto(session, 'Simulator.html', date);
        await tab(page, 'montecarlo');
        // Voreingestellter Seed und voreingestellte Laufzahl der Beispielhaushalte.
        await page.locator('#mcButton').click();
        await poll(page, () => !document.querySelector('#mcButton')?.disabled && !document.querySelector('#exportMonteCarloRunJson')?.disabled,
            null, 'VB-1 Monte Carlo', 600000);
        await page.locator('[data-mc-view="logs"]').click();
        const cards = page.locator('#scenarioComparison [data-scenario-id]');
        let deathYear;
        for (let index = 0; index < await cards.count() && !deathYear; index++) {
            await cards.nth(index).click();
            deathYear = await page.evaluate(() => window.globalCurrentScenarioData?.rows
                .find(row => row.inheritance?.pensionAllowance && row.erbschaftsteuer > 0)?.jahr);
        }
        if (!deathYear) throw new Error('VB-1: kein Szenario mit Todesjahr, Erbschaftsteuer und Versorgungsfreibetrag gefunden.');
        await openProtocols(page);
        const output = page.locator('#scenarioLogOutput');
        const row = output.locator(`#scenario-year-${deathYear}`);
        await row.waitFor();
        await output.evaluate((node, year) => {
            const target = node.querySelector(`#scenario-year-${year}`);
            node.scrollTop = Math.max(0, target.offsetTop - node.querySelector('thead').offsetHeight - 40);
            node.scrollIntoView({ block: 'start' });
        }, deathYear);
        const info = row.locator('.protocol-inheritance-info');
        await info.locator('.ds-info-button').click();
        await poll(page, year => document.querySelector(`#scenario-year-${year} .protocol-inheritance-info`)?.dataset.visible === 'true', deathYear, 'VB-1 Erbe-ⓘ offen');
        const text = await info.locator('[role="tooltip"]').innerText();
        if (!text.includes('Versorgungsfreibetrag (§ 17 ErbStG)')) throw new Error('VB-1: Versorgungsfreibetrag fehlt im Erbe-ⓘ.');
        await page.evaluate(async () => { await document.fonts.ready; });
        await page.screenshot({ path: path.join(reviewRoot, 'VB-1-protokoll.png'), animations: 'disabled' });
        if (session.errors.length) throw new Error(session.errors.join('\n'));
        console.log(`VB-1: Martin und Petra verheiratet · Todesjahr ${deathYear} · ${text.replace(/\s+/g, ' ').match(/Versorgungsfreibetrag \(§ 17 ErbStG\)[^·]*/)?.[0]}`);
    } finally { await session.context.close(); }
}
