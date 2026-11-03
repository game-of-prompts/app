# v1 contracts (frozen)

Contracts of the `v1` tag, kept so the app can still find and display competitions created with them.
The app never builds transactions for these contracts: v1 competitions are read-only.

Do not edit these files. Any change, including whitespace inside the scripts, changes the compiled ErgoTrees and
v1 competitions stop being found on-chain. `tests/contract_versions.test.ts` pins the expected script hashes.

They are compiled with the constants frozen in `src/lib/common/constants.ts` (`V1ProductionMode` / `V1DevelopmentMode`).
