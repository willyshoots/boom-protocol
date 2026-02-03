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

// Encode i64 as little-endian buffer
function encodeI64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(value, 0);
  return buf;
}

// Encode u32 as little-endian buffer
function encodeU32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value, 0);
  return buf;
}

// Encode u64 as little-endian buffer
function encodeU64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value, 0);
  return buf;
}

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Derive RoundSequencer PDA
  const [sequencerPDA, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('round_sequencer')],
    PROGRAM_ID
  );

  console.log('Initializing RoundSequencer...');
  console.log('Sequencer PDA:', sequencerPDA.toString());
  console.log('Authority:', keypair.publicKey.toString());

  // Check if already initialized
  const existing = await connection.getAccountInfo(sequencerPDA);
  if (existing) {
    console.log('RoundSequencer already initialized!');
    return;
  }

  // Default parameters for new rounds
  const defaultCooldown = BigInt(30 * 60); // 30 minutes in seconds
  const defaultLotterySpots = 10;
  const defaultMinDeposit = BigInt(0.1 * LAMPORTS_PER_SOL); // 0.1 SOL
  const defaultMaxDeposit = BigInt(10 * LAMPORTS_PER_SOL);  // 10 SOL

  // Build instruction data
  // init_round_sequencer(default_cooldown: i64, default_lottery_spots: u32, default_min_deposit: u64, default_max_deposit: u64)
  const discriminator = getDiscriminator('init_round_sequencer');
  const data = Buffer.concat([
    discriminator,
    encodeI64(defaultCooldown),
    encodeU32(defaultLotterySpots),
    encodeU64(defaultMinDeposit),
    encodeU64(defaultMaxDeposit),
  ]);

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: sequencerPDA, isSigner: false, isWritable: true },
      { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });

  const tx = new Transaction().add(instruction);

  try {
    const signature = await sendAndConfirmTransaction(connection, tx, [keypair]);
    console.log('✅ RoundSequencer initialized!');
    console.log('Transaction:', signature);
    console.log('\nDefault settings:');
    console.log('- Cooldown: 30 minutes');
    console.log('- Lottery spots: 10');
    console.log('- Min deposit: 0.1 SOL');
    console.log('- Max deposit: 10 SOL');
  } catch (err: any) {
    console.error('Error:', err.message || err);
    if (err.logs) {
      console.error('Logs:', err.logs);
    }
  }
}

main();
