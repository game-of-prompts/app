{
  // === Constants ===
  val STAKE_DENOMINATOR = 5L
  val COOLDOWN_IN_BLOCKS = 3000L

  // === Register Definitions (GameBox) ===
  // R4: Coll[Byte] - gameCreatorPK: Raw bytes of the game creator's public key.
  // R5: (Long, Coll[Byte]) - StateTuple: (unlockHeight, secretOrHash)
  //     - If unlockHeight == 0, secretOrHash is hashS.
  //     - If unlockHeight > 0, secretOrHash is the revealed S, and unlockHeight is the next claim block.
  // R6: Coll[Byte] - expectedParticipationScriptHash: Blake2b256 hash of the expected ErgoTree script for ParticipationBoxes.
  // R7: Coll[Long] - numericalParameters: Collection [deadline, creatorStake, participationFee]
  //                   - numericalParameters(0) (deadline): Block height limit for participation/resolution.
  //                   - numericalParameters(1) (creatorStake): Creator's ERG stake.
  //                   - numericalParameters(2) (participationFee): ERG participation fee.
  // R8: Int        - commissionPercentage: Commission percentage for the creator (e.g., 5 for 5%).
  // R9: Coll[Byte] - gameDetailsJsonHex: JSON String (UTF-8 -> Hex) with game details (title, description, etc.).

  // === Tokens (GameBox) ===
  // SELF.tokens(0): (gameNftId: Coll[Byte], amount: Long) - Unique game NFT, amount 1L.

  // === Value Extraction ===

  val gameCreatorPK = SELF.R4[Coll[Byte]].get

  val stateTuple_R5 = SELF.R5[(Long, Coll[Byte])].get
  val unlockHeight_in_self = stateTuple_R5._1 // unlockHeight is now the first element
  val secretOrHash_in_self = stateTuple_R5._2 // secretOrHash is now the second element

  val hashS_in_self = if (unlockHeight_in_self == 0L) {
    secretOrHash_in_self // If unlockHeight is 0, this is the hashS
  } else {
    blake2b256(secretOrHash_in_self) // If unlockHeight > 0, this is the revealed S
  }

  val action2_not_initialized = unlockHeight_in_self == 0L

  val expectedParticipationScriptHash = SELF.R6[Coll[Byte]].get
  
  val numericalParams = SELF.R7[Coll[Long]].get
  val deadline = numericalParams(0)
  val creatorStake = numericalParams(1)
  val participationFee = numericalParams(2)
  
  val commissionPercentage = SELF.R8[Int].get
  val gameNftId = SELF.tokens(0)._1

  val P2PK_ERGOTREE_PREFIX = fromBase16("0008cd") // For PK() workaround
  val gameCreatorP2PKPropBytes = P2PK_ERGOTREE_PREFIX ++ gameCreatorPK

  val isAfterDeadline = HEIGHT >= deadline
  val isBeforeDeadline = HEIGHT < deadline 

  // === ACTION 1: Game Resolution (On-Chain Winner Determination) ===
  val action1_isValidResolution = {
    if (isAfterDeadline && OUTPUTS.size > 1 && action2_not_initialized) {
      val winnerOutput = OUTPUTS(0)
      val creatorOutput = OUTPUTS(1)
      val revealedS_fromOutput = creatorOutput.R4[Coll[Byte]].get 
      
      val sCorrectlyRevealedAndOutputAuthorized = creatorOutput.propositionBytes == gameCreatorP2PKPropBytes &&
                                                  blake2b256(revealedS_fromOutput) == hashS_in_self

      if (sCorrectlyRevealedAndOutputAuthorized) {
        val participationInputs = INPUTS.slice(1, INPUTS.size)   // Contains aggregated boxes to pay the transaction fee. They will be avoided within the fold with isStructurallyValidPBox
        
        // Outer fold state: (maxScore, (winnerPK, prizePool))
        val initialOuterFoldState = (-1L, (Coll[Byte](), 0L))


        val outerFoldResult = participationInputs.fold(initialOuterFoldState, { 
          (accOuter: (Long, (Coll[Byte], Long)), pBox: Box) =>
            
            val prevMaxScore = accOuter._1

            val nestedWinnerAndPool = accOuter._2
            val prevWinnerPK = nestedWinnerAndPool._1
            val prevPrizePool = nestedWinnerAndPool._2

            // Extract optionals and validate pBox structure
            val pBoxPlayerPK_opt = pBox.R4[Coll[Byte]]
            val pBoxCommitment_opt = pBox.R5[Coll[Byte]]
            val gameNftId_opt_pBox = pBox.R6[Coll[Byte]]
            val pBoxSolverId_opt = pBox.R7[Coll[Byte]]
            val pBoxHashLogs_opt = pBox.R8[Coll[Byte]]
            val pBoxScoreList_opt = pBox.R9[Coll[Long]]

            val hasAllNeededRegisters = pBoxPlayerPK_opt.isDefined && pBoxCommitment_opt.isDefined &&
                                        gameNftId_opt_pBox.isDefined && pBoxSolverId_opt.isDefined &&
                                        pBoxHashLogs_opt.isDefined && pBoxScoreList_opt.isDefined

            val isStructurallyValidPBox = if (hasAllNeededRegisters) {
                                            gameNftId_opt_pBox.get == gameNftId &&
                                            pBox.value >= participationFee &&
                                            blake2b256(pBox.propositionBytes) == expectedParticipationScriptHash
                                          } else { false }

            if (isStructurallyValidPBox) {
                val pBoxPlayerPK = pBoxPlayerPK_opt.get
                val pBoxCommitment = pBoxCommitment_opt.get
                val pBoxSolverId = pBoxSolverId_opt.get
                val pBoxHashLogs = pBoxHashLogs_opt.get
                val pBoxScoreList = pBoxScoreList_opt.get

                // Inner fold to find the validated score in pBoxScoreList
                // Inner fold state: (foundScore: Long, scoreIsValidated: Boolean)
                val initialInnerFoldState = (-1L, false)
                val innerFoldResult = pBoxScoreList.fold(initialInnerFoldState, {
                    (accInner: (Long, Boolean), scoreAttempt: Long) =>
                        val previouslyFoundScore = accInner._1
                        val previouslyValidated = accInner._2

                        if (previouslyValidated) { // If we already found one, no need to keep searching
                            accInner 
                        } else {
                            val testCommitment = blake2b256(pBoxSolverId ++ longToByteArray(scoreAttempt) ++ pBoxHashLogs ++ revealedS_fromOutput)
                            if (testCommitment == pBoxCommitment) {
                                (scoreAttempt, true) // Score found and validated
                            } else {
                                accInner // Keep previous state, continue searching
                            }
                        }
                })
                
                val actualScoreForThisPBox = innerFoldResult._1
                val scoreFoundAndValidated = innerFoldResult._2

                if (scoreFoundAndValidated) {
                    val updatedPrizePool = prevPrizePool + pBox.value

                    val comparitionResult = {
                        if (actualScoreForThisPBox > prevMaxScore) {
                            (actualScoreForThisPBox, pBoxPlayerPK)
                        } else if (actualScoreForThisPBox == prevMaxScore && prevMaxScore != -1L) {
                             // Tie-breaking Logic: We keep the first one found with the maximum score.
                             // If you wanted to use creationHeight, 'accOuter' and 'initialOuterFoldState'
                             // would need an additional field for 'winnerCreationHeight'.
                            (prevMaxScore, prevWinnerPK)
                        } else {
                            (prevMaxScore, prevWinnerPK)
                        }
                    }
                        
                    (comparitionResult._1, (comparitionResult._2, updatedPrizePool))
                } else {
                    (prevMaxScore, (prevWinnerPK, prevPrizePool)) 
                }
            } else {
                (prevMaxScore, (prevWinnerPK, prevPrizePool))
            }
        })

        val finalMaxScore = outerFoldResult._1  // not used.

        val finalNestedWinnerAndPool = outerFoldResult._2
        val finalWinnerPKBytes = finalNestedWinnerAndPool._1
        val finalTotalPrizePool = finalNestedWinnerAndPool._2

        val foundAWinningCandidate = finalWinnerPKBytes.size > 0  // That works.

        if (foundAWinningCandidate) {
            val creatorCommissionAmount = finalTotalPrizePool * commissionPercentage / 100
            val finalWinnerPrize = finalTotalPrizePool - creatorCommissionAmount
            
            val onChainWinnerP2PKPropBytes = P2PK_ERGOTREE_PREFIX ++ finalWinnerPKBytes

            val winnerOutputHasNft = winnerOutput.tokens.size == 1 && 
                                     winnerOutput.tokens(0)._1 == gameNftId && 
                                     winnerOutput.tokens(0)._2 == 1L

            val winnerReceivesCorrectPrize = winnerOutput.value >= finalWinnerPrize &&
                                             winnerOutput.propositionBytes == onChainWinnerP2PKPropBytes && 
                                             winnerOutputHasNft
            
            val creatorOutputNoGameNft = creatorOutput.tokens.forall({(token: (Coll[Byte], Long)) => token._1 != gameNftId}) || 
                                         creatorOutput.tokens.size == 0
            val creatorReceivesCommissionAndStake = creatorOutput.value >= creatorCommissionAmount + creatorStake &&
                                                    creatorOutputNoGameNft
            
            winnerReceivesCorrectPrize && creatorReceivesCommissionAndStake
        } else { false }
      } else { false } 
    } else { false } 
  }

  // === ACTION 2: Partial Penalty for Early Secret Revelation (NEW IMPLEMENTATION) ===
  val action2_isValidCancellation = {
    if (isBeforeDeadline) {
      if (OUTPUTS.size == 2) {
        val recreatedGameBox = OUTPUTS(0)
        val claimerOutput = OUTPUTS(1)
        val stakePortionToClaim = creatorStake / STAKE_DENOMINATOR
        val remainingStake = creatorStake - stakePortionToClaim
        
        // --- Shared validation for the claimer's output ---
        val claimerGetsPortion = claimerOutput.value >= stakePortionToClaim

        // --- Case A: First withdrawal (revealing the secret) ---
        val caseA = if (unlockHeight_in_self == 0L) {
          val newR5Tuple = recreatedGameBox.R5[(Long, Coll[Byte])].get
          val newUnlockHeight = newR5Tuple._1
          val revealedS = newR5Tuple._2
          
          // 1. Check if the revealed S in the new box matches the original hash
          val sIsCorrect = blake2b256(revealedS) == hashS_in_self
          // 2. Check if the new unlock height is correctly set
          val unlockHeightIsCorrect = newUnlockHeight == HEIGHT + COOLDOWN_IN_BLOCKS

          sIsCorrect && unlockHeightIsCorrect
        } else { false }

        // --- Case B: Subsequent withdrawals (draining the stake) ---
        val caseB = if (unlockHeight_in_self > 0L) {
          // 1. Check if the cooldown period has passed
          val cooldownIsOver = HEIGHT >= unlockHeight_in_self
          val newR5Tuple = recreatedGameBox.R5[(Long, Coll[Byte])].get
          // 2. Check that S hasn't changed and the new unlock height is correct
          val r5StateIsCorrect = newR5Tuple._2 == secretOrHash_in_self && // S is the same
                                 newR5Tuple._1 == HEIGHT + COOLDOWN_IN_BLOCKS // Cooldown is reset

          cooldownIsOver && r5StateIsCorrect
        } else { false }

        // --- Shared validation for the recreated GameBox's integrity ---
        val gameBoxIntegrityPreserved = {
          recreatedGameBox.propositionBytes == SELF.propositionBytes &&
          recreatedGameBox.value >= remainingStake &&
          recreatedGameBox.tokens == SELF.tokens &&
          // Check that only the stake value in R7 is modified
          recreatedGameBox.R7[Coll[Long]].get(0) == deadline &&
          recreatedGameBox.R7[Coll[Long]].get(1) == remainingStake &&
          recreatedGameBox.R7[Coll[Long]].get(2) == participationFee &&
          // Check that other registers are untouched
          recreatedGameBox.R4[Coll[Byte]].get == gameCreatorPK &&
          recreatedGameBox.R6[Coll[Byte]].get == SELF.R6[Coll[Byte]].get &&
          recreatedGameBox.R8[Int].get == SELF.R8[Int].get &&
          recreatedGameBox.R9[Coll[Byte]].get == SELF.R9[Coll[Byte]].get
        }
        
        (caseA || caseB) && claimerGetsPortion && gameBoxIntegrityPreserved
      } else { false } // Incorrect number of outputs
    } else { false } // Action only valid before the deadline
  }
  
  // The script allows spending the GameBox if it's a valid resolution.
  sigmaProp(action1_isValidResolution || action2_isValidCancellation)
}