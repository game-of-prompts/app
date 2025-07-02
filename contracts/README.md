# Game of Prompts - Ergo Smart Contracts

This document describes the ErgoScript smart contracts for the Game of Prompts (GoP) platform, focusing on `game.es` for the game box and `participation.es` for player participation boxes.

## 0\. Key Definitions and Contract Variables

This section defines crucial terms and variables used in the `game.es` and `participation.es` contracts.

### 0.1. `game.es` (GameBox) Contract Variables and Registers

  * **`GameBox`**: Conceptual name for the box protected by the `game.es` script. It is the main box managing a game.
  * **`gameCreatorPK` (`R4: Coll[Byte]`):** The raw bytes of the game creator's public key.
  * **`hashS` (`R5: Coll[Byte]`):** The Blake2b256 hash of the game's secret `S`. This hash is stored in the GameBox to verify `S` when revealed.
  * **`expectedParticipationScriptHash` (`R6: Coll[Byte]`):** The Blake2b256 hash of the expected `participation.es` script. Used to validate that incoming participation boxes use the correct contract.
  * **`numericalParameters` (`R7: Coll[Long]`):** A collection of numerical game parameters:
      * **`deadline` (`numericalParameters(0)`):** The block height marking the end of the participation period and the start of the game resolution window.
      * **`creatorStake` (`numericalParameters(1)`):** The amount of ERG the game creator has staked as a guarantee or incentive.
      * **`participationFee` (`numericalParameters(2)`):** The ERG fee players must pay for their participation to be considered.
  * **`commissionPercentage` (`R8: Int`):** The percentage of the total prize pool the game creator receives as a commission if the game is resolved correctly.
  * **`gameDetailsJsonHex` (`R9: Coll[Byte]`):** A JSON string (converted from UTF-8 to hexadecimal) containing descriptive game details (title, description, rules, etc.).
  * **`gameNftId` (`SELF.tokens(0)._1`):** The ID of the unique token identifying this specific game. The GameBox is expected to contain 1 unit of this token.
  * **`S` (conceptual):** The game's secret, initially known only by the creator (or the game-service). It is revealed during "Action 1: Game Resolution" to validate scores.
  * **`gameCreatorP2PKPropBytes`**: The complete P2PK proposition script of the game creator, constructed using `P2PK_ERGOTREE_PREFIX ++ gameCreatorPK`.
  * **`action1_isValidResolution` (variable in `game.es` code):** The boolean logic in the `game.es` script defining the validity of "Action 1: Game Resolution" described in this README.
  * **`action2_isValidCancellation` (variable in `game.es` code):** The boolean logic (currently commented out in `game.es`) defining the validity of "Action 2: Cancellation for Early Secret Revelation" described in this README.
  * **`revealedS_fromOutput`**: Variable containing the secret `S` extracted from register `R4` of the creator's output box during "Action 1: Game Resolution".
  * **`participationInputs`**: Variable containing a slice of the transaction's `INPUTS`, representing the boxes expected to be ParticipationBoxes.
  * **`pBox` (in the `game.es` fold):** Variable representing an individual box from `participationInputs` being processed during "Action 1: Game Resolution".
  * **`pBoxPlayerPK`, `pBoxCommitment`, `pBoxSolverId`, `pBoxHashLogs`, `pBoxScoreList` (in `game.es`):** Variables that extract data from the corresponding registers of a `pBox` during its validation in "Action 1: Game Resolution".
  * **`testCommitment`**: Variable storing the result of the commitment calculation during score validation in "Action 1: Game Resolution".
  * **`actualScoreForThisPBox`**: The score of a `pBox` that has been successfully validated against its `pBoxCommitment` and the `revealedS_fromOutput` during "Action 1: Game Resolution".
  * **`prizePool` (conceptual, calculated in `game.es`):** The total sum of the values (`pBox.value`) of all validated ParticipationBoxes during "Action 1: Game Resolution".
  * **`winnerPK` (conceptual, determined in `game.es`):** The public key of the player whose ParticipationBox had the highest valid score during "Action 1: Game Resolution".

