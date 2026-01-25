// src/lib/ergo/contract.ts

import { compile, type ErgoTree } from "@fleet-sdk/compiler";
import { Network, type ErgoAddress as Address } from "@fleet-sdk/core";
import { blake2b256, sha256 } from "@fleet-sdk/crypto";
import { uint8ArrayToHex } from "./utils";
import { isDevMode } from "./envs";

// --- Importación de todos los fuentes de los contratos ---
import GAME_ACTIVE_SOURCE from '../../../contracts/game_active.es?raw';
import GAME_RESOLUTION_SOURCE from '../../../contracts/game_resolution.es?raw';
import JUDGES_PAID_SOURCE from '../../../contracts/judges_paid.es?raw';
import GAME_CANCELLATION_SOURCE from '../../../contracts/game_cancellation.es?raw';
import PARTICIPATION_SOURCE from '../../../contracts/participation.es?raw';
import PARTICIPATION_BATCH_SOURCE from '../../../contracts/participation_batch.es?raw';
import END_GAME_SOURCE from '../../../contracts/end_game.es?raw';
import MINT_IDT_SOURCE from '../../../contracts/mint_idt.es?raw';
import { reputation_proof_contract as REPUTATION_PROOF_SOURCE } from "reputation-system";
import { digital_public_good as DIGITAL_PUBLIC_GOOD_SCRIPT } from "reputation-system";

import { getGameConstants } from "$lib/common/constants";

const networkType: Network = Network.Mainnet;
const ergoTreeVersion = 1;

// --- Variables para almacenar en caché los resultados de la compilación ---
let _gameActive: { ergoTree?: ErgoTree, templateHash?: string } = {};
let _gameResolution: { ergoTree?: ErgoTree, templateHash?: string, scriptHash?: string } = {};
let _judgesPaid: { ergoTree?: ErgoTree, templateHash?: string, scriptHash?: string } = {};
let _gameCancellation: { ergoTree?: ErgoTree, templateHash?: string, scriptHash?: string } = {};
let _participation: { ergoTree?: ErgoTree, templateHash?: string, scriptHash?: string } = {};
let _participationBatch: { ergoTree?: ErgoTree, templateHash?: string, scriptHash?: string } = {};
let _endGame: { ergoTree?: ErgoTree, templateHash?: string, scriptHash?: string } = {};
let _mintIdt: { ergoTree?: ErgoTree, templateHash?: string, scriptHash?: string } = {};

// Subscribe to mode changes to invalidate cache
isDevMode.subscribe(() => {
    _gameActive = {};
    _gameResolution = {};
    _judgesPaid = {};
    _gameCancellation = {};
    _participation = {};
    _participationBatch = {};
    _endGame = {};
    _mintIdt = {};
});

// =============================================================================
// === LÓGICA DE COMPILACIÓN CON INYECCIÓN DE DEPENDENCIAS
// =============================================================================

// Nota: El orden de compilación es importante debido a las dependencias entre scripts.

function ensureParticipationBatchCompiled(): void {
    if (_participationBatch.ergoTree) return;
    ensureParticipationCompiled();

    const participationHash = getGopParticipationScriptHash();
    const finalBatchSource = PARTICIPATION_BATCH_SOURCE
        .replace(/`\+PARTICIPATION_SCRIPT_HASH\+`/g, participationHash);

    _participationBatch.ergoTree = compile(finalBatchSource, { version: ergoTreeVersion });
}

