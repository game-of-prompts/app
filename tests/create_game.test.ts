import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockChain } from "@fleet-sdk/mock-chain";
import { compile } from "@fleet-sdk/compiler";
import {
  ErgoAddress as Address,
  OutputBuilder,
  RECOMMENDED_MIN_FEE_VALUE,
  TransactionBuilder
} from "@fleet-sdk/core";
import {
  SByte,
  SColl,
  SInt,
  SLong,
  SPair
} from "@fleet-sdk/serializer";
import { blake2b256 } from "@fleet-sdk/crypto";
import * as fs from "fs";
import * as path from "path";
import { stringToBytes } from "@scure/base";
import { PARTICIPATION } from "$lib/ergo/reputation/types";

/**
 * Utility function to convert a Uint8Array to a hex string.
 * This is necessary for comparing script hashes and register values,
 * which are handled as hex strings.
 */
function uint8ArrayToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

// --- Constants and File Loading ---

// Developer's address for the commission, required by the `game_resolution` contract.
const DEV_ADDR_BASE58 = "9ejNy2qoifmzfCiDtEiyugthuXMriNNPhNKzzwjPtHnrK3esvbD";

// Resolve the path to the contracts directory to load the source files.
const contractsDir = path.resolve(__dirname, "..", "contracts");

// Load the source code of each ErgoScript contract.
// They are read as plain text to allow placeholder replacement before compilation.
const GAME_ACTIVE_TEMPLATE = fs.readFileSync(
  path.join(contractsDir, "game_active.es"),
  "utf-8"
);
const GAME_RESOLUTION_TEMPLATE = fs.readFileSync(
  path.join(contractsDir, "game_resolution.es"),
  "utf-8"
);

const redeemScriptSource = fs.readFileSync(
  path.join(contractsDir, "redeemP2SH.es"),
  "utf-8"
);
const redeemErgoTree = compile(redeemScriptSource);

// that always fails is created to allow the `game_active` contract to compile.
const GAME_CANCELLATION_SOURCE = "{ sigmaProp(false) }";   // Not needed.
const PARTICIPATION_TEMPLATE = fs.readFileSync(
  path.join(contractsDir, "participation.es"),
  "utf-8"
);


// --- Test Suite ---

