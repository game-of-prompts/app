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
    SBool
} from "@fleet-sdk/serializer";
import { blake2b256, randomBytes } from "@fleet-sdk/crypto";
import * as fs from "fs";
import * as path from "path";
import { stringToBytes } from "@scure/base";
import { bigintToLongByteArray, generate_pk_proposition, hexToBytes, uint8ArrayToHex } from "$lib/ergo/utils";
import { PARTICIPATION } from "$lib/ergo/reputation/types";

// --- Configuración de Constantes y Carga de Contratos ---
const contractsDir = path.resolve(__dirname, "..", "contracts");
const GAME_RESOLUTION_TEMPLATE = fs.readFileSync(path.join(contractsDir, "game_resolution.es"), "utf-8");

const DIGITAL_PUBLIC_GOOD_SCRIPT = fs.readFileSync(path.join(contractsDir, "reputation_system", "digital_public_good.es"), "utf-8")
const digitalPublicGoodErgoTree = compile(DIGITAL_PUBLIC_GOOD_SCRIPT, { version: 1 });
const digital_public_good_script_hash = digitalPublicGoodErgoTree.toHex();
const REPUTATION_PROOF_SOURCE = fs.readFileSync(path.join(contractsDir, "reputation_system", "reputation_proof.es"), "utf-8").replace(/`\+DIGITAL_PUBLIC_GOOD_SCRIPT_HASH\+`/g, digital_public_good_script_hash);

const PARTICIPATION_SOURCE = fs.readFileSync(path.join(contractsDir, "participation.es"), "utf-8");
const DEV_ADDR_BASE58 = "9ejNy2qoifmzfCiDtEiyugthuXMriNNPhNKzzwjPtHnrK3esvbD";
const JUDGE_PERIOD = 40n; // Debe coincidir con el valor en game_resolution.es mas cierto margen que se debe de dejar (ya que parece que el constructor de la transacción adelanta algunos bloques a proposito).

// Helper para crear un hash de compromiso
const createCommitment = (solverId: string, score: bigint, logs: string, secret: Uint8Array): Uint8Array => {
    return blake2b256(new Uint8Array([...stringToBytes("utf8", solverId), ...bigintToLongByteArray(score), ...stringToBytes("utf8", logs), ...secret]));
};

