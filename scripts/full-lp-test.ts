/**
 * BOOM Protocol - Full LP Test
 * 
 * Complete end-to-end test:
 * 1. Deposits to presale (round already started)
 * 2. Waits for presale to end
 * 3. Finalizes presale
 * 4. Creates standard SPL token
 * 5. Creates Raydium LP
 * 
 * Usage: npx ts-node scripts/full-lp-test.ts <round_id>
 */

import { Raydium, DEVNET_PROGRAM_ID, getCpmmPdaAmmConfigId } from '@raydium-io/raydium-sdk-v2';
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  SystemProgram,
  Transaction,
  TransactionInstruction,
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
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

const BOOM_PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');
const RPC_URL = 'https://api.devnet.solana.com';
const KEYPAIR_PATH = path.join(process.env.HOME!, '.config/solana/id.json');

const TOKEN_DECIMALS = 9;
const TOTAL_SUPPLY = 100_000_000;
const LP_TOKEN_AMOUNT = 90_000_000;
const SOL_AMOUNT = 0.5;

// Helpers
function getDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

function encodeU64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

function getPresaleRoundPDA(roundId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('presale'), encodeU64(BigInt(roundId))],
    BOOM_PROGRAM_ID
  );
}

function getUserDepositPDA(roundId: number, depositor: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('deposit'), encodeU64(BigInt(roundId)), depositor.toBuffer()],
    BOOM_PROGRAM_ID
  );
}

function getPresaleTokenPDA(roundId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('presale_token'), encodeU64(BigInt(roundId))],
    BOOM_PROGRAM_ID
  );
}

