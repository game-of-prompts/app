// src/lib/ergo/contract.ts

import { compile, type ErgoTree } from "@fleet-sdk/compiler";
import { Network, type ErgoAddress as Address } from "@fleet-sdk/core";
import { blake2b256, sha256 } from "@fleet-sdk/crypto";
import { uint8ArrayToHex } from "./utils";
import { network_id } from "./envs"; 

// --- Importación de todos los fuentes de los contratos ---
import GAME_ACTIVE_SOURCE from '../../../contracts/game_active.es?raw';
import GAME_RESOLUTION_SOURCE from '../../../contracts/game_resolution.es?raw';
import GAME_CANCELLATION_SOURCE from '../../../contracts/game_cancellation.es?raw';
import PARTICIPATION_SUBMITTED_SOURCE from '../../../contracts/participation.es?raw';
import REPUTATION_PROOF_SOURCE from '../../../contracts/reputation_system/reputation_proof.es?raw';
import DIGITAL_PUBLIC_GOOD_SCRIPT from '../../../contracts/reputation_system/digital_public_good.es?raw';

import { PARTICIPATION } from "./reputation/types";

const networkType: Network = network_id === "mainnet" ? Network.Mainnet : Network.Testnet;
const ergoTreeVersion = 1;

// --- Variables para almacenar en caché los resultados de la compilación ---
let _gameActive: { ergoTree?: ErgoTree, templateHash?: string } = {};
let _gameResolution: { ergoTree?: ErgoTree, templateHash?: string, scriptHash?: string } = {};
let _gameCancellation: { ergoTree?: ErgoTree, templateHash?: string, scriptHash?: string } = {};
let _participation: { ergoTree?: ErgoTree, templateHash?: string, scriptHash?: string } = {};

// --- Dev fee/config ---
export const dev_addr_base58 = "9ejNy2qoifmzfCiDtEiyugthuXMriNNPhNKzzwjPtHnrK3esvbD"
export const dev_fee = 5n;

// =============================================================================
// === LÓGICA DE COMPILACIÓN CON INYECCIÓN DE DEPENDENCIAS
// =============================================================================

// Nota: El orden de compilación es importante debido a las dependencias entre scripts.

function ensureParticipationCompiled(): void {
    if (_participation.ergoTree) return;
    _participation.ergoTree = compile(PARTICIPATION_SUBMITTED_SOURCE, { version: ergoTreeVersion });
}

function ensureGameCancellationCompiled(): void {
    if (_gameCancellation.ergoTree) return;
    _gameCancellation.ergoTree = compile(GAME_CANCELLATION_SOURCE, { version: ergoTreeVersion });
}

function ensureGameResolutionCompiled(): void {
    if (_gameResolution.ergoTree) return;
    ensureParticipationCompiled(); // Dependencia transitiva
    const submittedHash = getGopParticipationScriptHash();
    const reputationHash = getReputationProofScriptHash();
    let source = GAME_RESOLUTION_SOURCE
        .replace(/`\+DEV_ADDR\+`/g, dev_addr_base58)
        .replace(/`\+REPUTATION_PROOF_SCRIPT_HASH\+`/g, reputationHash)
        .replace(/`\+PARTICIPATION_SCRIPT_HASH\+`/g, submittedHash)
        .replace(/`\+PARTICIPATION_TYPE_ID\+`/g, PARTICIPATION);
    _gameResolution.ergoTree = compile(source, { version: ergoTreeVersion });
}

function ensureGameActiveCompiled(): void {
    if (_gameActive.ergoTree) return;
    ensureGameResolutionCompiled();
    ensureGameCancellationCompiled();
    ensureParticipationCompiled();

    const resolutionHash = getGopGameResolutionScriptHash();
    const cancellationHash = getGopGameCancellationScriptHash();
    const participationHash = getGopParticipationScriptHash();
    const resolvedHash = getGopParticipationScriptHash();

    let source = GAME_ACTIVE_SOURCE
        .replace(/`\+GAME_RESOLUTION_SCRIPT_HASH\+`/g, resolutionHash)
        .replace(/`\+GAME_CANCELLATION_SCRIPT_HASH\+`/g, cancellationHash)
        .replace(/`\+PARTICIPATION_SUBMITED_SCRIPT_HASH\+`/g, participationHash)
        .replace(/`\+PARTICIPATION_SCRIPT_HASH\+`/g, resolvedHash);
        
    _gameActive.ergoTree = compile(source, { version: ergoTreeVersion });
}

