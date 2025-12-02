{
  // =================================================================
  // === CONSTANTES
  // =================================================================

  // Denominador para calcular la porción del stake a drenar en cada acción.
  val STAKE_DENOMINATOR = `+STAKE_DENOMINATOR+`L

  // Período de enfriamiento en bloques entre cada acción de drenaje.
  val COOLDOWN_IN_BLOCKS = `+COOLDOWN_IN_BLOCKS+`L

  // Valor mínimo en nanoErgs que debe tener una caja para ser válida.
  val MinErg = 1000000L // 0.001 ERG

  // =================================================================
  // === DEFINICIONES DE REGISTROS (ESTADO DE CANCELACIÓN)
  // =================================================================

  // R4: Integer           - Game state (0: Active, 1: Resolved, 2: Cancelled).
  // R5: Long              - unlockHeight: Altura de bloque a partir de la cual se puede realizar el siguiente drenaje.
  // R6: Coll[Byte]        - revealedSecret: El secreto 'S' del juego, ya revelado.
  // R7: Long              - creatorStake: La cantidad actual (y decreciente) del stake del creador.
  // R8  Long              - originalDeadline
  // R9: Coll[Coll[Byte]]  - gameDetailsJsonHex, ParticipationTokenID

  // =================================================================
  // === EXTRACCIÓN DE VALORES
  // =================================================================

  val gameState = SELF.R4[Int].get
  val unlockHeight = SELF.R5[Long].get
  val revealedSecret = SELF.R6[Coll[Byte]].get
  val currentStake = SELF.R7[Long].get
  val originalDeadline = SELF.R8[Long].get
  val gameProvenance = SELF.R9[Coll[Coll[Byte]]].get
  val gameDetailsJsonHex = gameProvenance(0)
  val participationTokenId = gameProvenance(1)


  // El ID del NFT original del juego se extrae de los tokens de la propia caja.
  val gameNftId = SELF.tokens(0)._1
  val gameIsCancelled = gameState == 2

  // =================================================================
  // === ACCIONES DE GASTO
  // =================================================================

  // ### Acción 1: Drenar Stake (Bucle Principal)
  // Permite a cualquiera reclamar una porción del stake si ha pasado el cooldown
  // y si queda suficiente stake para continuar el ciclo.
  val action1_drainStake = {
    val recreatedCancellationBox = OUTPUTS(0)
    
    val stakePortionToClaim = currentStake / STAKE_DENOMINATOR
    val remainingStake = currentStake - stakePortionToClaim

    val cooldownIsOver = HEIGHT >= unlockHeight

    val recreatedValue = if(participationTokenId.size == 0) {
      recreatedCancellationBox.value
    } else {
      val matchingTokens = recreatedCancellationBox.tokens.filter { (token: (Coll[Byte], Long)) => 
        token._1 == participationTokenId
      }
      if (matchingTokens.size > 0) {
        matchingTokens(0)._2
      } else {
        0L
      }
    }

    val boxIsRecreatedCorrectly = {
      recreatedCancellationBox.propositionBytes == SELF.propositionBytes &&
      recreatedValue >= remainingStake &&
      recreatedCancellationBox.tokens(0)._1 == gameNftId &&
      recreatedCancellationBox.R4[Int].get == gameState &&
      recreatedCancellationBox.R5[Long].get >= HEIGHT + COOLDOWN_IN_BLOCKS &&
      recreatedCancellationBox.R6[Coll[Byte]].get == revealedSecret &&
      recreatedCancellationBox.R7[Long].get == remainingStake &&
      recreatedCancellationBox.R8[Long].get == originalDeadline &&
      recreatedCancellationBox.R9[Coll[Coll[Byte]]].get == gameProvenance
    }
    
    cooldownIsOver && boxIsRecreatedCorrectly
  }

  sigmaProp(gameIsCancelled && action1_drainStake)
}