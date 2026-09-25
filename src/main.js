// LETHE-7 — entry point.
import { Game } from './game/game.js';
import { installTouch } from './ui/touch.js';

const game = new Game();
installTouch(game.input);
window.__game = game;
game.start();
