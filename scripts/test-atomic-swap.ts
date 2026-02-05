/**
 * Test atomic swap functionality
 * 
 * For SELL: User transfers tokens directly to vault, then calls swap_atomic_sell
 * For BUY: User calls swap_atomic_buy which handles SOL transfer and token CPI
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { 
  PublicKey, 
  SystemProgram, 
  Keypair,
  Transaction,
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
import * as path from "path";

// Load IDL
const idlPath = path.join(__dirname, "../target/idl/boom.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

// Program IDs
const BOOM_PROGRAM_ID = new PublicKey("GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn");
const HOOK_PROGRAM_ID = new PublicKey("CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9");

async function main() {
  // Setup
  const connection = new anchor.web3.Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );
  
  const walletPath = process.env.HOME + "/.config/solana/id.json";
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );
  
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  
  const program = new Program(idl, provider);
  
  console.log("Wallet:", wallet.publicKey.toBase58());
  
  // Find the active round with a pool
  // For testing, let's use round 12 which should have a pool from earlier tests
  const roundId = 12n;
  const roundIdBytes = Buffer.alloc(8);
  roundIdBytes.writeBigUInt64LE(roundId);
  
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
  
  console.log("\n=== Pool Info ===");
  console.log("Pool PDA:", poolPda.toBase58());
  console.log("SOL Vault:", solVaultPda.toBase58());
  console.log("Token Vault:", tokenVaultPda.toBase58());
  
  // Fetch pool data
  let poolData: any;
  try {
    poolData = await program.account.pool.fetch(poolPda);
    console.log("\nPool state:");
    console.log("  Round ID:", poolData.roundId.toString());
    console.log("  Mint:", poolData.mint.toBase58());
    console.log("  SOL Reserve:", poolData.solReserve.toString(), "lamports");
    console.log("  Token Reserve:", poolData.tokenReserve.toString());
    console.log("  Fee BPS:", poolData.feeBps);
  } catch (e) {
    console.error("Failed to fetch pool:", e);
    console.log("\nNeed to set up a pool first. Run quick-e2e.ts or similar.");
    return;
  }
  
  const mint = poolData.mint;
  
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
  
  // Get or create user's token account
  const userTokenAccount = getAssociatedTokenAddressSync(
    mint,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  
  console.log("\n=== User Token Account ===");
  console.log("ATA:", userTokenAccount.toBase58());
  
  // Check user's token balance
  let userTokenBalance = 0n;
  try {
    const tokenAccountInfo = await getAccount(connection, userTokenAccount, "confirmed", TOKEN_2022_PROGRAM_ID);
    userTokenBalance = tokenAccountInfo.amount;
    console.log("Balance:", userTokenBalance.toString());
  } catch (e) {
    console.log("Token account doesn't exist or has 0 balance");
  }
  
  // ==================== TEST ATOMIC BUY ====================
  console.log("\n=== Test Atomic Buy ===");
  
  const solIn = BigInt(0.01 * LAMPORTS_PER_SOL); // 0.01 SOL
  const minTokensOut = 1n; // Accept any amount for testing
  
  console.log("Buying tokens with", Number(solIn) / LAMPORTS_PER_SOL, "SOL...");
  
  try {
    // First, ensure user has an ATA
    const accountInfo = await connection.getAccountInfo(userTokenAccount);
    if (!accountInfo) {
      console.log("Creating user token account...");
      const createAtaIx = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        userTokenAccount,
        wallet.publicKey,
        mint,
        TOKEN_2022_PROGRAM_ID
      );
      const tx = new Transaction().add(createAtaIx);
      await sendAndConfirmTransaction(connection, tx, [walletKeypair]);
      console.log("ATA created");
    }
    
    const txSig = await program.methods
      .swapAtomicBuy(new anchor.BN(solIn.toString()), new anchor.BN(minTokensOut.toString()))
      .accounts({
        pool: poolPda,
        mint: mint,
        tokenVault: tokenVaultPda,
        solVault: solVaultPda,
        userTokenAccount: userTokenAccount,
        user: wallet.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        hookProgram: HOOK_PROGRAM_ID,
        extraAccountMetas: extraAccountMetasPda,
        hookConfig: hookConfigPda,
        hookWhitelist: hookWhitelistPda,
      })
      .rpc();
    
    console.log("✅ Atomic buy succeeded!");
    console.log("Tx:", txSig);
    
    // Check new balance
    const newTokenBalance = (await getAccount(connection, userTokenAccount, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
    console.log("Tokens received:", (newTokenBalance - userTokenBalance).toString());
    userTokenBalance = newTokenBalance;
    
  } catch (e: any) {
    console.error("❌ Atomic buy failed:", e.message);
    if (e.logs) {
      console.log("\nLogs:");
      e.logs.forEach((log: string) => console.log("  ", log));
    }
  }
  
  // ==================== TEST ATOMIC SELL ====================
  console.log("\n=== Test Atomic Sell ===");
  
  // Check if user has tokens to sell
  try {
    const tokenAccountInfo = await getAccount(connection, userTokenAccount, "confirmed", TOKEN_2022_PROGRAM_ID);
    userTokenBalance = tokenAccountInfo.amount;
  } catch (e) {
    console.log("No tokens to sell");
    return;
  }
  
  if (userTokenBalance === 0n) {
    console.log("No tokens to sell");
    return;
  }
  
  const tokensToSell = userTokenBalance / 2n; // Sell half
  const minSolOut = 1n; // Accept any amount for testing
  
  console.log("Selling", tokensToSell.toString(), "tokens...");
  
  try {
    // Atomic sell requires two instructions in the same transaction:
    // 1. User transfers tokens directly to vault (with hook accounts)
    // 2. User calls swap_atomic_sell to receive SOL
    
    // Build token transfer instruction
    const transferIx = createTransferCheckedInstruction(
      userTokenAccount,
      mint,
      tokenVaultPda,
      wallet.publicKey,
      tokensToSell,
      9, // decimals
      [],
      TOKEN_2022_PROGRAM_ID
    );
    
    // For Token2022 with transfer hook, we need to add extra accounts
    // These are: hook program, extra account metas, then the resolved accounts
    transferIx.keys.push(
      { pubkey: HOOK_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: extraAccountMetasPda, isSigner: false, isWritable: false },
      { pubkey: hookConfigPda, isSigner: false, isWritable: false },
      { pubkey: hookWhitelistPda, isSigner: false, isWritable: false },
    );
    
    // Build swap_atomic_sell instruction
    const sellIx = await program.methods
      .swapAtomicSell(new anchor.BN(tokensToSell.toString()), new anchor.BN(minSolOut.toString()))
      .accounts({
        pool: poolPda,
        tokenVault: tokenVaultPda,
        solVault: solVaultPda,
        user: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    
    // Send both in one atomic transaction
    const tx = new Transaction().add(transferIx).add(sellIx);
    
    const userBalanceBefore = await connection.getBalance(wallet.publicKey);
    
    const txSig = await sendAndConfirmTransaction(connection, tx, [walletKeypair]);
    
    const userBalanceAfter = await connection.getBalance(wallet.publicKey);
    const solReceived = userBalanceAfter - userBalanceBefore;
    
    console.log("✅ Atomic sell succeeded!");
    console.log("Tx:", txSig);
    console.log("SOL received (approx):", solReceived / LAMPORTS_PER_SOL, "SOL");
    
  } catch (e: any) {
    console.error("❌ Atomic sell failed:", e.message);
    if (e.logs) {
      console.log("\nLogs:");
      e.logs.forEach((log: string) => console.log("  ", log));
    }
  }
  
  // Final pool state
  console.log("\n=== Final Pool State ===");
  const finalPoolData = await program.account.pool.fetch(poolPda);
  console.log("SOL Reserve:", finalPoolData.solReserve.toString(), "lamports");
  console.log("Token Reserve:", finalPoolData.tokenReserve.toString());
}

main().catch(console.error);
