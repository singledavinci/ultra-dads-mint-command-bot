export interface ContractMintConfig {
    contractMintEnabled: boolean;
    copyMintEnabled: boolean;
    /** Skip eth_call/estimateGas in whale copy pipeline (engine still caps + can sim later). */
    copyMintSkipPipelineSim: boolean;
    simulationRequired: boolean;
    autoExecuteContractDrops: boolean;
    defaultMintQuantity: number;
    maxMintValueEth: number;
    maxGasLimit: number;
    maxFeeGwei: number;
    maxPriorityFeeGwei: number;
    overdrive: boolean;
    overdriveMultiplier: number;
    allowUnverifiedContracts: boolean;
    privateRelayEnabled: boolean;
    unsafeOverrideSimulation: boolean;
    etherscanApiKey?: string;
    dryRun: boolean;
    signatureMintEnabled: boolean;
}

function readBool(key: string, def: boolean): boolean {
    const v = process.env[key];
    if (v === undefined || v === '') return def;
    return v === 'true' || v === '1';
}

function readFloat(key: string, def: number): number {
    const v = parseFloat(process.env[key] || '');
    return Number.isFinite(v) ? v : def;
}

function readInt(key: string, def: number): number {
    const v = parseInt(process.env[key] || '', 10);
    return Number.isFinite(v) ? v : def;
}

let cached: ContractMintConfig | null = null;

export function getContractMintConfig(): ContractMintConfig {
    if (cached) return cached;
    cached = {
        contractMintEnabled: readBool('CONTRACT_MINT_ENABLED', true),
        copyMintEnabled: readBool('COPY_MINT_ENABLED', true),
        copyMintSkipPipelineSim: readBool('COPY_MINT_SKIP_PIPELINE_SIM', true),
        simulationRequired: readBool('SIMULATION_REQUIRED', true),
        autoExecuteContractDrops: readBool('AUTO_EXECUTE_CONTRACT_DROPS', false),
        defaultMintQuantity: readInt('DEFAULT_MINT_QUANTITY', 1),
        maxMintValueEth: readFloat('MAX_MINT_VALUE_ETH', 0.05),
        maxGasLimit: readInt('MAX_GAS_LIMIT', 500_000),
        maxFeeGwei: readFloat('MAX_FEE_GWEI', 80),
        maxPriorityFeeGwei: readFloat('MAX_PRIORITY_FEE_GWEI', 5),
        overdrive: readBool('OVERDRIVE', false),
        overdriveMultiplier: readFloat('OVERDRIVE_MULTIPLIER', 1.25),
        allowUnverifiedContracts: readBool('ALLOW_UNVERIFIED_CONTRACTS', true),
        privateRelayEnabled: readBool('PRIVATE_RELAY_ENABLED', false),
        unsafeOverrideSimulation: readBool('UNSAFE_OVERRIDE_SIMULATION', false),
        etherscanApiKey: process.env.ETHERSCAN_API_KEY?.trim() || undefined,
        dryRun: readBool('CONTRACT_MINT_DRY_RUN', false),
        signatureMintEnabled: readBool('SIGNATURE_MINT_ENABLED', true),
    };
    return cached;
}

export function resetContractMintConfigForTests(): void {
    cached = null;
}
