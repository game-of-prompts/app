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
    SInt,
    SLong
} from "@fleet-sdk/serializer";
import * as fs from "fs";
import * as path from "path";
import { stringToBytes } from "@scure/base";

// --- Utility and Constants Setup ---
const contractsDir = path.resolve(__dirname, "..", "contracts");
const GAME_CANCELLATION_TEMPLATE = fs.readFileSync(path.join(contractsDir, "game_cancellation.es"), "utf-8");

describe("Game Stake Draining (drain_cancelled_game)", () => {
    let mockChain: MockChain;

    // --- Actors ---
    let creator: ReturnType<MockChain["newParty"]>;
    let claimer: ReturnType<MockChain["newParty"]>;
    let gameCancellationContract: ReturnType<MockChain["newParty"]>;


    // --- Contract Compilation ---
    let gameCancellationErgoTree: ReturnType<typeof compile>;

    // --- Game Parameters for the Test ---
    const initialCancelledStake = 10_000_000_000n; // 10 ERG
    const gameNftId = "11bbcc11bbcc11bbcc11bbcc11bbcc11bbcc11bbcc11bbcc11bbcc11bbcc11";
    const revealedSecret = stringToBytes("utf8", "the-secret-is-out");
    
    let cancelledGameBox: Box;

    beforeEach(() => {
        mockChain = new MockChain({ height: 800_000 });
        creator = mockChain.newParty("GameCreator");
        claimer = mockChain.newParty("Claimer");
        
        // The claimer needs funds to pay the transaction fee.
        claimer.addBalance({ nanoergs: 1_000_000_000n });

        // Compile the cancellation contract.
        gameCancellationErgoTree = compile(GAME_CANCELLATION_TEMPLATE);
        
        gameCancellationContract = mockChain.addParty(gameCancellationErgoTree.toHex(), "GameCancellationContract");

        // Arrange: Create the initial GameCancellation box that will be drained.
        // This simulates the state AFTER a game has been successfully cancelled.
        const unlockHeight = mockChain.height - 1; // Set in the past to be immediately drainable
        
        gameCancellationContract.addUTxOs({
            ergoTree: gameCancellationErgoTree.toHex(),
            value: initialCancelledStake,
            creationHeight: mockChain.height - 50, // created in the past
            assets: [{ tokenId: gameNftId, amount: 1n }],
            additionalRegisters: {
                R4: SInt(2).toHex(), // State: Cancelled
                R5: SLong(BigInt(unlockHeight)).toHex(),
                R6: SColl(SByte, revealedSecret).toHex(),
                R7: SLong(initialCancelledStake).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "{}")).toHex(),
            }
        });
        
        cancelledGameBox = gameCancellationContract.utxos.toArray()[0];
    });

    afterEach(() => {
        mockChain.reset();
    });

    it("should successfully drain a portion of the stake after the cooldown period", () => {
        // --- Arrange ---
        const claimerInitialBalance = claimer.balance.nanoergs;
        const unlockHeightFromRegister = parseInt(cancelledGameBox.additionalRegisters.R5.substring(4), 16);
        expect(mockChain.height).to.be.greaterThan(unlockHeightFromRegister);

        // --- Act ---
        // Calculate the expected fund distribution.
        const stakePortionToClaim = initialCancelledStake / 5n;
        const remainingStake = initialCancelledStake - stakePortionToClaim;
        const cooldownBlocks = 30;
        const cooldownMargin = 10;
        const newUnlockHeight = BigInt(mockChain.height + cooldownBlocks + cooldownMargin); // Cooldown for the next drain

        const transaction = new TransactionBuilder(mockChain.height)
            .from([cancelledGameBox, ...claimer.utxos.toArray()])
            .to([
                // Output 0: The recreated GameCancellation box with reduced stake
                new OutputBuilder(remainingStake, gameCancellationErgoTree)
                    .addTokens(cancelledGameBox.assets)
                    .setAdditionalRegisters({
                        R4: SInt(2).toHex(), // Preserve State
                        R5: SLong(newUnlockHeight).toHex(),
                        R6: SColl(SByte, revealedSecret).toHex(),
                        R7: SLong(remainingStake).toHex(),
                        R8: cancelledGameBox.additionalRegisters.R8,
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

        // Verify the new cancellation box was created and the old one was spent
        const newCancellationBoxes = gameCancellationContract.utxos.toArray();
        expect(newCancellationBoxes).to.have.length(1);
        
        const newCancellationBox = newCancellationBoxes[0];
        expect(newCancellationBox.value).to.equal(remainingStake);
        expect(newCancellationBox.assets[0].tokenId).to.equal(gameNftId);
        expect(newCancellationBox.additionalRegisters.R5).to.equal(SLong(newUnlockHeight).toHex());
        expect(newCancellationBox.additionalRegisters.R7).to.equal(SLong(remainingStake).toHex());

        // Verify the claimer received their portion of the stake
        const expectedFinalBalance = claimerInitialBalance + stakePortionToClaim - RECOMMENDED_MIN_FEE_VALUE;
        expect(claimer.balance.nanoergs).to.equal(expectedFinalBalance);
    });

    it("should fail to drain the stake before the cooldown period ends", () => {
        // --- Arrange ---
        // Create a new box with a future unlock height
        const futureUnlockHeight = mockChain.height + 10;
        gameCancellationContract.utxos.clear(); // remove the previous box
        gameCancellationContract.addUTxOs({
            ergoTree: gameCancellationErgoTree.toHex(),
            value: initialCancelledStake,
            creationHeight: mockChain.height,
            assets: [{ tokenId: gameNftId, amount: 1n }],
            additionalRegisters: {
                R4: SInt(2).toHex(), // State: Cancelled
                R5: SLong(BigInt(futureUnlockHeight)).toHex(),
                R6: SColl(SByte, revealedSecret).toHex(),
                R7: SLong(initialCancelledStake).toHex(),
                R8: SColl(SByte, stringToBytes("utf8", "{}")).toHex(),
            }
        });
        const futureLockedBox = gameCancellationContract.utxos.toArray()[0];

        expect(mockChain.height).to.be.lessThan(futureUnlockHeight);
        
        // --- Act ---
        const transaction = new TransactionBuilder(mockChain.height)
            .from([futureLockedBox, ...claimer.utxos.toArray()])
            .to([new OutputBuilder(1_000_000_000n, claimer.address)]) // Dummy output
            .sendChangeTo(claimer.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        // --- Assert ---
        // The contract's guard `HEIGHT >= SELF.R5[Long].get` should prevent this transaction.
        const executionResult = mockChain.execute(transaction, { signers: [claimer], throw: false });
        expect(executionResult).to.be.false;

        // Verify the game box was NOT spent
        expect(gameCancellationContract.utxos.toArray()).to.have.length(1);
        expect(gameCancellationContract.utxos.toArray()[0].boxId).to.equal(futureLockedBox.boxId);
    });
});