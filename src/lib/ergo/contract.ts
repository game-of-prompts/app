// src/lib/ergo/contract.ts

import { compile, type ErgoTree } from "@fleet-sdk/compiler";
import { Network, type Address } from "@fleet-sdk/core";
import { blake2b256, sha256 } from "@fleet-sdk/crypto";
import { uint8ArrayToHex } from "./utils";
import { network_id } from "./envs"; 

// --- Importación de todos los fuentes de los contratos ---
import GAME_ACTIVE_SOURCE from '../../../contracts/game_active.es?raw';
import GAME_RESOLUTION_SOURCE from '../../../contracts/game_resolution.es?raw';
import GAME_CANCELLATION_SOURCE from '../../../contracts/game_cancellation.es?raw';
import PARTICIPATION_SUBMITTED_SOURCE from '../../../contracts/participation_submited.es?raw';
import PARTICIPATION_RESOLVED_SOURCE from '../../../contracts/participation_resolved.es?raw';

const networkType: Network = network_id === "mainnet" ? Network.Mainnet : Network.Testnet;
const ergoTreeVersion = 1;

// --- Variables para almacenar en caché los resultados de la compilación ---
let _gameActive: { ergoTree?: ErgoTree, templateHash?: string } = {};
let _gameResolution: { ergoTree?: ErgoTree, templateHash?: string, scriptHash?: string } = {};
let _gameCancellation: { ergoTree?: ErgoTree, templateHash?: string, scriptHash?: string } = {};
let _participationSubmitted: { ergoTree?: ErgoTree, templateHash?: string, scriptHash?: string } = {};
let _participationResolved: { ergoTree?: ErgoTree, templateHash?: string, scriptHash?: string } = {};


const dev_addr_base58 = "9ejNy2qoifmzfCiDtEiyugthuXMriNNPhNKzzwjPtHnrK3esvbD"
console.log("Dev addr", dev_addr_base58)

// =============================================================================
// === LÓGICA DE COMPILACIÓN CON INYECCIÓN DE DEPENDENCIAS
// =============================================================================

// Nota: El orden de compilación es importante debido a las dependencias entre scripts.

function ensureParticipationResolvedCompiled(): void {
    if (_participationResolved.ergoTree) return;
    _participationResolved.ergoTree = compile(PARTICIPATION_RESOLVED_SOURCE, { version: ergoTreeVersion });
}

function ensureParticipationSubmittedCompiled(): void {
    if (_participationSubmitted.ergoTree) return;
    ensureParticipationResolvedCompiled();
    const resolvedHash = getGopParticipationResolvedScriptHash();
    let source = PARTICIPATION_SUBMITTED_SOURCE.replace(/`\+PARTICIPATION_RESOLVED_SCRIPT_HASH\+`/g, resolvedHash);
    _participationSubmitted.ergoTree = compile(source, { version: ergoTreeVersion });
}

function ensureGameCancellationCompiled(): void {
    if (_gameCancellation.ergoTree) return;
    _gameCancellation.ergoTree = compile(GAME_CANCELLATION_SOURCE, { version: ergoTreeVersion });
}

function ensureGameResolutionCompiled(): void {
    if (_gameResolution.ergoTree) return;
    ensureParticipationSubmittedCompiled(); // Dependencia transitiva
    const submittedHash = getGopParticipationSubmittedScriptHash();
    const resolvedHash = getGopParticipationResolvedScriptHash();
    let source = GAME_RESOLUTION_SOURCE
        .replace(/`\+DEV_ADDR\+`/g, dev_addr_base58)
        .replace(/`\+PARTICIPATION_SUBMITTED_SCRIPT_HASH\+`/g, submittedHash)
        .replace(/`\+PARTICIPATION_RESOLVED_SCRIPT_HASH\+`/g, resolvedHash);
    _gameResolution.ergoTree = compile(source, { version: ergoTreeVersion });
}

function ensureGameActiveCompiled(): void {
    if (_gameActive.ergoTree) return;
    ensureGameResolutionCompiled();
    ensureGameCancellationCompiled();
    ensureParticipationSubmittedCompiled();

    const resolutionHash = getGopGameResolutionScriptHash();
    const cancellationHash = getGopGameCancellationScriptHash();
    const participationHash = getGopParticipationSubmittedScriptHash();
    const resolvedHash = getGopParticipationResolvedScriptHash();

    let source = GAME_ACTIVE_SOURCE
        .replace(/`\+GAME_RESOLUTION_SCRIPT_HASH\+`/g, resolutionHash)
        .replace(/`\+GAME_CANCELLATION_SCRIPT_HASH\+`/g, cancellationHash)
        .replace(/`\+PARTICIPATION_SUBMITED_SCRIPT_HASH\+`/g, participationHash)
        .replace(/`\+PARTICIPATION_RESOLVED_SCRIPT_HASH\+`/g, resolvedHash);
        
    _gameActive.ergoTree = compile(source, { version: ergoTreeVersion });
}

