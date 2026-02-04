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

async function startQuickTestRound() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // Use round 10 to avoid conflicts with existing rounds
  const roundId = 10;
  
  console.log('🧪 QUICK LP TEST ROUND');
  console.log('='.repeat(50));
  console.log('');
  
  const roundIdBuf = Buffer.alloc(8);
  roundIdBuf.writeBigUInt64LE(BigInt(roundId), 0);

  const [presalePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale'), roundIdBuf],
    PROGRAM_ID
  );

  // TEST CONFIG - very short times, low amounts
  const cooldownSeconds = 2 * 60; // 2 minutes for quick testing
  const lotterySpots = 5;         // Everyone wins
  const minDeposit = 0.01 * LAMPORTS_PER_SOL;  // 0.01 SOL minimum
  const maxDeposit = 0.5 * LAMPORTS_PER_SOL;   // 0.5 SOL maximum

  console.log('📋 Test Round Config:');
  console.log('   Round ID:', roundId);
  console.log('   Presale PDA:', presalePDA.toString());
  console.log('   Duration:', cooldownSeconds / 60, 'minutes');
  console.log('   Lottery Spots:', lotterySpots);
  console.log('   Min Deposit:', minDeposit / LAMPORTS_PER_SOL, 'SOL');
  console.log('   Max Deposit:', maxDeposit / LAMPORTS_PER_SOL, 'SOL');
  console.log('');

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
    
    console.log('✅ Test Round Started!');
    console.log('   Transaction:', sig);
    console.log('');
    console.log('⏱️  Presale ends at:', endTime.toLocaleTimeString());
    console.log('');
    console.log('📝 NEXT STEPS:');
    console.log('   1. Deposit 0.1-0.5 SOL via frontend (round 10)');
    console.log('   2. Wait for presale to end (~2 min)');
    console.log('   3. Run: npx ts-node scripts/end-presale.ts 10');
    console.log('   4. Run: npx ts-node scripts/create-lp.ts 10');
    console.log('');
  } catch (err: any) {
    if (err.message?.includes('already in use')) {
      console.log('⚠️  Round 10 already exists! Try a different round ID.');
    } else {
      console.error('❌ Error:', err.message);
      if (err.logs) console.error('Logs:', err.logs.slice(-5));
    }
  }
}

startQuickTestRound();
