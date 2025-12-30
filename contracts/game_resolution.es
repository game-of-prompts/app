{
  // =================================================================
  // === CONSTANTES Y HASHES DE SCRIPTS
  // =================================================================

  val JUDGE_PERIOD = `+JUDGE_PERIOD+`L
  val CREATOR_OMISSION_NO_PENALTY_PERIOD = `+CREATOR_OMISSION_NO_PENALTY_PERIOD+`L
  val END_GAME_AUTH_GRACE_PERIOD = `+END_GAME_AUTH_GRACE_PERIOD+`L
  val DEV_SCRIPT = fromBase16("`+DEV_SCRIPT+`")
  val DEV_COMMISSION_PERCENTAGE = `+DEV_COMMISSION_PERCENTAGE+`L
  val JUDGES_PAID_ERGOTREE = fromBase16("`+JUDGES_PAID_ERGOTREE+`")

  val PARTICIPATION_TYPE_ID = fromBase16("`+PARTICIPATION_TYPE_ID+`")
  val MAX_SCORE_LIST = `+MAX_SCORE_LIST+`L

  val PARTICIPATION_SCRIPT_HASH = fromBase16("`+PARTICIPATION_SCRIPT_HASH+`") 
  val REPUTATION_PROOF_SCRIPT_HASH = fromBase16("`+REPUTATION_PROOF_SCRIPT_HASH+`")
  
  val P2PK_ERGOTREE_PREFIX = fromBase16("0008cd")
  val MIN_ERG_BOX = 1000000L


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

  val min_value = if (participationTokenId == Coll[Byte]()) {
    MIN_ERG_BOX
  } else {
    0L
  }

  val box_value = { (box: Box) =>
    if (participationTokenId == Coll[Byte]()) {
      box.value
    } else {
      box.tokens.filter { (token: (Coll[Byte], Long)) => token._1 == participationTokenId }.fold(0L, { (acc: Long, token: (Coll[Byte], Long)) => acc + token._2 })
    }
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
          val newScore = omittedWinnerBox.R9[Coll[Long]].get.fold((-1L, false), { (acc: (Long, Boolean), score: Long) =>
            if (acc._2) { acc } else {
              val testCommitment = blake2b256(omittedWinnerBox.R7[Coll[Byte]].get ++ seed ++ longToByteArray(score) ++ omittedWinnerBox.R8[Coll[Byte]].get ++ omittedWinnerBox.R4[Coll[Byte]].get ++ revealedS)
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
                val currentCandidateScoreTuple = currentCandidateBox.R9[Coll[Long]].get.fold((-1L, false), { (acc: (Long, Boolean), score: Long) =>
                  if (acc._2) { acc } else {
                    val testCommitment = blake2b256(currentCandidateBox.R7[Coll[Byte]].get ++ seed ++ longToByteArray(score) ++ currentCandidateBox.R8[Coll[Byte]].get ++ currentCandidateBox.R4[Coll[Byte]].get ++ revealedS)
                    if (testCommitment == currentCandidateBox.R5[Coll[Byte]].get) { (score, true) } else { acc }
                  }
                })

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

              val pBoxErgotree = winnerCandidateBox.R4[Coll[Byte]].get
              val pBoxScoreList = winnerCandidateBox.R9[Coll[Long]].get
              val pBoxCommitment = winnerCandidateBox.R5[Coll[Byte]].get
              val pBoxSolverId = winnerCandidateBox.R7[Coll[Byte]].get
              val pBoxLogsHash = winnerCandidateBox.R8[Coll[Byte]].get

              val validScoreExists = pBoxScoreList.fold(false, { (scoreAcc: Boolean, score: Long) =>
                if (scoreAcc) { scoreAcc } else {
                  val testCommitment = blake2b256(pBoxSolverId ++ seed ++ longToByteArray(score) ++ pBoxLogsHash ++ pBoxErgotree ++ revealedS)
                  if (testCommitment == pBoxCommitment) { true } else { scoreAcc }
                }
              })

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

      // Requerimos autorización explícita: si hay candidato a ganador, debe firmar el ganador (clave en participationBox.R4),
      // si NO hay candidato, debe firmar el resolver.
      val authorizedToEnd: SigmaProp = {

        val resolverAuth: SigmaProp = {
          val prefix = resolverPK.slice(0, 3)
          val addr_content = resolverPK.slice(3, resolverPK.size)

          val isP2PK = prefix == P2PK_ERGOTREE_PREFIX
          if (isP2PK) {
            proveDlog(decodePoint(addr_content))
          }
          else {
            sigmaProp(INPUTS.exists({ (box: Box) => box.propositionBytes == resolverPK }))
          }
        }
        
        val winnerAuth: SigmaProp = {
          val winnerBoxes = INPUTS.filter({ (box: Box) => 
              blake2b256(box.propositionBytes) == PARTICIPATION_SCRIPT_HASH && 
              box.R5[Coll[Byte]].get == winnerCandidateCommitment 
          })
          if (winnerBoxes.size > 0) {
            val winnerPK = winnerBoxes(0).R4[Coll[Byte]].get
            val prefix = winnerPK.slice(0, 3)
            val addr_content = winnerPK.slice(3, winnerPK.size)

            val isP2PK = prefix == P2PK_ERGOTREE_PREFIX
            if (isP2PK) {
              proveDlog(decodePoint(addr_content))
            }
            else {
              sigmaProp(INPUTS.exists({ (box: Box) => box.propositionBytes == winnerPK }))
            }
          } else {
            // Si no se encuentra la caja del ganador, la autorización falla
            sigmaProp(false)
          }
        }

        if (winnerCandidateCommitment != Coll[Byte]()) {
          // winnerAuth || resolverAuth  // Raises "Malformed transaction: Scripts of all transaction inputs should pass verification. b32bbdd8dd9b5d92894439d0a60c1ba6201d727b9dbd5f419786f510046ad02d: #0 => Success((false,1712))"
          val isAfterResolutionDeadlineWithGracePeriod = HEIGHT >= resolutionDeadline + END_GAME_AUTH_GRACE_PERIOD
          if (isAfterResolutionDeadlineWithGracePeriod) {
            resolverAuth
          } else {
            winnerAuth
          }
        } else {
          resolverAuth
        }
      }

      // --- Valores y cálculos comunes para AMBOS CASOS (con y sin ganador) ---
      val participations = INPUTS.filter({ 
              (box: Box) => 
                blake2b256(box.propositionBytes) == PARTICIPATION_SCRIPT_HASH && 
                box.R6[Coll[Byte]].get == gameNftId
            })

      val prizePool = {
        val participationsAmount = participations.fold(0L, { (acc: Long, pBox: Box) => acc + box_value(pBox) })
        val contractPrize = box_value(SELF) - creatorStake
        participationsAmount + contractPrize
      }
      val judge_amount = participatingJudges.size

      // --- LÓGICA DE PAGO A JUECES Y DEV ---
      // Esta lógica ahora se aplica tanto si hay ganador como si no.
      val perJudgeComission = prizePool * perJudgeComissionPercentage / 100L
      val devCommission = prizePool * DEV_COMMISSION_PERCENTAGE / 100L

      // 1. Calcular payout final para el DEV (manejando polvo)
      val devForfeits = if (devCommission < min_value && devCommission > 0L) { devCommission } else { 0L }
      val finalDevPayout = devCommission - devForfeits
      
      // 2. Calcular payout final para los JUECES (manejando polvo)
      val totalJudgeComission = perJudgeComission * judge_amount
      val judgesForfeits = if (perJudgeComission < min_value && perJudgeComission > 0L) { totalJudgeComission } else { 0L } // Si el pago por juez es polvo, se pierde TODA la comisión.
      val finalJudgesPayout = totalJudgeComission - judgesForfeits
      
      // 3. Verificación de que el DEV recibe su pago
      val devGetsPaid = if (finalDevPayout > 0L) {
          val devInputValue = INPUTS.filter({(b:Box) => b.propositionBytes == DEV_SCRIPT}).fold(0L, { (acc: Long, b: Box) => acc + box_value(b) })
          val devOutputValue = OUTPUTS.filter({(b:Box) => b.propositionBytes == DEV_SCRIPT}).fold(0L, { (acc: Long, b: Box) => acc + box_value(b) })
          val devAddedValue = devOutputValue - devInputValue
          devAddedValue >= finalDevPayout
      } else { true }
      
      // 4. Verificación de que los JUECES reciben su pago (enviando a judges_paid.es)
      val judgesGetsPaid = if (finalJudgesPayout > 0L) {
          val judgesPaidBox = OUTPUTS.filter({(b:Box) => b.propositionBytes == JUDGES_PAID_ERGOTREE})
          if (judgesPaidBox.size == 1) {
             val box = judgesPaidBox(0)
             val correctValue = box_value(box) >= finalJudgesPayout
             val correctR4 = box.R4[Coll[Coll[Byte]]].get == participatingJudges
             val correctR5 = box.R5[Coll[Byte]].get == participationTokenId
             correctValue && correctR4 && correctR5
          } else {
             false
          }
      } else { true }

      // --- Manejar el caso CON y SIN ganador ---
      if (winnerCandidateCommitment != Coll[Byte]()) {
        // --- CASO 1: HAY UN GANADOR DECLARADO ---
        val winnerBoxes = participations.filter({ (box: Box) => box.R5[Coll[Byte]].get == winnerCandidateCommitment })

        if (winnerBoxes.size == 1) {
          val winnerBox = winnerBoxes(0)

          val validWinner = {
            val pBoxErgotree = winnerBox.R4[Coll[Byte]].get
            val pBoxScoreList = winnerBox.R9[Coll[Long]].get
            val pBoxCommitment = winnerBox.R5[Coll[Byte]].get
            val pBoxSolverId = winnerBox.R7[Coll[Byte]].get
            val pBoxLogsHash = winnerBox.R8[Coll[Byte]].get

            val validScoreExists = pBoxScoreList.fold(false, { (scoreAcc: Boolean, score: Long) =>
              if (scoreAcc) { scoreAcc } else {
                val testCommitment = blake2b256(pBoxSolverId ++ seed ++ longToByteArray(score) ++ pBoxLogsHash ++ pBoxErgotree ++ revealedS)
                if (testCommitment == pBoxCommitment) { true } else { scoreAcc }
              }
            })

            val correctParticipationFee = box_value(winnerBox) >= participationFee
            val createdBeforeDeadline = winnerBox.creationInfo._1 < deadline

            validScoreExists && correctParticipationFee && createdBeforeDeadline && pBoxScoreList.size <= MAX_SCORE_LIST
          }

          if (validWinner) {
            val winnerPK = winnerBox.R4[Coll[Byte]].get
            val resolverCommission = prizePool * creatorComissionPercentage / 100L
            
            // El premio se calcula restando los payouts finales (que ya consideran el polvo)
            val tentativeWinnerPrize = prizePool - resolverCommission - finalJudgesPayout - finalDevPayout

            // Lógica para asegurar que el ganador no reciba menos que la tarifa de participación (evitar pérdida neta)
            // Si el premio tentativo es menor, eliminamos todas las comisiones (dev, jueces, resolver) y el ganador recibe el prizePool completo
            val adjustedWinnerPrize = if (tentativeWinnerPrize < participationFee) prizePool else tentativeWinnerPrize
            val adjustedResolverCommission = if (tentativeWinnerPrize < participationFee) 0L else resolverCommission
            val adjustedDevPayout = if (tentativeWinnerPrize < participationFee) 0L else finalDevPayout
            val adjustedJudgesPayout = if (tentativeWinnerPrize < participationFee) 0L else finalJudgesPayout
            val adjustedPerJudge = if (tentativeWinnerPrize < participationFee) 0L else perJudgeComission

            /*
            * If the tentative winner prize is less than the participation fee, all commissions (resolver, dev, judges) are set to zero,
            * and the winner receives the entire prize pool. This ensures the winner never loses money (i.e., receives at least their participation fee back)
            * but may result in the winner receiving more than their intended percentage in low-participation or high-commission scenarios.
            */

            // Ajustar las verificaciones de pago para usar los valores ajustados
            val adjustedDevGetsPaid = if (adjustedDevPayout > 0L) {
                val devInputValue = INPUTS.filter({(b:Box) => b.propositionBytes == DEV_SCRIPT}).fold(0L, { (acc: Long, b: Box) => acc + box_value(b) })
                val devOutputValue = OUTPUTS.filter({(b:Box) => b.propositionBytes == DEV_SCRIPT}).fold(0L, { (acc: Long, b: Box) => acc + box_value(b) })
                val devAddedValue = devOutputValue - devInputValue
                val txFee = if (participationTokenId == Coll[Byte]()) { 10000000L } else { 0L }
                devAddedValue >= adjustedDevPayout - txFee
            } else { true }

            val adjustedJudgesGetsPaid = if (adjustedJudgesPayout > 0L) {
                val judgesPaidBox = OUTPUTS.filter({(b:Box) => b.propositionBytes == JUDGES_PAID_ERGOTREE})
                if (judgesPaidBox.size == 1) {
                   val box = judgesPaidBox(0)
                   val correctValue = box_value(box) >= adjustedJudgesPayout
                   val correctR4 = box.R4[Coll[Coll[Byte]]].get == participatingJudges
                   val correctR5 = box.R5[Coll[Byte]].get == participationTokenId
                   correctValue && correctR4 && correctR5
                } else {
                   false
                }
            } else { true }

            // Verificación de la salida del ganador
            val winnerGetsPaid = {
                val winnerInputValue = INPUTS.filter({(b:Box) => b.propositionBytes == winnerPK}).fold(0L, { (acc: Long, b: Box) => acc + box_value(b) })
                val winnerOutputValue = OUTPUTS.filter({(b:Box) => b.propositionBytes == winnerPK}).fold(0L, { (acc: Long, b: Box) => acc + box_value(b) })
                val winnerAddedValue = winnerOutputValue - winnerInputValue
                val txFee = if (participationTokenId == Coll[Byte]()) { 10000000L } else { 0L }
                val winnerHasNFT = OUTPUTS.exists({ (b: Box) =>
                    b.propositionBytes == winnerPK &&
                    b.tokens.size > 0 &&
                    b.tokens(0)._1 == gameNftId
                })
                winnerAddedValue >= adjustedWinnerPrize - txFee && winnerHasNFT
            }

            val finalResolverPayout = creatorStake + adjustedResolverCommission  // In case of erg, we know creator_stake > MIN_ERG_BOX.
            val resolverGetsPaid = {
                val resolverInputValue = INPUTS.filter({(b:Box) => b.propositionBytes == resolverPK}).fold(0L, { (acc: Long, b: Box) => acc + box_value(b) })
                val resolverOutputValue = OUTPUTS.filter({(b:Box) => b.propositionBytes == resolverPK}).fold(0L, { (acc: Long, b: Box) => acc + box_value(b) })
                val resolverAddedValue = resolverOutputValue - resolverInputValue
                resolverAddedValue >= finalResolverPayout
            }
            
            authorizedToEnd && sigmaProp(winnerGetsPaid && resolverGetsPaid && adjustedDevGetsPaid && adjustedJudgesGetsPaid)
          } else {
            sigmaProp(false)
          }
          
        } else {
          sigmaProp(false)
        }
      } else {
        // --- CASO 2: NO HAY GANADOR DECLARADO ---

        // El resolutor reclama el stake del creador y el pozo de premios.
        val totalValue = prizePool + creatorStake
        
        // Las comisiones de dev y jueces ya se han calculado y validado fuera.
        // El resolutor se lleva todo lo demás.
        val finalResolverPayout = totalValue - finalDevPayout - finalJudgesPayout

        val resolverGetsPaid = {
            val resolverInputValue = INPUTS.filter({(b:Box) => b.propositionBytes == resolverPK}).fold(0L, { (acc: Long, b: Box) => acc + box_value(b) })
            val resolverOutputValue = OUTPUTS.filter({(b:Box) => b.propositionBytes == resolverPK}).fold(0L, { (acc: Long, b: Box) => acc + box_value(b) })
            val resolverAddedValue = resolverOutputValue - resolverInputValue
            val txFee = if (participationTokenId == Coll[Byte]()) { 10000000L } else { 0L }
            val resolverHasNFT = OUTPUTS.exists({ (b: Box) =>
                b.propositionBytes == resolverPK &&
                b.tokens.size > 0 &&
                b.tokens(0)._1 == gameNftId
            })
            resolverAddedValue >= finalResolverPayout - txFee && resolverHasNFT
        }
        
        // La condición final ya incluye las validaciones movidas fuera.
        authorizedToEnd && sigmaProp(resolverGetsPaid && devGetsPaid && judgesGetsPaid)
      }
    } else {
      sigmaProp(false)
    }
  }

  val game_in_resolution = sigmaProp(gameState == 1)
  val actions = sigmaProp(action1_includeOmittedParticipation) || sigmaProp(action2_judgesInvalidate) || action3_endGame
  game_in_resolution && actions
}