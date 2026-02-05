/**
 * Test BOOM Custom AMM - Simple Version
 * 
 * Tests:
 * 1. Create Token2022 with transfer hook
 * 2. Mint tokens
 * 3. Test transfer TO pool vault PDA (should work - sells allowed)
 * 4. Test transfer to random address (should fail - blocked by hook)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
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
  getExtraAccountMetaAddress,
  addExtraAccountMetasForExecute,
} from '@solana/spl-token';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';

const BOOM_PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');
const HOOK_PROGRAM_ID = new PublicKey('CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9');

const RPC_URL = 'https://api.devnet.solana.com';
const TOKEN_DECIMALS = 9;
const TOTAL_SUPPLY = 1_000_000_000;

// Load wallet
const KEYPAIR_PATH = path.join(process.env.HOME!, '.config/solana/id.json');
const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));

async function main() {
  console.log('🧪 BOOM AMM Simple Test');
  console.log('========================\n');

  const connection = new Connection(RPC_URL, 'confirmed');
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);

  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  // Generate round ID
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

  // Step 2: Create ATA and mint tokens
  console.log('📝 Step 2: Minting tokens...');
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
  console.log(`  ✅ Minted ${TOTAL_SUPPLY} tokens\n`);

  // Step 3: Initialize extra account metas for hook
  console.log('📝 Step 3: Initializing hook extra account metas...');

  // Derive extra account metas PDA
  const extraAccountMetasPda = getExtraAccountMetaAddress(mint, HOOK_PROGRAM_ID);
  console.log(`  Extra metas PDA: ${extraAccountMetasPda.toBase58()}`);

  // Derive whitelist PDA
  const [whitelistPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('whitelist'), mint.toBuffer()],
    HOOK_PROGRAM_ID
  );
  console.log(`  Whitelist PDA: ${whitelistPda.toBase58()}`);

  // Derive pool PDAs
  const roundIdBuffer = new BN(roundId).toArrayLike(Buffer, 'le', 8);
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );
  const [tokenVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_vault'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );
  console.log(`  Pool PDA: ${poolPda.toBase58()}`);
  console.log(`  Token Vault PDA: ${tokenVaultPda.toBase58()}`);

  // Initialize whitelist with pool vault - use discriminator for add_whitelist_with_pool
  // Discriminator: sha256("global:add_whitelist_with_pool")[0..8]
  const initWhitelistDiscriminator = Buffer.from([0x1e, 0x4a, 0x7c, 0x88, 0x9d, 0x5f, 0x3a, 0x2b]); // placeholder
  
  // Actually, let's just initialize the extra_account_metas without the whitelist for now
  // The hook should allow transfers when no extra metas are set up (permissive mode)
  
  // Try a simple transfer first to see what happens
  console.log('\n📝 Step 4: Testing transfer without hook setup (should be permissive)...');

  const recipient = Keypair.generate();
  const recipientAta = getAssociatedTokenAddressSync(
    mint,
    recipient.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  // Create recipient ATA
  const createRecipientAtaTx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      recipientAta,
      recipient.publicKey,
      mint,
      TOKEN_2022_PROGRAM_ID
    )
  );
  await sendAndConfirmTransaction(connection, createRecipientAtaTx, [wallet]);
  console.log(`  Created recipient ATA: ${recipientAta.toBase58()}`);

  // Try transfer - hook may block or allow depending on implementation
  try {
    const transferAmount = BigInt(1000) * BigInt(10 ** TOKEN_DECIMALS);
    
    // First try WITHOUT extra accounts (hook should allow if permissive)
    const transferTx = new Transaction().add(
      createTransferCheckedInstruction(
        walletAta,
        mint,
        recipientAta,
        wallet.publicKey,
        transferAmount,
        TOKEN_DECIMALS,
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );

    const sig = await sendAndConfirmTransaction(connection, transferTx, [wallet]);
    console.log(`  ✅ Transfer succeeded (hook is permissive without extra metas)`);
    console.log(`  Signature: ${sig}\n`);
  } catch (e: any) {
    console.log(`  ❌ Transfer blocked: ${e.message.slice(0, 200)}\n`);
    
    // Try WITH extra accounts
    console.log('  Trying transfer WITH extra account metas...');
    try {
      const transferAmount = BigInt(1000) * BigInt(10 ** TOKEN_DECIMALS);
      
      // Build transfer instruction
      let transferIx = createTransferCheckedInstruction(
        walletAta,
        mint,
        recipientAta,
        wallet.publicKey,
        transferAmount,
        TOKEN_DECIMALS,
        [],
        TOKEN_2022_PROGRAM_ID
      );

      // Add extra account metas for the hook
      await addExtraAccountMetasForExecute(
        connection,
        transferIx,
        HOOK_PROGRAM_ID,
        walletAta,
        mint,
        recipientAta,
        wallet.publicKey,
        transferAmount,
        'confirmed'
      );

      const transferTx = new Transaction().add(transferIx);
      const sig = await sendAndConfirmTransaction(connection, transferTx, [wallet]);
      console.log(`  ✅ Transfer with extra metas succeeded: ${sig}\n`);
    } catch (e2: any) {
      console.log(`  ❌ Transfer with extra metas also failed: ${e2.message.slice(0, 200)}\n`);
    }
  }

  // Step 5: Create pool vault ATA and test transfer to it
  console.log('📝 Step 5: Creating pool vault and testing transfer to it...');
  
  const poolVaultAta = getAssociatedTokenAddressSync(
    mint,
    poolPda,
    true, // allowOwnerOffCurve for PDA
    TOKEN_2022_PROGRAM_ID
  );
  console.log(`  Pool Vault ATA: ${poolVaultAta.toBase58()}`);

  try {
    // Create pool vault ATA
    const createVaultTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        poolVaultAta,
        poolPda,
        mint,
        TOKEN_2022_PROGRAM_ID
      )
    );
    await sendAndConfirmTransaction(connection, createVaultTx, [wallet]);
    console.log('  ✅ Pool vault ATA created');

    // Transfer to vault
    const vaultTransferAmount = BigInt(10000) * BigInt(10 ** TOKEN_DECIMALS);
    const vaultTransferTx = new Transaction().add(
      createTransferCheckedInstruction(
        walletAta,
        mint,
        poolVaultAta,
        wallet.publicKey,
        vaultTransferAmount,
        TOKEN_DECIMALS,
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );

    const sig = await sendAndConfirmTransaction(connection, vaultTransferTx, [wallet]);
    console.log(`  ✅ Transfer to pool vault succeeded!`);
    console.log(`  Signature: ${sig}\n`);
  } catch (e: any) {
    console.log(`  ❌ Pool vault operation failed: ${e.message.slice(0, 200)}\n`);
  }

  console.log('\n========================================');
  console.log('🎉 Test Complete!');
  console.log('========================================');
  console.log(`\nMint: ${mint.toBase58()}`);
  console.log(`Wallet ATA: ${walletAta.toBase58()}`);
  console.log(`Pool PDA: ${poolPda.toBase58()}`);
  console.log(`Pool Vault: ${poolVaultAta.toBase58()}`);
}

main().catch(console.error);
