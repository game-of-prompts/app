{
  // =================================================================
  // === CONSTANTES Y HASHES DE SCRIPTS
  // =================================================================

  val JUDGE_PERIOD = `+JUDGE_PERIOD+`L
  val CREATOR_OMISSION_NO_PENALTY_PERIOD = `+CREATOR_OMISSION_NO_PENALTY_PERIOD+`L

  val PARTICIPATION_TYPE_ID = fromBase16("`+PARTICIPATION_TYPE_ID+`")
  val MAX_SCORE_LIST = `+MAX_SCORE_LIST+`L

  val PARTICIPATION_SCRIPT_HASH = fromBase16("`+PARTICIPATION_SCRIPT_HASH+`") 
  val REPUTATION_PROOF_SCRIPT_HASH = fromBase16("`+REPUTATION_PROOF_SCRIPT_HASH+`")
  val END_GAME_SCRIPT_HASH = fromBase16("`+END_GAME_SCRIPT_HASH+`")


  // =================================================================
  // === DEFINICIONES DE REGISTROS
  // =================================================================

  // R4: Integer                    - Game state (0: Active, 1: Resolved, 2: Cancelled).
  // R5: Coll[Byte]                 - Seed
  // R6: (Coll[Byte], Coll[Byte])   - (revealedSecretS, winnerCandidateCommitment): El secreto y el candidato a ganador.
  // R7: Coll[Coll[Byte]]           - participatingJudges: Lista de IDs de tokens de reputación de los jueces.
  // R8: Coll[Long]                 - numericalParameters: [deadline, creatorStake, participationFee, perJudgeComissionPercentage, creatorComissionPercentage, resolutionDeadline]
  // R9: Coll[Coll[Byte]]           - gameProvenance: [gameDetailsJsonHex, ParticipationTokenID, resolverErgoTree]

  // =================================================================
  // === EXTRACCIÓN DE VALORES
  // =================================================================

  val gameState = SELF.R4[Int].get
  val seed = SELF.R5[Coll[Byte]].get

  val r6Tuple = SELF.R6[(Coll[Byte], Coll[Byte])].get
  val revealedS = r6Tuple._1
  val winnerCandidateCommitment = r6Tuple._2
  
  val participatingJudges = SELF.R7[Coll[Coll[Byte]]].get
  val numericalParams = SELF.R8[Coll[Long]].get
  val deadline = numericalParams(0)
  val creatorStake = numericalParams(1)
  val participationFee = numericalParams(2)
  val perJudgeComissionPercentage = numericalParams(3)
  val creatorComissionPercentage = numericalParams(4)
  val resolutionDeadline = numericalParams(5)

  val gameProvenance = SELF.R9[Coll[Coll[Byte]]].get
  // gameProvenance(0) = gameDetailsJsonHex
  val participationTokenId = gameProvenance(1)
  val resolverPK = gameProvenance(2)
  
  val gameNft = SELF.tokens(0)
  val gameNftId = gameNft._1

  val isAfterResolutionDeadline = HEIGHT >= resolutionDeadline
  val isBeforeResolutionDeadline = HEIGHT < resolutionDeadline

  val min_value = 0L

  val box_value = { (box: Box) =>
    box.tokens.filter { (token: (Coll[Byte], Long)) => token._1 == participationTokenId }.fold(0L, { (acc: Long, token: (Coll[Byte], Long)) => acc + token._2 })
  }

  val getScoreFromBox = { (box: Box) =>
    val scoreList = box.R9[Coll[Long]].get
    val solverId = box.R7[Coll[Byte]].get
    val logsHash = box.R8[Coll[Byte]].get
    val ergotree = box.R4[Coll[Byte]].get
    val commitment = box.R5[Coll[Byte]].get
    
    scoreList.fold((-1L, false), { (acc: (Long, Boolean), score: Long) =>
      if (acc._2) { acc } else {
        val testCommitment = blake2b256(solverId ++ seed ++ longToByteArray(score) ++ logsHash ++ ergotree ++ revealedS)
        if (testCommitment == commitment) { (score, true) } else { acc }
      }
    })
  }



  // =================================================================
  // === ACCIONES DE GASTO
  // =================================================================

  // ### Acción 1: Incluir Participación Omitida
  val action1_includeOmittedParticipation = {
    // Verificaciones iniciales de la estructura de la transacción
    if (isBeforeResolutionDeadline && INPUTS.size > 1 && OUTPUTS.size > 1) {
      
      val omittedWinnerBoxes = CONTEXT.dataInputs.filter({ 
              (box: Box) => 
                blake2b256(box.propositionBytes) == PARTICIPATION_SCRIPT_HASH && 
                box.R6[Coll[Byte]].get == gameNftId &&
                box.R5[Coll[Byte]].get != winnerCandidateCommitment
            })
      
      if (omittedWinnerBoxes.size == 1) {

        val omittedWinnerBox = omittedWinnerBoxes(0)
        
        // TODO val recreatedGameBoxes = OUTPUTS.filter({(b:Box) => b.propositionBytes == SELF.propositionBytes})
        // TODO if (recreatedGameBoxes.size == 1) {
        val recreatedGameBox = OUTPUTS(0)

        // Se verifica que la caja de participación enviada sea válida para este juego
        val omittedBoxIsValid = blake2b256(omittedWinnerBox.propositionBytes) == PARTICIPATION_SCRIPT_HASH &&
                                omittedWinnerBox.R6[Coll[Byte]].get == gameNftId &&
                                omittedWinnerBox.creationInfo._1 < deadline &&
                                box_value(omittedWinnerBox) >= participationFee &&
                                omittedWinnerBox.R9[Coll[Long]].get.size <= MAX_SCORE_LIST

        if (omittedBoxIsValid) {
          // Se calcula el puntaje de la nueva participación revelando el secreto
          val newScore = getScoreFromBox(omittedWinnerBox)._1

          // Solo continuamos si el puntaje se pudo validar (es decir, no es -1)
          val newScoreIsValid = newScore != -1L

          if (newScoreIsValid) {
            
            val newWinnerCandidate = if (winnerCandidateCommitment == Coll[Byte]()) {
              // CASO 1: No hay un candidato a ganador actual.
              // La caja presentada se convierte en el nuevo candidato. No se necesita dataInput.
              omittedWinnerBox.R5[Coll[Byte]].get
            } else {
              // CASO 2: Ya existe un candidato a ganador.
              // Se busca la caja del candidato actual en los dataInputs.
              val currentCandidateBoxes = CONTEXT.dataInputs.filter({
                (b:Box) => 
                  blake2b256(b.propositionBytes) == PARTICIPATION_SCRIPT_HASH && 
                  b.R5[Coll[Byte]].get == winnerCandidateCommitment &&
                  b.R6[Coll[Byte]].get == gameNftId
              })
              
              if (currentCandidateBoxes.size == 1) {
                val currentCandidateBox = currentCandidateBoxes(0)
                
                // Se calcula el puntaje del candidato actual de forma segura
                val currentCandidateScoreTuple = getScoreFromBox(currentCandidateBox)

                val currentScore = currentCandidateScoreTuple._1
                val validCurrentCandidate = currentCandidateScoreTuple._2 && currentScore != -1L

                if (validCurrentCandidate) {
                  // Se determina el nuevo ganador comparando puntajes AJUSTADOS y alturas de bloque
                  // Formula: score = game_score * (DEADLINE - HEIGHT)
                  val newScoreAdjusted = newScore * (deadline - omittedWinnerBox.creationInfo._1.toLong)
                  val currentScoreAdjusted = currentScore * (deadline - currentCandidateBox.creationInfo._1.toLong)

                  if (newScoreAdjusted > currentScoreAdjusted || (newScoreAdjusted == currentScoreAdjusted && omittedWinnerBox.creationInfo._1 < currentCandidateBox.creationInfo._1)) {
                    omittedWinnerBox.R5[Coll[Byte]].get // El nuevo es mejor
                  } else {
                    Coll[Byte]() // El actual sigue siendo el mejor
                  }
                } else {
                  Coll[Byte]() // El candidato actual no es válido, transacción inválida.
                }

              } else {
                // Si hay un compromiso pero no se provee la caja en dataInputs (o hay más de una), la transacción es inválida.
                Coll[Byte]()
              }
            }

            if (newWinnerCandidate != Coll[Byte]() && newWinnerCandidate != winnerCandidateCommitment) {

              // Verificación de la recreación de la caja del juego
              val gameBoxIsRecreatedCorrectly = {
                box_value(recreatedGameBox) >= box_value(SELF) &&
                recreatedGameBox.tokens(0)._1 == gameNftId &&
                recreatedGameBox.R4[Int].get == gameState && gameState == 1 &&
                recreatedGameBox.R5[Coll[Byte]].get == seed &&
                recreatedGameBox.R6[(Coll[Byte], Coll[Byte])].get._1 == revealedS &&
                recreatedGameBox.R6[(Coll[Byte], Coll[Byte])].get._2 == newWinnerCandidate &&
                recreatedGameBox.R7[Coll[Coll[Byte]]].get == participatingJudges &&
                recreatedGameBox.R8[Coll[Long]].get(0) == deadline &&
                recreatedGameBox.R8[Coll[Long]].get(1) == creatorStake &&
                recreatedGameBox.R8[Coll[Long]].get(2) == participationFee &&
                recreatedGameBox.R8[Coll[Long]].get(3) == perJudgeComissionPercentage &&
                recreatedGameBox.R8[Coll[Long]].get(4) == creatorComissionPercentage &&
                recreatedGameBox.R8[Coll[Long]].get(5) == resolutionDeadline &&
                recreatedGameBox.R9[Coll[Coll[Byte]]].get(0) == gameProvenance(0) &&
                recreatedGameBox.R9[Coll[Coll[Byte]]].get(1) == gameProvenance(1) &&
                (
                  recreatedGameBox.R9[Coll[Coll[Byte]]].get(2) == resolverPK ||  // Allow the resolver to set a new candidate after a judge invalidation action.
                  (resolutionDeadline - JUDGE_PERIOD) + CREATOR_OMISSION_NO_PENALTY_PERIOD < HEIGHT  // New resolver can be set.
                ) && 
                recreatedGameBox.R9[Coll[Coll[Byte]]].get.size == 3
              }
              
              gameBoxIsRecreatedCorrectly && newScoreIsValid
              
            } else { false }
          } else { false }
        } else { false }
      } else { false }
    } else { false }
  }

  // ### Acción 2: Invalidación por Jueces
  val action2_judgesInvalidate = {
    if (isBeforeResolutionDeadline && CONTEXT.dataInputs.size > 0) {
      
      val judgeVotes = CONTEXT.dataInputs.filter({
        (box: Box) => 
          blake2b256(box.propositionBytes) == REPUTATION_PROOF_SCRIPT_HASH &&
          box.tokens.size > 0 &&
          box.R4[Coll[Byte]].get == PARTICIPATION_TYPE_ID &&
          box.R5[Coll[Byte]].get == winnerCandidateCommitment &&
          box.R6[Boolean].get && // Is locked
          box.R8[Boolean].get == false && // Negative vote, invalidates winner candidate
          participatingJudges.exists({(tokenId: Coll[Byte]) => tokenId == box.tokens(0)._1})  // Is nominated
      })

      // Reputation proof does not show repeated boxes (of the same R4-R5 pair), so this point must be ensured.
      val allVotesAreUnique = {
        val judgeVoteTokens = judgeVotes.map({(box: Box) => box.tokens(0)._1})
        judgeVoteTokens.indices.forall { (i: Int) =>
            !(judgeVoteTokens.slice(i + 1, judgeVoteTokens.size).exists({ (otherToken: Coll[Byte]) =>
                otherToken == judgeVoteTokens(i)
            }))
        }
      }

      val hasRequiredVotes = {
        val requiredVotes =
          if (participatingJudges.size == 0) 0
          else participatingJudges.size / 2 + 1

        judgeVotes.size >= requiredVotes
      }

      val votesAreValid = allVotesAreUnique && hasRequiredVotes

      val recreatedGameBoxes = OUTPUTS.filter({(b:Box) => b.propositionBytes == SELF.propositionBytes})
      
      if (votesAreValid && recreatedGameBoxes.size == 1) {
        val recreatedGameBox = recreatedGameBoxes(0)

        val newCandidateCommitment = recreatedGameBox.R6[(Coll[Byte], Coll[Byte])].get._2
        val winnerCandidateValid = if (newCandidateCommitment == Coll[Byte]()) { true } 
          else {
            val winnerCandidateBoxes = CONTEXT.dataInputs.filter({ 
              (box: Box) => 
                blake2b256(box.propositionBytes) == PARTICIPATION_SCRIPT_HASH && 
                box.R6[Coll[Byte]].get == gameNftId &&
                box.R5[Coll[Byte]].get == newCandidateCommitment
            })

            if (winnerCandidateBoxes.size == 1) {
              val winnerCandidateBox = winnerCandidateBoxes(0)
              val pBoxScoreList = winnerCandidateBox.R9[Coll[Long]].get

              val validScoreExists = getScoreFromBox(winnerCandidateBox)._2

              val correctParticipationFee = box_value(winnerCandidateBox) >= participationFee
              val createdBeforeDeadline = winnerCandidateBox.creationInfo._1 < deadline

              validScoreExists && correctParticipationFee && createdBeforeDeadline && pBoxScoreList.size <= MAX_SCORE_LIST
            }
            else { false }
          }
          
        val invalidatedCandidateBoxes = INPUTS.filter({(b:Box) => blake2b256(b.propositionBytes) == PARTICIPATION_SCRIPT_HASH && b.R5[Coll[Byte]].get == winnerCandidateCommitment})
        
        if (winnerCandidateValid && invalidatedCandidateBoxes.size == 1) {
          val invalidatedCandidateBox = invalidatedCandidateBoxes(0)

          val fundsReturnedToPool = box_value(recreatedGameBox) >= box_value(SELF) + box_value(invalidatedCandidateBox)
          val deadlineIsExtended = recreatedGameBox.R8[Coll[Long]].get(5) >= HEIGHT + JUDGE_PERIOD

          val gameBoxIsRecreatedCorrectly = {
            recreatedGameBox.tokens(0)._1 == gameNftId &&
            recreatedGameBox.R4[Int].get == gameState && gameState == 1 &&
            recreatedGameBox.R5[Coll[Byte]].get == seed &&
            recreatedGameBox.R7[Coll[Coll[Byte]]].get == participatingJudges &&
            recreatedGameBox.R8[Coll[Long]].get(0) == deadline &&
            recreatedGameBox.R8[Coll[Long]].get(1) == creatorStake &&
            recreatedGameBox.R8[Coll[Long]].get(2) == participationFee &&
            recreatedGameBox.R8[Coll[Long]].get(3) == perJudgeComissionPercentage + creatorComissionPercentage &&
            recreatedGameBox.R8[Coll[Long]].get(4) == 0 &&
            recreatedGameBox.R9[Coll[Coll[Byte]]].get == gameProvenance
          }
          
          fundsReturnedToPool && deadlineIsExtended && gameBoxIsRecreatedCorrectly
        } else { false }
      } else { false }
    } else { false }
  }

  // ### Acción 3: Finalización del Juego
  val action3_endGame = {
    // La condición principal no cambia: solo se puede finalizar después del deadline.
    if (isAfterResolutionDeadline && OUTPUTS.size > 0) {
      val recreatedGameBoxes = OUTPUTS.filter({(b:Box) => blake2b256(b.propositionBytes) == END_GAME_SCRIPT_HASH})
      if (recreatedGameBoxes.size == 1) {
        val recreatedGameBox = recreatedGameBoxes(0)
        
        val gameBoxIsRecreatedCorrectly = {
          recreatedGameBox.tokens(0)._1 == gameNftId &&
          recreatedGameBox.R4[Int].get == gameState && gameState == 1 &&
          recreatedGameBox.R5[Coll[Byte]].get == seed &&
          recreatedGameBox.R6[(Coll[Byte], Coll[Byte])].get._1 == revealedS &&
          recreatedGameBox.R6[(Coll[Byte], Coll[Byte])].get._2 == winnerCandidateCommitment &&
          recreatedGameBox.R7[Coll[Coll[Byte]]].get == participatingJudges &&
          recreatedGameBox.R8[Coll[Long]].get(0) == deadline &&
          recreatedGameBox.R8[Coll[Long]].get(1) == creatorStake &&
          recreatedGameBox.R8[Coll[Long]].get(2) == participationFee &&
          recreatedGameBox.R8[Coll[Long]].get(3) == perJudgeComissionPercentage &&
          recreatedGameBox.R8[Coll[Long]].get(4) == creatorComissionPercentage &&
          recreatedGameBox.R8[Coll[Long]].get(5) == resolutionDeadline &&
          recreatedGameBox.R9[Coll[Coll[Byte]]].get == gameProvenance
        }

        gameBoxIsRecreatedCorrectly && box_value(recreatedGameBox) >= box_value(SELF)
      } else { false }
    } else {
      sigmaProp(false)
    }
  }

  val game_in_resolution = sigmaProp(gameState == 1)
  val actions = sigmaProp(action1_includeOmittedParticipation) || sigmaProp(action2_judgesInvalidate) || action3_endGame
  game_in_resolution && actions
}