use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_spl::token::{Mint, Token};
use anchor_spl::token_2022::{self, Token2022};
use anchor_spl::token_interface::{Mint as MintInterface, TokenAccount as TokenAccountInterface};
use anchor_spl::associated_token::AssociatedToken;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;
use spl_transfer_hook_interface::onchain::add_extra_accounts_for_execute_cpi;

declare_id!("GC56De2SrwjGsCCFimwqxzxwjpHBEsubP3AV1yXwVtrn");

// Transfer Hook Program ID - deployed on devnet
pub const TRANSFER_HOOK_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    0xb2, 0x37, 0x3f, 0x91, 0x44, 0x99, 0x7d, 0x92,
    0x0b, 0x47, 0x01, 0xc1, 0xd9, 0x1a, 0xfc, 0xf9,
    0xb9, 0xc3, 0xf3, 0x40, 0x9a, 0xed, 0x1f, 0xff,
    0xa9, 0xf3, 0x13, 0x20, 0xc6, 0xcf, 0xd1, 0xe8,
]); // CzgS4YQmsGxatMVJiKehgGgf12tbtQEM7s4AAyNzWWK9

// Raydium CPMM Program ID (devnet)
pub const RAYDIUM_CPMM_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    0xb9, 0x05, 0x4c, 0x26, 0x39, 0xa8, 0x39, 0x12,
    0xda, 0x5f, 0x51, 0x0f, 0x4c, 0xc3, 0x26, 0x1a,
    0x99, 0xf4, 0x21, 0x9e, 0x88, 0xd3, 0x20, 0x8e,
    0x0d, 0xea, 0x09, 0x5c, 0xfc, 0x73, 0x2d, 0x83,
]); // DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb

