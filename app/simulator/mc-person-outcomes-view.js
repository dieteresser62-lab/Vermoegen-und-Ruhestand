import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { escapeProtocolHtml } from './protocol-renderer.js';

const formatNumber = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

function share(count, total) {
    if (!total) return '—';
    const nearestEnd = Math.min(count, total - count);
    const fractionDigits = nearestEnd > 0 && nearestEnd / total <= 0.0005 ? 4 : 1;
    const percent = formatDisplayNumber(count / total, { unit: 'ratio', fractionDigits, minimumFractionDigits: 0 });
    return `${percent} (${formatNumber.format(count)} von ${formatNumber.format(total)})`;
}

const partnerHeaders = [
    'Woran es lag', 'Stirbt zuerst: reicht für den Partner',
    'Partner lebt danach noch (Jahre, Median)', 'Stirbt zuerst (alle Läufe)'
];

export function renderMonteCarloPersonOutcomes(host, rows, persons) {
    if (!host) return;
    const table = host.querySelector('table');
    host.hidden = !rows?.length;
    if (host.hidden) {
        table.innerHTML = '';
        return;
    }
    const headers = ['Person', 'Reicht, solange sie lebt', ...(rows.length === 2 ? partnerHeaders : [])];
    table.innerHTML = `<thead><tr>${headers.map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(({ runs, coveredWhileAlive, partner }, index) => {
            const failures = runs - coveredWhileAlive;
            const name = escapeProtocolHtml(persons[index]?.name || `Person ${index + 1}`);
            const partnerCells = partner ? `<td>${failures ? [
                ['Partner gestorben', partner.partnerDiedByFailure],
                ['Pflegefall', partner.careStartedByFailure],
                ['Weder noch', partner.neitherByFailure]
            ].map(([label, count]) => `<div>${label}: ${share(count, failures)}</div>`).join('') : '—'}</td>
            <td>${share(partner.coveredForSurvivor, partner.diedFirst)}</td>
            <td>${partner.medianSurvivalYears === null ? '—' : formatNumber.format(partner.medianSurvivalYears)}</td>
            <td>${share(partner.diedFirst, runs)}<div class="ds-hint">Gleichzeitig: ${share(partner.simultaneousDeaths, runs)}</div></td>` : '';
            return `<tr><th scope="row">${name}</th><td>${share(coveredWhileAlive, runs)}</td>${partnerCells}</tr>`;
        }).join('')}</tbody>`;
}
