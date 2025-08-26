import hashlib
import binascii
import argparse
import os

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
        if not (-(2**63) <= score < 2**63):
            raise ValueError(f"Score {score} is outside the range of a 64-bit signed Long.")
        score_bytes = score.to_bytes(8, byteorder='big', signed=True)

        # 3. Convert hash_logs_hex to bytes
        if len(hash_logs_hex) != 64:
             print(f"Warning: hash_logs_hex ('{hash_logs_hex}') does not have 64 characters. Ensure it is a 256-bit hash in hexadecimal.")
        hash_logs_bytes = binascii.unhexlify(hash_logs_hex)
        if len(hash_logs_bytes) != 32:
             raise ValueError(f"Resulting hash_logs_bytes is not 32 bytes long after conversion from hex '{hash_logs_hex}'.")

        # 4. Convert secret_s_hex to bytes
        if len(secret_s_hex) != 64:
             print(f"Warning: secret_s_hex ('{secret_s_hex}') does not have 64 characters. Ensure it is a 256-bit value in hexadecimal.")
        secret_s_bytes = binascii.unhexlify(secret_s_hex)
        if len(secret_s_bytes) != 32:
            raise ValueError(f"Resulting secret_s_bytes is not 32 bytes long after conversion from hex '{secret_s_hex}'.")

        # 5. Concatenate all bytes in the specified order
        concatenated_bytes = solver_id_bytes + score_bytes + hash_logs_bytes + secret_s_bytes

        # 6. Calculate the Blake2b-256 hash
        h = hashlib.blake2b(digest_size=32)
        h.update(concatenated_bytes)
        commitment_hash_bytes = h.digest()

        # 7. Convert the resulting hash to a hexadecimal string
        return commitment_hash_bytes.hex()

    except (ValueError, binascii.Error, Exception) as e:
        print(f"Error during commitment generation: {e}")
        raise

# --- Ejemplo de Uso ---
if __name__ == '__main__':
    # --- CONFIGURACIÓN ---
    # El secreto 'S' es siempre el mismo.
    CONSTANT_SECRET_S_HEX = "35aa11186c18d3e04f81656248213a1a3c43e89a67045763287e644db60c3f21"

    # --- LÓGICA DEL SCRIPT ---
    # Configurar el parser para leer argumentos de la línea de comandos
    parser = argparse.ArgumentParser(description="Genera un commitment para Game of Prompts.")
    parser.add_argument("score", type=int, help="La puntuación (score) obtenida por el solver.")
    args = parser.parse_args()

    # Obtener la puntuación del argumento
    user_score = args.score
    
    # Generar valores aleatorios para solver_id y hash_logs
    # os.urandom(32) genera 32 bytes criptográficamente seguros.
    # .hex() los convierte a una cadena hexadecimal de 64 caracteres.
    random_solver_id = os.urandom(32).hex()
    random_hash_logs_hex = os.urandom(32).hex()

    print("Inputs para generar el commitment:")
    print(f"  [PARÁMETRO]  Score (int): {user_score}")
    print(f"  [ALEATORIO]  Solver ID (hex): {random_solver_id}")
    print(f"  [ALEATORIO]  Hash Logs (hex): {random_hash_logs_hex}")
    print(f"  [CONSTANTE]  Secret S (hex): {CONSTANT_SECRET_S_HEX}")
    print("-" * 30)

    try:
        commitment_c = generate_gop_commitment(
            random_solver_id,
            user_score,
            random_hash_logs_hex,
            CONSTANT_SECRET_S_HEX
        )
        print(f"✅ Commitment C (hex) generado:")
        print(f"   {commitment_c}")
        print(f"   Longitud: {len(commitment_c)} caracteres ({len(binascii.unhexlify(commitment_c))} bytes)")

    except Exception as e:
        print(f"❌ No se pudo generar el commitment: {e}")