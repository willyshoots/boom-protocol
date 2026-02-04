/**
 * BOOM Protocol - End Presale & Run Lottery
 * 
 * This script:
 * 1. Ends the presale round
 * 2. Picks random winners from depositors
 * 3. Marks winners on-chain
 * 
 * Usage: npx ts-node scripts/end-presale.ts [round_id]
 */

import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Config
const PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const KEYPAIR_PATH = process.env.KEYPAIR_PATH || path.join(process.env.HOME!, '.config/solana/id.json');

// Instruction discriminators (first 8 bytes of SHA256("global:<name>"))
function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

// PDA helpers
function getPresaleRoundPDA(roundId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('presale'), roundId.toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID
  );
}

function getUserDepositPDA(roundId: BN, depositor: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('deposit'), roundId.toArrayLike(Buffer, 'le', 8), depositor.toBuffer()],
    PROGRAM_ID
  );
}

// Parse PresaleRound account
interface PresaleRound {
  authority: PublicKey;
  roundId: BN;
  startTime: BN;
  endTime: BN;
  lotterySpots: number;
  minDeposit: BN;
  maxDeposit: BN;
  totalDeposited: BN;
  totalDepositors: number;
  isFinalized: boolean;
}

function parsePresaleRound(data: Buffer): PresaleRound {
  const d = data.slice(8); // Skip discriminator
  return {
    authority: new PublicKey(d.slice(0, 32)),
    roundId: new BN(d.slice(32, 40), 'le'),
    startTime: new BN(d.slice(40, 48), 'le'),
    endTime: new BN(d.slice(48, 56), 'le'),
    lotterySpots: d.readUInt32LE(56),
    minDeposit: new BN(d.slice(60, 68), 'le'),
    maxDeposit: new BN(d.slice(68, 76), 'le'),
    totalDeposited: new BN(d.slice(76, 84), 'le'),
    totalDepositors: d.readUInt32LE(84),
    isFinalized: d[88] === 1,
  };
}

// Find all depositors for a round by scanning program accounts
async function findDepositors(connection: Connection, roundId: BN): Promise<PublicKey[]> {
  console.log('Scanning for depositors...');
  
  // Get all accounts owned by our program with deposit prefix
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [
      { memcmp: { offset: 0, bytes: Buffer.from([69, 238, 23, 217, 255, 137, 185, 35]).toString('base64') } }, // UserDeposit discriminator
      { memcmp: { offset: 8 + 32, bytes: roundId.toArrayLike(Buffer, 'le', 8).toString('base64') } }, // roundId match
    ],
  });

  const depositors: PublicKey[] = [];
  for (const { account } of accounts) {
    const depositor = new PublicKey(account.data.slice(8, 40));
    const amount = new BN(account.data.slice(48, 56), 'le');
    if (amount.gt(new BN(0))) {
      depositors.push(depositor);
    }
  }

  return depositors;
}

// Randomly select winners using slot hash as seed
function selectWinners(depositors: PublicKey[], numWinners: number, seed: Buffer): PublicKey[] {
  if (depositors.length <= numWinners) {
    return depositors; // Everyone wins
  }

  // Fisher-Yates shuffle with deterministic seed
  const shuffled = [...depositors];
  let seedHash = crypto.createHash('sha256').update(seed).digest();
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    // Use bytes from hash to get random index
    const randomBytes = seedHash.slice(0, 4);
    const randomValue = randomBytes.readUInt32LE(0);
    const j = randomValue % (i + 1);
    
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    
    // Rehash for next iteration
    seedHash = crypto.createHash('sha256').update(seedHash).digest();
  }

  return shuffled.slice(0, numWinners);
}

