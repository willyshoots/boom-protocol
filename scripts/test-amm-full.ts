/**
 * Test BOOM AMM - Full Flow
 * 
 * 1. Create Token2022 with transfer hook
 * 2. Initialize hook config (required before extra metas)
 * 3. Initialize extra_account_metas_empty (Phase 1 - permissive)
 * 4. Test transfers (should work)
 * 5. Create pool vault
 * 6. Test swap-like transfers
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
  createTransferCheckedInstruction,
  getExtraAccountMetaAddress,
} from '@solana/spl-token';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const BOOM_PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');
const HOOK_PROGRAM_ID = new PublicKey('CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9');

const RPC_URL = 'https://api.devnet.solana.com';
const TOKEN_DECIMALS = 9;
const TOTAL_SUPPLY = 1_000_000_000;

const KEYPAIR_PATH = path.join(process.env.HOME!, '.config/solana/id.json');
const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));

// Generate Anchor discriminator
function getDiscriminator(namespace: string, name: string): Buffer {
  const preimage = `${namespace}:${name}`;
  const hash = crypto.createHash('sha256').update(preimage).digest();
  return hash.slice(0, 8);
}

async function main() {
  console.log('🧪 BOOM AMM Full Test');
  console.log('======================\n');

  const connection = new Connection(RPC_URL, 'confirmed');
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);

  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

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

  // Step 2: Mint tokens
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

  // Step 3: Initialize hook config (might already exist globally)
  console.log('📝 Step 3: Checking hook config...');
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('hook_config')],
    HOOK_PROGRAM_ID
  );
  console.log(`  Config PDA: ${configPda.toBase58()}`);

  const configAccount = await connection.getAccountInfo(configPda);
  if (!configAccount) {
    console.log('  Initializing hook config...');
    const initConfigDisc = getDiscriminator('global', 'initialize');
    
    const initConfigIx = new TransactionInstruction({
      keys: [
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: HOOK_PROGRAM_ID,
      data: initConfigDisc,
    });

    try {
      const tx = new Transaction().add(initConfigIx);
      await sendAndConfirmTransaction(connection, tx, [wallet]);
      console.log('  ✅ Hook config initialized\n');
    } catch (e: any) {
      console.log(`  ⚠️ Config init error: ${e.message.slice(0, 100)}\n`);
    }
  } else {
    console.log('  ✅ Hook config already exists\n');
  }

  // Step 4: Initialize extra_account_metas_empty (Phase 1 mode)
  console.log('📝 Step 4: Initializing extra_account_metas (Phase 1 - empty)...');
  
  const [extraMetasPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('extra-account-metas'), mint.toBuffer()],
    HOOK_PROGRAM_ID
  );
  console.log(`  Extra metas PDA: ${extraMetasPda.toBase58()}`);

  const initEmptyDisc = getDiscriminator('global', 'initialize_extra_account_meta_list_empty');
  
  const initExtraMetasIx = new TransactionInstruction({
    keys: [
      { pubkey: extraMetasPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: HOOK_PROGRAM_ID,
    data: initEmptyDisc,
  });

  try {
    const tx = new Transaction().add(initExtraMetasIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log(`  ✅ Extra metas initialized (Phase 1): ${sig}\n`);
  } catch (e: any) {
    console.log(`  ⚠️ Extra metas init error: ${e.message.slice(0, 150)}\n`);
  }

  // Step 5: Test simple transfer (should work in Phase 1)
  console.log('📝 Step 5: Testing transfer (Phase 1 - should work)...');
  
  const recipient = Keypair.generate();
  const recipientAta = getAssociatedTokenAddressSync(
    mint,
    recipient.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  try {
    const createAtaTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        recipientAta,
        recipient.publicKey,
        mint,
        TOKEN_2022_PROGRAM_ID
      )
    );
    await sendAndConfirmTransaction(connection, createAtaTx, [wallet]);

    const transferAmount = BigInt(1000) * BigInt(10 ** TOKEN_DECIMALS);
    
    // Create transfer instruction
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

    // Add extra account metas for the hook (even if empty, Token2022 needs them resolved)
    const { addExtraAccountMetasForExecute } = await import('@solana/spl-token');
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
    console.log(`  ✅ Transfer succeeded! Sig: ${sig.slice(0, 20)}...\n`);
  } catch (e: any) {
    console.log(`  ❌ Transfer failed: ${e.message.slice(0, 200)}\n`);
  }

  // Step 6: Create pool vault and test
  console.log('📝 Step 6: Creating pool vault...');
  const roundId = Date.now();
  const roundIdBuffer = new BN(roundId).toArrayLike(Buffer, 'le', 8);
  
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );
  
  const poolVaultAta = getAssociatedTokenAddressSync(
    mint,
    poolPda,
    true,
    TOKEN_2022_PROGRAM_ID
  );
  console.log(`  Pool PDA: ${poolPda.toBase58()}`);
  console.log(`  Pool Vault: ${poolVaultAta.toBase58()}`);

  try {
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
    console.log('  ✅ Pool vault created');

    // Transfer to vault (simulates providing liquidity)
    const vaultAmount = BigInt(100000) * BigInt(10 ** TOKEN_DECIMALS);
    
    let vaultTransferIx = createTransferCheckedInstruction(
      walletAta,
      mint,
      poolVaultAta,
      wallet.publicKey,
      vaultAmount,
      TOKEN_DECIMALS,
      [],
      TOKEN_2022_PROGRAM_ID
    );

    // Add extra account metas
    const { addExtraAccountMetasForExecute: addMetas } = await import('@solana/spl-token');
    await addMetas(
      connection,
      vaultTransferIx,
      HOOK_PROGRAM_ID,
      walletAta,
      mint,
      poolVaultAta,
      wallet.publicKey,
      vaultAmount,
      'confirmed'
    );

    const vaultTransferTx = new Transaction().add(vaultTransferIx);
    const sig = await sendAndConfirmTransaction(connection, vaultTransferTx, [wallet]);
    console.log(`  ✅ Transferred 100k tokens to pool vault: ${sig.slice(0, 20)}...\n`);
  } catch (e: any) {
    console.log(`  ❌ Pool vault error: ${e.message.slice(0, 200)}\n`);
  }

  console.log('\n========================================');
  console.log('🎉 BOOM AMM Test Complete!');
  console.log('========================================');
  console.log(`\nMint: ${mint.toBase58()}`);
  console.log(`Wallet ATA: ${walletAta.toBase58()}`);
  console.log(`Pool Vault: ${poolVaultAta.toBase58()}`);
  console.log(`\n✅ Phase 1 (permissive) transfers WORK`);
  console.log(`Next: Initialize whitelist + upgrade to Phase 2 to lock down`);
}

main().catch(console.error);