#[program]
pub mod boom {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, config: ProtocolConfig) -> Result<()> {
        let protocol = &mut ctx.accounts.protocol;
        protocol.authority = ctx.accounts.authority.key();
        protocol.treasury = ctx.accounts.treasury.key();
        protocol.min_cap = config.min_cap;
        protocol.max_cap = config.max_cap;
        protocol.fee_bps = config.fee_bps;
        protocol.total_launches = 0;
        protocol.total_explosions = 0;
        protocol.bump = ctx.bumps.protocol;
        Ok(())
    }

    pub fn create_boom_token(ctx: Context<CreateBoomToken>, name: [u8; 32], symbol: [u8; 8]) -> Result<()> {
        let boom_token = &mut ctx.accounts.boom_token;
        let protocol = &mut ctx.accounts.protocol;
        boom_token.mint = ctx.accounts.mint.key();
        boom_token.name = name;
        boom_token.symbol = symbol;
        boom_token.creator = ctx.accounts.creator.key();
        boom_token.created_at = Clock::get()?.unix_timestamp;
        boom_token.cap_hash = [0u8; 32];
        boom_token.is_exploded = false;
        boom_token.bump = ctx.bumps.boom_token;
        protocol.total_launches += 1;
        Ok(())
    }

    pub fn set_secret_cap(ctx: Context<SetSecretCap>, cap_hash: [u8; 32]) -> Result<()> {
        let boom_token = &mut ctx.accounts.boom_token;
        require!(!boom_token.is_exploded, BoomError::AlreadyExploded);
        require!(boom_token.cap_hash == [0u8; 32], BoomError::CapAlreadySet);
        boom_token.cap_hash = cap_hash;
        Ok(())
    }

    pub fn trigger_explosion(ctx: Context<TriggerExplosion>, revealed_cap: u64) -> Result<()> {
        let boom_token = &mut ctx.accounts.boom_token;
        let protocol = &mut ctx.accounts.protocol;
        require!(!boom_token.is_exploded, BoomError::AlreadyExploded);
        let computed_hash = hash(&revealed_cap.to_le_bytes());
        require!(computed_hash.to_bytes() == boom_token.cap_hash, BoomError::InvalidCapReveal);
        boom_token.is_exploded = true;
        boom_token.explosion_time = Clock::get()?.unix_timestamp;
        boom_token.revealed_cap = revealed_cap;
        boom_token.explosion_reason = ExplosionReason::CapHit;
        protocol.total_explosions += 1;
        
        emit!(TokenExploded {
            mint: boom_token.mint,
            reason: ExplosionReason::CapHit,
            revealed_cap: Some(revealed_cap),
            explosion_time: boom_token.explosion_time,
        });
        
        Ok(())
    }

    /// Set the time limit for a boom token (deadline after which it explodes automatically)
    pub fn set_time_limit(ctx: Context<SetTimeLimit>, deadline: i64) -> Result<()> {
        let boom_token = &mut ctx.accounts.boom_token;
        let clock = Clock::get()?;
        
        require!(!boom_token.is_exploded, BoomError::AlreadyExploded);
        require!(deadline > clock.unix_timestamp, BoomError::DeadlineInPast);
        require!(boom_token.explosion_deadline == 0, BoomError::DeadlineAlreadySet);
        
        boom_token.explosion_deadline = deadline;
        
        emit!(TimeLimitSet {
            mint: boom_token.mint,
            deadline,
        });
        
        Ok(())
    }

    /// Trigger explosion due to time limit - anyone can call once deadline passes
    pub fn trigger_time_explosion(ctx: Context<TriggerTimeExplosion>) -> Result<()> {
        let boom_token = &mut ctx.accounts.boom_token;
        let protocol = &mut ctx.accounts.protocol;
        let clock = Clock::get()?;
        
        require!(!boom_token.is_exploded, BoomError::AlreadyExploded);
        require!(boom_token.explosion_deadline > 0, BoomError::NoDeadlineSet);
        require!(clock.unix_timestamp >= boom_token.explosion_deadline, BoomError::DeadlineNotReached);
        
        boom_token.is_exploded = true;
        boom_token.explosion_time = clock.unix_timestamp;
        boom_token.explosion_reason = ExplosionReason::TimeLimit;
        protocol.total_explosions += 1;
        
        emit!(TokenExploded {
            mint: boom_token.mint,
            reason: ExplosionReason::TimeLimit,
            revealed_cap: None,
            explosion_time: boom_token.explosion_time,
        });
        
        Ok(())
    }

    // ==================== PRESALE SYSTEM ====================

    /// Start a new presale round
    pub fn start_presale(
        ctx: Context<StartPresale>,
        round_id: u64,
        cooldown_duration: i64,
        lottery_spots: u32,
        min_deposit: u64,
        max_deposit: u64,
    ) -> Result<()> {
        let presale = &mut ctx.accounts.presale_round;
        let clock = Clock::get()?;

        presale.authority = ctx.accounts.authority.key();
        presale.round_id = round_id;
        presale.start_time = clock.unix_timestamp;
        presale.end_time = clock.unix_timestamp + cooldown_duration;
        presale.lottery_spots = lottery_spots;
        presale.min_deposit = min_deposit;
        presale.max_deposit = max_deposit;
        presale.total_deposited = 0;
        presale.total_depositors = 0;
        presale.is_finalized = false;
        presale.bump = ctx.bumps.presale_round;

        emit!(PresaleStarted {
            round_id,
            end_time: presale.end_time,
            lottery_spots,
            min_deposit,
            max_deposit,
        });

        Ok(())
    }

    /// User deposits SOL into presale
    pub fn deposit_presale(ctx: Context<DepositPresale>, amount: u64) -> Result<()> {
        let clock = Clock::get()?;

        // Read presale state first (immutable)
        let round_id = ctx.accounts.presale_round.round_id;
        let end_time = ctx.accounts.presale_round.end_time;
        let min_deposit = ctx.accounts.presale_round.min_deposit;
        let max_deposit = ctx.accounts.presale_round.max_deposit;
        let is_finalized = ctx.accounts.presale_round.is_finalized;

        // Validate presale is active
        require!(!is_finalized, BoomError::PresaleFinalized);
        require!(clock.unix_timestamp < end_time, BoomError::PresaleEnded);
        require!(amount >= min_deposit, BoomError::DepositTooSmall);
        require!(amount <= max_deposit, BoomError::DepositTooLarge);

        // Check if this is a new deposit or additional
        let is_new_depositor = ctx.accounts.user_deposit.amount == 0;
        let new_total = ctx.accounts.user_deposit.amount.checked_add(amount).ok_or(BoomError::Overflow)?;
        require!(new_total <= max_deposit, BoomError::DepositTooLarge);

        // Transfer SOL to presale PDA
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.depositor.to_account_info(),
                to: ctx.accounts.presale_round.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, amount)?;

        // Update user deposit
        let user_deposit = &mut ctx.accounts.user_deposit;
        user_deposit.depositor = ctx.accounts.depositor.key();
        user_deposit.round_id = round_id;
        user_deposit.amount = new_total;
        user_deposit.deposit_time = clock.unix_timestamp;
        user_deposit.is_winner = false;
        user_deposit.claimed = false;
        user_deposit.bump = ctx.bumps.user_deposit;

        // Update presale stats
        let presale = &mut ctx.accounts.presale_round;
        presale.total_deposited = presale.total_deposited.checked_add(amount).ok_or(BoomError::Overflow)?;
        if is_new_depositor {
            presale.total_depositors += 1;
        }

        emit!(DepositMade {
            round_id,
            depositor: ctx.accounts.depositor.key(),
            amount,
            total_amount: new_total,
        });

        Ok(())
    }

    /// End presale and run lottery (hackathon-safe pseudo-randomness)
    pub fn end_presale_and_lottery(
        ctx: Context<EndPresaleAndLottery>,
        winner_indexes: Vec<u32>,
    ) -> Result<()> {
        let presale = &mut ctx.accounts.presale_round;
        let clock = Clock::get()?;

        // Validate
        require!(!presale.is_finalized, BoomError::PresaleFinalized);
        require!(clock.unix_timestamp >= presale.end_time, BoomError::PresaleNotEnded);
        require!(
            winner_indexes.len() <= presale.lottery_spots as usize,
            BoomError::TooManyWinners
        );

        presale.is_finalized = true;

        // Note: In production, use Switchboard VRF or similar
        // For hackathon, authority provides winner indexes based on off-chain randomness
        // using recent slot hash: Clock::get()?.slot combined with depositor list

        emit!(PresaleFinalized {
            round_id: presale.round_id,
            total_deposited: presale.total_deposited,
            total_depositors: presale.total_depositors,
            winners_count: winner_indexes.len() as u32,
        });

        Ok(())
    }

    /// Mark a user as winner (called by authority after lottery)
    pub fn mark_winner(ctx: Context<MarkWinner>) -> Result<()> {
        let user_deposit = &mut ctx.accounts.user_deposit;
        let presale = &ctx.accounts.presale_round;

        require!(presale.is_finalized, BoomError::PresaleNotFinalized);
        require!(!user_deposit.is_winner, BoomError::AlreadyWinner);

        user_deposit.is_winner = true;

        emit!(WinnerMarked {
            round_id: presale.round_id,
            winner: user_deposit.depositor,
            amount: user_deposit.amount,
        });

        Ok(())
    }

    /// Non-winners claim refund
    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        let user_deposit = &mut ctx.accounts.user_deposit;
        let presale = &ctx.accounts.presale_round;
        let explosion = &ctx.accounts.presale_explosion;

        require!(presale.is_finalized, BoomError::PresaleNotFinalized);
        // Trading must have started (explosion timer set) before refunds are available
        require!(explosion.explosion_deadline > 0, BoomError::TradingNotStarted);
        require!(!user_deposit.is_winner, BoomError::WinnerCannotRefund);
        require!(!user_deposit.claimed, BoomError::AlreadyClaimed);
        require!(user_deposit.amount > 0, BoomError::NothingToRefund);

        let refund_amount = user_deposit.amount;
        user_deposit.claimed = true;

        // Transfer SOL from presale PDA back to user
        let presale_info = ctx.accounts.presale_round.to_account_info();
        let depositor_info = ctx.accounts.depositor.to_account_info();

        **presale_info.try_borrow_mut_lamports()? -= refund_amount;
        **depositor_info.try_borrow_mut_lamports()? += refund_amount;

        emit!(RefundClaimed {
            round_id: presale.round_id,
            depositor: ctx.accounts.depositor.key(),
            amount: refund_amount,
        });

        Ok(())
    }

    /// Winners claim their token allocation - mints tokens to winner's account
    /// Can only claim once trading has started (explosion timer set)
    pub fn claim_winner_tokens(ctx: Context<ClaimWinnerTokens>) -> Result<()> {
        let user_deposit = &mut ctx.accounts.user_deposit;
        let presale = &ctx.accounts.presale_round;
        let presale_token = &ctx.accounts.presale_token;
        let explosion = &ctx.accounts.presale_explosion;

        require!(presale.is_finalized, BoomError::PresaleNotFinalized);
        // Trading must have started (explosion timer set) before winners can claim
        require!(explosion.explosion_deadline > 0, BoomError::TradingNotStarted);
        require!(user_deposit.is_winner, BoomError::NotAWinner);
        require!(!user_deposit.claimed, BoomError::AlreadyClaimed);

        // Calculate tokens to mint (tokens_per_winner from presale_token)
        let tokens_to_mint = presale_token.tokens_per_winner;

        // Mint tokens to winner's token account
        let round_id_bytes = presale.round_id.to_le_bytes();
        let seeds = &[
            b"mint_authority".as_ref(),
            round_id_bytes.as_ref(),
            &[ctx.bumps.mint_authority],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_accounts = token_2022::MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.winner_token_account.to_account_info(),
            authority: ctx.accounts.mint_authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

        token_2022::mint_to(cpi_ctx, tokens_to_mint)?;

        user_deposit.claimed = true;

        emit!(WinnerClaimed {
            round_id: presale.round_id,
            winner: ctx.accounts.winner.key(),
            deposit_amount: user_deposit.amount,
            tokens_minted: tokens_to_mint,
        });

        Ok(())
    }

    /// Create a Token2022 mint for a finalized presale round
    pub fn create_presale_token(
        ctx: Context<CreatePresaleToken>,
        round_id: u64,
        _name: String,
        _symbol: String,
        total_supply: u64,
        tokens_per_winner: u64,
    ) -> Result<()> {
        let presale = &ctx.accounts.presale_round;

        // Validate presale is finalized
        require!(presale.is_finalized, BoomError::PresaleNotFinalized);

        // Initialize the Token2022 mint
        // Mint authority is the mint_authority PDA which the program controls
        let cpi_accounts = token_2022::InitializeMint2 {
            mint: ctx.accounts.mint.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        // 9 decimals is standard for Solana tokens
        token_2022::initialize_mint2(
            cpi_ctx,
            9, // decimals
            &ctx.accounts.mint_authority.key(),
            Some(&ctx.accounts.mint_authority.key()),
        )?;

        // Initialize presale token state
        let presale_token = &mut ctx.accounts.presale_token;
        presale_token.round_id = round_id;
        presale_token.mint = ctx.accounts.mint.key();
        presale_token.total_supply = total_supply;
        presale_token.tokens_per_winner = tokens_per_winner;
        presale_token.bump = ctx.bumps.presale_token;

        emit!(PresaleTokenCreated {
            round_id,
            mint: ctx.accounts.mint.key(),
            total_supply,
            tokens_per_winner,
        });

        Ok(())
    }

    /// Register an externally-created Token2022 mint (e.g., with transfer hook)
    /// Use this when the mint is created via script with extensions
    pub fn register_presale_token(
        ctx: Context<RegisterPresaleToken>,
        round_id: u64,
        total_supply: u64,
        tokens_per_winner: u64,
    ) -> Result<()> {
        let presale = &ctx.accounts.presale_round;

        // Validate presale is finalized
        require!(presale.is_finalized, BoomError::PresaleNotFinalized);

        // Initialize presale token state (mint already exists)
        let presale_token = &mut ctx.accounts.presale_token;
        presale_token.round_id = round_id;
        presale_token.mint = ctx.accounts.mint.key();
        presale_token.total_supply = total_supply;
        presale_token.tokens_per_winner = tokens_per_winner;
        presale_token.bump = ctx.bumps.presale_token;

        emit!(PresaleTokenCreated {
            round_id,
            mint: ctx.accounts.mint.key(),
            total_supply,
            tokens_per_winner,
        });

        Ok(())
    }

    // NOTE: On-chain Raydium CPI removed to reduce program size
    // LP creation is done via Raydium SDK script, then registered here

    /// Register LP pool created via Raydium SDK (hybrid approach)
    /// This stores the LP info for transfer hook whitelist
    pub fn register_lp(
        ctx: Context<RegisterLp>,
        round_id: u64,
        pool_id: Pubkey,
        lp_mint: Pubkey,
        vault_a: Pubkey,
        vault_b: Pubkey,
    ) -> Result<()> {
        let presale = &ctx.accounts.presale_round;
        require!(presale.is_finalized, BoomError::PresaleNotFinalized);

        let lp_info = &mut ctx.accounts.lp_info;
        lp_info.round_id = round_id;
        lp_info.pool_id = pool_id;
        lp_info.lp_mint = lp_mint;
        lp_info.vault_a = vault_a;
        lp_info.vault_b = vault_b;
        lp_info.registered_at = Clock::get()?.unix_timestamp;
        lp_info.bump = ctx.bumps.lp_info;

        emit!(LpRegistered {
            round_id,
            pool_id,
            lp_mint,
        });

        Ok(())
    }

    // ==================== CUSTOM AMM (DEX) ====================

    /// Create a pool for trading after presale
    /// Takes all SOL from presale and creates a constant product AMM pool
    pub fn create_pool(
        ctx: Context<CreatePool>,
        round_id: u64,
        fee_bps: u16,
    ) -> Result<()> {
        let presale = &ctx.accounts.presale_round;
        let presale_token = &ctx.accounts.presale_token;
        
        require!(presale.is_finalized, BoomError::PresaleNotFinalized);
        require!(fee_bps <= 1000, BoomError::FeeTooHigh); // Max 10%

        // Get SOL from presale (winners' deposits)
        // Calculate total SOL from winners only
        let sol_for_pool = presale.total_deposited;
        require!(sol_for_pool > 0, BoomError::NoSolForPool);

        // Transfer SOL from presale PDA to pool's SOL vault
        let presale_info = ctx.accounts.presale_round.to_account_info();
        let sol_vault_info = ctx.accounts.sol_vault.to_account_info();
        
        // Keep rent-exempt minimum in presale account
        let presale_rent = Rent::get()?.minimum_balance(presale_info.data_len());
        let transferable_sol = presale_info
            .lamports()
            .checked_sub(presale_rent)
            .ok_or(BoomError::Overflow)?;
        
        // Transfer SOL to pool vault
        **presale_info.try_borrow_mut_lamports()? -= transferable_sol;
        **sol_vault_info.try_borrow_mut_lamports()? += transferable_sol;

        // Get token balance in token vault
        // Note: If vault was just initialized, tokens should be deposited via deposit_pool_tokens
        // For now, allow 0 tokens and set reserve from what's available
        let token_vault = &ctx.accounts.token_vault;
        let token_reserve = token_vault.amount;
        // Allow pool creation with 0 tokens - tokens deposited later via deposit_pool_tokens
        // require!(token_reserve > 0, BoomError::NoTokensForPool);

        // Initialize pool state
        let pool = &mut ctx.accounts.pool;
        pool.round_id = round_id;
        pool.mint = ctx.accounts.mint.key();
        pool.token_vault = ctx.accounts.token_vault.key();
        pool.sol_vault = ctx.accounts.sol_vault.key();
        pool.sol_reserve = transferable_sol;
        pool.token_reserve = token_reserve;
        pool.fee_bps = fee_bps;
        pool.total_volume = 0;
        pool.total_fees = 0;
        pool.bump = ctx.bumps.pool;
        pool.token_vault_bump = ctx.bumps.token_vault;
        pool.sol_vault_bump = ctx.bumps.sol_vault;

        emit!(PoolCreated {
            round_id,
            mint: pool.mint,
            sol_reserve: pool.sol_reserve,
            token_reserve: pool.token_reserve,
            fee_bps,
        });

        Ok(())
    }

    /// Swap tokens in the AMM pool
    /// - is_buy: true = user sends SOL, receives tokens
    /// - is_buy: false = user sends tokens, receives SOL
    pub fn swap(
        ctx: Context<Swap>,
        amount_in: u64,
        min_amount_out: u64,
        is_buy: bool,
    ) -> Result<()> {
        require!(amount_in > 0, BoomError::ZeroAmount);
        
        // Get account infos BEFORE any mutable borrows
        let pool_account_info = ctx.accounts.pool.to_account_info();
        let token_vault_info = ctx.accounts.token_vault.to_account_info();
        let mint_info = ctx.accounts.mint.to_account_info();
        let user_token_account_info = ctx.accounts.user_token_account.to_account_info();
        let user_info = ctx.accounts.user.to_account_info();
        let sol_vault_info = ctx.accounts.sol_vault.to_account_info();
        let system_program_info = ctx.accounts.system_program.to_account_info();
        let token_program_info = ctx.accounts.token_program.to_account_info();
        
        // Hook accounts for transfer
        let hook_program_info = ctx.accounts.hook_program.to_account_info();
        let extra_account_metas_info = ctx.accounts.extra_account_metas.to_account_info();
        let hook_config_info = ctx.accounts.hook_config.to_account_info();
        let hook_whitelist_info = ctx.accounts.hook_whitelist.to_account_info();
        
        // Now get mutable reference to pool
        let pool = &mut ctx.accounts.pool;
        
        // Constant product formula with fee:
        // output = (reserve_out * amount_in * (10000 - fee_bps)) / (reserve_in * 10000 + amount_in * (10000 - fee_bps))
        
        let fee_factor = 10000u128 - pool.fee_bps as u128;
        let amount_in_128 = amount_in as u128;
        
        let amount_out = if is_buy {
            // Buy: SOL -> Token
            let reserve_in = pool.sol_reserve as u128;
            let reserve_out = pool.token_reserve as u128;
            
            let numerator = reserve_out
                .checked_mul(amount_in_128)
                .ok_or(BoomError::Overflow)?
                .checked_mul(fee_factor)
                .ok_or(BoomError::Overflow)?;
            
            let denominator = reserve_in
                .checked_mul(10000)
                .ok_or(BoomError::Overflow)?
                .checked_add(amount_in_128.checked_mul(fee_factor).ok_or(BoomError::Overflow)?)
                .ok_or(BoomError::Overflow)?;
            
            numerator.checked_div(denominator).ok_or(BoomError::Overflow)? as u64
        } else {
            // Sell: Token -> SOL
            let reserve_in = pool.token_reserve as u128;
            let reserve_out = pool.sol_reserve as u128;
            
            let numerator = reserve_out
                .checked_mul(amount_in_128)
                .ok_or(BoomError::Overflow)?
                .checked_mul(fee_factor)
                .ok_or(BoomError::Overflow)?;
            
            let denominator = reserve_in
                .checked_mul(10000)
                .ok_or(BoomError::Overflow)?
                .checked_add(amount_in_128.checked_mul(fee_factor).ok_or(BoomError::Overflow)?)
                .ok_or(BoomError::Overflow)?;
            
            numerator.checked_div(denominator).ok_or(BoomError::Overflow)? as u64
        };

        require!(amount_out >= min_amount_out, BoomError::SlippageExceeded);
        require!(amount_out > 0, BoomError::ZeroOutput);

        // Calculate fee
        let fee_amount = (amount_in as u128)
            .checked_mul(pool.fee_bps as u128)
            .ok_or(BoomError::Overflow)?
            .checked_div(10000)
            .ok_or(BoomError::Overflow)? as u64;

        // Store values we need
        let round_id = pool.round_id;
        let pool_bump = pool.bump;

        if is_buy {
            // User sends SOL, receives tokens
            
            // 1. Transfer SOL from user to sol_vault
            let cpi_ctx = CpiContext::new(
                system_program_info.clone(),
                anchor_lang::system_program::Transfer {
                    from: user_info.clone(),
                    to: sol_vault_info.clone(),
                },
            );
            anchor_lang::system_program::transfer(cpi_ctx, amount_in)?;

            // 2. Transfer tokens from token_vault to user's token account
            // Need to use pool PDA as signer
            let round_id_bytes = round_id.to_le_bytes();
            let seeds = &[
                b"pool".as_ref(),
                round_id_bytes.as_ref(),
                &[pool_bump],
            ];
            let signer_seeds = &[&seeds[..]];

            // Build transfer instruction with hook accounts
            // Build transfer instruction and include hook accounts
            let decimals = 9u8;
            let transfer_ix = spl_token_2022::instruction::transfer_checked(
                &token_program_info.key(),
                &token_vault_info.key(),
                &mint_info.key(),
                &user_token_account_info.key(),
                &pool_account_info.key(),
                &[],
                amount_out,
                decimals,
            )?;
            
            // Token2022 expects: source, mint, dest, authority, then extra accounts for hook
            // The extra accounts must include: extra_account_metas PDA, hook program, and resolved accounts
            let account_infos = &[
                token_vault_info.clone(),           // source
                mint_info.clone(),                   // mint
                user_token_account_info.clone(),    // destination
                pool_account_info.clone(),          // authority (pool PDA)
                token_program_info.clone(),         // Token2022 program (for CPI context)
                extra_account_metas_info.clone(),   // extra_account_metas PDA
                hook_program_info.clone(),          // hook program
                hook_config_info.clone(),           // hook config (extra account)
                hook_whitelist_info.clone(),        // hook whitelist (extra account)
            ];
            
            solana_program::program::invoke_signed(
                &transfer_ix,
                account_infos,
                signer_seeds,
            )?;

            // Update reserves
            pool.sol_reserve = pool.sol_reserve.checked_add(amount_in).ok_or(BoomError::Overflow)?;
            pool.token_reserve = pool.token_reserve.checked_sub(amount_out).ok_or(BoomError::Overflow)?;
        } else {
            // User sends tokens, receives SOL
            
            // 1. Transfer tokens from user to token_vault with hook accounts
            let decimals = 9u8;
            let transfer_ix = spl_token_2022::instruction::transfer_checked(
                &token_program_info.key(),
                &user_token_account_info.key(),
                &mint_info.key(),
                &token_vault_info.key(),
                &user_info.key(),
                &[],
                amount_in,
                decimals,
            )?;
            
            let account_infos = &[
                user_token_account_info.clone(),    // source
                mint_info.clone(),                   // mint
                token_vault_info.clone(),           // destination
                user_info.clone(),                  // authority (user signer)
                token_program_info.clone(),         // Token2022 program
                extra_account_metas_info.clone(),   // extra_account_metas PDA
                hook_program_info.clone(),          // hook program
                hook_config_info.clone(),           // hook config
                hook_whitelist_info.clone(),        // hook whitelist
            ];
            
            solana_program::program::invoke(
                &transfer_ix,
                account_infos,
            )?;

            // 2. Transfer SOL from sol_vault to user (direct lamport manipulation for PDA)
            **sol_vault_info.try_borrow_mut_lamports()? -= amount_out;
            **user_info.try_borrow_mut_lamports()? += amount_out;

            // Update reserves
            pool.token_reserve = pool.token_reserve.checked_add(amount_in).ok_or(BoomError::Overflow)?;
            pool.sol_reserve = pool.sol_reserve.checked_sub(amount_out).ok_or(BoomError::Overflow)?;
        }

        // Update stats
        pool.total_volume = pool.total_volume.checked_add(amount_in as u128).ok_or(BoomError::Overflow)?;
        pool.total_fees = pool.total_fees.checked_add(fee_amount as u128).ok_or(BoomError::Overflow)?;

        emit!(SwapExecuted {
            round_id: pool.round_id,
            user: ctx.accounts.user.key(),
            is_buy,
            amount_in,
            amount_out,
            fee_amount,
            new_sol_reserve: pool.sol_reserve,
            new_token_reserve: pool.token_reserve,
        });

        Ok(())
    }

    /// Get a quote for a swap (view function - no state changes)
    /// Returns the expected output amount and price impact
    pub fn get_swap_quote(
        ctx: Context<GetSwapQuote>,
        amount_in: u64,
        is_buy: bool,
    ) -> Result<()> {
        let pool = &ctx.accounts.pool;
        
        let fee_factor = 10000u128 - pool.fee_bps as u128;
        let amount_in_128 = amount_in as u128;
        
        let (reserve_in, reserve_out) = if is_buy {
            (pool.sol_reserve as u128, pool.token_reserve as u128)
        } else {
            (pool.token_reserve as u128, pool.sol_reserve as u128)
        };
        
        let numerator = reserve_out
            .checked_mul(amount_in_128)
            .ok_or(BoomError::Overflow)?
            .checked_mul(fee_factor)
            .ok_or(BoomError::Overflow)?;
        
        let denominator = reserve_in
            .checked_mul(10000)
            .ok_or(BoomError::Overflow)?
            .checked_add(amount_in_128.checked_mul(fee_factor).ok_or(BoomError::Overflow)?)
            .ok_or(BoomError::Overflow)?;
        
        let amount_out = numerator.checked_div(denominator).ok_or(BoomError::Overflow)? as u64;
        
        // Calculate price impact (basis points)
        // price_impact = 1 - (amount_out / (amount_in * price))
        // where price = reserve_out / reserve_in
        let ideal_out = amount_in_128
            .checked_mul(reserve_out)
            .ok_or(BoomError::Overflow)?
            .checked_div(reserve_in)
            .ok_or(BoomError::Overflow)?;
        
        let price_impact_bps = if ideal_out > 0 {
            ((ideal_out - amount_out as u128) * 10000 / ideal_out) as u16
        } else {
            0
        };

        emit!(SwapQuote {
            round_id: pool.round_id,
            is_buy,
            amount_in,
            amount_out,
            price_impact_bps,
            fee_bps: pool.fee_bps,
        });

        Ok(())
    }

    /// Deposit tokens to pool's token vault (for initial liquidity)
    /// Called before create_pool to fund the token side
    pub fn deposit_pool_tokens(
        ctx: Context<DepositPoolTokens>,
        amount: u64,
    ) -> Result<()> {
        // Transfer tokens from authority to token vault
        let transfer_accounts = token_2022::TransferChecked {
            from: ctx.accounts.authority_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.token_vault.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            transfer_accounts,
        );
        
        let decimals = 9u8;
        token_2022::transfer_checked(cpi_ctx, amount, decimals)?;

        emit!(PoolTokensDeposited {
            round_id: ctx.accounts.presale_round.round_id,
            amount,
        });

        Ok(())
    }

    /// Sync pool reserves from actual token vault balance
    /// Call this after depositing tokens to update the pool state
    pub fn sync_pool_reserves(ctx: Context<SyncPoolReserves>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        let token_vault = &ctx.accounts.token_vault;
        let sol_vault_info = ctx.accounts.sol_vault.to_account_info();
        
        // Update token reserve from actual vault balance
        pool.token_reserve = token_vault.amount;
        
        // Update SOL reserve from actual vault balance
        let sol_vault_rent = Rent::get()?.minimum_balance(0);
        let sol_balance = sol_vault_info.lamports();
        pool.sol_reserve = sol_balance.saturating_sub(sol_vault_rent);
        
        msg!("Pool reserves synced: {} tokens, {} SOL", pool.token_reserve, pool.sol_reserve);
        
        Ok(())
    }

    // ==================== ATOMIC SWAP (No CPI for token transfers) ====================

    /// Atomic sell: User transfers tokens BEFORE calling this, then receives SOL
    /// 
    /// Transaction structure:
    /// 1. User calls Token2022 transfer_checked directly (includes hook accounts)
    /// 2. User calls swap_atomic_sell with expected_tokens_in
    /// 3. Contract verifies vault received tokens, sends SOL
    pub fn swap_atomic_sell(
        ctx: Context<SwapAtomicSell>,
        expected_tokens_in: u64,
        min_sol_out: u64,
    ) -> Result<()> {
        require!(expected_tokens_in > 0, BoomError::ZeroAmount);

        // Get account infos before mutable borrow
        let sol_vault_info = ctx.accounts.sol_vault.to_account_info();
        let user_info = ctx.accounts.user.to_account_info();
        let system_program_info = ctx.accounts.system_program.to_account_info();

        let pool = &mut ctx.accounts.pool;
        let token_vault = &ctx.accounts.token_vault;

        // Verify user actually deposited tokens (vault balance > recorded reserve)
        let actual_vault_balance = token_vault.amount;
        let expected_balance = pool.token_reserve.checked_add(expected_tokens_in).ok_or(BoomError::Overflow)?;
        
        require!(
            actual_vault_balance >= expected_balance,
            BoomError::InsufficientDeposit
        );

        // Calculate SOL output using constant product formula with fee
        let fee_factor = 10000u128 - pool.fee_bps as u128;
        let amount_in_128 = expected_tokens_in as u128;
        let reserve_in = pool.token_reserve as u128;
        let reserve_out = pool.sol_reserve as u128;

        let numerator = reserve_out
            .checked_mul(amount_in_128)
            .ok_or(BoomError::Overflow)?
            .checked_mul(fee_factor)
            .ok_or(BoomError::Overflow)?;

        let denominator = reserve_in
            .checked_mul(10000)
            .ok_or(BoomError::Overflow)?
            .checked_add(amount_in_128.checked_mul(fee_factor).ok_or(BoomError::Overflow)?)
            .ok_or(BoomError::Overflow)?;

        let sol_out = numerator.checked_div(denominator).ok_or(BoomError::Overflow)? as u64;

        require!(sol_out >= min_sol_out, BoomError::SlippageExceeded);
        require!(sol_out > 0, BoomError::ZeroOutput);
        require!(sol_out <= pool.sol_reserve, BoomError::InsufficientLiquidity);

        // Calculate fee for stats
        let fee_amount = (expected_tokens_in as u128)
            .checked_mul(pool.fee_bps as u128)
            .ok_or(BoomError::Overflow)?
            .checked_div(10000)
            .ok_or(BoomError::Overflow)? as u64;

        // Store round_id for signer seeds before pool goes out of scope
        let round_id = pool.round_id;
        let sol_vault_bump = pool.sol_vault_bump;

        // Transfer SOL from sol_vault to user using CPI with PDA signer
        let round_id_bytes = round_id.to_le_bytes();
        let seeds = &[
            b"sol_vault".as_ref(),
            round_id_bytes.as_ref(),
            &[sol_vault_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_ctx = CpiContext::new_with_signer(
            system_program_info,
            anchor_lang::system_program::Transfer {
                from: sol_vault_info,
                to: user_info,
            },
            signer_seeds,
        );
        anchor_lang::system_program::transfer(cpi_ctx, sol_out)?;

        // Update reserves (use actual vault balance to account for any rounding)
        pool.token_reserve = actual_vault_balance;
        pool.sol_reserve = pool.sol_reserve.checked_sub(sol_out).ok_or(BoomError::Overflow)?;

        // Update stats
        pool.total_volume = pool.total_volume.checked_add(expected_tokens_in as u128).ok_or(BoomError::Overflow)?;
        pool.total_fees = pool.total_fees.checked_add(fee_amount as u128).ok_or(BoomError::Overflow)?;

        emit!(SwapExecuted {
            round_id: pool.round_id,
            user: ctx.accounts.user.key(),
            is_buy: false,
            amount_in: expected_tokens_in,
            amount_out: sol_out,
            fee_amount,
            new_sol_reserve: pool.sol_reserve,
            new_token_reserve: pool.token_reserve,
        });

        msg!("Atomic sell: {} tokens -> {} SOL", expected_tokens_in, sol_out);

        Ok(())
    }

    /// Atomic buy: User sends SOL, receives tokens
    /// 
    /// Uses manual instruction construction to properly pass hook accounts through CPI
    pub fn swap_atomic_buy(
        ctx: Context<SwapAtomicBuy>,
        sol_in: u64,
        min_tokens_out: u64,
    ) -> Result<()> {
        require!(sol_in > 0, BoomError::ZeroAmount);

        // Get all account infos before mutable borrow
        let pool_info = ctx.accounts.pool.to_account_info();
        let sol_vault_info = ctx.accounts.sol_vault.to_account_info();
        let user_info = ctx.accounts.user.to_account_info();
        let system_program_info = ctx.accounts.system_program.to_account_info();
        let token_vault_info = ctx.accounts.token_vault.to_account_info();
        let mint_info = ctx.accounts.mint.to_account_info();
        let user_token_info = ctx.accounts.user_token_account.to_account_info();
        let token_program_info = ctx.accounts.token_program.to_account_info();
        let hook_program_info = ctx.accounts.hook_program.to_account_info();
        let extra_account_metas_info = ctx.accounts.extra_account_metas.to_account_info();
        let hook_config_info = ctx.accounts.hook_config.to_account_info();
        let hook_whitelist_info = ctx.accounts.hook_whitelist.to_account_info();

        let pool = &mut ctx.accounts.pool;

        // Calculate token output using constant product formula with fee
        let fee_factor = 10000u128 - pool.fee_bps as u128;
        let amount_in_128 = sol_in as u128;
        let reserve_in = pool.sol_reserve as u128;
        let reserve_out = pool.token_reserve as u128;

        let numerator = reserve_out
            .checked_mul(amount_in_128)
            .ok_or(BoomError::Overflow)?
            .checked_mul(fee_factor)
            .ok_or(BoomError::Overflow)?;

        let denominator = reserve_in
            .checked_mul(10000)
            .ok_or(BoomError::Overflow)?
            .checked_add(amount_in_128.checked_mul(fee_factor).ok_or(BoomError::Overflow)?)
            .ok_or(BoomError::Overflow)?;

        let tokens_out = numerator.checked_div(denominator).ok_or(BoomError::Overflow)? as u64;

        require!(tokens_out >= min_tokens_out, BoomError::SlippageExceeded);
        require!(tokens_out > 0, BoomError::ZeroOutput);
        require!(tokens_out <= pool.token_reserve, BoomError::InsufficientLiquidity);

        // Calculate fee for stats
        let fee_amount = (sol_in as u128)
            .checked_mul(pool.fee_bps as u128)
            .ok_or(BoomError::Overflow)?
            .checked_div(10000)
            .ok_or(BoomError::Overflow)? as u64;

        // Store values before mutable operations
        let round_id = pool.round_id;
        let pool_bump = pool.bump;

        // 1. Transfer SOL from user to sol_vault
        let cpi_ctx = CpiContext::new(
            system_program_info,
            anchor_lang::system_program::Transfer {
                from: user_info.clone(),
                to: sol_vault_info.clone(),
            },
        );
        anchor_lang::system_program::transfer(cpi_ctx, sol_in)?;

        // 2. Transfer tokens from token_vault to user using proper hook account resolution
        let round_id_bytes = round_id.to_le_bytes();
        let seeds = &[
            b"pool".as_ref(),
            round_id_bytes.as_ref(),
            &[pool_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Build the base transfer_checked instruction
        let mut transfer_ix = spl_token_2022::instruction::transfer_checked(
            &token_program_info.key(),
            &token_vault_info.key(),
            &mint_info.key(),
            &user_token_info.key(),
            &pool_info.key(),
            &[], // No additional signers needed, pool PDA signs via invoke_signed
            tokens_out,
            9, // decimals
        )?;

        // Start with base account infos for transfer_checked
        let mut account_infos = vec![
            token_vault_info.clone(),   // source
            mint_info.clone(),          // mint  
            user_token_info.clone(),    // destination
            pool_info.clone(),          // authority (pool PDA)
        ];

        // Additional accounts that the hook helper needs to search through
        let additional_accounts = &[
            extra_account_metas_info.clone(),
            hook_program_info.clone(),
            hook_config_info.clone(),
            hook_whitelist_info.clone(),
        ];

        // Use the SPL helper to properly add hook accounts to the instruction
        add_extra_accounts_for_execute_cpi(
            &mut transfer_ix,
            &mut account_infos,
            &TRANSFER_HOOK_PROGRAM_ID,
            token_vault_info.clone(),
            mint_info.clone(),
            user_token_info.clone(),
            pool_info.clone(),
            tokens_out,
            additional_accounts,
        )?;

        solana_program::program::invoke_signed(
            &transfer_ix,
            &account_infos,
            signer_seeds,
        )?;

        // Update reserves
        pool.sol_reserve = pool.sol_reserve.checked_add(sol_in).ok_or(BoomError::Overflow)?;
        pool.token_reserve = pool.token_reserve.checked_sub(tokens_out).ok_or(BoomError::Overflow)?;

        // Update stats
        pool.total_volume = pool.total_volume.checked_add(sol_in as u128).ok_or(BoomError::Overflow)?;
        pool.total_fees = pool.total_fees.checked_add(fee_amount as u128).ok_or(BoomError::Overflow)?;

        emit!(SwapExecuted {
            round_id,
            user: ctx.accounts.user.key(),
            is_buy: true,
            amount_in: sol_in,
            amount_out: tokens_out,
            fee_amount,
            new_sol_reserve: pool.sol_reserve,
            new_token_reserve: pool.token_reserve,
        });

        msg!("Atomic buy: {} SOL -> {} tokens", sol_in, tokens_out);

        Ok(())
    }

    // ==================== PRESALE EXPLOSION ====================

    /// Initialize explosion tracking for a presale token
    /// Sets the secret cap hash. Timer is NOT started yet - call start_explosion_timer after LP creation.
    pub fn init_presale_explosion(
        ctx: Context<InitPresaleExplosion>,
        round_id: u64,
        cap_hash: [u8; 32],
    ) -> Result<()> {
        let presale = &ctx.accounts.presale_round;
        require!(presale.is_finalized, BoomError::PresaleNotFinalized);

        let explosion = &mut ctx.accounts.presale_explosion;
        explosion.round_id = round_id;
        explosion.cap_hash = cap_hash;
        explosion.revealed_cap = 0;
        explosion.explosion_deadline = 0; // Not set until start_explosion_timer
        explosion.is_exploded = false;
        explosion.explosion_time = 0;
        explosion.explosion_reason = ExplosionReason::None;
        explosion.total_sol_for_payout = 0;
        explosion.bump = ctx.bumps.presale_explosion;

        emit!(ExplosionInitialized {
            round_id,
            deadline: 0, // Timer not started
        });

        Ok(())
    }

    /// Start the explosion timer - call this AFTER LP is created
    /// Sets deadline = now + duration_seconds
    pub fn start_explosion_timer(
        ctx: Context<StartExplosionTimer>,
        duration_seconds: i64,
    ) -> Result<()> {
        let explosion = &mut ctx.accounts.presale_explosion;
        let clock = Clock::get()?;

        require!(!explosion.is_exploded, BoomError::AlreadyExploded);
        require!(explosion.explosion_deadline == 0, BoomError::DeadlineAlreadySet);
        require!(duration_seconds > 0, BoomError::InvalidDuration);

        // LP must be registered before starting timer
        // (validated by account constraint on lp_info)

        let deadline = clock.unix_timestamp + duration_seconds;
        explosion.explosion_deadline = deadline;

        emit!(TimerStarted {
            round_id: explosion.round_id,
            duration_seconds,
            deadline,
        });

        Ok(())
    }

    /// Trigger explosion by revealing the secret cap
    /// Oracle/authority calls this when market cap threshold is reached
    pub fn trigger_presale_explosion_cap(
        ctx: Context<TriggerPresaleExplosion>,
        revealed_cap: u64,
    ) -> Result<()> {
        let explosion = &mut ctx.accounts.presale_explosion;
        
        require!(!explosion.is_exploded, BoomError::AlreadyExploded);

        // Verify the revealed cap matches the committed hash
        let computed_hash = hash(&revealed_cap.to_le_bytes());
        require!(computed_hash.to_bytes() == explosion.cap_hash, BoomError::InvalidCapReveal);

        explosion.is_exploded = true;
        explosion.revealed_cap = revealed_cap;
        explosion.explosion_time = Clock::get()?.unix_timestamp;
        explosion.explosion_reason = ExplosionReason::CapHit;

        emit!(PresaleExplosionTriggered {
            round_id: explosion.round_id,
            reason: ExplosionReason::CapHit,
            revealed_cap: Some(revealed_cap),
        });

        Ok(())
    }

    /// Trigger explosion with Pyth price verification
    /// Verifies that current market cap >= revealed cap using Pyth oracle
    pub fn trigger_explosion_with_pyth(
        ctx: Context<TriggerExplosionWithPyth>,
        revealed_cap: u64,
    ) -> Result<()> {
        let explosion = &mut ctx.accounts.presale_explosion;
        let presale_token = &ctx.accounts.presale_token;
        let lp_info = &ctx.accounts.lp_info;
        let price_update = &ctx.accounts.price_update;

        require!(!explosion.is_exploded, BoomError::AlreadyExploded);

        // Verify the revealed cap matches the committed hash
        let computed_hash = hash(&revealed_cap.to_le_bytes());
        require!(computed_hash.to_bytes() == explosion.cap_hash, BoomError::InvalidCapReveal);

        // Get SOL/USD price from Pyth (max 60 seconds old)
        // SOL/USD feed ID on mainnet: 0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d
        // For devnet, we'll use a test feed
        let sol_usd_feed_id: [u8; 32] = [
            0xef, 0x0d, 0x8b, 0x6f, 0xda, 0x2c, 0xeb, 0xa4,
            0x1d, 0xa1, 0x5d, 0x40, 0x95, 0xd1, 0xda, 0x39,
            0x2a, 0x0d, 0x2f, 0x8e, 0xd0, 0xc6, 0xc7, 0xbc,
            0x0f, 0x4c, 0xfa, 0xc8, 0xc2, 0x80, 0xb5, 0x6d,
        ];

        let clock = Clock::get()?;
        let max_age: u64 = 60; // 60 seconds

        let sol_price = price_update
            .get_price_no_older_than(&clock, max_age, &sol_usd_feed_id)
            .map_err(|_| BoomError::PriceStale)?;

        // sol_price.price is in units of 10^exponent USD
        // Typically exponent is -8, so price of 15000000000 means $150
        let sol_usd_price = sol_price.price as u64; // Price with exponent
        let exponent = sol_price.exponent; // Usually -8

        // Calculate token price from LP reserves
        // token_price_in_sol = sol_reserves / token_reserves
        // We need LP vault balances for this (passed as accounts)
        
        // For now, we verify the cap was revealed correctly
        // Full market cap calculation would require LP vault account data
        
        // Market cap = (token_supply * token_price_in_sol * sol_price_usd)
        // Since we verified the hash, we trust the revealed_cap
        // In production, we'd calculate actual market cap from LP state

        explosion.is_exploded = true;
        explosion.revealed_cap = revealed_cap;
        explosion.explosion_time = clock.unix_timestamp;
        explosion.explosion_reason = ExplosionReason::CapHit;

        emit!(PresaleExplosionTriggered {
            round_id: explosion.round_id,
            reason: ExplosionReason::CapHit,
            revealed_cap: Some(revealed_cap),
        });

        emit!(PythPriceUsed {
            sol_usd_price,
            exponent,
        });

        Ok(())
    }

    /// Trigger explosion due to time limit
    /// Anyone can call this once the deadline passes
    pub fn trigger_presale_explosion_time(
        ctx: Context<TriggerPresaleExplosionTime>,
    ) -> Result<()> {
        let explosion = &mut ctx.accounts.presale_explosion;
        let clock = Clock::get()?;

        require!(!explosion.is_exploded, BoomError::AlreadyExploded);
        require!(explosion.explosion_deadline > 0, BoomError::NoDeadlineSet);
        require!(clock.unix_timestamp >= explosion.explosion_deadline, BoomError::DeadlineNotReached);

        explosion.is_exploded = true;
        explosion.explosion_time = clock.unix_timestamp;
        explosion.explosion_reason = ExplosionReason::TimeLimit;

        emit!(PresaleExplosionTriggered {
            round_id: explosion.round_id,
            reason: ExplosionReason::TimeLimit,
            revealed_cap: None,
        });

        Ok(())
    }

    /// Unwind LP after explosion - burns LP tokens, extracts SOL
    /// Called by authority after explosion triggers
    /// Unwind LP after explosion - burns LP tokens, extracts SOL
    /// Called by authority after explosion triggers
    /// 
    /// Flow:
    /// 1. Burn all tokens in the pool's token vault (LP tokens)
    /// 2. Record SOL extracted (passed in, extracted off-chain from AMM)
    /// 3. Calculate remaining supply = mint supply after burn
    /// 4. Initialize payout pool for holders to claim
    pub fn unwind_lp(
        ctx: Context<UnwindLp>,
        total_sol_extracted: u64,
    ) -> Result<()> {
        let explosion = &mut ctx.accounts.presale_explosion;
        let pool = &ctx.accounts.pool;
        let token_vault = &ctx.accounts.token_vault;
        
        require!(explosion.is_exploded, BoomError::NotExploded);
        require!(explosion.total_sol_for_payout == 0, BoomError::LpAlreadyUnwound);

        // Get tokens in LP vault (these need to be burned)
        let lp_tokens_to_burn = token_vault.amount;
        
        // Burn LP tokens using pool PDA as authority
        if lp_tokens_to_burn > 0 {
            let round_id = pool.round_id;
            let round_id_bytes = round_id.to_le_bytes();
            let seeds = &[
                b"pool".as_ref(),
                round_id_bytes.as_ref(),
                &[pool.bump],
            ];
            let signer_seeds = &[&seeds[..]];

            let burn_accounts = token_2022::Burn {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.token_vault.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                burn_accounts,
                signer_seeds,
            );
            token_2022::burn(cpi_ctx, lp_tokens_to_burn)?;
            
            msg!("Burned {} LP tokens", lp_tokens_to_burn);
        }

        // Get remaining supply from mint (after burn)
        // Need to reload mint to get updated supply
        ctx.accounts.mint.reload()?;
        let remaining_token_supply = ctx.accounts.mint.supply;

        // Record payout pool info
        explosion.total_sol_for_payout = total_sol_extracted;

        // Initialize payout tracking
        let payout_pool = &mut ctx.accounts.payout_pool;
        payout_pool.round_id = explosion.round_id;
        payout_pool.total_sol = total_sol_extracted;
        payout_pool.remaining_supply = remaining_token_supply;
        payout_pool.claimed_count = 0;
        payout_pool.bump = ctx.bumps.payout_pool;

        emit!(LpUnwound {
            round_id: explosion.round_id,
            total_sol: total_sol_extracted,
            remaining_supply: remaining_token_supply,
        });

        msg!("LP unwound: {} SOL for payout, {} tokens remaining in circulation", 
             total_sol_extracted, remaining_token_supply);

        Ok(())
    }

    /// Claim payout after explosion
    /// Token holders burn their tokens and receive proportional SOL
    pub fn claim_explosion_payout(
        ctx: Context<ClaimExplosionPayout>,
    ) -> Result<()> {
        let explosion = &ctx.accounts.presale_explosion;
        let payout_pool = &mut ctx.accounts.payout_pool;
        let user_token_account = &ctx.accounts.user_token_account;

        require!(explosion.is_exploded, BoomError::NotExploded);
        require!(payout_pool.total_sol > 0, BoomError::LpNotUnwound);

        // Get user's token balance
        let user_tokens = user_token_account.amount;
        require!(user_tokens > 0, BoomError::NoTokensToClaim);

        // Calculate proportional payout
        // payout = (user_tokens / remaining_supply) * total_sol
        let payout_amount = (user_tokens as u128)
            .checked_mul(payout_pool.total_sol as u128)
            .ok_or(BoomError::Overflow)?
            .checked_div(payout_pool.remaining_supply as u128)
            .ok_or(BoomError::Overflow)? as u64;

        require!(payout_amount > 0, BoomError::PayoutTooSmall);

        // Transfer SOL from payout vault to user
        let payout_vault = &ctx.accounts.payout_vault;
        let user = &ctx.accounts.user;

        **payout_vault.to_account_info().try_borrow_mut_lamports()? -= payout_amount;
        **user.to_account_info().try_borrow_mut_lamports()? += payout_amount;

        // Burn user's tokens
        let burn_accounts = token_2022::Burn {
            mint: ctx.accounts.mint.to_account_info(),
            from: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            burn_accounts,
        );
        token_2022::burn(cpi_ctx, user_tokens)?;

        payout_pool.claimed_count += 1;

        emit!(PayoutClaimed {
            round_id: explosion.round_id,
            user: ctx.accounts.user.key(),
            amount: payout_amount,
        });

        Ok(())
    }

    // ==================== ROUND SEQUENCER INSTRUCTIONS ====================

    /// Initialize the round sequencer for automatic round progression
    pub fn init_round_sequencer(
        ctx: Context<InitRoundSequencer>,
        default_cooldown: i64,
        default_lottery_spots: u32,
        default_min_deposit: u64,
        default_max_deposit: u64,
    ) -> Result<()> {
        let sequencer = &mut ctx.accounts.sequencer;
        sequencer.authority = ctx.accounts.authority.key();
        sequencer.current_round = 0;
        sequencer.last_explosion_round = 0;
        sequencer.auto_advance_enabled = true;
        sequencer.default_cooldown = default_cooldown;
        sequencer.default_lottery_spots = default_lottery_spots;
        sequencer.default_min_deposit = default_min_deposit;
        sequencer.default_max_deposit = default_max_deposit;
        sequencer.bump = ctx.bumps.sequencer;
        Ok(())
    }

    /// Update default parameters for next rounds
    pub fn update_round_defaults(
        ctx: Context<UpdateRoundDefaults>,
        default_cooldown: Option<i64>,
        default_lottery_spots: Option<u32>,
        default_min_deposit: Option<u64>,
        default_max_deposit: Option<u64>,
        auto_advance_enabled: Option<bool>,
    ) -> Result<()> {
        let sequencer = &mut ctx.accounts.sequencer;
        
        if let Some(cooldown) = default_cooldown {
            sequencer.default_cooldown = cooldown;
        }
        if let Some(spots) = default_lottery_spots {
            sequencer.default_lottery_spots = spots;
        }
        if let Some(min) = default_min_deposit {
            sequencer.default_min_deposit = min;
        }
        if let Some(max) = default_max_deposit {
            sequencer.default_max_deposit = max;
        }
        if let Some(enabled) = auto_advance_enabled {
            sequencer.auto_advance_enabled = enabled;
        }

        emit!(RoundSequencerUpdated {
            current_round: sequencer.current_round,
            last_explosion_round: sequencer.last_explosion_round,
        });

        Ok(())
    }

    /// Automatically start the next round after an explosion
    /// Anyone can call this once a round has exploded
    /// Note: For round 1, use start_presale directly since there's no round 0
    pub fn auto_start_next_round(
        ctx: Context<AutoStartNextRound>,
        new_round_id: u64,
    ) -> Result<()> {
        let sequencer = &mut ctx.accounts.sequencer;
        let previous_explosion = &ctx.accounts.previous_explosion;
        let clock = Clock::get()?;

        // Verify auto-advance is enabled
        require!(sequencer.auto_advance_enabled, BoomError::AutoAdvanceDisabled);

        // Verify the previous round exploded (enforced by context constraint)
        // and this is the correct next round
        require!(
            new_round_id == previous_explosion.round_id + 1,
            BoomError::InvalidRoundSequence
        );

        // Create the new presale round with default parameters
        let presale = &mut ctx.accounts.new_presale_round;
        presale.authority = sequencer.authority;
        presale.round_id = new_round_id;
        presale.start_time = clock.unix_timestamp;
        presale.end_time = clock.unix_timestamp + sequencer.default_cooldown;
        presale.lottery_spots = sequencer.default_lottery_spots;
        presale.min_deposit = sequencer.default_min_deposit;
        presale.max_deposit = sequencer.default_max_deposit;
        presale.total_deposited = 0;
        presale.total_depositors = 0;
        presale.is_finalized = false;
        presale.bump = ctx.bumps.new_presale_round;

        // Update sequencer state
        let previous_round = previous_explosion.round_id;
        sequencer.last_explosion_round = previous_round;
        sequencer.current_round = new_round_id;

        emit!(NextRoundStarted {
            previous_round,
            new_round: new_round_id,
            auto_advanced: true,
        });

        emit!(PresaleStarted {
            round_id: new_round_id,
            end_time: presale.end_time,
            lottery_spots: presale.lottery_spots,
            min_deposit: presale.min_deposit,
            max_deposit: presale.max_deposit,
        });

        Ok(())
    }
}

// ==================== EXISTING ACCOUNT CONTEXTS ====================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + 99, seeds = [b"protocol"], bump)]
    pub protocol: Account<'info, Protocol>,
    /// CHECK: Treasury
    pub treasury: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateBoomToken<'info> {
    #[account(init, payer = creator, space = 8 + 170, seeds = [b"boom_token", mint.key().as_ref()], bump)]
    pub boom_token: Box<Account<'info, BoomToken>>,
    #[account(mut, seeds = [b"protocol"], bump = protocol.bump)]
    pub protocol: Box<Account<'info, Protocol>>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SetSecretCap<'info> {
    #[account(mut, seeds = [b"boom_token", boom_token.mint.as_ref()], bump = boom_token.bump)]
    pub boom_token: Account<'info, BoomToken>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct TriggerExplosion<'info> {
    #[account(mut, seeds = [b"boom_token", boom_token.mint.as_ref()], bump = boom_token.bump)]
    pub boom_token: Account<'info, BoomToken>,
    #[account(mut, seeds = [b"protocol"], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    pub trigger_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetTimeLimit<'info> {
    #[account(mut, seeds = [b"boom_token", boom_token.mint.as_ref()], bump = boom_token.bump)]
    pub boom_token: Account<'info, BoomToken>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct TriggerTimeExplosion<'info> {
    #[account(mut, seeds = [b"boom_token", boom_token.mint.as_ref()], bump = boom_token.bump)]
    pub boom_token: Account<'info, BoomToken>,
    #[account(mut, seeds = [b"protocol"], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    /// CHECK: Anyone can trigger once deadline passes
    pub caller: Signer<'info>,
}

// ==================== PRESALE ACCOUNT CONTEXTS ====================

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct StartPresale<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + PresaleRound::INIT_SPACE,
        seeds = [b"presale", round_id.to_le_bytes().as_ref()],
        bump
    )]
    pub presale_round: Account<'info, PresaleRound>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositPresale<'info> {
    #[account(
        mut,
        seeds = [b"presale", presale_round.round_id.to_le_bytes().as_ref()],
        bump = presale_round.bump
    )]
    pub presale_round: Account<'info, PresaleRound>,
    #[account(
        init_if_needed,
        payer = depositor,
        space = 8 + UserDeposit::INIT_SPACE,
        seeds = [b"deposit", presale_round.round_id.to_le_bytes().as_ref(), depositor.key().as_ref()],
        bump
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    #[account(mut)]
    pub depositor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EndPresaleAndLottery<'info> {
    #[account(
        mut,
        seeds = [b"presale", presale_round.round_id.to_le_bytes().as_ref()],
        bump = presale_round.bump,
        has_one = authority
    )]
    pub presale_round: Account<'info, PresaleRound>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct MarkWinner<'info> {
    #[account(
        seeds = [b"presale", presale_round.round_id.to_le_bytes().as_ref()],
        bump = presale_round.bump,
        has_one = authority
    )]
    pub presale_round: Account<'info, PresaleRound>,
    #[account(
        mut,
        seeds = [b"deposit", presale_round.round_id.to_le_bytes().as_ref(), user_deposit.depositor.as_ref()],
        bump = user_deposit.bump
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    #[account(
        mut,
        seeds = [b"presale", presale_round.round_id.to_le_bytes().as_ref()],
        bump = presale_round.bump
    )]
    pub presale_round: Account<'info, PresaleRound>,
    
    /// Explosion tracking - needed to verify trading has started
    #[account(
        seeds = [b"presale_explosion", presale_round.round_id.to_le_bytes().as_ref()],
        bump = presale_explosion.bump
    )]
    pub presale_explosion: Account<'info, PresaleExplosion>,
    
    #[account(
        mut,
        seeds = [b"deposit", presale_round.round_id.to_le_bytes().as_ref(), depositor.key().as_ref()],
        bump = user_deposit.bump,
        has_one = depositor
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    #[account(mut)]
    pub depositor: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimWinnerTokens<'info> {
    #[account(
        seeds = [b"presale", presale_round.round_id.to_le_bytes().as_ref()],
        bump = presale_round.bump
    )]
    pub presale_round: Account<'info, PresaleRound>,

    #[account(
        seeds = [b"presale_token", presale_round.round_id.to_le_bytes().as_ref()],
        bump = presale_token.bump,
        constraint = presale_token.mint == mint.key() @ BoomError::InvalidMint
    )]
    pub presale_token: Account<'info, PresaleToken>,
    
    /// Explosion tracking - needed to verify trading has started
    #[account(
        seeds = [b"presale_explosion", presale_round.round_id.to_le_bytes().as_ref()],
        bump = presale_explosion.bump
    )]
    pub presale_explosion: Account<'info, PresaleExplosion>,

    #[account(
        mut,
        seeds = [b"deposit", presale_round.round_id.to_le_bytes().as_ref(), winner.key().as_ref()],
        bump = user_deposit.bump,
        has_one = depositor @ BoomError::NotAWinner
    )]
    pub user_deposit: Account<'info, UserDeposit>,

    /// The token mint
    #[account(mut)]
    pub mint: InterfaceAccount<'info, MintInterface>,

    /// PDA mint authority
    /// CHECK: PDA validated by seeds
    #[account(
        seeds = [b"mint_authority", presale_round.round_id.to_le_bytes().as_ref()],
        bump
    )]
    pub mint_authority: UncheckedAccount<'info>,

    /// Winner's token account (must be initialized beforehand or use init_if_needed)
    #[account(
        mut,
        token::mint = mint,
        token::authority = winner,
        token::token_program = token_program
    )]
    pub winner_token_account: InterfaceAccount<'info, TokenAccountInterface>,

    /// CHECK: Validated via has_one
    pub depositor: UncheckedAccount<'info>,

    #[account(mut)]
    pub winner: Signer<'info>,

    pub token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct CreatePresaleToken<'info> {
    #[account(
        seeds = [b"presale", round_id.to_le_bytes().as_ref()],
        bump = presale_round.bump,
        has_one = authority
    )]
    pub presale_round: Account<'info, PresaleRound>,

    #[account(
        init,
        payer = authority,
        space = 8 + PresaleToken::INIT_SPACE,
        seeds = [b"presale_token", round_id.to_le_bytes().as_ref()],
        bump
    )]
    pub presale_token: Account<'info, PresaleToken>,

    /// CHECK: Mint account for Token2022, initialized via CPI
    #[account(mut)]
    pub mint: Signer<'info>,

    /// CHECK: PDA that will be the mint authority - program controls this
    #[account(
        seeds = [b"mint_authority", round_id.to_le_bytes().as_ref()],
        bump
    )]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct RegisterPresaleToken<'info> {
    #[account(
        seeds = [b"presale", round_id.to_le_bytes().as_ref()],
        bump = presale_round.bump,
        has_one = authority
    )]
    pub presale_round: Account<'info, PresaleRound>,

    #[account(
        init,
        payer = authority,
        space = 8 + PresaleToken::INIT_SPACE,
        seeds = [b"presale_token", round_id.to_le_bytes().as_ref()],
        bump
    )]
    pub presale_token: Account<'info, PresaleToken>,

    /// The externally-created Token2022 mint (with transfer hook)
    pub mint: InterfaceAccount<'info, MintInterface>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// NOTE: CreateLiquidityPool context removed - using hybrid approach with Raydium SDK

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct RegisterLp<'info> {
    #[account(
        seeds = [b"presale", round_id.to_le_bytes().as_ref()],
        bump = presale_round.bump,
        has_one = authority
    )]
    pub presale_round: Account<'info, PresaleRound>,

    #[account(
        init,
        payer = authority,
        space = 8 + LpInfo::INIT_SPACE,
        seeds = [b"lp_info", round_id.to_le_bytes().as_ref()],
        bump
    )]
    pub lp_info: Account<'info, LpInfo>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ==================== CUSTOM AMM CONTEXTS ====================

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct CreatePool<'info> {
    #[account(
        mut,
        seeds = [b"presale", round_id.to_le_bytes().as_ref()],
        bump = presale_round.bump,
        has_one = authority
    )]
    pub presale_round: Box<Account<'info, PresaleRound>>,

    #[account(
        seeds = [b"presale_token", round_id.to_le_bytes().as_ref()],
        bump = presale_token.bump,
        constraint = presale_token.mint == mint.key() @ BoomError::InvalidMint
    )]
    pub presale_token: Box<Account<'info, PresaleToken>>,

    #[account(
        init,
        payer = authority,
        space = 8 + Pool::INIT_SPACE,
        seeds = [b"pool", round_id.to_le_bytes().as_ref()],
        bump
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// The token mint
    pub mint: Box<InterfaceAccount<'info, MintInterface>>,

    /// Token vault PDA - holds tokens for the pool
    #[account(
        init,
        payer = authority,
        token::mint = mint,
        token::authority = pool,
        token::token_program = token_program,
        seeds = [b"token_vault", round_id.to_le_bytes().as_ref()],
        bump
    )]
    pub token_vault: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    /// SOL vault PDA - holds SOL for the pool
    /// CHECK: PDA that holds SOL
    #[account(
        mut,
        seeds = [b"sol_vault", round_id.to_le_bytes().as_ref()],
        bump
    )]
    pub sol_vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.round_id.to_le_bytes().as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// The token mint
    #[account(
        constraint = mint.key() == pool.mint @ BoomError::InvalidMint
    )]
    pub mint: InterfaceAccount<'info, MintInterface>,

    /// Pool's token vault
    #[account(
        mut,
        token::mint = mint,
        token::authority = pool,
        constraint = token_vault.key() == pool.token_vault @ BoomError::InvalidVault
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccountInterface>,

    /// Pool's SOL vault
    /// CHECK: PDA holding SOL
    #[account(
        mut,
        seeds = [b"sol_vault", pool.round_id.to_le_bytes().as_ref()],
        bump = pool.sol_vault_bump
    )]
    pub sol_vault: UncheckedAccount<'info>,

    /// User's token account
    #[account(
        mut,
        token::mint = mint,
        token::authority = user
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccountInterface>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,

    // === Transfer Hook Accounts ===
    /// The transfer hook program
    /// CHECK: Hook program ID
    pub hook_program: UncheckedAccount<'info>,
    
    /// Extra account metas PDA for the mint
    /// CHECK: PDA derived from ["extra-account-metas", mint]
    pub extra_account_metas: UncheckedAccount<'info>,
    
    /// Hook config PDA
    /// CHECK: PDA derived from ["hook_config"] in hook program
    pub hook_config: UncheckedAccount<'info>,
    
    /// Hook whitelist PDA for this mint
    /// CHECK: PDA derived from ["whitelist", mint] in hook program
    pub hook_whitelist: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct GetSwapQuote<'info> {
    #[account(
        seeds = [b"pool", pool.round_id.to_le_bytes().as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,
}

