{
  // === Register Definitions (GameBox) ===
  // R4: Coll[Byte] - gameCreatorPK: Raw bytes of the game creator's public key.
  // R5: Coll[Byte] - hashS: Blake2b256 hash of the game's secret 'S'.
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
  val hashS_in_self = SELF.R5[Coll[Byte]].get
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
    if (isAfterDeadline && OUTPUTS.size > 1) {
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

  // === ACTION 2: Cancellation due to Early Secret Revelation (FULL DESIGN - COMMENTED OUT) ===
  /* // Uncomment to activate Action 2. Requires exhaustive testing and possible refactor of 'var'.
  val action2_isValidCancellation = sigmaProp({
    if (isBeforeDeadline) {
        // INPUTS(0) is SELF (GameBox)
        // INPUTS(1) is the box that reveals S (can be ANY box, not necessarily the creator's)
        val revealedSBox = INPUTS(1) 
        val revealedS_fromInput = revealedSBox.R4[Coll[Byte]].get
        val sIsCorrect = blake2b256(revealedS_fromInput) == hashS_in_self

        if (sIsCorrect) {
            val numPlayerRefundOutputs = OUTPUTS.size - 1 
            
            val c1_hasCreatorOutput = numPlayerRefundOutputs >= 0

            // Assume candidate PBoxes to be refunded are INPUTS(2) to INPUTS(1 + numPlayerRefundOutputs)
            val expectedPBoxInputs = if (numPlayerRefundOutputs > 0) INPUTS.slice(2, 2 + numPlayerRefundOutputs) else Coll[Box]()
            val c2_inputOutputCountMatch = expectedPBoxInputs.size == numPlayerRefundOutputs

            // Validate all input PBoxes
            val c3_allExpectedPBoxesAreValid = if (numPlayerRefundOutputs > 0) {
                 expectedPBoxInputs.forall({ (pBox: Box) =>
                    pBox.R6[Coll[Byte]].get == gameNftId && // Belongs to this game
                    blake2b256(pBox.propositionBytes) == expectedParticipationScriptHash && // Is a correct PBox script
                    pBox.value >= participationFee // Paid at least the fee
                })
            } else { 
                true // No players to refund, so this condition passes
            }

            // Calculate prize distribution and validate player outputs
            val initialPlayerOutputsFoldState = (true, 0L) // (allPlayerOutputsValid, totalStakeClaimedByPlayers)
            
            val playerOutputsProcessingResult = if (c1_hasCreatorOutput && c2_inputOutputCountMatch && c3_allExpectedPBoxesAreValid && numPlayerRefundOutputs > 0) {
                val maxPlayerClaimFromStakePercentage = 20 // Ex: 20% of creator's stake is distributed
                
                // Use the same expectedPBoxInputs already validated with c3
                OUTPUTS.slice(0, numPlayerRefundOutputs).zip(expectedPBoxInputs).fold(initialPlayerOutputsFoldState, {
                    (acc: (Boolean, Long), pair: ((Box, Box))) =>
                        val previousAllCorrect = acc._1
                        val previousTotalStakeClaimed = acc._2
                        
                        val playerRefundOutput = pair._1
                        val pBox = pair._2 // Corresponding pBox from input
                        val playerPKToRefund = pBox.R4[Coll[Byte]].get
                        val playerOriginalFee = pBox.value // The original value of the PBox (its fee)
                        
                        // The portion of the creator's stake that this player claims
                        // Distributed equally among the number of valid PBoxes processed
                        val stakePortionForThisPlayer = (creatorStake / numPlayerRefundOutputs) * maxPlayerClaimFromStakePercentage / 100
                        
                        val outputIsCurrentlyCorrect = playerRefundOutput.propositionBytes == (P2PK_ERGOTREE_PREFIX ++ playerPKToRefund) && // Workaround for PK
                                                      playerRefundOutput.value >= playerOriginalFee + stakePortionForThisPlayer && 
                                                      playerRefundOutput.tokens.size == 0 
                        
                        val nextTotalStakeClaimed = if (outputIsCurrentlyCorrect) {
                            previousTotalStakeClaimed + stakePortionForThisPlayer
                        } else {
                            previousTotalStakeClaimed
                        }
                        (previousAllCorrect && outputIsCurrentlyCorrect, nextTotalStakeClaimed)
                })
            } else if (numPlayerRefundOutputs == 0 && c1_hasCreatorOutput && c2_inputOutputCountMatch && c3_allExpectedPBoxesAreValid) { 
                initialPlayerOutputsFoldState // (true, 0L) -> No players, player outputs are valid, no stake claimed
            } else { 
                (false, 0L) // Some previous condition (c1, c2, c3) failed
            }
            
            val c4_allPlayerOutputsValid = playerOutputsProcessingResult._1
            val totalStakeClaimedByPlayers = playerOutputsProcessingResult._2

            // Validate creator's output
            val c5_creatorOutputValid = if (c1_hasCreatorOutput && c4_allPlayerOutputsValid) { 
                val creatorOutput = OUTPUTS(numPlayerRefundOutputs) 
                val remainingStakeForCreator = creatorStake - totalStakeClaimedByPlayers
                
                val creatorGetsNftBack = creatorOutput.tokens.size == 1 && 
                                         creatorOutput.tokens(0)._1 == gameNftId && 
                                         creatorOutput.tokens(0)._2 == 1L

                creatorOutput.propositionBytes == gameCreatorP2PKPropBytes && // Uses the workaround
                creatorOutput.value >= remainingStakeForCreator && 
                creatorGetsNftBack
            } else {
                false
            }
            
            c1_hasCreatorOutput && c2_inputOutputCountMatch && c3_allExpectedPBoxesAreValid && c4_allPlayerOutputsValid && c5_creatorOutputValid
        } else { false } // sIsNotCorrect
    } else { false } // isNotBeforeDeadline
  })
  */
  
  // The script allows spending the GameBox if it's a valid resolution.
  // When Action 2 is active and tested, it will be: sigmaProp(action1_isValidResolution || action2_isValidCancellation)
  sigmaProp(action1_isValidResolution)
}