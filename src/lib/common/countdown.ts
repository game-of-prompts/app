import { type Platform } from "./platform";



export async function block_to_time(target_block: number, platform: Platform): Promise<number>
{
    let current_block = await platform.get_current_height();
    let diff_block = target_block - current_block;

    let diff_time = diff_block * platform.time_per_block;
    
    return new Date().getTime() + diff_time;
}

export async function block_to_date(target_block: number, platform: Platform): Promise<string>
{
    const blockTime = await block_to_time(target_block, platform);
    const date = new Date(blockTime);
    // Format date as YYYY-MM-DD HH:MM UTC
    return `${date.getUTCFullYear()}-${(date.getUTCMonth() + 1).toString().padStart(2, '0')}-${date.getUTCDate().toString().padStart(2, '0')} ${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')} UTC`;
}

export async function time_to_block(target_time: number, platform: Platform): Promise<number>
{
    // Get the current block height
    let current_block = await platform.get_current_height();
    
    // Get the current timestamp in milliseconds
    let current_time = new Date().getTime();
    
    // Calculate the time difference in milliseconds
    let diff_time = target_time - current_time;
    
    // Calculate the number of blocks that will pass until the target time
    let diff_blocks = Math.ceil(diff_time / platform.time_per_block);
    
    // Calculate the target block number
    return current_block + diff_blocks;
}


/**
 * Calcula el timestamp Unix estimado (en milisegundos) para una altura de bloque objetivo.
 * Nota: Esta función es lógicamente idéntica a la existente `block_to_time`.
 * Se añade para claridad semántica si se prefiere este nombre.
 * @param target_block La altura de bloque objetivo.
 * @param platform Instancia de Platform con get_current_height() y time_per_block.
 * @returns Promise<number> El timestamp estimado en milisegundos.
 */
export async function block_height_to_timestamp(target_block: number, platform: Platform): Promise<number> {
    const current_block = await platform.get_current_height();
    const diff_block = target_block - current_block;

    // Si target_block es en el pasado o actual, diff_block será <= 0.
    // El cálculo da correctamente un timestamp pasado o actual relativo al ahora.
    const diff_time_ms = diff_block * platform.time_per_block;
    
    return new Date().getTime() + diff_time_ms;
}

/**
 * Calcula el tiempo restante hasta una altura de bloque objetivo y lo devuelve como un string legible.
 * @param target_block La altura de bloque objetivo.
 * @param platform Instancia de Platform.
 * @returns Promise<string> Un string como "X days, Y hours left", "Z minutes left", o "Expired".
 */
export async function block_to_time_remaining(target_block: number, platform: Platform): Promise<string> {
    const target_timestamp = await block_height_to_timestamp(target_block, platform); // Usa la nueva función (o block_to_time)
    const current_timestamp = new Date().getTime();
    let diff_ms = target_timestamp - current_timestamp;

    if (diff_ms <= 0) {
        // Una comprobación adicional: si por la varianza de tiempos diff_ms es negativo
        // pero el bloque actual aún es menor que target_block, significa que está muy cerca.
        const current_block = await platform.get_current_height();
        if (target_block > current_block && diff_ms > -platform.time_per_block * 5) { // ej. si no ha pasado más de 5 bloques "teóricos" en tiempo
            return "Closing very soon";
        }
        return "Expired";
    }

    const s_in_ms = 1000;
    const m_in_ms = 60 * s_in_ms;
    const h_in_ms = 60 * m_in_ms;
    const d_in_ms = 24 * h_in_ms;

    const days = Math.floor(diff_ms / d_in_ms);
    diff_ms %= d_in_ms; // Resto de ms después de quitar los días completos

    const hours = Math.floor(diff_ms / h_in_ms);
    diff_ms %= h_in_ms; // Resto de ms después de quitar las horas completas

    const minutes = Math.floor(diff_ms / m_in_ms);
    // diff_ms %= m_in_ms; // Resto de ms después de quitar los minutos completos (para segundos)
    // const seconds = Math.floor(diff_ms / s_in_ms);


    const parts: string[] = [];

    if (days > 0) {
        parts.push(`${days} day${days > 1 ? 's' : ''}`);
    }
    if (hours > 0) {
        parts.push(`${hours} hr${hours > 1 ? 's' : ''}`);
    }
    
    // Mostrar minutos si no hay días, o si es la única unidad significativa > 0
    if (minutes > 0 && days === 0 ) { 
        parts.push(`${minutes} min${minutes > 1 ? 's' : ''}`);
    }
    
    // Si después de todo no hay partes (ej. menos de 1 minuto)
    if (parts.length === 0) {
        if (target_timestamp - current_timestamp > 0) { // Asegurarse que realmente queda tiempo
            return "Less than a minute";
        } else { // Esto debería ser capturado por el primer if (diff_ms <= 0)
            return "Expired";
        }
    }
    
    // Unir las primeras dos partes más significativas para brevedad si hay más de dos
    // o todas si hay una o dos.
    if (parts.length > 2) {
        return `${parts[0]}, ${parts[1]} left`;
    } else {
        return `${parts.join(', ')} left`;
    }
}