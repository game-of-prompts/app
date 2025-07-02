import { stringToBytes } from "@scure/base";
import {
    ErgoAddress, SByte, SColl, SConstant, SGroupElement,
    type Box,
    type InputBox,
    type Amount
} from '@fleet-sdk/core';


export function hexToUtf8(hexString: string): string | null {
    try {
        if (hexString.length % 2 !== 0) {
            return null;
        }
    
        // Convierte la cadena hexadecimal a un array de bytes
        const byteArray = new Uint8Array(hexString.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    
        // Crea un nuevo TextDecoder para convertir el array de bytes a una cadena UTF-8
        const decoder = new TextDecoder('utf-8');
        const utf8String = decoder.decode(byteArray);
    
        return utf8String;
    } catch {
        return null;
    }
  }

export function generate_pk_proposition(wallet_pk: string): string {
    const pk = ErgoAddress.fromBase58(wallet_pk).getPublicKeys()[0];
    const encodedProp = SGroupElement(pk);
    return encodedProp.toHex();
}

export function SString(value: string): string {
    return SConstant(SColl(SByte, stringToBytes('utf8', value)));
}

export function uint8ArrayToHex(array: Uint8Array): string { 
    return [...new Uint8Array(array)]
        .map(x => x.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Parsea el `renderedValue` de un SColl[SLong] (típicamente un array de strings/numbers) a un array de bigints.
 * @param renderedValue El valor renderizado desde la API del explorador.
 * @returns Un array de bigints, o null si el parseo falla.
 */
export function parseLongColl(renderedValue: any): bigint[] | null {
    if (!Array.isArray(renderedValue)) {
        // console.warn("parseLongColl: renderedValue no es un array:", renderedValue);
        return null;
    }
    try {
        return renderedValue.map(item => {
            if (typeof item === 'string' || typeof item === 'number' || typeof item === 'bigint') {
                return BigInt(item);
            }
            throw new Error(`No se puede convertir el item '${item}' a BigInt.`);
        });
    } catch (e) {
        console.error("parseLongColl: Error convirtiendo items a BigInt:", renderedValue, e);
        return null;
    }
}

/**
 * Convierte un string hexadecimal a Uint8Array.
 * @param hexString El string hexadecimal a convertir.
 * @returns Un Uint8Array o null si la entrada es inválida.
 */
export function hexToBytes(hexString: string | undefined | null): Uint8Array | null {
    if (!hexString || typeof hexString !== 'string' || !/^[0-9a-fA-F]*$/.test(hexString)) {
        // console.warn("hexToBytes: entrada de string hexadecimal inválida (caracteres no hexadecimales o nulo/undefined).", hexString);
        return null;
    }
    if (hexString.length % 2 !== 0) {
        // console.warn("hexToBytes: el string hexadecimal debe tener una longitud par.", hexString);
        return null; 
    }
    try {
        const byteArray = new Uint8Array(hexString.length / 2);
        for (let i = 0; i < byteArray.length; i++) {
            const byte = parseInt(hexString.substring(i * 2, i * 2 + 2), 16);
            if (isNaN(byte)) {
                throw new Error("Se encontró un carácter hexadecimal inválido durante el parseInt.");
            }
            byteArray[i] = byte;
        }
        return byteArray;
    } catch (e) {
        console.error("hexToBytes: Error convirtiendo hex a bytes:", hexString, e);
        return null;
    }
}

/**
 * Parsea el `renderedValue` de un SInt (típicamente un número o un string representando un número) a un number.
 * @param renderedValue El valor renderizado desde la API del explorador.
 * @returns Un número, o null si el parseo falla.
 */
export function parseIntFromRendered(renderedValue: any): number | null {
    if (renderedValue === null || renderedValue === undefined) return null;

    if (typeof renderedValue === 'number') {
        return Number.isFinite(renderedValue) ? renderedValue : null;
    }
    if (typeof renderedValue === 'string') {
        const num = parseInt(renderedValue, 10);
        return Number.isFinite(num) ? num : null;
    }
    // console.warn("parseIntFromRendered: tipo de entrada no soportado:", renderedValue);
    return null;
}

/**
 * Parsea el `renderedValue` de un SColl[SByte] a un string hexadecimal.
 * El `renderedValue` puede ser un array de números (bytes) o (menos común para renderedValue) ya un string hexadecimal.
 * @param renderedValue El valor renderizado desde la API del explorador.
 * @returns Un string hexadecimal, o null si el parseo falla.
 */
export function parseCollByteToHex(renderedValue: any): string | null {
    if (renderedValue === null || renderedValue === undefined) return null;

    // Si es un array de números (bytes)
    if (Array.isArray(renderedValue) && renderedValue.every(item => typeof item === 'number' && item >= 0 && item <= 255)) {
        try {
            return uint8ArrayToHex(new Uint8Array(renderedValue));
        } catch (e) {
            console.error("parseCollByteToHex: Error convirtiendo array de bytes a hex:", renderedValue, e);
            return null;
        }
    }
    // Si ya es un string hexadecimal
    if (typeof renderedValue === 'string') {
        const cleanedHex = renderedValue.startsWith('0x') ? renderedValue.substring(2) : renderedValue;
        if (/^[0-9a-fA-F]*$/.test(cleanedHex) && cleanedHex.length % 2 === 0) { // Verifica que sea hex y longitud par
            return cleanedHex;
        }
    }
    // console.warn("parseCollByteToHex: formato de entrada no soportado o inválido:", renderedValue);
    return null;
}

export function parseIntFromHex(renderedValue: any): number | null {
    if (typeof renderedValue !== 'string' && typeof renderedValue !== 'number') return null;
    try {
        // If it's already a number (some explorers might pre-parse from SInt)
        if (typeof renderedValue === 'number') return renderedValue;
        // If it's a hex string from SInt.serializedValue, it's more complex (stripping type byte)
        // If renderedValue is simple string "123" for an Int, parseInt is fine.
        // Fleet's renderedValue for SInt might just be the number itself.
        // Let's assume renderedValue for SInt is directly the number or a string of the number.
        const num = parseInt(renderedValue, 10);
        return isNaN(num) ? null : num;
    } catch (e) { return null; }
}

export function utf8StringToCollByteHex(inputString: string): string {
    const bytes = stringToBytes('utf8', inputString);
    return SColl(SByte, bytes).toHex();
}

/**
 * Convierte un bigint de JavaScript a un Uint8Array de 8 bytes (64 bits),
 * en formato big-endian y manejando el signo (complemento a dos).
 * Simula el comportamiento de longToByteArray de ErgoScript.
 * @param value El bigint a convertir.
 * @returns Un Uint8Array de 8 bytes.
 * @throws Error si el valor está fuera del rango de un Long de 64 bits con signo.
 */
export function bigintToLongByteArray(value: bigint): Uint8Array {
    // Rango de un Long de 64 bits con signo: -(2^63) a (2^63 - 1)
    const MIN_LONG = -(2n ** 63n);
    const MAX_LONG = (2n ** 63n) - 1n;

    if (value < MIN_LONG || value > MAX_LONG) {
        throw new Error(`Valor ${value} está fuera del rango para un Long de 64 bits con signo.`);
    }

    const bytes = new Uint8Array(8);
    let val = value;

    // Para números negativos, trabajamos con su representación en complemento a dos
    // dentro de un espacio de 64 bits.
    // Si el valor es negativo, el bit más significativo (bit 63) será 1.
    // El método DataView.setBigInt64 maneja esto internamente.

    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setBigInt64(0, val, false); // false para big-endian

    return new Uint8Array(buffer);
}


export function parseBox(e: Box<Amount>): InputBox {
    return {
                                    boxId: e.boxId,
                                    value: e.value,
                                    assets: e.assets,
                                    ergoTree: e.ergoTree,
                                    creationHeight: e.creationHeight,
                                    additionalRegisters: Object.entries(e.additionalRegisters).reduce((acc, [key, value]) => {
                                        acc[key] = value.serializedValue;
                                        return acc;
                                    }, {} as {
                                        [key: string]: string;
                                    }),
                                    index: e.index,
                                    transactionId: e.transactionId
                                }
}