/**
 * main.js — entry point: boot the game, surface fatal errors politely.
 */
import { Game } from './game.js';

async function boot() {
  const canvas = document.getElementById('game-canvas');
  try {
    const game = new Game(canvas);
    window.__game = game;    // handy for debugging / automated tests
    await game.start();
  } catch (err) {
    console.error(err);
    const msg = document.createElement('div');
    msg.style.cssText =
      'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
      'background:#05010e;color:#ff3355;font-family:monospace;font-size:14px;' +
      'padding:2rem;text-align:center;z-index:99';
    msg.textContent =
      'NEOVOLT failed to start: ' + err.message +
      ' — make sure you are serving the folder over HTTP (not file://).';
    document.body.appendChild(msg);
  }
}

boot();
