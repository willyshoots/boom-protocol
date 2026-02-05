use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_error::ProgramError;
use anchor_spl::token_interface::{Mint, TokenAccount};
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta,
    seeds::Seed,
    state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

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

    /// Initialize extra account metas with EMPTY list (Phase 1 - allows all transfers)
    /// Token2022 requires this PDA to exist for hook execution
    pub fn initialize_extra_account_meta_list_empty(ctx: Context<InitializeExtraAccountMetaListEmpty>) -> Result<()> {
        // Empty list - no extra accounts required
        let extra_account_metas: Vec<ExtraAccountMeta> = vec![];
        
        let extra_metas_account = &ctx.accounts.extra_account_metas;
        let mut data = extra_metas_account.try_borrow_mut_data()?;
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &extra_account_metas)?;

        msg!("Extra account metas initialized EMPTY for mint: {}", ctx.accounts.mint.key());
        msg!("Phase 1 mode: all transfers allowed");
        Ok(())
    }

    /// Initialize the extra account metas list for a mint (Phase 2 - lockdown)
    /// This tells Token2022 which extra accounts to pass to execute()
    pub fn initialize_extra_account_meta_list(ctx: Context<InitializeExtraAccountMetaList>) -> Result<()> {
        // The extra accounts our execute() function needs:
        // 1. config PDA - seeds: ["hook_config"]
        // 2. whitelist PDA - seeds: ["whitelist", mint]
        
        let extra_account_metas = vec![
            // Config PDA
            ExtraAccountMeta::new_with_seeds(
                &[Seed::Literal { bytes: b"hook_config".to_vec() }],
                false, // is_signer
                false, // is_writable
            )?,
            // Whitelist PDA  
            ExtraAccountMeta::new_with_seeds(
                &[
                    Seed::Literal { bytes: b"whitelist".to_vec() },
                    Seed::AccountKey { index: 1 }, // mint is at index 1 in execute accounts
                ],
                false,
                false,
            )?,
        ];

        // Calculate required space
        let _account_size = ExtraAccountMetaList::size_of(extra_account_metas.len())?;
        
        // Initialize the account
        let extra_metas_account = &ctx.accounts.extra_account_metas;
        let mut data = extra_metas_account.try_borrow_mut_data()?;
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &extra_account_metas)?;

        msg!("Extra account metas initialized for mint: {}", ctx.accounts.mint.key());
        msg!("Phase 2 mode: lockdown enabled");
        Ok(())
    }

    /// Upgrade extra account metas from Phase 1 (empty) to Phase 2 (with config+whitelist)
    /// This rewrites the data in place - account was pre-allocated with enough space
    pub fn upgrade_extra_account_meta_list(ctx: Context<UpgradeExtraAccountMetaList>) -> Result<()> {
        let extra_account_metas = vec![
            ExtraAccountMeta::new_with_seeds(
                &[Seed::Literal { bytes: b"hook_config".to_vec() }],
                false,
                false,
            )?,
            ExtraAccountMeta::new_with_seeds(
                &[
                    Seed::Literal { bytes: b"whitelist".to_vec() },
                    Seed::AccountKey { index: 1 },
                ],
                false,
                false,
            )?,
        ];
        
        let extra_metas_account = &ctx.accounts.extra_account_metas;
        let mut data = extra_metas_account.try_borrow_mut_data()?;
        
        // Clear the existing data first (zero out the discriminator)
        data[0..8].copy_from_slice(&[0u8; 8]);
        
        // Now init fresh
        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &extra_account_metas)?;

        msg!("Extra account metas UPGRADED to Phase 2 for mint: {}", ctx.accounts.mint.key());
        Ok(())
    }

    /// Add a whitelist entry for a specific mint's official LP
    /// Only authority can call this
    pub fn add_whitelist(ctx: Context<AddWhitelist>, official_lp: Pubkey) -> Result<()> {
        let whitelist = &mut ctx.accounts.whitelist;
        whitelist.mint = ctx.accounts.mint.key();
        whitelist.official_lp = official_lp;
        whitelist.pool_token_vault = Pubkey::default();
        whitelist.boom_program = Pubkey::default();
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

    /// Set the BOOM program's pool token vault for custom AMM
    /// This allows transfers to/from the pool vault
    pub fn set_pool_vault(
        ctx: Context<UpdateWhitelist>,
        pool_token_vault: Pubkey,
        boom_program: Pubkey,
    ) -> Result<()> {
        let whitelist = &mut ctx.accounts.whitelist;
        whitelist.pool_token_vault = pool_token_vault;
        whitelist.boom_program = boom_program;
        msg!("Pool vault set - Mint: {}, Vault: {}, BOOM Program: {}", 
            whitelist.mint, pool_token_vault, boom_program);
        Ok(())
    }

    /// Initialize whitelist with custom AMM pool (no external LP)
    pub fn add_whitelist_with_pool(
        ctx: Context<AddWhitelist>,
        pool_token_vault: Pubkey,
        boom_program: Pubkey,
    ) -> Result<()> {
        let whitelist = &mut ctx.accounts.whitelist;
        whitelist.mint = ctx.accounts.mint.key();
        whitelist.official_lp = Pubkey::default(); // No external LP
        whitelist.pool_token_vault = pool_token_vault;
        whitelist.boom_program = boom_program;
        whitelist.bump = ctx.bumps.whitelist;
        msg!("Whitelist added with pool - Mint: {}, Vault: {}, BOOM: {}", 
            whitelist.mint, pool_token_vault, boom_program);
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
    /// 
    /// NOTE: This function name MUST match the SPL transfer-hook-interface.
    /// The function signature uses: sha256("spl-transfer-hook-interface:execute")[0..8]
    /// which equals [105, 37, 101, 197, 75, 251, 102, 26]
    pub fn fallback<'info>(
        program_id: &Pubkey,
        accounts: &'info [AccountInfo<'info>],
        data: &[u8],
    ) -> Result<()> {
        // Check discriminator for SPL transfer-hook execute
        let execute_discriminator: [u8; 8] = [105, 37, 101, 197, 75, 251, 102, 26];
        
        if data.len() < 8 {
            return Err(ProgramError::InvalidInstructionData.into());
        }
        
        let (disc, rest) = data.split_at(8);
        if disc != execute_discriminator {
            return Err(ProgramError::InvalidInstructionData.into());
        }
        
        // Parse amount from remaining data (u64 little-endian)
        let amount = if rest.len() >= 8 {
            u64::from_le_bytes(rest[0..8].try_into().unwrap())
        } else {
            0
        };
        
        // Execute the transfer hook logic
        execute_transfer_hook(program_id, accounts, amount)
    }
}

