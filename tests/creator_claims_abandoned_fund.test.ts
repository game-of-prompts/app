import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockChain } from "@fleet-sdk/mock-chain";
import {
  Box,
  ErgoTree,
  OutputBuilder,
  RECOMMENDED_MIN_FEE_VALUE,
  TransactionBuilder,
} from "@fleet-sdk/core";
import { SByte, SColl, SInt, SLong, SPair } from "@fleet-sdk/serializer";
import { hexToBytes } from "$lib/ergo/utils";
import { prependHexPrefix } from "$lib/utils";
import { getGopGameResolutionErgoTree, getGopParticipationErgoTree } from "$lib/ergo/contract";
import { stringToBytes } from "@scure/base";

const ERG_BASE_TOKEN = "";
const ERG_BASE_TOKEN_NAME = "ERG";
const USD_BASE_TOKEN = "ebb40ecab7bb7d2a935024100806db04f44c62c33ae9756cf6fc4cb6b9aa2d12";
const USD_BASE_TOKEN_NAME = "USD";

const baseModes = [
  { name: "ERG Mode", token: ERG_BASE_TOKEN, tokenName: ERG_BASE_TOKEN_NAME },
  { name: "USD Token Mode", token: USD_BASE_TOKEN, tokenName: USD_BASE_TOKEN_NAME },
];

