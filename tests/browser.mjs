import { chromium } from 'playwright';

/** Usa o Chromium informado pelo ambiente ou o navegador gerenciado pelo Playwright. */
export function abrirNavegador() {
  const opcoes = { args: ['--no-sandbox'] };
  if (process.env.PW_CHROMIUM) opcoes.executablePath = process.env.PW_CHROMIUM;
  return chromium.launch(opcoes);
}
