/**
 * Test Phase 2 Lockdown
 * 
 * After Phase 1 (permissive), upgrade to Phase 2:
 * 1. Create whitelist with pool vault
 * 2. Upgrade extra_account_metas to include config + whitelist
 * 3. Test transfer to pool vault (should work)
 * 4. Test transfer to random address (should fail)
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
  addExtraAccountMetasForExecute,
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

function getDiscriminator(namespace: string, name: string): Buffer {
  const preimage = `${namespace}:${name}`;
  const hash = crypto.createHash('sha256').update(preimage).digest();
  return hash.slice(0, 8);
}

async function main() {
  console.log('🔒 BOOM AMM Phase 2 Lockdown Test');
  console.log('==================================\n');

  const connection = new Connection(RPC_URL, 'confirmed');
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  const roundId = Date.now();
  const roundIdBuffer = new BN(roundId).toArrayLike(Buffer, 'le', 8);

  // Step 1: Create token with hook
  console.log('📝 Step 1: Creating Token2022 with transfer hook...');
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  console.log(`  Mint: ${mint.toBase58()}`);

  const mintLen = getMintLen([ExtensionType.TransferHook]);
  const mintLamports = await connection.getMinimumBalanceForRentExemption(mintLen);

  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: mint,
        space: mintLen,
        lamports: mintLamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferHookInstruction(mint, wallet.publicKey, HOOK_PROGRAM_ID, TOKEN_2022_PROGRAM_ID),
      createInitializeMintInstruction(mint, TOKEN_DECIMALS, wallet.publicKey, null, TOKEN_2022_PROGRAM_ID)
    ),
    [wallet, mintKeypair]
  );
  console.log('  ✅ Token created\n');

  // Step 2: Mint tokens
  console.log('📝 Step 2: Minting tokens...');
  const walletAta = getAssociatedTokenAddressSync(mint, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const mintAmount = BigInt(TOTAL_SUPPLY) * BigInt(10 ** TOKEN_DECIMALS);

  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      createAssociatedTokenAccountInstruction(wallet.publicKey, walletAta, wallet.publicKey, mint, TOKEN_2022_PROGRAM_ID),
      createMintToInstruction(mint, walletAta, wallet.publicKey, mintAmount, [], TOKEN_2022_PROGRAM_ID)
    ),
    [wallet]
  );
  console.log('  ✅ Minted tokens\n');

  // Step 3: Create pool vault
  console.log('📝 Step 3: Creating pool vault...');
  const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from('pool'), roundIdBuffer], BOOM_PROGRAM_ID);
  const poolVaultAta = getAssociatedTokenAddressSync(mint, poolPda, true, TOKEN_2022_PROGRAM_ID);
  console.log(`  Pool PDA: ${poolPda.toBase58()}`);
  console.log(`  Pool Vault: ${poolVaultAta.toBase58()}`);

  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      createAssociatedTokenAccountInstruction(wallet.publicKey, poolVaultAta, poolPda, mint, TOKEN_2022_PROGRAM_ID)
    ),
    [wallet]
  );
  console.log('  ✅ Pool vault created\n');

  // Step 4: Initialize whitelist with pool vault
  console.log('📝 Step 4: Initializing whitelist with pool vault...');
  const [whitelistPda] = PublicKey.findProgramAddressSync([Buffer.from('whitelist'), mint.toBuffer()], HOOK_PROGRAM_ID);
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from('hook_config')], HOOK_PROGRAM_ID);
  console.log(`  Whitelist PDA: ${whitelistPda.toBase58()}`);

  const addWhitelistDisc = getDiscriminator('global', 'add_whitelist_with_pool');
  const addWhitelistIx = new TransactionInstruction({
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: false },  // config - required!
      { pubkey: whitelistPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: HOOK_PROGRAM_ID,
    data: Buffer.concat([
      addWhitelistDisc,
      poolVaultAta.toBuffer(),  // pool_token_vault
      BOOM_PROGRAM_ID.toBuffer(), // boom_program
    ]),
  });

  try {
    await sendAndConfirmTransaction(connection, new Transaction().add(addWhitelistIx), [wallet]);
    console.log('  ✅ Whitelist created with pool vault\n');
  } catch (e: any) {
    console.log(`  ⚠️ Whitelist error: ${e.message.slice(0, 150)}\n`);
  }

  // Step 5: Initialize extra_account_metas (Phase 2 - with config + whitelist)
  console.log('📝 Step 5: Initializing extra_account_metas (Phase 2 - lockdown)...');
  const [extraMetasPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('extra-account-metas'), mint.toBuffer()],
    HOOK_PROGRAM_ID
  );
  console.log(`  Extra metas PDA: ${extraMetasPda.toBase58()}`);

  const initMetasDisc = getDiscriminator('global', 'initialize_extra_account_meta_list');
  const initMetasIx = new TransactionInstruction({
    keys: [
      { pubkey: extraMetasPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: HOOK_PROGRAM_ID,
    data: initMetasDisc,
  });

  try {
    await sendAndConfirmTransaction(connection, new Transaction().add(initMetasIx), [wallet]);
    console.log('  ✅ Extra metas initialized (Phase 2)\n');
  } catch (e: any) {
    console.log(`  ⚠️ Extra metas error: ${e.message.slice(0, 150)}\n`);
  }

  // Step 6: Test transfer TO pool vault (should work - whitelisted)
  console.log('📝 Step 6: Testing transfer TO pool vault (should SUCCEED)...');
  try {
    const transferAmount = BigInt(10000) * BigInt(10 ** TOKEN_DECIMALS);
    let transferIx = createTransferCheckedInstruction(
      walletAta, mint, poolVaultAta, wallet.publicKey,
      transferAmount, TOKEN_DECIMALS, [], TOKEN_2022_PROGRAM_ID
    );

    await addExtraAccountMetasForExecute(
      connection, transferIx, HOOK_PROGRAM_ID,
      walletAta, mint, poolVaultAta, wallet.publicKey, transferAmount, 'confirmed'
    );

    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(transferIx), [wallet]);
    console.log(`  ✅ Transfer to pool vault SUCCEEDED: ${sig.slice(0, 20)}...\n`);
  } catch (e: any) {
    console.log(`  ❌ Transfer to pool vault FAILED: ${e.message.slice(0, 200)}\n`);
  }

  // Step 7: Test transfer to RANDOM address (should FAIL - not whitelisted)
  console.log('📝 Step 7: Testing transfer to random address (should FAIL)...');
  const randomRecipient = Keypair.generate();
  const randomAta = getAssociatedTokenAddressSync(mint, randomRecipient.publicKey, false, TOKEN_2022_PROGRAM_ID);

  try {
    // Create random ATA first
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        createAssociatedTokenAccountInstruction(wallet.publicKey, randomAta, randomRecipient.publicKey, mint, TOKEN_2022_PROGRAM_ID)
      ),
      [wallet]
    );

    const transferAmount = BigInt(1000) * BigInt(10 ** TOKEN_DECIMALS);
    let transferIx = createTransferCheckedInstruction(
      walletAta, mint, randomAta, wallet.publicKey,
      transferAmount, TOKEN_DECIMALS, [], TOKEN_2022_PROGRAM_ID
    );

    await addExtraAccountMetasForExecute(
      connection, transferIx, HOOK_PROGRAM_ID,
      walletAta, mint, randomAta, wallet.publicKey, transferAmount, 'confirmed'
    );

    await sendAndConfirmTransaction(connection, new Transaction().add(transferIx), [wallet]);
    console.log(`  ⚠️ Transfer to random address SUCCEEDED (hook not blocking!)\n`);
  } catch (e: any) {
    if (e.message.includes('custom program error') || e.message.includes('NotWhitelisted') || e.message.includes('blocked')) {
      console.log(`  ✅ Transfer to random address BLOCKED as expected!\n`);
    } else {
      console.log(`  ❌ Transfer failed with unexpected error: ${e.message.slice(0, 150)}\n`);
    }
  }

  console.log('\n========================================');
  console.log('🔒 Phase 2 Lockdown Test Complete!');
  console.log('========================================');
  console.log(`\nMint: ${mint.toBase58()}`);
  console.log(`Pool Vault: ${poolVaultAta.toBase58()}`);
}

main().catch(console.error);
