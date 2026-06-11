import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { listeningItems } from "../data/sampleContent";
import { playChineseAudio } from "../lib/audio";
import { useProgress } from "../context/ProgressContext";
import { globalStyles } from "../theme";

export default function ListeningScreen() {
  const [index, setIndex] = useState(0);
  const [checked, setChecked] = useState(false);
  const { recordAnswer } = useProgress();
  const item = listeningItems[index];

  function check(correct) {
    setChecked(true);
    recordAnswer({ activityType: "listening", activityId: item.id, correct });
  }

  return (
    <ScrollView style={globalStyles.screen}>
      <Text style={globalStyles.title}>Listening</Text>
      <View style={globalStyles.card}>
        <Text style={globalStyles.subheading}>{item.title}</Text>
        <Text style={globalStyles.muted}>HSK {item.level}</Text>
        <View style={globalStyles.row}>
          <Pressable style={globalStyles.button} onPress={() => playChineseAudio(item.transcript)}>
            <Text style={globalStyles.buttonText}>Play Audio</Text>
          </Pressable>
          <Pressable style={globalStyles.ghostButton} onPress={() => playChineseAudio(item.transcript, { slow: true })}>
            <Text style={globalStyles.ghostText}>Slow</Text>
          </Pressable>
        </View>
        <Text style={globalStyles.muted}>{item.transcript}</Text>
      </View>
      <View style={globalStyles.card}>
        <Text style={globalStyles.text}>{item.question}</Text>
        {checked ? <Text style={globalStyles.muted}>Answer: {item.answer}</Text> : null}
        <View style={globalStyles.row}>
          <Pressable style={globalStyles.button} onPress={() => check(true)}>
            <Text style={globalStyles.buttonText}>Correct</Text>
          </Pressable>
          <Pressable style={globalStyles.ghostButton} onPress={() => check(false)}>
            <Text style={globalStyles.ghostText}>Wrong</Text>
          </Pressable>
        </View>
      </View>
      <Pressable
        style={globalStyles.ghostButton}
        onPress={() => {
          setChecked(false);
          setIndex((index + 1) % listeningItems.length);
        }}
      >
        <Text style={globalStyles.ghostText}>Next Listening</Text>
      </Pressable>
    </ScrollView>
  );
}
