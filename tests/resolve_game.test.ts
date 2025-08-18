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
const gameResolutionSource = GAME_RESOLUTION_TEMPLATE.replace("`+PARTICIPATION_RESOLVED_SCRIPT_HASH+`", participationResolvedScriptHash).replace("`+PARTICIPATION_SUBMITTED_SCRIPT_HASH+`", participationSubmittedScriptHash).replace("`+DEV_ADDR+`", DEV_ADDR_BASE58);
const gameResolutionErgoTree = compile(gameResolutionSource);
const gameResolutionScriptHash = uint8ArrayToHex(blake2b256(gameResolutionErgoTree.bytes));
const gameActiveSource = GAME_ACTIVE_TEMPLATE.replace("`+GAME_RESOLUTION_SCRIPT_HASH+`", gameResolutionScriptHash).replace("`+GAME_CANCELLATION_SCRIPT_HASH+`", gameCancellationScriptHash).replace("`+PARTICIPATION_SUBMITED_SCRIPT_HASH+`", participationSubmittedScriptHash).replace("`+PARTICIPATION_RESOLVED_SCRIPT_HASH+`", participationResolvedScriptHash);
const gameActiveErgoTree = compile(gameActiveSource);


describe("Game Resolution (resolve_game)", () => {
  let mockChain: MockChain;

  // --- Actores ---
  let creator: ReturnType<MockChain["newParty"]>;
  let participant1: ReturnType<MockChain["newParty"]>;
  let participant2: ReturnType<MockChain["newParty"]>;
  
  // --- Partidos de Contratos --- 
  let gameActiveContract: ReturnType<MockChain["addParty"]>;
  let participationSubmittedContract: ReturnType<MockChain["addParty"]>;
  let gameResolutionContract: ReturnType<MockChain["addParty"]>;
  let participationResolvedContract: ReturnType<MockChain["addParty"]>;


  // --- Estado del Juego ---
  let secret: Uint8Array;
  let gameNftId: string;
  const deadlineBlock = 800_200;
  const participationFee = 1_000_000n;
  const resolutionDeadline = BigInt(deadlineBlock + 40);
  const resolvedCounter = 2;
  let commitment1Hex: string;
  let commitment2Hex: string;
  let gameBoxOutput: OutputBuilder;
  let participation1Output: OutputBuilder;
  let participation2Output: OutputBuilder;
  let score1: bigint;
  let score2: bigint;
  let participation1_registers: Record<string, string>;
  let participation2_registers: Record<string, string>;
  let winnerCandidateCommitment: string;

  afterEach(() => {
    mockChain.reset();
  });
  
  beforeEach(() => {
    mockChain = new MockChain({ height: 800_000 });

    creator = mockChain.newParty("GameCreator");
    participant1 = mockChain.newParty("Player1");
    participant2 = mockChain.newParty("Player2");
    creator.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });

    const creatorStake = 2_000_000_000n;
    const creator_commission_percentage = 10n;

    // --- Definir Partidos de Contratos --- 
    gameActiveContract = mockChain.addParty(gameActiveErgoTree.toHex(), "GameActiveContract");
    participationSubmittedContract = mockChain.addParty(participationSubmittedErgoTree.toHex(), "ParticipationSubmittedContract");
    gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolutionContract");
    participationResolvedContract = mockChain.addParty(participationResolvedErgoTree.toHex(), "ParticipationResolvedContract");


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
        R4: SPair(SColl(SByte, creatorPkBytes), SLong(creator_commission_percentage)).toHex(),
        R5: SColl(SByte, hashedSecret).toHex(),
        R6: SColl(SColl(SByte), []).toHex(),
        R7: SColl(SLong, [BigInt(deadlineBlock), creatorStake, participationFee]).toHex(),
        R8: SColl(SByte, stringToBytes("utf8", "{}")).toHex(),
      }
    })

    const resolvedorPkBytes = creatorPkBytes;

    // --- Creación de las cajas `participation_submited.es` ---
    score1 = 1000n;
    commitment1Hex = uint8ArrayToHex(blake2b256(
        new Uint8Array([...stringToBytes("utf8", "player1-solver"), ...bigintToLongByteArray(score1), ...stringToBytes("utf8", "logs1"), ...secret])
    ));

    winnerCandidateCommitment = commitment1Hex;

    // OUTPUT(0)
    gameBoxOutput = new OutputBuilder(creatorStake, gameResolutionContract.address) 
      .addTokens([{ tokenId: gameNftId, amount: 1n }])
      .setAdditionalRegisters({
        R4: SPair(SLong(resolutionDeadline), SInt(resolvedCounter)).toHex(),
        R5: SPair(SColl(SByte, secret), SColl(SByte, hexToBytes(winnerCandidateCommitment)!)).toHex(),
        R6: SColl(SColl(SByte), []).toHex(),
        R7: SColl(SLong, [BigInt(deadlineBlock), creatorStake, participationFee]).toHex(),
        R8: SPair(SColl(SByte, resolvedorPkBytes), SLong(creator_commission_percentage)).toHex(),
        R9: SPair(SColl(SByte, creatorPkBytes), SColl(SByte, stringToBytes("utf8", "{}"))).toHex()
      });

    participation1_registers = {
            R4: SColl(SByte, participant1.address.getPublicKeys()[0]).toHex(),
            R5: SColl(SByte, commitment1Hex).toHex(),
            R6: SColl(SByte, gameNftId).toHex(),
            R7: SColl(SByte, stringToBytes("utf8", "player1-solver")).toHex(),
            R8: SColl(SByte, stringToBytes("utf8", "logs1")).toHex(),
            R9: SColl(SLong, [500n, 800n, score1, 1200n]).toHex(),
        };

    // INPUTS(1)
    participationSubmittedContract.addUTxOs({
      creationHeight: mockChain.height,
      ergoTree: participationSubmittedErgoTree.toHex(),
      assets: [],
      value: participationFee,
      additionalRegisters: participation1_registers
    });

    // OUTPUTS(1)
    participation1Output = new OutputBuilder(participationFee, participationResolvedContract.address) 
      .setAdditionalRegisters(participation1_registers);


    score2 = 850n;
    commitment2Hex = uint8ArrayToHex(blake2b256(
        new Uint8Array([...stringToBytes("utf8", "player2-solver"), ...bigintToLongByteArray(score2), ...stringToBytes("utf8", "logs2"), ...secret])
    ));

    participation2_registers = {
            R4: SColl(SByte, participant2.address.getPublicKeys()[0]).toHex(),
            R5: SColl(SByte, commitment2Hex).toHex(),
            R6: SColl(SByte, gameNftId).toHex(),
            R7: SColl(SByte, stringToBytes("utf8", "player2-solver")).toHex(),
            R8: SColl(SByte, stringToBytes("utf8", "logs2")).toHex(),
            R9: SColl(SLong, [score2, 900n, 950n]).toHex(),
        };

    // INPUTS(2)
    participationSubmittedContract.addUTxOs({
      creationHeight: mockChain.height,
      ergoTree: participationSubmittedErgoTree.toHex(),
      assets: [],
      value: participationFee,
      additionalRegisters: participation2_registers
    });

    // OUTPUTS(2)
    participation2Output = new OutputBuilder(participationFee, participationResolvedContract.address) 
      .setAdditionalRegisters(participation2_registers)
    
    mockChain.newBlocks(deadlineBlock - mockChain.height + 1);
  });

  it("should successfully transition the game to the resolution phase", () => {
    const currentHeight = mockChain.height;
  
    const tx = new TransactionBuilder(currentHeight)
      .from([
        gameActiveContract.utxos.toArray()[0],
        participationSubmittedContract.utxos.toArray()[0],
        participationSubmittedContract.utxos.toArray()[1],
        ...creator.utxos.toArray()])
      .to([gameBoxOutput, participation1Output, participation2Output])
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();
      
    const executionResult = mockChain.execute(tx, { signers: [creator] });

    expect(executionResult).to.be.true;

    // --- Verificación usando los partidos de contrato --- 
    expect(gameActiveContract.utxos.length).to.equal(0);
    expect(participationSubmittedContract.utxos.length).to.equal(0);
    expect(gameResolutionContract.utxos.length).to.equal(1);
    expect(participationResolvedContract.utxos.length).to.equal(2);

    const newResolutionBox = gameResolutionContract.utxos.toArray()[0];
    expect(newResolutionBox.value).to.equal(gameBoxOutput.value);
    expect(newResolutionBox.assets[0].tokenId).to.equal(gameNftId);
    
    const r4 = newResolutionBox.additionalRegisters.R4;
    expect(r4).to.equal(SPair(SLong(resolutionDeadline), SInt(2)).toHex());
    
    const r5 = newResolutionBox.additionalRegisters.R5;
    expect(r5).to.equal(SPair(SColl(SByte, secret), SColl(SByte, winnerCandidateCommitment)).toHex());
    
    const resolvedParticipationBoxes = participationResolvedContract.utxos.toArray();

    const matchingResolvedBox1 = resolvedParticipationBoxes.find(b => b.additionalRegisters.R5 === SColl(SByte, commitment1Hex).toHex());
    expect(matchingResolvedBox1).to.not.be.undefined;
    expect(matchingResolvedBox1!.value).to.equal(participationFee);
    expect(matchingResolvedBox1!.additionalRegisters).to.deep.equal(participation1_registers);

    const matchingResolvedBox2 = resolvedParticipationBoxes.find(b => b.additionalRegisters.R5 === SColl(SByte, commitment2Hex).toHex());
    expect(matchingResolvedBox2).to.not.be.undefined;
    expect(matchingResolvedBox2!.value).to.equal(participationFee);
    expect(matchingResolvedBox2!.additionalRegisters).to.deep.equal(participation2_registers);
  });
});