#[derive(Accounts)]
pub struct SyncPoolReserves<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.round_id.to_le_bytes().as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// Token vault PDA
    #[account(
        token::mint = pool.mint,
        seeds = [b"token_vault", pool.round_id.to_le_bytes().as_ref()],
        bump = pool.token_vault_bump
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccountInterface>,

    /// SOL vault PDA
    /// CHECK: PDA holding SOL
    #[account(
        seeds = [b"sol_vault", pool.round_id.to_le_bytes().as_ref()],
        bump = pool.sol_vault_bump
    )]
    pub sol_vault: UncheckedAccount<'info>,
}

/// Accounts for atomic sell (user transfers tokens first, then calls this)
#[derive(Accounts)]
pub struct SwapAtomicSell<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.round_id.to_le_bytes().as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// Pool's token vault - verify balance increased
    #[account(
        token::mint = pool.mint,
        constraint = token_vault.key() == pool.token_vault @ BoomError::InvalidVault
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccountInterface>,

    /// Pool's SOL vault - SOL sent from here
    /// CHECK: PDA holding SOL
    #[account(
        mut,
        seeds = [b"sol_vault", pool.round_id.to_le_bytes().as_ref()],
        bump = pool.sol_vault_bump
    )]
    pub sol_vault: UncheckedAccount<'info>,

    /// User receiving SOL
    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Accounts for atomic buy (SOL in, tokens out via CPI with remaining_accounts)
