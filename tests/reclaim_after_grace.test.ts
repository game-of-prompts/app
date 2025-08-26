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
const PARTICIPATION_SUBMITTED_TEMPLATE = fs.readFileSync(
  path.join(contractsDir, "participation_submited.es"),
  "utf-8"
);
const PARTICIPATION_RESOLVED_SOURCE = fs.readFileSync(
  path.join(contractsDir, "participation_resolved.es"),
  "utf-8"
);

const DEV_ADDR_BASE58 = "9ejNy2qoifmzfCiDtEiyugthuXMriNNPhNKzzwjPtHnrK3esvbD";
const GRACE_PERIOD_IN_BLOCKS = 720;

// --- Suite de Pruebas ---
describe("Participant Reclaim After Grace Period", () => {
  let mockChain: MockChain;

  // --- Actores ---
  let creator: ReturnType<MockChain["newParty"]>;
  let participant: ReturnType<MockChain["newParty"]>;

  // --- Partidos de Contratos ---
  let gameActiveContract: ReturnType<MockChain["newParty"]>;
  let participationSubmittedContract: ReturnType<MockChain["newParty"]>;

  // --- Cajas (UTXOs) ---
  let gameActiveBox: Box;
  let participationBox: Box;

  // --- Parámetros del Juego ---
  const creatorStake = 1_000_000_000n; // 1 ERG
  const participationFee = 1_000_000_000n; // 1 ERG
  const deadlineBlock = 800_200;
  const gameNftId =
    "fad58de3081b83590551ac9e28f3657b98d9f1c7842628d05267a57f1852f417";

  beforeEach(() => {
    mockChain = new MockChain({ height: 800_000 });

    // --- Inicializar Actores ---
    creator = mockChain.newParty("GameCreator");
    participant = mockChain.newParty("Participant");
    participant.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE * 2n });

    // --- Compilación de Contratos ---
    const participationResolvedErgoTree = compile(PARTICIPATION_RESOLVED_SOURCE);
    const resolvedHash = uint8ArrayToHex(
      blake2b256(participationResolvedErgoTree.bytes)
    );
    // Añadimos la constante al script de participación antes de compilarlo
    const submittedSourceWithConstant = PARTICIPATION_SUBMITTED_TEMPLATE.replace(
      "val GRACE_PERIOD_IN_BLOCKS = 720L",
      `val GRACE_PERIOD_IN_BLOCKS = ${GRACE_PERIOD_IN_BLOCKS}L`
    ).replace("`+PARTICIPATION_RESOLVED_SCRIPT_HASH+`", resolvedHash);

    const participationSubmittedErgoTree = compile(submittedSourceWithConstant);
    const submittedHash = uint8ArrayToHex(
      blake2b256(participationSubmittedErgoTree.bytes)
    );
    const gameCancellationErgoTree = compile(GAME_CANCELLATION_TEMPLATE);
    const cancellationHash = uint8ArrayToHex(
      blake2b256(gameCancellationErgoTree.bytes)
    );
    const resolutionSource = GAME_RESOLUTION_TEMPLATE.replace(
      "`+PARTICIPATION_RESOLVED_SCRIPT_HASH+`",
      resolvedHash
    )
      .replace("`+PARTICIPATION_SUBMITTED_SCRIPT_HASH+`", submittedHash)
      .replace("`+DEV_ADDR+`", DEV_ADDR_BASE58);
    const gameResolutionErgoTree = compile(resolutionSource);
    const resolutionHash = uint8ArrayToHex(
      blake2b256(gameResolutionErgoTree.bytes)
    );
    const gameActiveSource = GAME_ACTIVE_TEMPLATE.replace(
      "`+GAME_RESOLUTION_SCRIPT_HASH+`",
      resolutionHash
    )
      .replace("`+GAME_CANCELLATION_SCRIPT_HASH+`", cancellationHash)
      .replace("`+PARTICIPATION_SUBMITED_SCRIPT_HASH+`", submittedHash)
      .replace("`+PARTICIPATION_RESOLVED_SCRIPT_HASH+`", resolvedHash);
    const gameActiveErgoTree = compile(gameActiveSource);

    // --- Añadir Partidos de Contratos a la Cadena ---
    gameActiveContract = mockChain.addParty(
      gameActiveErgoTree.toHex(),
      "GameActive"
    );
    participationSubmittedContract = mockChain.addParty(
      participationSubmittedErgoTree.toHex(),
      "ParticipationSubmitted"
    );

    // --- Crear el estado inicial (Juego Activo + Participación) ---
    gameActiveContract.addUTxOs({
      value: creatorStake,
      ergoTree: gameActiveErgoTree.toHex(),
      assets: [{ tokenId: gameNftId, amount: 1n }],
      creationHeight: mockChain.height,
      additionalRegisters: {
        R4: SInt(0).toHex(),
        R5: SPair(SColl(SByte, creator.key.publicKey), SLong(10n)).toHex(),
        R6: SColl(SByte, blake2b256(stringToBytes("utf8", "secret"))).toHex(),
        R7: SColl(SColl(SByte), []).toHex(),
        R8: SColl(SLong, [
          BigInt(deadlineBlock),
          creatorStake,
          participationFee,
        ]).toHex(),
        R9: SColl(SByte, stringToBytes("utf8", "{}")).toHex(),
      },
    });

    participationSubmittedContract.addUTxOs({
      value: participationFee,
      ergoTree: participationSubmittedErgoTree.toHex(),
      creationHeight: mockChain.height,
      additionalRegisters: {
        R4: SColl(SByte, participant.key.publicKey).toHex(),
        R5: SColl(SByte, "aa".repeat(32)).toHex(),
        R6: SColl(SByte, gameNftId).toHex(),
        R7: SColl(SByte, "bb".repeat(8)).toHex(),
        R8: SColl(SByte, "cc".repeat(32)).toHex(),
        R9: SColl(SLong, [100n, 200n]).toHex(),
      },
    });

    gameActiveBox = gameActiveContract.utxos.toArray()[0];
    participationBox = participationSubmittedContract.utxos.toArray()[0];
  });

  afterEach(() => {
    mockChain.reset();
  });

  it("should allow a participant to reclaim funds if the grace period has passed", () => {
    // --- Arrange ---
    // Avanzamos el tiempo de la cadena justo después de que termine el período de gracia
    const reclaimHeight = deadlineBlock + GRACE_PERIOD_IN_BLOCKS;
    mockChain.jumpTo(reclaimHeight);

    const participantInitialBalance = participant.balance.nanoergs;
    expect(mockChain.height).to.be.greaterThanOrEqual(
      deadlineBlock + GRACE_PERIOD_IN_BLOCKS
    );

    // --- Act ---
    const reclaimTx = new TransactionBuilder(mockChain.height)
      .from([participationBox, ...participant.utxos.toArray()])
      .withDataFrom([gameActiveBox]) // Proporcionar la caja activa como prueba de inacción
      .to(
        new OutputBuilder(
          participationBox.value, // Reembolso completo
          participant.address
        )
      )
      .sendChangeTo(participant.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(reclaimTx, {
      signers: [participant],
    });

    // --- Assert ---
    // 1. La transacción debe ser válida
    expect(executionResult).to.be.true;

    // 2. La caja de participación debe haber sido gastada
    expect(participationSubmittedContract.utxos.length).to.equal(0);

    // 3. El balance del participante debe reflejar el reembolso
    const expectedBalance =
      participantInitialBalance + participationFee - RECOMMENDED_MIN_FEE_VALUE;
    expect(participant.balance.nanoergs).to.equal(expectedBalance);

    // 4. La caja del juego activo NO debe haber sido gastada
    expect(gameActiveContract.utxos.length).to.equal(1);
    expect(gameActiveContract.utxos.toArray()[0].boxId).to.equal(
      gameActiveBox.boxId
    );
  });

  it("should FAIL to reclaim funds if the grace period has NOT passed", () => {
    // --- Arrange ---
    // Avanzamos el tiempo, pero a un punto ANTES de que termine el período de gracia
    const reclaimHeight = deadlineBlock + GRACE_PERIOD_IN_BLOCKS - 1;
    mockChain.jumpTo(reclaimHeight);

    expect(mockChain.height).to.be.lessThan(
      deadlineBlock + GRACE_PERIOD_IN_BLOCKS
    );

    // --- Act ---
    const reclaimTx = new TransactionBuilder(mockChain.height)
      .from([participationBox, ...participant.utxos.toArray()])
      .withDataFrom([gameActiveBox])
      .to(new OutputBuilder(participationBox.value, participant.address))
      .sendChangeTo(participant.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(reclaimTx, {
      signers: [participant],
      throw: false, // Evitar que el test falle, queremos comprobar el resultado
    });

    // --- Assert ---
    // 1. La transacción NO debe ser válida
    expect(executionResult).to.be.false;

    // 2. La caja de participación NO debe haber sido gastada
    expect(participationSubmittedContract.utxos.length).to.equal(1);
  });
});