### 0.2. `participation.es` (ParticipationBox) Contract Variables and Registers

  * **`ParticipationBox`**: Conceptual name for the box protected by the `participation.es` script. It represents a player's participation in a game.
  * **`playerPKBytes` (`R4: Coll[Byte]`):** The raw bytes of the public key of the player creating the ParticipationBox.
  * **`commitmentC` (`R5: Coll[Byte]`):** The cryptographic commitment `blake2b256(solverId ++ longToByteArray(TRUE_SCORE) ++ hashLogs ++ S_game)`. This commitment is crucial for score validation.
  * **`gameNftId` (`R6: Coll[Byte]`):** The ID of the `gameNftId` of the game to which this participation belongs. It must match the `gameNftId` of the GameBox.
  * **`solverId` (`R7: Coll[Byte]`):** An identifier for the player's solver, in bytes (e.g., UTF-8).
  * **`hashLogs` (`R8: Coll[Byte]`):** A hash representing the player's game logs.
  * **`scoreList` (`R9: Coll[Long]`):** A collection of scores (`Long`). One of these scores must be the `TRUE_SCORE` used to generate `commitmentC`.
  * **`spentInValidGameResolution` (variable in `participation.es` code):** The boolean logic defining "Condition 1: Spent in a Valid Game Resolution".
  * **`spentInValidGameCancellation` (variable in `participation.es` code):** The boolean logic (currently commented out) defining "Condition 2: Spent in a Valid Game Cancellation".
  * **`playerReclaimsAfterGracePeriod` (variable in `participation.es` code):** The boolean logic (currently commented out) defining "Condition 3: Player Reclaims Funds After a Grace Period".
  * **`gameBoxCandidate`**: In `participation.es`, a variable representing an `INPUTS` box (usually `INPUTS(0)`) presumed to be the GameBox of the corresponding game.

-----

## 1\. `game.es` - Game Box Contract (GameBox)

This contract governs the main box of a game on the GoP platform. It holds the prize funds, the creator's stake, and the logic for game resolution and reward distribution.

### 1.1. Purpose

  * Represent a unique game on the blockchain.
  * Store game parameters, including `hashS`, `participationFee`, `deadline`, and `commissionPercentage`.
  * Handle the resolution logic to determine a winner based on submitted participations.
  * Distribute prizes to the winner and the commission and `creatorStake` to the creator.
  * (Optionally, if activated) Handle game cancellation if `S` is revealed prematurely.

### 1.2. Box Structure (GameBox)

(See Section 0.1 for register and token details)

### 1.3. Actions (Spending Logic)

#### Action 1: Game Resolution (defined by the `action1_isValidResolution` variable in the `game.es` code)

