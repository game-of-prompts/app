{
  // =================================================================
  // === CONSTANTES Y HASHES DE SCRIPTS
  // =================================================================

  // Hashes de los scripts a los que esta caja puede transicionar.
  // Estos valores deben ser reemplazados por los hashes reales de los scripts compilados.
  val GAME_RESOLUTION_SCRIPT_HASH = fromBase16("`+GAME_RESOLUTION_SCRIPT_HASH+`") 
  val GAME_CANCELLATION_SCRIPT_HASH = fromBase16("`+GAME_CANCELLATION_SCRIPT_HASH+`")
  
  // Hash del script que gobierna las cajas de participación de los jugadores.
  val PARTICIPATION_SUBMITED_SCRIPT_HASH = fromBase16("`+PARTICIPATION_SUBMITED_SCRIPT_HASH+`")

  // Hash del script de las participaciones una vez que el juego ha pasado a la fase de resolución.
  val PARTICIPATION_RESOLVED_SCRIPT_HASH = fromBase16("`+PARTICIPATION_RESOLVED_SCRIPT_HASH+`")

  // Constantes para la acción de cancelación.
  val STAKE_DENOMINATOR = 5L
  val COOLDOWN_IN_BLOCKS = 30L
  val JUDGE_PERIOD = 30L

  // =================================================================
  // === DEFINICIONES DE REGISTROS (ESTADO ACTIVO)
  // =================================================================

  // R4: (Coll[Byte], Long) - creatorInfo: (Clave pública del creador, Porcentaje de comisión).
  // R5: Coll[Byte]        - secretHash: Hash del secreto 'S' (blake2b256(S)).
  // R6: Coll[Coll[Byte]]  - invitedJudgesReputationProofs
  // R7: Coll[Long]        - numericalParameters: [deadline, creatorStake, participationFee].
  // R8: Coll[Byte]        - gameDetailsJsonHex: Detalles del juego en formato JSON/Hex.
  
  // =================================================================
  // === EXTRACCIÓN DE VALORES
  // =================================================================

  val creatorInfo = SELF.R4[(Coll[Byte], Long)].get
  val gameCreatorPK = creatorInfo._1
  
  val secretHash = SELF.R5[Coll[Byte]].get
  
  val numericalParams = SELF.R7[Coll[Long]].get
  val deadline = numericalParams(0)
  val creatorStake = numericalParams(1)
  val participationFee = numericalParams(2)
  val gameDetailsJsonHex = SELF.R8[Coll[Byte]].get
  
  val gameNft = SELF.tokens(0)
  val gameNftId = gameNft._1

  val isAfterDeadline = HEIGHT >= deadline
  val isBeforeDeadline = HEIGHT < deadline

  // =================================================================
  // === ACCIÓN 1: TRANSICIÓN A RESOLUCIÓN
  // =================================================================
  // Se ejecuta después de la fecha límite para iniciar la fase de resolución.
  // Consume esta caja y todas las participaciones, y lee las pruebas de los jueces como dataInputs.

  val action1_transitionToResolution = {
    if (isAfterDeadline) {
      val resolutionBox = OUTPUTS(0)
      
      // La estructura de la nueva caja de resolución es (Coll[Byte], Coll[Byte])
      val r5Tuple = resolutionBox.R5[(Coll[Byte], Coll[Byte])].get
      val revealedS = r5Tuple._1
      val winnerCandidateCommitment = r5Tuple._2

      val sIsCorrectlyRevealed = blake2b256(revealedS) == secretHash
      val transitionsToResolutionScript = blake2b256(resolutionBox.propositionBytes) == GAME_RESOLUTION_SCRIPT_HASH
      
      val participantInputs = INPUTS.filter({ (box: Box) => box.propositionBytes == PARTICIPATION_SUBMITED_SCRIPT_HASH })
      val participantOutputs = OUTPUTS.filter({ (box: Box) => box.propositionBytes == PARTICIPATION_RESOLVED_SCRIPT_HASH })

      if (sIsCorrectlyRevealed && transitionsToResolutionScript && participantInputs.size == participantOutputs.size) {
        val initialFoldState = (-1L, (Coll[Byte](), 0)) // (maxScore, winnerCommitment, validParticipantsCount)

        val foldResult = participantInputs.fold(initialFoldState, { 
          (acc: (Long, (Coll[Byte], Int)), pBox: Box) => {
            val validScript = blake2b256(pBox.propositionBytes) == PARTICIPATION_SUBMITED_SCRIPT_HASH
            val pointsToTheGame = pBox.R6[Coll[Byte]].get == gameNftId

            if (validScript && pointsToTheGame) {
              val pBoxScoreList = pBox.R9[Coll[Long]].get
              val pBoxCommitment = pBox.R5[Coll[Byte]].get
              val pBoxSolverId = pBox.R7[Coll[Byte]].get
              val pBoxLogsHash = pBox.R8[Coll[Byte]].get

              val scoreCheckResult = pBoxScoreList.fold((-1L, false), { (scoreAcc: (Long, Boolean), score: Long) =>
                if (scoreAcc._2) { scoreAcc } else {
                  val testCommitment = blake2b256(pBoxSolverId ++ longToByteArray(score) ++ pBoxLogsHash ++ revealedS)
                  if (testCommitment == pBoxCommitment) { (score, true) } else { scoreAcc }
                }
              })
              val actualScore = scoreCheckResult._1
              val isValidParticipant = {

                val validScoreExists = scoreCheckResult._2
                val correctParticipationFee = pBox.value >= participationFee

                val resolvedOutputExists = OUTPUTS.exists({ (outBox: Box) =>
                  blake2b256(outBox.propositionBytes) == PARTICIPATION_RESOLVED_SCRIPT_HASH &&
                  outBox.value == pBox.value &&
                  outBox.R4[Coll[Byte]].get == pBox.R4[Coll[Byte]].get &&
                  outBox.R5[Coll[Byte]].get == pBox.R5[Coll[Byte]].get && 
                  outBox.R6[Coll[Byte]].get == pBox.R6[Coll[Byte]].get
                })

                validScoreExists && correctParticipationFee && resolvedOutputExists
              }
              
              if (isValidParticipant && actualScore > acc._1) 
              {
                (actualScore, (pBoxCommitment, acc._2._2 + 1))
              }
              else if (isValidParticipant) 
              {
                (acc._1, (acc._2._1, acc._2._2 + 1))
              }
              else { acc }  // Not valid participation (real score not found)
            } 
            else { acc }  // Not valid participation (invalid script or not points to the game)
          }
        })
        
        if (foldResult._1 > -1L) {
          val initialWinnerCommitment = foldResult._2._1
          val validParticipantsCounter = foldResult._2._2

          if (validParticipantsCounter == participantInputs.size) {

            // --- Validación de Jueces ---
            val invitedJudges = SELF.R6[Coll[Coll[Byte]]].get
            val judgeProofDataInputs = CONTEXT.dataInputs
            /* .filter({(box: Box) => 
              box.propositionBytes == REPUTATION_PROOF_BOX && 
              box.R4[Coll[Byte]].get == ACCPET_GAME_JUDGE_INVITATION_PUBLIC_GOOD_REPUTATION_SYSTEM_NFT_ID &&
              box.R5[Coll[Byte]].get == gameNftId &&
              box.R6[(Boolean, Long)].get._1
            })*/
            val participatingJudgesTokens = judgeProofDataInputs.map({(box: Box) => box.tokens(0)._1})
            
            val judgesAreValid = {
              val sameSize = invitedJudges.size == participatingJudgesTokens.size
              val areTheSame = invitedJudges.forall({(tokenId: Coll[Byte]) => 
                  participatingJudgesTokens.exists({(jToken: Coll[Byte]) => jToken == tokenId})
              })
              sameSize && areTheSame
            }

            val resolutionBoxIsValid = {
              winnerCandidateCommitment == initialWinnerCommitment &&
              resolutionBox.value >= creatorStake &&
              resolutionBox.tokens.filter({ (token: (Coll[Byte], Long)) => token._1 == gameNftId }).size == 1 &&
              resolutionBox.R4[(Long, Int)].get == (HEIGHT + JUDGE_PERIOD, validParticipantsCounter) &&
              resolutionBox.R6[Coll[Coll[Byte]]].get == participatingJudgesTokens &&
              resolutionBox.R7[Coll[Long]].get == numericalParams &&
              resolutionBox.R8[(Coll[Byte], Long)].get == creatorInfo &&
              // resolutionBox.R8[(Coll[Byte], Long)].get._2 == creatorInfo._2 &&
              resolutionBox.R9[(Coll[Byte], Coll[Byte])].get == (gameCreatorPK, gameDetailsJsonHex)
            }

            judgesAreValid && resolutionBoxIsValid

          } else { false }  // Inputs (1-n) were not valid participation boxes.
        } else { false }  // Must be at least one valid participation box.
      } else { false }  // Invalid revealed secret, invalid transition script or invalid participation boxes.
    } else { false }  // Deadline not reached.
  }

  // =================================================================
  // === ACCIÓN 2: TRANSICIÓN A CANCELACIÓN
  // =================================================================
  // Se ejecuta antes de la fecha límite si alguien revela el secreto para penalizar al creador.

  val action2_transitionToCancellation = {
    if (isBeforeDeadline && OUTPUTS.size >= 2) {
      val cancellationBox = OUTPUTS(0)
      val claimerOutput = OUTPUTS(1)

      // El secreto 'S' debe ser revelado en el R5 de la nueva caja de cancelación.
      val r5Tuple = cancellationBox.R5[(Long, Coll[Byte])].get
      val revealedS = r5Tuple._2
      val sIsCorrectlyRevealed = blake2b256(revealedS) == secretHash

      val transitionsToCancellationScript = blake2b256(cancellationBox.propositionBytes) == GAME_CANCELLATION_SCRIPT_HASH

      if (sIsCorrectlyRevealed && transitionsToCancellationScript) {
        val stakePortionToClaim = creatorStake / STAKE_DENOMINATOR
        val remainingStake = creatorStake - stakePortionToClaim
        
        val claimerGetsPortion = claimerOutput.value >= stakePortionToClaim
        
        // Validar la creación de la nueva caja 'game_cancellation.es'.
        val cancellationBoxIsValid = {
            cancellationBox.value >= remainingStake &&
            cancellationBox.tokens.filter({ (token: (Coll[Byte], Long)) => token._1 == gameNftId }).size == 1 &&
            r5Tuple._1 >= HEIGHT + COOLDOWN_IN_BLOCKS && // El nuevo 'unlockHeight'.
            // Validar que los otros registros importantes se mantienen.
            cancellationBox.R4[(Coll[Byte], Long)].get == creatorInfo && // ESTO ESTA MAL, R4 ES EL unlockHeight.
            cancellationBox.R7[Coll[Long]].get == numericalParams
        }
        
        claimerGetsPortion && cancellationBoxIsValid
      } else { false }
    } else { false }
  }

  // Se permite el gasto si se cumple una de las dos transiciones de estado.
  sigmaProp(action1_transitionToResolution || action2_transitionToCancellation)
}