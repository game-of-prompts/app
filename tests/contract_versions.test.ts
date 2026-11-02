import { afterEach, describe, expect, it } from "vitest";
import {
  findContractVersion,
  getContractErgoTreeHex,
  getContractScriptHash,
  getContractTemplateHashes,
  type ContractName
} from "$lib/ergo/contract";
import { isDevMode } from "$lib/ergo/envs";
import { ErgoPlatform } from "$lib/ergo/platform";

// Script hashes (blake2b256 of the ErgoTree) of the v1 contracts, production constants.
// These are the exact trees of the v1 game boxes and participations on mainnet: if any of them
// changes, v1 competitions disappear from the app.
const V1_PRODUCTION_SCRIPT_HASHES: Record<ContractName, string> = {
  gameActive: "8711b5432ab2eb1d9c80791231677402b6509492fe59a12fa7731169824eda66",
  gameResolution: "426d25e239aa03f9fe7bc957fe0284a71bf70f4b102b50cad86d426b095a9a56",
  endGame: "7592e3e08751b8648d58e847fb9c5bc173a5bb20ee13979fc6d17a660abb10e1",
  gameCancellation: "a32abd02c9fe7950f671e5fb2b8453b17d83d5d5aed4592bba77ae5a893a7a09",
  participation: "fc66cd5b7772b2c01e36ae734de21598d6ece05dd5e3afe054df10b9d8476fd0",
  participationBatch: "ee137ecd6ca24767792860e252cab68722399b2971947e548c8cbacee18bb177",
  judgesPaid: "bb00ba07b50f7c0dc7ad70a198b071fee90fefbc1cbd41e8b0167d398abe0b64",
  mintIdt: "c918f2b28d5676177d77d394e58c077b6877fa5c98ea299538b5d322cb633fe5",
};

const CONTRACTS = Object.keys(V1_PRODUCTION_SCRIPT_HASHES) as ContractName[];

// Contracts whose code changed in v2 (judges_paid didn't, but mint_idt embeds the game_active hash).
const CHANGED_IN_V2: ContractName[] = ["gameActive", "gameResolution", "endGame", "gameCancellation", "participation", "participationBatch", "mintIdt"];

describe("Contract versions", { timeout: 60_000 }, () => {
  afterEach(() => isDevMode.set(false));

  it("v1 contracts compile to the trees deployed on mainnet", () => {
    for (const name of CONTRACTS) {
      expect(getContractScriptHash(name, "v1"), name).to.equal(V1_PRODUCTION_SCRIPT_HASHES[name]);
    }
  });

  it("v2 contracts differ from v1 wherever the contract changed", () => {
    for (const name of CHANGED_IN_V2) {
      expect(getContractErgoTreeHex(name, "v2"), name).not.to.equal(getContractErgoTreeHex(name, "v1"));
    }
    expect(getContractErgoTreeHex("judgesPaid", "v2")).to.equal(getContractErgoTreeHex("judgesPaid", "v1"));
  });

  it("identifies the version of a contract box by its ErgoTree", () => {
    for (const name of CHANGED_IN_V2) {
      expect(findContractVersion(name, getContractErgoTreeHex(name, "v1")), name).to.equal("v1");
      expect(findContractVersion(name, getContractErgoTreeHex(name, "v2")), name).to.equal("v2");
    }
    expect(findContractVersion("gameActive", getContractErgoTreeHex("participation", "v2"))).to.be.null;
  });

  it("searches the explorer with the templates of every version", () => {
    // mint_idt only changes a constant between versions, so both share the template;
    // that's why versions are told apart by the full ErgoTree.
    for (const name of CHANGED_IN_V2.filter((n) => n !== "mintIdt")) {
      expect(getContractTemplateHashes(name), name).to.have.length(2);
    }
    expect(getContractTemplateHashes("mintIdt")).to.have.length(1);
  });

  it("keeps the v1 dev-mode contracts apart from production", () => {
    const production = getContractErgoTreeHex("gameActive", "v1");
    isDevMode.set(true);
    expect(getContractErgoTreeHex("gameActive", "v1")).not.to.equal(production);
  });

  it("v1 games are read-only", async () => {
    const legacyGame = { contractVersion: "v1" } as any;
    await expect(new ErgoPlatform().endGame(legacyGame, [])).rejects.toThrow(/read-only/);
    await expect(new ErgoPlatform().drain_cancelled_game_stake(legacyGame, "")).rejects.toThrow(/read-only/);
  });
});
