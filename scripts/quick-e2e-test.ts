/**
 * BOOM Protocol - Quick E2E Test
 * 
 * Runs through the entire flow:
 * 1. Deposits to presale
 * 2. Finalizes presale (authority override)
 * 3. Creates standard SPL token
 * 4. Creates Raydium LP
 * 5. Registers everything
 */

import { Raydium, DEVNET_PROGRAM_ID, getCpmmPdaAmmConfigId } from '@raydium-io/raydium-sdk-v2';
import { 
  Connection, 
  Keypair, 
  PublicKey, 
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
} from '@solana/spl-token';
// @ts-ignore
import BN from 'bn.js';
import fs from 'fs';
import path from 'path';
import * as anchor from '@coral-xyz/anchor';

// Config
const BOOM_PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');
const RPC_URL = 'https://api.devnet.solana.com';
const KEYPAIR_PATH = path.join(process.env.HOME!, '.config/solana/id.json');

const TOKEN_DECIMALS = 9;
const TOTAL_SUPPLY = 100_000_000;
const LP_TOKEN_AMOUNT = 90_000_000;
const SOL_AMOUNT = 0.5;

function getPresaleRoundPDA(roundId: number): [PublicKey, number] {
  const roundIdBN = new BN(roundId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('presale'), roundIdBN.toArrayLike(Buffer, 'le', 8)],
    BOOM_PROGRAM_ID
  );
}

function getPresaleTokenPDA(roundId: number): [PublicKey, number] {
  const roundIdBN = new BN(roundId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('presale_token'), roundIdBN.toArrayLike(Buffer, 'le', 8)],
    BOOM_PROGRAM_ID
  );
}

function getLpInfoPDA(roundId: number): [PublicKey, number] {
  const roundIdBN = new BN(roundId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('lp_info'), roundIdBN.toArrayLike(Buffer, 'le', 8)],
    BOOM_PROGRAM_ID
  );
}

function getDepositorPDA(roundId: number, depositor: PublicKey): [PublicKey, number] {
  const roundIdBN = new BN(roundId);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('depositor'),
      roundIdBN.toArrayLike(Buffer, 'le', 8),
      depositor.toBuffer()
    ],
    BOOM_PROGRAM_ID
  );
}

function getPresaleVaultPDA(roundId: number): [PublicKey, number] {
  const roundIdBN = new BN(roundId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('presale_vault'), roundIdBN.toArrayLike(Buffer, 'le', 8)],
    BOOM_PROGRAM_ID
  );
}