/// Actual transfer hook logic (separated for clarity)
fn execute_transfer_hook<'info>(
    _program_id: &Pubkey,
    accounts: &'info [AccountInfo<'info>],
    _amount: u64,
) -> Result<()> {
    // Account indices per SPL transfer-hook-interface + our extra accounts:
    // 0: source_token
    // 1: mint
    // 2: destination_token
    // 3: owner
    // 4: extra_account_metas
    // 5+: our extra accounts (config, whitelist)
    
    // PHASE 1 MODE: If extra_account_metas not initialized, allow all transfers
    // This enables LP creation before lockdown
    if accounts.len() < 7 {
        msg!("Phase 1 mode: extra accounts not initialized, allowing transfer");
        return Ok(());
    }
    
    let source_token_info = &accounts[0];
    let destination_token_info = &accounts[2];
    let mint_info = &accounts[1];
    let config_info = &accounts[5];
    let whitelist_info = &accounts[6];
    
    // Deserialize config to check kill switch
    let config_data = config_info.try_borrow_data()?;
    if config_data.len() < 8 + 32 + 1 + 1 {
        msg!("Invalid config account");
        return Err(ProgramError::InvalidAccountData.into());
    }
    
    // Skip 8-byte discriminator, then: authority (32), transfers_enabled (1), bump (1)
    let transfers_enabled = config_data[8 + 32] == 1;
    if !transfers_enabled {
        msg!("Transfers are disabled globally");
        return Err(HookError::TransfersDisabled.into());
    }
    
    // Get destination token owner
    let dest_data = destination_token_info.try_borrow_data()?;
    // Token account layout: mint (32) + owner (32) at offset 32
    let dest_owner = Pubkey::try_from(&dest_data[32..64]).map_err(|_| ProgramError::InvalidAccountData)?;
    let mint_key = *mint_info.key;
    
    // Get source token info
    let source_data = source_token_info.try_borrow_data()?;
    let source_owner = Pubkey::try_from(&source_data[32..64]).map_err(|_| ProgramError::InvalidAccountData)?;
    
    // Parse whitelist - now has pool_token_vault and boom_program fields
    let whitelist_data = whitelist_info.try_borrow_data()?;
    
    // Whitelist layout: discriminator (8), mint (32), official_lp (32), pool_token_vault (32), boom_program (32), bump (1)
    // Check if whitelist exists and has valid data
    let (whitelist_mint, official_lp, pool_token_vault, boom_program) = if whitelist_data.len() >= 8 + 32 + 32 + 32 + 32 {
        let wl_mint = Pubkey::try_from(&whitelist_data[8..40]).map_err(|_| ProgramError::InvalidAccountData)?;
        let lp = Pubkey::try_from(&whitelist_data[40..72]).map_err(|_| ProgramError::InvalidAccountData)?;
        let vault = Pubkey::try_from(&whitelist_data[72..104]).map_err(|_| ProgramError::InvalidAccountData)?;
        let boom = Pubkey::try_from(&whitelist_data[104..136]).map_err(|_| ProgramError::InvalidAccountData)?;
        (wl_mint, lp, vault, boom)
    } else if whitelist_data.len() >= 8 + 32 + 32 {
        // Legacy format without pool vault
        let wl_mint = Pubkey::try_from(&whitelist_data[8..40]).map_err(|_| ProgramError::InvalidAccountData)?;
        let lp = Pubkey::try_from(&whitelist_data[40..72]).map_err(|_| ProgramError::InvalidAccountData)?;
        (wl_mint, lp, Pubkey::default(), Pubkey::default())
    } else {
        // No whitelist data - trading not enabled
        msg!("Trading not enabled yet - no whitelist");
        return Err(HookError::TradingNotEnabled.into());
    };
    
    // Get authority from config for bypass check
    let authority = Pubkey::try_from(&config_data[8..40]).map_err(|_| ProgramError::InvalidAccountData)?;
    
    // AUTHORITY BYPASS: Allow authority to transfer during setup (for LP creation)
    if source_owner == authority {
        msg!("Authority transfer allowed for LP setup - source: {}", source_owner);
        return Ok(());
    }
    
    // Check if trading is enabled (either external LP or custom pool vault is set)
    let has_external_lp = official_lp != Pubkey::default();
    let has_pool_vault = pool_token_vault != Pubkey::default();
    
    if !has_external_lp && !has_pool_vault {
        msg!("Trading not enabled yet - no LP or pool vault set for mint {}", mint_key);
        return Err(HookError::TradingNotEnabled.into());
    }
    
    // Trading is enabled - now apply rules
    
    // 1. Allow transfers to the official external LP (if set)
    if has_external_lp && whitelist_mint == mint_key && dest_owner == official_lp {
        msg!("Transfer to official LP allowed");
        return Ok(());
    }
    
    // 2. Allow transfers TO the pool token vault (user selling tokens)
    // The destination is the pool vault itself
    let dest_key = *destination_token_info.key;
    if has_pool_vault && dest_key == pool_token_vault {
        msg!("Transfer to pool vault allowed (sell)");
        return Ok(());
    }
    
    // 3. Allow transfers FROM the pool token vault (user buying tokens via CPI)
    // The source is the pool vault - this happens when BOOM program does CPI transfer
    let source_key = *source_token_info.key;
    if has_pool_vault && source_key == pool_token_vault {
        msg!("Transfer from pool vault allowed (buy via BOOM program CPI)");
        return Ok(());
    }
    
    // 4. Check the ACCOUNT owner (which program owns the account data)
    // Regular wallet ATAs are owned by Token2022 program - that's fine
    // DEX pools are owned by their respective programs - those we want to block (unless whitelisted)
    let account_owner = destination_token_info.owner;
    let token_2022_id = anchor_spl::token_2022::ID;
    let token_program_id = anchor_spl::token::ID;
    
    // Allow if the destination account is owned by Token2022 or legacy Token program
    // (this means it's a regular ATA, not a pool)
    if *account_owner == token_2022_id || *account_owner == token_program_id {
        msg!("Transfer to wallet allowed (trading enabled)");
        return Ok(());
    }
    
    msg!("Transfer BLOCKED - account owner {} not allowed for mint {}", account_owner, mint_key);
    Err(HookError::TransferToPoolBlocked.into())
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

/// Accounts for initializing extra account metas EMPTY (Phase 1 - allows all)
/// Pre-allocates space for Phase 2 upgrade
#[derive(Accounts)]
pub struct InitializeExtraAccountMetaListEmpty<'info> {
    /// The extra account metas PDA - EMPTY but with space for 2
    /// CHECK: Initialized by this instruction
    #[account(
        init,
        payer = payer,
        space = ExtraAccountMetaList::size_of(2).unwrap(), // Pre-allocate for Phase 2
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump
    )]
    pub extra_account_metas: UncheckedAccount<'info>,
    
    /// The token mint
    pub mint: InterfaceAccount<'info, Mint>,
    
    /// The payer for rent
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