// =============================================================================
// === FUNCIONES PÚBLICAS PARA OBTENER HASHES, DIRECCIONES Y ERGOTREES
// =============================================================================

// --- Funciones auxiliares genéricas ---
function getTemplateHash(stateObject: { ergoTree?: ErgoTree, templateHash?: string }, ensureCompiled: () => void): string {
    if (!stateObject.templateHash) {
        ensureCompiled();
        const templateBytes = stateObject.ergoTree!.template;
        stateObject.templateHash = uint8ArrayToHex(sha256(templateBytes)); // SHA256 para búsqueda en explorador
    }
    return stateObject.templateHash;
}

function getScriptHash(stateObject: { ergoTree?: ErgoTree, scriptHash?: string }, ensureCompiled: () => void): string {
    if (!stateObject.scriptHash) {
        ensureCompiled();
        const ergoTreeBytes = stateObject.ergoTree!.bytes;
        stateObject.scriptHash = uint8ArrayToHex(blake2b256(ergoTreeBytes)); // BLAKE2B256 para constantes en scripts
    }
    return stateObject.scriptHash;
}

// --- Game Active ---
export const getGopGameActiveTemplateHash = () => getTemplateHash(_gameActive, ensureGameActiveCompiled);
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
export const getGopParticipationTemplateHash = () => getTemplateHash(_participation, ensureParticipationCompiled);
export const getGopParticipationScriptHash = () => getScriptHash(_participation, ensureParticipationCompiled);
export function getGopParticipationAddress(): Address { ensureParticipationCompiled(); return _participation.ergoTree!.toAddress(networkType); }
export function getGopParticipationErgoTreeHex(): string { ensureParticipationCompiled(); return _participation.ergoTree!.toHex(); }

// =============================================================================
// === DIGITAL PUBLIC GOOD & REPUTATION PROOF (alineado con la misma dinámica)
// =============================================================================

// --- Digital Public Good ---
let _digitalPublicGood: { ergoTree?: ErgoTree, templateHash?: string, scriptHash?: string } = {};
function ensureDigitalPublicGoodCompiled(): void {
    if (_digitalPublicGood.ergoTree) return;
    _digitalPublicGood.ergoTree = compile(DIGITAL_PUBLIC_GOOD_SCRIPT, { version: ergoTreeVersion });
}
export const getDigitalPublicGoodTemplateHash = () => getTemplateHash(_digitalPublicGood, ensureDigitalPublicGoodCompiled);
export const getDigitalPublicGoodScriptHash = () => getScriptHash(_digitalPublicGood, ensureDigitalPublicGoodCompiled);
export function getDigitalPublicGoodAddress(): Address { ensureDigitalPublicGoodCompiled(); return _digitalPublicGood.ergoTree!.toAddress(networkType); }
export function getDigitalPublicGoodErgoTreeHex(): string { ensureDigitalPublicGoodCompiled(); return _digitalPublicGood.ergoTree!.toHex(); }

// --- Reputation Proof ---
let _reputationProof: { ergoTree?: ErgoTree, templateHash?: string, scriptHash?: string } = {};
function ensureReputationProofCompiled(): void {
    if (_reputationProof.ergoTree) return;
    // Dependencia: inyectar el hash de script de Digital Public Good
    const dpgScriptHash = getDigitalPublicGoodScriptHash();
    const source = REPUTATION_PROOF_SOURCE.replace(/`\+DIGITAL_PUBLIC_GOOD_SCRIPT_HASH\+`/g, dpgScriptHash);
    _reputationProof.ergoTree = compile(source, { version: ergoTreeVersion });
}
export const getReputationProofTemplateHash = () => getTemplateHash(_reputationProof, ensureReputationProofCompiled);
export const getReputationProofScriptHash = () => getScriptHash(_reputationProof, ensureReputationProofCompiled);
export function getReputationProofAddress(): Address { ensureReputationProofCompiled(); return _reputationProof.ergoTree!.toAddress(networkType); }
export function getReputationProofErgoTreeHex(): string { ensureReputationProofCompiled(); return _reputationProof.ergoTree!.toHex(); }
