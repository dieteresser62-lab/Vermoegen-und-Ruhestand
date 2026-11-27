/**
 * Leser Inflation: Destatis-Seite „Verbraucherpreise-12Kategorien“ mit Jahresdurchschnitten (Index) und
 * Veränderungsraten zum Vorjahr. Die Seite zeigt fünf Jahre; der ganze Seitenstand kommt als Beleg ins Repo.
 * Ältere Jahre der Seite gehen als `alteJahre` in die Lieferung und erscheinen im Prüfbericht, wenn sie sich geändert haben.
 */
import { DESTATIS_LEVEL_TABLE, DESTATIS_RATE_TABLE, gespeichert, KETTE, lesen } from '../ketten/inflation.mjs';
import { einheitenFuer, lieferungBauen } from '../lieferung.mjs';
import { datumAus, destatisStand, OffenFehler, standAus, strengeZahl, vorFrist } from './gemeinsam.mjs';

export const SEITE = 'https://www.destatis.de/DE/Themen/Wirtschaft/Preise/Verbraucherpreisindex/Tabellen/Verbraucherpreise-12Kategorien.html';

export function quellen() {
    return { seite: SEITE };
}

/** Endgültig ab (Ideengespräch: Mitte Januar). */
export const ENDGUELTIG_AB = '01-15';
export const STATUSREGEL = 'endgültig ab 15. Januar des Folgejahres, solange die Jahrestabellen kein „vorläufig“ tragen; sonst vorläufig';

export const ANLEITUNG = Object.freeze({
    seiten: [`${SEITE} (Tabellen „Jahresdurchschnitte“ und „Veränderungsraten zum Vorjahr“, Spalte „Verbraucherpreisindex insgesamt“)`],
    zahlen: 'Indexstand (Basis laut Tabellenüberschrift, z. B. 2020=100) und Veränderungsrate in Prozent für Y und Y−1, je eine Stelle.',
    beleg: 'Die ganze HTML-Seite unverändert speichern (Seitenstand des Abrufs).'
});

