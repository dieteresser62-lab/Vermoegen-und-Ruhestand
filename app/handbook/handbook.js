/** Aufgabenhilfe ohne Profilzugriff oder Speicherwirkung.
 *
 * @param {unknown} value
 * @returns {string} Normalisierter Suchtext.
 */
export function normalizeSearch(value) {
    return String(value).normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('de').replace(/ß/g, 'ss');
}

// Suchnormalisierung kann die Länge ändern (ß → ss); Marken bleiben am Originaltext.
// Leerraum wird zu einem Zeichen zusammengefasst, damit Wortgruppen über Zeilenumbrüche hinweg passen.
/**
 * @param {string} text
 * @returns {{folded: string; starts: number[]; ends: number[]}} Suchtext mit Rückweg in den Originaltext.
 */
function foldSearchText(text) {
    const starts = [], ends = [];
    let folded = '', offset = 0;
    for (const character of String(text)) {
        const normalized = /\s/.test(character) ? ' ' : normalizeSearch(character);
        if (!(normalized === ' ' && folded.endsWith(' '))) {
            folded += normalized;
            for (let i = 0; i < normalized.length; i++) { starts.push(offset); ends.push(offset + character.length); }
        } else ends[ends.length - 1] = offset + character.length;
        offset += character.length;
    }
    return { folded, starts, ends };
}

/**
 * @param {string} text
 * @param {string} query
 * @returns {{start: number; end: number}|null} Position im Originaltext.
 */
export function findSearchRange(text, query) {
    const needle = normalizeSearch(query).replace(/\s+/g, ' ');
    if (!needle) return null;
    const { folded, starts, ends } = foldSearchText(text);
    const index = folded.indexOf(needle);
    return index < 0 ? null : { start: starts[index], end: ends[index + needle.length - 1] };
}

const searchWords = query => normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
const wordCharacter = /[\p{L}\p{N}]/u;

/** Alle Fundstellen eines Suchbegriffs. Bei `preferWordStart` zählen Treffer am Wortanfang,
 * solange es sie gibt („im“ nicht in „immer“); sonst auch Treffer mitten im Wort.
 *
 * @param {{folded: string; starts: number[]; ends: number[]}} fold
 * @param {string} needle Normalisierter Suchbegriff.
 * @param {boolean} preferWordStart
 * @returns {{start: number; end: number}[]} Positionen im Originaltext.
 */
function searchOccurrences(fold, needle, preferWordStart) {
    const all = [], atStart = [];
    for (let index = fold.folded.indexOf(needle); index >= 0; index = fold.folded.indexOf(needle, index + 1)) {
        const range = { start: fold.starts[index], end: fold.ends[index + needle.length - 1] };
        all.push(range);
        if (index === 0 || !wordCharacter.test(fold.folded[index - 1])) atStart.push(range);
    }
    return preferWordStart && atStart.length ? atStart : all;
}

const SNIPPET_LENGTH = 240, SNIPPET_LEAD = 70;

// KS-1: Kommt die ganze Eingabe als Wortgruppe vor, sitzt der Ausschnitt dort. Sonst dort, wo die meisten
// verschiedenen Suchwörter in ein Fenster von 240 Zeichen passen; bei Gleichstand die längeren Wörter
// (so gewinnt ohne Nachbarn das längste Wort statt eines Füllworts), dann die kleinste Spanne, dann die frühere Stelle.
/**
 * @param {string} text Kapiteltext.
 * @param {string[]} words Normalisierte Suchwörter.
 * @param {boolean} phrase Ob die Wortgruppe im Text steht.
 * @returns {{start: number; end: number}} Bereich, der im Ausschnitt sichtbar sein soll.
 */
