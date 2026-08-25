import './styles.css';
import { Game } from './game/Game';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const game = new Game(canvas);

document.getElementById('start')!.addEventListener('click', () => game.start());
document.getElementById('restart')!.addEventListener('click', () => game.restart());
