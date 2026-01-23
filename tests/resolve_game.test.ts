import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockChain } from "@fleet-sdk/mock-chain";
import {
  OutputBuilder,
  RECOMMENDED_MIN_FEE_VALUE,
  TransactionBuilder,
} from "@fleet-sdk/core";
import { SByte, SColl, SLong, SPair, SInt } from "@fleet-sdk/serializer";
import { blake2b256 } from "@fleet-sdk/crypto";
import { stringToBytes } from "@scure/base";
import { bigintToLongByteArray, hexToBytes } from "$lib/ergo/utils";
import { prependHexPrefix } from "$lib/utils";
import { getGopGameActiveErgoTree, getGopGameResolutionErgoTree, getGopParticipationErgoTree } from "$lib/ergo/contract";
import { DefaultGameConstants } from "$lib/common/constants";

const ERG_BASE_TOKEN = "";
const ERG_BASE_TOKEN_NAME = "ERG";
const USD_BASE_TOKEN = "ebb40ecab7bb7d2a935024100806db04f44c62c33ae9756cf6fc4cb6b9aa2d12";
const USD_BASE_TOKEN_NAME = "USD";

const baseModes = [
  { name: "USD Token Mode", token: USD_BASE_TOKEN, tokenName: USD_BASE_TOKEN_NAME },
];

// Helper functions and contract loading remain the same...
function uint8ArrayToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

