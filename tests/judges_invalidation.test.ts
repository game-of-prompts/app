import { beforeEach, describe, expect, it } from "vitest";
import { MockChain } from "@fleet-sdk/mock-chain";
import {
    Box,
    ErgoTree,
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
    SBool} from "@fleet-sdk/serializer";
import { blake2b256, randomBytes } from "@fleet-sdk/crypto";
import { stringToBytes } from "@scure/base";
import { bigintToLongByteArray, generate_pk_proposition, hexToBytes } from "$lib/ergo/utils";
import { prependHexPrefix } from "$lib/utils";
import { getGopGameResolutionErgoTree, getGopParticipationErgoTree, getReputationProofErgoTree } from "$lib/ergo/contract";
import { DefaultGameConstants } from "$lib/common/constants";

const JUDGE_PERIOD = BigInt(DefaultGameConstants.JUDGE_PERIOD + 10); // Debe coincidir con el valor en game_resolution.es mas cierto margen que se debe de dejar (ya que parece que el constructor de la transacción adelanta algunos bloques a proposito).

const seed = "a3f9b7e12c9d55ab8068e3ff22b7a19c34d8f1cbeaa1e9c0138b82f00d5ea712";

// Helper para crear un hash de compromiso
const createCommitment = (solverId: string, score: bigint, logs: string, ergoTree: Uint8Array, secret: Uint8Array): Uint8Array => {
    return blake2b256(new Uint8Array([...stringToBytes("utf8", solverId), ...hexToBytes(seed), ...bigintToLongByteArray(score), ...stringToBytes("utf8", logs), ...ergoTree, ...secret]));
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
    let gameResolutionErgoTree: ErgoTree = getGopGameResolutionErgoTree();
    let participationErgoTree: ErgoTree = getGopParticipationErgoTree();
    let reputationProofErgoTree: ErgoTree = getReputationProofErgoTree();

    // --- Estado del Juego ---
    const currentHeight = 800_000;
    const resolutionDeadline = BigInt(currentHeight) + JUDGE_PERIOD;
    const gameNftId = "33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aa";
    let secret = stringToBytes("utf8", "secret-for-invalidation-test");

    let gameResolutionBox: Box;
    let invalidatedWinnerBox: Box;
    let nextWinnerBox: Box;
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
    });

    it("should successfully invalidate the current winner with a majority of judge votes (2 out of 3)", () => {
        // --- Crear Estado Inicial del Juego ---

        // --- Añadir Partidos de Contratos al MockChain ---
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "Participation");
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
        invalidatedCommitment = createCommitment("solver-invalid", 230n, "logs-invalid", prependHexPrefix(invalidatedWinner.address.getPublicKeys()[0]), secret);
        nextWinnerCommitment = createCommitment("solver-next-winner", 100n, "logs-next-winner", prependHexPrefix(nextWinner.address.getPublicKeys()[0]), secret);

        // 2. Crear tokens de reputación para los jueces
        judge1TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge2TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge3TokenId = Buffer.from(randomBytes(32)).toString("hex");

        // 3. Crear la caja `game_resolution`
        const numericalParams: bigint[] = [700_000n, 2_000_000_000n, 1_000_000n, 1n, BigInt(resolutionDeadline)];
        const judges = [judge1TokenId, judge2TokenId, judge3TokenId].map(id => Buffer.from(id, "hex"));

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 30,
            additionalRegisters: {
                // Estado del juego
                R4: SInt(1).toHex(),

                
                R5: SColl(SByte, hexToBytes(seed) ?? "").toHex(),

                // (revealedSecretS, winnerCandidateCommitment)
                R6: SPair(
                    SColl(SByte, secret),
                    SColl(SByte, invalidatedCommitment)
                ).toHex(),

                // participatingJudges
                R7: SColl(SColl(SByte), judges).toHex(),

                // numericalParameters: [deadline, creatorStake, participationFee, perJudgeCommissionPercent, creatorComissionPercentage, resolutionDeadline]
                R8: SColl(SLong, [
                    BigInt(numericalParams[0]), // deadline
                    numericalParams[1],         // creatorStake
                    numericalParams[2],         // participationFee
                    numericalParams[3],         // perJudgeCommissionPercent
                    10n,                         // creatorComissionPercentage
                    BigInt(numericalParams[4])  // resolutionDeadline
                ]).toHex(),

                // gameProvenance (R9) corregido: Coll[Coll[Byte]] con elementos planos
                R9: SColl(SColl(SByte), [
                    stringToBytes("utf8", "{}"),  "",                   // detalles del juego
                    
                    prependHexPrefix(resolver.key.publicKey, "0008cd")  // script resolvedor
                ]).toHex()
            }
        });

        gameResolutionBox = gameResolutionContract.utxos.toArray()[0];

        // 4. Crear cajas `participation`
        participationContract.addUTxOs({ // Ganador a ser invalidado
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: 700_000 - 30,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, prependHexPrefix(invalidatedWinner.address.getPublicKeys()[0])).toHex(),
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
            creationHeight: 700_000 - 30,  
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte,  prependHexPrefix(nextWinner.address.getPublicKeys()[0])).toHex(),
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
                    R6: SBool(true).toHex(),
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
                    R6: SBool(true).toHex(),
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
        const newNumericalParams = [
                    BigInt(numericalParams[0]), // deadline
                    numericalParams[1],         // creatorStake
                    numericalParams[2],         // participationFee
                    numericalParams[3],         // perJudgeCommissionPercent
                    10n,                         // creatorComissionPercentage
                    extendedDeadline  // resolutionDeadline
        ];
        
        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, invalidatedWinnerBox, ...resolver.utxos.toArray()])
            .to([
                new OutputBuilder(newFunds, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        // Estado del juego
                        R4: SInt(1).toHex(),

                        
                        R5: SColl(SByte, hexToBytes(seed) ?? "").toHex(),

                        // (revealedSecretS, winnerCandidateCommitment)
                        R6: SPair(
                            SColl(SByte, secret),
                            SColl(SByte, nextWinnerCommitment)
                        ).toHex(),

                        // participatingJudges
                        R7: SColl(SColl(SByte), judges).toHex(),

                        // numericalParameters: [deadline, creatorStake, participationFee, perJudgeCommissionPercent, creatorComissionPercentage, resolutionDeadline]
                        R8: SColl(SLong, newNumericalParams).toHex(),

                        // gameProvenance (R9) corregido: Coll[Coll[Byte]] con elementos planos
                        R9: SColl(SColl(SByte), [
                            stringToBytes("utf8", "{}"),  "",                       // detalles del juego
                            
                            prependHexPrefix(resolver.key.publicKey, "0008cd")  // script resolvedor
                        ]).toHex()
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
        const newR6 = newGameBox.additionalRegisters.R6;
        expect(newR6).to.equal(SPair(SColl(SByte, secret), SColl(SByte, nextWinnerCommitment)).toHex());
        
        // 3. El deadline de resolución se ha extendido y el contador de participantes resueltos ha disminuido
        const newR8 = newGameBox.additionalRegisters.R8;
        expect(newR8).to.equal(SColl(SLong, newNumericalParams).toHex());

        // 4. Las cajas gastadas ya no existen
        expect(gameResolutionContract.utxos.toArray().find(b => b.boxId === gameResolutionBox.boxId)).to.be.undefined;
        expect(participationContract.utxos.toArray().find(b => b.boxId === invalidatedWinnerBox.boxId)).to.be.undefined;
    });

    it("should successfully invalidate the current winner with a majority of judge votes (1 out of 1)", () => {
        // --- Crear Estado Inicial del Juego ---

        // --- Añadir Partidos de Contratos al MockChain ---
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "Participation");
        reputationProofContract = mockChain.addParty(reputationProofErgoTree.toHex(), "ReputationProof");

        // --- Inicializar Actores ---
        resolver = mockChain.newParty("Resolver");
        invalidatedWinner = mockChain.newParty("InvalidatedWinner");
        nextWinner = mockChain.newParty("NextWinner");
        judge1 = mockChain.newParty("Judge1");
        resolver.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });

        // 1. Generar compromisos para los participantes
        invalidatedCommitment = createCommitment("solver-invalid", 230n, "logs-invalid", prependHexPrefix( invalidatedWinner.address.getPublicKeys()[0]), secret);
        nextWinnerCommitment = createCommitment("solver-next-winner", 100n, "logs-next-winner", prependHexPrefix(nextWinner.address.getPublicKeys()[0]), secret);

        // 2. Crear tokens de reputación para los jueces
        judge1TokenId = Buffer.from(randomBytes(32)).toString("hex");

        // 3. Crear la caja `game_resolution`
        const numericalParams: bigint[] = [700_000n, 2_000_000_000n, 1_000_000n, 1n, BigInt(resolutionDeadline)];
        const judges = [judge1TokenId].map(id => Buffer.from(id, "hex"));

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 30,
            additionalRegisters: {
                // Estado del juego
                R4: SInt(1).toHex(),

                // Nuevo SEED (32 bytes aleatorios)
                R5: SColl(SByte, hexToBytes(seed) ?? "").toHex(),

                // (revealedSecretS, winnerCandidateCommitment)
                R6: SPair(
                    SColl(SByte, secret),
                    SColl(SByte, invalidatedCommitment)
                ).toHex(),

                // participatingJudges
                R7: SColl(SColl(SByte), judges).toHex(),

                // numericalParameters: [deadline, creatorStake, participationFee, perJudgeCommissionPercent, creatorComissionPercentage, resolutionDeadline]
                R8: SColl(SLong, [
                    BigInt(numericalParams[0]), // deadline
                    numericalParams[1],         // creatorStake
                    numericalParams[2],         // participationFee
                    numericalParams[3],         // perJudgeCommissionPercent
                    10n,                 // creatorComissionPercentage
                    BigInt(numericalParams[4])  // resolutionDeadline
                ]).toHex(),

                // gameProvenance (R9) corregido: Coll[Coll[Byte]] con elementos planos
                R9: SColl(SColl(SByte), [
                    stringToBytes("utf8", "{}"),  "",                    // detalles del juego
                    
                    prependHexPrefix(resolver.key.publicKey, "0008cd")  // script resolvedor
                ]).toHex()
            }
        });
        gameResolutionBox = gameResolutionContract.utxos.toArray()[0];

        // 4. Crear cajas `participation`
        participationContract.addUTxOs({ // Ganador a ser invalidado
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: 700_000 - 30,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, prependHexPrefix( invalidatedWinner.address.getPublicKeys()[0])).toHex(),
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
            creationHeight: 700_000 - 30,  
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte,  prependHexPrefix(nextWinner.address.getPublicKeys()[0])).toHex(),
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
                    R6: SBool(true).toHex(),
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
                    R6: SBool(true).toHex(),
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
        const newNumericalParams = [
                                BigInt(numericalParams[0]), // deadline
                                numericalParams[1],         // creatorStake
                                numericalParams[2],         // participationFee
                                numericalParams[3],         // perJudgeCommissionPercent
                                10n,                 // creatorComissionPercentage
                                extendedDeadline // resolutionDeadline
                            ]
        
        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, invalidatedWinnerBox, ...resolver.utxos.toArray()])
            .to([
                new OutputBuilder(newFunds, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters(
                        {
                            // Estado del juego
                            R4: SInt(1).toHex(),

                            // Nuevo SEED (32 bytes aleatorios)
                            R5: SColl(SByte, hexToBytes(seed) ?? "").toHex(),

                            // (revealedSecretS, winnerCandidateCommitment)
                            R6: SPair(
                                SColl(SByte, secret),
                                SColl(SByte, nextWinnerCommitment)
                            ).toHex(),

                            // participatingJudges
                            R7: SColl(SColl(SByte), judges).toHex(),

                            // numericalParameters: [deadline, creatorStake, participationFee, perJudgeCommissionPercent, creatorComissionPercentage, resolutionDeadline]
                            R8: SColl(SLong, newNumericalParams).toHex(),

                            // gameProvenance (R9) corregido: Coll[Coll[Byte]] con elementos planos
                            R9: SColl(SColl(SByte), [
                                stringToBytes("utf8", "{}"),  "",                    // detalles del juego
                                
                                prependHexPrefix(resolver.key.publicKey, "0008cd")  // script resolvedor
                            ]).toHex()
                        }
                    )
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
        const newR6= newGameBox.additionalRegisters.R6;
        expect(newR6).to.equal(SPair(SColl(SByte, secret), SColl(SByte, nextWinnerCommitment)).toHex());
        
        // 3. El deadline de resolución se ha extendido y el contador de participantes resueltos ha disminuido
        const newR8 = newGameBox.additionalRegisters.R8;
        expect(newR8).to.equal(SColl(SLong, newNumericalParams).toHex());

        // 4. Las cajas gastadas ya no existen
        expect(gameResolutionContract.utxos.toArray().find(b => b.boxId === gameResolutionBox.boxId)).to.be.undefined;
        expect(participationContract.utxos.toArray().find(b => b.boxId === invalidatedWinnerBox.boxId)).to.be.undefined;
    });

    it("should successfully invalidate the current winner with more than two current participants", () => {
        // --- Crear Estado Inicial del Juego ---

        // --- Añadir Partidos de Contratos al MockChain ---
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "Participation");
        reputationProofContract = mockChain.addParty(reputationProofErgoTree.toHex(), "ReputationProof");

        // --- Inicializar Actores ---
        resolver = mockChain.newParty("Resolver");
        invalidatedWinner = mockChain.newParty("InvalidatedWinner");
        nextWinner = mockChain.newParty("NextWinner");
        extraParticipant = mockChain.newParty("ExtraParticipant");
        judge1 = mockChain.newParty("Judge1");
        resolver.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });

        // 1. Generar compromisos para los participantes
        invalidatedCommitment = createCommitment("solver-invalid", 230n, "logs-invalid",  prependHexPrefix(invalidatedWinner.address.getPublicKeys()[0]), secret);
        nextWinnerCommitment = createCommitment("solver-next-winner", 100n, "logs-next-winner", prependHexPrefix(nextWinner.address.getPublicKeys()[0]), secret);
        extraParticipantCommitment = createCommitment("solver-extra", 40n, "logs-extra", prependHexPrefix(extraParticipant.address.getPublicKeys()[0]), secret);

        // 2. Crear tokens de reputación para los jueces
        judge1TokenId = Buffer.from(randomBytes(32)).toString("hex");

        // 3. Crear la caja `game_resolution`
        const numericalParams: bigint[] = [700_000n, 2_000_000_000n, 1_000_000n, 1n, BigInt(resolutionDeadline)];
        const judges = [judge1TokenId].map(id => Buffer.from(id, "hex"));

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 30,  
            additionalRegisters: {
                R4: SInt(1).toHex(), // Estado: Resolución
                R5: SColl(SByte, hexToBytes(seed) ?? "").toHex(),
                R6: SPair(
                        SColl(SByte, secret),
                        SColl(SByte, invalidatedCommitment)
                    ).toHex(),
                R7: SColl(SColl(SByte), judges).toHex(),
                R8: SColl(SLong, [
                    BigInt(numericalParams[0]), // deadline
                    numericalParams[1],         // creatorStake
                    numericalParams[2],         // participationFee
                    numericalParams[3],         // perJudgeCommissionPercent
                    10n,                 // creatorComissionPercentage
                    BigInt(numericalParams[4])  // resolutionDeadline
                ]).toHex(),
                 R9: SColl(SColl(SByte), [
                                stringToBytes("utf8", "{}"),  "",                    // detalles del juego
                                
                                prependHexPrefix(resolver.key.publicKey, "0008cd")  // script resolvedor
                            ]).toHex()
            }
        });
        gameResolutionBox = gameResolutionContract.utxos.toArray()[0];

        // 4. Crear cajas `participation`
        participationContract.addUTxOs({ // Ganador a ser invalidado
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: 700_000 - 30,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, prependHexPrefix( invalidatedWinner.address.getPublicKeys()[0])).toHex(),
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
            creationHeight: 700_000 - 30,  
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte,  prependHexPrefix(nextWinner.address.getPublicKeys()[0])).toHex(),
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
            creationHeight: 700_000 - 30,  
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte,  prependHexPrefix(extraParticipant.address.getPublicKeys()[0])).toHex(),
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
                    R6: SBool(true).toHex(),
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
                    R6: SBool(true).toHex(),
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
        const newNumericalParams = [
                            BigInt(numericalParams[0]), // deadline
                            numericalParams[1],         // creatorStake
                            numericalParams[2],         // participationFee
                            numericalParams[3],         // perJudgeCommissionPercent
                            10n,                 // creatorComissionPercentage
                            extendedDeadline  // resolutionDeadline
                        ];
        
        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, invalidatedWinnerBox, ...resolver.utxos.toArray()])
            .to([
                new OutputBuilder(newFunds, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters(
                        {
                            R4: SInt(1).toHex(), // Estado: Resolución
                            R5: SColl(SByte, hexToBytes(seed) ?? "").toHex(),
                            R6: SPair(
                                    SColl(SByte, secret),
                                    SColl(SByte, nextWinnerCommitment)
                                ).toHex(),
                            R7: SColl(SColl(SByte), judges).toHex(),
                            R8: SColl(SLong, newNumericalParams).toHex(),
                            R9: SColl(SColl(SByte), [
                                    stringToBytes("utf8", "{}"),  "",                    // detalles del juego
                                    
                                    prependHexPrefix(resolver.key.publicKey, "0008cd")  // script resolvedor
                                ]).toHex()
                        }
                    )
            ])
            .withDataFrom([judge1ReputationBox, nextWinnerBox]) // Los votos de los jueces y de la próxima candidata
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
        const newR6 = newGameBox.additionalRegisters.R6;
        expect(newR6).to.equal(SPair(SColl(SByte, secret), SColl(SByte, nextWinnerCommitment)).toHex());
        
        // 3. El deadline de resolución se ha extendido y el contador de participantes resueltos ha disminuido
        const newR8 = newGameBox.additionalRegisters.R8;
        expect(newR8).to.equal(SColl(SLong, newNumericalParams).toHex());

        // 4. Las cajas gastadas ya no existen
        expect(gameResolutionContract.utxos.toArray().find(b => b.boxId === gameResolutionBox.boxId)).to.be.undefined;
        expect(participationContract.utxos.toArray().find(b => b.boxId === invalidatedWinnerBox.boxId)).to.be.undefined;
        expect(participationContract.utxos.toArray().find(b => b.boxId === extraParticipantBox.boxId)).to.not.be.undefined; // The extra participant box should remain.
    });

    it("should successfully invalidate the current winner with no more participants", () => {
        // --- Crear Estado Inicial del Juego ---

        // --- Añadir Partidos de Contratos al MockChain ---
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "Participation");
        reputationProofContract = mockChain.addParty(reputationProofErgoTree.toHex(), "ReputationProof");

        // --- Inicializar Actores ---
        resolver = mockChain.newParty("Resolver");
        invalidatedWinner = mockChain.newParty("InvalidatedWinner");
        nextWinner = mockChain.newParty("NextWinner");
        extraParticipant = mockChain.newParty("ExtraParticipant");
        judge1 = mockChain.newParty("Judge1");
        resolver.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });

        // 1. Generar compromisos para los participantes
        invalidatedCommitment = createCommitment("solver-invalid", 230n, "logs-invalid",  prependHexPrefix(invalidatedWinner.address.getPublicKeys()[0]), secret);

        // 2. Crear tokens de reputación para los jueces
        judge1TokenId = Buffer.from(randomBytes(32)).toString("hex");

        // 3. Crear la caja `game_resolution`
        const numericalParams: bigint[] = [700_000n, 2_000_000_000n, 1_000_000n, 1n, BigInt(resolutionDeadline)];
        const judges = [judge1TokenId].map(id => Buffer.from(id, "hex"));

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 30,  
            additionalRegisters: {
                R4: SInt(1).toHex(), // Estado: Resolución
                R5: SColl(SByte, hexToBytes(seed) ?? "").toHex(),
                R6: SPair(
                        SColl(SByte, secret),
                        SColl(SByte, invalidatedCommitment)
                    ).toHex(),
                R7: SColl(SColl(SByte), judges).toHex(),
                R8: SColl(SLong, [
                    BigInt(numericalParams[0]), // deadline
                    numericalParams[1],         // creatorStake
                    numericalParams[2],         // participationFee
                    numericalParams[3],         // perJudgeCommissionPercent
                    10n,                 // creatorComissionPercentage
                    BigInt(numericalParams[4])  // resolutionDeadline
                ]).toHex(),
                 R9: SColl(SColl(SByte), [
                                stringToBytes("utf8", "{}"),  "",                    // detalles del juego
                                
                                prependHexPrefix(resolver.key.publicKey, "0008cd")  // script resolvedor
                            ]).toHex()
            }
        });
        gameResolutionBox = gameResolutionContract.utxos.toArray()[0];

        // 4. Crear cajas `participation`
        participationContract.addUTxOs({ // Ganador a ser invalidado
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: 700_000 - 30,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, prependHexPrefix( invalidatedWinner.address.getPublicKeys()[0])).toHex(),
                R5: SColl(SByte, invalidatedCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-invalid")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-invalid")).toHex(),
                R9: SColl(SLong, [100n, 200n, 23n, 230n, 300n, 1000n, 2n, 3n, 10n, 2n]).toHex(),
            }
        });
        invalidatedWinnerBox = participationContract.utxos.toArray()[0];

        expect(participationContract.utxos.toArray().length).to.equal(1);

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
                    R6: SBool(true).toHex(),
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
                    R6: SBool(true).toHex(),
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
        const newNumericalParams = [
                            BigInt(numericalParams[0]), // deadline
                            numericalParams[1],         // creatorStake
                            numericalParams[2],         // participationFee
                            numericalParams[3],         // perJudgeCommissionPercent
                            10n,                 // creatorComissionPercentage
                            extendedDeadline  // resolutionDeadline
                        ];
        
        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, invalidatedWinnerBox, ...resolver.utxos.toArray()])
            .to([
                new OutputBuilder(newFunds, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters(
                        {
                            R4: SInt(1).toHex(), // Estado: Resolución
                            R5: SColl(SByte, hexToBytes(seed) ?? "").toHex(),
                            R6: SPair(
                                    SColl(SByte, secret),
                                    SColl(SByte, [])
                                ).toHex(),
                            R7: SColl(SColl(SByte), judges).toHex(),
                            R8: SColl(SLong, newNumericalParams).toHex(),
                            R9: SColl(SColl(SByte), [
                                        stringToBytes("utf8", "{}"),  "",                    // detalles del juego
                                        
                                        prependHexPrefix(resolver.key.publicKey, "0008cd")  // script resolvedor
                                    ]).toHex()
                        }
                    )
            ])
            .withDataFrom([judge1ReputationBox]) // Los votos de los jueces y las participaciones no invalidadas
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
        const newR6 = newGameBox.additionalRegisters.R6;
        expect(newR6).to.equal(SPair(SColl(SByte, secret), SColl(SByte, [])).toHex());
        
        // 3. El deadline de resolución se ha extendido y el contador de participantes resueltos ha disminuido
        const newR8 = newGameBox.additionalRegisters.R8;
        expect(newR8).to.equal(SColl(SLong, newNumericalParams).toHex());

        // 4. Las cajas gastadas ya no existen
        expect(gameResolutionContract.utxos.toArray().find(b => b.boxId === gameResolutionBox.boxId)).to.be.undefined;
        expect(participationContract.utxos.toArray().find(b => b.boxId === invalidatedWinnerBox.boxId)).to.be.undefined;
    });

    it("should fail if there are not enough judge votes (1 out of 3)", () => {

        // --- Crear Estado Inicial del Juego ---

        // --- Añadir Partidos de Contratos al MockChain ---
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "Participation");
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
        invalidatedCommitment = createCommitment("solver-invalid", 230n, "logs-invalid",  prependHexPrefix(invalidatedWinner.address.getPublicKeys()[0]), secret);
        nextWinnerCommitment = createCommitment("solver-next-winner", 100n, "logs-next-winner", prependHexPrefix(nextWinner.address.getPublicKeys()[0]), secret);

        // 2. Crear tokens de reputación para los jueces
        judge1TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge2TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge3TokenId = Buffer.from(randomBytes(32)).toString("hex");

        // 3. Crear la caja `game_resolution`
        const numericalParams: bigint[] = [700_000n, 2_000_000_000n, 1_000_000n, 1n, BigInt(resolutionDeadline)];
        const judges = [judge1TokenId, judge2TokenId, judge3TokenId].map(id => Buffer.from(id, "hex"));

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 30,  
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

        // 4. Crear cajas `participation`
        participationContract.addUTxOs({ // Ganador a ser invalidado
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: 700_000 - 30,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte,  prependHexPrefix(invalidatedWinner.address.getPublicKeys()[0])).toHex(),
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
            creationHeight: 700_000 - 30,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte,  nextWinner.address.getPublicKeys()[0]).toHex(),
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
                    R6: SBool(true).toHex(),
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
                    R6: SBool(true).toHex(),
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
        const newNumericalParams = [700_000n, 2_000_000_000n, 1_000_000n, 1n, extendedDeadline];

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
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "Participation");
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
        invalidatedCommitment = createCommitment("solver-invalid", 230n, "logs-invalid",  prependHexPrefix(invalidatedWinner.address.getPublicKeys()[0]), secret);
        nextWinnerCommitment = createCommitment("solver-next-winner", 100n, "logs-next-winner", prependHexPrefix(nextWinner.address.getPublicKeys()[0]), secret);

        // 2. Crear tokens de reputación para los jueces
        judge1TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge2TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge3TokenId = Buffer.from(randomBytes(32)).toString("hex");

        // 3. Crear la caja `game_resolution`
        const numericalParams: bigint[] = [700_000n, 2_000_000_000n, 1_000_000n, 1n, BigInt(resolutionDeadline)];
        const judges = [judge1TokenId, judge2TokenId, judge3TokenId].map(id => Buffer.from(id, "hex"));

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 30,  
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

        // 4. Crear cajas `participation`
        participationContract.addUTxOs({ // Ganador a ser invalidado
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: 700_000 - 30,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte,  prependHexPrefix(invalidatedWinner.address.getPublicKeys()[0])).toHex(),
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
            creationHeight: 700_000 - 30,  
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte,  nextWinner.address.getPublicKeys()[0]).toHex(),
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
        const dummyInvalidInvalidatedCommitment = createCommitment("some-wrong-solver", 999n, "wrong-logs", prependHexPrefix(invalidatedWinner.address.getPublicKeys()[0]), secret);
        reputationProofContract.addUTxOs(
            { // Voto del Juez 1
                creationHeight: mockChain.height - 10,  // Judge opinion was formed 10 blocks ago, after resolve the game (30 blocks ago) and before judge period ends.
                ergoTree: reputationProofErgoTree.toHex(),
                value: 1_000_000n,
                assets: [{ tokenId: judge1TokenId, amount: 1n }],
                additionalRegisters: {
                    R4: SColl(SByte, dummyTypeNftId).toHex(),
                    R5: SColl(SByte, invalidatedCommitment).toHex(), // Vota contra el candidato
                    R6: SBool(true).toHex(),
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
                    R6: SBool(true).toHex(),
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
        const newNumericalParams = [700_000n, 2_000_000_000n, 1_000_000n, 1n, extendedDeadline];
        
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
    
    it("should fail if trying to invalidate after the judge period", () => {
        // --- Crear Estado Inicial del Juego ---

        // --- Añadir Partidos de Contratos al MockChain ---
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "Participation");
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
        invalidatedCommitment = createCommitment("solver-invalid", 230n, "logs-invalid",  prependHexPrefix(invalidatedWinner.address.getPublicKeys()[0]), secret);
        nextWinnerCommitment = createCommitment("solver-next-winner", 100n, "logs-next-winner", prependHexPrefix(nextWinner.address.getPublicKeys()[0]), secret);

        // 2. Crear tokens de reputación para los jueces
        judge1TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge2TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge3TokenId = Buffer.from(randomBytes(32)).toString("hex");

        // 3. Crear la caja `game_resolution`
        const numericalParams: bigint[] = [700_000n, 2_000_000_000n, 1_000_000n, 1n, BigInt(resolutionDeadline)];
        const judges = [judge1TokenId, judge2TokenId, judge3TokenId].map(id => Buffer.from(id, "hex"));

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 30,  
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

        // 4. Crear cajas `participation`
        participationContract.addUTxOs({ // Ganador a ser invalidado
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: 700_000 - 30,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, prependHexPrefix( invalidatedWinner.address.getPublicKeys()[0])).toHex(),
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
            creationHeight: 700_000 - 30,  
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte,  nextWinner.address.getPublicKeys()[0]).toHex(),
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
                    R6: SBool(true).toHex(),
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
                    R6: SBool(true).toHex(),
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
        const newNumericalParams = [700_000n, 2_000_000_000n, 1_000_000n, 1n, extendedDeadline];
        
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

    it("should fail if the new candidate was submitted after the deadline.", () => {
        // --- Crear Estado Inicial del Juego ---

        // --- Añadir Partidos de Contratos al MockChain ---
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "Participation");
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
        invalidatedCommitment = createCommitment("solver-invalid", 230n, "logs-invalid",  prependHexPrefix(invalidatedWinner.address.getPublicKeys()[0]), secret);
        nextWinnerCommitment = createCommitment("solver-next-winner", 100n, "logs-next-winner", prependHexPrefix(nextWinner.address.getPublicKeys()[0]), secret);

        // 2. Crear tokens de reputación para los jueces
        judge1TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge2TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge3TokenId = Buffer.from(randomBytes(32)).toString("hex");

        // 3. Crear la caja `game_resolution`
        const numericalParams: bigint[] = [700_000n, 2_000_000_000n, 1_000_000n, 1n, BigInt(resolutionDeadline)];
        const judges = [judge1TokenId, judge2TokenId, judge3TokenId].map(id => Buffer.from(id, "hex"));

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 30,  
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

        // 4. Crear cajas `participation`
        participationContract.addUTxOs({ // Ganador a ser invalidado
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: 700_000 - 30,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, prependHexPrefix( invalidatedWinner.address.getPublicKeys()[0])).toHex(),
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
            creationHeight: 700_000 + 30,  // Candidate created after deadline.
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte,  nextWinner.address.getPublicKeys()[0]).toHex(),
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
                    R6: SBool(true).toHex(),
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
                    R6: SBool(true).toHex(),
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
        const newNumericalParams = [700_000n, 2_000_000_000n, 1_000_000n, 1n, extendedDeadline];

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

    it("should fail if the new candidate has more scores than permitted.", () => {
        // --- Crear Estado Inicial del Juego ---

        // --- Añadir Partidos de Contratos al MockChain ---
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "Participation");
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
        invalidatedCommitment = createCommitment("solver-invalid", 230n, "logs-invalid",  prependHexPrefix(invalidatedWinner.address.getPublicKeys()[0]), secret);
        nextWinnerCommitment = createCommitment("solver-next-winner", 100n, "logs-next-winner", prependHexPrefix(nextWinner.address.getPublicKeys()[0]), secret);

        // 2. Crear tokens de reputación para los jueces
        judge1TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge2TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge3TokenId = Buffer.from(randomBytes(32)).toString("hex");

        // 3. Crear la caja `game_resolution`
        const numericalParams: bigint[] = [700_000n, 2_000_000_000n, 1_000_000n, 1n, BigInt(resolutionDeadline)];
        const judges = [judge1TokenId, judge2TokenId, judge3TokenId].map(id => Buffer.from(id, "hex"));

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 30,  
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

        // 4. Crear cajas `participation`
        participationContract.addUTxOs({ // Ganador a ser invalidado
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: 700_000 - 30,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, prependHexPrefix( invalidatedWinner.address.getPublicKeys()[0])).toHex(),
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
            creationHeight: 700_000 - 30,  // Candidate created after deadline.
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte,  nextWinner.address.getPublicKeys()[0]).toHex(),
                R5: SColl(SByte, nextWinnerCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-next-winner")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-next-winner")).toHex(),
                R9: SColl(SLong, [100n, 200n, 30n, 1200n, 20n, 1n, 200n, 33n, 2000n, 800n, 34n]).toHex(),  // 11 scores where 10 is the MAX_SCORE_LIST
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
                    R6: SBool(true).toHex(),
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
                    R6: SBool(true).toHex(),
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
        const newNumericalParams = [700_000n, 2_000_000_000n, 1_000_000n, 1n, extendedDeadline];

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

    it("should fail if the new candidate has less than the required participation fee.", () => {
        // --- Crear Estado Inicial del Juego ---

        // --- Añadir Partidos de Contratos al MockChain ---
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "Participation");
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
        invalidatedCommitment = createCommitment("solver-invalid", 230n, "logs-invalid",  prependHexPrefix(invalidatedWinner.address.getPublicKeys()[0]), secret);
        nextWinnerCommitment = createCommitment("solver-next-winner", 100n, "logs-next-winner", prependHexPrefix(nextWinner.address.getPublicKeys()[0]), secret);

        // 2. Crear tokens de reputación para los jueces
        judge1TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge2TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge3TokenId = Buffer.from(randomBytes(32)).toString("hex");

        // 3. Crear la caja `game_resolution`
        const participationFee = 5_000_000n;
        const numericalParams: bigint[] = [700_000n, 2_000_000_000n, participationFee, 1n, BigInt(resolutionDeadline)];
        const judges = [judge1TokenId, judge2TokenId, judge3TokenId].map(id => Buffer.from(id, "hex"));

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 30,  
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

        // 4. Crear cajas `participation`
        participationContract.addUTxOs({ // Ganador a ser invalidado
            ergoTree: participationErgoTree.toHex(),
            value: participationFee,
            creationHeight: 700_000 - 30,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, prependHexPrefix( invalidatedWinner.address.getPublicKeys()[0])).toHex(),
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
            value: participationFee - 1_000_000n,
            creationHeight: 700_000 - 30,  // Candidate created after deadline.
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte,  nextWinner.address.getPublicKeys()[0]).toHex(),
                R5: SColl(SByte, nextWinnerCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-next-winner")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-next-winner")).toHex(),
                R9: SColl(SLong, [100n, 200n, 30n, 1200n, 20n, 1n]).toHex(),
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
                    R6: SBool(true).toHex(),
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
                    R6: SBool(true).toHex(),
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
        const newNumericalParams = [700_000n, 2_000_000_000n, 1_000_000n, 1n, extendedDeadline];

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

    it("should fail if the new candidate has no valid score.", () => {
        // --- Crear Estado Inicial del Juego ---

        // --- Añadir Partidos de Contratos al MockChain ---
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "Participation");
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
        invalidatedCommitment = createCommitment("solver-invalid", 230n, "logs-invalid",  prependHexPrefix(invalidatedWinner.address.getPublicKeys()[0]), secret);
        nextWinnerCommitment = createCommitment("solver-next-winner", 100n, "logs-next-winner", prependHexPrefix(nextWinner.address.getPublicKeys()[0]), secret);

        // 2. Crear tokens de reputación para los jueces
        judge1TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge2TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge3TokenId = Buffer.from(randomBytes(32)).toString("hex");

        // 3. Crear la caja `game_resolution`;
        const numericalParams: bigint[] = [700_000n, 2_000_000_000n, 1_000_000n, 1n, BigInt(resolutionDeadline)];
        const judges = [judge1TokenId, judge2TokenId, judge3TokenId].map(id => Buffer.from(id, "hex"));

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: 2_000_000_000n,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height - 30,  
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

        // 4. Crear cajas `participation`
        participationContract.addUTxOs({ // Ganador a ser invalidado
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: 700_000 - 30,
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte, prependHexPrefix( invalidatedWinner.address.getPublicKeys()[0])).toHex(),
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
            creationHeight: 700_000 - 30,  // Candidate created after deadline.
            assets: [],
            additionalRegisters: {
                R4: SColl(SByte,  nextWinner.address.getPublicKeys()[0]).toHex(),
                R5: SColl(SByte, nextWinnerCommitment).toHex(),
                R6: SColl(SByte, stringToBytes("hex", gameNftId)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-next-winner")).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "logs-next-winner")).toHex(),
                R9: SColl(SLong, [200n, 30n, 1200n, 20n, 1n]).toHex(),  // Should be 100n here.
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
                    R6: SBool(true).toHex(),
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
                    R6: SBool(true).toHex(),
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
        const newNumericalParams = [700_000n, 2_000_000_000n, 1_000_000n, 1n, extendedDeadline];

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

});
