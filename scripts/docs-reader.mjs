/** Local, deliberately bounded Markdown reader. No packages, scripts or remote assets. */
import path from 'node:path';
import { createHash } from 'node:crypto';

// Add a page only once its source is complete. This list is shared by serve and dist.
export const READER_PAGES = Object.freeze([
    'QUICKSTART.md', 'CHANGELOG.md', 'LICENSE.md', 'docs/README.md',
    'docs/guides/EINRICHTUNG_UND_BETRIEB.md',
    ...['GESTALTUNGSGRUNDSAETZE', 'DESIGNSYSTEM', 'ENTWICKLUNGSGRUNDSAETZE', 'SCHREIBREGELN',
        'TOD_UND_ERBE', 'PFLEGE', 'IMMOBILIEN', 'STEUERN',
        'JAHRESBUDGET', 'HANDLUNGSANWEISUNG', 'STRATEGIEN', 'SIMULATION_LESEN',
        'MARKTVERGLEICH', 'MARKTVERGLEICH_EVIDENZREGISTER',
        'WISSENSCHAFTLICHER_RAHMEN', 'FORSCHUNGSABGLEICH_EVIDENZREGISTER',
        'SICHERUNG', 'BEISPIELHAUSHALTE', 'TECHNICAL', 'DATENVERTRAEGE', 'DATA_SOURCES', 'FACHKONZEPT']
        .map(name => `docs/reference/${name}.md`)
]);
export const READER_STYLES = Object.freeze(['css/tokens.css', 'css/fonts.css', 'css/components.css', 'css/docs-reader.css']);
export const readerHtmlPath = file => file.replace(/\.md$/, '.html');
export function readerSourcePath(file) {
    return READER_PAGES.find(source => file === source || file === readerHtmlPath(source)) ?? null;
}
const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const decode = value => value.replace(/&(?:amp|lt|gt|quot|apos|#39|nbsp);/g, entity => ({
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&nbsp;': ' '
}[entity]));
export const headingSlug = value => decode(value.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '').replace(/[`*_~]/g, ''))
    .replace(/\s+/g, ' ').trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
const relativeUrl = (from, to) => path.posix.relative(path.posix.dirname(from), to).split('/').map(encodeURIComponent).join('/') || path.posix.basename(to);

/** A regular Mermaid comment keeps the SVG contract out of every rendered view. */
export function diagramMetadata(code, file) {
    const lines = code.split('\n').filter(line => /^\s*%%\s+docs:diagram\b/.test(line));
    if (lines.length !== 1) throw new Error(`${file}: Mermaid needs exactly one %% docs:diagram comment`);
    const match = lines[0].match(/^\s*%% docs:diagram (\{[^\n]*\})\s*$/);
    let diagram;
    try { diagram = JSON.parse(match?.[1]); }
    catch { throw new Error(`${file}: invalid %% docs:diagram JSON`); }
    if (!['src', 'title', 'alt', 'legend'].every(key => typeof diagram?.[key] === 'string' && diagram[key].trim())) {
        throw new Error(`${file}: Mermaid needs local SVG, title, alt and legend`);
    }
    return diagram;
}

export function localReference(from, url) {
    if (/^(?:https?:|mailto:)/i.test(url)) return { external: true, url };
    if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(url)) throw new Error(`${from}: unsupported URL ${url}`);
    let parsed;
    try { parsed = new URL(url, `https://reader.invalid/${from}`); } catch { throw new Error(`${from}: invalid URL ${url}`); }
    let file;
    try { file = decodeURIComponent(parsed.pathname).replace(/^\//, ''); } catch { throw new Error(`${from}: invalid encoding ${url}`); }
    if (file.includes('\\') || file.includes('\0') || file.split('/').some(part => part.startsWith('.'))) throw new Error(`${from}: invalid local target ${url}`);
    // URL normalisation must not hide a traversal above the repository root.
    let depth = path.posix.dirname(from) === '.' ? 0 : path.posix.dirname(from).split('/').length;
    for (const part of url.split(/[?#]/)[0].split('/')) {
        const decoded = decodeURIComponent(part);
        if (decoded === '..' && --depth < 0) throw new Error(`${from}: target outside repository ${url}`);
        if (decoded && decoded !== '.' && decoded !== '..') depth++;
    }
    return { file, hash: parsed.hash, search: parsed.search };
}

/** read(path) returns UTF-8/Buffer or null; runtime(path) names shipped application assets. */
export function renderReaderPage({ file, source, read, runtime = () => false, approved = READER_PAGES }) {
    const assets = new Set(READER_STYLES), output = readerHtmlPath(file), ids = new Set(['top']), counts = new Map(), toc = [], tocTargets = [];
    const references = new Map();
    source = source.replace(/\r\n?/g, '\n');
    const pageTitle = source.match(/^#\s+(.+)$/m)?.[1] || file;
    for (const match of source.matchAll(/^ {0,3}\[([^\]]+)\]:\s*(<[^>]+>|\S+)(?:\s+.*)?$/gm)) references.set(match[1].toLowerCase(), match[2].replace(/^<|>$/g, ''));
    function target(url, image = false) {
        const ref = localReference(file, decode(url));
        if (ref.external) {
            if (image) throw new Error(`${file}: remote images are not shipped: ${url}`);
            return { href: ref.url };
        }
        const sourcePath = readerSourcePath(ref.file) || ref.file;
        if (read(sourcePath) == null) throw new Error(`${file}: missing local target ${sourcePath}`);
        const isPage = approved.includes(sourcePath);
        if (!image && !isPage && !(ref.file.endsWith('.html') && runtime(ref.file))) {
            return { repository: sourcePath + ref.hash };
        }
        if (image) {
            if (!/\.(?:svg|png|jpe?g|gif|webp)$/i.test(ref.file)) throw new Error(`${file}: unsupported image ${url}`);
            assets.add(ref.file);
        }
        return { href: relativeUrl(output, isPage ? readerHtmlPath(sourcePath) : ref.file) + ref.search + ref.hash };
    }
    function link(label, url, image = false) {
        const dest = target(url, image);
        if (dest.repository) return `<span class="docs-repository">${label} <small>(Repository: ${escape(dest.repository)})</small></span>`;
        return image ? `<img src="${escape(dest.href)}" alt="${escape(label)}" loading="lazy">` : `<a href="${escape(dest.href)}">${label}</a>`;
    }
    function inline(text) {
        const tokens = [];
        const keep = html => { tokens.push(html); return `\u0000${tokens.length - 1}\u0000`; };
        text = text.replace(/(`+)([^\n]*?)\1/g, (_, fence, code) => keep(`<code>${escape(code)}</code>`));
        // Inline/reference destinations, including balanced parentheses and optional titles.
        text = text.replace(/(!?)\[([^\]\n]+)\](?:\((<[^>]+>|(?:[^()\n]|\([^()]*\))*)(?:)\)|\[([^\]]*)\])/g,
            (original, img, label, destination, name) => {
                const url = destination === undefined ? references.get((name || label).toLowerCase()) : destination.trim().replace(/\s+["'][\s\S]*["']$/, '').replace(/^<|>$/g, '');
                if (url === undefined) return original;
                const labelHtml = escape(decode(label)).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                    .replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
                return keep(link(img ? decode(label) : labelHtml, url, Boolean(img)));
            });
        text = text.replace(/<a\s+(?:id|name)=["']([^"']+)["']\s*><\/a>/g, (_, id) => {
            if (ids.has(id)) throw new Error(`${file}: duplicate anchor ${id}`);
            ids.add(id); return keep(`<a id="${escape(id)}"></a>`);
        });
        text = text.replace(/<(https?:\/\/[^<>\s]+)>/g, (_, url) => keep(link(escape(url), url)));
        text = text.replace(/<br\s*\/?\s*>/gi, () => keep('<br>'));
        text = escape(decode(text)).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
        return text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
    }
    const lines = source.split('\n');
    let legacyDiagram = null; // Explicit --rev builds can still select the older Markdown format.
    const tableRow = line => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
    const blocks = [];
    for (let i = 0; i < lines.length;) {
        let line = lines[i];
        if (!line.trim()) { i++; continue; }
        if (line.trim().startsWith('<!--')) {
            let comment = line;
            while (!comment.includes('-->') && ++i < lines.length) comment += '\n' + lines[i];
            const legacy = comment.match(/^\s*<!-- docs:diagram (\{[^]*\}) -->\s*$/);
            if (legacy) legacyDiagram = diagramMetadata('%% docs:diagram ' + legacy[1], file);
            i++; continue;
        }
        const fence = line.match(/^\s*(`{3,}|~{3,})([\w-]*)\s*$/);
        if (fence) {
            const code = []; i++;
            while (i < lines.length && !new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[i])) code.push(lines[i++]);
            if (i === lines.length) throw new Error(`${file}: unclosed code block`);
            i++;
            if (fence[2] === 'mermaid') {
                const source = code.join('\n');
                if (legacyDiagram && /^\s*%%\s+docs:diagram\b/m.test(source)) throw new Error(`${file}: duplicate diagram metadata`);
                const diagram = legacyDiagram ?? diagramMetadata(source, file);
                const hash = createHash('sha256').update(source).digest('hex');
                const ref = localReference(file, diagram.src);
                if (ref.external || !ref.file.endsWith('.svg')) throw new Error(`${file}: diagram must be a local SVG`);
                const svg = String(read(ref.file) ?? '');
                if (!svg.includes(`data-source-sha256="${hash}"`)) throw new Error(`${file}: stale diagram SVG ${ref.file}`);
                blocks.push(`<figure>${link(diagram.alt, diagram.src, true)}<figcaption>${escape(diagram.title)}. ${escape(diagram.legend)}</figcaption></figure>`);
                legacyDiagram = null;
            } else blocks.push(`<pre><code class="language-${escape(fence[2])}">${escape(code.join('\n'))}</code></pre>`);
            continue;
        }
        if (/^ {0,3}\[[^\]]+\]:/.test(line)) { i++; continue; }
        const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
        const setext = i + 1 < lines.length && /^ {0,3}(?:=+|-+)\s*$/.test(lines[i + 1]);
        if (heading || setext) {
            const title = heading ? heading[2] : line.trim(), level = heading ? heading[1].length : lines[i + 1].trim()[0] === '=' ? 1 : 2;
            const base = headingSlug(title); let n = counts.get(base) || 0, id = n ? `${base}-${n}` : base;
            while (ids.has(id)) id = `${base}-${++n}`;
            counts.set(base, n + 1); ids.add(id);
            blocks.push(`<p class="docs-target-note">Abschnitt aus: ${escape(pageTitle)} · <a href="#top">zum Seitenanfang ↑</a></p><h${level} class="docs-heading" id="${escape(id)}">${inline(title)}</h${level}>`);
            if (level === 2) {
                toc.push(`<li><a href="#${escape(id)}">${inline(title)}</a></li>`);
                tocTargets.push(`.docs-reader:has(.docs-heading[id="${escape(id)}"]:target) nav a[href="#${escape(id)}"]`);
            }
            i += heading ? 1 : 2; continue;
        }
        if (i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*\|/.test(lines[i + 1])) {
            const headers = tableRow(line); i += 2;
            const rows = [];
            while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(tableRow(lines[i++]));
            blocks.push(`<div class="ds-table-scroll" tabindex="0" role="region" aria-label="${escape(headers.join(', '))}"><table class="ds-table"><thead><tr>${headers.map(cell => `<th scope="col">${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
            continue;
        }
        const list = line.match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/);
        if (list) {
            const ordered = /\d/.test(list[2]), tag = ordered ? 'ol' : 'ul', items = [];
            while (i < lines.length) {
                const item = lines[i].match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
                if (!item || /\d/.test(item[1]) !== ordered) break;
                let content = item[2]; i++;
                while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-+*]|\d+[.)])\s/.test(lines[i])) content += ' ' + lines[i++].trim();
                items.push(`<li>${inline(content)}</li>`);
            }
            blocks.push(`<${tag}>${items.join('')}</${tag}>`); continue;
        }
        if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) { blocks.push('<hr>'); i++; continue; }
        const paragraph = [line]; i++;
        while (i < lines.length && lines[i].trim() && !/^\s*(?:#{1,6}\s|```|~~~|<!--|[-+*]\s|\d+[.)]\s|\|)/.test(lines[i])) paragraph.push(lines[i++]);
        blocks.push(`<p>${inline(paragraph.join('\n'))}</p>`);
    }
    if (legacyDiagram) throw new Error(`${file}: diagram metadata without Mermaid source`);
    const tocStyle = tocTargets.length ? `<style>${tocTargets.join(',\n')} { background: var(--accent-soft); color: var(--accent); font-weight: 600; }</style>` : '';
    return { assets, html: `<!doctype html>\n<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(pageTitle)} · Vermögen &amp; Ruhestand</title>${READER_STYLES.map(style => `<link rel="stylesheet" href="${relativeUrl(output, style)}">`).join('')}${tocStyle}</head><body class="docs-reader"><header id="top"><a href="${relativeUrl(output, 'Handbuch.html')}">Zum Handbuch</a> · <a href="${relativeUrl(output, 'docs/README.html')}">Doku-Wegweiser</a></header><div class="docs-reader-layout"><nav aria-label="Auf dieser Seite"><ul>${toc.join('')}</ul></nav><main class="ds-card">${blocks.join('\n')}</main></div></body></html>\n` };
}

/** Generate and validate the entire local reader chain before dist is touched. */
export function buildReaderFiles({ read, runtime }) {
    const files = new Map(), assets = new Set();
    for (const file of READER_PAGES) {
        if (read(file) == null) continue; // Explicit --rev can select a commit predating a page.
        const page = renderReaderPage({ file, source: String(read(file)), read, runtime });
        files.set(readerHtmlPath(file), Buffer.from(page.html));
        for (const asset of page.assets) assets.add(asset);
    }
    for (const asset of assets) {
        const data = read(asset);
        if (data == null) throw new Error(`Reader asset missing: ${asset}`);
        files.set(asset, Buffer.from(data));
    }
    validateReaderFiles({ files, read, runtime });
    return files;
}

export function validateReaderFiles({ files, read, runtime }) {
    const queue = [...files.keys()].filter(file => file.endsWith('.html')), seen = new Set();
    const load = file => files.get(file) ?? (runtime(file) ? read(file) : null);
    while (queue.length) {
        const file = queue.shift(); if (seen.has(file)) continue; seen.add(file);
        const data = load(file);
        if (data == null) throw new Error(`Offline reader target missing: ${file}`);
        const text = String(data), refs = [];
        if (file.endsWith('.html')) {
            for (const match of text.matchAll(/\b(href|src)="([^"]*)"/g)) refs.push({ url: decode(match[2]), resource: match[1] === 'src' || /\.css(?:[?#]|$)/.test(match[2]) });
        } else if (file.endsWith('.css')) {
            for (const match of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) refs.push({ url: match[1], resource: true });
        } else if (file.endsWith('.svg')) {
            if (/<script\b|<foreignObject\b|\bon\w+\s*=|(?:href|src)\s*=|url\(|@import|<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error(`Offline reader SVG must be self-contained: ${file}`);
        }
        for (const ref of refs) {
            // Existing app action placeholders are not documentation destinations.
            if (!files.has(file) && !ref.resource && /^javascript:void\(0\);?$/.test(ref.url)) continue;
            const target = localReference(file, ref.url);
            if (target.external) {
                if (ref.resource) throw new Error(`Offline reader has external resource: ${file} -> ${ref.url}`);
                continue;
            }
            const data = load(target.file);
            if (data == null) throw new Error(`Offline reader target missing: ${file} -> ${target.file}`);
            if (target.hash && target.file.endsWith('.html')) {
                const id = decodeURIComponent(target.hash.slice(1));
                const ids = [...String(data).matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
                if (target.file === 'depot-tranchen-manager.html') {
                    const routes = String(load('app/tranches/tranchen-manager-page/views.js') ?? '').match(/const managerTargets = \{([\s\S]*?)\n\};/)?.[1] || '';
                    for (const route of routes.matchAll(/^\s*(?:'([^']+)'|([\w-]+)):\s*\{[^\n]*?focus:\s*'([^']+)'/gm)) {
                        if (ids.includes(route[3])) ids.push(route[1] || route[2]);
                    }
                }
                if (!ids.includes(id)) throw new Error(`Offline reader anchor missing: ${file} -> ${target.file}${target.hash}`);
            }
            if (/\.(?:html|css|svg)$/.test(target.file)) queue.push(target.file);
        }
    }
}
