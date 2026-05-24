/**
 * @deprecated Use builderPayment.ts — v1 uses EIP-1559 priority boost only.
 * Kept for import stability during migration.
 */
export {
    applyPriorityBoostToPlan,
    defaultPriorityBoostWei as defaultBuilderTipWei,
    priorityBoostWeiFromEth as builderTipWeiFromEth,
    getChainId,
} from './builderPayment';