describe.each(baseModes)("Creator Claims Abandoned Funds - (%s)", (mode) => {
  let mockChain: MockChain;
  let resolver: ReturnType<MockChain["newParty"]>;
  let participant: ReturnType<MockChain["newParty"]>;
  let gameResolutionContract: ReturnType<MockChain["newParty"]>;
  let participationContract: ReturnType<MockChain["newParty"]>;
  let gameResolutionBox: Box;
  let participationBox: Box;
  const resolverStake = 1_000_000_000n;
  const participationFee = 1_000_000_000n;
  const resolutionDeadline = 800_200;
  const gameNftId = "fad58de3081b83590551ac9e28f3657b98d9f1c7842628d05267a57f1852f417";

  const ABANDON_PERIOD_IN_BLOCKS = 64800;

  let gameResolutionErgoTree: ErgoTree = getGopGameResolutionErgoTree();
  let participationErgoTree: ErgoTree = getGopParticipationErgoTree();

  beforeEach(() => {
    mockChain = new MockChain({ height: 800_000 });
    resolver = mockChain.newParty("GameCreator");
    participant = mockChain.newParty("Participant");

    if (mode.token !== ERG_BASE_TOKEN) {
      resolver.addBalance({
        tokens: [{ tokenId: mode.token, amount: participationFee * 2n }],
        nanoergs: RECOMMENDED_MIN_FEE_VALUE * 10n
      });
    } else {
      resolver.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE * 2n });
    }
     participant.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE * 10n });

    gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
    participationContract = mockChain.addParty(participationErgoTree.toHex(), "Participation");

    const gameBoxValue = mode.token === ERG_BASE_TOKEN ? resolverStake : RECOMMENDED_MIN_FEE_VALUE;
    const gameAssets = [
      { tokenId: gameNftId, amount: 1n },
      ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: resolverStake }] : [])
    ];

    gameResolutionContract.addUTxOs({
      value: gameBoxValue,
      ergoTree: gameResolutionErgoTree.toHex(),
      assets: gameAssets,
      creationHeight: mockChain.height,
      additionalRegisters: {
        // Estado del juego
        R4: SInt(1).toHex(),

        // SEED (32 bytes aleatorios)
        R5: SColl(SByte, hexToBytes("d4e5f6a7b8c90123456789abcdef0123456789abcdef0123d4e5f6a7b8c90123") ?? "").toHex(),

        // (revealedSecretS, winnerCandidateCommitment)
        R6: SPair(
          SColl(SByte, "aa".repeat(32)), // revealedSecretS
          SColl(SByte, "bb".repeat(32))  // winnerCandidateCommitment
        ).toHex(),

        // participatingJudges (en este caso vacío)
        R7: SColl(SColl(SByte), []).toHex(),

        // numericalParameters: [deadline, resolverStake, participationFee, perJudgeCommissionPercent, resolverComissionPercentage, resolutionDeadline]
        R8: SColl(SLong, [
          0n, // deadline
          resolverStake,         // resolverStake
          participationFee,         // participationFee
          0n,         // perJudgeCommissionPercent
          10n,                        // resolverComissionPercentage
          BigInt(resolutionDeadline)  // resolutionDeadline
        ]).toHex(),

        // gameProvenance: Coll[Coll[Byte]] con los tres elementos planos
        R9: SColl(SColl(SByte), [
          stringToBytes("utf8", "{}"),                                // detalles del juego (JSON/Hex)
          mode.token,
          prependHexPrefix(resolver.key.publicKey, "0008cd")  // script del resolvedor
        ]).toHex()
      },
    });

    const participationValue = mode.token === ERG_BASE_TOKEN ? participationFee : RECOMMENDED_MIN_FEE_VALUE;
    const participationAssets = mode.token === ERG_BASE_TOKEN
      ? []
      : [{ tokenId: mode.token, amount: participationFee }];

    participationContract.addUTxOs({
      value: participationValue,
      ergoTree: participationErgoTree.toHex(),
      assets: participationAssets,
      creationHeight: mockChain.height,
      additionalRegisters: {
        R4: SColl(SByte, participant.address.getPublicKeys()[0]).toHex(),
        R5: SColl(SByte, "aa".repeat(32)).toHex(),
        R6: SColl(SByte, hexToBytes(gameNftId) ?? "").toHex(),
        R7: SColl(SByte, "bb".repeat(8)).toHex(),
        R8: SColl(SByte, "cc".repeat(32)).toHex(),
        R9: SColl(SLong, [100n, 200n]).toHex(),
      },
    });

    gameResolutionBox = gameResolutionContract.utxos.toArray()[0];
    participationBox = participationContract.utxos.toArray()[0];
  });

  afterEach(() => {
    mockChain.reset({ clearParties: true });
  });

  it("should allow the resolver to claim abandoned funds if the abandon period has passed", () => {
    const abandonHeight = resolutionDeadline + ABANDON_PERIOD_IN_BLOCKS;
    mockChain.jumpTo(abandonHeight);
    const resolverInitialBalance = resolver.balance.nanoergs;

    const claimValue = mode.token === ERG_BASE_TOKEN ? participationBox.value : RECOMMENDED_MIN_FEE_VALUE;
    const claimAssets = mode.token === ERG_BASE_TOKEN
      ? []
      : [{ tokenId: mode.token, amount: participationFee }];

    const claimTx = new TransactionBuilder(mockChain.height)
      .from([participationBox, ...resolver.utxos.toArray()])
      .withDataFrom([gameResolutionBox])
      .to(new OutputBuilder(claimValue, resolver.address).addTokens(claimAssets))
      .sendChangeTo(resolver.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(claimTx, { signers: [resolver] });

    expect(executionResult).to.be.true;
  });

  it("should FAIL to claim abandoned funds if the abandon period has NOT passed", () => {
    const abandonHeight = resolutionDeadline + ABANDON_PERIOD_IN_BLOCKS - 10;
    mockChain.jumpTo(abandonHeight);

    const claimAssets = mode.token === ERG_BASE_TOKEN
      ? []
      : [{ tokenId: mode.token, amount: participationFee }];

    const claimTx = new TransactionBuilder(mockChain.height)
      .from([participationBox, ...resolver.utxos.toArray()])
      .withDataFrom([gameResolutionBox])
      .to(new OutputBuilder(participationBox.value, resolver.address).addTokens(claimAssets))
      .sendChangeTo(resolver.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(claimTx, { signers: [resolver], throw: false });

    expect(executionResult).to.be.false;
    expect(participationContract.utxos.length).to.equal(1);
  });

  it("should FAIL to claim abandoned funds if no data input is provided", () => {
    const abandonHeight = resolutionDeadline + ABANDON_PERIOD_IN_BLOCKS;
    mockChain.jumpTo(abandonHeight);

    const claimAssets = mode.token === ERG_BASE_TOKEN
      ? []
      : [{ tokenId: mode.token, amount: participationFee }];

    const claimTx = new TransactionBuilder(mockChain.height)
      .from([participationBox, ...resolver.utxos.toArray()])
      .to(new OutputBuilder(participationBox.value, resolver.address).addTokens(claimAssets))
      .sendChangeTo(resolver.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(claimTx, { signers: [resolver], throw: false });

    expect(executionResult).to.be.false;
    expect(participationContract.utxos.length).to.equal(1);
  });

  it("should FAIL to claim abandoned funds if wrong game NFT in data input", () => {
    const abandonHeight = resolutionDeadline + ABANDON_PERIOD_IN_BLOCKS;
    mockChain.jumpTo(abandonHeight);

    const wrongNftId = "fad58de3081b83590551ac9e28f3657b98d9f1c7842628d05267a57f1852f418"; // last digit changed
    gameResolutionContract.addUTxOs({
      value: resolverStake,
      ergoTree: gameResolutionErgoTree.toHex(),
      assets: [{ tokenId: wrongNftId, amount: 1n }],
      creationHeight: mockChain.height,
      additionalRegisters: {
        // Estado del juego
        R4: SInt(1).toHex(),

        // Nuevo SEED (32 bytes aleatorios)
        R5: SColl(SByte, hexToBytes("d4e5f6a7b8c90123456789abcdef0123456789abcdef0123d4e5f6a7b8c90123") ?? "").toHex(),

        // (revealedSecretS, winnerCandidateCommitment)
        R6: SPair(
          SColl(SByte, "aa".repeat(32)), // revealedSecretS
          SColl(SByte, "bb".repeat(32))  // winnerCandidateCommitment
        ).toHex(),

        // participatingJudges (en este caso vacío)
        R7: SColl(SColl(SByte), []).toHex(),

        // numericalParameters: [deadline, resolverStake, participationFee, perJudgeCommissionPercent, resolverComissionPercentage, resolutionDeadline]
        R8: SColl(SLong, [
          0n, // deadline
          resolverStake,         // resolverStake
          participationFee,         // participationFee
          0n,         // perJudgeCommissionPercent
          10n,                        // resolverComissionPercentage
          BigInt(resolutionDeadline)  // resolutionDeadline
        ]).toHex(),

        // gameProvenance: Coll[Coll[Byte]] con los tres elementos planos
        R9: SColl(SColl(SByte), [
          stringToBytes("utf8", "{}"),                                // detalles del juego (JSON/Hex)
          mode.token,
          prependHexPrefix(resolver.key.publicKey, "0008cd")  // script del resolvedor
        ]).toHex()
      },
    });
    const wrongGameResolutionBox = gameResolutionContract.utxos.toArray()[1];

    const claimAssets = mode.token === ERG_BASE_TOKEN
      ? []
      : [{ tokenId: mode.token, amount: participationFee }];

    const claimTx = new TransactionBuilder(mockChain.height)
      .from([participationBox, ...resolver.utxos.toArray()])
      .withDataFrom([wrongGameResolutionBox])
      .to(new OutputBuilder(participationBox.value, resolver.address).addTokens(claimAssets))
      .sendChangeTo(resolver.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(claimTx, { signers: [resolver], throw: false });

    expect(executionResult).to.be.false;
    expect(participationContract.utxos.length).to.equal(1);
  });

  it("should FAIL to claim abandoned funds if game state is not resolved", () => {
    const abandonHeight = resolutionDeadline + ABANDON_PERIOD_IN_BLOCKS;
    mockChain.jumpTo(abandonHeight);

    gameResolutionContract.addUTxOs({
      value: resolverStake,
      ergoTree: gameResolutionErgoTree.toHex(),
      assets: [{ tokenId: gameNftId, amount: 1n }],
      creationHeight: mockChain.height,
      additionalRegisters: {
        // Estado del juego
        R4: SInt(0).toHex(),

        // Nuevo SEED (32 bytes aleatorios)
        R5: SColl(SByte, hexToBytes("d4e5f6a7b8c90123456789abcdef0123456789abcdef0123d4e5f6a7b8c90123") ?? "").toHex(),

        // (revealedSecretS, winnerCandidateCommitment)
        R6: SPair(
          SColl(SByte, "aa".repeat(32)), // revealedSecretS
          SColl(SByte, "bb".repeat(32))  // winnerCandidateCommitment
        ).toHex(),

        // participatingJudges (en este caso vacío)
        R7: SColl(SColl(SByte), []).toHex(),

        // numericalParameters: [deadline, resolverStake, participationFee, perJudgeCommissionPercent, resolverComissionPercentage, resolutionDeadline]
        R8: SColl(SLong, [
          0n, // deadline
          resolverStake,         // resolverStake
          participationFee,         // participationFee
          0n,         // perJudgeCommissionPercent
          10n,                        // resolverComissionPercentage
          BigInt(resolutionDeadline)  // resolutionDeadline
        ]).toHex(),

        // gameProvenance: Coll[Coll[Byte]] con los tres elementos planos
        R9: SColl(SColl(SByte), [
          stringToBytes("utf8", "{}"),                                // detalles del juego (JSON/Hex)
          mode.token,
          prependHexPrefix(resolver.key.publicKey, "0008cd")  // script del resolvedor
        ]).toHex()
      },
    });
    const wrongStateGameBox = gameResolutionContract.utxos.toArray()[1];

    const claimAssets = mode.token === ERG_BASE_TOKEN
      ? []
      : [{ tokenId: mode.token, amount: participationFee }];

    const claimTx = new TransactionBuilder(mockChain.height)
      .from([participationBox, ...resolver.utxos.toArray()])
      .withDataFrom([wrongStateGameBox])
      .to(new OutputBuilder(participationBox.value, resolver.address).addTokens(claimAssets))
      .sendChangeTo(resolver.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(claimTx, { signers: [resolver], throw: false });

    expect(executionResult).to.be.false;
    expect(participationContract.utxos.length).to.equal(1);
  });

  it("should FAIL to claim abandoned funds if output is not sent to resolver", () => {
    const abandonHeight = resolutionDeadline + ABANDON_PERIOD_IN_BLOCKS;
    mockChain.jumpTo(abandonHeight);

    const claimAssets = mode.token === ERG_BASE_TOKEN
      ? []
      : [{ tokenId: mode.token, amount: participationFee }];

    const claimTx = new TransactionBuilder(mockChain.height)
      .from([participationBox, ...resolver.utxos.toArray()])
      .withDataFrom([gameResolutionBox])
      .to(new OutputBuilder(participationBox.value, participant.address).addTokens(claimAssets))
      .sendChangeTo(resolver.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(claimTx, { signers: [resolver], throw: false });

    expect(executionResult).to.be.false;
    expect(participationContract.utxos.length).to.equal(1);
  });

});