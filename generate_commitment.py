import hashlib
import binascii
import argparse
import os

def generate_gop_commitment(
    solver_id: str,
    score: int,
    hash_logs_hex: str,
    secret_s_hex: str,
    ergotree_hex: str
) -> str:
    """
    Generates the cryptographic commitment for participation in Game of Prompts.

    Args:
        solver_id (str): The solver's identifier, as a hexadecimal string (64 chars = 32 bytes).
        score (int): The score obtained by the solver (64-bit signed integer).
        hash_logs_hex (str): Hash of the game logs (Blake2b-256 → 32 bytes hex).
        secret_s_hex (str): Secret S of the game (256-bit → 64-char hex).
        ergotree_hex (str): ErgoTree (smart contract bytes) in hex (typically 64 chars).

    Returns:
        str: Commitment C (Blake2b-256) as hexadecimal string.
    """
    try:
        # 1. Convert solver_id to bytes
        solver_id_bytes = binascii.unhexlify(solver_id)

        # 2. Convert score (Long) to bytes
        if not (-(2**63) <= score < 2**63):
            raise ValueError(f"Score {score} is outside the range of a 64-bit signed Long.")
        score_bytes = score.to_bytes(8, byteorder='big', signed=True)

        # 3. Convert hash_logs_hex to bytes
        if len(hash_logs_hex) != 64:
            print(f"Warning: hash_logs_hex ('{hash_logs_hex}') does not have 64 characters.")
        hash_logs_bytes = binascii.unhexlify(hash_logs_hex)

        # 4. Convert secret_s_hex to bytes
        if len(secret_s_hex) != 64:
            print(f"Warning: secret_s_hex ('{secret_s_hex}') does not have 64 characters.")
        secret_s_bytes = binascii.unhexlify(secret_s_hex)

        # 5. Convert ergotree_hex to bytes
        if len(ergotree_hex) != 64:
            print(f"Warning: ergotree_hex ('{ergotree_hex}') does not have 64 characters.")
        ergotree_bytes = binascii.unhexlify(ergotree_hex)

        # 6. Concatenate in order
        concatenated_bytes = solver_id_bytes + score_bytes + hash_logs_bytes + ergotree_bytes + secret_s_bytes

        # 7. Calculate Blake2b-256 hash
        h = hashlib.blake2b(digest_size=32)
        h.update(concatenated_bytes)
        commitment_hash_bytes = h.digest()

        # 8. Return hex
        return commitment_hash_bytes.hex()

    except (ValueError, binascii.Error, Exception) as e:
        print(f"Error during commitment generation: {e}")
        raise

# --- Example usage ---
if __name__ == '__main__':
    CONSTANT_SECRET_S_HEX = "35aa11186c18d3e04f81656248213a1a3c43e89a67045763287e644db60c3f21"
    CONSTANT_ERGOTREE_HEX = "a3f1bde417cf029a9d51dceaf45a08e23c4cc6f1ed2a75b3b394ac97b4e23145"

    parser = argparse.ArgumentParser(description="Genera un commitment para Game of Prompts.")
    parser.add_argument("score", type=int, help="La puntuación (score) obtenida por el solver.")
    args = parser.parse_args()

    user_score = args.score
    random_solver_id = os.urandom(32).hex()
    random_hash_logs_hex = os.urandom(32).hex()

    print("Inputs para generar el commitment:")
    print(f"  [PARÁMETRO]  Score (int): {user_score}")
    print(f"  [ALEATORIO]  Solver ID (hex): {random_solver_id}")
    print(f"  [ALEATORIO]  Hash Logs (hex): {random_hash_logs_hex}")
    print(f"  [CONSTANTE]  ErgoTree (hex): {CONSTANT_ERGOTREE_HEX}")
    print(f"  [CONSTANTE]  Secret S (hex): {CONSTANT_SECRET_S_HEX}")
    print("-" * 30)

    try:
        commitment_c = generate_gop_commitment(
            random_solver_id,
            user_score,
            random_hash_logs_hex,
            CONSTANT_SECRET_S_HEX,
            CONSTANT_ERGOTREE_HEX
        )
        print(f"✅ Commitment C (hex) generado:")
        print(f"   {commitment_c}")
        print(f"   Longitud: {len(commitment_c)} caracteres ({len(binascii.unhexlify(commitment_c))} bytes)")

    except Exception as e:
        print(f"❌ No se pudo generar el commitment: {e}")
