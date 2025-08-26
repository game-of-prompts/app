// src/common/platform.ts

import type { 
    GameActive,
    GameResolution,
    GameCancellation,
    ParticipationSubmitted,
    ParticipationResolved
} from "$lib/common/game";
import { type Box } from "@fleet-sdk/core";

// Un tipo de unión para representar un juego en cualquier estado posible.
export type AnyGame = GameActive | GameResolution | GameCancellation;

export interface CreateGoPGamePlatformParams {
    gameServiceId: string;
    hashedSecret: string; // Hex string de blake2b256(S)
    deadlineBlock: number;
    creatorStakeNanoErg: BigInt;
    participationFeeNanoErg: BigInt;
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
    createGoPGame(params: CreateGoPGamePlatformParams): Promise<string | null>;

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
        participations: ParticipationSubmitted[],
        secretS_hex: string
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
     * @param participation La participación ('ParticipationSubmitted') que se va a reembolsar.
     * @param claimerAddressString La dirección del usuario que reclama.
     * @returns Una promesa que se resuelve con el ID de la transacción.
     */
    drain_cancelled_game_stake(
        game: GameCancellation,
        claimerAddressString: string
    ): Promise<string | null>;

    endGame(
        game: GameResolution,
        participations: ParticipationResolved[]
    ): Promise<string | null>;

    /**
     * Permite a un juez votar para invalidar al candidato a ganador actual.
     * Si suficientes jueces votan, se elige un nuevo candidato y se extiende el plazo.
     */
    judgesInvalidate(
        game: GameResolution,
        invalidatedParticipation: ParticipationResolved,
        judgeVoteDataInputs: Box<bigint>[]
    ): Promise<string | null>

    /**
     * Permite a cualquier usuario incluir las participaciones que fueron omitidas en la fase de resolución.
     * El usuario que ejecuta esta acción se convierte en el nuevo 'resolver' para reclamar la comisión.
     */
    includeOmittedParticipations(
        game: GameResolution,
        omittedParticipation: ParticipationSubmitted[],
        currentResolved: ParticipationResolved[],
        newResolverPkHex: string
    ): Promise<string | null>


    /*
    * Permite a un jugador reclamar su participación después de que el juego haya sido cancelado.
    * Solo es posible si el jugador no ha reclamado aún y el juego está en estado 'Cancelled_Draining'.
    */
    claimAfterCancellation(
        game: GameCancellation,
        participation: ParticipationSubmitted
    ): Promise<string | null>;

    /*
    * Permite a un jugador reclamar su participación después de que el período de gracia haya terminado.
    * Solo es posible si el jugador no ha reclamado aún y el juego está en estado 'Active' pero el período de participación ha terminado y el período de gracia ha pasado.
    */
    reclaimAfterGrace(
        game: GameActive,
        participation: ParticipationSubmitted
    ): Promise<string | null>;


    /**
     * Obtiene todos los juegos "Game of Prompts" de la blockchain en todos sus estados.
     * @returns Un Map con todos los juegos, usando el ID del juego como clave.
     */
    fetchGoPGames(): Promise<Map<string, AnyGame>>;
}