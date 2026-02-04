/**
 * Start a quick presale round for testing (1 minute cooldown)
 */

import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

const BOOM_PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');

function getDiscriminator(name: string): Buffer {
  const preimage = `global:${name}`;
  return createHash('sha256').update(preimage).digest().slice(0, 8);
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
  const roundId = parseInt(process.argv[2] || '13');
  const cooldownSeconds = 60; // 1 minute!
  const lotterySpots = 5;
  const minDeposit = 0.01 * LAMPORTS_PER_SOL;
  const maxDeposit = 1 * LAMPORTS_PER_SOL;

  const keypairPath = path.join(process.env.HOME!, '.config/solana/id.json');
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  console.log('🚀 Starting Quick Round', roundId);
  console.log('Cooldown: 1 minute');
  console.log('Wallet:', wallet.publicKey.toBase58());

  // Get presale PDA
  const roundIdBN = BigInt(roundId);
  const [presalePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale'), encodeU64(roundIdBN)],
    BOOM_PROGRAM_ID
  );
  const [vaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale_vault'), encodeU64(roundIdBN)],
    BOOM_PROGRAM_ID
  );
  const [protocolPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('protocol')],
    BOOM_PROGRAM_ID
  );

  // Build instruction
  const data = Buffer.concat([
    getDiscriminator('start_presale'),
    encodeU64(roundIdBN),
    encodeI64(BigInt(cooldownSeconds)),
    encodeU32(lotterySpots),
    encodeU64(BigInt(minDeposit)),
    encodeU64(BigInt(maxDeposit)),
  ]);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: presalePDA, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: BOOM_PROGRAM_ID,
    data,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);

  console.log('\n✅ Round', roundId, 'Started!');
  console.log('Transaction:', sig);
  console.log('Presale PDA:', presalePDA.toBase58());
  console.log('\nPresale ends in 1 minute!');
}

main().catch(console.error);
