/**
 * Initialize Extra Account Metas for Transfer Hook
 * 
 * This creates the ExtraAccountMetaList account that Token2022 needs
 * to know which additional accounts to pass to our hook's execute function.
 */

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  clusterApiUrl,
  SystemProgram
} from '@solana/web3.js';
import {
  ExtraAccountMetaList,
  ExtraAccountMeta,
  resolveExtraAccountMeta,
  ExtraAccountMetaAccountDataLayout
} from '@solana/spl-token';
import * as fs from 'fs';

const HOOK_PROGRAM = new PublicKey('CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9');
const TOKEN_MINT = new PublicKey('G7QjN4RT9y2SsjzcebqLcdhcCZHjmugtg63z7dk3BPoS');

// Load wallet
const walletPath = process.env.HOME + '/.config/solana/id.json';
const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(secretKey));

async function initExtraMetas() {
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  
  console.log('🔧 Initializing Extra Account Metas for Transfer Hook');
  console.log('=====================================================\n');
  console.log('Hook Program:', HOOK_PROGRAM.toBase58());
  console.log('Token Mint:', TOKEN_MINT.toBase58());
  console.log('Authority:', wallet.publicKey.toBase58());

  // Derive the extra account metas PDA (standard seeds per transfer hook interface)
  const [extraMetasPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('extra-account-metas'), TOKEN_MINT.toBuffer()],
    HOOK_PROGRAM
  );
  console.log('\nExtra Metas PDA:', extraMetasPda.toBase58());

  // Check if already exists
  const existing = await connection.getAccountInfo(extraMetasPda);
  if (existing) {
    console.log('✅ Extra account metas already initialized!');
    console.log('   Data length:', existing.data.length);
    return;
  }

  // Derive the PDAs for config and whitelist that the hook needs
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('hook_config')],
    HOOK_PROGRAM
  );
  
  const [whitelistPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('whitelist'), TOKEN_MINT.toBuffer()],
    HOOK_PROGRAM
  );

  console.log('Config PDA:', configPda.toBase58());
  console.log('Whitelist PDA:', whitelistPda.toBase58());

  // The execute context needs these extra accounts in order:
  // 1. config (seeds: ["hook_config"])
  // 2. whitelist (seeds: ["whitelist", mint])
  
  // Create ExtraAccountMeta entries
  // For PDA accounts, we use the seeds format
  const extraMetas: ExtraAccountMeta[] = [
    // Config PDA - seeds: [b"hook_config"], program: HOOK_PROGRAM
    {
      discriminator: 1, // PDA
      addressConfig: Buffer.alloc(32), // seeds will be encoded
      isSigner: false,
      isWritable: false,
    },
    // Whitelist PDA - seeds: [b"whitelist", mint], program: HOOK_PROGRAM  
    {
      discriminator: 1, // PDA
      addressConfig: Buffer.alloc(32),
      isSigner: false,
      isWritable: false,
    },
  ];

  // Calculate space needed
  // ExtraAccountMetaList: 4 bytes (length) + 35 bytes per entry
  const numExtraAccounts = 2;
  const accountSize = ExtraAccountMetaAccountDataLayout.span + numExtraAccounts * 35;
  
  console.log('\n📊 Account size:', accountSize, 'bytes');
  
  // Get rent
  const rent = await connection.getMinimumBalanceForRentExemption(accountSize);
  console.log('Rent:', rent / 1e9, 'SOL');

  // Build the initialize instruction
  // The hook program needs an initialize_extra_account_meta_list instruction
  // If it doesn't have one, we need to create the account manually
  
  // Check if the hook has such an instruction by trying to call it
  // For now, let's try creating the account with proper data format
  
  // Build extra account meta data manually
  // Format: [u32 length][ExtraAccountMeta entries...]
  const metaBuffer = Buffer.alloc(accountSize);
  
  // Write length (2 entries)
  metaBuffer.writeUInt32LE(2, 0);
  
  // Entry 1: Config PDA
  // discriminator (1 byte): 1 = PDA
  // addressConfig (32 bytes): seeds configuration  
  // isSigner (1 byte): 0
  // isWritable (1 byte): 0
  let offset = 4;
  
  // For config: literal PDA address
  metaBuffer.writeUInt8(0, offset); // discriminator 0 = literal address
  configPda.toBuffer().copy(metaBuffer, offset + 1);
  metaBuffer.writeUInt8(0, offset + 33); // isSigner
  metaBuffer.writeUInt8(0, offset + 34); // isWritable
  offset += 35;
  
  // Entry 2: Whitelist PDA (also literal since we know it)
  metaBuffer.writeUInt8(0, offset); // discriminator 0 = literal
  whitelistPda.toBuffer().copy(metaBuffer, offset + 1);
  metaBuffer.writeUInt8(0, offset + 33); // isSigner
  metaBuffer.writeUInt8(0, offset + 34); // isWritable
  
  console.log('\n📝 Creating extra account metas account...');
  
  // Create account
  const createIx = SystemProgram.createAccount({
    fromPubkey: wallet.publicKey,
    newAccountPubkey: extraMetasPda,
    lamports: rent,
    space: accountSize,
    programId: HOOK_PROGRAM,
  });
  
  // The problem is we can't use createAccount for a PDA...
  // We need the hook program to have an initialize instruction
  
  // Let's try using a CPI approach - call the hook program with an init instruction
  // Actually, the standard approach is for the hook program to have:
  // initialize_extra_account_meta_list(ctx, extra_account_metas: Vec<ExtraAccountMeta>)
  
  // Since our hook doesn't have this, we need to add it to the program
  // For now, let's just document what's needed
  
  console.log('\n⚠️ The hook program needs an initialize_extra_account_meta_list instruction!');
  console.log('This instruction creates the ExtraAccountMetaList PDA that Token2022 requires.');
  console.log('\nRequired changes to boom-hook/src/lib.rs:');
  console.log('1. Add spl_tlv_account_resolution dependency');
  console.log('2. Add InitializeExtraAccountMetaList instruction');
  console.log('3. Redeploy hook program');
  
  // Let me try calling a hypothetical init instruction anyway
  // The standard discriminator for this is from spl_transfer_hook_interface
  // Sighash: sha256("spl-transfer-hook-interface:initialize-extra-account-metas")[0..8]
  
  const initDiscriminator = Buffer.from([
    43, 34, 13, 49, 167, 88, 235, 235  // Standard discriminator
  ]);
  
  const initData = Buffer.concat([
    initDiscriminator,
    // empty vec<ExtraAccountMeta> for now
    Buffer.from([0, 0, 0, 0]) // vec length = 0
  ]);
  
  const initIx = new TransactionInstruction({
    programId: HOOK_PROGRAM,
    keys: [
      { pubkey: extraMetasPda, isSigner: false, isWritable: true },
      { pubkey: TOKEN_MINT, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: initData,
  });
  
  try {
    const tx = new Transaction().add(initIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log('✅ Extra account metas initialized!');
    console.log('   Signature:', sig);
  } catch (err: any) {
    console.log('\n❌ Init failed:', err.message);
    if (err.logs) {
      console.log('Logs:', err.logs.slice(-5));
    }
    console.log('\nThe hook program needs to implement the SPL transfer-hook-interface.');
    console.log('Adding this to the program now...');
  }
}

initExtraMetas().catch(console.error);
