{
  // =================================================================
  // === CONSTANTES Y HASHES DE SCRIPTS
  // =================================================================

  // Hashes de los scripts a los que esta caja puede transicionar.
  // Estos valores deben ser reemplazados por los hashes reales de los scripts compilados.
  val GAME_RESOLUTION_SCRIPT_HASH = fromBase16("`+GAME_RESOLUTION_SCRIPT_HASH+`") 
  val GAME_CANCELLATION_SCRIPT_HASH = fromBase16("`+GAME_CANCELLATION_SCRIPT_HASH+`")
  
  // Hash del script de las participaciones.
  val PARTICIPATION_SCRIPT_HASH = fromBase16("`+PARTICIPATION_SCRIPT_HASH+`")

  // Constantes para la acción de cancelación.
  val STAKE_DENOMINATOR = 5L
  val COOLDOWN_IN_BLOCKS = 30L
  val JUDGE_PERIOD = 30L
  val MIN_BOX_VALUE = 1000000L
  val MAX_SCORE_LIST = 10

  // =================================================================
  // === DEFINICIONES DE REGISTROS (ESTADO ACTIVO)
  // =================================================================

  // R4: Integer            - Game state (0: Active, 1: Resolved, 2: Cancelled).
  // R5: (Coll[Byte], Long) - creatorInfo: (Script de gasto del creador, Porcentaje de comisión).
  // R6: Coll[Byte]         - secretHash: Hash del secreto 'S' (blake2b256(S)).
  // R7: Coll[Coll[Byte]]   - invitedJudgesReputationProofs
  // R8: Coll[Long]         - numericalParameters: [deadline, creatorStake, participationFee, perJudgeComissionPercentage].
  // R9: Coll[Byte]         - gameDetailsJsonHex: Detalles del juego en formato JSON/Hex.

  // =================================================================
  // === EXTRACCIÓN DE VALORES
  // =================================================================

  val gameState = SELF.R4[Int].get
  val creatorInfo = SELF.R5[(Coll[Byte], Long)].get
  val gameCreatorScript = creatorInfo._1
  
  val secretHash = SELF.R6[Coll[Byte]].get
  
  val numericalParams = SELF.R8[Coll[Long]].get
  val deadline = numericalParams(0)
  val creatorStake = numericalParams(1)
  val participationFee = numericalParams(2)
  val perJudgeComission = numericalParams(3)

  val gameDetailsJsonHex = SELF.R9[Coll[Byte]].get
  
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
      val resolutionBoxes = OUTPUTS.filter({ (box: Box) => 
        blake2b256(box.propositionBytes) == GAME_RESOLUTION_SCRIPT_HASH 
      })
      
      if (resolutionBoxes.size == 1) {
        val resolutionBox = resolutionBoxes(0)
        
        // La estructura de la nueva caja de resolución es (Coll[Byte], Coll[Byte])
        val r5Tuple = resolutionBox.R5[(Coll[Byte], Coll[Byte])].get
        val revealedS = r5Tuple._1
        val winnerCandidateCommitment = r5Tuple._2

        val sIsCorrectlyRevealed = blake2b256(revealedS) == secretHash
        val transitionsToResolutionScript = blake2b256(resolutionBox.propositionBytes) == GAME_RESOLUTION_SCRIPT_HASH
        
        val winnerCandidateValid = if (winnerCandidateCommitment == Coll[Byte]()) { true } 
          else {
            val winnerCandidateBoxes = CONTEXT.dataInputs.filter({ 
              (box: Box) => 
                blake2b256(box.propositionBytes) == PARTICIPATION_SCRIPT_HASH && 
                box.R6[Coll[Byte]].get == gameNftId &&
                box.R5[Coll[Byte]].get == winnerCandidateCommitment
            })

            if (winnerCandidateBoxes.size != 1) {
              false
            } else {
              val winnerCandidateBox = winnerCandidateBoxes(0)

              val pBoxScoreList = winnerCandidateBox.R9[Coll[Long]].get
              val pBoxCommitment = winnerCandidateBox.R5[Coll[Byte]].get
              val pBoxSolverId = winnerCandidateBox.R7[Coll[Byte]].get
              val pBoxLogsHash = winnerCandidateBox.R8[Coll[Byte]].get

              val validScoreExists = pBoxScoreList.fold(false, { (scoreAcc: Boolean, score: Long) =>
                if (scoreAcc) { scoreAcc } else {
                  val testCommitment = blake2b256(pBoxSolverId ++ longToByteArray(score) ++ pBoxLogsHash ++ revealedS)
                  if (testCommitment == pBoxCommitment) { true } else { scoreAcc }
                }
              })

              val correctParticipationFee = winnerCandidateBox.value >= participationFee
              val createdBeforeDeadline = winnerCandidateBox.creationInfo._1 < deadline

              validScoreExists && correctParticipationFee && createdBeforeDeadline && pBoxScoreList.size <= MAX_SCORE_LIST
            }
          }

        if (sIsCorrectlyRevealed && transitionsToResolutionScript && winnerCandidateValid) {
          
          // --- Judge validation ---
          val invitedJudges = SELF.R7[Coll[Coll[Byte]]].get
          val judgeProofDataInputs = CONTEXT.dataInputs
            .filter({(box: Box) =>
              // box.propositionBytes == REPUTATION_PROOF_BOX && 
              box.tokens.size == 1 &&
              // box.R4[Coll[Byte]].get == ACCPET_GAME_JUDGE_INVITATION_PUBLIC_GOOD_REPUTATION_SYSTEM_NFT_ID &&
              box.R5[Coll[Byte]].get == gameNftId &&
              box.R6[(Boolean, Long)].get._1
            })
          val participatingJudgesTokens = judgeProofDataInputs.map({(box: Box) => box.tokens(0)._1})

          val resolutionBoxIsValid = {
              resolutionBox.value >= creatorStake &&
              resolutionBox.tokens.filter({ (token: (Coll[Byte], Long)) => token._1 == gameNftId }).size == 1 &&
              resolutionBox.R4[Int].get == 1 && // El estado del juego pasa a "Resuelto" (1)
              resolutionBox.R6[Coll[Coll[Byte]]].get == participatingJudgesTokens &&
              resolutionBox.R7[Coll[Long]].get(0) == deadline &&
              resolutionBox.R7[Coll[Long]].get(1) == creatorStake &&
              resolutionBox.R7[Coll[Long]].get(2) == participationFee &&
              resolutionBox.R7[Coll[Long]].get(3) == perJudgeComission &&
              resolutionBox.R7[Coll[Long]].get(4) >= HEIGHT + JUDGE_PERIOD &&
              resolutionBox.R8[(Coll[Byte], Long)].get._2 == creatorInfo._2 &&
              resolutionBox.R9[(Coll[Byte], Coll[Byte])].get == (gameCreatorScript, gameDetailsJsonHex)
            }
            
            val judgesAreValid = {
              val sameSize = invitedJudges.size == participatingJudgesTokens.size
              val areTheSame = invitedJudges.forall({(tokenId: Coll[Byte]) => 
                  participatingJudgesTokens.exists({(jToken: Coll[Byte]) => jToken == tokenId})
              })
              sameSize && areTheSame
            }

          judgesAreValid && resolutionBoxIsValid
        } else { false }  // Invalid revealed secret, invalid transition script or invalid participation boxes.
      } else { false }  // There should be exactly one resolution box.
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

      // Calcular los valores iniciales.
      val initialStakePortionToClaim = creatorStake / STAKE_DENOMINATOR
      val initialRemainingStake = creatorStake - initialStakePortionToClaim

      // Asegurarse de que la caja de cancelación tenga al menos el valor mínimo requerido.
      val stakePortionToClaim = if (initialRemainingStake < MIN_BOX_VALUE) {
        creatorStake - MIN_BOX_VALUE
      } else {
        initialStakePortionToClaim
      }

      val remainingStake = if (initialRemainingStake < MIN_BOX_VALUE) {
        MIN_BOX_VALUE
      } else {
        initialRemainingStake
      }

      // --- 1. Validar la caja de cancelación (OUTPUTS(0)) ---
      val cancellationBoxIsValid = {
          blake2b256(cancellationBox.propositionBytes) == GAME_CANCELLATION_SCRIPT_HASH &&
          cancellationBox.value >= remainingStake &&
          cancellationBox.tokens.filter({ (token: (Coll[Byte], Long)) => token._1 == gameNftId }).size == 1 &&
          cancellationBox.R4[Int].get == 2 && // Game state is "Cancelled" (2)
          cancellationBox.R5[Long].get >= HEIGHT + COOLDOWN_IN_BLOCKS &&
          blake2b256(cancellationBox.R6[Coll[Byte]].get) == secretHash &&
          cancellationBox.R7[Long].get == remainingStake &&
          cancellationBox.R8[Long].get == deadline &&
          cancellationBox.R9[Coll[Byte]].get == gameDetailsJsonHex
      }
      
      // --- 2. Validar la salida para quien reclama (OUTPUTS(1)) ---
      val claimerOutputIsValid = claimerOutput.value >= stakePortionToClaim
      
      // El resultado final es verdadero solo si ambas cajas son válidas.
      cancellationBoxIsValid && claimerOutputIsValid

    } else { 
      false 
    }
  }

  val game_active = gameState == 0
  val actions = action1_transitionToResolution || action2_transitionToCancellation
  sigmaProp(game_active && actions)
}