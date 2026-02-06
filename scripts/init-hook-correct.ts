/**
 * Initialize hook extra metas with correct accounts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
} from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const HOOK_PROGRAM_ID = new PublicKey('CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9');
const RPC_URL = 'https://api.devnet.solana.com';
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
  
  console.log('🔧 Initializing Hook Extra Account Metas');
  console.log('==========================================\n');
  console.log('Mint:', MINT.toBase58());

  // PDA with hook program seeds: ["extra-account-metas", mint]
  const [extraMetasPda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('extra-account-metas'), MINT.toBuffer()],
    HOOK_PROGRAM_ID
  );
  console.log('Extra Metas PDA (hook seeds):', extraMetasPda.toBase58());

  // Check if it exists
  const info = await connection.getAccountInfo(extraMetasPda);
  if (info) {
    console.log('✅ Already initialized!');
    return;
  }

  console.log('\n📝 Initializing with initialize_extra_account_meta_list_empty...');
  
  const disc = getDiscriminator('global', 'initialize_extra_account_meta_list_empty');
  
  // Accounts: extra_account_metas, mint, payer, system_program
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: extraMetasPda, isSigner: false, isWritable: true },
      { pubkey: MINT, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: HOOK_PROGRAM_ID,
    data: disc,
  });

  try {
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log('✅ Initialized:', sig);
  } catch (e: any) {
    console.log('❌ Error:', e.message);
    if (e.logs) console.log('Logs:', e.logs.slice(-5));
  }

  // Verify
  const info2 = await connection.getAccountInfo(extraMetasPda);
  console.log('\nFinal check - exists:', info2 ? '✅' : '❌');
}

main().catch(console.error);
