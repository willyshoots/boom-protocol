/**
 * BOOM Protocol - Comprehensive E2E Devnet Test
 * 
 * Tests the FULL lifecycle with multiple wallets:
 * 1. Start Presale
 * 2. Deposits from 2 wallets (winner + loser)
 * 3. End Presale + Lottery (pick 1 winner)
 * 4. Mark Winner
 * 5. Create Token (Token2022 with transfer hook)
 * 6. Register Presale Token
 * 7. Init Explosion Tracking
 * 8. Create Pool (custom AMM)
 * 9. Deposit tokens to pool + Sync reserves
 * 10. Register LP
 * 11. Start Explosion Timer
 * 12. Claim Winner Tokens (winner wallet)
 * 13. Claim Refund (loser wallet)
 * 14. Swap: Buy (SOL → Token)
 * 15. Swap: Sell (Token → SOL)
 * 16. Trigger Time Explosion
 * 17. Unwind LP
 * 18. Claim Explosion Payout
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
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  AuthorityType,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  createInitializeMetadataPointerInstruction,
  createSetAuthorityInstruction,
  getMintLen,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { createInitializeInstruction, pack } from '@solana/spl-token-metadata';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============ CONFIG ============
const BOOM_PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');
const HOOK_PROGRAM_ID = new PublicKey('CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9');
const RPC_URL = 'https://api.devnet.solana.com';
const DELAY_MS = 2000; // Between txs to avoid rate limits

// Load main wallet
const KEYPAIR_PATH = path.join(process.env.HOME!, '.config/solana/id.json');
const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
const mainWallet = Keypair.fromSecretKey(new Uint8Array(keypairData));

// Use a unique round ID based on timestamp
const ROUND_ID = Math.floor(Date.now() / 1000);
const COOLDOWN_SECONDS = 30; // Short for testing
const EXPLOSION_DURATION = 60; // 1 minute

function disc(name: string): Buffer {
  return crypto.createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function sendWithTimeout(
  conn: Connection,
  tx: Transaction,
  signers: Keypair[],
  timeoutMs = 45000,
): Promise<string> {
  return Promise.race([
    sendAndConfirmTransaction(conn, tx, signers, { commitment: 'confirmed' }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Transaction timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

function roundBuf(): Buffer {
  return new BN(ROUND_ID).toArrayLike(Buffer, 'le', 8);
}

function pda(seeds: (Buffer | Uint8Array)[], programId = BOOM_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

// Results tracking
const results: { step: string; status: 'PASS' | 'FAIL' | 'SKIP'; detail?: string }[] = [];

function pass(step: string, detail?: string) {
  results.push({ step, status: 'PASS', detail });
  console.log(`  ✅ ${step}${detail ? ': ' + detail : ''}`);
}

function fail(step: string, detail: string) {
  results.push({ step, status: 'FAIL', detail });
  console.log(`  ❌ ${step}: ${detail}`);
}

function skip(step: string, detail: string) {
  results.push({ step, status: 'SKIP', detail });
  console.log(`  ⏭️  ${step}: ${detail}`);
}

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');

  console.log('🚀 BOOM Protocol - Comprehensive E2E Test');
  console.log('==========================================');
  console.log(`Round ID: ${ROUND_ID}`);
  console.log(`Main Wallet: ${mainWallet.publicKey.toBase58()}`);
  
  const mainBalance = await connection.getBalance(mainWallet.publicKey);
  console.log(`Main Balance: ${mainBalance / LAMPORTS_PER_SOL} SOL`);
  
  if (mainBalance < 2 * LAMPORTS_PER_SOL) {
    console.log('❌ Insufficient SOL. Need at least 2 SOL.');
    return;
  }

  // ============ SETUP: Fresh wallets ============
  console.log('\n📋 SETUP: Creating fresh test wallets...');
  const winnerWallet = Keypair.generate();
  const loserWallet = Keypair.generate();
  console.log(`  Winner: ${winnerWallet.publicKey.toBase58()}`);
  console.log(`  Loser:  ${loserWallet.publicKey.toBase58()}`);

  // Fund wallets from main wallet
  try {
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: mainWallet.publicKey,
        toPubkey: winnerWallet.publicKey,
        lamports: 0.3 * LAMPORTS_PER_SOL,
      }),
      SystemProgram.transfer({
        fromPubkey: mainWallet.publicKey,
        toPubkey: loserWallet.publicKey,
        lamports: 0.3 * LAMPORTS_PER_SOL,
      }),
    );
    await sendWithTimeout(connection, fundTx, [mainWallet]);
    pass('Fund test wallets', '0.3 SOL each');
  } catch (e: any) {
    fail('Fund test wallets', e.message?.slice(0, 100));
    return;
  }

  await sleep(DELAY_MS);

  // ============ PDAs ============
  const rb = roundBuf();
  const presalePda = pda([Buffer.from('presale'), rb]);
  const presaleTokenPda = pda([Buffer.from('presale_token'), rb]);
  const explosionPda = pda([Buffer.from('presale_explosion'), rb]);
  const poolPda = pda([Buffer.from('pool'), rb]);
  const tokenVaultPda = pda([Buffer.from('token_vault'), rb]);
  const solVaultPda = pda([Buffer.from('sol_vault'), rb]);
  const lpInfoPda = pda([Buffer.from('lp_info'), rb]);
  const mintAuthorityPda = pda([Buffer.from('mint_authority'), rb]);
  const payoutPoolPda = pda([Buffer.from('payout_pool'), rb]);
  const payoutVaultPda = pda([Buffer.from('payout_vault'), rb]);

  const winnerDepositPda = pda([Buffer.from('deposit'), rb, winnerWallet.publicKey.toBuffer()]);
  const loserDepositPda = pda([Buffer.from('deposit'), rb, loserWallet.publicKey.toBuffer()]);

  // ============ STEP 1: START PRESALE ============
  console.log('\n📝 STEP 1: Start Presale');
  try {
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: presalePda, isSigner: false, isWritable: true },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: Buffer.concat([
        disc('start_presale'),
        rb,
        new BN(COOLDOWN_SECONDS).toArrayLike(Buffer, 'le', 8),
        Buffer.from(new Uint32Array([10]).buffer), // lotterySpots
        new BN(0.05 * LAMPORTS_PER_SOL).toArrayLike(Buffer, 'le', 8), // minDeposit
        new BN(5 * LAMPORTS_PER_SOL).toArrayLike(Buffer, 'le', 8), // maxDeposit
        new BN(0).toArrayLike(Buffer, 'le', 8), // maxWinnerContribution (0 = no limit)
      ]),
    });
    const sig = await sendWithTimeout(connection, new Transaction().add(ix), [mainWallet]);
    pass('Start Presale', sig.slice(0, 20) + '...');
  } catch (e: any) {
    fail('Start Presale', e.message?.slice(0, 120));
    return; // Can't continue
  }

  await sleep(DELAY_MS);

  // ============ STEP 2: Deposits ============
  console.log('\n📝 STEP 2: Deposits (winner + loser)');
  
  const depositAmount = new BN(0.1 * LAMPORTS_PER_SOL);
  
  for (const [label, wallet, depositPda_] of [
    ['Winner deposit', winnerWallet, winnerDepositPda],
    ['Loser deposit', loserWallet, loserDepositPda],
  ] as [string, Keypair, PublicKey][]) {
    try {
      const ix = new TransactionInstruction({
        keys: [
          { pubkey: presalePda, isSigner: false, isWritable: true },
          { pubkey: depositPda_, isSigner: false, isWritable: true },
          { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: BOOM_PROGRAM_ID,
        data: Buffer.concat([disc('deposit_presale'), depositAmount.toArrayLike(Buffer, 'le', 8)]),
      });
      const sig = await sendWithTimeout(connection, new Transaction().add(ix), [wallet]);
      pass(label, sig.slice(0, 20) + '...');
    } catch (e: any) {
      fail(label, e.message?.slice(0, 120));
    }
    await sleep(DELAY_MS);
  }

  // ============ STEP 3: Wait for cooldown ============
  console.log(`\n⏳ Waiting ${COOLDOWN_SECONDS + 5}s for presale cooldown...`);
  await sleep((COOLDOWN_SECONDS + 5) * 1000);

  // ============ STEP 4: End Presale + Lottery ============
  console.log('\n📝 STEP 3: End Presale + Lottery');
  try {
    // Winner is index 0 (first depositor = winnerWallet)
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: presalePda, isSigner: false, isWritable: true },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: Buffer.concat([
        disc('end_presale_and_lottery'),
        Buffer.from(new Uint32Array([1]).buffer), // vec length = 1
        Buffer.from(new Uint32Array([0]).buffer), // winner index 0
      ]),
    });
    const sig = await sendWithTimeout(connection, new Transaction().add(ix), [mainWallet]);
    pass('End Presale + Lottery', sig.slice(0, 20) + '...');
  } catch (e: any) {
    fail('End Presale + Lottery', e.message?.slice(0, 120));
  }

  await sleep(DELAY_MS);

  // ============ STEP 5: Mark Winner ============
  console.log('\n📝 STEP 4: Mark Winner');
  try {
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: presalePda, isSigner: false, isWritable: false },
        { pubkey: winnerDepositPda, isSigner: false, isWritable: true },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: disc('mark_winner'),
    });
    const sig = await sendWithTimeout(connection, new Transaction().add(ix), [mainWallet]);
    pass('Mark Winner', sig.slice(0, 20) + '...');
  } catch (e: any) {
    fail('Mark Winner', e.message?.slice(0, 120));
  }

  await sleep(DELAY_MS);

  // ============ STEP 6: Create Token (Token2022 with transfer hook) ============
  console.log('\n📝 STEP 5: Create Token2022 with transfer hook');
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  console.log(`  Mint: ${mint.toBase58()}`);

  const TOKEN_NAME = '$TEST1';
  const TOKEN_SYMBOL = 'TEST1';
  const TOKEN_URI = '';

  try {
    // Step A: Create mint with extensions (exact size, no metadata yet)
    const extensions = [ExtensionType.TransferHook, ExtensionType.MetadataPointer];
    const mintLen = getMintLen(extensions);
    const mintLamports = await connection.getMinimumBalanceForRentExemption(mintLen);

    const tx1 = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: mainWallet.publicKey,
        newAccountPubkey: mint,
        space: mintLen,
        lamports: mintLamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferHookInstruction(
        mint, mainWallet.publicKey, HOOK_PROGRAM_ID, TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMetadataPointerInstruction(
        mint, mainWallet.publicKey, mint, TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        mint, 9, mainWallet.publicKey, null, TOKEN_2022_PROGRAM_ID
      ),
    );
    const sig1 = await sendWithTimeout(connection, tx1, [mainWallet, mintKeypair]);
    console.log(`  Mint created: ${sig1.slice(0, 20)}...`);
    await sleep(DELAY_MS);

    // Step B: Initialize metadata (Token2022 auto-reallocates for embedded metadata)
    // Then transfer mint authority to program PDA
    const { tokenMetadataInitializeWithRentTransfer } = await import('@solana/spl-token');
    await tokenMetadataInitializeWithRentTransfer(
      connection,
      mainWallet,            // payer
      mint,                  // mint
      mainWallet.publicKey,  // updateAuthority
      mainWallet,            // mintAuthority (Signer)
      TOKEN_NAME,
      TOKEN_SYMBOL,
      TOKEN_URI,
      [],                    // multiSigners
      { commitment: 'confirmed' } as any,
      TOKEN_2022_PROGRAM_ID,
    );
    console.log(`  Metadata initialized: name=${TOKEN_NAME}`);
    await sleep(DELAY_MS);

    // Step C: Transfer mint authority to program PDA
    const tx3 = new Transaction().add(
      createSetAuthorityInstruction(
        mint, mainWallet.publicKey, AuthorityType.MintTokens,
        mintAuthorityPda, [], TOKEN_2022_PROGRAM_ID
      ),
    );
    const sig3 = await sendWithTimeout(connection, tx3, [mainWallet]);
    pass('Create Token2022 ($TEST1)', `name=${TOKEN_NAME}, ${sig3.slice(0, 20)}...`);
  } catch (e: any) {
    fail('Create Token2022 ($TEST1)', e.message?.slice(0, 200));
    if (e.logs) {
      const errLogs = e.logs.filter((l: string) => l.includes('Error') || l.includes('failed') || l.includes('Program log'));
      if (errLogs.length) console.log('  Logs:', errLogs.slice(0, 5));
    }
  }

  await sleep(DELAY_MS);

  // ============ STEP 6b: Initialize Hook Extra Account Metas ============
  console.log('\n📝 STEP 6b: Init Hook Extra Account Metas');
  const [extraMetasPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('extra-account-metas'), mint.toBuffer()], HOOK_PROGRAM_ID
  );
  const [hookConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('hook_config')], HOOK_PROGRAM_ID
  );
  const [hookWhitelistPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('whitelist'), mint.toBuffer()], HOOK_PROGRAM_ID
  );
  try {
    // Add whitelist entry for this mint (needs: config, whitelist, mint, authority, system_program + official_lp pubkey arg)
    const addWhitelistIx = new TransactionInstruction({
      programId: HOOK_PROGRAM_ID,
      keys: [
        { pubkey: hookConfigPda, isSigner: false, isWritable: false },
        { pubkey: hookWhitelistPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([
        disc('add_whitelist'),
        tokenVaultPda.toBuffer(), // official_lp = token vault as the LP account
      ]),
    });
    // Init extra account metas
    const initExtraMetasIx = new TransactionInstruction({
      programId: HOOK_PROGRAM_ID,
      keys: [
        { pubkey: extraMetasPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: disc('initialize_extra_account_meta_list'),
    });
    const sig = await sendWithTimeout(connection, new Transaction().add(addWhitelistIx, initExtraMetasIx), [mainWallet]);
    pass('Init Hook Extra Account Metas', sig.slice(0, 20) + '...');
  } catch (e: any) {
    fail('Init Hook Extra Account Metas', e.message?.slice(0, 150));
    if (e.logs) {
      const errLogs = e.logs.filter((l: string) => l.includes('Error') || l.includes('failed') || l.includes('custom'));
      if (errLogs.length) console.log('  Logs:', errLogs.slice(0, 3));
    }
  }
  await sleep(DELAY_MS);

  // ============ STEP 7: Register Presale Token ============
  console.log('\n📝 STEP 6: Register Presale Token');
  const totalSupply = new BN(1_000_000_000).mul(new BN(10).pow(new BN(9))); // 1B tokens
  const tokensPerWinner = new BN(100_000_000).mul(new BN(10).pow(new BN(9))); // 100M per winner

  try {
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: presalePda, isSigner: false, isWritable: false },
        { pubkey: presaleTokenPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: Buffer.concat([
        disc('register_presale_token'),
        rb,
        totalSupply.toArrayLike(Buffer, 'le', 8),
        tokensPerWinner.toArrayLike(Buffer, 'le', 8),
      ]),
    });
    const sig = await sendWithTimeout(connection, new Transaction().add(ix), [mainWallet]);
    pass('Register Presale Token', sig.slice(0, 20) + '...');
  } catch (e: any) {
    fail('Register Presale Token', e.message?.slice(0, 120));
  }

  await sleep(DELAY_MS);

  // ============ STEP 8: Init Explosion Tracking ============
  console.log('\n📝 STEP 7: Init Explosion Tracking');
  // Secret cap = 1000 SOL market cap
  const secretCap = new BN(1000 * LAMPORTS_PER_SOL);
  const capHash = crypto.createHash('sha256').update(secretCap.toArrayLike(Buffer, 'le', 8)).digest();

  try {
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: presalePda, isSigner: false, isWritable: false },
        { pubkey: explosionPda, isSigner: false, isWritable: true },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: Buffer.concat([
        disc('init_presale_explosion'),
        rb,
        capHash,
      ]),
    });
    const sig = await sendWithTimeout(connection, new Transaction().add(ix), [mainWallet]);
    pass('Init Explosion Tracking', sig.slice(0, 20) + '...');
  } catch (e: any) {
    fail('Init Explosion Tracking', e.message?.slice(0, 120));
  }

  await sleep(DELAY_MS);

  // ============ STEP 9: Create Pool ============
  console.log('\n📝 STEP 8: Create Pool');
  try {
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: presalePda, isSigner: false, isWritable: true },
        { pubkey: presaleTokenPda, isSigner: false, isWritable: false },
        { pubkey: poolPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: tokenVaultPda, isSigner: false, isWritable: true },
        { pubkey: solVaultPda, isSigner: false, isWritable: true },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: Buffer.concat([
        disc('create_pool'),
        rb,
        Buffer.from(new Uint16Array([100]).buffer), // 1% fee
      ]),
    });
    const sig = await sendWithTimeout(connection, new Transaction().add(ix), [mainWallet]);
    pass('Create Pool', sig.slice(0, 20) + '...');
  } catch (e: any) {
    fail('Create Pool', e.message?.slice(0, 120));
  }

  await sleep(DELAY_MS);

  // ============ STEP 10: Register LP ============
  console.log('\n📝 STEP 9: Register LP');
  try {
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: presalePda, isSigner: false, isWritable: false },
        { pubkey: lpInfoPda, isSigner: false, isWritable: true },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: Buffer.concat([
        disc('register_lp'),
        rb,
        poolPda.toBuffer(),
        mint.toBuffer(),
        tokenVaultPda.toBuffer(),
        solVaultPda.toBuffer(),
      ]),
    });
    const sig = await sendWithTimeout(connection, new Transaction().add(ix), [mainWallet]);
    pass('Register LP', sig.slice(0, 20) + '...');
  } catch (e: any) {
    fail('Register LP', e.message?.slice(0, 120));
  }

  await sleep(DELAY_MS);

  // ============ STEP 11: Start Explosion Timer ============
  console.log('\n📝 STEP 10: Start Explosion Timer (trading begins!)');
  try {
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: explosionPda, isSigner: false, isWritable: true },
        { pubkey: lpInfoPda, isSigner: false, isWritable: false },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: Buffer.concat([
        disc('start_explosion_timer'),
        new BN(EXPLOSION_DURATION).toArrayLike(Buffer, 'le', 8),
      ]),
    });
    const sig = await sendWithTimeout(connection, new Transaction().add(ix), [mainWallet]);
    pass('Start Explosion Timer', sig.slice(0, 20) + '...');
  } catch (e: any) {
    fail('Start Explosion Timer', e.message?.slice(0, 120));
  }

  await sleep(DELAY_MS);

  // ============ STEP 12: Winner Claims Tokens ============
  console.log('\n📝 STEP 11: Winner Claims Tokens');
  
  // Create winner's ATA first
  const winnerAta = getAssociatedTokenAddressSync(mint, winnerWallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  try {
    const createAtaTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        mainWallet.publicKey, winnerAta, winnerWallet.publicKey, mint, TOKEN_2022_PROGRAM_ID
      )
    );
    await sendWithTimeout(connection, createAtaTx, [mainWallet]);
    console.log('  ATA created for winner');
  } catch (e: any) {
    if (!e.message?.includes('already in use')) {
      console.log(`  ATA creation issue: ${e.message?.slice(0, 80)}`);
    }
  }
  await sleep(DELAY_MS);

  try {
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: presalePda, isSigner: false, isWritable: false },
        { pubkey: presaleTokenPda, isSigner: false, isWritable: false },
        { pubkey: explosionPda, isSigner: false, isWritable: false },
        { pubkey: winnerDepositPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: mintAuthorityPda, isSigner: false, isWritable: false },
        { pubkey: winnerAta, isSigner: false, isWritable: true },
        { pubkey: winnerWallet.publicKey, isSigner: false, isWritable: false }, // depositor (CHECK)
        { pubkey: winnerWallet.publicKey, isSigner: true, isWritable: true },   // winner (signer)
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: disc('claim_winner_tokens'),
    });
    const sig = await sendWithTimeout(connection, new Transaction().add(ix), [winnerWallet]);
    
    // Check balance
    const tokenBal = await connection.getTokenAccountBalance(winnerAta);
    pass('Winner Claims Tokens', `${tokenBal.value.uiAmount} tokens, ${sig.slice(0, 20)}...`);
  } catch (e: any) {
    fail('Winner Claims Tokens', e.message?.slice(0, 150));
    if (e.logs) {
      const errLogs = e.logs.filter((l: string) => l.includes('Error') || l.includes('failed') || l.includes('custom'));
      if (errLogs.length) console.log('  Logs:', errLogs.slice(0, 3));
    }
  }

  await sleep(DELAY_MS);

  // ============ STEP 13: Loser Claims Refund ============
  console.log('\n📝 STEP 12: Loser Claims Refund');
  const loserBalBefore = await connection.getBalance(loserWallet.publicKey);
  try {
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: presalePda, isSigner: false, isWritable: false },
        { pubkey: explosionPda, isSigner: false, isWritable: false },
        { pubkey: loserDepositPda, isSigner: false, isWritable: true },
        { pubkey: poolPda, isSigner: false, isWritable: true },
        { pubkey: solVaultPda, isSigner: false, isWritable: true },
        { pubkey: loserWallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: disc('claim_refund'),
    });
    const sig = await sendWithTimeout(connection, new Transaction().add(ix), [loserWallet]);
    const loserBalAfter = await connection.getBalance(loserWallet.publicKey);
    const refundAmount = (loserBalAfter - loserBalBefore + 5000) / LAMPORTS_PER_SOL; // +5000 for tx fee approx
    pass('Loser Claims Refund', `~${refundAmount.toFixed(4)} SOL refunded, ${sig.slice(0, 20)}...`);
  } catch (e: any) {
    fail('Loser Claims Refund', e.message?.slice(0, 150));
    if (e.logs) {
      const errLogs = e.logs.filter((l: string) => l.includes('Error') || l.includes('failed') || l.includes('custom'));
      if (errLogs.length) console.log('  Logs:', errLogs.slice(0, 3));
    }
  }

  await sleep(DELAY_MS);

  // ============ STEP 14-15: Swaps (need tokens in pool first) ============
  // The pool was created with SOL from presale but likely 0 tokens.
  // We need to mint tokens to authority, then deposit to pool via deposit_pool_tokens.
  
  // First, mint tokens to main wallet using mint_authority PDA... 
  // Actually, claim_winner_tokens mints tokens. For pool liquidity, we need to 
  // use deposit_pool_tokens which requires authority to have tokens.
  // The mint authority is a PDA, so we can't directly mint. We need the program to do it.
  // Let's check if the pool has any tokens.
  
  console.log('\n📝 STEP 13: Check Pool State');
  let poolHasTokens = false;
  try {
    const tokenVaultBalance = await connection.getTokenAccountBalance(tokenVaultPda);
    const solVaultBalance = await connection.getBalance(solVaultPda);
    console.log(`  Token Vault: ${tokenVaultBalance.value.uiAmount} tokens`);
    console.log(`  SOL Vault: ${solVaultBalance / LAMPORTS_PER_SOL} SOL`);
    poolHasTokens = (tokenVaultBalance.value.uiAmount || 0) > 0;
    pass('Check Pool State');
  } catch (e: any) {
    // Token vault might not exist if pool creation failed
    fail('Check Pool State', e.message?.slice(0, 100));
  }

  // For swaps to work, pool needs both token and SOL reserves.
  // If pool has 0 tokens, we need to deposit some.
  // The winner has tokens from claiming - they could deposit, but deposit_pool_tokens requires authority.
  // Let's try to have the winner do a swap sell to seed the pool instead.
  // Actually, we can't swap if pool has 0 tokens (division by zero in AMM).
  // 
  // The real flow: authority mints tokens to themselves first, then deposits to pool.
  // But mint authority is a PDA... The program's create_presale_token instruction mints.
  // For a transfer-hook token registered externally, we need deposit_pool_tokens.
  // But that requires authority to have tokens. Authority can get tokens by being a winner too,
  // or we can have the winner transfer tokens to pool via deposit.
  //
  // Simplest approach: Have the winner transfer some tokens back, then authority deposits to pool.
  // But deposit_pool_tokens uses CPI transfer which requires transfer hook extra accounts...
  //
  // Let's try the swap approach anyway - if pool has SOL but 0 tokens, buy will fail.
  // Let's skip swaps if no tokens in pool, and note it as a known limitation.

  if (!poolHasTokens) {
    console.log('\n📝 STEP 13b: Mint tokens to pool');
    try {
      const POOL_TOKEN_AMOUNT = new BN(500_000_000).mul(new BN(10).pow(new BN(9))); // 500M tokens
      const ix = new TransactionInstruction({
        keys: [
          { pubkey: presalePda, isSigner: false, isWritable: false },
          { pubkey: presaleTokenPda, isSigner: false, isWritable: false },
          { pubkey: mint, isSigner: false, isWritable: true },
          { pubkey: mintAuthorityPda, isSigner: false, isWritable: false },
          { pubkey: tokenVaultPda, isSigner: false, isWritable: true },
          { pubkey: mainWallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        programId: BOOM_PROGRAM_ID,
        data: Buffer.concat([
          disc('mint_pool_tokens'),
          POOL_TOKEN_AMOUNT.toArrayLike(Buffer, 'le', 8),
        ]),
      });
      const sig = await sendWithTimeout(connection, new Transaction().add(ix), [mainWallet]);
      pass('Mint Pool Tokens', `500M tokens, ${sig.slice(0, 20)}...`);
      
      // Sync pool reserves after minting
      const syncIx = new TransactionInstruction({
        keys: [
          { pubkey: poolPda, isSigner: false, isWritable: true },
          { pubkey: tokenVaultPda, isSigner: false, isWritable: false },
          { pubkey: solVaultPda, isSigner: false, isWritable: false },
        ],
        programId: BOOM_PROGRAM_ID,
        data: disc('sync_pool_reserves'),
      });
      const syncSig = await sendWithTimeout(connection, new Transaction().add(syncIx), [mainWallet]);
      pass('Sync Pool Reserves', syncSig.slice(0, 20) + '...');
      poolHasTokens = true;
    } catch (e: any) {
      fail('Mint Pool Tokens', e.message?.slice(0, 150));
      if (e.logs) {
        const errLogs = e.logs.filter((l: string) => l.includes('Error') || l.includes('failed') || l.includes('custom'));
        if (errLogs.length) console.log('  Logs:', errLogs.slice(0, 3));
      }
    }
    await sleep(DELAY_MS);
  }

  if (!poolHasTokens) {
    skip('Swap Buy', 'Pool still has 0 tokens after mint attempt');
    skip('Swap Sell', 'Pool has 0 tokens');
  } else {
    // ============ STEP 14: Swap Buy (atomic) ============
    console.log('\n📝 STEP 14: Swap Buy (SOL → Token) [atomic]');
    
    try {
      const ix = new TransactionInstruction({
        keys: [
          { pubkey: poolPda, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: tokenVaultPda, isSigner: false, isWritable: true },
          { pubkey: solVaultPda, isSigner: false, isWritable: true },
          { pubkey: winnerAta, isSigner: false, isWritable: true },
          { pubkey: winnerWallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          // Hook accounts
          { pubkey: HOOK_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: extraMetasPda, isSigner: false, isWritable: false },
          { pubkey: hookConfigPda, isSigner: false, isWritable: false },
          { pubkey: hookWhitelistPda, isSigner: false, isWritable: false },
        ],
        programId: BOOM_PROGRAM_ID,
        data: Buffer.concat([
          disc('swap_atomic_buy'),
          new BN(0.01 * LAMPORTS_PER_SOL).toArrayLike(Buffer, 'le', 8), // sol_in
          new BN(0).toArrayLike(Buffer, 'le', 8), // min_tokens_out
        ]),
      });
      const sig = await sendWithTimeout(connection, new Transaction().add(ix), [winnerWallet]);
      pass('Swap Buy', sig.slice(0, 20) + '...');
    } catch (e: any) {
      fail('Swap Buy', e.message?.slice(0, 150));
      if (e.logs) {
        const errLogs = e.logs.filter((l: string) => l.includes('Error') || l.includes('failed') || l.includes('custom') || l.includes('hook'));
        if (errLogs.length) console.log('  Logs:', errLogs.slice(0, 5));
      }
    }
    
    await sleep(DELAY_MS);

    // ============ STEP 15: Swap Sell (atomic) ============
    // For atomic sell, user must first transfer tokens to the pool's token vault,
    // then call swap_atomic_sell which checks the increased balance and sends SOL back.
    console.log('\n📝 STEP 15: Swap Sell (Token → SOL) [atomic]');
    try {
      const tokensToSell = new BN(1000).mul(new BN(10).pow(new BN(9)));
      
      // First: transfer tokens from winner to token vault (with hook accounts)
      const transferIx = new TransactionInstruction({
        keys: [
          { pubkey: winnerAta, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: tokenVaultPda, isSigner: false, isWritable: true },
          { pubkey: winnerWallet.publicKey, isSigner: true, isWritable: false },
          // Hook extra accounts
          { pubkey: extraMetasPda, isSigner: false, isWritable: false },
          { pubkey: HOOK_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: hookConfigPda, isSigner: false, isWritable: false },
          { pubkey: hookWhitelistPda, isSigner: false, isWritable: false },
        ],
        programId: TOKEN_2022_PROGRAM_ID,
        data: Buffer.from([
          12, // transfer_checked instruction index
          ...tokensToSell.toArrayLike(Buffer, 'le', 8),
          9, // decimals
        ]),
      });

      // Then: call swap_atomic_sell (only needs pool, token_vault, sol_vault, user, system)
      const sellIx = new TransactionInstruction({
        keys: [
          { pubkey: poolPda, isSigner: false, isWritable: true },
          { pubkey: tokenVaultPda, isSigner: false, isWritable: false },
          { pubkey: solVaultPda, isSigner: false, isWritable: true },
          { pubkey: winnerWallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: BOOM_PROGRAM_ID,
        data: Buffer.concat([
          disc('swap_atomic_sell'),
          tokensToSell.toArrayLike(Buffer, 'le', 8), // tokens_in
          new BN(0).toArrayLike(Buffer, 'le', 8), // min_sol_out
        ]),
      });
      
      const sig = await sendWithTimeout(connection, new Transaction().add(transferIx, sellIx), [winnerWallet]);
      pass('Swap Sell', sig.slice(0, 20) + '...');
    } catch (e: any) {
      fail('Swap Sell', e.message?.slice(0, 150));
      if (e.logs) {
        const errLogs = e.logs.filter((l: string) => l.includes('Error') || l.includes('failed') || l.includes('custom') || l.includes('hook'));
        if (errLogs.length) console.log('  Logs:', errLogs.slice(0, 5));
      }
    }
  }

  await sleep(DELAY_MS);

  // ============ STEP 16: Wait for explosion deadline + trigger ============
  console.log(`\n⏳ Waiting ${EXPLOSION_DURATION + 5}s for explosion deadline...`);
  await sleep((EXPLOSION_DURATION + 5) * 1000);

  console.log('\n📝 STEP 15: Trigger Time Explosion');
  try {
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: explosionPda, isSigner: false, isWritable: true },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: disc('trigger_presale_explosion_time'),
    });
    const sig = await sendWithTimeout(connection, new Transaction().add(ix), [mainWallet]);
    pass('Trigger Time Explosion', sig.slice(0, 20) + '...');
  } catch (e: any) {
    fail('Trigger Time Explosion', e.message?.slice(0, 150));
    if (e.logs) {
      const errLogs = e.logs.filter((l: string) => l.includes('Error') || l.includes('failed') || l.includes('custom'));
      if (errLogs.length) console.log('  Logs:', errLogs.slice(0, 3));
    }
  }

  await sleep(DELAY_MS);

  // ============ STEP 17: Unwind LP ============
  console.log('\n📝 STEP 16: Unwind LP');
  // First, fund the payout vault with SOL from sol_vault
  // unwind_lp takes total_sol_extracted as param and creates payout_pool
  try {
    // Check SOL vault balance
    const solVaultBal = await connection.getBalance(solVaultPda);
    console.log(`  SOL Vault balance: ${solVaultBal / LAMPORTS_PER_SOL} SOL`);
    
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: presalePda, isSigner: false, isWritable: false },
        { pubkey: explosionPda, isSigner: false, isWritable: true },
        { pubkey: payoutPoolPda, isSigner: false, isWritable: true },
        { pubkey: poolPda, isSigner: false, isWritable: false },
        { pubkey: tokenVaultPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: Buffer.concat([
        disc('unwind_lp'),
        new BN(solVaultBal).toArrayLike(Buffer, 'le', 8), // total_sol_extracted
      ]),
    });
    const sig = await sendWithTimeout(connection, new Transaction().add(ix), [mainWallet]);
    pass('Unwind LP', sig.slice(0, 20) + '...');
  } catch (e: any) {
    fail('Unwind LP', e.message?.slice(0, 150));
    if (e.logs) {
      const errLogs = e.logs.filter((l: string) => l.includes('Error') || l.includes('failed') || l.includes('custom'));
      if (errLogs.length) console.log('  Logs:', errLogs.slice(0, 3));
    }
  }

  await sleep(DELAY_MS);

  // ============ STEP 18: Claim Explosion Payout ============
  console.log('\n📝 STEP 17: Claim Explosion Payout');
  // Winner burns their tokens and gets proportional SOL
  try {
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: explosionPda, isSigner: false, isWritable: false },
        { pubkey: payoutPoolPda, isSigner: false, isWritable: true },
        { pubkey: poolPda, isSigner: false, isWritable: false },
        { pubkey: solVaultPda, isSigner: false, isWritable: true },
        { pubkey: winnerAta, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: winnerWallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: disc('claim_explosion_payout'),
    });
    const sig = await sendWithTimeout(connection, new Transaction().add(ix), [winnerWallet]);
    pass('Claim Explosion Payout', sig.slice(0, 20) + '...');
  } catch (e: any) {
    fail('Claim Explosion Payout', e.message?.slice(0, 150));
    if (e.logs) {
      const errLogs = e.logs.filter((l: string) => l.includes('Error') || l.includes('failed') || l.includes('custom'));
      if (errLogs.length) console.log('  Logs:', errLogs.slice(0, 3));
    }
  }

  // ============ FINAL REPORT ============
  console.log('\n\n🏁 ==========================================');
  console.log('   E2E TEST RESULTS');
  console.log('==========================================\n');
  
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;
  
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⏭️';
    console.log(`  ${icon} ${r.step}${r.detail ? ' — ' + r.detail : ''}`);
  }
  
  console.log(`\n  Total: ${results.length} | ✅ ${passed} | ❌ ${failed} | ⏭️  ${skipped}`);
  console.log(`\n  Round ID: ${ROUND_ID}`);
  console.log(`  Mint: ${mint.toBase58()}`);
  console.log('==========================================\n');
}

main().catch(err => {
  console.error('\n💥 FATAL ERROR:', err.message);
  console.error(err);
  process.exit(1);
});
