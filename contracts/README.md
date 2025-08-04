# **Game of Prompts \- Ergo Smart Contracts**

This document describes the ErgoScript smart contracts for the Game of Prompts (GoP) platform. It covers the updated game.es (governing the GameBox) and participation.es (governing player ParticipationBoxes). This new version introduces a more robust state management system for the GameBox, enabling game cancellation and creator stake penalties.

## **1\. The GameBox State Model**

The behavior of the GameBox is determined by a combination of its on-chain state and the current block height relative to the game's deadline. This creates four primary states, each with a distinct set of allowed actions.

* **Internal State Indicator:** R5 of the GameBox stores a tuple (Long, Coll\[Byte\]).  
  * R5.\_1 \== 0L: The game is **Active**. The secret S has not been revealed.  
  * R5.\_1 \> 0L: The game is **Canceled**. The secret S has been revealed on-chain. R5.\_1 holds the unlockHeight for the next penalty withdrawal.  
* **Time Indicator:** The current block height (HEIGHT) relative to numericalParameters(0) (deadline).

### **GameBox State Matrix**

|  | Before deadline (HEIGHT \< deadline) | After deadline (HEIGHT \>= deadline) |
| :---- | :---- | :---- |
| **State 1: Active**\<br\>(R5.\_1 \== 0L) | **1A: Normal Operation**\<br\>- Players can create ParticipationBoxes.\<br\>- **GameBox Action:** Can be spent via action2\_isValidCancellation to transition to State 2A (Cancel Game). | **1B: Resolution Period**\<br\>- No new participations.\<br\>- **GameBox Action:** Can be spent via action1\_isValidResolution to resolve the game and pay the winner. |
| **State 2: Canceled**\<br\>(R5.\_1 \> 0L) | **2A: Canceled & Draining**\<br\>- **GameBox Action:** Can be spent via action2\_isValidCancellation to continue draining the creatorStake (if HEIGHT \>= unlockHeight).\<br\>- **ParticipationBox Action:** Players can spend their box via spentInValidGameCancellation to get a refund. | **2B: Canceled & Finalized**\<br\>- **GameBox Action:** No further actions possible. The action2 path is blocked by the deadline. The remaining creatorStake is locked.\<br\>- **ParticipationBox Action:** Players can still spend their box via spentInValidGameCancellation to get a refund. |

## **2\. game.es \- The Game Box Contract**

This contract governs the main game box, holding the prize pool, creator's stake, and the logic for all state transitions.

### **2.1. Purpose**

* To represent a unique game on the blockchain.  
* To manage the game's state (Active vs. Canceled) and enforce time-based rules (deadline).  
* To handle the standard game resolution logic to determine a winner.  
* To implement a penalty mechanism for early secret revelation, allowing the creator's stake to be progressively drained.

### **2.2. Box Structure (GameBox)**

* **R4: Coll\[Byte\] \- gameCreatorPK:** The game creator's public key.  
* **R5: (Long, Coll\[Byte\]) \- StateTuple:** The core state register.  
  * If StateTuple.\_1 \== 0 (Active): StateTuple.\_2 holds hashS, the hash of the game's secret.  
  * If StateTuple.\_1 \> 0 (Canceled): StateTuple.\_2 holds the revealed secret S, and StateTuple.\_1 is the unlockHeight for the next stake withdrawal.  
* **R6: Coll\[Byte\] \- {TODO}
* **R7: Coll\[Long\] \- numericalParameters:** A collection \[deadline, creatorStake, participationFee\]. The creatorStake value is reduced if the game is canceled.  
* **R8: Int \- commissionPercentage:** The creator's commission percentage.  
* **R9: Coll\[Byte\] \- gameDetailsJsonHex:** Game details in JSON/Hex format.  
* **tokens(0):** The unique gameNftId.

### **2.3. Spending Logic (Actions)**

#### **Action 1: Game Resolution (action1\_isValidResolution)**

This is the standard action to finalize the game.

* **Conditions:**  
  * Must be executed **after** the deadline.  
  * The GameBox must be in the **Active** state (unlockHeight\_in\_self \== 0L).  
* **Process:**  
  1. **Secret Revelation:** The creator reveals S in their output box. The script verifies that blake2b256(S) matches the stored hashS.  
  2. **Participation Processing:** The script iterates through valid ParticipationBox inputs, validates them, and calculates their true score by checking their commitmentC against the revealed S.  
  3. **Winner Determination:** The participant with the highest valid score is identified.  
  4. **Output Validation:**  
     * **Winner's Output (OUTPUTS(0)):** Receives the prize pool (less commission) and the gameNftId.  
     * **Creator's Output (OUTPUTS(1)):** Receives the original creatorStake plus the commission.

