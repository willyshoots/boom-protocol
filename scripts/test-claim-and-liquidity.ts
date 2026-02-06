/**
 * Test claim flow and setup liquidity
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const BOOM_PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');
const RPC_URL = 'https://api.devnet.solana.com';
const ROUND_ID = 4;
const MINT = new PublicKey('7uey6Ef1hrFFQboP6gh72Mxrvb6Bgk5FY1hFr7sDDKRX');

const KEYPAIR_PATH = path.join(process.env.HOME!, '.config/solana/id.json');
const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));

function getDiscriminator(namespace: string, name: string): Buffer {
  const preimage = `${namespace}:${name}`;
  return crypto.createHash('sha256').update(preimage).digest().slice(0, 8);
}

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  
  console.log('🧪 Testing Claim Flow for Round', ROUND_ID);
  console.log('=====================================\n');

  const roundIdBN = new BN(ROUND_ID);
  const roundIdBuffer = roundIdBN.toArrayLike(Buffer, 'le', 8);
  
  const [presalePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );
  const [presaleTokenPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale_token'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );
  const [explosionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale_explosion'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );
  const [depositPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('deposit'), roundIdBuffer, wallet.publicKey.toBuffer()],
    BOOM_PROGRAM_ID
  );
  const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('mint_authority'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );
  
  const walletAta = getAssociatedTokenAddressSync(
    MINT,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  // Check explosion state
  console.log('Checking explosion state...');
  const explosionInfo = await connection.getAccountInfo(explosionPda);
  if (explosionInfo) {
    const data = explosionInfo.data.slice(8); // skip discriminator
    const roundId = new BN(data.slice(0, 8), 'le').toNumber();
    // cap_hash is 32 bytes at offset 8
    // revealed_cap is 8 bytes at offset 40
    // explosion_deadline is 8 bytes at offset 48
    const explosionDeadline = new BN(data.slice(48, 56), 'le').toNumber();
    const isExploded = data[56] === 1;
    
    console.log('  Round ID:', roundId);
    console.log('  Explosion Deadline:', explosionDeadline);
    console.log('  Deadline Date:', explosionDeadline > 0 ? new Date(explosionDeadline * 1000).toLocaleString() : 'NOT SET');
    console.log('  Is Exploded:', isExploded);
    console.log('  Trading Started:', explosionDeadline > 0 ? '✅ YES' : '❌ NO');
  }

  // Check deposit state
  console.log('\nChecking deposit state...');
  const depositInfo = await connection.getAccountInfo(depositPda);
  if (depositInfo) {
    const data = depositInfo.data.slice(8);
    // depositor is 32 bytes at offset 0
    // round_id is 8 bytes at offset 32
    const amount = new BN(data.slice(40, 48), 'le');
    // deposit_time is 8 bytes at offset 48
    const isWinner = data[56] === 1;
    const claimed = data[57] === 1;
    
    console.log('  Amount:', amount.toNumber() / LAMPORTS_PER_SOL, 'SOL');
    console.log('  Is Winner:', isWinner ? '✅' : '❌');
    console.log('  Claimed:', claimed ? 'Yes' : 'No');
  }

  // Try to claim winner tokens
  console.log('\n📝 Attempting to claim winner tokens...');
  
  const claimDisc = getDiscriminator('global', 'claim_winner_tokens');
  
  // Accounts per ClaimWinnerTokens struct:
  // presale_round, presale_token, presale_explosion, user_deposit, mint, mint_authority, winner_token_account, depositor, winner, token_program
  
  const claimIx = new TransactionInstruction({
    keys: [
      { pubkey: presalePda, isSigner: false, isWritable: false },
      { pubkey: presaleTokenPda, isSigner: false, isWritable: false },
      { pubkey: explosionPda, isSigner: false, isWritable: false },
      { pubkey: depositPda, isSigner: false, isWritable: true },
      { pubkey: MINT, isSigner: false, isWritable: true },
      { pubkey: mintAuthorityPda, isSigner: false, isWritable: false },
      { pubkey: walletAta, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: false, isWritable: false }, // depositor (CHECK account)
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },   // winner (signer)
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: BOOM_PROGRAM_ID,
    data: claimDisc,
  });

  try {
    const tx = new Transaction().add(claimIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log('✅ Tokens claimed:', sig);
    
    // Check balance
    const tokenBalance = await connection.getTokenAccountBalance(walletAta);
    console.log('Token balance:', tokenBalance.value.uiAmount, 'tokens');
  } catch (e: any) {
    console.log('❌ Claim failed:', e.message);
    // Check if it's the "TradingNotStarted" error
    if (e.logs) {
      const relevantLogs = e.logs.filter((l: string) => l.includes('Error') || l.includes('failed'));
      console.log('Relevant logs:', relevantLogs);
    }
  }
}

main().catch(console.error);
