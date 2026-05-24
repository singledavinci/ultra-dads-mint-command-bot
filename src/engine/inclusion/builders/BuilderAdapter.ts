import type {
    BundleSimulationResult,
    BundleSpec,
    BundleSubmitResult,
} from '../../../types/inclusion';

export interface BuilderAdapter {
    readonly name: string;
    simulateBundle(spec: BundleSpec): Promise<BundleSimulationResult>;
    sendBundle(spec: BundleSpec): Promise<BundleSubmitResult>;
    getBundleStats?(bundleHash: string, targetBlock: number): Promise<{ included: boolean }>;
}
