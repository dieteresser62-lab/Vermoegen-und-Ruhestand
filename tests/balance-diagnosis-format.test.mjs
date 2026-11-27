import { formatDiagnosisPayload } from '../app/balance/balance-diagnosis-format.js';

console.log('--- Balance Diagnosis Format Tests ---');

{
    const formatted = formatDiagnosisPayload({
        guardrails: [
            {
                name: 'Budget-Floor Deckung',
                value: 129702.2,
                threshold: 129702.2,
                type: 'currency',
                rule: 'min'
            }
        ],
        keyParams: {}
    });

    const guardrail = formatted.guardrails[0];
    assertEqual(guardrail.status, 'ok', 'Exact min threshold should be OK, not warn');
    assert(guardrail.note.includes('Exakt auf Mindestniveau'), 'Exact min threshold should explain boundary status');
}

{
    const formatted = formatDiagnosisPayload({
        guardrails: [
            {
                name: 'Runway',
                value: 104,
                threshold: 100,
                type: 'percent',
                rule: 'min'
            }
        ],
        keyParams: {}
    });

    const guardrail = formatted.guardrails[0];
    assertEqual(guardrail.status, 'warn', 'Narrow margin above min threshold should stay warn');
    assert(guardrail.note.includes('Knapp'), 'Narrow margin should explain low safety distance');
}

{
    const raw = { guardrails: [], threeBucket: { is3Bucket: true, isBadYear: true } };
    const original = JSON.stringify(raw);
    const first = formatDiagnosisPayload(raw);
    assertEqual(first.guardrails.length, 1, 'Die Zeile für 3-Töpfe steht schon in der ersten Diagnose');
    assertEqual(first.guardrails[0]?.name, '3-Töpfe', 'Die zusätzliche Zeile gehört zur formatierten Diagnose');
    assertEqual(JSON.stringify(formatDiagnosisPayload(raw)), JSON.stringify(first), 'Wiederholtes Formatieren ergibt dieselbe Diagnose');
    assertEqual(JSON.stringify(raw), original, 'Die Rohdiagnose bleibt unverändert');
}

console.log('✅ Balance diagnosis format tests passed');
console.log('--- Balance Diagnosis Format Tests Completed ---');
