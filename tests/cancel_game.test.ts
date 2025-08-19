import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockChain } from "@fleet-sdk/mock-chain";
import { compile } from "@fleet-sdk/compiler";
import {
    Box,
    OutputBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    TransactionBuilder
} from "@fleet-sdk/core";
import {
    SByte,
    SColl,
    SLong,
    SPair
} from "@fleet-sdk/serializer";
import { blake2b256 } from "@fleet-sdk/crypto";
import * as fs from "fs";
import * as path from "path";
import { stringToBytes } from "@scure/base";

// --- Utility and Constants Setup ---
const contractsDir = path.resolve(__dirname, "..", "contracts");

// Load contract templates. We need the active game contract (as input)
// and the cancellation contract (as output).
const GAME_ACTIVE_TEMPLATE = fs.readFileSync(path.join(contractsDir, "game_active.es"), "utf-8");
const GAME_CANCELLATION_TEMPLATE = fs.readFileSync(path.join(contractsDir, "game_cancellation.es"), "utf-8");

// Mocks for dependencies needed to compile the game_active contract
const GAME_RESOLUTION_SOURCE = "{ sigmaProp(false) }";
const PARTICIPATION_SUBMITTED_SOURCE = "{ sigmaProp(false) }";
const PARTICIPATION_RESOLVED_SOURCE = "{ sigmaProp(false) }";

