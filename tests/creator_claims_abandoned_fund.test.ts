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


describe("Creator Claims Abandoned Funds", () => {
  let mockChain: MockChain;
  let creator: ReturnType<MockChain["newParty"]>;
  let participant: ReturnType<MockChain["newParty"]>;
  let gameResolutionContract: ReturnType<MockChain["newParty"]>;
  let participationContract: ReturnType<MockChain["newParty"]>;
  let gameResolutionBox: Box;
  let participationBox: Box;
  const creatorStake = 1_000_000_000n;
  const participationFee = 1_000_000_000n;
  const resolutionDeadline = 800_200;
  const gameNftId = "fad58de3081b83590551ac9e28f3657b98d9f1c7842628d05267a57f1852f417";

  const ABANDON_PERIOD_IN_BLOCKS = 64800;

  let gameResolutionErgoTree: ErgoTree = getGopGameResolutionErgoTree();
  let participationErgoTree: ErgoTree = getGopParticipationErgoTree();

  beforeEach(() => {
    mockChain = new MockChain({ height: 800_000 });
    creator = mockChain.newParty("GameCreator");
    participant = mockChain.newParty("Participant");
    creator.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE * 2n });

    gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
    participationContract = mockChain.addParty(participationErgoTree.toHex(), "Participation");

    gameResolutionContract.addUTxOs({
      value: creatorStake,
      ergoTree: gameResolutionErgoTree.toHex(),
      assets: [{ tokenId: gameNftId, amount: 1n }],
      creationHeight: mockChain.height,
      additionalRegisters: {
        R4: SInt(1).toHex(),
        R5: SPair(SColl(SByte, "00".repeat(32)), SColl(SByte, "aa".repeat(32))).toHex(),
        R6: SColl(SColl(SByte), []).toHex(),
        R7: SColl(SLong, [0n, creatorStake, participationFee, BigInt(resolutionDeadline)]).toHex(),
        R8: SPair(SColl(SByte, prependHexPrefix(creator.key.publicKey, "0008cd")), SLong(10n)).toHex(),
      },
    });

    participationContract.addUTxOs({
      value: participationFee,
      ergoTree: participationErgoTree.toHex(),
      assets: [],
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
    mockChain.reset({clearParties: true});
  });

  it("should allow the creator to claim abandoned funds if the abandon period has passed", () => {
    const abandonHeight = resolutionDeadline + ABANDON_PERIOD_IN_BLOCKS;
    mockChain.jumpTo(abandonHeight);
    const creatorInitialBalance = creator.balance.nanoergs;
    
    const claimTx = new TransactionBuilder(mockChain.height)
      .from([participationBox, ...creator.utxos.toArray()])
      .withDataFrom([gameResolutionBox])
      .to(new OutputBuilder(participationBox.value, creator.address))
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(claimTx, { signers: [creator] });

    expect(executionResult).to.be.true;
    expect(participationContract.utxos.length).to.equal(0);
    const expectedBalance = creatorInitialBalance + participationFee - RECOMMENDED_MIN_FEE_VALUE;
    expect(creator.balance.nanoergs).to.equal(expectedBalance);
    expect(gameResolutionContract.utxos.length).to.equal(1);
  });

  it("should FAIL to claim abandoned funds if the abandon period has NOT passed", () => {
    const abandonHeight = resolutionDeadline + ABANDON_PERIOD_IN_BLOCKS - 10;
    mockChain.jumpTo(abandonHeight);

    const claimTx = new TransactionBuilder(mockChain.height)
      .from([participationBox, ...creator.utxos.toArray()])
      .withDataFrom([gameResolutionBox])
      .to(new OutputBuilder(participationBox.value, creator.address))
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(claimTx, { signers: [creator], throw: false });

    expect(executionResult).to.be.false;
    expect(participationContract.utxos.length).to.equal(1);
  });

  it("should FAIL to claim abandoned funds if no data input is provided", () => {
    const abandonHeight = resolutionDeadline + ABANDON_PERIOD_IN_BLOCKS;
    mockChain.jumpTo(abandonHeight);

    const claimTx = new TransactionBuilder(mockChain.height)
      .from([participationBox, ...creator.utxos.toArray()])
      .to(new OutputBuilder(participationBox.value, creator.address))
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(claimTx, { signers: [creator], throw: false });

    expect(executionResult).to.be.false;
    expect(participationContract.utxos.length).to.equal(1);
  });

  it("should FAIL to claim abandoned funds if wrong game NFT in data input", () => {
    const abandonHeight = resolutionDeadline + ABANDON_PERIOD_IN_BLOCKS;
    mockChain.jumpTo(abandonHeight);

    const wrongNftId = "fad58de3081b83590551ac9e28f3657b98d9f1c7842628d05267a57f1852f418"; // last digit changed
    gameResolutionContract.addUTxOs({
      value: creatorStake,
      ergoTree: gameResolutionErgoTree.toHex(),
      assets: [{ tokenId: wrongNftId, amount: 1n }],
      creationHeight: mockChain.height,
      additionalRegisters: {
        R4: SInt(0).toHex(),
        R5: SPair(SColl(SByte, "00".repeat(32)), SColl(SByte, "aa".repeat(32))).toHex(),
        R6: SColl(SColl(SByte), []).toHex(),
        R7: SColl(SLong, [0n, creatorStake, participationFee, BigInt(resolutionDeadline)]).toHex(),
        R8: SPair(SColl(SByte, prependHexPrefix(creator.key.publicKey, "0008cd")), SLong(10n)).toHex(),
      },
    });
    const wrongGameResolutionBox = gameResolutionContract.utxos.toArray()[1];

    const claimTx = new TransactionBuilder(mockChain.height)
      .from([participationBox, ...creator.utxos.toArray()])
      .withDataFrom([wrongGameResolutionBox])
      .to(new OutputBuilder(participationBox.value, creator.address))
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(claimTx, { signers: [creator], throw: false });

    expect(executionResult).to.be.false;
    expect(participationContract.utxos.length).to.equal(1);
  });

  it("should FAIL to claim abandoned funds if game state is not resolved", () => {
    const abandonHeight = resolutionDeadline + ABANDON_PERIOD_IN_BLOCKS;
    mockChain.jumpTo(abandonHeight);

    gameResolutionContract.addUTxOs({
      value: creatorStake,
      ergoTree: gameResolutionErgoTree.toHex(),
      assets: [{ tokenId: gameNftId, amount: 1n }],
      creationHeight: mockChain.height,
      additionalRegisters: {
        R4: SInt(0).toHex(),
        R5: SPair(SColl(SByte, "00".repeat(32)), SColl(SByte, "aa".repeat(32))).toHex(),
        R6: SColl(SColl(SByte), []).toHex(),
        R7: SColl(SLong, [0n, creatorStake, participationFee, BigInt(resolutionDeadline)]).toHex(),
        R8: SPair(SColl(SByte, prependHexPrefix(creator.key.publicKey, "0008cd")), SLong(10n)).toHex(),
      },
    });
    const wrongStateGameBox = gameResolutionContract.utxos.toArray()[1];

    const claimTx = new TransactionBuilder(mockChain.height)
      .from([participationBox, ...creator.utxos.toArray()])
      .withDataFrom([wrongStateGameBox])
      .to(new OutputBuilder(participationBox.value, creator.address))
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(claimTx, { signers: [creator], throw: false });

    expect(executionResult).to.be.false;
    expect(participationContract.utxos.length).to.equal(1);
  });

  it("should FAIL to claim abandoned funds if output is not sent to creator", () => {
    const abandonHeight = resolutionDeadline + ABANDON_PERIOD_IN_BLOCKS;
    mockChain.jumpTo(abandonHeight);

    const claimTx = new TransactionBuilder(mockChain.height)
      .from([participationBox, ...creator.utxos.toArray()])
      .withDataFrom([gameResolutionBox])
      .to(new OutputBuilder(participationBox.value, participant.address))
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(claimTx, { signers: [creator], throw: false });

    expect(executionResult).to.be.false;
    expect(participationContract.utxos.length).to.equal(1);
  });

  it("should FAIL to claim abandoned funds if not signed by creator", () => {
    const abandonHeight = resolutionDeadline + ABANDON_PERIOD_IN_BLOCKS;
    mockChain.jumpTo(abandonHeight);

    const claimTx = new TransactionBuilder(mockChain.height)
      .from([participationBox, ...creator.utxos.toArray()])
      .withDataFrom([gameResolutionBox])
      .to(new OutputBuilder(participationBox.value, creator.address))
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(claimTx, { signers: [participant], throw: false });

    expect(executionResult).to.be.false;
    expect(participationContract.utxos.length).to.equal(1);
  });
});