async function endPresale(roundId: number) {
  console.log('🎰 BOOM Protocol - End Presale & Lottery');
  console.log('========================================\n');

  // Load wallet
  const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
  const wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));
  console.log('Authority:', wallet.publicKey.toBase58());

  // Connect
  const connection = new Connection(RPC_URL, 'confirmed');
  const roundIdBN = new BN(roundId);
  const [presaleRoundPDA] = getPresaleRoundPDA(roundIdBN);

  console.log('Round ID:', roundId);
  console.log('Presale PDA:', presaleRoundPDA.toBase58());

  // Fetch presale state
  const presaleInfo = await connection.getAccountInfo(presaleRoundPDA);
  if (!presaleInfo) {
    throw new Error('Presale round not found');
  }

  const presale = parsePresaleRound(presaleInfo.data);
  console.log('\n📊 Presale State:');
  console.log('  Total Deposited:', presale.totalDeposited.toString(), 'lamports');
  console.log('  Total Depositors:', presale.totalDepositors);
  console.log('  Lottery Spots:', presale.lotterySpots);
  console.log('  Is Finalized:', presale.isFinalized);
  console.log('  End Time:', new Date(presale.endTime.toNumber() * 1000).toISOString());

  if (presale.isFinalized) {
    console.log('\n⚠️  Presale already finalized!');
    return;
  }

  // Check if presale ended
  const now = Math.floor(Date.now() / 1000);
  if (now < presale.endTime.toNumber()) {
    const remaining = presale.endTime.toNumber() - now;
    console.log(`\n⏳ Presale not ended yet. ${remaining} seconds remaining.`);
    console.log('   Force ending anyway for testing...');
  }

  // Find all depositors
  const depositors = await findDepositors(connection, roundIdBN);
  console.log('\n👥 Found depositors:', depositors.length);
  depositors.forEach((d, i) => console.log(`  ${i + 1}. ${d.toBase58()}`));

  // Get recent blockhash for randomness seed
  const { blockhash } = await connection.getLatestBlockhash();
  const seed = Buffer.from(blockhash);

  // Select winners
  const numWinners = Math.min(presale.lotterySpots, depositors.length);
  const winners = selectWinners(depositors, numWinners, seed);
  console.log('\n🎉 Selected Winners:');
  winners.forEach((w, i) => console.log(`  ${i + 1}. ${w.toBase58()}`));

  // Step 1: End presale and lottery
  console.log('\n📝 Step 1: Ending presale...');
  
  const endPresaleIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: presaleRoundPDA, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([
      getDiscriminator('end_presale_and_lottery'),
      // winner_indexes: Vec<u32> - just pass empty for now, we'll mark winners separately
      Buffer.from([0, 0, 0, 0]), // vec length = 0
    ]),
  });

  const tx1 = new Transaction().add(endPresaleIx);
  const sig1 = await sendAndConfirmTransaction(connection, tx1, [wallet]);
  console.log('  ✅ Presale ended:', sig1);

  // Step 2: Mark each winner
  console.log('\n📝 Step 2: Marking winners...');
  
  for (const winner of winners) {
    const [userDepositPDA] = getUserDepositPDA(roundIdBN, winner);
    
    const markWinnerIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: presaleRoundPDA, isSigner: false, isWritable: false },
        { pubkey: userDepositPDA, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
      ],
      data: getDiscriminator('mark_winner'),
    });

    const tx2 = new Transaction().add(markWinnerIx);
    const sig2 = await sendAndConfirmTransaction(connection, tx2, [wallet]);
    console.log(`  ✅ Marked winner ${winner.toBase58().slice(0, 8)}...: ${sig2}`);
  }

  console.log('\n🎰 Lottery Complete!');
  console.log(`   ${winners.length} winners selected out of ${depositors.length} depositors`);

  return winners;
}

// CLI entry point
const roundId = parseInt(process.argv[2] || '1');
if (isNaN(roundId)) {
  console.error('Usage: npx ts-node scripts/end-presale.ts [round_id]');
  process.exit(1);
}

endPresale(roundId)
  .then((winners) => {
    console.log('\n✅ Done! Next step: npx ts-node scripts/create-token.ts', roundId);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
