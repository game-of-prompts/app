// src/lib/ergo/contract.ts

import { compile, type ErgoTree } from "@fleet-sdk/compiler";
import { Network, type ErgoAddress as Address } from "@fleet-sdk/core";
import { blake2b256, sha256 } from "@fleet-sdk/crypto";
import { uint8ArrayToHex } from "./utils";
import { isDevMode } from "./envs";

// --- Fuentes de los contratos actuales (v2) ---
import GAME_ACTIVE_SOURCE from '../../../contracts/game_active.es?raw';
import GAME_RESOLUTION_SOURCE from '../../../contracts/game_resolution.es?raw';
import JUDGES_PAID_SOURCE from '../../../contracts/judges_paid.es?raw';
import GAME_CANCELLATION_SOURCE from '../../../contracts/game_cancellation.es?raw';
import PARTICIPATION_SOURCE from '../../../contracts/participation.es?raw';
import PARTICIPATION_BATCH_SOURCE from '../../../contracts/participation_batch.es?raw';
import END_GAME_SOURCE from '../../../contracts/end_game.es?raw';
import MINT_IDT_SOURCE from '../../../contracts/mint_idt.es?raw';
// --- Fuentes de los contratos v1 (tag `v1`): solo se usan para leer juegos antiguos ---
import GAME_ACTIVE_SOURCE_V1 from '../../../contracts/v1/game_active.es?raw';
import GAME_RESOLUTION_SOURCE_V1 from '../../../contracts/v1/game_resolution.es?raw';
import JUDGES_PAID_SOURCE_V1 from '../../../contracts/v1/judges_paid.es?raw';
import GAME_CANCELLATION_SOURCE_V1 from '../../../contracts/v1/game_cancellation.es?raw';
import PARTICIPATION_SOURCE_V1 from '../../../contracts/v1/participation.es?raw';
import PARTICIPATION_BATCH_SOURCE_V1 from '../../../contracts/v1/participation_batch.es?raw';
import END_GAME_SOURCE_V1 from '../../../contracts/v1/end_game.es?raw';
import MINT_IDT_SOURCE_V1 from '../../../contracts/v1/mint_idt.es?raw';
import FALSE_SOURCE from '../../../contracts/false.es?raw';
import { reputation_proof_contract as REPUTATION_PROOF_SOURCE } from "reputation-system";
import { digital_public_good as DIGITAL_PUBLIC_GOOD_SCRIPT } from "reputation-system";

import { CONTRACT_VERSIONS, CURRENT_CONTRACT_VERSION, getGameConstants, type ContractVersion } from "$lib/common/constants";

const networkType: Network = Network.Mainnet;
const ergoTreeVersion = 1;

export type ContractName =
    | 'gameActive'
    | 'gameResolution'
    | 'endGame'
    | 'gameCancellation'
    | 'participation'
    | 'participationBatch'
    | 'judgesPaid'
    | 'mintIdt';

const SOURCES: Record<ContractVersion, Record<ContractName, string>> = {
    v1: {
        gameActive: GAME_ACTIVE_SOURCE_V1,
        gameResolution: GAME_RESOLUTION_SOURCE_V1,
        endGame: END_GAME_SOURCE_V1,
        gameCancellation: GAME_CANCELLATION_SOURCE_V1,
        participation: PARTICIPATION_SOURCE_V1,
        participationBatch: PARTICIPATION_BATCH_SOURCE_V1,
        judgesPaid: JUDGES_PAID_SOURCE_V1,
        mintIdt: MINT_IDT_SOURCE_V1,
    },
    v2: {
        gameActive: GAME_ACTIVE_SOURCE,
        gameResolution: GAME_RESOLUTION_SOURCE,
        endGame: END_GAME_SOURCE,
        gameCancellation: GAME_CANCELLATION_SOURCE,
        participation: PARTICIPATION_SOURCE,
        participationBatch: PARTICIPATION_BATCH_SOURCE,
        judgesPaid: JUDGES_PAID_SOURCE,
        mintIdt: MINT_IDT_SOURCE,
    },
};

type Compiled = { ergoTree?: ErgoTree, templateHash?: string, scriptHash?: string };

