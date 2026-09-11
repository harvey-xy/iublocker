import { render } from 'preact';
import { Dashboard } from './Dashboard';

const root = document.getElementById('app');
if (root) render(<Dashboard />, root);
