/**
 * Rückwärtsprobe 2025 gegen die heutigen Quellen (`npm run jahresdaten:rueckwaertsprobe -- --live`).
 *
 * In einer Wegwerfkopie wie bei der Offline-Probe: 2025 entfernen, dann `npm run jahresdaten -- 2025 --holen`
 * mit echtem Netzabruf. Jede geholte Lieferung wird Feld für Feld mit der offline aus den gespeicherten Originalen
 * erzeugten Lieferung verglichen. Danach laufen `--pruefen` und `--uebernehmen` mit den geholten Lieferungen.
 * Der Bericht nennt je Kette Wert, Quelle und eine mögliche Revision. Kein Test im normalen Lauf, weil er Netz braucht.
 */
import { spawnSync } from 'node:child_process';
import { KETTEN } from './ketten.mjs';
import { lieferungLesen } from './lieferung.mjs';
import { rueckwaertsprobe } from './rueckwaertsprobe.mjs';
import { GRUNDBESTAND } from './grundbestand.mjs';

/** Einordnung einer Abweichung zwischen heutiger Quelle und gespeichertem Original. */
function einordnen(live, offline, toleranz) {
    if (live === offline) return 'gleich';
    if (!Number.isFinite(live) || !Number.isFinite(offline)) return 'fehlt';
    const abstand = Math.abs(live - offline);
    if (abstand <= Math.abs(offline) * 1e-12) return 'Rundungsrauschen';
    if (toleranz !== undefined && abstand <= toleranz + 1e-12) return 'innerhalb der Anschlusstoleranz';
    return 'Abweichung';
}

/** Feldpaare einer Kette, Gruppen je Schlüssel. @param {any} KETTE @param {any} live @param {any} offline */
function feldpaare(KETTE, live, offline) {
    const paare = [];
    for (const [feld, spec] of Object.entries(KETTE.werte)) {
        const toleranz = KETTE.anschluss.toleranz[feld];
        if (spec.gruppe) for (const key of spec.gruppe) paare.push({ feld: `${feld}.${key}`, live: live?.[feld]?.[key], offline: offline?.[feld]?.[key], toleranz });
        else if (live?.[feld] !== undefined || offline?.[feld] !== undefined) paare.push({ feld, live: live?.[feld], offline: offline?.[feld], toleranz });
    }
    return paare;
}

/**
 * Vergleicht die geholte mit der offline erzeugten Lieferung einer Kette.
 * @param {any} modul @param {{vorhanden: boolean, lieferung?: any, rohdatenFehler?: string[]}} live @param {any} offline
 */
export function lieferungenVergleichen(modul, live, offline) {
    const { KETTE } = modul;
    if (!live.vorhanden) return { kette: KETTE.id, label: KETTE.label, geholt: false, felder: [], abweichungen: [] };
    const felder = [
        ...feldpaare(KETTE, live.lieferung.werte, offline.werte).map(paar => ({ teil: `Wert ${offline.perioden.werte}`, ...paar })),
        ...feldpaare(KETTE, live.lieferung.anschluss?.werte, offline.anschluss.werte).map(paar => ({ teil: `Anschluss ${offline.perioden.anschluss}`, ...paar }))
    ].map(paar => ({ ...paar, einordnung: paar.offline === undefined ? 'nur heutige Quelle' : einordnen(paar.live, paar.offline, paar.toleranz) }));
    return {
        kette: KETTE.id, label: KETTE.label, geholt: true,
        status: live.lieferung.status, quelle: live.lieferung.quelle, methodeLive: live.lieferung.methode, methodeOffline: offline.methode,
        quelleOffline: offline.quelle, hinweis: live.lieferung.hinweis ?? '', rohdatenFehler: live.rohdatenFehler ?? [],
        felder, abweichungen: felder.filter(item => !['gleich', 'nur heutige Quelle'].includes(item.einordnung))
    };
}

/**
 * @param {{root: string, jahr?: number, behalten?: boolean}} options
 */
