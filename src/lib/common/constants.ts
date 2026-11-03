import { GAME, PARTICIPATION, PARTICIPATION_UNAVAILABLE } from "$lib/ergo/reputation/types";

export interface GameConstants {
    JUDGE_PERIOD: number;    // VARIOS BLOQUES PARA PERMITIR A TODOS LOS JUECES PROBAR EL CANDIDATO.
    RESOLVER_OMISSION_NO_PENALTY_PERIOD: number;  // VARIOS BLOQUES PARA NO PERMITIR QUE SE MODFIQUE EL RESOLVER. // Must be less than JUDGE_PERIOD, but the difference must be enough to allow others penalize resolver after this period.
    MAX_SCORE_LIST: number;
    STAKE_DENOMINATOR: number;
    COOLDOWN_IN_BLOCKS: number;
    END_GAME_AUTH_GRACE_PERIOD: number;   // A PARTIR DE RESOLUTION DEADLINE (R8.5)
    PARTICIPATION_GRACE_PERIOD: number;    // A PARTIR DE DEADLINE (R8.0) - TIEMPO QUE TIENE EL RESOLVER PARA REVELAR EL SECRETO
    PARTICIPATION_TIME_WINDOW: number;
    SEED_MARGIN: number;
    MIN_TIME_WEIGHT_MARGIN: number;   //  Bloques despues de created at hasta los que la formula de efficient score puede considerar el time weight.
    COMMISSION_DENOMINATOR: number;

    PARTICIPATION_TYPE_ID: string;
    PARTICIPATION_UNAVAILABLE_TYPE_ID: string;
    ACCEPT_GAME_INVITATION_TYPE_ID: string;
}

const DevelopmentMode: GameConstants = {
    JUDGE_PERIOD: 30,
    RESOLVER_OMISSION_NO_PENALTY_PERIOD: 5,
    MAX_SCORE_LIST: 10,
    STAKE_DENOMINATOR: 5,
    COOLDOWN_IN_BLOCKS: 30,
    END_GAME_AUTH_GRACE_PERIOD: 5,
    PARTICIPATION_GRACE_PERIOD: 90,
    PARTICIPATION_TIME_WINDOW: 5,
    SEED_MARGIN: 1,
    MIN_TIME_WEIGHT_MARGIN: 1,
    COMMISSION_DENOMINATOR: 1000000,

    PARTICIPATION_TYPE_ID: PARTICIPATION,
    PARTICIPATION_UNAVAILABLE_TYPE_ID: PARTICIPATION_UNAVAILABLE,
    ACCEPT_GAME_INVITATION_TYPE_ID: GAME,
};

const ProductionMode: GameConstants = {
    JUDGE_PERIOD: 720,  // aprox. one day
    RESOLVER_OMISSION_NO_PENALTY_PERIOD: 5,
    MAX_SCORE_LIST: 10,
    STAKE_DENOMINATOR: 5,
    COOLDOWN_IN_BLOCKS: 30,
    END_GAME_AUTH_GRACE_PERIOD: 64800,  // aprox. 90 days
    PARTICIPATION_GRACE_PERIOD: 6480,  // aprox. 9 days
    PARTICIPATION_TIME_WINDOW: 2160,  // aprox. three days.   In case future_participation.es exists ... could be 720 blocks aprox. 1 day
    SEED_MARGIN: 20,
    MIN_TIME_WEIGHT_MARGIN: 720,  // approx. 24 hours
    COMMISSION_DENOMINATOR: 1000000,

    PARTICIPATION_TYPE_ID: PARTICIPATION,
    PARTICIPATION_UNAVAILABLE_TYPE_ID: PARTICIPATION_UNAVAILABLE,
    ACCEPT_GAME_INVITATION_TYPE_ID: GAME,
}



import { get } from "svelte/store";
import { isDevMode } from "$lib/ergo/envs";

