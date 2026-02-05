/**
 * Quick E2E Test - Fresh presale → pool → swap
 * Uses 10 second presale for fast testing
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
  getMintLen,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  createInitializeMetadataPointerInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  addExtraAccountMetasForExecute,
  createTransferCheckedInstruction,
} from '@solana/spl-token';
// Note: tokenMetadataInitializeWithRentTransfer is imported dynamically below
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
  console.log('⚡ Quick E2E Test');
  console.log('==================\n');

  const connection = new Connection(RPC_URL, 'confirmed');
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  const roundId = Date.now();
  const roundIdBN = new BN(roundId);
  const roundIdBuffer = roundIdBN.toArrayLike(Buffer, 'le', 8);
  console.log(`Round ID: ${roundId}\n`);

  // Derive PDAs
  const [protocolPda] = PublicKey.findProgramAddressSync([Buffer.from('protocol')], BOOM_PROGRAM_ID);
  const [presalePda] = PublicKey.findProgramAddressSync([Buffer.from('presale'), roundIdBuffer], BOOM_PROGRAM_ID);
  const [sequencerPda] = PublicKey.findProgramAddressSync([Buffer.from('round_sequencer')], BOOM_PROGRAM_ID);
  const [depositorPda] = PublicKey.findProgramAddressSync([Buffer.from('depositor'), roundIdBuffer, wallet.publicKey.toBuffer()], BOOM_PROGRAM_ID);
  const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from('pool'), roundIdBuffer], BOOM_PROGRAM_ID);
  const [tokenVaultPda] = PublicKey.findProgramAddressSync([Buffer.from('token_vault'), roundIdBuffer], BOOM_PROGRAM_ID);
  const [solVaultPda] = PublicKey.findProgramAddressSync([Buffer.from('sol_vault'), roundIdBuffer], BOOM_PROGRAM_ID);
  const [presaleTokenPda] = PublicKey.findProgramAddressSync([Buffer.from('presale_token'), roundIdBuffer], BOOM_PROGRAM_ID);
  const [mintAuthorityPda] = PublicKey.findProgramAddressSync([Buffer.from('mint_authority'), roundIdBuffer], BOOM_PROGRAM_ID);

  // === STEP 1: Start Presale (10 second duration) ===
  console.log('📝 Step 1: Starting presale (10s duration)...');
  
  const startPresaleDisc = getDiscriminator('start_presale');
  const cooldownDuration = new BN(10); // 10 seconds!
  const lotterySpots = 1; // 1 winner
  const minDeposit = new BN(0.01 * LAMPORTS_PER_SOL);
  const maxDeposit = new BN(1 * LAMPORTS_PER_SOL);

  const startPresaleData = Buffer.concat([
    startPresaleDisc,
    roundIdBN.toArrayLike(Buffer, 'le', 8),         // round_id: u64
    cooldownDuration.toArrayLike(Buffer, 'le', 8),  // cooldown_duration: i64
    Buffer.from(new Uint32Array([lotterySpots]).buffer), // lottery_spots: u32
    minDeposit.toArrayLike(Buffer, 'le', 8),        // min_deposit: u64
    maxDeposit.toArrayLike(Buffer, 'le', 8),        // max_deposit: u64
  ]);

  const startPresaleIx = new TransactionInstruction({
    programId: BOOM_PROGRAM_ID,
    keys: [
      { pubkey: presalePda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: startPresaleData,
  });

  try {
    await sendAndConfirmTransaction(connection, new Transaction().add(startPresaleIx), [wallet]);
    console.log('  ✅ Presale started\n');
  } catch (e: any) {
    console.log(`  ❌ Start presale failed: ${e.message.slice(0, 150)}\n`);
    return;
  }

  // === STEP 2: Deposit ===
  console.log('📝 Step 2: Depositing 0.1 SOL...');
  
  // Derive user deposit PDA with correct seeds
  const [userDepositPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('deposit'), roundIdBuffer, wallet.publicKey.toBuffer()],
    BOOM_PROGRAM_ID
  );
  
  const depositDisc = getDiscriminator('deposit_presale');
  const depositAmount = new BN(0.1 * LAMPORTS_PER_SOL);
  
  const depositData = Buffer.concat([
    depositDisc,
    depositAmount.toArrayLike(Buffer, 'le', 8),
  ]);

  const depositIx = new TransactionInstruction({
    programId: BOOM_PROGRAM_ID,
    keys: [
      { pubkey: presalePda, isSigner: false, isWritable: true },
      { pubkey: userDepositPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: depositData,
  });

  try {
    await sendAndConfirmTransaction(connection, new Transaction().add(depositIx), [wallet]);
    console.log('  ✅ Deposited\n');
  } catch (e: any) {
    console.log(`  ❌ Deposit failed: ${e.message.slice(0, 150)}\n`);
    return;
  }

  // === STEP 3: Wait for presale to end ===
  console.log('⏳ Waiting 12 seconds for presale to end...');
  await new Promise(r => setTimeout(r, 12000));
  console.log('  Done waiting\n');

  // === STEP 4: End presale / finalize ===
  console.log('📝 Step 4: Finalizing presale...');
  
  const finalizeDisc = getDiscriminator('end_presale_and_lottery');
  const winnerIndices = Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]); // Vec<u32> with 1 element: [0]
  
  const finalizeData = Buffer.concat([
    finalizeDisc,
    Buffer.from([1, 0, 0, 0]), // vec length = 1
    Buffer.from([0, 0, 0, 0]), // winner index 0
  ]);

  const finalizeIx = new TransactionInstruction({
    programId: BOOM_PROGRAM_ID,
    keys: [
      { pubkey: presalePda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
    ],
    data: finalizeData,
  });

  try {
    await sendAndConfirmTransaction(connection, new Transaction().add(finalizeIx), [wallet]);
    console.log('  ✅ Presale finalized\n');
  } catch (e: any) {
    console.log(`  ⚠️ Finalize error: ${e.message.slice(0, 150)}\n`);
  }

  // === STEP 5: Create Token2022 with hook + metadata ===
  console.log('📝 Step 5: Creating Token2022 with transfer hook + metadata...');
  
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  console.log(`  Mint: ${mint.toBase58()}`);

  // Token metadata
  const tokenName = `BOOM Round ${roundId}`;
  const tokenSymbol = 'BOOM';
  const tokenUri = ''; // Could add IPFS URI for token image later

  // Calculate mint account size with fixed extensions only
  // TokenMetadata will be added via reallocate after mint init
  const mintLen = getMintLen([ExtensionType.TransferHook, ExtensionType.MetadataPointer]);
  const mintRent = await connection.getMinimumBalanceForRentExemption(mintLen);

  console.log(`  Name: ${tokenName}`);
  console.log(`  Symbol: ${tokenSymbol}`);
  console.log(`  Account size: ${mintLen} bytes (before metadata)`);

  // Step 5a: Create mint account with MetadataPointer + TransferHook + Mint
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: mint,
        space: mintLen,
        lamports: mintRent,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeMetadataPointerInstruction(mint, wallet.publicKey, mint, TOKEN_2022_PROGRAM_ID),
      createInitializeTransferHookInstruction(mint, wallet.publicKey, HOOK_PROGRAM_ID, TOKEN_2022_PROGRAM_ID),
      createInitializeMintInstruction(mint, TOKEN_DECIMALS, wallet.publicKey, wallet.publicKey, TOKEN_2022_PROGRAM_ID)
    ),
    [wallet, mintKeypair]
  );
  console.log('  ✅ Token created');

  // Step 5b: Initialize metadata with rent transfer (auto-reallocates account)
  // tokenMetadataInitializeWithRentTransfer handles reallocation for us
  const { tokenMetadataInitializeWithRentTransfer } = await import('@solana/spl-token');
  await tokenMetadataInitializeWithRentTransfer(
    connection,
    wallet,
    mint,
    wallet.publicKey,  // updateAuthority
    wallet.publicKey,  // mintAuthority
    tokenName,
    tokenSymbol,
    tokenUri,
    [],  // multiSigners
    { commitment: 'confirmed' },
    TOKEN_2022_PROGRAM_ID
  );
  console.log('  ✅ Metadata initialized\n');

  // Init hook extra metas
  const [extraMetasPda] = PublicKey.findProgramAddressSync([Buffer.from('extra-account-metas'), mint.toBuffer()], HOOK_PROGRAM_ID);
  
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      new TransactionInstruction({
        programId: HOOK_PROGRAM_ID,
        keys: [
          { pubkey: extraMetasPda, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: getDiscriminator('initialize_extra_account_meta_list_empty'),
      })
    ),
    [wallet]
  );
  console.log('  ✅ Hook extra metas initialized\n');

  // === STEP 6: Register presale token ===
  console.log('📝 Step 6: Registering presale token...');
  
  const totalSupply = new BN(1_000_000_000).mul(new BN(10 ** TOKEN_DECIMALS));
  const tokensPerWinner = totalSupply.div(new BN(10));

  const registerTokenData = Buffer.concat([
    getDiscriminator('register_presale_token'),
    roundIdBN.toArrayLike(Buffer, 'le', 8),
    totalSupply.toArrayLike(Buffer, 'le', 8),
    tokensPerWinner.toArrayLike(Buffer, 'le', 8),
  ]);

  const registerTokenIx = new TransactionInstruction({
    programId: BOOM_PROGRAM_ID,
    keys: [
      { pubkey: presalePda, isSigner: false, isWritable: false },
      { pubkey: presaleTokenPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: registerTokenData,
  });

  try {
    await sendAndConfirmTransaction(connection, new Transaction().add(registerTokenIx), [wallet]);
    console.log('  ✅ Token registered\n');
  } catch (e: any) {
    console.log(`  ⚠️ Register error: ${e.message.slice(0, 150)}\n`);
  }

  // === STEP 7: Mint tokens and transfer to vault ===
  console.log('📝 Step 7: Minting tokens...');
  
  const walletAta = getAssociatedTokenAddressSync(mint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const totalSupplyBigInt = BigInt(1_000_000_000) * BigInt(10 ** TOKEN_DECIMALS);

  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      createAssociatedTokenAccountInstruction(wallet.publicKey, walletAta, wallet.publicKey, mint, TOKEN_2022_PROGRAM_ID),
      createMintToInstruction(mint, walletAta, wallet.publicKey, totalSupplyBigInt, [], TOKEN_2022_PROGRAM_ID)
    ),
    [wallet]
  );
  console.log('  ✅ Minted 1B tokens\n');

  // === STEP 8: Create Pool ===
  console.log('📝 Step 8: Creating pool...');

  const createPoolDisc = getDiscriminator('create_pool');
  const feeBps = new BN(50);

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
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: tokenVaultPda, isSigner: false, isWritable: true },
      { pubkey: solVaultPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: createPoolData,
  });

  try {
    await sendAndConfirmTransaction(connection, new Transaction().add(createPoolIx), [wallet]);
    console.log('  ✅ Pool created\n');
  } catch (e: any) {
    console.log(`  ❌ Pool creation failed: ${e.message.slice(0, 200)}`);
    if (e.logs) console.log('  Logs:', e.logs.slice(-5));
    console.log('');
    return;
  }

  // === STEP 9: Test SWAP ===
  console.log('📝 Step 9: Testing swap...');
  
  // First, deposit tokens to the vault via direct transfer (with hook accounts)
  const tokensForPool = BigInt(500_000_000) * BigInt(10 ** TOKEN_DECIMALS);
  
  let tokenDepositIx = createTransferCheckedInstruction(
    walletAta, mint, tokenVaultPda, wallet.publicKey,
    tokensForPool, TOKEN_DECIMALS, [], TOKEN_2022_PROGRAM_ID
  );

  // Add hook extra accounts
  await addExtraAccountMetasForExecute(
    connection, tokenDepositIx, HOOK_PROGRAM_ID,
    walletAta, mint, tokenVaultPda, wallet.publicKey, tokensForPool, 'confirmed'
  );

  try {
    await sendAndConfirmTransaction(connection, new Transaction().add(tokenDepositIx), [wallet]);
    console.log('  ✅ Deposited 500M tokens to pool vault');
    
    // Sync pool reserves
    const syncDisc = getDiscriminator('sync_pool_reserves');
    const syncIx = new TransactionInstruction({
      programId: BOOM_PROGRAM_ID,
      keys: [
        { pubkey: poolPda, isSigner: false, isWritable: true },
        { pubkey: tokenVaultPda, isSigner: false, isWritable: false },
        { pubkey: solVaultPda, isSigner: false, isWritable: false },
      ],
      data: syncDisc,
    });
    await sendAndConfirmTransaction(connection, new Transaction().add(syncIx), [wallet]);
    console.log('  ✅ Pool reserves synced\n');
  } catch (e: any) {
    console.log(`  ⚠️ Token deposit: ${e.message.slice(0, 150)}`);
    if (e.logs) console.log('  Logs:', e.logs.slice(-3));
    console.log('');
  }

  // Now try swap - include hook accounts
  const swapDisc = getDiscriminator('swap');
  const swapAmount = new BN(0.01 * LAMPORTS_PER_SOL);
  const minOut = new BN(0);

  const swapData = Buffer.concat([
    swapDisc,
    swapAmount.toArrayLike(Buffer, 'le', 8),
    minOut.toArrayLike(Buffer, 'le', 8),
    Buffer.from([1]), // is_buy = true
  ]);

  // Derive hook accounts (using existing extraMetasPda from step 5)
  const [hookConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('hook_config')],
    HOOK_PROGRAM_ID
  );
  const [hookWhitelistPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('whitelist'), mint.toBuffer()],
    HOOK_PROGRAM_ID
  );
  // extraMetasPda was already derived in step 5

  const swapIx = new TransactionInstruction({
    programId: BOOM_PROGRAM_ID,
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: tokenVaultPda, isSigner: false, isWritable: true },
      { pubkey: solVaultPda, isSigner: false, isWritable: true },
      { pubkey: walletAta, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      // Hook accounts
      { pubkey: HOOK_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: extraMetasPda, isSigner: false, isWritable: false },
      { pubkey: hookConfigPda, isSigner: false, isWritable: false },
      { pubkey: hookWhitelistPda, isSigner: false, isWritable: false },
    ],
    data: swapData,
  });

  try {
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(swapIx), [wallet]);
    console.log(`  🎉 SWAP SUCCEEDED: ${sig.slice(0, 40)}...\n`);
  } catch (e: any) {
    console.log(`  ❌ Swap failed: ${e.message.slice(0, 200)}`);
    if (e.logs) console.log('  Logs:', e.logs.slice(-8));
    console.log('');
  }

  console.log('========================================');
  console.log('⚡ Quick E2E Test Complete!');
  console.log('========================================');
}

main().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