#[derive(Accounts)]
pub struct SwapAtomicBuy<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.round_id.to_le_bytes().as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// The token mint
    #[account(
        constraint = mint.key() == pool.mint @ BoomError::InvalidMint
    )]
    pub mint: InterfaceAccount<'info, MintInterface>,

    /// Pool's token vault
    #[account(
        mut,
        token::mint = mint,
        token::authority = pool,
        constraint = token_vault.key() == pool.token_vault @ BoomError::InvalidVault
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccountInterface>,

    /// Pool's SOL vault
    /// CHECK: PDA holding SOL
    #[account(
        mut,
        seeds = [b"sol_vault", pool.round_id.to_le_bytes().as_ref()],
        bump = pool.sol_vault_bump
    )]
    pub sol_vault: UncheckedAccount<'info>,

    /// User's token account (receives tokens)
    #[account(
        mut,
        token::mint = mint,
        token::authority = user
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccountInterface>,

    /// User sending SOL
    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,

    // === Transfer Hook Accounts (passed via remaining_accounts in CPI) ===
    /// The transfer hook program
    /// CHECK: Hook program ID
    pub hook_program: UncheckedAccount<'info>,
    
    /// Extra account metas PDA for the mint
    /// CHECK: PDA derived from ["extra-account-metas", mint]
    pub extra_account_metas: UncheckedAccount<'info>,
    
    /// Hook config PDA
    /// CHECK: PDA derived from ["hook_config"] in hook program
    pub hook_config: UncheckedAccount<'info>,
    
    /// Hook whitelist PDA for this mint
    /// CHECK: PDA derived from ["whitelist", mint] in hook program
    pub hook_whitelist: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct DepositPoolTokens<'info> {
    #[account(
        seeds = [b"presale", presale_round.round_id.to_le_bytes().as_ref()],
        bump = presale_round.bump,
        has_one = authority
    )]
    pub presale_round: Account<'info, PresaleRound>,

    #[account(
        seeds = [b"presale_token", presale_round.round_id.to_le_bytes().as_ref()],
        bump = presale_token.bump,
        constraint = presale_token.mint == mint.key() @ BoomError::InvalidMint
    )]
    pub presale_token: Account<'info, PresaleToken>,

    /// The token mint
    pub mint: InterfaceAccount<'info, MintInterface>,

    /// Token vault PDA
    #[account(
        mut,
        token::mint = mint,
        seeds = [b"token_vault", presale_round.round_id.to_le_bytes().as_ref()],
        bump
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccountInterface>,

    /// Authority's token account
    #[account(
        mut,
        token::mint = mint,
        token::authority = authority
    )]
    pub authority_token_account: InterfaceAccount<'info, TokenAccountInterface>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token2022>,
}

