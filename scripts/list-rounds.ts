import { Connection, PublicKey } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

async function listRounds() {
  console.log('=== Checking All Rounds ===\n');
  
  // Check sequencer
  const [sequencerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('round_sequencer')],
    PROGRAM_ID
  );
  
  const seqInfo = await connection.getAccountInfo(sequencerPda);
  if (seqInfo) {
    // Layout: discriminator(8) + authority(32) + current_round(u64) + last_explosion_round(u64) + auto_advance(1) + ...
    const currentRound = Number(seqInfo.data.readBigUInt64LE(8 + 32));
    const lastExplosionRound = Number(seqInfo.data.readBigUInt64LE(8 + 32 + 8));
    const autoAdvance = seqInfo.data[8 + 32 + 8 + 8] === 1;
    console.log('RoundSequencer:');
    console.log('  Current Round:', currentRound);
    console.log('  Last Explosion Round:', lastExplosionRound);
    console.log('  Auto Advance:', autoAdvance);
    console.log();
  }
  
  // Check rounds 1-10
  let foundRounds = 0;
  for (let round = 1; round <= 10; round++) {
    const roundBuf = Buffer.alloc(8);
    roundBuf.writeBigUInt64LE(BigInt(round), 0);
    
    const [presalePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('presale'), roundBuf],
      PROGRAM_ID
    );
    const info = await connection.getAccountInfo(presalePda);
    if (info) {
      foundRounds++;
      // Parse key fields from account data
      // After 8-byte discriminator:
      // authority: 32 bytes
      // start_time: i64 (8 bytes)
      // end_time: i64 (8 bytes)
      // round_id: u8 (1 byte)
      // lottery_spots: u8 (1 byte)
      // min_deposit: u64 (8 bytes)
      // max_deposit: u64 (8 bytes)
      // total_deposited: u64 (8 bytes)
      // total_depositors: u32 (4 bytes)
      // is_finalized: bool (1 byte)
      
      const startTime = Number(info.data.readBigInt64LE(8 + 32));
      const endTime = Number(info.data.readBigInt64LE(8 + 32 + 8));
      const roundId = info.data[8 + 32 + 8 + 8];
      const totalDeposited = Number(info.data.readBigUInt64LE(8 + 32 + 8 + 8 + 1 + 1 + 8 + 8));
      const totalDepositors = info.data.readUInt32LE(8 + 32 + 8 + 8 + 1 + 1 + 8 + 8 + 8);
      const isFinalized = info.data[8 + 32 + 8 + 8 + 1 + 1 + 8 + 8 + 8 + 4] === 1;
      
      const now = Date.now() / 1000;
      const isActive = !isFinalized && now < endTime;
      const hasEnded = now >= endTime;
      
      console.log(`Round ${round}:`);
      console.log(`  PDA: ${presalePda.toString()}`);
      console.log(`  Start: ${new Date(startTime * 1000).toLocaleString()}`);
      console.log(`  End: ${new Date(endTime * 1000).toLocaleString()}`);
      console.log(`  Deposited: ${totalDeposited / 1e9} SOL (${totalDepositors} depositors)`);
      console.log(`  Finalized: ${isFinalized}`);
      console.log(`  Status: ${isFinalized ? '✅ FINALIZED' : hasEnded ? '⏰ ENDED (not finalized)' : '🟢 ACTIVE'}`);
      console.log();
    }
  }
  
  if (foundRounds === 0) {
    console.log('No rounds found.');
  } else {
    console.log(`Total: ${foundRounds} round(s) found`);
  }
}

listRounds().then(() => {
  console.log('=== Done ===');
}).catch(console.error);
