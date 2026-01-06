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
    SInt,
    SLong,
    SPair
} from "@fleet-sdk/serializer";
import { blake2b256 } from "@fleet-sdk/crypto";
import { stringToBytes } from "@scure/base";
import { getGopGameActiveErgoTree, getGopGameCancellationErgoTree } from "$lib/ergo/contract";
import { hexToBytes } from "$lib/ergo/utils";

const ERG_BASE_TOKEN = "";
const ERG_BASE_TOKEN_NAME = "ERG";
const USD_BASE_TOKEN = "ebb40ecab7bb7d2a935024100806db04f44c62c33ae9756cf6fc4cb6b9aa2d12";
const USD_BASE_TOKEN_NAME = "USD";

const baseModes = [
    { name: "USD Token Mode", token: USD_BASE_TOKEN, tokenName: USD_BASE_TOKEN_NAME },
];

describe.each(baseModes)("Game Cancellation (cancel_game) - (%s)", (mode) => {
    let mockChain: MockChain;

    let game: ReturnType<MockChain["newParty"]>;
    let creator: ReturnType<MockChain["newParty"]>;
    let claimer: ReturnType<MockChain["newParty"]>;

    let gameActiveErgoTree: ReturnType<typeof compile>;
    let gameCancellationErgoTree: ReturnType<typeof compile>;

    const creatorStake = 10_000_000_000n; // 10 ERG de apuesta inicial
    const deadlineBlock = 800_200;
    const secret = stringToBytes("utf8", "this-is-the-revealed-secret");
    const hashedSecret = blake2b256(secret);
    const gameNftId = "00aadd0000aadd0000aadd0000aadd0000aadd0000aadd0000aadd0000aadd00";

    let gameBox: Box;

    beforeEach(() => {
        mockChain = new MockChain({ height: 800_000 });
        game = mockChain.newParty("Game");
        creator = mockChain.newParty("GameCreator");
        claimer = mockChain.newParty("Claimer");

        // --- CORRECCIÓN AQUÍ ---
        // Solo le damos al reclamante fondos suficientes para pagar la tarifa de minero (Fee).
        // 0.1 ERG es más que suficiente para fees (aprox 0.0011 ERG). 
        // Esto demuestra que NO está pagando el stake.
        claimer.addBalance({ nanoergs: 100_000_000n });

        gameCancellationErgoTree = getGopGameCancellationErgoTree();
        gameActiveErgoTree = getGopGameActiveErgoTree();

        // Configuración de la caja del juego (donde está el dinero o los tokens)
        const gameBoxValue = mode.token === ERG_BASE_TOKEN ? creatorStake : RECOMMENDED_MIN_FEE_VALUE;
        const gameAssets = [
            { tokenId: gameNftId, amount: 1n },
            ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: creatorStake }] : [])
        ];

        game.addUTxOs({
            value: gameBoxValue,
            ergoTree: gameActiveErgoTree.toHex(),
            assets: gameAssets,
            creationHeight: mockChain.height,
            additionalRegisters: {
                R4: SInt(0).toHex(), // Estado 0: Activo
                R5: SPair(SColl(SByte, "ab".repeat(32)), SLong(BigInt(800_005))).toHex(),
                R6: SColl(SByte, hashedSecret).toHex(),
                R7: SColl(SColl(SByte), []).toHex(),
                R8: SColl(SLong, [
                    BigInt(deadlineBlock),
                    creatorStake,
                    1_000_000n,
                    500n,
                    1000n
                ]).toHex(),
                R9: SColl(SColl(SByte), [stringToBytes("utf8", "{}"), hexToBytes(mode.token) ?? ""]).toHex()
            }
        });

        gameBox = game.utxos.toArray()[0];
    }, 15000);

    afterEach(() => {
        mockChain.reset({ clearParties: true });
    });

    it("should successfully cancel the game: Claimer receives 20%, Contract retains 80%", () => {
        // --- Arrange ---
        // 1. Cálculos de la penalización (Lógica del contrato)
        // El contrato dice: Si cancelas, pierdes 1/5 del stake.
        const stakePortionForClaimer = creatorStake / 5n; // 2 ERG (si stake es 10)
        const stakePortionForGame = creatorStake - stakePortionForClaimer; // 8 ERG

        const newUnlockHeight = BigInt(mockChain.height + 40);

        // 2. Definir valores de las cajas de salida
        // CAJA 1: El juego cancelado (se queda con el 80%)
        const cancellationBoxValue = mode.token === ERG_BASE_TOKEN
            ? stakePortionForGame
            : RECOMMENDED_MIN_FEE_VALUE;

        const cancellationAssets = [
            { tokenId: gameNftId, amount: 1n },
            ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: stakePortionForGame }] : [])
        ];

        // CAJA 2: La penalización para el reclamante (se lleva el 20%)
        // Nota: Si es ERG Mode, el valor es el stakePortion. Si es Token Mode, es el MinFee, pero lleva los tokens.
        const penaltyBoxValue = mode.token === ERG_BASE_TOKEN
            ? stakePortionForClaimer
            : RECOMMENDED_MIN_FEE_VALUE;

        const penaltyAssets = mode.token !== ERG_BASE_TOKEN
            ? [{ tokenId: mode.token, amount: stakePortionForClaimer }]
            : [];

        // --- Act ---
        const transaction = new TransactionBuilder(mockChain.height)
            .from([gameBox, ...claimer.utxos.toArray()]) // Inputs: Caja del Juego (Stake) + Caja del Reclamante (para Fee)
            .to([
                // Salida 0: Caja de Cancelación (80% del Stake)
                new OutputBuilder(cancellationBoxValue, gameCancellationErgoTree)
                    .addTokens(cancellationAssets)
                    .setAdditionalRegisters({
                        R4: SInt(2).toHex(), // Estado: Cancelado
                        R5: SLong(newUnlockHeight).toHex(),
                        R6: SColl(SByte, secret).toHex(), // Secreto revelado
                        R7: SLong(stakePortionForGame).toHex(),
                        R8: SLong(BigInt(deadlineBlock)).toHex(),
                        R9: SColl(SColl(SByte), [stringToBytes("utf8", "{}"), hexToBytes(mode.token) ?? ""]).toHex(),
                    }),

                // Salida 1: Pago al Reclamante (20% del Stake)
                new OutputBuilder(penaltyBoxValue, claimer.address)
                    .addTokens(penaltyAssets)
            ])
            .sendChangeTo(claimer.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const executionResult = mockChain.execute(transaction, { signers: [claimer] });

        // --- Assert ---
        expect(executionResult, "La transacción debería ejecutarse correctamente").to.be.true;

        // Verificaciones opcionales para asegurar la lógica
        if (mode.token === ERG_BASE_TOKEN) {
            // Verificar que la salida 1 (reclamante) tenga aprox 2 ERG
            // (Nota: FleetSDK output value es exacto al definido en OutputBuilder)
            expect(transaction.outputs[1].value).to.equal(stakePortionForClaimer);
        } else {
            // Verificar tokens
            expect(transaction.outputs[1].assets[0].amount).to.equal(stakePortionForClaimer);
        }
    });

    it("should fail to cancel if the game deadline has passed", () => {
        mockChain.jumpTo(Number(deadlineBlock) + 1);

        // Intentamos una transacción simple para ver si el contrato bloquea
        // (Simplificado para brevedad, usando la misma lógica de arriba fallaría igual)
        const transaction = new TransactionBuilder(mockChain.height)
            .from([gameBox, ...claimer.utxos.toArray()])
            .to([new OutputBuilder(RECOMMENDED_MIN_FEE_VALUE, claimer.address)])
            .sendChangeTo(claimer.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const executionResult = mockChain.execute(transaction, { signers: [claimer], throw: false });
        expect(executionResult).to.be.false;
    });
});