/** @param {string} html @param {string} entryId @param {string} captionMuss */
function tabelle(html, entryId, captionMuss) {
    const start = html.indexOf(`<div class="c-toggle__entry" id="${entryId}">`);
    if (start < 0) throw new OffenFehler(`Destatis-Seite: Tabelle ${entryId} fehlt`);
    const caption = html.indexOf('<caption>Verbraucherpreisindex für Deutschland', start);
    const ende = html.indexOf('</table>', caption);
    if (caption < 0 || ende < 0) throw new OffenFehler(`Destatis-Seite: Tabelle ${entryId} ohne Überschrift`);
    const text = html.slice(caption, ende);
    const titel = text.slice(0, text.indexOf('</caption>'));
    if (!captionMuss || !new RegExp(captionMuss).test(titel)) throw new OffenFehler(`Destatis-Seite: Tabelle ${entryId} hat eine unerwartete Überschrift`);
    // Spalte über den Kopf bestimmen: erste Kopfzelle „Jahr“, dann die Spalte „Verbraucherpreisindex insgesamt“.
    const kopf = [...(text.match(/<thead>([\s\S]*?)<\/thead>/)?.[1] ?? '').matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(match => match[1].replace(/<br\/?>/g, ' ').replace(/\s+/g, ' ').trim());
    const spalte = kopf.indexOf('Verbraucherpreisindex insgesamt') - 1;
    if (kopf[0] !== 'Jahr' || spalte < 0) throw new OffenFehler(`Destatis-Seite: Tabelle ${entryId} ohne Spalte „Verbraucherpreisindex insgesamt“`);
    // Jahr → Zahl oder null (leer, Fußnote, nicht numerisch); doppelte Jahre merken.
    const werte = new Map(), doppelt = new Set();
    for (const zeile of text.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
        const jahr = zeile[1].match(/<th[^>]*scope="row"[^>]*>\s*(\d{4})\s*<\/th>/)?.[1];
        if (!jahr) continue;
        const zellen = [...zeile[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map(match => match[1]);
        if (zellen.length !== kopf.length - 1) throw new OffenFehler(`Destatis-Seite: Tabelle ${entryId}, Zeile ${jahr} passt nicht zu den Spaltenköpfen`);
        if (werte.has(Number(jahr))) doppelt.add(Number(jahr));
        werte.set(Number(jahr), strengeZahl(zellen[spalte] ?? '', { komma: true }));
    }
    return { titel, werte, doppelt, vorlaeufig: /vorläufig/i.test(text) };
}

/**
 * Index (Jahresdurchschnitt) und Rate je Jahr; die Basis kommt aus der Überschrift der Indextabelle.
 * @param {string} html
 */
export function vpiLesen(html) {
    const index = tabelle(html, DESTATIS_LEVEL_TABLE.entryId, '\\d{4}=100');
    const raten = tabelle(html, DESTATIS_RATE_TABLE.entryId, 'Veränderungsraten zum Vorjahr in %');
    return { basis: index.titel.match(/(\d{4})=100/)[0], index: index.werte, raten: raten.werte, doppelt: new Set([...index.doppelt, ...raten.doppelt]),
        vorlaeufig: index.vorlaeufig || raten.vorlaeufig };
}

/**
 * @param {{root: string, jahr: number, abrufen: import('./netz.mjs').Abruf}} input
 */
export async function holen({ root, jahr, abrufen }) {
    const antwort = await abrufen(SEITE);
    const html = antwort.text();
    const vpi = vpiLesen(html);
    const fehlt = [jahr - 1, jahr].filter(y => !vpi.index.has(y) || !vpi.raten.has(y));
    if (fehlt.length) throw new OffenFehler(`Destatis zeigt noch keinen Jahreswert für ${fehlt.join(', ')}`);
    const doppelt = [jahr - 1, jahr].filter(y => vpi.doppelt.has(y));
    if (doppelt.length) throw new OffenFehler(`Destatis-Jahrestabelle: Jahr ${doppelt.join(', ')} kommt mehrfach vor`);
    const unlesbar = [jahr - 1, jahr].filter(y => vpi.index.get(y) === null || vpi.raten.get(y) === null);
    if (unlesbar.length) throw new OffenFehler(`Destatis-Jahrestabelle: Zelle für ${unlesbar.join(', ')} ist leer oder nicht numerisch`);
    const werteFuer = y => ({ jahresrate: vpi.raten.get(y), indexstand: vpi.index.get(y) });
    const chain = lesen(root);
    const alteJahre = {};
    for (const y of [...vpi.index.keys()].filter(y => y < jahr - 1 && vpi.raten.has(y)).sort()) {
        const stand = gespeichert(chain, y, root);
        if (vpi.index.get(y) === null || vpi.raten.get(y) === null || vpi.doppelt.has(y)) continue;
        if (Number.isFinite(stand?.jahresrate) && Number.isFinite(stand?.indexstand) && stand.basis?.indexstand === vpi.basis) alteJahre[y] = werteFuer(y);
    }
    const werte = werteFuer(jahr);
    const hinweise = [];
    if (vorFrist(antwort.abgerufen, jahr, ENDGUELTIG_AB)) hinweise.push(`Vorläufig: Abruf vor dem 15. Januar ${jahr + 1}.`);
    if (vpi.vorlaeufig) hinweise.push('Vorläufig: Die Destatis-Jahrestabelle kennzeichnet Werte als vorläufig.');
    return {
        hinweise,
        ...lieferungBauen({
            kette: KETTE.id,
            jahr,
            perioden: KETTE.periodenFuer(jahr),
            werte,
            einheit: einheitenFuer(KETTE, werte),
            basis: { indexstand: vpi.basis },
            anschluss: { jahr: jahr - 1, werte: werteFuer(jahr - 1) },
            quelle: {
                name: 'Destatis, Verbraucherpreisindex für Deutschland, Jahrestabelle (Verbraucherpreise-12Kategorien)',
                url: SEITE,
                abrufdatum: datumAus(antwort.abgerufen),
                veroeffentlichungsstand: destatisStand(html) || standAus(antwort)
            },
            methode: 'abgerufen: veröffentlichte Jahresrate und Jahresdurchschnitt für Y und Y−1 aus der Destatis-Jahrestabelle',
            lieferant: 'skript',
            status: hinweise.length ? 'vorlaeufig' : 'endgueltig',
            ...(hinweise.length ? { hinweis: hinweise.join(' ') } : {}),
            ...(Object.keys(alteJahre).length ? { alteJahre } : {}),
            rohdateien: [{ datei: 'antwort-destatis-vpi.html', inhalt: antwort.bytes, art: 'antwort' }]
        })
    };
}
