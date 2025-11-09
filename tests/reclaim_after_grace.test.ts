import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockChain } from "@fleet-sdk/mock-chain";
import {
  Box,
  OutputBuilder,
  RECOMMENDED_MIN_FEE_VALUE,
  TransactionBuilder,
} from "@fleet-sdk/core";
import { SByte, SColl, SInt, SLong, SPair } from "@fleet-sdk/serializer";
import { blake2b256 } from "@fleet-sdk/crypto";
import { stringToBytes } from "@scure/base";
import { prependHexPrefix } from "$lib/utils";
import { DefaultGameConstants } from "$lib/common/constants";
import { getGopGameActiveErgoTree, getGopParticipationErgoTree } from "$lib/ergo/contract";


const GRACE_PERIOD_IN_BLOCKS = DefaultGameConstants.PARTICIPATION_GRACE_PERIOD_IN_BLOCKS;

describe("Participant Reclaim After Grace Period", () => {
  let mockChain: MockChain;
  let creator: ReturnType<MockChain["newParty"]>;
  let participant: ReturnType<MockChain["newParty"]>;
  let gameActiveContract: ReturnType<MockChain["newParty"]>;
  let participationContract: ReturnType<MockChain["newParty"]>;
  let gameActiveBox: Box;
  let participationBox: Box;

  const creatorStake = 1_000_000_000n;
  const participationFee = 1_000_000_000n;
  const deadlineBlock = 800_200;
  
  const gameNftId = "fad58de3081b83590551ac9e28f3657b98d9f1c7842628d05267a57f1852f417";

  const participationErgoTree = getGopParticipationErgoTree();
  const gameActiveErgoTree = getGopGameActiveErgoTree();

  beforeEach(() => {
    mockChain = new MockChain({ height: 800_000 });
    creator = mockChain.newParty("GameCreator");
    participant = mockChain.newParty("Participant");
    participant.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE * 2n });

    gameActiveContract = mockChain.addParty(gameActiveErgoTree.toHex(), "GameActive");
    participationContract = mockChain.addParty(participationErgoTree.toHex(), "Participation");

    gameActiveContract.addUTxOs({
      value: creatorStake,
      ergoTree: gameActiveErgoTree.toHex(),
      assets: [{ tokenId: gameNftId, amount: 1n }],
      creationHeight: mockChain.height,
      additionalRegisters: {
          // R4: Game state (0: Active)
          R4: SInt(0).toHex(),

          // R5: (Seed, Ceremony deadline)
          R5: SPair(
            SColl(SByte, stringToBytes("utf8", "seed-for-ceremony")),
            SLong(BigInt(deadlineBlock + 50))
          ).toHex(),

          // R6: Hash of the secret 'S'
          R6: SColl(SByte, blake2b256(stringToBytes("utf8", "secret"))).toHex(),

          // R7: Invited judges (empty in this test)
          R7: SColl(SColl(SByte), []).toHex(),

          // R8: [deadline, creatorStake, participationFee, perJudgeComissionPercentage, creatorComissionPercentage]
          R8: SColl(SLong, [
            BigInt(deadlineBlock),
            creatorStake,
            participationFee,
            500n,  // 5.00% comisión por juez
            1000n  // 10.00% comisión del creador,
          ]).toHex(),

          // R9: (Detalles del juego, Script del creador)
          R9: SColl(SColl(SByte), [
            SColl(SByte, stringToBytes("utf8", "{}")), "", // JSON con detalles del juego
            SColl(SByte, creator.key.publicKey) // Script de gasto del creador (placeholder)
          ]).toHex()
        },
    });

    participationContract.addUTxOs({
      value: participationFee,
      ergoTree: participationErgoTree.toHex(),
      assets: [],
      creationHeight: mockChain.height,
      additionalRegisters: {
        R4: SColl(SByte, prependHexPrefix(participant.address.getPublicKeys()[0])).toHex(),
        R5: SColl(SByte, "aa".repeat(32)).toHex(),
        R6: SColl(SByte, gameNftId).toHex(),
        R7: SColl(SByte, "bb".repeat(8)).toHex(),
        R8: SColl(SByte, "cc".repeat(32)).toHex(),
        R9: SColl(SLong, [100n, 200n]).toHex(),
      },
    });

    gameActiveBox = gameActiveContract.utxos.toArray()[0];
    participationBox = participationContract.utxos.toArray()[0];
  });

  afterEach(() => {
    mockChain.reset({clearParties: true});
  });

  it("should allow a participant to reclaim funds if the grace period has passed", () => {
    const reclaimHeight = deadlineBlock + GRACE_PERIOD_IN_BLOCKS;
    mockChain.jumpTo(reclaimHeight);
    const participantInitialBalance = participant.balance.nanoergs;
    
    const reclaimTx = new TransactionBuilder(mockChain.height)
      .from([participationBox, ...participant.utxos.toArray()])
      .withDataFrom([gameActiveBox])
      .to(new OutputBuilder(participationBox.value, participant.address))
      .sendChangeTo(participant.address)  // Could be any other address too
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(reclaimTx, { signers: [participant] });

    expect(executionResult).to.be.true;
    expect(participationContract.utxos.length).to.equal(0);
    const expectedBalance = participantInitialBalance + participationFee - RECOMMENDED_MIN_FEE_VALUE;
    expect(participant.balance.nanoergs).to.equal(expectedBalance);
    expect(gameActiveContract.utxos.length).to.equal(1);
  });

  it("should FAIL to reclaim funds if the grace period has NOT passed", () => {
    const reclaimHeight = deadlineBlock + GRACE_PERIOD_IN_BLOCKS - 10;  // Seems that the mockchain goes various blocks forward when executing the tx!
    mockChain.jumpTo(reclaimHeight);

    console.log(deadlineBlock, GRACE_PERIOD_IN_BLOCKS, reclaimHeight);
    console.log("Current height:", mockChain.height);

    const reclaimTx = new TransactionBuilder(mockChain.height)
      .from([participationBox, ...participant.utxos.toArray()])
      .withDataFrom([gameActiveBox])
      .to(new OutputBuilder(participationBox.value, participant.address))
      .sendChangeTo(participant.address) // Could be any other address too
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(reclaimTx, { signers: [participant], throw: false });

    expect(executionResult).to.be.false;
    expect(participationContract.utxos.length).to.equal(1);
  });
});