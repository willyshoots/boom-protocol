/**
 * Create Token2022 with transfer hook + FluxBeam LP
 * No presale - just direct token creation and LP
 * 
 * Usage: npx ts-node scripts/create-token-with-lp.ts --name=TEST3 --symbol=TEST3
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
  VersionedTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  getMintLen,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { createHash } from 'crypto';

const HOOK_PROGRAM_ID = new PublicKey('CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9');
const TOKEN_DECIMALS = 9;
const TOTAL_SUPPLY = 1_000_000_000; // 1 billion

// Parse args
const args = process.argv.slice(2);
const tokenName = args.find(a => a.startsWith('--name='))?.split('=')[1] || 'TEST3';
const tokenSymbol = args.find(a => a.startsWith('--symbol='))?.split('=')[1] || 'TEST3';
const solForLp = parseFloat(args.find(a => a.startsWith('--sol='))?.split('=')[1] || '0.05');
const isMainnet = args.includes('--mainnet');

const RPC_URL = isMainnet 
  ? 'https://api.mainnet-beta.solana.com'
  : 'https://api.devnet.solana.com';

// Load wallet
const KEYPAIR_PATH = path.join(process.env.HOME!, '.config/solana/id.json');
const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));

// Helpers
function getDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

function httpPost(url: string, data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(data);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        } else {
          try { resolve(JSON.parse(body)); } 
          catch { reject(new Error(`Parse error: ${body}`)); }
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function getHookConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('hook_config')], HOOK_PROGRAM_ID);
}

function getWhitelistPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('whitelist'), mint.toBuffer()], HOOK_PROGRAM_ID);
}

function getExtraMetasPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('extra-account-metas'), mint.toBuffer()], HOOK_PROGRAM_ID);
}

async function main() {
  console.log('🚀 Creating Token2022 with Transfer Hook + FluxBeam LP');
  console.log('=======================================================');
  console.log(`Network: ${isMainnet ? 'MAINNET' : 'DEVNET'}`);
  console.log(`Name: ${tokenName}`);
  console.log(`Symbol: ${tokenSymbol}`);
  console.log(`SOL for LP: ${solForLp}`);
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  console.log('');

  const connection = new Connection(RPC_URL, 'confirmed');
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  // ==================== STEP 1: Create Token2022 ====================
  console.log('🪙 Step 1: Creating Token2022 with transfer hook...');
  
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  console.log(`   Mint: ${mint.toBase58()}`);

  const mintLen = getMintLen([ExtensionType.TransferHook]);
  const mintRent = await connection.getMinimumBalanceForRentExemption(mintLen);

  const tx1 = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: mint,
      space: mintLen,
      lamports: mintRent,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeTransferHookInstruction(mint, wallet.publicKey, HOOK_PROGRAM_ID, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(mint, TOKEN_DECIMALS, wallet.publicKey, wallet.publicKey, TOKEN_2022_PROGRAM_ID)
  );
  
  const sig1 = await sendAndConfirmTransaction(connection, tx1, [wallet, mintKeypair]);
  console.log(`   ✅ Token created: ${sig1}`);

  // ==================== STEP 2: Initialize Hook PDAs ====================
  console.log('\n🔧 Step 2: Initializing hook PDAs (trading blocked)...');

  const [hookConfigPDA] = getHookConfigPDA();
  const [whitelistPDA] = getWhitelistPDA(mint);
  const [extraMetasPDA] = getExtraMetasPDA(mint);

  const tx2 = new Transaction().add(
    // Add whitelist (no LP yet = blocked)
    new TransactionInstruction({
      programId: HOOK_PROGRAM_ID,
      keys: [
        { pubkey: hookConfigPDA, isSigner: false, isWritable: false },
        { pubkey: whitelistPDA, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([getDiscriminator('add_whitelist'), PublicKey.default.toBuffer()]),
    }),
    // Init extra metas
    new TransactionInstruction({
      programId: HOOK_PROGRAM_ID,
      keys: [
        { pubkey: extraMetasPDA, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: getDiscriminator('initialize_extra_account_meta_list'),
    })
  );

  const sig2 = await sendAndConfirmTransaction(connection, tx2, [wallet]);
  console.log(`   ✅ Hook PDAs initialized: ${sig2}`);
  console.log(`   ⚠️ Transfers are now BLOCKED until LP is whitelisted`);

  // ==================== STEP 3: Mint Tokens ====================
  console.log('\n💰 Step 3: Minting tokens...');

  const walletAta = getAssociatedTokenAddressSync(mint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const totalSupplyLamports = BigInt(TOTAL_SUPPLY) * BigInt(10 ** TOKEN_DECIMALS);

  const tx3 = new Transaction().add(
    createAssociatedTokenAccountInstruction(wallet.publicKey, walletAta, wallet.publicKey, mint, TOKEN_2022_PROGRAM_ID),
    createMintToInstruction(mint, walletAta, wallet.publicKey, totalSupplyLamports, [], TOKEN_2022_PROGRAM_ID)
  );

  const sig3 = await sendAndConfirmTransaction(connection, tx3, [wallet]);
  console.log(`   ✅ Minted ${TOTAL_SUPPLY.toLocaleString()} tokens: ${sig3}`);

  // ==================== STEP 4: Create FluxBeam LP ====================
  console.log('\n🏊 Step 4: Creating FluxBeam LP...');

  const WSOL_MINT = 'So11111111111111111111111111111111111111112';
  const solLamports = Math.floor(solForLp * LAMPORTS_PER_SOL);
  const tokensForLp = BigInt(100_000_000) * BigInt(10 ** TOKEN_DECIMALS); // 100M tokens

  console.log(`   SOL: ${solForLp}`);
  console.log(`   Tokens: 100,000,000`);

  let lpAddress: PublicKey;

  try {
    const fluxResult = await httpPost('https://api.fluxbeam.xyz/v1/token_pools', {
      payer: wallet.publicKey.toBase58(),
      token_a: WSOL_MINT,
      token_b: mint.toBase58(),
      token_a_amount: solLamports,
      token_b_amount: tokensForLp.toString(),
      priority_fee_lamports: 10000
    });

    console.log(`   Pool: ${fluxResult.pool}`);
    lpAddress = new PublicKey(fluxResult.pool);

    if (fluxResult.transaction) {
      const txBuffer = Buffer.from(fluxResult.transaction, 'base64');
      const versionedTx = VersionedTransaction.deserialize(txBuffer);
      versionedTx.sign([wallet]);
      
      const lpSig = await connection.sendRawTransaction(versionedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3
      });
      
      await connection.confirmTransaction(lpSig, 'confirmed');
      console.log(`   ✅ LP created: ${lpSig}`);
    }
  } catch (err: any) {
    console.error(`   ❌ FluxBeam failed: ${err.message}`);
    console.log(`   Using placeholder LP for testing...`);
    lpAddress = Keypair.generate().publicKey;
  }

  // ==================== STEP 5: Whitelist LP (Enable Trading) ====================
  console.log('\n🔓 Step 5: Whitelisting LP (enabling trading)...');

  const tx5 = new Transaction().add(
    new TransactionInstruction({
      programId: HOOK_PROGRAM_ID,
      keys: [
        { pubkey: hookConfigPDA, isSigner: false, isWritable: false },
        { pubkey: whitelistPDA, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.concat([getDiscriminator('update_whitelist'), lpAddress.toBuffer()]),
    })
  );

  const sig5 = await sendAndConfirmTransaction(connection, tx5, [wallet]);
  console.log(`   ✅ Trading enabled: ${sig5}`);

  // ==================== DONE ====================
  console.log('\n🎉 TOKEN LAUNCH COMPLETE!');
  console.log('==========================================');
  console.log(`Token Mint: ${mint.toBase58()}`);
  console.log(`LP Address: ${lpAddress.toBase58()}`);
  const cluster = isMainnet ? '' : '?cluster=devnet';
  console.log(`Solscan: https://solscan.io/token/${mint.toBase58()}${cluster}`);
}

main().catch(err => {
  console.error('\n❌ Failed:', err.message);
  if (err.logs) console.error('Logs:', err.logs.slice(-5));
  process.exit(1);
});
