## Game of Prompts (GoP)

**Game of Prompts** is a competitive platform where creators design **game-services** that evaluate the robots playing them (solvers), and players create **solver-services** that attempt to maximize their score in those games. The services operate following the Celaut paradigm, and the entire system functions using the Ergo (ERG) blockchain to record and evaluate results and transfer prizes.

![logo](logos/logo.png)

### Technological Foundations of GoP

To understand Game of Prompts, it's essential to know the two technologies it's built upon: the Celaut paradigm and the Ergo blockchain.

#### Celaut: Service Execution

[Celaut](https://github.com/celaut-project) is a paradigm for the decentralized execution of computational services. Its foundations include:

  * Software packaged as immutable and uniquely identified "services" (e.g., by content hash).
  * Distributed execution on nodes of the Celaut network.
  * Composition of services, where some use others as dependencies.
  * Execution in isolated environments (containers) with resource control.
  * Support for deterministic services, crucial for reproducibility.

> While Celaut, as a paradigm, contemplates the use of Ergo for interaction and incentive mechanisms (like payments or reputation management) among nodes in its own network, Game of Prompts primarily focuses on other fundamental capabilities of Celaut: the packaging of immutable services, their isolated and deterministic execution, and the composition of these. These are the features that are crucial for GoP, without the Celaut internal network infrastructure for interaction between its nodes being a requirement. **Utilizing these properties is crucial for the system to function while maintaining the P2P philosophy.**

#### Ergo: A Blockchain for Smart Contracts

[Ergo](https://ergoplatform.org) is a Proof-of-Work blockchain distinguished by its robust extended Unspent Transaction Output (eUTXO) accounting model and its expressive smart contract language, ErgoScript. These features make Ergo an ideal platform for building complex and secure decentralized applications (dApps), being fundamental for the on-chain operations of Game of Prompts.

## 1. Main Components

The fundamental elements that constitute the Game of Prompts platform are:

  * **Game Service (`<game_id>.celaut.bee`)**:
    It's an autonomous service that encapsulates all the logic of a specific game, created by a game designer. Its design should be obfuscated to protect its internal workings and the game's secret. Its main responsibility is to receive a Solver Service as input, execute the game, evaluate the solver's performance according to the game's internal rules, and generate game data as output, including the score obtained, a hash of the logs, and the `commitmentC` necessary for on-chain participation.

  * **Solver Service (`<solver_id>.celaut.bee`)**:
    This is also a Celaut service, but it's created by a player with the objective of interacting with and solving a particular Game Service. The solver implements the player's strategy or logic to maximize the score in the game. It's packaged and sent to the Game Service for evaluation.

  * **GoP Web**:
    Acts as the central community portal. Through this web interface (which could also be a general Celaut service: `web-gop.celaut.bee`, but with a connection to an Ergo explorer), users can discover and publish games, read their descriptions and rules, download Game Services to test or play them, and facilitate the process of publishing results (the `ParticipationBox`) on the Ergo blockchain.

-----

## 2. Creator's Flow (Game Designer)

The process for a creator to design and publish a game on the GoP platform involves several steps:

1.  **Game Design**

      * The core of the design is a challenge that produces a **quantifiable score**. This means the result is not simply binary (solved/unsolved), but allows for ranking among different solvers. For example, in a maze game, the score could be inversely proportional to the time or number of steps, or proportional to how close it was to the exit.
      * For the Ergohack MVP, the focus is on games with **objective** scoring, such as puzzles, mazes, prediction games, classification tasks, etc., where evaluation can be algorithmic and deterministic. Specifically, two games have been implemented: [Snake](games/snake/README.md) and [Trading](games/trading/README.md)

    > ⚠️ **Variability:** It's crucial for a game to exhibit a high Scenario Dispersion Coefficient (CDE). If the Game Service always presents the same input or problem, players could simply "hardcode" an optimal solution. To avoid this, the game should generate variable scenarios in each execution; for example, if it's a story generation game, each game could ask "create a story about [random_topic]" where `random_topic` changes, ensuring the solver must be general and not tailored to a single case.

2.  **Secret Generation (`S`)**

      * The creator must generate a unique and random 256-bit secret code for their game. This secret `S` is fundamental for the functioning of `commitmentC` and the subsequent validation of scores during the resolution phase. Its hash (`hashS`) will be registered on-chain.

3.  **Game Service Packaging**

      * It's recommended that creators use a standard template for the Game Service. This template would facilitate integration with the GoP ecosystem and include common logic for:
          * Receiving a Solver Service as input.
          * Executing the solver within the game environment (i.e., requesting its execution from the node and having the node return the endpoint through which to use it).
          * Calculating the score.
          * Generating logs and their hash (`hashLogs`).
          * Using the game's secret `S` to calculate `commitmentC` (which links `solverId`, score, `hashLogs`, and `S`).
      * The creator must integrate their game's specific logic and the secret `S` in the designated places within the template.
      * Finally, the game is packaged as a Celaut service and exported to a file such as (`<game_id>.celaut.bee`).

    > In the Celaut paradigm, 'packaging' a service involves consolidating its code, Dockerfile, and configuration metadata (architecture, API, etc.), structuring them according to a Protobuf [schema](https://github.com/celaut-project/nodo/blob/master/protos/celaut.proto) and serializing them into a binary format using [Protocol Buffers (protobuf)](https://protobuf.dev/). Given the potential bulkiness of these services—especially because the specification of a Celaut service, like a 'Solver Service' in Game of Prompts, encapsulates its entire file system—Celaut nodes use [bee-rpc](https://github.com/bee-rpc-protocol/bee-rpc). This protocol is optimized for transferring large protobuf messages with efficient memory usage, which is crucial for a 'Game Service' to effectively receive and handle a 'Solver Service'.

4.  **Publication on Ergo and GoP Web**

      * The creator must register their game on the GoP Web, providing:
          * The Celaut service ID (`<game_id>.celaut.bee`).
          * The **hash of the secret key (`hashS`)**. This hash is generated by the creator from their secret key `S` (a unique and random 256-bit value that they must generate and keep secure). It is `hashS` that is provided to the GoP Web for game registration. The original secret key `S` **is not shared with the GoP Web platform** nor made public to players at this stage, being reserved exclusively for the game resolution phase, where it is fundamental for validating scores.
          * Alternative links (mirrors) for downloading the Game Service (in case their Celaut node doesn't have peers with that service available, as otherwise it will request it automatically).
          * An exhaustive description: game dynamics, how the score is calculated, time or resource limits, etc.
          * The cost per participation (`participationFee`) in ERG.
          * The deadline (`deadline`) for players to submit their participations.
          * The commission percentage (`commissionPercentage`) the creator will receive from the prize pool.
          * Optionally, they can link to proof of their reputation or history.
      * The GoP Web acts as an interface for "Game Creation (Contract Deployment)" on the Ergo blockchain (see Section 6). Through it, the creator publishes the `GameBox` containing `hashS`, `deadline`, `participationFee`, `commissionPercentage`, `creatorStake`, and the `gameNftId`, thus officializing the game on the platform.

-----

## 3. Player's Flow (Participant)

For a player to participate in a GoP game, they follow these steps:

1.  **Game Selection**

      * The player browses the GoP Web to find a game that interests them. To make their decision, they can consider the game description, rules, `participationFee`, `deadline`, the creator's `commissionPercentage`, and, if available, information about the CDE (previously mentioned) or the creator's reputation.
      * Once chosen, they download the Game Service (`<juego_id>.celaut.bee`) and run it on their own Celaut node or a trusted peer of their node. This local execution allows them to understand the game mechanics (even if the internal logic is obfuscated) and test different strategies (they can try as many times as they want, because the fee is only paid for participation).

2.  **Solver Design**

      * Based on their understanding of the game, the player designs and develops a Solver Service (`<solver_id>.celaut.bee`). This solver must be able to interact with the interface expected by the Game Service (implicitly or explicitly defined by the game creator).
      * The solver's objective is to implement logic that attempts to obtain the highest possible score according to the game's rules.
      * Once ready, the player packages their solver as a Celaut service and exports it to a file such as `<solver_id>.celaut.bee` or `<solver_tag>.celaut.bee`.

3.  **Game Execution (to obtain participation data)**

      * The Game Service (`<juego_id>.celaut.bee`) is run on the player's Celaut node (or a trusted one), and the newly created Solver Service (`<solver_id>.celaut.bee`) is provided as input.
      * The Game Service processes the interaction with the solver, evaluates its performance, and generates a set of crucial data. This information is what the player will need if they decide to compete formally:
          * **For the `ParticipationBox` (data to be registered on-chain):**
              * **Solver ID (`solverId`):** A unique identifier for the player's solver service (i.e., the hash of the Celaut service). It will be stored in `R7` of the `ParticipationBox`.
              * **Score List (`scoreList`):** A collection of several scores, where one of them is the actual score obtained, and the others act as decoys to obfuscate the exact result. It will be stored in `R9` of the `ParticipationBox`.
              * **Log Hash (`hashLogs`):** A cryptographic hash of significant game events and movements. It will be stored in `R8` of the `ParticipationBox`.
              * **Cryptographic Commitment (`commitmentC`):** Calculated by the Game Service. It's a hash `blake2b256(solverId ++ longToByteArray(TRUE_SCORE) ++ hashLogs ++ S_game)`. This `commitmentC` links the solver's identity, its true score (present in `scoreList`), its game logs, and the game's secret `S`. It will be stored in `R5` of the `ParticipationBox`.
          * **For the Player (reference and off-chain verification information):**
              * **The True Score:** The player knows which of the scores in `scoreList` was actually achieved.
              * **Complete Log File:** The detailed record of the game, which when hashed must match `hashLogs`.
              * **Scenario Seed (optional, but highly recommended):** If the game uses procedural scenario generation, the seed would allow reproducing the exact same game instance for verification. In our Snake example, this means reproducing the same initial position of the snake and the same position of each apple.
              * **Game Creator's Signature on the results (optional, good practice):** The Game Service should digitally sign the generated dataset (especially `commitmentC` and the score) with a private key associated with the creator. This provides an additional (off-chain) guarantee of the authenticity of their local game results before deciding to publish them.

4.  **Competition Participation**

      * If the player is satisfied with their score and wishes to compete for the prize, they use the data generated in the previous step (mainly `solverId`, `hashLogs`, `scoreList`, and `commitmentC`) to build and publish a transaction on the Ergo blockchain. This transaction creates a `ParticipationBox`.
      * Creating this box requires the player to pay the `participationFee` in ERG, which is included in the value of the `ParticipationBox`.
      * Once the `ParticipationBox` is mined on the blockchain before the `deadline`, the player is formally participating in the competition.

-----

## 4. Resolution and Rewards

  * **Result Publication**

      * Players publish their `ParticipationBox` (with `commitmentC` and other data) before the deadline.

  * **Collection and Comparison**

      * The winner is the solver with the **highest score**, determined and validated on-chain during Action 1 (Game Resolution) using the secret `S` revealed by the creator and each participant's `commitmentC`.
      * In case of a tie:
          * The one added first in the resolution transaction wins (according to the processing order in the `game.es` contract fold).
          * If they are in the same block, the order within the transaction is determinant.

  * **Prize Distribution - Game Resolution**

      * The `game.es` contract (GameBox), when Action 1 (Resolution) is executed, distributes the accumulated funds (from participation fees) to the winner and the commission to the creator. The creator is incentivized to execute this action to receive their commission and recover their `creatorStake`.

    > A low stake by the creator means they might ultimately not want to resolve the game, so the lower the reputation or trust in the creator, the higher the necessary stake should be, although participating or not is the players' decision.

-----

## 5. Security, Transparency, and MVP Assumptions

Trust and clarity are fundamental in GoP. For the Ergohack MVP version, the following aspects are considered:

  * **Obfuscated Game Logic:**

      * Game services (`<juego_id>.celaut.bee`) should be protected to hinder reverse engineering and premature discovery of their internal logic or the secret `S`.

  * **Cryptographic Commitments and Secret `S`:**

      * The `commitmentC` stored in each `ParticipationBox` can only be validated with the game's secret `S`. A participant's actual score is not publicly visible on-chain until the revelation of `S` during Action 1 (Resolution), thanks to the use of `scoreList` and `commitmentC`.

  * **Detailed Score Validation Mechanism (Action 1 - Resolution):**
    The system implemented in the contracts (`game.es` and `participation.es`) ensures score integrity without revealing it prematurely through the following process:

    1.  **Data Stored in the `ParticipationBox` (on-chain by the player):**
          * `solverId` (in register R7): Identifier of the player's solver, obtained by packaging the solver's code into a Celaut service.
          * `hashLogs` (in register R8): Hash of the game logs.
          * `scoreList` (in register R9): A list of several scores, where one is the actual score obtained and the others act as decoys.
          * `commitmentC` (in register R5): A cryptographic commitment calculated by the game service using the secret `S` (not yet publicly revealed). Its format is:
            `commitmentC = blake2b256(solverId ++ longToByteArray(TRUE_SCORE) ++ hashLogs ++ S_game)`
            The `TRUE_SCORE` is one of the scores present in the `scoreList`.
    2.  **Validation Process during Action 1 (Game Resolution) in `game.es`:**
          * The game creator reveals the secret `S` (in `OUTPUTS(1).R4` of the resolution transaction).
          * For each candidate `ParticipationBox` (included as an `INPUT` in the transaction), the `game.es` contract iterates through each `scoreAttempt` in the `pBoxScoreList` (extracted from `R9` of the `ParticipationBox`).
          * For each `scoreAttempt`, the contract calculates a `testCommitment` using the `pBoxSolverId` (from `R7`) and `pBoxHashLogs` (from `R8`) of that `ParticipationBox`, the current `scoreAttempt`, and the `S` revealed by the creator:
            `testCommitment = blake2b256(pBoxSolverId ++ longToByteArray(scoreAttempt) ++ pBoxHashLogs ++ revealedS_fromOutput)`
          * If this `testCommitment` matches the `pBoxCommitment` (from `R5`) stored in the `ParticipationBox`, then `scoreAttempt` is considered the authentic and validated score (`actualScoreForThisPBox`) for that participation.
    3.  **Advantages and Assumptions of this Scheme:**
          * **The actual score is not publicly visible in the `ParticipationBox` before resolution.** This is achieved through `scoreList` and `commitmentC`.
          * **The player cannot change their score after participating** because the `ParticipationBox` is immutable once created on the blockchain.
          * **The creator cannot falsify a score for an existing `ParticipationBox` during on-chain resolution.** Once the creator reveals a single `S` in the resolution transaction, the `game.es` contract applies the validation logic (described above) deterministically to all included `ParticipationBox`es. The creator cannot instruct the contract to validate a score different from the one derived from `commitmentC` and the revealed `S`.
          * **Trust in the initial generation of `commitmentC`:** The player trusts that the `game-service` (provided by the creator) has correctly generated the initial `commitmentC` based on their `TRUE_SCORE` and the same secret `S` that the creator will use in the resolution. If the `game-service` were malicious and generated an incorrect `commitmentC` (e.g., using a different `S`, or linking it to a score not obtained), the player might not be able to validate their real score, or an incorrect score might be validated. This `commitmentC` generation phase is off-chain. On-chain protection is activated once `commitmentC` is in the `ParticipationBox`.
            This mechanism ensures that, given a `commitmentC` and a revealed `S`, score validation is objective and verifiable on-chain. The creator publishes the secret `S` to allow this verification and to be able to recover their `creatorStake` and commission.

  * **Public Validation of Resolution:**

      * All results of Action 1 (Resolution) are verifiable on-chain using the `game.es` contract script, the secret `S` revealed by the creator, and the public data in the participating `ParticipationBox`es.

  * **Winner Validation (Post-Resolution):**

      * For the MVP, the winner, once announced, is expected to share "in good faith" their complete solver-service (`<solver_id>.celaut.bee`), the log file of the winning game, their game seed (if applicable), and the indeterminism index (which is the estimated number of times tests must be run to obtain those logs) to allow community verification. As there is no formal judge system in the MVP (ideas about judges are explored in Section 10.2.2), the prize is delivered immediately after on-chain resolution.

  * **Isolated Solver Execution:**

      * The player cannot cheat the game-service by directly modifying their solver during the game, as it is the game-service that instantiates and executes the solver-service as a dependency within a Celaut environment.
        ```ascii
        +---------------------------------+
        | Player's Celaut Node          |
        |                                 |
        |  +----------------------------+ |
        |  | Game Service               | |
        |  | (<game_id>.celaut.bee)     | |
        |  |  - Game logic              | |
        |  |  - Instantiates and runs   | |
        |  |    Solver                  | |
        |  |  - Evaluates Solver        | |
        |  |                            | |
        |  |  +-----------------------+ | |
        |  |  | Solver Service        | | |
        |  |  | (isolated within the  | | |
        |  |  |  Celaut environment   | | |
        |  |  |  provided by the      | | |
        |  |  |  Game Service)        | | |
        |  |  | (<solver>.celaut.bee) | | |
        |  |  +-----------------------+ | |
        |  |                            | |
        |  +----------------------------+ |
        |                                 |
        +---------------------------------+
                      ^
                      |
        (The Game Service instantiates and
        manages the execution of the
        Solver Service in a Celaut-
        controlled environment)
        ```

      * Using the Celaut node terminal, the player can verify (according to the node's capabilities) that the game-service will not have network connections, increasing confidence that the execution environment is isolated for the game logic.

    > However, a player controlling a malicious Celaut node could theoretically attempt to interfere. More robust defense mechanisms for the game-service (such as obfuscating the real solver within additional container services) are considered for future versions.

  * **Incentives for Participation:**

      * Players pay their `participationFee` when creating and publishing their `ParticipationBox`. The incentive to publish a game lies in the possibility of winning, without knowing the exact scores of other participants due to the `commitmentC` and `scoreList` scheme. The `scoreList` provided by the game-service obfuscates the player's actual score among several options, with `commitmentC` linking the true score to the game's secret.

  * **Game Variability (CDE):**

      * It is assumed that players will verify that games have a high Scenario Dispersion Coefficient (CDE) by repeatedly testing the game. This is crucial for the game to be fair and not trivially solvable with pre-adjusted solutions. It's important that the player, upon finishing a game, can see, in addition to their score, the specific scenario played to be able to evaluate this CDE over time.

  * **Creator's Incentives for Resolution (MVP):**

      * The creator has the incentive to reveal the secret `S` after the `deadline` and correctly execute Action 1 (Resolution) to receive their `commissionPercentage` and recover their `creatorStake`. Failure to do so would mean losing these benefits and locking up the participation funds.

-----

## 6. Ergo Contract (Ergohack MVP Version)

The Game of Prompts system on Ergo is based on two main contracts: `game.es` which protects the `GameBox` (the main game box) and `participation.es` which protects the `ParticipationBox`es (the players' participation boxes). For the Ergohack MVP, the key stages and actions are:

  * **Game Creation (Deployment of `game.es` Contract):**
    An initial `GameBox` is created on the blockchain with the game data, including:

      * A unique `gameNftId` for the game (contained in `SELF.tokens(0)._1` of the `GameBox`).
      * `hashS` (Blake2b256 hash of the game's secret `S`) in register `R5`.
      * `numericalParameters` in `R7`, which is a collection containing:
          * `deadline` (block height limit for participation and resolution).
          * `creatorStake` (creator's ERG stake).
          * `participationFee` (ERG fee per participation).
      * `commissionPercentage` (commission percentage for the creator) in `R8`.
      * `gameCreatorPK` (bytes of the creator's public key) in `R4`.
      * `expectedParticipationScriptHash` (hash of the `participation.es` script) in `R6`.
      * `gameDetailsJsonHex` (game details in hexadecimal JSON format) in `R9`.
      * The `game.es` script governs the behavior of this `GameBox`.

  * **Participation Registration (Creation of `ParticipationBox` according to `participation.es`):**
    A player publishes a game by creating a `ParticipationBox` before the game's `deadline`. This action involves:

      * Paying the `participationFee`, which is stored as the value (`SELF.value`) of the `ParticipationBox`.
      * Storing in the `ParticipationBox`:
          * `playerPKBytes` (bytes of the player's public key) in `R4`.
          * `commitmentC` (cryptographic commitment with their true score, `solverId`, `hashLogs`, and `S_game`) in `R5`.
          * `gameNftId` (ID of the game NFT to which the participation belongs) in `R6`.
          * `solverId` (ID of the player's solver) in `R7`.
          * `hashLogs` (hash of the game logs) in `R8`.
          * `scoreList` (collection of scores, one of which is the true one) in `R9`.
      * This `ParticipationBox` becomes eligible to be processed in the game resolution if it meets the conditions of the `participation.es` contract, mainly being spent as part of a valid game resolution.

  * **Action 1: Game Resolution (`action1_isValidResolution` logic in `game.es` code)**
    Once the `deadline` is reached (`HEIGHT >= deadline`), the game creator can execute this action to spend the original `GameBox` and include valid `ParticipationBox`es as inputs (`INPUTS`) in the transaction. This action allows:

      * **Revealing the secret `S`**: The creator includes it in register `R4` of their own output box (`OUTPUTS(1).R4[Coll[Byte]].get`). The contract verifies that `blake2b256(revealedS_fromOutput) == hashS_in_self` (the original `hashS` from the `GameBox`).
      * **Validating each candidate `ParticipationBox` (`pBox`)**:
          * Must have the correct `gameNftId` in its `R6`.
          * Must have a value (`pBox.value`) greater than or equal to `participationFee`.
          * The hash of its protection script (`pBox.propositionBytes`) must match `expectedParticipationScriptHash` stored in the `GameBox`.
          * Must have all registers R4-R9 defined.
      * **Verifying the score of each valid `ParticipationBox`**:
          * For each `pBox`, the contract iterates over its `pBoxScoreList` (from `R9`).
          * For each `scoreAttempt` in the list, it calculates `testCommitment = blake2b256(pBoxSolverId ++ longToByteArray(scoreAttempt) ++ pBoxHashLogs ++ revealedS_fromOutput)`.
          * If `testCommitment == pBoxCommitment` (the `commitmentC` of the `pBox` in `R5`), then `scoreAttempt` is the `actualScoreForThisPBox`.
      * **Determining the winner**:
          * The `prizePool` is accumulated by summing the `pBox.value` of all validated `ParticipationBox`es with verified scores.
          * The player (`pBoxPlayerPK`) with the highest `actualScoreForThisPBox` is identified.
          * Ties favor the first `ParticipationBox` processed in the transaction that achieves the maximum score.
      * **Distributing the funds**:
          * If there is a winner, `creatorCommissionAmount = finalTotalPrizePool * commissionPercentage / 100` is calculated.
          * `finalWinnerPrize = finalTotalPrizePool - creatorCommissionAmount`.
          * **Winner's Output (`OUTPUTS(0)`):** Receives at least `finalWinnerPrize`, is protected by the winner's public key (`winnerPK`), and contains the `gameNftId`.
          * **Creator's Output (`OUTPUTS(1)`):** Receives at least `creatorCommissionAmount + creatorStake`, is protected by the creator's public key (`gameCreatorP2PKPropBytes`), and does not contain the `gameNftId`.

> ⚖️ For the MVP, the incentive structure focuses on the creator executing Action 1 (Resolution) to get their commission and `creatorStake`. Action 2 (Cancellation for Early Secret Revelation, variable `action2_isValidCancellation` in `game.es`), which introduces stronger disincentives against early secret revelation or game abandonment by the creator, is designed but commented out in the current code and is considered for future development (see Section 10.1.1).

More details on the specific implementation of the contracts can be found in [contracts/README.md](contracts/README.md).

-----

## 8. MVP Failure Points and Known Weaknesses

The following describes potential failure points, weaknesses, or areas that rely on trust in the MVP version of Game of Prompts:

  * **Insufficient Game Variability (Low Scenario Dispersion Coefficient - CDE):**

      * **Problem:** If a game-service always presents the same scenario or a very limited set of them (low CDE), a malicious creator could have a pre-calculated solver that obtains the maximum score, or the first players could solve it and the competition would quickly lose interest.
      * **Mitigation in MVP:** Relies on players' diligence to:
          * Evaluate the game description and the creator's reputation (if known).
          * After playing a game (before deciding to publish the result), the player receives information about the specific scenario played. If several players share this information or play multiple times (if the game allows it at no additional cost per attempt before publishing), the community can begin to infer the CDE.
          * The GoP Web platform could, in the future, display statistics or allow comments on the CDE of games.
      * **Impact:** A low CDE centralizes the advantage with the creator or early informed players.

  * **Potential Manipulation by the Game Creator due to Knowledge of Secret `S` and Control of the Game-Service:**

      * **Problem:** The game creator knows the secret `S` from the beginning and provides the `game-service`. Theoretically, they could design the `game-service` to:
          * Grant a favorable `commitmentC` (e.g., linked to an artificially high score from the `scoreList`) to a specific `solverId` (theirs or an accomplice's) under certain hidden conditions.
          * Generate `commitmentC` inconsistently for different players (e.g., using different `S` internally).
      * **Mitigation in MVP:**
          * Post-victory transparency: The winner (whether the creator or any other player) must share their solver and logs. If the community detects that the winning solver is trivial, exploits a non-obvious game feature, or the logs seem anomalous, it could be flagged as an unfair game.
          * The creator, if participating, must do so with a `solverId` and a `ParticipationBox` like any other player. Their `commitmentC` would be subject to the same on-chain validation.
          * The player receives the `commitmentC` from the `game-service` *before* the revelation of `S`. The `game.es` contract validates this `commitmentC` objectively once `S` is revealed. The main risk lies in trusting that the `game-service` honestly generated the `commitmentC` for the score obtained by the player with the `S` that will be universally revealed.
      * **Impact:** This is an attack vector that depends on the honesty of the `game-service`. In the MVP, detection relies on *post-hoc* community auditing and the creator's reputation.
      * **Proposed Solution (Future):** A judge system (see Section 10.2.2) would be necessary for more formal adjudication in suspicious cases.

  * **Selection (Censorship) of Participations by the Creator in the Resolution:**

      * **Problem:** In Action 1 (Game Resolution), it is the creator who builds the transaction. This gives them the ability to choose which `ParticipationBox`es to include as inputs. A malicious creator could omit (censor) `ParticipationBox`es from players with high scores (they know `S` and could verify `commitmentC`s off-chain before building the transaction) to favor another participation (possibly their own or an ally's) with a lower score. The on-chain script can only determine the winner among the participations presented to it.
      * **Mitigation in MVP:** There is no on-chain mechanism in the MVP to prevent this directly. It relies on:
          * The creator's reputation and honesty.
          * Possible public observation that known participations were not included (although this is difficult to coordinate without a centralized record of all candidate `ParticipationBox`es outside of exploring the chain itself).
      * **Impact:** This is a significant failure point in terms of fair play if the creator is malicious.
      * **Proposed Solution (Future):** See Section 10.1.2 for "Proof of Omitted Participation."

  * **Non-Sharing of Proofs by the Winner for Public Verification:**

      * **Problem:** In the MVP (as described in Section 5, "Winner Validation"), the winner is expected to share their solver-service, logs, scenario seed, etc., in good faith to allow community verification. However, since the prize is delivered immediately after on-chain resolution, a winner might decide not to share this information, preventing full validation of their victory and undermining trust in the fairness of the specific game.
      * **Mitigation in MVP:** Currently, this aspect relies on the winner's good faith and possible social pressure from the community. There is no on-chain mechanism in the MVP to force this sharing or withhold the prize.
      * **Impact:** Makes it difficult to detect subtle cheating or the use of non-obvious exploits that only analysis of the solver and detailed logs could reveal. This can create doubts about the legitimacy of some victories.
      * **Considerations for Future Solutions:**
          * One proposal is for the creator to verify the "availability" of this data (perhaps through a prior on-chain commitment by the player to reveal it) before including a participation in the resolution transaction. However, granting the creator this unilateral omission capability could exacerbate the censorship problem (mentioned in the previous point) and would need to be designed very carefully to be compatible with anti-censorship mechanisms.
          * More robust alternatives could include an escrow system for the prize, which is only released after sharing and validation of the source data (the `solverId` and `hashLogs` already present in the `ParticipationBox` would allow verification of the authenticity of the shared solver service and logs). For complete validation, especially if the scenario seed is crucial and not covered by `hashLogs`, including a commitment to the seed in the `ParticipationBox` could be considered in future contract versions. These ideas align with proposals for a "Judge System" or improvements to "Advanced Contract Mechanisms" (see Section 10).

-----

## 9. Game Examples

The Game of Prompts platform is versatile and can host a wide range of games. The following examples illustrate some types of challenges that can be implemented, spanning from classic entertainment to scientific, financial, and optimization applications:

  * **Classic Arcade Games (e.g., Snake, Pac-Man):**

      * **Concept:** The solver-service controls the main character (the snake, Pac-Man, etc.) in a classic game environment. The game-service manages the game logic, obstacles, enemies, and consumables, presenting a challenge of skill and reflexes for the solver.
      * **Scoring:** Directly based on the score obtained in the game: length reached by the snake, points accumulated by eating pills and ghosts, number of levels completed, or survival time.

    > Example implementation of the Snake game [here](games/snake/README.md)

  * **Open World and Discovery Games (e.g., Minecraft running in a service):**

      * **Concept:** Imagine a game-service that encapsulates a voxel-based open-world environment, similar to Minecraft, where the game engine itself or a faithful simulation runs as part of the service. The solver-service, conceived as an autonomous agent (inspired by projects like [Nvidia's Voyager](https://voyager.minedojo.org/), which demonstrates AI learning and operating in Minecraft), interacts directly with this persistent world. Its goals can be to undertake complex tasks such as efficient collection of specific resources, autonomous creation of advanced tools, construction of buildings following certain plans or constraints, or systematic exploration and mapping of unknown territories. The game-service not only hosts the interactive environment but also defines the physics, interaction rules, crafting recipes, and criteria for validating the fulfillment of assigned objectives.
      * **Scoring:** Could be multifactorial, evaluating efficiency in resource collection (e.g., quantity per unit of time), complexity and utility of crafted objects, degree of completion of specific missions (e.g., building a structure with certain materials), extent of the map explored, or novelty and adaptability of strategies employed by the solver. Or it can be focused on measuring a specific skill in each game; this shows us how useful it can be to recycle the same game-service to create different games on the platform, where each can have different scoring systems.

  * **Financial Market Trading Simulation Games:**

      * **Concept:** The game-service simulates a dynamic financial market (stocks, cryptocurrencies, commodities, forex, etc.) using historical data or generative models that can include random or predefined market events (black swans, economic announcements). The solver-service acts as a trading bot that must make investment decisions (buy, sell, hold positions, use simple derivatives) to maximize the return on an initial portfolio.
      * **Scoring:** Based on the solver's financial performance metrics, such as absolute or percentage net profit, Sharpe ratio (risk-adjusted return), maximum drawdown, consistency of profits, or profitability compared to a market benchmark of the simulated market. These types of games have obvious applications in the research and development of algorithmic investment strategies.

    > Example implementation [here](games/trading/README.md)

    > **The application of this methodology to smart contract systems** is particularly promising. Consider, for example, a service-game that emulates the operation of SigmaUSD contracts, in which solvers compete to maximize their profits by interacting with them. This approach not only validates the strategy but also drives the creation of a rich and diverse ecosystem of bots for current and future applications on Ergo and other blockchains.

  * **Protein Folding Games:**

      * **Concept:** The game-service provides an amino acid sequence, representing the primary structure of a protein. The challenge for the solver-service is to predict the most stable and functionally viable three-dimensional conformation (tertiary structure) of said protein. This is a fundamental and complex problem in computational biology and bioinformatics.
      * **Scoring:** Based on established biophysical metrics: the calculated free energy of the folded conformation proposed by the solver (where lower scores generally indicate greater stability), structural similarity (e.g., RMSD - Root Mean Square Deviation) with experimentally resolved structures (if they exist and are used as a hidden reference by the game-service), or evaluation using domain-specific scoring functions that assess aspects like the correct formation of hydrogen bonds or the exposure of hydrophobic residues. This type of game delves into direct applications of scientific research, such as the design of new drugs and the understanding of molecular mechanisms of diseases.

    > The ability to create trustless competitions allows students or researchers from anywhere in the world to participate.

  * **Strategy and Resource Management Games:**

      * **Concept:** The game-service presents a scenario where the solver-service must efficiently manage limited resources (e.g., minerals, energy, population, time) to build a base, develop technologies, train units, or achieve a specific strategic objective, possibly competing against an internal game AI or against the clock.
      * **Scoring:** Could be based on the speed to achieve the objective, the amount of resources accumulated at the end of the game, efficiency in resource use (e.g., production/cost ratio), the robustness of the economy or infrastructure created, or a combined score reflecting strategic dominance.

  * **Code Optimization Challenges (Code Golfing/Efficiency):**

      * **Concept:** The game-service presents a well-defined computational problem (e.g., sorting a list, finding the shortest path in a small graph, solving an equation) and a set of test data. The solver-service must generate and provide a code snippet (or a sequence of instructions in a specific language or pseudo-language defined by the game) that correctly solves the problem.
      * **Scoring:** Could prioritize the correctness of the solution, the execution efficiency of the solver's code (measured in time or CPU cycles within an environment controlled by the game-service), and/or its conciseness (e.g., number of lines of code, solver size in bytes, number of operations).

  * **Natural Language Interaction and Understanding Games:**

      * **Concept:** The game-service presents the solver with scenarios, questions, or instructions formulated in natural language (with a restricted vocabulary and grammar to facilitate evaluation). The solver-service must interpret the text and respond coherently, perform a specific action based on the instruction, or extract requested information.
      * **Scoring:** Based on the accuracy of the response (e.g., matching expected answers or patterns), success in completing the described task (verifiable by the game state), relevance of the extracted information, or compliance with output format constraints.

These are just a few examples, and **game creators have the freedom to innovate and propose new types of challenges**, as long as the score can be quantifiable to maintain fairness and competitive interest.

-----

## 10. Additional Considerations, Features Not Implemented in MVP, and Future Ideas

This section groups elements that, although part of the complete vision of Game of Prompts, were not implemented in the MVP version presented at Ergohack, along with ideas for the platform's evolution.

### 10.1. Proposed Improvements to MVP Model Fairness and Security

These are improvements focused on strengthening the robustness and fairness of the main gameplay flow.

  * **10.1.1. Action 2 of the `game.es` Contract: Cancellation for Early Secret Revelation**

      * This action (variable `action2_isValidCancellation` in the `game.es` code, currently commented out) is designed to be activated if the secret `S` is revealed *before* the `deadline`.
      * It would allow any party (not just a player) who detects the revelation of `S` (for example, in an input box of the cancellation transaction) to initiate the cancellation. Participating players could then claim their `participationFee` and, potentially, a portion of the `creatorStake` as a penalty to the creator (according to the detailed design in `contracts/game.es` for this action).
      * The creator would recover the remaining `creatorStake` (if any after distribution to players) and the `gameNftId`.
      * **Related Incentives:** This action strongly disincentivizes the creator from revealing `S` prematurely or abandoning the game, as they would lose part or all of their `creatorStake`.

  * **10.1.2. Proof of Omitted Participation (to counteract Creator Censorship)**

      * **Problem (Reiteration of point 8):** In Action 1 (Resolution), the creator chooses which `ParticipationBox`es to include as inputs, potentially omitting participations with high scores.
      * **Possible Future Improvement:** Implement a post-resolution mechanism ("Proof of Omitted Participation") where, after the revelation of `S`, a brief dispute period opens to present valid `ParticipationBox`es (created before the `deadline` and with the correct `gameNftId`) not included by the creator in the resolution transaction. If one of these omitted `ParticipationBox`es had a score (verifiable on-chain with the now public `S`) that would change the game's outcome (i.e., be higher than the declared winner's), a penalty could be activated on the `creatorStake`. Whoever demonstrates the omission and the higher score could receive a reward from this `creatorStake`. This system could be verified on-chain without needing judges once `S` is public.

  * **10.1.3. Advanced Solver Obfuscation (against malicious Celaut nodes)**

      * To prevent a malicious Celaut node controlled by the player from deceiving the game-service (beyond network isolation checks), the game-service could implement techniques like generating N instances of possible solvers and obfuscating the real solver by encapsulating it within another service to modify its hash before launching it.

  * **10.1.4. Creator Reputation Proof**

      * Using an on-chain reputation system for game creators could help players choose games from trustworthy designers with a good track record of CDE and fair resolutions. For example, systems like those proposed at [https://github.com/reputation-systems](https://github.com/reputation-systems), which Celaut itself already uses, could be explored.

  * **10.1.5. Definition and Verification of Execution Requirements for Solvers**

      * **Concept:** Allow game creators to specify restrictions on Solver Services that can participate. These restrictions could include computational resource limits (CPU, RAM, execution time per move), specific hardware/software architectures, or a list of allowed or prohibited APIs/dependencies.
      * **Mechanism:** Celaut, as an execution platform, allows the Game Service to verify the architecture, resources, etc., of the Solver Service it is about to execute simply by reading its service specification (in this case, the .celaut.bee file).
      * **Benefit:**
          * **Fairness:** Ensures all participants compete under similar conditions, preventing a player from gaining an advantage simply by using massively superior hardware or software not anticipated by the game design.
          * **Game Design:** Enables games where resource efficiency is part of the challenge or scoring criteria.
      * **Consequence:** If a Solver Service does not meet these predefined requirements, its participation could be automatically invalidated by the Game Service and it will not generate `commitmentC`.

### 10.2. New Features and Game Mechanics

These ideas aim to enrich the gaming experience and platform capabilities.

  * **10.2.1. Advanced Game Types: Subjective Games**

      * Evaluating games based on storytelling, creativity, style, or humor would likely require the use of LLMs within the game-service for scoring. This would add complexity in validating results and would probably require a judge system for disputed cases.

  * **10.2.2. Judge System**

      * To resolve disputes (e.g., about the validity of a game in a subjective game, or in case of suspected cheating by the creator or a player that cannot be algorithmically resolved on-chain), a judge system could be implemented.
      * Judges could have the ability to review logs, solver behavior, and the game-service in a specific scenario to make binding decisions. This system could have on-chain components (staking for judges, dispute contracts) and off-chain components (deliberation). This system would be particularly relevant for "Winner Validation (Post-Resolution)" in cases where good faith is not sufficient.

  * **10.2.3. Poker Incentive**

      * To add a strategic layer to participation, players could be allowed to choose their own participation fee (above a minimum set by the creator). A higher fee could weigh their score (e.g., `finalScore = baseScore * (paidFee / minimumFee)`) or give them access to a larger portion of the prize if they win. This introduces risk/reward dynamics similar to poker.

  * **10.2.4. Accept Other Tokens for Participation and Prizes**

      * Allowing participation fees to be paid and prizes to be distributed in other native Ergo tokens, in addition to ERG, could increase the platform's flexibility and appeal to different communities.

### 10.3. Platform Expansion and New Competition Formats

These are ideas for expanding the scope and variety of competitions on GoP.

  * **10.3.1. Direct Interaction and Pay-Per-Attempt Models in Isolated Services**

    The ability of Celaut services to operate in an isolated environment and, crucially, to verify Ergo blockchain transactions (or reliably receive payment proofs) directly within the game-service, would open up new and significant possibilities for Game of Prompts:

      * **Pay-Per-Attempt:**

          * **Concept:** Would allow game creators to design game-services that charge a small fee for each attempt or interaction a player makes.
          * **Benefit:** This model is especially useful for games susceptible to brute-force attacks (e.g., puzzles with a large but finite solution space, riddles where multiple answers can be tried). By associating a cost with each attempt, solution spam is disincentivized, and it ensures that only seriously considered attempts compete. The game-service would manage the logic of these attempts and could, for example, reveal the main game secret (to claim the `GameBox`) to the first player who submits a successful and paid attempt.
          * **Technical Requirement:** Depends on the isolated Celaut service's ability to reliably verify payments on Ergo.

      * **Direct Interaction with the Game (without needing a solver-service):**

          * **Concept:** Based on the same capability of isolated services to manage logic and payments, players could interact directly with the game-service without needing to develop, package, and register a complete `solver-service`. This could be through a simple user interface that sends prompts/commands, or via lightweight scripts.
          * **Change in Dynamics:**
              * **Not mandatory to "submit a game" (Solver):** Competition would not focus on evaluating an autonomous solver, but on direct interaction. Showing a "solver" (if any tool or script was used to interact) could be optional. To incentivize transparency and community learning in certain contexts, not sharing the method or "lightweight solver" could incur a penalty in the final score, if the game defines it so.
              * **New Game Types:** Enables games like "first to guess wins," useful for riddles (perhaps interacting with an LLM within the game-service), real-time puzzle solving, etc.
          * **Broadening the User Base:** By reducing or eliminating the barrier of having to program a complete Celaut service as a solver, the platform would open up to a much larger number of users, including those who are not programmers but are good strategists or problem solvers.
          * **Secret Management:** Similar to pay-per-attempt, the game-service could self-manage the revelation of the main game's secret `S` if the victory condition is objective and verifiable by the service itself. For games of a more subjective nature using this direct interaction mode, a "Judge System" (described in Section 10.2.2) would still be relevant for final validation.

    These capabilities would transform Game of Prompts from a purely "bot-vs-bot" platform to a more diverse ecosystem for competition and problem-solving.

  * **10.3.2. Multi-Chain Expansion via Satellite Contracts and Rosen Bridge**
    To extend participation in Game of Prompts to users and communities on other blockchains (especially account-based chains), a "satellite contract" model is contemplated.

      * **Satellite Contract Concept:** For each game created with the `game.es` script on Ergo, "satellite" contracts could be instantiated on other compatible chains. Each satellite contract would mirror the essential game parameters, such as:
          * The participation cost (denominated in a currency of the satellite chain).
          * A `deadline` for participation on that specific chain (which could be the same as or earlier than the `deadline` on Ergo to allow time for synchronization).
          * The Rosen Bridge address (or similar system) for transferring funds and data to Ergo.
      * **Participation Flow on Satellite Chain:**
        1.  Players on the external chain would interact with the satellite contract to register their participation, paying the fee in the local currency. Their participation details (similar to `commitmentC`, `solverId`, etc., adapted if necessary) would be stored or referenced in this satellite contract.
        2.  The satellite contract would accumulate participation fees.
      * **Resolution and Synchronization with Ergo (Modified GameBox Action 1):**
        1.  Once the `deadline` on the satellite chain is reached (or just before the main `deadline` on Ergo), a function in the satellite contract would be activated. This function's sole purpose would be to securely transfer all accumulated funds and participation data (possibly `commitmentC`s and `playerPKs`) via Rosen Bridge to a designated box on Ergo. This "satellite aggregation box" on Ergo would be controlled by or readable by the main `gameBox` contract. It is crucial that Rosen Bridge allows the reliable transfer of this data (registers or structured data); for this, **we must be able to perform P2HS transfers instead of P2PK**.
        2.  The **Action 1** transaction (Game Resolution) in the main `gameBox` on Ergo would be modified from the current version. In addition to `INPUTS` from native Ergo `ParticipationBox`es, it would now also take these "satellite aggregation boxes" (one for each supported external chain) as inputs.
        3.  The `gameBox` script would process participations from all chains (both native Ergo and those from satellites via Rosen Bridge) to determine the global winner. The `commitmentC` validation logic with the secret `S` (revealed in `OUTPUTS(1).R4` of the `gameBox`) would apply universally.
        4.  Prize distribution would occur on Ergo. If winners are from external chains, they could claim their prizes in ERG, or Rosen Bridge could facilitate the transfer of value back to the winner's origin chain.
        5.  Rosen Bridge fees would be distributed as an aggregate in the participation fee cost for participants from the satellite for the way in, and, if applicable, from the winner for the way out.
      * **Security and Restrictions:**
          * The satellite contract on the external chain would be designed to be very simple: collect participations and funds, and only allow them to be spent (after the satellite's `deadline`) to a specific Rosen Bridge address destined for the predefined aggregation box on Ergo.
          * The aggregation box on Ergo, in turn, could only be spent as an input in Action 1 of the original `gameBox`.

    > This approach would allow Game of Prompts to become a truly interoperable competition platform, leveraging Ergo's security and capabilities for core game logic and settlement, while expanding its reach to a broader blockchain ecosystem.