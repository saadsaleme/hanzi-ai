import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { starterVocabulary } from "../data/sampleContent";
import { playChineseAudio } from "../lib/audio";
import { useProgress } from "../context/ProgressContext";
import { globalStyles } from "../theme";

export default function FlashcardsScreen() {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const { recordAnswer } = useProgress();
  const card = useMemo(() => starterVocabulary[index], [index]);

  function nextCard(correct) {
    recordAnswer({ activityType: "vocabulary", activityId: `flashcard-${card.id}`, correct });
    setRevealed(false);
    setIndex((index + 1) % starterVocabulary.length);
  }

  return (
    <ScrollView style={globalStyles.screen}>
      <Text style={globalStyles.title}>Flashcards</Text>
      <Text style={globalStyles.muted}>
        Card {index + 1} of {starterVocabulary.length}
      </Text>
      <View style={globalStyles.card}>
        <Text style={globalStyles.heading}>{card.hanzi}</Text>
        <Text style={globalStyles.muted}>HSK {card.level}</Text>
        {revealed ? (
          <>
            <Text style={globalStyles.text}>{card.pinyin}</Text>
            <Text style={globalStyles.text}>{card.meaning}</Text>
            <Text style={globalStyles.muted}>{card.example}</Text>
          </>
        ) : null}
        <View style={globalStyles.row}>
          <Pressable style={globalStyles.ghostButton} onPress={() => playChineseAudio(card.hanzi)}>
            <Text style={globalStyles.ghostText}>Play Audio</Text>
          </Pressable>
          <Pressable style={globalStyles.ghostButton} onPress={() => playChineseAudio(card.hanzi, { slow: true })}>
            <Text style={globalStyles.ghostText}>Slow</Text>
          </Pressable>
        </View>
        {!revealed ? (
          <Pressable style={globalStyles.button} onPress={() => setRevealed(true)}>
            <Text style={globalStyles.buttonText}>Reveal</Text>
          </Pressable>
        ) : (
          <View style={globalStyles.row}>
            <Pressable style={globalStyles.button} onPress={() => nextCard(true)}>
              <Text style={globalStyles.buttonText}>Know It</Text>
            </Pressable>
            <Pressable style={globalStyles.ghostButton} onPress={() => nextCard(false)}>
              <Text style={globalStyles.ghostText}>Review Again</Text>
            </Pressable>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
