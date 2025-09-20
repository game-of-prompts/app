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
import { bigintToLongByteArray, generate_pk_proposition, uint8ArrayToHex } from "$lib/ergo/utils";
import { PARTICIPATION } from "$lib/ergo/reputation/types";

// --- Configuración de Constantes y Carga de Contratos ---
const contractsDir = path.resolve(__dirname, "..", "contracts");
const GAME_RESOLUTION_TEMPLATE = fs.readFileSync(path.join(contractsDir, "game_resolution.es"), "utf-8");

const DIGITAL_PUBLIC_GOOD_SCRIPT = fs.readFileSync(path.join(contractsDir, "reputation_system", "digital_public_good.es"), "utf-8")
const digitalPublicGoodErgoTree = compile(DIGITAL_PUBLIC_GOOD_SCRIPT, { version: 1 });
const digital_public_good_script_hash = digitalPublicGoodErgoTree.toHex();
const REPUTATION_PROOF_SOURCE = fs.readFileSync(path.join(contractsDir, "reputation_system", "reputation_proof.es"), "utf-8").replace(/`\+DIGITAL_PUBLIC_GOOD_SCRIPT_HASH\+`/g, digital_public_good_script_hash);

const PARTICIPATION_RESOLVED_SOURCE = fs.readFileSync(path.join(contractsDir, "participation_resolved.es"), "utf-8");
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
    let participationResolvedContract: ReturnType<MockChain["newParty"]>;
    let reputationProofContract: ReturnType<MockChain["newParty"]>;
    
    // --- ErgoTrees de Contratos ---
    let gameResolutionErgoTree: ReturnType<typeof compile>;
    let participationResolvedErgoTree: ReturnType<typeof compile>;
    let reputationProofErgoTree: ReturnType<typeof compile>;

    // --- Estado del Juego ---
    const currentHeight = 800_000;
    const resolutionDeadline = BigInt(currentHeight) + JUDGE_PERIOD;
    const gameNftId = "33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aa";
    const secret = stringToBytes("utf8", "secret-for-invalidation-test");

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
        mockChain.reset();
        mockChain.jumpTo(currentHeight);

        // --- Compilar Contratos ---
        participationResolvedErgoTree = compile(PARTICIPATION_RESOLVED_SOURCE);
        
        // Asumimos que no necesitamos el hash de 'submitted' para este test
        const dummySubmittedHash = "0".repeat(64);

        const resolutionSource = GAME_RESOLUTION_TEMPLATE
            .replace("`+PARTICIPATION_RESOLVED_SCRIPT_HASH+`", uint8ArrayToHex(blake2b256(participationResolvedErgoTree.bytes)))
            .replace("`+PARTICIPATION_SUBMITTED_SCRIPT_HASH+`", dummySubmittedHash)
            .replace("`+REPUTATION_PROOF_SCRIPT_HASH+`", uint8ArrayToHex(blake2b256(compile(REPUTATION_PROOF_SOURCE).bytes)))
            .replace("`+PARTICIPATION_TYPE_ID+`", PARTICIPATION)
            .replace("`+DEV_ADDR+`", DEV_ADDR_BASE58);
        gameResolutionErgoTree = compile(resolutionSource);
        reputationProofErgoTree = compile(REPUTATION_PROOF_SOURCE);

        // --- Añadir Partidos de Contratos al MockChain ---
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationResolvedContract = mockChain.addParty(participationResolvedErgoTree.toHex(), "ParticipationResolved");
        reputationProofContract = mockChain.addParty(reputationProofErgoTree.toHex(), "ReputationProof");
    });

    it("should successfully invalidate the current winner with a majority of judge votes (2 out of 3)", () => {
        // --- Crear Estado Inicial del Juego ---

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
                R9: SColl(SLong, [100n, 200n, 23n, 230n, 300n, 1000n, 2n, 3n, 10n, 2n]).toHex(),
            }
        });
        invalidatedWinnerBox = participationResolvedContract.utxos.toArray()[0];

        participationResolvedContract.addUTxOs({ // Próximo candidato a ganador
            ergoTree: participationResolvedErgoTree.toHex(),
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
        nextWinnerBox = participationResolvedContract.utxos.toArray()[1];

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

        // --- Crear Estado Inicial del Juego ---

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
                R9: SColl(SLong, [100n, 200n, 23n, 230n, 300n, 1000n, 2n, 3n, 10n, 2n]).toHex(),
            }
        });
        invalidatedWinnerBox = participationResolvedContract.utxos.toArray()[0];

        participationResolvedContract.addUTxOs({ // Próximo candidato a ganador
            ergoTree: participationResolvedErgoTree.toHex(),
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
        nextWinnerBox = participationResolvedContract.utxos.toArray()[1];

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
                R9: SColl(SLong, [100n, 200n, 23n, 230n, 300n, 1000n, 2n, 3n, 10n, 2n]).toHex(),
            }
        });
        invalidatedWinnerBox = participationResolvedContract.utxos.toArray()[0];

        participationResolvedContract.addUTxOs({ // Próximo candidato a ganador
            ergoTree: participationResolvedErgoTree.toHex(),
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
        nextWinnerBox = participationResolvedContract.utxos.toArray()[1];

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

        // 1. Generar compromisos para los participantes
        invalidatedCommitment = createCommitment("solver-invalid", 230n, "logs-invalid", secret);
        nextWinnerCommitment = createCommitment("solver-next-winner", 100n, "logs-next-winner", secret);
        extraParticipantCommitment = createCommitment("solver-extra-participant", 5n, "logs-extra-participant", secret);

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
                R9: SColl(SLong, [100n, 200n, 23n, 230n, 300n, 1000n, 2n, 3n, 10n, 2n]).toHex(),
            }
        });
        invalidatedWinnerBox = participationResolvedContract.utxos.toArray()[0];

        participationResolvedContract.addUTxOs({ // Próximo candidato a ganador
            ergoTree: participationResolvedErgoTree.toHex(),
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
        nextWinnerBox = participationResolvedContract.utxos.toArray()[1];

        participationResolvedContract.addUTxOs({
            ergoTree: participationResolvedErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: mockChain.height - 30,  // We resolved the game 30 blocks ago, still within the judge period.
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, extraParticipant.key.publicKey).toHex(),
                R5: SColl(SByte, extraParticipantCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-extra-participant")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-extra-participant")).toHex(),
                R9: SColl(SLong, [20n, 2n, 300n, 1n, 5n, 300n, 3n, 1200n]).toHex(),
            }
        });
        extraParticipantBox = participationResolvedContract.utxos.toArray()[2];

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







        mockChain.newBlocks(Number(JUDGE_PERIOD) + 1); // Avanzar el tiempo más allá del deadline
        
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
           .withDataFrom([judge1ReputationBox, judge2ReputationBox])
           .sendChangeTo(resolver.address)
           .payFee(RECOMMENDED_MIN_FEE_VALUE)
           .build();

        const executionResult = mockChain.execute(tx, { signers: [resolver], throw: false });
        expect(executionResult).to.be.false;
    });

    // Escenario con un único juez (1 de 1)
    it("should successfully invalidate the current winner with a majority of judge votes (1 out of 1)", () => {
                // --- Crear Estado Inicial del Juego ---

        // 1. Generar compromisos para los participantes
        invalidatedCommitment = createCommitment("solver-invalid", 230n, "logs-invalid", secret);
        nextWinnerCommitment = createCommitment("solver-next-winner", 100n, "logs-next-winner", secret);

        // 2. Crear tokens de reputación para los jueces
        judge1TokenId = Buffer.from(randomBytes(32)).toString("hex");

        // 3. Crear la caja `game_resolution`
        const numericalParams: bigint[] = [700_000n, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 2n];
        const singleJudge = [Buffer.from(judge1TokenId, "hex")];

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 5,
            additionalRegisters: {
                R4: SInt(1).toHex(), // Estado: Resolución
                R5: SPair(SColl(SByte, secret), SColl(SByte, invalidatedCommitment)).toHex(),
                R6: SColl(SColl(SByte), singleJudge).toHex(), // Solo un juez
                R7: SColl(SLong, numericalParams).toHex(),
                R8: SPair(SColl(SByte, resolver.key.publicKey), SLong(10n)).toHex(),
                R9: SPair(SColl(SByte, resolver.key.publicKey), SColl(SByte, stringToBytes("utf8", "{}"))).toHex()
            }
        });

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
                R9: SColl(SLong, [100n, 200n, 23n, 230n, 300n, 1000n, 2n, 3n, 10n, 2n]).toHex(),
            }
        });
        invalidatedWinnerBox = participationResolvedContract.utxos.toArray()[0];

        participationResolvedContract.addUTxOs({ // Próximo candidato a ganador
            ergoTree: participationResolvedErgoTree.toHex(),
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
        nextWinnerBox = participationResolvedContract.utxos.toArray()[1];

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
        judge1ReputationBox = reputationProofContract.utxos.toArray()[0];

        console.log("Current height before new blocks:", mockChain.height);
        mockChain.newBlocks(30);
        console.log("Current height after new blocks:", mockChain.height);

        // Obtener la nueva caja añadida (última)
        const utxos = gameResolutionContract.utxos.toArray();
        console.log("All game resolution boxes:", utxos);
        const singleJudgeGameBox = utxos[utxos.length - 1];

        const currentHeight = mockChain.height;
        const newFunds = singleJudgeGameBox.value + invalidatedWinnerBox.value;
        const extendedDeadline = BigInt(resolutionDeadline) + JUDGE_PERIOD;
        const decrementedCounter = 1n;
        const newNumericalParams = [700_000n, 2_000_000_000n, 1_000_000n, extendedDeadline, decrementedCounter];

        const tx = new TransactionBuilder(currentHeight)
            .from([singleJudgeGameBox, invalidatedWinnerBox, ...resolver.utxos.toArray()])
            .to([
                new OutputBuilder(newFunds, gameResolutionContract.address)
                    .addTokens(singleJudgeGameBox.assets)
                    .setAdditionalRegisters({
                        ...singleJudgeGameBox.additionalRegisters,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, nextWinnerCommitment)).toHex(),
                        R7: SColl(SLong, newNumericalParams).toHex(),
                    })
            ])
            .withDataFrom([judge1ReputationBox, nextWinnerBox])
            .sendChangeTo(resolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const executionResult = mockChain.execute(tx, { signers: [resolver] });
        expect(executionResult).to.be.true;

        // Verificaciones similares a las del test exitoso anterior
        const newGameBoxes = gameResolutionContract.utxos.toArray();
        console.log("New game boxes:", newGameBoxes);
        console.log("Expected new funds:", newFunds);
        console.log("Expected new numerical params:", newNumericalParams);
        const createdNewGameBox = newGameBoxes.find(b => b.value === newFunds && b.additionalRegisters.R7 === SColl(SLong, newNumericalParams).toHex());
        expect(createdNewGameBox).to.not.be.undefined;
        expect(createdNewGameBox!.additionalRegisters.R5).to.equal(SPair(SColl(SByte, secret), SColl(SByte, nextWinnerCommitment)).toHex());
    });

    it("should successfully invalidate the current winner with a majority of judge votes (1 out of 1) with an extra participant", () => {
        // Creamos una nueva caja de game_resolution que solo tenga a judge1 como juez
        const numericalParams: bigint[] = [700_000n, 2_000_000_000n, 1_000_000n, BigInt(resolutionDeadline), 3n];
        const singleJudge = [Buffer.from(judge1TokenId, "hex")];

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: 800_000,  // The previous game gox was created at height 800_000, because of that, the current resolution deadline is 800_040. To be able to invalidate, we need to create this new box at the same height, so the deadline remains the same.
            additionalRegisters: {
                R4: SInt(1).toHex(), // Estado: Resolución
                R5: SPair(SColl(SByte, secret), SColl(SByte, invalidatedCommitment)).toHex(),
                R6: SColl(SColl(SByte), singleJudge).toHex(), // Solo un juez
                R7: SColl(SLong, numericalParams).toHex(),
                R8: SPair(SColl(SByte, resolver.key.publicKey), SLong(10n)).toHex(),
                R9: SPair(SColl(SByte, resolver.key.publicKey), SColl(SByte, stringToBytes("utf8", "{}"))).toHex()
            }
        });

        // Obtener la nueva caja añadida (última)
        const utxos = gameResolutionContract.utxos.toArray();
        const singleJudgeGameBox = utxos[utxos.length - 1];

        const currentHeight = mockChain.height;
        const newFunds = singleJudgeGameBox.value + invalidatedWinnerBox.value;
        const extendedDeadline = BigInt(resolutionDeadline) + JUDGE_PERIOD;
        const decrementedCounter = 2n;
        const newNumericalParams = [700_000n, 2_000_000_000n, 1_000_000n, extendedDeadline, decrementedCounter];
        const tx_height = currentHeight + 50; // Intentamos crear la transacción 50 bloques después del current height, es decir, 10 bloques después del resolution deadline.

        console.log("Current height:", currentHeight);
        console.log("Resolution deadline:", resolutionDeadline);
        console.log("Tx hegiht:", tx_height);
        console.log("extended deadline:", extendedDeadline);
       
        /*
Current height: 800000
Resolution deadline: 800040n
Tx hegiht: 800050
extended deadline: 800080n
        */

        mockChain.jumpTo(tx_height);
        const tx = new TransactionBuilder(tx_height)  // ¿Porqué pasa este test si se resuelve pasado el resolution deadline?
            .from([singleJudgeGameBox, invalidatedWinnerBox, ...resolver.utxos.toArray()])
            .to([
                new OutputBuilder(newFunds, gameResolutionErgoTree)
                    .addTokens(singleJudgeGameBox.assets)
                    .setAdditionalRegisters({
                        ...singleJudgeGameBox.additionalRegisters,
                        R5: SPair(SColl(SByte, secret), SColl(SByte, nextWinnerCommitment)).toHex(),
                        R7: SColl(SLong, newNumericalParams).toHex(),
                    })
            ])
            .withDataFrom([judge1ReputationBox, nextWinnerBox, extraParticipantBox])
            .sendChangeTo(resolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const executionResult = mockChain.execute(tx, { signers: [resolver] });
        expect(executionResult).to.be.true;

        // Verificaciones similares a las del test exitoso anterior
        const newGameBoxes = gameResolutionContract.utxos.toArray();
        const createdNewGameBox = newGameBoxes.find(b => b.value === newFunds && b.additionalRegisters.R7 === SColl(SLong, newNumericalParams).toHex());
        expect(createdNewGameBox).to.not.be.undefined;
        expect(createdNewGameBox!.additionalRegisters.R5).to.equal(SPair(SColl(SByte, secret), SColl(SByte, nextWinnerCommitment)).toHex());
    });

});
