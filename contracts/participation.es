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
                             gameBoxCandidate.R5[(Long, Coll[Byte])].isDefined && // hashS
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

  // === Action 2: Spent in Valid Game Cancellation ===
  val spentInValidGameCancellation = {
    // This action allows a player to get a refund if the game's secret 'S' 
    // is revealed on-chain in the GameBox before the deadline.
    // The GameBox MUST be provided as the first dataInput.
    
    if (CONTEXT.dataInputs.size > 0) {
      val gameBoxInData = CONTEXT.dataInputs(0)

      // Verify that the dataInput is the correct GameBox for this participation
      val gameBoxIsPlausible = gameBoxInData.tokens.size > 0 &&
                               gameBoxInData.tokens(0)._1 == gameNftIdInSelf &&
                               // Check that R5 has the expected (Long, Coll[Byte]) structure
                               gameBoxInData.R5[(Long, Coll[Byte])].isDefined && 
                               gameBoxInData.R7[Coll[Long]].get.size == 3

      if (gameBoxIsPlausible) {
        val gameDeadline = gameBoxInData.R7[Coll[Long]].get(0)
        val stateTuple_R5 = gameBoxInData.R5[(Long, Coll[Byte])].get

        // Condition 1: The secret 'S' must be revealed within the GameBox itself.
        // This is true if the unlockHeight (the first element of the R5 tuple) is > 0.
        // The GameBox contract itself ensures the revealed S was valid, so we can trust its state.
        val secretIsRevealedInGameBox = stateTuple_R5._1 > 0L

        // Condition 2: The player must get their funds back.
        val playerGetsRefund = OUTPUTS.exists { (outBox: Box) =>
          val playerP2PKAddress = P2PK_ERGOTREE_PREFIX ++ playerPKBytes
          outBox.propositionBytes == playerP2PKAddress && outBox.value >= SELF.value
        }
        
        secretIsRevealedInGameBox && playerGetsRefund
      } else {
        false // The provided dataInput is not the correct GameBox
      }
    } else {
      false // A dataInput for the GameBox is required
    }
  }

  // === Action 3: Player reclaims their funds after a grace period (COMMENTED OUT) ===
  val playerReclaimsAfterGracePeriod = false // Placeholder

  // Allow spending if it's a valid resolution OR a valid cancellation.
  sigmaProp(spentInValidGameResolution || spentInValidGameCancellation)
}