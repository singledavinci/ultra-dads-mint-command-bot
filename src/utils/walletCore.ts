import { ethers, JsonRpcProvider, parseEther, formatEther } from 'ethers';

export interface WalletInfo {
  address: string;
  privateKey: string;
  balance: string;
}

export const generateWallets = (count: number, mnemonic?: string): WalletInfo[] => {
  const wallets: WalletInfo[] = [];
  const phrase = mnemonic || ethers.Wallet.createRandom().mnemonic!.phrase;
  const hdNode = ethers.HDNodeWallet.fromPhrase(phrase);

  for (let i = 0; i < count; i++) {
    // Derive subwallets using standard Ethereum derivation path (m/44'/60'/0'/0/i)
    const wallet = hdNode.deriveChild(i);
    wallets.push({
      address: wallet.address,
      privateKey: wallet.privateKey,
      balance: '0',
    });
  }
  return wallets;
};

export const getBalances = async (provider: JsonRpcProvider, wallets: WalletInfo[]): Promise<WalletInfo[]> => {
  const updatedWallets = await Promise.all(
    wallets.map(async (w) => {
      const balance = await provider.getBalance(w.address);
      return { ...w, balance: formatEther(balance) };
    })
  );
  return updatedWallets;
};

/**
 * Scans a range of derived wallets (from start index to end index) to find the highest index
 * that has either a non-zero balance or transaction history (nonce > 0).
 */
export const findHighestActiveWalletIndex = async (
  mnemonic: string,
  accountIndex: number,
  startIndex: number,
  maxSearchDepth: number,
  provider: JsonRpcProvider
): Promise<number> => {
  const userBaseNode = ethers.HDNodeWallet.fromPhrase(mnemonic, "", `m/44'/60'/${accountIndex}'/0`);
  let highestActiveIndex = -1;

  // Search sequentially. We await in batches or sequentially to avoid blasting the RPC.
  // We'll do a simple sequential search since user might hit rate limits on free RPCs.
  for (let i = startIndex; i < maxSearchDepth; i++) {
    const wallet = userBaseNode.deriveChild(i);
    try {
      const [balance, nonce] = await Promise.all([
        provider.getBalance(wallet.address),
        provider.getTransactionCount(wallet.address)
      ]);

      if (balance > 0n || nonce > 0) {
        highestActiveIndex = i;
      }
    } catch (err) {
      const e = err as Error;
      console.warn(`[Wallet Discovery] RPC Error checking wallet ${i}: ${e.message}`);
      // If the RPC throws an error (e.g., rate limit), we should probably stop searching
      // to avoid getting IP banned, or back off. We'll just break and return what we have so far.
      break;
    }
  }

  return highestActiveIndex;
};

export const splitGas = async (
  masterPrivateKey: string,
  subWallets: string[], // array of addresses
  amountPerWallet: string,
  provider: JsonRpcProvider
) => {
  const masterWallet = new ethers.Wallet(masterPrivateKey, provider);
  const amount = parseEther(amountPerWallet);

  const txPromises = [];
  let nonce = await masterWallet.getNonce();
  const feeData = await provider.getFeeData();

  for (let i = 0; i < subWallets.length; i++) {
    const address = subWallets[i];
    
    // Add a micro-stagger to avoid RPC 429 errors during broadcast
    if (i > 0) await new Promise(r => setTimeout(r, 60));

    const p = masterWallet.sendTransaction({
      to: address,
      value: amount,
      nonce: nonce++,
      maxFeePerGas: feeData.maxFeePerGas ?? undefined,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? undefined,
      type: 2 // EIP-1559
    });
    
    txPromises.push(p);
  }

  // We return the promises so the caller can wait for the broadcast confirmation
  return Promise.all(txPromises);
};
