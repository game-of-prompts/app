import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockChain, KeyedMockChainParty } from "@fleet-sdk/mock-chain";
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
import {
  getGopGameActiveErgoTree,
  getGopGameResolutionErgoTree,
  getGopParticipationErgoTree,
  getGopFalseErgoTreeHex,
} from "$lib/ergo/contract";
import { DefaultGameConstants, getGameConstants, GAME_NFT_AMOUNT } from "$lib/common/constants";
import { DEV_SCRIPT, DEV_COMMISSION_PERCENTAGE } from "$lib/ergo/envs";

const COMMISSION_DENOMINATOR = getGameConstants().COMMISSION_DENOMINATOR;
const CREATOR_SLASH_RATIO = BigInt(COMMISSION_DENOMINATOR);

const ERG_BASE_TOKEN = "";
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
  let creator: KeyedMockChainParty;
  let participant1: KeyedMockChainParty;
  let participant2: KeyedMockChainParty;

  // --- Partidos de Contratos --- 
  let gameActiveContract: any;
  let participationContract: any;
  let gameResolutionContract: any;

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
      { tokenId: gameNftId, amount: GAME_NFT_AMOUNT },
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

        // R5: Coll[Byte] - seed
        R5: SColl(SByte, hexToBytes(seed)!).toHex(),

        // R6: Coll[Byte] - secretHash
        R6: SColl(SByte, hashedSecret).toHex(),

        // R7: Coll[Coll[Byte]] - invitedJudgesReputationProofs
        R7: SColl(SColl(SByte), []).toHex(),

        // R8: Coll[Long] - numericalParameters: [deadline, resolverStake, participationFee, perJudgeCommission, resolverCommission]
        R8: SColl(SLong, [
          1n, // createdAt
          20n,                  // timeWeight
          BigInt(deadlineBlock),
          resolverStake,
          participationFee,
          perJudgeCommission,
          resolver_commission_percentage,
          BigInt(Math.round(DEV_COMMISSION_PERCENTAGE / 100 * COMMISSION_DENOMINATOR)),
          CREATOR_SLASH_RATIO
        ]).toHex(),

        // R9: JSON Details
        R9: SColl(SColl(SByte), [stringToBytes("utf8", "{}"), hexToBytes(mode.token) ?? "", hexToBytes(DEV_SCRIPT)!]).toHex()
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

    const newNumericalParams = [
      1n, // createdAt
      20n,                  // timeWeight
      BigInt(deadlineBlock),
      resolverStake,
      participationFee,
      perJudgeCommission,
      resolver_commission_percentage,
      BigInt(Math.round(DEV_COMMISSION_PERCENTAGE / 100 * COMMISSION_DENOMINATOR)),
      CREATOR_SLASH_RATIO,
      resolutionDeadline
    ];

    const gameResolutionBoxValue = mode.token === ERG_BASE_TOKEN ? resolverStake : RECOMMENDED_MIN_FEE_VALUE;
    const gameResolutionAssets = [
      { tokenId: gameNftId, amount: GAME_NFT_AMOUNT },
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
          hexToBytes(DEV_SCRIPT)!, // Script del desarrollador
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

    // Create solver ID box
    const solverIdBox = {
      creationHeight: deadlineBlock - DefaultGameConstants.PARTICIPATION_TIME_WINDOW - DefaultGameConstants.SEED_MARGIN - 1, // Created before deadline
      ergoTree: getGopFalseErgoTreeHex(),
      assets: [],
      value: RECOMMENDED_MIN_FEE_VALUE,
      additionalRegisters: {
        R4: SColl(SByte, stringToBytes("utf8", "player1-solver")).toHex()
      }
    };
    creator.addUTxOs(solverIdBox);

    mockChain.newBlocks(deadlineBlock - mockChain.height + 1);
  });

  it("should successfully transition the game to the resolution phase", () => {
    const currentHeight = mockChain.height;

    const tx = new TransactionBuilder(currentHeight)
      .from([
        gameActiveContract.utxos.toArray()[0],
        ...creator.utxos.toArray()])
      .to([gameBoxOutput])
      .withDataFrom([participationContract.utxos.toArray()[0], creator.utxos.toArray()[creator.utxos.toArray().length - 1]])
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(tx, { signers: [creator] });

    expect(executionResult).to.be.true;
  });

  it("should deny the resolver to inflate their commission during resolution transition", () => {
    const currentHeight = mockChain.height;
    const inflatedResolverCommissionPercentage = resolver_commission_percentage + 25n;

    const inflatedResolutionOutput = new OutputBuilder(
      mode.token === ERG_BASE_TOKEN ? resolverStake : RECOMMENDED_MIN_FEE_VALUE,
      gameResolutionContract.address
    )
      .addTokens([
        { tokenId: gameNftId, amount: GAME_NFT_AMOUNT },
        ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: resolverStake }] : [])
      ])
      .setAdditionalRegisters({
        R4: SInt(1).toHex(),
        R5: SColl(SByte, hexToBytes(seed)!).toHex(),
        R6: SPair(SColl(SByte, secret), SColl(SByte, hexToBytes(winnerCandidateCommitment)!)).toHex(),
        R7: SColl(SColl(SByte), []).toHex(),
        R8: SColl(SLong, [
          1n,
          20n,
          BigInt(deadlineBlock),
          resolverStake,
          participationFee,
          perJudgeCommission,
          inflatedResolverCommissionPercentage,
          BigInt(Math.round(DEV_COMMISSION_PERCENTAGE / 100 * COMMISSION_DENOMINATOR)),
          CREATOR_SLASH_RATIO,
          resolutionDeadline
        ]).toHex(),
        R9: SColl(SColl(SByte), [
          stringToBytes("utf8", "{}"),
          hexToBytes(mode.token) ?? "",
          hexToBytes(DEV_SCRIPT)!,
          creator.address.getPublicKeys()[0]
        ]).toHex()
      });

    const tx = new TransactionBuilder(currentHeight)
      .from([
        gameActiveContract.utxos.toArray()[0],
        ...creator.utxos.toArray()])
      .to([inflatedResolutionOutput])
      .withDataFrom([participationContract.utxos.toArray()[0], creator.utxos.toArray()[creator.utxos.toArray().length - 1]])
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(tx, { signers: [creator], throw: false });

    expect(executionResult).to.be.false;
  });

  it("should FAIL if the resolution deadline is set far in the future", () => {
    // Ending the game needs HEIGHT >= resolutionDeadline: a huge value would lock the stake and every participation.
    const farResolutionOutput = new OutputBuilder(
      mode.token === ERG_BASE_TOKEN ? resolverStake : RECOMMENDED_MIN_FEE_VALUE,
      gameResolutionContract.address
    )
      .addTokens([
        { tokenId: gameNftId, amount: GAME_NFT_AMOUNT },
        ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: resolverStake }] : [])
      ])
      .setAdditionalRegisters({
        R4: SInt(1).toHex(),
        R5: SColl(SByte, hexToBytes(seed)!).toHex(),
        R6: SPair(SColl(SByte, secret), SColl(SByte, hexToBytes(winnerCandidateCommitment)!)).toHex(),
        R7: SColl(SColl(SByte), []).toHex(),
        R8: SColl(SLong, [
          1n,
          20n,
          BigInt(deadlineBlock),
          resolverStake,
          participationFee,
          perJudgeCommission,
          resolver_commission_percentage,
          BigInt(Math.round(DEV_COMMISSION_PERCENTAGE / 100 * COMMISSION_DENOMINATOR)),
          CREATOR_SLASH_RATIO,
          9_223_372_036_854_775_807n  // Long.MaxValue
        ]).toHex(),
        R9: SColl(SColl(SByte), [
          stringToBytes("utf8", "{}"),
          hexToBytes(mode.token) ?? "",
          hexToBytes(DEV_SCRIPT)!,
          creator.address.getPublicKeys()[0]
        ]).toHex()
      });

    const tx = new TransactionBuilder(mockChain.height)
      .from([
        gameActiveContract.utxos.toArray()[0],
        ...creator.utxos.toArray()])
      .to([farResolutionOutput])
      .withDataFrom([participationContract.utxos.toArray()[0], creator.utxos.toArray()[creator.utxos.toArray().length - 1]])
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    expect(mockChain.execute(tx, { signers: [creator], throw: false })).to.be.false;
    expect(gameActiveContract.utxos.length).to.equal(1);
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
      .withDataFrom([participationContract.utxos.toArray()[1], creator.utxos.toArray()[creator.utxos.toArray().length - 1]])
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
      .withDataFrom([participationContract.utxos.toArray()[1], creator.utxos.toArray()[creator.utxos.toArray().length - 1]])
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
      .withDataFrom([participationContract.utxos.toArray()[1], creator.utxos.toArray()[creator.utxos.toArray().length - 1]])
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(tx, { signers: [creator], throw: false });

    expect(executionResult).to.be.false;
  });

  it("should FAIL transition the game to the resolution phase if output state is wrong", () => {
    const currentHeight = mockChain.height;

    const resolvedorPkBytes = creator.address.getPublicKeys()[0];

    const newNumericalParams = [
      1n, // createdAt
      20n,                  // timeWeight
      BigInt(deadlineBlock),
      resolverStake,
      participationFee,
      perJudgeCommission,
      resolver_commission_percentage,
      BigInt(Math.round(DEV_COMMISSION_PERCENTAGE / 100 * COMMISSION_DENOMINATOR)),
      CREATOR_SLASH_RATIO,
      resolutionDeadline
    ];

    const gameResolutionBoxValue = mode.token === ERG_BASE_TOKEN ? resolverStake : RECOMMENDED_MIN_FEE_VALUE;
    const gameResolutionAssets = [
      { tokenId: gameNftId, amount: GAME_NFT_AMOUNT },
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
              hexToBytes(DEV_SCRIPT)!, // Script del desarrollador
              resolvedorPkBytes           // Script de gasto del resolvedor
            ]).toHex()
          })
      ])
      .withDataFrom([participationContract.utxos.toArray()[0], creator.utxos.toArray()[creator.utxos.toArray().length - 1]])
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
    const newNumericalParams = [
      1n, // createdAt
      20n, // timeWeight
      BigInt(deadlineBlock),
      resolverStake,
      participationFee,
      perJudgeCommission,
      resolver_commission_percentage,
      BigInt(Math.round(DEV_COMMISSION_PERCENTAGE / 100 * COMMISSION_DENOMINATOR)),
      CREATOR_SLASH_RATIO,
      resolutionDeadline
    ];
    const resolvedorPkBytes = creatorPkBytes;

    const gameResolutionBoxValue = mode.token === ERG_BASE_TOKEN ? resolverStake : RECOMMENDED_MIN_FEE_VALUE;
    const gameResolutionAssets = [
      { tokenId: gameNftId, amount: GAME_NFT_AMOUNT },
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
          hexToBytes(DEV_SCRIPT)!,
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
      .withDataFrom([participationContract.utxos.toArray()[1], creator.utxos.toArray()[creator.utxos.toArray().length - 1]]) // Use the new invalid box
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(tx, { signers: [creator], throw: false });

    expect(executionResult).to.be.false;
  });

  it("should FAIL transition the game to the resolution phase if R9 is modified", () => {
    const currentHeight = mockChain.height;
    const creatorPkBytes = creator.address.getPublicKeys()[0];
    const newNumericalParams = [
      1n, // createdAt
      20n, // timeWeight
      BigInt(deadlineBlock),
      resolverStake,
      participationFee,
      perJudgeCommission,
      resolver_commission_percentage,
      BigInt(Math.round(DEV_COMMISSION_PERCENTAGE / 100 * COMMISSION_DENOMINATOR)),
      CREATOR_SLASH_RATIO,
      resolutionDeadline
    ];

    const gameResolutionBoxValue = mode.token === ERG_BASE_TOKEN ? resolverStake : RECOMMENDED_MIN_FEE_VALUE;
    const gameResolutionAssets = [
      { tokenId: gameNftId, amount: GAME_NFT_AMOUNT },
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
            hexToBytes(DEV_SCRIPT)!,
            creatorPkBytes           // Script de gasto del resolvedor
          ]).toHex()
        })])
      .withDataFrom([participationContract.utxos.toArray()[0], creator.utxos.toArray()[creator.utxos.toArray().length - 1]])
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(tx, { signers: [creator], throw: false });

    expect(executionResult).to.be.false;
  });

});