export async function rueckwaertsprobeLive({ root, jahr = GRUNDBESTAND.endYear, behalten = false }) {
    let holenLauf = null;
    let vergleiche = [];
    const probe = await rueckwaertsprobe({
        root, jahr, behalten,
        lieferungenAnlegen: kopie => {
            const result = spawnSync(process.execPath, ['scripts/jahresdaten.mjs', String(jahr), '--holen'], { cwd: kopie, encoding: 'utf8', windowsHide: true });
            holenLauf = { exit: result.status, ausgabe: `${result.stdout}${result.stderr}`.trim() };
            vergleiche = KETTEN.map(modul => lieferungenVergleichen(modul, lieferungLesen(kopie, modul.KETTE, jahr), modul.lieferungAusOriginalen(kopie, jahr).lieferung));
            return vergleiche.filter(item => item.geholt).map(item => ({ kette: item.label }));
        }
    });
    return { ...probe, holen: holenLauf, vergleiche };
}

/** Kurzfassung: welche Ketten genau gleich sind und welche abweichen. @param {any} ergebnis */
function ergebnisSatz(ergebnis) {
    const art = item => !item.geholt ? 'offen'
        : item.abweichungen.some(feld => ['Abweichung', 'fehlt'].includes(feld.einordnung)) ? 'Abweichung'
            : item.abweichungen.length ? 'Rauschen' : 'gleich';
    const gruppe = name => ergebnis.vergleiche.filter(item => art(item) === name).map(item => item.label);
    const teile = [];
    if (gruppe('gleich').length) teile.push(`Genau die gespeicherten Werte liefern heute: ${gruppe('gleich').join(', ')}.`);
    if (gruppe('Rauschen').length) teile.push(`Nur im Rundungsrauschen oder innerhalb der Anschlusstoleranz weichen ab: ${gruppe('Rauschen').join(', ')}.`);
    if (gruppe('Abweichung').length) teile.push(`Echte Abweichungen, mögliche Revision der Quelle: ${gruppe('Abweichung').join(', ')}.`);
    if (gruppe('offen').length) teile.push(`Offen geblieben: ${gruppe('offen').join(', ')}.`);
    teile.push(ergebnis.vergleich.contentHashGleich
        ? `Die Übernahme erzeugt den gespeicherten Datensatz wieder (Inhaltshash \`${ergebnis.vergleich.contentHash.slice(0, 8)}…\`).`
        : `Die Übernahme erzeugt deshalb nicht genau den gespeicherten Datensatz: Inhaltshash \`${ergebnis.vergleich.contentHash.slice(0, 8)}…\` statt \`${GRUNDBESTAND.contentHash.slice(0, 8)}…\`.`);
    return teile.join(' ');
}

const zahl = value => (typeof value === 'number' ? String(value) : value === undefined ? '–' : JSON.stringify(value));

