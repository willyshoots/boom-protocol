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

const walletPath = process.env.HOME + '/.config/solana/id.json';
const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const authority = Keypair.fromSecretKey(new Uint8Array(secretKey));

function getDiscriminator(name: string): Buffer {
  const hash = createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

function encodeU64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value, 0);
  return buf;
}

function encodeI64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(value, 0);
  return buf;
}

function encodeU32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value, 0);
  return buf;
}

async function startFreshRound(roundId: number) {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  console.log('🚀 Starting Fresh Round', roundId);
  console.log('='.repeat(40));

  const roundIdBuf = Buffer.alloc(8);
  roundIdBuf.writeBigUInt64LE(BigInt(roundId), 0);

  const [presalePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale'), roundIdBuf],
    PROGRAM_ID
  );

  // Config for test
  const cooldownSeconds = 15 * 60; // 15 minutes presale
  const lotterySpots = 25;
  const minDeposit = 0.1 * LAMPORTS_PER_SOL;
  const maxDeposit = 10 * LAMPORTS_PER_SOL;

  console.log('Presale PDA:', presalePDA.toString());
  console.log('Cooldown:', cooldownSeconds / 60, 'minutes');
  console.log('Lottery Spots:', lotterySpots);
  console.log('Min/Max Deposit:', minDeposit / LAMPORTS_PER_SOL, '-', maxDeposit / LAMPORTS_PER_SOL, 'SOL');

  // start_presale(round_id: u64, cooldown_duration: i64, lottery_spots: u32, min_deposit: u64, max_deposit: u64)
  const data = Buffer.concat([
    getDiscriminator('start_presale'),
    encodeU64(BigInt(roundId)),
    encodeI64(BigInt(cooldownSeconds)),
    encodeU32(lotterySpots),
    encodeU64(BigInt(minDeposit)),
    encodeU64(BigInt(maxDeposit)),
  ]);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: presalePDA, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });

  try {
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    
    const endTime = new Date(Date.now() + cooldownSeconds * 1000);
    console.log('\n✅ Round', roundId, 'Started!');
    console.log('Transaction:', sig);
    console.log('\nPresale ends at:', endTime.toLocaleString());
    console.log('\n👉 Users can now deposit on the frontend!');
  } catch (err: any) {
    if (err.message?.includes('already in use')) {
      console.log('Round', roundId, 'already exists!');
    } else {
      console.error('Error:', err.message);
      if (err.logs) console.error('Logs:', err.logs.slice(-5));
    }
  }
}

const roundId = parseInt(process.argv[2] || '3');
startFreshRound(roundId);
