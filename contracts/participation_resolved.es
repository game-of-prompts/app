{
  // =================================================================
  // === CONSTANTES Y VALORES ÚTILES
  // =================================================================
  val JUDGE_PERIOD = 30L

  // =================================================================
  // === DEFINICIONES DE REGISTROS (PARTICIPACIÓN RESUELTA)
  // =================================================================

  // La estructura de registros es idéntica a la de 'participation_submitted.es'.
  // R4: Coll[Byte] - playerPKBytes: Clave pública del jugador.
  // R5: Coll[Byte] - commitmentC: Commitment criptográfico.
  // R6: Coll[Byte] - gameNftId: ID del NFT del juego.
  // R7: Coll[Byte] - solverId: ID del solver del jugador.
  // R8: Coll[Byte] - hashLogs: Hash de los logs del juego.
  // R9: Coll[Long] - scoreList: Lista de puntuaciones.
  
  // =================================================================
  // === LÓGICA DE GASTO
  // =================================================================

  // La caja principal del juego debe ser siempre la primera entrada en la transacción.
  val mainGameBox = INPUTS(0)
  val resolutionDeadline = mainGameBox.R7[Coll[Long]].get(3)

  // --- ACCIÓN 1: Gasto en la finalización normal del juego (EndGame) ---
  val isValidEndGame = {
    // 1. Verificar que esta participación pertenece a la caja del juego que se está gastando.
    val gameNftIdInSelf = SELF.R6[Coll[Byte]].get
    val gameLinkIsValid = mainGameBox.tokens(0)._1 == gameNftIdInSelf && mainGameBox.R4[Int].get == 1

    // 2. Verificar que el período de resolución/juicio ha terminado.
    val resolutionPeriodIsOver = HEIGHT >= resolutionDeadline

    gameLinkIsValid && resolutionPeriodIsOver
  }

  // --- ACCIÓN 2: Gasto cuando esta participación es invalidada por los jueces ---
  val isInvalidatedByJudges = {
    // 1. Verificar que la invalidación ocurre antes del deadline de resolución.
    val isBeforeDeadline = HEIGHT < resolutionDeadline
    
    // 2. Verificar que ESTA caja es la candidata a ganadora que se está invalidando.
    //    El commitment en R5 de esta caja debe coincidir con el del candidato en la caja del juego.
    val winnerCandidateCommitment = mainGameBox.R5[(Coll[Byte], Coll[Byte])].get._2
    val isTheInvalidatedCandidate = SELF.R5[Coll[Byte]].get == winnerCandidateCommitment

    if (isBeforeDeadline && isTheInvalidatedCandidate) {
      // 3. Verificar que la transacción recrea la caja del juego correctamente según las reglas de invalidación.
      val recreatedGameBox = OUTPUTS(0)
      
      // La caja recreada debe tener el mismo script que la original.
      val scriptIsPreserved = recreatedGameBox.propositionBytes == mainGameBox.propositionBytes
      
      // El deadline debe extenderse por el período de juicio.
      val deadlineIsExtended = recreatedGameBox.R7[Coll[Long]].get(3) >= resolutionDeadline + JUDGE_PERIOD
      
      // El contador de participantes resueltos debe disminuir en 1.
      val oldResolvedCounter = mainGameBox.R7[Coll[Long]].get(4)
      val counterIsDecreased = recreatedGameBox.R7[Coll[Long]].get(4) == oldResolvedCounter - 1  // Esta comprobación nos asegura que la acción realizada es una invalidación por los jueces.
      
      // Los fondos de esta caja deben ser devueltos al pozo de premios en la nueva caja del juego.
      val fundsAreReturned = recreatedGameBox.value >= mainGameBox.value + SELF.value
      
      // El nuevo candidato a ganador debe ser diferente al de esta caja.
      val newWinnerCommitment = recreatedGameBox.R5[(Coll[Byte], Coll[Byte])].get._2
      val winnerIsChanged = newWinnerCommitment != winnerCandidateCommitment

      scriptIsPreserved && deadlineIsExtended && counterIsDecreased && fundsAreReturned && winnerIsChanged
    } else {
      false
    }
  }

  // La caja se puede gastar si se cumple CUALQUIERA de las dos condiciones.
  sigmaProp(isValidEndGame || isInvalidatedByJudges)
}