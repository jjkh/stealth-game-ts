import './style.css';
import { MainCanvas } from './lib/Canvas';
import LevelEditor from './scenes/LevelEditor';

let currentScene: LevelEditor;

// debug info
let debugInfoDiv: HTMLDivElement | null;
let lastFrameTime = performance.now();

window.onload = init;

function init() {
  let canvas = new MainCanvas(document.querySelector<HTMLCanvasElement>('#app')!);
  currentScene = new LevelEditor(canvas);

  window.addEventListener('resize', () => canvas.resize(window.innerWidth, window.innerHeight));
  canvas.resize(window.innerWidth, window.innerHeight);

  // setup event callbacks
  canvas.pointerMoveHandler = (ev, p) => currentScene.onPointerMove ? currentScene.onPointerMove(ev, p) : {};
  canvas.pointerUpHandler = (ev, p) => currentScene.onPointerUp ? currentScene.onPointerUp(ev, p) : {};
  canvas.pointerDownHandler = (ev, p) => currentScene.onPointerDown ? currentScene.onPointerDown(ev, p) : {};
  canvas.keyDownHandler = ev => currentScene.onKeyDown ? currentScene.onKeyDown(ev) : {};
  canvas.keyUpHandler = ev => currentScene.onKeyUp ? currentScene.onKeyUp(ev) : {};
  canvas.wheelHandler = (ev, p) => currentScene.onWheel ? currentScene.onWheel(ev, p) : {};

  // debug info
  debugInfoDiv = document.querySelector<HTMLDivElement>('#debuginfo');

  window.requestAnimationFrame(mainLoop);
}

function mainLoop(timestamp: DOMHighResTimeStamp) {
  currentScene.draw();

  if (debugInfoDiv) {
    // debug info
    const fps = 1_000 / (timestamp - lastFrameTime);
    debugInfoDiv.innerHTML = `${fps.toFixed(2)} fps`;
    lastFrameTime = timestamp;
  }

  window.requestAnimationFrame(mainLoop);
}