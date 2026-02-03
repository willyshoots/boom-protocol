import { 
  Connection, 
  Keypair, 
  PublicKey, 
  SystemProgram, 
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
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

// Encode Option<i64> - 1 byte tag + 8 bytes value if Some
function encodeOptionI64(value: bigint | null): Buffer {
  if (value === null) {
    return Buffer.from([0]); // None
  }
  const buf = Buffer.alloc(9);
  buf[0] = 1; // Some
  buf.writeBigInt64LE(value, 1);
  return buf;
}

// Encode Option<u32>
function encodeOptionU32(value: number | null): Buffer {
  if (value === null) {
    return Buffer.from([0]); // None
  }
  const buf = Buffer.alloc(5);
  buf[0] = 1; // Some
  buf.writeUInt32LE(value, 1);
  return buf;
}

// Encode Option<u64>
function encodeOptionU64(value: bigint | null): Buffer {
  if (value === null) {
    return Buffer.from([0]); // None
  }
  const buf = Buffer.alloc(9);
  buf[0] = 1; // Some
  buf.writeBigUInt64LE(value, 1);
  return buf;
}

// Encode Option<bool>
function encodeOptionBool(value: boolean | null): Buffer {
  if (value === null) {
    return Buffer.from([0]); // None
  }
  return Buffer.from([1, value ? 1 : 0]); // Some(true/false)
}

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Derive RoundSequencer PDA
  const [sequencerPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('round_sequencer')],
    PROGRAM_ID
  );

  console.log('Updating RoundSequencer...');
  console.log('Sequencer PDA:', sequencerPDA.toString());

  // New parameters - only update lottery_spots, keep others as None
  const newLotterySpots = 25; // 20-30 range, picking 25

  // Build instruction data
  // update_round_defaults(
  //   default_cooldown: Option<i64>,
  //   default_lottery_spots: Option<u32>,
  //   default_min_deposit: Option<u64>,
  //   default_max_deposit: Option<u64>,
  //   auto_advance_enabled: Option<bool>
  // )
  const discriminator = getDiscriminator('update_round_defaults');
  const data = Buffer.concat([
    discriminator,
    encodeOptionI64(null),           // keep cooldown
    encodeOptionU32(newLotterySpots), // update to 25
    encodeOptionU64(null),           // keep min deposit
    encodeOptionU64(null),           // keep max deposit
    encodeOptionBool(null),          // keep auto_advance
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
    console.log('✅ RoundSequencer updated!');
    console.log('Transaction:', signature);
    console.log('\nNew settings:');
    console.log('- Lottery spots: 25 (was 10)');
    console.log('- With 10% presale allocation, each winner gets max 0.4%');
  } catch (err: any) {
    console.error('Error:', err.message || err);
    if (err.logs) {
      console.error('Logs:', err.logs);
    }
  }
}

main();