function ensureEndGameCompiled(): void {
    if (_endGame.ergoTree) return;
    ensureParticipationCompiled();
    ensureParticipationBatchCompiled();
    ensureJudgesPaidCompiled();

    const participationHash = getGopParticipationScriptHash();
    const participationBatchHash = getGopParticipationBatchScriptHash();
    const judgesPaidErgoTree = getGopJudgesPaidErgoTreeHex();
    const constants = getGameConstants();

    let source = END_GAME_SOURCE
        .replace(/`\+END_GAME_AUTH_GRACE_PERIOD\+`/g, constants.END_GAME_AUTH_GRACE_PERIOD.toString())
        .replace(/`\+DEV_SCRIPT\+`/g, constants.DEV_SCRIPT)
        .replace(/`\+DEV_COMMISSION_PERCENTAGE\+`/g, (constants.DEV_COMMISSION_PERCENTAGE / 100 * constants.COMMISSION_DENOMINATOR).toString())
        .replace(/`\+JUDGES_PAID_ERGOTREE\+`/g, judgesPaidErgoTree)
        .replace(/`\+MAX_SCORE_LIST\+`/g, constants.MAX_SCORE_LIST.toString())
        .replace(/`\+PARTICIPATION_SCRIPT_HASH\+`/g, participationHash)
        .replace(/`\+PARTICIPATION_BATCH_SCRIPT_HASH\+`/g, participationBatchHash);

    _endGame.ergoTree = compile(source, { version: ergoTreeVersion });
}

function ensureParticipationCompiled(): void {
    if (_participation.ergoTree) return;
    const constants = getGameConstants();

    const finalSource = PARTICIPATION_SOURCE
        .replace(/`\+GRACE_PERIOD_IN_BLOCKS\+`/g, constants.PARTICIPATION_GRACE_PERIOD_IN_BLOCKS.toString());

    _participation.ergoTree = compile(finalSource, { version: ergoTreeVersion });
}

function ensureGameCancellationCompiled(): void {
    if (_gameCancellation.ergoTree) return;
    const constants = getGameConstants();

    let source = GAME_CANCELLATION_SOURCE
        .replace(/`\+COOLDOWN_IN_BLOCKS\+`/g, constants.COOLDOWN_IN_BLOCKS.toString())
        .replace(/`\+STAKE_DENOMINATOR\+`/g, constants.STAKE_DENOMINATOR.toString());

    _gameCancellation.ergoTree = compile(source, { version: ergoTreeVersion });
}

function ensureGameResolutionCompiled(): void {
    if (_gameResolution.ergoTree) return;
    ensureParticipationCompiled(); // Dependencia transitiva
    ensureJudgesPaidCompiled(); // Dependencia directa
    const submittedHash = getGopParticipationScriptHash();
    const reputationHash = getReputationProofScriptHash();
    const judgesPaidErgoTree = getGopJudgesPaidErgoTreeHex();
    const batchHash = getGopParticipationBatchScriptHash();
    const endGameHash = getGopEndGameScriptHash();
    const constants = getGameConstants();

    let source = GAME_RESOLUTION_SOURCE
        .replace(/`\+PARTICIPATION_SCRIPT_HASH\+`/g, submittedHash)
        .replace(/`\+PARTICIPATION_BATCH_SCRIPT_HASH\+`/g, batchHash)
        .replace(/`\+END_GAME_SCRIPT_HASH\+`/g, endGameHash)
        .replace(/`\+JUDGE_PERIOD\+`/g, constants.JUDGE_PERIOD.toString())
        .replace(/`\+END_GAME_AUTH_GRACE_PERIOD\+`/g, constants.END_GAME_AUTH_GRACE_PERIOD.toString())
        .replace(/`\+RESOLVER_OMISSION_NO_PENALTY_PERIOD\+`/g, constants.RESOLVER_OMISSION_NO_PENALTY_PERIOD.toString())
        .replace(/`\+DEV_SCRIPT\+`/g, constants.DEV_SCRIPT)
        .replace(/`\+DEV_COMMISSION_PERCENTAGE\+`/g, (constants.DEV_COMMISSION_PERCENTAGE / 100 * constants.COMMISSION_DENOMINATOR).toString())
        .replace(/`\+REPUTATION_PROOF_SCRIPT_HASH\+`/g, reputationHash)
        .replace(/`\+PARTICIPATION_TYPE_ID\+`/g, constants.PARTICIPATION_TYPE_ID)
        .replace(/`\+PARTICIPATION_UNAVAILABLE_TYPE_ID\+`/g, constants.PARTICIPATION_UNAVAILABLE_TYPE_ID)
        .replace(/`\+MAX_SCORE_LIST\+`/g, constants.MAX_SCORE_LIST.toString())
        .replace(/`\+PARTICIPATION_TIME_WINDOW\+`/g, constants.PARTICIPATION_TIME_WINDOW.toString())
        .replace(/`\+SEED_MARGIN\+`/g, constants.SEED_MARGIN.toString())
        .replace(/`\+JUDGES_PAID_ERGOTREE\+`/g, judgesPaidErgoTree);

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
    const reputationHash = getReputationProofScriptHash();
    const constants = getGameConstants();

    let source = GAME_ACTIVE_SOURCE
        // Hashes de scripts
        .replace(/`\+GAME_RESOLUTION_SCRIPT_HASH\+`/g, resolutionHash)
        .replace(/`\+GAME_CANCELLATION_SCRIPT_HASH\+`/g, cancellationHash)
        .replace(/`\+REPUTATION_PROOF_SCRIPT_HASH\+`/g, reputationHash)
        .replace(/`\+PARTICIPATION_SCRIPT_HASH\+`/g, participationHash)
        .replace(/`\+ACCEPT_GAME_INVITATION_TYPE_ID\+`/g, constants.ACCEPT_GAME_INVITATION_TYPE_ID)

        // Constantes numéricas del contrato
        .replace(/`\+STAKE_DENOMINATOR\+`/g, constants.STAKE_DENOMINATOR.toString())
        .replace(/`\+COOLDOWN_IN_BLOCKS\+`/g, constants.COOLDOWN_IN_BLOCKS.toString())
        .replace(/`\+JUDGE_PERIOD\+`/g, constants.JUDGE_PERIOD.toString())
        .replace(/`\+MAX_SCORE_LIST\+`/g, constants.MAX_SCORE_LIST.toString())
        .replace(/`\+PARTICIPATION_TIME_WINDOW\+`/g, constants.PARTICIPATION_TIME_WINDOW.toString())
        .replace(/`\+SEED_MARGIN\+`/g, constants.SEED_MARGIN.toString());

    _gameActive.ergoTree = compile(source, { version: ergoTreeVersion });
}

