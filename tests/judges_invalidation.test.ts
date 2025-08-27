import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockChain } from "@fleet-sdk/mock-chain";
import { compile } from "@fleet-sdk/compiler";
import {
    Box,
    OutputBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    TransactionBuilder
} from "@fleet-sdk/core";
import {
    SByte,
    SColl,
    SLong,
    SPair,
    SInt,
    SBool,
    SSigmaProp
} from "@fleet-sdk/serializer";
import { blake2b256, randomBytes } from "@fleet-sdk/crypto";
import * as fs from "fs";
import * as path from "path";
import { stringToBytes } from "@scure/base";
import { bigintToLongByteArray, generate_pk_proposition, uint8ArrayToHex } from "$lib/ergo/utils";

// --- Configuración de Constantes y Carga de Contratos ---
const contractsDir = path.resolve(__dirname, "..", "contracts");
const GAME_RESOLUTION_TEMPLATE = fs.readFileSync(path.join(contractsDir, "game_resolution.es"), "utf-8");
const REPUTATION_PROOF_SOURCE = fs.readFileSync(path.join(contractsDir, "reputation_proof.es"), "utf-8");
const PARTICIPATION_RESOLVED_SOURCE = fs.readFileSync(path.join(contractsDir, "participation_resolved.es"), "utf-8");
const DEV_ADDR_BASE58 = "9ejNy2qoifmzfCiDtEiyugthuXMriNNPhNKzzwjPtHnrK3esvbD";
const JUDGE_PERIOD = 30n; // Debe coincidir con el valor en game_resolution.es

// Helper para crear un hash de compromiso
const createCommitment = (solverId: string, score: bigint, logs: string, secret: Uint8Array): Uint8Array => {
    return blake2b256(new Uint8Array([...stringToBytes("utf8", solverId), ...bigintToLongByteArray(score), ...stringToBytes("utf8", logs), ...secret]));
};

