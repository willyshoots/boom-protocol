/**
 * Complete Phase 2 for an existing token
 */
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

const HOOK_PROGRAM_ID = new PublicKey('CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9');

const mintAddress = process.argv[2];
const lpAddress = process.argv[3];

if (!mintAddress || !lpAddress) {
  console.error('Usage: npx ts-node scripts/phase2-only.ts <MINT> <LP>');
  process.exit(1);
}

const RPC_URL = 'https://api.mainnet-beta.solana.com';
const KEYPAIR_PATH = path.join(process.env.HOME!, '.config/solana/id.json');
const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
const wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));

function getDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

function getHookConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('hook_config')], HOOK_PROGRAM_ID);
}

function getWhitelistPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('whitelist'), mint.toBuffer()], HOOK_PROGRAM_ID);
}

function getExtraMetasPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('extra-account-metas'), mint.toBuffer()], HOOK_PROGRAM_ID);
}

async function main() {
  const mint = new PublicKey(mintAddress);
  const lp = new PublicKey(lpAddress);
  const connection = new Connection(RPC_URL, 'confirmed');

  console.log('Phase 2: Locking down', mint.toBase58());

  const [hookConfigPDA] = getHookConfigPDA();
  const [extraMetasPDA] = getExtraMetasPDA(mint);
  const [whitelistPDA] = getWhitelistPDA(mint);

  // Upgrade extra metas
  console.log('Upgrading extra_account_metas...');
  const upgradeTx = new Transaction().add(
    new TransactionInstruction({
      programId: HOOK_PROGRAM_ID,
      keys: [
        { pubkey: hookConfigPDA, isSigner: false, isWritable: false },
        { pubkey: extraMetasPDA, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
      ],
      data: getDiscriminator('upgrade_extra_account_meta_list'),
    })
  );
  const upgradeSig = await sendAndConfirmTransaction(connection, upgradeTx, [wallet]);
  console.log('✅ Upgraded:', upgradeSig);

  // Add whitelist
  console.log('Adding whitelist...');
  const whitelistTx = new Transaction().add(
    new TransactionInstruction({
      programId: HOOK_PROGRAM_ID,
      keys: [
        { pubkey: hookConfigPDA, isSigner: false, isWritable: false },
        { pubkey: whitelistPDA, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([getDiscriminator('add_whitelist'), lp.toBuffer()]),
    })
  );
  const whitelistSig = await sendAndConfirmTransaction(connection, whitelistTx, [wallet]);
  console.log('✅ Whitelist:', whitelistSig);

  console.log('\n🎉 Phase 2 complete! Token locked down.');
}

main().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
