/**
 * BOOM Protocol - Proper LP Creation (Devnet Compatible)
 * 
 * Creates a standard SPL token + Raydium LP for devnet testing.
 * Token2022 with FluxBeam would be used on mainnet.
 * 
 * Usage: npx ts-node scripts/create-lp-proper.ts <round_id>
 */

import { Raydium, DEVNET_PROGRAM_ID, getCpmmPdaAmmConfigId } from '@raydium-io/raydium-sdk-v2';
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  clusterApiUrl, 
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress
} from '@solana/spl-token';
// @ts-ignore
import BN from 'bn.js';
import fs from 'fs';
import path from 'path';
import * as anchor from '@coral-xyz/anchor';

// Config
const BOOM_PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const KEYPAIR_PATH = process.env.KEYPAIR_PATH || path.join(process.env.HOME!, '.config/solana/id.json');

// Token config
const TOKEN_DECIMALS = 9;
const TOTAL_SUPPLY = 100_000_000; // 100M tokens
const LP_TOKEN_AMOUNT = 90_000_000; // 90% to LP
const SOL_AMOUNT = 0.5; // 0.5 SOL initial liquidity

// PDA helpers
function getPresaleRoundPDA(roundId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('presale'), roundId.toArrayLike(Buffer, 'le', 8)],
    BOOM_PROGRAM_ID
  );
}

function getPresaleTokenPDA(roundId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('presale_token'), roundId.toArrayLike(Buffer, 'le', 8)],
    BOOM_PROGRAM_ID
  );
}

function getLpInfoPDA(roundId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('lp_info'), roundId.toArrayLike(Buffer, 'le', 8)],
    BOOM_PROGRAM_ID
  );
}

function getMintAuthorityPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('mint_authority')],
    BOOM_PROGRAM_ID
  );
}