function getLpInfoPDA(roundId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('lp_info'), encodeU64(BigInt(roundId))],
    BOOM_PROGRAM_ID
  );
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fullLPTest(roundId: number) {
  console.log('🚀 BOOM Protocol - Full LP Test');
  console.log('================================\n');
  console.log('Round:', roundId);

  const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
  const wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));
  const connection = new Connection(RPC_URL, 'confirmed');

  console.log('Wallet:', wallet.publicKey.toBase58());
  const balance = await connection.getBalance(wallet.publicKey);
  console.log('Balance:', balance / LAMPORTS_PER_SOL, 'SOL\n');

  const [presaleRoundPDA] = getPresaleRoundPDA(roundId);
  const [userDepositPDA] = getUserDepositPDA(roundId, wallet.publicKey);
  const [presaleTokenPDA] = getPresaleTokenPDA(roundId);
  const [lpInfoPDA] = getLpInfoPDA(roundId);

  // Check presale state
  const presaleInfo = await connection.getAccountInfo(presaleRoundPDA);
  if (!presaleInfo) {
    throw new Error('Presale round not found! Start it first with quick-round.ts');
  }

  const presaleData = presaleInfo.data.slice(8);
  const endTime = Number(Buffer.from(presaleData.slice(48, 56)).readBigInt64LE());
  const totalDeposited = Number(Buffer.from(presaleData.slice(76, 84)).readBigUInt64LE());
  const isFinalized = presaleData[88] === 1;

  console.log('📊 Presale State:');
  console.log('End Time:', new Date(endTime * 1000).toLocaleString());
  console.log('Total Deposited:', totalDeposited / LAMPORTS_PER_SOL, 'SOL');
  console.log('Is Finalized:', isFinalized);

  // ==================== STEP 1: Deposit ====================
  if (totalDeposited === 0) {
    console.log('\n📥 STEP 1: Depositing...');
    
    const depositAmount = 0.2 * LAMPORTS_PER_SOL;
    const depositData = Buffer.concat([
      getDiscriminator('deposit_presale'),
      encodeU64(BigInt(depositAmount))
    ]);

    const depositIx = new TransactionInstruction({
      keys: [
        { pubkey: presaleRoundPDA, isSigner: false, isWritable: true },
        { pubkey: userDepositPDA, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: depositData,
    });

    try {
      const tx = new Transaction().add(depositIx);
      const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
      console.log('✅ Deposited', depositAmount / LAMPORTS_PER_SOL, 'SOL');
      console.log('   Tx:', sig);
    } catch (e: any) {
      if (e.message?.includes('already in use')) {
        console.log('⚠️ Already deposited');
      } else {
        throw e;
      }
    }
  } else {
    console.log('\n✅ STEP 1: Already have deposits');
  }

  // ==================== STEP 2: Wait for presale to end ====================
  const now = Math.floor(Date.now() / 1000);
  if (now < endTime && !isFinalized) {
    const waitSeconds = endTime - now + 2;
    console.log(`\n⏳ STEP 2: Waiting ${waitSeconds}s for presale to end...`);
    
    for (let i = waitSeconds; i > 0; i--) {
      process.stdout.write(`\r   ${i}s remaining...  `);
      await sleep(1000);
    }
    console.log('\n   ✅ Presale ended!');
  } else {
    console.log('\n✅ STEP 2: Presale already ended');
  }

  // ==================== STEP 3: Finalize ====================
  if (!isFinalized) {
    console.log('\n🏁 STEP 3: Finalizing presale...');

    // end_presale_and_lottery(winner_indexes: Vec<u32>)
    const winnerIndexes = [0]; // First depositor
    const winnerIndexesBuffer = Buffer.alloc(4 + winnerIndexes.length * 4);
    winnerIndexesBuffer.writeUInt32LE(winnerIndexes.length, 0);
    winnerIndexes.forEach((idx, i) => {
      winnerIndexesBuffer.writeUInt32LE(idx, 4 + i * 4);
    });

    const finalizeData = Buffer.concat([
      getDiscriminator('end_presale_and_lottery'),
      winnerIndexesBuffer
    ]);

    const finalizeIx = new TransactionInstruction({
      keys: [
        { pubkey: presaleRoundPDA, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: finalizeData,
    });

    try {
      const tx = new Transaction().add(finalizeIx);
      const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
      console.log('✅ Presale finalized');
      console.log('   Tx:', sig);
    } catch (e: any) {
      console.log('Finalize error:', e.message);
      if (e.logs) console.log(e.logs.slice(-5));
    }

    // Mark winner
    console.log('   Marking winner...');
    const markWinnerData = getDiscriminator('mark_winner');
    const markWinnerIx = new TransactionInstruction({
      keys: [
        { pubkey: presaleRoundPDA, isSigner: false, isWritable: false },
        { pubkey: userDepositPDA, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
      ],
      programId: BOOM_PROGRAM_ID,
      data: markWinnerData,
    });

    try {
      const tx = new Transaction().add(markWinnerIx);
      const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
      console.log('✅ Winner marked');
      console.log('   Tx:', sig);
    } catch (e: any) {
      console.log('Mark winner error:', e.message);
    }
  } else {
    console.log('\n✅ STEP 3: Already finalized');
  }

  // ==================== STEP 4: Create Token ====================
  console.log('\n🪙 STEP 4: Creating standard SPL token...');

  const existingTokenInfo = await connection.getAccountInfo(presaleTokenPDA);
  let tokenMint: PublicKey;

  if (existingTokenInfo) {
    const tokenData = existingTokenInfo.data.slice(8);
    tokenMint = new PublicKey(tokenData.slice(8, 40));
    console.log('⚠️ Token already exists:', tokenMint.toBase58());

    // Check if it's a Token2022 mint (won't work with Raydium)
    const mintInfo = await connection.getAccountInfo(tokenMint);
    if (mintInfo && mintInfo.owner.toBase58() !== TOKEN_PROGRAM_ID.toBase58()) {
      console.log('❌ Token is Token2022, creating new SPL token for LP...');
      // Create new SPL token instead
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
      console.log('✅ New SPL Token created:', tokenMint.toBase58());
    }
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
  }

  // Mint supply
  const walletTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet,
    tokenMint,
    wallet.publicKey
  );

  const currentBalance = await connection.getTokenAccountBalance(walletTokenAccount.address);
  if (Number(currentBalance.value.amount) === 0) {
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
  } else {
    console.log('✅ Tokens already minted');
  }

  // ==================== STEP 5: Create Raydium LP ====================
  console.log('\n🏊 STEP 5: Creating Raydium CPMM Pool...');

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

  console.log('Submitting transaction...');
  const { txId } = await execute({ sendAndConfirm: true });

  const poolId = extInfo.address.poolId?.toString() || '';
  const lpMint = extInfo.address.lpMint?.toString() || '';

  console.log('\n✅ Raydium Pool Created!');
  console.log('   Tx:', txId);
  console.log('   Pool ID:', poolId);
  console.log('   LP Mint:', lpMint);

  // ==================== Summary ====================
  console.log('\n🎉 FULL LP TEST COMPLETE!');
  console.log('==========================================');
  console.log('Round:', roundId);
  console.log('Token:', tokenMint.toBase58());
  console.log('Pool:', poolId);
  console.log('\n📱 Test trading:');
  console.log(`https://raydium.io/swap/?inputMint=sol&outputMint=${tokenMint.toBase58()}`);
  console.log('\n🔗 Explorer:');
  console.log(`https://solscan.io/account/${poolId}?cluster=devnet`);

  return { success: true, tokenMint: tokenMint.toBase58(), poolId };
}

const roundId = parseInt(process.argv[2] || '13');
fullLPTest(roundId)
  .then(r => console.log('\n✅ Result:', JSON.stringify(r, null, 2)))
  .catch(e => {
    console.error('\n❌ Error:', e);
    process.exit(1);
  });
