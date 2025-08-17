import { describe, it, expect, beforeEach } from "vitest";
import { MockChain } from "@fleet-sdk/mock-chain";
import { compile } from "@fleet-sdk/compiler";
import {
  OutputBuilder,
  RECOMMENDED_MIN_FEE_VALUE,
  TransactionBuilder,
  type Box,
  type TokenAmount
} from "@fleet-sdk/core";
import { SByte, SColl, SLong, SPair, SInt } from "@fleet-sdk/serializer";
import { blake2b256 } from "@fleet-sdk/crypto";
import * as fs from "fs";
import * as path from "path";
import { stringToBytes } from "@scure/base";
import { bigintToLongByteArray } from "$lib/ergo/utils";

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
  let gameBox: Box<bigint>;
  let participationBox1: Box<bigint>;
  let participationBox2: Box<bigint>;
  let secret: Uint8Array;
  let gameNftId: string;
  const deadlineBlock = 800_200;
  const participationFee = 1_000_000n;
  
  beforeEach(() => {
    mockChain = new MockChain({ height: 800_000 });

    creator = mockChain.newParty("GameCreator");
    participant1 = mockChain.newParty("Player1");
    participant2 = mockChain.newParty("Player2");
    creator.addBalance({ nanoergs: 10_000_000_000n });
    participant1.addBalance({ nanoergs: 1_000_000_000n });
    participant2.addBalance({ nanoergs: 1_000_000_000n });

    // --- Definir Partidos de Contratos --- 
    gameActiveContract = mockChain.addParty(gameActiveErgoTree.toHex(), "GameActiveContract");
    participationSubmittedContract = mockChain.addParty(participationSubmittedErgoTree.toHex(), "ParticipationSubmittedContract");
    gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolutionContract");
    participationResolvedContract = mockChain.addParty(participationResolvedErgoTree.toHex(), "ParticipationResolvedContract");


    // --- Creación de la caja `game_active.es` ---
    const creatorStake = 2_000_000_000n;
    secret = stringToBytes("utf8", "the-secret-phrase-for-testing");
    const hashedSecret = blake2b256(secret);
    const creatorPkBytes = creator.address.getPublicKeys()[0];
    const inputUTXO = creator.utxos.toArray()[0];
    gameNftId = inputUTXO.boxId;
    
    const gameBoxOutput = new OutputBuilder(creatorStake, gameActiveContract.address) 
      .mintToken({ amount: 1n, name: "Game NFT" })
      .setAdditionalRegisters({
        R4: SPair(SColl(SByte, creatorPkBytes), SLong(10n)).toHex(),
        R5: SColl(SByte, hashedSecret).toHex(),
        R6: SColl(SColl(SByte), []).toHex(),
        R7: SColl(SLong, [BigInt(deadlineBlock), creatorStake, participationFee]).toHex(),
        R8: SColl(SByte, stringToBytes("utf8", "{}")).toHex(),
      });
      
    const tx0 =  new TransactionBuilder(mockChain.height)
      .from(inputUTXO)
      .to(gameBoxOutput)
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    mockChain.execute(tx0, { signers: [creator] });
      
    gameBox = gameActiveContract.utxos.toArray()[0]; 


    // --- Creación de las cajas `participation_submited.es` ---
    const score1 = 1000n;
    const commitment1Hex = uint8ArrayToHex(blake2b256(
        new Uint8Array([...stringToBytes("utf8", "player1-solver"), ...bigintToLongByteArray(score1), ...stringToBytes("utf8", "logs1"), ...secret])
    ));

    const transaction1 = new TransactionBuilder(mockChain.height)
      .from(participant1.utxos.toArray())
      .to(new OutputBuilder(participationFee, participationSubmittedContract.address) 
        .setAdditionalRegisters({
            R4: SColl(SByte, participant1.address.getPublicKeys()[0]).toHex(),
            R5: SColl(SByte, commitment1Hex).toHex(),
            R6: SColl(SByte, gameNftId).toHex(),
            R7: SColl(SByte, stringToBytes("utf8", "player1-solver")).toHex(),
            R8: SColl(SByte, stringToBytes("utf8", "logs1")).toHex(),
            R9: SColl(SLong, [500n, 800n, score1, 1200n]).toHex(),
        }))
      .sendChangeTo(participant1.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    mockChain.execute(transaction1, { signers: [participant1] });
    
    const score2 = 850n;
    const commitment2Hex = uint8ArrayToHex(blake2b256(
        new Uint8Array([...stringToBytes("utf8", "player2-solver"), ...bigintToLongByteArray(score2), ...stringToBytes("utf8", "logs2"), ...secret])
    ));

    const transaction2 = new TransactionBuilder(mockChain.height)
      .from(participant2.utxos.toArray())
      .to(new OutputBuilder(participationFee, participationSubmittedContract.address) 
        .setAdditionalRegisters({
            R4: SColl(SByte, participant2.address.getPublicKeys()[0]).toHex(),
            R5: SColl(SByte, commitment2Hex).toHex(),
            R6: SColl(SByte, gameNftId).toHex(),
            R7: SColl(SByte, stringToBytes("utf8", "player2-solver")).toHex(),
            R8: SColl(SByte, stringToBytes("utf8", "logs2")).toHex(),
            R9: SColl(SLong, [score2, 900n, 950n]).toHex(),
        }))
      .sendChangeTo(participant2.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    mockChain.execute(transaction2, { signers: [participant2] });

    // Obtenemos las cajas de participación del partido correspondiente
    [participationBox1, participationBox2] = participationSubmittedContract.utxos.toArray(); 
    
    mockChain.newBlocks(deadlineBlock - mockChain.height + 1);
  });

  it("should successfully transition the game to the resolution phase", () => {
    const currentHeight = mockChain.height;
    const resolverPkBytes = creator.address.getPublicKeys()[0];
    const JUDGE_PERIOD = 30;
    const resolutionDeadline = BigInt(currentHeight + JUDGE_PERIOD);
    const winnerCandidateCommitment = participationBox1.additionalRegisters.R5;
    
    const resolutionBoxOutput = new OutputBuilder(gameBox.value, gameResolutionContract.address) 
      .addTokens(gameBox.assets as TokenAmount<bigint>[])
      .setAdditionalRegisters({
          R4: SPair(SLong(resolutionDeadline), SInt(2)).toHex(),
          R5: SPair(SColl(SByte, secret), SColl(SByte, winnerCandidateCommitment)).toHex(),
          R6: SColl(SColl(SByte), []).toHex(),
          R7: gameBox.additionalRegisters.R7,
          R8: SPair(SColl(SByte, resolverPkBytes), SLong(10n)).toHex(),
          R9: SPair(SColl(SByte, resolverPkBytes), SColl(SByte, stringToBytes("utf8", "{}"))).toHex(),
      });

    const resolvedParticipationOutput1 = new OutputBuilder(participationBox1.value, participationResolvedContract.address) 
        .setAdditionalRegisters(participationBox1.additionalRegisters);
    const resolvedParticipationOutput2 = new OutputBuilder(participationBox2.value, participationResolvedContract.address) 
        .setAdditionalRegisters(participationBox2.additionalRegisters);

    const tx = new TransactionBuilder(currentHeight)
      .from([gameBox, participationBox1, participationBox2, ...creator.utxos.toArray()])
      .to([resolutionBoxOutput, resolvedParticipationOutput1, resolvedParticipationOutput2])
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
    expect(newResolutionBox.value).to.equal(gameBox.value);
    expect(newResolutionBox.assets[0].tokenId).to.equal(gameNftId);
    
    const r4 = newResolutionBox.additionalRegisters.R4;
    expect(r4).to.equal(SPair(SLong(resolutionDeadline), SInt(2)).toHex());
    
    const r5 = newResolutionBox.additionalRegisters.R5;
    expect(r5).to.equal(SPair(SColl(SByte, secret), SColl(SByte, winnerCandidateCommitment)).toHex());
    
    const resolvedParticipationBoxes = participationResolvedContract.utxos.toArray();
    const matchingResolvedBox = resolvedParticipationBoxes.find(b => b.additionalRegisters.R5 === participationBox1.additionalRegisters.R5);
    expect(matchingResolvedBox).to.not.be.undefined;
    expect(matchingResolvedBox!.value).to.equal(participationBox1.value);
    expect(matchingResolvedBox!.additionalRegisters).to.deep.equal(participationBox1.additionalRegisters);
  });
});