function snippetFocus(text, words, phrase) {
    const fold = foldSearchText(text);
    const group = phrase && searchOccurrences(fold, words.join(' '), false)[0];
    if (group) return group;
    const occurrences = [...new Set(words)].flatMap(word => searchOccurrences(fold, word, true).map(range => ({ ...range, word })))
        .sort((a, b) => a.start - b.start || b.end - a.end);
    let best = null;
    for (let i = 0; i < occurrences.length; i++) {
        const seen = new Set();
        let length = 0, end = 0;
        for (let j = i; j < occurrences.length && occurrences[j].end - occurrences[i].start <= SNIPPET_LENGTH; j++) {
            end = Math.max(end, occurrences[j].end);
            if (seen.has(occurrences[j].word)) continue;
            seen.add(occurrences[j].word); length += occurrences[j].word.length;
            const candidate = { start: occurrences[i].start, end, count: seen.size, length };
            if (!best || candidate.count > best.count || candidate.count === best.count && (candidate.length > best.length
                || candidate.length === best.length && candidate.end - candidate.start < best.end - best.start)) best = candidate;
        }
    }
    return best || { start: 0, end: 0 };
}

/**
 * @param {{id: string; title: string; text: string}[]} records
 * @param {string} query
 * @returns Ergebnis der bestehenden Projektion.
 */
export function searchChapters(records, query) {
    const words = searchWords(query);
    if (!words.length) return [];
    const group = words.join(' ');
    return records.map(record => {
        const text = normalizeSearch(record.text).replace(/\s+/g, ' ');
        if (!words.every(word => text.includes(word))) return null;
        const title = normalizeSearch(record.title);
        const score = words.reduce((sum, word) => sum + (title.includes(word) ? 2 : 0), 0);
        const phrase = text.includes(group);
        const focus = snippetFocus(record.text, words, phrase);
        const start = Math.max(0, focus.start - Math.min(SNIPPET_LEAD, Math.max(0, SNIPPET_LENGTH - (focus.end - focus.start))));
        return { ...record, score, phrase, snippet: (start ? '… ' : '') + record.text.slice(start, start + SNIPPET_LENGTH) + (start + SNIPPET_LENGTH < record.text.length ? ' …' : '') };
    }).filter(Boolean).sort((a, b) => Number(b.phrase) - Number(a.phrase) || b.score - a.score);
}

/** Markierungen im Trefferausschnitt: die ganze Wortgruppe, wo sie steht; sonst jedes Suchwort,
 * längere zuerst und ohne Überlappung, Treffer am Wortanfang vor Treffern mitten im Wort.
 *
 * @param {string} snippet
 * @param {string} query
 * @returns {{start: number; end: number}[]} Sortierte Bereiche im Ausschnitt.
 */
export function searchMarkRanges(snippet, query) {
    const words = searchWords(query);
    if (!words.length) return [];
    const fold = foldSearchText(snippet);
    const group = searchOccurrences(fold, words.join(' '), false);
    if (group.length) return group;
    const ranges = [];
    for (const word of [...new Set(words)].sort((a, b) => b.length - a.length)) {
        for (const range of searchOccurrences(fold, word, true)) {
            if (!ranges.some(other => range.start < other.end && other.start < range.end)) ranges.push(range);
        }
    }
    return ranges.sort((a, b) => a.start - b.start);
}

const searchBlockTags = new Set('ARTICLE ASIDE BLOCKQUOTE BR DD DIV DL DT FIGCAPTION FIGURE H1 H2 H3 H4 H5 H6 HR LI OL P SECTION TABLE TBODY TD TH THEAD TR UL'.split(' '));

// Blockgrenzen trennen Wörter; Inline-Auszeichnungen bleiben Teil ihres Satzes.
/**
 * @param {HTMLElement} root
 * @returns {string} Sichtbarer Text.
 */
export function handbookSearchText(root) {
    const read = node => {
        if (node.nodeType === 3) return node.nodeValue;
        if (node.nodeType !== 1) return '';
        if (node.hidden || node.getAttribute('aria-hidden') === 'true'
            || node.hasAttribute('data-handbook-search-ignore') || node.classList.contains('step-number')
            || ['SCRIPT', 'STYLE', 'NAV'].includes(node.tagName)) return '';
        const text = [...node.childNodes].map(read).join('');
        return searchBlockTags.has(node.tagName) ? ' ' + text + ' ' : text;
    };
    return read(root).replace(/\s+/g, ' ').trim();
}

