#!/usr/bin/env python3
"""
genera_commitment.py

Uso:
  python genera_commitment.py <score> [--address ADDRESS]

Si se pasa --address, el script consulta el Explorer oficial de Ergo en
/api/v1/boxes/byAddress/{address} para obtener el campo "ergoTree".
"""

import hashlib
import binascii
import argparse
import os
import requests
import sys

EXPLORER_API_BASE = "https://api.ergoplatform.com/api/v1/boxes/byAddress"

def fetch_ergo_tree_for_address(address: str, timeout: int = 10) -> str:
    """
    Consulta el Explorer público y devuelve el 'ergoTree' (hex) del primer box
    asociado a la dirección.
    """
    url = f"{EXPLORER_API_BASE}/{address}"
    try:
        resp = requests.get(url, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as e:
        raise RuntimeError(f"Error HTTP al consultar el Explorer: {e}")

    items = data.get("items", [])
    if not items:
        raise RuntimeError(f"No se encontraron boxes para la dirección {address}")

    ergo_tree = items[0].get("ergoTree")
    if not ergo_tree:
        raise RuntimeError(f"No se encontró 'ergoTree' en el primer box devuelto para {address}")

    return ergo_tree

def generate_gop_commitment(
    solver_id: str,
    score: int,
    hash_logs_hex: str,
    secret_s_hex: str,
    ergotree_hex: str
) -> str:
    """Genera el commitment C (Blake2b-256) para Game of Prompts."""
    solver_id_bytes = binascii.unhexlify(solver_id)
    score_bytes = score.to_bytes(8, byteorder="big", signed=True)
    hash_logs_bytes = binascii.unhexlify(hash_logs_hex)
    secret_s_bytes = binascii.unhexlify(secret_s_hex)
    ergotree_bytes = binascii.unhexlify(ergotree_hex)

    concatenated = solver_id_bytes + score_bytes + hash_logs_bytes + ergotree_bytes + secret_s_bytes
    h = hashlib.blake2b(digest_size=32)
    h.update(concatenated)
    return h.hexdigest()

def main():
    CONSTANT_SECRET_S_HEX = "35aa11186c18d3e04f81656248213a1a3c43e89a67045763287e644db60c3f21"
    CONSTANT_ERGOTREE_HEX = "a3f1bde417cf029a9d51dceaf45a08e23c4cc6f1ed2a75b3b394ac97b4e23145"

    parser = argparse.ArgumentParser(description="Genera un commitment para Game of Prompts.")
    parser.add_argument("score", type=int, help="Puntuación (score) obtenida por el solver.")
    parser.add_argument("--address", type=str, default=None, help="Dirección Ergo del jugador.")
    parser.add_argument("--secret", type=str, default=CONSTANT_SECRET_S_HEX, help="Secret S (hex).")
    parser.add_argument("--no-fetch", action="store_true", help="No consultar el Explorer aunque se pase --address.")
    args = parser.parse_args()

    solver_id_hex = os.urandom(32).hex()
    hash_logs_hex = os.urandom(32).hex()
    ergotree_hex_to_use = CONSTANT_ERGOTREE_HEX

    if args.address and not args.no_fetch:
        try:
            print(f"Consultando Explorer para la dirección: {args.address} ...")
            ergotree_hex_to_use = fetch_ergo_tree_for_address(args.address)
            print(f"ErgoTree obtenido (len={len(ergotree_hex_to_use)} chars).")
        except Exception as e:
            print(f"⚠️  No se pudo obtener el ErgoTree: {e}")
            print("Usando el ErgoTree constante por defecto.")
            ergotree_hex_to_use = CONSTANT_ERGOTREE_HEX

    print("\nEntradas para generar el commitment:")
    print(f"  Score: {args.score}")
    print(f"  Solver ID: {solver_id_hex}")
    print(f"  Hash Logs: {hash_logs_hex}")
    print(f"  ErgoTree: {ergotree_hex_to_use[:80]}... (len={len(ergotree_hex_to_use)})")
    print(f"  Secret S: {args.secret}\n{'-'*60}")

    commitment = generate_gop_commitment(
        solver_id_hex,
        args.score,
        hash_logs_hex,
        args.secret,
        ergotree_hex_to_use
    )

    print(f"✅ Commitment generado:\n{commitment}")
    print(f"Longitud: {len(commitment)} caracteres ({len(binascii.unhexlify(commitment))} bytes)")

if __name__ == "__main__":
    main()