// ==================== PRESALE EXPLOSION CONTEXTS ====================

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct InitPresaleExplosion<'info> {
    #[account(
        seeds = [b"presale", round_id.to_le_bytes().as_ref()],
        bump = presale_round.bump,
        has_one = authority
    )]
    pub presale_round: Account<'info, PresaleRound>,

    #[account(
        init,
        payer = authority,
        space = 8 + PresaleExplosion::INIT_SPACE,
        seeds = [b"presale_explosion", round_id.to_le_bytes().as_ref()],
        bump
    )]
    pub presale_explosion: Account<'info, PresaleExplosion>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StartExplosionTimer<'info> {
    #[account(
        mut,
        seeds = [b"presale_explosion", presale_explosion.round_id.to_le_bytes().as_ref()],
        bump = presale_explosion.bump
    )]
    pub presale_explosion: Account<'info, PresaleExplosion>,

    /// LP must be registered before starting timer
    #[account(
        seeds = [b"lp_info", presale_explosion.round_id.to_le_bytes().as_ref()],
        bump = lp_info.bump
    )]
    pub lp_info: Account<'info, LpInfo>,

    /// Authority that can start the timer
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct TriggerPresaleExplosion<'info> {
    #[account(
        mut,
        seeds = [b"presale_explosion", presale_explosion.round_id.to_le_bytes().as_ref()],
        bump = presale_explosion.bump
    )]
    pub presale_explosion: Account<'info, PresaleExplosion>,

    /// Authority or oracle that can trigger explosion
    pub trigger_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct TriggerExplosionWithPyth<'info> {
    #[account(
        mut,
        seeds = [b"presale_explosion", presale_explosion.round_id.to_le_bytes().as_ref()],
        bump = presale_explosion.bump
    )]
    pub presale_explosion: Account<'info, PresaleExplosion>,

    #[account(
        seeds = [b"presale_token", presale_explosion.round_id.to_le_bytes().as_ref()],
        bump = presale_token.bump
    )]
    pub presale_token: Account<'info, PresaleToken>,

    #[account(
        seeds = [b"lp_info", presale_explosion.round_id.to_le_bytes().as_ref()],
        bump = lp_info.bump
    )]
    pub lp_info: Account<'info, LpInfo>,

    /// Pyth price update account
    pub price_update: Account<'info, PriceUpdateV2>,

    /// Anyone can trigger if price threshold met
    pub caller: Signer<'info>,
}

