/**
 * Gegenprobe JD-2a: ein erfundenes Folgejahr über Jahreslieferungen anhängen (wie im Jahresneutralitätstest von JD-1,
 * aber über echte Dateien in einer Wegwerfkopie). Erfundene Werte: Aktienkurse +5 % je Land bei gleichen Kursen
 * (mit Dividende etwa +7 %), Inflation 2,1 %, Geldmarkt 1,90 %, Lohn 3,0 %, Gold +8,5 %, CAPE 36,2.
 * Lieferant `hand`. Der Beleg hat das Auszugsformat der Kette (wie die Rückwärtsprobe), damit die Prüfung Werte gegen Beleg
 * besteht (JD-2c); `{ beleg: 'text' }` legt stattdessen eine Textdatei an, die zu keinem Leser passt. Anschlusswerte sind die Eingangswerte des Endjahrs:
 * bei einem angehängten Jahr aus dem Fortschreibungsblock, sonst (Grundbestand) aus den Originalen.
 */
import { KETTEN } from '../../scripts/lib/jahresdaten/ketten.mjs';
import { einheitenFuer, lieferungBauen, lieferungSchreiben } from '../../scripts/lib/jahresdaten/lieferung.mjs';

const runden = (value, stellen) => Number(value.toFixed(stellen));

/** @param {string} id @param {any} vorjahr Werte des Vorjahrs (aus der Lieferung aus den Originalen). */
function erfundeneWerte(id, vorjahr) {
    switch (id) {
    case 'global-equity-research-chain':
        return {
            oecdDezember: Object.fromEntries(Object.entries(vorjahr.oecdDezember).map(([iso, wert]) => [iso, runden(wert * 1.05, 4)])),
            ezbDezember: { ...vorjahr.ezbDezember }
        };
    case 'german-cpi-chain': return { jahresrate: 2.1, indexstand: runden(vorjahr.indexstand * 1.021, 1) };
    case 'german-cash-money-market-chain': return { jahresmittel: 1.9 };
    case 'german-gross-wage-growth-chain': return { indexstand: runden(vorjahr.indexstand * 1.03, 1), veraenderung: 3 };
    case 'gold-german-investor-chain': return { goldUsdJeUnze: runden(vorjahr.goldUsdJeUnze * 1.085, 2), usdJeEur: vorjahr.usdJeEur };
    case 'us-shiller-cape-chain': return { cape: 36.2 };
    default: throw new Error(`Unbekannte Kette ${id}`);
    }
}

const komma = value => String(value).replace('.', ',');

