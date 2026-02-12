/**
 * BOOM Protocol - Live Test 3: Real People Test
 * 
 * 3 depositors, 2 winners, 1 loser
 * Winners get 5% tokens each (10% total), 90% to pool
 * Max 0.5 SOL per winner goes to pool, excess refunded
 * 10 min presale, 10 min explosion timer
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
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============ CONFIG ============
const BOOM_PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');
const HOOK_PROGRAM_ID = new PublicKey('CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9');
const RPC_URL = 'https://api.devnet.solana.com';
const DELAY_MS = 2000;

const KEYPAIR_PATH = path.join(process.env.HOME!, '.config/solana/id.json');
const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
const mainWallet = Keypair.fromSecretKey(new Uint8Array(keypairData));

const ROUND_ID = Math.floor(Date.now() / 1000);
const COOLDOWN_SECONDS = 600; // 10 minutes
const EXPLOSION_DURATION = 600; // 10 minutes

const TOKEN_NAME = '$TEST3';
const TOKEN_SYMBOL = 'TEST3';
const TOKEN_URI = '';

function disc(name: string): Buffer {
  return crypto.createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function sendWithTimeout(
  conn: Connection, tx: Transaction, signers: Keypair[], timeoutMs = 45000,
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

  console.log('🚀 BOOM Protocol - Live Test 3: 2 Winners 1 Loser ($TEST3)');
  console.log('====================================================');
  console.log(`Round ID: ${ROUND_ID}`);
  console.log(`Main Wallet: ${mainWallet.publicKey.toBase58()}`);
  
  const mainBalance = await connection.getBalance(mainWallet.publicKey);
  console.log(`Main Balance: ${mainBalance / LAMPORTS_PER_SOL} SOL`);
  
  if (mainBalance < 3 * LAMPORTS_PER_SOL) {
    console.log('❌ Insufficient SOL. Need at least 3 SOL.');
    return;
  }

  // ============ SETUP: 3 test wallets ============
  console.log('\n📋 SETUP: Creating 3 test wallets...');
  const walletA = Keypair.generate();
  const walletB = Keypair.generate();
  const walletC = Keypair.generate();
  const wallets = [
    { name: 'Wallet A', kp: walletA },
    { name: 'Wallet B', kp: walletB },
    { name: 'Wallet C', kp: walletC },
  ];
  for (const w of wallets) console.log(`  ${w.name}: ${w.kp.publicKey.toBase58()}`);

  // Record starting balances (after funding)
  const startBalances: Record<string, number> = {};

  try {
    const fundTx = new Transaction();
    for (const w of wallets) {
      fundTx.add(SystemProgram.transfer({
        fromPubkey: mainWallet.publicKey,
        toPubkey: w.kp.publicKey,
        lamports: 0.8 * LAMPORTS_PER_SOL, // enough for 0.7 SOL deposit + tx fees
      }));
    }
    await sendWithTimeout(connection, fundTx, [mainWallet]);
    pass('Fund test wallets', '0.8 SOL each to A, B, C');
    for (const w of wallets) {
      startBalances[w.name] = await connection.getBalance(w.kp.publicKey);
    }
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

  const depositPdas = wallets.map(w => pda([Buffer.from('deposit'), rb, w.kp.publicKey.toBuffer()]));

  // ============ STEP 1: START PRESALE (lottery_spots = 3) ============
  console.log('\n📝 STEP 1: Start Presale (lottery_spots=3)');
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
        Buffer.from(new Uint32Array([2]).buffer), // lotterySpots = 2 (out of 3 depositors)
        new BN(0.5 * LAMPORTS_PER_SOL).toArrayLike(Buffer, 'le', 8), // minDeposit = 0.5 SOL
        new BN(100 * LAMPORTS_PER_SOL).toArrayLike(Buffer, 'le', 8), // maxDeposit = 100 SOL (effectively no limit)
        new BN(0.5 * LAMPORTS_PER_SOL).toArrayLike(Buffer, 'le', 8), // maxWinnerContribution = 0.5 SOL
      ]),
    });
    const sig = await sendWithTimeout(connection, new Transaction().add(ix), [mainWallet]);
    pass('Start Presale', sig.slice(0, 20) + '...');
  } catch (e: any) {
    fail('Start Presale', e.message?.slice(0, 120));
    return;
  }
  await sleep(DELAY_MS);

  // ============ STEP 2: Deposits from all 3 ============
  console.log('\n📝 STEP 2: Deposits (A, B, C)');
  const depositAmount = new BN(0.7 * LAMPORTS_PER_SOL); // 0.7 SOL each (winners get 0.2 SOL excess refunded)
  for (let i = 0; i < wallets.length; i++) {
    const { name, kp } = wallets[i];
    try {
      const ix = new TransactionInstruction({
        keys: [
          { pubkey: presalePda, isSigner: false, isWritable: true },
          { pubkey: depositPdas[i], isSigner: false, isWritable: true },
          { pubkey: kp.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: BOOM_PROGRAM_ID,
        data: Buffer.concat([disc('deposit_presale'), depositAmount.toArrayLike(Buffer, 'le', 8)]),
      });
      const sig = await sendWithTimeout(connection, new Transaction().add(ix), [kp]);
      pass(`${name} deposit`, sig.slice(0, 20) + '...');
    } catch (e: any) {
      fail(`${name} deposit`, e.message?.slice(0, 120));
    }
    await sleep(DELAY_MS);
  }

  // ============ STEP 3: Wait for cooldown ============
  console.log(`\n⏳ Waiting ${COOLDOWN_SECONDS + 5}s for presale cooldown...`);
  await sleep((COOLDOWN_SECONDS + 5) * 1000);

  // ============ STEP 4: End Presale + Lottery (2 winners) ============
  console.log('\n📝 STEP 3: End Presale + Lottery (2 winners out of 3)');
  try {
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: presalePda, isSigner: false, isWritable: true },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: Buffer.concat([
        disc('end_presale_and_lottery'),
        Buffer.from(new Uint32Array([2]).buffer), // vec length = 2 (2 winners)
        Buffer.from(new Uint32Array([0]).buffer), // winner index 0 (Wallet A)
        Buffer.from(new Uint32Array([1]).buffer), // winner index 1 (Wallet B)
      ]),
    });
    const sig = await sendWithTimeout(connection, new Transaction().add(ix), [mainWallet]);
    pass('End Presale + Lottery', sig.slice(0, 20) + '...');
  } catch (e: any) {
    fail('End Presale + Lottery', e.message?.slice(0, 120));
  }
  await sleep(DELAY_MS);

  // ============ STEP 5: Mark 2 winners (A and B win, C loses) ============
  console.log('\n📝 STEP 4: Mark Winners (A and B only — C is the loser)');
  const winnerIndices = [0, 1]; // Wallet A and B
  const loserIndex = 2; // Wallet C
  for (const i of winnerIndices) {
    const { name } = wallets[i];
    try {
      const ix = new TransactionInstruction({
        keys: [
          { pubkey: presalePda, isSigner: false, isWritable: false },
          { pubkey: depositPdas[i], isSigner: false, isWritable: true },
          { pubkey: mainWallet.publicKey, isSigner: true, isWritable: false },
        ],
        programId: BOOM_PROGRAM_ID,
        data: disc('mark_winner'),
      });
      const sig = await sendWithTimeout(connection, new Transaction().add(ix), [mainWallet]);
      pass(`Mark ${name} winner`, sig.slice(0, 20) + '...');
    } catch (e: any) {
      fail(`Mark ${name} winner`, e.message?.slice(0, 120));
    }
    await sleep(DELAY_MS);
  }
  console.log(`  ℹ️  ${wallets[loserIndex].name} is the loser (not marked as winner)`);

  // ============ STEP 6: Create Token2022 with transfer hook ============
  console.log('\n📝 STEP 5: Create Token2022 ($TEST3) with transfer hook');
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  console.log(`  Mint: ${mint.toBase58()}`);

  try {
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
      createInitializeTransferHookInstruction(mint, mainWallet.publicKey, HOOK_PROGRAM_ID, TOKEN_2022_PROGRAM_ID),
      createInitializeMetadataPointerInstruction(mint, mainWallet.publicKey, mint, TOKEN_2022_PROGRAM_ID),
      createInitializeMintInstruction(mint, 9, mainWallet.publicKey, null, TOKEN_2022_PROGRAM_ID),
    );
    await sendWithTimeout(connection, tx1, [mainWallet, mintKeypair]);
    console.log('  Mint created');
    await sleep(DELAY_MS);

    const { tokenMetadataInitializeWithRentTransfer } = await import('@solana/spl-token');
    await tokenMetadataInitializeWithRentTransfer(
      connection, mainWallet, mint, mainWallet.publicKey, mainWallet,
      TOKEN_NAME, TOKEN_SYMBOL, TOKEN_URI, [], { commitment: 'confirmed' } as any, TOKEN_2022_PROGRAM_ID,
    );
    console.log(`  Metadata initialized: name=${TOKEN_NAME}`);
    await sleep(DELAY_MS);

    const tx3 = new Transaction().add(
      createSetAuthorityInstruction(mint, mainWallet.publicKey, AuthorityType.MintTokens, mintAuthorityPda, [], TOKEN_2022_PROGRAM_ID),
    );
    const sig3 = await sendWithTimeout(connection, tx3, [mainWallet]);
    pass('Create Token2022 ($TEST3)', sig3.slice(0, 20) + '...');
  } catch (e: any) {
    fail('Create Token2022 ($TEST3)', e.message?.slice(0, 200));
    if (e.logs) console.log('  Logs:', e.logs.filter((l: string) => l.includes('Error') || l.includes('failed')).slice(0, 3));
  }
  await sleep(DELAY_MS);

  // ============ STEP 6b: Init Hook Extra Account Metas ============
  console.log('\n📝 STEP 6b: Init Hook Extra Account Metas');
  const [extraMetasPda] = PublicKey.findProgramAddressSync([Buffer.from('extra-account-metas'), mint.toBuffer()], HOOK_PROGRAM_ID);
  const [hookConfigPda] = PublicKey.findProgramAddressSync([Buffer.from('hook_config')], HOOK_PROGRAM_ID);
  const [hookWhitelistPda] = PublicKey.findProgramAddressSync([Buffer.from('whitelist'), mint.toBuffer()], HOOK_PROGRAM_ID);

  try {
    const addWhitelistIx = new TransactionInstruction({
      programId: HOOK_PROGRAM_ID,
      keys: [
        { pubkey: hookConfigPda, isSigner: false, isWritable: false },
        { pubkey: hookWhitelistPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([disc('add_whitelist'), tokenVaultPda.toBuffer()]),
    });
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
    if (e.logs) console.log('  Logs:', e.logs.filter((l: string) => l.includes('Error') || l.includes('failed') || l.includes('custom')).slice(0, 3));
  }
  await sleep(DELAY_MS);

  // ============ STEP 7: Register Presale Token ============
  console.log('\n📝 STEP 7: Register Presale Token');
  const totalSupply = new BN(1_000_000_000).mul(new BN(10).pow(new BN(9)));
  const tokensPerWinner = new BN(50_000_000).mul(new BN(10).pow(new BN(9))); // 5% each = 50M tokens
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
        disc('register_presale_token'), rb,
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
  console.log('\n📝 STEP 8: Init Explosion Tracking');
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
      data: Buffer.concat([disc('init_presale_explosion'), rb, capHash]),
    });
    const sig = await sendWithTimeout(connection, new Transaction().add(ix), [mainWallet]);
    pass('Init Explosion Tracking', sig.slice(0, 20) + '...');
  } catch (e: any) {
    fail('Init Explosion Tracking', e.message?.slice(0, 120));
  }
  await sleep(DELAY_MS);

  // ============ STEP 9: Create Pool ============
  console.log('\n📝 STEP 9: Create Pool');
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
      data: Buffer.concat([disc('create_pool'), rb, Buffer.from(new Uint16Array([100]).buffer)]),
    });
    const sig = await sendWithTimeout(connection, new Transaction().add(ix), [mainWallet]);
    pass('Create Pool', sig.slice(0, 20) + '...');
  } catch (e: any) {
    fail('Create Pool', e.message?.slice(0, 120));
  }
  await sleep(DELAY_MS);

  // ============ STEP 10: Register LP ============
  console.log('\n📝 STEP 10: Register LP');
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
        disc('register_lp'), rb,
        poolPda.toBuffer(), mint.toBuffer(), tokenVaultPda.toBuffer(), solVaultPda.toBuffer(),
      ]),
    });
    const sig = await sendWithTimeout(connection, new Transaction().add(ix), [mainWallet]);
    pass('Register LP', sig.slice(0, 20) + '...');
  } catch (e: any) {
    fail('Register LP', e.message?.slice(0, 120));
  }
  await sleep(DELAY_MS);

  // ============ STEP 11: Start Explosion Timer ============
  console.log('\n📝 STEP 11: Start Explosion Timer');
  try {
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: explosionPda, isSigner: false, isWritable: true },
        { pubkey: lpInfoPda, isSigner: false, isWritable: false },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: Buffer.concat([disc('start_explosion_timer'), new BN(EXPLOSION_DURATION).toArrayLike(Buffer, 'le', 8)]),
    });
    const sig = await sendWithTimeout(connection, new Transaction().add(ix), [mainWallet]);
    pass('Start Explosion Timer', sig.slice(0, 20) + '...');
  } catch (e: any) {
    fail('Start Explosion Timer', e.message?.slice(0, 120));
  }
  await sleep(DELAY_MS);

  // ============ STEP 12: Winners claim tokens (A and B only) ============
  console.log('\n📝 STEP 12: Winners claim tokens (A and B)');
  const walletAtas: PublicKey[] = [];
  for (let i = 0; i < wallets.length; i++) {
    const { name, kp } = wallets[i];
    const ata = getAssociatedTokenAddressSync(mint, kp.publicKey, false, TOKEN_2022_PROGRAM_ID);
    walletAtas.push(ata);

    if (!winnerIndices.includes(i)) {
      console.log(`  ⏭️  ${name} is a loser — skipping token claim`);
      continue;
    }

    // Create ATA
    try {
      const createAtaTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(mainWallet.publicKey, ata, kp.publicKey, mint, TOKEN_2022_PROGRAM_ID)
      );
      await sendWithTimeout(connection, createAtaTx, [mainWallet]);
      console.log(`  ATA created for ${name}`);
    } catch (e: any) {
      if (!e.message?.includes('already in use')) console.log(`  ATA issue for ${name}: ${e.message?.slice(0, 80)}`);
    }
    await sleep(DELAY_MS);

    // Claim
    try {
      const ix = new TransactionInstruction({
        keys: [
          { pubkey: presalePda, isSigner: false, isWritable: false },
          { pubkey: presaleTokenPda, isSigner: false, isWritable: false },
          { pubkey: explosionPda, isSigner: false, isWritable: false },
          { pubkey: depositPdas[i], isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: true },
          { pubkey: mintAuthorityPda, isSigner: false, isWritable: false },
          { pubkey: ata, isSigner: false, isWritable: true },
          { pubkey: kp.publicKey, isSigner: false, isWritable: false },
          { pubkey: kp.publicKey, isSigner: true, isWritable: true },
          { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        programId: BOOM_PROGRAM_ID,
        data: disc('claim_winner_tokens'),
      });
      const sig = await sendWithTimeout(connection, new Transaction().add(ix), [kp]);
      const tokenBal = await connection.getTokenAccountBalance(ata);
      pass(`${name} claims tokens`, `${tokenBal.value.uiAmount} tokens, ${sig.slice(0, 20)}...`);
    } catch (e: any) {
      fail(`${name} claims tokens`, e.message?.slice(0, 150));
      if (e.logs) console.log('  Logs:', e.logs.filter((l: string) => l.includes('Error') || l.includes('failed') || l.includes('custom')).slice(0, 3));
    }
    await sleep(DELAY_MS);
  }

  // ============ STEP 12b: All wallets claim refunds ============
  // Loser C gets full refund (0.7 SOL)
  // Winners A & B get excess refund (0.7 - 0.5 = 0.2 SOL each)
  console.log('\n📝 STEP 12b: Claim refunds (loser=full, winners=excess)');
  for (let i = 0; i < wallets.length; i++) {
    const { name, kp } = wallets[i];
    const expectedRefund = winnerIndices.includes(i) ? '~0.2 SOL (excess)' : '~0.7 SOL (full)';
    try {
      const balBefore = await connection.getBalance(kp.publicKey);
      const ix = new TransactionInstruction({
        keys: [
          { pubkey: presalePda, isSigner: false, isWritable: false },
          { pubkey: explosionPda, isSigner: false, isWritable: false },
          { pubkey: depositPdas[i], isSigner: false, isWritable: true },
          { pubkey: poolPda, isSigner: false, isWritable: true },
          { pubkey: solVaultPda, isSigner: false, isWritable: true },
          { pubkey: kp.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: BOOM_PROGRAM_ID,
        data: disc('claim_refund'),
      });
      const sig = await sendWithTimeout(connection, new Transaction().add(ix), [kp]);
      const balAfter = await connection.getBalance(kp.publicKey);
      const refunded = (balAfter - balBefore + 5000) / LAMPORTS_PER_SOL;
      pass(`${name} claims refund`, `+${refunded.toFixed(4)} SOL (expected ${expectedRefund}), ${sig.slice(0, 20)}...`);
    } catch (e: any) {
      fail(`${name} claims refund`, e.message?.slice(0, 150));
      if (e.logs) console.log('  Logs:', e.logs.filter((l: string) => l.includes('Error') || l.includes('failed') || l.includes('custom')).slice(0, 3));
    }
    await sleep(DELAY_MS);
  }

  // ============ STEP 13: Mint pool tokens + sync ============
  console.log('\n📝 STEP 13: Mint pool tokens + sync');
  let poolHasTokens = false;
  try {
    const POOL_TOKEN_AMOUNT = new BN(900_000_000).mul(new BN(10).pow(new BN(9))); // 90% to pool
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
      data: Buffer.concat([disc('mint_pool_tokens'), POOL_TOKEN_AMOUNT.toArrayLike(Buffer, 'le', 8)]),
    });
    const sig = await sendWithTimeout(connection, new Transaction().add(ix), [mainWallet]);
    pass('Mint Pool Tokens', `500M tokens, ${sig.slice(0, 20)}...`);
    await sleep(DELAY_MS);

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
    if (e.logs) console.log('  Logs:', e.logs.filter((l: string) => l.includes('Error') || l.includes('failed') || l.includes('custom')).slice(0, 3));
  }
  await sleep(DELAY_MS);

  // ============ STEP 14: Swaps (Wallet A does buy+sell) ============
  if (!poolHasTokens) {
    skip('Swap Buy', 'Pool has 0 tokens');
    skip('Swap Sell', 'Pool has 0 tokens');
  } else {
    console.log('\n📝 STEP 14: Wallet A Swap Buy (SOL → Token)');
    try {
      const ix = new TransactionInstruction({
        keys: [
          { pubkey: poolPda, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: tokenVaultPda, isSigner: false, isWritable: true },
          { pubkey: solVaultPda, isSigner: false, isWritable: true },
          { pubkey: walletAtas[0], isSigner: false, isWritable: true },
          { pubkey: walletA.publicKey, isSigner: true, isWritable: true },
          { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: HOOK_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: extraMetasPda, isSigner: false, isWritable: false },
          { pubkey: hookConfigPda, isSigner: false, isWritable: false },
          { pubkey: hookWhitelistPda, isSigner: false, isWritable: false },
        ],
        programId: BOOM_PROGRAM_ID,
        data: Buffer.concat([
          disc('swap_atomic_buy'),
          new BN(0.01 * LAMPORTS_PER_SOL).toArrayLike(Buffer, 'le', 8),
          new BN(0).toArrayLike(Buffer, 'le', 8),
        ]),
      });
      const sig = await sendWithTimeout(connection, new Transaction().add(ix), [walletA]);
      pass('Swap Buy (Wallet A)', sig.slice(0, 20) + '...');
    } catch (e: any) {
      fail('Swap Buy (Wallet A)', e.message?.slice(0, 150));
      if (e.logs) console.log('  Logs:', e.logs.filter((l: string) => l.includes('Error') || l.includes('failed') || l.includes('custom') || l.includes('hook')).slice(0, 5));
    }
    await sleep(DELAY_MS);

    console.log('\n📝 STEP 15: Wallet A Swap Sell (Token → SOL)');
    try {
      const tokensToSell = new BN(1000).mul(new BN(10).pow(new BN(9)));
      const transferIx = new TransactionInstruction({
        keys: [
          { pubkey: walletAtas[0], isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: tokenVaultPda, isSigner: false, isWritable: true },
          { pubkey: walletA.publicKey, isSigner: true, isWritable: false },
          { pubkey: extraMetasPda, isSigner: false, isWritable: false },
          { pubkey: HOOK_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: hookConfigPda, isSigner: false, isWritable: false },
          { pubkey: hookWhitelistPda, isSigner: false, isWritable: false },
        ],
        programId: TOKEN_2022_PROGRAM_ID,
        data: Buffer.from([12, ...tokensToSell.toArrayLike(Buffer, 'le', 8), 9]),
      });
      const sellIx = new TransactionInstruction({
        keys: [
          { pubkey: poolPda, isSigner: false, isWritable: true },
          { pubkey: tokenVaultPda, isSigner: false, isWritable: false },
          { pubkey: solVaultPda, isSigner: false, isWritable: true },
          { pubkey: walletA.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: BOOM_PROGRAM_ID,
        data: Buffer.concat([
          disc('swap_atomic_sell'),
          tokensToSell.toArrayLike(Buffer, 'le', 8),
          new BN(0).toArrayLike(Buffer, 'le', 8),
        ]),
      });
      const sig = await sendWithTimeout(connection, new Transaction().add(transferIx, sellIx), [walletA]);
      pass('Swap Sell (Wallet A)', sig.slice(0, 20) + '...');
    } catch (e: any) {
      fail('Swap Sell (Wallet A)', e.message?.slice(0, 150));
      if (e.logs) console.log('  Logs:', e.logs.filter((l: string) => l.includes('Error') || l.includes('failed') || l.includes('custom') || l.includes('hook')).slice(0, 5));
    }
  }
  await sleep(DELAY_MS);

  // ============ STEP 16: Wait for explosion ============
  console.log(`\n⏳ Waiting ${EXPLOSION_DURATION + 5}s for explosion deadline...`);
  await sleep((EXPLOSION_DURATION + 5) * 1000);

  // ============ STEP 17: Trigger Time Explosion ============
  console.log('\n📝 STEP 16: Trigger Time Explosion');
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
    if (e.logs) console.log('  Logs:', e.logs.filter((l: string) => l.includes('Error') || l.includes('failed') || l.includes('custom')).slice(0, 3));
  }
  await sleep(DELAY_MS);

  // ============ STEP 18: Unwind LP ============
  console.log('\n📝 STEP 17: Unwind LP');
  try {
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
      data: Buffer.concat([disc('unwind_lp'), new BN(solVaultBal).toArrayLike(Buffer, 'le', 8)]),
    });
    const sig = await sendWithTimeout(connection, new Transaction().add(ix), [mainWallet]);
    pass('Unwind LP', sig.slice(0, 20) + '...');
  } catch (e: any) {
    fail('Unwind LP', e.message?.slice(0, 150));
    if (e.logs) console.log('  Logs:', e.logs.filter((l: string) => l.includes('Error') || l.includes('failed') || l.includes('custom')).slice(0, 3));
  }
  await sleep(DELAY_MS);

  // ============ STEP 19: Winners claim explosion payout ============
  console.log('\n📝 STEP 18: Winners claim explosion payout (A and B only)');
  for (const i of winnerIndices) {
    const { name, kp } = wallets[i];
    const balBefore = await connection.getBalance(kp.publicKey);
    try {
      const ix = new TransactionInstruction({
        keys: [
          { pubkey: explosionPda, isSigner: false, isWritable: false },
          { pubkey: payoutPoolPda, isSigner: false, isWritable: true },
          { pubkey: poolPda, isSigner: false, isWritable: false },
          { pubkey: solVaultPda, isSigner: false, isWritable: true },
          { pubkey: walletAtas[i], isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: true },
          { pubkey: kp.publicKey, isSigner: true, isWritable: true },
          { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: BOOM_PROGRAM_ID,
        data: disc('claim_explosion_payout'),
      });
      const sig = await sendWithTimeout(connection, new Transaction().add(ix), [kp]);
      const balAfter = await connection.getBalance(kp.publicKey);
      const solReceived = (balAfter - balBefore + 5000) / LAMPORTS_PER_SOL;
      pass(`${name} claims payout`, `+${solReceived.toFixed(6)} SOL, ${sig.slice(0, 20)}...`);
    } catch (e: any) {
      fail(`${name} claims payout`, e.message?.slice(0, 150));
      if (e.logs) console.log('  Logs:', e.logs.filter((l: string) => l.includes('Error') || l.includes('failed') || l.includes('custom')).slice(0, 3));
    }
    await sleep(DELAY_MS);
  }

  // ============ FINAL REPORT ============
  console.log('\n\n🏁 ====================================================');
  console.log('   E2E TEST 2 RESULTS ($TEST3 - 2 Winners 1 Loser)');
  console.log('====================================================\n');

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

  // Final wallet balances
  console.log('\n  💰 Wallet Balance Report:');
  for (let i = 0; i < wallets.length; i++) {
    const { name, kp } = wallets[i];
    const finalBal = await connection.getBalance(kp.publicKey);
    const startBal = startBalances[name];
    const diff = (finalBal - startBal) / LAMPORTS_PER_SOL;
    console.log(`    ${name}: ${(finalBal / LAMPORTS_PER_SOL).toFixed(6)} SOL (${diff >= 0 ? '+' : ''}${diff.toFixed(6)} SOL vs start)`);
  }

  console.log('====================================================\n');
}

main().catch(err => {
  console.error('\n💥 FATAL ERROR:', err.message);
  console.error(err);
  process.exit(1);
});