// =============================================================================
// === FUNCIONES PÚBLICAS PARA OBTENER HASHES, DIRECCIONES Y ERGOTREES
// =============================================================================

// --- Funciones auxiliares genéricas ---
function getTemplateHash(stateObject: { ergoTree?: ErgoTree, templateHash?: string }, ensureCompiled: () => void): string {
    if (!stateObject.templateHash) {
        ensureCompiled();
        const templateBytes = stateObject.ergoTree!.template.toBytes();
        stateObject.templateHash = uint8ArrayToHex(sha256(templateBytes)); // SHA256 para búsqueda en explorador
    }
    return stateObject.templateHash;
}

function getScriptHash(stateObject: { ergoTree?: ErgoTree, scriptHash?: string }, ensureCompiled: () => void): string {
    if (!stateObject.scriptHash) {
        ensureCompiled();
        const ergoTreeBytes = stateObject.ergoTree!.toBytes();
        stateObject.scriptHash = uint8ArrayToHex(blake2b256(ergoTreeBytes)); // BLAKE2B256 para constantes en scripts
    }
    return stateObject.scriptHash;
}

// --- Game Active ---
export const getGopGameActiveScriptHash = () => getTemplateHash(_gameActive, ensureGameActiveCompiled);
export function getGopGameActiveAddress(): Address { ensureGameActiveCompiled(); return _gameActive.ergoTree!.toAddress(networkType); }
export function getGopGameActiveErgoTreeHex(): string { ensureGameActiveCompiled(); return _gameActive.ergoTree!.toHex(); }

// --- Game Resolution ---
export const getGopGameResolutionTemplateHash = () => getTemplateHash(_gameResolution, ensureGameResolutionCompiled);
export const getGopGameResolutionScriptHash = () => getScriptHash(_gameResolution, ensureGameResolutionCompiled);
export function getGopGameResolutionAddress(): Address { ensureGameResolutionCompiled(); return _gameResolution.ergoTree!.toAddress(networkType); }
export function getGopGameResolutionErgoTreeHex(): string { ensureGameResolutionCompiled(); return _gameResolution.ergoTree!.toHex(); }

// --- Game Cancellation ---
export const getGopGameCancellationTemplateHash = () => getTemplateHash(_gameCancellation, ensureGameCancellationCompiled);
export const getGopGameCancellationScriptHash = () => getScriptHash(_gameCancellation, ensureGameCancellationCompiled);
export function getGopGameCancellationAddress(): Address { ensureGameCancellationCompiled(); return _gameCancellation.ergoTree!.toAddress(networkType); }
export function getGopGameCancellationErgoTreeHex(): string { ensureGameCancellationCompiled(); return _gameCancellation.ergoTree!.toHex(); }

// --- Participation Submitted ---
export const getGopParticipationSubmittedTemplateHash = () => getTemplateHash(_participationSubmitted, ensureParticipationSubmittedCompiled);
export const getGopParticipationSubmittedScriptHash = () => getScriptHash(_participationSubmitted, ensureParticipationSubmittedCompiled);
export function getGopParticipationSubmittedAddress(): Address { ensureParticipationSubmittedCompiled(); return _participationSubmitted.ergoTree!.toAddress(networkType); }
export function getGopParticipationSubmittedErgoTreeHex(): string { ensureParticipationSubmittedCompiled(); return _participationSubmitted.ergoTree!.toHex(); }

// --- Participation Resolved ---
export const getGopParticipationResolvedTemplateHash = () => getTemplateHash(_participationResolved, ensureParticipationResolvedCompiled);
export const getGopParticipationResolvedScriptHash = () => getScriptHash(_participationResolved, ensureParticipationResolvedCompiled);
export function getGopParticipationResolvedAddress(): Address { ensureParticipationResolvedCompiled(); return _participationResolved.ergoTree!.toAddress(networkType); }
export function getGopParticipationResolvedErgoTreeHex(): string { ensureParticipationResolvedCompiled(); return _participationResolved.ergoTree!.toHex(); }