/**
 * Test Transfer Hook Functionality
 * 
 * Tests:
 * 1. Wallet-to-wallet transfer (should SUCCEED)
 */

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
  clusterApiUrl,
  TransactionInstruction
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getMint,
  getTransferHook,
  getExtraAccountMetaAddress,
  getExtraAccountMetas,
} from '@solana/spl-token';
import * as fs from 'fs';

// Our Token2022 mint from round 11
const TOKEN_MINT = new PublicKey('G7QjN4RT9y2SsjzcebqLcdhcCZHjmugtg63z7dk3BPoS');
const HOOK_PROGRAM = new PublicKey('CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9');

// Load wallet
const walletPath = process.env.HOME + '/.config/solana/id.json';
const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(secretKey));

async function testTransferHook() {
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  
  console.log('🧪 Transfer Hook Test Suite');
  console.log('===========================\n');
  console.log('Wallet:', wallet.publicKey.toBase58());
  console.log('Token Mint:', TOKEN_MINT.toBase58());
  console.log('Hook Program:', HOOK_PROGRAM.toBase58());

  // Get mint info to check transfer hook
  console.log('\n📊 Checking mint info...');
  const mintInfo = await getMint(connection, TOKEN_MINT, 'confirmed', TOKEN_2022_PROGRAM_ID);
  console.log('   Decimals:', mintInfo.decimals);
  
  // Check transfer hook extension
  const transferHook = getTransferHook(mintInfo);
  if (transferHook) {
    console.log('   Transfer Hook Program:', transferHook.programId.toBase58());
  } else {
    console.log('   ⚠️ No transfer hook found on this mint!');
  }

  // Get our token balance
  const sourceAta = getAssociatedTokenAddressSync(
    TOKEN_MINT,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  console.log('\n📊 Checking token balance...');
  try {
    const tokenAccount = await getAccount(connection, sourceAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
    console.log('   Balance:', Number(tokenAccount.amount) / 1e9, 'tokens');
  } catch (e) {
    console.log('   ❌ No token account found. Need tokens to test.');
    return;
  }

  // ==================== TEST 1: Wallet-to-Wallet Transfer ====================
  console.log('\n' + '='.repeat(50));
  console.log('TEST 1: Wallet-to-Wallet Transfer');
  console.log('='.repeat(50));
  
  // Create a fresh test wallet
  const testWallet = Keypair.generate();
  console.log('Test recipient:', testWallet.publicKey.toBase58());
  
  // Fund it with tiny SOL for rent
  console.log('Funding test wallet...');
  const fundTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: testWallet.publicKey,
      lamports: 10000000 // 0.01 SOL
    })
  );
  await sendAndConfirmTransaction(connection, fundTx, [wallet]);
  
  // Create destination ATA
  const destAta = getAssociatedTokenAddressSync(
    TOKEN_MINT,
    testWallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  
  console.log('Creating destination token account...');
  const createAtaTx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      destAta,
      testWallet.publicKey,
      TOKEN_MINT,
      TOKEN_2022_PROGRAM_ID
    )
  );
  await sendAndConfirmTransaction(connection, createAtaTx, [wallet]);
  
  // Get extra account metas for the transfer hook
  console.log('Fetching extra account metas...');
  
  // Derive the extra account metas PDA
  const [extraMetasPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('extra-account-metas'), TOKEN_MINT.toBuffer()],
    HOOK_PROGRAM
  );
  console.log('   Extra metas PDA:', extraMetasPda.toBase58());
  
  // Hook config and whitelist PDAs
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('hook_config')],
    HOOK_PROGRAM
  );
  const [whitelistPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('whitelist'), TOKEN_MINT.toBuffer()],
    HOOK_PROGRAM
  );
  
  console.log('   Config PDA:', configPda.toBase58());
  console.log('   Whitelist PDA:', whitelistPda.toBase58());

  // Transfer tokens with hook accounts
  const transferAmount = BigInt(1000000000); // 1 token (9 decimals)
  console.log('\nTransferring 1 token with hook accounts...');
  
  try {
    // Create transfer instruction with extra accounts for hook
    const transferIx = createTransferCheckedInstruction(
      sourceAta,
      TOKEN_MINT,
      destAta,
      wallet.publicKey,
      transferAmount,
      9,
      [],
      TOKEN_2022_PROGRAM_ID
    );
    
    // Add extra accounts required by transfer hook
    // The hook's Execute context expects: config, whitelist, source_token, mint, destination_token, owner, extra_metas
    transferIx.keys.push(
      { pubkey: HOOK_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: whitelistPda, isSigner: false, isWritable: false },
      { pubkey: extraMetasPda, isSigner: false, isWritable: false },
    );
    
    const transferTx = new Transaction().add(transferIx);
    
    const sig = await sendAndConfirmTransaction(connection, transferTx, [wallet]);
    console.log('✅ TEST 1 PASSED: Wallet-to-wallet transfer succeeded!');
    console.log('   Signature:', sig);
    
    // Verify the transfer
    const destAccount = await getAccount(connection, destAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
    console.log('   Destination balance:', Number(destAccount.amount) / 1e9, 'tokens');
    
  } catch (error: any) {
    console.log('❌ TEST 1 FAILED: Transfer error');
    console.log('   Error:', error.message);
    if (error.logs) {
      console.log('   Logs:');
      error.logs.forEach((log: string) => console.log('     ', log));
    }
  }

  // ==================== SUMMARY ====================
  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));
}

testTransferHook().catch(console.error);
