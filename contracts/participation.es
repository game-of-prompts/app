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
  // gameDeadline is no longer in SELF.R9. It must be obtained from the GameBox (INPUTS(0).R7(0)) during spending.

  // === Action 1: Spent as part of a Valid Game Resolution (Action 3 of GameBox) ===
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

        // Markers of a GameBox Action 3:
        // - At least 1 INPUT (the GameBox itself, SELF is another input).
        // - At least 2 OUTPUTS (Winner, Creator)
        // - OUTPUT(1) (creator's output) has R4 defined (where S is revealed).
        val c2_txStructureLooksLikeResolution = INPUTS.size >= 1 && // SELF is an input, GameBox is another.
                                                OUTPUTS.size >= 2 &&
                                                OUTPUTS(1).R4[Coll[Byte]].isDefined

        c1_isAfterDeadline && c2_txStructureLooksLikeResolution
    } else {
        false
    }
  }

  // === Action 2: Spent in Valid Game Cancellation (Action 4 of GameBox) (FULL DESIGN - COMMENTED OUT) ===
  /* // Uncomment and develop when Action 4 in game.es is active.
  val spentInValidGameCancellation = sigmaProp({
    val gameBoxCandidate = INPUTS(0) // Assume GameBox is INPUTS(0)
    // Similar to spentInValidGameResolution, but check HEIGHT < gameDeadlineFromGameBox
    // and markers of Action 4 (e.g., INPUTS(1) revealing S if Action 4 is designed that way).
    // Action 4 in game.es also needs to be refactored to avoid 'var' if it causes issues.
    // For now, a placeholder.
    false
  })
  */

  // === Action 3: Player reclaims their funds after a grace period (FULL DESIGN - COMMENTED OUT) ===
  /* // Uncomment and develop. This condition is independent of INPUTS(0) if it's a direct claim.
  val N_GRACE_PERIOD_BLOCKS = 1000L
  val playerReclaimsAfterGracePeriod = sigmaProp({
    // To get gameDeadline, this claim transaction would need the GameBox as a DataInput
    // or assume a deadline if the original GameBox cannot be accessed.
    // If it's assumed that the GameBox is in CONTEXT.dataInputs(0) for this specific action:
    // val gameBoxInData = CONTEXT.dataInputs(0)
    // val originalGameDeadline = gameBoxInData.R7[Coll[Long]].get(0)
    // val isAfterGrace = HEIGHT >= originalGameDeadline + N_GRACE_PERIOD_BLOCKS
    // isAfterGrace && PK(playerPKBytes) // WARNING: PK(playerPKBytes) will fail with the current compiler
    false // Placeholder
  })
  */

  // For now, only spending under Action 1 (Game Resolution) is allowed
  sigmaProp(spentInValidGameResolution)
  // When the others are ready:
  // sigmaProp(spentInValidGameResolution || spentInValidGameCancellation || playerReclaimsAfterGracePeriod)
}