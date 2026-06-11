import { ScrollView, Text, View } from "react-native";
import { useProgress } from "../context/ProgressContext";
import { globalStyles } from "../theme";

export default function DashboardScreen({ navigation }) {
  const { progress, subscription } = useProgress();
  const stats = [
    ["XP", progress.xp || 0],
    ["Tokens", progress.tokens || 0],
    ["Level", progress.level || 1],
    ["Vocabulary", progress.vocabulary_completed || 0],
    ["Reading", progress.reading_completed || 0],
    ["Listening", progress.listening_completed || 0],
    ["Exercises", progress.exercises_completed || 0]
  ];

  return (
    <ScrollView style={globalStyles.screen}>
      <Text style={globalStyles.title}>Dashboard</Text>
      <Text style={globalStyles.muted}>Realtime progress shared with the website.</Text>
      <View style={globalStyles.card}>
        <Text style={globalStyles.subheading}>Subscription</Text>
        <Text style={globalStyles.text}>{subscription?.plan_name || subscription?.plan || "Free Trial"}</Text>
      </View>
      {stats.map(([label, value]) => (
        <View key={label} style={globalStyles.card}>
          <View style={globalStyles.row}>
            <Text style={globalStyles.text}>{label}</Text>
            <Text style={globalStyles.subheading}>{value}</Text>
          </View>
        </View>
      ))}
      <Text style={globalStyles.muted} onPress={() => navigation.navigate("Settings")}>
        Manage mobile settings
      </Text>
    </ScrollView>
  );
}
