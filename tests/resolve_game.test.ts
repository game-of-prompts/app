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

// Helper functions and contract loading remain the same...
function uint8ArrayToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

describe("Game Resolution (resolve_game)", () => {
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
  const creator_commission_percentage = 10n;
  const perJudgeCommission = 1n;
  const deadlineBlock = 800_200;
  const participationFee = 1_000_000n;
  const creatorStake = 2_000_000_000n;
  const resolutionDeadline = BigInt(deadlineBlock + 40);  // Seems that the mockchain goes various blocks forward when executing the tx!
  let commitment1Hex: string;
  let gameBoxOutput: OutputBuilder;
  let score1: bigint;
  let participation1_registers: Record<string, string>;
  let winnerCandidateCommitment: string;

  afterEach(() => {
    mockChain.reset({clearParties: true});
  });
  
  beforeEach(() => {
    mockChain = new MockChain({ height: 800_000 });

    creator = mockChain.newParty("GameCreator");
    participant1 = mockChain.newParty("Player1");
    participant2 = mockChain.newParty("Player2");
    creator.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });

    // --- Definir Partidos de Contratos --- 
    gameActiveContract = mockChain.addParty(gameActiveErgoTree.toHex(), "GameActiveContract");
    participationContract = mockChain.addParty(participationSubmittedErgoTree.toHex(), "ParticipationContract");
    gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolutionContract");


    // --- Creación de la caja `game_active.es` ---
    secret = stringToBytes("utf8", "the-secret-phrase-for-testing");
    const hashedSecret = blake2b256(secret);
    const creatorPkBytes = creator.address.getPublicKeys()[0];
    gameNftId = "c94a63ec4e9ae8700c671a908bd2121d4c049cec75a40f1309e09ab59d0bbc71";

    // INPUTS(0)
    gameActiveContract.addUTxOs({
      creationHeight: mockChain.height,
      ergoTree: gameActiveErgoTree.toHex(),
      assets: [{ tokenId: gameNftId, amount: 1n }],
      value: creatorStake,
      additionalRegisters: {
        // R4: Integer - Game state (0: Active)
        R4: SInt(0).toHex(),

        // R5: (Coll[Byte], Long) - seed: (Seed, Ceremony deadline)
        R5: SPair(SColl(SByte, "aa".repeat(32)), SLong(BigInt(mockChain.height + 10))).toHex(),

        // R6: Coll[Byte] - secretHash
        R6: SColl(SByte, hashedSecret).toHex(),

        // R7: Coll[Coll[Byte]] - invitedJudgesReputationProofs
        R7: SColl(SColl(SByte), []).toHex(),

        // R8: Coll[Long] - numericalParameters: [deadline, creatorStake, participationFee, perJudgeComissionPercentage, creatorComissionPercentage]
        R8: SColl(SLong, [
          BigInt(deadlineBlock),
          creatorStake,
          participationFee,
          perJudgeCommission,
          creator_commission_percentage
        ]).toHex(),

        // R9: (Coll[Byte], Coll[Byte]) - gameProvenance: (Detalles JSON/Hex, Script de gasto del creador)
        R9: SPair(
          SColl(SByte, stringToBytes("utf8", "{}")), 
          SColl(SByte, creatorPkBytes)
        ).toHex(),
      }
    });

    const resolvedorPkBytes = creatorPkBytes;

    const participantErgotree = prependHexPrefix(participant1.address.getPublicKeys()[0]);

    // --- Creación de las cajas `participation.es` ---
    score1 = 1000n;
    commitment1Hex = uint8ArrayToHex(blake2b256(
        new Uint8Array([...stringToBytes("utf8", "player1-solver"), ...bigintToLongByteArray(score1), ...stringToBytes("utf8", "logs1"), ...participantErgotree, ...secret])
    ));

    winnerCandidateCommitment = commitment1Hex;

    const newNumericalParams = [BigInt(deadlineBlock), creatorStake, participationFee, perJudgeCommission, creator_commission_percentage, resolutionDeadline];

    // OUTPUT(0)
    gameBoxOutput = new OutputBuilder(creatorStake, gameResolutionContract.address) 
      .addTokens([{ tokenId: gameNftId, amount: 1n }])
      .setAdditionalRegisters({
        
        // R4: Integer - Game state (1: Resolved)
        R4: SInt(1).toHex(),

        // R5: Coll[Byte] - Seed
        R5: SColl(SByte, "aa".repeat(32)).toHex(), 

        // R6: (Coll[Byte], Coll[Byte]) - (revealedSecretS, winnerCandidateCommitment)
        R6: SPair(SColl(SByte, secret), SColl(SByte, hexToBytes(winnerCandidateCommitment)!)).toHex(),

        // R7: Coll[Coll[Byte]] - participatingJudges (lista vacía)
        R7: SColl(SColl(SByte), []).toHex(),

        // R8: Coll[Long] - numericalParameters
        R8: SColl(SLong, newNumericalParams).toHex(),

        // R9: Coll[Coll[Byte]] - gameProvenance: (Detalles, Script Creador, Script Resolvedor)
        R9: SColl(SColl(SByte), [
          stringToBytes("utf8", "{}"), // Detalles del juego
          creatorPkBytes,             // Script de gasto del creador original
          resolvedorPkBytes           // Script de gasto del resolvedor
        ]).toHex()
      });

    participation1_registers = {
        R4: SColl(SByte,  participantErgotree).toHex(),
        R5: SColl(SByte, commitment1Hex).toHex(),
        R6: SColl(SByte, gameNftId).toHex(),
        R7: SColl(SByte, stringToBytes("utf8", "player1-solver")).toHex(),
        R8: SColl(SByte, stringToBytes("utf8", "logs1")).toHex(),
        R9: SColl(SLong, [500n, 800n, score1, 1200n]).toHex()
      };

    // INPUTS(1)
    participationContract.addUTxOs({
      creationHeight: mockChain.height,
      ergoTree: participationSubmittedErgoTree.toHex(),
      assets: [],
      value: participationFee,
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

    // --- Verificación usando los partidos de contrato --- 
    expect(gameActiveContract.utxos.length).to.equal(0);
    expect(gameResolutionContract.utxos.length).to.equal(1);

    const newResolutionBox = gameResolutionContract.utxos.toArray()[0];
    expect(newResolutionBox.value).to.equal(gameBoxOutput.value);
    expect(newResolutionBox.assets[0].tokenId).to.equal(gameNftId);
    
    const r4 = newResolutionBox.additionalRegisters.R4;
    expect(r4).to.equal(SInt(1).toHex());
    
    const r6 = newResolutionBox.additionalRegisters.R6;
    expect(r6).to.equal(SPair(SColl(SByte, secret), SColl(SByte, hexToBytes(winnerCandidateCommitment)!)).toHex()); 
    
    const r8 = newResolutionBox.additionalRegisters.R8;
    const expectedNumericalParams = [BigInt(deadlineBlock), creatorStake, participationFee, perJudgeCommission, creator_commission_percentage, resolutionDeadline];
    expect(r8).to.equal(SColl(SLong, expectedNumericalParams).toHex());
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
        R4: SColl(SByte,  participant1.address.getPublicKeys()[0]).toHex(),
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
        new Uint8Array([...stringToBytes("utf8", "player1-solver"), ...bigintToLongByteArray(score1), ...stringToBytes("utf8", "logs1"), ...wrongSecret])
    ));

    participationContract.addUTxOs({
      creationHeight: mockChain.height,
      ergoTree: participationSubmittedErgoTree.toHex(),
      assets: [],
      value: participationFee,
      additionalRegisters: {
        R4: SColl(SByte,  participant1.address.getPublicKeys()[0]).toHex(),
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
        R4: SColl(SByte,  participant1.address.getPublicKeys()[0]).toHex(),
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
  
    const creatorPkBytes = creator.address.getPublicKeys()[0];
    const newNumericalParams = [BigInt(deadlineBlock), creatorStake, participationFee, perJudgeCommission, creator_commission_percentage, resolutionDeadline];
    const resolvedorPkBytes = creatorPkBytes;

    const wrongGameBoxOutput = new OutputBuilder(creatorStake, gameResolutionContract.address) 
      .addTokens([{ tokenId: gameNftId, amount: 1n }])
      .setAdditionalRegisters({
        
        // R4: Integer - Game state (1: Resolved)
        R4: SInt(0).toHex(),

        // R5: Coll[Byte] - Seed
        R5: SColl(SByte, "aa".repeat(32)).toHex(), 

        // R6: (Coll[Byte], Coll[Byte]) - (revealedSecretS, winnerCandidateCommitment)
        R6: SPair(SColl(SByte, secret), SColl(SByte, [])).toHex(),

        // R7: Coll[Coll[Byte]] - participatingJudges (lista vacía)
        R7: SColl(SColl(SByte), []).toHex(),

        // R8: Coll[Long] - numericalParameters
        R8: SColl(SLong, newNumericalParams).toHex(),

        // R9: Coll[Coll[Byte]] - gameProvenance: (Detalles, Script Creador, Script Resolvedor)
        R9: SColl(SColl(SByte), [
          stringToBytes("utf8", "{}"), // Detalles del juego
          creatorPkBytes,             // Script de gasto del creador original
          resolvedorPkBytes           // Script de gasto del resolvedor
        ]).toHex()
      });

    const tx = new TransactionBuilder(currentHeight)
      .from([
        gameActiveContract.utxos.toArray()[0],
        ...creator.utxos.toArray()])
      .to([wrongGameBoxOutput])
      .withDataFrom([participationContract.utxos.toArray()[0]])
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();
      
    const executionResult = mockChain.execute(tx, { signers: [creator], throw: false });

    expect(executionResult).to.be.false;
  });

  it("should successfully transition the game to the resolution phase without winner", () => {
    const currentHeight = mockChain.height;

    const creator_commission_percentage = 10n;
    const creatorPkBytes = creator.address.getPublicKeys()[0];
    const newNumericalParams = [BigInt(deadlineBlock), creatorStake, participationFee, perJudgeCommission, creator_commission_percentage, resolutionDeadline];
    const resolvedorPkBytes = creatorPkBytes;

    const gameBoxOutputWithAnyWinner = new OutputBuilder(creatorStake, gameResolutionContract.address) 
      .addTokens([{ tokenId: gameNftId, amount: 1n }])
      .setAdditionalRegisters({
        
        // R4: Integer - Game state (1: Resolved)
        R4: SInt(1).toHex(),

        // R5: Coll[Byte] - Seed
        R5: SColl(SByte, "aa".repeat(32)).toHex(), 

        // R6: (Coll[Byte], Coll[Byte]) - (revealedSecretS, winnerCandidateCommitment)
        R6: SPair(SColl(SByte, secret), SColl(SByte, [])).toHex(),

        // R7: Coll[Coll[Byte]] - participatingJudges (lista vacía)
        R7: SColl(SColl(SByte), []).toHex(),

        // R8: Coll[Long] - numericalParameters
        R8: SColl(SLong, newNumericalParams).toHex(),

        // R9: Coll[Coll[Byte]] - gameProvenance: (Detalles, Script Creador, Script Resolvedor)
        R9: SColl(SColl(SByte), [
          stringToBytes("utf8", "{}"), // Detalles del juego
          creatorPkBytes,             // Script de gasto del creador original
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

    // --- Verificación usando los partidos de contrato --- 
    expect(gameActiveContract.utxos.length).to.equal(0);
    expect(gameResolutionContract.utxos.length).to.equal(1);

    const newResolutionBox = gameResolutionContract.utxos.toArray()[0];
    expect(newResolutionBox.value).to.equal(gameBoxOutput.value);
    expect(newResolutionBox.assets[0].tokenId).to.equal(gameNftId);
    
    const r4 = newResolutionBox.additionalRegisters.R4;
    expect(r4).to.equal(SInt(1).toHex());
    
    const r6 = newResolutionBox.additionalRegisters.R6;
    expect(r6).to.equal(SPair(SColl(SByte, secret), SColl(SByte, [])).toHex()); 
    
    const r8 = newResolutionBox.additionalRegisters.R8;
    const expectedNumericalParams = [BigInt(deadlineBlock), creatorStake, participationFee, perJudgeCommission, creator_commission_percentage, resolutionDeadline];
    expect(r8).to.equal(SColl(SLong, expectedNumericalParams).toHex());
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
  
});
