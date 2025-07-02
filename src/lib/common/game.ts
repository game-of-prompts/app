// Preferiblemente en un nuevo archivo como '$lib/common/gop_game_types.ts' o adaptando el existente.
// import { type contract_version } from "$lib/ergo/contract"; // Eliminado a menos que GoP tenga un sistema de versiones similar
import type { ErgoPlatform } from "$lib/ergo/platform"; // Asegúrate que la ruta es correcta
import type { Amount, Box } from "@fleet-sdk/core";


export interface WinnerInfo {
    playerAddress: string; // Dirección Base58 del ganador
    playerPK_Hex?: string;  // PK Hex del ganador (opcional, si la dirección no está directa)
    score: bigint | number; // Puntuación ganadora
    participationBoxId?: string; // ID de la caja de participación ganadora (para highlight)
}


/**
 * Describe el contenido detallado de un juego de GoP.
 * Reemplaza a 'ProjectContent' de Bene.
 */
export interface GameContent {
    rawJsonString?: string; // El JSON original, si los detalles vienen de ahí
    title: string;
    description: string;
    serviceId: string;     // Campo esencial para GoP
    imageURL?: string;    // Opcional, de gameDetailsJson o metadatos del NFT
    webLink?: string;     // Opcional, de gameDetailsJson o metadatos del NFT
    mirrorUrls?: string[];// Opcional
}

export interface Participation {
    boxId: string;
    box: Box<Amount>, // La caja cruda de la participacion del explorador

    transactionId: string;
    creationHeight: number;
    value: bigint; // La participationFeeNanoErg pagada

    playerPK_Hex: string;      // De R4, representación hexadecimal
    commitmentC_Hex: string;   // De R5, representación hexadecimal
    
    solverId_RawBytesHex: string; // De R7, hex de los bytes crudos
    solverId_String?: string;     // R7 decodificado si es un string UTF-8
    hashLogs_Hex: string;      // De R8, representación hexadecimal
    scoreList: bigint[];      // De R9
}

/**
 * Estructura principal para un juego de GoP.
 * Mantenemos el nombre 'Project' por compatibilidad con la Svelte List Page si esta no se modifica.
 * Los campos específicos de la mecánica de crowdfunding de Bene han sido eliminados o adaptados.
 * Los valores monetarios y de tokens ahora usan 'bigint'.
 */
export interface Game { // Nombre 'Project' mantenido para compatibilidad con UI existente
    boxId: string; // gameBox.boxId
    box: Box<Amount>; // La caja cruda de la gameBox del explorador

    platform: ErgoPlatform; // Instancia de ErgoPlatform para acciones (ej. obtener altura actual)

    // --- Campos parseados de los registros de gameBox (GoP) ---
    gameCreatorPK_Hex: string; // De R4 (hex string de Coll[Byte])
    // hashedSecret_Hex?: string; // De R5 (opcional, para uso interno, no para mostrar en listas)
    // expectedParticipationScriptHash_Hex?: string; // De R6 (opcional)
    
    deadlineBlock: number;          // De R7 (reemplaza block_limit de Bene)
    creatorStakeNanoErg: bigint;    // De R7 (debería coincidir con box.value)
    participationFeeNanoErg: bigint;// De R7
    commissionPercentage: number;   // De R8

    gameId: string;

    // --- Contenido/Detalles del Juego ---
    content: GameContent;

    // El campo 'value' representa el valor ERG de la caja, que en GoP es la apuesta del creador.
    value: bigint; // box.value (antes era number)

    participations: Participation[];

    ended: boolean;
    secret?: Uint8Array;
    winnerInfo?: WinnerInfo;
}

/**
 * Verifica si el período de participación de un juego de GoP ha terminado.
 * @param game El objeto del juego de GoP (tipado como Project por compatibilidad).
 * @returns Promise<boolean> True si la fecha límite (deadline) ha pasado.
 */
export async function isGameParticipationEnded(game: Game): Promise<boolean> {
    const currentHeight = await game.platform.get_current_height();
    return game.deadlineBlock <= currentHeight;
}

/**
 * Parsea los detalles del contenido de un juego.
 * En GoP, esta información puede venir de un string JSON (almacenado, por ejemplo,
 * en un registro del NFT del juego) o construirse a partir de los datos EIP-4 del NFT.
 *
 * @param rawJsonDetails String JSON opcional con los detalles del juego.
 * @param gameBoxId ID de la gameBox, usado como identificador de fallback.
 * @param nft Detalles del TokenEIP4 del Game NFT. Su nombre y descripción pueden usarse.
 * @returns GameContent parseado.
 */
export function parseGameContent(
    rawJsonDetails: string | undefined | null,
    gameBoxId: string, 
    nft?: TokenEIP4 
): GameContent {
    let title = nft?.name || `Game ${gameBoxId.slice(0, 8)}`;
    let description = nft?.description || "No description provided.";
    // Intenta obtener serviceId del campo 'serviceId' del NFT (si se enriqueció TokenEIP4)
    // o parseándolo desde la descripción del NFT, o del JSON.
    let serviceId = nft?.serviceId || ""; 
    let imageURL: string | undefined = undefined;
    let webLink: string | undefined = undefined;
    let mirrorUrls: string[] | undefined = undefined;

    if (rawJsonDetails) {
        try {
            const parsed = JSON.parse(rawJsonDetails);
            title = parsed.title || title;
            description = parsed.description || description;
            serviceId = parsed.serviceId || serviceId; // El JSON tiene precedencia para serviceId
            imageURL = parsed.imageURL || parsed.image || undefined;
            webLink = parsed.webLink || parsed.link || undefined;
            mirrorUrls = parsed.mirrorUrls || undefined;
        } catch (error) {
            console.warn(`Error al parsear rawJsonDetails para el juego ${gameBoxId}. Usando fallbacks. Error: ${error}`);
            // Si el JSON falla, los valores de nft (title, description) ya están asignados.
            // serviceId podría necesitar ser parseado de la descripción del NFT si no estaba ya en nft.serviceId.
        }
    }
    
    // Si serviceId sigue vacío, intenta un último parseo de la descripción del NFT.
    if (!serviceId && nft?.description) {
        // Ejemplo de regex: "Service ID: my-service.celaut.bee"
        const serviceIdMatch = nft.description.match(/Service ID:\s*([\w.-]+)/i);
        if (serviceIdMatch && serviceIdMatch[1]) {
           serviceId = serviceIdMatch[1];
        }
    }
    // Fallback final si serviceId sigue sin encontrarse. Es un campo importante.
    if (!serviceId) {
        console.warn(`serviceId no encontrado para el juego ${gameBoxId}. Usando placeholder.`);
        serviceId = `unknown_service_for_${gameBoxId.slice(0,6)}`;
    }

    return {
        rawJsonString: rawJsonDetails, // Guarda el JSON original si se usó
        title,
        description,
        serviceId,
        imageURL,
        webLink,
        mirrorUrls
    };
}