// src/lib/common/game.ts

import type { ErgoPlatform } from "$lib/ergo/platform";
import type { Amount, Box, TokenEIP4 } from "@fleet-sdk/core";

/**
 * Defines the possible states a game can be in, according to the new contract logic.
 */
export const GameState = {
    Unknown: 'Unknown',
    Active: 'Active',                   // State 1A: Normal operation before deadline
    Resolution: 'Resolution',           // State 1B: After deadline, waiting for winner resolution
    Finalized: 'Finalized',             // State 1C: Game ended, winner resolved (game-box spent)
    Cancelled_Draining: 'Cancelled_Draining', // State 2A: Cancelled before deadline, stake can be drained
    Cancelled_Finalized: 'Cancelled_Finalized' // State 2B: Cancelled after deadline, stake is locked
} as const;

/**
 * A type representing the possible string values for a game's status.
 */
export type GameStatus = typeof GameState[keyof typeof GameState];

export interface WinnerInfo {
    playerAddress: string;
    playerPK_Hex?: string;
    score: bigint | number;
    participationBoxId?: string;
}

/**
 * Describes the detailed content of a GoP game, typically parsed from R9.
 */
export interface GameContent {
    rawJsonString: string;
    title: string;
    description: string;
    serviceId: string;
    imageURL?: string;
    webLink?: string;
    mirrorUrls?: string[];
}

export interface Participation {
    boxId: string;
    box: Box<Amount>;

    transactionId: string;
    creationHeight: number;
    value: bigint;

    playerPK_Hex: string;
    commitmentC_Hex: string;
    
    solverId_RawBytesHex: string;
    solverId_String?: string;
    hashLogs_Hex: string;
    scoreList: bigint[];
}

/**
 * Main data structure for a Game of Prompts game.
 * It's adapted to the new contract logic with a state machine.
 */
export interface Game {
    boxId: string;
    box: Box<Amount>;

    platform: ErgoPlatform;

    status: GameStatus; // Replaces the old 'ended' boolean with a more descriptive state
    unlockHeight?: number; // From R5._1, relevant for cancelled games
    hashS?: string; // From R5._2 when game is active (unlockHeight == 0)
    revealedS_Hex?: string; // From R5._2 when game is cancelled (unlockHeight > 0)
    
    // --- Parsed Fields from GameBox Registers ---
    gameCreatorPK_Hex: string; // From R4
    deadlineBlock: number;          // From R7
    creatorStakeNanoErg: bigint;    // From R7 (this value can now decrease)
    participationFeeNanoErg: bigint;// From R7
    commissionPercentage: number;   // From R8

    gameId: string; // The NFT ID from tokens(0)

    // --- Game Details & Data ---
    content: GameContent; // Parsed from R9
    value: bigint; // The box's ERG value, representing the current creator stake
    participations: Participation[];

    // --- Data populated after game ends ---
    secret?: Uint8Array;
    winnerInfo?: WinnerInfo;
}

/**
 * A helper function to check if a game is considered "ended" (i.e., no more actions can be taken).
 * @param game The Game object.
 * @returns boolean True if the game is in a final state.
 */
export function isGameEnded(game: Game): boolean {
    return game.status === GameState.Unknown || game.status === GameState.Cancelled_Finalized || game.status === GameState.Finalized;
}

export function isGameParticipationEnded(game: Game): boolean {
    return game.status !== GameState.Active;
}

/**
 * Parses the content details for a game.
 * NOTE: This is more of a utility/parsing function than a type definition.
 * It could be located in a 'utils' or 'helpers' file.
 * @param rawJsonDetails Optional JSON string with game details (from R9).
 * @param gameBoxId The box ID, used as a fallback identifier.
 * @param nft Optional EIP-4 token data from the Game NFT.
 * @returns Parsed GameContent.
 */
export function parseGameContent(
    rawJsonDetails: string | undefined | null,
    gameBoxId: string, 
    nft?: TokenEIP4 & { serviceId?: string } // Allow serviceId to be part of the enriched type
): GameContent {
    let title = nft?.name || `Game ${gameBoxId.slice(0, 8)}`;
    let description = nft?.description || "No description provided.";
    let serviceId = nft?.serviceId || ""; 
    let imageURL: string | undefined = undefined;
    let webLink: string | undefined = undefined;
    let mirrorUrls: string[] | undefined = undefined;

    if (rawJsonDetails) {
        try {
            const parsed = JSON.parse(rawJsonDetails);
            title = parsed.title || title;
            description = parsed.description || description;
            serviceId = parsed.serviceId || serviceId;
            imageURL = parsed.imageURL || parsed.image || undefined;
            webLink = parsed.webLink || parsed.link || undefined;
            mirrorUrls = parsed.mirrorUrls || undefined;
        } catch (error) {
            console.warn(`Error parsing rawJsonDetails for game ${gameBoxId}. Using fallbacks. Error: ${error}`);
        }
    }
    
    if (!serviceId && nft?.description) {
        const serviceIdMatch = nft.description.match(/Service ID:\s*([\w.-]+)/i);
        if (serviceIdMatch && serviceIdMatch[1]) {
           serviceId = serviceIdMatch[1];
        }
    }
    
    if (!serviceId) {
        console.warn(`serviceId not found for game ${gameBoxId}. Using placeholder.`);
        serviceId = `unknown_service_for_${gameBoxId.slice(0,6)}`;
    }

    return {
        rawJsonString: rawJsonDetails || undefined,
        title,
        description,
        serviceId,
        imageURL,
        webLink,
        mirrorUrls
    };
}