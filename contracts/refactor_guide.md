# Guide: Implementing Judges Payment Refactor

This guide outlines the necessary steps to update the tests and the frontend interface following the refactoring of `game_resolution.es` and the creation of `judges_paid.es`.

## 1. Update Tests (`tests/end_game.test.ts`)

The `end_game.test.ts` file currently verifies that the "End Game" transaction creates individual outputs for each judge. This needs to be updated to verify a single output to the `judges_paid` contract.

### Steps:
1.  **Compile `judges_paid.es`**:
    -   In the test setup, compile `contracts/judges_paid.es`.
    -   You will need to inject `REPUTATION_PROOF_SCRIPT_HASH` (which should already be available in the test context).
    -   Store the resulting ErgoTree (or address) in a variable, e.g., `judgesPaidErgoTree`.

2.  **Update `game_resolution.es` Compilation**:
    -   When compiling `game_resolution.es` in the test, add `JUDGES_PAID_ERGOTREE` to the constants map.
    -   Value: The `judgesPaidErgoTree` obtained in the previous step.

3.  **Modify Transaction Verification**:
    -   Locate the test cases that check the outputs of the "End Game" transaction.
    -   **Remove** checks for individual judge payment boxes.
    -   **Add** a check for a single box with:
        -   `propositionBytes`: Equal to `judgesPaidErgoTree`.
        -   `value`: Equal to `finalJudgesPayout` (you may need to calculate this in the test or verify the total).
        -   `R4`: Should contain the `participatingJudges` array (Coll[Coll[Byte]]).
        -   `R5`: Should contain the `participationTokenId` (Coll[Byte]).

## 2. Update Interface (`src/lib/ergo/actions/resolve_game.ts`)

The `resolve_game.ts` file (specifically the `endGame` action) constructs the transaction to finalize the game. It needs to be updated to send judge funds to the new contract.

### Steps:
1.  **Obtain `judges_paid` Address/ErgoTree**:
    -   The frontend needs to know the address of the `judges_paid` contract.
    -   This might require compiling the contract on the frontend (if `fleet-sdk` supports it and the source is available) or having the address hardcoded/configured if it's static (though it depends on `REPUTATION_PROOF_SCRIPT_HASH`, so it might be static for a given environment).
    -   *Recommendation*: If the contract is static for the app, compile it once and store the address. If it depends on dynamic parameters, compile it at runtime.

2.  **Modify Output Creation**:
    -   In the transaction building logic (likely using `TransactionBuilder` or similar):
    -   **Remove** the loop that creates an output candidate for each judge.
    -   **Add** a single output candidate for the `judges_paid` contract:
        -   `ergoTree`: The ErgoTree of `judges_paid.es`.
        -   `value`: The total amount calculated for judges (`finalJudgesPayout`).
        -   `registers`:
            -   `R4`: `participatingJudges` (from the game box).
            -   `R5`: `participationTokenId` (from the game box).

3.  **Update `game_resolution` Compilation (if applicable)**:
    -   If the frontend compiles `game_resolution.es` on the fly (e.g. to get the script hash or address), ensure it injects the `JUDGES_PAID_ERGOTREE` constant.

## 3. New Action: Distribute Judge Funds (Optional/Future)

Since the funds are now locked in `judges_paid.es`, a new action is needed to actually distribute them to the judges.

-   **Contract**: `judges_paid.es`
-   **Action**: Spend the box.
-   **Inputs**: The `judges_paid` box.
-   **Data Inputs**: Reputation proofs for the judges (to verify addresses).
-   **Outputs**: Individual payments to judges.
-   **Trigger**: This can be triggered by anyone (e.g., a bot, the first judge to claim, or a dedicated "Distribute" button in the UI).

This action is not strictly part of "End Game" but is required for judges to receive their funds eventually.
