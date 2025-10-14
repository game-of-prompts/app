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
import * as fs from "fs";
import * as path from "path";
import { stringToBytes } from "@scure/base";
import { PARTICIPATION } from "$lib/ergo/reputation/types";

// --- Configuración de Utilidades y Constantes ---
const contractsDir = path.resolve(__dirname, "..", "contracts");

/**
 * Función de utilidad para convertir un Uint8Array a una cadena hexadecimal.
 * @param bytes El array de bytes a convertir.
 * @returns La representación hexadecimal en formato string.
 */
function uint8ArrayToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

// --- Carga de Plantillas de Contratos ---
// Se cargan todos los contratos necesarios para la prueba.
const GAME_ACTIVE_TEMPLATE = fs.readFileSync(path.join(contractsDir, "game_active.es"), "utf-8");
const GAME_CANCELLATION_TEMPLATE = fs.readFileSync(path.join(contractsDir, "game_cancellation.es"), "utf-8");
const GAME_RESOLUTION_TEMPLATE = fs.readFileSync(path.join(contractsDir, "game_resolution.es"), "utf-8");
const PARTICIPATION_TEMPLATE = fs.readFileSync(path.join(contractsDir, "participation.es"), "utf-8");

// Dirección de desarrollador para comisiones, requerida por game_resolution.es
const DEV_ADDR_BASE58 = "9ejNy2qoifmzfCiDtEiyugthuXMriNNPhNKzzwjPtHnrK3esvbD";


