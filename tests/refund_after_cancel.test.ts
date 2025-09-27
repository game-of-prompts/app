import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockChain } from "@fleet-sdk/mock-chain";
import { compile } from "@fleet-sdk/compiler";
import {
  Box,
  OutputBuilder,
  RECOMMENDED_MIN_FEE_VALUE,
  TransactionBuilder,
} from "@fleet-sdk/core";
import { SByte, SColl, SInt, SLong, SPair } from "@fleet-sdk/serializer";
import { blake2b256 } from "@fleet-sdk/crypto";
import * as fs from "fs";
import * as path from "path";
import { stringToBytes } from "@scure/base";
import { PARTICIPATION } from "$lib/ergo/reputation/types";

// --- Configuración de Utilidades y Carga de Contratos ---
const contractsDir = path.resolve(__dirname, "..", "contracts");

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

const GAME_ACTIVE_TEMPLATE = fs.readFileSync(
  path.join(contractsDir, "game_active.es"),
  "utf-8"
);
const GAME_CANCELLATION_TEMPLATE = fs.readFileSync(
  path.join(contractsDir, "game_cancellation.es"),
  "utf-8"
);
const GAME_RESOLUTION_TEMPLATE = fs.readFileSync(
  path.join(contractsDir, "game_resolution.es"),
  "utf-8"
);
const PARTICIPATION_TEMPLATE = fs.readFileSync(
  path.join(contractsDir, "participation.es"),
  "utf-8"
);

const DEV_ADDR_BASE58 = "9ejNy2qoifmzfCiDtEiyugthuXMriNNPhNKzzwjPtHnrK3esvbD";

