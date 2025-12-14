// src/ergo/platform.ts
import {
    type GameActive,
    type GameResolution,
    type GameCancellation,
    type ValidParticipation,
    type GameFinalized
} from '../common/game';
import { fetchActiveGames, fetchResolutionGames, fetchCancellationGames, fetchFinalizedGames } from './fetch';
import { create_game } from './actions/create_game';
import { CACHE_DURATION_MS, explorer_uri, network_id } from './envs';
import { address, connected, network, balance, games } from "../common/store";
import { submit_score } from './actions/submit_score';
import { resolve_game } from './actions/resolve_game';
import { type Platform } from '$lib/common/platform';
import { cancel_game } from './actions/cancel_game';
import { drain_cancelled_game_stake } from './actions/drain_cancelled_game_stake';
import { end_game } from './actions/end_game';
import { judges_invalidate } from './actions/judges_invalidate';
import { type Amount, type Box } from '@fleet-sdk/core';
import { include_omitted_participation } from './actions/include_omitted_participation';
import { claim_after_cancellation } from './actions/claim_after_cancellation';
import { reclaim_after_grace } from './actions/reclaim_after_grace';
import { update_reputation_proof } from './reputation/submit';
import { get } from 'svelte/store';
import { contribute_to_ceremony } from './actions/ceremony';

// Un tipo de unión para representar un juego en cualquier estado posible.
type AnyGame = GameActive | GameResolution | GameCancellation | GameFinalized;

interface CreateGoPGamePlatformParams {
    gameServiceId: string;
    hashedSecret: string; // Hex string of blake2b256(S)
    deadlineBlock: number;
    creatorStakeAmount: bigint|BigInt;
    participationFeeAmount: bigint|BigInt;
    commissionPercentage: number;
    judges: string[];
    gameDetailsJson: string; // JSON string with title, description, serviceId, etc.
    perJudgeComissionPercentage: number;
    participationTokenId?: string;
}

export class ErgoPlatform implements Platform {

    id = "ergo";
    main_token = "ERG";
    icon = "";
    time_per_block = 2 * 60 * 1000;  // every 2 minutes
    last_version = "v1_0";

    async connect(): Promise<void> {
        // Handled by wallet-svelte-component
    }

    async get_current_height(): Promise<number> {
        try {
            return await ergo.get_current_height();
        } catch {
            try {
                const response = await fetch(get(explorer_uri) + '/api/v1/networkState');
                if (!response.ok) throw new Error(`La solicitud a la API falló: ${response.status}`);
                const data = await response.json();
                return data.height;
            } catch (error) {
                console.error("No se pudo obtener la altura de la red desde la API:", error);
                throw new Error("No se puede obtener la altura actual.");
            }
        }
    }

    async get_balance(id?: string): Promise<Map<string, number>> {
        // Handled by wallet-svelte-component
        return new Map();
    }

    public async createGoPGame(params: CreateGoPGamePlatformParams): Promise<string | null> {
        if (!ergo) throw new Error("Wallet not connected");

        try {
            return await create_game(
                params.gameServiceId,
                params.hashedSecret,
                params.deadlineBlock,
                params.creatorStakeAmount,
                params.participationFeeAmount,
                params.commissionPercentage,
                params.judges,
                params.gameDetailsJson,
                params.perJudgeComissionPercentage,
                params.participationTokenId || ""
            );
        } catch (error) {
            console.error("Error en el método de plataforma createGoPGame:", error);
            if (error instanceof Error) throw new Error(`No se pudo crear el juego: ${error.message}`);
            throw new Error("Ocurrió un error desconocido al crear el juego.");
        }
    }

    async submitScoreToGopGame(
        game: GameActive, // Tipo específico: solo se puede enviar puntuación a un juego activo.
        scoreList: bigint[],
        commitmentC_hex: string,
        solverId_string: string,
        hashLogs_hex: string
    ): Promise<string | null> {
        if (!ergo) throw new Error("Wallet not connected");

        return await submit_score(
            game.gameId,
            scoreList,
            game.participationFeeAmount,
            game.participationTokenId,
            commitmentC_hex,
            solverId_string,
            hashLogs_hex
        );
    }

    async resolveGame(
        game: GameActive,
        participations: ValidParticipation[],
        secretS_hex: string,
        acceptedJudgeNominations: string[]
    ): Promise<string | null> {
        if (!ergo) throw new Error("Wallet not connected");

        return await resolve_game(game, participations, secretS_hex, acceptedJudgeNominations);
    }

    async cancel_game(
        game: GameActive, // Tipo específico: solo se puede cancelar un juego activo.
        secretS_hex: string,
        claimerAddressString: string
    ): Promise<string | null> {
        if (!ergo) throw new Error("Wallet not connected");

        return await cancel_game(game, secretS_hex, claimerAddressString);
    }

    async drain_cancelled_game_stake(
        game: GameCancellation, // Tipo específico: el juego debe estar en estado de cancelación.
        claimerAddressString: string
    ): Promise<string | null> {
        if (!ergo) throw new Error("Wallet not connected");

        return await drain_cancelled_game_stake(game, claimerAddressString);
    }

    /**
     * Finaliza un juego en estado de resolución, pagando al ganador y distribuyendo las comisiones.
     * Solo puede ser llamado por el 'resolver' actual después de que el período de jueces haya terminado.
     */
    async endGame(
        game: GameResolution,
        participations: ValidParticipation[]
    ): Promise<string | null> {
        if (!ergo) throw new Error("Wallet not connected");
        return await end_game(game, participations);
    }

