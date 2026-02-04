/**
 * Initialize Extra Account Metas for Transfer Hook (simplified)
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
import * as fs from 'fs';
import { createHash } from 'crypto';

const HOOK_PROGRAM = new PublicKey('CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9');
const TOKEN_MINT = new PublicKey('G7QjN4RT9y2SsjzcebqLcdhcCZHjmugtg63z7dk3BPoS');

const walletPath = process.env.HOME + '/.config/solana/id.json';
const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(secretKey));

function getDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

async function main() {
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  
  console.log('🔧 Initializing Extra Account Metas');
  console.log('====================================\n');
  console.log('Hook Program:', HOOK_PROGRAM.toBase58());
  console.log('Token Mint:', TOKEN_MINT.toBase58());

  // Derive the extra account metas PDA
  const [extraMetasPda, extraMetasBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('extra-account-metas'), TOKEN_MINT.toBuffer()],
    HOOK_PROGRAM
  );
  console.log('Extra Metas PDA:', extraMetasPda.toBase58());

  // Check if exists
  const existing = await connection.getAccountInfo(extraMetasPda);
  if (existing) {
    console.log('✅ Already initialized!');
    return;
  }

  // Build instruction
  const data = getDiscriminator('initialize_extra_account_meta_list');

  const ix = new TransactionInstruction({
    programId: HOOK_PROGRAM,
    keys: [
      { pubkey: extraMetasPda, isSigner: false, isWritable: true },
      { pubkey: TOKEN_MINT, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  console.log('\n📝 Sending transaction...');
  
  try {
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log('✅ Extra account metas initialized!');
    console.log('   Signature:', sig);
  } catch (err: any) {
    console.error('❌ Error:', err.message);
    if (err.logs) {
      console.error('Logs:', err.logs.slice(-10));
    }
  }
}

main().catch(console.error);
