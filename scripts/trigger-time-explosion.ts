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

const walletPath = process.env.HOME + '/.config/solana/id.json';
const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const authority = Keypair.fromSecretKey(new Uint8Array(secretKey));

function getDiscriminator(name: string): Buffer {
  const hash = createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const roundId = 1;

  const roundIdBuf = Buffer.alloc(8);
  roundIdBuf.writeBigUInt64LE(BigInt(roundId), 0);

  // Explosion PDA
  const [explosionPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale_explosion'), roundIdBuf],
    PROGRAM_ID
  );

  console.log('=== Triggering Time Explosion ===');
  console.log('Round:', roundId);
  console.log('Explosion PDA:', explosionPDA.toString());

  // Check current explosion state
  const accountInfo = await connection.getAccountInfo(explosionPDA);
  if (!accountInfo) {
    console.log('❌ Explosion account not found!');
    return;
  }

  const data = accountInfo.data.slice(8);
  const isExploded = data[8 + 32 + 8 + 8] === 1; // offset to is_exploded field
  const deadline = Number(data.readBigInt64LE(8 + 32 + 8)); // explosion_deadline

  console.log('Is Exploded:', isExploded);
  console.log('Deadline:', new Date(deadline * 1000).toLocaleString());
  console.log('Current time:', new Date().toLocaleString());

  if (isExploded) {
    console.log('\n💥 Already exploded!');
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  if (now < deadline) {
    const waitSecs = deadline - now;
    console.log(`\n⏳ Deadline not reached yet. Wait ${waitSecs} seconds.`);
    console.log('Run this script again after:', new Date(deadline * 1000).toLocaleString());
    return;
  }

  console.log('\n🔥 Triggering time explosion...');

  const triggerData = getDiscriminator('trigger_presale_explosion_time');

  const triggerIx = new TransactionInstruction({
    keys: [
      { pubkey: explosionPDA, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false }, // caller (anyone)
    ],
    programId: PROGRAM_ID,
    data: triggerData,
  });

  try {
    const tx = new Transaction().add(triggerIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log('\n💥💥💥 BOOM! Time limit explosion triggered! 💥💥💥');
    console.log('Transaction:', sig);
  } catch (err: any) {
    console.error('Error:', err.message);
    if (err.logs) console.error('Logs:', err.logs.slice(-5));
  }
}

main();
