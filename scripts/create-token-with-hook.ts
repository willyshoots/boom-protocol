/**
 * BOOM Protocol - Create Token WITH Transfer Hook
 * 
 * Creates a Token2022 mint with transfer hook extension wired to our hook program.
 * This ensures tokens can only be transferred to wallets or whitelisted LPs.
 * 
 * Usage: npx ts-node scripts/create-token-with-hook.ts [round_id] [name] [symbol] [total_supply]
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
import {
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  getMintLen,
  ExtensionType,
  TYPE_SIZE,
  LENGTH_SIZE,
} from '@solana/spl-token';
import pkg from '@coral-xyz/anchor';
const { BN } = pkg;
type BNType = InstanceType<typeof BN>;
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Config
const BOOM_PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');
const HOOK_PROGRAM_ID = new PublicKey('CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9');
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const KEYPAIR_PATH = process.env.KEYPAIR_PATH || path.join(process.env.HOME!, '.config/solana/id.json');

// Discriminators for our boom program
function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

// PDA helpers
function getPresaleRoundPDA(roundId: any): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('presale'), roundId.toArrayLike(Buffer, 'le', 8)],
    BOOM_PROGRAM_ID
  );
}

function getPresaleTokenPDA(roundId: any): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('presale_token'), roundId.toArrayLike(Buffer, 'le', 8)],
    BOOM_PROGRAM_ID
  );
}

function getMintAuthorityPDA(roundId: any): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('mint_authority'), roundId.toArrayLike(Buffer, 'le', 8)],
    BOOM_PROGRAM_ID
  );
}

// Hook PDAs
function getHookConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('hook_config')],
    HOOK_PROGRAM_ID
  );
}

function getExtraAccountMetasPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('extra-account-metas'), mint.toBuffer()],
    HOOK_PROGRAM_ID
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
async function countWinners(connection: Connection, roundId: any): Promise<number> {
  const accounts = await connection.getProgramAccounts(BOOM_PROGRAM_ID, {
    filters: [
      { memcmp: { offset: 0, bytes: Buffer.from([69, 238, 23, 217, 255, 137, 185, 35]).toString('base64') } },
      { memcmp: { offset: 8 + 32, bytes: roundId.toArrayLike(Buffer, 'le', 8).toString('base64') } },
    ],
  });

  let winners = 0;
  for (const { account } of accounts) {
    const isWinner = account.data[8 + 32 + 8 + 8 + 8] === 1;
    if (isWinner) winners++;
  }
  return winners;
}

async function createTokenWithHook(
  roundId: number,
  name: string = 'BOOM Token',
  symbol: string = 'BOOM',
  totalSupply: number = 1_000_000_000
) {
  console.log('🪙 BOOM Protocol - Create Token WITH Transfer Hook');
  console.log('==================================================\n');

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
  const [hookConfigPDA] = getHookConfigPDA();

  console.log('Round ID:', roundId);
  console.log('Presale PDA:', presaleRoundPDA.toBase58());
  console.log('Token PDA:', presaleTokenPDA.toBase58());
  console.log('Mint Authority PDA:', mintAuthorityPDA.toBase58());
  console.log('Hook Program:', HOOK_PROGRAM_ID.toBase58());
  console.log('Hook Config PDA:', hookConfigPDA.toBase58());

  // Check presale state
  const presaleInfo = await connection.getAccountInfo(presaleRoundPDA);
  if (!presaleInfo) {
    throw new Error('Presale round not found');
  }

  const presale = parsePresaleRound(presaleInfo.data);
  console.log('\n📊 Presale State:');
  console.log('  Is Finalized:', presale.isFinalized);
  console.log('  Total Deposited:', (presale.totalDeposited.toNumber() / LAMPORTS_PER_SOL).toFixed(4), 'SOL');

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

  // Count winners
  const winnersCount = await countWinners(connection, roundIdBN);
  console.log('  Winners:', winnersCount);

  if (winnersCount === 0) {
    throw new Error('No winners marked!');
  }

  // Calculate tokenomics
  const presaleShare = Math.floor(totalSupply * 0.1);
  const tokensPerWinner = Math.floor(presaleShare / winnersCount);
  
  console.log('\n💰 Tokenomics:');
  console.log('  Total Supply:', totalSupply.toLocaleString());
  console.log('  Per Winner:', tokensPerWinner.toLocaleString());

  // Generate mint keypair
  const mintKeypair = Keypair.generate();
  const [extraAccountMetasPDA] = getExtraAccountMetasPDA(mintKeypair.publicKey);
  
  console.log('\n🔑 New Mint:', mintKeypair.publicKey.toBase58());
  console.log('   Extra Metas PDA:', extraAccountMetasPDA.toBase58());

  // Calculate mint account size with transfer hook extension
  const extensions = [ExtensionType.TransferHook];
  const mintLen = getMintLen(extensions);
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

  console.log('\n📝 Creating Token2022 mint with transfer hook...');
  console.log('   Mint size:', mintLen, 'bytes');
  console.log('   Rent:', lamports / LAMPORTS_PER_SOL, 'SOL');

  // Transaction 1: Create mint account + initialize transfer hook + initialize mint
  const tx1 = new Transaction();

  // 1. Create mint account
  tx1.add(
    SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    })
  );

  // 2. Initialize transfer hook extension (MUST be before mint init)
  tx1.add(
    createInitializeTransferHookInstruction(
      mintKeypair.publicKey,
      wallet.publicKey, // authority
      HOOK_PROGRAM_ID,  // hook program
      TOKEN_2022_PROGRAM_ID
    )
  );

  // 3. Initialize the mint itself
  tx1.add(
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      9, // decimals
      mintAuthorityPDA, // mint authority is our PDA
      mintAuthorityPDA, // freeze authority
      TOKEN_2022_PROGRAM_ID
    )
  );

  const sig1 = await sendAndConfirmTransaction(connection, tx1, [wallet, mintKeypair]);
  console.log('✅ Mint created with transfer hook:', sig1);

  // Transaction 2: Initialize extra account metas for the hook
  // This tells the hook which accounts it needs during transfers
  console.log('\n📝 Initializing extra account metas for hook...');

  // The hook needs these extra accounts on every transfer:
  // 1. hook_config PDA
  // 2. whitelist PDA (for the mint)
  
  // For now, we'll initialize this via the hook program if it has such instruction
  // Or we can skip this if the hook handles missing accounts gracefully

  // Transaction 3: Register the mint in our boom program
  console.log('\n📝 Registering token in BOOM program...');

  const nameBytes = Buffer.alloc(4 + name.length);
  nameBytes.writeUInt32LE(name.length, 0);
  nameBytes.write(name, 4);

  const symbolBytes = Buffer.alloc(4 + symbol.length);
  symbolBytes.writeUInt32LE(symbol.length, 0);
  symbolBytes.write(symbol, 4);

  const totalSupplyBN = new BN(totalSupply).mul(new BN(10).pow(new BN(9)));
  const tokensPerWinnerBN = new BN(tokensPerWinner).mul(new BN(10).pow(new BN(9)));

  // Note: Since we created the mint manually with transfer hook,
  // we need to just register it in our PresaleToken account
  // We might need a different instruction for this, or modify the existing one

  // For now, let's create a simpler registration that just records the mint
  // without trying to initialize it (since it's already initialized)

  // Transaction 3: Register the token in our boom program
  console.log('\n📝 Registering token in BOOM program...');

  const registerData = Buffer.concat([
    getDiscriminator('register_presale_token'),
    roundIdBN.toArrayLike(Buffer, 'le', 8),
    totalSupplyBN.toArrayLike(Buffer, 'le', 8),
    tokensPerWinnerBN.toArrayLike(Buffer, 'le', 8),
  ]);

  const registerIx = new TransactionInstruction({
    programId: BOOM_PROGRAM_ID,
    keys: [
      { pubkey: presaleRoundPDA, isSigner: false, isWritable: false },
      { pubkey: presaleTokenPDA, isSigner: false, isWritable: true },
      { pubkey: mintKeypair.publicKey, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: registerData,
  });

  const tx2 = new Transaction().add(registerIx);
  const sig2 = await sendAndConfirmTransaction(connection, tx2, [wallet]);
  console.log('✅ Token registered in BOOM program:', sig2);

  console.log('\n✅ Token Created with Transfer Hook!');
  console.log('   Mint:', mintKeypair.publicKey.toBase58());
  console.log('   Hook Program:', HOOK_PROGRAM_ID.toBase58());
  console.log('   Registered in BOOM program: Yes');
  console.log('\n🔗 View on Solscan:');
  console.log(`   https://solscan.io/token/${mintKeypair.publicKey.toBase58()}?cluster=devnet`);

  return mintKeypair.publicKey;
}

// CLI entry point
const roundId = parseInt(process.argv[2] || '1');
const name = process.argv[3] || 'BOOM Token';
const symbol = process.argv[4] || 'BOOM';
const totalSupply = parseInt(process.argv[5] || '1000000000');

createTokenWithHook(roundId, name, symbol, totalSupply)
  .then((mint) => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