describe.each(baseModes)("Game Resolution (resolve_game) - (%s)", (mode) => {
  let mockChain: MockChain;

  // --- Actores ---
  let creator: ReturnType<MockChain["newParty"]>;
  let participant1: ReturnType<MockChain["newParty"]>;
  let participant2: ReturnType<MockChain["newParty"]>;

  // --- Partidos de Contratos --- 
  let gameActiveContract: ReturnType<MockChain["addParty"]>;
  let participationContract: ReturnType<MockChain["addParty"]>;
  let gameResolutionContract: ReturnType<MockChain["addParty"]>;

  const participationSubmittedErgoTree = getGopParticipationErgoTree();
  const gameResolutionErgoTree = getGopGameResolutionErgoTree();
  const gameActiveErgoTree = getGopGameActiveErgoTree();

  // --- Estado del Juego ---
  let secret: Uint8Array;
  let gameNftId: string;
  const resolver_commission_percentage = 10n;
  const perJudgeCommission = 1n;
  const deadlineBlock = 800_200;
  const participationFee = 1_000_000n;
  const resolverStake = 2_000_000_000n;
  const resolutionDeadline = BigInt(deadlineBlock + DefaultGameConstants.JUDGE_PERIOD + 10);  // Seems that the mockchain goes various blocks forward when executing the tx!
  let commitment1Hex: string;
  let gameBoxOutput: OutputBuilder;
  let score1: bigint;
  let participation1_registers: Record<string, string>;
  let winnerCandidateCommitment: string;
  const seed = "a3f9b7e12c9d55ab8068e3ff22b7a19c34d8f1cbeaa1e9c0138b82f00d5ea712";

  afterEach(() => {
    mockChain.reset({ clearParties: true });
  });

  beforeEach(() => {
    mockChain = new MockChain({ height: 800_000 });

    creator = mockChain.newParty("GameCreator");
    participant1 = mockChain.newParty("Player1");
    participant2 = mockChain.newParty("Player2");

    if (mode.token !== ERG_BASE_TOKEN) {
      creator.addBalance({
        tokens: [{ tokenId: mode.token, amount: resolverStake * 2n }],
        nanoergs: RECOMMENDED_MIN_FEE_VALUE * 10n
      });
    } else {
      creator.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE * 10n });
    }

    // --- Definir Partidos de Contratos --- 
    gameActiveContract = mockChain.addParty(gameActiveErgoTree.toHex(), "GameActiveContract");
    participationContract = mockChain.addParty(participationSubmittedErgoTree.toHex(), "ParticipationContract");
    gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolutionContract");


    // --- Creación de la caja `game_active.es` ---
    secret = stringToBytes("utf8", "the-secret-phrase-for-testing");
    const hashedSecret = blake2b256(secret);
    const creatorPkBytes = creator.address.getPublicKeys()[0];
    gameNftId = "c94a63ec4e9ae8700c671a908bd2121d4c049cec75a40f1309e09ab59d0bbc71";

    const gameBoxValue = mode.token === ERG_BASE_TOKEN ? resolverStake : RECOMMENDED_MIN_FEE_VALUE;
    const gameAssets = [
      { tokenId: gameNftId, amount: 1n },
      ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: resolverStake }] : [])
    ];

    // INPUTS(0)
    gameActiveContract.addUTxOs({
      creationHeight: mockChain.height,
      ergoTree: gameActiveErgoTree.toHex(),
      assets: gameAssets,
      value: gameBoxValue,
      additionalRegisters: {
        // R4: Integer - Game state (0: Active)
        R4: SInt(0).toHex(),

        // R5: (Coll[Byte], Long) - seed: (Seed, Ceremony deadline)
        R5: SPair(SColl(SByte, hexToBytes(seed)!), SLong(BigInt(mockChain.height + 10))).toHex(),

        // R6: Coll[Byte] - secretHash
        R6: SColl(SByte, hashedSecret).toHex(),

        // R7: Coll[Coll[Byte]] - invitedJudgesReputationProofs
        R7: SColl(SColl(SByte), []).toHex(),

        // R8: Coll[Long] - numericalParameters: [deadline, resolverStake, participationFee, perJudgeCommissionPercentage, resolverCommissionPercentage]
        R8: SColl(SLong, [
          BigInt(deadlineBlock),
          resolverStake,
          participationFee,
          perJudgeCommission,
          resolver_commission_percentage
        ]).toHex(),

        // R9: JSON Details
        R9: SColl(SColl(SByte), [stringToBytes("utf8", "{}"), hexToBytes(mode.token) ?? ""]).toHex()
      }
    });

    const resolvedorPkBytes = creatorPkBytes;

    const participantErgotree = prependHexPrefix(participant1.address.getPublicKeys()[0]);

    // --- Creación de las cajas `participation.es` ---
    score1 = 1000n;
    commitment1Hex = uint8ArrayToHex(blake2b256(
      new Uint8Array([...stringToBytes("utf8", "player1-solver"), ...hexToBytes(seed)!, ...bigintToLongByteArray(score1), ...stringToBytes("utf8", "logs1"), ...participantErgotree, ...secret])
    ));

    winnerCandidateCommitment = commitment1Hex;

    const newNumericalParams = [BigInt(deadlineBlock), resolverStake, participationFee, perJudgeCommission, resolver_commission_percentage, resolutionDeadline];

    const gameResolutionBoxValue = mode.token === ERG_BASE_TOKEN ? resolverStake : RECOMMENDED_MIN_FEE_VALUE;
    const gameResolutionAssets = [
      { tokenId: gameNftId, amount: 1n },
      ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: resolverStake }] : [])
    ];

    // OUTPUT(0)
    gameBoxOutput = new OutputBuilder(gameResolutionBoxValue, gameResolutionContract.address)
      .addTokens(gameResolutionAssets)
      .setAdditionalRegisters({

        // R4: Integer - Game state (1: Resolved)
        R4: SInt(1).toHex(),

        // R5: Coll[Byte] - Seed
        R5: SColl(SByte, hexToBytes(seed)!).toHex(),

        // R6: (Coll[Byte], Coll[Byte]) - (revealedSecretS, winnerCandidateCommitment)
        R6: SPair(SColl(SByte, secret), SColl(SByte, hexToBytes(winnerCandidateCommitment)!)).toHex(),

        // R7: Coll[Coll[Byte]] - participatingJudges (lista vacía)
        R7: SColl(SColl(SByte), []).toHex(),

        // R8: Coll[Long] - numericalParameters
        R8: SColl(SLong, newNumericalParams).toHex(),

        // R9: Coll[Coll[Byte]] - gameProvenance: (Detalles, Script Resolvedor)
        R9: SColl(SColl(SByte), [
          stringToBytes("utf8", "{}"), // Detalles del juego
          hexToBytes(mode.token) ?? "",
          resolvedorPkBytes           // Script de gasto del resolvedor
        ]).toHex()
      });

    participation1_registers = {
      R4: SColl(SByte, participantErgotree).toHex(),
      R5: SColl(SByte, commitment1Hex).toHex(),
      R6: SColl(SByte, gameNftId).toHex(),
      R7: SColl(SByte, stringToBytes("utf8", "player1-solver")).toHex(),
      R8: SColl(SByte, stringToBytes("utf8", "logs1")).toHex(),
      R9: SColl(SLong, [500n, 800n, score1, 1200n]).toHex()
    };

    const participationValue = mode.token === ERG_BASE_TOKEN ? participationFee : RECOMMENDED_MIN_FEE_VALUE;
    const participationAssets = mode.token === ERG_BASE_TOKEN
      ? []
      : [{ tokenId: mode.token, amount: participationFee }];

    // INPUTS(1)
    participationContract.addUTxOs({
      creationHeight: mockChain.height,
      ergoTree: participationSubmittedErgoTree.toHex(),
      assets: participationAssets,
      value: participationValue,
      additionalRegisters: participation1_registers
    });

    mockChain.newBlocks(deadlineBlock - mockChain.height + 1);
  });

  it("should successfully transition the game to the resolution phase", () => {
    const currentHeight = mockChain.height;

    const tx = new TransactionBuilder(currentHeight)
      .from([
        gameActiveContract.utxos.toArray()[0],
        ...creator.utxos.toArray()])
      .to([gameBoxOutput])
      .withDataFrom([participationContract.utxos.toArray()[0]])
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(tx, { signers: [creator] });

    expect(executionResult).to.be.true;
  });

  it("should FAIL transition the game to the resolution phase if participation game nft id is wrong", () => {
    const currentHeight = mockChain.height;

    const wrongGameNftId = "c94a63ec4e9ae8700c671a908bd2121d4c049cec75a40f1309e09ab59d0bbc72"; // last digit changed

    participationContract.addUTxOs({
      creationHeight: mockChain.height,
      ergoTree: participationSubmittedErgoTree.toHex(),
      assets: [],
      value: participationFee,
      additionalRegisters: {
        R4: SColl(SByte, participant1.address.getPublicKeys()[0]).toHex(),
        R5: SColl(SByte, commitment1Hex).toHex(),
        R6: SColl(SByte, wrongGameNftId).toHex(),
        R7: SColl(SByte, stringToBytes("utf8", "player1-solver")).toHex(),
        R8: SColl(SByte, stringToBytes("utf8", "logs1")).toHex(),
        R9: SColl(SLong, [500n, 800n, score1, 1200n]).toHex()
      }
    });

    const tx = new TransactionBuilder(currentHeight)
      .from([
        gameActiveContract.utxos.toArray()[0],
        ...creator.utxos.toArray()])
      .to([gameBoxOutput])
      .withDataFrom([participationContract.utxos.toArray()[1]])
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(tx, { signers: [creator], throw: false });

    expect(executionResult).to.be.false;
  });

  it("should FAIL transition the game to the resolution phase if commitment is wrong", () => {
    const currentHeight = mockChain.height;

    const wrongSecret = stringToBytes("utf8", "wrong-secret-phrase-for-testing");
    const wrongCommitment1Hex = uint8ArrayToHex(blake2b256(
      new Uint8Array([...stringToBytes("utf8", "player1-solver"), ...hexToBytes(seed)!, ...bigintToLongByteArray(score1), ...stringToBytes("utf8", "logs1"), ...wrongSecret])
    ));

    participationContract.addUTxOs({
      creationHeight: mockChain.height,
      ergoTree: participationSubmittedErgoTree.toHex(),
      assets: [],
      value: participationFee,
      additionalRegisters: {
        R4: SColl(SByte, participant1.address.getPublicKeys()[0]).toHex(),
        R5: SColl(SByte, wrongCommitment1Hex).toHex(),
        R6: SColl(SByte, gameNftId).toHex(),
        R7: SColl(SByte, stringToBytes("utf8", "player1-solver")).toHex(),
        R8: SColl(SByte, stringToBytes("utf8", "logs1")).toHex(),
        R9: SColl(SLong, [500n, 800n, score1, 1200n]).toHex()
      }
    });

    const tx = new TransactionBuilder(currentHeight)
      .from([
        gameActiveContract.utxos.toArray()[0],
        ...creator.utxos.toArray()])
      .to([gameBoxOutput])
      .withDataFrom([participationContract.utxos.toArray()[1]])
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(tx, { signers: [creator], throw: false });

    expect(executionResult).to.be.false;
  });

  it("should FAIL transition the game to the resolution phase if doesn't contains the real score", () => {
    const currentHeight = mockChain.height;

    participationContract.addUTxOs({
      creationHeight: mockChain.height,
      ergoTree: participationSubmittedErgoTree.toHex(),
      assets: [],
      value: participationFee,
      additionalRegisters: {
        R4: SColl(SByte, participant1.address.getPublicKeys()[0]).toHex(),
        R5: SColl(SByte, commitment1Hex).toHex(),
        R6: SColl(SByte, gameNftId).toHex(),
        R7: SColl(SByte, stringToBytes("utf8", "player1-solver")).toHex(),
        R8: SColl(SByte, stringToBytes("utf8", "logs1")).toHex(),
        R9: SColl(SLong, [500n, 800n, 640n, 1200n]).toHex()
      }
    });

    const tx = new TransactionBuilder(currentHeight)
      .from([
        gameActiveContract.utxos.toArray()[0],
        ...creator.utxos.toArray()])
      .to([gameBoxOutput])
      .withDataFrom([participationContract.utxos.toArray()[1]])
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(tx, { signers: [creator], throw: false });

    expect(executionResult).to.be.false;
  });

  it("should FAIL transition the game to the resolution phase if output state is wrong", () => {
    const currentHeight = mockChain.height;

    const resolvedorPkBytes = creator.address.getPublicKeys()[0];

    const newNumericalParams = [BigInt(deadlineBlock), resolverStake, participationFee, perJudgeCommission, resolver_commission_percentage, resolutionDeadline];

    const gameResolutionBoxValue = mode.token === ERG_BASE_TOKEN ? resolverStake : RECOMMENDED_MIN_FEE_VALUE;
    const gameResolutionAssets = [
      { tokenId: gameNftId, amount: 1n },
      ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: resolverStake }] : [])
    ];

    const tx = new TransactionBuilder(currentHeight)
      .from([
        gameActiveContract.utxos.toArray()[0],
        ...creator.utxos.toArray()])
      .to([
        new OutputBuilder(gameResolutionBoxValue, gameResolutionContract.address)
          .addTokens(gameResolutionAssets)
          .setAdditionalRegisters({

            // R4: Integer - Game state (1: Resolved)
            R4: SInt(0).toHex(),

            // R5: Coll[Byte] - Seed
            R5: SColl(SByte, hexToBytes(seed)!).toHex(),

            // R6: (Coll[Byte], Coll[Byte]) - (revealedSecretS, winnerCandidateCommitment)
            R6: SPair(SColl(SByte, secret), SColl(SByte, hexToBytes(winnerCandidateCommitment)!)).toHex(),

            // R7: Coll[Coll[Byte]] - participatingJudges (lista vacía)
            R7: SColl(SColl(SByte), []).toHex(),

            // R8: Coll[Long] - numericalParameters
            R8: SColl(SLong, newNumericalParams).toHex(),

            // R9: Coll[Coll[Byte]] - gameProvenance: (Detalles, Script Resolvedor)
            R9: SColl(SColl(SByte), [
              stringToBytes("utf8", "{}"), // Detalles del juego
              hexToBytes(mode.token) ?? "",
              resolvedorPkBytes           // Script de gasto del resolvedor
            ]).toHex()
          })
      ])
      .withDataFrom([participationContract.utxos.toArray()[0]])
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(tx, { signers: [creator], throw: false });

    expect(executionResult).to.be.false;
  });

  it("should successfully transition the game to the resolution phase without winner", () => {
    const currentHeight = mockChain.height;

    const resolver_commission_percentage = 10n;
    const creatorPkBytes = creator.address.getPublicKeys()[0];
    const newNumericalParams = [BigInt(deadlineBlock), resolverStake, participationFee, perJudgeCommission, resolver_commission_percentage, resolutionDeadline];
    const resolvedorPkBytes = creatorPkBytes;

    const gameResolutionBoxValue = mode.token === ERG_BASE_TOKEN ? resolverStake : RECOMMENDED_MIN_FEE_VALUE;
    const gameResolutionAssets = [
      { tokenId: gameNftId, amount: 1n },
      ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: resolverStake }] : [])
    ];

    const gameBoxOutputWithAnyWinner = new OutputBuilder(gameResolutionBoxValue, gameResolutionContract.address)
      .addTokens(gameResolutionAssets)
      .setAdditionalRegisters({

        // R4: Integer - Game state (1: Resolved)
        R4: SInt(1).toHex(),

        // R5: Coll[Byte] - Seed
        R5: SColl(SByte, hexToBytes(seed)!).toHex(),

        // R6: (Coll[Byte], Coll[Byte]) - (revealedSecretS, winnerCandidateCommitment)
        R6: SPair(SColl(SByte, secret), SColl(SByte, [])).toHex(),

        // R7: Coll[Coll[Byte]] - participatingJudges (lista vacía)
        R7: SColl(SColl(SByte), []).toHex(),

        // R8: Coll[Long] - numericalParameters
        R8: SColl(SLong, newNumericalParams).toHex(),

        // R9: Coll[Coll[Byte]] - gameProvenance: (Detalles, Script Resolvedor)
        R9: SColl(SColl(SByte), [
          stringToBytes("utf8", "{}"), // Detalles del juego
          hexToBytes(mode.token) ?? "",
          resolvedorPkBytes           // Script de gasto del resolvedor
        ]).toHex()
      });

    const tx = new TransactionBuilder(currentHeight)
      .from([
        gameActiveContract.utxos.toArray()[0],
        ...creator.utxos.toArray()])
      .to([gameBoxOutputWithAnyWinner])
      .withDataFrom([])
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(tx, { signers: [creator] });

    expect(executionResult).to.be.true;
  });

  it("should FAIL if the winning participation has more than 10 scores", () => {
    const currentHeight = mockChain.height;

    // Create a list of 11 scores
    const tooManyScores = Array.from({ length: 11 }, (_, i) => BigInt(i + 1));

    participationContract.addUTxOs({
      creationHeight: mockChain.height,
      ergoTree: participationSubmittedErgoTree.toHex(),
      assets: [],
      value: participationFee,
      additionalRegisters: {
        R4: SColl(SByte, participant1.address.getPublicKeys()[0]).toHex(),
        R5: SColl(SByte, commitment1Hex).toHex(),
        R6: SColl(SByte, gameNftId).toHex(),
        R7: SColl(SByte, stringToBytes("utf8", "player1-solver")).toHex(),
        R8: SColl(SByte, stringToBytes("utf8", "logs1")).toHex(),
        R9: SColl(SLong, tooManyScores).toHex(), // Using the list with 11 scores
      },
    });

    const tx = new TransactionBuilder(currentHeight)
      .from([
        gameActiveContract.utxos.toArray()[0],
        ...creator.utxos.toArray()
      ])
      .to([gameBoxOutput])
      .withDataFrom([participationContract.utxos.toArray()[1]]) // Use the new invalid box
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(tx, { signers: [creator], throw: false });

    expect(executionResult).to.be.false;
  });

  it("should FAIL transition the game to the resolution phase if R9 is modified", () => {
    const currentHeight = mockChain.height;
    const creatorPkBytes = creator.address.getPublicKeys()[0];
    const newNumericalParams = [BigInt(deadlineBlock), resolverStake, participationFee, perJudgeCommission, resolver_commission_percentage, resolutionDeadline];

    const gameResolutionBoxValue = mode.token === ERG_BASE_TOKEN ? resolverStake : RECOMMENDED_MIN_FEE_VALUE;
    const gameResolutionAssets = [
      { tokenId: gameNftId, amount: 1n },
      ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: resolverStake }] : [])
    ];

    const tx = new TransactionBuilder(currentHeight)
      .from([
        gameActiveContract.utxos.toArray()[0],
        ...creator.utxos.toArray()
      ])
      .to([new OutputBuilder(gameResolutionBoxValue, gameResolutionContract.address)
        .addTokens(gameResolutionAssets)
        .setAdditionalRegisters({

          // R4: Integer - Game state (1: Resolved)
          R4: SInt(1).toHex(),

          // R5: Coll[Byte] - Seed
          R5: SColl(SByte, hexToBytes(seed)!).toHex(),

          // R6: (Coll[Byte], Coll[Byte]) - (revealedSecretS, winnerCandidateCommitment)
          R6: SPair(SColl(SByte, secret), SColl(SByte, hexToBytes(winnerCandidateCommitment)!)).toHex(),

          // R7: Coll[Coll[Byte]] - participatingJudges (lista vacía)
          R7: SColl(SColl(SByte), []).toHex(),

          // R8: Coll[Long] - numericalParameters
          R8: SColl(SLong, newNumericalParams).toHex(),

          // R9: Coll[Coll[Byte]] - gameProvenance: (Detalles, Script Resolvedor)
          R9: SColl(SColl(SByte), [
            stringToBytes("utf8", '{"name": "anon"}'), // Detalles del juego modificados
            hexToBytes(mode.token) ?? "",
            creatorPkBytes           // Script de gasto del resolvedor
          ]).toHex()
        })])
      .withDataFrom([participationContract.utxos.toArray()[0]])
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(tx, { signers: [creator], throw: false });

    expect(executionResult).to.be.false;
  });

});
