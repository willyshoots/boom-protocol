/**
 * Deposit to a presale round
 * Usage: npx ts-node scripts/deposit.ts <round_id> <amount_sol>
 */

import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

const BOOM_PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');

function getDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

function encodeU64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

async function deposit() {
  const roundId = parseInt(process.argv[2] || '16');
  const amountSol = parseFloat(process.argv[3] || '0.1');
  
  const keypairPath = path.join(process.env.HOME!, '.config/solana/id.json');
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  const amount = amountSol * LAMPORTS_PER_SOL;

  const [presalePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale'), encodeU64(BigInt(roundId))],
    BOOM_PROGRAM_ID
  );

  // user_deposit seeds use round_id directly, not presale PDA
  const [depositPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('deposit'), encodeU64(BigInt(roundId)), wallet.publicKey.toBuffer()],
    BOOM_PROGRAM_ID
  );

  console.log(`💰 Depositing ${amountSol} SOL to Round ${roundId}`);
  console.log(`   Presale PDA: ${presalePDA.toBase58()}`);

  const data = Buffer.concat([
    getDiscriminator('deposit_presale'),
    encodeU64(BigInt(Math.floor(amount)))
  ]);

  // Accounts: presale_round, user_deposit, depositor, system_program
  const ix = new TransactionInstruction({
    programId: BOOM_PROGRAM_ID,
    keys: [
      { pubkey: presalePDA, isSigner: false, isWritable: true },
      { pubkey: depositPDA, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
  console.log(`✅ Deposited ${amountSol} SOL`);
  console.log(`   Tx: ${sig}`);
}

deposit().catch(err => {
  console.error('❌ Deposit failed:', err.message);
  if (err.logs) console.error('Logs:', err.logs.slice(-5));
  process.exit(1);
});
