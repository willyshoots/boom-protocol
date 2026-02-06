/**
 * Deposit tokens to pool (fixed accounts)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
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
  
  console.log('💰 Depositing tokens to pool (fixed)');
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
  
  const walletAta = getAssociatedTokenAddressSync(
    MINT,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  // Check current balance
  const tokenBalance = await connection.getTokenAccountBalance(walletAta);
  console.log('Wallet token balance:', tokenBalance.value.uiAmount, 'tokens');

  // Deposit 5M tokens
  const depositAmount = new BN(5_000_000).mul(new BN(10).pow(new BN(9)));
  console.log('Depositing: 5,000,000 tokens\n');

  const depositDisc = getDiscriminator('global', 'deposit_pool_tokens');
  
  // Accounts in order: presale_round, presale_token, mint, token_vault, authority_token_account, authority, token_program
  const depositIx = new TransactionInstruction({
    keys: [
      { pubkey: presalePda, isSigner: false, isWritable: false },
      { pubkey: presaleTokenPda, isSigner: false, isWritable: false },
      { pubkey: MINT, isSigner: false, isWritable: false },
      { pubkey: tokenVaultPda, isSigner: false, isWritable: true },
      { pubkey: walletAta, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: BOOM_PROGRAM_ID,
    data: Buffer.concat([
      depositDisc,
      depositAmount.toArrayLike(Buffer, 'le', 8),
    ]),
  });

  try {
    const tx = new Transaction().add(depositIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log('✅ Tokens deposited:', sig);
  } catch (e: any) {
    console.log('❌ Deposit failed:', e.message);
    if (e.logs) {
      console.log('Logs:', e.logs.slice(-5));
    }
    return;
  }

  // Sync reserves
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

  const tx2 = new Transaction().add(syncIx);
  const sig2 = await sendAndConfirmTransaction(connection, tx2, [wallet]);
  console.log('✅ Reserves synced:', sig2);

  // Check final state
  const poolInfo = await connection.getAccountInfo(poolPda);
  if (poolInfo) {
    const data = poolInfo.data.slice(8);
    const solReserve = new BN(data.slice(104, 112), 'le');
    const tokenReserve = new BN(data.slice(112, 120), 'le');
    
    console.log('\n📊 Final Pool State:');
    console.log('  SOL Reserve:', solReserve.toNumber() / LAMPORTS_PER_SOL, 'SOL');
    console.log('  Token Reserve:', tokenReserve.toNumber() / 1e9, 'tokens');
    
    // Calculate price
    if (tokenReserve.toNumber() > 0 && solReserve.toNumber() > 0) {
      const price = (solReserve.toNumber() / tokenReserve.toNumber());
      console.log('  Token Price:', price.toFixed(12), 'SOL per token');
    }
    
    console.log('\n🎯 Pool is ready for trading!');
  }
}

main().catch(console.error);