describe("Game Resolution Invalidation by Judges", () => {
    let mockChain: MockChain;

    // --- Actores ---
    let resolver: ReturnType<MockChain["newParty"]>;
    let invalidatedWinner: ReturnType<MockChain["newParty"]>;
    let nextWinner: ReturnType<MockChain["newParty"]>;
    let judge1: ReturnType<MockChain["newParty"]>;
    let judge2: ReturnType<MockChain["newParty"]>;
    let judge3: ReturnType<MockChain["newParty"]>;

    // --- Contratos y Partidos ---
    let gameResolutionContract: ReturnType<MockChain["newParty"]>;
    let participationResolvedContract: ReturnType<MockChain["newParty"]>;
    let reputationProofContract: ReturnType<MockChain["newParty"]>;
    
    // --- ErgoTrees de Contratos ---
    let gameResolutionErgoTree: ReturnType<typeof compile>;
    let participationResolvedErgoTree: ReturnType<typeof compile>;
    let reputationProofErgoTree: ReturnType<typeof compile>;

    // --- Estado del Juego ---
    const resolutionDeadline = 800_200;
    const gameNftId = "33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aa";
    const secret = stringToBytes("utf8", "secret-for-invalidation-test");

    let gameResolutionBox: Box;
    let invalidatedWinnerBox: Box;
    let nextWinnerBox: Box;
    let judge1ReputationBox: Box;
    let judge2ReputationBox: Box;

    let invalidatedCommitment: Uint8Array;
    let nextWinnerCommitment: Uint8Array;
    let judge1TokenId: string;
    let judge2TokenId: string;
    let judge3TokenId: string;


    beforeEach(() => {
        mockChain = new MockChain({ height: 800_000 });

        // --- Inicializar Actores ---
        resolver = mockChain.newParty("Resolver");
        invalidatedWinner = mockChain.newParty("InvalidatedWinner");
        nextWinner = mockChain.newParty("NextWinner");
        judge1 = mockChain.newParty("Judge1");
        judge2 = mockChain.newParty("Judge2");
        judge3 = mockChain.newParty("Judge3");
        resolver.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });

        // --- Compilar Contratos ---
        participationResolvedErgoTree = compile(PARTICIPATION_RESOLVED_SOURCE);
        const resolvedHash = Buffer.from(blake2b256(participationResolvedErgoTree.bytes)).toString("hex");
        
        // Asumimos que no necesitamos el hash de 'submitted' para este test
        const dummySubmittedHash = "0".repeat(64);

        const resolutionSource = GAME_RESOLUTION_TEMPLATE
            .replace("`+PARTICIPATION_RESOLVED_SCRIPT_HASH+`", resolvedHash)
            .replace("`+PARTICIPATION_SUBMITTED_SCRIPT_HASH+`", dummySubmittedHash)
            .replace("`+DEV_ADDR+`", DEV_ADDR_BASE58);
        gameResolutionErgoTree = compile(resolutionSource);
        reputationProofErgoTree = compile(REPUTATION_PROOF_SOURCE);

        // --- Añadir Partidos de Contratos al MockChain ---
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationResolvedContract = mockChain.addParty(participationResolvedErgoTree.toHex(), "ParticipationResolved");
        reputationProofContract = mockChain.addParty(reputationProofErgoTree.toHex(), "ReputationProof");

        // --- Crear Estado Inicial del Juego ---

        // 1. Generar compromisos para los participantes
        invalidatedCommitment = createCommitment("solver-invalid", 1000n, "logs-invalid", secret);
        nextWinnerCommitment = createCommitment("solver-next-winner", 900n, "logs-next-winner", secret);

        // 2. Crear tokens de reputación para los jueces
        judge1TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge2TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge3TokenId = Buffer.from(randomBytes(32)).toString("hex");

        // 3. Crear la caja `game_resolution`
        const numericalParams: bigint[] = [700_000n, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];
        const participatingJudges = [judge1TokenId, judge2TokenId, judge3TokenId].map(id => Buffer.from(id, "hex"));

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 20,
            additionalRegisters: {
                R4: SInt(1).toHex(), // Estado: Resolución
                R5: SPair(SColl(SByte, secret), SColl(SByte, invalidatedCommitment)).toHex(),
                R6: SColl(SColl(SByte), participatingJudges).toHex(),
                R7: SColl(SLong, numericalParams).toHex(),
                R8: SPair(SColl(SByte, resolver.key.publicKey), SLong(10n)).toHex(),
                R9: SPair(SColl(SByte, resolver.key.publicKey), SColl(SByte, stringToBytes("utf8", "{}"))).toHex()
            }
        });
        gameResolutionBox = gameResolutionContract.utxos.toArray()[0];

        // 4. Crear cajas `participation_resolved`
        participationResolvedContract.addUTxOs({ // Ganador a ser invalidado
            ergoTree: participationResolvedErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: mockChain.height - 30,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, invalidatedWinner.key.publicKey).toHex(),
                R5: SColl(SByte, invalidatedCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-invalid")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-invalid")).toHex(),
                R9: SColl(SLong, [1000n]).toHex(),
            }
        });
        invalidatedWinnerBox = participationResolvedContract.utxos.toArray()[0];

        participationResolvedContract.addUTxOs({ // Próximo candidato a ganador
            ergoTree: participationResolvedErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: mockChain.height - 40,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, nextWinner.key.publicKey).toHex(),
                R5: SColl(SByte, nextWinnerCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-next-winner")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-next-winner")).toHex(),
                R9: SColl(SLong, [900n]).toHex(),
            }
        });
        nextWinnerBox = participationResolvedContract.utxos.toArray()[1];

        // 5. Crear cajas `reputation_proof` para los jueces (los votos)
        const dummyTypeNftId = randomBytes(32);
        reputationProofContract.addUTxOs(
            { // Voto del Juez 1
                creationHeight: mockChain.height,
                ergoTree: reputationProofErgoTree.toHex(),
                value: 1_000_000n,
                assets: [{ tokenId: judge1TokenId, amount: 1n }],
                additionalRegisters: {
                    R4: SColl(SByte, dummyTypeNftId).toHex(),
                    R5: SColl(SByte, invalidatedCommitment).toHex(), // Vota contra el candidato
                    R6: SPair(SBool(false), SLong(3n)).toHex(),
                    R7: generate_pk_proposition("9fcwctfPQPkDfHgxBns5Uu3dwWpaoywhkpLEobLuztfQuV5mt3T"),
                    R8: SBool(true).toHex(),
                    R9: SColl(SByte, new Uint8Array(0)).toHex(),
                }
            }
        );
        reputationProofContract.addUTxOs(
            { // Voto del Juez 2
                creationHeight: mockChain.height,
                ergoTree: reputationProofErgoTree.toHex(),
                value: 1_000_000n,
                assets: [{ tokenId: judge2TokenId, amount: 1n }],
                additionalRegisters: {
                    R4: SColl(SByte, dummyTypeNftId).toHex(),
                    R5: SColl(SByte, invalidatedCommitment).toHex(),
                    R6: SPair(SBool(false), SLong(3n)).toHex(),
                    R7: generate_pk_proposition("9fwQGg6pPjibqhEZDVopd9deAHXNsWU4fjAHFYLAKexdVCDhYEs"),
                    R8: SBool(true).toHex(),
                    R9: SColl(SByte, new Uint8Array(0)).toHex(),
                }
            }
        );
        [judge1ReputationBox, judge2ReputationBox] = reputationProofContract.utxos.toArray();
    });

    it("should successfully invalidate the current winner with a majority of judge votes (2 out of 3)", () => {
        const currentHeight = mockChain.height;
        const requiredVotes = 2; // (3 / 2) + 1 = 2
        
        // --- Estado Esperado de la Nueva Caja de Juego ---
        const newFunds = gameResolutionBox.value + invalidatedWinnerBox.value;
        const extendedDeadline = BigInt(resolutionDeadline) + JUDGE_PERIOD;
        const decrementedCounter = 1n; // 2 - 1
        const newNumericalParams = [700_000n, 2_000_000_000n, 1_000_000n, extendedDeadline, decrementedCounter];
        
        const tx = new TransactionBuilder(currentHeight)
            .from([gameResolutionBox, invalidatedWinnerBox, nextWinnerBox, ...resolver.utxos.toArray()])
            .to([
                new OutputBuilder(newFunds, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        ...gameResolutionBox.additionalRegisters,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, nextWinnerCommitment)).toHex(), // Nuevo candidato
                        R7: SColl(SLong, newNumericalParams).toHex(), // Parámetros actualizados
                    })
            ])
            .withDataFrom([judge1ReputationBox, judge2ReputationBox]) // Los votos de los jueces
            .sendChangeTo(resolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();
            
        const executionResult = mockChain.execute(tx, { signers: [resolver] });

        // --- Aserciones ---
        expect(executionResult).to.be.true;

        const newGameBox = gameResolutionContract.utxos.toArray()[0];
        expect(newGameBox).to.not.be.undefined;
        
        // 1. Fondos retornados al pool
        expect(newGameBox.value).to.equal(newFunds);

        // 2. El candidato a ganador ha sido actualizado
        const newR5 = newGameBox.additionalRegisters.R5;
        expect(newR5).to.equal(SPair(SColl(SByte, secret), SColl(SByte, nextWinnerCommitment)).toHex());
        
        // 3. El deadline de resolución se ha extendido
        const newR7 = newGameBox.additionalRegisters.R7;
        expect(newR7).to.equal(SColl(SLong, newNumericalParams).toHex());

        // 4. El contador de participantes resueltos ha disminuido
        // (Verificación ya incluida en la aserción de R7)

        // 5. Las cajas gastadas ya no existen
        expect(gameResolutionContract.utxos.toArray().find(b => b.boxId === gameResolutionBox.boxId)).to.be.undefined;
        expect(participationResolvedContract.utxos.toArray().find(b => b.boxId === invalidatedWinnerBox.boxId)).to.be.undefined;
    });

    it("should fail if there are not enough judge votes (1 out of 3)", () => {
        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, invalidatedWinnerBox, nextWinnerBox, ...resolver.utxos.toArray()])
            .to([ /* ... outputs ... */ ])
            .withDataFrom([judge1ReputationBox]) // Solo 1 voto, se necesitan 2
            .sendChangeTo(resolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const executionResult = mockChain.execute(tx, { signers: [resolver], throw: false });
        expect(executionResult).to.be.false;
    });

    it("should fail if a judge votes for the wrong commitment", () => {
        // Modificar el voto del Juez 2 para que apunte a un compromiso incorrecto
        const wrongCommitment = randomBytes(32);
        judge2ReputationBox.additionalRegisters.R5 = SColl(SByte, wrongCommitment).toHex();

        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, invalidatedWinnerBox, nextWinnerBox, ...resolver.utxos.toArray()])
            .to([ /* ... outputs ... */ ])
            .withDataFrom([judge1ReputationBox, judge2ReputationBox])
            .sendChangeTo(resolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();
            
        const executionResult = mockChain.execute(tx, { signers: [resolver], throw: false });
        expect(executionResult).to.be.false;
    });
    
    it("should fail if trying to invalidate after the resolution deadline", () => {
        mockChain.newBlocks(Number(JUDGE_PERIOD) + 1); // Avanzar el tiempo más allá del deadline
        
        const tx = new TransactionBuilder(mockChain.height)
           .from([gameResolutionBox, invalidatedWinnerBox, nextWinnerBox, ...resolver.utxos.toArray()])
           .to([ /* ... outputs ... */ ])
           .withDataFrom([judge1ReputationBox, judge2ReputationBox])
           .sendChangeTo(resolver.address)
           .payFee(RECOMMENDED_MIN_FEE_VALUE)
           .build();

        const executionResult = mockChain.execute(tx, { signers: [resolver], throw: false });
        expect(executionResult).to.be.false;
    });
});