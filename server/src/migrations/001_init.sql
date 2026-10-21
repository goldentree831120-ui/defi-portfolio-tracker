-- Where the indexer has got to, per chain and contract. Advanced in the SAME transaction as
-- the events it covers, so a crash can never leave events stored without the cursor (or the
-- reverse).
CREATE TABLE indexer_cursor (
    chain_id        integer     NOT NULL,
    contract        text        NOT NULL,
    last_block      bigint      NOT NULL,
    last_block_hash text,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, contract)
);

-- Raw event log. (chain_id, tx_hash, log_index) identifies a log uniquely, so re-reading a
-- block range can never insert the same event twice.
CREATE TABLE staking_events (
    id            bigserial   PRIMARY KEY,
    chain_id      integer     NOT NULL,
    contract      text        NOT NULL,
    block_number  bigint      NOT NULL,
    block_hash    text        NOT NULL,
    block_time    timestamptz NOT NULL,
    tx_hash       text        NOT NULL,
    log_index     integer     NOT NULL,
    event         text        NOT NULL CHECK (event IN ('Staked', 'RewardsClaimed', 'Withdrawn')),
    user_address  text        NOT NULL,          -- lower-case hex
    position_id   numeric(78, 0) NOT NULL,
    amount        numeric(78, 0) NOT NULL,       -- token base units (wei); uint256 fits in 78 digits
    lock_duration bigint,                        -- Staked only, seconds
    penalty       numeric(78, 0),                -- Withdrawn only
    UNIQUE (chain_id, tx_hash, log_index)
);
CREATE INDEX staking_events_by_user
    ON staking_events (chain_id, contract, user_address, block_number DESC, log_index DESC);

-- Current state of every position, built from the events (a projection). Only ever changed
-- by an event that was newly inserted above, which is what makes re-indexing safe.
CREATE TABLE positions (
    chain_id         integer        NOT NULL,
    contract         text           NOT NULL,
    user_address     text           NOT NULL,
    position_id      numeric(78, 0) NOT NULL,
    amount           numeric(78, 0) NOT NULL,
    lock_duration    bigint         NOT NULL,
    reward_rate_bps  integer,                    -- from the contract's lock options; NULL if unknown
    start_time       timestamptz    NOT NULL,
    unlock_time      timestamptz    NOT NULL,
    rewards_claimed  numeric(78, 0) NOT NULL DEFAULT 0,
    withdrawn        boolean        NOT NULL DEFAULT false,
    withdrawn_amount numeric(78, 0),
    penalty          numeric(78, 0),
    opened_block     bigint         NOT NULL,
    closed_block     bigint,
    PRIMARY KEY (chain_id, contract, user_address, position_id)
);
