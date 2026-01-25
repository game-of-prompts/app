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
    SBool
} from "@fleet-sdk/serializer";
import { blake2b256, randomBytes } from "@fleet-sdk/crypto";
import { stringToBytes } from "@scure/base";
import { bigintToLongByteArray, generate_pk_proposition, hexToBytes } from "$lib/ergo/utils";
import { prependHexPrefix } from "$lib/utils";
import { getGopGameResolutionErgoTree, getGopParticipationErgoTree, getReputationProofErgoTree } from "$lib/ergo/contract";
import { DefaultGameConstants } from "$lib/common/constants";

const USD_BASE_TOKEN = "ebb40ecab7bb7d2a935024100806db04f44c62c33ae9756cf6fc4cb6b9aa2d12";
const USD_BASE_TOKEN_NAME = "USD";

const baseModes = [
    { name: "USD Token Mode", token: USD_BASE_TOKEN, tokenName: USD_BASE_TOKEN_NAME },
];

const JUDGE_PERIOD = BigInt(DefaultGameConstants.JUDGE_PERIOD + 10); // Debe coincidir con el valor en game_resolution.es mas cierto margen que se debe de dejar (ya que parece que el constructor de la transacción adelanta algunos bloques a proposito).

const seed = "a3f9b7e12c9d55ab8068e3ff22b7a19c34d8f1cbeaa1e9c0138b82f00d5ea712";

// Helper para crear un hash de compromiso
const createCommitment = (solverId: string, score: bigint, logsHash: Uint8Array, ergoTree: Uint8Array, secret: Uint8Array): Uint8Array => {
    return blake2b256(new Uint8Array([...stringToBytes("utf8", solverId), ...(hexToBytes(seed) || new Uint8Array(0)), ...bigintToLongByteArray(score), ...logsHash, ...ergoTree, ...secret]));
};

