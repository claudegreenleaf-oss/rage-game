// Music / Effects sliders and the mute toggle, shared by the pause menu and the Settings screen.
import Phaser from 'phaser';
import { C } from '../render/palette';
import { Button, Slider } from '../render/ui';
import { audio } from '../audio/sfx';

export function volumeControls(scene: Phaser.Scene, x: number, y: number, gap: number, w = 420): { items: Array<Slider | Button>; mute: Button } {
  let lastBlip = 0;
  const music = new Slider(scene, x, y, 'Music', () => audio.musicVolume, (v) => audio.setVolumes({ music: v }), { w });
  const sfx = new Slider(scene, x, y + gap, 'Effects', () => audio.sfxVolume, (v) => {
    audio.setVolumes({ sfx: v });
    // A preview blip so you hear the new level (throttled while dragging).
    const now = scene.time.now;
    if (now - lastBlip > 90) { lastBlip = now; audio.play('pop', 1 + v * 0.3, 1); }
  }, { w });
  const label = () => (audio.muted ? 'Sound: off (N)' : 'Sound: on (N)');
  const mute: Button = new Button(scene, x, y + gap * 2, label(), () => { audio.toggleMute(); mute.setText(label()); }, { color: C.paper, w });
  const unsub = audio.onMute(() => mute.setText(label()));
  scene.events.once('shutdown', () => unsub());
  return { items: [music, sfx, mute], mute };
}
