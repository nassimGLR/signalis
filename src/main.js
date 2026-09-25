// LETHE-7 — entry point.
import { Game } from './game/game.js';

const game = new Game();
window.__game = game;
game.start();