This is the main action to finalize the game and distribute prizes.

  * **Pre-conditions:**
      * Must be executed after the `deadline` (`HEIGHT >= deadline`).
      * The transaction must have at least two `OUTPUTS` (one for the winner and one for the creator).
  * **Secret Revelation:**
      * The creator's output (`OUTPUTS(1)`) must contain `S` in its `R4`.
      * It is verified that `blake2b256` of the revealed `S` matches `hashS` (from `R5` of the GameBox).
      * The creator's output must be protected by `gameCreatorP2PKPropBytes`.
  * **Processing of Participation Boxes (`INPUTS`):**
      * The script iterates over `participationInputs`.
      * **Structural Validation of each `pBox`:**
          * Registers R4-R9 defined.
          * Correct `gameNftId`.
          * `pBox.value >= participationFee`.
          * Hash of `pBox` script matches `expectedParticipationScriptHash`.
      * **Score Validation (Inner Fold):**
          * For each valid `pBox`, it iterates over `pBoxScoreList`.
          * For each `scoreAttempt`, `testCommitment = blake2b256(pBoxSolverId ++ longToByteArray(scoreAttempt) ++ pBoxHashLogs ++ revealedS_fromOutput)` is calculated.
          * If `testCommitment == pBoxCommitment`, `scoreAttempt` is the `actualScoreForThisPBox`.
  * **Winner Determination (Outer Fold):**
      * `maxScore` and `winnerPK` are tracked.
      * `prizePool` is accumulated from the valid `pBox.value`.
      * **Tie-breaking:** The first processed (in the transaction's input fold) with the `maxScore` wins.
  * **Transaction Output Validation:**
      * If there is a winner:
          * `creatorCommissionAmount` is calculated.
          * `finalWinnerPrize = prizePool - creatorCommissionAmount`.
          * **Winner's Output (`OUTPUTS(0)`):** Receives `>= finalWinnerPrize`, protected by `winnerPK`, and the `gameNftId`.
          * **Creator's Output (`OUTPUTS(1)`):** Receives `>= creatorCommissionAmount + creatorStake`, protected by `gameCreatorP2PKPropBytes`, and without `gameNftId`.

#### Action 2: Cancellation for Early Secret Revelation (defined by the `action2_isValidCancellation` variable in the `game.es` code)

  * **Current Status:** **COMMENTED OUT** in `game.es`; not active.
  * **Intended Logic:**
      * If `S` is revealed in `INPUTS(1).R4` *before* the `deadline`.
      * Participating players would receive their `participationFee` + portion of the `creatorStake`.
      * Creator would recover the remaining `creatorStake` and `gameNftId`.

### 1.4. Current Spending Condition

The GameBox can only be spent if the boolean logic of `action1_isValidResolution` (defining "Action 1: Game Resolution") is true.

-----

## 2\. `participation.es` - Participation Box Contract (ParticipationBox)

This contract governs the boxes created by players.

### 2.1. Purpose

  * Represent a player's participation.
  * Store `commitmentC`, `solverId`, `hashLogs`, and `scoreList`.
  * Ensure payment of `participationFee`.
  * Define spending conditions.

### 2.2. Box Structure (ParticipationBox)

(See Section 0.2 for register details)

### 2.3. Spending Conditions (Spending Logic)

#### Condition 1: Spent in a Valid Game Resolution (variable `spentInValidGameResolution` in `participation.es` code)

  * **Current Status:** Active.
  * Allows spending if it's part of "Action 1: Game Resolution" (whose validity is defined by the `action1_isValidResolution` variable in `game.es`) of the GameBox.
  * **Verifications:**
      * `gameBoxCandidate` (`INPUTS(0)`) is plausible (NFT, registers).
      * `HEIGHT >= gameDeadlineFromGameBox`.
      * Transaction structure looks like resolution (`OUTPUTS.size >= 2`, `OUTPUTS(1).R4` defined).

#### Condition 2: Spent in a Valid Game Cancellation (variable `spentInValidGameCancellation` in `participation.es` code)

  * **Current Status:** **COMMENTED OUT** in `participation.es`.
  * **Intended Logic:** Would allow spending if it's part of "Action 2: Cancellation for Early Secret Revelation" (whose validity is defined by the `action2_isValidCancellation` variable in `game.es`) of the GameBox.

#### Condition 3: Player Reclaims Funds After a Grace Period (variable `playerReclaimsAfterGracePeriod` in `participation.es` code)

  * **Current Status:** **COMMENTED OUT** in `participation.es`.
  * **Intended Logic:** Would allow the player to reclaim `participationFee` if the game is not resolved `N_GRACE_PERIOD_BLOCKS` after `deadline`.

### 2.4. Current Spending Condition

A ParticipationBox can only be spent if the boolean logic of `spentInValidGameResolution` (Condition 1) is true.

-----

## 3\. Score Commitment Scheme

The player receives `commitmentC` (pre-calculated by the game-service off-chain using `S`) and stores it in `R5` of their ParticipationBox. The format is:
`commitmentC = blake2b256(solverId ++ longToByteArray(TRUE_SCORE) ++ hashLogs ++ S_game)`

During "Action 1: Game Resolution" (in `game.es`), after `S` is revealed, the script verifies `commitmentC` for each `scoreAttempt` from `pBoxScoreList`:
`testCommitment = blake2b256(pBoxSolverId ++ longToByteArray(scoreAttempt) ++ pBoxHashLogs ++ revealedS_fromOutput)`
If `testCommitment == pBoxCommitment`, `scoreAttempt` is valid.

-----

## 4\. Workaround for P2PK Addresses

Both contracts use `P2PK_ERGOTREE_PREFIX = fromBase16("0008cd")` concatenated with public key bytes to form P2PK addresses. Example: `gameCreatorP2PKPropBytes = P2PK_ERGOTREE_PREFIX ++ gameCreatorPK`.

-----

## 5\. Interaction Flow (Simplified)

1.  **Game Creation:** Creator deploys `game.es`, creating the GameBox with `gameNftId`, `hashS`, `deadline`, etc.
2.  **Player Participation:**
      * Player interacts with game-service off-chain.
      * Receives `solverId`, `hashLogs`, `scoreList`, and `commitmentC` (pre-calculated by game-service with `S`).
      * Player creates ParticipationBox (according to `participation.es`), paying `participationFee`.
3.  **Game Resolution:**
      * Post-`deadline`, creator initiates a transaction to spend GameBox (executing "Action 1: Game Resolution").
      * Inputs: GameBox, ParticipationBoxes.
      * Creator reveals `S`.
      * `game.es` validates participations, `commitmentC`, determines winner, and creates outputs for winner (prize + NFT) and creator (commission + stake).

-----

To test the contract without running the game, the following [script](../games/snake/game/generate_commitment.py) can be executed to obtain data from a game.