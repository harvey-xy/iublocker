import { render } from 'preact';
import { Logger } from './Logger';

const root = document.getElementById('app');
if (root) render(<Logger />, root);