export const getGameConstants = (version: ContractVersion = CURRENT_CONTRACT_VERSION): GameConstants => {
    if (version === 'v1') return get(isDevMode) ? V1DevelopmentMode : V1ProductionMode;
    return get(isDevMode) ? DevelopmentMode : ProductionMode;
};

// Export for tests
export const DefaultGameConstants = ProductionMode;

// The game NFT is minted with 2 units that travel together in the game box. end_game gives one unit
// to the winner (or resolver) as the trophy and burns the other, so the trophy can never act as a game box.
export const GAME_NFT_AMOUNT = 2n;
export const GAME_TROPHY_AMOUNT = 1n;

// R4 value written by game_resolution's action4 into the end_game box.
export const ENDING_GAME_STATE = 3;

// =============================================================================
// === CONTRACT VERSIONS
// =============================================================================

// Every set of on-chain contracts the app can read. Games created with an older version stay visible
// (read-only); new games and every write action use CURRENT_CONTRACT_VERSION.
//   v1: contracts at tag `v1` (contracts/v1/*.es).
//   v2: current contracts (contracts/*.es).
export type ContractVersion = 'v1' | 'v2';
export const CURRENT_CONTRACT_VERSION: ContractVersion = 'v2';
export const CONTRACT_VERSIONS: readonly ContractVersion[] = ['v2', 'v1'];

export interface ContractRules {
    gameNftAmount: bigint;      // Units of the game NFT held by every game box.
    endingGameState: number;    // R4 of the end_game box.
}

const CONTRACT_RULES: Record<ContractVersion, ContractRules> = {
    v1: { gameNftAmount: 1n, endingGameState: 1 },
    v2: { gameNftAmount: GAME_NFT_AMOUNT, endingGameState: ENDING_GAME_STATE },
};

export const getContractRules = (version: ContractVersion): ContractRules => CONTRACT_RULES[version];

// Constants the v1 contracts were compiled with. Frozen: changing them would change the v1 ErgoTrees
// and v1 games would no longer be found on-chain.
const V1DevelopmentMode: GameConstants = {
    JUDGE_PERIOD: 30,
    RESOLVER_OMISSION_NO_PENALTY_PERIOD: 5,
    MAX_SCORE_LIST: 10,
    STAKE_DENOMINATOR: 5,
    COOLDOWN_IN_BLOCKS: 30,
    END_GAME_AUTH_GRACE_PERIOD: 5,
    PARTICIPATION_GRACE_PERIOD: 90,
    PARTICIPATION_TIME_WINDOW: 5,
    SEED_MARGIN: 1,
    MIN_TIME_WEIGHT_MARGIN: 1,
    COMMISSION_DENOMINATOR: 1000000,

    PARTICIPATION_TYPE_ID: PARTICIPATION,
    PARTICIPATION_UNAVAILABLE_TYPE_ID: PARTICIPATION_UNAVAILABLE,
    ACCEPT_GAME_INVITATION_TYPE_ID: GAME,
};

const V1ProductionMode: GameConstants = {
    JUDGE_PERIOD: 720,
    RESOLVER_OMISSION_NO_PENALTY_PERIOD: 5,
    MAX_SCORE_LIST: 10,
    STAKE_DENOMINATOR: 5,
    COOLDOWN_IN_BLOCKS: 30,
    END_GAME_AUTH_GRACE_PERIOD: 64800,
    PARTICIPATION_GRACE_PERIOD: 6480,
    PARTICIPATION_TIME_WINDOW: 2160,
    SEED_MARGIN: 20,
    MIN_TIME_WEIGHT_MARGIN: 720,
    COMMISSION_DENOMINATOR: 1000000,

    PARTICIPATION_TYPE_ID: PARTICIPATION,
    PARTICIPATION_UNAVAILABLE_TYPE_ID: PARTICIPATION_UNAVAILABLE,
    ACCEPT_GAME_INVITATION_TYPE_ID: GAME,
};