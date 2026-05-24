/**
 * User-facing hints when link mint / payment simulation fails.
 */

const SIM_FAIL_PATTERNS = [
    'all simulations failed',
    'private/allowlist/sold out',
    'unknown payment',
    'execution blocked',
];

const SEADROP_FAIL_PATTERNS = [
    'seadrop',
    'mintpublic',
    '0 per wallet',
    'drop inactive',
    'public phase',
    'not active',
    'not started',
    'has ended',
];

export function isSimulationFailureMessage(msg: string): boolean {
    const lower = msg.toLowerCase();
    return SIM_FAIL_PATTERNS.some(p => lower.includes(p));
}

export function isSeaDropMintFailureMessage(msg: string): boolean {
    const lower = msg.toLowerCase();
    return SEADROP_FAIL_PATTERNS.some(p => lower.includes(p));
}

export function formatLinkMintFailureHint(reason?: string): string {
    const lower = (reason || '').toLowerCase();
    let base: string;
    if (reason && isSeaDropMintFailureMessage(reason)) {
        base =
            'SeaDrop public mint is not available for this path.\n' +
            '• Set <code>OPENSEA_API_KEY</code> and re-paste the link for GTD/allowlist\n' +
            '• Or wait for the public window / use <code>/blockmint</code> with calldata from a live mint tx';
    } else if (reason && isSimulationFailureMessage(reason)) {
        base = reason;
    } else {
        base = 'Mint simulation failed — calldata or payment may be wrong';
    }

    return (
        `${base}\n` +
        `Try: /custommint with exact calldata · /mint &lt;contract&gt; &lt;eth&gt; &lt;data&gt; · /forcesim · copy a tracked wallet mint`
    );
}

export function shortLinkMintError(msg: string, max = 72): string {
    if (msg.length <= max) return msg;
    return msg.slice(0, max - 3) + '...';
}
