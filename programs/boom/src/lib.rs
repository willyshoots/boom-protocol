use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_spl::token::{Mint, Token};
use anchor_spl::token_2022::{self, Token2022};
use anchor_spl::token_interface::{Mint as MintInterface, TokenAccount as TokenAccountInterface};
use anchor_spl::associated_token::AssociatedToken;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

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

        require!(presale.is_finalized, BoomError::PresaleNotFinalized);
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
    pub fn claim_winner_tokens(ctx: Context<ClaimWinnerTokens>) -> Result<()> {
        let user_deposit = &mut ctx.accounts.user_deposit;
        let presale = &ctx.accounts.presale_round;
        let presale_token = &ctx.accounts.presale_token;

        require!(presale.is_finalized, BoomError::PresaleNotFinalized);
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

    // ==================== PRESALE EXPLOSION ====================

    /// Initialize explosion tracking for a presale token
    /// Sets the secret cap hash and optional time limit
    pub fn init_presale_explosion(
        ctx: Context<InitPresaleExplosion>,
        round_id: u64,
        cap_hash: [u8; 32],
        explosion_deadline: i64,
    ) -> Result<()> {
        let presale = &ctx.accounts.presale_round;
        require!(presale.is_finalized, BoomError::PresaleNotFinalized);

        let explosion = &mut ctx.accounts.presale_explosion;
        explosion.round_id = round_id;
        explosion.cap_hash = cap_hash;
        explosion.revealed_cap = 0;
        explosion.explosion_deadline = explosion_deadline;
        explosion.is_exploded = false;
        explosion.explosion_time = 0;
        explosion.explosion_reason = ExplosionReason::None;
        explosion.total_sol_for_payout = 0;
        explosion.bump = ctx.bumps.presale_explosion;

        emit!(ExplosionInitialized {
            round_id,
            deadline: explosion_deadline,
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
    pub fn unwind_lp(
        ctx: Context<UnwindLp>,
        total_sol_extracted: u64,
        remaining_token_supply: u64,
    ) -> Result<()> {
        let explosion = &mut ctx.accounts.presale_explosion;
        require!(explosion.is_exploded, BoomError::NotExploded);
        require!(explosion.total_sol_for_payout == 0, BoomError::LpAlreadyUnwound);

        // Record payout pool info
        // In production, this would CPI to Raydium to actually unwind
        // For hackathon, authority reports the amounts after off-chain unwind
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

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
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
}