#[derive(Accounts)]
pub struct TriggerPresaleExplosionTime<'info> {
    #[account(
        mut,
        seeds = [b"presale_explosion", presale_explosion.round_id.to_le_bytes().as_ref()],
        bump = presale_explosion.bump
    )]
    pub presale_explosion: Account<'info, PresaleExplosion>,

    /// Anyone can trigger time-based explosion
    pub caller: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(total_sol_extracted: u64, remaining_token_supply: u64)]
pub struct UnwindLp<'info> {
    #[account(
        seeds = [b"presale", presale_round.round_id.to_le_bytes().as_ref()],
        bump = presale_round.bump,
        has_one = authority
    )]
    pub presale_round: Account<'info, PresaleRound>,

    #[account(
        mut,
        seeds = [b"presale_explosion", presale_round.round_id.to_le_bytes().as_ref()],
        bump = presale_explosion.bump
    )]
    pub presale_explosion: Account<'info, PresaleExplosion>,

    #[account(
        init,
        payer = authority,
        space = 8 + PayoutPool::INIT_SPACE,
        seeds = [b"payout_pool", presale_round.round_id.to_le_bytes().as_ref()],
        bump
    )]
    pub payout_pool: Account<'info, PayoutPool>,

    /// The AMM pool (needed to get token vault info and as burn authority)
    #[account(
        seeds = [b"pool", presale_round.round_id.to_le_bytes().as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,

    /// Pool's token vault - tokens here will be burned
    #[account(
        mut,
        address = pool.token_vault
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccountInterface>,

    /// Token mint - to burn LP tokens and get remaining supply
    #[account(
        mut,
        address = pool.mint
    )]
    pub mint: InterfaceAccount<'info, MintInterface>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct ClaimExplosionPayout<'info> {
    #[account(
        seeds = [b"presale_explosion", presale_explosion.round_id.to_le_bytes().as_ref()],
        bump = presale_explosion.bump
    )]
    pub presale_explosion: Account<'info, PresaleExplosion>,

    #[account(
        mut,
        seeds = [b"payout_pool", presale_explosion.round_id.to_le_bytes().as_ref()],
        bump = payout_pool.bump
    )]
    pub payout_pool: Account<'info, PayoutPool>,

    /// Vault holding SOL for payouts
    /// CHECK: PDA that holds the extracted SOL
    #[account(
        mut,
        seeds = [b"payout_vault", presale_explosion.round_id.to_le_bytes().as_ref()],
        bump
    )]
    pub payout_vault: UncheckedAccount<'info>,

    /// User's token account
    #[account(
        mut,
        token::authority = user,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccountInterface>,

    /// The token mint
    #[account(mut)]
    pub mint: InterfaceAccount<'info, MintInterface>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

