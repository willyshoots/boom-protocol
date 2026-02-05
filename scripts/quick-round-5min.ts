/**
 * Start a 5-minute presale round
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

function encodeI64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(value);
  return buf;
}

function encodeU32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value);
  return buf;
}

async function main() {
  const roundId = parseInt(process.argv[2] || '17');
  const cooldownSeconds = 300; // 5 minutes
  const lotterySpots = 5;
  const minDeposit = 0.01 * LAMPORTS_PER_SOL;
  const maxDeposit = 10 * LAMPORTS_PER_SOL;

  const keypairPath = path.join(process.env.HOME!, '.config/solana/id.json');
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  console.log('🚀 Starting Round', roundId, '(5 minute presale)');
  console.log('Wallet:', wallet.publicKey.toBase58());

  const [presalePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale'), encodeU64(BigInt(roundId))],
    BOOM_PROGRAM_ID
  );

  const data = Buffer.concat([
    getDiscriminator('start_presale'),
    encodeU64(BigInt(roundId)),
    encodeI64(BigInt(cooldownSeconds)),
    encodeU32(lotterySpots),
    encodeU64(BigInt(Math.floor(minDeposit))),
    encodeU64(BigInt(Math.floor(maxDeposit))),
  ]);

  const ix = new TransactionInstruction({
    programId: BOOM_PROGRAM_ID,
    keys: [
      { pubkey: presalePDA, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
  console.log('✅ Round', roundId, 'started!');
  console.log('Tx:', sig);
  console.log('Presale PDA:', presalePDA.toBase58());
  console.log('');
  console.log('⏰ Presale ends in 5 minutes');
}

main().catch(err => {
  console.error('❌ Failed:', err.message);
  if (err.logs) console.error('Logs:', err.logs.slice(-5));
  process.exit(1);
});
