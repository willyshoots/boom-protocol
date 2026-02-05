/**
 * Custom LP Creation with Transfer Hook Support
 * 
 * Uses Raydium CPMM (supports Token2022) with proper extra account resolution
 * for our transfer hook.
 */

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createSyncNativeInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  NATIVE_MINT,
  getExtraAccountMetaAddress,
  getExtraAccountMetas,
  addExtraAccountMetasForExecute,
  getTransferHook,
  resolveExtraAccountMeta,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

const HOOK_PROGRAM_ID = new PublicKey('CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9');

// Parse args
const args = process.argv.slice(2);
const mintAddress = args.find(a => a.startsWith('--mint='))?.split('=')[1];
const solForLp = parseFloat(args.find(a => a.startsWith('--sol='))?.split('=')[1] || '0.05');
const tokensForLp = parseFloat(args.find(a => a.startsWith('--tokens='))?.split('=')[1] || '100000000');
const isMainnet = args.includes('--mainnet');

if (!mintAddress) {
  console.error('Usage: npx ts-node scripts/create-lp-custom.ts --mint=<MINT> --sol=0.05 --tokens=100000000 --mainnet');
  process.exit(1);
}

const RPC_URL = isMainnet 
  ? 'https://api.mainnet-beta.solana.com'
  : 'https://api.devnet.solana.com';

// Load wallet
const KEYPAIR_PATH = path.join(process.env.HOME!, '.config/solana/id.json');
const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));

function getDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

function getWhitelistPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('whitelist'), mint.toBuffer()], HOOK_PROGRAM_ID);
}

function getHookConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('hook_config')], HOOK_PROGRAM_ID);
}

async function main() {
  const mint = new PublicKey(mintAddress!);
  const TOKEN_DECIMALS = 9;
  
  console.log('🏊 Custom LP Creation with Transfer Hook Support');
  console.log('================================================');
  console.log(`Network: ${isMainnet ? 'MAINNET' : 'DEVNET'}`);
  console.log(`Mint: ${mint.toBase58()}`);
  console.log(`SOL for LP: ${solForLp}`);
  console.log(`Tokens for LP: ${tokensForLp.toLocaleString()}`);
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  console.log('');

  const connection = new Connection(RPC_URL, 'confirmed');
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  // Get hook extra accounts PDA
  const extraMetasAddress = getExtraAccountMetaAddress(mint, HOOK_PROGRAM_ID);
  console.log(`Extra Metas PDA: ${extraMetasAddress.toBase58()}`);
  
  const [whitelistPDA] = getWhitelistPDA(mint);
  console.log(`Whitelist PDA: ${whitelistPDA.toBase58()}`);

  // Check if extra metas account exists
  const extraMetasInfo = await connection.getAccountInfo(extraMetasAddress);
  if (!extraMetasInfo) {
    console.error('❌ Extra account metas PDA not found. Hook not initialized properly.');
    process.exit(1);
  }
  console.log('✅ Extra account metas found\n');

  // Step 1: Create a test transfer to verify hook works
  console.log('🧪 Step 1: Testing transfer with hook extra accounts...');
  
  const walletAta = getAssociatedTokenAddressSync(mint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  
  // Create a second wallet ATA to test transfer
  const testKeypair = Keypair.generate();
  const testAta = getAssociatedTokenAddressSync(mint, testKeypair.publicKey, false, TOKEN_2022_PROGRAM_ID);
  
  // Build transfer instruction with extra accounts
  const transferAmount = BigInt(1000) * BigInt(10 ** TOKEN_DECIMALS); // 1000 tokens
  
  let transferIx = createTransferCheckedInstruction(
    walletAta,
    mint,
    testAta,
    wallet.publicKey,
    transferAmount,
    TOKEN_DECIMALS,
    [],
    TOKEN_2022_PROGRAM_ID
  );

  // Add extra account metas for transfer hook
  console.log('   Adding extra account metas for hook...');
  
  await addExtraAccountMetasForExecute(
    connection,
    transferIx,
    HOOK_PROGRAM_ID,
    walletAta,
    mint,
    testAta,
    wallet.publicKey,
    transferAmount,
    'confirmed'
  );

  console.log(`   Transfer instruction now has ${transferIx.keys.length} accounts`);
  
  // Log the accounts for debugging
  console.log('   Accounts in transfer instruction:');
  transferIx.keys.forEach((key, i) => {
    console.log(`     ${i}: ${key.pubkey.toBase58().slice(0, 20)}... (signer: ${key.isSigner}, writable: ${key.isWritable})`);
  });

  // Create test ATA and do test transfer
  const testTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }),
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      testAta,
      testKeypair.publicKey,
      mint,
      TOKEN_2022_PROGRAM_ID
    ),
    transferIx
  );

  try {
    const testSig = await sendAndConfirmTransaction(connection, testTx, [wallet], {
      skipPreflight: true,
    });
    console.log(`   ✅ Test transfer succeeded: ${testSig}`);
  } catch (err: any) {
    console.error(`   ❌ Test transfer failed: ${err.message}`);
    if (err.logs) {
      console.log('\n   Logs:');
      err.logs.slice(-10).forEach((log: string) => console.log(`     ${log}`));
    }
    
    // Check if the failure is due to whitelist
    console.log('\n   Checking whitelist status...');
    const whitelistInfo = await connection.getAccountInfo(whitelistPDA);
    if (whitelistInfo) {
      // Parse whitelist - official_lp is at offset 8 (after discriminator)
      const officialLp = new PublicKey(whitelistInfo.data.slice(8, 40));
      console.log(`   Current whitelisted LP: ${officialLp.toBase58()}`);
      if (officialLp.equals(PublicKey.default)) {
        console.log('   ⚠️ No LP whitelisted yet - transfers are blocked');
      }
    }
    
    process.exit(1);
  }

  console.log('\n✅ Transfer hook is working! Now we can create LP.');
  console.log('   The key is using addExtraAccountMetasForExecute() for all token transfers.\n');

  // Step 2: Now we know it works, let's think about LP creation
  console.log('📋 Step 2: LP Creation Strategy');
  console.log('   For FluxBeam/Raydium LP creation, we need to:');
  console.log('   1. Get the pool address first (from their API)');
  console.log('   2. Whitelist the pool address in our hook');
  console.log('   3. Build a custom transaction that:');
  console.log('      - Creates pool accounts');
  console.log('      - Transfers tokens WITH extra accounts');
  console.log('      - Initializes the pool');
  console.log('');
  console.log('   The challenge: DEX APIs return pre-built transactions');
  console.log('   that dont include our hook accounts.');
  console.log('');
  console.log('   Solutions:');
  console.log('   A) Use DEX SDK to build transaction ourselves with hook accounts');
  console.log('   B) Disable hook temporarily, create LP, re-enable');
  console.log('   C) Modify hook to allow transfers when destination is a new ATA');
}

main().catch(err => {
  console.error('\n❌ Failed:', err.message);
  process.exit(1);
});