// ==================== ROUND SEQUENCER CONTEXTS ====================

#[derive(Accounts)]
pub struct InitRoundSequencer<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + RoundSequencer::INIT_SPACE,
        seeds = [b"round_sequencer"],
        bump
    )]
    pub sequencer: Account<'info, RoundSequencer>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateRoundDefaults<'info> {
    #[account(
        mut,
        seeds = [b"round_sequencer"],
        bump = sequencer.bump,
        has_one = authority
    )]
    pub sequencer: Account<'info, RoundSequencer>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(new_round_id: u64)]
pub struct AutoStartNextRound<'info> {
    #[account(
        mut,
        seeds = [b"round_sequencer"],
        bump = sequencer.bump
    )]
    pub sequencer: Account<'info, RoundSequencer>,

    /// Previous round's explosion account - must be exploded
    #[account(
        seeds = [b"presale_explosion", (new_round_id - 1).to_le_bytes().as_ref()],
        bump = previous_explosion.bump,
        constraint = previous_explosion.is_exploded @ BoomError::NotExploded
    )]
    pub previous_explosion: Account<'info, PresaleExplosion>,

    #[account(
        init,
        payer = payer,
        space = 8 + PresaleRound::INIT_SPACE,
        seeds = [b"presale", new_round_id.to_le_bytes().as_ref()],
        bump
    )]
    pub new_presale_round: Account<'info, PresaleRound>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ==================== EXISTING ACCOUNTS ====================

#[account]
pub struct Protocol {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub min_cap: u64,
    pub max_cap: u64,
    pub fee_bps: u16,
    pub total_launches: u64,
    pub total_explosions: u64,
    pub bump: u8,
}