describe("Game Resolution Invalidation by Judges", () => {
    const mockChain = new MockChain({ height: 800_000 });

    // --- Actores ---
    let resolver: ReturnType<MockChain["newParty"]>;
    let invalidatedWinner: ReturnType<MockChain["newParty"]>;
    let nextWinner: ReturnType<MockChain["newParty"]>;
    let extraParticipant: ReturnType<MockChain["newParty"]>;
    let judge1: ReturnType<MockChain["newParty"]>;
    let judge2: ReturnType<MockChain["newParty"]>;
    let judge3: ReturnType<MockChain["newParty"]>;

    // --- Contratos y Partidos ---
    let gameResolutionContract: ReturnType<MockChain["newParty"]>;
    let participationContract: ReturnType<MockChain["newParty"]>;
    let reputationProofContract: ReturnType<MockChain["newParty"]>;
    
    // --- ErgoTrees de Contratos ---
    let gameResolutionErgoTree: ReturnType<typeof compile>;
    let participationErgoTree: ReturnType<typeof compile>;
    let reputationProofErgoTree: ReturnType<typeof compile>;

    // --- Estado del Juego ---
    const currentHeight = 800_000;
    const resolutionDeadline = BigInt(currentHeight) + JUDGE_PERIOD;
    const gameNftId = "33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aa";
    let secret = stringToBytes("utf8", "secret-for-invalidation-test");

    let gameResolutionBox: Box;
    let invalidatedWinnerBox: Box;
    let nextWinnerBox: Box;
    let extraParticipantBox: Box;
    let judge1ReputationBox: Box;
    let judge2ReputationBox: Box;

    let invalidatedCommitment: Uint8Array;
    let nextWinnerCommitment: Uint8Array;
    let extraParticipantCommitment: Uint8Array;
    let judge1TokenId: string;
    let judge2TokenId: string;
    let judge3TokenId: string;


    beforeEach(() => {
        mockChain.reset({clearParties: true});
        mockChain.jumpTo(currentHeight);

        // --- Compilar Contratos ---
        participationErgoTree = compile(PARTICIPATION_SOURCE);
        
        // Asumimos que no necesitamos el hash de 'submitted' para este test
        const dummySubmittedHash = "0".repeat(64);

        const resolutionSource = GAME_RESOLUTION_TEMPLATE
            .replace("`+PARTICIPATION_SCRIPT_HASH+`", uint8ArrayToHex(blake2b256(participationErgoTree.bytes)))
            .replace("`+REPUTATION_PROOF_SCRIPT_HASH+`", uint8ArrayToHex(blake2b256(compile(REPUTATION_PROOF_SOURCE).bytes)))
            .replace("`+PARTICIPATION_TYPE_ID+`", PARTICIPATION)
            .replace("`+DEV_ADDR+`", DEV_ADDR_BASE58);
        gameResolutionErgoTree = compile(resolutionSource);
        reputationProofErgoTree = compile(REPUTATION_PROOF_SOURCE);
    });

    it("should successfully invalidate the current winner with a majority of judge votes (2 out of 3)", () => {
        // --- Crear Estado Inicial del Juego ---

        // --- Añadir Partidos de Contratos al MockChain ---
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "ParticipationResolved");
        reputationProofContract = mockChain.addParty(reputationProofErgoTree.toHex(), "ReputationProof");

        // --- Inicializar Actores ---
        resolver = mockChain.newParty("Resolver");
        invalidatedWinner = mockChain.newParty("InvalidatedWinner");
        nextWinner = mockChain.newParty("NextWinner");
        judge1 = mockChain.newParty("Judge1");
        judge2 = mockChain.newParty("Judge2");
        judge3 = mockChain.newParty("Judge3");
        resolver.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });

        // 1. Generar compromisos para los participantes
        invalidatedCommitment = createCommitment("solver-invalid", 230n, "logs-invalid", secret);
        nextWinnerCommitment = createCommitment("solver-next-winner", 100n, "logs-next-winner", secret);

        // 2. Crear tokens de reputación para los jueces
        judge1TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge2TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge3TokenId = Buffer.from(randomBytes(32)).toString("hex");

        // 3. Crear la caja `game_resolution`
        const numericalParams: bigint[] = [700_000n, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];
        const judges = [judge1TokenId, judge2TokenId, judge3TokenId].map(id => Buffer.from(id, "hex"));

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 30,  // We resolved the game 30 blocks ago, still within the judge period.
            additionalRegisters: {
                R4: SInt(1).toHex(), // Estado: Resolución
                R5: SPair(SColl(SByte, secret), SColl(SByte, invalidatedCommitment)).toHex(),
                R6: SColl(SColl(SByte), judges).toHex(),
                R7: SColl(SLong, numericalParams).toHex(),
                R8: SPair(SColl(SByte, resolver.key.publicKey), SLong(10n)).toHex(),
                R9: SPair(SColl(SByte, resolver.key.publicKey), SColl(SByte, stringToBytes("utf8", "{}"))).toHex()
            }
        });
        gameResolutionBox = gameResolutionContract.utxos.toArray()[0];

        // 4. Crear cajas `participation_resolved`
        participationContract.addUTxOs({ // Ganador a ser invalidado
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: mockChain.height - 30,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, invalidatedWinner.key.publicKey).toHex(),
                R5: SColl(SByte, invalidatedCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-invalid")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-invalid")).toHex(),
                R9: SColl(SLong, [100n, 200n, 23n, 230n, 300n, 1000n, 2n, 3n, 10n, 2n]).toHex(),
            }
        });
        invalidatedWinnerBox = participationContract.utxos.toArray()[0];

        participationContract.addUTxOs({ // Próximo candidato a ganador
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: mockChain.height - 30,  // We resolved the game 30 blocks ago, still within the judge period.
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, nextWinner.key.publicKey).toHex(),
                R5: SColl(SByte, nextWinnerCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-next-winner")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-next-winner")).toHex(),
                R9: SColl(SLong, [100n, 200n, 30n, 1200n, 20n, 1n, 200n, 33n, 2000n]).toHex(),
            }
        });
        nextWinnerBox = participationContract.utxos.toArray()[1];

        // 5. Crear cajas `reputation_proof` para los jueces (los votos)
        const dummyTypeNftId = "f6819e0b7cf99c8c7872b62f4985b8d900c6150925d01eb279787517a848b6d8";
        reputationProofContract.addUTxOs(
            { // Voto del Juez 1
                creationHeight: mockChain.height - 10,  // Judge opinion was formed 10 blocks ago, after resolve the game (30 blocks ago) and before judge period ends.
                ergoTree: reputationProofErgoTree.toHex(),
                value: 1_000_000n,
                assets: [{ tokenId: judge1TokenId, amount: 1n }],
                additionalRegisters: {
                    R4: SColl(SByte, dummyTypeNftId).toHex(),
                    R5: SColl(SByte, invalidatedCommitment).toHex(), // Vota contra el candidato
                    R6: SPair(SBool(true), SLong(1_000_000n)).toHex(),
                    R7: generate_pk_proposition("9fcwctfPQPkDfHgxBns5Uu3dwWpaoywhkpLEobLuztfQuV5mt3T"),
                    R8: SBool(false).toHex(),  // Considera inválido al candidato
                    R9: SColl(SByte, new Uint8Array(0)).toHex(),
                }
            }
        );
        reputationProofContract.addUTxOs(
            { // Voto del Juez 2
                creationHeight: mockChain.height - 10,  // Judge opinion was formed 10 blocks ago, after resolve the game (30 blocks ago) and before judge period ends.
                ergoTree: reputationProofErgoTree.toHex(),
                value: 1_000_000n,
                assets: [{ tokenId: judge2TokenId, amount: 1n }],
                additionalRegisters: {
                    R4: SColl(SByte, dummyTypeNftId).toHex(),
                    R5: SColl(SByte, invalidatedCommitment).toHex(),
                    R6: SPair(SBool(true), SLong(1_000_000n)).toHex(),
                    R7: generate_pk_proposition("9fwQGg6pPjibqhEZDVopd9deAHXNsWU4fjAHFYLAKexdVCDhYEs"),
                    R8: SBool(false).toHex(),  // Considera inválido al candidato
                    R9: SColl(SByte, new Uint8Array(0)).toHex(),
                }
            }
        );
        judge1ReputationBox = reputationProofContract.utxos.toArray()[0];
        judge2ReputationBox = reputationProofContract.utxos.toArray()[1];

        const requiredVotes = 2; // (3 / 2) + 1 = 2
        
        // --- Estado Esperado de la Nueva Caja de Juego ---
        const newFunds = gameResolutionBox.value + invalidatedWinnerBox.value;
        const extendedDeadline = BigInt(resolutionDeadline) + JUDGE_PERIOD;
        const decrementedCounter = 1n; // 2 - 1
        const newNumericalParams = [700_000n, 2_000_000_000n, 1_000_000n, extendedDeadline, decrementedCounter];
        
        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, invalidatedWinnerBox, ...resolver.utxos.toArray()])
            .to([
                new OutputBuilder(newFunds, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        ...gameResolutionBox.additionalRegisters,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, nextWinnerCommitment)).toHex(), // Nuevo candidato
                        R7: SColl(SLong, newNumericalParams).toHex(), // Parámetros actualizados
                    })
            ])
            .withDataFrom([judge1ReputationBox, judge2ReputationBox, nextWinnerBox]) // Los votos de los jueces y las participaciones no invalidadas
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
        
        // 3. El deadline de resolución se ha extendido y el contador de participantes resueltos ha disminuido
        const newR7 = newGameBox.additionalRegisters.R7;
        expect(newR7).to.equal(SColl(SLong, newNumericalParams).toHex());

        // 4. Las cajas gastadas ya no existen
        expect(gameResolutionContract.utxos.toArray().find(b => b.boxId === gameResolutionBox.boxId)).to.be.undefined;
        expect(participationContract.utxos.toArray().find(b => b.boxId === invalidatedWinnerBox.boxId)).to.be.undefined;
    });

    it("should fail if there are not enough judge votes (1 out of 3)", () => {

        // --- Crear Estado Inicial del Juego ---

        // --- Añadir Partidos de Contratos al MockChain ---
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "ParticipationResolved");
        reputationProofContract = mockChain.addParty(reputationProofErgoTree.toHex(), "ReputationProof");

        // --- Inicializar Actores ---
        resolver = mockChain.newParty("Resolver");
        invalidatedWinner = mockChain.newParty("InvalidatedWinner");
        nextWinner = mockChain.newParty("NextWinner");
        judge1 = mockChain.newParty("Judge1");
        judge2 = mockChain.newParty("Judge2");
        judge3 = mockChain.newParty("Judge3");
        resolver.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });

        // 1. Generar compromisos para los participantes
        invalidatedCommitment = createCommitment("solver-invalid", 230n, "logs-invalid", secret);
        nextWinnerCommitment = createCommitment("solver-next-winner", 100n, "logs-next-winner", secret);

        // 2. Crear tokens de reputación para los jueces
        judge1TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge2TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge3TokenId = Buffer.from(randomBytes(32)).toString("hex");

        // 3. Crear la caja `game_resolution`
        const numericalParams: bigint[] = [700_000n, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];
        const judges = [judge1TokenId, judge2TokenId, judge3TokenId].map(id => Buffer.from(id, "hex"));

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 30,  // We resolved the game 30 blocks ago, still within the judge period.
            additionalRegisters: {
                R4: SInt(1).toHex(), // Estado: Resolución
                R5: SPair(SColl(SByte, secret), SColl(SByte, invalidatedCommitment)).toHex(),
                R6: SColl(SColl(SByte), judges).toHex(),
                R7: SColl(SLong, numericalParams).toHex(),
                R8: SPair(SColl(SByte, resolver.key.publicKey), SLong(10n)).toHex(),
                R9: SPair(SColl(SByte, resolver.key.publicKey), SColl(SByte, stringToBytes("utf8", "{}"))).toHex()
            }
        });
        gameResolutionBox = gameResolutionContract.utxos.toArray()[0];

        // 4. Crear cajas `participation_resolved`
        participationContract.addUTxOs({ // Ganador a ser invalidado
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: mockChain.height - 30,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, invalidatedWinner.key.publicKey).toHex(),
                R5: SColl(SByte, invalidatedCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-invalid")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-invalid")).toHex(),
                R9: SColl(SLong, [100n, 200n, 23n, 230n, 300n, 1000n, 2n, 3n, 10n, 2n]).toHex(),
            }
        });
        invalidatedWinnerBox = participationContract.utxos.toArray()[0];

        participationContract.addUTxOs({ // Próximo candidato a ganador
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: mockChain.height - 30,  // We resolved the game 30 blocks ago, still within the judge period.
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, nextWinner.key.publicKey).toHex(),
                R5: SColl(SByte, nextWinnerCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-next-winner")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-next-winner")).toHex(),
                R9: SColl(SLong, [100n, 200n, 30n, 1200n, 20n, 1n, 200n, 33n, 2000n]).toHex(),
            }
        });
        nextWinnerBox = participationContract.utxos.toArray()[1];

        // 5. Crear cajas `reputation_proof` para los jueces (los votos)
        const dummyTypeNftId = "f6819e0b7cf99c8c7872b62f4985b8d900c6150925d01eb279787517a848b6d8";
        reputationProofContract.addUTxOs(
            { // Voto del Juez 1
                creationHeight: mockChain.height - 10,  // Judge opinion was formed 10 blocks ago, after resolve the game (30 blocks ago) and before judge period ends.
                ergoTree: reputationProofErgoTree.toHex(),
                value: 1_000_000n,
                assets: [{ tokenId: judge1TokenId, amount: 1n }],
                additionalRegisters: {
                    R4: SColl(SByte, dummyTypeNftId).toHex(),
                    R5: SColl(SByte, invalidatedCommitment).toHex(), // Vota contra el candidato
                    R6: SPair(SBool(true), SLong(1_000_000n)).toHex(),
                    R7: generate_pk_proposition("9fcwctfPQPkDfHgxBns5Uu3dwWpaoywhkpLEobLuztfQuV5mt3T"),
                    R8: SBool(false).toHex(),  // Considera inválido al candidato
                    R9: SColl(SByte, new Uint8Array(0)).toHex(),
                }
            }
        );
        reputationProofContract.addUTxOs(
            { // Voto del Juez 2
                creationHeight: mockChain.height - 10,  // Judge opinion was formed 10 blocks ago, after resolve the game (30 blocks ago) and before judge period ends.
                ergoTree: reputationProofErgoTree.toHex(),
                value: 1_000_000n,
                assets: [{ tokenId: judge2TokenId, amount: 1n }],
                additionalRegisters: {
                    R4: SColl(SByte, dummyTypeNftId).toHex(),
                    R5: SColl(SByte, invalidatedCommitment).toHex(),
                    R6: SPair(SBool(true), SLong(1_000_000n)).toHex(),
                    R7: generate_pk_proposition("9fwQGg6pPjibqhEZDVopd9deAHXNsWU4fjAHFYLAKexdVCDhYEs"),
                    R8: SBool(false).toHex(),  // Considera inválido al candidato
                    R9: SColl(SByte, new Uint8Array(0)).toHex(),
                }
            }
        );
        judge1ReputationBox = reputationProofContract.utxos.toArray()[0];
        judge2ReputationBox = reputationProofContract.utxos.toArray()[1];

        const currentHeight = mockChain.height;
        const newFunds = gameResolutionBox.value + invalidatedWinnerBox.value;
        const extendedDeadline = BigInt(resolutionDeadline) + JUDGE_PERIOD;
        const decrementedCounter = 1n;
        const newNumericalParams = [700_000n, 2_000_000_000n, 1_000_000n, extendedDeadline, decrementedCounter];

        const tx = new TransactionBuilder(currentHeight)
            .from([gameResolutionBox, invalidatedWinnerBox, nextWinnerBox, ...resolver.utxos.toArray()])
            .to([
                new OutputBuilder(newFunds, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        ...gameResolutionBox.additionalRegisters,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, nextWinnerCommitment)).toHex(),
                        R7: SColl(SLong, newNumericalParams).toHex(),
                    })
            ])
            .withDataFrom([judge1ReputationBox]) // Solo 1 voto, se necesitan 2
            .sendChangeTo(resolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const executionResult = mockChain.execute(tx, { signers: [resolver], throw: false });
        expect(executionResult).to.be.false;
    });

    it("should fail if a judge votes for the wrong commitment", () => {
        // --- Crear Estado Inicial del Juego ---

        // --- Añadir Partidos de Contratos al MockChain ---
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "ParticipationResolved");
        reputationProofContract = mockChain.addParty(reputationProofErgoTree.toHex(), "ReputationProof");

        // --- Inicializar Actores ---
        resolver = mockChain.newParty("Resolver");
        invalidatedWinner = mockChain.newParty("InvalidatedWinner");
        nextWinner = mockChain.newParty("NextWinner");
        judge1 = mockChain.newParty("Judge1");
        judge2 = mockChain.newParty("Judge2");
        judge3 = mockChain.newParty("Judge3");
        resolver.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });

        // 1. Generar compromisos para los participantes
        invalidatedCommitment = createCommitment("solver-invalid", 230n, "logs-invalid", secret);
        nextWinnerCommitment = createCommitment("solver-next-winner", 100n, "logs-next-winner", secret);

        // 2. Crear tokens de reputación para los jueces
        judge1TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge2TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge3TokenId = Buffer.from(randomBytes(32)).toString("hex");

        // 3. Crear la caja `game_resolution`
        const numericalParams: bigint[] = [700_000n, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];
        const judges = [judge1TokenId, judge2TokenId, judge3TokenId].map(id => Buffer.from(id, "hex"));

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 30,  // We resolved the game 30 blocks ago, still within the judge period.
            additionalRegisters: {
                R4: SInt(1).toHex(), // Estado: Resolución
                R5: SPair(SColl(SByte, secret), SColl(SByte, invalidatedCommitment)).toHex(),
                R6: SColl(SColl(SByte), judges).toHex(),
                R7: SColl(SLong, numericalParams).toHex(),
                R8: SPair(SColl(SByte, resolver.key.publicKey), SLong(10n)).toHex(),
                R9: SPair(SColl(SByte, resolver.key.publicKey), SColl(SByte, stringToBytes("utf8", "{}"))).toHex()
            }
        });
        gameResolutionBox = gameResolutionContract.utxos.toArray()[0];

        // 4. Crear cajas `participation_resolved`
        participationContract.addUTxOs({ // Ganador a ser invalidado
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: mockChain.height - 30,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, invalidatedWinner.key.publicKey).toHex(),
                R5: SColl(SByte, invalidatedCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-invalid")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-invalid")).toHex(),
                R9: SColl(SLong, [100n, 200n, 23n, 230n, 300n, 1000n, 2n, 3n, 10n, 2n]).toHex(),
            }
        });
        invalidatedWinnerBox = participationContract.utxos.toArray()[0];

        participationContract.addUTxOs({ // Próximo candidato a ganador
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: mockChain.height - 30,  // We resolved the game 30 blocks ago, still within the judge period.
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, nextWinner.key.publicKey).toHex(),
                R5: SColl(SByte, nextWinnerCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-next-winner")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-next-winner")).toHex(),
                R9: SColl(SLong, [100n, 200n, 30n, 1200n, 20n, 1n, 200n, 33n, 2000n]).toHex(),
            }
        });
        nextWinnerBox = participationContract.utxos.toArray()[1];

        // 5. Crear cajas `reputation_proof` para los jueces (los votos)
        const dummyTypeNftId = "f6819e0b7cf99c8c7872b62f4985b8d900c6150925d01eb279787517a848b6d8";
        const dummyInvalidInvalidatedCommitment = createCommitment("some-wrong-solver", 999n, "wrong-logs", secret);
        reputationProofContract.addUTxOs(
            { // Voto del Juez 1
                creationHeight: mockChain.height - 10,  // Judge opinion was formed 10 blocks ago, after resolve the game (30 blocks ago) and before judge period ends.
                ergoTree: reputationProofErgoTree.toHex(),
                value: 1_000_000n,
                assets: [{ tokenId: judge1TokenId, amount: 1n }],
                additionalRegisters: {
                    R4: SColl(SByte, dummyTypeNftId).toHex(),
                    R5: SColl(SByte, invalidatedCommitment).toHex(), // Vota contra el candidato
                    R6: SPair(SBool(true), SLong(1_000_000n)).toHex(),
                    R7: generate_pk_proposition("9fcwctfPQPkDfHgxBns5Uu3dwWpaoywhkpLEobLuztfQuV5mt3T"),
                    R8: SBool(false).toHex(),  // Considera inválido al candidato
                    R9: SColl(SByte, new Uint8Array(0)).toHex(),
                }
            }
        );
        reputationProofContract.addUTxOs(
            { // Voto del Juez 2
                creationHeight: mockChain.height - 10,  // Judge opinion was formed 10 blocks ago, after resolve the game (30 blocks ago) and before judge period ends.
                ergoTree: reputationProofErgoTree.toHex(),
                value: 1_000_000n,
                assets: [{ tokenId: judge2TokenId, amount: 1n }],
                additionalRegisters: {
                    R4: SColl(SByte, dummyTypeNftId).toHex(),
                    R5: SColl(SByte, dummyInvalidInvalidatedCommitment).toHex(),
                    R6: SPair(SBool(true), SLong(1_000_000n)).toHex(),
                    R7: generate_pk_proposition("9fwQGg6pPjibqhEZDVopd9deAHXNsWU4fjAHFYLAKexdVCDhYEs"),
                    R8: SBool(false).toHex(),  // Considera inválido al candidato
                    R9: SColl(SByte, new Uint8Array(0)).toHex(),
                }
            }
        );
        // The second judge voted for a different commitment, so their vote should not count. Only one is valid, not enough to reach the required majority.
        judge1ReputationBox = reputationProofContract.utxos.toArray()[0];
        judge2ReputationBox = reputationProofContract.utxos.toArray()[1];

        const requiredVotes = 2; // (3 / 2) + 1 = 2
        
        // --- Estado Esperado de la Nueva Caja de Juego ---
        const newFunds = gameResolutionBox.value + invalidatedWinnerBox.value;
        const extendedDeadline = BigInt(resolutionDeadline) + JUDGE_PERIOD;
        const decrementedCounter = 1n; // 2 - 1
        const newNumericalParams = [700_000n, 2_000_000_000n, 1_000_000n, extendedDeadline, decrementedCounter];
        
        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, invalidatedWinnerBox, ...resolver.utxos.toArray()])
            .to([
                new OutputBuilder(newFunds, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        ...gameResolutionBox.additionalRegisters,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, nextWinnerCommitment)).toHex(), // Nuevo candidato
                        R7: SColl(SLong, newNumericalParams).toHex(), // Parámetros actualizados
                    })
            ])
            .withDataFrom([judge1ReputationBox, judge2ReputationBox, nextWinnerBox]) // Los votos de los jueces y las participaciones no invalidadas
            .sendChangeTo(resolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();
            
        const executionResult = mockChain.execute(tx, { signers: [resolver], throw: false });
        expect(executionResult).to.be.false;
    });
    
    it("should fail if trying to invalidate after the resolution deadline", () => {
        // --- Crear Estado Inicial del Juego ---

        // --- Añadir Partidos de Contratos al MockChain ---
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "ParticipationResolved");
        reputationProofContract = mockChain.addParty(reputationProofErgoTree.toHex(), "ReputationProof");
    
        // --- Inicializar Actores ---
        resolver = mockChain.newParty("Resolver");
        invalidatedWinner = mockChain.newParty("InvalidatedWinner");
        nextWinner = mockChain.newParty("NextWinner");
        judge1 = mockChain.newParty("Judge1");
        judge2 = mockChain.newParty("Judge2");
        judge3 = mockChain.newParty("Judge3");
        resolver.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });

        // 1. Generar compromisos para los participantes
        invalidatedCommitment = createCommitment("solver-invalid", 230n, "logs-invalid", secret);
        nextWinnerCommitment = createCommitment("solver-next-winner", 100n, "logs-next-winner", secret);

        // 2. Crear tokens de reputación para los jueces
        judge1TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge2TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge3TokenId = Buffer.from(randomBytes(32)).toString("hex");

        // 3. Crear la caja `game_resolution`
        const numericalParams: bigint[] = [700_000n, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];
        const judges = [judge1TokenId, judge2TokenId, judge3TokenId].map(id => Buffer.from(id, "hex"));

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 30,  // We resolved the game 30 blocks ago, still within the judge period.
            additionalRegisters: {
                R4: SInt(1).toHex(), // Estado: Resolución
                R5: SPair(SColl(SByte, secret), SColl(SByte, invalidatedCommitment)).toHex(),
                R6: SColl(SColl(SByte), judges).toHex(),
                R7: SColl(SLong, numericalParams).toHex(),
                R8: SPair(SColl(SByte, resolver.key.publicKey), SLong(10n)).toHex(),
                R9: SPair(SColl(SByte, resolver.key.publicKey), SColl(SByte, stringToBytes("utf8", "{}"))).toHex()
            }
        });
        gameResolutionBox = gameResolutionContract.utxos.toArray()[0];

        // 4. Crear cajas `participation_resolved`
        participationContract.addUTxOs({ // Ganador a ser invalidado
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: mockChain.height - 30,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, invalidatedWinner.key.publicKey).toHex(),
                R5: SColl(SByte, invalidatedCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-invalid")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-invalid")).toHex(),
                R9: SColl(SLong, [100n, 200n, 23n, 230n, 300n, 1000n, 2n, 3n, 10n, 2n]).toHex(),
            }
        });
        invalidatedWinnerBox = participationContract.utxos.toArray()[0];

        participationContract.addUTxOs({ // Próximo candidato a ganador
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: mockChain.height - 30,  // We resolved the game 30 blocks ago, still within the judge period.
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, nextWinner.key.publicKey).toHex(),
                R5: SColl(SByte, nextWinnerCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-next-winner")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-next-winner")).toHex(),
                R9: SColl(SLong, [100n, 200n, 30n, 1200n, 20n, 1n, 200n, 33n, 2000n]).toHex(),
            }
        });
        nextWinnerBox = participationContract.utxos.toArray()[1];

        // 5. Crear cajas `reputation_proof` para los jueces (los votos)
        const dummyTypeNftId = "f6819e0b7cf99c8c7872b62f4985b8d900c6150925d01eb279787517a848b6d8";
        reputationProofContract.addUTxOs(
            { // Voto del Juez 1
                creationHeight: mockChain.height - 10,  // Judge opinion was formed 10 blocks ago, after resolve the game (30 blocks ago) and before judge period ends.
                ergoTree: reputationProofErgoTree.toHex(),
                value: 1_000_000n,
                assets: [{ tokenId: judge1TokenId, amount: 1n }],
                additionalRegisters: {
                    R4: SColl(SByte, dummyTypeNftId).toHex(),
                    R5: SColl(SByte, invalidatedCommitment).toHex(), // Vota contra el candidato
                    R6: SPair(SBool(true), SLong(1_000_000n)).toHex(),
                    R7: generate_pk_proposition("9fcwctfPQPkDfHgxBns5Uu3dwWpaoywhkpLEobLuztfQuV5mt3T"),
                    R8: SBool(false).toHex(),  // Considera inválido al candidato
                    R9: SColl(SByte, new Uint8Array(0)).toHex(),
                }
            }
        );
        reputationProofContract.addUTxOs(
            { // Voto del Juez 2
                creationHeight: mockChain.height - 10,  // Judge opinion was formed 10 blocks ago, after resolve the game (30 blocks ago) and before judge period ends.
                ergoTree: reputationProofErgoTree.toHex(),
                value: 1_000_000n,
                assets: [{ tokenId: judge2TokenId, amount: 1n }],
                additionalRegisters: {
                    R4: SColl(SByte, dummyTypeNftId).toHex(),
                    R5: SColl(SByte, invalidatedCommitment).toHex(),
                    R6: SPair(SBool(true), SLong(1_000_000n)).toHex(),
                    R7: generate_pk_proposition("9fwQGg6pPjibqhEZDVopd9deAHXNsWU4fjAHFYLAKexdVCDhYEs"),
                    R8: SBool(false).toHex(),  // Considera inválido al candidato
                    R9: SColl(SByte, new Uint8Array(0)).toHex(),
                }
            }
        );
        judge1ReputationBox = reputationProofContract.utxos.toArray()[0];
        judge2ReputationBox = reputationProofContract.utxos.toArray()[1];

        const requiredVotes = 2; // (3 / 2) + 1 = 2
        
        // --- Estado Esperado de la Nueva Caja de Juego ---
        const newFunds = gameResolutionBox.value + invalidatedWinnerBox.value;
        const extendedDeadline = BigInt(resolutionDeadline) + JUDGE_PERIOD;
        const decrementedCounter = 1n; // 2 - 1
        const newNumericalParams = [700_000n, 2_000_000_000n, 1_000_000n, extendedDeadline, decrementedCounter];
        
        mockChain.newBlocks(41); // Advance beyond the judge period

        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, invalidatedWinnerBox, ...resolver.utxos.toArray()])
            .to([
                new OutputBuilder(newFunds, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        ...gameResolutionBox.additionalRegisters,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, nextWinnerCommitment)).toHex(), // Nuevo candidato
                        R7: SColl(SLong, newNumericalParams).toHex(), // Parámetros actualizados
                    })
            ])
            .withDataFrom([judge1ReputationBox, judge2ReputationBox, nextWinnerBox]) // Los votos de los jueces y las participaciones no invalidadas
            .sendChangeTo(resolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();
        const executionResult = mockChain.execute(tx, { signers: [resolver], throw: false });
        expect(executionResult).to.be.false;
    });

    it("should successfully invalidate the current winner with a majority of judge votes (1 out of 1)", () => {
        // --- Crear Estado Inicial del Juego ---

        // --- Añadir Partidos de Contratos al MockChain ---
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "ParticipationResolved");
        reputationProofContract = mockChain.addParty(reputationProofErgoTree.toHex(), "ReputationProof");

        // --- Inicializar Actores ---
        resolver = mockChain.newParty("Resolver");
        invalidatedWinner = mockChain.newParty("InvalidatedWinner");
        nextWinner = mockChain.newParty("NextWinner");
        judge1 = mockChain.newParty("Judge1");
        resolver.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });

        // 1. Generar compromisos para los participantes
        invalidatedCommitment = createCommitment("solver-invalid", 230n, "logs-invalid", secret);
        nextWinnerCommitment = createCommitment("solver-next-winner", 100n, "logs-next-winner", secret);

        // 2. Crear tokens de reputación para los jueces
        judge1TokenId = Buffer.from(randomBytes(32)).toString("hex");

        // 3. Crear la caja `game_resolution`
        const numericalParams: bigint[] = [700_000n, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];
        const judges = [judge1TokenId].map(id => Buffer.from(id, "hex"));

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 30,  // We resolved the game 30 blocks ago, still within the judge period.
            additionalRegisters: {
                R4: SInt(1).toHex(), // Estado: Resolución
                R5: SPair(SColl(SByte, secret), SColl(SByte, invalidatedCommitment)).toHex(),
                R6: SColl(SColl(SByte), judges).toHex(),
                R7: SColl(SLong, numericalParams).toHex(),
                R8: SPair(SColl(SByte, resolver.key.publicKey), SLong(10n)).toHex(),
                R9: SPair(SColl(SByte, resolver.key.publicKey), SColl(SByte, stringToBytes("utf8", "{}"))).toHex()
            }
        });
        gameResolutionBox = gameResolutionContract.utxos.toArray()[0];

        // 4. Crear cajas `participation_resolved`
        participationContract.addUTxOs({ // Ganador a ser invalidado
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: mockChain.height - 30,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, invalidatedWinner.key.publicKey).toHex(),
                R5: SColl(SByte, invalidatedCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-invalid")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-invalid")).toHex(),
                R9: SColl(SLong, [100n, 200n, 23n, 230n, 300n, 1000n, 2n, 3n, 10n, 2n]).toHex(),
            }
        });
        invalidatedWinnerBox = participationContract.utxos.toArray()[0];

        participationContract.addUTxOs({ // Próximo candidato a ganador
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: mockChain.height - 30,  // We resolved the game 30 blocks ago, still within the judge period.
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, nextWinner.key.publicKey).toHex(),
                R5: SColl(SByte, nextWinnerCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-next-winner")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-next-winner")).toHex(),
                R9: SColl(SLong, [100n, 200n, 30n, 1200n, 20n, 1n, 200n, 33n, 2000n]).toHex(),
            }
        });
        nextWinnerBox = participationContract.utxos.toArray()[1];

        // 5. Crear cajas `reputation_proof` para los jueces (los votos)
        const dummyTypeNftId = "f6819e0b7cf99c8c7872b62f4985b8d900c6150925d01eb279787517a848b6d8";
        reputationProofContract.addUTxOs(
            { // Voto del Juez 1
                creationHeight: mockChain.height - 10,  // Judge opinion was formed 10 blocks ago, after resolve the game (30 blocks ago) and before judge period ends.
                ergoTree: reputationProofErgoTree.toHex(),
                value: 1_000_000n,
                assets: [{ tokenId: judge1TokenId, amount: 1n }],
                additionalRegisters: {
                    R4: SColl(SByte, dummyTypeNftId).toHex(),
                    R5: SColl(SByte, invalidatedCommitment).toHex(), // Vota contra el candidato
                    R6: SPair(SBool(true), SLong(1_000_000n)).toHex(),
                    R7: generate_pk_proposition("9fcwctfPQPkDfHgxBns5Uu3dwWpaoywhkpLEobLuztfQuV5mt3T"),
                    R8: SBool(false).toHex(),  // Considera inválido al candidato
                    R9: SColl(SByte, new Uint8Array(0)).toHex(),
                }
            }
        );
        reputationProofContract.addUTxOs(
            { // Voto del Juez 2
                creationHeight: mockChain.height - 10,  // Judge opinion was formed 10 blocks ago, after resolve the game (30 blocks ago) and before judge period ends.
                ergoTree: reputationProofErgoTree.toHex(),
                value: 1_000_000n,
                assets: [{ tokenId: judge2TokenId, amount: 1n }],
                additionalRegisters: {
                    R4: SColl(SByte, dummyTypeNftId).toHex(),
                    R5: SColl(SByte, invalidatedCommitment).toHex(),
                    R6: SPair(SBool(true), SLong(1_000_000n)).toHex(),
                    R7: generate_pk_proposition("9fwQGg6pPjibqhEZDVopd9deAHXNsWU4fjAHFYLAKexdVCDhYEs"),
                    R8: SBool(false).toHex(),  // Considera inválido al candidato
                    R9: SColl(SByte, new Uint8Array(0)).toHex(),
                }
            }
        );
        judge1ReputationBox = reputationProofContract.utxos.toArray()[0];
        
        // --- Estado Esperado de la Nueva Caja de Juego ---
        const newFunds = gameResolutionBox.value + invalidatedWinnerBox.value;
        const extendedDeadline = BigInt(resolutionDeadline) + JUDGE_PERIOD;
        const decrementedCounter = 1n; // 2 - 1
        const newNumericalParams = [700_000n, 2_000_000_000n, 1_000_000n, extendedDeadline, decrementedCounter];
        
        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, invalidatedWinnerBox, ...resolver.utxos.toArray()])
            .to([
                new OutputBuilder(newFunds, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        ...gameResolutionBox.additionalRegisters,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, nextWinnerCommitment)).toHex(), // Nuevo candidato
                        R7: SColl(SLong, newNumericalParams).toHex(), // Parámetros actualizados
                    })
            ])
            .withDataFrom([judge1ReputationBox, nextWinnerBox]) // Los votos de los jueces y las participaciones no invalidadas
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
        
        // 3. El deadline de resolución se ha extendido y el contador de participantes resueltos ha disminuido
        const newR7 = newGameBox.additionalRegisters.R7;
        expect(newR7).to.equal(SColl(SLong, newNumericalParams).toHex());

        // 4. Las cajas gastadas ya no existen
        expect(gameResolutionContract.utxos.toArray().find(b => b.boxId === gameResolutionBox.boxId)).to.be.undefined;
        expect(participationContract.utxos.toArray().find(b => b.boxId === invalidatedWinnerBox.boxId)).to.be.undefined;
    });

    it("should fail if trying to maintain the resolvedCounter instead of decrement it", () => {
        // Exactly the same setup as the successful case, but we will try to keep the resolvedCounter the same instead of decrementing it.

        // --- Crear Estado Inicial del Juego ---

        // --- Añadir Partidos de Contratos al MockChain ---
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "ParticipationResolved");
        reputationProofContract = mockChain.addParty(reputationProofErgoTree.toHex(), "ReputationProof");

        // --- Inicializar Actores ---
        resolver = mockChain.newParty("Resolver");
        invalidatedWinner = mockChain.newParty("InvalidatedWinner");
        nextWinner = mockChain.newParty("NextWinner");
        judge1 = mockChain.newParty("Judge1");
        resolver.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });

        // 1. Generar compromisos para los participantes
        invalidatedCommitment = createCommitment("solver-invalid", 230n, "logs-invalid", secret);
        nextWinnerCommitment = createCommitment("solver-next-winner", 100n, "logs-next-winner", secret);

        // 2. Crear tokens de reputación para los jueces
        judge1TokenId = Buffer.from(randomBytes(32)).toString("hex");

        // 3. Crear la caja `game_resolution`
        const numericalParams: bigint[] = [700_000n, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];
        const judges = [judge1TokenId].map(id => Buffer.from(id, "hex"));

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 30,  // We resolved the game 30 blocks ago, still within the judge period.
            additionalRegisters: {
                R4: SInt(1).toHex(), // Estado: Resolución
                R5: SPair(SColl(SByte, secret), SColl(SByte, invalidatedCommitment)).toHex(),
                R6: SColl(SColl(SByte), judges).toHex(),
                R7: SColl(SLong, numericalParams).toHex(),
                R8: SPair(SColl(SByte, resolver.key.publicKey), SLong(10n)).toHex(),
                R9: SPair(SColl(SByte, resolver.key.publicKey), SColl(SByte, stringToBytes("utf8", "{}"))).toHex()
            }
        });
        gameResolutionBox = gameResolutionContract.utxos.toArray()[0];

        // 4. Crear cajas `participation_resolved`
        participationContract.addUTxOs({ // Ganador a ser invalidado
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: mockChain.height - 30,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, invalidatedWinner.key.publicKey).toHex(),
                R5: SColl(SByte, invalidatedCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-invalid")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-invalid")).toHex(),
                R9: SColl(SLong, [100n, 200n, 23n, 230n, 300n, 1000n, 2n, 3n, 10n, 2n]).toHex(),
            }
        });
        invalidatedWinnerBox = participationContract.utxos.toArray()[0];

        participationContract.addUTxOs({ // Próximo candidato a ganador
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: mockChain.height - 30,  // We resolved the game 30 blocks ago, still within the judge period.
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, nextWinner.key.publicKey).toHex(),
                R5: SColl(SByte, nextWinnerCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-next-winner")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-next-winner")).toHex(),
                R9: SColl(SLong, [100n, 200n, 30n, 1200n, 20n, 1n, 200n, 33n, 2000n]).toHex(),
            }
        });
        nextWinnerBox = participationContract.utxos.toArray()[1];

        // 5. Crear cajas `reputation_proof` para los jueces (los votos)
        const dummyTypeNftId = "f6819e0b7cf99c8c7872b62f4985b8d900c6150925d01eb279787517a848b6d8";
        reputationProofContract.addUTxOs(
            { // Voto del Juez 1
                creationHeight: mockChain.height - 10,  // Judge opinion was formed 10 blocks ago, after resolve the game (30 blocks ago) and before judge period ends.
                ergoTree: reputationProofErgoTree.toHex(),
                value: 1_000_000n,
                assets: [{ tokenId: judge1TokenId, amount: 1n }],
                additionalRegisters: {
                    R4: SColl(SByte, dummyTypeNftId).toHex(),
                    R5: SColl(SByte, invalidatedCommitment).toHex(), // Vota contra el candidato
                    R6: SPair(SBool(true), SLong(1_000_000n)).toHex(),
                    R7: generate_pk_proposition("9fcwctfPQPkDfHgxBns5Uu3dwWpaoywhkpLEobLuztfQuV5mt3T"),
                    R8: SBool(false).toHex(),  // Considera inválido al candidato
                    R9: SColl(SByte, new Uint8Array(0)).toHex(),
                }
            }
        );
        reputationProofContract.addUTxOs(
            { // Voto del Juez 2
                creationHeight: mockChain.height - 10,  // Judge opinion was formed 10 blocks ago, after resolve the game (30 blocks ago) and before judge period ends.
                ergoTree: reputationProofErgoTree.toHex(),
                value: 1_000_000n,
                assets: [{ tokenId: judge2TokenId, amount: 1n }],
                additionalRegisters: {
                    R4: SColl(SByte, dummyTypeNftId).toHex(),
                    R5: SColl(SByte, invalidatedCommitment).toHex(),
                    R6: SPair(SBool(true), SLong(1_000_000n)).toHex(),
                    R7: generate_pk_proposition("9fwQGg6pPjibqhEZDVopd9deAHXNsWU4fjAHFYLAKexdVCDhYEs"),
                    R8: SBool(false).toHex(),  // Considera inválido al candidato
                    R9: SColl(SByte, new Uint8Array(0)).toHex(),
                }
            }
        );
        judge1ReputationBox = reputationProofContract.utxos.toArray()[0];
        
        // --- Estado Esperado de la Nueva Caja de Juego ---
        const newFunds = gameResolutionBox.value + invalidatedWinnerBox.value;
        const extendedDeadline = BigInt(resolutionDeadline) + JUDGE_PERIOD;
        const decrementedCounter = 2n; // Intentionally maintaining the same counter instead of decrementing it.
        const newNumericalParams = [700_000n, 2_000_000_000n, 1_000_000n, extendedDeadline, decrementedCounter];
        
        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, invalidatedWinnerBox, ...resolver.utxos.toArray()])
            .to([
                new OutputBuilder(newFunds, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        ...gameResolutionBox.additionalRegisters,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, nextWinnerCommitment)).toHex(), // Nuevo candidato
                        R7: SColl(SLong, newNumericalParams).toHex(), // Parámetros actualizados
                    })
            ])
            .withDataFrom([judge1ReputationBox, nextWinnerBox]) // Los votos de los jueces y las participaciones no invalidadas
            .sendChangeTo(resolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();
            
        const executionResult = mockChain.execute(tx, { signers: [resolver], throw: false });
        expect(executionResult).to.be.false;
    });

    it("should successfully invalidate the current winner with more than two current participants", () => {
        // --- Crear Estado Inicial del Juego ---

        // --- Añadir Partidos de Contratos al MockChain ---
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "ParticipationResolved");
        reputationProofContract = mockChain.addParty(reputationProofErgoTree.toHex(), "ReputationProof");

        // --- Inicializar Actores ---
        resolver = mockChain.newParty("Resolver");
        invalidatedWinner = mockChain.newParty("InvalidatedWinner");
        nextWinner = mockChain.newParty("NextWinner");
        extraParticipant = mockChain.newParty("ExtraParticipant");
        judge1 = mockChain.newParty("Judge1");
        resolver.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });

        // 1. Generar compromisos para los participantes
        invalidatedCommitment = createCommitment("solver-invalid", 230n, "logs-invalid", secret);
        nextWinnerCommitment = createCommitment("solver-next-winner", 100n, "logs-next-winner", secret);
        extraParticipantCommitment = createCommitment("solver-extra", 40n, "logs-extra", secret);

        // 2. Crear tokens de reputación para los jueces
        judge1TokenId = Buffer.from(randomBytes(32)).toString("hex");

        // 3. Crear la caja `game_resolution`
        const numericalParams: bigint[] = [700_000n, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];
        const judges = [judge1TokenId].map(id => Buffer.from(id, "hex"));

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 30,  // We resolved the game 30 blocks ago, still within the judge period.
            additionalRegisters: {
                R4: SInt(1).toHex(), // Estado: Resolución
                R5: SPair(SColl(SByte, secret), SColl(SByte, invalidatedCommitment)).toHex(),
                R6: SColl(SColl(SByte), judges).toHex(),
                R7: SColl(SLong, numericalParams).toHex(),
                R8: SPair(SColl(SByte, resolver.key.publicKey), SLong(10n)).toHex(),
                R9: SPair(SColl(SByte, resolver.key.publicKey), SColl(SByte, stringToBytes("utf8", "{}"))).toHex()
            }
        });
        gameResolutionBox = gameResolutionContract.utxos.toArray()[0];

        // 4. Crear cajas `participation_resolved`
        participationContract.addUTxOs({ // Ganador a ser invalidado
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: mockChain.height - 30,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, invalidatedWinner.key.publicKey).toHex(),
                R5: SColl(SByte, invalidatedCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-invalid")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-invalid")).toHex(),
                R9: SColl(SLong, [100n, 200n, 23n, 230n, 300n, 1000n, 2n, 3n, 10n, 2n]).toHex(),
            }
        });
        invalidatedWinnerBox = participationContract.utxos.toArray()[0];

        participationContract.addUTxOs({ // Próximo candidato a ganador
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: mockChain.height - 30,  // We resolved the game 30 blocks ago, still within the judge period.
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, nextWinner.key.publicKey).toHex(),
                R5: SColl(SByte, nextWinnerCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-next-winner")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-next-winner")).toHex(),
                R9: SColl(SLong, [100n, 200n, 30n, 1200n, 20n, 1n, 200n, 33n, 2000n]).toHex(),
            }
        });
        nextWinnerBox = participationContract.utxos.toArray()[1];

        participationContract.addUTxOs({ // Participante extra que no será invalidado
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: mockChain.height - 30,  // We resolved the game 30 blocks ago, still within the judge period.
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, extraParticipant.key.publicKey).toHex(),
                R5: SColl(SByte, extraParticipantCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-extra")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-extra")).toHex(),
                R9: SColl(SLong, [100n, 200n, 10n, 40n, 50n, 500n, 1n, 1n, 5n, 1n]).toHex(),
            }
        });
        const extraParticipantBox = participationContract.utxos.toArray()[2];

        expect(participationContract.utxos.toArray().length).to.equal(3);

        // 5. Crear cajas `reputation_proof` para los jueces (los votos)
        const dummyTypeNftId = "f6819e0b7cf99c8c7872b62f4985b8d900c6150925d01eb279787517a848b6d8";
        reputationProofContract.addUTxOs(
            { // Voto del Juez 1
                creationHeight: mockChain.height - 10,  // Judge opinion was formed 10 blocks ago, after resolve the game (30 blocks ago) and before judge period ends.
                ergoTree: reputationProofErgoTree.toHex(),
                value: 1_000_000n,
                assets: [{ tokenId: judge1TokenId, amount: 1n }],
                additionalRegisters: {
                    R4: SColl(SByte, dummyTypeNftId).toHex(),
                    R5: SColl(SByte, invalidatedCommitment).toHex(), // Vota contra el candidato
                    R6: SPair(SBool(true), SLong(1_000_000n)).toHex(),
                    R7: generate_pk_proposition("9fcwctfPQPkDfHgxBns5Uu3dwWpaoywhkpLEobLuztfQuV5mt3T"),
                    R8: SBool(false).toHex(),  // Considera inválido al candidato
                    R9: SColl(SByte, new Uint8Array(0)).toHex(),
                }
            }
        );
        reputationProofContract.addUTxOs(
            { // Voto del Juez 2
                creationHeight: mockChain.height - 10,  // Judge opinion was formed 10 blocks ago, after resolve the game (30 blocks ago) and before judge period ends.
                ergoTree: reputationProofErgoTree.toHex(),
                value: 1_000_000n,
                assets: [{ tokenId: judge2TokenId, amount: 1n }],
                additionalRegisters: {
                    R4: SColl(SByte, dummyTypeNftId).toHex(),
                    R5: SColl(SByte, invalidatedCommitment).toHex(),
                    R6: SPair(SBool(true), SLong(1_000_000n)).toHex(),
                    R7: generate_pk_proposition("9fwQGg6pPjibqhEZDVopd9deAHXNsWU4fjAHFYLAKexdVCDhYEs"),
                    R8: SBool(false).toHex(),  // Considera inválido al candidato
                    R9: SColl(SByte, new Uint8Array(0)).toHex(),
                }
            }
        );
        judge1ReputationBox = reputationProofContract.utxos.toArray()[0];
        
        // --- Estado Esperado de la Nueva Caja de Juego ---
        const newFunds = gameResolutionBox.value + invalidatedWinnerBox.value;
        const extendedDeadline = BigInt(resolutionDeadline) + JUDGE_PERIOD;
        const decrementedCounter = 1n; // 2 - 1
        const newNumericalParams = [700_000n, 2_000_000_000n, 1_000_000n, extendedDeadline, decrementedCounter];
        
        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, invalidatedWinnerBox, ...resolver.utxos.toArray()])
            .to([
                new OutputBuilder(newFunds, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        ...gameResolutionBox.additionalRegisters,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, nextWinnerCommitment)).toHex(), // Nuevo candidato
                        R7: SColl(SLong, newNumericalParams).toHex(), // Parámetros actualizados
                    })
            ])
            .withDataFrom([judge1ReputationBox, nextWinnerBox, extraParticipantBox]) // Los votos de los jueces y las participaciones no invalidadas
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
        
        // 3. El deadline de resolución se ha extendido y el contador de participantes resueltos ha disminuido
        const newR7 = newGameBox.additionalRegisters.R7;
        expect(newR7).to.equal(SColl(SLong, newNumericalParams).toHex());

        // 4. Las cajas gastadas ya no existen
        expect(gameResolutionContract.utxos.toArray().find(b => b.boxId === gameResolutionBox.boxId)).to.be.undefined;
        expect(participationContract.utxos.toArray().find(b => b.boxId === invalidatedWinnerBox.boxId)).to.be.undefined;
        expect(participationContract.utxos.toArray().find(b => b.boxId === extraParticipantBox.boxId)).to.not.be.undefined; // The extra participant box should remain.
    });

    it("should successfully invalidate current winner with single judge vote using transaction data", () => {
        // Based on a real failed case.
        
        // --- Crear Estado Inicial del Juego ---

        // --- Añadir Partidos de Contratos al MockChain ---
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "ParticipationResolved");
        reputationProofContract = mockChain.addParty(reputationProofErgoTree.toHex(), "ReputationProof");

        // --- Inicializar Actores ---
        resolver = mockChain.newParty("Resolver");
        invalidatedWinner = mockChain.newParty("InvalidatedWinner");
        nextWinner = mockChain.newParty("NextWinner");
        judge1 = mockChain.newParty("Judge1");
        resolver.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });

        // Ajustar la altura actual para coincidir con la transacción
        mockChain.jumpTo(1616940);

        // 1. Definir compromisos y secretos basados en la transacción
        secret = Buffer.from("35aa11186c18d3e04f81656248213a1a3c43e89a67045763287e644db60c3f21", "hex");
        invalidatedCommitment = Buffer.from("f1c5e1ba7002e8f330511ec71593e8463e1e221adfcbaecc18998858345411d0", "hex");
        nextWinnerCommitment = Buffer.from("862ba47251932d8f1c2f59df9acfeb5f9b1481927d3f9e2a5990af4adb8d3408", "hex");

        // 2. Crear tokens de reputación para los jueces
        judge1TokenId = "2da371e44ef2083041fa048a55db55f7013d81f3c12ac79c3f814a282e1c7839";

        // 3. Crear la caja `game_resolution`
        const numericalParams: bigint[] = [1616920n, 1000000n, 1000000n, 1616961n, 2n];
        const judges = [judge1TokenId].map(id => Buffer.from(id, "hex"));
        const pkBytes = Buffer.from("02910cc52aa89e392d2715fc556aea54d5d4d81ccca937a11481771d37395c39b7", "hex");
        const jsonBytes = stringToBytes("utf8", '{"title":"TEST V1","description":"","imageURL":"","webLink":"","serviceId":"d19a3da7d5a202f11a330dc5557c27ca0faa175ed59ee5ffaced72e6cb226858b72d","mirrorUrls":[]}');

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 1000000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: 1616921,
            additionalRegisters: {
                R4: SInt(1).toHex(), // Estado: Resolución
                R5: SPair(SColl(SByte, secret), SColl(SByte, invalidatedCommitment)).toHex(),
                R6: SColl(SColl(SByte), judges).toHex(),
                R7: SColl(SLong, numericalParams).toHex(),
                R8: SPair(SColl(SByte, pkBytes), SLong(40n)).toHex(),
                R9: SPair(SColl(SByte, pkBytes), SColl(SByte, jsonBytes)).toHex()
            }
        });
        gameResolutionBox = gameResolutionContract.utxos.toArray()[0];

        // 4. Crear cajas `participation_resolved`
        const invalidatedSolverIdBytes = Buffer.from("9b0ff243323604c8dfd02629e8a63bce19bc58d813986cb19d4e8d721a57b15f", "utf-8");
        const invalidatedLogsBytes = Buffer.from("23739dc0c5f61dd85a363872cc337e57e109f1b04b945ad6790a293425150cc8", "hex");
        participationContract.addUTxOs({ // Ganador a ser invalidado
            ergoTree: participationErgoTree.toHex(),
            value: 1000000n,
            creationHeight: 1616921,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, pkBytes).toHex(),
                R5: SColl(SByte, invalidatedCommitment).toHex(),
                R6: SColl(SByte, Buffer.from(gameNftId, "hex")).toHex(),
                R7: SColl(SByte, invalidatedSolverIdBytes).toHex(),
                R8: SColl(SByte, invalidatedLogsBytes).toHex(),
                R9: SColl(SLong, [100n, 200n, 23n, 300n, 2n, 203n]).toHex(),
            }
        });
        invalidatedWinnerBox = participationContract.utxos.toArray()[0];

        const nextSolverIdBytes = Buffer.from("85278ef8896bd70c2537a30fc686388b1c3cd7bf991e2dcdb03de223ecd78bc6", "utf-8");
        const nextLogsBytes = hexToBytes("4132b3d13f16f7ba7a2d0d3c926bb817987825793bec7e8379a0cc3c91ab75bc")!;
        participationContract.addUTxOs({ // Próximo candidato a ganador
            ergoTree: participationErgoTree.toHex(),
            value: 1000000n,
            creationHeight: 1616921,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, pkBytes).toHex(),
                R5: SColl(SByte, nextWinnerCommitment).toHex(),
                R6: SColl(SByte, hexToBytes(gameNftId)!).toHex(),
                R7: SColl(SByte, nextSolverIdBytes).toHex(),
                R8: SColl(SByte, nextLogsBytes).toHex(),
                R9: SColl(SLong, [50n, 34n, 10n, 40n, 34n, 1200n, 20n]).toHex(),
            }
        });
        nextWinnerBox = participationContract.utxos.toArray()[1];

        // Check commitment
        console.log("Debug info for commitment check:");
        console.log("Secret (hex):", Buffer.from(secret).toString("hex"));
        console.log("Next solver id (hex):", Buffer.from(nextSolverIdBytes).toString("hex"));
        console.log("Next logs (hex):", Buffer.from(nextLogsBytes).toString("hex"));
        console.log("Expected commitment (hex):", Buffer.from(nextWinnerCommitment).toString("hex"));
        const dataToHash = new Uint8Array([
                    ...nextSolverIdBytes,
                    ...bigintToLongByteArray(BigInt(40)),
                    ...nextLogsBytes,
                    ...secret
                ]);
        const testCommitment = blake2b256(dataToHash);
        console.log("Calculated commitment:", Buffer.from(testCommitment).toString("hex"));
        console.log("Expected commitment:  ", Buffer.from(nextWinnerCommitment).toString("hex"));
        expect(Buffer.from(testCommitment).toString("hex")).to.equal(Buffer.from(nextWinnerCommitment).toString("hex"));

        // 5. Crear cajas `reputation_proof` para los jueces (los votos)
        const dummyTypeNftId = Buffer.from("f6819e0b7cf99c8c7872b62f4985b8d900c6150925d01eb279787517a848b6d8", "hex");
        const judgePropositionBytes = Buffer.from("cedca8dc7be135c9ae7cae80a953cb3d798d4956cc7b3fac10a4cb1f4a092984", "hex");
        const nullBytes = Buffer.from("6e756c6c", "hex");
        reputationProofContract.addUTxOs(
            { // Voto del Juez 1
                creationHeight: 1616923,
                ergoTree: reputationProofErgoTree.toHex(),
                value: 1000000n,
                assets: [{ tokenId: judge1TokenId, amount: 1n }],
                additionalRegisters: {
                    R4: SColl(SByte, dummyTypeNftId).toHex(),
                    R5: SColl(SByte, invalidatedCommitment).toHex(),
                    R6: SPair(SBool(true), SLong(1000000n)).toHex(),
                    R7: SColl(SByte, judgePropositionBytes).toHex(),
                    R8: SBool(false).toHex(),
                    R9: SColl(SByte, nullBytes).toHex(),
                }
            }
        );
        judge1ReputationBox = reputationProofContract.utxos.toArray()[0];

        // --- Estado Esperado de la Nueva Caja de Juego ---
        const newFunds = gameResolutionBox.value + invalidatedWinnerBox.value;
        const extendedDeadline = 1616961n + JUDGE_PERIOD;
        const decrementedCounter = 1n;
        const newNumericalParams = [1616920n, 1000000n, 1000000n, extendedDeadline, decrementedCounter];

        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, invalidatedWinnerBox, ...resolver.utxos.toArray()])
            .to([
                new OutputBuilder(newFunds, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        ...gameResolutionBox.additionalRegisters,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, nextWinnerCommitment)).toHex(), // Nuevo candidato
                        R7: SColl(SLong, newNumericalParams).toHex(), // Parámetros actualizados
                    })
            ])
            .withDataFrom([judge1ReputationBox, nextWinnerBox]) // Los votos de los jueces y las participaciones no invalidadas
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

        // 3. El deadline de resolución se ha extendido y el contador de participantes resueltos ha disminuido
        const newR7 = newGameBox.additionalRegisters.R7;
        expect(newR7).to.equal(SColl(SLong, newNumericalParams).toHex());

        // 4. Las cajas gastadas ya no existen
        expect(gameResolutionContract.utxos.toArray().find(b => b.boxId === gameResolutionBox.boxId)).to.be.undefined;
        expect(participationContract.utxos.toArray().find(b => b.boxId === invalidatedWinnerBox.boxId)).to.be.undefined;
    });
});
