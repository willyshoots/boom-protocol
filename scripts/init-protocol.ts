import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";

const PROGRAM_ID = new PublicKey("GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn");

async function main() {
  // Connect to devnet
  const connection = new anchor.web3.Connection("https://api.devnet.solana.com", "confirmed");
  
  // Load wallet from default keypair
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(
      os.homedir() + "/.config/solana/id.json", "utf-8"
    )))
  );
  
  const wallet = new anchor.Wallet(walletKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  
  console.log("Wallet:", wallet.publicKey.toString());
  console.log("Program ID:", PROGRAM_ID.toString());
  
  // Find protocol PDA
  const [protocolPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol")],
    PROGRAM_ID
  );
  console.log("Protocol PDA:", protocolPDA.toString());
  
  // Check if already initialized
  const accountInfo = await connection.getAccountInfo(protocolPDA);
  if (accountInfo) {
    console.log("Protocol already initialized!");
    return;
  }
  
  console.log("Protocol not initialized. Initializing...");
  
  // Load IDL
  const idl = JSON.parse(fs.readFileSync("./target/idl/boom.json", "utf-8"));
  const program = new Program(idl, provider);
  
  // Initialize
  const tx = await program.methods
    .initialize({
      minCap: new anchor.BN(1_000_000), // 1 SOL min cap
      maxCap: new anchor.BN(100_000_000_000), // 100k SOL max cap  
      feeBps: 50, // 0.5% fee
    })
    .accounts({
      protocol: protocolPDA,
      treasury: wallet.publicKey,
      authority: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  
  console.log("Initialized! Tx:", tx);
}

main().catch(console.error);
