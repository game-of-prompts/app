import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE
} from '@fleet-sdk/core';
import { SColl, SByte } from '@fleet-sdk/serializer';
import { hexToBytes } from '$lib/ergo/utils';

declare const ergo: any;

/**
 * Creates a box with the solver ID in R4.
 * This box is required for participation validation.
 * @param solverId The solver ID (hex string) to publish.
 * @returns The transaction ID.
 */
export async function publish_solver_id(solverId: string): Promise<string> {
    const currentHeight = await ergo.get_current_height();
    const changeAddress = await ergo.get_change_address();

    const solverIdBytes = hexToBytes(solverId);
    if (!solverIdBytes) throw new Error("Invalid solver ID hex");

    const outputBox = new OutputBuilder(
        SAFE_MIN_BOX_VALUE,
        changeAddress  // TODO User a { false } script.
    )
        .setAdditionalRegisters({
            R4: SColl(SByte, solverIdBytes).toHex()
        });

    const inputs = await ergo.get_utxos();

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from(inputs)
        .to([outputBox])
        .sendChangeTo(changeAddress)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();

    const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
    const txId = await ergo.submit_tx(signedTransaction);

    console.log(`Solver ID published. Tx ID: ${txId}`);
    return txId;
}
