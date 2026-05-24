/**
 * Builder bundle environment checks — see docs/BUNDLE_MECHANICS_SPEC.md.
 */
import type { RuntimeConfig } from '../config/runtimeConfig';
import { getRuntimeConfig } from '../config/runtimeConfig';
import type { InclusionMetrics } from '../types/inclusion';

export interface BuilderEnvCheck {
    ok: boolean;
    errors: string[];
    warnings: string[];
}

export function checkBuilderEnvironment(cfg: RuntimeConfig = getRuntimeConfig()): BuilderEnvCheck {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!cfg.builderMintEnabled) {
        return { ok: true, errors, warnings };
    }

    if (!cfg.flashbotsAuthPrivateKey?.trim()) {
        errors.push('FLASHBOTS_AUTH_PRIVATE_KEY is required when BUILDER_MINT_ENABLED=true');
    }

    if (cfg.builderAllowPublicFallback) {
        warnings.push(
            'BUILDER_ALLOW_PUBLIC_FALLBACK=true — public mempool fallback can leak calldata (discouraged)'
        );
    }

    if (cfg.builderSecondaryRelayFallback && !cfg.titanRelayUrl?.trim()) {
        warnings.push('BUILDER_SECONDARY_RELAY_FALLBACK=true but TITAN_RELAY_URL is unset');
    }

    if (cfg.flashbotsRelayUrl.includes('rpc.flashbots.net') && !cfg.flashbotsRelayUrl.includes('relay.')) {
        warnings.push('FLASHBOTS_RELAY_URL looks like Protect RPC — use https://relay.flashbots.net for bundles');
    }

    if (cfg.maxTotalBundleEth > 2) {
        warnings.push(
            `MAX_TOTAL_BUNDLE_ETH=${cfg.maxTotalBundleEth} is high — confirm budget before competitive drops`
        );
    }

    if (cfg.builderCoinbaseContract) {
        warnings.push(
            `BUILDER_COINBASE_CONTRACT set — bundle adds tip tx from first wallet (nonce+1); contract must forward to block.coinbase`
        );
    }

    if (cfg.builderUseMevSendBundle) {
        warnings.push('BUILDER_USE_MEV_SEND_BUNDLE=true — using mev_sendBundle (MEV-Share format)');
    }

    if (cfg.builderPartialBundleRegen) {
        warnings.push(
            'BUILDER_PARTIAL_BUNDLE_REGEN=true — sim-failing wallets are dropped and bundle retried'
        );
    }

    return { ok: errors.length === 0, errors, warnings };
}

export function logBuilderStartupChecks(check: BuilderEnvCheck): void {
    if (!getRuntimeConfig().builderMintEnabled) return;
    for (const w of check.warnings) {
        console.warn(`[Builder] ⚠️ ${w}`);
    }
    for (const e of check.errors) {
        console.error(`[Builder] ❌ ${e}`);
    }
    if (check.ok && check.warnings.length === 0) {
        console.log('[Builder] Config OK (see docs/BUNDLE_MECHANICS_SPEC.md)');
    }
}

export function formatBuilderDebugHtml(
    metrics: InclusionMetrics,
    pendingBundles: Array<{ bundleHash: string; targetBlock: number; wallets: number; ageMs: number }>
): string {
    const cfg = getRuntimeConfig();
    const check = checkBuilderEnvironment(cfg);
    let text =
        `\n<b>Builder bundles</b>\n` +
        `Enabled: ${cfg.builderMintEnabled ? 'ON' : 'OFF'}\n` +
        `Relay: ${cfg.flashbotsRelayUrl.replace(/https?:\/\//, '').slice(0, 40)}\n` +
        `Auth key: ${cfg.flashbotsAuthPrivateKey ? 'set' : 'missing'}\n` +
        `Public fallback: ${cfg.builderAllowPublicFallback ? 'ON ⚠️' : 'OFF ✅'}\n` +
        `Secondary relay: ${cfg.builderSecondaryRelayFallback ? 'ON' : 'off'}\n` +
        `Caps: ${cfg.builderMaxTxsPerBundle} tx/bundle · ${cfg.maxTotalBundleEth} ETH max · tip ≤${cfg.maxBuilderTipEth} ETH\n` +
        `Submitted: ${metrics.bundlesSubmitted} · Included: ${metrics.bundlesIncluded} · Partial regen: ${metrics.bundlesPartialRegen}\n` +
        `Public: ${metrics.publicBroadcasts} · Protected: ${metrics.protectedBroadcasts}\n`;

    if (pendingBundles.length > 0) {
        text += `Pending: ${pendingBundles.length}\n`;
        for (const p of pendingBundles.slice(0, 3)) {
            text += `• <code>${p.bundleHash.slice(0, 10)}…</code> block ${p.targetBlock} (${p.wallets}w, ${Math.round(p.ageMs / 1000)}s)\n`;
        }
    } else {
        text += `Pending: 0\n`;
    }

    if (check.errors.length) {
        text += `\n<b>Config errors</b>\n${check.errors.map(e => `• ${e}`).join('\n')}\n`;
    }
    if (check.warnings.length) {
        text += `\n<b>Warnings</b>\n${check.warnings.slice(0, 3).map(w => `• ${w}`).join('\n')}\n`;
    }

    return text;
}
