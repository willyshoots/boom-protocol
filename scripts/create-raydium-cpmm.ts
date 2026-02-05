/**
 * Create Raydium CPMM Pool for Token2022 with Transfer Hook
 * 
 * Uses Raydium SDK which claims Token2022 support
 */

import { 
  Raydium, 
  TxVersion, 
  parseTokenAccountResp,
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

// Parse args
const args = process.argv.slice(2);
const mintAddress = args.find(a => a.startsWith('--mint='))?.split('=')[1];
const solAmount = parseFloat(args.find(a => a.startsWith('--sol='))?.split('=')[1] || '0.05');
const tokenAmount = parseFloat(args.find(a => a.startsWith('--tokens='))?.split('=')[1] || '100000000');

if (!mintAddress) {
  console.error('Usage: npx ts-node scripts/create-raydium-cpmm.ts --mint=<MINT> --sol=0.05 --tokens=100000000');
  process.exit(1);
}

// Load wallet
const KEYPAIR_PATH = path.join(process.env.HOME!, '.config/solana/id.json');
const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
const owner = Keypair.fromSecretKey(new Uint8Array(keypairData));

// Use mainnet
const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
const cluster = 'mainnet' as const;

async function fetchTokenAccountData() {
  const solAccountResp = await connection.getAccountInfo(owner.publicKey);
  const tokenAccountResp = await connection.getTokenAccountsByOwner(owner.publicKey, { programId: TOKEN_PROGRAM_ID });
  const token2022Req = await connection.getTokenAccountsByOwner(owner.publicKey, { programId: TOKEN_2022_PROGRAM_ID });
  const tokenAccountData = parseTokenAccountResp({
    owner: owner.publicKey,
    solAccountResp,
    tokenAccountResp: {
      context: tokenAccountResp.context,
      value: [...tokenAccountResp.value, ...token2022Req.value],
    },
  });
  return tokenAccountData;
}

async function main() {
  console.log('🏊 Creating Raydium CPMM Pool (Token2022 Support)');
  console.log('==================================================');
  console.log(`Mint: ${mintAddress}`);
  console.log(`SOL Amount: ${solAmount}`);
  console.log(`Token Amount: ${tokenAmount.toLocaleString()}`);
  console.log(`Wallet: ${owner.publicKey.toBase58()}`);
  console.log('');

  const balance = await connection.getBalance(owner.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  console.log('📡 Initializing Raydium SDK...');
  const raydium = await Raydium.load({
    owner,
    connection,
    cluster,
    disableFeatureCheck: true,
    disableLoadToken: false,
    blockhashCommitment: 'finalized',
  });
  console.log('✅ SDK initialized\n');

  // Get mint info
  const mint = new PublicKey(mintAddress!);
  
  console.log('📡 Fetching token info...');
  
  // Try to get token info from Raydium API first
  let mintAInfo: any;
  let mintBInfo: any;
  
  try {
    // WSOL
    mintAInfo = await raydium.token.getTokenInfo('So11111111111111111111111111111111111111112');
    console.log(`   Token A (SOL): ${mintAInfo.address}`);
  } catch {
    mintAInfo = {
      address: 'So11111111111111111111111111111111111111112',
      programId: TOKEN_PROGRAM_ID.toBase58(),
      decimals: 9,
    };
    console.log(`   Token A (SOL): ${mintAInfo.address} (manual)`);
  }
  
  try {
    // Our token - might not be in their API since it's new
    mintBInfo = await raydium.token.getTokenInfo(mintAddress!);
    console.log(`   Token B: ${mintBInfo.address}`);
  } catch {
    // Manual definition for Token2022
    mintBInfo = {
      address: mint.toBase58(),
      programId: TOKEN_2022_PROGRAM_ID.toBase58(),
      decimals: 9,
    };
    console.log(`   Token B: ${mintBInfo.address} (manual - Token2022)`);
  }

  console.log(`   Token B Program: ${mintBInfo.programId}\n`);

  // Get fee configs
  console.log('📡 Fetching fee configs...');
  const feeConfigs = await raydium.api.getCpmmConfigs();
  console.log(`   Found ${feeConfigs.length} fee configs`);
  
  // Log all fee configs
  feeConfigs.forEach((cfg, i) => {
    console.log(`   [${i}] ${cfg.id} - trade fee: ${cfg.tradeFeeRate}`);
  });
  
  // Use 0.25% fee tier (look for lowest fee)
  const feeConfig = feeConfigs.sort((a, b) => a.tradeFeeRate - b.tradeFeeRate)[0];
  console.log(`   Using fee config: ${feeConfig.id} (${feeConfig.tradeFeeRate})\n`);

  // Calculate amounts with decimals
  const solLamports = new BN(Math.floor(solAmount * LAMPORTS_PER_SOL));
  const tokenLamports = new BN(Math.floor(tokenAmount * 10 ** 9));

  console.log('🔧 Creating pool...');
  console.log(`   SOL: ${solLamports.toString()} lamports`);
  console.log(`   Tokens: ${tokenLamports.toString()} lamports`);
  console.log(`   Fee config ID: ${feeConfig.id}`);
  
  // Check token accounts
  console.log('\n📡 Checking token accounts...');
  const tokenAccounts = await fetchTokenAccountData();
  console.log(`   Found ${Object.keys(tokenAccounts.tokenAccounts || {}).length} token accounts`);
  
  // Check if we have our token
  const ourTokenAccount = Object.values(tokenAccounts.tokenAccounts || {}).find(
    (acc: any) => acc.mint.toBase58() === mintAddress
  );
  if (ourTokenAccount) {
    console.log(`   ✅ Found TEST3 token account: ${(ourTokenAccount as any).amount.toString()} tokens`);
  } else {
    console.log(`   ⚠️ No token account found for ${mintAddress}`);
  }
  console.log('');

  try {
    console.log('   Building transaction...');
    const { execute, extInfo, transaction } = await raydium.cpmm.createPool({
      programId: CREATE_CPMM_POOL_PROGRAM,
      poolFeeAccount: CREATE_CPMM_POOL_FEE_ACC,
      mintA: mintAInfo,
      mintB: mintBInfo,
      mintAAmount: solLamports,
      mintBAmount: tokenLamports,
      startTime: new BN(0),
      feeConfig,
      associatedOnly: false,
      ownerInfo: {
        useSOLBalance: true,
      },
      txVersion: TxVersion.V0,
      computeBudgetConfig: {
        units: 600000,
        microLamports: 100000,
      },
    });

    console.log('📝 Transaction built. Pool info:');
    console.log(`   Pool ID: ${extInfo.address.poolId.toString()}`);
    console.log(`   LP Mint: ${extInfo.address.lpMint.toString()}\n`);

    console.log('🚀 Executing transaction...');
    const { txId } = await execute({ sendAndConfirm: true });
    
    console.log('\n🎉 POOL CREATED SUCCESSFULLY!');
    console.log('==========================================');
    console.log(`Pool ID: ${extInfo.address.poolId.toString()}`);
    console.log(`LP Mint: ${extInfo.address.lpMint.toString()}`);
    console.log(`Transaction: ${txId}`);
    console.log(`Solscan: https://solscan.io/tx/${txId}`);

  } catch (err: any) {
    console.error('\n❌ Pool creation failed:', err.message);
    if (err.logs) {
      console.log('\nTransaction logs:');
      err.logs.slice(-15).forEach((log: string) => console.log('  ', log));
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\n❌ Failed:', err.message);
  process.exit(1);
});