async function createLPProper(roundId: number) {
  console.log('🚀 BOOM Protocol - Proper LP Creation');
  console.log('=====================================\n');

  // Load wallet
  const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
  const wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));
  console.log('Wallet:', wallet.publicKey.toBase58());

  // Connect
  const connection = new Connection(RPC_URL, 'confirmed');
  const balance = await connection.getBalance(wallet.publicKey);
  console.log('Balance:', balance / LAMPORTS_PER_SOL, 'SOL');
  console.log('RPC:', RPC_URL);

  // Get presale state
  const roundIdBN = new BN(roundId);
  const [presaleRoundPDA] = getPresaleRoundPDA(roundIdBN);
  const [presaleTokenPDA] = getPresaleTokenPDA(roundIdBN);
  const [lpInfoPDA] = getLpInfoPDA(roundIdBN);
  const [mintAuthorityPDA] = getMintAuthorityPDA();

  console.log('\n📊 PDAs:');
  console.log('Presale Round:', presaleRoundPDA.toBase58());
  console.log('Presale Token:', presaleTokenPDA.toBase58());
  console.log('LP Info:', lpInfoPDA.toBase58());
  console.log('Mint Authority:', mintAuthorityPDA.toBase58());

  // Verify presale is finalized
  const presaleRoundInfo = await connection.getAccountInfo(presaleRoundPDA);
  if (!presaleRoundInfo) {
    throw new Error('Presale round not found');
  }
  const presaleData = presaleRoundInfo.data.slice(8);
  const isFinalized = presaleData[88] === 1;
  const totalDeposited = new BN(presaleData.slice(76, 84), 'le');
  
  console.log('\n📈 Presale State:');
  console.log('Is Finalized:', isFinalized);
  console.log('Total Deposited:', totalDeposited.toNumber() / LAMPORTS_PER_SOL, 'SOL');

  if (!isFinalized) {
    throw new Error('Presale must be finalized first!');
  }

  // Check if presale token already exists
  const existingTokenInfo = await connection.getAccountInfo(presaleTokenPDA);
  let tokenMint: PublicKey;

  if (existingTokenInfo) {
    // Parse existing token
    const tokenData = existingTokenInfo.data.slice(8);
    tokenMint = new PublicKey(tokenData.slice(8, 40));
    console.log('\n⚠️ Token already exists:', tokenMint.toBase58());
    console.log('Skipping token creation...');
  } else {
    // ==================== STEP 1: Create Standard SPL Token ====================
    console.log('\n🪙 STEP 1: Creating Standard SPL Token...');
    
    tokenMint = await createMint(
      connection,
      wallet,
      wallet.publicKey, // mint authority
      wallet.publicKey, // freeze authority
      TOKEN_DECIMALS,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );
    
    console.log('✅ Token Mint created:', tokenMint.toBase58());

    // Create token account and mint supply
    console.log('Minting initial supply...');
    const walletTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet,
      tokenMint,
      wallet.publicKey
    );

    const totalSupplyLamports = BigInt(TOTAL_SUPPLY) * BigInt(10 ** TOKEN_DECIMALS);
    await mintTo(
      connection,
      wallet,
      tokenMint,
      walletTokenAccount.address,
      wallet,
      totalSupplyLamports
    );

    console.log('✅ Minted', TOTAL_SUPPLY.toLocaleString(), 'tokens to wallet');

    // ==================== STEP 2: Register Token in BOOM Contract ====================
    console.log('\n📝 STEP 2: Registering token in BOOM contract...');

    // Load IDL
    const idlPath = path.join(__dirname, '../target/idl/boom.json');
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));

    const provider = new anchor.AnchorProvider(
      connection,
      new anchor.Wallet(wallet),
      { commitment: 'confirmed' }
    );
    const program = new anchor.Program(idl, provider);

    // Call register_presale_token
    const tokensPerWinner = BigInt(LP_TOKEN_AMOUNT) * BigInt(10 ** TOKEN_DECIMALS) / BigInt(5); // Assume 5 winners
    
    try {
      const tx = await program.methods
        .registerPresaleToken(
          new anchor.BN(roundId),
          new anchor.BN(totalSupplyLamports.toString()),
          new anchor.BN(tokensPerWinner.toString())
        )
        .accounts({
          presaleRound: presaleRoundPDA,
          presaleToken: presaleTokenPDA,
          mint: tokenMint,
          authority: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log('✅ Token registered in BOOM contract');
      console.log('Transaction:', tx);
    } catch (e: any) {
      if (e.message?.includes('already in use')) {
        console.log('Token already registered, continuing...');
      } else {
        throw e;
      }
    }
  }

  // ==================== STEP 3: Create Raydium LP ====================
  console.log('\n🏊 STEP 3: Creating Raydium CPMM Pool...');

  // Initialize Raydium SDK
  const raydium = await Raydium.load({
    connection,
    owner: wallet,
    cluster: 'devnet',
    disableLoadToken: false,
  });

  // Get fee configs
  const feeConfigs = await raydium.api.getCpmmConfigs();
  feeConfigs.forEach((config) => {
    config.id = getCpmmPdaAmmConfigId(
      DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,
      config.index
    ).publicKey.toBase58();
  });

  console.log('Fee configs loaded:', feeConfigs.length);

  // Token info
  const mintA = {
    address: 'So11111111111111111111111111111111111111112', // Wrapped SOL
    programId: TOKEN_PROGRAM_ID.toBase58(),
    decimals: 9,
  };

  const mintB = {
    address: tokenMint.toBase58(),
    programId: TOKEN_PROGRAM_ID.toBase58(),
    decimals: TOKEN_DECIMALS,
  };

  // LP amounts
  const solAmount = new BN(SOL_AMOUNT * LAMPORTS_PER_SOL);
  const tokenAmount = new BN(LP_TOKEN_AMOUNT).mul(new BN(10 ** TOKEN_DECIMALS));

  console.log('\n💰 LP Amounts:');
  console.log('SOL:', SOL_AMOUNT);
  console.log('Tokens:', LP_TOKEN_AMOUNT.toLocaleString());

  // Create the pool
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

  console.log('Executing pool creation...');
  const { txId } = await execute({ sendAndConfirm: true });

  const poolId = extInfo.address.poolId?.toString() || '';
  const lpMint = extInfo.address.lpMint?.toString() || '';
  const vaultA = extInfo.address.vaultA?.toString() || '';
  const vaultB = extInfo.address.vaultB?.toString() || '';

  console.log('\n✅ Raydium Pool Created!');
  console.log('Transaction:', txId);
  console.log('Pool ID:', poolId);
  console.log('LP Mint:', lpMint);
  console.log('Vault A (SOL):', vaultA);
  console.log('Vault B (Token):', vaultB);

  // ==================== STEP 4: Register LP in BOOM Contract ====================
  console.log('\n📝 STEP 4: Registering LP in BOOM contract...');

  // Load IDL again if needed
  const idlPath = path.join(__dirname, '../target/idl/boom.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: 'confirmed' }
  );
  const program = new anchor.Program(idl, provider);

  try {
    const registerLpTx = await program.methods
      .registerLp(
        new anchor.BN(roundId),
        new PublicKey(poolId),
        new PublicKey(lpMint),
        new PublicKey(vaultA),
        new PublicKey(vaultB)
      )
      .accounts({
        presaleRound: presaleRoundPDA,
        lpInfo: lpInfoPDA,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log('✅ LP registered in BOOM contract');
    console.log('Transaction:', registerLpTx);
  } catch (e: any) {
    console.log('LP registration error:', e.message);
    // May fail if LP already registered, that's OK
  }

  // ==================== Summary ====================
  console.log('\n🎉 LP Creation Complete!');
  console.log('==========================================');
  console.log('Round ID:', roundId);
  console.log('Token Mint:', tokenMint.toBase58());
  console.log('Pool ID:', poolId);
  console.log('LP Mint:', lpMint);
  console.log('\nExplorer Links:');
  console.log('Token:', `https://solscan.io/token/${tokenMint.toBase58()}?cluster=devnet`);
  console.log('Pool:', `https://solscan.io/account/${poolId}?cluster=devnet`);
  console.log('Transaction:', `https://solscan.io/tx/${txId}?cluster=devnet`);

  return {
    tokenMint: tokenMint.toBase58(),
    poolId,
    lpMint,
    vaultA,
    vaultB,
    txId,
  };
}

// CLI entry point
const roundId = parseInt(process.argv[2] || '11');
if (isNaN(roundId)) {
  console.error('Usage: npx ts-node scripts/create-lp-proper.ts <round_id>');
  process.exit(1);
}

createLPProper(roundId)
  .then((result) => {
    console.log('\n✅ Result:', JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Error:', err);
    process.exit(1);
  });
