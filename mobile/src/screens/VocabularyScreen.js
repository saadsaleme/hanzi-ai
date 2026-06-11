import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { starterVocabulary, hskLevels } from "../data/sampleContent";
import { playChineseAudio } from "../lib/audio";
import { globalStyles } from "../theme";

export default function VocabularyScreen() {
  const [level, setLevel] = useState(1);
  const words = useMemo(() => starterVocabulary.filter((word) => word.level === level), [level]);

  return (
    <ScrollView style={globalStyles.screen}>
      <Text style={globalStyles.title}>Vocabulary</Text>
      <View style={[globalStyles.row, { flexWrap: "wrap", justifyContent: "flex-start" }]}>
        {hskLevels.map((item) => (
          <Pressable key={item} style={globalStyles.pill} onPress={() => setLevel(item)}>
            <Text style={globalStyles.pillText}>HSK {item}</Text>
          </Pressable>
        ))}
      </View>
      {words.map((word) => (
        <View key={word.id} style={globalStyles.card}>
          <View style={globalStyles.row}>
            <Text style={globalStyles.heading}>{word.hanzi}</Text>
            <Text style={globalStyles.pillText}>HSK {word.level}</Text>
          </View>
          <Text style={globalStyles.muted}>{word.pinyin}</Text>
          <Text style={globalStyles.text}>{word.meaning}</Text>
          <Text style={globalStyles.muted}>{word.example}</Text>
          <View style={globalStyles.row}>
            <Pressable style={globalStyles.ghostButton} onPress={() => playChineseAudio(word.hanzi)}>
              <Text style={globalStyles.ghostText}>Play Audio</Text>
            </Pressable>
            <Pressable style={globalStyles.ghostButton} onPress={() => playChineseAudio(word.hanzi, { slow: true })}>
              <Text style={globalStyles.ghostText}>Slow</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}
