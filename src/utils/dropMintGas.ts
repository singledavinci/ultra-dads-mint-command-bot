/**
 * Drop mint gas / tip options — wizard + scheduled fire execution.
 */

import { parseEther } from 'ethers';
import type { ScheduledMint } from '../bot/stateManager.js';
import type { ResolvedDropExecution } from '../services/scheduledDropResolver.js';
import { scheduledDropExecuteOptions } from '../services/scheduledDropResolver.js';
import type { LinkMintConfig } from '../services/linkMintService.js';
import { GAS_TIER_DEFS, type GasTierId } from '../services/networkGas.js';

export type DropMintGasChoice = {
    gasTierId?: string;
    gasBribeGwei?: string;
    priorityBoostEth?: string;
    overdrive?: boolean;
    inclusionMode?: 'public' | 'protected' | 'builder_flashbots' | 'builder_titan';
};

export function parseCustomGweiBribe(text: string): { ok: true; value: string } | { ok: false; error: string } {
    const t = text.trim().replace(/gwei$/i, '').trim();
    const n = parseFloat(t);
    if (Number.isNaN(n) || n < 0) {
        return { ok: false, error: 'Send a non-negative GWEI value (e.g. 5 or 0 for off).' };
    }
    return { ok: true, value: String(n) };
}

export function parseCustomTipEth(text: string): { ok: true; value: string } | { ok: false; error: string } {
    const t = text.trim().replace(/eth$/i, '').trim();
    const n = parseFloat(t);
    if (Number.isNaN(n) || n < 0) {
        return { ok: false, error: 'Send a non-negative ETH tip (e.g. 0.004 or 0 for none).' };
    }
    return { ok: true, value: String(n) };
}

export function gasChoiceFromTierReport(
    tierId: string,
    gasReportJson: string
): DropMintGasChoice | null {
    try {
        const report = JSON.parse(gasReportJson) as {
            tiers?: Array<{
                id: string;
                gasBribeGwei: string;
                priorityBoostEth: number;
                overdrive: boolean;
                suggestedInclusionMode: 'public' | 'builder_flashbots';
            }>;
        };
        const tier = report.tiers?.find(t => t.id === tierId);
        if (!tier) return null;
        return {
            gasTierId: tier.id,
            gasBribeGwei: tier.gasBribeGwei,
            priorityBoostEth: String(tier.priorityBoostEth),
            overdrive: tier.overdrive,
            inclusionMode: tier.suggestedInclusionMode,
        };
    } catch {
        return null;
    }
}

export function defaultDropMintGasChoice(): DropMintGasChoice {
    const def = (process.env.LINK_MINT_GAS_TIER || 'fcfs_plus') as GasTierId;
    const tierDef = GAS_TIER_DEFS.find(t => t.id === def) ?? GAS_TIER_DEFS[2];
    return {
        gasTierId: tierDef.id,
        gasBribeGwei: String(tierDef.bribeGwei),
        priorityBoostEth: String(tierDef.builderTipEth),
        overdrive: tierDef.overdrive,
        inclusionMode: tierDef.builderTipEth > 0 ? 'builder_flashbots' : 'public',
    };
}

export function formatGasChoiceLabel(gas: DropMintGasChoice): string {
    const tier = gas.gasTierId || 'default';
    const bribe = gas.gasBribeGwei && parseFloat(gas.gasBribeGwei) > 0 ? `+${gas.gasBribeGwei} gwei` : 'no extra bribe';
    const tip =
        gas.priorityBoostEth && parseFloat(gas.priorityBoostEth) > 0
            ? `${gas.priorityBoostEth} ETH tip`
            : 'no tip';
    const mode = gas.inclusionMode || 'public';
    return `${tier} · ${bribe} · ${tip} · ${mode}`;
}

export function scheduledMintGasFields(gas: DropMintGasChoice): Partial<ScheduledMint> {
    return {
        gasTierId: gas.gasTierId,
        gasBribeGwei: gas.gasBribeGwei,
        priorityBoostEth: gas.priorityBoostEth,
        overdrive: gas.overdrive,
        inclusionMode: gas.inclusionMode,
    };
}

export function gasChoiceFromScheduledMint(sm: ScheduledMint): DropMintGasChoice {
    return {
        gasTierId: sm.gasTierId,
        gasBribeGwei: sm.gasBribeGwei,
        priorityBoostEth: sm.priorityBoostEth,
        overdrive: sm.overdrive,
        inclusionMode: sm.inclusionMode,
    };
}

export function dropMintExecuteOptionsFromScheduled(
    resolved: ResolvedDropExecution,
    sm: ScheduledMint,
    linkCfg: LinkMintConfig
): Record<string, unknown> {
    const base = scheduledDropExecuteOptions(resolved, linkCfg);
    const gas = gasChoiceFromScheduledMint(sm);
    if (gas.gasTierId) base.gasTierId = gas.gasTierId;
    if (gas.gasBribeGwei !== undefined && gas.gasBribeGwei !== '') {
        base.gasBribeGwei = gas.gasBribeGwei;
    }
    if (gas.priorityBoostEth && parseFloat(gas.priorityBoostEth) > 0) {
        base.builderTipWei = parseEther(gas.priorityBoostEth).toString();
    }
    if (gas.overdrive) base.overdrive = true;
    if (gas.inclusionMode) base.inclusionMode = gas.inclusionMode;
    return base;
}
