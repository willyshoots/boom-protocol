use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};

declare_id!("CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9");

#[program]
pub mod boom_hook {
    use super::*;

    /// Initialize the global hook config
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.transfers_enabled = true;
        config.bump = ctx.bumps.config;
        msg!("Hook initialized with authority: {}", config.authority);
        Ok(())
    }

    /// Add a whitelist entry for a specific mint's official LP
    /// Only authority can call this
    pub fn add_whitelist(ctx: Context<AddWhitelist>, official_lp: Pubkey) -> Result<()> {
        let whitelist = &mut ctx.accounts.whitelist;
        whitelist.mint = ctx.accounts.mint.key();
        whitelist.official_lp = official_lp;
        whitelist.bump = ctx.bumps.whitelist;
        msg!("Whitelist added - Mint: {}, LP: {}", whitelist.mint, official_lp);
        Ok(())
    }

    /// Update the whitelisted LP for a mint (in case LP changes)
    pub fn update_whitelist(ctx: Context<UpdateWhitelist>, new_lp: Pubkey) -> Result<()> {
        ctx.accounts.whitelist.official_lp = new_lp;
        msg!("Whitelist updated - Mint: {}, New LP: {}", ctx.accounts.whitelist.mint, new_lp);
        Ok(())
    }

    /// Toggle global transfers (emergency kill switch)
    pub fn set_transfers_enabled(ctx: Context<UpdateConfig>, enabled: bool) -> Result<()> {
        ctx.accounts.config.transfers_enabled = enabled;
        msg!("Transfers enabled: {}", enabled);
        Ok(())
    }

    /// The transfer hook - validates every transfer
    /// Called automatically by Token2022 on every transfer of hooked tokens
    pub fn execute(ctx: Context<Execute>, _amount: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        
        // Check global kill switch
        require!(config.transfers_enabled, HookError::TransfersDisabled);
        
        let destination = &ctx.accounts.destination_token;
        let dest_owner = destination.owner;
        let mint_key = ctx.accounts.mint.key();
        
        // Check if there's a whitelist entry for this mint
        let whitelist = &ctx.accounts.whitelist;
        
        // If whitelist exists and destination is the official LP, allow
        if whitelist.mint == mint_key && whitelist.official_lp != Pubkey::default() {
            if dest_owner == whitelist.official_lp {
                msg!("Transfer to official LP allowed for mint {}", mint_key);
                return Ok(());
            }
        }
        
        // Allow transfers to regular wallets
        // Regular wallets have accounts owned by System Program
        let system_program_id = anchor_lang::system_program::ID;
        if dest_owner == system_program_id {
            msg!("Transfer to wallet allowed");
            return Ok(());
        }
        
        // Allow transfers to Token-2022 owned accounts (ATAs)
        let token_2022_id = anchor_spl::token_2022::ID;
        if dest_owner == token_2022_id {
            msg!("Transfer to token account allowed");
            return Ok(());
        }
        
        // Allow transfers to regular Token Program accounts too (for compatibility)
        let token_program_id = anchor_spl::token::ID;
        if dest_owner == token_program_id {
            msg!("Transfer to legacy token account allowed");
            return Ok(());
        }
        
        // Block all other transfers (likely pool programs)
        msg!("Transfer BLOCKED - dest owner {} not whitelisted for mint {}", dest_owner, mint_key);
        Err(HookError::TransferToPoolBlocked.into())
    }
}

// ==================== ACCOUNTS ====================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + HookConfig::INIT_SPACE,
        seeds = [b"hook_config"],
        bump
    )]
    pub config: Account<'info, HookConfig>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddWhitelist<'info> {
    #[account(
        seeds = [b"hook_config"],
        bump = config.bump,
        has_one = authority
    )]
    pub config: Account<'info, HookConfig>,
    
    #[account(
        init,
        payer = authority,
        space = 8 + MintWhitelist::INIT_SPACE,
        seeds = [b"whitelist", mint.key().as_ref()],
        bump
    )]
    pub whitelist: Account<'info, MintWhitelist>,
    
    /// The token mint to whitelist
    pub mint: InterfaceAccount<'info, Mint>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateWhitelist<'info> {
    #[account(
        seeds = [b"hook_config"],
        bump = config.bump,
        has_one = authority
    )]
    pub config: Account<'info, HookConfig>,
    
    #[account(
        mut,
        seeds = [b"whitelist", whitelist.mint.as_ref()],
        bump = whitelist.bump
    )]
    pub whitelist: Account<'info, MintWhitelist>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        mut,
        seeds = [b"hook_config"],
        bump = config.bump,
        has_one = authority
    )]
    pub config: Account<'info, HookConfig>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Execute<'info> {
    #[account(
        seeds = [b"hook_config"],
        bump = config.bump
    )]
    pub config: Account<'info, HookConfig>,
    
    /// The whitelist entry for this mint (may not exist)
    /// CHECK: We handle the case where this doesn't exist
    #[account(
        seeds = [b"whitelist", mint.key().as_ref()],
        bump
    )]
    pub whitelist: Account<'info, MintWhitelist>,
    
    /// Source token account
    #[account()]
    pub source_token: InterfaceAccount<'info, TokenAccount>,
    
    /// The token mint being transferred
    #[account()]
    pub mint: InterfaceAccount<'info, Mint>,
    
    /// Destination token account
    #[account()]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,
    
    /// Source token owner (signer)
    pub owner: Signer<'info>,
    
    /// CHECK: Extra account metas - required by transfer hook interface
    #[account()]
    pub extra_account_metas: UncheckedAccount<'info>,
}

// ==================== STATE ====================

#[account]
#[derive(InitSpace)]
pub struct HookConfig {
    /// Authority who can manage whitelists
    pub authority: Pubkey,
    /// Global kill switch
    pub transfers_enabled: bool,
    /// PDA bump
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct MintWhitelist {
    /// The mint this whitelist is for
    pub mint: Pubkey,
    /// The official LP address for this mint
    pub official_lp: Pubkey,
    /// PDA bump
    pub bump: u8,
}

// ==================== ERRORS ====================

#[error_code]
pub enum HookError {
    #[msg("Transfer to non-whitelisted pool is blocked. Only official LP allowed.")]
    TransferToPoolBlocked,
    #[msg("All transfers are currently disabled by protocol")]
    TransfersDisabled,
}
