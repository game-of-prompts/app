import { compile, type ErgoTree } from "@fleet-sdk/compiler";
import { Network, type Address } from "@fleet-sdk/core";
import { blake2b256, sha256 } from "@fleet-sdk/crypto";
import { uint8ArrayToHex } from "./utils";
import { network_id } from "./envs"; 

import GOP_GAME_BOX_SCRIPT_SOURCE from '../../../contracts/game.es?raw';
import GOP_PARTICIPATION_BOX_SCRIPT_SOURCE from '../../../contracts/participation.es?raw';

const networkType: Network = network_id === "mainnet" ? Network.Mainnet : Network.Testnet;
const ergoTreeVersion = 1; 

let _gopGameBoxErgoTree: ErgoTree | null = null;
let _gopParticipationBoxErgoTree: ErgoTree | null = null;
let _gopGameBoxTemplateHash: string | null = null;
let _gopParticipationBoxScriptHash: string | null = null;
let _gopParticipationBoxTemplateHash: string | null = null;

function ensureGameBoxCompiled(): void {
    if (!_gopGameBoxErgoTree) {
        console.log("Compiling GameBox script...");
        try {
            const participation_box_script_hash = getGopParticipationBoxScriptHash();
            let scriptSource = GOP_GAME_BOX_SCRIPT_SOURCE;
            scriptSource = scriptSource.replace(/\$PARTICIPATION_BOX_SCRIPT_HASH/g, participation_box_script_hash);
            _gopGameBoxErgoTree = compile(scriptSource, { version: ergoTreeVersion });
            console.log("GameBox script compiled successfully.");
        } catch (e) {
            console.error("ERROR Compiling GameBox script:", e); // Loguear el script fuente puede ser muy verboso
            throw e; 
        }
    }
}

function ensureParticipationBoxCompiled(): void {
    if (!_gopParticipationBoxErgoTree) {
        console.log("Compiling ParticipationBox script...");
        try {
            _gopParticipationBoxErgoTree = compile(GOP_PARTICIPATION_BOX_SCRIPT_SOURCE, { version: ergoTreeVersion });
            console.log("ParticipationBox script compiled successfully.");
        } catch (e) {
            console.error("ERROR Compiling ParticipationBox script:", e);
            throw e;
        }
    }
}

/**
 * Obtiene el ErgoTree hexadecimal del script de la GameBox.
 * @returns El ErgoTree hexadecimal.
 */
export function getGopGameBoxErgoTreeHex(): string {
    ensureGameBoxCompiled();
    return _gopGameBoxErgoTree!.toHex();
}

/**
 * Obtiene el ErgoTree hexadecimal del script de la ParticipationBox.
 * @returns El ErgoTree hexadecimal.
 */
export function getGopParticipationBoxErgoTreeHex(): string {
    ensureParticipationBoxCompiled();
    return _gopParticipationBoxErgoTree!.toHex();
}

/**
 * Calcula y devuelve la dirección P2S para el script de la GameBox.
 * @returns La dirección Base58.
 */
export function getGopGameBoxAddress(): Address {
    ensureGameBoxCompiled();
    return _gopGameBoxErgoTree!.toAddress(networkType);
}

/**
 * Calcula y devuelve la dirección P2S para el script de la ParticipationBox.
 * @returns La dirección Base58.
 */
export function getGopParticipationBoxAddress(): Address {
    ensureParticipationBoxCompiled();
    return _gopParticipationBoxErgoTree!.toAddress(networkType);
}

/**
 * Calcula el hash Blake2b256 del *template* del ErgoTree del script de la GameBox.
 * Este hash se usa para buscar cajas en la blockchain.
 * @returns El hash del template en formato hexadecimal.
 */
export function getGopGameBoxTemplateHash(): string {
    if (!_gopGameBoxTemplateHash) {
        ensureGameBoxCompiled();
        const templateObject = _gopGameBoxErgoTree!.template;
        if (typeof templateObject.toBytes !== 'function') {
            throw new Error("GameBox ErgoTree 'template' property does not have a 'toBytes()' method.");
        }
        const templateBytes = templateObject.toBytes();
        if (!(templateBytes instanceof Uint8Array)) {
            throw new Error("GameBox ErgoTree 'template.toBytes()' did not return a Uint8Array.");
        }
        
        _gopGameBoxTemplateHash = uint8ArrayToHex(sha256(templateBytes));
    }
    return _gopGameBoxTemplateHash;
}

/**
 * Calcula el hash del ErgoTree *completo* del script de la ParticipationBox.
 * Este es el hash que se almacena en la constante de la GameBox y DEBE usar blake2b256
 * si el script de la GameBox usa blake2b256 para la verificación.
 * @returns El hash del script en formato hexadecimal.
 */
export function getGopParticipationBoxScriptHash(): string {
    if (!_gopParticipationBoxScriptHash) {
        ensureParticipationBoxCompiled();
        const ergoTreeBytes = _gopParticipationBoxErgoTree!.toBytes(); 
        if (!(ergoTreeBytes instanceof Uint8Array)) {
             throw new Error("Failed to get valid Uint8Array for ParticipationBox ErgoTree bytes.");
        }
        _gopParticipationBoxScriptHash = uint8ArrayToHex(blake2b256(ergoTreeBytes));
    }
    return _gopParticipationBoxScriptHash;
}

/**
 * Calcula el hash del *template* del ErgoTree del script de la ParticipationBox.
 * Se usa para buscar todas las ParticipationBox en la blockchain.
 * @returns El hash del template en formato hexadecimal.
 */
export function getGopParticipationBoxTemplateHash(): string { // <--- NUEVA FUNCIÓN
    if (!_gopParticipationBoxTemplateHash) {
        ensureParticipationBoxCompiled();
        const templateObject = _gopParticipationBoxErgoTree!.template;
        if (typeof templateObject.toBytes !== 'function') {
            throw new Error("ParticipationBox ErgoTree 'template' property does not have a 'toBytes()' method.");
        }
        const templateBytes = templateObject.toBytes();
        if (!(templateBytes instanceof Uint8Array)) {
            throw new Error("ParticipationBox ErgoTree 'template.toBytes()' did not return a Uint8Array.");
        }

        _gopParticipationBoxTemplateHash = uint8ArrayToHex(sha256(templateBytes));
        console.log("DEBUG: Calculated ParticipationBox Template Hash (using sha256):", _gopParticipationBoxTemplateHash);
    }
    return _gopParticipationBoxTemplateHash;
}