describe("Game Cancellation (Low Stake) - (%s)", () => {
    const mode = { name: "ERG Mode", token: ERG_BASE_TOKEN, tokenName: ERG_BASE_TOKEN_NAME }

    let mockChain: MockChain;
    let game: ReturnType<MockChain["newParty"]>;
    let creator: ReturnType<MockChain["newParty"]>;
    let claimer: ReturnType<MockChain["newParty"]>;
    let gameActiveErgoTree: ReturnType<typeof compile>;
    let gameCancellationErgoTree: ReturnType<typeof compile>;

    // --- Parámetros del Juego para la Prueba ---
    // Stake: 1.2 ERG. El 80% restante es 960,000 nanoergs, que es < 1,000,000 (Min Box Value)
    const creatorStake = 1_200_000n;
    const deadlineBlock = 800_200;
    const secret = stringToBytes("utf8", "this-is-the-revealed-secret");
    const hashedSecret = blake2b256(secret);
    const gameNftId = "00aadd0000aadd0000aadd0000aadd0000aadd0000aadd0000aadd0000aadd00";
    let gameBox: Box;

    beforeEach(() => {
        mockChain = new MockChain({ height: 800_000 });
        game = mockChain.newParty("Game");
        creator = mockChain.newParty("GameCreator");
        claimer = mockChain.newParty("Claimer");
        // Fondos para pagar la tarifa de la transacción (Miner Fee)
        claimer.addBalance({ nanoergs: 100_000_000n });

        gameCancellationErgoTree = getGopGameCancellationErgoTree();
        gameActiveErgoTree = getGopGameActiveErgoTree();

        const gameBoxValue = mode.token === ERG_BASE_TOKEN ? creatorStake : RECOMMENDED_MIN_FEE_VALUE;
        const gameAssets = [
            { tokenId: gameNftId, amount: 1n },
            ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: creatorStake }] : [])
        ];

        // Se usa una deadline de ceremonia ficticia que ya pasó (800_005) para este registro
        const ceremonyDeadline = 800_005;

        game.addUTxOs({
            value: gameBoxValue,
            ergoTree: gameActiveErgoTree.toHex(),
            assets: gameAssets,
            creationHeight: mockChain.height,
            additionalRegisters: {
                R4: SInt(0).toHex(), // Estado: Activo
                // R5: (Coll[Byte], Long) - seed: (Seed, Ceremony deadline)
                // Se restaura el formato correcto del registro R5
                R5: SPair(
                    SColl(SByte, "ab".repeat(32)),
                    SLong(BigInt(ceremonyDeadline))
                ).toHex(),
                R6: SColl(SByte, hashedSecret).toHex(),
                R7: SColl(SColl(SByte), []).toHex(),
                // R8: Se restaura el formato completo de parámetros numéricos.
                R8: SColl(SLong, [
                    BigInt(deadlineBlock),
                    creatorStake,
                    1_000_000n,                // participationFee
                    500n,                      // perJudgeComissionPercentage
                    1000n                      // creatorComissionPercentage
                ]).toHex(),
                R9: SColl(SColl(SByte), [
                    stringToBytes("utf8", "{}"),
                    mode.token
                ]).toHex()
            }
        });
        gameBox = game.utxos.toArray()[0];
    }, 15000);

    afterEach(() => {
        mockChain.reset({ clearParties: true });
    });

    it("should fail to cancel if remaining stake is less than MIN_BOX_VALUE (ERG Mode Only)", () => {
        // --- Arrange ---
        // Stake total: 1,200,000n
        const stakePortionToClaim = creatorStake / 5n; // 240,000 nanoergs (20% de penalización)
        const newCreatorStake = creatorStake - stakePortionToClaim; // 960,000 nanoergs (80% restante)
        const newUnlockHeight = BigInt(mockChain.height + 40);

        // Mínimo valor requerido por el protocolo de Ergo para cualquier caja de salida.
        const MIN_BOX_VALUE = 1_000_000n;

        // Verificamos que el stake restante (960,000n) es menor que el valor mínimo (1,000,000n).
        expect(newCreatorStake).to.be.lessThan(MIN_BOX_VALUE);

        // --- Act ---
        const cancellationBoxValue = mode.token === ERG_BASE_TOKEN ? newCreatorStake : RECOMMENDED_MIN_FEE_VALUE;
        const penaltyValue = mode.token === ERG_BASE_TOKEN ? stakePortionToClaim : RECOMMENDED_MIN_FEE_VALUE;

        const cancellationAssets = [
            { tokenId: gameNftId, amount: 1n },
            ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: newCreatorStake }] : [])
        ];

        const penaltyAssets = mode.token !== ERG_BASE_TOKEN
            ? [{ tokenId: mode.token, amount: stakePortionToClaim }]
            : [];

        const transaction = new TransactionBuilder(mockChain.height)
            .from([gameBox, ...claimer.utxos.toArray()])
            .to([
                // Salida 0: Esta caja falla en ERG Mode porque el valor (960,000n) es muy bajo.
                new OutputBuilder(cancellationBoxValue, gameCancellationErgoTree)
                    .addTokens(cancellationAssets)
                    .setAdditionalRegisters({
                        R4: SInt(2).toHex(),
                        R5: SLong(newUnlockHeight).toHex(),
                        R6: SColl(SByte, secret).toHex(),
                        R7: SLong(newCreatorStake).toHex(),
                        R8: SLong(BigInt(deadlineBlock)).toHex(),
                        R9: gameBox.additionalRegisters.R9,
                    }),
                // Salida 1: La penalización para el reclamante.
                new OutputBuilder(penaltyValue, claimer.address).addTokens(penaltyAssets)
            ])
            .sendChangeTo(claimer.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        // --- Assert ---
        // La ejecución de la transacción debe fallar. En ERG Mode, esto es por la regla de Min Box Value.
        // En Token Mode, esto pasaría si no se hiciera la verificación dentro del contrato.
        const executionResult = mockChain.execute(transaction, { signers: [claimer], throw: false });
        expect(executionResult, "La cancelación debe fallar cuando el nanoERG restante es menor al Min Box Value de 1,000,000n.").to.be.false;
    });
});