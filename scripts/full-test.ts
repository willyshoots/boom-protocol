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
const TROY_PUBKEY = new PublicKey('6FeR4ioSTQBV78mvwCJLaGVGnfXGx9AqqNS2bKRJkNQQ'); // Troy's wallet

// Load authority wallet
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

function getRoundIdBuf(roundId: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(roundId), 0);
  return buf;
}

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const roundId = 1;
  const roundIdBuf = getRoundIdBuf(roundId);

  // PDAs
  const [presalePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale'), roundIdBuf],
    PROGRAM_ID
  );
  const [userDepositPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('deposit'), roundIdBuf, TROY_PUBKEY.toBuffer()],
    PROGRAM_ID
  );
  const [presaleExplosionPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale_explosion'), roundIdBuf],
    PROGRAM_ID
  );

  console.log('=== BOOM Protocol Full Test ===\n');
  console.log('Round ID:', roundId);
  console.log('Presale PDA:', presalePDA.toString());
  console.log('Troy deposit PDA:', userDepositPDA.toString());
  console.log('Explosion PDA:', presaleExplosionPDA.toString());
  console.log('');

  // Step 1: Mark Troy as winner
  console.log('Step 1: Marking Troy as lottery winner...');
  try {
    const markWinnerIx = new TransactionInstruction({
      keys: [
        { pubkey: presalePDA, isSigner: false, isWritable: true },
        { pubkey: userDepositPDA, isSigner: false, isWritable: true },
        { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      ],
      programId: PROGRAM_ID,
      data: getDiscriminator('mark_winner'),
    });

    const tx1 = new Transaction().add(markWinnerIx);
    const sig1 = await sendAndConfirmTransaction(connection, tx1, [authority]);
    console.log('✅ Troy marked as winner:', sig1);
  } catch (err: any) {
    if (err.message?.includes('AlreadyWinner') || err.logs?.some((l: string) => l.includes('already'))) {
      console.log('ℹ️ Troy already marked as winner');
    } else {
      console.error('Error marking winner:', err.message);
    }
  }

  // Step 2: Finalize presale with end_presale_and_lottery
  console.log('\nStep 2: Finalizing presale (end_presale_and_lottery)...');
  try {
    // winner_indexes is a Vec<u32>, Troy is index 0
    // Borsh encoding: 4-byte length prefix + 4 bytes per u32
    const winnerIndexes = [0]; // Troy is depositor index 0
    const vecLen = Buffer.alloc(4);
    vecLen.writeUInt32LE(winnerIndexes.length, 0);
    const indexBuf = Buffer.alloc(4);
    indexBuf.writeUInt32LE(0, 0);

    const finalizeData = Buffer.concat([
      getDiscriminator('end_presale_and_lottery'),
      vecLen,
      indexBuf,
    ]);

    const finalizeIx = new TransactionInstruction({
      keys: [
        { pubkey: presalePDA, isSigner: false, isWritable: true },
        { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      ],
      programId: PROGRAM_ID,
      data: finalizeData,
    });

    const tx2 = new Transaction().add(finalizeIx);
    const sig2 = await sendAndConfirmTransaction(connection, tx2, [authority]);
    console.log('✅ Presale finalized:', sig2);
  } catch (err: any) {
    if (err.message?.includes('Finalized') || err.logs?.some((l: string) => l.includes('finalized'))) {
      console.log('ℹ️ Presale already finalized');
    } else {
      console.error('Error finalizing:', err.message);
      if (err.logs) console.error('Logs:', err.logs.slice(-5));
    }
  }

  // Step 3: Initialize explosion with 5-min deadline
  console.log('\nStep 3: Initializing explosion (5-min time limit)...');
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 5 * 60); // 5 minutes from now
  const secretCap = BigInt(1_000_000 * LAMPORTS_PER_SOL); // 1M SOL (won't hit, time limit will trigger)
  const capHash = createHash('sha256').update(Buffer.from(encodeU64(secretCap))).digest();

  try {
    const initExplosionData = Buffer.concat([
      getDiscriminator('init_presale_explosion'),
      encodeU64(BigInt(roundId)),
      capHash,
      encodeI64(deadline),
    ]);

    const initExplosionIx = new TransactionInstruction({
      keys: [
        { pubkey: presalePDA, isSigner: false, isWritable: false },
        { pubkey: presaleExplosionPDA, isSigner: false, isWritable: true },
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: PROGRAM_ID,
      data: initExplosionData,
    });

    const tx3 = new Transaction().add(initExplosionIx);
    const sig3 = await sendAndConfirmTransaction(connection, tx3, [authority]);
    console.log('✅ Explosion initialized:', sig3);
    console.log('   Deadline:', new Date(Number(deadline) * 1000).toLocaleString());
    console.log('   Secret cap hash set (cap will not be hit, time limit will trigger)');
  } catch (err: any) {
    if (err.logs?.some((l: string) => l.includes('already'))) {
      console.log('ℹ️ Explosion already initialized');
    } else {
      console.error('Error initializing explosion:', err.message);
      if (err.logs) console.error('Logs:', err.logs.slice(-5));
    }
  }

  console.log('\n=== Setup Complete ===');
  console.log('\nNext steps:');
  console.log('1. Create token with transfer hook (run create-token-with-hook.ts)');
  console.log('2. Create LP on Raydium (run create-lp.ts)');
  console.log('3. Register LP (run register-lp.ts)');
  console.log('4. Wait 5 minutes for time limit');
  console.log('5. Trigger time explosion (anyone can call)');
  console.log('6. Unwind LP and claim payouts');
  console.log('\nOr run: npx ts-node scripts/trigger-explosion.ts (after 5 mins)');
}

main();
