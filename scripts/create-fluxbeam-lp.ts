/**
 * BOOM Protocol - FluxBeam LP Creator (Token2022 Compatible)
 * 
 * FluxBeam is the first DEX on Solana to fully support Token2022.
 * This script creates an LP pool via their simple REST API.
 */

import { 
  Connection, 
  Keypair, 
  VersionedTransaction,
  clusterApiUrl
} from '@solana/web3.js';
import * as fs from 'fs';
import * as https from 'https';

// Our Token2022 mint from round 11
const TOKEN_MINT = 'G7QjN4RT9y2SsjzcebqLcdhcCZHjmugtg63z7dk3BPoS';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

// Load wallet
const walletPath = process.env.HOME + '/.config/solana/id.json';
const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(secretKey));

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
        try {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          } else {
            resolve(JSON.parse(body));
          }
        } catch (e) {
          reject(new Error(`Parse error: ${body}`));
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function createFluxBeamLP() {
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  
  console.log('🌊 BOOM Protocol - FluxBeam LP Creator');
  console.log('======================================\n');
  console.log('Wallet:', wallet.publicKey.toBase58());
  console.log('Token Mint:', TOKEN_MINT);
  
  // Minimal amounts to conserve devnet SOL
  const solAmount = 50000000;  // 0.05 SOL (50M lamports)
  const tokenAmount = 10000000000000000; // 10M tokens (with 9 decimals)
  
  console.log('\n💰 LP Amounts (minimal for testing):');
  console.log('   SOL:', solAmount / 1e9, 'SOL');
  console.log('   Tokens: 10,000,000');

  console.log('\n📡 Calling FluxBeam API...');
  
  try {
    const result = await httpPost('https://api.fluxbeam.xyz/v1/token_pools', {
      payer: wallet.publicKey.toBase58(),
      token_a: WSOL_MINT,
      token_b: TOKEN_MINT,
      token_a_amount: solAmount,
      token_b_amount: tokenAmount,
      priority_fee_lamports: 10000
    });
    
    console.log('\n✅ FluxBeam API Response:');
    console.log('   Pool Address:', result.pool);
    
    if (result.transaction) {
      console.log('\n📝 Signing and submitting transaction...');
      
      // Decode the transaction
      const txBuffer = Buffer.from(result.transaction, 'base64');
      const transaction = VersionedTransaction.deserialize(txBuffer);
      
      // Sign with our wallet
      transaction.sign([wallet]);
      
      // Submit
      const signature = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        maxRetries: 3
      });
      
      console.log('   Transaction sent:', signature);
      
      // Wait for confirmation
      console.log('   Waiting for confirmation...');
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');
      
      if (confirmation.value.err) {
        console.error('❌ Transaction failed:', confirmation.value.err);
      } else {
        console.log('\n🎉 LP Created Successfully!');
        console.log('==========================================');
        console.log('Pool Address:', result.pool);
        console.log('Transaction:', signature);
        console.log('Explorer: https://solscan.io/tx/' + signature + '?cluster=devnet');
        
        return {
          success: true,
          pool: result.pool,
          signature
        };
      }
    } else {
      console.log('\n⚠️ API Response (no transaction):');
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    throw error;
  }
}

createFluxBeamLP().catch(console.error);
