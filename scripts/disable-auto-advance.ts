import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import * as fs from 'fs';
import { createHash } from 'crypto';

const PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');

// Load wallet
const walletPath = process.env.HOME + '/.config/solana/id.json';
const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const keypair = Keypair.fromSecretKey(new Uint8Array(secretKey));

// Compute Anchor instruction discriminator
function getDiscriminator(name: string): Buffer {
  const hash = createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

// Encode Option<i64>
function encodeOptionI64(value: bigint | null): Buffer {
  if (value === null) return Buffer.from([0]);
  const buf = Buffer.alloc(9);
  buf[0] = 1;
  buf.writeBigInt64LE(value, 1);
  return buf;
}

// Encode Option<u32>
function encodeOptionU32(value: number | null): Buffer {
  if (value === null) return Buffer.from([0]);
  const buf = Buffer.alloc(5);
  buf[0] = 1;
  buf.writeUInt32LE(value, 1);
  return buf;
}

// Encode Option<u64>
function encodeOptionU64(value: bigint | null): Buffer {
  if (value === null) return Buffer.from([0]);
  const buf = Buffer.alloc(9);
  buf[0] = 1;
  buf.writeBigUInt64LE(value, 1);
  return buf;
}

// Encode Option<bool>
function encodeOptionBool(value: boolean | null): Buffer {
  if (value === null) return Buffer.from([0]);
  return Buffer.from([1, value ? 1 : 0]);
}

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  const [sequencerPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('round_sequencer')],
    PROGRAM_ID
  );

  console.log('=== Disabling Auto-Advance ===');
  console.log('Sequencer PDA:', sequencerPDA.toString());

  // Build instruction data to disable auto_advance_enabled
  const discriminator = getDiscriminator('update_round_defaults');
  const data = Buffer.concat([
    discriminator,
    encodeOptionI64(null),     // keep cooldown
    encodeOptionU32(null),     // keep lottery_spots
    encodeOptionU64(null),     // keep min deposit
    encodeOptionU64(null),     // keep max deposit
    encodeOptionBool(false),   // DISABLE auto_advance
  ]);

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: sequencerPDA, isSigner: false, isWritable: true },
      { pubkey: keypair.publicKey, isSigner: true, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });

  const tx = new Transaction().add(instruction);

  try {
    const signature = await sendAndConfirmTransaction(connection, tx, [keypair]);
    console.log('\n✅ Auto-advance DISABLED!');
    console.log('Transaction:', signature);
    console.log('\nNo new rounds will start automatically.');
  } catch (err: any) {
    console.error('Error:', err.message || err);
    if (err.logs) {
      console.error('Logs:', err.logs);
    }
  }
}

main();
