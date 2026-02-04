/**
 * BOOM Protocol - Create Raydium CPMM Liquidity Pool
 * 
 * This script creates a liquidity pool on Raydium after presale ends.
 * Uses the official Raydium SDK for reliability.
 * 
 * Usage: npx ts-node scripts/create-lp.ts <round_id>
 */

import { Raydium, DEVNET_PROGRAM_ID, getCpmmPdaAmmConfigId } from '@raydium-io/raydium-sdk-v2';
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
// @ts-ignore
import BN from 'bn.js';
import fs from 'fs';
import path from 'path';

// Config
const BOOM_PROGRAM_ID = new PublicKey('GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn');
const RPC_URL = process.env.RPC_URL || clusterApiUrl('devnet');
const KEYPAIR_PATH = process.env.KEYPAIR_PATH || path.join(process.env.HOME!, '.config/solana/id.json');

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

async function createLP(roundId: number) {
  console.log('🚀 BOOM Protocol - Raydium LP Creator');
  console.log('=====================================\n');

  // Load wallet
  const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
  const wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));
  console.log('Wallet:', wallet.publicKey.toBase58());

  // Connect
  const connection = new Connection(RPC_URL, 'confirmed');
  console.log('RPC:', RPC_URL);

  // Get presale state
  const roundIdBN = new BN(roundId);
  const [presaleRoundPDA] = getPresaleRoundPDA(roundIdBN);
  const [presaleTokenPDA] = getPresaleTokenPDA(roundIdBN);

  console.log('\n📊 Fetching presale state...');
  console.log('Presale Round PDA:', presaleRoundPDA.toBase58());
  console.log('Presale Token PDA:', presaleTokenPDA.toBase58());

  // Fetch presale round account
  const presaleRoundInfo = await connection.getAccountInfo(presaleRoundPDA);
  if (!presaleRoundInfo) {
    throw new Error('Presale round not found');
  }

  // Parse presale round (skip 8-byte discriminator)
  const presaleData = presaleRoundInfo.data.slice(8);
  const authority = new PublicKey(presaleData.slice(0, 32));
  const storedRoundId = new BN(presaleData.slice(32, 40), 'le');
  const totalDeposited = new BN(presaleData.slice(72, 80), 'le'); // offset for total_deposited
  const isFinalized = presaleData[88] === 1; // offset for is_finalized

  console.log('Authority:', authority.toBase58());
  console.log('Round ID:', storedRoundId.toString());
  console.log('Total Deposited:', totalDeposited.toString(), 'lamports');
  console.log('Is Finalized:', isFinalized);

  if (!isFinalized) {
    throw new Error('Presale is not finalized yet!');
  }

  // Fetch presale token account to get mint
  const presaleTokenInfo = await connection.getAccountInfo(presaleTokenPDA);
  if (!presaleTokenInfo) {
    throw new Error('Presale token not found - create_presale_token must be called first');
  }

  // Parse presale token (skip 8-byte discriminator)
  const tokenData = presaleTokenInfo.data.slice(8);
  const tokenRoundId = new BN(tokenData.slice(0, 8), 'le');
  const mintAddress = new PublicKey(tokenData.slice(8, 40));
  const totalSupply = new BN(tokenData.slice(40, 48), 'le');

  console.log('\n🪙 Token Info:');
  console.log('Mint:', mintAddress.toBase58());
  console.log('Total Supply:', totalSupply.toString());

  // Initialize Raydium SDK
  console.log('\n🔧 Initializing Raydium SDK...');
  const raydium = await Raydium.load({
    connection,
    owner: wallet,
    cluster: 'devnet',
    disableLoadToken: false,
  });

  // Get fee configs for devnet
  const feeConfigs = await raydium.api.getCpmmConfigs();
  feeConfigs.forEach((config) => {
    config.id = getCpmmPdaAmmConfigId(
      DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,
      config.index
    ).publicKey.toBase58();
  });

  console.log('Fee configs loaded:', feeConfigs.length);

  // Prepare token info for pool creation
  // SOL (wrapped) as mintA
  const mintA = {
    address: 'So11111111111111111111111111111111111111112', // Wrapped SOL
    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    decimals: 9,
  };

  // Our BOOM token as mintB (Token2022)
  const mintB = {
    address: mintAddress.toBase58(),
    programId: TOKEN_2022_PROGRAM_ID.toBase58(),
    decimals: 9,
  };

  // Calculate LP amounts based on tokenomics:
  // - SOL side: Use presale SOL (winner deposits)
  // - Token side: 90% of total supply goes to LP
  const solAmount = totalDeposited; // All winner SOL goes to LP
  const tokenAmount = totalSupply.mul(new BN(90)).div(new BN(100)); // 90% to LP

  console.log('\n💰 LP Amounts:');
  console.log('SOL:', solAmount.toString(), 'lamports (~', solAmount.div(new BN(1e9)).toString(), 'SOL)');
  console.log('Tokens:', tokenAmount.toString(), '(90% of supply)');

  // Create the pool
  console.log('\n🏊 Creating Raydium CPMM Pool...');
  
  try {
    const { execute, extInfo, transaction } = await raydium.cpmm.createPool({
      programId: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,
      poolFeeAccount: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC,
      mintA,
      mintB,
      mintAAmount: solAmount,
      mintBAmount: tokenAmount,
      startTime: new BN(0), // Start immediately
      feeConfig: feeConfigs[0], // Use default fee config
      associatedOnly: false,
      ownerInfo: {
        useSOLBalance: true,
      },
      // @ts-ignore
      txVersion: 'V0', // Use versioned transactions
    });

    console.log('\n📝 Transaction built. Executing...');
    
    // Execute the transaction
    const { txId } = await execute({ sendAndConfirm: true });
    
    console.log('\n✅ Pool Created Successfully!');
    console.log('Transaction:', txId);
    console.log('\nPool Keys:');
    Object.entries(extInfo.address).forEach(([key, value]) => {
      console.log(`  ${key}: ${value.toString()}`);
    });

    // Return pool info for registration
    return {
      txId,
      poolId: extInfo.address.poolId?.toString(),
      lpMint: extInfo.address.lpMint?.toString(),
      vaultA: extInfo.address.vaultA?.toString(),
      vaultB: extInfo.address.vaultB?.toString(),
    };

  } catch (error: any) {
    console.error('\n❌ Pool creation failed:', error.message);
    if (error.logs) {
      console.error('Logs:', error.logs);
    }
    throw error;
  }
}

// CLI entry point
const roundId = parseInt(process.argv[2] || '1');
if (isNaN(roundId)) {
  console.error('Usage: npx ts-node scripts/create-lp.ts <round_id>');
  process.exit(1);
}

createLP(roundId)
  .then((result) => {
    console.log('\n🎉 LP Creation Complete!');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
