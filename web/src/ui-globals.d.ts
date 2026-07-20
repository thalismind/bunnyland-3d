declare module '@bunnyland/ui-web/assets/bunnyland-ui.js';

interface Window {
  BunnylandUI: {
    initClientMenu(options?: { baseUrl?: string }): { close?: () => void } | void;
  };
}
