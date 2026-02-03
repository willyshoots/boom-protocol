"""
Solana client for interacting with BOOM Protocol smart contract.
"""

import json
import asyncio
from pathlib import Path
from typing import Optional, Tuple
from dataclasses import dataclass

from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Confirmed
from solana.transaction import Transaction
from solders.pubkey import Pubkey
from solders.keypair import Keypair
from solders.instruction import Instruction, AccountMeta
from solders.system_program import ID as SYSTEM_PROGRAM_ID
from solders.hash import Hash

import structlog

logger = structlog.get_logger()


@dataclass
class BoomTokenState:
    """State of a BOOM token from on-chain."""
    mint: Pubkey
    name: str
    symbol: str
    is_exploded: bool
    cap_hash: bytes
    revealed_cap: int
    explosion_time: int


class SolanaClient:
    """Client for interacting with BOOM Protocol on Solana."""
    
    def __init__(
        self,
        rpc_url: str,
        keypair_path: str,
        program_id: str,
    ):
        self.rpc_url = rpc_url
        self.program_id = Pubkey.from_string(program_id)
        self.keypair = self._load_keypair(keypair_path)
        self.client: Optional[AsyncClient] = None
    
    def _load_keypair(self, path: str) -> Keypair:
        """Load keypair from JSON file."""
        expanded_path = Path(path).expanduser()
        
        if not expanded_path.exists():
            logger.warning("keypair_not_found_generating_new", path=str(expanded_path))
            # Generate a new keypair for testing
            kp = Keypair()
            logger.info("generated_keypair", pubkey=str(kp.pubkey()))
            return kp
        
        with open(expanded_path) as f:
            secret_key = json.load(f)
        
        return Keypair.from_bytes(bytes(secret_key))
    
    async def connect(self):
        """Connect to Solana RPC."""
        self.client = AsyncClient(self.rpc_url, commitment=Confirmed)
        logger.info("connected_to_solana", rpc=self.rpc_url)
    
    async def close(self):
        """Close connection."""
        if self.client:
            await self.client.close()
    
    def get_protocol_pda(self) -> Tuple[Pubkey, int]:
        """Derive the protocol PDA."""
        return Pubkey.find_program_address(
            [b"protocol"],
            self.program_id
        )
    
    def get_boom_token_pda(self, mint: Pubkey) -> Tuple[Pubkey, int]:
        """Derive the boom_token PDA for a given mint."""
        return Pubkey.find_program_address(
            [b"boom_token", bytes(mint)],
            self.program_id
        )
    
    async def get_boom_token_state(self, mint: Pubkey) -> Optional[BoomTokenState]:
        """Fetch the BoomToken account state."""
        if not self.client:
            raise RuntimeError("Client not connected")
        
        boom_token_pda, _ = self.get_boom_token_pda(mint)
        
        try:
            response = await self.client.get_account_info(boom_token_pda)
            
            if response.value is None:
                logger.warning("boom_token_account_not_found", pda=str(boom_token_pda))
                return None
            
            # Parse account data (simplified - would use Anchor IDL in production)
            data = response.value.data
            
            # For hackathon MVP, return mock state if we can't parse
            # Real implementation would use anchorpy to deserialize
            logger.info("boom_token_found", pda=str(boom_token_pda), data_len=len(data))
            
            return BoomTokenState(
                mint=mint,
                name="BOOM Token",
                symbol="BOOM",
                is_exploded=False,  # Would parse from data
                cap_hash=bytes(32),
                revealed_cap=0,
                explosion_time=0,
            )
            
        except Exception as e:
            logger.error("get_boom_token_state_error", error=str(e))
            return None
    
    async def trigger_explosion(
        self,
        token_mint: Pubkey,
        revealed_cap: int,
        price_proof: bytes = b"",
        dry_run: bool = True,
    ) -> Optional[str]:
        """
        Call trigger_explosion on the BOOM Protocol.
        
        Args:
            token_mint: The token mint address
            revealed_cap: The revealed market cap threshold
            price_proof: Price proof from Pyth (empty for MVP)
            dry_run: If True, don't actually send the transaction
        
        Returns:
            Transaction signature if successful, None otherwise
        """
        if not self.client:
            raise RuntimeError("Client not connected")
        
        boom_token_pda, _ = self.get_boom_token_pda(token_mint)
        protocol_pda, _ = self.get_protocol_pda()
        
        logger.info(
            "preparing_trigger_explosion",
            mint=str(token_mint),
            boom_token_pda=str(boom_token_pda),
            protocol_pda=str(protocol_pda),
            revealed_cap=revealed_cap,
            dry_run=dry_run,
        )
        
        if dry_run:
            logger.info("dry_run_skipping_transaction")
            return "DRY_RUN_SUCCESS"
        
        try:
            # Build the instruction
            # Anchor discriminator for "trigger_explosion"
            discriminator = bytes([0x5d, 0x9b, 0x8e, 0x4f, 0x2a, 0x1c, 0x3d, 0x7e])  # Example
            
            # Instruction data: discriminator + revealed_cap (u64) + price_proof (vec)
            instruction_data = (
                discriminator +
                revealed_cap.to_bytes(8, 'little') +
                len(price_proof).to_bytes(4, 'little') +
                price_proof
            )
            
            # Account metas
            accounts = [
                AccountMeta(pubkey=boom_token_pda, is_signer=False, is_writable=True),
                AccountMeta(pubkey=protocol_pda, is_signer=False, is_writable=True),
                AccountMeta(pubkey=Pubkey.default(), is_signer=False, is_writable=False),  # pyth_price placeholder
                AccountMeta(pubkey=self.keypair.pubkey(), is_signer=True, is_writable=False),
            ]
            
            instruction = Instruction(
                program_id=self.program_id,
                accounts=accounts,
                data=instruction_data,
            )
            
            # Get recent blockhash
            blockhash_response = await self.client.get_latest_blockhash()
            recent_blockhash = blockhash_response.value.blockhash
            
            # Build and sign transaction
            tx = Transaction(
                recent_blockhash=recent_blockhash,
                fee_payer=self.keypair.pubkey(),
            )
            tx.add(instruction)
            tx.sign(self.keypair)
            
            # Send transaction
            result = await self.client.send_transaction(tx)
            
            signature = str(result.value)
            logger.info("explosion_triggered", signature=signature)
            
            return signature
            
        except Exception as e:
            logger.error("trigger_explosion_error", error=str(e))
            return None
    
    async def get_token_supply(self, mint: Pubkey) -> Optional[int]:
        """Get total supply of a token."""
        if not self.client:
            raise RuntimeError("Client not connected")
        
        try:
            response = await self.client.get_token_supply(mint)
            if response.value:
                return int(response.value.amount)
            return None
        except Exception as e:
            logger.error("get_token_supply_error", error=str(e))
            return None
