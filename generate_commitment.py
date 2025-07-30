import hashlib
import binascii

def generate_gop_commitment(
    solver_id: str,
    score: int,
    hash_logs_hex: str,
    secret_s_hex: str
) -> str:
    """
    Generates the cryptographic commitment for participation in Game of Prompts.

    Args:
        solver_id (str): The solver's identifier (e.g., "my_solver.celaut.bee" or an alias).
                         It will be encoded to UTF-8 bytes.
        score (int): The score obtained by the solver. It will be converted to bytes of an Ergo Long
                     (64-bit, big-endian, signed).
        hash_logs_hex (str): The hash of the game logs, as a hexadecimal string.
                             It must be a 32-byte hash (e.g., Blake2b-256), therefore, a 64-character hex string.
        secret_s_hex (str): The game's secret 'S', as a hexadecimal string.
                            Generally a 256-bit value (64-character hex string).

    Returns:
        str: The resulting commitment C (Blake2b-256 hash) as a hexadecimal string.
    """
    try:
        # 1. Convert solver_id to bytes (UTF-8)
        solver_id_bytes = solver_id.encode('utf-8')

        # 2. Convert score (Long) to bytes
        # ErgoScript Long is 64-bit (8 bytes), big-endian, signed.
        # Python's int.to_bytes handles this. The range of an Ergo Long is important.
        # If the score is always positive and does not exceed the maximum of an 8-byte unsigned Long,
        # To ensure compatibility, we handle the sign.
        if not (-(2**63) <= score < 2**63):
            raise ValueError(f"Score {score} is outside the range of a 64-bit signed Long.")
        score_bytes = score.to_bytes(8, byteorder='big', signed=True)

        # 3. Convert hash_logs_hex to bytes
        if len(hash_logs_hex) != 64: # A 256-bit hash is 32 bytes = 64 hex characters
             print(f"Warning: hash_logs_hex ('{hash_logs_hex}') does not have 64 characters. Ensure it is a 256-bit hash in hexadecimal.")
        hash_logs_bytes = binascii.unhexlify(hash_logs_hex)
        if len(hash_logs_bytes) != 32: # Double check in case the hex was valid but not 32 bytes
             raise ValueError(f"Resulting hash_logs_bytes is not 32 bytes long after conversion from hex '{hash_logs_hex}'.")


        # 4. Convert secret_s_hex to bytes
        if len(secret_s_hex) != 64: # A 256-bit secret is 32 bytes = 64 hex characters
             print(f"Warning: secret_s_hex ('{secret_s_hex}') does not have 64 characters. Ensure it is a 256-bit value in hexadecimal.")
        secret_s_bytes = binascii.unhexlify(secret_s_hex)
        if len(secret_s_bytes) != 32:
            raise ValueError(f"Resulting secret_s_bytes is not 32 bytes long after conversion from hex '{secret_s_hex}'.")


        # 5. Concatenate all bytes in the specified order
        concatenated_bytes = solver_id_bytes + score_bytes + hash_logs_bytes + secret_s_bytes

        # 6. Calculate the Blake2b-256 hash (digest_size=32 produces a 256-bit hash)
        h = hashlib.blake2b(digest_size=32)
        h.update(concatenated_bytes)
        commitment_hash_bytes = h.digest()

        # 7. Convert the resulting hash to a hexadecimal string
        return commitment_hash_bytes.hex()

    except ValueError as e:
        print(f"Value error during commitment generation: {e}")
        raise
    except binascii.Error as e:
        print(f"binascii error (probably incorrect hexadecimal format) during commitment generation: {e}")
        raise
    except Exception as e:
        print(f"Unexpected error during commitment generation: {e}")
        raise

# --- Example Usage ---
if __name__ == '__main__':
    ex_solver_id = "d19a3da7d5a202f11a30dc557c27ca0faa175ed59ee5faced72e6cb26858b72d"
    ex_score = 22800
    # hash_logs_hex and secret_s_hex must be 64-character hexadecimal strings
    ex_hash_logs_hex = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2" # Example
    ex_secret_s_hex = "7fef0c1ac4d9b7d78edcea8096011af620387c1ffdb568d2f7203f9bc63568a3" # Example

    print(f"Inputs for the commitment:")
    print(f"  Solver ID (string): {ex_solver_id}")
    print(f"  Score (int): {ex_score}")
    print(f"  Hash Logs (hex): {ex_hash_logs_hex}")
    print(f"  Secret S (hex): {ex_secret_s_hex}")
    print("-" * 30)

    try:
        commitment_c = generate_gop_commitment(
            ex_solver_id,
            ex_score,
            ex_hash_logs_hex,
            ex_secret_s_hex
        )
        print(f"Commitment C (hex): {commitment_c}")
        print(f"Length of Commitment C: {len(commitment_c)} hex characters ({len(binascii.unhexlify(commitment_c))} bytes)")

    except Exception as e:
        print(f"Could not generate the example commitment: {e}")