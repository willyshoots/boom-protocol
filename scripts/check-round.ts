import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const roundId = parseInt(process.argv[2] || '1');

  // Derive PDAs
  const roundIdBuf = Buffer.alloc(8);
  roundIdBuf.writeBigUInt64LE(BigInt(roundId), 0);
  
  const [presalePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale'), roundIdBuf],
    PROGRAM_ID
  );

  console.log('=== Round 1 Status ===');
  console.log('Presale PDA:', presalePDA.toString());

  const accountInfo = await connection.getAccountInfo(presalePDA);
  if (!accountInfo) {
    console.log('Round 1 not found!');
    return;
  }

  // Parse PresaleRound account (skip 8-byte discriminator)
  const data = accountInfo.data.slice(8);
  let offset = 0;

  const authority = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const roundIdVal = data.readBigUInt64LE(offset);
  offset += 8;

  const startTime = Number(data.readBigInt64LE(offset));
  offset += 8;

  const endTime = Number(data.readBigInt64LE(offset));
  offset += 8;

  const lotterySpots = data.readUInt32LE(offset);
  offset += 4;

  const minDeposit = data.readBigUInt64LE(offset);
  offset += 8;

  const maxDeposit = data.readBigUInt64LE(offset);
  offset += 8;

  const totalDeposited = data.readBigUInt64LE(offset);
  offset += 8;

  const totalDepositors = data.readUInt32LE(offset);
  offset += 4;

  const isFinalized = data[offset] === 1;

  console.log('\nRound ID:', roundIdVal.toString());
  console.log('Authority:', authority.toString());
  console.log('Start Time:', new Date(startTime * 1000).toLocaleString());
  console.log('End Time:', new Date(endTime * 1000).toLocaleString());
  console.log('Lottery Spots:', lotterySpots);
  console.log('Min Deposit:', Number(minDeposit) / LAMPORTS_PER_SOL, 'SOL');
  console.log('Max Deposit:', Number(maxDeposit) / LAMPORTS_PER_SOL, 'SOL');
  console.log('Total Deposited:', Number(totalDeposited) / LAMPORTS_PER_SOL, 'SOL');
  console.log('Total Depositors:', totalDepositors);
  console.log('Is Finalized:', isFinalized);

  const now = Date.now() / 1000;
  if (now < endTime) {
    console.log('\n⏳ Presale ends in', Math.round((endTime - now) / 60), 'minutes');
  } else {
    console.log('\n✅ Presale period has ended');
  }
}

main();
