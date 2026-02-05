/**
 * Test atomic swap using raw instruction building (no IDL needed)
 */

import { 
  Connection,
  PublicKey, 
  SystemProgram, 
  Keypair,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as crypto from "crypto";

// Program IDs
const BOOM_PROGRAM_ID = new PublicKey("GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn");
const HOOK_PROGRAM_ID = new PublicKey("CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9");

// Helper to get Anchor instruction discriminator
function getDiscriminator(instructionName: string): Buffer {
  return Buffer.from(
    crypto.createHash("sha256")
      .update(`global:${instructionName}`)
      .digest()
      .slice(0, 8)
  );
}

// Helper to encode u64 as little-endian buffer
function encodeU64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  const walletPath = process.env.HOME + "/.config/solana/id.json";
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );
  
  console.log("Wallet:", walletKeypair.publicKey.toBase58());
  console.log("Balance:", (await connection.getBalance(walletKeypair.publicKey)) / LAMPORTS_PER_SOL, "SOL");
  
  // Use the round from latest quick-e2e.ts run
  const roundId = 1770266776769n;
  const roundIdBytes = encodeU64(roundId);
  
  // Derive PDAs
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), roundIdBytes],
    BOOM_PROGRAM_ID
  );
  
  const [solVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("sol_vault"), roundIdBytes],
    BOOM_PROGRAM_ID
  );
  
  const [tokenVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_vault"), roundIdBytes],
    BOOM_PROGRAM_ID
  );
  
  console.log("\n=== PDAs ===");
  console.log("Pool:", poolPda.toBase58());
  console.log("SOL Vault:", solVaultPda.toBase58());
  console.log("Token Vault:", tokenVaultPda.toBase58());
  
  // Fetch pool account to get mint
  const poolAccountInfo = await connection.getAccountInfo(poolPda);
  if (!poolAccountInfo) {
    console.error("Pool account not found. Run quick-e2e.ts first.");
    return;
  }
  
  // Parse pool data manually
  // Layout: discriminator (8) + round_id (8) + mint (32) + token_vault (32) + 
  //         sol_reserve (8) + token_reserve (8) + fee_bps (2) + ...
  const poolData = poolAccountInfo.data;
  const mint = new PublicKey(poolData.slice(16, 48)); // offset 8+8
  const solReserve = poolData.readBigUInt64LE(80); // offset 8+8+32+32
  const tokenReserve = poolData.readBigUInt64LE(88); // offset +8
  
  console.log("\n=== Pool State ===");
  console.log("Mint:", mint.toBase58());
  console.log("SOL Reserve:", Number(solReserve) / LAMPORTS_PER_SOL, "SOL");
  console.log("Token Reserve:", tokenReserve.toString());
  
  // Derive hook PDAs
  const [extraAccountMetasPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.toBuffer()],
    HOOK_PROGRAM_ID
  );
  
  const [hookConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("hook_config")],
    HOOK_PROGRAM_ID
  );
  
  const [hookWhitelistPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist"), mint.toBuffer()],
    HOOK_PROGRAM_ID
  );
  
  // User token account
  const userTokenAccount = getAssociatedTokenAddressSync(
    mint,
    walletKeypair.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  
  console.log("\n=== User ===");
  console.log("Token Account:", userTokenAccount.toBase58());
  
  // Ensure ATA exists
  const ataInfo = await connection.getAccountInfo(userTokenAccount);
  if (!ataInfo) {
    console.log("Creating ATA...");
    const createAtaIx = createAssociatedTokenAccountInstruction(
      walletKeypair.publicKey,
      userTokenAccount,
      walletKeypair.publicKey,
      mint,
      TOKEN_2022_PROGRAM_ID
    );
    const tx = new Transaction().add(createAtaIx);
    await sendAndConfirmTransaction(connection, tx, [walletKeypair]);
    console.log("ATA created");
  }
  
  // Get user token balance
  let userTokenBalance = 0n;
  try {
    const tokenAccountData = await getAccount(connection, userTokenAccount, "confirmed", TOKEN_2022_PROGRAM_ID);
    userTokenBalance = tokenAccountData.amount;
    console.log("Token Balance:", userTokenBalance.toString());
  } catch (e) {
    console.log("Token Balance: 0");
  }
  
  // ==================== TEST ATOMIC BUY ====================
  console.log("\n=== Test Atomic Buy ===");
  
  const solIn = BigInt(0.01 * LAMPORTS_PER_SOL);
  const minTokensOut = 1n;
  
  // Build swap_atomic_buy instruction
  const buyDiscriminator = getDiscriminator("swap_atomic_buy");
  const buyData = Buffer.concat([
    buyDiscriminator,
    encodeU64(solIn),
    encodeU64(minTokensOut),
  ]);
  
  const buyIx = new TransactionInstruction({
    programId: BOOM_PROGRAM_ID,
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: tokenVaultPda, isSigner: false, isWritable: true },
      { pubkey: solVaultPda, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: HOOK_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: extraAccountMetasPda, isSigner: false, isWritable: false },
      { pubkey: hookConfigPda, isSigner: false, isWritable: false },
      { pubkey: hookWhitelistPda, isSigner: false, isWritable: false },
    ],
    data: buyData,
  });
  
  console.log("Buying tokens with", Number(solIn) / LAMPORTS_PER_SOL, "SOL...");
  
  try {
    const tx = new Transaction().add(buyIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [walletKeypair], { 
      commitment: "confirmed",
      skipPreflight: false,
    });
    console.log("✅ Atomic buy succeeded!");
    console.log("Tx:", sig);
    
    const newBalance = (await getAccount(connection, userTokenAccount, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
    console.log("Tokens received:", (newBalance - userTokenBalance).toString());
    userTokenBalance = newBalance;
    
  } catch (e: any) {
    console.error("❌ Atomic buy failed:", e.message);
    if (e.logs) {
      console.log("\nTransaction Logs:");
      e.logs.forEach((log: string) => console.log("  ", log));
    }
  }
  
  // ==================== TEST ATOMIC SELL ====================
  console.log("\n=== Test Atomic Sell ===");
  
  // Refresh balance
  try {
    userTokenBalance = (await getAccount(connection, userTokenAccount, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
  } catch (e) {
    userTokenBalance = 0n;
  }
  
  if (userTokenBalance === 0n) {
    console.log("No tokens to sell");
    return;
  }
  
  const tokensToSell = userTokenBalance / 2n;
  const minSolOut = 1n;
  
  console.log("Selling", tokensToSell.toString(), "tokens...");
  
  // Step 1: Transfer tokens to vault (user -> vault)
  const transferIx = createTransferCheckedInstruction(
    userTokenAccount,
    mint,
    tokenVaultPda,
    walletKeypair.publicKey,
    tokensToSell,
    9,
    [],
    TOKEN_2022_PROGRAM_ID
  );
  
  // Add hook accounts to transfer
  transferIx.keys.push(
    { pubkey: HOOK_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: extraAccountMetasPda, isSigner: false, isWritable: false },
    { pubkey: hookConfigPda, isSigner: false, isWritable: false },
    { pubkey: hookWhitelistPda, isSigner: false, isWritable: false },
  );
  
  // Step 2: Call swap_atomic_sell
  const sellDiscriminator = getDiscriminator("swap_atomic_sell");
  const sellData = Buffer.concat([
    sellDiscriminator,
    encodeU64(tokensToSell),
    encodeU64(minSolOut),
  ]);
  
  const sellIx = new TransactionInstruction({
    programId: BOOM_PROGRAM_ID,
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: tokenVaultPda, isSigner: false, isWritable: false },
      { pubkey: solVaultPda, isSigner: false, isWritable: true },
      { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: sellData,
  });
  
  try {
    const solBefore = await connection.getBalance(walletKeypair.publicKey);
    
    const tx = new Transaction().add(transferIx).add(sellIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [walletKeypair], {
      commitment: "confirmed",
      skipPreflight: false,
    });
    
    const solAfter = await connection.getBalance(walletKeypair.publicKey);
    
    console.log("✅ Atomic sell succeeded!");
    console.log("Tx:", sig);
    console.log("SOL received (approx):", (solAfter - solBefore) / LAMPORTS_PER_SOL, "SOL");
    
  } catch (e: any) {
    console.error("❌ Atomic sell failed:", e.message);
    if (e.logs) {
      console.log("\nTransaction Logs:");
      e.logs.forEach((log: string) => console.log("  ", log));
    }
  }
  
  // Final state
  console.log("\n=== Final State ===");
  const finalPoolInfo = await connection.getAccountInfo(poolPda);
  if (finalPoolInfo) {
    const finalData = finalPoolInfo.data;
    const finalSolReserve = finalData.readBigUInt64LE(80);
    const finalTokenReserve = finalData.readBigUInt64LE(88);
    console.log("SOL Reserve:", Number(finalSolReserve) / LAMPORTS_PER_SOL, "SOL");
    console.log("Token Reserve:", finalTokenReserve.toString());
  }
}

main().catch(console.error);
