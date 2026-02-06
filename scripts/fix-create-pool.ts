/**
 * Fix Pool Creation for Round 4
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
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const BOOM_PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');
const RPC_URL = 'https://api.devnet.solana.com';
const ROUND_ID = 4;

// The mint we created in the previous test
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
  
  console.log('🔧 Fixing Pool Creation for Round', ROUND_ID);
  console.log('=========================================\n');
  
  // First check what's stored in presale_token
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

  console.log('PDAs:');
  console.log('  Presale:', presalePda.toBase58());
  console.log('  PresaleToken:', presaleTokenPda.toBase58());
  console.log('  Pool:', poolPda.toBase58());
  console.log('  TokenVault:', tokenVaultPda.toBase58());
  console.log('  SolVault:', solVaultPda.toBase58());
  console.log('  Mint:', MINT.toBase58());
  console.log();

  // Check presale_token account to verify mint
  const presaleTokenAccount = await connection.getAccountInfo(presaleTokenPda);
  if (presaleTokenAccount) {
    console.log('PresaleToken account exists, size:', presaleTokenAccount.data.length);
    // Parse the mint from the account data (after 8-byte discriminator and 8-byte round_id)
    const mintBytes = presaleTokenAccount.data.slice(16, 48);
    const storedMint = new PublicKey(mintBytes);
    console.log('Stored mint:', storedMint.toBase58());
    console.log('Expected mint:', MINT.toBase58());
    console.log('Match:', storedMint.equals(MINT) ? '✅' : '❌');
  }

  // Check if pool already exists
  const poolAccount = await connection.getAccountInfo(poolPda);
  if (poolAccount) {
    console.log('\n⚠️ Pool already exists! Cannot create again.');
    console.log('Pool account size:', poolAccount.data.length);
    return;
  }

  console.log('\n📝 Creating pool...');
  
  const feeBps = 100; // 1%
  const createPoolDisc = getDiscriminator('global', 'create_pool');
  
  // Accounts in order per CreatePool struct:
  // 1. presale_round (mut)
  // 2. presale_token
  // 3. pool (init, mut)
  // 4. mint
  // 5. token_vault (init, mut)
  // 6. sol_vault (mut)
  // 7. authority (signer, mut)
  // 8. token_program
  // 9. system_program
  
  const createPoolIx = new TransactionInstruction({
    keys: [
      { pubkey: presalePda, isSigner: false, isWritable: true },
      { pubkey: presaleTokenPda, isSigner: false, isWritable: false },
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: MINT, isSigner: false, isWritable: false },
      { pubkey: tokenVaultPda, isSigner: false, isWritable: true },
      { pubkey: solVaultPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: BOOM_PROGRAM_ID,
    data: Buffer.concat([
      createPoolDisc,
      roundIdBuffer,
      Buffer.from(new Uint16Array([feeBps]).buffer),
    ]),
  });

  try {
    const tx = new Transaction().add(createPoolIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log('✅ Pool created:', sig);
  } catch (e: any) {
    console.log('❌ Error:', e.message);
    if (e.logs) {
      console.log('Logs:', e.logs);
    }
  }
}

main().catch(console.error);
