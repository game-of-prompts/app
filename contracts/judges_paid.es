{
  // =================================================================
  // === CONSTANTES
  // =================================================================
  val REPUTATION_PROOF_SCRIPT_HASH = fromBase16("`+REPUTATION_PROOF_SCRIPT_HASH+`")
  
  // =================================================================
  // === REGISTROS
  // =================================================================
  // R4: Coll[Coll[Byte]] - participatingJudges: Lista de IDs de tokens de reputación de los jueces.
  // R5: Coll[Byte]       - participationTokenId: ID del token de participación (o vacío si es ERG).

  val participatingJudges = SELF.R4[Coll[Coll[Byte]]].get
  val participationTokenId = SELF.R5[Coll[Byte]].get

  // =================================================================
  // === FUNCIONES AUXILIARES
  // =================================================================

  val box_value = { (box: Box) =>
    if (participationTokenId == Coll[Byte]()) {
      box.value
    } else {
      box.tokens.filter { (token: (Coll[Byte], Long)) => token._1 == participationTokenId }.fold(0L, { (acc: Long, token: (Coll[Byte], Long)) => acc + token._2 })
    }
  }

  // =================================================================
  // === LÓGICA PRINCIPAL
  // =================================================================

  val judge_amount = participatingJudges.size
  val total_funds = box_value(SELF)
  
  // Si no hay fondos o no hay jueces, permitimos gastar (aunque no debería ocurrir si se crea correctamente)
  if (total_funds > 0L && judge_amount > 0) {
    
    val perJudgeComission = total_funds / judge_amount

    // 1) Filtramos una sola vez los judge boxes relevantes de los dataInputs
    val judgeBoxes = CONTEXT.dataInputs.filter { (b: Box) =>
      blake2b256(b.propositionBytes) == REPUTATION_PROOF_SCRIPT_HASH &&
      b.tokens.size > 0 &&
      participatingJudges.exists({ (tokenId: Coll[Byte]) => tokenId == b.tokens(0)._1 })
    }

    // 2) Extraemos pares (address, tokenId)
    val judgeEntries = judgeBoxes.map { (b: Box) =>
      (b.R7[Coll[Byte]].get, b.tokens(0)._1)
    }

    val judgeAddrs = judgeEntries.map { (e: (Coll[Byte], Coll[Byte])) => e._1 }
    val judgeTokenIds = judgeEntries.map { (e: (Coll[Byte], Coll[Byte])) => e._2 }

    // 3) Comprobaciones estructurales mínimas
    val uniqueTokensOk =
      judgeTokenIds.forall { (id: Coll[Byte]) =>
        judgeTokenIds.filter({ (x: Coll[Byte]) => x == id }).size == 1
      }

    val allJudgesFound = judgeBoxes.size == judge_amount && uniqueTokensOk

    if (!uniqueTokensOk || !allJudgesFound) {
      false
    } else {
      // 4) Para cada dirección distinta: cuántos judges apuntan a ella (occurrences)
      val uniqueAddrs = 
        judgeAddrs.fold(Coll[Coll[Byte]](), { (acc: Coll[Coll[Byte]], addr: Coll[Byte]) =>
          if (acc.exists({ (a: Coll[Byte]) => a == addr })) {
            acc
          } else {
            acc ++ Coll(addr)
          }
        })

      val addrChecks = uniqueAddrs.forall { (addr: Coll[Byte]) =>
        // cuántos judges usan esta misma dirección
        val occurrences = judgeAddrs.fold(0, { (acc: Int, a: Coll[Byte]) => if (a == addr) acc + 1 else acc })

        // valor total entrante y saliente para esa dirección
        val inValue = INPUTS.filter({ (b: Box) => b.propositionBytes == addr })
                            .fold(0L, { (acc: Long, b: Box) => acc + box_value(b) })
        val outValue = OUTPUTS.filter({ (b: Box) => b.propositionBytes == addr })
                              .fold(0L, { (acc: Long, b: Box) => acc + box_value(b) })
        val received = outValue - inValue

        // recibir al menos perJudgeComission * occurrences
        val amountOk = received >= (perJudgeComission * occurrences)

        amountOk
      }

      // 5) comprobación total (opcional, por seguridad contable)
      // En este contrato, SELF se consume, por lo que el total recibido por los jueces debe ser al menos el valor de SELF (menos posibles restos de división si no es exacta, pero aquí dividimos enteros)
      // Nota: perJudgeComission * judge_amount puede ser <= total_funds debido al redondeo hacia abajo.
      // El remanente se lo puede quedar el que ejecuta la tx (minero/ejecutor) o quemarse.
      
      addrChecks
    }
  } else {
    true
  }
}