// --- Caché de compilación, por versión de contratos ---
const emptyCache = (): Record<ContractVersion, Partial<Record<ContractName, Compiled>>> => ({ v1: {}, v2: {} });
let _compiled = emptyCache();
let _false: Compiled = {};

// Subscribe to mode changes to invalidate cache
isDevMode.subscribe(() => {
    _compiled = emptyCache();
    _false = {};
});

// =============================================================================
// === LÓGICA DE COMPILACIÓN CON INYECCIÓN DE DEPENDENCIAS
// =============================================================================

// Sustituye cada `+NOMBRE+` del fuente por su valor. Falla si queda alguno sin resolver.
// Los valores se calculan solo si el fuente usa ese marcador: las dependencias entre contratos cambian
// entre versiones (p. ej. participation -> participation_batch en v2, al revés en v1).
function inject(source: string, values: Record<string, () => string | number>): string {
    let result = source;
    for (const [key, value] of Object.entries(values)) {
        const placeholder = new RegExp('`\\+' + key + '\\+`', 'g');
        if (placeholder.test(result)) result = result.replace(placeholder, value().toString());
    }
    const missing = result.match(/`\+\w+\+`/);
    if (missing) throw new Error(`Unresolved placeholder ${missing[0]} in contract source.`);
    return result;
}

// Nota: las dependencias entre scripts se resuelven siempre dentro de la misma versión.
function compileContract(version: ContractVersion, name: ContractName): ErgoTree {
    const constants = getGameConstants(version);
    const source = SOURCES[version][name];
    const scriptHash = (dependency: ContractName) => getContractScriptHash(dependency, version);

    switch (name) {
        case 'participation':
            return compile(inject(source, {
                GRACE_PERIOD: () => constants.PARTICIPATION_GRACE_PERIOD,
                PARTICIPATION_BATCH_SCRIPT_HASH: () => scriptHash('participationBatch'),   // v2+
            }), { version: ergoTreeVersion });

        case 'participationBatch':
            return compile(inject(source, {
                PARTICIPATION_SCRIPT_HASH: () => scriptHash('participation'),   // v1 only
            }), { version: ergoTreeVersion });

        case 'judgesPaid':
            return compile(inject(source, {
                REPUTATION_PROOF_SCRIPT_HASH: () => getReputationProofScriptHash(),
            }), { version: ergoTreeVersion });

        case 'endGame':
            return compile(inject(source, {
                END_GAME_AUTH_GRACE_PERIOD: () => constants.END_GAME_AUTH_GRACE_PERIOD,
                COMMISSION_DENOMINATOR: () => constants.COMMISSION_DENOMINATOR,
                JUDGES_PAID_ERGOTREE: () => getContractErgoTreeHex('judgesPaid', version),
                MAX_SCORE_LIST: () => constants.MAX_SCORE_LIST,
                PARTICIPATION_SCRIPT_HASH: () => scriptHash('participation'),
                PARTICIPATION_BATCH_SCRIPT_HASH: () => scriptHash('participationBatch'),
            }), { version: ergoTreeVersion });

        case 'gameCancellation':
            return compile(inject(source, {
                COOLDOWN_IN_BLOCKS: () => constants.COOLDOWN_IN_BLOCKS,
            }), { version: ergoTreeVersion });

        case 'gameResolution':
            return compile(inject(source, {
                PARTICIPATION_SCRIPT_HASH: () => scriptHash('participation'),
                PARTICIPATION_BATCH_SCRIPT_HASH: () => scriptHash('participationBatch'),
                END_GAME_SCRIPT_HASH: () => scriptHash('endGame'),
                JUDGE_PERIOD: () => constants.JUDGE_PERIOD,
                END_GAME_AUTH_GRACE_PERIOD: () => constants.END_GAME_AUTH_GRACE_PERIOD,
                RESOLVER_OMISSION_NO_PENALTY_PERIOD: () => constants.RESOLVER_OMISSION_NO_PENALTY_PERIOD,
                REPUTATION_PROOF_SCRIPT_HASH: () => getReputationProofScriptHash(),
                PARTICIPATION_TYPE_ID: () => constants.PARTICIPATION_TYPE_ID,
                PARTICIPATION_UNAVAILABLE_TYPE_ID: () => constants.PARTICIPATION_UNAVAILABLE_TYPE_ID,
                MAX_SCORE_LIST: () => constants.MAX_SCORE_LIST,
                PARTICIPATION_TIME_WINDOW: () => constants.PARTICIPATION_TIME_WINDOW,
                SEED_MARGIN: () => constants.SEED_MARGIN,
                MIN_TIME_WEIGHT_MARGIN: () => constants.MIN_TIME_WEIGHT_MARGIN,
                COMMISSION_DENOMINATOR: () => constants.COMMISSION_DENOMINATOR,
                FALSE_SCRIPT_HASH: () => getGopFalseScriptHash(),
                JUDGES_PAID_ERGOTREE: () => getContractErgoTreeHex('judgesPaid', version),
            }), { version: ergoTreeVersion });

        case 'gameActive':
            return compile(inject(source, {
                GAME_RESOLUTION_SCRIPT_HASH: () => scriptHash('gameResolution'),
                GAME_CANCELLATION_SCRIPT_HASH: () => scriptHash('gameCancellation'),
                REPUTATION_PROOF_SCRIPT_HASH: () => getReputationProofScriptHash(),
                PARTICIPATION_SCRIPT_HASH: () => scriptHash('participation'),
                ACCEPT_GAME_INVITATION_TYPE_ID: () => constants.ACCEPT_GAME_INVITATION_TYPE_ID,
                STAKE_DENOMINATOR: () => constants.STAKE_DENOMINATOR,
                COOLDOWN_IN_BLOCKS: () => constants.COOLDOWN_IN_BLOCKS,
                JUDGE_PERIOD: () => constants.JUDGE_PERIOD,
                MAX_SCORE_LIST: () => constants.MAX_SCORE_LIST,
                PARTICIPATION_TIME_WINDOW: () => constants.PARTICIPATION_TIME_WINDOW,
                FALSE_SCRIPT_HASH: () => getGopFalseScriptHash(),
                SEED_MARGIN: () => constants.SEED_MARGIN,
                GRACE_PERIOD: () => constants.PARTICIPATION_GRACE_PERIOD,
            }), { version: ergoTreeVersion });

        case 'mintIdt':
            return compile(inject(source, {
                contract_bytes_hash: () => scriptHash('gameActive'),
            }), { version: ergoTreeVersion });
    }
}

