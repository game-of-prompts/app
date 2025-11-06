import { type AnyGame as Game } from "./game";
import { game_detail } from "./store";
import { fetchGame, fetchGoPGames } from "$lib/ergo/fetch";

/**
 * Loads a game by its ID, searching first among active games and then
 * among finished games. Updates the game_detail store.
 * @param gameId The ID of the game to load.
 * @param platform An instance of the Platform object that implements
 * fetchGoPGames.
 */
export async function loadGameById(gameId: string): Promise<void> {
    let gamesMap: Map<string, Game> = await fetchGoPGames(false, true);
    let game: Game | undefined = gamesMap.get(gameId);
    
    if (game) {
        console.log(`Juego ${gameId} encontrado.`);
        game_detail.set(game);
        return;
    }
    else {
        game_detail.set(await fetchGame(gameId));
    }
}