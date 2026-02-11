/**
 * BOOM Protocol - Unwind LP + Explosion Payout E2E Test
 * 
 * Full flow: presale → pool → swap → explosion → unwind LP → claim payout
 * Based on test-swap-e2e.ts with added explosion/unwind/claim steps.
 */

import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, SystemProgram, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID, ExtensionType, createInitializeMintInstruction,
  createInitializeTransferHookInstruction, getMintLen,
  createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync,
  createTransferCheckedInstruction, addExtraAccountMetasForExecute,
} from '@solana/spl-token';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============ CONFIG ============
const BOOM_PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');
const HOOK_PROGRAM_ID = new PublicKey('CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9');
const RPC_URL = 'https://api.devnet.solana.com';
const DELAY_MS = 2500;
const COOLDOWN_SECONDS = 60;
const EXPLOSION_TIMER_SECONDS = 60; // shortened from 120s

const KEYPAIR_PATH = path.join(process.env.HOME!, '.config/solana/id.json');
const mainWallet = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'))));

const ROUND_ID = Math.floor(Date.now() / 1000);

function disc(name: string): Buffer {
  return crypto.createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function rb(): Buffer { return new BN(ROUND_ID).toArrayLike(Buffer, 'le', 8); }
function pda(seeds: (Buffer | Uint8Array)[], programId = BOOM_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

const results: { step: string; status: 'PASS' | 'FAIL' | 'SKIP'; detail?: string }[] = [];
function pass(s: string, d?: string) { results.push({ step: s, status: 'PASS', detail: d }); console.log(`  ✅ ${s}${d ? ': ' + d : ''}`); }
function fail(s: string, d: string) { results.push({ step: s, status: 'FAIL', detail: d }); console.log(`  ❌ ${s}: ${d}`); }

async function sendTx(conn: Connection, ix: TransactionInstruction | TransactionInstruction[], signers: Keypair[]): Promise<string> {
  const tx = new Transaction();
  if (Array.isArray(ix)) ix.forEach(i => tx.add(i)); else tx.add(ix);
  return sendAndConfirmTransaction(conn, tx, signers);
}

async function main() {
  const conn = new Connection(RPC_URL, 'confirmed');
  
  console.log('🔄 BOOM Protocol - Unwind LP + Payout E2E Test');
  console.log('================================================');
  console.log(`Round ID: ${ROUND_ID}`);
  console.log(`Wallet: ${mainWallet.publicKey.toBase58()}`);
  const bal = await conn.getBalance(mainWallet.publicKey);
  console.log(`Balance: ${bal / LAMPORTS_PER_SOL} SOL\n`);
  if (bal < 2.0 * LAMPORTS_PER_SOL) { console.log('Need >= 2.0 SOL'); return; }

  // Winner wallet
  const winner = Keypair.generate();
  console.log(`Winner: ${winner.publicKey.toBase58()}`);

  // Fund winner
  await sendTx(conn, SystemProgram.transfer({ fromPubkey: mainWallet.publicKey, toPubkey: winner.publicKey, lamports: 0.5 * LAMPORTS_PER_SOL }), [mainWallet]);
  console.log('Winner funded with 0.5 SOL');
  await sleep(DELAY_MS);

  // PDAs
  const presalePda = pda([Buffer.from('presale'), rb()]);
  const presaleTokenPda = pda([Buffer.from('presale_token'), rb()]);
  const explosionPda = pda([Buffer.from('presale_explosion'), rb()]);
  const poolPda = pda([Buffer.from('pool'), rb()]);
  const tokenVaultPda = pda([Buffer.from('token_vault'), rb()]);
  const solVaultPda = pda([Buffer.from('sol_vault'), rb()]);
  const lpInfoPda = pda([Buffer.from('lp_info'), rb()]);
  const mintAuthorityPda = pda([Buffer.from('mint_authority'), rb()]);
  const winnerDepositPda = pda([Buffer.from('deposit'), rb(), winner.publicKey.toBuffer()]);
  const payoutPoolPda = pda([Buffer.from('payout_pool'), rb()]);
  const payoutVaultPda = pda([Buffer.from('payout_vault'), rb()]);

  // ===== 1. START PRESALE =====
  console.log('\n--- Step 1: Start Presale ---');
  try {
    await sendTx(conn, new TransactionInstruction({
      keys: [
        { pubkey: presalePda, isSigner: false, isWritable: true },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: Buffer.concat([
        disc('start_presale'), rb(),
        new BN(COOLDOWN_SECONDS).toArrayLike(Buffer, 'le', 8),
        Buffer.from(new Uint32Array([10]).buffer),
        new BN(0.05 * LAMPORTS_PER_SOL).toArrayLike(Buffer, 'le', 8),
        new BN(5 * LAMPORTS_PER_SOL).toArrayLike(Buffer, 'le', 8),
      ]),
    }), [mainWallet]);
    pass('Start Presale');
  } catch (e: any) { fail('Start Presale', e.message?.slice(0, 120)); return; }
  await sleep(DELAY_MS);

  // ===== 2. DEPOSIT =====
  console.log('\n--- Step 2: Winner Deposits ---');
  try {
    await sendTx(conn, new TransactionInstruction({
      keys: [
        { pubkey: presalePda, isSigner: false, isWritable: true },
        { pubkey: winnerDepositPda, isSigner: false, isWritable: true },
        { pubkey: winner.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: Buffer.concat([disc('deposit_presale'), new BN(0.1 * LAMPORTS_PER_SOL).toArrayLike(Buffer, 'le', 8)]),
    }), [winner]);
    pass('Winner Deposit');
  } catch (e: any) { fail('Winner Deposit', e.message?.slice(0, 120)); return; }
  await sleep(DELAY_MS);

  // ===== 3. WAIT COOLDOWN =====
  console.log(`\n⏳ Waiting ${COOLDOWN_SECONDS + 5}s for cooldown...`);
  await sleep((COOLDOWN_SECONDS + 5) * 1000);

  // ===== 4. END PRESALE =====
  console.log('\n--- Step 3: End Presale + Lottery ---');
  try {
    await sendTx(conn, new TransactionInstruction({
      keys: [
        { pubkey: presalePda, isSigner: false, isWritable: true },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: Buffer.concat([disc('end_presale_and_lottery'), Buffer.from(new Uint32Array([1]).buffer), Buffer.from(new Uint32Array([0]).buffer)]),
    }), [mainWallet]);
    pass('End Presale + Lottery');
  } catch (e: any) { fail('End Presale', e.message?.slice(0, 120)); return; }
  await sleep(DELAY_MS);

  // ===== 5. MARK WINNER =====
  console.log('\n--- Step 4: Mark Winner ---');
  try {
    await sendTx(conn, new TransactionInstruction({
      keys: [
        { pubkey: presalePda, isSigner: false, isWritable: false },
        { pubkey: winnerDepositPda, isSigner: false, isWritable: true },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: disc('mark_winner'),
    }), [mainWallet]);
    pass('Mark Winner');
  } catch (e: any) { fail('Mark Winner', e.message?.slice(0, 120)); return; }
  await sleep(DELAY_MS);

  // ===== 6. CREATE TOKEN =====
  console.log('\n--- Step 5: Create Token2022 ---');
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  console.log(`  Mint: ${mint.toBase58()}`);
  try {
    const extensions = [ExtensionType.TransferHook];
    const mintLen = getMintLen(extensions);
    const mintLamports = await conn.getMinimumBalanceForRentExemption(mintLen);
    await sendTx(conn, [
      SystemProgram.createAccount({ fromPubkey: mainWallet.publicKey, newAccountPubkey: mint, space: mintLen, lamports: mintLamports, programId: TOKEN_2022_PROGRAM_ID }),
      createInitializeTransferHookInstruction(mint, mainWallet.publicKey, HOOK_PROGRAM_ID, TOKEN_2022_PROGRAM_ID),
      createInitializeMintInstruction(mint, 9, mintAuthorityPda, null, TOKEN_2022_PROGRAM_ID),
    ], [mainWallet, mintKeypair]);
    pass('Create Token2022');
  } catch (e: any) { fail('Create Token2022', e.message?.slice(0, 120)); return; }
  await sleep(DELAY_MS);

  // ===== 6b. INIT HOOK EXTRA METAS =====
  console.log('\n--- Step 5b: Init Hook Extra Account Metas ---');
  const [extraMetasPda] = PublicKey.findProgramAddressSync([Buffer.from('extra-account-metas'), mint.toBuffer()], HOOK_PROGRAM_ID);
  try {
    await sendTx(conn, new TransactionInstruction({
      programId: HOOK_PROGRAM_ID,
      keys: [
        { pubkey: extraMetasPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: disc('initialize_extra_account_meta_list_empty'),
    }), [mainWallet]);
    pass('Init Hook Extra Metas');
  } catch (e: any) { fail('Init Hook Extra Metas', e.message?.slice(0, 120)); return; }
  await sleep(DELAY_MS);

  // ===== 7. REGISTER PRESALE TOKEN =====
  console.log('\n--- Step 6: Register Presale Token ---');
  const totalSupply = new BN(1_000_000_000).mul(new BN(10).pow(new BN(9)));
  const tokensPerWinner = new BN(100_000_000).mul(new BN(10).pow(new BN(9)));
  try {
    await sendTx(conn, new TransactionInstruction({
      keys: [
        { pubkey: presalePda, isSigner: false, isWritable: false },
        { pubkey: presaleTokenPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: Buffer.concat([disc('register_presale_token'), rb(), totalSupply.toArrayLike(Buffer, 'le', 8), tokensPerWinner.toArrayLike(Buffer, 'le', 8)]),
    }), [mainWallet]);
    pass('Register Presale Token');
  } catch (e: any) { fail('Register Presale Token', e.message?.slice(0, 120)); return; }
  await sleep(DELAY_MS);

  // ===== 8. INIT EXPLOSION =====
  console.log('\n--- Step 7: Init Explosion ---');
  const secretCap = new BN(1000 * LAMPORTS_PER_SOL);
  const capHash = crypto.createHash('sha256').update(secretCap.toArrayLike(Buffer, 'le', 8)).digest();
  try {
    await sendTx(conn, new TransactionInstruction({
      keys: [
        { pubkey: presalePda, isSigner: false, isWritable: false },
        { pubkey: explosionPda, isSigner: false, isWritable: true },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: Buffer.concat([disc('init_presale_explosion'), rb(), capHash]),
    }), [mainWallet]);
    pass('Init Explosion');
  } catch (e: any) { fail('Init Explosion', e.message?.slice(0, 120)); return; }
  await sleep(DELAY_MS);

  // ===== 9. CREATE POOL =====
  console.log('\n--- Step 8: Create Pool ---');
  try {
    await sendTx(conn, new TransactionInstruction({
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
      data: Buffer.concat([disc('create_pool'), rb(), Buffer.from(new Uint16Array([100]).buffer)]),
    }), [mainWallet]);
    pass('Create Pool');
  } catch (e: any) { fail('Create Pool', e.message?.slice(0, 120)); return; }
  await sleep(DELAY_MS);

  // ===== 10. REGISTER LP =====
  console.log('\n--- Step 9: Register LP ---');
  try {
    await sendTx(conn, new TransactionInstruction({
      keys: [
        { pubkey: presalePda, isSigner: false, isWritable: false },
        { pubkey: lpInfoPda, isSigner: false, isWritable: true },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: Buffer.concat([disc('register_lp'), rb(), poolPda.toBuffer(), mint.toBuffer(), tokenVaultPda.toBuffer(), solVaultPda.toBuffer()]),
    }), [mainWallet]);
    pass('Register LP');
  } catch (e: any) { fail('Register LP', e.message?.slice(0, 120)); }
  await sleep(DELAY_MS);

  // ===== 11. START EXPLOSION TIMER =====
  console.log('\n--- Step 10: Start Explosion Timer ---');
  try {
    await sendTx(conn, new TransactionInstruction({
      keys: [
        { pubkey: explosionPda, isSigner: false, isWritable: true },
        { pubkey: lpInfoPda, isSigner: false, isWritable: false },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: Buffer.concat([disc('start_explosion_timer'), new BN(EXPLOSION_TIMER_SECONDS).toArrayLike(Buffer, 'le', 8)]),
    }), [mainWallet]);
    pass('Start Explosion Timer', `${EXPLOSION_TIMER_SECONDS}s`);
  } catch (e: any) { fail('Start Explosion Timer', e.message?.slice(0, 120)); }
  await sleep(DELAY_MS);

  // ===== 12. WINNER CLAIMS TOKENS =====
  console.log('\n--- Step 11: Winner Claims Tokens ---');
  const winnerAta = getAssociatedTokenAddressSync(mint, winner.publicKey, false, TOKEN_2022_PROGRAM_ID);
  try {
    await sendTx(conn, createAssociatedTokenAccountInstruction(mainWallet.publicKey, winnerAta, winner.publicKey, mint, TOKEN_2022_PROGRAM_ID), [mainWallet]);
  } catch (e: any) { /* may exist */ }
  await sleep(DELAY_MS);

  try {
    await sendTx(conn, new TransactionInstruction({
      keys: [
        { pubkey: presalePda, isSigner: false, isWritable: false },
        { pubkey: presaleTokenPda, isSigner: false, isWritable: false },
        { pubkey: explosionPda, isSigner: false, isWritable: false },
        { pubkey: winnerDepositPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: mintAuthorityPda, isSigner: false, isWritable: false },
        { pubkey: winnerAta, isSigner: false, isWritable: true },
        { pubkey: winner.publicKey, isSigner: false, isWritable: false },
        { pubkey: winner.publicKey, isSigner: true, isWritable: true },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: disc('claim_winner_tokens'),
    }), [winner]);
    const tokenBal = await conn.getTokenAccountBalance(winnerAta);
    pass('Winner Claims Tokens', `${tokenBal.value.uiAmount} tokens`);
  } catch (e: any) { fail('Winner Claims Tokens', e.message?.slice(0, 150)); return; }
  await sleep(DELAY_MS);

  // ===== 13. SEED POOL: Transfer tokens to vault + sync =====
  console.log('\n--- Step 12: Seed Pool with Tokens ---');
  const winnerBal = await conn.getTokenAccountBalance(winnerAta);
  console.log(`  Winner token balance: ${winnerBal.value.uiAmount}`);
  const depositAmount = BigInt(winnerBal.value.amount) / 2n;
  console.log(`  Depositing ${depositAmount} raw tokens to vault...`);

  try {
    let transferIx = createTransferCheckedInstruction(
      winnerAta, mint, tokenVaultPda, winner.publicKey,
      depositAmount, 9, [], TOKEN_2022_PROGRAM_ID
    );
    await addExtraAccountMetasForExecute(
      conn, transferIx, HOOK_PROGRAM_ID,
      winnerAta, mint, tokenVaultPda, winner.publicKey, depositAmount, 'confirmed'
    );
    await sendTx(conn, transferIx, [winner]);
    const vaultBal = await conn.getTokenAccountBalance(tokenVaultPda);
    pass('Transfer Tokens to Vault', `${vaultBal.value.uiAmount} tokens in vault`);
  } catch (e: any) {
    fail('Transfer Tokens to Vault', e.message?.slice(0, 200));
    if (e.logs) { const el = e.logs.filter((l: string) => l.includes('Error') || l.includes('failed')); if (el.length) console.log('  Logs:', el.slice(0, 3)); }
    return;
  }
  await sleep(DELAY_MS);

  // ===== 14. FUND SOL VAULT =====
  console.log('\n--- Step 13: Fund SOL Vault ---');
  try {
    await sendTx(conn, SystemProgram.transfer({ fromPubkey: mainWallet.publicKey, toPubkey: solVaultPda, lamports: 0.1 * LAMPORTS_PER_SOL }), [mainWallet]);
    pass('Fund SOL Vault', '0.1 SOL');
  } catch (e: any) { fail('Fund SOL Vault', e.message?.slice(0, 120)); }
  await sleep(DELAY_MS);

  // ===== 15. SYNC POOL RESERVES =====
  console.log('\n--- Step 14: Sync Pool Reserves ---');
  try {
    await sendTx(conn, new TransactionInstruction({
      keys: [
        { pubkey: poolPda, isSigner: false, isWritable: true },
        { pubkey: tokenVaultPda, isSigner: false, isWritable: false },
        { pubkey: solVaultPda, isSigner: false, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: disc('sync_pool_reserves'),
    }), [mainWallet]);
    const tvBal = await conn.getTokenAccountBalance(tokenVaultPda);
    const svBal = await conn.getBalance(solVaultPda);
    pass('Sync Pool Reserves', `tokens=${tvBal.value.uiAmount}, SOL=${svBal / LAMPORTS_PER_SOL}`);
  } catch (e: any) {
    fail('Sync Pool Reserves', e.message?.slice(0, 200));
    return;
  }
  await sleep(DELAY_MS);

  // ===== 16. SWAP ATOMIC BUY =====
  console.log('\n--- Step 15: Swap Atomic Buy ---');
  const buyerAta = getAssociatedTokenAddressSync(mint, mainWallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  try {
    await sendTx(conn, createAssociatedTokenAccountInstruction(mainWallet.publicKey, buyerAta, mainWallet.publicKey, mint, TOKEN_2022_PROGRAM_ID), [mainWallet]);
  } catch (e: any) { /* may exist */ }
  await sleep(DELAY_MS);

  const [hookConfigPda] = PublicKey.findProgramAddressSync([Buffer.from('hook_config')], HOOK_PROGRAM_ID);
  const [hookWhitelistPda] = PublicKey.findProgramAddressSync([Buffer.from('whitelist'), mint.toBuffer()], HOOK_PROGRAM_ID);

  const solIn = new BN(0.01 * LAMPORTS_PER_SOL);
  try {
    await sendTx(conn, new TransactionInstruction({
      keys: [
        { pubkey: poolPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: tokenVaultPda, isSigner: false, isWritable: true },
        { pubkey: solVaultPda, isSigner: false, isWritable: true },
        { pubkey: buyerAta, isSigner: false, isWritable: true },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: HOOK_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: extraMetasPda, isSigner: false, isWritable: false },
        { pubkey: hookConfigPda, isSigner: false, isWritable: false },
        { pubkey: hookWhitelistPda, isSigner: false, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: Buffer.concat([disc('swap_atomic_buy'), solIn.toArrayLike(Buffer, 'le', 8), new BN(0).toArrayLike(Buffer, 'le', 8)]),
    }), [mainWallet]);
    const buyerBal = await conn.getTokenAccountBalance(buyerAta);
    pass('Swap Atomic Buy', `got ${buyerBal.value.uiAmount} tokens`);
  } catch (e: any) {
    fail('Swap Atomic Buy', e.message?.slice(0, 200));
  }
  await sleep(DELAY_MS);

  // ===== 17. WAIT FOR EXPLOSION TIMER =====
  console.log(`\n⏳ Waiting ${EXPLOSION_TIMER_SECONDS + 5}s for explosion timer...`);
  await sleep((EXPLOSION_TIMER_SECONDS + 5) * 1000);

  // ===== 18. TRIGGER TIME EXPLOSION =====
  console.log('\n--- Step 17: Trigger Time Explosion ---');
  try {
    await sendTx(conn, new TransactionInstruction({
      keys: [
        { pubkey: explosionPda, isSigner: false, isWritable: true },
        { pubkey: mainWallet.publicKey, isSigner: true, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: disc('trigger_presale_explosion_time'),
    }), [mainWallet]);
    pass('Trigger Time Explosion');
  } catch (e: any) {
    fail('Trigger Time Explosion', e.message?.slice(0, 200));
    if (e.logs) { const el = e.logs.filter((l: string) => l.includes('Error') || l.includes('failed') || l.includes('Program log')); if (el.length) console.log('  Logs:', el.slice(0, 5)); }
    return;
  }
  await sleep(DELAY_MS);

  // ===== 19. UNWIND LP =====
  console.log('\n--- Step 18: Unwind LP ---');
  // Get SOL in sol_vault to pass as total_sol_extracted
  const solVaultBalance = await conn.getBalance(solVaultPda);
  console.log(`  SOL vault balance: ${solVaultBalance / LAMPORTS_PER_SOL} SOL`);
  const vaultTokenBal = await conn.getTokenAccountBalance(tokenVaultPda);
  console.log(`  Token vault balance: ${vaultTokenBal.value.uiAmount} tokens`);

  try {
    await sendTx(conn, new TransactionInstruction({
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
      data: Buffer.concat([disc('unwind_lp'), new BN(solVaultBalance).toArrayLike(Buffer, 'le', 8)]),
    }), [mainWallet]);
    const afterVaultBal = await conn.getTokenAccountBalance(tokenVaultPda);
    pass('Unwind LP', `vault tokens after burn: ${afterVaultBal.value.uiAmount}`);
  } catch (e: any) {
    fail('Unwind LP', e.message?.slice(0, 200));
    if (e.logs) { const el = e.logs.filter((l: string) => l.includes('Error') || l.includes('failed') || l.includes('custom') || l.includes('Program log')); if (el.length) console.log('  Logs:', el.slice(0, 8)); }
    return;
  }
  await sleep(DELAY_MS);

  // ===== 20. FUND PAYOUT VAULT =====
  console.log('\n--- Step 19: Fund Payout Vault ---');
  // The unwind_lp records the SOL but doesn't transfer it. We need to move SOL
  // from sol_vault to payout_vault. Since sol_vault is a PDA we can't sign for it,
  // so we fund payout_vault directly from mainWallet with the extracted amount.
  try {
    await sendTx(conn, SystemProgram.transfer({
      fromPubkey: mainWallet.publicKey,
      toPubkey: payoutVaultPda,
      lamports: solVaultBalance,
    }), [mainWallet]);
    const pvBal = await conn.getBalance(payoutVaultPda);
    pass('Fund Payout Vault', `${pvBal / LAMPORTS_PER_SOL} SOL`);
  } catch (e: any) { fail('Fund Payout Vault', e.message?.slice(0, 120)); return; }
  await sleep(DELAY_MS);

  // ===== 21. CLAIM EXPLOSION PAYOUT (winner) =====
  console.log('\n--- Step 20: Claim Explosion Payout ---');
  // Winner still has tokens in their ATA (the half they didn't deposit to vault)
  const winnerTokensBeforeClaim = await conn.getTokenAccountBalance(winnerAta);
  console.log(`  Winner tokens before claim: ${winnerTokensBeforeClaim.value.uiAmount}`);
  const winnerSolBefore = await conn.getBalance(winner.publicKey);

  try {
    await sendTx(conn, new TransactionInstruction({
      keys: [
        { pubkey: explosionPda, isSigner: false, isWritable: false },
        { pubkey: payoutPoolPda, isSigner: false, isWritable: true },
        { pubkey: payoutVaultPda, isSigner: false, isWritable: true },
        { pubkey: winnerAta, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: winner.publicKey, isSigner: true, isWritable: true },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: disc('claim_explosion_payout'),
    }), [winner]);
    const winnerSolAfter = await conn.getBalance(winner.publicKey);
    const solReceived = (winnerSolAfter - winnerSolBefore + 5000) / LAMPORTS_PER_SOL;
    const winnerTokensAfter = await conn.getTokenAccountBalance(winnerAta);
    pass('Claim Explosion Payout', `received ~${solReceived.toFixed(6)} SOL, tokens after: ${winnerTokensAfter.value.uiAmount}`);
  } catch (e: any) {
    fail('Claim Explosion Payout', e.message?.slice(0, 200));
    if (e.logs) { const el = e.logs.filter((l: string) => l.includes('Error') || l.includes('failed') || l.includes('custom') || l.includes('Program log')); if (el.length) console.log('  Logs:', el.slice(0, 8)); }
  }

  // ===== REPORT =====
  console.log('\n\n🏁 ==========================================');
  console.log('   UNWIND LP + PAYOUT E2E TEST RESULTS');
  console.log('==========================================\n');
  
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : '❌';
    console.log(`  ${icon} ${r.step}${r.detail ? ' — ' + r.detail : ''}`);
  }
  
  console.log(`\n  Total: ${results.length} | ✅ ${passed} | ❌ ${failed}`);
  console.log(`  Round ID: ${ROUND_ID}`);
  console.log(`  Mint: ${mint.toBase58()}`);
  console.log('==========================================\n');
  
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error('💥 FATAL:', err.message); process.exit(1); });
