{
  // =================================================================
  // === CONSTANTES Y HASHES DE SCRIPTS
  // =================================================================

  val JUDGE_PERIOD = 30L 
  val JUDGE_COMMISSION_PERCENTAGE = 5L
  val DEV_ADDR = fromBase58("`+DEV_ADDR+`")
  val DEV_COMMISSION_PERCENTAGE = 5L
  val PARTICIPATION_SUBMITTED_SCRIPT_HASH = fromBase16("`+PARTICIPATION_SUBMITTED_SCRIPT_HASH+`") 
  val PARTICIPATION_RESOLVED_SCRIPT_HASH = fromBase16("`+PARTICIPATION_RESOLVED_SCRIPT_HASH+`")
  val P2PK_ERGOTREE_PREFIX = fromBase16("0008cd")
  val MIN_ERG_BOX = 1000000L


  // =================================================================
  // === DEFINICIONES DE REGISTROS (ESTADO DE RESOLUCIÓN FINAL)
  // =================================================================

  // R4: (Long, Int)                - (resolutionDeadline, resolvedCounter): Límite de bloque y contador.
  // R5: (Coll[Byte], Coll[Byte])   - (revealedSecretS, winnerCandidateCommitment): El secreto y el candidato a ganador.
  // R6: Coll[Coll[Byte]]           - participatingJudges: Lista de IDs de tokens de reputación de los jueces.
  // R7: Coll[Long]                 - numericalParams: [deadline, creatorStake, participationFee].
  // R8: (Coll[Byte], Long)          - resolverInfo: (Clave pública del "Resolvedor", % de comisión).
  // R9: (Coll[Byte], Coll[Byte])   - gameProvenance: (Clave pública del CREADOR ORIGINAL, Detalles del juego en JSON/Hex).

  // =================================================================
  // === EXTRACCIÓN DE VALORES
  // =================================================================

  val resolutionDeadline = SELF.R4[(Long, Int)].get._1

  val r5Tuple = SELF.R5[(Coll[Byte], Coll[Byte])].get
  val revealedS = r5Tuple._1
  val winnerCandidateCommitment = r5Tuple._2
  
  val participatingJudges = SELF.R6[Coll[Coll[Byte]]].get
  val numericalParams = SELF.R7[Coll[Long]].get
  val creatorStake = numericalParams(1)

  val resolverInfo = SELF.R8[(Coll[Byte], Long)].get
  val resolverPK = resolverInfo._1
  val commissionPercentage = resolverInfo._2
  
  val gameNft = SELF.tokens(0)
  val gameNftId = gameNft._1

  val isBeforeResolutionDeadline = HEIGHT < resolutionDeadline
  val isAfterResolutionDeadline = HEIGHT >= resolutionDeadline

  // =================================================================
  // === ACCIONES DE GASTO
  // =================================================================

  // ### Acción 1: Incluir Participación Omitida
  val action1_includeOmittedParticipation = {
    if (isBeforeResolutionDeadline && INPUTS.size > 1 && OUTPUTS.size > 1 && CONTEXT.dataInputs.size > 0) {
      val submittedPBox = INPUTS(1)
      val recreatedGameBox = OUTPUTS(0)
      val currentCandidateBox = CONTEXT.dataInputs(0)

      val pBoxIsValid = blake2b256(submittedPBox.propositionBytes) == PARTICIPATION_SUBMITTED_SCRIPT_HASH &&
                        submittedPBox.R6[Coll[Byte]].get == gameNftId

      val candidateDataInputIsValid = currentCandidateBox.R5[Coll[Byte]].get == winnerCandidateCommitment &&
                                      blake2b256(currentCandidateBox.propositionBytes) == PARTICIPATION_RESOLVED_SCRIPT_HASH &&
                                      currentCandidateBox.R6[Coll[Byte]].get == gameNftId

      if (pBoxIsValid && candidateDataInputIsValid) {
        
        val newScore = submittedPBox.R9[Coll[Long]].get.fold((-1L, false), { (acc: (Long, Boolean), score: Long) =>
          if (acc._2) { acc } else {
            val testCommitment = blake2b256(submittedPBox.R7[Coll[Byte]].get ++ longToByteArray(score) ++ submittedPBox.R8[Coll[Byte]].get ++ revealedS)
            if (testCommitment == submittedPBox.R5[Coll[Byte]].get) { (score, true) } else { acc }
          }
        })._1
        
        val currentScore = currentCandidateBox.R9[Coll[Long]].get.fold((-1L, false), { (acc: (Long, Boolean), score: Long) =>
          if (acc._2) { acc } else {
            val testCommitment = blake2b256(currentCandidateBox.R7[Coll[Byte]].get ++ longToByteArray(score) ++ currentCandidateBox.R8[Coll[Byte]].get ++ revealedS)
            if (testCommitment == currentCandidateBox.R5[Coll[Byte]].get) { (score, true) } else { acc }
          }
        })._1

        val newWinnerCandidate = if (newScore > currentScore) {
          submittedPBox.R5[Coll[Byte]].get
        } else {
          winnerCandidateCommitment
        }

        val gameBoxIsRecreatedCorrectly = {
          recreatedGameBox.propositionBytes == SELF.propositionBytes &&
          recreatedGameBox.R5[(Coll[Byte], Coll[Byte])].get == (revealedS, newWinnerCandidate) &&
          recreatedGameBox.R6[Coll[Coll[Byte]]].get == participatingJudges &&
          recreatedGameBox.R7[Coll[Long]].get == numericalParams &&
          recreatedGameBox.R8[(Coll[Byte], Int)].get._2 == commissionPercentage &&
          recreatedGameBox.R9[(Coll[Byte], Coll[Byte])].get == SELF.R9[(Coll[Byte], Coll[Byte])].get
        }
        
        val participationIsRecreated = OUTPUTS.exists( { (outBox: Box) =>
          blake2b256(outBox.propositionBytes) == PARTICIPATION_RESOLVED_SCRIPT_HASH &&
          outBox.value == submittedPBox.value &&
          outBox.R4[Coll[Byte]].get == submittedPBox.R4[Coll[Byte]].get &&
          outBox.R5[Coll[Byte]].get == submittedPBox.R5[Coll[Byte]].get
        })
        
        gameBoxIsRecreatedCorrectly && participationIsRecreated
      } else { false }
    } else { false }
  }

  // ### Acción 2: Invalidación por Jueces
  val action2_judgesInvalidate = {
    if (isBeforeResolutionDeadline) {
      val judgeVotes = CONTEXT.dataInputs
      val requiredVotes =
        if (participatingJudges.size == 0) 0
        else participatingJudges.size / 2 + 1

      val votesAreValid = if (judgeVotes.size < requiredVotes) { false } else {
        val judgeVoteTokens = judgeVotes.map({(box: Box) => box.tokens(0)._1})
        
        val allVotesAreUnique = judgeVoteTokens.indices.forall { (i: Int) =>
            !(judgeVoteTokens.slice(i + 1, judgeVoteTokens.size).exists({ (otherToken: Coll[Byte]) =>
                otherToken == judgeVoteTokens(i)
            }))
        }

        allVotesAreUnique && judgeVotes.forall( { (voteBox: Box) =>
          val judgeTokenId = voteBox.tokens(0)._1
          val voteTargetCommitment = voteBox.R5[Coll[Byte]].get
          val allJudgesParticipate = participatingJudges.exists({ (pJudge: Coll[Byte]) => pJudge == judgeTokenId })
          allJudgesParticipate && voteTargetCommitment == winnerCandidateCommitment
        })
      }
      
      if (votesAreValid) {
        val recreatedGameBox = OUTPUTS(0)
        val participantInputs = INPUTS.slice(1, INPUTS.size)
        val invalidatedCandidateBox = INPUTS.filter({(b:Box) => b.R5[Coll[Byte]].get == winnerCandidateCommitment})(0)

        val initialFoldState = (-1L, Coll[Byte]()) // (maxScore, nextCandidateCommitment)
        val foldResult = participantInputs.fold(initialFoldState, { (acc: (Long, Coll[Byte]), pBox: Box) =>
            if (pBox.R5[Coll[Byte]].get != winnerCandidateCommitment) {
                val scoreCheckResult = pBox.R9[Coll[Long]].get.fold((-1L, false), { (scoreAcc: (Long, Boolean), score: Long) =>
                    if (scoreAcc._2) { scoreAcc } else {
                        val testCommitment = blake2b256(pBox.R7[Coll[Byte]].get ++ longToByteArray(score) ++ pBox.R8[Coll[Byte]].get ++ revealedS)
                        if (testCommitment == pBox.R5[Coll[Byte]].get) { (score, true) } else { scoreAcc }
                    }
                })
                val actualScore = scoreCheckResult._1
                if (actualScore > acc._1) { (actualScore, pBox.R5[Coll[Byte]].get) } else { acc }
            } else { acc }
        })
        val nextCandidateCommitment = foldResult._2

        val fundsReturnedToPool = recreatedGameBox.value >= SELF.value + invalidatedCandidateBox.value
        val deadlineIsExtended = recreatedGameBox.R4[(Long, Int)].get._1 >= resolutionDeadline + JUDGE_PERIOD
        val candidateIsReset = recreatedGameBox.R5[(Coll[Byte], Coll[Byte])].get._2 == nextCandidateCommitment
        fundsReturnedToPool && deadlineIsExtended && candidateIsReset
      } else { false }
    } else { false }
  }

  // ### Acción 3: Finalización del Juego
  val action3_endGame = {
    if (isAfterResolutionDeadline && OUTPUTS.size > 1) {
      val participations = INPUTS.filter({ (box: Box) => box.propositionBytes == PARTICIPATION_RESOLVED_SCRIPT_HASH })
      val winnerOutput = OUTPUTS(0)
      val resolverOutput = OUTPUTS(1)
      val devOutput = OUTPUTS(2)
      
      val prizePool = participations.fold(0L, { (acc: Long, pBox: Box) => acc + pBox.value })

      val resolverCommissionAmount = {
        val rawResolverCommission = prizePool * commissionPercentage / 100L
        val resolverTotalPayout = creatorStake + rawResolverCommission

        if (resolverTotalPayout >= MIN_ERG_BOX) {
            rawResolverCommission
        } else {
            -creatorStake 
        }
      }

      val devCommissionAmount = {
        val amount = prizePool * DEV_COMMISSION_PERCENTAGE / 100L
        if (amount >= MIN_ERG_BOX) { amount } else { 0L }
      }
      val judgesCommissionAmount = {
        val amount = prizePool * JUDGE_COMMISSION_PERCENTAGE / 100L
        if (amount >= MIN_ERG_BOX) { amount } else { 0L }
      }
      val winnerPrize = prizePool - resolverCommissionAmount - devCommissionAmount - judgesCommissionAmount

      val winnerBox = INPUTS.filter({ (box: Box) => box.R5[Coll[Byte]].get == winnerCandidateCommitment })(0)
      val winnerPK = winnerBox.R4[Coll[Byte]].get
      val winnerAddressBytes = P2PK_ERGOTREE_PREFIX ++ winnerPK

      val devGetsPaid = devOutput.propositionBytes == (P2PK_ERGOTREE_PREFIX ++ DEV_ADDR) && 
                        devOutput.value >= devCommissionAmount
      
      val judgesGetsPaid = true  // Send to rep. proofs R7 addres

      val winnerGetsPrize = winnerOutput.value >= winnerPrize &&
                            winnerOutput.propositionBytes == winnerAddressBytes &&
                            winnerOutput.tokens.filter({ (token: (Coll[Byte], Long)) => token._1 == gameNftId }).size == 1
      
      val resolverGetsPaid = resolverOutput.value >= creatorStake + resolverCommissionAmount &&
                              resolverOutput.propositionBytes == (P2PK_ERGOTREE_PREFIX ++ resolverPK)
      
      winnerGetsPrize && resolverGetsPaid && devGetsPaid && judgesGetsPaid
    } else { false }
  }

  sigmaProp(action1_includeOmittedParticipation || action2_judgesInvalidate || action3_endGame)
}