    /**
     * Permite a un juez votar para invalidar al candidato a ganador actual.
     * Si suficientes jueces votan, se elige un nuevo candidato y se extiende el plazo.
     */
    async judgesInvalidate(
        game: GameResolution,
        invalidatedParticipation: ValidParticipation,
        participations: ValidParticipation[],
        judgeVoteDataInputs: Box<Amount>[]
    ): Promise<string | null> {
        if (!ergo) throw new Error("Wallet not connected");

        if (judgeVoteDataInputs.length > (game.judges.length / 2)) {
            return await judges_invalidate(game, invalidatedParticipation, participations, judgeVoteDataInputs);
        }
        else {
            return await update_reputation_proof("participation", invalidatedParticipation.commitmentC_Hex, false, null);
        }
    }

    /**
     * Permite a cualquier usuario incluir las participaciones que fueron omitidas en la fase de resolución.
     * El usuario que ejecuta esta acción se convierte en el nuevo 'resolver' para reclamar la comisión.
     */
    async includeOmittedParticipations(
        game: GameResolution,
        omittedParticipation: ValidParticipation,
        currentResolved: ValidParticipation | null,
        newResolverPkHex: string
    ): Promise<string | null> {
        if (!ergo) throw new Error("Wallet not connected");
        return await include_omitted_participation(game, omittedParticipation, currentResolved, newResolverPkHex);
    }

    /**
     * Reclama el reembolso de una participación en un juego cancelado.
     * @param game El objeto Game en estado 'GameCancellation'.
     * @param participation La participación ('Participation') que se va a reembolsar.
     * @param claimerAddressString La dirección del usuario que reclama.
     * @returns Una promesa que se resuelve con el ID de la transacción.
     */
    async claimAfterCancellation(
        game: GameCancellation,
        participation: ValidParticipation
    ): Promise<string | null> {
        if (!ergo) throw new Error("Wallet not connected");
        if (game.status !== 'Cancelled_Draining') {
            throw new Error("El juego no está en un estado que permita reembolsos.");
        }
        if (participation.status !== 'Submitted') {
            throw new Error("Solo se pueden reclamar reembolsos para participaciones no gastadas.");
        }
        return await claim_after_cancellation(game, participation);
    }

    /** 
     * Permite al creador de una participación reclamar su stake después de que el período de gracia haya terminado.
     * @param game El objeto Game en estado 'GameActive'.
     * @param participation La participación ('Participation') que se va a reclamar.
     * @returns Una promesa que se resuelve con el ID de la transacción.
     *   */
    async reclaimAfterGrace(
        game: GameActive,
        participation: ValidParticipation
    ): Promise<string | null> {
        if (!ergo) throw new Error("Wallet not connected");
        if (game.status !== 'Active') {
            throw new Error("El juego no está en estado activo.");
        }
        if (participation.status !== 'Submitted') {
            throw new Error("Solo se pueden reclamar participaciones no gastadas.");
        }
        const currentHeight = await this.get_current_height();
        if (currentHeight <= game.deadlineBlock + game.constants.PARTICIPATION_GRACE_PERIOD_IN_BLOCKS) {
            throw new Error("El período de gracia aún no ha terminado.");
        }
        return await reclaim_after_grace(game, participation);
    }

    async reclaimAbandoned(
        game: GameResolution,
        participation: ValidParticipation
    ): Promise<string | null> {
        if (!ergo) throw new Error("Wallet not connected");
        if (game.status !== 'Resolution') {
            throw new Error("El juego no está en estado de resolución.");
        }
        if (participation.status !== 'Submitted') {
            throw new Error("Solo se pueden reclamar participaciones no gastadas.");
        }
        const currentHeight = await this.get_current_height();
        if (currentHeight <= game.deadlineBlock + game.constants.PARTICIPATION_ABANDONED_FUNDS_GRACE_PERIOD) {
            throw new Error("El período de gracia aún no ha terminado.");
        }
        return await reclaim_abandoned_participation(game, participation);
    }

    /**
     * Allows a nominated judge to accept their role in an active game.
     * @param game The Game object in 'Active' state.
     * @returns A promise that resolves to the transaction ID.
     */
    async acceptJudgeNomination(game: GameActive): Promise<string | null> {
        if (!ergo) throw new Error("Wallet not connected.");
        if (game.status !== 'Active') {
            throw new Error("The game is not in an active state.");
        }
        try {
            return await update_reputation_proof("game", game.gameId, true, null);
        } catch (error) {
            console.error("Error in platform method acceptJudgeNomination:", error);
            if (error instanceof Error) throw new Error(`Failed to accept judge nomination: ${error.message}`);
            throw new Error("An unknown error occurred while accepting the judge nomination.");
        }
    }

    /**
     * Executes the "Open Ceremony" action (action3_openCeremony) for an active game.
     * * This action allows anyone to "re-spend" the game's box before the
     * 'ceremonyDeadline' to update the game seed (gameSeed),
     * thereby adding entropy.
     * * The new seed is calculated as:
     * updated_seed = blake2b256(old_seed ++ INPUTS(0).id)
     * * All other registers and box values are preserved.
     * * @param game The GameActive object (box to be consumed).
     * @returns The transaction ID if successful.
     */
    async contribute_to_ceremony(game: GameActive): Promise<string | null> {
        if (!ergo) throw new Error("Wallet not connected.");
        if (game.status !== 'Active') {
            throw new Error("The game is not in an active state.");
        }
        try {
            return await contribute_to_ceremony(game);
        } catch (error) {
            console.error("Error in platform method contribute_to_ceremony:", error);
            if (error instanceof Error) throw new Error(`Failed to contribute to ceremony: ${error.message}`);
            throw new Error("An unknown error occurred while contributing to the ceremony.");
        }

    }

}