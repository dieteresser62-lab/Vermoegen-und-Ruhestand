// Synthetische PH-1b-Aufnahmen und gemessene Planfeldbreiten; keine Browser-Testfälle.
import fs from 'node:fs/promises';
import path from 'node:path';

export async function capturePH1B({ browser, baseUrl, newProbelauf, newNormalSession, goto, tab, capture, root, date }) {
    const normal = await newNormalSession(browser, baseUrl, date);
    try {
        const { page } = normal;
        // SV-1: je ein Punkt der drei Arten, synthetisch und für den ganzen Haushalt.
        await page.evaluate(async () => {
            const { SnapshotArchive, SNAPSHOT_KINDS, IMPORT_POINT_LABELS } = await import('/app/shared/snapshot-archive.js');
            const { PersistenceFacade: P } = await import('/app/shared/persistence-facade.js');
            const records = SnapshotArchive.captureCurrentRecords({ keys: () => P.keysSync(), getItem: key => P.getItemSync(key) });
            for (const [kind, label] of [[SNAPSHOT_KINDS.monthlyClosePreMutation, 'Monatsabschluss 2026-09'],
                [SNAPSHOT_KINDS.annualClosePreMutation, 'Max Mustermann'], [SNAPSHOT_KINDS.fullBackupImportRecovery, IMPORT_POINT_LABELS.restore]]) {
                await SnapshotArchive.createSnapshot({ label, kind, activeProfileId: P.getItemSync('rs_current_profile'), records });
            }
        });
        await page.reload(); await normal.ready();
        if (await page.locator('#probelaufBand').isVisible() || await page.locator('.data-point-blocked').count())
            throw new Error('Handbuchbild enthält einen Spielbereich oder gesperrte Punkte.');
        await capture(normal, 'daten-sicherung', 'Daten & Sicherung · Normalbetrieb · synthetischer Musterhaushalt', date);
        if (await page.locator('[data-restore-point]:disabled').count() || await page.locator('[data-restore-point]').count() !== 3)
            throw new Error('Zurückholen muss an allen drei Punkten aktiv sein.');
        await capture(normal, 'daten-sicherung-punkte', 'Wiederherstellungspunkte · Normalbetrieb · je ein Punkt vom Monatsabschluss, Jahresabschluss und vor dem Zurückholen', date, 'masken', '#wiederherstellung', true);
        if (normal.errors.length) throw new Error(normal.errors.join('; '));
    } finally { await normal.context.close(); }

    const session = await newProbelauf(browser, baseUrl, date);
    const { page } = session;
    try {
        // Echte Oberfläche für Alle Parameter in Plan, Versuch und Versuch mit Dynamik.
        await goto(session, 'Balance.html'); await tab(page, 'strategy');
        await page.locator('#balanceAllParameters > summary').click();
        const measures = [];
        for (const mode of ['Plan', 'Versuch', 'Versuch, Dynamik Ausgewogen']) {
            if (mode === 'Versuch') await page.locator('[data-plan-trial-toggle]:visible').first().click();
            if (mode.includes('Dynamik')) {
                await page.locator('[data-balance-control="dynamicFlexPreset"] button').filter({ hasText: 'Ausgewogen' }).click();
            }
            for (const width of [1366, 1920, 2560]) {
                await page.setViewportSize({ width, height: 1080 });
                const measure = await page.locator('#kirchensteuerSatz').evaluate(element => {
                    const style = getComputedStyle(element), canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d'); context.font = style.font;
                    const textWidth = Math.max(...[...element.options].map(option => context.measureText(option.text).width));
                    const width = element.getBoundingClientRect().width;
                    const textSpace = width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
                        - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth) - 20;
                    return { width, textWidth, textSpace };
                });
                if (measure.textSpace < measure.textWidth) throw new Error('Kirchensteuer-Auswahl abgeschnitten');
                measures.push({ viewport: width, mode, ...measure });
            }
        }
        await page.setViewportSize({ width: 1920, height: 1080 });
        await fs.writeFile(path.join(root, 'tests/fixtures/ph-1b-select-measurement.json'), JSON.stringify(measures, null, 2) + '\n');

    } finally { await session.context.close(); }
}
