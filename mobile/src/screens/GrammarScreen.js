import { ScrollView, Text, View } from "react-native";
import { grammarItems } from "../data/sampleContent";
import { globalStyles } from "../theme";

export default function GrammarScreen() {
  return (
    <ScrollView style={globalStyles.screen}>
      <Text style={globalStyles.title}>Grammar</Text>
      {grammarItems.map((item) => (
        <View key={item.id} style={globalStyles.card}>
          <Text style={globalStyles.subheading}>HSK {item.level}</Text>
          <Text style={globalStyles.heading}>{item.title}</Text>
          <Text style={globalStyles.text}>{item.structure}</Text>
          <Text style={globalStyles.muted}>{item.explanation}</Text>
          <Text style={globalStyles.text}>{item.example}</Text>
        </View>
      ))}
    </ScrollView>
  );
}
