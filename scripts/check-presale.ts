import { Connection, PublicKey } from '@solana/web3.js';

function encodeU64(value: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

async function check() {
  const roundId = parseInt(process.argv[2] || '17');
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const BOOM_PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');
  
  const [presalePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale'), encodeU64(roundId)],
    BOOM_PROGRAM_ID
  );
  
  const info = await connection.getAccountInfo(presalePDA);
  if (!info) { console.log('Round', roundId, 'not found'); return; }
  
  // Layout:
  // discriminator: 8
  // authority: 32 (offset 8)
  // round_id: 8 (offset 40)
  // start_time: 8 (offset 48)
  // end_time: 8 (offset 56)
  // lottery_spots: 4 (offset 64)
  // min_deposit: 8 (offset 68)
  // max_deposit: 8 (offset 76)
  // total_deposited: 8 (offset 84)
  // total_depositors: 4 (offset 92)
  // is_finalized: 1 (offset 96)
  
  const data = info.data;
  const startTime = Number(data.readBigInt64LE(48));
  const endTime = Number(data.readBigInt64LE(56));
  const totalDeposited = Number(data.readBigUInt64LE(84)) / 1e9;
  const isFinalized = data[96] === 1;
  const now = Math.floor(Date.now() / 1000);
  const remaining = endTime - now;
  
  console.log('Round', roundId, 'Status:');
  console.log('  Start:', new Date(startTime * 1000).toISOString());
  console.log('  End:', new Date(endTime * 1000).toISOString());
  console.log('  Now:', new Date(now * 1000).toISOString());
  console.log('  Total Deposited:', totalDeposited, 'SOL');
  console.log('  Finalized:', isFinalized);
  console.log('  Time Remaining:', remaining > 0 ? remaining + ' seconds' : 'ENDED');
}

check();
