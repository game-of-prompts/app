// src/common/platform.ts

import type {
    GameActive,
    GameResolution,
    GameCancellation,
    ValidParticipation,
    AnyGame
} from "$lib/common/game";
import { type Amount, type Box } from "@fleet-sdk/core";

export interface CreateGoPGamePlatformParams {
    gameServiceId: string;
    hashedSecret: string; // Hex string de blake2b256(S)
    deadlineBlock: number;
    resolverStakeAmount: BigInt;
    participationFeeAmount: BigInt;
    commissionPercentage: number;
    gameDetailsJson: string; // String JSON con título, descripción, etc.
}

export interface Platform {
    id: string;              // ergo, ethereum ...
    main_token: string;      // ERG, ETH ...
    icon: string;            // Ruta o URL del icono.
    time_per_block: number;  // milisegundos
    last_version: string;    // Versión del conjunto de contratos

    connect(): Promise<void>;
    get_current_height(): Promise<number>;
    get_balance(id?: string): Promise<Map<string, number>>;

    /**
     * Inicia la creación de un nuevo juego "Game of Prompts".
     * @param params Objeto con todos los parámetros necesarios.
     * @returns Una promesa que se resuelve con el ID de la transacción.
     */
    createGoPGame(params: CreateGoPGamePlatformParams): Promise<string[] | null>;

    /**
     * Envía la puntuación de un jugador a un juego.
     * @param game El objeto Game en estado 'Active' al que se envía la puntuación.
     * @param scoreList Lista de puntuaciones para ofuscar la real.
     * @param commitmentC_hex El commitment criptográfico en hexadecimal.
     * @param solverId_string El ID del solver del jugador.
     * @param hashLogs_hex El hash de los logs del jugador.
     * @returns Una promesa que se resuelve con el ID de la transacción.
     */
    submitScoreToGopGame(
        game: GameActive,
        scoreList: bigint[],
        commitmentC_hex: string,
        solverId_string: string,
        hashLogs_hex: string
    ): Promise<string | null>;

    /**
     * Inicia la fase de resolución de un juego.
     * @param game El objeto Game en estado 'Active' que se va a resolver.
     * @param secretS_hex El secreto 'S' en formato hexadecimal.
     * @returns Una promesa que se resuelve con el ID de la transacción.
     */
    resolveGame(
        game: GameActive,
        participations: ValidParticipation[],
        secretS_hex: string,
        acceptedJudgeNominations: string[]
    ): Promise<string | null>;

    /**
     * Inicia la cancelación de un juego antes de su fecha límite.
     * @param game El objeto Game en estado 'Active' que se va a cancelar.
     * @param secretS_hex El secreto 'S' en formato hexadecimal.
     * @param claimerAddressString La dirección del usuario que inicia la cancelación.
     * @returns Una promesa que se resuelve con el ID de la transacción.
     */
    cancel_game(
        game: GameActive,
        secretS_hex: string,
        claimerAddressString: string
    ): Promise<string | null>;

    /**
     * Reclama el reembolso de una participación en un juego cancelado.
     * @param game El objeto Game en estado 'GameCancellation'.
     * @param participation La participación ('Participation') que se va a reembolsar.
     * @param claimerAddressString La dirección del usuario que reclama.
     * @returns Una promesa que se resuelve con el ID de la transacción.
     */
    drain_cancelled_game_stake(
        game: GameCancellation,
        claimerAddressString: string
    ): Promise<string | null>;

    endGame(
        game: GameResolution,
        participations: ValidParticipation[]
    ): Promise<string | null>;

    toEndGame(
        game: GameResolution
    ): Promise<string | null>;

    /**
     * Executes chained transaction: Resolution -> EndGame -> Finalize in a single operation.
     * Returns array of transaction IDs [txA, txB].
     */
    toEndGameChained(
        game: GameResolution,
        participations: ValidParticipation[]
    ): Promise<string[] | null>;

    /**
     * Permite a un juez votar para invalidar al candidato a ganador actual.
     * Solo crea o actualiza la opinión de reputación.
     */
    judgesInvalidateVote(
        invalidatedParticipation: ValidParticipation
    ): Promise<string | null>;

    /**
     * Ejecuta la invalidación definitiva en el contrato.
     * Requiere que ya exista una mayoría de votos.
     */
    judgesInvalidateExecute(
        game: GameResolution,
        invalidatedParticipation: ValidParticipation,
        judgeVoteDataInputs: Box<Amount>[]
    ): Promise<string[] | null>;

    /**
     * Permite a un juez votar para marcar al candidato a ganador actual como no disponible.
     * Solo crea o actualiza la opinión de reputación.
     */
    judgesInvalidateUnavailableVote(
        game: GameResolution,
        invalidatedParticipation: ValidParticipation
    ): Promise<string | null>;

    /**
     * Ejecuta la marca de indisponibilidad definitiva en el contrato.
     * Requiere que ya exista una mayoría de votos.
     */
    judgesInvalidateUnavailableExecute(
        game: GameResolution,
        invalidatedParticipation: ValidParticipation,
        judgeVoteDataInputs: Box<Amount>[]
    ): Promise<string | null>;

    /**
     * Permite a cualquier usuario incluir las participaciones que fueron omitidas en la fase de resolución.
     * El usuario que ejecuta esta acción se convierte en el nuevo 'resolver' para reclamar la comisión.
     */
    includeOmittedParticipations(
        game: GameResolution,
        omittedParticipation: ValidParticipation,
        currentResolved: ValidParticipation,
        newResolverPkHex: string
    ): Promise<string | null>


    /*
    * Permite a un jugador reclamar su participación después de que el juego haya sido cancelado.
    * Solo es posible si el jugador no ha reclamado aún y el juego está en estado 'Cancelled_Draining'.
    */
    claimAfterCancellation(
        game: GameCancellation,
        participation: ValidParticipation
    ): Promise<string | null>;

    /*
    * Permite a un jugador reclamar su participación después de que el período de gracia haya terminado.
    * Solo es posible si el jugador no ha reclamado aún y el juego está en estado 'Active' pero el período de participación ha terminado y el período de gracia ha pasado.
    */
    reclaimAfterGrace(
        game: GameActive,
        participation: ValidParticipation
    ): Promise<string | null>;

    /**
     * 
     */
    acceptJudgeNomination(game: GameActive): Promise<string | null>;

    /*
    *
    */
    contribute_to_ceremony(game: GameActive): Promise<string | null>;

    /**
     * Batches multiple participations into a single box to optimize end_game transaction.
     */
    batchParticipations(
        game: GameResolution,
        participations: ValidParticipation[],
        batches: Box<any>[]
    ): Promise<string | null>;

}