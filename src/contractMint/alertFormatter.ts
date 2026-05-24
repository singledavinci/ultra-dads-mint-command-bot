import type { ContractMintPlan, ContractMintPipelineResult, DetectedContractMint } from './types.js';

export function formatContractMintAlert(result: ContractMintPipelineResult): string {
    const d = result.detected;
    const p = result.plan;
    const lines: string[] = ['<b>CONTRACT MINT DETECTED</b>'];

    lines.push(`<b>Collection:</b> ${escapeHtml(d?.collectionName || 'Unknown')}`);
    lines.push(`<b>Contract:</b> <code>${d?.tokenContract || p?.tokenContract || 'n/a'}</code>`);
    lines.push(`<b>Token Standard:</b> ${d?.tokenStandard || p?.tokenStandard || 'unknown'}`);
    lines.push(`<b>Mint Type:</b> ${p?.mintType || 'unknown'}`);
    lines.push(`<b>Function:</b> ${escapeHtml(p?.functionName || d?.selector || 'unknown')}`);
    lines.push(`<b>Value:</b> ${p?.value || d?.valueWei || '0'}`);
    lines.push(`<b>Quantity:</b> ${p?.quantity ?? d?.quantity ?? 1}`);
    lines.push(`<b>Simulation:</b> ${p?.simulationStatus || 'not_run'}`);
    if (p?.simulationFailure) lines.push(`<b>Sim failure:</b> ${p.simulationFailure}`);
    lines.push(`<b>Executable:</b> ${p?.executable ? 'yes' : 'no'}`);
    lines.push(`<b>Reason:</b> ${escapeHtml(p?.reason || p?.skipReason || 'pending')}`);
    if (d?.txHash) {
        lines.push(`<b>Tx:</b> <a href="https://etherscan.io/tx/${d.txHash}">${d.txHash.slice(0, 14)}…</a>`);
    }
    const action =
        p?.actionTaken ?? (result.executed ? 'submitted' : 'none (preview only — execution runs separately)');
    lines.push(`<b>Action Taken:</b> ${escapeHtml(action)}`);
    if (p?.skipReason) lines.push(`\n${escapeHtml(p.skipReason)}`);
    if (result.executionTxHashes?.length) {
        lines.push(`\n<b>Submitted:</b> ${result.executionTxHashes.length} tx(s)`);
    }
    return lines.join('\n');
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Compact plan summary for whale automint (no misleading “action taken” before engine runs). */
export function formatAutomintPlanContext(result: ContractMintPipelineResult): string {
    const p = result.plan;
    if (!p) return '';
    const lines: string[] = [
        `<b>Copy-mint plan</b> · <code>${escapeHtml(p.functionName || p.selector)}</code>`,
        `Route: ${p.category} · Executable: ${p.executable ? 'yes' : 'no'}`,
        `Sim: ${p.simulationStatus || 'not_run'} · ${escapeHtml(p.reason || '')}`,
    ];
    if (p.skipReason && !p.executable) {
        lines.push(escapeHtml(p.skipReason));
    }
    return lines.join('\n');
}

export function formatPreview(plan: ContractMintPlan): string {
    return (
        `<b>Mint preview</b>\n` +
        `Contract: <code>${plan.tokenContract}</code>\n` +
        `Target: <code>${plan.executionTarget}</code>\n` +
        `Function: ${plan.functionName} (${plan.selector})\n` +
        `Qty: ${plan.quantity} | Value: ${plan.value}\n` +
        `Simulation: ${plan.simulationStatus}\n` +
        `Executable: ${plan.executable ? 'yes' : 'no'}\n` +
        `${plan.reason}`
    );
}