describe("Game Cancellation (cancel_game)", () => {
    let mockChain: MockChain;

    // --- Actores ---
    let game: ReturnType<MockChain["newParty"]>;
    let creator: ReturnType<MockChain["newParty"]>;
    let claimer: ReturnType<MockChain["newParty"]>;

    // --- Árboles de Contratos (ErgoTrees) ---
    // Estas variables se inicializarán en `beforeEach` después de compilar los contratos.
    let gameActiveErgoTree: ReturnType<typeof compile>;
    let gameCancellationErgoTree: ReturnType<typeof compile>;

    // --- Parámetros del Juego para la Prueba ---
    const creatorStake = 10_000_000_000n; // 10 ERG
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

        // El reclamante necesita fondos para pagar la tarifa de la transacción.
        claimer.addBalance({ nanoergs: 1_000_000_000n });

        // --- Compilación de Contratos en Orden de Dependencia ---

        // 1. Compilar contratos sin dependencias de hash.
        const participationErgoTree = compile(PARTICIPATION_TEMPLATE);
        const participationScriptHash = uint8ArrayToHex(blake2b256(participationErgoTree.bytes));

        const gameResolutionSource = GAME_RESOLUTION_TEMPLATE
            .replace("`+PARTICIPATION_SCRIPT_HASH+`", participationScriptHash)
            .replace("`+REPUTATION_PROOF_SCRIPT_HASH+`", "0".repeat(64)) // No se usa en este script
            .replace("`+PARTICIPATION_TYPE_ID+`", PARTICIPATION)
            .replace("`+DEV_ADDR+`", DEV_ADDR_BASE58);
        const gameResolutionErgoTree = compile(gameResolutionSource);
        const gameResolutionScriptHash = uint8ArrayToHex(blake2b256(gameResolutionErgoTree.bytes));

        // 3. Compilar el contrato de cancelación.
        gameCancellationErgoTree = compile(GAME_CANCELLATION_TEMPLATE);
        const gameCancellationScriptHash = uint8ArrayToHex(blake2b256(gameCancellationErgoTree.bytes));

        // 4. Finalmente, compilar el contrato principal del juego con todos los hashes necesarios.
        const finalGameActiveSource = GAME_ACTIVE_TEMPLATE
            .replace("`+GAME_RESOLUTION_SCRIPT_HASH+`", gameResolutionScriptHash)
            .replace("`+GAME_CANCELLATION_SCRIPT_HASH+`", gameCancellationScriptHash)
            .replace("`+PARTICIPATION_SCRIPT_HASH+`", participationScriptHash);
        gameActiveErgoTree = compile(finalGameActiveSource);

        // --- Creación de la Caja del Juego ---
        // Se crea la caja `game_active` inicial que será cancelada en la prueba.
        game.addUTxOs({
            value: creatorStake,
            ergoTree: gameActiveErgoTree.toHex(),
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height,
            additionalRegisters: {
                R4: SInt(0).toHex(),
                R5: SPair(SColl(SByte, creator.key.publicKey), SLong(10n)).toHex(),
                R6: SColl(SByte, hashedSecret).toHex(),
                R7: SColl(SColl(SByte), []).toHex(),
                R8: SColl(SLong, [BigInt(deadlineBlock), creatorStake, 1_000_000n]).toHex(),
                R9: SColl(SByte, stringToBytes("utf8", "{}")).toHex(),
            }
        });

        gameBox = game.utxos.toArray()[0];
    });

    afterEach(() => {
        mockChain.reset({clearParties: true});
    });

    it("should successfully cancel the game and pay penalty before the deadline", () => {
        // --- Arrange ---
        const claimerInitialBalance = claimer.balance.nanoergs;

        // --- Act ---
        // Calcular la distribución de fondos esperada según la lógica del contrato.
        const stakePortionToClaim = creatorStake / 5n; // 20% de penalización
        const newCreatorStake = creatorStake - stakePortionToClaim;
        const newUnlockHeight = BigInt(mockChain.height + 40); // Cooldown definido en el contrato

        const transaction = new TransactionBuilder(mockChain.height)
            .from([gameBox, ...claimer.utxos.toArray()])
            .to([
                // Salida 0: La nueva caja `GameCancellation`
                new OutputBuilder(newCreatorStake, gameCancellationErgoTree)
                    .addTokens(gameBox.assets)
                    .setAdditionalRegisters({
                        R4: SInt(2).toHex(), // Estado: Cancelado
                        R5: SLong(newUnlockHeight).toHex(),
                        R6: SColl(SByte, secret).toHex(), // Se revela el secreto
                        R7: SLong(newCreatorStake).toHex(),
                        R8: SLong(BigInt(deadlineBlock)).toHex(),
                        R9: gameBox.additionalRegisters.R9,
                    }),
                // Salida 1: La penalización pagada al reclamante
                new OutputBuilder(stakePortionToClaim, claimer.address)
            ])
            .sendChangeTo(claimer.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const executionResult = mockChain.execute(transaction, { signers: [claimer] });

        // --- Assert ---
        expect(executionResult, "La transacción de cancelación debería ser válida").to.be.true;

        // Verificar que la caja original del juego fue gastada
        /* expect(mockChain.boxes.at(gameActiveErgoTree.toHex())).to.have.length(0);

        // Verificar que la nueva caja de cancelación fue creada correctamente
        const cancellationBoxes = mockChain.boxes.at(gameCancellationErgoTree.toHex());
        expect(cancellationBoxes).to.have.length(1);
        
        const newCancellationBox = cancellationBoxes[0];
        expect(newCancellationBox.value).to.equal(newCreatorStake);
        expect(newCancellationBox.assets[0].tokenId).to.equal(gameNftId);
        expect(newCancellationBox.registers.R6).to.equal(SColl(SByte, secret).toHex());

        // Verificar que el reclamante recibió la penalización
        const expectedFinalBalance = claimerInitialBalance + stakePortionToClaim - RECOMMENDED_MIN_FEE_VALUE;
        expect(claimer.balance.nanoergs).to.equal(expectedFinalBalance); */
    });

    it("should fail to cancel if the game deadline has passed", () => {
        // --- Arrange ---
        // Avanzar el tiempo de la cadena de bloques más allá de la fecha límite del juego.
        mockChain.jumpTo(deadlineBlock + 1);
        expect(mockChain.height).to.be.greaterThan(deadlineBlock);

        // --- Act ---
        // Intentar construir y ejecutar la misma transacción de cancelación.
        const transaction = new TransactionBuilder(mockChain.height)
            .from([gameBox, ...claimer.utxos.toArray()])
            .to([ new OutputBuilder(1_000_000_000n, claimer.address) ]) // Salida de ejemplo
            .sendChangeTo(claimer.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        // --- Assert ---
        // La guarda del contrato `HEIGHT < deadline` debería prevenir esta transacción.
        const executionResult = mockChain.execute(transaction, { signers: [claimer], throw: false });
        expect(executionResult, "La cancelación no debería ser posible después de la fecha límite").to.be.false;

        // Verificar que la caja del juego NO fue gastada.
        // expect(mockChain.boxes.at(gameActiveErgoTree.toHex())).to.have.length(1);
    });
});


