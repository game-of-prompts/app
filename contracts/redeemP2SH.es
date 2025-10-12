{
  // R4: Coll[Byte] - Blake2b256 hash of the final recipient's contract
  val recipientScriptHash = SELF.R4[Coll[Byte]].get

  // The funds of the redeem contract goes to the recipient.
  sigmaProp(OUTPUTS.exists( {(output: Box) =>
        blake2b256(output.propositionBytes) == recipientScriptHash &&
        output.value >= SELF.value &&
        output.tokens == SELF.tokens  // Expects the same set of tokens in the same order.
   }))
}