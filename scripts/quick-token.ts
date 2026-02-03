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
  getMintLen,
  ExtensionType,
  createInitializeTransferHookInstruction,
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

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const roundId = 1;

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

  // Generate new mint keypair
  const mintKeypair = Keypair.generate();
  console.log('Creating token with transfer hook...');
  console.log('Mint:', mintKeypair.publicKey.toString());
  console.log('Presale Token PDA:', presaleTokenPDA.toString());

  // Create mint with transfer hook extension
  const extensions = [ExtensionType.TransferHook];
  const mintLen = getMintLen(extensions);
  const mintRent = await connection.getMinimumBalanceForRentExemption(mintLen);

  // Token supply: 1 billion with 9 decimals
  const totalSupply = BigInt(1_000_000_000) * BigInt(10 ** 9);
  const winnersCount = 1; // Just Troy
  const tokensPerWinner = totalSupply / BigInt(winnersCount);

  // Instructions
  const createAccountIx = SystemProgram.createAccount({
    fromPubkey: authority.publicKey,
    newAccountPubkey: mintKeypair.publicKey,
    space: mintLen,
    lamports: mintRent,
    programId: TOKEN_2022_PROGRAM_ID,
  });

  const initHookIx = createInitializeTransferHookInstruction(
    mintKeypair.publicKey,
    authority.publicKey,
    HOOK_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
  );

  const initMintIx = createInitializeMintInstruction(
    mintKeypair.publicKey,
    9, // decimals
    mintAuthorityPDA,
    null, // no freeze authority
    TOKEN_2022_PROGRAM_ID,
  );

  // Register with BOOM protocol
  // register_presale_token(round_id: u64, total_supply: u64, tokens_per_winner: u64)
  const registerData = Buffer.concat([
    getDiscriminator('register_presale_token'),
    encodeU64(BigInt(roundId)),
    encodeU64(totalSupply),
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
    const tx = new Transaction()
      .add(createAccountIx)
      .add(initHookIx)
      .add(initMintIx)
      .add(registerIx);

    const sig = await sendAndConfirmTransaction(connection, tx, [authority, mintKeypair]);
    console.log('✅ Token created!');
    console.log('Transaction:', sig);
    console.log('\nMint address:', mintKeypair.publicKey.toString());
    console.log('Total supply:', (Number(totalSupply) / 10**9).toLocaleString(), 'tokens');
    console.log('Tokens per winner:', (Number(tokensPerWinner) / 10**9).toLocaleString(), 'tokens');
  } catch (err: any) {
    console.error('Error:', err.message);
    if (err.logs) console.error('Logs:', err.logs.slice(-5));
  }
}

main();
