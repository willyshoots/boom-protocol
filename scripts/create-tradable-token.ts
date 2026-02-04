/**
 * Create a tradable token with LP on Raydium
 * 
 * Flow:
 * 1. Create Token2022 mint with WALLET as authority (not PDA)
 * 2. Mint tokens to wallet
 * 3. Register token with BOOM protocol
 * 4. Create Raydium LP
 * 5. Register LP with protocol
 * 6. Revoke mint authority
 */

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  SystemProgram, 
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createMintToInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
  ExtensionType,
  createInitializeTransferHookInstruction,
  createSetAuthorityInstruction,
  AuthorityType,
} from '@solana/spl-token';
import * as fs from 'fs';
import { createHash } from 'crypto';

const PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');
const HOOK_PROGRAM_ID = new PublicKey('CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9');

const walletPath = process.env.HOME + '/.config/solana/id.json';
const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const authority = Keypair.fromSecretKey(new Uint8Array(secretKey));

function getDiscriminator(name: string): Buffer {
  const hash = createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

function encodeU64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value, 0);
  return buf;
}

async function createTradableToken(roundId: number) {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  console.log('🚀 Creating Tradable Token with Raydium LP');
  console.log('==========================================\n');
  console.log('Authority:', authority.publicKey.toString());
  console.log('Round ID:', roundId);

  const roundIdBuf = Buffer.alloc(8);
  roundIdBuf.writeBigUInt64LE(BigInt(roundId), 0);

  // PDAs
  const [presalePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale'), roundIdBuf],
    PROGRAM_ID
  );
  const [presaleTokenPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('presale_token'), roundIdBuf],
    PROGRAM_ID
  );
  const [mintAuthorityPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('mint_authority'), roundIdBuf],
    PROGRAM_ID
  );

  // Token config
  const DECIMALS = 9;
  const TOTAL_SUPPLY = BigInt(1_000_000_000) * BigInt(10 ** DECIMALS); // 1B tokens
  const LP_TOKENS = TOTAL_SUPPLY * BigInt(90) / BigInt(100); // 90% to LP
  const WINNER_TOKENS = TOTAL_SUPPLY * BigInt(10) / BigInt(100); // 10% to winners

  // Generate new mint
  const mintKeypair = Keypair.generate();
  console.log('\n📝 Step 1: Creating Token Mint');
  console.log('Mint:', mintKeypair.publicKey.toString());

  // Create mint with transfer hook, authority as mint authority
  const extensions = [ExtensionType.TransferHook];
  const mintLen = getMintLen(extensions);
  const mintRent = await connection.getMinimumBalanceForRentExemption(mintLen);

  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: authority.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: mintLen,
      lamports: mintRent,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeTransferHookInstruction(
      mintKeypair.publicKey,
      authority.publicKey,
      HOOK_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID,
    ),
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      DECIMALS,
      authority.publicKey, // Authority is mint authority (for now)
      null, // no freeze authority
      TOKEN_2022_PROGRAM_ID,
    ),
  );

  await sendAndConfirmTransaction(connection, createMintTx, [authority, mintKeypair]);
  console.log('✅ Mint created');

  // Step 2: Create ATA and mint tokens to authority
  console.log('\n📝 Step 2: Minting tokens to authority wallet');
  
  const authorityATA = getAssociatedTokenAddressSync(
    mintKeypair.publicKey,
    authority.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
  );

  const mintTokensTx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      authority.publicKey,
      authorityATA,
      authority.publicKey,
      mintKeypair.publicKey,
      TOKEN_2022_PROGRAM_ID,
    ),
    createMintToInstruction(
      mintKeypair.publicKey,
      authorityATA,
      authority.publicKey,
      LP_TOKENS, // Mint LP portion first
      [],
      TOKEN_2022_PROGRAM_ID,
    ),
  );

  await sendAndConfirmTransaction(connection, mintTokensTx, [authority]);
  console.log('✅ Minted', (Number(LP_TOKENS) / 10**DECIMALS).toLocaleString(), 'tokens to authority');

  // Step 3: Register token with BOOM protocol
  console.log('\n📝 Step 3: Registering token with BOOM protocol');
  
  const winnersCount = 1; // For testing, just 1 winner (Troy)
  const tokensPerWinner = WINNER_TOKENS / BigInt(winnersCount);

  const registerData = Buffer.concat([
    getDiscriminator('register_presale_token'),
    encodeU64(BigInt(roundId)),
    encodeU64(TOTAL_SUPPLY),
    encodeU64(tokensPerWinner),
  ]);

  const registerIx = new TransactionInstruction({
    keys: [
      { pubkey: presalePDA, isSigner: false, isWritable: false },
      { pubkey: presaleTokenPDA, isSigner: false, isWritable: true },
      { pubkey: mintKeypair.publicKey, isSigner: false, isWritable: false },
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: registerData,
  });

  try {
    const registerTx = new Transaction().add(registerIx);
    await sendAndConfirmTransaction(connection, registerTx, [authority]);
    console.log('✅ Token registered with protocol');
  } catch (err: any) {
    if (err.message?.includes('already in use')) {
      console.log('ℹ️  Token already registered');
    } else {
      throw err;
    }
  }

  // Step 4: Transfer mint authority to PDA (so program can mint winner tokens)
  console.log('\n📝 Step 4: Transferring mint authority to program PDA');
  
  const transferAuthTx = new Transaction().add(
    createSetAuthorityInstruction(
      mintKeypair.publicKey,
      authority.publicKey,
      AuthorityType.MintTokens,
      mintAuthorityPDA, // Transfer to PDA
      [],
      TOKEN_2022_PROGRAM_ID,
    ),
  );

  await sendAndConfirmTransaction(connection, transferAuthTx, [authority]);
  console.log('✅ Mint authority transferred to PDA:', mintAuthorityPDA.toString());

  console.log('\n🎉 Token Creation Complete!');
  console.log('='.repeat(50));
  console.log('Mint:', mintKeypair.publicKey.toString());
  console.log('Authority ATA:', authorityATA.toString());
  console.log('LP Tokens in wallet:', (Number(LP_TOKENS) / 10**DECIMALS).toLocaleString());
  console.log('\nNext: Run create-lp.ts to create Raydium pool');

  return {
    mint: mintKeypair.publicKey.toString(),
    authorityATA: authorityATA.toString(),
    lpTokens: LP_TOKENS.toString(),
  };
}

// CLI
const roundId = parseInt(process.argv[2] || '3'); // Default to round 3 (fresh)
createTradableToken(roundId)
  .then(console.log)
  .catch(console.error);