/// Accounts for upgrading extra account metas from Phase 1 to Phase 2
#[derive(Accounts)]
pub struct UpgradeExtraAccountMetaList<'info> {
    /// Hook config for authority check
    #[account(
        seeds = [b"hook_config"],
        bump = config.bump,
        has_one = authority
    )]
    pub config: Account<'info, HookConfig>,

    /// The extra account metas PDA to upgrade
    /// CHECK: Already initialized, will be rewritten
    #[account(
        mut,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump
    )]
    pub extra_account_metas: UncheckedAccount<'info>,
    
    /// The token mint
    pub mint: InterfaceAccount<'info, Mint>,
    
    /// Authority (must match config)
    pub authority: Signer<'info>,
}

/// Accounts for initializing extra account metas with blocking (fresh init for Phase 2)
#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    /// The extra account metas PDA
    /// CHECK: Fresh init
    #[account(
        init,
        payer = payer,
        space = ExtraAccountMetaList::size_of(2).unwrap(), // 2 extra accounts: config + whitelist
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump
    )]
    pub extra_account_metas: UncheckedAccount<'info>,
    
    /// The token mint
    pub mint: InterfaceAccount<'info, Mint>,
    
    /// The payer for rent
    #[account(mut)]
    pub payer: Signer<'info>,
    
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
    /// The official LP address for this mint (legacy - can be zero for custom AMM)
    pub official_lp: Pubkey,
    /// BOOM program's pool token vault (for custom AMM)
    pub pool_token_vault: Pubkey,
    /// BOOM program ID (allowed to do CPI transfers)
    pub boom_program: Pubkey,
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
    #[msg("Trading not enabled yet - LP must be whitelisted first")]
    TradingNotEnabled,
}