describe("Game Cancellation (cancel_game_before_deadline)", () => {
    let mockChain: MockChain;

    // --- Actors ---
    let game: ReturnType<MockChain["newParty"]>;
    let creator: ReturnType<MockChain["newParty"]>;
    let claimer: ReturnType<MockChain["newParty"]>;

    // --- Contract Compilation ---
    // We must compile the contracts to get their ErgoTree for transaction building.
    const gameResolutionErgoTree = compile(GAME_RESOLUTION_SOURCE);
    const participationSubmittedErgoTree = compile(PARTICIPATION_SUBMITTED_SOURCE);
    const participationResolvedErgoTree = compile(PARTICIPATION_RESOLVED_SOURCE);
    
    // The game_cancellation contract depends on the creator's public key,
    // so we will compile it inside `beforeEach` once the creator is defined.
    let gameCancellationErgoTree: ReturnType<typeof compile>;

    // The game_active contract depends on the hashes of the other contracts.
    const gameActiveSource = GAME_ACTIVE_TEMPLATE
        .replace("`+GAME_RESOLUTION_SCRIPT_HASH+`", Buffer.from(blake2b256(gameResolutionErgoTree.bytes)).toString("hex"))
        .replace("`+PARTICIPATION_SUBMITED_SCRIPT_HASH+`", Buffer.from(blake2b256(participationSubmittedErgoTree.bytes)).toString("hex"))
        .replace("`+PARTICIPATION_RESOLVED_SCRIPT_HASH+`", Buffer.from(blake2b256(participationResolvedErgoTree.bytes)).toString("hex"));

    let gameActiveErgoTree: ReturnType<typeof compile>;
    
    // --- Game Parameters for the Test ---
    const creatorStake = 10_000_000_000n; // 10 ERG
    const deadlineBlock = 800_200;
    const secret = stringToBytes("utf8", "this-is-the-revealed-secret");
    const hashedSecret = blake2b256(secret);
    const gameNftId = "00aadd0000aadd0000aadd0000aadd0000aadd0000aadd0000aadd0000aadd00";

    let gameBox: Box;

    beforeEach(() => {
        mockChain = new MockChain({ height: 800_000 });
        game = mockChain.newParty("Game");
        creator = mockChain.newParty("GameCreator");
        claimer = mockChain.newParty("Claimer");

        // The claimer needs funds to pay the transaction fee.
        claimer.addBalance({ nanoergs: 1_000_000_000n });

        // Compile the cancellation contract with the specific creator's public key.
        const creatorPkHex = Buffer.from(creator.key.publicKey).toString("hex");
        const gameCancellationSource = GAME_CANCELLATION_TEMPLATE.replace("`+CREATOR_PK+`", creatorPkHex);
        gameCancellationErgoTree = compile(gameCancellationSource);

        // Compile the active contract with the hash of the newly compiled cancellation contract.
        const gameCancellationScriptHash = Buffer.from(blake2b256(gameCancellationErgoTree.bytes)).toString("hex");
        const finalGameActiveSource = gameActiveSource.replace("`+GAME_CANCELLATION_SCRIPT_HASH+`", gameCancellationScriptHash);
        gameActiveErgoTree = compile(finalGameActiveSource);

        // Arrange: Create the initial GameActive box that will be cancelled.
        game.addUTxOs({
            value: creatorStake,
            ergoTree: gameActiveErgoTree.toHex(),
            assets: [{ tokenId: gameNftId, amount: 1n }],
            creationHeight: mockChain.height,
            additionalRegisters: {
                R4: SPair(SColl(SByte, creator.key.publicKey), SLong(10n)).toHex(),
                R5: SColl(SByte, hashedSecret).toHex(),
                R6: SColl(SColl(SByte), []).toHex(),
                R7: SColl(SLong, [BigInt(deadlineBlock), creatorStake, 1_000_000n]).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "{}")).toHex(),
            }
        });

        gameBox = game.utxos.toArray()[0];
    });

    afterEach(() => {
        mockChain.reset();
    });

    it("should successfully cancel the game and pay penalty before the deadline", () => {
        // --- Arrange ---
        const claimerInitialBalance = claimer.balance.nanoergs;

        // --- Act ---
        // Calculate the expected fund distribution.
        const stakePortionToClaim = creatorStake / 5n;
        const newCreatorStake = creatorStake - stakePortionToClaim;
        const newUnlockHeight = BigInt(mockChain.height + 40); // From contract logic

        const transaction = new TransactionBuilder(mockChain.height)
            .from([gameBox, ...claimer.utxos.toArray()])
            .to([
                // Output 0: The new GameCancellation box
                new OutputBuilder(newCreatorStake, gameCancellationErgoTree)
                    .addTokens(gameBox.assets)
                    .setAdditionalRegisters({
                        R4: SLong(newUnlockHeight).toHex(),
                        R5: SColl(SByte, secret).toHex(),
                        R6: SLong(newCreatorStake).toHex(),
                        R7: gameBox.additionalRegisters.R8,
                    }),
                // Output 1: The penalty paid to the claimer
                new OutputBuilder(stakePortionToClaim, claimer.address)
            ])
            .sendChangeTo(claimer.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const executionResult = mockChain.execute(transaction, { signers: [claimer] });

        // --- Assert ---
        expect(executionResult).to.be.true;

        // Verify the original game box was spent
        /* expect(mockChain.boxes.at(gameActiveErgoTree.toHex())).to.have.length(0);

        // Verify the new cancellation box was created
        const cancellationBoxes = mockChain.boxes.at(gameCancellationErgoTree.toHex());
        expect(cancellationBoxes).to.have.length(1);
        
        const newCancellationBox = cancellationBoxes[0];
        expect(newCancellationBox.value).to.equal(newCreatorStake);
        expect(newCancellationBox.assets[0].tokenId).to.equal(gameNftId);
        expect(newCancellationBox.registers.R5).to.equal(SColl(SByte, secret).toHex());

        // Verify the claimer received the penalty
        const expectedFinalBalance = claimerInitialBalance + stakePortionToClaim - RECOMMENDED_MIN_FEE_VALUE;
        expect(claimer.balance.nanoergs).to.equal(expectedFinalBalance); */
    });

    it("should fail to cancel if the game deadline has passed", () => {
        // Advance time past the deadline
        mockChain.jumpTo(deadlineBlock + 1);
        expect(mockChain.height).to.be.greaterThan(deadlineBlock);

        // --- Act ---
        const transaction = new TransactionBuilder(mockChain.height)
            .from([gameBox, ...claimer.utxos.toArray()])
            .to([ new OutputBuilder(1_000_000_000n, claimer.address) ]) // Dummy output
            .sendChangeTo(claimer.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        // --- Assert ---
        // The contract's guard `HEIGHT < deadline` should prevent this transaction.
        const executionResult = mockChain.execute(transaction, { signers: [claimer], throw: false });
        expect(executionResult).to.be.false;

        // Verify the game box was NOT spent
        // expect(mockChain.boxes.toArray().at(gameActiveErgoTree.toHex())).to.have.length(1);
    });
});