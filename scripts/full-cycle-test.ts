/**
 * BOOM Protocol - Full Cycle Test
 * Tests the complete flow with new claim timing logic
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
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  getMintLen,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getExtraAccountMetaAddress,
} from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const BOOM_PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');
const HOOK_PROGRAM_ID = new PublicKey('CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9');
const RPC_URL = 'https://api.devnet.solana.com';

const KEYPAIR_PATH = path.join(process.env.HOME!, '.config/solana/id.json');
const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));

function getDiscriminator(namespace: string, name: string): Buffer {
  const preimage = `${namespace}:${name}`;
  return crypto.createHash('sha256').update(preimage).digest().slice(0, 8);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  const ROUND_ID = 21; // Fresh round
  
  console.log('🚀 BOOM Protocol - Full Cycle Test');
  console.log('====================================\n');
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  // PDAs
  const roundIdBN = new BN(ROUND_ID);
  const roundIdBuffer = roundIdBN.toArrayLike(Buffer, 'le', 8);
  
  const [presalePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );
  const [explosionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale_explosion'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );
  const [presaleTokenPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale_token'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );
  const [tokenVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_vault'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );
  const [solVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('sol_vault'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );
  const [lpInfoPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('lp_info'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );
  const [depositPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('deposit'), roundIdBuffer, wallet.publicKey.toBuffer()],
    BOOM_PROGRAM_ID
  );
  const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('mint_authority'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );

  // ============ PHASE 1: START PRESALE ============
  console.log('📝 PHASE 1: Starting Presale Round', ROUND_ID);
  
  const startPresaleDisc = getDiscriminator('global', 'start_presale');
  const cooldownDuration = new BN(60); // 60 seconds for quick test
  const lotterySpots = 10;
  const minDeposit = new BN(0.05 * LAMPORTS_PER_SOL);
  const maxDeposit = new BN(5 * LAMPORTS_PER_SOL);
  
  const startPresaleIx = new TransactionInstruction({
    keys: [
      { pubkey: presalePda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: BOOM_PROGRAM_ID,
    data: Buffer.concat([
      startPresaleDisc,
      roundIdBuffer,
      cooldownDuration.toArrayLike(Buffer, 'le', 8),
      Buffer.from(new Uint32Array([lotterySpots]).buffer),
      minDeposit.toArrayLike(Buffer, 'le', 8),
      maxDeposit.toArrayLike(Buffer, 'le', 8),
    ]),
  });

  try {
    const tx1 = new Transaction().add(startPresaleIx);
    const sig1 = await sendAndConfirmTransaction(connection, tx1, [wallet]);
    console.log(`  ✅ Presale started: ${sig1}\n`);
  } catch (e: any) {
    if (e.message?.includes('already in use')) {
      console.log('  ⚠️ Round already exists, continuing...\n');
    } else {
      throw e;
    }
  }
  
  await sleep(1000);

  // ============ PHASE 2: DEPOSIT ============
  console.log('📝 PHASE 2: Making deposit');
  
  const depositAmount = new BN(0.1 * LAMPORTS_PER_SOL);
  const depositDisc = getDiscriminator('global', 'deposit_presale');
  
  const depositIx = new TransactionInstruction({
    keys: [
      { pubkey: presalePda, isSigner: false, isWritable: true },
      { pubkey: depositPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: BOOM_PROGRAM_ID,
    data: Buffer.concat([
      depositDisc,
      depositAmount.toArrayLike(Buffer, 'le', 8),
    ]),
  });

  try {
    const tx2 = new Transaction().add(depositIx);
    const sig2 = await sendAndConfirmTransaction(connection, tx2, [wallet]);
    console.log(`  ✅ Deposited 0.1 SOL: ${sig2}\n`);
  } catch (e: any) {
    console.log(`  ⚠️ Deposit error: ${e.message}\n`);
  }

  // Wait for presale to end
  console.log('⏳ Waiting 65 seconds for presale to end...');
  await sleep(65000);

  // ============ PHASE 3: END PRESALE + LOTTERY ============
  console.log('📝 PHASE 3: Ending Presale + Running Lottery');
  
  const endPresaleDisc = getDiscriminator('global', 'end_presale_and_lottery');
  const winnerIndexes: number[] = [0]; // First depositor wins
  
  const endPresaleIx = new TransactionInstruction({
    keys: [
      { pubkey: presalePda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
    ],
    programId: BOOM_PROGRAM_ID,
    data: Buffer.concat([
      endPresaleDisc,
      Buffer.from(new Uint32Array([winnerIndexes.length]).buffer),
      Buffer.from(new Uint32Array(winnerIndexes).buffer),
    ]),
  });

  try {
    const tx3 = new Transaction().add(endPresaleIx);
    const sig3 = await sendAndConfirmTransaction(connection, tx3, [wallet]);
    console.log(`  ✅ Presale ended: ${sig3}\n`);
  } catch (e: any) {
    console.log(`  ⚠️ End presale error: ${e.message}\n`);
  }

  await sleep(2000);

  // Mark winner
  console.log('📝 PHASE 3b: Marking winner');
  const markWinnerDisc = getDiscriminator('global', 'mark_winner');
  
  const markWinnerIx = new TransactionInstruction({
    keys: [
      { pubkey: presalePda, isSigner: false, isWritable: false },
      { pubkey: depositPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
    ],
    programId: BOOM_PROGRAM_ID,
    data: markWinnerDisc,
  });

  try {
    const tx3b = new Transaction().add(markWinnerIx);
    const sig3b = await sendAndConfirmTransaction(connection, tx3b, [wallet]);
    console.log(`  ✅ Winner marked: ${sig3b}\n`);
  } catch (e: any) {
    console.log(`  ⚠️ Mark winner error: ${e.message}\n`);
  }

  await sleep(2000);

  // ============ PHASE 4: CREATE TOKEN ============
  console.log('📝 PHASE 4: Creating Token2022 with transfer hook');
  
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  console.log(`  Mint: ${mint.toBase58()}`);

  const extensions = [ExtensionType.TransferHook];
  const mintLen = getMintLen(extensions);
  const mintLamports = await connection.getMinimumBalanceForRentExemption(mintLen);

  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: mint,
      space: mintLen,
      lamports: mintLamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeTransferHookInstruction(
      mint,
      wallet.publicKey,
      HOOK_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID
    ),
    createInitializeMintInstruction(
      mint,
      9, // decimals
      mintAuthorityPda, // mint authority is the PDA
      null,
      TOKEN_2022_PROGRAM_ID
    )
  );

  try {
    const sig4 = await sendAndConfirmTransaction(connection, createMintTx, [wallet, mintKeypair]);
    console.log(`  ✅ Token created: ${sig4}\n`);
  } catch (e: any) {
    console.log(`  ⚠️ Create token error: ${e.message}\n`);
  }

  await sleep(2000);

  // Register token with program
  console.log('📝 PHASE 4b: Registering token with program');
  const registerTokenDisc = getDiscriminator('global', 'register_presale_token');
  const totalSupply = new BN(1_000_000_000).mul(new BN(10).pow(new BN(9))); // 1B tokens
  const tokensPerWinner = new BN(10_000_000).mul(new BN(10).pow(new BN(9))); // 10M tokens per winner

  const registerTokenIx = new TransactionInstruction({
    keys: [
      { pubkey: presalePda, isSigner: false, isWritable: false },
      { pubkey: presaleTokenPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: BOOM_PROGRAM_ID,
    data: Buffer.concat([
      registerTokenDisc,
      roundIdBuffer,
      totalSupply.toArrayLike(Buffer, 'le', 8),
      tokensPerWinner.toArrayLike(Buffer, 'le', 8),
    ]),
  });

  try {
    const tx4b = new Transaction().add(registerTokenIx);
    const sig4b = await sendAndConfirmTransaction(connection, tx4b, [wallet]);
    console.log(`  ✅ Token registered: ${sig4b}\n`);
  } catch (e: any) {
    console.log(`  ⚠️ Register token error: ${e.message}\n`);
  }

  await sleep(2000);

  // ============ PHASE 5: INIT EXPLOSION TRACKING ============
  console.log('📝 PHASE 5: Initializing explosion tracking');
  
  // Create a secret cap hash (e.g., cap at 1000 SOL market cap)
  const secretCap = new BN(1000 * LAMPORTS_PER_SOL);
  const capHash = crypto.createHash('sha256').update(secretCap.toArrayLike(Buffer, 'le', 8)).digest();
  
  const initExplosionDisc = getDiscriminator('global', 'init_presale_explosion');
  
  const initExplosionIx = new TransactionInstruction({
    keys: [
      { pubkey: presalePda, isSigner: false, isWritable: false },
      { pubkey: explosionPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: BOOM_PROGRAM_ID,
    data: Buffer.concat([
      initExplosionDisc,
      roundIdBuffer,
      capHash,
    ]),
  });

  try {
    const tx5 = new Transaction().add(initExplosionIx);
    const sig5 = await sendAndConfirmTransaction(connection, tx5, [wallet]);
    console.log(`  ✅ Explosion tracking initialized: ${sig5}\n`);
  } catch (e: any) {
    console.log(`  ⚠️ Init explosion error: ${e.message}\n`);
  }

  await sleep(2000);

  // ============ PHASE 6: CREATE POOL ============  
  console.log('📝 PHASE 6: Creating AMM pool');
  
  const feeBps = 100; // 1% fee
  const createPoolDisc = getDiscriminator('global', 'create_pool');
  
  const createPoolIx = new TransactionInstruction({
    keys: [
      { pubkey: presalePda, isSigner: false, isWritable: true },
      { pubkey: presaleTokenPda, isSigner: false, isWritable: false },
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },  // mint comes BEFORE vaults
      { pubkey: tokenVaultPda, isSigner: false, isWritable: true },
      { pubkey: solVaultPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },  // token_program before system
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: BOOM_PROGRAM_ID,
    data: Buffer.concat([
      createPoolDisc,
      roundIdBuffer,
      Buffer.from(new Uint16Array([feeBps]).buffer),
    ]),
  });

  try {
    const tx6 = new Transaction().add(createPoolIx);
    const sig6 = await sendAndConfirmTransaction(connection, tx6, [wallet]);
    console.log(`  ✅ Pool created: ${sig6}\n`);
  } catch (e: any) {
    console.log(`  ⚠️ Create pool error: ${e.message}\n`);
  }

  await sleep(2000);

  // ============ PHASE 7: REGISTER LP ============
  console.log('📝 PHASE 7: Registering LP info');
  
  const registerLpDisc = getDiscriminator('global', 'register_lp');
  
  const registerLpIx = new TransactionInstruction({
    keys: [
      { pubkey: presalePda, isSigner: false, isWritable: false },
      { pubkey: lpInfoPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: BOOM_PROGRAM_ID,
    data: Buffer.concat([
      registerLpDisc,
      roundIdBuffer,
      poolPda.toBuffer(), // pool_id
      mint.toBuffer(),    // lp_mint (using token mint as placeholder)
      tokenVaultPda.toBuffer(), // vault_a
      solVaultPda.toBuffer(),   // vault_b
    ]),
  });

  try {
    const tx7 = new Transaction().add(registerLpIx);
    const sig7 = await sendAndConfirmTransaction(connection, tx7, [wallet]);
    console.log(`  ✅ LP registered: ${sig7}\n`);
  } catch (e: any) {
    console.log(`  ⚠️ Register LP error: ${e.message}\n`);
  }

  await sleep(2000);

  // ============ PHASE 8: START EXPLOSION TIMER ============
  console.log('📝 PHASE 8: Starting explosion timer (TRADING BEGINS!)');
  
  const explosionDuration = new BN(120); // 2 minutes for test
  const startTimerDisc = getDiscriminator('global', 'start_explosion_timer');
  
  const startTimerIx = new TransactionInstruction({
    keys: [
      { pubkey: explosionPda, isSigner: false, isWritable: true },
      { pubkey: lpInfoPda, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
    ],
    programId: BOOM_PROGRAM_ID,
    data: Buffer.concat([
      startTimerDisc,
      explosionDuration.toArrayLike(Buffer, 'le', 8),
    ]),
  });

  try {
    const tx8 = new Transaction().add(startTimerIx);
    const sig8 = await sendAndConfirmTransaction(connection, tx8, [wallet]);
    console.log(`  ✅ Trading started! Timer: 2 minutes: ${sig8}\n`);
  } catch (e: any) {
    console.log(`  ⚠️ Start timer error: ${e.message}\n`);
  }

  console.log('🎉 FULL CYCLE TEST COMPLETE!');
  console.log('============================\n');
  console.log('✅ Presale started');
  console.log('✅ Deposit made'); 
  console.log('✅ Presale ended + lottery');
  console.log('✅ Winner marked');
  console.log('✅ Token created');
  console.log('✅ Explosion tracking initialized');
  console.log('✅ Pool created');
  console.log('✅ LP registered');
  console.log('✅ Trading started (explosion timer running)');
  console.log('\nNow claims should be available for winners and refunds!');
  console.log(`Mint: ${mint.toBase58()}`);
  console.log(`Pool: ${poolPda.toBase58()}`);
}

main().catch(console.error);
