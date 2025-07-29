// src/ergo/platform.ts
import type { Game } from '../common/game';
import { fetchGoPGames } from './fetch';
import { create_game } from './actions/create_game';
import { explorer_uri, network_id } from './envs';
import { address, connected, network, balance } from "../common/store";
import { submit_score } from './actions/submit_score';
import { resolve_game } from './actions/resolve_game';
import { type Platform } from '$lib/common/platform';

interface CreateGoPGamePlatformParams {
    gameServiceId: string;
    hashedSecret: string; // Hex string of blake2b256(S)
    deadlineBlock: number;
    creatorStakeNanoErg: BigInt;
    participationFeeNanoErg: BigInt;
    commissionPercentage: number;
    gameDetailsJson: string; // JSON string with title, description, serviceId, etc.
}

export class ErgoPlatform implements Platform{

    id = "ergo";
    main_token = "ERG";
    icon = "";
    time_per_block = 2*60*1000;  // every 2 minutes
    last_version = "v1_0";

    async connect(): Promise<void> {
        if (typeof ergoConnector !== 'undefined') {
            const nautilus = ergoConnector.nautilus;
            if (nautilus) {
                if (await nautilus.connect()) {
                    console.log('Connected!');
                    address.set(await ergo.get_change_address());
                    network.set((network_id == "mainnet") ? "ergo-mainnet" : "ergo-testnet");
                    await this.get_balance();
                    connected.set(true);
                } else {
                    alert('Not connected!');
                }
            } else {
                alert('Nautilus Wallet is not active');
            }
            } /*else {
                alert('No wallet available');
            } */
    }

    async get_current_height(): Promise<number> {
        try {
            // If connected to the Ergo wallet, get the current height directly
            return await ergo.get_current_height();
        } catch {
            // Fallback to fetching the current height from the Ergo API
            try {
                const response = await fetch(explorer_uri+'/api/v1/networkState');
                if (!response.ok) {
                    throw new Error(`API request failed with status: ${response.status}`);
                }
    
                const data = await response.json();
                return data.height; // Extract and return the height
            } catch (error) {
                console.error("Failed to fetch network height from API:", error);
                throw new Error("Unable to get current height.");
            }
        }
    }

    async get_balance(id?: string): Promise<Map<string, number>> {
        const balanceMap = new Map<string, number>();
        const addr = await ergo.get_change_address();

        if (addr) {
            try {
                // Fetch balance for the specific address from the API
                const response = await fetch(explorer_uri+`/api/v1/addresses/${addr}/balance/confirmed`);
                if (!response.ok) {
                    throw new Error(`API request failed with status: ${response.status}`);
                }
    
                const data = await response.json();
    
                // Add nanoErgs balance to the map
                balanceMap.set("ERG", data.nanoErgs);
                balance.set(data.nanoErgs)
    
                // Add tokens balances to the map
                data.tokens.forEach((token: { tokenId: string; amount: number }) => {
                    balanceMap.set(token.tokenId, token.amount);
                });
            } catch (error) {
                console.error(`Failed to fetch balance for address ${addr} from API:`, error);
                throw new Error("Unable to fetch balance.");
            }
        } else {
            throw new Error("Address is required to fetch balance.");
        }
    
        return balanceMap;
    }

    /**
     * Initiates the creation of a new Game of Prompts game on the Ergo blockchain.
     * This method prepares the parameters and calls the underlying transaction function.
     *
     * @param params - An object containing all necessary parameters for game creation.
     * @returns A promise that resolves with the transaction ID string if successful, or null otherwise.
     */
    public async createGoPGame(params: CreateGoPGamePlatformParams): Promise<string | null> {
        if (!ergo) {
            throw new Error("Wallet not connected or Ergo connector not available.");
        }
        
        try {
            // Call the new underlying function 'create_game' responsible for
            // building and submitting the actual Ergo transaction.
            const transactionId = await create_game(
                // currentContractVersion, // Pass if create_game expects it
                params.gameServiceId,
                params.hashedSecret,
                params.deadlineBlock,
                params.creatorStakeNanoErg,
                params.participationFeeNanoErg,
                params.commissionPercentage,
                params.gameDetailsJson
            );
            return transactionId;
        } catch (error) {
            console.error("Error in createGoPGame platform method:", error);
            // Optionally, re-throw or handle specific error types if needed
            // For example, if 'create_game' throws custom errors.
            if (error instanceof Error) {
                throw new Error(`Failed to create GoP game: ${error.message}`);
            }
            throw new Error("An unknown error occurred while creating the GoP game.");
        }
    }

    async submitScoreToGopGame(
        game: Game, 
        scoreList: bigint[],
        commitmentC_hex: string, 
        solverId_string: string, 
        hashLogs_hex: string
    ): Promise<string | null> {
        if (!ergo) {
            throw new Error("Wallet not connected or Ergo connector not available.");
        }

        console.log("ErgoPlatform: Preparing to submit score.");
        return await submit_score(
            game.gameId, // gameNftId es string hexadecimal
            scoreList,
            game.participationFeeNanoErg,
            commitmentC_hex,
            solverId_string,
            hashLogs_hex
        );
    }

    async resolveGame(
        game: Game,
        secretS_hex: string
    ): Promise<string | null> {
        if (!ergo) {
            throw new Error("Wallet not connected or Ergo connector not available.");
        }
        
        console.log("ErgoPlatform: Calling resolve_game_transaction.");
        // Ahora simplemente delegamos, pasando el conector 'this.ergo'
        return await resolve_game(
            game,
            secretS_hex
        );
    }

    async fetchGoPGames(offset: number = 0): Promise<Map<string, Game>> {
        return await fetchGoPGames(offset, 'all');
    }
}
