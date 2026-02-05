/**
 * Create FluxBeam LP with pre-whitelisting
 * 1. Get pool address from FluxBeam API
 * 2. Whitelist the pool address in our hook
 * 3. Execute the LP creation transaction
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
  VersionedTransaction,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { createHash } from 'crypto';

const HOOK_PROGRAM_ID = new PublicKey('CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9');
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

// Parse args
const args = process.argv.slice(2);
const mintAddress = args.find(a => a.startsWith('--mint='))?.split('=')[1];
const solForLp = parseFloat(args.find(a => a.startsWith('--sol='))?.split('=')[1] || '0.05');
const tokensForLp = args.find(a => a.startsWith('--tokens='))?.split('=')[1] || '100000000';
const isMainnet = args.includes('--mainnet');

if (!mintAddress) {
  console.error('Usage: npx ts-node scripts/create-lp-with-whitelist.ts --mint=<MINT_ADDRESS> --sol=0.05 --mainnet');
  process.exit(1);
}

const RPC_URL = isMainnet 
  ? 'https://api.mainnet-beta.solana.com'
  : 'https://api.devnet.solana.com';

// Load wallet
const KEYPAIR_PATH = path.join(process.env.HOME!, '.config/solana/id.json');
const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));

function getDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

function httpPost(url: string, data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(data);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        } else {
          try { resolve(JSON.parse(body)); } 
          catch { reject(new Error(`Parse error: ${body}`)); }
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function getHookConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('hook_config')], HOOK_PROGRAM_ID);
}

function getWhitelistPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('whitelist'), mint.toBuffer()], HOOK_PROGRAM_ID);
}

async function main() {
  const mint = new PublicKey(mintAddress!);
  
  console.log('🏊 Creating FluxBeam LP with Pre-Whitelisting');
  console.log('==============================================');
  console.log(`Network: ${isMainnet ? 'MAINNET' : 'DEVNET'}`);
  console.log(`Mint: ${mint.toBase58()}`);
  console.log(`SOL for LP: ${solForLp}`);
  console.log(`Tokens for LP: ${tokensForLp}`);
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  console.log('');

  const connection = new Connection(RPC_URL, 'confirmed');
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  const solLamports = Math.floor(solForLp * LAMPORTS_PER_SOL);
  const tokenAmount = BigInt(tokensForLp) * BigInt(10 ** 9); // 9 decimals

  // Step 1: Get pool address from FluxBeam (without executing)
  console.log('📡 Step 1: Getting pool address from FluxBeam...');
  
  const fluxResult = await httpPost('https://api.fluxbeam.xyz/v1/token_pools', {
    payer: wallet.publicKey.toBase58(),
    token_a: WSOL_MINT,
    token_b: mint.toBase58(),
    token_a_amount: solLamports,
    token_b_amount: tokenAmount.toString(),
    priority_fee_lamports: 50000
  });

  if (!fluxResult.pool || !fluxResult.transaction) {
    console.error('❌ FluxBeam API did not return expected data');
    console.log(JSON.stringify(fluxResult, null, 2));
    process.exit(1);
  }

  const poolAddress = new PublicKey(fluxResult.pool);
  console.log(`   Pool address: ${poolAddress.toBase58()}`);

  // Step 2: Whitelist the pool address BEFORE executing LP creation
  console.log('\n🔓 Step 2: Whitelisting pool address in hook...');

  const [hookConfigPDA] = getHookConfigPDA();
  const [whitelistPDA] = getWhitelistPDA(mint);

  const whitelistTx = new Transaction().add(
    new TransactionInstruction({
      programId: HOOK_PROGRAM_ID,
      keys: [
        { pubkey: hookConfigPDA, isSigner: false, isWritable: false },
        { pubkey: whitelistPDA, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.concat([getDiscriminator('update_whitelist'), poolAddress.toBuffer()]),
    })
  );

  const whitelistSig = await sendAndConfirmTransaction(connection, whitelistTx, [wallet]);
  console.log(`   ✅ Pool whitelisted: ${whitelistSig}`);

  // Step 3: Now execute the FluxBeam LP creation transaction
  console.log('\n🏊 Step 3: Executing LP creation transaction...');

  const txBuffer = Buffer.from(fluxResult.transaction, 'base64');
  const versionedTx = VersionedTransaction.deserialize(txBuffer);
  versionedTx.sign([wallet]);

  try {
    const lpSig = await connection.sendRawTransaction(versionedTx.serialize(), {
      skipPreflight: true,  // Skip simulation - let it fail on-chain if needed
      maxRetries: 3
    });

    console.log(`   Transaction sent: ${lpSig}`);
    console.log('   Waiting for confirmation...');
    
    await connection.confirmTransaction(lpSig, 'confirmed');
    console.log(`   ✅ LP created successfully!`);

    console.log('\n🎉 LP CREATION COMPLETE!');
    console.log('==========================================');
    console.log(`Pool Address: ${poolAddress.toBase58()}`);
    console.log(`Transaction: ${lpSig}`);
    const cluster = isMainnet ? '' : '?cluster=devnet';
    console.log(`Solscan: https://solscan.io/tx/${lpSig}${cluster}`);
  } catch (err: any) {
    console.error(`   ❌ LP creation failed: ${err.message}`);
    if (err.logs) {
      console.log('\nTransaction logs:');
      err.logs.slice(-10).forEach((log: string) => console.log('   ', log));
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\n❌ Failed:', err.message);
  process.exit(1);
});