describe("Game Creation (create_game)", () => {
  // `mockChain` simulates an Ergo blockchain, allowing transactions to be
  // executed and their results verified without a real network.
  let mockChain: MockChain;

  // --- Involved Parties ---
  // A 'creator' is defined as the main actor in the game creation.
  let creator: ReturnType<MockChain["newParty"]>;
  
  // A 'party' representing the game contract address.
  let gameActiveContract: ReturnType<MockChain["newParty"]>;

  // --- Compiled Contracts ---
  // These variables will store the compiled ErgoTrees of our contracts.
  // Compilation is done once for the entire test suite.
  let gameActiveErgoTree: ReturnType<typeof compile>;
  
  // --- Dynamic Contract Compilation ---
  // ErgoScript contracts often depend on each other.
  // The `game_active` contract needs to know the hash of other contracts it can transition to.
  // Therefore, we compile in order of dependency, injecting the necessary hashes.

  // 1. `participation`: No dependencies.
  const participationErgoTree = compile(PARTICIPATION_TEMPLATE);
  const participationScriptHash = uint8ArrayToHex(blake2b256(participationErgoTree.bytes));
  
  // 3. `game_cancellation`: Mock with no dependencies.
  const gameCancellationErgoTree = compile(GAME_CANCELLATION_SOURCE);
  const gameCancellationScriptHash = uint8ArrayToHex(blake2b256(gameCancellationErgoTree.bytes));
  
  // 4. `game_resolution`: Depends on participation hashes.
  const gameResolutionSource = GAME_RESOLUTION_TEMPLATE
    .replace("`+PARTICIPATION_SCRIPT_HASH+`", participationScriptHash)
    .replace("`+REPUTATION_PROOF_SCRIPT_HASH+`", "0".repeat(64)) // No se usa en este script
    .replace("`+REDEEM_SCRIPT_HASH+`", uint8ArrayToHex(blake2b256(redeemErgoTree.toHex())))
    .replace("`+PARTICIPATION_TYPE_ID+`", PARTICIPATION)
    .replace("`+DEV_ADDR+`", DEV_ADDR_BASE58);
  const gameResolutionErgoTree = compile(gameResolutionSource);
  const gameResolutionScriptHash = uint8ArrayToHex(blake2b256(gameResolutionErgoTree.bytes));

  // 5. `game_active`: This is the main contract and depends on all others.
  const gameActiveSource = GAME_ACTIVE_TEMPLATE
    .replace("`+GAME_RESOLUTION_SCRIPT_HASH+`", gameResolutionScriptHash)
    .replace("`+GAME_CANCELLATION_SCRIPT_HASH+`", gameCancellationScriptHash)
    .replace("`+PARTICIPATION_SCRIPT_HASH+`", participationScriptHash); // Dependency added for completeness.
  
  gameActiveErgoTree = compile(gameActiveSource);
  
  // Initialize the chain and actors before each test.
  beforeEach(() => {
    mockChain = new MockChain({ height: 800_000 });
    creator = mockChain.newParty("GameCreator");

    // Funds are assigned to the creator to create the game box and pay the transaction fee.
    // It's crucial that the balance is greater than the game stake + fee.
    creator.addBalance({ nanoergs: 10_000_000_000n }); // 10 ERG

    // A "party" is added to the mockchain representing the `game_active` contract address.
    // This allows us to easily query UTXOs belonging to this contract.
    gameActiveContract = mockChain.addParty(gameActiveErgoTree.toHex(), "GameActiveContract");
  });

  it("Should successfully create a new game box", () => {
    // --- 1. Arrange ---

    // Parameters for the game to be created.
    const deadlineBlock = mockChain.height + 200;
    const creatorStake = 2_000_000_000n; // 2 ERG
    const participationFee = 1_000_000n; // 0.001 ERG
    const commissionPercentage = 10;
    const gameDetailsJson = JSON.stringify({ title: "New Test Game", desc: "A test." });

    // The secret 'S' and its hash. The hash is stored on-chain, the secret is revealed later.
    const secret = stringToBytes("utf8", "super-secret-phrase");
    const hashedSecret = blake2b256(secret);

    // Get a UTXO from the creator to use as input.
    // In Ergo, the ID of the first transaction input is used to determine the ID of minted tokens.
    const inputUTXO = creator.utxos.toArray()[0];
    const gameNftId = inputUTXO.boxId;

    // Extract the creator's public key in bytes, required for register R5.
    const creatorPkBytes = creator.address.getPublicKeys()[0];

    // --- 2. Act ---

    // Build the output box that will represent the active game.
    const gameBoxOutput = new OutputBuilder(
        creatorStake,
        gameActiveErgoTree
    )
    // Mint the Game NFT. It's a unique token that identifies the game.
    .mintToken({
        amount: 1n, // Only one is created.
        name: "Game NFT"
    })
    // Set the additional registers with the game information,
    // following the specification in `game_active.es`.
    .setAdditionalRegisters({
        // R4: Game state (0: Active)
        R4: SInt(0).toHex(),
        // R5: (Creator's public key, Commission percentage)
        R5: SPair(SColl(SByte, creatorPkBytes), SLong(BigInt(commissionPercentage))).toHex(),
        // R6: Hash of the secret 'S'
        R6: SColl(SByte, hashedSecret).toHex(),
        // R7: Invited judges (empty in this test)
        R7: SColl(SColl(SByte), []).toHex(),
        // R8: [deadline, creator's stake, participation fee]
        R8: SColl(SLong, [BigInt(deadlineBlock), creatorStake, participationFee]).toHex(),
        // R9: Game details in JSON format (converted to bytes)
        R9: SColl(SByte, stringToBytes("utf8", gameDetailsJson)).toHex()
    });

    // Build the transaction.
    const transaction = new TransactionBuilder(mockChain.height)
      .from(inputUTXO) // Use the creator's UTXO.
      .to(gameBoxOutput) // Create the game box.
      .sendChangeTo(creator.address) // Change goes back to the creator.
      .payFee(RECOMMENDED_MIN_FEE_VALUE) // Pay the mining fee.
      .build();

    // Execute the transaction on the mockchain. The creator must sign it.
    const executionResult = mockChain.execute(transaction, { signers: [creator] });
    
    // --- 3. Assert ---

    // The transaction should have been executed successfully.
    expect(executionResult).to.be.true;

    // There should be a single UTXO at the game contract's address.
    expect(gameActiveContract.utxos.length).to.equal(1);
    
    // Get the created box to verify its properties.
    const createdGameBox = gameActiveContract.utxos.toArray()[0];

    // The nanoERG value of the box must equal the creator's stake.
    expect(createdGameBox.value).to.equal(creatorStake);
    // The ID of the minted token (Game NFT) must match the input box ID.
    expect(createdGameBox.assets[0].tokenId).to.equal(gameNftId);
    // The amount of the NFT must be 1.
    expect(createdGameBox.assets[0].amount).to.equal(1n);

    // Verify that each register contains the correct, serialized information.
    // This is the most important part to ensure compatibility with the contract.
    expect(createdGameBox.additionalRegisters.R4).to.equal(gameBoxOutput.additionalRegisters.R4);
    expect(createdGameBox.additionalRegisters.R5).to.equal(gameBoxOutput.additionalRegisters.R5);
    expect(createdGameBox.additionalRegisters.R6).to.equal(gameBoxOutput.additionalRegisters.R6);
    expect(createdGameBox.additionalRegisters.R7).to.equal(gameBoxOutput.additionalRegisters.R7);
    expect(createdGameBox.additionalRegisters.R8).to.equal(gameBoxOutput.additionalRegisters.R8);
    expect(createdGameBox.additionalRegisters.R9).to.equal(gameBoxOutput.additionalRegisters.R9);
  });
});