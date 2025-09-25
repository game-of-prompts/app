import {
    OutputBuilder,
    SAFE_MIN_BOX_VALUE,
    RECOMMENDED_MIN_FEE_VALUE,
    TransactionBuilder,
    type Box,
    type Amount,
    ErgoAddress,
    SColl,
    SByte,
    SBool,
    SLong
} from '@fleet-sdk/core';
import { blake2b256 } from '@fleet-sdk/crypto';
import { getReputationProofAddress }  from "$lib/ergo/contract";
import { SString, hexToBytes, parseBox } from '../utils';
import { explorer_uri, REPUTATION_PROOF_TOTAL_SUPPLY } from '../envs';
import { SPair } from '@fleet-sdk/serializer';
import { reputation_proof, types } from '$lib/common/store';
import { get } from 'svelte/store';
import { GAME, JUDGE, PARTICIPATION } from './types';
import { fetchTypeNfts } from './fetch';

const ergo_tree_address = getReputationProofAddress();

/**
 * Serializes a (boolean, number) tuple into an Ergo-compatible (Boolean, Long) hex string for R6.
 * @param isLocked The lock state.
 * @param totalSupply The total token supply.
 * @returns The serialized hex string for the tuple.
 */
function tupleToSerialized(isLocked: boolean, totalSupply: number): string {
    return SPair(SBool(isLocked), SLong(totalSupply)).toHex();
}

/**
 * Serializes a JavaScript boolean into an Ergo-compatible Boolean hex string.
 * @param value The boolean to serialize.
 * @returns The serialized hex string.
 */
export function booleanToSerializer(value: boolean): string {
    return SBool(value).toHex();
}

export async function generate_reputation_proof(burned_amount: BigInt): Promise<string | null> {
    const proof = get(reputation_proof);
    const token_amount = REPUTATION_PROOF_TOTAL_SUPPLY;
    const total_supply = REPUTATION_PROOF_TOTAL_SUPPLY;
    const is_locked = false;
    const type_nft_id = JUDGE;
    const polarization = true;
    const content = "";

    console.log("Generating reputation proof with parameters:", {
        token_amount,
        total_supply,
        type_nft_id,    
        polarization,
        content,
        is_locked
    });

    const creatorAddressString = await ergo.get_change_address();
    if (!creatorAddressString) {
        throw new Error("Could not get the creator's address from the wallet.");
    }
    const creatorP2PKAddress = ErgoAddress.fromBase58(creatorAddressString);

    // Fetch the Type NFT box to be used in dataInputs. This is required by the contract.
    const typeNftBoxResponse = await fetch(`${explorer_uri}/api/v1/boxes/byTokenId/${type_nft_id}`);
    if (!typeNftBoxResponse.ok) {
      alert("Could not fetch the Type NFT box. Aborting transaction.");
      return null;
    }
    const typeNftBox = (await typeNftBoxResponse.json()).items[0];

    console.log("type nft box ", typeNftBox)

    // Inputs for the transaction
    const utxos = await ergo.get_utxos();
    const inputs: Box<Amount>[] = utxos;
    let dataInputs = [typeNftBox];
    dataInputs.concat(proof?.current_boxes.slice(1))

    const outputs: OutputBuilder[] = [];

    // --- Create the main output for the new/modified proof ---
    const new_proof_output = new OutputBuilder(
        burned_amount > SAFE_MIN_BOX_VALUE ? burned_amount : SAFE_MIN_BOX_VALUE,
        ergo_tree_address
    );

    // Minting a new token if no input proof is provided
    new_proof_output.mintToken({
        amount: token_amount.toString()
    });

    const object_pointer = inputs[0].boxId;  // Points to the self token being evaluated by default

    const propositionBytes = hexToBytes(creatorP2PKAddress.ergoTree);
    if (!propositionBytes) {
        throw new Error(`Could not get proposition bytes from address ${creatorAddressString}.`);
    }
    const hashedProposition = blake2b256(propositionBytes);

    new_proof_output.setAdditionalRegisters({
        R4: SColl(SByte, hexToBytes(type_nft_id) ?? "").toHex(),
        R5: SColl(SByte, hexToBytes(object_pointer) ?? "").toHex(),
        R6: tupleToSerialized(is_locked, total_supply),
        R7: SColl(SByte, hashedProposition).toHex(),
        R8: booleanToSerializer(polarization),
        R9: SString(typeof(content) === "object" ? JSON.stringify(content): content ?? "")
    });

    outputs.push(new_proof_output);

    // --- Build and submit the transaction ---
    try {
        const unsignedTransaction = await new TransactionBuilder(await ergo.get_current_height())
            .from(inputs)
            .to(outputs)
            .sendChangeTo(creatorP2PKAddress)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build()
            .toEIP12Object();

        const signedTransaction = await ergo.sign_tx(unsignedTransaction);
        const transactionId = await ergo.submit_tx(signedTransaction);



        console.log("Transaction ID -> ", transactionId);
        return transactionId;
    } catch (e) {
        console.error("Error building or submitting transaction:", e);
        alert(`Transaction failed: ${e.message}`);
        return null;
    }
}

