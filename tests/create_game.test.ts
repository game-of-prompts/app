import { beforeEach, describe, expect, it } from "vitest";
import { KeyedMockChainParty, MockChain } from "@fleet-sdk/mock-chain";
import { compile } from "@fleet-sdk/compiler";
import {
  OutputBuilder,
  RECOMMENDED_MIN_FEE_VALUE,
  TransactionBuilder,
  BOX_VALUE_PER_BYTE,
  SAFE_MIN_BOX_VALUE
} from "@fleet-sdk/core";
import {
  SByte,
  SColl,
  SInt,
  SLong,
  SPair
} from "@fleet-sdk/serializer";
import { blake2b256 } from "@fleet-sdk/crypto";
import { stringToBytes } from "@scure/base";
import { getGopGameActiveErgoTree } from "$lib/ergo/contract";


// --- Test Suite ---

const ERG_BASE_TOKEN = "";
const ERG_BASE_TOKEN_NAME = "ERG";
const USD_BASE_TOKEN = "ebb40ecab7bb7d2a935024100806db04f44c62c33ae9756cf6fc4cb6b9aa2d12";
const USD_BASE_TOKEN_NAME = "USD";

const baseModes = [
  { name: "USD Token Mode", token: USD_BASE_TOKEN, tokenName: USD_BASE_TOKEN_NAME },
];

