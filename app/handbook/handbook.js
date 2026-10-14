/** Aufgabenhilfe ohne Profilzugriff oder Speicherwirkung. */
export function normalizeSearch(value) {
    return String(value).normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('de').replace(/ß/g, 'ss');
}

// Suchnormalisierung kann die Länge ändern (ß → ss); Marken bleiben am Originaltext.
export function findSearchRange(text, query) {
    const starts = [], ends = [];
    let folded = '', offset = 0;
    for (const character of String(text)) {
        const normalized = normalizeSearch(character);
        folded += normalized;
        for (let i = 0; i < normalized.length; i++) { starts.push(offset); ends.push(offset + character.length); }
        offset += character.length;
    }
    const needle = normalizeSearch(query);
    if (!needle) return null;
    const index = folded.indexOf(needle);
    return index < 0 ? null : { start: starts[index], end: ends[index + needle.length - 1] };
}

export function searchChapters(records, query) {
    const words = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return records.map(record => {
        const text = normalizeSearch(record.text);
        if (!words.every(word => text.includes(word))) return null;
        const title = normalizeSearch(record.title);
        const score = words.reduce((sum, word) => sum + (title.includes(word) ? 2 : 0), 0);
        const first = findSearchRange(record.text, words[0])?.start || 0;
        const start = Math.max(0, first - 70);
        return { ...record, score, snippet: (start ? '… ' : '') + record.text.slice(start, start + 240) + (start + 240 < record.text.length ? ' …' : '') };
    }).filter(Boolean).sort((a, b) => b.score - a.score);
}

const searchBlockTags = new Set('ARTICLE ASIDE BLOCKQUOTE BR DD DIV DL DT FIGCAPTION FIGURE H1 H2 H3 H4 H5 H6 HR LI OL P SECTION TABLE TBODY TD TH THEAD TR UL'.split(' '));

// Blockgrenzen trennen Wörter; Inline-Auszeichnungen bleiben Teil ihres Satzes.
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

export function initHandbook(doc = globalThis.document, win = doc?.defaultView) {
    if (!doc || !win) return;
    const chapters = [...doc.querySelectorAll('[data-handbook-chapter]')];
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
    const markNavigation = id => doc.querySelectorAll('.hb-nav a').forEach(link => {
        if (link.hash === '#' + id) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });
    const openTarget = (id, { focus = true, showContext = false } = {}) => {
        const target = doc.getElementById(id);
        if (!target) return false;
        const chapter = target.closest('[data-handbook-chapter]');
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
            for (const linkId of ['handbookAppLink', 'handbookReturn']) doc.getElementById(linkId).href = chapter.dataset.app;
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
        const words = normalizeSearch(query).split(/\s+/);
        for (const match of matches) {
            const chapter = doc.getElementById(match.id);
            const section = [...chapter.querySelectorAll('.hb-section')].find(item => words.every(word => normalizeSearch(handbookSearchText(item)).includes(word)));
            const link = doc.createElement('a'); link.className = 'hb-hit'; link.href = '#' + (section?.id || match.id);
            const heading = doc.createElement('h3'); heading.textContent = match.title;
            const snippet = doc.createElement('p');
            // Nur Textknoten; auch HTML-artige Suchbegriffe können kein Markup einfügen.
            const range = findSearchRange(match.snippet, words[0]);
            if (!range) snippet.textContent = match.snippet;
            else {
                snippet.append(doc.createTextNode(match.snippet.slice(0, range.start)));
                const mark = doc.createElement('mark'); mark.textContent = match.snippet.slice(range.start, range.end); snippet.append(mark);
                snippet.append(doc.createTextNode(match.snippet.slice(range.end)));
            }
            link.append(heading, snippet); hits.append(link);
        }
    };
    doc.querySelector('.hb-wrap').addEventListener('click', event => {
        const link = event.target.closest('a[href^="#"]');
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