function ensureJudgesPaidCompiled(): void {
    if (_judgesPaid.ergoTree) return;
    const reputationHash = getReputationProofScriptHash();

    let source = JUDGES_PAID_SOURCE
        .replace(/`\+REPUTATION_PROOF_SCRIPT_HASH\+`/g, reputationHash);

    _judgesPaid.ergoTree = compile(source, { version: ergoTreeVersion });
}

function ensureMintIdtCompiled(): void {
    if (_mintIdt.ergoTree) return;
    ensureGameActiveCompiled();

    const gameActiveHash = getGopGameActiveScriptHash();

    let source = MINT_IDT_SOURCE
        .replace(/`\+contract_bytes_hash\+`/g, gameActiveHash);

    _mintIdt.ergoTree = compile(source, { version: ergoTreeVersion });
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
export const getGopGameActiveScriptHash = () => getScriptHash(_gameActive, ensureGameActiveCompiled);
export function getGopGameActiveAddress(): Address { ensureGameActiveCompiled(); return _gameActive.ergoTree!.toAddress(networkType); }
export function getGopGameActiveErgoTreeHex(): string { ensureGameActiveCompiled(); return _gameActive.ergoTree!.toHex(); }
export function getGopGameActiveErgoTree(): ErgoTree { ensureGameActiveCompiled(); return _gameActive.ergoTree!; }

// --- Game Resolution ---
export const getGopGameResolutionTemplateHash = () => getTemplateHash(_gameResolution, ensureGameResolutionCompiled);
export const getGopGameResolutionScriptHash = () => getScriptHash(_gameResolution, ensureGameResolutionCompiled);
export function getGopGameResolutionAddress(): Address { ensureGameResolutionCompiled(); return _gameResolution.ergoTree!.toAddress(networkType); }
export function getGopGameResolutionErgoTreeHex(): string { ensureGameResolutionCompiled(); return _gameResolution.ergoTree!.toHex(); }
export function getGopGameResolutionErgoTree(): ErgoTree { ensureGameResolutionCompiled(); return _gameResolution.ergoTree!; }

// --- Judges Paid ---
export const getGopJudgesPaidTemplateHash = () => getTemplateHash(_judgesPaid, ensureJudgesPaidCompiled);
export const getGopJudgesPaidScriptHash = () => getScriptHash(_judgesPaid, ensureJudgesPaidCompiled);
export function getGopJudgesPaidAddress(): Address { ensureJudgesPaidCompiled(); return _judgesPaid.ergoTree!.toAddress(networkType); }
export function getGopJudgesPaidErgoTreeHex(): string { ensureJudgesPaidCompiled(); return _judgesPaid.ergoTree!.toHex(); }
export function getGopJudgesPaidErgoTree(): ErgoTree { ensureJudgesPaidCompiled(); return _judgesPaid.ergoTree!; }

// --- Game Cancellation ---
export const getGopGameCancellationTemplateHash = () => getTemplateHash(_gameCancellation, ensureGameCancellationCompiled);
export const getGopGameCancellationScriptHash = () => getScriptHash(_gameCancellation, ensureGameCancellationCompiled);
export function getGopGameCancellationAddress(): Address { ensureGameCancellationCompiled(); return _gameCancellation.ergoTree!.toAddress(networkType); }
export function getGopGameCancellationErgoTreeHex(): string { ensureGameCancellationCompiled(); return _gameCancellation.ergoTree!.toHex(); }
export function getGopGameCancellationErgoTree(): ErgoTree { ensureGameCancellationCompiled(); return _gameCancellation.ergoTree!; }

// --- Participation Submitted ---
export const getGopParticipationTemplateHash = () => getTemplateHash(_participation, ensureParticipationCompiled);
export const getGopParticipationScriptHash = () => getScriptHash(_participation, ensureParticipationCompiled);
export function getGopParticipationAddress(): Address { ensureParticipationCompiled(); return _participation.ergoTree!.toAddress(networkType); }
export function getGopParticipationErgoTreeHex(): string { ensureParticipationCompiled(); return _participation.ergoTree!.toHex(); }
export function getGopParticipationErgoTree(): ErgoTree { ensureParticipationCompiled(); return _participation.ergoTree!; }

// --- Participation Batch ---
export const getGopParticipationBatchTemplateHash = () => getTemplateHash(_participationBatch, ensureParticipationBatchCompiled);
export const getGopParticipationBatchScriptHash = () => getScriptHash(_participationBatch, ensureParticipationBatchCompiled);
export function getGopParticipationBatchAddress(): Address { ensureParticipationBatchCompiled(); return _participationBatch.ergoTree!.toAddress(networkType); }
export function getGopParticipationBatchErgoTreeHex(): string { ensureParticipationBatchCompiled(); return _participationBatch.ergoTree!.toHex(); }
export function getGopParticipationBatchErgoTree(): ErgoTree { ensureParticipationBatchCompiled(); return _participationBatch.ergoTree!; }

// --- End Game ---
export const getGopEndGameTemplateHash = () => getTemplateHash(_endGame, ensureEndGameCompiled);
export const getGopEndGameScriptHash = () => getScriptHash(_endGame, ensureEndGameCompiled);
export function getGopEndGameAddress(): Address { ensureEndGameCompiled(); return _endGame.ergoTree!.toAddress(networkType); }
export function getGopEndGameErgoTreeHex(): string { ensureEndGameCompiled(); return _endGame.ergoTree!.toHex(); }
export function getGopEndGameErgoTree(): ErgoTree { ensureEndGameCompiled(); return _endGame.ergoTree!; }

// --- Mint IDT ---
export const getGopMintIdtTemplateHash = () => getTemplateHash(_mintIdt, ensureMintIdtCompiled);
export const getGopMintIdtScriptHash = () => getScriptHash(_mintIdt, ensureMintIdtCompiled);
export function getGopMintIdtAddress(): Address { ensureMintIdtCompiled(); return _mintIdt.ergoTree!.toAddress(networkType); }
export function getGopMintIdtErgoTreeHex(): string { ensureMintIdtCompiled(); return _mintIdt.ergoTree!.toHex(); }
export function getGopMintIdtErgoTree(): ErgoTree { ensureMintIdtCompiled(); return _mintIdt.ergoTree!; }

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
export function getReputationProofErgoTree(): ErgoTree { ensureReputationProofCompiled(); return _reputationProof.ergoTree!; }
