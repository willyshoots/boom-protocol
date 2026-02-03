/**
 * BOOM Protocol - Create Token for Presale Round
 * 
 * This script creates a Token2022 mint for a finalized presale round.
 * Must be run after end-presale.ts
 * 
 * Usage: npx ts-node scripts/create-token.ts [round_id] [name] [symbol] [total_supply]
 */

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction, 
  TransactionInstruction, 
  sendAndConfirmTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Config
const PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const KEYPAIR_PATH = process.env.KEYPAIR_PATH || path.join(process.env.HOME!, '.config/solana/id.json');

// Instruction discriminators
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

function getPresaleTokenPDA(roundId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('presale_token'), roundId.toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID
  );
}

function getMintAuthorityPDA(roundId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('mint_authority'), roundId.toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID
  );
}

// Parse PresaleRound
function parsePresaleRound(data: Buffer) {
  const d = data.slice(8);
  return {
    authority: new PublicKey(d.slice(0, 32)),
    roundId: new BN(d.slice(32, 40), 'le'),
    totalDeposited: new BN(d.slice(76, 84), 'le'),
    totalDepositors: d.readUInt32LE(84),
    isFinalized: d[88] === 1,
    lotterySpots: d.readUInt32LE(56),
  };
}

// Count winners
async function countWinners(connection: Connection, roundId: BN): Promise<number> {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [
      { memcmp: { offset: 0, bytes: Buffer.from([69, 238, 23, 217, 255, 137, 185, 35]).toString('base64') } },
      { memcmp: { offset: 8 + 32, bytes: roundId.toArrayLike(Buffer, 'le', 8).toString('base64') } },
    ],
  });

  let winners = 0;
  for (const { account } of accounts) {
    const isWinner = account.data[8 + 32 + 8 + 8 + 8] === 1; // is_winner offset
    if (isWinner) winners++;
  }
  return winners;
}

async function createToken(
  roundId: number,
  name: string = 'BOOM Token',
  symbol: string = 'BOOM',
  totalSupply: number = 1_000_000_000 // 1 billion tokens
) {
  console.log('🪙 BOOM Protocol - Create Token');
  console.log('================================\n');

  // Load wallet
  const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
  const wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));
  console.log('Authority:', wallet.publicKey.toBase58());

  // Connect
  const connection = new Connection(RPC_URL, 'confirmed');
  const roundIdBN = new BN(roundId);

  // PDAs
  const [presaleRoundPDA] = getPresaleRoundPDA(roundIdBN);
  const [presaleTokenPDA] = getPresaleTokenPDA(roundIdBN);
  const [mintAuthorityPDA] = getMintAuthorityPDA(roundIdBN);

  console.log('Round ID:', roundId);
  console.log('Presale PDA:', presaleRoundPDA.toBase58());
  console.log('Token PDA:', presaleTokenPDA.toBase58());
  console.log('Mint Authority PDA:', mintAuthorityPDA.toBase58());

  // Check presale state
  const presaleInfo = await connection.getAccountInfo(presaleRoundPDA);
  if (!presaleInfo) {
    throw new Error('Presale round not found');
  }

  const presale = parsePresaleRound(presaleInfo.data);
  console.log('\n📊 Presale State:');
  console.log('  Is Finalized:', presale.isFinalized);
  console.log('  Total Deposited:', (presale.totalDeposited.toNumber() / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
  console.log('  Total Depositors:', presale.totalDepositors);

  if (!presale.isFinalized) {
    throw new Error('Presale not finalized! Run end-presale.ts first.');
  }

  // Check if token already exists
  const existingToken = await connection.getAccountInfo(presaleTokenPDA);
  if (existingToken) {
    const mintAddr = new PublicKey(existingToken.data.slice(8 + 8, 8 + 8 + 32));
    console.log('\n⚠️  Token already created!');
    console.log('   Mint:', mintAddr.toBase58());
    return mintAddr;
  }

  // Count winners to calculate tokens per winner
  const winnersCount = await countWinners(connection, roundIdBN);
  console.log('  Winners:', winnersCount);

  if (winnersCount === 0) {
    throw new Error('No winners marked! Run end-presale.ts to mark winners.');
  }

  // Calculate tokenomics
  // 10% to presale winners, 90% to LP
  const presaleShare = Math.floor(totalSupply * 0.1);
  const tokensPerWinner = Math.floor(presaleShare / winnersCount);
  
  console.log('\n💰 Tokenomics:');
  console.log('  Total Supply:', totalSupply.toLocaleString(), 'tokens');
  console.log('  Presale Share (10%):', presaleShare.toLocaleString());
  console.log('  Per Winner:', tokensPerWinner.toLocaleString());
  console.log('  LP Share (90%):', (totalSupply - presaleShare).toLocaleString());

  // Generate new mint keypair
  const mintKeypair = Keypair.generate();
  console.log('\n🔑 New Mint:', mintKeypair.publicKey.toBase58());

  // Build instruction data
  const nameBytes = Buffer.alloc(4 + name.length);
  nameBytes.writeUInt32LE(name.length, 0);
  nameBytes.write(name, 4);

  const symbolBytes = Buffer.alloc(4 + symbol.length);
  symbolBytes.writeUInt32LE(symbol.length, 0);
  symbolBytes.write(symbol, 4);

  const totalSupplyBN = new BN(totalSupply).mul(new BN(10).pow(new BN(9))); // 9 decimals
  const tokensPerWinnerBN = new BN(tokensPerWinner).mul(new BN(10).pow(new BN(9)));

  const data = Buffer.concat([
    getDiscriminator('create_presale_token'),
    roundIdBN.toArrayLike(Buffer, 'le', 8),
    nameBytes,
    symbolBytes,
    totalSupplyBN.toArrayLike(Buffer, 'le', 8),
    tokensPerWinnerBN.toArrayLike(Buffer, 'le', 8),
  ]);

  // Create instruction
  const createTokenIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: presaleRoundPDA, isSigner: false, isWritable: false },
      { pubkey: mintKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: mintAuthorityPDA, isSigner: false, isWritable: false },
      { pubkey: presaleTokenPDA, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  console.log('\n📝 Creating token...');
  
  const tx = new Transaction().add(createTokenIx);
  const sig = await sendAndConfirmTransaction(connection, tx, [wallet, mintKeypair]);
  
  console.log('✅ Token Created!');
  console.log('   Signature:', sig);
  console.log('   Mint:', mintKeypair.publicKey.toBase58());
  console.log('\n🔗 View on Solscan:');
  console.log(`   https://solscan.io/token/${mintKeypair.publicKey.toBase58()}?cluster=devnet`);

  return mintKeypair.publicKey;
}

// CLI entry point
const roundId = parseInt(process.argv[2] || '1');
const name = process.argv[3] || 'BOOM Token';
const symbol = process.argv[4] || 'BOOM';
const totalSupply = parseInt(process.argv[5] || '1000000000');

if (isNaN(roundId)) {
  console.error('Usage: npx ts-node scripts/create-token.ts [round_id] [name] [symbol] [total_supply]');
  process.exit(1);
}

createToken(roundId, name, symbol, totalSupply)
  .then((mint) => {
    console.log('\n✅ Done! Next step: npx ts-node scripts/create-lp.ts', roundId);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