#### **Action 2: Game Cancellation & Stake Draining (action2\_isValidCancellation)**

This action penalizes the creator for revealing the secret S prematurely.

* **Condition:** Must be executed **before** the deadline.  
* **Phase A: Initial Cancellation (State Transition)**  
  * **Trigger:** Executed when the GameBox is in the **Active** state (unlockHeight\_in\_self \== 0L).  
  * **Logic:**  
    1. Anyone can initiate a transaction that spends the GameBox.  
    2. The transaction **re-creates the GameBox** (OUTPUTS(0)) but transitions it to the **Canceled** state:  
       * The secret S is revealed and stored in the new R5.  
       * An unlockHeight is set for the next withdrawal (HEIGHT \+ COOLDOWN\_IN\_BLOCKS).  
       * The creatorStake in R7 is reduced by a fixed portion.  
    3. A second output (claimerOutput) is given to the transaction initiator, containing the portion of the stake that was removed.  
* **Phase B: Subsequent Withdrawals (Draining)**  
  * **Trigger:** Executed when the GameBox is in the **Canceled** state (unlockHeight\_in\_self \> 0L) and the cooldown period has passed (HEIGHT \>= unlockHeight\_in\_self).  
  * **Logic:** Similar to Phase A. The transaction re-creates the GameBox with an even smaller creatorStake and resets the unlockHeight for a new cooldown period, allowing the stake to be drained over time.

## **3\. participation.es \- The Participation Box Contract**

This contract protects the box each player creates to enter a game.

### **3.1. Purpose**

* To represent a player's entry into a game.  
* To hold the player's commitmentC (commitment to their true score).  
* To define the conditions under which the player's funds can be spent.

### **3.2. Box Structure (ParticipationBox)**

* **R4: Coll\[Byte\] \- playerPKBytes:** The player's public key.  
* **R5: Coll\[Byte\] \- commitmentC:** The cryptographic commitment to the true score.  
* **R6: Coll\[Byte\] \- gameNftId:** The NFT ID of the game being played.  
* **R7: Coll\[Byte\] \- solverId:** The player's solver ID.  
* **R8: Coll\[Byte\] \- hashLogs:** A hash of the player's game logs.  
* **R9: Coll\[Long\] \- scoreList:** A list of scores, one of which is genuine.

### **3.3. Spending Conditions**

#### **Condition 1: Spent in a Valid Game Resolution (spentInValidGameResolution)**

* **Status:** Active.  
* **Logic:** Allows the box to be spent as an input to a valid **Game Resolution** transaction (Action 1 of game.es). This is the normal path for a game that finishes correctly.

#### **Condition 2: Spent in a Valid Game Cancellation (spentInValidGameCancellation)**

* **Status:** Active.  
* **Logic:** Allows a player to **reclaim their participationFee** if the game has been canceled.  
* **Verification:**  
  1. The transaction must include the corresponding GameBox as a dataInput.  
  2. The script verifies that the GameBox in the dataInput is in the **Canceled** state (i.e., gameBoxInData.R5.\_1 \> 0L).  
  3. The script ensures that one of the transaction's outputs returns the participationFee to the player's address.

## **4\. Interaction Flow Summary**

1. **Game Creation:** The creator deploys game.es, creating a GameBox in the **Active** state (State 1A).  
2. **Player Participation:** Before the deadline, players create ParticipationBoxes.  
3. **Outcome Scenarios:**  
   * **Scenario A: Normal Game Resolution**  
     1. The deadline passes. The game remains in the **Active** state (now State 1B).  
     2. The creator initiates **Action 1**, spending the GameBox and all valid ParticipationBoxes.  
     3. game.es validates scores and distributes the prize pool, commission, and stake.  
   * **Scenario B: Game Cancellation**  
     1. **Before** the deadline, someone initiates **Action 2** on the GameBox.  
     2. The GameBox transitions to the **Canceled** state (State 2A), revealing S and losing a portion of its stake.  
     3. Players can now use **Condition 2** (spentInValidGameCancellation) on their ParticipationBox to get a full refund at any time (both before and after the deadline, in states 2A and 2B).  
     4. Meanwhile, the remaining creatorStake in the GameBox can be further drained via **Action 2** as long as it is still before the deadline.