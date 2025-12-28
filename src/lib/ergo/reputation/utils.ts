import type { ReputationProof } from "ergo-reputation-system";

export function calculate_reputation(proof: ReputationProof): number {
    const burned_value = proof.current_boxes.reduce((acc, b) => acc + Number(b.box.value), 0);
    const subjective = 1;
    return burned_value * subjective;
}

export function total_burned_string(proof: ReputationProof): string {
    const totalValue = proof.current_boxes.reduce((accumulator, box) => {
        return accumulator + BigInt(box.box.value);
    }, 0n);

    const scale = 10n ** 9n;
    const integerPart = totalValue / scale;
    const fractionalPart = totalValue % scale;

    let paddedFraction = fractionalPart.toString().padStart(9, '0');
    paddedFraction = paddedFraction.replace(/0+$/, '');

    if (paddedFraction === '') {
        paddedFraction = '0';
    }

    return `${integerPart}.${paddedFraction}`;
}

export function total_burned(proof: ReputationProof): number {
    const totalValue = proof.current_boxes.reduce((accumulator, box) => {
        return accumulator + BigInt(box.box.value);
    }, 0n);

    return Number(totalValue);
}
