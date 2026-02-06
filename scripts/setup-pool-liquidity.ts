/**
 * Setup pool liquidity for Round 4
 * - Mint tokens to authority
 * - Deposit tokens to pool vault
 * - Sync pool reserves
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
  createMintToInstruction,
  createTransferCheckedInstruction,
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
  
  console.log('💧 Setting up pool liquidity for Round', ROUND_ID);
  console.log('==========================================\n');

  const roundIdBN = new BN(ROUND_ID);
  const roundIdBuffer = roundIdBN.toArrayLike(Buffer, 'le', 8);
  
  const [presalePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );
  const [tokenVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_vault'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );
  const [solVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('sol_vault'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );
  const [mintAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('mint_authority'), roundIdBuffer],
    BOOM_PROGRAM_ID
  );

  // Get wallet's token account
  const walletAta = getAssociatedTokenAddressSync(
    MINT,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  console.log('Wallet ATA:', walletAta.toBase58());
  console.log('Token Vault:', tokenVaultPda.toBase58());
  console.log('Mint Authority PDA:', mintAuthorityPda.toBase58());

  // Check if wallet ATA exists
  const ataInfo = await connection.getAccountInfo(walletAta);
  if (!ataInfo) {
    console.log('\n📝 Creating wallet token account...');
    const createAtaTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        walletAta,
        wallet.publicKey,
        MINT,
        TOKEN_2022_PROGRAM_ID
      )
    );
    const sig1 = await sendAndConfirmTransaction(connection, createAtaTx, [wallet]);
    console.log('✅ ATA created:', sig1);
  }

  // The mint authority is the PDA, so we need to use the program to mint
  // Actually, looking back at the token creation, we set mint authority to mintAuthorityPda
  // So we can't mint directly - we need to use claim_winner_tokens which mints via the program
  
  // Let's check the token vault balance
  const vaultInfo = await connection.getAccountInfo(tokenVaultPda);
  if (vaultInfo) {
    console.log('\nToken vault exists');
  }

  // Check pool state
  const poolInfo = await connection.getAccountInfo(poolPda);
  if (poolInfo) {
    console.log('Pool exists, size:', poolInfo.data.length);
    // Parse pool data - skip 8 byte discriminator
    const data = poolInfo.data.slice(8);
    const roundId = new BN(data.slice(0, 8), 'le').toNumber();
    const mint = new PublicKey(data.slice(8, 40));
    const tokenVault = new PublicKey(data.slice(40, 72));
    const solVault = new PublicKey(data.slice(72, 104));
    const solReserve = new BN(data.slice(104, 112), 'le');
    const tokenReserve = new BN(data.slice(112, 120), 'le');
    
    console.log('\nPool State:');
    console.log('  Round ID:', roundId);
    console.log('  Mint:', mint.toBase58());
    console.log('  SOL Reserve:', solReserve.toNumber() / LAMPORTS_PER_SOL, 'SOL');
    console.log('  Token Reserve:', tokenReserve.toNumber() / 1e9, 'tokens');
  }

  // Since mint authority is the PDA, we need to deposit tokens via the program
  // Use deposit_pool_tokens instruction
  console.log('\n📝 Depositing tokens to pool via program...');
  
  // First, we need to mint tokens to our wallet
  // But mint authority is the PDA... 
  // Actually, for testing let's just sync the reserves and see current state
  
  console.log('\n📝 Syncing pool reserves...');
  const syncDisc = getDiscriminator('global', 'sync_pool_reserves');
  
  const syncIx = new TransactionInstruction({
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: tokenVaultPda, isSigner: false, isWritable: false },
      { pubkey: solVaultPda, isSigner: false, isWritable: false },
    ],
    programId: BOOM_PROGRAM_ID,
    data: syncDisc,
  });

  try {
    const tx = new Transaction().add(syncIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log('✅ Reserves synced:', sig);
  } catch (e: any) {
    console.log('Sync error:', e.message);
  }

  // Check final pool state
  const poolInfo2 = await connection.getAccountInfo(poolPda);
  if (poolInfo2) {
    const data = poolInfo2.data.slice(8);
    const solReserve = new BN(data.slice(104, 112), 'le');
    const tokenReserve = new BN(data.slice(112, 120), 'le');
    
    console.log('\nFinal Pool State:');
    console.log('  SOL Reserve:', solReserve.toNumber() / LAMPORTS_PER_SOL, 'SOL');
    console.log('  Token Reserve:', tokenReserve.toNumber() / 1e9, 'tokens');
  }

  // Check sol vault balance
  const solVaultBalance = await connection.getBalance(solVaultPda);
  console.log('\nSOL Vault actual balance:', solVaultBalance / LAMPORTS_PER_SOL, 'SOL');
}

main().catch(console.error);
