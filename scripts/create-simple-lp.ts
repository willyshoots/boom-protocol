/**
 * Simple LP Test - Create standard SPL token + Raydium pool
 * Bypasses Token2022 to verify Raydium LP works
 */

import { Raydium, DEVNET_PROGRAM_ID, getCpmmPdaAmmConfigId } from '@raydium-io/raydium-sdk-v2';
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  clusterApiUrl, 
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  createMintToInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
  getMinimumBalanceForRentExemptMint
} from '@solana/spl-token';
// @ts-ignore
import BN from 'bn.js';
import fs from 'fs';

const RPC_URL = process.env.RPC_URL || clusterApiUrl('devnet');

// Load wallet
const walletPath = process.env.HOME + '/.config/solana/id.json';
const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(secretKey));

async function createSimpleLp() {
  const connection = new Connection(RPC_URL, 'confirmed');
  
  console.log('🧪 Simple LP Test (Standard SPL Token)');
  console.log('======================================\n');
  console.log('Wallet:', wallet.publicKey.toBase58());

  // Step 1: Create a standard SPL token
  console.log('\n📝 Step 1: Creating standard SPL token mint...');
  
  const mintKeypair = Keypair.generate();
  const mintRent = await getMinimumBalanceForRentExemptMint(connection);
  
  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: getMintLen([]),
      lamports: mintRent,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      9,
      wallet.publicKey,
      wallet.publicKey,
      TOKEN_PROGRAM_ID
    )
  );
  
  await sendAndConfirmTransaction(connection, createMintTx, [wallet, mintKeypair]);
  console.log('✅ Mint created:', mintKeypair.publicKey.toBase58());

  // Step 2: Create ATA and mint tokens
  console.log('\n📝 Step 2: Minting tokens...');
  
  const ata = getAssociatedTokenAddressSync(
    mintKeypair.publicKey,
    wallet.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );
  
  const mintTokensTx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      ata,
      wallet.publicKey,
      mintKeypair.publicKey,
      TOKEN_PROGRAM_ID
    ),
    createMintToInstruction(
      mintKeypair.publicKey,
      ata,
      wallet.publicKey,
      1_000_000_000n * 1_000_000_000n, // 1B tokens with 9 decimals
      [],
      TOKEN_PROGRAM_ID
    )
  );
  
  await sendAndConfirmTransaction(connection, mintTokensTx, [wallet]);
  console.log('✅ Minted 1B tokens to:', ata.toBase58());

  // Step 3: Create Raydium LP
  console.log('\n📝 Step 3: Creating Raydium CPMM pool...');
  
  const raydium = await Raydium.load({
    connection,
    owner: wallet,
    cluster: 'devnet',
    disableLoadToken: false,
  });

  const feeConfigs = await raydium.api.getCpmmConfigs();
  feeConfigs.forEach((config) => {
    config.id = getCpmmPdaAmmConfigId(
      DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,
      config.index
    ).publicKey.toBase58();
  });

  const mintA = {
    address: 'So11111111111111111111111111111111111111112', // Wrapped SOL
    programId: TOKEN_PROGRAM_ID.toBase58(),
    decimals: 9,
  };

  const mintB = {
    address: mintKeypair.publicKey.toBase58(),
    programId: TOKEN_PROGRAM_ID.toBase58(),
    decimals: 9,
  };

  const solAmount = new BN(500000000); // 0.5 SOL
  const tokenAmount = new BN('100000000000000000'); // 100M tokens

  console.log('SOL amount:', solAmount.toString(), 'lamports');
  console.log('Token amount:', tokenAmount.toString());

  try {
    const { execute, extInfo } = await raydium.cpmm.createPool({
      programId: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,
      poolFeeAccount: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC,
      mintA,
      mintB,
      mintAAmount: solAmount,
      mintBAmount: tokenAmount,
      startTime: new BN(0),
      feeConfig: feeConfigs[0],
      associatedOnly: false,
      ownerInfo: {
        useSOLBalance: true,
      },
      // @ts-ignore
      txVersion: 'V0',
    });

    const { txId } = await execute({ sendAndConfirm: true });
    
    console.log('\n✅ Pool Created Successfully!');
    console.log('Transaction:', txId);
    console.log('\nPool Keys:');
    Object.entries(extInfo.address).forEach(([key, value]) => {
      console.log(`  ${key}: ${value}`);
    });

    return {
      success: true,
      mint: mintKeypair.publicKey.toBase58(),
      poolId: extInfo.address.poolId?.toString(),
    };
  } catch (err: any) {
    console.error('\n❌ Pool creation failed:', err.message);
    throw err;
  }
}

createSimpleLp().catch(console.error);