/** Belegdateien im Auszugsformat der Kette mit den Werten für Y und Y−1. */
export function erfundeneBelege(id, jahr, werte, vorjahr, basis) {
    const datei = (name, text) => ({ datei: name, inhalt: Buffer.from(text, 'utf8'), art: 'auszug' });
    switch (id) {
    case 'global-equity-research-chain':
        return [
            datei('rohauszug-oecd.csv', ['REF_AREA,MEASURE,TIME_PERIOD,OBS_VALUE,OBS_STATUS', ...[[jahr - 1, vorjahr], [jahr, werte]].flatMap(([y, w]) => (
                Object.entries(w.oecdDezember).map(([iso, wert]) => `${iso},SHARE,${y}-12,${wert},A`)))].join('\n') + '\n'),
            datei('rohauszug-ezb.csv', ['CURRENCY,TIME_PERIOD,OBS_VALUE,OBS_STATUS', ...[[jahr - 1, vorjahr], [jahr, werte]].flatMap(([y, w]) => (
                Object.entries(w.ezbDezember).map(([code, wert]) => `${code},${y}-12,${wert},A`)))].join('\n') + '\n')
        ];
    case 'german-cpi-chain': {
        const tabelle = (titel, feld) => `<caption>Verbraucherpreisindex für Deutschland<br/>\n${titel}</caption><thead><tr><th colspan="1">Jahr</th><th>Verbraucherpreisindex<br/>\ninsgesamt</th></tr></thead><tbody>${
            [[jahr, werte], [jahr - 1, vorjahr]].map(([y, w]) => `<tr><th rowspan="1" scope="row">${y}</th><td>${komma(w[feld])}</td></tr>`).join('')}</tbody></table>\n`;
        return [datei('rohauszug-destatis-vpi.html', tabelle(basis?.indexstand ?? '2020=100', 'indexstand') + tabelle('Veränderungsraten zum Vorjahr in %', 'jahresrate'))];
    }
    case 'german-cash-money-market-chain':
        return [datei('rohauszug-bundesbank-tagesgeld.txt', `Money market rates from 1999\n  ${jahr - 1}   ${vorjahr.jahresmittel}\n  ${jahr}   ${werte.jahresmittel}\n`)];
    case 'german-gross-wage-growth-chain':
        return [datei('rohauszug-destatis-verdienste.html', [[jahr, werte], [jahr - 1, vorjahr]].map(([y, w]) => (
            `<tr><td class="Vorspalte">${y}</td><td>${komma(w.indexstand)}</td><td>${komma(w.veraenderung)}</td></tr>`)).join('\n') + '\n')];
    case 'gold-german-investor-chain':
        return [
            datei('rohauszug-weltbank-gold.csv', `Jahr;Gold (USD/troy oz)\n${jahr - 1};${vorjahr.goldUsdJeUnze}\n${jahr};${werte.goldUsdJeUnze}\n`),
            datei('rohauszug-bundesbank-usd-eur.csv', `BBK_STD_CURRENCY;TIME_PERIOD;OBS_VALUE\nUSD;${jahr - 1};${vorjahr.usdJeEur}\nUSD;${jahr};${werte.usdJeEur}\n`)
        ];
    case 'us-shiller-cape-chain':
        return [datei('rohauszug-shiller-cape.csv', `Date,CAPE\n${jahr - 2}.12,${vorjahr.cape}\n${jahr - 1}.12,${werte.cape}\n`)];
    default: throw new Error(`Unbekannte Kette ${id}`);
    }
}

/**
 * Schreibt die erfundenen Lieferungen für `jahr` in eine Projektwurzel (nur Wegwerfkopien!).
 * @param {string} root @param {number} jahr Folgejahr (Endjahr + 1). @param {{status?: string, ohne?: string, beleg?: 'auszug' | 'text'}} [options]
 * @returns {string[]} geschriebene Dateien.
 */
export function erfundeneLieferungenSchreiben(root, jahr, { status = 'endgueltig', ohne, beleg = 'auszug' } = {}) {
    const geschrieben = [];
    for (const modul of KETTEN) {
        if (modul.KETTE.id === ohne) continue;
        const vorjahresLieferung = modul.lesen(root).fortschreibung?.lieferungen?.find(eintrag => eintrag.jahr === jahr - 1)
            ?? modul.lieferungAusOriginalen(root, jahr - 1).lieferung;
        const vorjahr = vorjahresLieferung.werte;
        const { dateien } = lieferungBauen({
            kette: modul.KETTE.id,
            jahr,
            werte: erfundeneWerte(modul.KETTE.id, vorjahr),
            einheit: einheitenFuer(modul.KETTE, erfundeneWerte(modul.KETTE.id, vorjahr)),
            anschluss: { jahr: jahr - 1, werte: vorjahr },
            perioden: modul.KETTE.periodenFuer(jahr),
            ...(vorjahresLieferung.basis ? { basis: vorjahresLieferung.basis } : {}),
            quelle: { name: 'Erfundene Testlieferung (Gegenprobe)', url: 'https://example.invalid/jahresdaten-gegenprobe', abrufdatum: `${jahr + 1}-01-15`, veroeffentlichungsstand: `${jahr + 1}-01-15` },
            methode: 'erfunden für die Gegenprobe; keine Quelldaten',
            lieferant: 'hand',
            status,
            rohdateien: beleg === 'text'
                ? [{ datei: 'rohantwort-erfunden.txt', inhalt: Buffer.from(`Erfundene Testlieferung ${modul.KETTE.id} ${jahr}; keine Quelldaten.\n`, 'utf8'), art: 'antwort' }]
                : erfundeneBelege(modul.KETTE.id, jahr, erfundeneWerte(modul.KETTE.id, vorjahr), vorjahr, vorjahresLieferung.basis)
        });
        geschrieben.push(...lieferungSchreiben(root, modul.KETTE.id, jahr, dateien));
    }
    return geschrieben;
}
