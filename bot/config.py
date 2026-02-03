"""
BOOM Protocol Bot Configuration
"""

from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Optional
import os


class BotConfig(BaseSettings):
    """Configuration for the BOOM price monitor bot."""
    
    # Solana network
    rpc_url: str = Field(
        default="https://api.devnet.solana.com",
        description="Solana RPC endpoint"
    )
    
    # Wallet
    keypair_path: str = Field(
        default="~/.config/solana/id.json",
        description="Path to keypair JSON file"
    )
    
    # BOOM Protocol
    program_id: str = Field(
        default="BOOM111111111111111111111111111111111111111",
        description="BOOM Protocol program ID"
    )
    
    # Token to monitor
    token_mint: Optional[str] = Field(
        default=None,
        description="Token mint address to monitor"
    )
    
    # Thresholds (in USD)
    market_cap_threshold: float = Field(
        default=100000.0,
        description="Market cap threshold to trigger explosion (USD)"
    )
    
    # Revealed cap for trigger_explosion instruction
    revealed_cap_lamports: int = Field(
        default=100_000_000_000,  # 100k USD in lamports representation
        description="Revealed cap value for the smart contract"
    )
    
    # Monitoring
    poll_interval_seconds: float = Field(
        default=5.0,
        description="How often to check price (seconds)"
    )
    
    # Price API (Jupiter is simpler for MVP)
    use_jupiter: bool = Field(
        default=True,
        description="Use Jupiter API for prices (vs Pyth)"
    )
    
    jupiter_api_url: str = Field(
        default="https://price.jup.ag/v6",
        description="Jupiter price API endpoint"
    )
    
    pyth_price_feed_id: Optional[str] = Field(
        default=None,
        description="Pyth price feed ID (if using Pyth)"
    )
    
    # Logging
    log_level: str = Field(default="INFO")
    log_file: Optional[str] = Field(default="boom_bot.log")
    
    # Dry run mode (don't actually trigger)
    dry_run: bool = Field(
        default=True,
        description="If true, log but don't send transactions"
    )
    
    class Config:
        env_prefix = "BOOM_"
        env_file = ".env"
        env_file_encoding = "utf-8"


def load_config() -> BotConfig:
    """Load configuration from environment/.env file."""
    return BotConfig()
