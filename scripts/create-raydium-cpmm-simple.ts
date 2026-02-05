/**
 * Create Raydium CPMM Pool - Simple Version
 */

import { 
  Raydium, 
  TxVersion,
  CREATE_CPMM_POOL_PROGRAM,
  CREATE_CPMM_POOL_FEE_ACC,
} from '@raydium-io/raydium-sdk-v2';
import { 
  Connection, 
  Keypair, 
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

const mintAddress = process.argv[2];
if (!mintAddress) {
  console.error('Usage: npx ts-node scripts/create-raydium-cpmm-simple.ts <MINT_ADDRESS>');
  process.exit(1);
}

// Load wallet
const KEYPAIR_PATH = path.join(process.env.HOME!, '.config/solana/id.json');
const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
const owner = Keypair.fromSecretKey(new Uint8Array(keypairData));

const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

async function main() {
  console.log('🏊 Creating Raydium CPMM Pool');
  console.log(`Mint: ${mintAddress}`);
  console.log(`Wallet: ${owner.publicKey.toBase58()}\n`);

  const balance = await connection.getBalance(owner.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  console.log('Initializing SDK...');
  
  try {
    const raydium = await Raydium.load({
      owner,
      connection,
      cluster: 'mainnet',
      disableFeatureCheck: true,
      disableLoadToken: true, // Don't load all tokens
      blockhashCommitment: 'finalized',
    });
    console.log('SDK initialized\n');

    // Get fee configs
    console.log('Fetching configs...');
    const feeConfigs = await raydium.api.getCpmmConfigs();
    const feeConfig = feeConfigs[0]; // Use first (0.25%)
    console.log(`Using fee: ${feeConfig.tradeFeeRate}\n`);

    // Build pool creation
    console.log('Creating pool...');
    const { execute, extInfo } = await raydium.cpmm.createPool({
      programId: CREATE_CPMM_POOL_PROGRAM,
      poolFeeAccount: CREATE_CPMM_POOL_FEE_ACC,
      mintA: {
        address: 'So11111111111111111111111111111111111111112',
        programId: TOKEN_PROGRAM_ID.toBase58(),
        decimals: 9,
      },
      mintB: {
        address: mintAddress,
        programId: TOKEN_2022_PROGRAM_ID.toBase58(),
        decimals: 9,
      },
      mintAAmount: new BN('50000000'), // 0.05 SOL
      mintBAmount: new BN('100000000000000000'), // 100M tokens with 9 decimals
      startTime: new BN(0),
      feeConfig,
      associatedOnly: false,
      ownerInfo: {
        useSOLBalance: true,
      },
      txVersion: TxVersion.LEGACY, // Try legacy first
    });

    console.log(`Pool ID: ${extInfo.address.poolId.toString()}`);
    
    console.log('\nExecuting...');
    const { txId } = await execute({ sendAndConfirm: true });
    
    console.log('\n✅ SUCCESS!');
    console.log(`TX: ${txId}`);
    
  } catch (err: any) {
    console.error('\n❌ Error:', err.message);
    console.error(err.stack);
    if (err.logs) {
      console.log('\nLogs:');
      err.logs.slice(-10).forEach((l: string) => console.log('  ', l));
    }
  }
}

main();
