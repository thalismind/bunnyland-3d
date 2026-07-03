import '@bunnyland/ui-web/assets/bunnyland-ui.css';
import { bindThemeSelect } from '@bunnyland/ui-web/theme';

const themeSelect = document.getElementById('theme-select') as HTMLSelectElement | null;

if (themeSelect) {
  bindThemeSelect(themeSelect);
}
