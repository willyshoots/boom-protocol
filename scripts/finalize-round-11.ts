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
const ROUND_ID = 11;

const walletPath = process.env.HOME + '/.config/solana/id.json';
const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const authority = Keypair.fromSecretKey(new Uint8Array(secretKey));

function getDiscriminator(name: string): Buffer {
  const hash = createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  console.log('🎰 Finalizing Round 11');
  console.log('='.repeat(40));

  const roundIdBuf = Buffer.alloc(8);
  roundIdBuf.writeBigUInt64LE(BigInt(ROUND_ID), 0);

  const [presalePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale'), roundIdBuf],
    PROGRAM_ID
  );

  // Troy's depositor address (the only depositor)
  const depositorPubkey = new PublicKey('6dqJVBxjc9B6AMgBz7Ek5ATwxaouxdFcAbrhqB3aY9od');

  const [depositPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('deposit'), roundIdBuf, depositorPubkey.toBuffer()],
    PROGRAM_ID
  );

  console.log('Presale PDA:', presalePDA.toString());
  console.log('Deposit PDA:', depositPDA.toString());

  // Step 1: End presale and lottery (no winner indexes needed, we'll mark manually)
  console.log('\n📝 Step 1: Ending presale...');
  
  // end_presale_and_lottery(winner_indexes: Vec<u32>)
  // For simplicity, pass empty vec - we'll mark winner manually
  const endData = Buffer.concat([
    getDiscriminator('end_presale_and_lottery'),
    Buffer.from([0, 0, 0, 0]), // empty Vec<u32> length prefix
  ]);

  const endIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: presalePDA, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    ],
    data: endData,
  });

  try {
    const tx1 = new Transaction().add(endIx);
    const sig1 = await sendAndConfirmTransaction(connection, tx1, [authority]);
    console.log('✅ Presale ended:', sig1);
  } catch (err: any) {
    console.log('Presale end result:', err.message);
    if (err.logs) console.log(err.logs.slice(-3));
  }

  // Step 2: Mark the depositor as winner
  console.log('\n📝 Step 2: Marking winner...');
  
  const markData = getDiscriminator('mark_winner');

  const markIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: presalePDA, isSigner: false, isWritable: false },
      { pubkey: depositPDA, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    ],
    data: markData,
  });

  try {
    const tx2 = new Transaction().add(markIx);
    const sig2 = await sendAndConfirmTransaction(connection, tx2, [authority]);
    console.log('✅ Winner marked:', sig2);
  } catch (err: any) {
    console.log('Mark winner result:', err.message);
    if (err.logs) console.log(err.logs.slice(-3));
  }

  console.log('\n✅ Round 11 finalized! Ready for token + LP creation.');
}

main().catch(console.error);
