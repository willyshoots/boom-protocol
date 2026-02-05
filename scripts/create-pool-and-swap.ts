/**
 * Create Pool and Test Swaps
 * 
 * Uses the presale from round 263787 that already completed
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

function getDiscriminator(name: string): Buffer {
  return crypto.createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

async function main() {
  console.log('🏊 Create Pool & Test Swaps');
  console.log('============================\n');

  const connection = new Connection(RPC_URL, 'confirmed');
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  // Use the existing presale round
  const roundId = 263787;
  const roundIdBN = new BN(roundId);
  const roundIdBuffer = roundIdBN.toArrayLike(Buffer, 'le', 8);
  
  // The test mint from earlier (wallet is authority)
  const testMint = new PublicKey('7czMRppoDbxqsAku9qQWncJ26u675JcCvTQoTN76NFXF');
  
  console.log(`Round ID: ${roundId}`);
  console.log(`Test Mint: ${testMint.toBase58()}\n`);

  // Derive all PDAs
  const [presalePda] = PublicKey.findProgramAddressSync([Buffer.from('presale'), roundIdBuffer], BOOM_PROGRAM_ID);
  const [presaleTokenPda] = PublicKey.findProgramAddressSync([Buffer.from('presale_token'), roundIdBuffer], BOOM_PROGRAM_ID);
  const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from('pool'), roundIdBuffer], BOOM_PROGRAM_ID);
  const [tokenVaultPda] = PublicKey.findProgramAddressSync([Buffer.from('token_vault'), roundIdBuffer], BOOM_PROGRAM_ID);
  const [solVaultPda] = PublicKey.findProgramAddressSync([Buffer.from('sol_vault'), roundIdBuffer], BOOM_PROGRAM_ID);
  const [lpInfoPda] = PublicKey.findProgramAddressSync([Buffer.from('lp_info'), roundIdBuffer], BOOM_PROGRAM_ID);

  console.log('📍 PDAs:');
  console.log(`  Presale: ${presalePda.toBase58()}`);
  console.log(`  Presale Token: ${presaleTokenPda.toBase58()}`);
  console.log(`  Pool: ${poolPda.toBase58()}`);
  console.log(`  Token Vault: ${tokenVaultPda.toBase58()}`);
  console.log(`  SOL Vault: ${solVaultPda.toBase58()}\n`);

  // Check if presale exists and is finalized
  const presaleAccount = await connection.getAccountInfo(presalePda);
  if (!presaleAccount) {
    console.log('❌ Presale account not found');
    return;
  }
  console.log('✅ Presale account exists\n');

  // Check if pool already exists
  const poolAccount = await connection.getAccountInfo(poolPda);
  if (poolAccount) {
    console.log('✅ Pool already exists, skipping creation\n');
  } else {
    // Step 1: Create token vault ATA
    console.log('📝 Step 1: Creating token vault ATA...');
    const tokenVaultAta = getAssociatedTokenAddressSync(testMint, poolPda, true, TOKEN_2022_PROGRAM_ID);
    console.log(`  Token Vault ATA: ${tokenVaultAta.toBase58()}`);

    try {
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(
          createAssociatedTokenAccountInstruction(wallet.publicKey, tokenVaultAta, poolPda, testMint, TOKEN_2022_PROGRAM_ID)
        ),
        [wallet]
      );
      console.log('  ✅ Token vault ATA created\n');
    } catch (e: any) {
      if (e.message.includes('already in use')) {
        console.log('  ✅ Token vault ATA already exists\n');
      } else {
        console.log(`  ⚠️ Error: ${e.message.slice(0, 100)}\n`);
      }
    }

    // Step 2: Deposit tokens to vault (need tokens in vault before pool creation)
    console.log('📝 Step 2: Depositing tokens to vault...');
    const walletAta = getAssociatedTokenAddressSync(testMint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const tokenVaultAta2 = getAssociatedTokenAddressSync(testMint, poolPda, true, TOKEN_2022_PROGRAM_ID);
    
    // Check wallet token balance
    const walletTokenBalance = await connection.getTokenAccountBalance(walletAta);
    console.log(`  Wallet token balance: ${walletTokenBalance.value.uiAmount}`);

    const tokensForPool = BigInt(500_000_000) * BigInt(10 ** TOKEN_DECIMALS);
    
    // Get extra metas PDA
    const [extraMetasPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('extra-account-metas'), testMint.toBuffer()],
      HOOK_PROGRAM_ID
    );

    try {
      let transferIx = createTransferCheckedInstruction(
        walletAta, testMint, tokenVaultAta2, wallet.publicKey,
        tokensForPool, TOKEN_DECIMALS, [], TOKEN_2022_PROGRAM_ID
      );

      await addExtraAccountMetasForExecute(
        connection, transferIx, HOOK_PROGRAM_ID,
        walletAta, testMint, tokenVaultAta2, wallet.publicKey, tokensForPool, 'confirmed'
      );

      await sendAndConfirmTransaction(connection, new Transaction().add(transferIx), [wallet]);
      console.log(`  ✅ Deposited 500M tokens to vault\n`);
    } catch (e: any) {
      console.log(`  ⚠️ Token deposit error: ${e.message.slice(0, 150)}\n`);
    }

    // Step 3: Call create_pool
    console.log('📝 Step 3: Creating pool...');
    const createPoolDisc = getDiscriminator('create_pool');
    const feeBps = new BN(50); // 0.5%

    const createPoolData = Buffer.concat([
      createPoolDisc,
      roundIdBN.toArrayLike(Buffer, 'le', 8),
      feeBps.toArrayLike(Buffer, 'le', 2),
    ]);

    const createPoolIx = new TransactionInstruction({
      programId: BOOM_PROGRAM_ID,
      keys: [
        { pubkey: presalePda, isSigner: false, isWritable: true },
        { pubkey: presaleTokenPda, isSigner: false, isWritable: false },
        { pubkey: poolPda, isSigner: false, isWritable: true },
        { pubkey: testMint, isSigner: false, isWritable: false },
        { pubkey: tokenVaultAta2, isSigner: false, isWritable: true },
        { pubkey: solVaultPda, isSigner: false, isWritable: true },
        { pubkey: lpInfoPda, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: createPoolData,
    });

    try {
      const sig = await sendAndConfirmTransaction(connection, new Transaction().add(createPoolIx), [wallet]);
      console.log(`  ✅ Pool created: ${sig.slice(0, 30)}...\n`);
    } catch (e: any) {
      console.log(`  ❌ Pool creation failed: ${e.message.slice(0, 200)}`);
      if (e.logs) {
        console.log('  Logs:', e.logs.slice(-5));
      }
      console.log('\n');
    }
  }

  // Step 4: Test swap (buy)
  console.log('📝 Step 4: Testing BUY swap (SOL → Token)...');
  
  const swapDisc = getDiscriminator('swap');
  const buyAmount = new BN(0.01 * LAMPORTS_PER_SOL); // 0.01 SOL
  const minOut = new BN(0); // Accept any output for test
  const isBuy = true;

  const tokenVaultAta = getAssociatedTokenAddressSync(testMint, poolPda, true, TOKEN_2022_PROGRAM_ID);
  const walletAta = getAssociatedTokenAddressSync(testMint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);

  const swapData = Buffer.concat([
    swapDisc,
    buyAmount.toArrayLike(Buffer, 'le', 8),
    minOut.toArrayLike(Buffer, 'le', 8),
    Buffer.from([isBuy ? 1 : 0]),
  ]);

  const swapIx = new TransactionInstruction({
    programId: BOOM_PROGRAM_ID,
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: testMint, isSigner: false, isWritable: false },
      { pubkey: tokenVaultAta, isSigner: false, isWritable: true },
      { pubkey: solVaultPda, isSigner: false, isWritable: true },
      { pubkey: walletAta, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: swapData,
  });

  try {
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(swapIx), [wallet]);
    console.log(`  ✅ BUY swap succeeded: ${sig.slice(0, 30)}...\n`);
  } catch (e: any) {
    console.log(`  ❌ BUY swap failed: ${e.message.slice(0, 200)}`);
    if (e.logs) {
      console.log('  Logs:', e.logs.slice(-5));
    }
    console.log('\n');
  }

  // Step 5: Test swap (sell)
  console.log('📝 Step 5: Testing SELL swap (Token → SOL)...');
  
  const sellAmount = new BN(1000 * 10 ** TOKEN_DECIMALS); // 1000 tokens
  const minSolOut = new BN(0);
  const isSell = false;

  const sellSwapData = Buffer.concat([
    swapDisc,
    sellAmount.toArrayLike(Buffer, 'le', 8),
    minSolOut.toArrayLike(Buffer, 'le', 8),
    Buffer.from([isSell ? 1 : 0]),
  ]);

  const sellSwapIx = new TransactionInstruction({
    programId: BOOM_PROGRAM_ID,
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: testMint, isSigner: false, isWritable: false },
      { pubkey: tokenVaultAta, isSigner: false, isWritable: true },
      { pubkey: solVaultPda, isSigner: false, isWritable: true },
      { pubkey: walletAta, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: sellSwapData,
  });

  try {
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(sellSwapIx), [wallet]);
    console.log(`  ✅ SELL swap succeeded: ${sig.slice(0, 30)}...\n`);
  } catch (e: any) {
    console.log(`  ❌ SELL swap failed: ${e.message.slice(0, 200)}`);
    if (e.logs) {
      console.log('  Logs:', e.logs.slice(-5));
    }
    console.log('\n');
  }

  console.log('========================================');
  console.log('🎉 Pool & Swap Test Complete!');
  console.log('========================================');
}

main().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
