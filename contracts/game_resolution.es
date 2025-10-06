{
  // =================================================================
  // === CONSTANTES Y HASHES DE SCRIPTS
  // =================================================================

  val JUDGE_PERIOD = 30L 
  val DEV_ADDR = PK("`+DEV_ADDR+`")
  val DEV_COMMISSION_PERCENTAGE = 5L
  val PARTICIPATION_SCRIPT_HASH = fromBase16("`+PARTICIPATION_SCRIPT_HASH+`") 
  val REPUTATION_PROOF_SCRIPT_HASH = fromBase16("`+REPUTATION_PROOF_SCRIPT_HASH+`")
  val P2PK_ERGOTREE_PREFIX = fromBase16("0008cd")
  val MIN_ERG_BOX = 1000000L
  val PARTICIPATION_TYPE_ID = fromBase16("`+PARTICIPATION_TYPE_ID+`")
  val MAX_SCORE_LIST = 10


  // =================================================================
  // === DEFINICIONES DE REGISTROS
  // =================================================================

  // R4: Integer                    - Game state (0: Active, 1: Resolved, 2: Cancelled).
  // R5: (Coll[Byte], Coll[Byte])   - (revealedSecretS, winnerCandidateCommitment): El secreto y el candidato a ganador.
  // R6: Coll[Coll[Byte]]           - participatingJudges: Lista de IDs de tokens de reputación de los jueces.
  // R7: Coll[Long]                 - numericalParams: [originalDeadline, creatorStake, participationFee, resolutionDeadline].
  // R8: (Coll[Byte], Long)         - resolverInfo: (Clave pública del "Resolvedor", % de comisión).
  // R9: (Coll[Byte], Coll[Byte])   - gameProvenance: (Clave pública del CREADOR ORIGINAL, Detalles del juego en JSON/Hex).

  // =================================================================
  // === EXTRACCIÓN DE VALORES
  // =================================================================

  val gameState = SELF.R4[Int].get

  val r5Tuple = SELF.R5[(Coll[Byte], Coll[Byte])].get
  val revealedS = r5Tuple._1
  val winnerCandidateCommitment = r5Tuple._2
  
  val participatingJudges = SELF.R6[Coll[Coll[Byte]]].get
  val numericalParams = SELF.R7[Coll[Long]].get
  val deadline = numericalParams(0)
  val creatorStake = numericalParams(1)
  val participationFee = numericalParams(2)
  val resolutionDeadline = numericalParams(3)

  val resolverInfo = SELF.R8[(Coll[Byte], Long)].get
  val resolverPK = resolverInfo._1
  val commissionPercentage = resolverInfo._2
  
  val gameNft = SELF.tokens(0)
  val gameNftId = gameNft._1

  val isAfterResolutionDeadline = HEIGHT >= resolutionDeadline
  val isBeforeResolutionDeadline = HEIGHT < resolutionDeadline

  // =================================================================
  // === ACCIONES DE GASTO
  // =================================================================

  // ### Acción 1: Incluir Participación Omitida (Versión Corregida y Mejorada)
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
        val recreatedGameBox = OUTPUTS(0)

        // Se verifica que la caja de participación enviada sea válida para este juego
        val omittedBoxIsValid = blake2b256(omittedWinnerBox.propositionBytes) == PARTICIPATION_SCRIPT_HASH &&
                                omittedWinnerBox.R6[Coll[Byte]].get == gameNftId &&
                                omittedWinnerBox.creationInfo._1 < deadline &&
                                omittedWinnerBox.value >= participationFee &&
                                omittedWinnerBox.R9[Coll[Long]].get.size <= MAX_SCORE_LIST

        if (omittedBoxIsValid) {
          // Se calcula el puntaje de la nueva participación revelando el secreto
          val newScore = omittedWinnerBox.R9[Coll[Long]].get.fold((-1L, false), { (acc: (Long, Boolean), score: Long) =>
            if (acc._2) { acc } else {
              val testCommitment = blake2b256(omittedWinnerBox.R7[Coll[Byte]].get ++ longToByteArray(score) ++ omittedWinnerBox.R8[Coll[Byte]].get ++ revealedS)
              if (testCommitment == omittedWinnerBox.R5[Coll[Byte]].get) { (score, true) } else { acc }
            }
          })._1

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
                val currentScore = currentCandidateBox.R9[Coll[Long]].get.fold((-1L, false), { (acc: (Long, Boolean), score: Long) =>
                  if (acc._2) { acc } else {
                    val testCommitment = blake2b256(currentCandidateBox.R7[Coll[Byte]].get ++ longToByteArray(score) ++ currentCandidateBox.R8[Coll[Byte]].get ++ revealedS)
                    if (testCommitment == currentCandidateBox.R5[Coll[Byte]].get) { (score, true) } else { acc }
                  }
                })._1

                // Se determina el nuevo ganador comparando puntajes y alturas de bloque
                if (newScore > currentScore || (newScore == currentScore && omittedWinnerBox.creationInfo._1 < currentCandidateBox.creationInfo._1)) {
                  omittedWinnerBox.R5[Coll[Byte]].get // El nuevo es mejor
                } else {
                  Coll[Byte]() // El actual sigue siendo el mejor
                }
              } else {
                // Si hay un compromiso pero no se provee la caja en dataInputs (o hay más de una), la transacción es inválida.
                Coll[Byte]()
              }
            }

            if (newWinnerCandidate != Coll[Byte]() && newWinnerCandidate != winnerCandidateCommitment) {

              // Verificación de la recreación de la caja del juego
              val gameBoxIsRecreatedCorrectly = {
                recreatedGameBox.propositionBytes == SELF.propositionBytes &&
                recreatedGameBox.R4[Int].get == gameState &&
                recreatedGameBox.tokens.size == 1 &&
                recreatedGameBox.tokens(0)._1 == gameNftId &&
                recreatedGameBox.R5[(Coll[Byte], Coll[Byte])].get == (revealedS, newWinnerCandidate) &&  // Se actualiza el candidato
                recreatedGameBox.R6[Coll[Coll[Byte]]].get == participatingJudges &&
                recreatedGameBox.R7[Coll[Long]].get(0) == deadline &&
                recreatedGameBox.R7[Coll[Long]].get(1) == creatorStake &&
                recreatedGameBox.R7[Coll[Long]].get(2) == participationFee &&
                recreatedGameBox.R7[Coll[Long]].get(3) == resolutionDeadline &&
                recreatedGameBox.R8[(Coll[Byte], Long)].get._2 == commissionPercentage &&
                recreatedGameBox.R9[(Coll[Byte], Coll[Byte])].get == SELF.R9[(Coll[Byte], Coll[Byte])].get
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
      val judgeVotes = CONTEXT.dataInputs.filter({(b:Box) => blake2b256(b.propositionBytes) == REPUTATION_PROOF_SCRIPT_HASH})
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

        val votesIntegrity = judgeVotes.forall( { (voteBox: Box) =>
          
          val allJudgesParticipate = participatingJudges.exists({ (pJudge: Coll[Byte]) => pJudge == voteBox.tokens(0)._1 })
          val isGoProofType = voteBox.R4[Coll[Byte]].get == PARTICIPATION_TYPE_ID
          val correctVoteTargetCommitment = voteBox.R5[Coll[Byte]].get == winnerCandidateCommitment
          
          allJudgesParticipate && isGoProofType && correctVoteTargetCommitment
        })

        allVotesAreUnique && votesIntegrity
      }

      val recreatedGameBoxes = OUTPUTS.filter({(b:Box) => b.propositionBytes == SELF.propositionBytes})
      
      if (votesAreValid && recreatedGameBoxes.size == 1) {
        
        val recreatedGameBox = recreatedGameBoxes(0)
        val participantInputs = CONTEXT.dataInputs.filter({(b:Box) => blake2b256(b.propositionBytes) == PARTICIPATION_SCRIPT_HASH})
        val invalidatedCandidateBoxes = INPUTS.filter({(b:Box) => blake2b256(b.propositionBytes) == PARTICIPATION_SCRIPT_HASH && b.R5[Coll[Byte]].get == winnerCandidateCommitment})
        if (invalidatedCandidateBoxes.size == 1) {
          val invalidatedCandidateBox = invalidatedCandidateBoxes(0)

          val initialFoldState = (-1L, Coll[Byte]()) // (maxScore, nextCandidateCommitment)
          // TODO Check
          // todo filter participantInputs with:  ¿?
          //   -  val correctParticipationFee = pBox.value >= participationFee
          //   -  val pBox.creationHeight <= game.resolutionDeadline
          // New deadline should be HEIGHT + JUDGE_PERIOD, not resolutionDeadline + JUDGE_PERIOD
          val foldResult = participantInputs.fold(initialFoldState, { (acc: (Long, Coll[Byte]), pBox: Box) =>
              if (pBox.R5[Coll[Byte]].get != winnerCandidateCommitment) {  // In case is duplicated, ignore the invalidated candidate box
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
          val deadlineIsExtended = recreatedGameBox.R7[Coll[Long]].get(3) >= resolutionDeadline + JUDGE_PERIOD
          val candidateIsReset = recreatedGameBox.R5[(Coll[Byte], Coll[Byte])].get._2 == nextCandidateCommitment
          val gameStateIsPreserved = recreatedGameBox.R4[Int].get == gameState && gameState == 1
          
          fundsReturnedToPool && deadlineIsExtended && candidateIsReset && gameStateIsPreserved
        } else { false }
      } else { false }
    } else { false }
  }

  // ### Acción 3: Finalización del Juego
  val action3_endGame = {
    // Requerimos autorización explícita: si hay candidato a ganador, debe firmar el ganador (clave en participationBox.R4),
    // si NO hay candidato, debe firmar el resolver.

    // Determinamos una SigmaProp que representa la autorización del que llama a finalizar
    val authorizedToEnd: SigmaProp = {
      if (winnerCandidateCommitment != Coll[Byte]()) {
        // Hay candidato a ganador: requerimos que la transacción esté firmada por la clave pública del ganador
        val winnerBoxes = INPUTS.filter({ (box: Box) => blake2b256(box.propositionBytes) == PARTICIPATION_SCRIPT_HASH && box.R5[Coll[Byte]].get == winnerCandidateCommitment })
        if (winnerBoxes.size > 0) {
          val winnerPK = winnerBoxes(0).R4[Coll[Byte]].get
          val prefix = winnerPK.slice(0, 3)
          val pubKey = winnerPK.slice(3, winnerPK.size)

          (sigmaProp(prefix == P2PK_ERGOTREE_PREFIX) && proveDlog(decodePoint(pubKey))) || sigmaProp(INPUTS.exists({ (box: Box) => box.propositionBytes == winnerPK }))
        } else {
          // No se puede verificar la clave del ganador -> denegado
          sigmaProp(false)
        }
      } else {
        // No hay candidato: requerimos que la transacción esté firmada por la clave del creador
        // Asumiendo que P2PK_ERGOTREE_PREFIX está definido como Coll[Byte](0, 8, -51) o fromBase16("0008cd")
        val prefix = resolverPK.slice(0, 3)
        val pubKey = resolverPK.slice(3, resolverPK.size)

        (sigmaProp(prefix == P2PK_ERGOTREE_PREFIX) && proveDlog(decodePoint(pubKey))) ||
        sigmaProp(INPUTS.exists({ (box: Box) => box.propositionBytes == resolverPK }))
      }
    }

    // La condición principal no cambia: solo se puede finalizar después del deadline.
    if (isAfterResolutionDeadline && OUTPUTS.size > 0) {

      // Valores comunes para ambos casos (con y sin ganador)
      val participations = INPUTS.filter({ (box: Box) => blake2b256(box.propositionBytes) == PARTICIPATION_SCRIPT_HASH })
      val prizePool = participations.fold(0L, { (acc: Long, pBox: Box) => acc + pBox.value })
      
      // --- MEJORA 3: Manejar el caso CON y SIN ganador ---
      if (winnerCandidateCommitment != Coll[Byte]()) {
        // --- CASO 1: HAY UN GANADOR DECLARADO ---

        // --- MEJORA 1: Verificación segura del input del ganador ---
        val winnerBoxes = participations.filter({ (box: Box) => box.R5[Coll[Byte]].get == winnerCandidateCommitment })

        // Solo continuamos si se encuentra exactamente una caja de participación para el ganador.
        if (winnerBoxes.size > 0) {  // Maybe there are more than one box with the same commitment, but at least one. (it's secure because the commitment includes the public key)
        
          // La lógica de cálculo de pagos es la misma que la original.
          val resolverCommission = prizePool * commissionPercentage / 100L
          val devCommission = prizePool * DEV_COMMISSION_PERCENTAGE / 100L
          val winnerBasePrize = prizePool - resolverCommission - devCommission

          val winnerGetsBasePrize = winnerBasePrize >= MIN_ERG_BOX

          val intermediateDevPayout = if (winnerGetsBasePrize) { devCommission } else { 0L }
          val intermediateResolverPayout = if (winnerGetsBasePrize) { creatorStake + resolverCommission } else { creatorStake }
          val intermediateWinnerPayout = if (winnerGetsBasePrize) { winnerBasePrize } else { prizePool + creatorStake }

          val devForfeits = if (intermediateDevPayout < MIN_ERG_BOX && intermediateDevPayout > 0L) { intermediateDevPayout } else { 0L }
          val resolverForfeits = if (intermediateResolverPayout < MIN_ERG_BOX && intermediateResolverPayout > 0L) { intermediateResolverPayout } else { 0L }

          val finalDevPayout = intermediateDevPayout - devForfeits
          val finalResolverPayout = intermediateResolverPayout - resolverForfeits
          val finalWinnerPrize = intermediateWinnerPayout + devForfeits + resolverForfeits

          val winnerGetsPaid = true /* Signs the winner, so we don't need to check it again.
           .exists({ (b: Box) =>
              b.value >= finalWinnerPrize &&
              b.propositionBytes == (P2PK_ERGOTREE_PREFIX ++ winnerPK) &&
              b.tokens.size == 1 && // Buena práctica: asegurar que solo está el NFT
              b.tokens(0)._1 == gameNftId
          }) */

          val resolverGetsPaid = if (finalResolverPayout > 0L) {
              OUTPUTS.exists({(b:Box) => b.value >= finalResolverPayout && b.propositionBytes == resolverPK})
          } else { true }
          
          val devGetsPaid = if (finalDevPayout > 0L) {
              OUTPUTS.exists({(b:Box) => b.value >= finalDevPayout && b.propositionBytes == DEV_ADDR.propBytes})
          } else { true }

          authorizedToEnd && sigmaProp(winnerGetsPaid && resolverGetsPaid && devGetsPaid)
        } else {
          // Si no se encuentra la caja del ganador, la transacción es inválida.
          sigmaProp(false)
        }
      } else {
        // --- CASO 2: NO HAY GANADOR DECLARADO ---

        // El resolutor reclama el stake del creador y el pozo de premios, pagando la comisión del dev.
        val totalValue = prizePool + creatorStake
        val devCommission = prizePool * DEV_COMMISSION_PERCENTAGE / 100L

        // Lógica de polvo para la comisión del desarrollador.
        val devForfeits = if (devCommission < MIN_ERG_BOX && devCommission > 0L) { devCommission } else { 0L }
        val finalDevPayout = devCommission - devForfeits
        
        // El resolutor se lleva todo lo demás.
        val finalResolverPayout = totalValue - finalDevPayout

        // Verificación de las salidas para el caso sin ganador.
        val resolverGetsPaid = OUTPUTS.exists({ (b: Box) =>
            b.value >= finalResolverPayout &&
            b.propositionBytes == resolverPK &&
            b.tokens.size == 1 && // El resolutor recibe el NFT
            b.tokens(0)._1 == gameNftId
        })
        
        val devGetsPaid = if (finalDevPayout > 0L) {
            OUTPUTS.exists({(b:Box) => b.value >= finalDevPayout && b.propositionBytes == DEV_ADDR.propBytes})
        } else { true }
        
        authorizedToEnd && sigmaProp(resolverGetsPaid && devGetsPaid)
      }
    } else {
      sigmaProp(false)
    }
  }

  val game_in_resolution = sigmaProp(gameState == 1)
  val actions = sigmaProp(action1_includeOmittedParticipation) || sigmaProp(action2_judgesInvalidate) || action3_endGame
  game_in_resolution && actions
}
