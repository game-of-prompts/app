import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockChain } from "@fleet-sdk/mock-chain";
import { compile } from "@fleet-sdk/compiler";
import {
  OutputBuilder,
  RECOMMENDED_MIN_FEE_VALUE,
  TransactionBuilder,
} from "@fleet-sdk/core";
import { SByte, SColl, SLong, SInt, SGroupElement } from "@fleet-sdk/serializer";
import { blake2b256 } from "@fleet-sdk/crypto";
import * as fs from "fs";
import * as path from "path";
import { stringToBytes } from "@scure/base";

// Helper para convertir Uint8Array a una cadena hexadecimal.
function uint8ArrayToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

// =================================================================
// === CARGA Y COMPILACIÓN DE CONTRATOS
// =================================================================

const contractsDir = path.resolve(__dirname, "..", "contracts");

// Cargar el código fuente de los contratos ErgoScript
const PARTICIPATION_SOURCE = fs.readFileSync(path.join(contractsDir, "participation.es"), "utf-8");
const GAME_CANCELLATION_SOURCE = fs.readFileSync(path.join(contractsDir, "game_cancellation.es"), "utf-8");
const GAME_ACTIVE_SOURCE = fs.readFileSync(path.join(contractsDir, "game_active.es"), "utf-8");

// Compilar los contratos a ErgoTree
const participationErgoTree = compile(PARTICIPATION_SOURCE);
const participationScriptHash = uint8ArrayToHex(blake2b256(participationErgoTree.bytes));
const gameCancellationErgoTree = compile(GAME_CANCELLATION_SOURCE);
const gameCancellationScriptHash = uint8ArrayToHex(blake2b256(gameCancellationErgoTree.bytes));

// Inyectar hashes en el contrato 'game_active.es' (necesario para la consistencia del entorno de prueba)
const gameActiveSource = GAME_ACTIVE_SOURCE
    .replace("`+GAME_RESOLUTION_SCRIPT_HASH+`", "0".repeat(64)) // No es relevante para este test
    .replace("`+GAME_CANCELLATION_SCRIPT_HASH+`", gameCancellationScriptHash)
    .replace("`+PARTICIPATION_SCRIPT_HASH+`", participationScriptHash);
const gameActiveErgoTree = compile(gameActiveSource);


describe("Participation Contract: Refund after Game Cancellation", () => {
  let mockChain: MockChain;

  // --- Actores ---
  let player: ReturnType<MockChain["newParty"]>;
  let creator: ReturnType<MockChain["newParty"]>; // Para crear la caja de juego inicial

  // --- Partidos de Contratos ---
  let participationContract: ReturnType<MockChain["addParty"]>;
  let gameCancelledContract: ReturnType<MockChain["addParty"]>;

  // --- Estado del Juego ---
  let gameNftId: string;
  const participationFee = 1_000_000n; // 0.001 ERG
  const creatorInitialStake = 2_000_000_000n; // 2 ERG

  afterEach(() => {
    mockChain.reset({ clearParties: true });
  });

  beforeEach(() => {
    mockChain = new MockChain({ height: 800_000 });

    // Inicializar actores con saldo para las tasas de transacción
    player = mockChain.newParty("PlayerToRefund");
    creator = mockChain.newParty("GameCreator");
    player.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });

    // --- Definir Partidos de Contratos ---
    participationContract = mockChain.addParty(participationErgoTree.toHex(), "ParticipationContract");
    gameCancelledContract = mockChain.addParty(gameCancellationErgoTree.toHex(), "GameCancelledContract");

    // --- Crear el estado inicial: una caja de juego cancelada y una participación ---
    gameNftId = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
    const secret = stringToBytes("utf8", "the-secret-was-revealed");
    
    // 1. Crear la caja `game_cancelled.es` (Data Input)
    // Esta caja simula un juego que ha sido cancelado.
    gameCancelledContract.addUTxOs({
      creationHeight: mockChain.height - 100, // Creada en el pasado
      ergoTree: gameCancellationErgoTree.toHex(),
      assets: [{ tokenId: gameNftId, amount: 1n }],
      value: creatorInitialStake, // El stake que queda
      additionalRegisters: {
        R4: SInt(2).toHex(), // Estado 2: "Cancelled"
        R5: SLong(BigInt(mockChain.height - 50)).toHex(), // unlockHeight en el pasado
        R6: SColl(SByte, secret).toHex(), // El secreto revelado
        R7: SLong(creatorInitialStake).toHex(), // Stake actual
        R8: SColl(SByte, stringToBytes("utf8", `{"gameNftId":"${gameNftId}"}`)).toHex(),
      }
    });

    // 2. Crear la caja `participation.es` (Input a gastar)
    // Esta es la caja del jugador que quiere su reembolso.
    const playerPkBytes = player.address.getPublicKeys()[0];
    const dummyCommitment = blake2b256(stringToBytes("utf8", "dummy-commitment"));

    participationContract.addUTxOs({
      creationHeight: mockChain.height - 90,
      ergoTree: participationErgoTree.toHex(),
      assets: [],
      value: participationFee,
      additionalRegisters: {
        R4: SGroupElement( playerPkBytes).toHex(),
        R5: SColl(SByte, dummyCommitment).toHex(),
        R6: SColl(SByte, gameNftId).toHex(),
        R7: SColl(SByte, stringToBytes("utf8", "player1-solver")).toHex(),
        R8: SColl(SByte, stringToBytes("utf8", "logs1")).toHex(),
        R9: SColl(SLong, [500n, 800n, 1000n, 1200n]).toHex()
      }
    });
  });

  it("should allow a player to claim a refund if the game is cancelled", () => {
    const currentHeight = mockChain.height;

    // Caja de salida que devuelve los fondos al jugador
    const refundOutput = new OutputBuilder(participationFee, player.address);
    
    const participationBoxToSpend = participationContract.utxos.toArray()[0];
    const gameCancelledBoxAsData = gameCancelledContract.utxos.toArray()[0];

    const tx = new TransactionBuilder(currentHeight)
      .from([participationBoxToSpend, ...player.utxos.toArray()])
      .withDataFrom([gameCancelledBoxAsData])
      .to([refundOutput])
      .sendChangeTo(player.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(tx, { signers: [player] });

    // 1. La transacción debe ser válida
    expect(executionResult).to.be.true;

    // 2. La caja de participación debe haber sido gastada
    expect(participationContract.utxos.length).to.equal(0);

    // 3. La caja del juego cancelado (data input) no debe haber sido gastada
    expect(gameCancelledContract.utxos.length).to.equal(1);
    
    // 4. El jugador debe tener una nueva caja con el valor del reembolso
    const playerRefundBox = player.utxos.toArray().find(box => box.value === participationFee);
    expect(playerRefundBox).to.not.be.undefined;
    expect(playerRefundBox?.value).to.equal(participationFee);
  });
});