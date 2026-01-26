import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockChain } from "@fleet-sdk/mock-chain";
import {
  OutputBuilder,
  RECOMMENDED_MIN_FEE_VALUE,
  TransactionBuilder,
} from "@fleet-sdk/core";
import { SByte, SColl, SLong, SInt } from "@fleet-sdk/serializer";
import { blake2b256 } from "@fleet-sdk/crypto";
import { stringToBytes } from "@scure/base";
import { prependHexPrefix } from "$lib/utils";
import { getGopGameCancellationErgoTree, getGopParticipationErgoTree } from "$lib/ergo/contract";
import { hexToBytes } from "$lib/ergo/utils";


const ERG_BASE_TOKEN = "";
const ERG_BASE_TOKEN_NAME = "ERG";
const USD_BASE_TOKEN = "ebb40ecab7bb7d2a935024100806db04f44c62c33ae9756cf6fc4cb6b9aa2d12";
const USD_BASE_TOKEN_NAME = "USD";

const baseModes = [
  { name: "USD Token Mode", token: USD_BASE_TOKEN, tokenName: USD_BASE_TOKEN_NAME },
];

describe.each(baseModes)("Participation Contract: Refund after Game Cancellation - (%s)", (mode) => {
  let mockChain: MockChain;

  const participationErgoTree = getGopParticipationErgoTree();
  const gameCancellationErgoTree = getGopGameCancellationErgoTree();

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

    if (mode.token !== ERG_BASE_TOKEN) {
      player.addBalance({
        tokens: [{ tokenId: mode.token, amount: participationFee * 2n }],
        nanoergs: RECOMMENDED_MIN_FEE_VALUE * 10n
      });
    } else {
      player.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });
    }

    // --- Definir Partidos de Contratos ---
    participationContract = mockChain.addParty(participationErgoTree.toHex(), "ParticipationContract");
    gameCancelledContract = mockChain.addParty(gameCancellationErgoTree.toHex(), "GameCancelledContract");

    // --- Crear el estado inicial: una caja de juego cancelada y una participación ---
    gameNftId = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
    const secret = stringToBytes("utf8", "the-secret-was-revealed");

    // 1. Crear la caja `game_cancelled.es` (Data Input)
    // Esta caja simula un juego que ha sido cancelado.
    const gameBoxValue = mode.token === ERG_BASE_TOKEN ? creatorInitialStake : RECOMMENDED_MIN_FEE_VALUE;
    const gameAssets = [
      { tokenId: gameNftId, amount: 1n },
      ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: creatorInitialStake }] : [])
    ];

    gameCancelledContract.addUTxOs({
      creationHeight: mockChain.height - 100, // Creada en el pasado
      ergoTree: gameCancellationErgoTree.toHex(),
      assets: gameAssets,
      value: gameBoxValue, // El stake que queda
      additionalRegisters: {
        R4: SInt(2).toHex(), // Estado 2: "Cancelled"
        R5: SLong(BigInt(mockChain.height - 50)).toHex(), // unlockHeight en el pasado
        R6: SColl(SByte, secret).toHex(), // El secreto revelado
        R7: SLong(creatorInitialStake).toHex(), // Stake actual
        R8: SLong(BigInt(mockChain.height)).toHex(), // originalDeadline (Long)
        R9: SColl(SColl(SByte), [
          stringToBytes("utf8", "{}"),
          hexToBytes(mode.token) ?? new Uint8Array(0),
          prependHexPrefix(creator.address.getPublicKeys()[0], "0008cd")
        ]).toHex(),
      }
    });

    // 2. Crear la caja `participation.es` (Input a gastar)
    // Esta es la caja del jugador que quiere su reembolso.
    const playerPkBytes = player.address.getPublicKeys()[0];
    const dummyCommitment = blake2b256(stringToBytes("utf8", "dummy-commitment"));

    const participationValue = mode.token === ERG_BASE_TOKEN ? participationFee : RECOMMENDED_MIN_FEE_VALUE;
    const participationAssets = mode.token === ERG_BASE_TOKEN
      ? []
      : [{ tokenId: mode.token, amount: participationFee }];

    participationContract.addUTxOs({
      creationHeight: mockChain.height - 90,
      ergoTree: participationErgoTree.toHex(),
      assets: participationAssets,
      value: participationValue,
      additionalRegisters: {
        R4: SColl(SByte, prependHexPrefix(playerPkBytes)).toHex(),
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
    const refundValue = mode.token === ERG_BASE_TOKEN ? participationFee : RECOMMENDED_MIN_FEE_VALUE;
    const refundAssets = mode.token === ERG_BASE_TOKEN
      ? []
      : [{ tokenId: mode.token, amount: participationFee }];

    const refundOutput = new OutputBuilder(refundValue, player.address).addTokens(refundAssets);

    const participationBoxToSpend = participationContract.utxos.toArray()[0];
    const gameCancelledBoxAsData = gameCancelledContract.utxos.toArray()[0];

    const tx = new TransactionBuilder(currentHeight)
      .from([participationBoxToSpend, ...player.utxos.toArray()])
      .withDataFrom([gameCancelledBoxAsData])
      .to([refundOutput])
      .sendChangeTo(player.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(tx, { signers: [player as any] });

    expect(executionResult).to.be.true;
  });
});