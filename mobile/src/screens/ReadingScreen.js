import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { readingItems } from "../data/sampleContent";
import { playChineseAudio } from "../lib/audio";
import { useProgress } from "../context/ProgressContext";
import { colors, globalStyles } from "../theme";

export default function ReadingScreen() {
  const [index, setIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [lookup, setLookup] = useState(null);
  const { recordAnswer } = useProgress();
  const item = readingItems[index];

  function checkAnswer(correct) {
    setShowAnswer(true);
    recordAnswer({ activityType: "reading", activityId: item.id, correct });
  }

  return (
    <ScrollView style={globalStyles.screen}>
      <Text style={globalStyles.title}>Reading</Text>
      <Text style={globalStyles.muted}>
        Reading {index + 1} of {readingItems.length} · HSK {item.level}
      </Text>
      <View style={globalStyles.card}>
        <Text style={globalStyles.subheading}>{item.title}</Text>
        <Pressable onLongPress={() => setLookup({ word: "学习", pinyin: "xue xi", meaning: "to study" })}>
          <Text style={[globalStyles.text, { fontSize: 19, lineHeight: 32 }]}>{item.text}</Text>
        </Pressable>
        <View style={globalStyles.row}>
          <Pressable style={globalStyles.ghostButton} onPress={() => playChineseAudio(item.text)}>
            <Text style={globalStyles.ghostText}>Play Audio</Text>
          </Pressable>
          <Pressable style={globalStyles.ghostButton} onPress={() => playChineseAudio(item.text, { slow: true })}>
            <Text style={globalStyles.ghostText}>Slow</Text>
          </Pressable>
        </View>
      </View>
      <View style={globalStyles.card}>
        <Text style={globalStyles.subheading}>Question</Text>
        <Text style={globalStyles.text}>{item.question}</Text>
        {showAnswer ? <Text style={globalStyles.muted}>Answer: {item.answer}</Text> : null}
        <View style={globalStyles.row}>
          <Pressable style={globalStyles.button} onPress={() => checkAnswer(true)}>
            <Text style={globalStyles.buttonText}>I got it</Text>
          </Pressable>
          <Pressable style={globalStyles.ghostButton} onPress={() => checkAnswer(false)}>
            <Text style={globalStyles.ghostText}>Review</Text>
          </Pressable>
        </View>
      </View>
      <View style={globalStyles.row}>
        <Pressable style={globalStyles.ghostButton} onPress={() => setIndex(Math.max(0, index - 1))}>
          <Text style={globalStyles.ghostText}>Previous</Text>
        </Pressable>
        <Pressable style={globalStyles.ghostButton} onPress={() => setIndex(Math.min(readingItems.length - 1, index + 1))}>
          <Text style={globalStyles.ghostText}>Next</Text>
        </Pressable>
      </View>
      <Modal transparent visible={Boolean(lookup)} animationType="fade" onRequestClose={() => setLookup(null)}>
        <Pressable style={{ flex: 1, justifyContent: "center", padding: 24 }} onPress={() => setLookup(null)}>
          <View style={[globalStyles.card, { backgroundColor: colors.panelSoft }]}>
            <Text style={globalStyles.heading}>{lookup?.word}</Text>
            <Text style={globalStyles.muted}>{lookup?.pinyin}</Text>
            <Text style={globalStyles.text}>{lookup?.meaning}</Text>
            <Pressable style={globalStyles.ghostButton} onPress={() => playChineseAudio(lookup?.word || "")}>
              <Text style={globalStyles.ghostText}>Play Audio</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}