function compiled(name: ContractName, version: ContractVersion): Compiled & { ergoTree: ErgoTree } {
    const cache = _compiled[version];
    if (!cache[name]?.ergoTree) cache[name] = { ergoTree: compileContract(version, name) };
    return cache[name] as Compiled & { ergoTree: ErgoTree };
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

// --- Acceso por versión ---
export function getContractErgoTree(name: ContractName, version: ContractVersion = CURRENT_CONTRACT_VERSION): ErgoTree {
    return compiled(name, version).ergoTree;
}
export function getContractErgoTreeHex(name: ContractName, version: ContractVersion = CURRENT_CONTRACT_VERSION): string {
    return getContractErgoTree(name, version).toHex();
}
export function getContractTemplateHash(name: ContractName, version: ContractVersion = CURRENT_CONTRACT_VERSION): string {
    return getTemplateHash(compiled(name, version), () => { });
}
export function getContractScriptHash(name: ContractName, version: ContractVersion = CURRENT_CONTRACT_VERSION): string {
    return getScriptHash(compiled(name, version), () => { });
}
export function getContractAddress(name: ContractName, version: ContractVersion = CURRENT_CONTRACT_VERSION): Address {
    return getContractErgoTree(name, version).toAddress(networkType);
}

// Template hashes of a contract across every supported version, without duplicates (to query the explorer).
export function getContractTemplateHashes(name: ContractName): string[] {
    return [...new Set(CONTRACT_VERSIONS.map((version) => getContractTemplateHash(name, version)))];
}

// The contract version whose `name` contract compiles to exactly this ErgoTree, or null if none does.
export function findContractVersion(name: ContractName, ergoTreeHex: string): ContractVersion | null {
    return CONTRACT_VERSIONS.find((version) => getContractErgoTreeHex(name, version) === ergoTreeHex) ?? null;
}

// --- Contratos de la versión actual (usados para crear juegos y construir transacciones) ---
const current = (name: ContractName) => ({
    templateHash: () => getContractTemplateHash(name),
    scriptHash: () => getContractScriptHash(name),
    address: () => getContractAddress(name),
    ergoTreeHex: () => getContractErgoTreeHex(name),
    ergoTree: () => getContractErgoTree(name),
});

const gameActive = current('gameActive');
export const getGopGameActiveTemplateHash = gameActive.templateHash;
export const getGopGameActiveScriptHash = gameActive.scriptHash;
export const getGopGameActiveAddress = gameActive.address;
export const getGopGameActiveErgoTreeHex = gameActive.ergoTreeHex;
export const getGopGameActiveErgoTree = gameActive.ergoTree;

const gameResolution = current('gameResolution');
export const getGopGameResolutionTemplateHash = gameResolution.templateHash;
export const getGopGameResolutionScriptHash = gameResolution.scriptHash;
export const getGopGameResolutionAddress = gameResolution.address;
export const getGopGameResolutionErgoTreeHex = gameResolution.ergoTreeHex;
export const getGopGameResolutionErgoTree = gameResolution.ergoTree;

const judgesPaid = current('judgesPaid');
export const getGopJudgesPaidTemplateHash = judgesPaid.templateHash;
export const getGopJudgesPaidScriptHash = judgesPaid.scriptHash;
export const getGopJudgesPaidAddress = judgesPaid.address;
export const getGopJudgesPaidErgoTreeHex = judgesPaid.ergoTreeHex;
export const getGopJudgesPaidErgoTree = judgesPaid.ergoTree;

const gameCancellation = current('gameCancellation');
export const getGopGameCancellationTemplateHash = gameCancellation.templateHash;
export const getGopGameCancellationScriptHash = gameCancellation.scriptHash;
export const getGopGameCancellationAddress = gameCancellation.address;
export const getGopGameCancellationErgoTreeHex = gameCancellation.ergoTreeHex;
export const getGopGameCancellationErgoTree = gameCancellation.ergoTree;

const participation = current('participation');
export const getGopParticipationTemplateHash = participation.templateHash;
export const getGopParticipationScriptHash = participation.scriptHash;
export const getGopParticipationAddress = participation.address;
export const getGopParticipationErgoTreeHex = participation.ergoTreeHex;
export const getGopParticipationErgoTree = participation.ergoTree;

const participationBatch = current('participationBatch');
export const getGopParticipationBatchTemplateHash = participationBatch.templateHash;
export const getGopParticipationBatchScriptHash = participationBatch.scriptHash;
export const getGopParticipationBatchAddress = participationBatch.address;
export const getGopParticipationBatchErgoTreeHex = participationBatch.ergoTreeHex;
export const getGopParticipationBatchErgoTree = participationBatch.ergoTree;

const endGame = current('endGame');
export const getGopEndGameTemplateHash = endGame.templateHash;
export const getGopEndGameScriptHash = endGame.scriptHash;
export const getGopEndGameAddress = endGame.address;
export const getGopEndGameErgoTreeHex = endGame.ergoTreeHex;
export const getGopEndGameErgoTree = endGame.ergoTree;

const mintIdt = current('mintIdt');
export const getGopMintIdtTemplateHash = mintIdt.templateHash;
export const getGopMintIdtScriptHash = mintIdt.scriptHash;
export const getGopMintIdtAddress = mintIdt.address;
export const getGopMintIdtErgoTreeHex = mintIdt.ergoTreeHex;
export const getGopMintIdtErgoTree = mintIdt.ergoTree;

// --- False Script (común a todas las versiones) ---
function ensureFalseCompiled(): void {
    if (_false.ergoTree) return;
    _false.ergoTree = compile(FALSE_SOURCE, { version: ergoTreeVersion });
}
export const getGopFalseTemplateHash = () => getTemplateHash(_false, ensureFalseCompiled);
export const getGopFalseScriptHash = () => getScriptHash(_false, ensureFalseCompiled);
export function getGopFalseAddress(): Address { ensureFalseCompiled(); return _false.ergoTree!.toAddress(networkType); }
export function getGopFalseErgoTreeHex(): string { ensureFalseCompiled(); return _false.ergoTree!.toHex(); }
export function getGopFalseErgoTree(): ErgoTree { ensureFalseCompiled(); return _false.ergoTree!; }


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