// --- Suite de Pruebas ---
describe("Participant Refund After Cancellation", () => {
  let mockChain: MockChain;

  // --- Actores ---
  let creator: ReturnType<MockChain["newParty"]>;
  let participant: ReturnType<MockChain["newParty"]>;
  let canceller: ReturnType<MockChain["newParty"]>;

  // --- Partidos de Contratos ---
  let gameActiveContract: ReturnType<MockChain["newParty"]>;
  let gameCancellationContract: ReturnType<MockChain["newParty"]>;
  let participationContract: ReturnType<MockChain["newParty"]>;

  // --- Cajas (UTXOs) ---
  let participationBox: Box;
  let gameCancellationBox: Box;

  // --- Parámetros del Juego ---
  const creatorStake = 10_000_000_000n; // 10 ERG
  const participationFee = 1_000_000_000n; // 1 ERG
  const deadlineBlock = 800_200;
  const secret = stringToBytes("utf8", "the-secret-phrase");
  const hashedSecret = blake2b256(secret);
  const gameNftId =
    "fad58de3081b83590551ac9e28f3657b98d9f1c7842628d05267a57f1852f417";

  beforeEach(() => {
    mockChain = new MockChain({ height: 800_000 });

    // --- Inicializar Actores ---
    creator = mockChain.newParty("GameCreator");
    participant = mockChain.newParty("Participant");
    canceller = mockChain.newParty("Canceller");

    // Fondos para pagar tasas de transacción
    participant.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE * 2n });
    canceller.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE * 2n });

    // --- Compilación de Contratos en Orden ---
    const participationErgoTree = compile(PARTICIPATION_TEMPLATE);
    const participationHash = uint8ArrayToHex(
      blake2b256(participationErgoTree.bytes)
    );
    const gameCancellationErgoTree = compile(GAME_CANCELLATION_TEMPLATE);
    const cancellationHash = uint8ArrayToHex(
      blake2b256(gameCancellationErgoTree.bytes)
    );
    const resolutionSource = GAME_RESOLUTION_TEMPLATE
      .replace("`+PARTICIPATION_SCRIPT_HASH+`", participationHash)
      .replace("`+REPUTATION_PROOF_SCRIPT_HASH+`", "0".repeat(64)) // No se usa en este script
      .replace("`+PARTICIPATION_TYPE_ID+`", PARTICIPATION)
      .replace("`+DEV_ADDR+`", DEV_ADDR_BASE58);
    const gameResolutionErgoTree = compile(resolutionSource);
    const resolutionHash = uint8ArrayToHex(
      blake2b256(gameResolutionErgoTree.bytes)
    );
    const gameActiveSource = GAME_ACTIVE_TEMPLATE
      .replace("`+GAME_RESOLUTION_SCRIPT_HASH+`", resolutionHash)
      .replace("`+GAME_CANCELLATION_SCRIPT_HASH+`", cancellationHash)
      .replace("`+PARTICIPATION_HASH+`", participationHash);
    const gameActiveErgoTree = compile(gameActiveSource);

    // --- Añadir Partidos de Contratos a la Cadena ---
    gameActiveContract = mockChain.addParty(
      gameActiveErgoTree.toHex(),
      "GameActive"
    );
    gameCancellationContract = mockChain.addParty(
      gameCancellationErgoTree.toHex(),
      "GameCancellation"
    );
    participationContract = mockChain.addParty(
      participationErgoTree.toHex(),
      "Participation"
    );

    // --- FASE 1: Crear el estado inicial (Juego Activo + Participación) ---
   gameActiveContract.addUTxOs({
      value: creatorStake,
      ergoTree: gameActiveErgoTree.toHex(),
      assets: [{ tokenId: gameNftId, amount: 1n }],
      creationHeight: mockChain.height,
      additionalRegisters: {
        R4: SInt(0).toHex(),
        R5: SPair(SColl(SByte, creator.key.publicKey), SLong(10n)).toHex(),
        R6: SColl(SByte, hashedSecret).toHex(),
        R7: SColl(SColl(SByte), []).toHex(),
        R8: SColl(SLong, [
          BigInt(deadlineBlock),
          creatorStake,
          participationFee,
        ]).toHex(),
        R9: SColl(SByte, stringToBytes("utf8", "{}")).toHex(),
      },
    });
     const gameActiveBox = gameActiveContract.utxos.toArray()[0];

    participationContract.addUTxOs({
      value: participationFee,
      ergoTree: participationErgoTree.toHex(),
      assets: [],
      creationHeight: mockChain.height,
      additionalRegisters: {
        R4: SColl(SByte, participant.key.publicKey).toHex(),
        R5: SColl(SByte, "aa".repeat(32)).toHex(), // Commitment (dummy)
        R6: SColl(SByte, gameNftId).toHex(),
        R7: SColl(SByte, "bb".repeat(8)).toHex(), // solverId (dummy)
        R8: SColl(SByte, "cc".repeat(32)).toHex(), // hashLogs (dummy)
        R9: SColl(SLong, [100n, 200n]).toHex(), // scoreList (dummy)
      },
    });

    // --- FASE 2: Cancelar el juego para preparar el estado del test ---
    const stakePortionToClaim = creatorStake / 5n;
    const remainingStake = creatorStake - stakePortionToClaim;
    const cooldown = 40n;  // Seems that the mockchain goes various blocks forward when executing the tx!

    const cancelTx = new TransactionBuilder(mockChain.height)
      .from([gameActiveBox, ...canceller.utxos.toArray()])
      .to([
        new OutputBuilder(remainingStake, gameCancellationErgoTree)
          .addTokens(gameActiveBox.assets)
          .setAdditionalRegisters({
            R4: SInt(2).toHex(),
            R5: SLong(BigInt(mockChain.height) + cooldown).toHex(),
            R6: SColl(SByte, secret).toHex(), // Se revela el secreto
            R7: SLong(remainingStake).toHex(),
            R8: gameActiveBox.additionalRegisters.R9,
          }),
        new OutputBuilder(stakePortionToClaim, canceller.address),
      ])
      .sendChangeTo(canceller.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    mockChain.execute(cancelTx, { signers: [canceller] });

    // Guardar las cajas necesarias para el test principal
    participationBox = participationContract.utxos.toArray()[0];
    gameCancellationBox = gameCancellationContract.utxos.toArray()[0];
  });

  afterEach(() => {
    mockChain.reset({clearParties: true});
  });

  it("should allow a participant to claim a full refund after the game is cancelled", () => {
    // --- Arrange ---
    const participantInitialBalance = participant.balance.nanoergs;
    expect(gameCancellationBox).to.not.be.undefined;
    expect(participationBox).to.not.be.undefined;

    // --- Act ---
    const refundTx = new TransactionBuilder(mockChain.height)
      .from([participationBox, ...participant.utxos.toArray()])
      .withDataFrom([gameCancellationBox]) // Proporcionar la caja cancelada como prueba
      .to(
        new OutputBuilder(
          participationBox.value, // Reembolso completo
          participant.address
        )
      )
      .sendChangeTo(participant.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(refundTx, {
      signers: [participant],
    });

    // --- Assert ---
    // 1. La transacción debe ser válida
    expect(executionResult).to.be.true;

    // 2. La caja de participación debe haber sido gastada
    expect(participationContract.utxos.length).to.equal(0);

    // 3. El balance del participante debe reflejar el reembolso
    const expectedBalance =
      participantInitialBalance + participationFee - RECOMMENDED_MIN_FEE_VALUE;
    expect(participant.balance.nanoergs).to.equal(expectedBalance);

    // 4. La caja de cancelación NO debe haber sido gastada (solo leída)
    expect(gameCancellationContract.utxos.length).to.equal(1);
    expect(gameCancellationContract.utxos.toArray()[0].boxId).to.equal(
      gameCancellationBox.boxId
    );
  });
});