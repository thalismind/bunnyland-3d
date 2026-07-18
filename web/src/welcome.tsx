import '@bunnyland/ui-web/assets/bunnyland-ui.css';
import { ThemeSelect } from '@bunnyland/ui-web/preact';
import { render } from 'preact';

const themeSelectRoot = document.getElementById('theme-select-root');

if (themeSelectRoot) render(<ThemeSelect id="theme-select" aria-label="Theme" />, themeSelectRoot);