/**
 * @param {Document} [doc]
 * @param {Window} [win]
 * @returns {void} Gebundene Handbuchnavigation.
 */
export function initHandbook(doc = globalThis.document, win = doc?.defaultView) {
    if (!doc || !win) return;
    const chapters = [.../** @type {NodeListOf<HTMLElement>} */ (doc.querySelectorAll('[data-handbook-chapter]'))];
    const home = doc.getElementById('handbuch-start');
    const input = doc.getElementById('handbookSearch');
    const results = doc.getElementById('handbookResults');
    const hits = doc.getElementById('handbookHits');
    const toc = doc.getElementById('handbookToc');
    const tocLinks = doc.getElementById('handbookTocLinks');
    const context = doc.getElementById('handbookContext');
    const compact = node => node.textContent.replace(/\s+/g, ' ').trim();
    // Ein Treffer je Kapitel; der Zielabschnitt wird aus dessen passenden Texten bestimmt.
    const records = chapters.map(chapter => ({ id: chapter.id, title: compact(chapter.querySelector('h2')), text: handbookSearchText(chapter) }));
    let currentId = 'handbuch-start';
    let highlight = null;
    const clearHighlight = () => { highlight?.classList.remove('hb-highlight'); highlight = null; };
    const markNavigation = id => /** @type {NodeListOf<HTMLAnchorElement>} */ (doc.querySelectorAll('.hb-nav a')).forEach(link => {
        if (link.hash === '#' + id) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });
    const openTarget = (id, { focus = true, showContext = false } = {}) => {
        const target = doc.getElementById(id);
        if (!target) return false;
        const chapter = /** @type {HTMLElement|null} */ (target.closest('[data-handbook-chapter]'));
        const isHome = target === home || home.contains(target) || target.id === 'inhaltsverzeichnis';
        if (!chapter && !isHome) return false;
        currentId = isHome ? home.id : chapter.id;
        doc.querySelector('.hb-grid').classList.toggle('hb-grid-wide', isHome);
        input.value = ''; results.hidden = true; home.hidden = !isHome;
        chapters.forEach(item => { item.hidden = item !== chapter; });
        toc.hidden = isHome; context.hidden = true; clearHighlight();
        markNavigation(currentId); tocLinks.replaceChildren();
        if (chapter) {
            for (const section of chapter.querySelectorAll('.hb-section')) {
                const heading = section.querySelector('h3');
                if (!heading) continue;
                const link = doc.createElement('a'); link.href = '#' + section.id; link.textContent = compact(heading);
                if (section.contains(target)) link.setAttribute('aria-current', 'location');
                tocLinks.append(link);
            }
            for (const linkId of ['handbookAppLink', 'handbookReturn']) /** @type {HTMLAnchorElement} */ (doc.getElementById(linkId)).href = chapter.dataset.app;
            if (showContext) {
                highlight = target.closest('.hb-section') || chapter;
                highlight.classList.add('hb-highlight');
                const title = compact(highlight.querySelector('h3, h2') || chapter.querySelector('h2'));
                doc.getElementById('handbookContextText').textContent = 'Hierher führt die Hilfe aus der App: ' + title;
                context.hidden = false;
            }
        }
        if (focus) {
            target.setAttribute('tabindex', '-1');
            target.scrollIntoView({ block: 'start' });
            target.focus({ preventScroll: true });
        }
        return true;
    };
    const clearContextRequest = () => {
        const url = new URL(win.location.href);
        if (!url.searchParams.has('ctx')) return;
        url.searchParams.delete('ctx');
        win.history.replaceState(win.history.state, '', url.href);
    };
    const navigate = (id, options = {}) => {
        if (!openTarget(id, options)) return false;
        clearContextRequest();
        if (win.location.hash !== '#' + id) win.history.pushState(null, '', '#' + id);
        return true;
    };
    const renderSearch = () => {
        const query = input.value.trim();
        if (!query) { openTarget(currentId, { focus: false }); return; }
        clearContextRequest();
        clearHighlight(); context.hidden = true; home.hidden = true; toc.hidden = true;
        doc.querySelector('.hb-grid').classList.add('hb-grid-wide');
        chapters.forEach(chapter => { chapter.hidden = true; });
        markNavigation(''); results.hidden = false; hits.replaceChildren();
        const matches = searchChapters(records, query);
        doc.getElementById('handbookResultsTitle').textContent = matches.length + (matches.length === 1 ? ' Kapitel zu „' : ' Kapitel zu „') + query + '“';
        if (!matches.length) {
            const empty = doc.createElement('p'); empty.className = 'hb-empty'; empty.textContent = 'Kein Treffer. Probiere einen kürzeren Begriff, zum Beispiel Tagesgeld oder Mindest-Flex.';
            hits.append(empty); return;
        }
        const words = searchWords(query), group = words.join(' ');
        const sectionText = item => normalizeSearch(handbookSearchText(/** @type {HTMLElement} */ (item))).replace(/\s+/g, ' ');
        for (const match of matches) {
            const chapter = doc.getElementById(match.id);
            // KS-1: Steht die Wortgruppe in einem Abschnitt, führt der Treffer dorthin; sonst wie bisher.
            const sections = [...chapter.querySelectorAll('.hb-section')];
            const section = (match.phrase && sections.find(item => sectionText(item).includes(group)))
                || sections.find(item => words.every(word => sectionText(item).includes(word)));
            const link = doc.createElement('a'); link.className = 'hb-hit'; link.href = '#' + (section?.id || match.id);
            const heading = doc.createElement('h3'); heading.textContent = match.title;
            const snippet = doc.createElement('p');
            // Nur Textknoten; auch HTML-artige Suchbegriffe können kein Markup einfügen.
            let position = 0;
            for (const range of searchMarkRanges(match.snippet, query)) {
                snippet.append(doc.createTextNode(match.snippet.slice(position, range.start)));
                const mark = doc.createElement('mark'); mark.textContent = match.snippet.slice(range.start, range.end); snippet.append(mark);
                position = range.end;
            }
            snippet.append(doc.createTextNode(match.snippet.slice(position)));
            link.append(heading, snippet); hits.append(link);
        }
    };
    /** @type {HTMLElement} */ (doc.querySelector('.hb-wrap')).addEventListener('click', event => {
        const link = /** @type {Element} */ (event.target).closest(/** @type {'a'} */ ('a[href^="#"]'));
        if (!link || event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        let id;
        try { id = decodeURIComponent(link.hash.slice(1)); } catch { return; }
        if (navigate(id)) event.preventDefault();
    });
    input.addEventListener('input', renderSearch);
    doc.getElementById('handbookContextClose').addEventListener('click', () => { context.hidden = true; clearHighlight(); clearContextRequest(); });
    doc.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); input.focus(); input.select(); }
        if (event.key === 'Escape' && doc.activeElement === input) { input.value = ''; openTarget(currentId, { focus: false }); }
    });
    const fromLocation = (initial = false) => {
        let id;
        try { id = decodeURIComponent(win.location.hash.slice(1)); } catch { id = ''; }
        const showContext = initial && Boolean(id) && new URLSearchParams(win.location.search).get('ctx') === '1';
        if (!openTarget(id || home.id, { focus: Boolean(id), showContext })) openTarget(home.id, { focus: false });
    };
    win.addEventListener('hashchange', () => fromLocation());
    win.addEventListener('popstate', () => fromLocation());
    fromLocation(true);
}

if (globalThis.document) initHandbook();
