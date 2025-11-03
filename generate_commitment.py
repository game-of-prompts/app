#!/usr/bin/env python3
"""
genera_commitment.py

Usage:
  python genera_commitment.py <score> [--address ADDRESS] [--seed SEED]

If --address is provided, the script queries the official Ergo Explorer at
/api/v1/boxes/byAddress/{address} to obtain the "ergoTree" field.
"""

import hashlib
import binascii
import argparse
import os
import requests
import sys

EXPLORER_API_BASE = "https://api.ergoplatform.com/api/v1/boxes/byAddress"


def fetch_ergo_tree_for_address(address: str, timeout: int = 10) -> str:
    """Fetch the 'ergoTree' (hex) of the first box associated with the given address."""
    url = f"{EXPLORER_API_BASE}/{address}"
    try:
        resp = requests.get(url, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as e:
        raise RuntimeError(f"HTTP error when querying the Explorer: {e}")

    items = data.get("items", [])
    if not items:
        raise RuntimeError(f"No boxes found for address {address}")

    ergo_tree = items[0].get("ergoTree")
    if not ergo_tree:
        raise RuntimeError(f"No 'ergoTree' found in the first box returned for {address}")

    return ergo_tree


def generate_gop_commitment(
    solver_id: str,
    seed_str: str,
    score: int,
    hash_logs_hex: str,
    secret_s_hex: str,
    ergotree_hex: str
) -> str:
    """Generate the Game of Prompts commitment C (Blake2b-256)."""
    solver_id_bytes = binascii.unhexlify(solver_id)

    # If seed looks like hex, decode it; otherwise, encode as UTF-8
    try:
        seed_bytes = binascii.unhexlify(seed_str)
    except (binascii.Error, ValueError):
        seed_bytes = seed_str.encode("utf-8")

    score_bytes = score.to_bytes(8, byteorder="big", signed=True)
    hash_logs_bytes = binascii.unhexlify(hash_logs_hex)
    secret_s_bytes = binascii.unhexlify(secret_s_hex)
    ergotree_bytes = binascii.unhexlify(ergotree_hex)

    # Order: solver_id + seed + score + hash_logs + ergoTree + secret_s
    concatenated = solver_id_bytes + seed_bytes + score_bytes + hash_logs_bytes + ergotree_bytes + secret_s_bytes
    h = hashlib.blake2b(digest_size=32)
    h.update(concatenated)
    return h.hexdigest()


def main():
    CONSTANT_SECRET_S_HEX = "35aa11186c18d3e04f81656248213a1a3c43e89a67045763287e644db60c3f21"
    CONSTANT_ERGOTREE_HEX = "a3f1bde417cf029a9d51dceaf45a08e23c4cc6f1ed2a75b3b394ac97b4e23145"

    parser = argparse.ArgumentParser(description="Generate a Game of Prompts commitment.")
    parser.add_argument("score", type=int, help="Solver's score.")
    parser.add_argument("--address", type=str, default=None, help="Ergo address of the player.")
    parser.add_argument("--seed", type=str, default=None, help="Custom seed for the player (text or hex).")
    parser.add_argument("--secret", type=str, default=CONSTANT_SECRET_S_HEX, help="Secret S (hex).")
    parser.add_argument("--no-fetch", action="store_true", help="Do not query the Explorer even if --address is provided.")
    args = parser.parse_args()

    solver_id_hex = os.urandom(32).hex()
    hash_logs_hex = os.urandom(32).hex()
    ergotree_hex_to_use = CONSTANT_ERGOTREE_HEX

    if args.address and not args.no_fetch:
        try:
            print(f"Querying Ergo Explorer for address: {args.address} ...")
            ergotree_hex_to_use = fetch_ergo_tree_for_address(args.address)
            print(f"ErgoTree retrieved (len={len(ergotree_hex_to_use)} chars).")
        except Exception as e:
            print(f"⚠️  Could not fetch ErgoTree: {e}")
            print("Using the default constant ErgoTree instead.")
            ergotree_hex_to_use = CONSTANT_ERGOTREE_HEX

    if not args.address:
        print("⚠️  You did not specify an address. This will not work for real submissions.")

    if not args.seed:
        print("⚠️  No seed provided. It's recommended to define one for valid production commitments.")
        args.seed = "default-seed"

    commitment = generate_gop_commitment(
        solver_id_hex,
        args.seed,
        args.score,
        hash_logs_hex,
        args.secret,
        ergotree_hex_to_use
    )

    # Pretty formatted output
    print("\n" + "═" * 60)
    print("🔐 COMMITMENT DATA".center(60))
    print("═" * 60)

    print("\n")
    print(f"🔒 Secret:           {args.secret}")
    print("\n")

    print(f"🧩 Solver ID:        {solver_id_hex}")
    print(f"📄 Hash Logs:        {hash_logs_hex}")
    print(f"✅ Commitment:       {commitment}")
    print(f"🧮 Score:            {args.score}")
    print("\n")

    print("─" * 60)
    print(f"🌱 Seed:             {args.seed}")
    print(f"🌳 ErgoTree:         {ergotree_hex_to_use[:80]}... (len={len(ergotree_hex_to_use)})")
    print("═" * 60 + "\n")
    print(f"Commitment length: {len(commitment)} characters "
          f"({len(binascii.unhexlify(commitment))} bytes)")


if __name__ == "__main__":
    main()