describe("Game Cancellation (Low Stake)", () => {
    let mockChain: MockChain;
    let game: ReturnType<MockChain["newParty"]>;
    let creator: ReturnType<MockChain["newParty"]>;
    let claimer: ReturnType<MockChain["newParty"]>;
    let gameActiveErgoTree: ReturnType<typeof compile>;
    let gameCancellationErgoTree: ReturnType<typeof compile>;

    // --- Parámetros del Juego para la Prueba ---
    // El stake es < 1.25 ERG, por lo que el 80% restante es < 1 ERG (MIN_BOX_VALUE)
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
        claimer.addBalance({ nanoergs: 1_000_000_000n });

        // --- Compilación de Contratos ---
        const participationSubmittedSource = PARTICIPATION_TEMPLATE
        const participationSubmittedErgoTree = compile(participationSubmittedSource);
        const participationSubmittedScriptHash = uint8ArrayToHex(blake2b256(participationSubmittedErgoTree.bytes));
        const gameResolutionSource = GAME_RESOLUTION_TEMPLATE
            .replace("`+PARTICIPATION_SCRIPT_HASH+`", participationSubmittedScriptHash)
            .replace("`+REPUTATION_PROOF_SCRIPT_HASH+`", "0".repeat(64)) // No se usa en este script
            .replace("`+PARTICIPATION_TYPE_ID+`", PARTICIPATION)
            .replace("`+DEV_ADDR+`", DEV_ADDR_BASE58);
        const gameResolutionErgoTree = compile(gameResolutionSource);
        const gameResolutionScriptHash = uint8ArrayToHex(blake2b256(gameResolutionErgoTree.bytes));
        gameCancellationErgoTree = compile(GAME_CANCELLATION_TEMPLATE);
        const gameCancellationScriptHash = uint8ArrayToHex(blake2b256(gameCancellationErgoTree.bytes));
        const finalGameActiveSource = GAME_ACTIVE_TEMPLATE
            .replace("`+GAME_RESOLUTION_SCRIPT_HASH+`", gameResolutionScriptHash)
            .replace("`+GAME_CANCELLATION_SCRIPT_HASH+`", gameCancellationScriptHash)
            .replace("`+PARTICIPATION_SCRIPT_HASH+`", participationSubmittedScriptHash);
        gameActiveErgoTree = compile(finalGameActiveSource);

        // --- Creación de la Caja del Juego con Stake Bajo ---
        game.addUTxOs({
            value: creatorStake,
            ergoTree: gameActiveErgoTree.toHex(),
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height,
            additionalRegisters: {
                R4: SInt(0).toHex(),
                R5: SPair(SColl(SByte, creator.key.publicKey), SLong(10n)).toHex(),
                R6: SColl(SByte, hashedSecret).toHex(),
                R7: SColl(SColl(SByte), []).toHex(),
                R8: SColl(SLong, [BigInt(deadlineBlock), creatorStake, 1_000_000n]).toHex(),
                R9: SColl(SByte, stringToBytes("utf8", "{}")).toHex(),
            }
        });
        gameBox = game.utxos.toArray()[0];
    });

    afterEach(() => {
        mockChain.reset({clearParties: true});
    });

    it("should fail to cancel if remaining stake is less than MIN_BOX_VALUE", () => {
        // --- Arrange ---
        // Calcular la distribución de fondos.
        const stakePortionToClaim = creatorStake / 5n; // 240,000 nanoergs
        const newCreatorStake = creatorStake - stakePortionToClaim; // 960,000 nanoergs
        const newUnlockHeight = BigInt(mockChain.height + 40);

        // Verificar que el stake restante es menor que el valor mínimo de una caja.
        expect(newCreatorStake).to.be.lessThan(1_000_000);

        // --- Act ---
        // Intentar construir la transacción. La creación de la salida 0 fallará
        // a nivel de nodo/protocolo porque su valor es demasiado bajo.
        const transaction = new TransactionBuilder(mockChain.height)
            .from([gameBox, ...claimer.utxos.toArray()])
            .to([
                // Salida 0: Esta caja tiene un valor < MIN_BOX_VALUE, lo que debería invalidar la tx.
                new OutputBuilder(newCreatorStake, gameCancellationErgoTree)
                    .addTokens(gameBox.assets)
                    .setAdditionalRegisters({
                        R4: SInt(2).toHex(),
                        R5: SLong(newUnlockHeight).toHex(),
                        R6: SColl(SByte, secret).toHex(),
                        R7: SLong(newCreatorStake).toHex(),
                        R8: SLong(BigInt(deadlineBlock)).toHex(),
                        R9: gameBox.additionalRegisters.R9,
                    }),
                // Salida 1: La penalización para el reclamante.
                new OutputBuilder(stakePortionToClaim, claimer.address)
            ])
            .sendChangeTo(claimer.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        // --- Assert ---
        // La ejecución de la transacción debe fallar porque una de las salidas
        // no cumple con el valor mínimo requerido por el protocolo de Ergo.
        const executionResult = mockChain.execute(transaction, { signers: [claimer], throw: false });
        expect(executionResult, "La cancelación debería fallar si el stake restante es demasiado bajo").to.be.false;
    });
});
