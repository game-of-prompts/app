import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { cubicOut } from "svelte/easing";
import type { TransitionConfig } from "svelte/transition";
import type { AnyGame, GameCancellation } from '$lib/common/game';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

type FlyAndScaleParams = {
	y?: number;
	x?: number;
	start?: number;
	duration?: number;
};

export const flyAndScale = (
	node: Element,
	params: FlyAndScaleParams = { y: -8, x: 0, start: 0.95, duration: 150 }
): TransitionConfig => {
	const style = getComputedStyle(node);
	const transform = style.transform === "none" ? "" : style.transform;

	const scaleConversion = (
		valueA: number,
		scaleA: [number, number],
		scaleB: [number, number]
	) => {
		const [minA, maxA] = scaleA;
		const [minB, maxB] = scaleB;

		const percentage = (valueA - minA) / (maxA - minA);
		const valueB = percentage * (maxB - minB) + minB;

		return valueB;
	};

	const styleToString = (
		style: Record<string, number | string | undefined>
	): string => {
		return Object.keys(style).reduce((str, key) => {
			if (style[key] === undefined) return str;
			return str + `${key}:${style[key]};`;
		}, "");
	};

	return {
		duration: params.duration ?? 200,
		delay: 0,
		css: (t) => {
			const y = scaleConversion(t, [0, 1], [params.y ?? 5, 0]);
			const x = scaleConversion(t, [0, 1], [params.x ?? 0, 0]);
			const scale = scaleConversion(t, [0, 1], [params.start ?? 0.95, 1]);

			return styleToString({
				transform: `${transform} translate3d(${x}px, ${y}px, 0) scale(${scale})`,
				opacity: t
			});
		},
		easing: cubicOut
	};
};

// Devuelve el stake, sin importar el estado del juego
export function getDisplayStake(game: AnyGame): bigint {
	if (game.status === 'Cancelled_Draining') {
		return (game as GameCancellation).resolverStakeAmount;
	}
	return game.resolverStakeAmount;
}

// Devuelve la tarifa de participación o 0 si el juego está cancelado
export function getParticipationFee(game: AnyGame): bigint {
	if (game.status === 'Cancelled_Draining') {
		return 0n; // 0 BigInt
	}
	return game.participationFeeAmount;
}

export function prependHexPrefix(originalBytes: Uint8Array, hexPrefix: string = "0008cd"): Uint8Array {
	const cleanHex = hexPrefix.replace(/\s+/g, '');
	if (cleanHex.length % 2 !== 0) {
		throw new Error("La cadena hexadecimal debe tener una longitud par.");
	}

	const prefixBytes = new Uint8Array(cleanHex.length / 2);
	for (let i = 0; i < cleanHex.length; i += 2) {
		prefixBytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
	}

	const result = new Uint8Array(prefixBytes.length + originalBytes.length);

	result.set(prefixBytes, 0);
	result.set(originalBytes, prefixBytes.length);

	return result;
}

export function formatTokenBigInt(
        raw: unknown,
        decimals: number,
        minFrac: number = 2,
        maxFrac: number = 8,
    ): string {
        if (raw === undefined || raw === null) return "N/A";

        let valueBig: bigint;
        try {
            if (typeof raw === "bigint") {
                valueBig = raw;
            } else if (typeof raw === "number") {
                valueBig = BigInt(Math.trunc(raw));
            } else {
                const s = (raw as any)?.toString?.();
                valueBig = BigInt(s);
            }
        } catch {
            const n = Number(raw);
            if (isNaN(n)) return "N/A";
            return (n / Math.pow(10, decimals)).toLocaleString(undefined, {
                minimumFractionDigits: minFrac,
                maximumFractionDigits: maxFrac,
            });
        }

        const base = 10n ** BigInt(decimals);
        const intPart = valueBig / base;
        const frac = valueBig % base;

        let fracStr = frac.toString().padStart(decimals, "0").slice(0, maxFrac);

        while (fracStr.length > minFrac && fracStr.endsWith("0")) {
            fracStr = fracStr.slice(0, -1);
        }

        let intFormatted: string;
        try {
            intFormatted = Number(intPart).toLocaleString();
        } catch {
            const s = intPart.toString();
            intFormatted = s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
        }

        return fracStr ? `${intFormatted}.${fracStr}` : `${intFormatted}.00`;
    }