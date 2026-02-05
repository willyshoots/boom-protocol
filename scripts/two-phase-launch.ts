/**
 * BOOM Protocol - Two-Phase Launch
 * 
 * Phase 1: Create token + LP (hook allows all - no extra_account_metas yet)
 * Phase 2: Initialize extra_account_metas + whitelist (lock down to official LP only)
 * 
 * Usage: npx ts-node scripts/two-phase-launch.ts --name=TEST4 --symbol=TEST4 --sol=0.05
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
const TOTAL_SUPPLY = 1_000_000_000;

// Parse args
const args = process.argv.slice(2);
const tokenName = args.find(a => a.startsWith('--name='))?.split('=')[1] || 'TEST4';
const tokenSymbol = args.find(a => a.startsWith('--symbol='))?.split('=')[1] || 'TEST4';
const solForLp = parseFloat(args.find(a => a.startsWith('--sol='))?.split('=')[1] || '0.05');

const RPC_URL = 'https://api.mainnet-beta.solana.com';

// Load wallet
const KEYPAIR_PATH = path.join(process.env.HOME!, '.config/solana/id.json');
const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));

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
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        else { try { resolve(JSON.parse(body)); } catch { reject(new Error(`Parse error: ${body}`)); } }
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
  console.log('🚀 BOOM Protocol - Two-Phase Launch');
  console.log('=====================================');
  console.log(`Token: ${tokenName} (${tokenSymbol})`);
  console.log(`SOL for LP: ${solForLp}`);
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  console.log('');

  const connection = new Connection(RPC_URL, 'confirmed');
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  // ==================== PHASE 1: Create Token + LP ====================
  console.log('═══════════════════════════════════════');
  console.log('PHASE 1: Create Token + LP (No Lockdown)');
  console.log('═══════════════════════════════════════\n');

  // Step 1.1: Create Token2022 with transfer hook
  console.log('📝 Step 1.1: Creating Token2022 with transfer hook...');
  
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
  console.log(`   ✅ Token created: ${sig1}\n`);

  // Step 1.1b: Initialize extra_account_metas EMPTY (required by Token2022, allows all transfers)
  console.log('📝 Step 1.1b: Initializing extra_account_metas (EMPTY - Phase 1)...');
  
  const [extraMetasPDA] = getExtraMetasPDA(mint);
  
  const initEmptyIx = new TransactionInstruction({
    programId: HOOK_PROGRAM_ID,
    keys: [
      { pubkey: extraMetasPDA, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: getDiscriminator('initialize_extra_account_meta_list_empty'),
  });

  const emptyMetasTx = new Transaction().add(initEmptyIx);
  const emptyMetasSig = await sendAndConfirmTransaction(connection, emptyMetasTx, [wallet]);
  console.log(`   ✅ Empty extra_account_metas: ${emptyMetasSig}`);
  console.log(`   ⚠️ Phase 1 mode: all transfers allowed\n`);

  // Step 1.2: Mint tokens
  console.log('📝 Step 1.2: Minting tokens...');
  
  const walletAta = getAssociatedTokenAddressSync(mint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const totalSupplyLamports = BigInt(TOTAL_SUPPLY) * BigInt(10 ** TOKEN_DECIMALS);

  const tx2 = new Transaction().add(
    createAssociatedTokenAccountInstruction(wallet.publicKey, walletAta, wallet.publicKey, mint, TOKEN_2022_PROGRAM_ID),
    createMintToInstruction(mint, walletAta, wallet.publicKey, totalSupplyLamports, [], TOKEN_2022_PROGRAM_ID)
  );

  const sig2 = await sendAndConfirmTransaction(connection, tx2, [wallet]);
  console.log(`   ✅ Minted ${TOTAL_SUPPLY.toLocaleString()} tokens: ${sig2}\n`);

  // Step 1.3: Create FluxBeam LP
  console.log('📝 Step 1.3: Creating FluxBeam LP...');
  
  const WSOL_MINT = 'So11111111111111111111111111111111111111112';
  const solLamports = Math.floor(solForLp * LAMPORTS_PER_SOL);
  const tokensForLp = BigInt(100_000_000) * BigInt(10 ** TOKEN_DECIMALS);

  let lpAddress: PublicKey;

  try {
    const fluxResult = await httpPost('https://api.fluxbeam.xyz/v1/token_pools', {
      payer: wallet.publicKey.toBase58(),
      token_a: WSOL_MINT,
      token_b: mint.toBase58(),
      token_a_amount: solLamports,
      token_b_amount: tokensForLp.toString(),
      priority_fee_lamports: 50000
    });

    lpAddress = new PublicKey(fluxResult.pool);
    console.log(`   Pool: ${lpAddress.toBase58()}`);

    if (fluxResult.transaction) {
      const txBuffer = Buffer.from(fluxResult.transaction, 'base64');
      const versionedTx = VersionedTransaction.deserialize(txBuffer);
      versionedTx.sign([wallet]);
      
      const lpSig = await connection.sendRawTransaction(versionedTx.serialize(), {
        skipPreflight: true,
        maxRetries: 3
      });
      
      await connection.confirmTransaction(lpSig, 'confirmed');
      console.log(`   ✅ LP created: ${lpSig}\n`);
    }
  } catch (err: any) {
    console.error(`   ❌ FluxBeam failed: ${err.message}`);
    process.exit(1);
  }

  // ==================== PHASE 2: Lock Down ====================
  console.log('═══════════════════════════════════════');
  console.log('PHASE 2: Lock Down (Enable Blocking)');
  console.log('═══════════════════════════════════════\n');

  // Get hook config PDA
  const [hookConfigPDA] = getHookConfigPDA();

  // Step 2.1: Initialize hook config if needed
  const configInfo = await connection.getAccountInfo(hookConfigPDA);
  
  if (!configInfo) {
    console.log('📝 Step 2.1: Initializing hook config...');
    const initConfigData = getDiscriminator('initialize');
    const initConfigIx = new TransactionInstruction({
      programId: HOOK_PROGRAM_ID,
      keys: [
        { pubkey: hookConfigPDA, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: initConfigData,
    });
    const configTx = new Transaction().add(initConfigIx);
    const configSig = await sendAndConfirmTransaction(connection, configTx, [wallet]);
    console.log(`   ✅ Config initialized: ${configSig}\n`);
  } else {
    console.log('📝 Step 2.1: Hook config already exists ✅\n');
  }

  // Step 2.2: Upgrade extra_account_metas from Phase 1 to Phase 2
  console.log('📝 Step 2.2: Upgrading extra_account_metas (enabling lockdown)...');
  
  const upgradeExtraMetasIx = new TransactionInstruction({
    programId: HOOK_PROGRAM_ID,
    keys: [
      { pubkey: hookConfigPDA, isSigner: false, isWritable: false },
      { pubkey: extraMetasPDA, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
    ],
    data: getDiscriminator('upgrade_extra_account_meta_list'),
  });

  const upgradeMetasTx = new Transaction().add(upgradeExtraMetasIx);
  const upgradeMetasSig = await sendAndConfirmTransaction(connection, upgradeMetasTx, [wallet]);
  console.log(`   ✅ Extra account metas UPGRADED: ${upgradeMetasSig}`);
  console.log(`   ⚠️ Now ALL transfers require extra accounts!\n`);

  // Step 2.3: Add whitelist with official LP
  console.log('📝 Step 2.3: Adding whitelist with official LP...');
  
  const [whitelistPDA] = getWhitelistPDA(mint);
  
  const addWhitelistIx = new TransactionInstruction({
    programId: HOOK_PROGRAM_ID,
    keys: [
      { pubkey: hookConfigPDA, isSigner: false, isWritable: false },
      { pubkey: whitelistPDA, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([getDiscriminator('add_whitelist'), lpAddress.toBuffer()]),
  });

  const whitelistTx = new Transaction().add(addWhitelistIx);
  const whitelistSig = await sendAndConfirmTransaction(connection, whitelistTx, [wallet]);
  console.log(`   ✅ Whitelist added: ${whitelistSig}`);
  console.log(`   Official LP: ${lpAddress.toBase58()}\n`);

  // ==================== SUMMARY ====================
  console.log('═══════════════════════════════════════');
  console.log('🎉 TWO-PHASE LAUNCH COMPLETE!');
  console.log('═══════════════════════════════════════');
  console.log(`Token Mint: ${mint.toBase58()}`);
  console.log(`LP Address: ${lpAddress.toBase58()}`);
  console.log(`Total Supply: ${TOTAL_SUPPLY.toLocaleString()}`);
  console.log('');
  console.log('✅ Phase 1: Token + LP created (hook allowed all)');
  console.log('✅ Phase 2: Lockdown enabled (only official LP works)');
  console.log('');
  console.log(`Solscan: https://solscan.io/token/${mint.toBase58()}`);
}

main().catch(err => {
  console.error('\n❌ Launch failed:', err.message);
  if (err.logs) console.error('Logs:', err.logs.slice(-5));
  process.exit(1);
});
