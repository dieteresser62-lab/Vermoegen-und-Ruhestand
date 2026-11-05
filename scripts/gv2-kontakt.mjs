// Isolierte Muster-Spielbereiche; Bildabnahme, keine zusätzlichen Browsertests.
import fs from 'node:fs/promises';
import path from 'node:path';

export async function captureGV2({ browser, baseUrl, newProbelauf, goto, tab, poll, root, phase, partnershipOnly = false }) {
    const directory = path.join(root, 'auftrag/GV-2-kontakt');
    await fs.mkdir(directory, { recursive: true });
    const entries = [];
    if (!partnershipOnly) for (const [variant, label] of [['immobilien', 'Haus und vermietete Wohnung'], ['grund', 'ohne Immobilien'], ['drei-toepfe', 'Helga und Werner · Gold, Anleihen und Haus']]) {
        const mixed = variant === 'drei-toepfe';
        const session = await newProbelauf(browser, baseUrl, '2026-10-23', 'demo', mixed ? 'helga-werner' : 'max-erika', mixed ? 'haus-pg3' : variant);
        const ids = mixed ? ['muster_helga', 'muster_werner'] : ['muster_a', 'muster_b'];
        const { page } = session;
        async function shot(name, expected) {
            await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
            for (const width of [1920, 2560]) {
                await page.setViewportSize({ width, height: width === 1920 ? 1080 : 1440 });
                await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                const file = `${phase}-${variant}-${name}-${width}.png`;
                await page.screenshot({ path: path.join(directory, file), fullPage: true, animations: 'disabled' });
                entries.push(`| [${file}](${file}) | ${label} · ${name} | ${expected} |`);
            }
        }
        try {
            await shot('uebersicht', 'Gesamtvermögen, fluchtende Personenbeträge, Allokation und gestapelter Verlauf.');
            await page.locator('#overviewAssetHelp .ds-info-button').click();
            await shot('uebersicht-aufteilung', 'Geldanlagen und beide Immobilienarten mit Anteilen am Gesamtvermögen.');
            await page.locator('#overviewAssetHelp .ds-info-button').click();
            await goto(session, 'depot-tranchen-manager.html', '2026-10-23');
            await page.locator('[data-manager-view="plan"]').first().click();
            await shot('haushalt-plan', 'Gesamtvermögen in Haushalt und Personen, Unterzeile und Mini-Verlauf.');
            await page.locator('#managerPartnershipToggle').click();
            await shot('partnerschaft', 'Ein Bedienweg für Immobilienerbe; Kaufkraftfeld mit Innenabstand.');
            for (const id of ids) {
                await page.locator(`#managerSectionNav [data-manager-profile="${id}"]`).click();
                await shot(mixed ? id === ids[0] ? 'person-helga' : 'person-werner' : id === ids[0] ? 'person-max' : 'person-erika', 'Hauptkachel Gesamtvermögen, Bestände und Kennzahlen, Immobilien gleichrangig und Anteil am Gesamtvermögen.');
            }
            await page.locator('[data-manager-view="history"]').first().click();
            for (const [selector, name] of [['#managerHistorySwitch [data-manager-history-scope="household"]', 'haushalt'], [`#managerHistorySwitch [data-manager-profile="${mixed ? ids[1] : ids[0]}"]`, mixed ? 'werner' : 'max']]) {
                if (await page.locator(selector).count()) await page.locator(selector).click();
                await shot(`verlauf-${name}`, 'Gestapeltes Gesamtvermögen, Aufteilung mit Immobilien, Entwicklung ausdrücklich Geldvermögen.');
            }
            await goto(session, 'Ausgaben.html', '2026-10-23');
            await shot('ausgaben', 'Budgets und Zahlungen behalten ihre Geldbasis.');
            await goto(session, 'Balance.html', '2026-10-23');
            await shot('balance', 'Gesamtvermögen mit Unterzeile; Deckung und Strategie rechnen Geldvermögen.');
            await tab(page, 'diagnosis');
            await shot('balance-diagnose', 'Kennzahlen und Quoten ausdrücklich Geldvermögen.');
            await tab(page, 'strategy');
            await shot('balance-strategie', 'Strategiequoten behalten das Geldvermögen als Grundlage.');
            await goto(session, 'Simulator.html', '2026-10-23');
            await tab(page, 'backtesting');
            await page.locator('#btButton').click();
            await poll(page, () => !document.querySelector('#btButton')?.disabled && !!document.querySelector('#simulationLog tbody tr'), null, 'GV-2 Backtest', 60000);
            await shot('backtest', 'Gesamtvermögen, gestapelte Immobilien und Protokollkopf über ganze Breite.');
            await tab(page, 'montecarlo');
            await page.locator('#mcSettingsToggle').click();
            await page.locator('#mcAnzahl').fill('128');
            await page.locator('#mcSeed').fill('12345');
            await page.locator('#mcSeed').blur();
            await page.locator('#mcSettingsToggle').click();
            await page.locator('#mcButton').click();
            await poll(page, () => !document.querySelector('#mcButton')?.disabled && !document.querySelector('#exportMonteCarloRunJson')?.disabled, null, 'GV-2 Monte Carlo', 60000);
            for (const view of ['overview', 'risk', 'care', 'logs']) {
                await page.locator(`[data-mc-view="${view}"]`).click();
                await shot(`monte-carlo-${view}`, 'Gesamtvermögen in Kennzahlen, Verteilung, Fächer und Pfaden; Ruin bleibt Geldvermögen.');
            }
            await tab(page, 'ergebnis');
            await shot('simulator-ergebnis', 'Gesamtvermögen und Immobilienband im Ergebnis.');
            await tab(page, 'annahmen');
            await shot('simulator-annahmen', 'Anfangsbestand und Strategie mit eindeutiger Geldbasis.');
            await tab(page, 'werkstatt');
            await shot('werkstatt', 'Optimierung ausdrücklich Geldvermögen.');
            for (const tool of ['replay', 'sweep', 'optimize']) {
                await page.locator(`[data-workshop-tool="${tool}"]`).click();
                await shot(`werkstatt-${tool}`, 'Werkzeug mit unveränderter Geld- und Strategiebasis.');
            }
            await goto(session, 'Daten-Sicherung.html', '2026-10-23');
            await shot('daten-sicherung', 'Unveränderte Sicherungen und Datenmengen.');
            await page.goto(`${baseUrl}/Handbuch.html`);
            await shot('handbuch', 'Vermögen, Verlauf und Verteilungen nach Regeln 10 und 13.');
            for (const chapter of ['haushalt-plan', 'vermoegensverlauf', 'simulator', 'monte-carlo', 'probelauf']) {
                await page.goto(`${baseUrl}/Handbuch.html#${chapter}`);
                await page.locator(`#${chapter}:visible`).waitFor();
                await shot(`handbuch-${chapter}`, 'Aktuelle Vermögens-, Verteilungs- und Verlaufserklärung am jeweiligen Hauptort.');
            }
            if (session.errors.length) throw new Error(session.errors.join('\n'));
        } finally { await session.context.close(); }
        console.log(`GV-2 ${phase}: ${label} bei 1920×1080 und 2560×1440 aufgenommen.`);
    }
    if (partnershipOnly) for (const variant of ['grund', 'testament']) {
        const session = await newProbelauf(browser, baseUrl, '2026-10-23', 'demo', 'martin-petra', variant);
        try {
            const { page } = session;
            await goto(session, 'depot-tranchen-manager.html', '2026-10-23');
            await page.locator('[data-manager-view="plan"]').first().click();
            await page.locator('#managerPartnershipToggle').click();
            for (const width of [1920, 2560]) {
                await page.setViewportSize({ width, height: width === 1920 ? 1080 : 1440 });
                await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
                const file = `${phase}-martin-petra-${variant}-${width}.png`;
                await page.screenshot({ path: path.join(directory, file), fullPage: true, animations: 'disabled' });
                entries.push(`| [${file}](${file}) | Martin und Petra · Partnerschaft | ${variant === 'grund' ? 'Immobilien + Steuer: Testamentfelder gesperrt mit Grund.' : 'Testament aktiv; Kaufkraftstand rechtsbündig mit Innenabstand.'} |`);
            }
            if (session.errors.length) throw new Error(session.errors.join('\n'));
        } finally { await session.context.close(); }
    }
    await fs.writeFile(path.join(directory, `${partnershipOnly ? 'partnerschaft-' : ''}${phase}.md`), `# ${phase}\n\n| Bild | Stelle | Abnahme |\n|---|---|---|\n${entries.join('\n')}\n`);
}
