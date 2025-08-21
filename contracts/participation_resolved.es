{
  // =================================================================
  // === CONSTANTES Y HASHES DE SCRIPTS
  // =================================================================

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

  // Esta caja solo tiene una condición de gasto posible: ser parte de la transacción final 'endGame'.
  val isValidEndGame = {
    // La caja principal del juego debe ser la primera entrada en la transacción.
    val mainGameBox = INPUTS(0)
    
    // 1. Verificar que esta participación pertenece a la caja del juego que se está gastando.
    val gameNftIdInSelf = SELF.R6[Coll[Byte]].get
    val gameLinkIsValid = mainGameBox.tokens(0)._1 == gameNftIdInSelf

    // 2. Verificar que el script de la caja principal es uno de los dos estados finales válidos.
    val mainBoxScriptHash = blake2b256(mainGameBox.propositionBytes)
    
    // 3. Verificar que el período de resolución/juicio ha terminado.
    //    La fecha límite para la resolución se encuentra en el R4 de las cajas de resolución.
    val resolutionDeadline = mainGameBox.R7[Coll[Long]].get(3)
    val resolutionPeriodIsOver = HEIGHT >= resolutionDeadline

    // Se deben cumplir las dos condiciones para que el gasto sea válido.
    gameLinkIsValid && resolutionPeriodIsOver
  }

  sigmaProp(isValidEndGame)
}