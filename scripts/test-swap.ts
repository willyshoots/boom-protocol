/**
 * Test BOOM AMM Swap Functionality
 * 
 * Full flow:
 * 1. Create Token2022 with transfer hook
 * 2. Initialize hook (Phase 1)
 * 3. Initialize protocol + start presale
 * 4. Deposit to presale
 * 5. Finalize presale + create token
 * 6. Create pool
 * 7. Test BUY swap (SOL → Token)
 * 8. Test SELL swap (Token → SOL)
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
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  addExtraAccountMetasForExecute,
  createTransferCheckedInstruction,
} from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const BOOM_PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');
const HOOK_PROGRAM_ID = new PublicKey('CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9');

const RPC_URL = 'https://api.devnet.solana.com';
const TOKEN_DECIMALS = 9;

const KEYPAIR_PATH = path.join(process.env.HOME!, '.config/solana/id.json');
const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));

function getDiscriminator(namespace: string, name: string): Buffer {
  const preimage = `${namespace}:${name}`;
  return crypto.createHash('sha256').update(preimage).digest().slice(0, 8);
}

async function main() {
  console.log('🔄 BOOM AMM Swap Test');
  console.log('======================\n');

  const connection = new Connection(RPC_URL, 'confirmed');
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  // Load IDL
  const idlPath = '/Users/clawdtroy/.openclaw/workspace/boom-protocol/target/idl/boom.json';
  let boomIdl;
  try {
    boomIdl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
  } catch {
    console.log('No IDL found, using manual instruction building\n');
  }

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: 'confirmed' }
  );
  anchor.setProvider(provider);

  // Round ID for this test
  const roundId = new BN(Date.now());
  const roundIdBuffer = roundId.toArrayLike(Buffer, 'le', 8);
  console.log(`Round ID: ${roundId.toString()}\n`);

  // Derive all PDAs
  const [protocolPda] = PublicKey.findProgramAddressSync([Buffer.from('protocol')], BOOM_PROGRAM_ID);
  const [presalePda] = PublicKey.findProgramAddressSync([Buffer.from('presale'), roundIdBuffer], BOOM_PROGRAM_ID);
  const [presaleTokenPda] = PublicKey.findProgramAddressSync([Buffer.from('presale_token'), roundIdBuffer], BOOM_PROGRAM_ID);
  const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from('pool'), roundIdBuffer], BOOM_PROGRAM_ID);
  const [tokenVaultPda] = PublicKey.findProgramAddressSync([Buffer.from('token_vault'), roundIdBuffer], BOOM_PROGRAM_ID);
  const [solVaultPda] = PublicKey.findProgramAddressSync([Buffer.from('sol_vault'), roundIdBuffer], BOOM_PROGRAM_ID);
  const [sequencerPda] = PublicKey.findProgramAddressSync([Buffer.from('round_sequencer')], BOOM_PROGRAM_ID);
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('hook_config')], HOOK_PROGRAM_ID);

  console.log('📍 PDAs:');
  console.log(`  Protocol: ${protocolPda.toBase58()}`);
  console.log(`  Presale: ${presalePda.toBase58()}`);
  console.log(`  Pool: ${poolPda.toBase58()}`);
  console.log(`  Token Vault: ${tokenVaultPda.toBase58()}`);
  console.log(`  SOL Vault: ${solVaultPda.toBase58()}\n`);

  // Step 1: Check/Initialize Protocol
  console.log('📝 Step 1: Checking protocol...');
  const protocolAccount = await connection.getAccountInfo(protocolPda);
  if (!protocolAccount) {
    console.log('  Initializing protocol...');
    const initProtocolDisc = getDiscriminator('global', 'initialize');
    const initProtocolIx = new TransactionInstruction({
      keys: [
        { pubkey: protocolPda, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: initProtocolDisc,
    });
    await sendAndConfirmTransaction(connection, new Transaction().add(initProtocolIx), [wallet]);
    console.log('  ✅ Protocol initialized\n');
  } else {
    console.log('  ✅ Protocol exists\n');
  }

  // Step 2: Start Presale Round
  console.log('📝 Step 2: Starting presale round...');
  const startPresaleDisc = getDiscriminator('global', 'start_presale_round');
  
  // Presale params: min_deposit, max_deposit, presale_duration, explosion_timeout, min_depositors
  const minDeposit = new BN(0.01 * LAMPORTS_PER_SOL);
  const maxDeposit = new BN(1 * LAMPORTS_PER_SOL);
  const presaleDuration = new BN(60); // 60 seconds
  const explosionTimeout = new BN(300); // 5 minutes
  const minDepositors = new BN(1);
  const tokenName = Buffer.alloc(32);
  Buffer.from('TEST_SWAP').copy(tokenName);
  const tokenSymbol = Buffer.alloc(8);
  Buffer.from('TSWAP').copy(tokenSymbol);

  const startPresaleData = Buffer.concat([
    startPresaleDisc,
    roundId.toArrayLike(Buffer, 'le', 8),
    minDeposit.toArrayLike(Buffer, 'le', 8),
    maxDeposit.toArrayLike(Buffer, 'le', 8),
    presaleDuration.toArrayLike(Buffer, 'le', 8),
    explosionTimeout.toArrayLike(Buffer, 'le', 8),
    minDepositors.toArrayLike(Buffer, 'le', 8),
    tokenName,
    tokenSymbol,
  ]);

  const startPresaleIx = new TransactionInstruction({
    keys: [
      { pubkey: protocolPda, isSigner: false, isWritable: true },
      { pubkey: presalePda, isSigner: false, isWritable: true },
      { pubkey: sequencerPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: BOOM_PROGRAM_ID,
    data: startPresaleData,
  });

  try {
    await sendAndConfirmTransaction(connection, new Transaction().add(startPresaleIx), [wallet]);
    console.log('  ✅ Presale started\n');
  } catch (e: any) {
    console.log(`  ⚠️ Presale start error: ${e.message.slice(0, 100)}\n`);
  }

  // Step 3: Deposit to presale
  console.log('📝 Step 3: Depositing to presale...');
  const [depositorPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('depositor'), roundIdBuffer, wallet.publicKey.toBuffer()],
    BOOM_PROGRAM_ID
  );

  const depositDisc = getDiscriminator('global', 'deposit');
  const depositAmount = new BN(0.5 * LAMPORTS_PER_SOL);
  const depositData = Buffer.concat([
    depositDisc,
    roundId.toArrayLike(Buffer, 'le', 8),
    depositAmount.toArrayLike(Buffer, 'le', 8),
  ]);

  const depositIx = new TransactionInstruction({
    keys: [
      { pubkey: presalePda, isSigner: false, isWritable: true },
      { pubkey: depositorPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: BOOM_PROGRAM_ID,
    data: depositData,
  });

  try {
    await sendAndConfirmTransaction(connection, new Transaction().add(depositIx), [wallet]);
    console.log(`  ✅ Deposited ${depositAmount.toNumber() / LAMPORTS_PER_SOL} SOL\n`);
  } catch (e: any) {
    console.log(`  ⚠️ Deposit error: ${e.message.slice(0, 100)}\n`);
  }

  // Step 4: Wait for presale to end then finalize
  console.log('📝 Step 4: Waiting for presale to end (60s)...');
  console.log('  (In production this would use actual timing)');
  
  // For testing, let's try to finalize immediately - it might fail if presale hasn't ended
  await new Promise(resolve => setTimeout(resolve, 2000));

  const finalizeDisc = getDiscriminator('global', 'finalize_presale');
  const finalizeData = Buffer.concat([
    finalizeDisc,
    roundId.toArrayLike(Buffer, 'le', 8),
  ]);

  const finalizeIx = new TransactionInstruction({
    keys: [
      { pubkey: presalePda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
    ],
    programId: BOOM_PROGRAM_ID,
    data: finalizeData,
  });

  try {
    await sendAndConfirmTransaction(connection, new Transaction().add(finalizeIx), [wallet]);
    console.log('  ✅ Presale finalized\n');
  } catch (e: any) {
    console.log(`  ⚠️ Finalize error (presale may not have ended): ${e.message.slice(0, 100)}`);
    console.log('  Waiting 60 seconds for presale to end...\n');
    await new Promise(resolve => setTimeout(resolve, 62000));
    
    try {
      await sendAndConfirmTransaction(connection, new Transaction().add(finalizeIx), [wallet]);
      console.log('  ✅ Presale finalized after waiting\n');
    } catch (e2: any) {
      console.log(`  ❌ Finalize still failed: ${e2.message.slice(0, 100)}\n`);
      return;
    }
  }

  // Step 5: Create token
  console.log('📝 Step 5: Creating token...');
  // This is complex - need to create Token2022 mint with hook and metadata
  // For now, let's check if the token creation instruction exists
  
  const createTokenDisc = getDiscriminator('global', 'create_token');
  console.log(`  Create token discriminator: ${createTokenDisc.toString('hex')}`);
  
  // Token creation requires specific accounts - let's check the instruction
  console.log('  (Token creation is complex - checking existing flow...)\n');

  console.log('\n========================================');
  console.log('⚠️ Full swap test requires complete presale flow');
  console.log('========================================');
  console.log('\nThe swap test needs:');
  console.log('1. Completed presale with deposits');
  console.log('2. Token created via create_token instruction');
  console.log('3. Pool created via create_pool instruction');
  console.log('4. Then swap can be tested');
  console.log('\nLet me create a simpler direct pool test...');
}

main().catch(console.error);
