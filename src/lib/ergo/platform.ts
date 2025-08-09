// src/ergo/platform.ts
import { 
    type GameActive, 
    type GameResolution, 
    type GameCancellation, 
    type ParticipationSubmitted 
} from '../common/game';
import { fetchActiveGames, fetchResolutionGames, fetchCancellationGames } from './fetch';
import { create_game } from './actions/create_game';
import { explorer_uri, network_id } from './envs';
import { address, connected, network, balance } from "../common/store";
import { submit_score } from './actions/submit_score';
import { resolve_game } from './actions/resolve_game';
import { type Platform } from '$lib/common/platform';
import { cancel_game_before_deadline } from './actions/cancel_game_before_deadline';
import { drain_cancelled_game_stake } from './actions/drain_cancelled_game_stake';

// Un tipo de unión para representar un juego en cualquier estado posible.
type AnyGame = GameActive | GameResolution | GameCancellation;

interface CreateGoPGamePlatformParams {
    gameServiceId: string;
    hashedSecret: string; // Hex string of blake2b256(S)
    deadlineBlock: number;
    creatorStakeNanoErg: BigInt;
    participationFeeNanoErg: BigInt;
    commissionPercentage: number;
    invitedJudges: string[];
    gameDetailsJson: string; // JSON string with title, description, serviceId, etc.
}

export class ErgoPlatform implements Platform {

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
                    console.log('¡Conectado!');
                    address.set(await ergo.get_change_address());
                    network.set((network_id == "mainnet") ? "ergo-mainnet" : "ergo-testnet");
                    await this.get_balance();
                    connected.set(true);
                } else {
                    alert('No conectado');
                }
            } else {
                alert('La billetera Nautilus no está activa');
            }
        }
    }

    async get_current_height(): Promise<number> {
        try {
            return await ergo.get_current_height();
        } catch {
            try {
                const response = await fetch(explorer_uri + '/api/v1/networkState');
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
        const balanceMap = new Map<string, number>();
        const addr = await ergo.get_change_address();
        if (!addr) throw new Error("Se requiere una dirección para obtener el saldo.");

        try {
            const response = await fetch(explorer_uri + `/api/v1/addresses/${addr}/balance/confirmed`);
            if (!response.ok) throw new Error(`La solicitud a la API falló: ${response.status}`);
            const data = await response.json();
            balanceMap.set("ERG", data.nanoErgs);
            balance.set(data.nanoErgs);
            data.tokens.forEach((token: { tokenId: string; amount: number }) => {
                balanceMap.set(token.tokenId, token.amount);
            });
        } catch (error) {
            console.error(`No se pudo obtener el saldo para la dirección ${addr}:`, error);
            throw new Error("No se puede obtener el saldo.");
        }
        return balanceMap;
    }

    public async createGoPGame(params: CreateGoPGamePlatformParams): Promise<string | null> {
        if (!ergo) throw new Error("Billetera no conectada.");
        
        try {
            return await create_game(
                params.gameServiceId,
                params.hashedSecret,
                params.deadlineBlock,
                params.creatorStakeNanoErg,
                params.participationFeeNanoErg,
                params.commissionPercentage,
                params.invitedJudges,
                params.gameDetailsJson
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
        if (!ergo) throw new Error("Billetera no conectada.");

        return await submit_score(
            game.gameId,
            scoreList,
            game.participationFeeNanoErg,
            commitmentC_hex,
            solverId_string,
            hashLogs_hex
        );
    }

    async resolveGame(
        game: GameActive,
        participations: ParticipationSubmitted[],
        secretS_hex: string
    ): Promise<string | null> {
        if (!ergo) throw new Error("Billetera no conectada.");
        
        return await resolve_game(game, participations, secretS_hex, []);
    }

    async cancel_game_before_deadline(
        game: GameActive, // Tipo específico: solo se puede cancelar un juego activo.
        secretS_hex: string,
        claimerAddressString: string
    ): Promise<string | null> {
        if (!ergo) throw new Error("Billetera no conectada.");
        
        return await cancel_game_before_deadline(game, secretS_hex, claimerAddressString);
    }

    async drain_cancelled_game_stake(
        game: GameCancellation, // Tipo específico: el juego debe estar en estado de cancelación.
        claimerAddressString: string
    ): Promise<string | null> {
        if (!ergo) throw new Error("Billetera no conectada.");

        return await drain_cancelled_game_stake(game, claimerAddressString);
    }

    /**
     * Busca todos los juegos en la blockchain, combinando los resultados de cada estado posible.
     * @returns Un `Promise` que resuelve a un `Map` que contiene todos los juegos, usando el ID del juego como clave.
     */
    async fetchGoPGames(): Promise<Map<string, AnyGame>> {
        console.log("Buscando todos los juegos en todos los estados...");

        // Ejecutar todas las búsquedas en paralelo para mayor eficiencia.
        const [activeGames, resolutionGames, cancellationGames] = await Promise.all([
            fetchActiveGames(),
            fetchResolutionGames(),
            fetchCancellationGames()
        ]);

        // Combinar los resultados en un solo mapa.
        // El operador '...' permite fusionar los mapas. Si un ID existiera en múltiples
        // mapas (lo cual es imposible por diseño de los contratos), el último prevalecería.
        const allGames = new Map<string, AnyGame>([
            ...activeGames,
            ...resolutionGames,
            ...cancellationGames,
        ]);

        console.log(`Búsqueda completada. Total de juegos encontrados: ${allGames.size}`);
        return allGames;
    }
}