async function quickE2ETest(roundId: number) {
  console.log('🚀 BOOM Protocol - Quick E2E Test');
  console.log('==================================\n');
  console.log('Round:', roundId);

  const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
  const wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));
  const connection = new Connection(RPC_URL, 'confirmed');

  console.log('Wallet:', wallet.publicKey.toBase58());
  const balance = await connection.getBalance(wallet.publicKey);
  console.log('Balance:', balance / LAMPORTS_PER_SOL, 'SOL\n');

  const [presaleRoundPDA] = getPresaleRoundPDA(roundId);
  const [presaleTokenPDA] = getPresaleTokenPDA(roundId);
  const [lpInfoPDA] = getLpInfoPDA(roundId);
  const [depositorPDA] = getDepositorPDA(roundId, wallet.publicKey);
  const [vaultPDA] = getPresaleVaultPDA(roundId);

  // Load Anchor program
  const idlPath = path.join(process.cwd(), 'target/idl/boom.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: 'confirmed' }
  );
  const program = new anchor.Program(idl, provider);

  // ==================== STEP 1: Deposit ====================
  console.log('📥 STEP 1: Depositing to presale...');
  
  const depositAmount = 0.2 * LAMPORTS_PER_SOL;
  
  try {
    const depositTx = await program.methods
      .deposit(new anchor.BN(depositAmount))
      .accounts({
        presaleRound: presaleRoundPDA,
        depositor: depositorPDA,
        vault: vaultPDA,
        user: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log('✅ Deposited', depositAmount / LAMPORTS_PER_SOL, 'SOL');
    console.log('   Tx:', depositTx);
  } catch (e: any) {
    if (e.message?.includes('already in use') || e.message?.includes('AlreadyDeposited')) {
      console.log('⚠️ Already deposited, continuing...');
    } else {
      console.log('Deposit error:', e.message);
    }
  }

  // ==================== STEP 2: Finalize Presale ====================
  console.log('\n🏁 STEP 2: Finalizing presale...');

  try {
    const presaleInfo = await connection.getAccountInfo(presaleRoundPDA);
    if (presaleInfo) {
      const data = presaleInfo.data.slice(8);
      const isFinalized = data[88] === 1;
      if (isFinalized) {
        console.log('✅ Presale already finalized');
      } else {
        // Call end_presale_and_lottery with winner index [0] (our deposit)
        const finalizeTx = await program.methods
          .endPresaleAndLottery([0]) // First depositor (us) as winner
          .accounts({
            presaleRound: presaleRoundPDA,
            authority: wallet.publicKey,
          })
          .rpc();
        console.log('✅ Presale finalized');
        console.log('   Tx:', finalizeTx);

        // Mark ourselves as winner
        const markWinnerTx = await program.methods
          .markWinner()
          .accounts({
            presaleRound: presaleRoundPDA,
            userDeposit: depositorPDA,
            authority: wallet.publicKey,
          })
          .rpc();
        console.log('✅ Marked as winner');
        console.log('   Tx:', markWinnerTx);
      }
    }
  } catch (e: any) {
    console.log('Finalize error:', e.message);
    if (e.logs) {
      console.log('Logs:', e.logs.slice(-5));
    }
  }

  // ==================== STEP 3: Create Standard SPL Token ====================
  console.log('\n🪙 STEP 3: Creating Standard SPL Token...');

  let tokenMint: PublicKey;
  const existingTokenInfo = await connection.getAccountInfo(presaleTokenPDA);
  
  if (existingTokenInfo) {
    const tokenData = existingTokenInfo.data.slice(8);
    tokenMint = new PublicKey(tokenData.slice(8, 40));
    console.log('⚠️ Token already exists:', tokenMint.toBase58());
  } else {
    tokenMint = await createMint(
      connection,
      wallet,
      wallet.publicKey,
      wallet.publicKey,
      TOKEN_DECIMALS,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );
    console.log('✅ Token created:', tokenMint.toBase58());

    // Mint supply to wallet
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
    console.log('✅ Minted', TOTAL_SUPPLY.toLocaleString(), 'tokens');

    // Register token in contract
    try {
      const tokensPerWinner = totalSupplyLamports / BigInt(25); // 25 lottery spots
      const registerTx = await program.methods
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
      console.log('✅ Token registered in contract');
      console.log('   Tx:', registerTx);
    } catch (e: any) {
      console.log('Register token error:', e.message);
    }
  }

  // ==================== STEP 4: Create Raydium LP ====================
  console.log('\n🏊 STEP 4: Creating Raydium CPMM Pool...');

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
    address: 'So11111111111111111111111111111111111111112',
    programId: TOKEN_PROGRAM_ID.toBase58(),
    decimals: 9,
  };

  const mintB = {
    address: tokenMint.toBase58(),
    programId: TOKEN_PROGRAM_ID.toBase58(),
    decimals: TOKEN_DECIMALS,
  };

  const solAmountBN = new BN(SOL_AMOUNT * LAMPORTS_PER_SOL);
  const tokenAmountBN = new BN(LP_TOKEN_AMOUNT).mul(new BN(10 ** TOKEN_DECIMALS));

  console.log('SOL:', SOL_AMOUNT);
  console.log('Tokens:', LP_TOKEN_AMOUNT.toLocaleString());

  try {
    const { execute, extInfo } = await raydium.cpmm.createPool({
      programId: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,
      poolFeeAccount: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC,
      mintA,
      mintB,
      mintAAmount: solAmountBN,
      mintBAmount: tokenAmountBN,
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

    const poolId = extInfo.address.poolId?.toString() || '';
    const lpMint = extInfo.address.lpMint?.toString() || '';
    const vaultA = extInfo.address.vaultA?.toString() || '';
    const vaultB = extInfo.address.vaultB?.toString() || '';

    console.log('\n✅ Raydium Pool Created!');
    console.log('   Tx:', txId);
    console.log('   Pool ID:', poolId);
    console.log('   LP Mint:', lpMint);

    // ==================== STEP 5: Register LP ====================
    console.log('\n📝 STEP 5: Registering LP in contract...');

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

      console.log('✅ LP registered in contract');
      console.log('   Tx:', registerLpTx);
    } catch (e: any) {
      console.log('Register LP error:', e.message);
    }

    // ==================== Summary ====================
    console.log('\n🎉 E2E Test Complete!');
    console.log('==========================================');
    console.log('Round:', roundId);
    console.log('Token:', tokenMint.toBase58());
    console.log('Pool:', poolId);
    console.log('\n📱 Test trading at:');
    console.log(`https://raydium.io/swap/?inputMint=sol&outputMint=${tokenMint.toBase58()}`);

    return { success: true, tokenMint: tokenMint.toBase58(), poolId };

  } catch (e: any) {
    console.error('\n❌ LP creation failed:', e.message);
    throw e;
  }
}

const roundId = parseInt(process.argv[2] || '12');
quickE2ETest(roundId)
  .then(console.log)
  .catch((e) => {
    console.error('Failed:', e);
    process.exit(1);
  });
