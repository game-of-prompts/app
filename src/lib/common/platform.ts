// src/common/platform.ts
import { type Game } from "$lib/common/game";

export interface CreateGoPGamePlatformParams {
    gameServiceId: string;
    hashedSecret: string; // Hex string of blake2b256(S)
    deadlineBlock: number;
    creatorStakeNanoErg: BigInt;
    participationFeeNanoErg: BigInt;
    commissionPercentage: number;
    gameDetailsJson: string; // JSON string with title, description, serviceId, etc.
}

export interface Platform {
    id: string;  // ergo, ethereum ...
    main_token: string; // ERG, ETH ...
    icon: string;  // Icon path or url.
    time_per_block: number; // milliseconds
    last_version: string; // Tipo para la versión del contrato

    connect(): Promise<void>;
    get_current_height(): Promise<number>;
    get_balance(id?: string): Promise<Map<string, number>>;

    /**
     * Inicia la creación de un nuevo juego "Game of Prompts" en la blockchain.
     * @param params - Objeto que contiene todos los parámetros necesarios para la creación del juego.
     * @returns Una promesa que se resuelve con el ID de la transacción si tiene éxito, o null en caso contrario.
     */
    createGoPGame(params: CreateGoPGamePlatformParams): Promise<string | null>;

    /**
     * Envía la puntuación de un jugador a un juego "Game of Prompts".
     * @param game - El objeto Game al que se envía la puntuación.
     * @param scoreList - Lista de puntuaciones.
     * @param commitmentC_hex - Commitment C en formato hexadecimal.
     * @param solverId_string - ID del solucionador en formato string.
     * @param hashLogs_hex - Hash de los logs en formato hexadecimal.
     * @returns Una promesa que se resuelve con el ID de la transacción si tiene éxito, o null en caso contrario.
     */
    submitScoreToGopGame(
        game: Game,
        scoreList: bigint[], // o el tipo apropiado si bigint no es directamente serializable o esperado así
        commitmentC_hex: string,
        solverId_string: string,
        hashLogs_hex: string
    ): Promise<string | null>;

    /**
     * Resuelve un juego "Game of Prompts".
     * @param game - El objeto Game que se va a resolver.
     * @param secretS_hex - El secreto S en formato hexadecimal.
     * @returns Una promesa que se resuelve con el ID de la transacción si tiene éxito, o null en caso contrario.
     */
    resolveGame(
        game: Game,
        secretS_hex: string
    ): Promise<string | null>;

    /**
     * Cancela un juego "Game of Prompts" antes de la fecha límite.
     * @param game - El objeto Game que se va a cancelar.
     * @param secretS_hex - El secreto S en formato hexadecimal.
     * @param claimerAddressString - La dirección Ergo del usuario que inicia la cancelación.
     * @returns Una promesa que se resuelve con el ID de la transacción si tiene éxito, o null en caso contrario.
    */
    cancel_game_before_deadline(
        game: Game,
        secretS_hex: string,
        claimerAddressString: string
    ): Promise<string | null>;

    /**
     * Obtiene los juegos "Game of Prompts" activos.
     * @param offset - Opcional, para paginación.
     * @returns Un Map con los juegos activos, donde la clave es el ID del juego.
     */
    fetchGoPGames(offset?: number): Promise<Map<string, Game>>;

}