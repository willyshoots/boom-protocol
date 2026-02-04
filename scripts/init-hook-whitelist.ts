/**
 * Initialize hook whitelist for a token mint
 */

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  clusterApiUrl
} from '@solana/web3.js';
import * as fs from 'fs';
import { createHash } from 'crypto';

const HOOK_PROGRAM = new PublicKey('CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9');
const TOKEN_MINT = new PublicKey('G7QjN4RT9y2SsjzcebqLcdhcCZHjmugtg63z7dk3BPoS');

// Load wallet
const walletPath = process.env.HOME + '/.config/solana/id.json';
const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(secretKey));

function getDiscriminator(name: string): Buffer {
  const hash = createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

async function initWhitelist() {
  const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
  
  console.log('🔧 Initializing Hook Whitelist');
  console.log('==============================\n');
  console.log('Hook Program:', HOOK_PROGRAM.toBase58());
  console.log('Token Mint:', TOKEN_MINT.toBase58());
  console.log('Authority:', wallet.publicKey.toBase58());

  // Derive PDAs
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('hook_config')],
    HOOK_PROGRAM
  );
  
  const [whitelistPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('whitelist'), TOKEN_MINT.toBuffer()],
    HOOK_PROGRAM
  );
  
  console.log('\nConfig PDA:', configPda.toBase58());
  console.log('Whitelist PDA:', whitelistPda.toBase58());

  // Check if already initialized
  const existing = await connection.getAccountInfo(whitelistPda);
  if (existing) {
    console.log('\n✅ Whitelist already initialized!');
    return;
  }

  // Build add_whitelist instruction
  // add_whitelist(ctx, official_lp: Pubkey)
  // For now, set official_lp to default (will update after LP creation)
  const officialLp = PublicKey.default; // All zeros - no LP set yet
  
  const data = Buffer.concat([
    getDiscriminator('add_whitelist'),
    officialLp.toBuffer()
  ]);

  const ix = new TransactionInstruction({
    programId: HOOK_PROGRAM,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: whitelistPda, isSigner: false, isWritable: true },
      { pubkey: TOKEN_MINT, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
    ],
    data,
  });

  console.log('\n📝 Sending transaction...');
  
  try {
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log('✅ Whitelist initialized!');
    console.log('   Signature:', sig);
  } catch (err: any) {
    console.error('❌ Error:', err.message);
    if (err.logs) {
      console.error('Logs:', err.logs.slice(-5));
    }
  }
}

initWhitelist().catch(console.error);
