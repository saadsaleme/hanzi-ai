import * as Speech from "expo-speech";

let speaking = false;

export async function playChineseAudio(text, options = {}) {
  const { slow = false } = options;

  if (speaking) {
    Speech.stop();
    speaking = false;
    return;
  }

  speaking = true;
  Speech.speak(text, {
    language: "zh-CN",
    rate: slow ? 0.55 : 0.9,
    pitch: 1,
    onDone: () => {
      speaking = false;
    },
    onStopped: () => {
      speaking = false;
    },
    onError: () => {
      speaking = false;
    }
  });
}

export function stopAudio() {
  Speech.stop();
  speaking = false;
}