describe.each(baseModes)("Game Resolution Invalidation Unavailable by Judges - (%s)", (mode) => {
    const mockChain = new MockChain({ height: 800_000 });

    // --- Actores ---
    let resolver: ReturnType<MockChain["newParty"]>;
    let invalidatedWinner: ReturnType<MockChain["newParty"]>;
    let nextWinner: ReturnType<MockChain["newParty"]>;
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
    let judge1ReputationBox: Box;
    let judge2ReputationBox: Box;

    let invalidatedCommitment: Uint8Array;
    let judge1TokenId: string;
    let judge2TokenId: string;
    let judge3TokenId: string;


    beforeEach(() => {
        mockChain.reset({ clearParties: true });
        mockChain.jumpTo(currentHeight);
    });

    it("should successfully invalidate the current winner as unavailable with a majority of judge votes (2 out of 3)", () => {
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
        resolver.addBalance({ nanoergs: 10_000_000_000n });

        // 1. Generar compromisos para los participantes
        const invalidatedLogsHash = blake2b256(stringToBytes("utf8", "logs-invalid"));
        const nextWinnerLogsHash = blake2b256(stringToBytes("utf8", "logs-next-winner"));

        invalidatedCommitment = createCommitment("solver-invalid", 230n, invalidatedLogsHash, prependHexPrefix(invalidatedWinner.address.getPublicKeys()[0]), secret);

        // 2. Crear tokens de reputación para los jueces
        judge1TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge2TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge3TokenId = Buffer.from(randomBytes(32)).toString("hex");

        // 3. Crear la caja `game_resolution`
        const numericalParams: bigint[] = [700_000n, 2_000_000_000n, 1_000_000n, 1n, 10n, BigInt(resolutionDeadline), 0n];
        const judges = [judge1TokenId, judge2TokenId, judge3TokenId].map(id => Buffer.from(id, "hex"));

        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: RECOMMENDED_MIN_FEE_VALUE,
            assets: [
                { tokenId: gameNftId, amount: 1n },
                { tokenId: USD_BASE_TOKEN, amount: 2_000_000_000n } // resolverStake
            ],
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

                // numericalParameters: [deadline, resolverStake, participationFee, perJudgeCommissionPercent, resolverCommissionPercentage, resolutionDeadline]
                R8: SColl(SLong, [
                    BigInt(numericalParams[0]), // deadline
                    numericalParams[1],         // resolverStake
                    numericalParams[2],         // participationFee
                    numericalParams[3],         // perJudgeCommissionPercent
                    numericalParams[4],         // resolverCommissionPercentage
                    BigInt(numericalParams[5]), // resolutionDeadline
                    numericalParams[6]          // timeWeight
                ]).toHex(),

                // gameProvenance (R9) corregido: Coll[Coll[Byte]] con elementos planos
                R9: SColl(SColl(SByte), [
                    stringToBytes("utf8", "{}"),
                    hexToBytes(USD_BASE_TOKEN) ?? new Uint8Array(0), // participationTokenId
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
            assets: [{ tokenId: USD_BASE_TOKEN, amount: 1_000_000n }], // participationFee
            additionalRegisters: {
                R4: SColl(SByte, prependHexPrefix(invalidatedWinner.address.getPublicKeys()[0])).toHex(),
                R5: SColl(SByte, invalidatedCommitment).toHex(),
                R6: SColl(SByte, hexToBytes(gameNftId) ?? new Uint8Array(0)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-invalid")).toHex(),
                R8: SColl(SByte, invalidatedLogsHash).toHex(),
                R9: SColl(SLong, [100n, 200n, 23n, 230n, 300n, 1000n, 2n, 3n, 10n, 2n]).toHex(),
            }
        });
        invalidatedWinnerBox = participationContract.utxos.toArray()[0];

        // 5. Crear cajas `reputation_proof` para los jueces (los votos)
        const unavailableTypeNftId = DefaultGameConstants.PARTICIPATION_UNAVAILABLE_TYPE_ID;
        reputationProofContract.addUTxOs(
            { // Voto del Juez 1
                creationHeight: mockChain.height - 10,  // Judge opinion was formed 10 blocks ago, after resolve the game (30 blocks ago) and before judge period ends.
                ergoTree: reputationProofErgoTree.toHex(),
                value: 1_000_000n,
                assets: [{ tokenId: judge1TokenId, amount: 1n }],
                additionalRegisters: {
                    R4: SColl(SByte, hexToBytes(unavailableTypeNftId) ?? new Uint8Array(0)).toHex(),
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
                    R4: SColl(SByte, hexToBytes(unavailableTypeNftId) ?? new Uint8Array(0)).toHex(),
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
            numericalParams[1],         // resolverStake
            numericalParams[2],         // participationFee
            numericalParams[3],         // perJudgeCommissionPercent unchanged
            numericalParams[4],         // resolverCommissionPercentage unchanged
            extendedDeadline, // resolutionDeadline
            0n                // timeWeight
        ];

        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, invalidatedWinnerBox, ...resolver.utxos.toArray()])
            .to([
                new OutputBuilder(newFunds, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .addTokens(invalidatedWinnerBox.assets)
                    .setAdditionalRegisters({
                        // Estado del juego
                        R4: SInt(1).toHex(),


                        R5: SColl(SByte, hexToBytes(seed) ?? "").toHex(),

                        // (revealedSecretS, winnerCandidateCommitment)
                        R6: SPair(
                            SColl(SByte, secret),
                            SColl(SByte, [])
                        ).toHex(),

                        // participatingJudges
                        R7: SColl(SColl(SByte), judges).toHex(),

                        // numericalParameters: [deadline, resolverStake, participationFee, perJudgeCommissionPercent, resolverCommissionPercentage, resolutionDeadline]
                        R8: SColl(SLong, newNumericalParams).toHex(),

                        // gameProvenance (R9) corregido: Coll[Coll[Byte]] con elementos planos
                        R9: SColl(SColl(SByte), [
                            stringToBytes("utf8", "{}"),
                            hexToBytes(USD_BASE_TOKEN) ?? new Uint8Array(0), // participationTokenId
                            prependHexPrefix(resolver.key.publicKey, "0008cd")  // script resolvedor
                        ]).toHex()
                    })
            ])
            .withDataFrom([judge1ReputationBox, judge2ReputationBox]) // Los votos de los jueces y las participaciones no invalidadas
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

        // 2. Tokens retornados al pool
        expect(newGameBox.assets.length).to.equal(2); // gameNft + USD tokens
        expect(newGameBox.assets[0].tokenId).to.equal(gameNftId);
        expect(newGameBox.assets[0].amount).to.equal(1n);
        expect(newGameBox.assets[1].tokenId).to.equal(USD_BASE_TOKEN);
        expect(newGameBox.assets[1].amount).to.equal(2_000_000_000n + 1_000_000n); // resolverStake + participationFee

        // 3. Estado del juego permanece en resolución
        expect(newGameBox.additionalRegisters.R4).to.equal(SInt(1).toHex());

        // 4. Semilla permanece igual
        expect(newGameBox.additionalRegisters.R5).to.equal(SColl(SByte, hexToBytes(seed) ?? "").toHex());

        // 5. Nuevo candidato a ganador
        expect(newGameBox.additionalRegisters.R6).to.equal(SPair(
            SColl(SByte, secret),
            SColl(SByte, [])
        ).toHex());

        // 6. Jueces permanecen iguales
        expect(newGameBox.additionalRegisters.R7).to.equal(SColl(SColl(SByte), judges).toHex());

        // 7. Parámetros numéricos actualizados correctamente
        expect(newGameBox.additionalRegisters.R8).to.equal(SColl(SLong, newNumericalParams).toHex());

        // 8. Provenance del juego permanece igual
        expect(newGameBox.additionalRegisters.R9).to.equal(SColl(SColl(SByte), [
            stringToBytes("utf8", "{}"),
            hexToBytes(USD_BASE_TOKEN) ?? new Uint8Array(0),
            prependHexPrefix(resolver.key.publicKey, "0008cd")
        ]).toHex());
    });
});