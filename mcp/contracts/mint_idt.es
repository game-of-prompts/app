{
/*
    The function of the following contract is to ensure that the minted token can be spent exclusively 
    in the contract corresponding to the constant 'contract_bytes_hash'.
*/

    val contractBox = OUTPUTS(0)

    val correctSpend = {
        val isIDT = SELF.tokens(0)._1 == contractBox.tokens(0)._1
        val spendAll = SELF.tokens(0)._2 == contractBox.tokens(0)._2

        isIDT && spendAll
    }

    val correctContract = {
        fromBase16("`+contract_bytes_hash+`") == blake2b256(contractBox.propositionBytes)
    }

    sigmaProp(allOf(Coll(
        correctSpend,
        correctContract
    )))
}
