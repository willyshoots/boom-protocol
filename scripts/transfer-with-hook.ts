/**
 * Direct transfer with hook accounts to pool vault
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
} from '@solana/spl-token';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const BOOM_PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');
const HOOK_PROGRAM_ID = new PublicKey('CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9');
const RPC_URL = 'https://api.devnet.solana.com';
const ROUND_ID = 4;
const MINT = new PublicKey('7uey6Ef1hrFFQboP6gh72Mxrvb6Bgk5FY1hFr7sDDKRX');

const KEYPAIR_PATH = path.join(process.env.HOME!, '.config/solana/id.json');
const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));

function getDiscriminator(namespace: string, name: string): Buffer {
  const preimage = `${namespace}:${name}`;
  return crypto.createHash('sha256').update(preimage).digest().slice(0, 8);
}

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  
  console.log('💸 Direct Transfer with Hook to Pool Vault');
  console.log('==========================================\n');

  const roundIdBN = new BN(ROUND_ID);
  const roundIdBuffer = roundIdBN.toArrayLike(Buffer, 'le', 8);
  
  const [tokenVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_vault'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );
  const [solVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('sol_vault'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );
  
  // Hook PDAs
  const [extraMetasPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('extra-account-metas'), MINT.toBuffer()],
    HOOK_PROGRAM_ID
  );
  const [hookConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('hook_config')],
    HOOK_PROGRAM_ID
  );
  const [whitelistPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('whitelist'), MINT.toBuffer()],
    HOOK_PROGRAM_ID
  );
  
  const walletAta = getAssociatedTokenAddressSync(
    MINT,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  console.log('Source:', walletAta.toBase58());
  console.log('Destination:', tokenVaultPda.toBase58());
  console.log('Hook Config:', hookConfigPda.toBase58());
  console.log('Extra Metas:', extraMetasPda.toBase58());

  // Amount to transfer: 5M tokens
  const amount = BigInt(5_000_000) * BigInt(10 ** 9);

  // Create transfer with hook accounts
  // Token2022 transfer_checked with hooks needs:
  // source, mint, dest, authority + extra accounts for hook
  
  const transferIx = createTransferCheckedInstruction(
    walletAta,          // source
    MINT,               // mint
    tokenVaultPda,      // destination
    wallet.publicKey,   // owner
    amount,             // amount
    9,                  // decimals
    [],                 // signers
    TOKEN_2022_PROGRAM_ID
  );

  // Add hook accounts manually
  // For transfer hook execution, Token2022 expects extra accounts after the standard ones:
  // - extra_account_metas PDA
  // - hook program
  // - any accounts referenced by extra_account_metas (config, whitelist)
  transferIx.keys.push(
    { pubkey: extraMetasPda, isSigner: false, isWritable: false },
    { pubkey: HOOK_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: hookConfigPda, isSigner: false, isWritable: false },
    { pubkey: whitelistPda, isSigner: false, isWritable: false },
  );

  try {
    const tx = new Transaction().add(transferIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log('\n✅ Transfer complete:', sig);
  } catch (e: any) {
    console.log('\n❌ Transfer failed:', e.message);
    if (e.logs) {
      console.log('Logs:', e.logs.slice(-8));
    }
    return;
  }

  // Sync pool reserves
  console.log('\n📝 Syncing pool reserves...');
  const syncDisc = getDiscriminator('global', 'sync_pool_reserves');
  
  const { TransactionInstruction } = await import('@solana/web3.js');
  const syncIx = new TransactionInstruction({
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: tokenVaultPda, isSigner: false, isWritable: false },
      { pubkey: solVaultPda, isSigner: false, isWritable: false },
    ],
    programId: BOOM_PROGRAM_ID,
    data: syncDisc,
  });

  const tx2 = new Transaction().add(syncIx);
  await sendAndConfirmTransaction(connection, tx2, [wallet]);
  console.log('✅ Synced');

  // Check final state
  const poolInfo = await connection.getAccountInfo(poolPda);
  if (poolInfo) {
    const data = poolInfo.data.slice(8);
    const solReserve = new BN(data.slice(104, 112), 'le');
    const tokenReserve = new BN(data.slice(112, 120), 'le');
    
    console.log('\n📊 Pool State:');
    console.log('  SOL:', solReserve.toNumber() / LAMPORTS_PER_SOL, 'SOL');
    console.log('  Tokens:', tokenReserve.toNumber() / 1e9);
    
    if (tokenReserve.toNumber() > 0) {
      const price = solReserve.toNumber() / tokenReserve.toNumber();
      console.log('  Price:', price.toExponential(4), 'SOL/token');
    }
  }
}

main().catch(console.error);
