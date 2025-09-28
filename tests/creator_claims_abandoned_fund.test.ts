import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockChain } from "@fleet-sdk/mock-chain";
import { compile } from "@fleet-sdk/compiler";
import {
  Box,
  OutputBuilder,
  RECOMMENDED_MIN_FEE_VALUE,
  TransactionBuilder,
} from "@fleet-sdk/core";
import { SByte, SColl, SGroupElement, SInt, SLong, SPair } from "@fleet-sdk/serializer";
import { blake2b256 } from "@fleet-sdk/crypto";
import * as fs from "fs";
import * as path from "path";
import { stringToBytes } from "@scure/base";
import { PARTICIPATION } from "$lib/ergo/reputation/types";

const contractsDir = path.resolve(__dirname, "..", "contracts");

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

const GAME_RESOLUTION_TEMPLATE = fs.readFileSync(path.join(contractsDir, "game_resolution.es"), "utf-8");
const PARTICIPATION_TEMPLATE = fs.readFileSync(path.join(contractsDir, "participation.es"), "utf-8");

const DEV_ADDR_BASE58 = "9ejNy2qoifmzfCiDtEiyugthuXMriNNPhNKzzwjPtHnrK3esvbD";
const ABANDON_PERIOD_IN_BLOCKS = 64800;

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

  beforeEach(() => {
    mockChain = new MockChain({ height: 800_000 });
    creator = mockChain.newParty("GameCreator");
    participant = mockChain.newParty("Participant");
    creator.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE * 2n });

    const participationErgoTree = compile(PARTICIPATION_TEMPLATE);
    const participationHash = uint8ArrayToHex(blake2b256(participationErgoTree.bytes));
    const resolutionSource = GAME_RESOLUTION_TEMPLATE
      .replace("`+PARTICIPATION_SCRIPT_HASH+`", participationHash)
      .replace("`+REPUTATION_PROOF_SCRIPT_HASH+`", "0".repeat(64)) // No se usa en este script
      .replace("`+PARTICIPATION_TYPE_ID+`", PARTICIPATION)
      .replace("`+DEV_ADDR+`", DEV_ADDR_BASE58);
    const gameResolutionErgoTree = compile(resolutionSource);

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
        R8: SPair(SColl(SByte, creator.key.publicKey), SLong(10n)).toHex(),
      },
    });

    participationContract.addUTxOs({
      value: participationFee,
      ergoTree: participationErgoTree.toHex(),
      assets: [],
      creationHeight: mockChain.height,
      additionalRegisters: {
        R4: SGroupElement(participant.address.getPublicKeys()[0]).toHex(),
        R5: SColl(SByte, "aa".repeat(32)).toHex(),
        R6: SColl(SByte, gameNftId).toHex(),
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

    const wrongNftId = "wrong" + gameNftId.substring(5);
    const wrongGameBox = {
      ...gameResolutionBox,
      assets: [{ tokenId: wrongNftId, amount: 1n }],
    };
    gameResolutionContract.addUTxOs(wrongGameBox);
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

    const wrongStateBox = {
      ...gameResolutionBox,
      additionalRegisters: {
        ...gameResolutionBox.additionalRegisters,
        R4: SInt(0).toHex(),
      },
    };
    gameResolutionContract.addUTxOs(wrongStateBox);
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