/** Bericht als Markdown für data/historical/rueckwaertsprobe-live-<Jahr>.md. @param {Awaited<ReturnType<typeof rueckwaertsprobeLive>>} ergebnis @param {string} datum */
export function liveBerichtMarkdown(ergebnis, datum) {
    const { jahr, vergleiche, ketten, vergleich } = ergebnis;
    const zeilen = [
        `# Rückwärtsprobe ${jahr} gegen die heutigen Quellen`, '',
        `Lauf am ${datum} mit \`npm run jahresdaten:rueckwaertsprobe -- --live\`. In einer Wegwerfkopie wurde ${jahr} entfernt und mit \`--holen\` neu abgerufen. Jede geholte Lieferung ist mit der Lieferung aus den gespeicherten Originalen von JD-2a verglichen. Danach liefen \`--pruefen\` und \`--uebernehmen\` mit den geholten Lieferungen.`, '',
        ergebnisSatz(ergebnis), '',
        `Abruf: Exit ${ergebnis.holen?.exit ?? '–'}. Prüfung: Exit ${ergebnis.pruefen.exit}. Übernahme: Exit ${ergebnis.uebernehmen.exit}. Inhaltshash nach der Übernahme \`${vergleich.contentHash}\` (Grundbestand ${vergleich.contentHashGleich ? 'gleich' : 'nicht gleich'}).`, '',
        '| Kette | Status | Felder | gleich | Rauschen | in Toleranz | Abweichung | Zeile 2025 bytegleich |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |'
    ];
    for (const item of vergleiche) {
        const zaehle = einordnung => item.felder.filter(feld => feld.einordnung === einordnung).length;
        const zeile = ketten.find(kette => kette.kette === item.label);
        zeilen.push(`| ${item.label} | ${item.geholt ? item.status : 'offen'} | ${item.felder.length} | ${zaehle('gleich')} | ${zaehle('Rundungsrauschen')} | ${zaehle('innerhalb der Anschlusstoleranz')} | ${zaehle('Abweichung') + zaehle('fehlt')} | ${zeile?.zeileBytegleich ? 'ja' : 'nein'} |`);
    }
    zeilen.push('', 'Rauschen heißt: Abstand unter einem Billionstel des Werts, etwa durch eine neu gespeicherte Arbeitsmappe. „In Toleranz“ heißt: innerhalb der Anschlusstoleranz der Kette.', '');
    for (const item of vergleiche) {
        zeilen.push(`## ${item.label}`, '');
        if (!item.geholt) {
            const offen = ergebnis.holen?.ausgabe.split('\n').find(line => line.trim().startsWith(`${item.label}:`));
            zeilen.push(`Offen: ${offen?.trim() ?? 'keine Lieferung'}.`, '');
            continue;
        }
        zeilen.push(`- Heutige Quelle: ${item.quelle.name}, ${item.quelle.url}, Abruf ${item.quelle.abrufdatum}, ${item.quelle.veroeffentlichungsstand}.`);
        zeilen.push(`- Original: ${item.quelleOffline.name}, ${item.quelleOffline.veroeffentlichungsstand}.`);
        if (item.methodeLive !== item.methodeOffline) zeilen.push(`- Methode heute: ${item.methodeLive}. Methode Original: ${item.methodeOffline}.`);
        if (item.hinweis) zeilen.push(`- Hinweis des Lesers: ${item.hinweis}`);
        if (item.rohdatenFehler.length) zeilen.push(`- Belegfehler: ${item.rohdatenFehler.join('; ')}`);
        const zeigen = item.felder.filter(feld => feld.einordnung !== 'gleich');
        if (!zeigen.length) zeilen.push(`- Alle ${item.felder.length} Felder gleich.`);
        else {
            zeilen.push('', '| Teil | Feld | heute | Original | Einordnung |', '| --- | --- | --- | --- | --- |');
            for (const feld of zeigen) zeilen.push(`| ${feld.teil} | \`${feld.feld}\` | ${zahl(feld.live)} | ${zahl(feld.offline)} | ${feld.einordnung} |`);
            if (item.felder.length > zeigen.length) zeilen.push('', `Die übrigen ${item.felder.length - zeigen.length} Felder sind gleich.`);
        }
        zeilen.push('');
    }
    const alte = (ergebnis.bericht?.ketten ?? []).flatMap(kette => (kette.alteJahre ?? []).filter(item => !item.ok).map(item => ({ label: kette.label, ...item })));
    zeilen.push('## Alte Jahre laut heutiger Quelle', '');
    if (!alte.length) zeilen.push('Keine Quelle meldet für frühere Jahre andere Werte als gespeichert.');
    else {
        zeilen.push('Nur gemeldet, alte Jahre bleiben eingefroren.', '', '| Kette | Jahr | Feld | heute | gespeichert |', '| --- | --- | --- | --- | --- |');
        for (const item of alte) zeilen.push(`| ${item.label} | ${item.jahr} | \`${item.feld}\` | ${zahl(item.geliefert)} | ${zahl(item.gespeichert)} |`);
    }
    zeilen.push('', '## Übernahme in der Kopie', '');
    for (const kette of ketten) zeilen.push(`- ${kette.kette}: Zeile ${jahr} bytegleich ${kette.zeileBytegleich ? 'ja' : 'nein'}, Kette ohne Fortschreibungsblock bytegleich ${kette.ketteBytegleichOhneBlock ? 'ja' : 'nein'}.`);
    zeilen.push(`- Datenmodul bytegleich ${vergleich.datenmodulBytegleich ? 'ja' : 'nein'}, Inhaltshash \`${vergleich.contentHash}\`.`);
    if (ergebnis.fehler.length) zeilen.push('', 'Befunde der Probe:', '', ...ergebnis.fehler.map(text => `- ${text}`));
    return `${zeilen.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