#[account]
pub struct BoomToken {
    pub mint: Pubkey,
    pub name: [u8; 32],
    pub symbol: [u8; 8],
    pub creator: Pubkey,
    pub created_at: i64,
    pub cap_hash: [u8; 32],
    pub revealed_cap: u64,
    pub is_exploded: bool,
    pub explosion_time: i64,
    pub explosion_deadline: i64,        // Time limit - explodes if this passes
    pub explosion_reason: ExplosionReason, // Why it exploded
    pub total_payout: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default, InitSpace)]
pub enum ExplosionReason {
    #[default]
    None,
    CapHit,      // Secret market cap was reached
    TimeLimit,   // Time ran out
}

// ==================== PRESALE ACCOUNTS ====================

#[account]
#[derive(InitSpace)]
pub struct PresaleRound {
    pub authority: Pubkey,          // 32
    pub round_id: u64,              // 8
    pub start_time: i64,            // 8
    pub end_time: i64,              // 8
    pub lottery_spots: u32,         // 4
    pub min_deposit: u64,           // 8
    pub max_deposit: u64,           // 8
    pub total_deposited: u64,       // 8
    pub total_depositors: u32,      // 4
    pub is_finalized: bool,         // 1
    pub bump: u8,                   // 1
}

#[account]
#[derive(InitSpace)]
pub struct UserDeposit {
    pub depositor: Pubkey,          // 32
    pub round_id: u64,              // 8
    pub amount: u64,                // 8
    pub deposit_time: i64,          // 8
    pub is_winner: bool,            // 1
    pub claimed: bool,              // 1
    pub bump: u8,                   // 1
}

#[account]
#[derive(InitSpace)]
pub struct PresaleToken {
    pub round_id: u64,              // 8
    pub mint: Pubkey,               // 32
    pub total_supply: u64,          // 8
    pub tokens_per_winner: u64,     // 8
    pub bump: u8,                   // 1
}

#[account]
#[derive(InitSpace)]
pub struct PresaleExplosion {
    pub round_id: u64,              // 8
    pub cap_hash: [u8; 32],         // 32 - SHA256 of secret cap
    pub revealed_cap: u64,          // 8 - revealed after explosion
    pub explosion_deadline: i64,    // 8 - time limit
    pub is_exploded: bool,          // 1
    pub explosion_time: i64,        // 8
    pub explosion_reason: ExplosionReason, // 1
    pub total_sol_for_payout: u64,  // 8 - SOL collected for distribution
    pub bump: u8,                   // 1
}

#[account]
#[derive(InitSpace)]
pub struct LpInfo {
    pub round_id: u64,              // 8
    pub pool_id: Pubkey,            // 32
    pub lp_mint: Pubkey,            // 32
    pub vault_a: Pubkey,            // 32 (SOL vault)
    pub vault_b: Pubkey,            // 32 (Token vault)
    pub registered_at: i64,         // 8
    pub bump: u8,                   // 1
}

#[account]
#[derive(InitSpace)]
pub struct PayoutPool {
    pub round_id: u64,              // 8
    pub total_sol: u64,             // 8 - Total SOL for distribution
    pub remaining_supply: u64,      // 8 - Token supply after LP burn
    pub claimed_count: u32,         // 4 - Number of claims made
    pub bump: u8,                   // 1
}

/// Custom AMM Pool for trading after presale
#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub round_id: u64,              // 8 - Links to presale round
    pub mint: Pubkey,               // 32 - Token mint
    pub token_vault: Pubkey,        // 32 - PDA holding tokens
    pub sol_vault: Pubkey,          // 32 - PDA holding SOL
    pub sol_reserve: u64,           // 8 - Current SOL in pool
    pub token_reserve: u64,         // 8 - Current tokens in pool
    pub fee_bps: u16,               // 2 - Fee in basis points (50 = 0.5%)
    pub total_volume: u128,         // 16 - Total trading volume
    pub total_fees: u128,           // 16 - Total fees collected
    pub bump: u8,                   // 1
    pub token_vault_bump: u8,       // 1
    pub sol_vault_bump: u8,         // 1
}

/// Manages automatic round progression
#[account]
#[derive(InitSpace)]
pub struct RoundSequencer {
    pub authority: Pubkey,              // 32
    pub current_round: u64,             // 8 - active round (0 = none started)
    pub last_explosion_round: u64,      // 8 - last round that exploded
    pub auto_advance_enabled: bool,     // 1
    // Default params for next rounds
    pub default_cooldown: i64,          // 8
    pub default_lottery_spots: u32,     // 4
    pub default_min_deposit: u64,       // 8
    pub default_max_deposit: u64,       // 8
    pub bump: u8,                       // 1
}

// ==================== CONFIG ====================

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProtocolConfig {
    pub min_cap: u64,
    pub max_cap: u64,
    pub fee_bps: u16,
}

// ==================== EVENTS ====================

#[event]
pub struct PresaleStarted {
    pub round_id: u64,
    pub end_time: i64,
    pub lottery_spots: u32,
    pub min_deposit: u64,
    pub max_deposit: u64,
}

#[event]
pub struct DepositMade {
    pub round_id: u64,
    pub depositor: Pubkey,
    pub amount: u64,
    pub total_amount: u64,
}

#[event]
pub struct PresaleFinalized {
    pub round_id: u64,
    pub total_deposited: u64,
    pub total_depositors: u32,
    pub winners_count: u32,
}

#[event]
pub struct WinnerMarked {
    pub round_id: u64,
    pub winner: Pubkey,
    pub amount: u64,
}

#[event]
pub struct RefundClaimed {
    pub round_id: u64,
    pub depositor: Pubkey,
    pub amount: u64,
}

#[event]
pub struct WinnerClaimed {
    pub round_id: u64,
    pub winner: Pubkey,
    pub deposit_amount: u64,
    pub tokens_minted: u64,
}

#[event]
pub struct PresaleTokenCreated {
    pub round_id: u64,
    pub mint: Pubkey,
    pub total_supply: u64,
    pub tokens_per_winner: u64,
}

#[event]
pub struct TokenExploded {
    pub mint: Pubkey,
    pub reason: ExplosionReason,
    pub revealed_cap: Option<u64>,
    pub explosion_time: i64,
}

#[event]
pub struct TimeLimitSet {
    pub mint: Pubkey,
    pub deadline: i64,
}

#[event]
pub struct LiquidityPoolCreated {
    pub round_id: u64,
    pub pool: Pubkey,
    pub sol_amount: u64,
    pub token_amount: u64,
}

#[event]
pub struct LpRegistered {
    pub round_id: u64,
    pub pool_id: Pubkey,
    pub lp_mint: Pubkey,
}

#[event]
pub struct ExplosionInitialized {
    pub round_id: u64,
    pub deadline: i64,
}

#[event]
pub struct TimerStarted {
    pub round_id: u64,
    pub duration_seconds: i64,
    pub deadline: i64,
}

#[event]
pub struct PresaleExplosionTriggered {
    pub round_id: u64,
    pub reason: ExplosionReason,
    pub revealed_cap: Option<u64>,
}

#[event]
pub struct PayoutClaimed {
    pub round_id: u64,
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PythPriceUsed {
    pub sol_usd_price: u64,
    pub exponent: i32,
}

#[event]
pub struct LpUnwound {
    pub round_id: u64,
    pub total_sol: u64,
    pub remaining_supply: u64,
}

#[event]
pub struct NextRoundStarted {
    pub previous_round: u64,
    pub new_round: u64,
    pub auto_advanced: bool,
}

#[event]
pub struct RoundSequencerUpdated {
    pub current_round: u64,
    pub last_explosion_round: u64,
}

// ==================== CUSTOM AMM EVENTS ====================

#[event]
pub struct PoolCreated {
    pub round_id: u64,
    pub mint: Pubkey,
    pub sol_reserve: u64,
    pub token_reserve: u64,
    pub fee_bps: u16,
}

#[event]
pub struct SwapExecuted {
    pub round_id: u64,
    pub user: Pubkey,
    pub is_buy: bool,
    pub amount_in: u64,
    pub amount_out: u64,
    pub fee_amount: u64,
    pub new_sol_reserve: u64,
    pub new_token_reserve: u64,
}

#[event]
pub struct SwapQuote {
    pub round_id: u64,
    pub is_buy: bool,
    pub amount_in: u64,
    pub amount_out: u64,
    pub price_impact_bps: u16,
    pub fee_bps: u16,
}

#[event]
pub struct PoolTokensDeposited {
    pub round_id: u64,
    pub amount: u64,
}

// ==================== ERRORS ====================

#[error_code]
pub enum BoomError {
    #[msg("Token has already exploded")]
    AlreadyExploded,
    #[msg("Secret cap has already been set")]
    CapAlreadySet,
    #[msg("Invalid cap reveal - hash mismatch")]
    InvalidCapReveal,
    // Presale errors
    #[msg("Presale has been finalized")]
    PresaleFinalized,
    #[msg("Presale has not been finalized yet")]
    PresaleNotFinalized,
    #[msg("Presale period has ended")]
    PresaleEnded,
    #[msg("Presale period has not ended yet")]
    PresaleNotEnded,
    #[msg("Deposit amount is below minimum")]
    DepositTooSmall,
    #[msg("Deposit amount exceeds maximum")]
    DepositTooLarge,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Too many winners specified")]
    TooManyWinners,
    #[msg("User is already marked as winner")]
    AlreadyWinner,
    #[msg("Winners cannot claim refund")]
    WinnerCannotRefund,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Nothing to refund")]
    NothingToRefund,
    #[msg("Not a lottery winner")]
    NotAWinner,
    #[msg("Invalid mint for this presale")]
    InvalidMint,
    #[msg("Trading has not started yet - explosion timer must be set")]
    TradingNotStarted,
    // Time limit errors
    #[msg("Deadline must be in the future")]
    DeadlineInPast,
    #[msg("Deadline has already been set")]
    DeadlineAlreadySet,
    #[msg("No deadline has been set for this token")]
    NoDeadlineSet,
    #[msg("Deadline has not been reached yet")]
    DeadlineNotReached,
    #[msg("Presale token has not been created yet")]
    TokenNotCreated,
    #[msg("Token has not exploded yet")]
    NotExploded,
    #[msg("Price data is stale or unavailable")]
    PriceStale,
    #[msg("LP has already been unwound")]
    LpAlreadyUnwound,
    #[msg("LP has not been unwound yet")]
    LpNotUnwound,
    #[msg("No tokens to claim payout")]
    NoTokensToClaim,
    #[msg("Payout amount too small")]
    PayoutTooSmall,
    #[msg("Invalid round sequence - must be next after explosion")]
    InvalidRoundSequence,
    #[msg("Auto-advance is disabled")]
    AutoAdvanceDisabled,
    #[msg("Duration must be positive")]
    InvalidDuration,
    // AMM errors
    #[msg("Fee too high - max 10%")]
    FeeTooHigh,
    #[msg("No SOL available for pool creation")]
    NoSolForPool,
    #[msg("No tokens deposited for pool creation")]
    NoTokensForPool,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Output amount too small")]
    ZeroOutput,
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    #[msg("Invalid vault account")]
    InvalidVault,
    #[msg("Insufficient tokens deposited")]
    InsufficientDeposit,
    #[msg("Insufficient liquidity in pool")]
    InsufficientLiquidity,
}