describe.each(baseModes)("Game Creation (create_game) - (%s)", (mode) => {
  // `mockChain` simulates an Ergo blockchain, allowing transactions to be
  // executed and their results verified without a real network.
  let mockChain: MockChain;

  // --- Involved Parties ---
  // A 'creator' is defined as the main actor in the game creation.
  let creator: KeyedMockChainParty;

  // A 'party' representing the game contract address.
  let gameActiveContract: ReturnType<MockChain["newParty"]>;

  // --- Compiled Contracts ---
  // These variables will store the compiled ErgoTrees of our contracts.
  // Compilation is done once for the entire test suite.
  let gameActiveErgoTree: ReturnType<typeof compile>;

  gameActiveErgoTree = getGopGameActiveErgoTree();

  // Initialize the chain and actors before each test.
  beforeEach(() => {
    mockChain = new MockChain({ height: 800_000 });
    creator = mockChain.newParty("GameCreator");

    // Funds are assigned to the creator to create the game box and pay the transaction fee.
    // It's crucial that the balance is greater than the game stake + fee.
    if (mode.token !== ERG_BASE_TOKEN) {
      creator.addBalance({
        tokens: [{ tokenId: mode.token, amount: 10_000_000_000n }],
        nanoergs: RECOMMENDED_MIN_FEE_VALUE * 10n
      });
    } else {
      creator.addBalance({ nanoergs: 10_000_000_000n }); // 10 ERG
    }

    // A "party" is added to the mockchain representing the `game_active` contract address.
    // This allows us to easily query UTXOs belonging to this contract.
    gameActiveContract = mockChain.addParty(gameActiveErgoTree.toHex(), "GameActiveContract");
  });

  it("Should successfully create a new game box", () => {
    // --- 1. Arrange ---

    // Parameters for the game to be created.
    const deadlineBlock = mockChain.height + 200;
    const resolverStake = 2_000_000_000n; // 2 ERG
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

    // --- 2. Act ---

    // Build the output box that will represent the active game.

    // Calculate expected size and value
    const stripHexPrefix = (h: string) => h?.startsWith('0x') ? h.slice(2) : h;
    const hexBytesLen = (hexStr: string) => hexStr ? Math.ceil(stripHexPrefix(hexStr).length / 2) : 0;
    const BASE_BOX_OVERHEAD = 60;
    const PER_TOKEN_BYTES = 40;
    const PER_REGISTER_OVERHEAD = 1;
    const SIZE_MARGIN = 120;
    const BOX_VALUE_PER_BYTE = 360n; // Hardcoded or imported, better to match implementation
    const SAFE_MIN_BOX_VALUE = 1000000n; // Assuming this is the value used

    // Registers
    const r4Hex = SInt(0).toHex();
    const r5Hex = SColl(SByte, stringToBytes("utf8", "seed-for-ceremony")).toHex();
    const r6Hex = SColl(SByte, hashedSecret).toHex();
    const r7Hex = SColl(SColl(SByte), []).toHex();
    const r8Hex = SColl(SLong, [
      BigInt(deadlineBlock),
      resolverStake,
      participationFee,
      50000n,
      100000n
    ]).toHex();
    const r9Hex = SColl(SByte, stringToBytes("utf8", gameDetailsJson)).toHex();

    const registers = { R4: r4Hex, R5: r5Hex, R6: r6Hex, R7: r7Hex, R8: r8Hex, R9: r9Hex };

    let ergoTreeBytes = hexBytesLen(gameActiveErgoTree.toHex());

    // Tokens: NFT + (Token if mode.token != ERG)
    const tokensCount = mode.token !== ERG_BASE_TOKEN ? 2 : 1;
    const tokensBytes = 1 + tokensCount * PER_TOKEN_BYTES;

    let registersBytes = 0;
    for (const h of Object.values(registers)) {
      registersBytes += hexBytesLen(h) + PER_REGISTER_OVERHEAD;
    }

    const totalEstimatedSize = BigInt(
      BASE_BOX_OVERHEAD + ergoTreeBytes + tokensBytes + registersBytes + SIZE_MARGIN
    );
    const minRequiredValue = BOX_VALUE_PER_BYTE * totalEstimatedSize;

    const maxBigInt = (...vals: bigint[]) => vals.reduce((a, b) => a > b ? a : b, vals[0]);

    let gameBoxValue: bigint;
    if (mode.token === ERG_BASE_TOKEN) {
      gameBoxValue = resolverStake;
    } else {
      gameBoxValue = maxBigInt(SAFE_MIN_BOX_VALUE, minRequiredValue);
    }

    const gameBoxOutput = new OutputBuilder(
      gameBoxValue,
      gameActiveErgoTree
    )
      // Mint the Game NFT. It's a unique token that identifies the game.
      .mintToken({
        amount: 1n, // Only one is created.
        name: "Game NFT"
      });

    // Add token stake if in token mode (NFT is always at index 0, token at index 1)
    if (mode.token !== ERG_BASE_TOKEN) {
      gameBoxOutput.addTokens([{ tokenId: mode.token, amount: resolverStake }]);
    }

    // Set the additional registers with the game information,
    // following the specification in `game_active.es`.
    gameBoxOutput.setAdditionalRegisters({
      // R4: Game state (0: Active)
      R4: r4Hex,

      // R5: Seed (ceremony deadline is calculated as deadline - PARTICIPATION_TIME_WINDOW)
      R5: r5Hex,

      // R6: Hash of the secret 'S'
      R6: r6Hex,

      // R7: Invited judges (empty in this test)
      R7: r7Hex,

      // R8: [deadline, resolverStake, participationFee, perJudgeCommissionPercentage, resolverCommissionPercentage]
      R8: r8Hex,

      // R9: Detalles del juego
      R9: r9Hex
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

    // The nanoERG value of the box must equal the creator's stake in ERG mode,
    // or RECOMMENDED_MIN_FEE_VALUE in token mode.
    expect(createdGameBox.value).to.equal(gameBoxValue);

    // The ID of the minted token (Game NFT) must match the input box ID (always at index 0).
    expect(createdGameBox.assets[0].tokenId).to.equal(gameNftId);
    // The amount of the NFT must be 1.
    expect(createdGameBox.assets[0].amount).to.equal(1n);

    // In token mode, verify the token stake is at index 1
    if (mode.token !== ERG_BASE_TOKEN) {
      expect(createdGameBox.assets[1].tokenId).to.equal(mode.token);
      expect(createdGameBox.assets[1].amount).to.equal(resolverStake);
    }

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