export async function update_reputation_proof(
    type: "game"|"participation"|"judge",
    object_pointer: string,
    polarization: boolean,
    content: object|string|null,
): Promise<string | null> {

    const type_nft_id = type === "game" ? GAME : (type === "participation" ? PARTICIPATION : (type === "judge" ? JUDGE : null));
    if (!type_nft_id) { throw new Error("Invalid reputation proof type.") }

    const proof = get(reputation_proof);
    const token_amount = 1;
    const is_locked = true;
    let total_supply;
    let input_proof;

    if (!proof) { throw new Error("Reputation proof not found.") }

    input_proof = proof.current_boxes.filter((b) => b.type.tokenId == JUDGE && b.object_pointer == proof.token_id)[0];
    total_supply = proof.total_amount;

    console.log("Generating reputation proof with parameters:", {
        token_amount,
        total_supply,
        type_nft_id,    
        object_pointer,
        polarization,
        content,
        is_locked,
        input_proof
    });

    const creatorAddressString = await ergo.get_change_address();
    if (!creatorAddressString) {
        throw new Error("Could not get the creator's address from the wallet.");
    }
    const creatorP2PKAddress = ErgoAddress.fromBase58(creatorAddressString);

    // Fetch the Type NFT box to be used in dataInputs. This is required by the contract.
    let typeNftBoxes = Array.from(await fetchTypeNfts(), ([k, v]) => v.box ? parseBox(v.box) : null);

    // Inputs for the transaction
    const utxos = await ergo.get_utxos();
    const inputs: Box<Amount>[] = input_proof ? [parseBox(input_proof.box), ...utxos] : utxos;
    let dataInputs = [...typeNftBoxes, ...proof?.current_boxes.filter((e) => e.box_id !== input_proof.box_id).map((i) => parseBox(i.box))];

    const outputs: OutputBuilder[] = [];

    // --- Create the main output for the new/modified proof ---
    const new_proof_output = new OutputBuilder(
        SAFE_MIN_BOX_VALUE,
        ergo_tree_address
    );

    // Transferring existing tokens
    new_proof_output.addTokens({
        tokenId: input_proof.token_id,
        amount: token_amount.toString()
    });

    const propositionBytes = hexToBytes(creatorP2PKAddress.ergoTree);
    if (!propositionBytes) {
        throw new Error(`Could not get proposition bytes from address ${creatorAddressString}.`);
    }
    const hashedProposition = blake2b256(propositionBytes);

    if (input_proof.token_amount - token_amount > 0) {
        outputs.push(
            new OutputBuilder(BigInt(input_proof.box.value), ergo_tree_address)
            .addTokens({
                tokenId: input_proof.token_id,
                amount: (input_proof.token_amount - token_amount).toString()
            })
            .setAdditionalRegisters({
                R4: SColl(SByte, hexToBytes(input_proof.type.tokenId) ?? "").toHex(),
                R5: SColl(SByte, hexToBytes(input_proof.object_pointer) ?? "").toHex(),
                R6: tupleToSerialized(input_proof.is_locked, total_supply),
                R7: SColl(SByte, hashedProposition).toHex(),
                R8: booleanToSerializer(input_proof.polarization),
                R9: SString(typeof(input_proof.content) === "object" ? JSON.stringify(input_proof.content): input_proof.content ?? "")
            })
        );
    }

    new_proof_output.setAdditionalRegisters({
        R4: SColl(SByte, hexToBytes(type_nft_id) ?? "").toHex(),
        R5: SColl(SByte, hexToBytes(object_pointer) ?? "").toHex(),
        R6: tupleToSerialized(is_locked, total_supply),
        R7: SColl(SByte, hashedProposition).toHex(),
        R8: booleanToSerializer(polarization),
        R9: SString(typeof(content) === "object" ? JSON.stringify(content): content ?? "")
    });

    outputs.push(new_proof_output);

    // --- Build and submit the transaction ---
    try {
        const unsignedTransaction = await new TransactionBuilder(await ergo.get_current_height())
            .from(inputs)
            .to(outputs)
            .sendChangeTo(creatorP2PKAddress)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .withDataFrom(dataInputs)
            .build()
            .toEIP12Object();

        const signedTransaction = await ergo.sign_tx(unsignedTransaction);
        const transactionId = await ergo.submit_tx(signedTransaction);

        console.log("Transaction ID -> ", transactionId);
        return transactionId;
    } catch (e) {
        console.error("Error building or submitting transaction:", e);
        alert(`Transaction failed: ${e.message}`);
        return null;
    }
}