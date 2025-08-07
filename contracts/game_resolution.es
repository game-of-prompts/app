{
  // =================================================================
  // === CONSTANTES Y HASHES DE SCRIPTS
  // =================================================================

  val JUDGE_PERIOD = 30L 
  val PARTICIPATION_SUBMITTED_SCRIPT_HASH = fromBase16("...") 
  val PARTICIPATION_RESOLVED_SCRIPT_HASH = fromBase16("...")
  val P2PK_ERGOTREE_PREFIX = fromBase16("0008cd")

  // =================================================================
  // === DEFINICIONES DE REGISTROS (ESTADO DE RESOLUCIÓN FINAL)
  // =================================================================

  // R4: (Long, Int)                - (resolutionDeadline, resolvedCounter): Límite de bloque y contador.
  // R5: (Coll[Byte], Coll[Byte])   - (revealedSecretS, winnerCandidateCommitment): El secreto y el candidato a ganador.
  // R6: Coll[Coll[Byte]]           - participatingJudges: Lista de IDs de tokens de reputación de los jueces aceptados.
  // R7: Coll[Long]                 - numericalParameters: [deadline, creatorStake, participationFee].
  // R8: (Coll[Byte], Int)          - resolvedorInfo: (Clave pública del "Resolvedor", % de comisión).
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

  val resolvedorInfo = SELF.R8[(Coll[Byte], Int)].get
  val resolvedorPK = resolvedorInfo._1
  val commissionPercentage = resolvedorInfo._2
  
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
        
        val newScore = submittedPBox.R9[Coll[Long]].get.fold((-1L, false), { (acc, score) =>
          if (acc._2) { acc } else {
            val testCommitment = blake2b256(submittedPBox.R7[Coll[Byte]].get ++ longToByteArray(score) ++ submittedPBox.R8[Coll[Byte]].get ++ revealedS)
            if (testCommitment == submittedPBox.R5[Coll[Byte]].get) { (score, true) } else { acc }
          }
        })._1
        
        val currentScore = currentCandidateBox.R9[Coll[Long]].get.fold((-1L, false), { (acc, score) =>
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
        
        val participationIsRecreated = OUTPUTS.exists { outBox =>
          blake2b256(outBox.propositionBytes) == PARTICIPATION_RESOLVED_SCRIPT_HASH &&
          outBox.value == submittedPBox.value &&
          outBox.R4[Coll[Byte]].get == submittedPBox.R4[Coll[Byte]].get &&
          outBox.R5[Coll[Byte]].get == submittedPBox.R5[Coll[Byte]].get
        }
        
        gameBoxIsRecreatedCorrectly && participationIsRecreated
      } else { false }
    } else { false }
  }

  // ### Acción 2: Invalidación por Jueces
  val action2_judgesInvalidate = {
    if (isBeforeResolutionDeadline) {
      val judgeVotes = CONTEXT.dataInputs
      val requiredVotes =
        if (participatingJudges.isEmpty) 0
        else participatingJudges.size / 2 + 1

      val votesAreValid = if (judgeVotes.size < requiredVotes) { false } else {
        val judgeVoteTokens = judgeVotes.map({(box: Box) => box.tokens(0)._1})
        val allVotesAreUnique = judgeVoteTokens.distinct.size == judgeVoteTokens.size

        allVotesAreUnique && judgeVotes.forall { voteBox =>
          val judgeTokenId = voteBox.tokens(0)._1
          val voteTargetCommitment = voteBox.R5[Coll[Byte]].get
          judgeTokenId.isIn(participatingJudges) && voteTargetCommitment == winnerCandidateCommitment
        }
      }
      
      if (votesAreValid) {
        val recreatedGameBox = OUTPUTS(0)
        val participantInputs = INPUTS.slice(1, INPUTS.size)
        val invalidatedCandidateBox = INPUTS.find({(b:Box) => b.R5[Coll[Byte]].get == winnerCandidateCommitment}).get

        val initialFoldState = (-1L, Coll[Byte]()) // (maxScore, nextCandidateCommitment)
        val foldResult = participantInputs.fold(initialFoldState, { (acc, pBox) =>
            if (pBox.R5[Coll[Byte]].get != winnerCandidateCommitment) {
                val scoreCheckResult = pBox.R9[Coll[Long]].get.fold((-1L, false), { (scoreAcc, score) =>
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
      val winnerOutput = OUTPUTS(0)
      val resolvedorOutput = OUTPUTS(1)
      
      val prizePool = SELF.value - creatorStake
      val resolvedorCommissionAmount = prizePool * commissionPercentage / 100
      val winnerPrize = prizePool - resolvedorCommissionAmount

      val winnerBoxOption = INPUTS.find({ (box: Box) => box.R5[Coll[Byte]].get == winnerCandidateCommitment })
      val winnerPK = winnerBoxOption.get.R4[Coll[Byte]].get
      val winnerAddressBytes = P2PK_ERGOTREE_PREFIX ++ winnerPK
      
      val winnerGetsPrize = winnerOutput.value >= winnerPrize &&
                            winnerOutput.propositionBytes == winnerAddressBytes &&
                            winnerOutput.tokens.contains(gameNft)
      
      val resolvedorGetsPaid = resolvedorOutput.value >= creatorStake + resolvedorCommissionAmount &&
                               resolvedorOutput.propositionBytes == (P2PK_ERGOTREE_PREFIX ++ resolvedorPK)
      
      winnerGetsPrize && resolvedorGetsPaid
    } else { false }
  }

  sigmaProp(action1_includeOmittedParticipation || action2_judgesInvalidate || action3_endGame)
}