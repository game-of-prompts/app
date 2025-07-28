{
  // === Register Definitions (ParticipationBox) ===
  // R4: Coll[Byte] - playerPKBytes: Raw bytes of the player's PK.
  // R5: Coll[Byte] - commitmentC: Cryptographic commitment with the true score.
  //                   Format: blake2b256(solverId_R7 ++ longToByteArray(TRUE_SCORE_FROM_R9) ++ hashLogs_R8 ++ S_game)
  // R6: Coll[Byte] - gameNftId: ID of the GameBox's NFT to which this participation belongs.
  // R7: Coll[Byte] - solverId: Player's solver ID (UTF-8 bytes).
  // R8: Coll[Byte] - hashLogs: Hash of the game logs (bytes).
  // R9: Coll[Long] - scoreList: Collection of scores (Long), one of which is the true one.
  // SELF.value:      Long    - participationFee: Fee paid by the player.

  // === Value Extraction from SELF ===
  val playerPKBytes = SELF.R4[Coll[Byte]].get
  val gameNftIdInSelf = SELF.R6[Coll[Byte]].get

  // === Helper for P2PK Addresses ===
  val P2PK_ERGOTREE_PREFIX = fromBase16("0008cd")

  // === Action 1: Spent as part of a Valid Game Resolution (Action 1 of GameBox) ===
  val spentInValidGameResolution = {
    val gameBoxCandidate = INPUTS(0) // Assume GameBox is INPUTS(0) in the resolution tx

    val gameBoxIsPlausible = gameBoxCandidate.tokens.size > 0 &&
                             gameBoxCandidate.tokens(0)._1 == gameNftIdInSelf &&
                             gameBoxCandidate.R4[Coll[Byte]].isDefined && // creatorPK
                             gameBoxCandidate.R5[Coll[Byte]].isDefined && // hashS
                             gameBoxCandidate.R7[Coll[Long]].isDefined &&
                             gameBoxCandidate.R7[Coll[Long]].get.size == 3 // numericalParams

    if (gameBoxIsPlausible) {
        val gameDeadlineFromGameBox = gameBoxCandidate.R7[Coll[Long]].get(0)
        val c1_isAfterDeadline = HEIGHT >= gameDeadlineFromGameBox
        val c2_txStructureLooksLikeResolution = INPUTS.size >= 1 &&
                                                OUTPUTS.size >= 2 &&
                                                OUTPUTS(1).R4[Coll[Byte]].isDefined
        c1_isAfterDeadline && c2_txStructureLooksLikeResolution
    } else {
        false
    }
  }

  // === Action 2: Spent in Valid Game Cancellation (UPDATED LOGIC) ===
  val spentInValidGameCancellation = {
    // This action allows a player to get a refund if the game's secret 'S' is revealed
    // before the deadline.
    // 1. The GameBox must be provided as a dataInput to verify its parameters.
    // 2. An input must reveal the secret 'S'.
    // 3. The transaction must refund the fee to the player (address in R4).
    if (CONTEXT.dataInputs.size > 0 && INPUTS.size > 0) {
      val gameBoxInData = CONTEXT.dataInputs(0)
      val revealerBox = INPUTS(0) // Assume the box revealing S is the first input

      // Verify that the dataInput is the correct GameBox for this participation
      val gameBoxIsPlausible = gameBoxInData.tokens.size > 0 &&
                               gameBoxInData.tokens(0)._1 == gameNftIdInSelf &&
                               gameBoxInData.R5[Coll[Byte]].isDefined && // hashS
                               gameBoxInData.R7[Coll[Long]].get.size == 3   // numericalParams

      if (gameBoxIsPlausible) {
        val gameDeadline = gameBoxInData.R7[Coll[Long]].get(0)
        val hashS_fromGameBox = gameBoxInData.R5[Coll[Byte]].get

        // Condition 1: Must happen before the deadline
        val isBeforeDeadline = HEIGHT < gameDeadline

        // Condition 2: The secret 'S' must be correctly revealed in an input
        val sIsRevealedCorrectly = if (revealerBox.R4[Coll[Byte]].isDefined) {
          val revealedS = revealerBox.R4[Coll[Byte]].get
          blake2b256(revealedS) == hashS_fromGameBox
        } else {
          false
        }

        // Condition 3: The player must get their funds back.
        // The transaction must have an output that pays at least SELF.value
        // to the player's PK (from R4).
        val playerGetsRefund = OUTPUTS.exists { (outBox: Box) =>
          val playerP2PKAddress = P2PK_ERGOTREE_PREFIX ++ playerPKBytes
          outBox.propositionBytes == playerP2PKAddress && outBox.value >= SELF.value
        }
        
        isBeforeDeadline && sIsRevealedCorrectly && playerGetsRefund
      } else {
        false // The provided dataInput is not the correct GameBox
      }
    } else {
      false // Not enough inputs or dataInputs for this action
    }
  }

  // === Action 3: Player reclaims their funds after a grace period (COMMENTED OUT) ===
  val playerReclaimsAfterGracePeriod = false // Placeholder

  // Allow spending if it's a valid resolution OR a valid cancellation.
  sigmaProp(spentInValidGameResolution || spentInValidGameCancellation)
}