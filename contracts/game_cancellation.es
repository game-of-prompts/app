{
  // =================================================================
  // === CONSTANTES
  // =================================================================

  // Denominador para calcular la porción del stake a drenar en cada acción.
  val STAKE_DENOMINATOR = 5L
  // Período de enfriamiento en bloques entre cada acción de drenaje.
  val COOLDOWN_IN_BLOCKS = 30L
  // Valor mínimo en nanoErgs que debe tener una caja para ser válida.
  val MinErg = 1000000L // 0.001 ERG

  // =================================================================
  // === DEFINICIONES DE REGISTROS (ESTADO DE CANCELACIÓN)
  // =================================================================

  // -- OLD --
  // R4: Long        - unlockHeight: Altura de bloque a partir de la cual se puede realizar el siguiente drenaje.
  // R5: Coll[Byte]  - revealedSecret: El secreto 'S' del juego, ya revelado.
  // R6: Long        - creatorStake: La cantidad actual (y decreciente) del stake del creador.
  // R7: Coll[Byte]  - ReadOnlyInfo: Un JSON (en bytes UTF-8) con datos inmutables del juego (ID del NFT, deadline original, etc.).

  // -- NEW --
  // R4: Integer     - Game state (0: Active, 1: Resolved, 2: Cancelled).
  // R5: Long        - unlockHeight: Altura de bloque a partir de la cual se puede realizar el siguiente drenaje.
  // R6: Coll[Byte]  - revealedSecret: El secreto 'S' del juego, ya revelado.
  // R7: Long        - creatorStake: La cantidad actual (y decreciente) del stake del creador.
  // R8: Coll[Byte]  - ReadOnlyInfo: Un JSON (en bytes UTF-8) con datos inmutables del juego (ID del NFT, deadline original, etc.).

  // =================================================================
  // === EXTRACCIÓN DE VALORES
  // =================================================================

  val unlockHeight = SELF.R4[Long].get
  val revealedSecret = SELF.R5[Coll[Byte]].get
  val currentStake = SELF.R6[Long].get
  val readOnlyInfo = SELF.R7[Coll[Byte]].get

  // El ID del NFT original del juego se extrae de los tokens de la propia caja.
  val gameNftId = SELF.tokens(0)._1

  // =================================================================
  // === ACCIONES DE GASTO
  // =================================================================

  // ### Acción 1: Drenar Stake (Bucle Principal)
  // Permite a cualquiera reclamar una porción del stake si ha pasado el cooldown
  // y si queda suficiente stake para continuar el ciclo.
  val action1_drainStake = {
    val recreatedCancellationBox = OUTPUTS(0)
    val claimerOutput = OUTPUTS(1)
    
    val stakePortionToClaim = currentStake / STAKE_DENOMINATOR
    val remainingStake = currentStake - stakePortionToClaim

    val cooldownIsOver = HEIGHT >= unlockHeight

    val claimerGetsPortion = claimerOutput.value >= stakePortionToClaim

    val boxIsRecreatedCorrectly = {
      recreatedCancellationBox.propositionBytes == SELF.propositionBytes &&
      recreatedCancellationBox.value >= remainingStake &&
      recreatedCancellationBox.tokens(0)._1 == gameNftId &&
      recreatedCancellationBox.R4[Long].get >= HEIGHT + COOLDOWN_IN_BLOCKS &&
      recreatedCancellationBox.R5[Coll[Byte]].get == revealedSecret &&
      recreatedCancellationBox.R6[Long].get == remainingStake &&
      recreatedCancellationBox.R7[Coll[Byte]].get == readOnlyInfo
    }
    
    claimerGetsPortion && boxIsRecreatedCorrectly
  }

  sigmaProp(action1_drainStake)
}