// From https://github.com/fleet-sdk/fleet-by-example/blob/master/tests/timedFundContract.spec.ts
// Only to check if mock-chain works and how to.

import { MockChain } from "@fleet-sdk/mock-chain";
import { compile } from "@fleet-sdk/compiler";
import {
  SInt,
  SSigmaProp,
  SGroupElement,
  TransactionBuilder,
  OutputBuilder
} from "@fleet-sdk/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("Timed fund contract", () => {
  // set up the mock chain
  const mockChain = new MockChain({ height: 1_052_944 });
  const deadline = mockChain.height + 500;

  // add parties
  const alice = mockChain.newParty("Alice");
  const bob = mockChain.newParty("Bob");

  // compile the contract script
  const ergoTree = compile("(alicePK && HEIGHT > deadline) || (bobPK && HEIGHT <= deadline)", {
    map: {
      alicePK: SSigmaProp(SGroupElement(alice.key.publicKey)),
      bobPK: SSigmaProp(SGroupElement(bob.key.publicKey)),
      deadline: SInt(deadline)
    }
  });

  // add contract as a party, this step is not necessary
  // but it can be useful for debugging and logging.
  const contractParty = mockChain.addParty(ergoTree.toHex(), "Timed Fund Contract");

  afterEach(() => {
    mockChain.reset();
  });

  describe("Below the deadline", () => {
    beforeEach(() => {
      // ensure the mock chain height is below the deadline
      expect(mockChain.height).to.be.below(deadline);
    });

    it("Should allow Bob to withdrawal funds", () => {
      // create an UTxO protected by the contract
      contractParty.addBalance({ nanoergs: 1_000000000n });

      // build the transaction
      const transaction = new TransactionBuilder(mockChain.height)
        .from(contractParty.utxos)
        .to(new OutputBuilder(1_000000000n, bob.address))
        .build();

      // execute the transaction
      expect(mockChain.execute(transaction, { signers: [bob] })).to.be.true;

      // funds should be transferred from the contract to bob.
      expect(contractParty.balance).to.be.deep.equal({ nanoergs: 0n, tokens: [] });
      expect(bob.balance).to.be.deep.equal({ nanoergs: 1_000000000n, tokens: [] });
    });

    it("Should not allow Alice to withdrawal funds", () => {
      // create an UTxO protected by the contract
      contractParty.addBalance({ nanoergs: 1_000000000n });

      // build the transaction
      const transaction = new TransactionBuilder(mockChain.height)
        .from(contractParty.utxos)
        .to(new OutputBuilder(1_000000000n, alice.address))
        .build();

      // execute the transaction
      expect(mockChain.execute(transaction, { signers: [alice], throw: false })).to.be.false;

      // balances should not change
      expect(alice.balance).to.be.deep.equal({ nanoergs: 0n, tokens: [] });
      expect(contractParty.balance).to.be.deep.equal({ nanoergs: 1_000000000n, tokens: [] });
    });
  });

  describe("Above the deadline", () => {
    beforeEach(() => {
      // jump to a height above the deadline
      mockChain.jumpTo(deadline + 1);
      expect(mockChain.height).to.be.above(deadline);
    });

    it("Should not allow Bob to withdrawal funds", () => {
      // create an UTxO protected by the contract
      contractParty.addBalance({ nanoergs: 1_000000000n });

      // build the transaction
      const transaction = new TransactionBuilder(mockChain.height)
        .from(contractParty.utxos)
        .to(new OutputBuilder(1_000000000n, bob.address))
        .build();

      // execute the transaction
      expect(mockChain.execute(transaction, { signers: [bob], throw: false })).to.be.false;

      // balances should not change
      expect(bob.balance).to.be.deep.equal({ nanoergs: 0n, tokens: [] });
      expect(contractParty.balance).to.be.deep.equal({ nanoergs: 1_000000000n, tokens: [] });
    });

    it("Should allow Alice to withdrawal funds", () => {
      // create an UTxO protected by the contract
      contractParty.addBalance({ nanoergs: 1_000000000n });

      // build the transaction
      const transaction = new TransactionBuilder(mockChain.height)
        .from(contractParty.utxos)
        .to(new OutputBuilder(1_000000000n, alice.address))
        .build();

      // execute the transaction
      expect(mockChain.execute(transaction, { signers: [alice] })).to.be.true;

      // funds should be transferred from the contract to alice.
      expect(contractParty.balance).to.be.deep.equal({ nanoergs: 0n, tokens: [] });
      expect(alice.balance).to.be.deep.equal({ nanoergs: 1_000000000n, tokens: [] });
    });
  });
});