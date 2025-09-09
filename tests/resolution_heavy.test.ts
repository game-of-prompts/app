import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockChain } from "@fleet-sdk/mock-chain";
import { compile } from "@fleet-sdk/compiler";
import {
  OutputBuilder,
  RECOMMENDED_MIN_FEE_VALUE,
  TransactionBuilder,
} from "@fleet-sdk/core";
import { SByte, SColl, SLong, SPair, SInt } from "@fleet-sdk/serializer";
import { blake2b256 } from "@fleet-sdk/crypto";
import * as fs from "fs";
import * as path from "path";
import { stringToBytes } from "@scure/base";
import { bigintToLongByteArray, hexToBytes } from "$lib/ergo/utils";
import { PARTICIPATION } from "$lib/ergo/reputation/types";

// Helper functions and contract loading remain the same...
function uint8ArrayToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}
const DEV_ADDR_BASE58 = "9ejNy2qoifmzfCiDtEiyugthuXMriNNPhNKzzwjPtHnrK3esvbD";
const contractsDir = path.resolve(__dirname, "..", "contracts");
const GAME_ACTIVE_TEMPLATE = fs.readFileSync(path.join(contractsDir, "game_active.es"), "utf-8");
const GAME_RESOLUTION_TEMPLATE = fs.readFileSync(path.join(contractsDir, "game_resolution.es"), "utf-8");
const PARTICIPATION_SUBMITTED_TEMPLATE = fs.readFileSync(path.join(contractsDir, "participation_submited.es"), "utf-8");
const PARTICIPATION_RESOLVED_SOURCE = fs.readFileSync(path.join(contractsDir, "participation_resolved.es"), "utf-8");
const GAME_CANCELLATION_SOURCE = "{ sigmaProp(false) }";

// Contract compilation remains the same...
const participationResolvedErgoTree = compile(PARTICIPATION_RESOLVED_SOURCE);
const participationResolvedScriptHash = uint8ArrayToHex(blake2b256(participationResolvedErgoTree.bytes));
const participationSubmittedSource = PARTICIPATION_SUBMITTED_TEMPLATE.replace("`+PARTICIPATION_RESOLVED_SCRIPT_HASH+`", participationResolvedScriptHash);
const participationSubmittedErgoTree = compile(participationSubmittedSource);
const participationSubmittedScriptHash = uint8ArrayToHex(blake2b256(participationSubmittedErgoTree.bytes));
const gameCancellationErgoTree = compile(GAME_CANCELLATION_SOURCE);
const gameCancellationScriptHash = uint8ArrayToHex(blake2b256(gameCancellationErgoTree.bytes));
const gameResolutionSource = GAME_RESOLUTION_TEMPLATE
    .replace("`+PARTICIPATION_RESOLVED_SCRIPT_HASH+`", participationResolvedScriptHash)
    .replace("`+PARTICIPATION_SUBMITTED_SCRIPT_HASH+`", participationSubmittedScriptHash)
    .replace("`+REPUTATION_PROOF_SCRIPT_HASH+`", "0".repeat(64)) // No se usa en este script
    .replace("`+PARTICIPATION_TYPE_ID+`", PARTICIPATION)
    .replace("`+DEV_ADDR+`", DEV_ADDR_BASE58);
const gameResolutionErgoTree = compile(gameResolutionSource);
const gameResolutionScriptHash = uint8ArrayToHex(blake2b256(gameResolutionErgoTree.bytes));
const gameActiveSource = GAME_ACTIVE_TEMPLATE.replace("`+GAME_RESOLUTION_SCRIPT_HASH+`", gameResolutionScriptHash).replace("`+GAME_CANCELLATION_SCRIPT_HASH+`", gameCancellationScriptHash).replace("`+PARTICIPATION_SUBMITED_SCRIPT_HASH+`", participationSubmittedScriptHash).replace("`+PARTICIPATION_RESOLVED_SCRIPT_HASH+`", participationResolvedScriptHash);
const gameActiveErgoTree = compile(gameActiveSource);


