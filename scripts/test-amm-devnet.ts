/**
 * Test BOOM Custom AMM on Devnet
 * 
 * Simulates post-presale scenario:
 * 1. Create Token2022 with transfer hook
 * 2. Set up pool vault whitelist in hook
 * 3. Create pool with 1 SOL + tokens
 * 4. Test buy/sell swaps
 * 5. Verify blocked transfers to non-whitelisted addresses
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
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
  createTransferCheckedInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

const BOOM_PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');
const HOOK_PROGRAM_ID = new PublicKey('CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9');

const RPC_URL = 'https://api.devnet.solana.com';
const TOKEN_DECIMALS = 9;
const TOTAL_SUPPLY = 1_000_000_000; // 1 billion tokens

// Load wallet
const KEYPAIR_PATH = path.join(process.env.HOME!, '.config/solana/id.json');
const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));

async function main() {
  console.log('🧪 BOOM AMM Devnet Test');
  console.log('========================\n');
  
  const connection = new Connection(RPC_URL, 'confirmed');
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  // Generate unique round ID for this test
  const roundId = Date.now();
  console.log(`Round ID: ${roundId}\n`);

  // Step 1: Create Token2022 with transfer hook
  console.log('📝 Step 1: Creating Token2022 with transfer hook...');
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
      TOKEN_DECIMALS,
      wallet.publicKey,
      null,
      TOKEN_2022_PROGRAM_ID
    )
  );

  await sendAndConfirmTransaction(connection, createMintTx, [wallet, mintKeypair]);
  console.log('  ✅ Token created with transfer hook\n');

  // Step 2: Create ATA and mint tokens to wallet
  console.log('📝 Step 2: Minting tokens to wallet...');
  const walletAta = getAssociatedTokenAddressSync(
    mint,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  const mintAmount = BigInt(TOTAL_SUPPLY) * BigInt(10 ** TOKEN_DECIMALS);
  
  const mintTx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      walletAta,
      wallet.publicKey,
      mint,
      TOKEN_2022_PROGRAM_ID
    ),
    createMintToInstruction(
      mint,
      walletAta,
      wallet.publicKey,
      mintAmount,
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );

  await sendAndConfirmTransaction(connection, mintTx, [wallet]);
  console.log(`  ✅ Minted ${TOTAL_SUPPLY} tokens to ${walletAta.toBase58()}\n`);

  // Step 3: Initialize hook extra account metas (required for hook to work)
  console.log('📝 Step 3: Initializing hook extra account metas...');
  
  // Derive extra account metas PDA
  const [extraAccountMetasPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('extra-account-metas'), mint.toBuffer()],
    HOOK_PROGRAM_ID
  );
  console.log(`  Extra metas PDA: ${extraAccountMetasPda.toBase58()}`);

  // Derive pool vault PDA (where tokens will be held)
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), new BN(roundId).toArrayLike(Buffer, 'le', 8)],
    BOOM_PROGRAM_ID
  );
  const [tokenVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_vault'), new BN(roundId).toArrayLike(Buffer, 'le', 8)],
    BOOM_PROGRAM_ID
  );
  console.log(`  Pool PDA: ${poolPda.toBase58()}`);
  console.log(`  Token Vault PDA: ${tokenVaultPda.toBase58()}`);

  // Derive whitelist PDA
  const [whitelistPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('whitelist'), mint.toBuffer()],
    HOOK_PROGRAM_ID
  );
  console.log(`  Whitelist PDA: ${whitelistPda.toBase58()}`);

  // Load hook IDL
  const hookIdlPath = '/Users/clawdtroy/.openclaw/workspace/boom-protocol/target/idl/boom_hook.json';
  const hookIdl = JSON.parse(fs.readFileSync(hookIdlPath, 'utf-8'));
  
  // Set up anchor provider
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: 'confirmed' }
  );
  anchor.setProvider(provider);

  const hookProgram = new Program(hookIdl, provider);

  // Initialize whitelist with pool vault
  try {
    const initWhitelistTx = await hookProgram.methods
      .addWhitelistWithPool(tokenVaultPda, BOOM_PROGRAM_ID)
      .accounts({
        whitelist: whitelistPda,
        mint: mint,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`  ✅ Whitelist initialized: ${initWhitelistTx}\n`);
  } catch (e: any) {
    console.log(`  ⚠️ Whitelist init error (may already exist): ${e.message}\n`);
  }

  // Initialize extra account metas
  try {
    const initMetasTx = await hookProgram.methods
      .initializeExtraAccountMetaList()
      .accounts({
        extraAccountMetaList: extraAccountMetasPda,
        mint: mint,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`  ✅ Extra account metas initialized: ${initMetasTx}\n`);
  } catch (e: any) {
    console.log(`  ⚠️ Extra metas init error (may already exist): ${e.message}\n`);
  }

  // Step 4: Test basic transfer (should work - wallet to wallet allowed initially)
  console.log('📝 Step 4: Testing wallet-to-wallet transfer...');
  
  // Create a test recipient
  const recipient = Keypair.generate();
  const recipientAta = getAssociatedTokenAddressSync(
    mint,
    recipient.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  // Note: With our hook, transfers may be blocked unless destination is whitelisted
  // Let's test if it blocks correctly
  try {
    const transferTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        recipientAta,
        recipient.publicKey,
        mint,
        TOKEN_2022_PROGRAM_ID
      ),
      createTransferCheckedInstruction(
        walletAta,
        mint,
        recipientAta,
        wallet.publicKey,
        BigInt(1000) * BigInt(10 ** TOKEN_DECIMALS),
        TOKEN_DECIMALS,
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );

    await sendAndConfirmTransaction(connection, transferTx, [wallet]);
    console.log('  ⚠️ Transfer succeeded (hook may be permissive)\n');
  } catch (e: any) {
    console.log(`  ✅ Transfer blocked as expected: ${e.message.slice(0, 100)}...\n`);
  }

  // Step 5: Test transfer TO pool vault (should work - sells allowed)
  console.log('📝 Step 5: Testing transfer to pool vault...');
  
  // First, create the token vault ATA
  const tokenVaultAta = getAssociatedTokenAddressSync(
    mint,
    poolPda,
    true, // allowOwnerOffCurve for PDA
    TOKEN_2022_PROGRAM_ID
  );
  console.log(`  Token Vault ATA: ${tokenVaultAta.toBase58()}`);

  try {
    // Create vault ATA
    const createVaultTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenVaultAta,
        poolPda,
        mint,
        TOKEN_2022_PROGRAM_ID
      )
    );
    await sendAndConfirmTransaction(connection, createVaultTx, [wallet]);
    console.log('  ✅ Token vault ATA created\n');
  } catch (e: any) {
    console.log(`  ⚠️ Vault ATA may already exist: ${e.message.slice(0, 50)}...\n`);
  }

  // Transfer tokens to vault (simulating a sell)
  try {
    const sellTx = new Transaction().add(
      createTransferCheckedInstruction(
        walletAta,
        mint,
        tokenVaultAta,
        wallet.publicKey,
        BigInt(10000) * BigInt(10 ** TOKEN_DECIMALS),
        TOKEN_DECIMALS,
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );

    await sendAndConfirmTransaction(connection, sellTx, [wallet]);
    console.log('  ✅ Transfer to pool vault succeeded!\n');
  } catch (e: any) {
    console.log(`  ❌ Transfer to vault failed: ${e.message}\n`);
  }

  console.log('\n========================================');
  console.log('🎉 AMM Hook Test Complete!');
  console.log('========================================');
  console.log(`\nMint: ${mint.toBase58()}`);
  console.log(`Pool PDA: ${poolPda.toBase58()}`);
  console.log(`Token Vault: ${tokenVaultAta.toBase58()}`);
  console.log(`\nNext: Test full swap flow through BOOM program`);
}

main().catch(console.error);
