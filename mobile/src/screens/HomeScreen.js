import { Pressable, ScrollView, Text, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import { useProgress } from "../context/ProgressContext";
import { globalStyles } from "../theme";

const menuItems = ["Flashcards", "Exercises", "Exam", "Grammar", "Plans", "Settings"];

export default function HomeScreen({ navigation }) {
  const { profile, user } = useAuth();
  const { progress, subscription } = useProgress();
  const name = profile?.full_name || user?.email?.split("@")[0] || "Learner";

  return (
    <ScrollView style={globalStyles.screen}>
      <Text style={globalStyles.title}>Welcome, {name}</Text>
      <Text style={globalStyles.muted}>Continue your Chinese learning path across mobile and web.</Text>

      <View style={globalStyles.card}>
        <View style={globalStyles.row}>
          <View>
            <Text style={globalStyles.subheading}>Level {progress.level}</Text>
            <Text style={globalStyles.text}>{progress.xp || 0} XP</Text>
          </View>
          <View>
            <Text style={globalStyles.subheading}>{progress.tokens || 0}</Text>
            <Text style={globalStyles.muted}>Tokens</Text>
          </View>
        </View>
        <Text style={globalStyles.muted}>
          Plan: {subscription?.plan_name || subscription?.plan || profile?.subscription_plan || "Free Trial"}
        </Text>
      </View>

      <Pressable style={globalStyles.button} onPress={() => navigation.navigate("Learn", { screen: "Vocabulary" })}>
        <Text style={globalStyles.buttonText}>Start Learning</Text>
      </Pressable>

      {menuItems.map((item) => (
        <Pressable key={item} style={globalStyles.ghostButton} onPress={() => navigation.navigate(item)}>
          <Text style={globalStyles.ghostText}>{item}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
