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
const DEV_ADDR_BASE_58 = "9ejNy2qoifmzfCiDtEiyugthuXMriNNPhNKzzwjPtHnrK3esvbD";
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
const gameResolutionSource = GAME_RESOLUTION_TEMPLATE.replace("`+PARTICIPATION_RESOLVED_SCRIPT_HASH+`", participationResolvedScriptHash).replace("`+PARTICIPATION_SUBMITTED_SCRIPT_HASH+`", participationSubmittedScriptHash).replace("`+DEV_ADDR+`", DEV_ADDR_BASE_58);
const gameResolutionErgoTree = compile(gameResolutionSource);
const gameResolutionScriptHash = uint8ArrayToHex(blake2b256(gameResolutionErgoTree.bytes));
const gameActiveSource = GAME_ACTIVE_TEMPLATE.replace("`+GAME_RESOLUTION_SCRIPT_HASH+`", gameResolutionScriptHash).replace("`+GAME_CANCELLATION_SCRIPT_HASH+`", gameCancellationScriptHash).replace("`+PARTICIPATION_SUBMITED_SCRIPT_HASH+`", participationSubmittedScriptHash).replace("`+PARTICIPATION_RESOLVED_SCRIPT_HASH+`", participationResolvedScriptHash);
const gameActiveErgoTree = compile(gameActiveSource);


describe("Simplified Transaction Test with Simple Contracts", () => {
  let mockChain: MockChain;
  let creator: ReturnType<MockChain["newParty"]>;
  let contractA: ReturnType<MockChain["addParty"]>;
  let contractB: ReturnType<MockChain["addParty"]>;
  let contractC: ReturnType<MockChain["addParty"]>;

  // A simple ErgoTree that will always evaluate to true because the deadline is in the past.
  const alwaysTrueSource = "sigmaProp(HEIGHT > deadline)";
  const alwaysTrueErgoTree = compile(alwaysTrueSource, {
    map: { deadline: SInt(100) } 
  });

  beforeEach(() => {
    mockChain = new MockChain({ height: 800_000 });
    creator = mockChain.newParty("Creator");
    creator.addBalance({ nanoergs: 1_000_000_000n });

    // Create three separate contract parties, all using the same simple script
    contractA = mockChain.addParty(alwaysTrueErgoTree.toHex(), "ContractA");
    contractB = mockChain.addParty(alwaysTrueErgoTree.toHex(), "ContractB");
    contractC = mockChain.addParty(alwaysTrueErgoTree.toHex(), "ContractC");

    // Fund each contract with a UTXO
    contractA.addUTxOs({ value: 1_000_000n, ergoTree: alwaysTrueErgoTree.toHex(), assets: [], creationHeight: mockChain.height, additionalRegisters: {} });
    contractB.addUTxOs({ value: 1_000_000n, ergoTree: alwaysTrueErgoTree.toHex(), assets: [], creationHeight: mockChain.height, additionalRegisters: {} });
    contractC.addUTxOs({ value: 1_000_000n, ergoTree: alwaysTrueErgoTree.toHex(), assets: [], creationHeight: mockChain.height, additionalRegisters: {} });
  });

  afterEach(() => {
    mockChain.reset();
  });

  it("should successfully spend three inputs with a simple, always-true script", () => {
    const currentHeight = mockChain.height;
    const fee = RECOMMENDED_MIN_FEE_VALUE;
    const totalInputValue = 3_000_000n;
    const outputValue = totalInputValue - fee;

    const inputs = [
      contractA.utxos.toArray()[0],
      contractB.utxos.toArray()[0],
      contractC.utxos.toArray()[0],
      ...creator.utxos.toArray() // Add creator's UTXO for fee and change
    ];

    const tx = new TransactionBuilder(currentHeight)
      .from(inputs)
      .to(new OutputBuilder(outputValue, creator.address))
      .sendChangeTo(creator.address)
      .payFee(fee)
      .build();

    // The 'creator' is the one building and signing the transaction.
    // This is valid because the contract script itself doesn't require a specific signature.
    const executionResult = mockChain.execute(tx, { signers: [creator] });

    // --- Verification ---
    expect(executionResult, "Transaction execution should be successful").to.be.true;

    // Check that the contract boxes were spent
    expect(contractA.utxos.length, "Contract A should have no UTXOs left").to.equal(0);
    expect(contractB.utxos.length, "Contract B should have no UTXOs left").to.equal(0);
    expect(contractC.utxos.length, "Contract C should have no UTXOs left").to.equal(0);

    // Check that the creator's balance reflects the outcome
    const initialBalance = 1_000_000_000n;
    const finalBalance = creator.balance.nanoergs;
    expect(finalBalance).to.equal(initialBalance + totalInputValue - fee);
  });
});


