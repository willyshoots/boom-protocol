import { 
  Connection, 
  Keypair, 
  PublicKey, 
  SystemProgram, 
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import * as fs from 'fs';
import { createHash } from 'crypto';

const PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');

const walletPath = process.env.HOME + '/.config/solana/id.json';
const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const payer = Keypair.fromSecretKey(new Uint8Array(secretKey));

function getDiscriminator(name: string): Buffer {
  const hash = createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

function encodeU64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value, 0);
  return buf;
}

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  const prevRoundId = 1;
  const newRoundId = 2;

  const prevRoundIdBuf = Buffer.alloc(8);
  prevRoundIdBuf.writeBigUInt64LE(BigInt(prevRoundId), 0);
  
  const newRoundIdBuf = Buffer.alloc(8);
  newRoundIdBuf.writeBigUInt64LE(BigInt(newRoundId), 0);

  // PDAs
  const [sequencerPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('round_sequencer')],
    PROGRAM_ID
  );
  const [prevExplosionPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale_explosion'), prevRoundIdBuf],
    PROGRAM_ID
  );
  const [newPresalePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale'), newRoundIdBuf],
    PROGRAM_ID
  );

  console.log('=== Auto-Starting Next Round ===');
  console.log('Previous round:', prevRoundId);
  console.log('New round:', newRoundId);
  console.log('Sequencer PDA:', sequencerPDA.toString());
  console.log('Previous explosion PDA:', prevExplosionPDA.toString());
  console.log('New presale PDA:', newPresalePDA.toString());

  // auto_start_next_round(new_round_id: u64)
  const data = Buffer.concat([
    getDiscriminator('auto_start_next_round'),
    encodeU64(BigInt(newRoundId)),
  ]);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: sequencerPDA, isSigner: false, isWritable: true },
      { pubkey: prevExplosionPDA, isSigner: false, isWritable: false },
      { pubkey: newPresalePDA, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });

  try {
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
    console.log('\n✅ Round 2 started automatically!');
    console.log('Transaction:', sig);
    console.log('\nRound 2 will use default settings from RoundSequencer:');
    console.log('- 30 min cooldown');
    console.log('- 25 lottery spots');
    console.log('- 0.1-10 SOL deposits');
  } catch (err: any) {
    console.error('Error:', err.message);
    if (err.logs) console.error('Logs:', err.logs.slice(-5));
  }
}

main();