describe("Game Resolution (resolve_game)", () => {
  let mockChain: MockChain;

  // --- Actors ---
  let creator: ReturnType<MockChain["newParty"]>;
  
  // --- Contract Parties --- 
  let gameActiveContract: ReturnType<MockChain["addParty"]>;
  let participationSubmittedContract: ReturnType<MockChain["addParty"]>;
  let gameResolutionContract: ReturnType<MockChain["addParty"]>;
  let participationResolvedContract: ReturnType<MockChain["addParty"]>;

  // --- Common Game State ---
  let secret: Uint8Array;
  let gameNftId: string;
  const deadlineBlock = 800_200;
  const participationFee = 1_000_000n;
  const creatorStake = 2_000_000_000n;
  const creator_commission_percentage = 10n;


  afterEach(() => {
    mockChain.reset();
  });
  
  beforeEach(() => {
    mockChain = new MockChain({ height: 800_000 });

    creator = mockChain.newParty("GameCreator");
    creator.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE * 10n });

    // --- Define Contract Parties --- 
    gameActiveContract = mockChain.addParty(gameActiveErgoTree.toHex(), "GameActiveContract");
    participationSubmittedContract = mockChain.addParty(participationSubmittedErgoTree.toHex(), "ParticipationSubmittedContract");
    gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolutionContract");
    participationResolvedContract = mockChain.addParty(participationResolvedErgoTree.toHex(), "ParticipationResolvedContract");

    // --- Create the common `game_active.es` box (INPUT 0) ---
    secret = stringToBytes("utf8", "the-secret-phrase-for-testing");
    const hashedSecret = blake2b256(secret);
    const creatorPkBytes = creator.address.getPublicKeys()[0];
    gameNftId = "c94a63ec4e9ae8700c671a908bd2121d4c049cec75a40f1309e09ab59d0bbc71";

    gameActiveContract.addUTxOs({
      creationHeight: mockChain.height,
      ergoTree: gameActiveErgoTree.toHex(),
      assets: [{ tokenId: gameNftId, amount: 1n }],
      value: creatorStake,
      additionalRegisters: {
        R4: SInt(0).toHex(),
        R5: SPair(SColl(SByte, creatorPkBytes), SLong(creator_commission_percentage)).toHex(),
        R6: SColl(SByte, hashedSecret).toHex(),
        R7: SColl(SColl(SByte), []).toHex(),
        R8: SColl(SLong, [BigInt(deadlineBlock), creatorStake, participationFee]).toHex(),
        R9: SColl(SByte, stringToBytes("utf8", "{}")).toHex(),
      }
    });
    
    // Advance the chain to the resolution phase
    mockChain.newBlocks(deadlineBlock - mockChain.height + 1);
  });

  it("should successfully transition the game to the resolution phase with 2 participants", () => {
    // --- Test-specific setup for 2 participants ---
    const participant1 = mockChain.newParty("Player1");
    const participant2 = mockChain.newParty("Player2");

    // --- Participant 1 Data ---
    const score1 = 1000n;
    const commitment1Hex = uint8ArrayToHex(blake2b256(
        new Uint8Array([...stringToBytes("utf8", "player1-solver"), ...bigintToLongByteArray(score1), ...stringToBytes("utf8", "logs1"), ...secret])
    ));
    const participation1_registers = {
        R4: SColl(SByte, participant1.address.getPublicKeys()[0]).toHex(),
        R5: SColl(SByte, hexToBytes(commitment1Hex)!).toHex(),
        R6: SColl(SByte, hexToBytes(gameNftId)!).toHex(),
        R7: SColl(SByte, stringToBytes("utf8", "player1-solver")).toHex(),
        R8: SColl(SByte, stringToBytes("utf8", "logs1")).toHex(),
        R9: SColl(SLong, [500n, 800n, score1, 1200n]).toHex(),
    };
    participationSubmittedContract.addUTxOs({
        assets: [],
      creationHeight: mockChain.height - 10,
      ergoTree: participationSubmittedErgoTree.toHex(),
      value: participationFee,
      additionalRegisters: participation1_registers
    });
    const participation1Output = new OutputBuilder(participationFee, participationResolvedContract.address) 
      .setAdditionalRegisters(participation1_registers);

    // --- Participant 2 Data ---
    const score2 = 850n;
    const commitment2Hex = uint8ArrayToHex(blake2b256(
        new Uint8Array([...stringToBytes("utf8", "player2-solver"), ...bigintToLongByteArray(score2), ...stringToBytes("utf8", "logs2"), ...secret])
    ));
    const participation2_registers = {
        R4: SColl(SByte, participant2.address.getPublicKeys()[0]).toHex(),
        R5: SColl(SByte, hexToBytes(commitment2Hex)!).toHex(),
        R6: SColl(SByte, hexToBytes(gameNftId)!).toHex(),
        R7: SColl(SByte, stringToBytes("utf8", "player2-solver")).toHex(),
        R8: SColl(SByte, stringToBytes("utf8", "logs2")).toHex(),
        R9: SColl(SLong, [score2, 900n, 950n]).toHex(),
    };
    participationSubmittedContract.addUTxOs({
        assets: [],
      creationHeight: mockChain.height - 10,
      ergoTree: participationSubmittedErgoTree.toHex(),
      value: participationFee,
      additionalRegisters: participation2_registers
    });
    const participation2Output = new OutputBuilder(participationFee, participationResolvedContract.address) 
      .setAdditionalRegisters(participation2_registers);

    // --- Game Resolution Box Output ---
    const creatorPkBytes = creator.address.getPublicKeys()[0];
    const gameBox = gameActiveContract.utxos.toArray()[0];
    const newNumericalParams = [BigInt(deadlineBlock), creatorStake, participationFee, BigInt(mockChain.height + 40), 2n];
    const gameBoxOutput = new OutputBuilder(creatorStake, gameResolutionContract.address) 
      .addTokens(gameBox.assets)
      .setAdditionalRegisters({
        R4: SInt(1).toHex(),
        R5: SPair(SColl(SByte, secret), SColl(SByte, hexToBytes(commitment1Hex)!)).toHex(),
        R6: gameBox.additionalRegisters.R7, // invitedJudges
        R7: SColl(SLong, newNumericalParams).toHex(),
        R8: gameBox.additionalRegisters.R5, // creatorInfo
        R9: SPair(SColl(SByte, creatorPkBytes), SColl(SByte, stringToBytes("utf8", "{}"))).toHex()
      });

    // --- Transaction Building and Execution ---
    const currentHeight = mockChain.height;
    const tx = new TransactionBuilder(currentHeight)
      .from([
        gameActiveContract.utxos.toArray()[0],
        ...participationSubmittedContract.utxos.toArray(),
        ...creator.utxos.toArray()])
      .to([gameBoxOutput, participation1Output, participation2Output])
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();
      
    const executionResult = mockChain.execute(tx, { signers: [creator] });

    // --- Verification ---
    expect(executionResult).to.be.true;
    expect(gameActiveContract.utxos.length).to.equal(0);
    expect(participationSubmittedContract.utxos.length).to.equal(0);
    expect(gameResolutionContract.utxos.length).to.equal(1);
    expect(participationResolvedContract.utxos.length).to.equal(2);

    const resolvedParticipationBoxes = participationResolvedContract.utxos.toArray();
    const matchingResolvedBox1 = resolvedParticipationBoxes.find(b => b.additionalRegisters.R5 === SColl(SByte, hexToBytes(commitment1Hex)!).toHex());
    expect(matchingResolvedBox1).to.not.be.undefined;
    expect(matchingResolvedBox1!.additionalRegisters).to.deep.equal(participation1_registers);

    const matchingResolvedBox2 = resolvedParticipationBoxes.find(b => b.additionalRegisters.R5 === SColl(SByte, hexToBytes(commitment2Hex)!).toHex());
    expect(matchingResolvedBox2).to.not.be.undefined;
    expect(matchingResolvedBox2!.additionalRegisters).to.deep.equal(participation2_registers);
  });

  it("should successfully resolve the game with 100 dynamic participations", () => {
    const participationCount = 100;
    const participationOutputs = [];
    
    let highestScore = -1n;
    let highestScoreCommitmentHex = "";

    for (let i = 0; i < participationCount; i++) {
        const participant = mockChain.newParty(`DynamicPlayer${i + 1}`);
        const score = BigInt(Math.floor(Math.random() * 10000));
        const solverStr = `player${i + 1}-solver`;
        const logsStr = `logs${i + 1}`;
        const commitmentHex = uint8ArrayToHex(blake2b256(
            new Uint8Array([...stringToBytes("utf8", solverStr), ...bigintToLongByteArray(score), ...stringToBytes("utf8", logsStr), ...secret])
        ));
        
        if (score > highestScore) {
            highestScore = score;
            highestScoreCommitmentHex = commitmentHex;
        }

        const r9_score2 = BigInt(Math.floor(Math.random() * 10000));
        const r9_score3 = BigInt(Math.floor(Math.random() * 10000));
        const r9_score4 = BigInt(Math.floor(Math.random() * 10000));

        const registers = {
            R4: SColl(SByte, participant.address.getPublicKeys()[0]).toHex(),
            R5: SColl(SByte, hexToBytes(commitmentHex)!).toHex(),
            R6: SColl(SByte, hexToBytes(gameNftId)!).toHex(),
            R7: SColl(SByte, stringToBytes("utf8", solverStr)).toHex(),
            R8: SColl(SByte, stringToBytes("utf8", logsStr)).toHex(),
            R9: SColl(SLong, [score, r9_score2, r9_score3, r9_score4]).toHex(),
        };

        participationSubmittedContract.addUTxOs({
            assets: [],
            creationHeight: mockChain.height - 10,
            ergoTree: participationSubmittedErgoTree.toHex(),
            value: participationFee,
            additionalRegisters: registers
        });
        
        participationOutputs.push(
            new OutputBuilder(participationFee, participationResolvedContract.address)
                .setAdditionalRegisters(registers)
        );
    }
    
    const creatorPkBytes = creator.address.getPublicKeys()[0];
    const participationInputs = participationSubmittedContract.utxos.toArray();
    const gameBox = gameActiveContract.utxos.toArray()[0];
    const newNumericalParams = [BigInt(deadlineBlock), creatorStake, participationFee, BigInt(mockChain.height + 40), BigInt(participationCount)];
    const gameBoxOutput100 = new OutputBuilder(gameBox.value, gameResolutionContract.address)
      .addTokens(gameBox.assets)
      .setAdditionalRegisters({
        R4: SInt(1).toHex(),
        R5: SPair(SColl(SByte, secret), SColl(SByte, hexToBytes(highestScoreCommitmentHex)!)).toHex(),
        R6: gameBox.additionalRegisters.R7, // invitedJudges
        R7: SColl(SLong, newNumericalParams).toHex(),
        R8: gameBox.additionalRegisters.R5, // creatorInfo
        R9: SPair(SColl(SByte, creatorPkBytes), SColl(SByte, stringToBytes("utf8", "{}"))).toHex()
      });

    const currentHeight = mockChain.height;
    const tx = new TransactionBuilder(currentHeight)
      .from([
        gameBox,
        ...participationInputs,
        ...creator.utxos.toArray()
      ])
      .to([gameBoxOutput100, ...participationOutputs])
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(tx, { signers: [creator] });
    
    expect(executionResult, "Transaction should be valid").to.be.true;

    // --- Verification ---
    expect(gameActiveContract.utxos.length, "Game active box should be spent").to.equal(0);
    expect(participationSubmittedContract.utxos.length, "All participation boxes should be spent").to.equal(0);
    expect(gameResolutionContract.utxos.length, "A new game resolution box should be created").to.equal(1);
    expect(participationResolvedContract.utxos.length, "100 new resolved participation boxes should be created").to.equal(participationCount);

    const newResolutionBox = gameResolutionContract.utxos.toArray()[0];
    const r7 = newResolutionBox.additionalRegisters.R7;
    expect(r7, "R7 of resolution box should contain the correct participant count").to.equal(SColl(SLong, newNumericalParams).toHex());

    const resolvedBoxes = participationResolvedContract.utxos.toArray();
    for (const inputBox of participationInputs) {
        const matchingOutputBox = resolvedBoxes.find(
            (outputBox) => JSON.stringify(outputBox.additionalRegisters) === JSON.stringify(inputBox.additionalRegisters)
        );
        expect(matchingOutputBox, `Should find a matching resolved box for input with commitment ${inputBox.additionalRegisters.R5}`).to.not.be.undefined;
        expect(matchingOutputBox!.value, "Resolved box value should match the participation fee").to.equal(participationFee);
    }
  });
});