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

  // R4: Long        - unlockHeight: Altura de bloque a partir de la cual se puede realizar el siguiente drenaje.
  // R5: Coll[Byte]  - revealedSecret: El secreto 'S' del juego, ya revelado.
  // R6: Long        - creatorStake: La cantidad actual (y decreciente) del stake del creador.
  // R7: Coll[Byte]  - ReadOnlyInfo: Un JSON (en bytes UTF-8) con datos inmutables del juego (ID del NFT, deadline original, etc.).

  // =================================================================
  // === EXTRACCIÓN DE VALORES
  // =================================================================

  val unlockHeight = SELF.R4[Long].get
  val revealedSecret = SELF.R5[Coll[Byte]].get
  val currentStake = SELF.R6[Long].get
  val readOnlyInfo = SELF.R7[Coll[Byte]].get

  // El ID del NFT original del juego se extrae de los tokens de la propia caja.
  val gameNftId = SELF.tokens(0)._1
  
  // Condición para verificar si el período de enfriamiento ha pasado.
  val cooldownIsOver = HEIGHT >= unlockHeight

  // =================================================================
  // === ACCIONES DE GASTO
  // =================================================================

  // ### Acción 1: Drenar Stake (Bucle Principal)
  // Permite a cualquiera reclamar una porción del stake si ha pasado el cooldown
  // y si queda suficiente stake para continuar el ciclo.
  val action1_drainStake = {
    // Esta acción solo se puede realizar si el stake restante es suficiente para crear una nueva caja de cancelación y la recompensa.
    val stakeIsSufficient = currentStake > (MinErg + (currentStake / STAKE_DENOMINATOR))

    if (cooldownIsOver && stakeIsSufficient) {
      val recreatedCancellationBox = OUTPUTS(0)
      val claimerOutput = OUTPUTS(1)
      
      val stakePortionToClaim = currentStake / STAKE_DENOMINATOR
      val remainingStake = currentStake - stakePortionToClaim

      // 1. Validar la salida del reclamador.
      val claimerGetsPortion = claimerOutput.value >= stakePortionToClaim

      // 2. Validar que la caja de cancelación se recrea correctamente para el siguiente ciclo.
      val boxIsRecreatedCorrectly = {
        recreatedCancellationBox.propositionBytes == SELF.propositionBytes &&
        recreatedCancellationBox.value >= remainingStake &&
        recreatedCancellationBox.tokens(0)._1 == gameNftId && // Conserva el NFT original.
        recreatedCancellationBox.R4[Long].get >= HEIGHT + COOLDOWN_IN_BLOCKS && // Nuevo unlockHeight.
        recreatedCancellationBox.R5[Coll[Byte]].get == revealedSecret && // El secreto no cambia.
        recreatedCancellationBox.R6[Long].get == remainingStake && // El stake se reduce.
        recreatedCancellationBox.R7[Coll[Byte]].get == readOnlyInfo // La info no cambia.
      }
      
      claimerGetsPortion && boxIsRecreatedCorrectly
    } else { false }
  }

  // ### Acción 2: Finalizar Drenaje y Minting de NFT
  // Se ejecuta cuando el stake restante es demasiado pequeño para continuar el ciclo.
  // Envía el polvo restante al ejecutor y mintea un NFT como prueba de la cancelación final.
  val action2_finalizeDrain = {
    val stakeIsInsufficient = currentStake <= (MinErg + (currentStake / STAKE_DENOMINATOR))

    if (cooldownIsOver && stakeIsInsufficient) {
      val finalOutput = OUTPUTS(0)
      
      // 1. El primer token de la salida debe ser el nuevo NFT que se está minteando.
      //    Su ID es el ID de la caja que se gasta (SELF.id).
      val newTokenMinted = finalOutput.tokens(0)._1 == SELF.id && finalOutput.tokens(0)._2 == 1L

      // 2. El valor de la salida es el polvo de Ergs que quedaba en el stake.
      val dustIsClaimed = finalOutput.value >= currentStake

      // 3. (EIP-0004) Se pueblan los registros de la caja de salida para definir el NFT.
      val nftIsDefinedCorrectly = {
        // R4: Nombre del Token (String)
        finalOutput.R4[Coll[Byte]].isDefined &&
        // R5: Descripción del Token (String)
        finalOutput.R5[Coll[Byte]].isDefined &&
        // R6: Número de decimales (Int), debe ser 0 para un NFT.
        finalOutput.R6[Int].get == 0
        // R7: Tipo de Token (String), "NFT" según EIP-0022.
        // finalOutput.R7[Coll[Byte]].get == Coll[Byte]("NFT".utf8) &&
        // R8: Enlace a los assets (String)
        // finalOutput.R8[Coll[Byte]].isDefined &&
        // R9: Hash del archivo de assets (Coll[Byte])
        // finalOutput.R9[Coll[Byte]].isDefined
      }
      
      newTokenMinted && dustIsClaimed && nftIsDefinedCorrectly
    } else { false }
  }

  // La caja se puede gastar si se cumple una de las dos acciones.
  sigmaProp(action1_drainStake || action2_finalizeDrain)
}