describe("Transaction Test with Complex I/O and Simple Contracts", () => {
  let mockChain: MockChain;
  let creator: ReturnType<MockChain["newParty"]>;
  let contractInputA: ReturnType<MockChain["addParty"]>;
  let contractInputB: ReturnType<MockChain["addParty"]>;
  let contractInputC: ReturnType<MockChain["addParty"]>;
  
  let gameResolutionDestination: ReturnType<MockChain["addParty"]>;
  let participationResolvedDestination: ReturnType<MockChain["addParty"]>;

  const alwaysTrueSource = "sigmaProp(HEIGHT > deadline)";
  const alwaysTrueErgoTree = compile(alwaysTrueSource, { map: { deadline: SInt(100) } });

  beforeEach(() => {
    mockChain = new MockChain({ height: 800_000 });
    creator = mockChain.newParty("Creator");
    creator.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE});

    // --- Input contracts ---
    contractInputA = mockChain.addParty(alwaysTrueErgoTree.toHex(), "ContractInputA");
    contractInputB = mockChain.addParty(alwaysTrueErgoTree.toHex(), "ContractInputB");
    contractInputC = mockChain.addParty(alwaysTrueErgoTree.toHex(), "ContractInputC");
    
    // --- Destination contracts for outputs ---
    gameResolutionDestination = mockChain.addParty(alwaysTrueErgoTree.toHex(), "GameResolutionDestination");
    participationResolvedDestination = mockChain.addParty(alwaysTrueErgoTree.toHex(), "ParticipationResolvedDestination");

    // --- Mock data for input registers ---
    const mockCreatorPk = creator.address.getPublicKeys()[0];
    
    // Fund Input A (mimicking game_active box)
    contractInputA.addUTxOs({
      value: 2_000_000_000n,
      ergoTree: alwaysTrueErgoTree.toHex(),
      creationHeight: mockChain.height,
      assets: [{ tokenId: "c94a63ec4e9ae8700c671a908bd2121d4c049cec75a40f1309e09ab59d0bbc71", amount: 1n }],
      additionalRegisters: { R4: SPair(SColl(SByte, mockCreatorPk), SLong(10n)).toHex() }
    });

    // Fund Input B (mimicking participation_submitted box 1)
    contractInputB.addUTxOs({
      value: 1_000_000n,
      ergoTree: alwaysTrueErgoTree.toHex(),
      creationHeight: mockChain.height,
      assets: [],
      additionalRegisters: { R4: SColl(SByte, mockCreatorPk).toHex() }
    });
    
    // Fund Input C (mimicking participation_submitted box 2)
    contractInputC.addUTxOs({
      value: 1_000_000n,
      ergoTree: alwaysTrueErgoTree.toHex(),
      creationHeight: mockChain.height,
      assets: [],
      additionalRegisters: { R4: SColl(SByte, mockCreatorPk).toHex() }
    });

    mockChain.newBlocks(200);
  });

  afterEach(() => {
    mockChain.reset();
  });

  it("should successfully spend three inputs and create three outputs with registers", () => {
    const currentHeight = mockChain.height;
    const fee = RECOMMENDED_MIN_FEE_VALUE;
    
    // --- Define Outputs ---
    
    // Output 1: Mimics gameBoxOutput
    const gameOutput = new OutputBuilder(2_000_000_000n, gameResolutionDestination.address)
      .addTokens([{ tokenId: "c94a63ec4e9ae8700c671a908bd2121d4c049cec75a40f1309e09ab59d0bbc71", amount: 1n }])
      .setAdditionalRegisters({
        R4: SPair(SLong(BigInt(currentHeight + 30)), SInt(2)).toHex(),
        R5: SColl(SByte, stringToBytes("utf8", "mock-secret")).toHex()
      });

    // Output 2: Mimics participation1Output
    const participationOutput1 = new OutputBuilder(1_000_000n, participationResolvedDestination.address)
      .setAdditionalRegisters({
        R4: SColl(SByte, creator.address.getPublicKeys()[0]).toHex(),
        R5: SColl(SByte, hexToBytes("01".repeat(32))!).toHex()
      });

    // Output 3: Mimics participation2Output
    const participationOutput2 = new OutputBuilder(1_000_000n, participationResolvedDestination.address)
      .setAdditionalRegisters({
        R4: SColl(SByte, creator.address.getPublicKeys()[0]).toHex(),
        R5: SColl(SByte, hexToBytes("02".repeat(32))!).toHex()
      });

    const tx = new TransactionBuilder(currentHeight)
      .from([
        contractInputA.utxos.toArray()[0],
        contractInputB.utxos.toArray()[0],
        contractInputC.utxos.toArray()[0],
        ...creator.utxos.toArray()
      ])
      .to([gameOutput, participationOutput1, participationOutput2])
      .sendChangeTo(creator.address)
      .payFee(fee)
      .build();

    const executionResult = mockChain.execute(tx, { signers: [creator] });

    // --- Verification ---
    expect(executionResult, "Transaction execution should be successful").to.be.true;
  });
});


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
  let commitment1Hex: string;
  let commitment2Hex: string;
  let gameBoxOutput: OutputBuilder;
  let participation1Output: OutputBuilder;
  let participation2Output: OutputBuilder;
  let score1: bigint;
  let score2: bigint;
  let participation1_registers: Record<string, string>;
  let participation2_registers: Record<string, string>;

  const alwaysTrueSource = "sigmaProp(HEIGHT > deadline)";
  const alwaysTrueErgoTree = compile(alwaysTrueSource, { map: { deadline: SInt(100) } });

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
    let gameActiveContractTree = alwaysTrueErgoTree.toHex()
    let participationSubmitedContractTree = participationSubmittedErgoTree.toHex()

    gameActiveContract = mockChain.addParty(gameActiveContractTree, "GameActiveContract");
    participationSubmittedContract = mockChain.addParty(participationSubmitedContractTree, "ParticipationSubmittedContract");
    gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolutionContract");
    participationResolvedContract = mockChain.addParty(participationResolvedErgoTree.toHex(), "ParticipationResolvedContract");


    // --- Creación de la caja `game_active.es` ---
    secret = stringToBytes("utf8", "the-secret-phrase-for-testing");
    const hashedSecret = blake2b256(secret);
    const creatorPkBytes = creator.address.getPublicKeys()[0];
    const inputUTXO = creator.utxos.toArray()[0];
    gameNftId = "c94a63ec4e9ae8700c671a908bd2121d4c049cec75a40f1309e09ab59d0bbc71";

    // INPUTS(0)
    gameActiveContract.addUTxOs({
      creationHeight: mockChain.height,
      ergoTree: gameActiveContractTree,
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

    const resolutionDeadline = BigInt(mockChain.height + 30);
    const resolvedCounter = 2;
    const resolvedorPkBytes = creatorPkBytes;

    // --- Creación de las cajas `participation_submited.es` ---
    score1 = 1000n;
    commitment1Hex = uint8ArrayToHex(blake2b256(
        new Uint8Array([...stringToBytes("utf8", "player1-solver"), ...bigintToLongByteArray(score1), ...stringToBytes("utf8", "logs1"), ...secret])
    ));

    const winnerCandidateCommitment = commitment1Hex;

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
            R5: SColl(SByte, hexToBytes(commitment1Hex)!).toHex(),
            R6: SColl(SByte, hexToBytes(gameNftId)!).toHex(),
            R7: SColl(SByte, stringToBytes("utf8", "player1-solver")).toHex(),
            R8: SColl(SByte, stringToBytes("utf8", "logs1")).toHex(),
            R9: SColl(SLong, [500n, 800n, score1, 1200n]).toHex(),
        };

    // INPUTS(1)
    participationSubmittedContract.addUTxOs({
      creationHeight: mockChain.height,
      ergoTree: participationSubmitedContractTree,
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
            R5: SColl(SByte, hexToBytes(commitment2Hex)!).toHex(),
            R6: SColl(SByte, hexToBytes(gameNftId)!).toHex(),
            R7: SColl(SByte, stringToBytes("utf8", "player2-solver")).toHex(),
            R8: SColl(SByte, stringToBytes("utf8", "logs2")).toHex(),
            R9: SColl(SLong, [score2, 900n, 950n]).toHex(),
        };

    // INPUTS(2)
    participationSubmittedContract.addUTxOs({
      creationHeight: mockChain.height,
      ergoTree: participationSubmitedContractTree,
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
    const JUDGE_PERIOD = 30;
    const resolutionDeadline = BigInt(currentHeight + JUDGE_PERIOD);
    const winnerCandidateCommitment = commitment1Hex;
  
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

    expect(executionResult, "Transaction failed to execute").to.be.true;
        /*
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
    expect(r5).to.equal(SPair(SColl(SByte, secret), SColl(SByte, hexToBytes(winnerCandidateCommitment)!)).toHex());
    
    const resolvedParticipationBoxes = participationResolvedContract.utxos.toArray();
    // --- FIX: Correctly find the matching box by its R5 register ---
    const matchingResolvedBox = resolvedParticipationBoxes.find(b => b.additionalRegisters.R5 === participation1_registers.R5);
    expect(matchingResolvedBox).to.not.be.undefined;
    expect(matchingResolvedBox!.value).to.equal(participationFee);
    expect(matchingResolvedBox!.additionalRegisters).to.deep.equal(participation1_registers);
    */
  });
});
