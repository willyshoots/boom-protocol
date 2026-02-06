/**
 * Check and init hook for mint
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
import { TOKEN_2022_PROGRAM_ID, getExtraAccountMetaAddress } from '@solana/spl-token';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const BOOM_PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');
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
  
  console.log('🔍 Checking hook setup for mint:', MINT.toBase58());
  console.log('================================================\n');

  // Get extra account metas PDA
  const extraAccountMetasPda = getExtraAccountMetaAddress(MINT, HOOK_PROGRAM_ID);
  console.log('Extra Account Metas PDA:', extraAccountMetasPda.toBase58());

  // Hook config PDA
  const [hookConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('hook_config')],
    HOOK_PROGRAM_ID
  );
  console.log('Hook Config PDA:', hookConfigPda.toBase58());

  // Check if extra account metas exists
  const extraMetasInfo = await connection.getAccountInfo(extraAccountMetasPda);
  console.log('\nExtra Account Metas exists:', extraMetasInfo ? '✅ YES' : '❌ NO');

  // Check hook config
  const hookConfigInfo = await connection.getAccountInfo(hookConfigPda);
  console.log('Hook Config exists:', hookConfigInfo ? '✅ YES' : '❌ NO');

  if (!extraMetasInfo) {
    console.log('\n📝 Initializing extra account metas...');
    
    // Initialize extra_account_metas_empty (permissive phase 1)
    const initMetasDisc = getDiscriminator('global', 'initialize_extra_account_metas_empty');
    
    const initMetasIx = new TransactionInstruction({
      keys: [
        { pubkey: extraAccountMetasPda, isSigner: false, isWritable: true },
        { pubkey: MINT, isSigner: false, isWritable: false },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: HOOK_PROGRAM_ID,
      data: initMetasDisc,
    });

    try {
      const tx = new Transaction().add(initMetasIx);
      const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
      console.log('✅ Extra account metas initialized:', sig);
    } catch (e: any) {
      console.log('❌ Init failed:', e.message);
      if (e.logs) console.log('Logs:', e.logs.slice(-5));
    }
  }

  // Check again
  const extraMetasInfo2 = await connection.getAccountInfo(extraAccountMetasPda);
  if (extraMetasInfo2) {
    console.log('\n✅ Hook is ready! Extra account metas initialized.');
  }
}

main().catch(console.error);
