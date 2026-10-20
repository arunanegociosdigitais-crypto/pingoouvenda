// Som de notificação de venda (cha-ching + voz "Pingou Venda").
// Tocado toda vez que uma venda é registrada com sucesso no app.

import saleSoundUrl from "./assets/som-venda-pingouvenda.mp3";

let audio: HTMLAudioElement | null = null;

function getAudio(): HTMLAudioElement | null {
  try {
    if (!audio) {
      audio = new Audio(saleSoundUrl);
      audio.preload = "auto";
    }
    return audio;
  } catch {
    return null;
  }
}

/** Toca o som de venda. Silencioso se o navegador bloquear (sem gesto, etc.). */
export function playSaleSound(): void {
  const el = getAudio();
  if (!el) return;
  try {
    el.currentTime = 0;
    void el.play().catch(() => {
      /* navegador bloqueou autoplay — ignora */
    });
  } catch {
    /* ambiente sem áudio — ignora */
  }
}
